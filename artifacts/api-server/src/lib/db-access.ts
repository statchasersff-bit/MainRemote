/**
 * One line per database touch, so the wake-ups can be counted.
 *
 * The production database bills while it is awake and suspends after a few
 * idle minutes, so what the bill measures is not rows or bytes but how often
 * anything at all reaches for it. Every call site that does says so here
 * with a short reason, and nothing else: no SQL, no parameters, no
 * credentials. /api/status reports the same counters, so a day of logs is
 * not needed to see whether a change worked.
 */

import { logger } from "./logger";

export type DbAccessReason =
  | "news_ingest"
  | "club_ingest"
  | "x_ingest"
  | "news_read"
  | "freshness_read"
  | "fpa_read"
  | "fpa_write"
  | "practice_read"
  | "practice_write"
  | "depth_chart_read"
  | "depth_chart_write"
  | "image_version_flush"
  | "startup_restore"
  | "summary_backfill"
  | "schema_init";

interface Counter {
  count: number;
  lastAtMs: number;
}

const counters = new Map<DbAccessReason, Counter>();
let total = 0;

/** Say that the database is about to be used, and why. */
export function dbAccess(reason: DbAccessReason, detail: Record<string, unknown> = {}): void {
  const now = Date.now();
  const entry = counters.get(reason);
  if (entry) {
    entry.count += 1;
    entry.lastAtMs = now;
  } else {
    counters.set(reason, { count: 1, lastAtMs: now });
  }
  total += 1;
  logger.info({ dbAccess: reason, ...detail }, `DB_ACCESS ${reason}`);
}

/** For /api/status: how many times each reason has reached the database since boot. */
export function dbAccessStatus(): {
  total: number;
  byReason: Record<string, { count: number; lastAt: string }>;
} {
  const byReason: Record<string, { count: number; lastAt: string }> = {};
  for (const [reason, entry] of counters) {
    byReason[reason] = { count: entry.count, lastAt: new Date(entry.lastAtMs).toISOString() };
  }
  return { total, byReason };
}
