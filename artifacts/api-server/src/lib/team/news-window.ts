/**
 * The team News tab's freshness rule (Team Pages Phase 7, 2026-11-20; mak
 * approved the assessment in docs/PHASE6-NEWS-LIMIT-AND-PURGE-TEST.md).
 *
 * When a club has at least RECENT_NEWS_MIN stories from the last
 * RECENT_NEWS_DAYS days, the tab shows only those: a club whose own feed has
 * gone quiet (Washington's) no longer fills the page with months-old items.
 * When it has fewer - the offseason, or a thin week - the list is exactly what
 * it was, so no club's tab ever empties.
 *
 * Display only. Collection, the database and every other reader of the news
 * (player pages, the wire) are untouched, and the order is kept: this only
 * ever drops the oldest end of a newest-first list.
 */
export const RECENT_NEWS_DAYS = 45;
export const RECENT_NEWS_MIN = 20;

export function recentTeamNews<T extends { pubDateMs?: number | null }>(items: readonly T[], now: number): T[] {
  const cutoff = now - RECENT_NEWS_DAYS * 24 * 60 * 60 * 1000;
  const recent = items.filter((item) => typeof item.pubDateMs === "number" && item.pubDateMs >= cutoff);
  return recent.length >= RECENT_NEWS_MIN ? recent : [...items];
}
