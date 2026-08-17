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

import { db } from "./db";

export interface Freshness {
  /** Epoch ms of the most recent content change, or null on an empty archive. */
  changedAtMs: number | null;
  /** Number of items the value was computed over — part of the cache key. */
  count: number;
}

let cached: Freshness | null = null;

/**
 * Recompute from the store.
 *
 * `lastSeenAt` alone would move on every ingest (it's touched whenever an item
 * is re-seen, even unchanged), so it isn't used here. `firstSeenAt` marks when
 * an item genuinely entered the archive and `pubDateMs` when it was published;
 * the newest of those, plus the row count, changes only when the archive's
 * contents actually change.
 */
function compute(): Freshness {
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS count,
         MAX(COALESCE(pubDateMs, 0)) AS maxPub,
         MAX(firstSeenAt) AS maxFirstSeen
       FROM news_items`,
    )
    .get() as {
    count: number;
    maxPub: number | null;
    maxFirstSeen: string | null;
  };

  if (!row || row.count === 0) {
    return { changedAtMs: null, count: 0 };
  }

  const firstSeenMs = row.maxFirstSeen ? Date.parse(row.maxFirstSeen) : NaN;
  const candidates = [
    row.maxPub ?? 0,
    Number.isNaN(firstSeenMs) ? 0 : firstSeenMs,
  ].filter((n) => n > 0);

  return {
    changedAtMs: candidates.length ? Math.max(...candidates) : null,
    count: row.count,
  };
}

/** Current freshness, memoised until invalidated by an ingest that changed data. */
export function freshness(): Freshness {
  if (cached === null) cached = compute();
  return cached;
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
  if (movesDate) cached = null;
}

/**
 * A short token identifying the current content state, for ETags and for
 * keying the render cache. Changes on every content mutation.
 */
export function contentVersion(): string {
  const { changedAtMs, count } = freshness();
  return `${changedAtMs ?? 0}-${count}-${mutationSeq}`;
}
