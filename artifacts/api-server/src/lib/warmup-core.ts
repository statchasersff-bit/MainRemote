/**
 * The boot warm-up, the part with no state: which pages to render first and
 * how to walk the list without crowding out readers.
 *
 * Why it exists: a fresh process answers its first team hub in ~2.5 s, its
 * first player page in ~5.5 s and its first matchup in ~2 s, nearly all of it
 * loading the game logs, rosters and box scores the renders share. After the
 * publish of 2026-10-21 14:26 UTC that cold start met crawler traffic and
 * WordPress's 8 s fragment timeout at the same moment, and every request -
 * even a 404 - waited 50-75 s for twelve minutes while the backlog drained.
 * Warming the hot renders in a controlled order gets the shared data loaded
 * and the common fragments cached before the traffic does it the hard way.
 *
 * The walk is serial, through the server's own port, with a pause between
 * pages: each render blocks the event loop for as long as it takes, so one at
 * a time with a yield is what keeps a reader's request interleaving instead of
 * queueing behind thirty of ours. A budget caps the whole thing; what is left
 * when it runs out is skipped and said so.
 */

export interface WarmupPlanInput {
  /** Team slugs, in the order to warm them. */
  teams: readonly string[];
  /** The team sections with pretty URLs of their own, warmed after everything else. */
  sections: readonly string[];
  /** Player slugs, hottest first; only the first `maxPlayers` are warmed. */
  players: readonly string[];
  maxPlayers: number;
  /** Matchup pair slugs: this week's and last week's games. */
  pairs: readonly string[];
  /**
   * Whether the WordPress pages ask the fragment to print the page's H1
   * (`?h1=1`). It is part of the render-cache key, so the warm-up must ask
   * the same way the plugin does or it warms entries nobody reads.
   */
  ownHeading: boolean;
}

/**
 * The paths to request, in order: team hubs (every team page starts there),
 * this week's matchups, the most-rostered players, then the team sections.
 */
export function planWarmup(input: WarmupPlanInput): string[] {
  const h1 = input.ownHeading ? "?h1=1" : "";
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (p: string) => {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  };
  for (const slug of input.teams) add(`/embed/team/${encodeURIComponent(slug)}${h1}`);
  for (const pair of input.pairs) add(`/embed/matchup/${encodeURIComponent(pair)}`);
  for (const slug of input.players.slice(0, Math.max(0, input.maxPlayers))) {
    add(`/embed/player/${encodeURIComponent(slug)}${h1}`);
  }
  for (const section of input.sections) {
    for (const slug of input.teams) {
      add(`/embed/team/${encodeURIComponent(slug)}?section=${encodeURIComponent(section)}${input.ownHeading ? "&h1=1" : ""}`);
    }
  }
  return out;
}

export interface WarmupSummary {
  planned: number;
  ok: number;
  failed: number;
  skipped: number;
  ms: number;
}

export interface WarmupDeps {
  /** Request one path; resolves with the status, rejects on a network failure or timeout. */
  fetch: (path: string) => Promise<number>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  note: (line: string) => void;
  /** The machine's available memory in MB, or -1 when it cannot be read. Read before each page. */
  availableMb?: () => number;
}

export interface WarmupLimits {
  /** Stop after this long, whatever is left. */
  budgetMs: number;
  /** The pause between pages, for readers' requests to get in. */
  yieldMs: number;
  /** A progress line every this many pages. */
  progressEvery?: number;
  /**
   * Stop when the machine has less than this many MB available. Every page
   * the walk renders stays resident (the data it loaded, the fragment it
   * cached), and the builders that start when the walk ends need room of
   * their own: on 2026-10-21 the first boot with the warm-up left the VM
   * dead within hours. A reader who finds a page cold waits seconds; a VM
   * the OOM killer takes is down until somebody republishes.
   */
  minFreeMb?: number;
}

/**
 * The player cap from its environment variable. Unset or blank means the
 * default: `Number("")` is 0, which would (and until 2026-10-21 did) warm no
 * players at all.
 */
export function parsePlayerCap(raw: string | undefined, fallback: number): number {
  const text = (raw ?? "").trim();
  if (text === "") return fallback;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export async function runWarmup(
  paths: readonly string[],
  deps: WarmupDeps,
  limits: WarmupLimits,
): Promise<WarmupSummary> {
  const started = deps.now();
  const summary: WarmupSummary = { planned: paths.length, ok: 0, failed: 0, skipped: 0, ms: 0 };
  const every = limits.progressEvery ?? 50;
  deps.note(`start ${paths.length} pages, budget ${Math.round(limits.budgetMs / 1000)}s`);
  for (let i = 0; i < paths.length; i += 1) {
    if (deps.now() - started >= limits.budgetMs) {
      summary.skipped = paths.length - i;
      deps.note(`budget spent after ${i} pages; ${summary.skipped} skipped`);
      break;
    }
    if (limits.minFreeMb !== undefined && deps.availableMb) {
      const free = deps.availableMb();
      if (free >= 0 && free < limits.minFreeMb) {
        summary.skipped = paths.length - i;
        deps.note(`memory floor: ${free}MB available, under ${limits.minFreeMb}MB, after ${i} pages; ${summary.skipped} skipped`);
        break;
      }
    }
    const path = paths[i]!;
    try {
      const status = await deps.fetch(path);
      if (status >= 200 && status < 400) summary.ok += 1;
      else {
        summary.failed += 1;
        deps.note(`${path} answered ${status}`);
      }
    } catch (err) {
      summary.failed += 1;
      deps.note(`${path} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if ((i + 1) % every === 0 && i + 1 < paths.length) {
      deps.note(`${i + 1}/${paths.length} after ${Math.round((deps.now() - started) / 1000)}s`);
    }
    if (limits.yieldMs > 0 && i + 1 < paths.length) await deps.sleep(limits.yieldMs);
  }
  summary.ms = deps.now() - started;
  deps.note(
    `done: ${summary.ok} ok, ${summary.failed} failed, ${summary.skipped} skipped of ${summary.planned} in ${Math.round(summary.ms / 1000)}s`,
  );
  return summary;
}

function unrefSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

/**
 * When work that should not compete with the warm-up may start: at the
 * warm-up's end, but no sooner than `floorMs` after the call and no later
 * than `capMs`, warm-up or not. A rejected warm-up counts as finished.
 */
export async function afterWarmup(
  warmup: Promise<unknown> | undefined,
  floorMs: number,
  capMs: number,
  wait: (ms: number) => Promise<void> = unrefSleep,
): Promise<void> {
  const done = (warmup ?? Promise.resolve()).catch(() => undefined);
  await Promise.all([wait(floorMs), Promise.race([done, wait(capMs)])]);
}
