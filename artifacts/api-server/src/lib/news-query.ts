/**
 * Reading side of the news store, shared by the JSON API and the server-side
 * renderer so both see exactly the same rows in the same order.
 */

import { and, desc, eq, gte, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db, newsItems } from "./db";
import { logger } from "./logger";
import { playerIdsForTeam, teamForImage } from "./teams";
import { nameKeysForTeam, teamForPlayerName } from "./team/roster";
import { categorize } from "./news-category";
import type { NewsItem } from "./render";
import { mergeNewsLanes } from "./news-merge";
import { imageVersionForUrl } from "./image-versions";
import { imageKeyFor } from "./image-urls";

/**
 * The X lane's source_type. Declared here rather than imported from lib/x so
 * the read path does not depend on the ingestion half at all - the feed must
 * still build, and still read X rows, in a deployment where X ingestion is
 * switched off and nothing in lib/x is ever loaded.
 */
const X_LANE = "x";

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 250;

/**
 * How far back a team-filtered read reaches, in days.
 *
 * Expressed as a window rather than a row count. Team is not a column - it is
 * resolved per row from the player behind the headshot (see lib/teams.ts), and
 * only then from the player's name - so it cannot be pushed into the WHERE
 * clause and a team page has to filter in memory. The quantity that bound is
 * therefore "how much archive do we read", and the honest unit for that is
 * time, not rows: a fixed newest-N scan reaches back six months while the
 * archive is thin and five days once the feed is busy, with nothing in the
 * output to say which of the two just happened.
 *
 * Six months so a team page covers a full offseason - the reference this
 * matches (thehuddle's team news pages) carries roughly four months of items in
 * one list - and so the section does not empty out over the quiet weeks between
 * the draft and camp.
 */
export const TEAM_WINDOW_DAYS = 180;

/**
 * Hard ceiling on the rows pulled for one team page, whatever the window holds.
 *
 * A safety valve, not a tuning knob: it stops a busy feed turning every cache
 * miss into a table read. When it binds it is logged rather than silently
 * applied - a window quietly truncated back into a row count is the exact
 * failure this replaces, and the log line is the signal that the derived team
 * has earned a stored, indexed column so the filter can move into SQL.
 */
export const TEAM_SCAN_MAX = 4000;

export interface ListNewsOptions {
  limit?: number;
  search?: string;
  /**
   * Include the club feeds' rows as well as the player wire's.
   *
   * Off by default, and that default is the point - see listNews below.
   */
  includeClubs?: boolean;
}

/**
 * Newest first. The team abbreviation is resolved here rather than in the
 * browser (see lib/teams.ts) so server-rendered cards carry their team colors
 * in the initial HTML.
 *
 * The player wire only, unless asked otherwise. This is the reader behind the
 * news page and GET /api/news, and that surface is a player news tool: cards
 * built around a headshot, a player name, and a filter by player. The club
 * feeds publish roughly ten times the volume - practice reports, previews,
 * ticket promotions, none of them tagged with a player - so including them by
 * default would not enrich this list, it would replace it, and the first page
 * would stop being about players within a day.
 *
 * The club rows are not hidden; they are on the team pages, which are the
 * surface built to read them (listNewsForTeam, below). This is a question of
 * which list is which, not of what is worth storing.
 */
