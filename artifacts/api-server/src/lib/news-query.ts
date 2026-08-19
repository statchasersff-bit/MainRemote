/**
 * Reading side of the news store, shared by the JSON API and the server-side
 * renderer so both see exactly the same rows in the same order.
 */

import { desc, ilike, or, sql } from "drizzle-orm";
import { db, newsItems } from "./db";
import { teamForImage } from "./teams";
import type { NewsItem } from "./render";

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 250;

export interface ListNewsOptions {
  limit?: number;
  search?: string;
}

/**
 * Newest first. The team abbreviation is resolved here rather than in the
 * browser (see lib/teams.ts) so server-rendered cards carry their team colours
 * in the initial HTML.
 */
export async function listNews(
  options: ListNewsOptions = {},
): Promise<NewsItem[]> {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const search = (options.search ?? "").trim();

  const rows = await db
    .select()
    .from(newsItems)
    // ILIKE, not LIKE: SQLite's LIKE was case-insensitive for ASCII by default
    // and Postgres' is not, so a plain port would have quietly made search
    // case-sensitive.
    .where(
      search
        ? or(
            ilike(newsItems.title, `%${search}%`),
            ilike(newsItems.playerName, `%${search}%`),
          )
        : undefined,
    )
    // NULLS LAST is explicit for the same reason: Postgres sorts NULLs FIRST on
    // DESC, so an item with an unparseable pubDate would have jumped to the top
    // of the page. SQLite put them last.
    .orderBy(
      sql`${newsItems.pubDateMs} desc nulls last`,
      desc(newsItems.firstSeenAt),
    )
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    link: row.link,
    pubDate: row.pubDate,
    pubDateMs: row.pubDateMs,
    playerName: row.playerName,
    image: row.image,
    summary: row.summary,
    source: row.source,
    team: teamForImage(row.image),
  }));
}
