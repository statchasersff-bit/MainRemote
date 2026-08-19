/**
 * Data access for the news archive.
 *
 * Postgres (via @workspace/db) rather than a local SQLite file. The deployment
 * target is a GCE VM whose filesystem is rebuilt on every deploy, so a file in
 * `data/` is not a store of record — it survives until the next publish and
 * then silently resets to whatever snapshot was in the image. That is how
 * production ended up serving "No player news has been archived yet": an empty
 * database with nothing to fall back on. Postgres lives outside the deployment,
 * so the archive, each item's firstSeenAt, and any generated summary now
 * outlive a redeploy.
 *
 * Everything here is async, unlike better-sqlite3. The one place that could not
 * absorb that — the ETag/cache-key path, which runs synchronously while a
 * response is being composed — reads a memoised snapshot instead; see
 * lib/freshness.ts.
 */

export { db } from "@workspace/db";
export { newsItems, type NewsItemRow, type InsertNewsItem } from "@workspace/db";

/**
 * A stable content fingerprint for an item. We dedupe on this rather than the
 * upstream id: the feed has historically changed both its id scheme and its
 * pubDate formatting, and the old fallback id (a hash of title|link|pubDate)
 * produced a fresh row for the same article every time that string changed —
 * which is how the backlog ended up with each story stored twice.
 */
export function newsDedupeKey(item: {
  title?: string | null;
  id?: string | null;
}): string {
  const title = (item.title ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  return title || `id:${(item.id ?? "").trim()}`;
}