export async function listNews(
  options: ListNewsOptions = {},
): Promise<NewsItem[]> {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const search = (options.search ?? "").trim();
  /**
   * The lanes this list shows: the player wire, plus X.
   *
   * Still expressed as `team_abbr IS NULL` for the wire rather than as a test
   * on the new source_type column, because that is the rule every row in the
   * archive was written under and the column is null for all of them. Changing
   * the wire/club split to depend on source_type would make this list's
   * contents contingent on a backfill - and a backfill that has not run yet
   * looks exactly like a feed that has silently swallowed the club archive.
   *
   * X is added as its own term instead. Its rows may carry a team (resolved at
   * ingest from the player named in the post), so the wire's test excludes
   * them, and the whole point of the integration is that they appear here.
   */
  const lanes = options.includeClubs
    ? undefined
    : or(isNull(newsItems.teamAbbr), eq(newsItems.sourceType, X_LANE));

  const rows = await db
    .select()
    .from(newsItems)
    // ILIKE, not LIKE: SQLite's LIKE was case-insensitive for ASCII by default
    // and Postgres' is not, so a plain port would have quietly made search
    // case-sensitive.
    .where(
      and(
        lanes,
        search
          ? or(
              ilike(newsItems.title, `%${search}%`),
              ilike(newsItems.playerName, `%${search}%`),
              // The handle, so "schefter" finds his posts. Only X rows have
              // one, so this costs nothing on the rest of the archive.
              ilike(newsItems.authorHandle, `%${search}%`),
            )
          : undefined,
      ),
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
 * The stored team wins when there is one. A club row was written by the feed of
 * the team it belongs to, so it is known rather than inferred, and there is
 * nothing for the inference below to add - a club story has no headshot and
 * usually no player name, so running it through them would resolve a first-party
 * fact to null.
 *
 * Everything else is the wire, where team is derived: from the headshot first -
 * that is the existing, unchanged behavior the news feed relies on - and then,
 * only when there is no headshot to read, from the player's name against the
 * same Sleeper index. The archive genuinely contains rows with a null image
 * ("Vita Vea: Agrees to one-year extension"), and without the fallback those
 * stories belong to no team and would never appear on any team page.
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
    imageKey: imageKeyFor(row.image),
    imageVersion: imageVersionForUrl(row.image),
    summary: row.summary,
    source: row.source,
    sourceType: row.sourceType,
    authorHandle: row.authorHandle,
    // Derived, never stored - see lib/news-category.ts. Computed over the
    // title and the summary together because an X row's title is only the
    // post's first line and the rest of it is in the summary.
    category: categorize(row.title, row.summary),
    team:
      row.teamAbbr ??
      teamForImage(row.image) ??
      teamForPlayerName(row.playerName),
  };
}

/**
 * The Sleeper id in a row's headshot URL, in SQL - playerIdFromImage().
 * Null when there is no headshot or it is not a player thumb.
 */
const imageId = sql<string | null>`substring(${newsItems.image} from '/players/thumb/([0-9]+)[.]')`;

/**
 * A row's player name folded to Sleeper's search key, in SQL - the same
 * folding as teamForPlayerName(), for ASCII names. SQL has no portable way to
 * strip accents the way the JS does with NFD, so names that are not plain
 * ASCII are matched by `nonAsciiName` instead and left to the JS to decide.
 */
const nameKey = sql<string>`lower(regexp_replace(coalesce(${newsItems.playerName}, ''), '[^A-Za-z0-9]', '', 'g'))`;
const nonAsciiName = sql<boolean>`${newsItems.playerName} ~ '[^ -~]'`;

/**
 * Which wire rows could resolve to `team`, as a WHERE clause.
 *
 * THIS REPLACED A 4,000-ROW SCAN. Team is derived per row - from the headshot's
 * player, then from the player's name, both against the CURRENT Sleeper map -
 * which is why it is not a column: a traded player's older stories follow him
 * to his new team. So the team pages read every wire row in the window and
 * filtered in JS, up to TEAM_SCAN_MAX of them per render.
 *
 * This asks the database for a superset instead, built from the same two maps
 * turned around: rows whose headshot is a player on the team now, rows whose
 * name folds to a player on the team now, and rows whose name is not plain
 * ASCII (the one case the SQL folding cannot match). The JS derivation still
 * runs on what comes back and still has the final word, so the result is the
 * one the scan gave - a superset filtered exactly is the set - at a few dozen
 * rows instead of thousands.
 *
 * With both maps empty (a cold process before its first roster fetch) the
 * scan resolved every row to no team and found nothing; this asks for nothing.
 */
function wireCandidatesFor(team: string) {
  const ids = playerIdsForTeam(team);
  const keys = nameKeysForTeam(team);
  return or(
    ids.length ? inArray(imageId, ids) : sql`false`,
    keys.length ? inArray(nameKey, keys) : sql`false`,
    nonAsciiName,
  );
}

/**
 * One player's wire and X stories, newest first.
 *
 * Matched by the player the row is tagged with, in SQL, rather than by a
 * substring search over titles and names: the substring search pulled up to 60
 * rows mentioning the name anywhere and kept only exact matches, so a common
 * surname could fill the 60 with other players and starve this one's News tab.
 * The SQL is a superset (same folding as nameKey, plus non-ASCII names) and
 * the caller keeps its exact match on searchKey().
 */
