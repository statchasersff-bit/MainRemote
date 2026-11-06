/**
 * The post-publish warm crawl's sequencing, with no app imports so tests
 * reach it (the way lib/edge-prefetch-core.ts is to lib/edge-prefetch.ts):
 * wait out the boot chain, wait for the public origin to report THIS build,
 * then run the crawl once. The wiring (version, origin, child process) is
 * lib/live-warm.ts; what the crawl does is scripts/warm-live.mjs.
 */

/** Let the boot chain (FPA ingest, player stats, both done by minute four on 11-02) finish first. */
export const START_DELAY_MS = 4 * 60 * 1000;
export const VERSION_ATTEMPTS = 10;
export const VERSION_RETRY_MS = 60 * 1000;
/**
 * WordPress caches the asset version it prints for 15 minutes
 * (statchasers_news_asset_version()), so the origin reporting this build is
 * not enough: on 2026-11-05 the crawl ran while WordPress still printed the
 * previous ?ver=, and Cloudflare kept those pages (30-day s-maxage) pointing
 * at the old stylesheet under the new markup - unstyled player pages. The
 * crawl now also waits for a fresh WordPress render to print this build:
 * 20 checks a minute apart outlast the 15-minute cache.
 */
export const SITE_ATTEMPTS = 20;

export interface LiveWarmDeps {
  /** This build's asset version; "0" means no built version.json, so no crawl. */
  version: string;
  originVersion: () => Promise<string | null>;
  /** The ?ver= a fresh (cache-busted) WordPress render prints; omitted in old callers and tests. */
  siteVersion?: () => Promise<string | null>;
  siteAttempts?: number;
  run: (args: string[]) => Promise<string>;
  sleep: (ms: number) => Promise<void>;
  note: (line: string) => void;
  startDelayMs?: number;
  attempts?: number;
  retryDelayMs?: number;
}

/**
 * Wait out the boot chain, wait for the origin to report this build, crawl.
 * Resolves with the script's summary line, or null when it did not run.
 * Stateless so tests reach it with fakes.
 */
export async function runLiveWarm(deps: LiveWarmDeps): Promise<string | null> {
  if (!deps.version || deps.version === "0") {
    deps.note("skipped: this build has no asset version");
    return null;
  }
  await deps.sleep(deps.startDelayMs ?? START_DELAY_MS);
  const attempts = deps.attempts ?? VERSION_ATTEMPTS;
  let seen: string | null = null;
  for (let i = 1; i <= attempts; i += 1) {
    seen = await deps.originVersion();
    if (seen === deps.version) break;
    if (i === attempts) {
      deps.note(`skipped: origin still serves ${seen ?? "nothing"} after ${attempts} checks, this build is ${deps.version}`);
      return null;
    }
    await deps.sleep(deps.retryDelayMs ?? VERSION_RETRY_MS);
  }
  if (deps.siteVersion) {
    const siteAttempts = deps.siteAttempts ?? SITE_ATTEMPTS;
    let printed: string | null = null;
    for (let i = 1; i <= siteAttempts; i += 1) {
      printed = await deps.siteVersion();
      if (printed === deps.version) break;
      if (i === siteAttempts) {
        deps.note(`skipped: WordPress still prints ${printed ?? "nothing"} after ${siteAttempts} checks, this build is ${deps.version}`);
        return null;
      }
      await deps.sleep(deps.retryDelayMs ?? VERSION_RETRY_MS);
    }
  }
  deps.note(`start: origin serves ${deps.version}`);
  try {
    const stdout = await deps.run([]);
    const summary = /^warm-live complete:.*$/m.exec(stdout)?.[0] ?? stdout.trim().split("\n").pop() ?? "done";
    deps.note(summary);
    return summary;
  } catch (err) {
    deps.note(`failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
