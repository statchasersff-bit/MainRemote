/**
 * The live-site warm crawl after a publish, run from the server at boot.
 *
 * What scripts/warm-live.mjs does and why is in that file. This is its
 * wiring: production only (SC_LIVE_WARM overrides), a wait for the boot chain
 * to clear the VM, and THE GUARD shared with the edge pre-fetch - nothing is
 * crawled until the public origin's /embed/assets.json reports this build.
 * The proxy switches to a new VM some minutes after it boots; a crawl before
 * that would fill WordPress's page cache with the previous build's markup and
 * hide the publish until the cache expired.
 *
 * The sequencing is lib/live-warm-core.ts. The crawl runs as a child process so that nothing of it lives in the
 * server's heap, like every builder (lib/player/live-refresh.ts); it is one
 * outbound request every 1.6 s, so it costs the server exactly the renders
 * a slow visitor would. Its summary line goes to stderr as `[live-warm]`,
 * where the deployment's Logs pane can see it.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assetVersion } from "../routes/embed";
import { KEY_HEADER } from "./embed-key";
import { CANONICAL_PUBLIC_ORIGIN, configuredPublicOrigin } from "./request";
import { runLiveWarm } from "./live-warm-core";

const SCRIPT = "warm-live.mjs";
const VERSION_TIMEOUT_MS = 20 * 1000;
/** 864 pages at 1.6 s is 23 min; the cap only matters if the site stalls. */
const CRAWL_TIMEOUT_MS = 60 * 60 * 1000;
const CHILD_HEAP_MB = 128;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = [path.resolve(HERE, "..", "scripts"), path.resolve(HERE, "..", "..", "..", "scripts")].find((dir) =>
  fs.existsSync(path.join(dir, SCRIPT)),
);

function flag(name: string, fallback: boolean): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return fallback;
}

export function liveWarmEnabled(): boolean {
  return flag("SC_LIVE_WARM", process.env["NODE_ENV"] === "production");
}

function note(line: string): void {
  process.stderr.write(`[live-warm] ${new Date().toISOString()} ${line}\n`);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The build the public origin is serving, read the way the plugin reads it. */
async function originVersion(origin: string): Promise<string | null> {
  const key = (process.env["SC_EMBED_KEY"] ?? "").trim();
  try {
    const res = await fetch(`${origin}/embed/assets.json`, {
      headers: { accept: "application/json", "cache-control": "no-cache", ...(key ? { [KEY_HEADER]: key } : {}) },
      signal: AbortSignal.timeout(VERSION_TIMEOUT_MS),
    });
    if (res.status !== 200) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === "string" && body.version ? body.version : null;
  } catch {
    return null;
  }
}

function runScript(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!SCRIPTS_DIR) {
      reject(new Error("scripts/ not found beside the server"));
      return;
    }
    execFile(
      process.execPath,
      [`--max-old-space-size=${CHILD_HEAP_MB}`, path.join(SCRIPTS_DIR, SCRIPT), ...args],
      { timeout: CRAWL_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(`${SCRIPT}: ${err.message}${stderr ? ` - ${stderr.slice(-500)}` : ""}`));
        else {
          // The script's slowest-pages and failure lines, for the pane.
          for (const line of stderr.split("\n")) if (line.trim()) note(line.trim());
          resolve(stdout);
        }
      },
    );
  });
}

/** The production wiring: this build's version, the public origin, the real script. */
export function startLiveWarm(): Promise<string | null> {
  const origin = configuredPublicOrigin() ?? CANONICAL_PUBLIC_ORIGIN;
  return runLiveWarm({
    version: assetVersion(),
    originVersion: () => originVersion(origin),
    run: runScript,
    sleep,
    note,
  });
}
