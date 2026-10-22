/**
 * A memory breadcrumb for the deployment's Logs pane.
 *
 * The 10-21/10-22 deaths left nothing behind: the VM stopped answering and
 * the pane (stderr only, see live-refresh.ts) had no line that said how big
 * the process had grown first. This writes one every ten minutes - resident
 * size, the JS heap against V8's own ceiling, and what the VM has left
 * (cgroup-aware, lib/mem.ts) - so the next outage has a trend to read, and a
 * louder line when either ceiling is close.
 *
 * V8's ceiling is the thing to watch: left to itself V8 sizes the old
 * generation from a quarter of the machine's RAM, which on the 2 GB VM is
 * ~512 MB of heap before "JavaScript heap out of memory" ends the process.
 * package.json's start script raises it explicitly.
 *
 * Production only, like the watchdog; SC_MEM_LOG=1 turns it on elsewhere,
 * SC_MEM_LOG=0 off.
 */

import v8 from "node:v8";
import { availableMemMb } from "./mem";

const INTERVAL_MS = 10 * 60 * 1000;
/** Heap used over this share of V8's limit is one GC storm from the end. */
const HEAP_WARN_SHARE = 0.85;
/** The VM's headroom under which a builder child cannot be afforded. */
const AVAIL_WARN_MB = 250;

function flag(name: string, fallback: boolean): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return fallback;
}

export function memLogEnabled(): boolean {
  return flag("SC_MEM_LOG", process.env["NODE_ENV"] === "production");
}

export interface MemSample {
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  heapLimitMb: number;
  externalMb: number;
  availableMb: number;
}

export function sampleMemory(): MemSample {
  const m = process.memoryUsage();
  const mb = (n: number) => Math.round(n / 1048576);
  return {
    rssMb: mb(m.rss),
    heapUsedMb: mb(m.heapUsed),
    heapTotalMb: mb(m.heapTotal),
    heapLimitMb: mb(v8.getHeapStatistics().heap_size_limit),
    externalMb: mb(m.external),
    availableMb: availableMemMb(),
  };
}

/** The line as the pane shows it; "WARN" prefixed when a ceiling is close. */
export function memLine(s: MemSample, now: Date = new Date()): string {
  const warnings: string[] = [];
  if (s.heapLimitMb > 0 && s.heapUsedMb > s.heapLimitMb * HEAP_WARN_SHARE) {
    warnings.push(`heap within ${Math.round(100 - HEAP_WARN_SHARE * 100)}% of V8's limit`);
  }
  if (s.availableMb >= 0 && s.availableMb < AVAIL_WARN_MB) {
    warnings.push(`VM has under ${AVAIL_WARN_MB}MB left`);
  }
  const body =
    `rss=${s.rssMb}MB heap=${s.heapUsedMb}/${s.heapTotalMb}MB (limit ${s.heapLimitMb}MB) ` +
    `external=${s.externalMb}MB avail=${s.availableMb}MB`;
  return `[mem] ${now.toISOString()} ${warnings.length ? `WARN ${warnings.join("; ")}: ` : ""}${body}`;
}

export function startMemLog(): void {
  if (!memLogEnabled()) return;
  const write = () => process.stderr.write(`${memLine(sampleMemory())}\n`);
  write();
  setInterval(write, INTERVAL_MS).unref();
}
