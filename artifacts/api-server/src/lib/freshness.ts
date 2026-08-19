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
 */
export async function ensureFreshness(): Promise<Freshness> {
  if (cached !== null) return cached;
  loading ??= compute()
    .then((value) => {
      cached = value;
      return value;
    })
    .finally(() => {
      loading = null;
    });
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
