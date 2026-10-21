/**
 * The edge pre-fetch, wired to this app: the public origin the plugin prints,
 * this build's asset version, a real fetch. See lib/edge-prefetch-core.ts for
 * what it does and why.
 *
 * Production only unless SC_EDGE_PREFETCH says otherwise.
 */

import { assetVersion } from "../routes/embed";
import { KEY_HEADER } from "./embed-key";
import { prefetchEdgeAssets, type EdgePrefetchSummary } from "./edge-prefetch-core";
import { CANONICAL_PUBLIC_ORIGIN, configuredPublicOrigin } from "./request";

const REQUEST_TIMEOUT_MS = 60 * 1000;
const VERSION_TIMEOUT_MS = 20 * 1000;

function flag(name: string, fallback: boolean): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return fallback;
}

export function edgePrefetchEnabled(): boolean {
  return flag("SC_EDGE_PREFETCH", process.env["NODE_ENV"] === "production");
}

function note(line: string): void {
  process.stderr.write(`[edge-prefetch] ${new Date().toISOString()} ${line}\n`);
}

/** The production wiring: the public origin, this build's version, a real fetch. */
export function startEdgePrefetch(): Promise<EdgePrefetchSummary> {
  const origin = configuredPublicOrigin() ?? CANONICAL_PUBLIC_ORIGIN;
  const key = (process.env["SC_EMBED_KEY"] ?? "").trim();
  return prefetchEdgeAssets({
    origin,
    version: assetVersion(),
    // The build the origin is serving, read the way the plugin reads it. See
    // the guard in lib/edge-prefetch-core.ts: this is what keeps a workspace
    // run, or a VM the proxy has not switched to, from poisoning the edge.
    originVersion: async () => {
      const res = await fetch(`${origin}/embed/assets.json`, {
        headers: { accept: "application/json", "cache-control": "no-cache", ...(key ? { [KEY_HEADER]: key } : {}) },
        signal: AbortSignal.timeout(VERSION_TIMEOUT_MS),
      });
      if (res.status !== 200) return null;
      const body = (await res.json()) as { version?: unknown };
      return typeof body.version === "string" && body.version ? body.version : null;
    },
    fetch: async (url) => {
      const res = await fetch(url, {
        headers: { accept: "text/css,*/*;q=0.1", "user-agent": "StatChasers-EdgePrefetch/1 (+https://statchasers.com)" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      await res.arrayBuffer();
      return { status: res.status, cache: res.headers.get("cf-cache-status") };
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    note,
  });
}
