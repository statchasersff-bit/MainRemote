/**
 * Every dated game page, for the sitemap: each finished game once, at its one
 * canonical address (`/nfl/<a>-vs-<b>/2026-week-2/`).
 *
 * Since WEB-001 (2026-11-24) every finished game is canonical at its own dated
 * address (meetingHasOwnAddress in pair.ts) - the current season's as much as
 * the archives - so the list is simply the completed games the page itself
 * can serve. Until then the pair's page owned this season's latest result and
 * the list carried only the earlier meeting of a pair that had met twice (13
 * games of 2026 at week 12) plus the whole of the season before.
 *
 * Built from the same records the page resolves a game address against
 * (getMatchupData): the pair's alphabetically-first club's regular season and
 * postseason, for the current season and the HISTORY_SEASONS before it, with
 * the same test - final, with a result. So every row answers 200 and names
 * itself as its canonical, and a game outside the window (a 404) is never
 * listed. Each game is listed once, keyed on its pair and segment.
 *
 * `modified` (the sitemap's lastmod) is the newer of two stored stamps that
 * move only when the page's content does (2026-11-24, replacing c1948cd's
 * always-null):
 *   - the box score's `modifiedAt` (boxscore.ts contentStamp):
 *     buildBoxscores.mjs advances it only when a re-pull brings a different
 *     summary, so a stat correction moves it and an identical re-pull inside
 *     the settle window does not. A record stored before that field uses its
 *     in-season `fetchedAt`; the 2021-2025 archive, pulled in one bulk run
 *     long after those games, has no stamp.
 *   - the written recap's `writtenAt` (recap_prose_<season>.json), which
 *     writeRecaps.mjs keeps when an import brings back the same text.
 * A game with neither prints no lastmod. The kickoff is never used: it is
 * not a modification time. Play-by-play, videos and odds keep no per-game
 * change stamp and do not move it.
 *
 * The WordPress plugin reads this at /embed/matchup-games.json and serves
 * each path from /game-sitemap.xml (paginated by Rank Math's per-page limit).
 */

import { TEAMS, type NflTeam } from "../team/teams";
import { getTeamPostseason, getTeamSchedule, type ScheduleGame } from "../team/schedule";
import { nflState } from "../team/nfl-state";
import { HISTORY_SEASONS } from "./matchup-data";
import { storedBoxscoreModifiedAt } from "./boxscore";
import { writtenRecapAt } from "./recap-overview";
import {
  canonicalizeMatchupPair,
  gameSegment,
  meetingHasOwnAddress,
  type MatchupGameRef,
} from "./pair";

export interface ArchivedGame {
  /** The pair's canonical slug: `cleveland-browns-vs-tampa-bay-buccaneers`. */
  pair: string;
  /** The dated segment under it: `2026-week-2`. */
  game: string;
  /** The page's path under the matchup prefix. */
  path: string;
  season: number;
  week: number;
  seasonType: "regular" | "post";
  /** Kickoff, ISO. */
  kickoff: string;
  /**
   * The sitemap's lastmod, ISO, or null for none: the newer of the stored box
   * score's content stamp and the written recap's (see the file comment).
   */
  modified: string | null;
}

interface Fixture {
  team: NflTeam;
  game: ScheduleGame;
}

/** One club's regular season and postseason, as fixtures; empty on a miss. */
async function fixturesOf(team: NflTeam, season: number): Promise<Fixture[]> {
  const [regular, post] = await Promise.all([
    getTeamSchedule(team, season).catch(() => null),
    getTeamPostseason(team, season).catch(() => null),
  ]);
  return [...(regular?.games ?? []), ...(post?.games ?? [])].map((game) => ({ team, game }));
}

/** The newer of the game's stored content stamps, ISO, or null. */
function gameModified(season: number, game: ScheduleGame): string | null {
  const stamps = [storedBoxscoreModifiedAt(game.espnEventId), writtenRecapAt(season, game.gameId)]
    .filter((x): x is string => x !== null)
    .map((x) => new Date(Date.parse(x)).toISOString());
  return stamps.length ? stamps.sort().at(-1)! : null;
}

/** The dated pages of one season, unsorted. */
async function seasonGames(prefix: string, season: number): Promise<ArchivedGame[]> {
  const fixtures = (await Promise.all(TEAMS.map((team) => fixturesOf(team, season)))).flat();

  const seen = new Set<string>();
  const games: ArchivedGame[] = [];
  for (const { team, game } of fixtures) {
    const pair = canonicalizeMatchupPair(team, game.opponent);
    // Read from the pair's first club only: that is the schedule the page
    // resolves a game address against (getMatchupData reads pair.a's), so a
    // row the other club's schedule alone carries would be a 404.
    if (!pair || pair.a.abbreviation !== team.abbreviation) continue;
    // The page's own test for a game address: final, with a result.
    const isFinal = game.status === "final" && game.result !== null;
    if (!meetingHasOwnAddress({ kickoffMs: game.kickoffMs, isFinal })) continue;
    const ref: MatchupGameRef = { season, week: game.week, seasonType: game.seasonType };
    const segment = gameSegment(ref);
    const key = `${pair.slug}/${segment}`;
    if (seen.has(key)) continue;
    seen.add(key);
    games.push({
      pair: pair.slug,
      game: segment,
      path: `${prefix}${pair.slug}/${segment}/`,
      season,
      week: game.week,
      seasonType: game.seasonType,
      kickoff: new Date(game.kickoffMs!).toISOString(),
      modified: gameModified(season, game),
    });
  }
  return games;
}

/**
 * Every dated game page, sorted newest first: the current season and the
 * HISTORY_SEASONS before it, the window the page serves.
 *
 * `season` defaults to the league's current season. `now` only picks that
 * season: a finished game's address does not depend on the clock.
 */
export async function archivedGames(
  prefix: string,
  now: number = Date.now(),
  season?: number,
): Promise<{ season: number; seasons: number[]; games: ArchivedGame[] }> {
  const year = season ?? (await nflState(new Date(now))).season;
  const seasons = Array.from({ length: HISTORY_SEASONS + 1 }, (_, i) => year - i);
  const games = (await Promise.all(seasons.map((s) => seasonGames(prefix, s)))).flat();
  games.sort((x, y) => y.kickoff.localeCompare(x.kickoff) || x.pair.localeCompare(y.pair));
  return { season: year, seasons, games };
}
