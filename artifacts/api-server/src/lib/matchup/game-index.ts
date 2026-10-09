/**
 * Every dated game page that exists this season, for the sitemap.
 *
 * A finished meeting gets an address of its own (`/nfl/<a>-vs-<b>/2026-week-2/`)
 * once the pair's page has let go of it: two weeks after kickoff, or at once
 * when the two clubs still have a meeting ahead (see meetingHasOwnAddress in
 * pair.ts, the one rule the route, the team hub and this list all apply).
 * Until then the dated URL 301s up to the pair's page, and a sitemap that
 * listed it would be advertising a redirect.
 *
 * The WordPress plugin reads this at /embed/matchup-games.json and appends
 * each path to Rank Math's page sitemap beside the 496 pair URLs (mak,
 * 2026-10-09: "no game-page sitemap yet"). Built from the 32 regular-season
 * schedules plus each club's postseason, deduplicated per game, so a game is
 * listed once however many clubs it belongs to.
 */

import { TEAMS, type NflTeam } from "../team/teams";
import { getTeamPostseason, getTeamSchedule, type ScheduleGame } from "../team/schedule";
import { nflState } from "../team/nfl-state";
import { canonicalizeMatchupPair, gameSegment, isUpcomingFixture, meetingHasOwnAddress, type MatchupGameRef } from "./pair";

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
  /** Kickoff, ISO. The sitemap's lastmod: a recap does not change after the game. */
  kickoff: string;
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

/**
 * The dated pages that exist at `now`, sorted newest first.
 *
 * `season` defaults to the league's current season. The regular schedules
 * are what the team hubs already hold, so this costs nothing new; the 32
 * postseason reads are empty for most clubs in most years.
 */
export async function archivedGames(
  prefix: string,
  now: number = Date.now(),
  season?: number,
): Promise<{ season: number; games: ArchivedGame[] }> {
  const year = season ?? (await nflState(new Date(now))).season;
  const fixtures = (await Promise.all(TEAMS.map((team) => fixturesOf(team, year)))).flat();

  // Which pairs still have a meeting ahead: upcoming beats recent on the
  // pair's page, so a played divisional game is let go of straight away.
  const rematchAhead = new Set<string>();
  for (const { team, game } of fixtures) {
    const pair = canonicalizeMatchupPair(team, game.opponent);
    if (!pair) continue;
    if (isUpcomingFixture(game.status === "final", game.kickoffMs, now)) rematchAhead.add(pair.slug);
  }

  const seen = new Set<string>();
  const games: ArchivedGame[] = [];
  for (const { team, game } of fixtures) {
    const pair = canonicalizeMatchupPair(team, game.opponent);
    if (!pair || game.status !== "final" || game.kickoffMs === null) continue;
    if (!meetingHasOwnAddress(game.kickoffMs, true, now, rematchAhead.has(pair.slug))) continue;
    const ref: MatchupGameRef = { season: year, week: game.week, seasonType: game.seasonType };
    const segment = gameSegment(ref);
    const key = `${pair.slug}/${segment}`;
    if (seen.has(key)) continue;
    seen.add(key);
    games.push({
      pair: pair.slug,
      game: segment,
      path: `${prefix}${pair.slug}/${segment}/`,
      season: year,
      week: game.week,
      seasonType: game.seasonType,
      kickoff: new Date(game.kickoffMs).toISOString(),
    });
  }
  games.sort((x, y) => y.kickoff.localeCompare(x.kickoff) || x.pair.localeCompare(y.pair));
  return { season: year, games };
}
