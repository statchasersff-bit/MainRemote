/**
 * Reading side of the news store, shared by the JSON API and the server-side
 * renderer so both see exactly the same rows in the same order.
 */

import { desc, ilike, or, sql } from "drizzle-orm";
import { db, newsItems } from "./db";
import { teamForImage } from "./teams";
import { teamForPlayerName } from "./team/roster";
import type { NewsItem } from "./render";

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 250;

/**
 * How far back a team-filtered read scans.
 *
 * Team is not a column — it is resolved per row from the player behind the
 * headshot (see lib/teams.ts) — so it cannot be pushed into the WHERE clause,
 * and a team page has to filter in memory. This bounds that work: newest N
 * rows, filtered down. One team's share of the archive is roughly a
 * thirty-second of it, so this is what makes "the last several weeks of
 * Patriots news" reachable while keeping the query a bounded index scan rather
 * than a full table read that grows forever.
 */
export const TEAM_SCAN_LIMIT = 750;

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

  return rows.map(toNewsItem);
}

/**
 * One row to one item, including the resolved team.
 *
 * Shared by both readers so the JSON API, the news page and the team pages
 * cannot drift apart in what an item looks like.
 *
 * The team is resolved from the headshot first — that is the existing,
 * unchanged behaviour the news feed relies on — and then, only when there is no
 * headshot to read, from the player's name against the same Sleeper index. The
 * archive genuinely contains rows with a null image ("Vita Vea: Agrees to
 * one-year extension"), and without the fallback those stories belong to no
 * team and would never appear on any team page.
 */
function toNewsItem(row: typeof newsItems.$inferSelect): NewsItem {
  return {
    id: row.id,
    title: row.title,
    link: row.link,
    pubDate: row.pubDate,
    pubDateMs: row.pubDateMs,
    playerName: row.playerName,
    image: row.image,
    summary: row.summary,
    source: row.source,
    team: teamForImage(row.image) ?? teamForPlayerName(row.playerName),
  };
}

export interface ListTeamNewsOptions {
  /** Most items to return. */
  limit?: number;
  /** How many rows to scan before filtering. Defaults to TEAM_SCAN_LIMIT. */
  scan?: number;
}

/**
 * The archive, narrowed to one team.
 *
 * This is a view over the SAME pipeline the news tool uses — same table, same
 * ordering, same row-to-item mapping — not a second news implementation. The
 * only thing it adds is the filter, which has to happen here because team is a
 * derived value rather than a stored one.
 */
export async function listNewsForTeam(
  team: string,
  options: ListTeamNewsOptions = {},
): Promise<NewsItem[]> {
  const wanted = team.toLowerCase();
  const scan = Math.min(Math.max(options.scan ?? TEAM_SCAN_LIMIT, 1), 2000);
  const limit = Math.max(options.limit ?? 24, 1);

  const rows = await db
    .select()
    .from(newsItems)
    .orderBy(
      sql`${newsItems.pubDateMs} desc nulls last`,
      desc(newsItems.firstSeenAt),
    )
    .limit(scan);

  const items: NewsItem[] = [];
  for (const row of rows) {
    const item = toNewsItem(row);
    if (item.team !== wanted) continue;
    items.push(item);
    if (items.length >= limit) break;
  }
  return items;
}