export async function listNewsForPlayerName(
  name: string,
  limit: number,
): Promise<NewsItem[]> {
  const key = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!key) return [];
  const rows = await db
    .select()
    .from(newsItems)
    .where(
      and(
        or(isNull(newsItems.teamAbbr), eq(newsItems.sourceType, X_LANE)),
        or(eq(nameKey, key), nonAsciiName),
      ),
    )
    .orderBy(
      sql`${newsItems.pubDateMs} desc nulls last`,
      desc(newsItems.firstSeenAt),
      desc(newsItems.id),
    )
    .limit(Math.max(limit, 1));
  return rows.map(toNewsItem);
}

export interface ListTeamNewsOptions {
  /** Most items to return. */
  limit?: number;
  /** How far back to read, in days. Defaults to TEAM_WINDOW_DAYS. */
  windowDays?: number;
  /** Row ceiling for the read. Defaults to TEAM_SCAN_MAX. */
  scan?: number;
  /** Clock injection point, so the window is testable without waiting. */
  nowMs?: number;
}

/**
 * The archive, narrowed to one team.
 *
 * This is a view over the SAME pipeline the news tool uses - same table, same
 * ordering, same row-to-item mapping - not a second news implementation.
 *
 * It reads twice, because the archive stores team two different ways and only
 * one of them is a column:
 *
 *   1. The club rows, straight off idx_news_team_abbr_pub_date_ms. An index
 *      seek for exactly this team, exactly this window, already in order - no
 *      scan and no ceiling, because the database is doing the filtering.
 *   2. The wire rows, where team is derived per row and cannot go in a WHERE
 *      clause, so this is still the windowed scan it always was. Narrowed to
 *      `team_abbr IS NULL` so it no longer re-reads everything the first query
 *      already answered.
 *
 * Two round trips rather than one, deliberately. A UNION would need the derived
 * team inside SQL, which is the thing that cannot be expressed; and merging two
 * ordered lists of at most a few dozen items each is free next to the scan it
 * removes.
 */
export async function listNewsForTeam(
  team: string,
  options: ListTeamNewsOptions = {},
): Promise<NewsItem[]> {
  const wanted = team.toLowerCase();
  const limit = Math.max(options.limit ?? 24, 1);
  const scan = Math.min(
    Math.max(options.scan ?? TEAM_SCAN_MAX, 1),
    TEAM_SCAN_MAX,
  );
  const windowDays = Math.max(options.windowDays ?? TEAM_WINDOW_DAYS, 1);
  const since = (options.nowMs ?? Date.now()) - windowDays * 86_400_000;

  const inWindow = or(gte(newsItems.pubDateMs, since), isNull(newsItems.pubDateMs));
  const newestFirst = [
    sql`${newsItems.pubDateMs} desc nulls last`,
    desc(newsItems.firstSeenAt),
    // A batch lands with one first_seen_at and often one pubDate, and rows
    // tied on both came back in whatever order the plan produced.
    desc(newsItems.id),
  ] as const;

  const [stored, derivable] = await Promise.all([
    // (1) The club rows for this team. `limit` and not `scan`: every row this
    // returns is already this team's, so there is nothing to filter out and no
    // reason to read past what the caller asked for.
    db
      .select()
      .from(newsItems)
      .where(and(eq(newsItems.teamAbbr, wanted), inWindow))
      .orderBy(...newestFirst)
      .limit(limit),
    // (2) The wire rows that COULD be this team's. See wireCandidatesFor().
    db
      .select()
      .from(newsItems)
      .where(and(isNull(newsItems.teamAbbr), inWindow, wireCandidatesFor(wanted)))
      .orderBy(...newestFirst)
      .limit(scan),
  ]);

  // The ceiling binding means the scan stopped short of the window, so this
  // team's older wire stories are missing for a reason that has nothing to do
  // with the team. Said out loud, rather than left to be inferred from a page
  // that merely looks quiet.
  if (derivable.length >= scan) {
    logger.warn(
      { team: wanted, scan, windowDays },
      "Team news hit the row ceiling before the end of its window - older wire stories are being cut off.",
    );
  }

  // Two lanes, each already newest-first out of SQL. Merged rather than
  // concatenated - a club story from this morning belongs above a wire story
  // from last night, not after every club story ever - but merged with a quota
  // rather than purely by date, so a loud week at the club cannot push every
  // player note out of the visible ten. See WIRE_QUOTA.
  const clubLane = stored.map(toNewsItem);
  const wireLane: NewsItem[] = [];
  for (const row of derivable) {
    const item = toNewsItem(row);
    if (item.team === wanted) wireLane.push(item);
  }

  return mergeNewsLanes(clubLane, wireLane).slice(0, limit);
}
