/**
 * Every dated game page that is canonical at its own address, for the sitemap.
 *
 * A finished meeting has an address of its own (`/nfl/<a>-vs-<b>/2026-week-2/`)
 * from the moment the pair's page stops owning it: the pair's page owns this
 * season's latest result until the rematch is within six days (see
 * pairOwnsMeeting in pair.ts, the one rule the route, the team hub and this
 * list all apply). While it is owned the dated URL canonicalizes up to the
 * pair's page, and a sitemap that listed it would be advertising a copy.
 *
 * Every game of the season before is an archive at its own address, so the
 * whole of it is listed too (the SEO brief of 2026-10-10: "add every 2025
 * game page"). `<lastmod>` is the stored box score's fetch stamp - the last
 * time the stats were pulled, which moves on a stat correction - and the
 * kickoff for a game whose stats are not stored.
 *
 * The WordPress plugin reads this at /embed/matchup-games.json and serves
 * each path from /game-sitemap.xml. Built from the 32 regular-season
 * schedules plus each club's postseason, deduplicated per game, so a game is
 * listed once however many clubs it belongs to.
 */

import { TEAMS, type NflTeam } from "../team/teams";
import { getTeamPostseason, getTeamSchedule, type ScheduleGame } from "../team/schedule";
import { nflState } from "../team/nfl-state";
import { storedBoxscoreFetchedAt } from "./boxscore";
import {
  canonicalizeMatchupPair,
  gameSegment,
  meetingHasOwnAddress,
  type MatchupGameRef,
  type MeetingFacts,
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
  /** The sitemap's lastmod, ISO: the stored stats' fetch stamp, else the kickoff. */
  modified: string;
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

function factsOf(game: ScheduleGame): MeetingFacts {
  return { kickoffMs: game.kickoffMs, isFinal: game.status === "final" };
}

/** The dated pages of one season at `now`, unsorted. */
async function seasonGames(
  prefix: string,
  season: number,
  currentSeason: number,
  now: number,
): Promise<ArchivedGame[]> {
  const fixtures = (await Promise.all(TEAMS.map((team) => fixturesOf(team, season)))).flat();

  // Every meeting of each pair this season, so the rule can see whether a
  // game is the latest one played and whether a rematch is near.
  const byPair = new Map<string, MeetingFacts[]>();
  for (const { team, game } of fixtures) {
    const pair = canonicalizeMatchupPair(team, game.opponent);
    if (!pair) continue;
    const list = byPair.get(pair.slug) ?? [];
    // Both clubs' schedules carry the meeting; the rule is indifferent to a
    // duplicate, and deduplicating by event id would drop rows without one.
    list.push(factsOf(game));
    byPair.set(pair.slug, list);
  }

  const seen = new Set<string>();
  const games: ArchivedGame[] = [];
  for (const { team, game } of fixtures) {
    const pair = canonicalizeMatchupPair(team, game.opponent);
    if (!pair || game.status !== "final" || game.kickoffMs === null) continue;
    const own = meetingHasOwnAddress(
      { ...factsOf(game), season },
      byPair.get(pair.slug) ?? [],
      currentSeason,
      now,
    );
    if (!own) continue;
    const ref: MatchupGameRef = { season, week: game.week, seasonType: game.seasonType };
    const segment = gameSegment(ref);
    const key = `${pair.slug}/${segment}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const kickoff = new Date(game.kickoffMs).toISOString();
    games.push({
      pair: pair.slug,
      game: segment,
      path: `${prefix}${pair.slug}/${segment}/`,
      season,
      week: game.week,
      seasonType: game.seasonType,
      kickoff,
      modified: storedBoxscoreFetchedAt(game.espnEventId) ?? kickoff,
    });
  }
  return games;
}

/**
 * The dated pages that exist at `now`, sorted newest first: the current
 * season by the ownership rule, and the whole of the season before.
 *
 * `season` defaults to the league's current season. The regular schedules
 * are what the team hubs already hold, so this costs nothing new; the 32
 * postseason reads are empty for most clubs in most years.
 */
export async function archivedGames(
  prefix: string,
  now: number = Date.now(),
  season?: number,
): Promise<{ season: number; seasons: number[]; games: ArchivedGame[] }> {
  const year = season ?? (await nflState(new Date(now))).season;
  const seasons = [year, year - 1];
  const games = (
    await Promise.all(seasons.map((s) => seasonGames(prefix, s, year, now)))
  ).flat();
  games.sort((x, y) => y.kickoff.localeCompare(x.kickoff) || x.pair.localeCompare(y.pair));
  return { season: year, seasons, games };
}
