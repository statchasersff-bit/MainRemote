/**
 * Ask Cloudflare for this build's stylesheets and bundles right after boot.
 *
 * A publish changes the asset hash, so the first visitor after it asks the
 * edge for `team.css?ver=<new>`, which the edge has never seen and fetches
 * from the origin - and the origin, freshly booted, is at its slowest. On
 * 2026-10-21 that left pages unstyled for twelve minutes: the markup came
 * from WordPress's last good render, the stylesheet queued behind the cold
 * start. These URLs are immutable once the edge has them (app.ts marks the
 * matching ver= `max-age=31536000, immutable`), so one request each from here,
 * while the process is still idle, is the whole fix. Nothing to do when the
 * build has no version (assetVersion() === "0"): the plugin then prints its
 * own constant, and there is no hashed URL to warm.
 *
 * Production only unless SC_EDGE_PREFETCH says otherwise. The origin is the
 * public one the plugin prints (lib/request.ts), never the bare *.replit.app
 * name: a cache entry under the wrong host warms nothing. The wiring to this
 * app (origin, build version, a real fetch) is lib/edge-prefetch.ts; this file
 * has no state, so tests reach it directly.
 */

import { HASHED_ASSET_PATHS } from "./hashed-assets";

const CONCURRENCY = 2;
/** A second pass for whatever failed the first: the proxy may still be routing the new VM. */
export const RETRY_DELAY_MS = 3 * 60 * 1000;

/** The versioned URLs the plugin prints, for one origin and one build. */
export function edgeAssetUrls(origin: string, version: string): string[] {
  const base = origin.replace(/\/+$/, "");
  return HASHED_ASSET_PATHS.map((p) => `${base}${p}?ver=${encodeURIComponent(version)}`);
}

export interface EdgeFetchResult {
  status: number;
  /** Cloudflare's cf-cache-status, when it answered. */
  cache: string | null;
}

export interface EdgePrefetchDeps {
  fetch: (url: string) => Promise<EdgeFetchResult>;
  sleep: (ms: number) => Promise<void>;
  note: (line: string) => void;
  origin: string;
  version: string;
  /**
   * What build the origin is serving right now (its /embed/assets.json
   * version), or null when it does not answer. THE GUARD: a process that is
   * not the one behind the origin - a workspace run, a VM the proxy has not
   * switched to yet - must not ask the edge for `?ver=<its build>`, because
   * the edge would then hold the OTHER build's bytes under this build's hash,
   * immutable for a year, and serve them to every visitor after the publish
   * that makes this hash real. Nothing is fetched until the origin answers
   * with this very version; it is asked again after each `retryDelayMs`, up
   * to `attempts` times.
   */
  originVersion?: () => Promise<string | null>;
  attempts?: number;
  retryDelayMs?: number;
}

export interface EdgePrefetchSummary {
  requested: number;
  /** Answered 200: the edge holds it now (HIT already, or MISS just filled). */
  cached: number;
  failed: string[];
}

async function pass(urls: readonly string[], deps: EdgePrefetchDeps): Promise<{ cached: number; failed: string[] }> {
  let cached = 0;
  const failed: string[] = [];
  const queue = [...urls];
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      try {
        const r = await deps.fetch(url);
        if (r.status === 200) {
          cached += 1;
          deps.note(`${r.cache ?? "no cf-cache-status"} ${url}`);
        } else {
          failed.push(url);
          deps.note(`answered ${r.status} ${url}`);
        }
      } catch (err) {
        failed.push(url);
        deps.note(`failed ${url}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));
  return { cached, failed };
}

export async function prefetchEdgeAssets(deps: EdgePrefetchDeps): Promise<EdgePrefetchSummary> {
  if (!deps.version || deps.version === "0") {
    deps.note("no built asset version (version.json missing); nothing to warm");
    return { requested: 0, cached: 0, failed: [] };
  }
  if (deps.originVersion) {
    const attempts = Math.max(1, deps.attempts ?? 3);
    let serving: string | null = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      serving = await deps.originVersion().catch(() => null);
      if (serving === deps.version) break;
      deps.note(
        `${deps.origin} is serving ${serving === null ? "no readable version" : `ver=${serving}`}, not this build (${deps.version}); ` +
          (attempt < attempts ? `asking again in ${Math.round((deps.retryDelayMs ?? RETRY_DELAY_MS) / 1000)}s` : "giving up, nothing warmed"),
      );
      if (attempt < attempts) await deps.sleep(deps.retryDelayMs ?? RETRY_DELAY_MS);
    }
    if (serving !== deps.version) return { requested: 0, cached: 0, failed: [] };
  }
  const urls = edgeAssetUrls(deps.origin, deps.version);
  deps.note(`start ${urls.length} assets at ${deps.origin}, ver=${deps.version}`);
  const first = await pass(urls, deps);
  let cached = first.cached;
  let failed = first.failed;
  if (failed.length) {
    await deps.sleep(deps.retryDelayMs ?? RETRY_DELAY_MS);
    const second = await pass(failed, deps);
    cached += second.cached;
    failed = second.failed;
  }
  deps.note(`done: ${cached}/${urls.length} at the edge${failed.length ? `, ${failed.length} not: ${failed.join(" ")}` : ""}`);
  return { requested: urls.length, cached, failed };
}
