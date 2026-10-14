/**
 * When the content last really changed, held in memory.
 *
 * Drives the "Last updated" stamp, the ETags and every render cache key. It
 * used to be a COUNT/MAX query re-run whenever a request arrived more than a
 * minute after the last one, which on a database that suspends when idle
 * meant ordinary page traffic kept the database awake by itself.
 *
 * Now the state is loaded ONCE, at startup (reloadFreshness, from index.ts),
 * and from then on it is maintained by the writers in this process: every
 * ingest that inserts or updates rows reports what it wrote
 * (recordArchiveWrite) and the state moves without a query. Public requests
 * only ever read the in-memory value.
 *
 * Something that writes the archive from OUTSIDE this process - a manual
 * import, a scheduled job with its own connection - is invisible to this, by
 * design, and says so by calling POST /api/cache/reload (routes/news.ts),
 * which runs reloadFreshness() again. There is no timer and no traffic-driven
 * re-check: the one DB-backed fallback is a startup load that failed, which
 * is retried at most every RETRY_MS on the next request.
 */

import { sql } from "drizzle-orm";
import { db, newsItems } from "./db";
import { dbAccess } from "./db-access";
import { logger } from "./logger";

export interface Freshness {
  changedAtMs: number | null;
  count: number;
}

const EMPTY: Freshness = { changedAtMs: null, count: 0 };

/** The floor on how often a failed load is retried against the database. */
const RETRY_MS = 15 * 60 * 1000;

let cached: Freshness | null = null;
let loading: Promise<Freshness> | null = null;
let lastAttemptMs = 0;
let epoch = 0;
let mutationSeq = 0;

async function compute(): Promise<Freshness> {
  dbAccess("freshness_read");
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
 * Read the state from the database and make it the in-memory copy.
 *
 * The startup load, and the explicit reload. One at a time: concurrent
 * callers join the load in flight. A write that lands while a load is
 * running bumps `epoch`, and the load's result is then discarded rather than
 * overwriting what the write already recorded.
 */
export function reloadFreshness(): Promise<Freshness> {
  if (loading) return loading;
  lastAttemptMs = Date.now();
  const at = epoch;
  loading = compute()
    .then((value) => {
      if (epoch === at) cached = value;
      mutationSeq++;
      return value;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/**
 * The current state. In memory after the first successful load; a page
 * request never reaches the database for this once the state is held.
 *
 * Before the first load, or after a failed one, the request that gets here
 * first tries the load itself, and the next tries are held back by RETRY_MS
 * so a database that is down is not asked again by every visitor. In between,
 * EMPTY is served: the page renders, with a content version that moves again
 * once a load succeeds.
 */
export async function ensureFreshness(): Promise<Freshness> {
  if (cached !== null) return cached;
  if (loading) return loading;
  if (Date.now() - lastAttemptMs < RETRY_MS) return EMPTY;
  try {
    return await reloadFreshness();
  } catch (err) {
    logger.warn({ err }, "freshness could not be loaded; serving an empty state until the next retry");
    return EMPTY;
  }
}

export function freshness(): Freshness {
  return cached ?? EMPTY;
}

/**
 * A writer in this process changed the archive. Moves the state in memory
 * with no query: an insert's first_seen_at is `now`, so the newest-content
 * time is at least that; an update can only move it as far as the newest
 * publish time it wrote.
 */
export function recordArchiveWrite(write: { inserted: number; newestMs: number | null }): void {
  epoch++;
  mutationSeq++;
  if (cached === null) {
    // Nothing held yet (the startup load failed or has not run). The writer
    // has just proven the database reachable, so load now rather than guess.
    void reloadFreshness().catch(() => undefined);
    return;
  }
  const candidates = [cached.changedAtMs ?? 0, write.newestMs ?? 0].filter((n) => n > 0);
  cached = {
    changedAtMs: candidates.length ? Math.max(...candidates) : cached.changedAtMs,
    count: cached.count + write.inserted,
  };
}

/**
 * Rows were revised without the archive getting newer (a summary backfill):
 * the content version moves so caches drop, the "last updated" date does not.
 */
export function noteContentRevised(): void {
  mutationSeq++;
}

export function contentVersion(): string {
  const { changedAtMs, count } = freshness();
  return `${changedAtMs ?? 0}-${count}-${mutationSeq}`;
}

/** For /api/status. */
export function freshnessStatus(): { loaded: boolean; mutationSeq: number } {
  return { loaded: cached !== null, mutationSeq };
}
