/**
 * When the news content last *materially* changed.
 *
 * This deliberately does NOT move on every request, every ingest run, or every
 * render. An ingest that finds nothing new leaves the timestamp alone, so a
 * "Last updated" label and a sitemap `lastmod` derived from it stay honest.
 * Faked freshness — bumping a date because a page was served — is worse than
 * no date at all: once the signal is noise, it stops being used.
 *
 * The value is derived from the data itself rather than tracked separately, so
 * it survives restarts and can't drift out of sync with what's actually stored.
 */

import { sql } from "drizzle-orm";
import { db, newsItems } from "./db";

export interface Freshness {
  /** Epoch ms of the most recent content change, or null on an empty archive. */
  changedAtMs: number | null;
  /** Number of items the value was computed over — part of the cache key. */
  count: number;
}

const EMPTY: Freshness = { changedAtMs: null, count: 0 };

let cached: Freshness | null = null;
/** In-flight load, so a burst of concurrent requests issues one query. */
let loading: Promise<Freshness> | null = null;
/** When `cached` was computed, for the staleness bound below. */
let loadedAtMs = 0;
/**
 * Bumped by every invalidation. A load that started before one lands must not
 * overwrite `cached` with the value it read *before* the change — otherwise an
 * ingest that finishes mid-query is silently undone and the snapshot goes back
 * to describing the archive as it was.
 */
let epoch = 0;

/**
 * How long a loaded snapshot may be trusted without re-reading the archive.
 *
 * This process is not the only thing that can write to the archive, and — more
 * to the point — it is not guaranteed to notice when it is. `invalidateFreshness()`
 * only fires from an ingest *in this process* that *succeeded* and *changed*
 * something. Every other case leaves the snapshot untouched forever:
 *
 *   - this instance's ingest throws every time (a feed URL missing from the
 *     deployment's environment, an upstream outage, a database error). Nothing
 *     invalidates, so the ETag never moves and the render cache never drops —
 *     the page serves the same HTML indefinitely no matter what is in the
 *     database. This is the failure that kept production frozen: a cache whose
 *     only invalidation path was the very thing that was broken.
 *   - something else writes: the scheduled deployment POSTing /api/ingest to a
 *     different instance, a second instance, a manual import.
 *
 * So the snapshot expires on its own as well. 60s matches the `max-age=60`
 * already on the page and the embed fragment, so this adds no staleness the
 * HTTP layer did not already allow, and costs one small aggregate per minute.
 */
const MAX_AGE_MS = (() => {
  const raw = Number(process.env["FRESHNESS_MAX_AGE_MS"]);
  return Number.isFinite(raw) && raw >= 0 ? raw : 60_000;
})();

/**
 * Recompute from the store.
 *
 * `lastSeenAt` alone would move on every ingest (it's touched whenever an item
 * is re-seen, even unchanged), so it isn't used here. `firstSeenAt` marks when
 * an item genuinely entered the archive and `pubDateMs` when it was published;
 * the newest of those, plus the row count, changes only when the archive's
 * contents actually change.
 */
async function compute(): Promise<Freshness> {
  // Everything is reduced to epoch milliseconds in SQL and read back as a
  // number. Values from an aggregate arrive as strings from the pg driver —
  // count(*) and max() over a bigint both do, and max() over a timestamptz
  // does NOT come back as a Date the way a plain column selection would — so
  // converting here rather than trusting the shape keeps one rule instead of
  // three special cases.
  const [row] = await db
    .select({
      count: sql<string>`count(*)`,
      maxPub: sql<string | null>`max(coalesce(${newsItems.pubDateMs}, 0))`,
      maxFirstSeenMs: sql<
        string | null
      >`max(extract(epoch from ${newsItems.firstSeenAt}) * 1000)`,
    })
    .from(newsItems);

  const count = Number(row?.count ?? 0);
  if (!row || count === 0) return EMPTY;

  const candidates = [Number(row.maxPub ?? 0), Number(row.maxFirstSeenMs ?? 0)]
    .filter((n) => Number.isFinite(n) && n > 0);

  return {
    changedAtMs: candidates.length ? Math.max(...candidates) : null,
    count,
  };
}

/**
 * Load the snapshot if it isn't warm. Await this before anything reads
 * freshness() or contentVersion() for a response — a no-op once loaded.
 *
 * This exists because the store went async when it moved to Postgres, but the
 * two readers below cannot: they run while an ETag is being assembled and a
 * cache key computed, mid-response. Rather than make those paths async and
 * spread awaits through every caller, the value is loaded once per content
 * version and read synchronously from memory afterwards.
 *
 * "Warm" means loaded *and* younger than MAX_AGE_MS — see that constant for why
 * an invalidation-only snapshot is not enough.
 */
export async function ensureFreshness(): Promise<Freshness> {
  if (cached !== null && Date.now() - loadedAtMs < MAX_AGE_MS) return cached;

  loading ??= (() => {
    const at = epoch;
    return compute()
      .then((value) => {
        // Dropped if an invalidation landed while this query was running: that
        // value describes the archive from before the change.
        if (epoch === at) {
          cached = value;
          loadedAtMs = Date.now();
        }
        return value;
      })
      .finally(() => {
        loading = null;
      });
  })();

  return loading;
}

/**
 * The loaded snapshot. Returns the empty value if nothing has loaded it yet,
 * which is why request paths call ensureFreshness() first.
 */
export function freshness(): Freshness {
  return cached ?? EMPTY;
}

/**
 * Bumped by ANY stored-content mutation, including ones that don't move the
 * user-visible date — a backfilled summary changes the rendered cards without
 * making the archive newer. Kept separate from `changedAtMs` so cache
 * correctness never has to be traded against date honesty.
 */
let mutationSeq = 0;

/**
 * Called when stored content changed. A no-op ingest must not reach this.
 *
 * @param movesDate Whether this change should also move the public
 *                  "last updated" date. False for backfills that revise
 *                  existing items rather than adding news.
 */
export function invalidateFreshness(movesDate = true): void {
  mutationSeq++;
  if (movesDate) {
    epoch++;
    cached = null;
    loading = null;
  }
}

/**
 * A short token identifying the current content state, for ETags and for
 * keying the render cache. Changes on every content mutation.
 */
export function contentVersion(): string {
  const { changedAtMs, count } = freshness();
  return `${changedAtMs ?? 0}-${count}-${mutationSeq}`;
}
