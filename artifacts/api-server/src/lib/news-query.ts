/**
 * Reading side of the news store, shared by the JSON API and the server-side
 * renderer so both see exactly the same rows in the same order.
 */

import { db } from "./db";
import { teamForImage } from "./teams";
import type { NewsItem } from "./render";

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 250;

interface NewsRow {
  id: string;
  title: string;
  link: string | null;
  pubDate: string | null;
  pubDateMs: number | null;
  playerName: string | null;
  image: string | null;
  summary: string | null;
  source: string | null;
}

export interface ListNewsOptions {
  limit?: number;
  search?: string;
}

/**
 * Newest first. The team abbreviation is resolved here rather than in the
 * browser (see lib/teams.ts) so server-rendered cards carry their team colours
 * in the initial HTML.
 */
export function listNews(options: ListNewsOptions = {}): NewsItem[] {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const search = (options.search ?? "").trim();

  const rows = search
    ? (db
        .prepare(
          `SELECT * FROM news_items
           WHERE title LIKE ? OR playerName LIKE ?
           ORDER BY pubDateMs DESC, firstSeenAt DESC
           LIMIT ?`,
        )
        .all(`%${search}%`, `%${search}%`, limit) as NewsRow[])
    : (db
        .prepare(
          `SELECT * FROM news_items
           ORDER BY pubDateMs DESC, firstSeenAt DESC
           LIMIT ?`,
        )
        .all(limit) as NewsRow[]);

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
