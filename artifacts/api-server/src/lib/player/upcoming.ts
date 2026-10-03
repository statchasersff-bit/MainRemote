/**
 * What is next for a player: the schedule, with the matchup it walks into.
 *
 * The Game Log tab is about games that have been played. This is the one block
 * on it that is not, and the separation is enforced rather than described: an
 * upcoming game never becomes a row in the completed table with dashes where
 * its statistics would go. A table of results and a list of fixtures are two
 * different objects, and merging them produces a page where "did not play" and
 * "has not played yet" look identical.
 *
 * Two upstreams, neither of which the page may fail on:
 *
 *   - the team's schedule (ESPN, via lib/team/schedule.ts), which the team hubs
 *     already load and cache. It carries the REGULAR season only, which is why
 *     nothing here filters out the postseason: there is none to filter.
 *
 *   - fantasy points allowed, from the same `fpaSnapshots` table the /fpa tool
 *     reads. Using it rather than deriving a second opponent-strength number
 *     here is the whole point - one matchup methodology per site, so a rank on
 *     this card and a rank on that page cannot disagree.
 *
 * Bye weeks need no handling. A bye is a week with no game, so it is simply not
 * in `schedule.games`, and the next four fixtures skip it the way a schedule
 * does: by not containing it.
 */

import { logger } from "../logger";
import { getFpaTable, type FpaTableData } from "../fpa/fpa-data";
import { FANTASY_POSITIONS, type FantasyPosition } from "../fpa/nflverse";
import type { TeamSchedule } from "../team/schedule";
import type { NflTeam } from "../team/teams";
import type { ScoringFormat } from "./scoring";

/** How many fixtures the section shows, when the season has that many left. */
export const UPCOMING_COUNT = 4;

/**
 * Raw points allowed, not the adjusted blend.
 *
 * `/fpa` defaults to `raw` and that is the number the site quotes everywhere
 * else, so this quotes it too. One constant rather than a choice made inline:
 * if the adjusted view ever becomes the house metric, this is the single line
 * that moves and the card, the caption and the tool stay in agreement.
 */
const FPA_VIEW = "raw" as const;

/**
 * A game already scored past. ESPN can leave a fixture "scheduled" for a while
 * after it kicks off, so a game is only dropped once its window has closed.
 */
const GAME_WINDOW_MS = 4 * 60 * 60 * 1000;

export interface UpcomingMatchup {
  /** 1 = allows the most points to this position. See the caption. */
  rank: number;
  /** Fantasy points allowed per game to the position. */
  fpa: number;
  position: FantasyPosition;
}

export interface UpcomingGame {
  week: number;
  homeAway: "home" | "away";
  opponent: NflTeam | null;
  /** The opponent's short code - the card's focal point. */
  opponentCode: string;
  opponentName: string;
  kickoffMs: number | null;
  timeConfirmed: boolean;
  /** Null for a position the FPA table does not cover, and for kickers. */
  matchup: UpcomingMatchup | null;
}

function isFantasyPosition(value: string | null): value is FantasyPosition {
  return value !== null && (FANTASY_POSITIONS as readonly string[]).includes(value);
}

/* ------------------------------------------------------------ the fpa table */

interface CacheEntry {
  at: number;
  table: FpaTableData | null;
}

/**
 * The points-allowed table, memoised per scoring format.
 *
 * `getFpaTable` runs a query per call, and this is now on the path of every
 * player page - several hundred of them, three formats each. The numbers move
 * once a week at most, so a ten-minute window costs nothing in freshness and
 * takes the query off the request path entirely.
 *
 * A failed query keeps the last good table rather than blanking the section:
 * the matchup ranks being an hour old is a far better page than the fixtures
 * losing their context because one connection timed out.
 */
const TABLE_TTL_MS = 10 * 60 * 1000;
const tableCache = new Map<string, CacheEntry>();

export async function matchupTable(
  format: ScoringFormat,
  now: number = Date.now(),
): Promise<FpaTableData | null> {
  const key = `${format}:${FPA_VIEW}`;
  const hit = tableCache.get(key);
  if (hit && now - hit.at < TABLE_TTL_MS) return hit.table;

  try {
    const table = await getFpaTable({ format, view: FPA_VIEW });
    tableCache.set(key, { at: now, table });
    return table;
  } catch (err) {
    logger.warn({ err, format }, "FPA table unavailable for the upcoming-games block");
    if (hit) return hit.table;
    tableCache.set(key, { at: now, table: null });
    return null;
  }
}

/** Drops the memoised tables. For the tests and the dev reload path. */
export function resetMatchupTableCache(): void {
  tableCache.clear();
}

/* --------------------------------------------------------------- the games */

export interface UpcomingInput {
  position: string | null;
  schedule: TeamSchedule | null;
  fpa: FpaTableData | null;
  now: number;
  count?: number;
}

/**
 * The next few fixtures, with each opponent's difficulty against this position.
 *
 * Deliberately NOT lib/team/schedule.ts's `upcomingGames()`, which falls back
 * to the tail of the schedule once a season is over so the team hub's card
 * strip never empties. Here that fallback would print finished games under a
 * heading that says "upcoming" - so an over season returns nothing, and the
 * section drops out of the page rather than lying about it.
 */
export function buildUpcoming(input: UpcomingInput): UpcomingGame[] {
  const { position, schedule, fpa, now } = input;
  const count = input.count ?? UPCOMING_COUNT;
  if (!schedule) return [];

  const fixtures = schedule.games
    .filter(
      (game) =>
        game.status !== "final" &&
        (game.kickoffMs === null || game.kickoffMs + GAME_WINDOW_MS > now),
    )
    .sort((a, b) => a.week - b.week)
    .slice(0, count);

  const pos = isFantasyPosition(position) ? position : null;

  return fixtures.map((game) => {
    const code = game.opponent?.code ?? game.opponentName;

    // Matched on the canonical team row where there is one, so an upstream
    // abbreviation this codebase spells differently (WSH/WAS, JAC/JAX) still
    // finds its row.
    const row =
      pos && fpa
        ? (fpa.rows.find(
            (candidate) =>
              (game.opponent && candidate.team?.code === game.opponent.code) ||
              candidate.abbr.toUpperCase() === code.toUpperCase(),
          ) ?? null)
        : null;

    const cell = row && pos ? row.byPos[pos] : null;

    return {
      week: game.week,
      homeAway: game.homeAway,
      opponent: game.opponent,
      opponentCode: code,
      opponentName: game.opponent?.fullName ?? game.opponentName,
      kickoffMs: game.kickoffMs,
      timeConfirmed: game.timeConfirmed,
      matchup:
        cell && pos && Number.isFinite(cell.rank) && Number.isFinite(cell.fpa)
          ? { rank: cell.rank, fpa: cell.fpa, position: pos }
          : null,
    };
  });
}

/**
 * A fingerprint of the block, for the render cache.
 *
 * The fixtures and their ranks both move - one when a game finishes, the other
 * when the ingest runs - and neither is covered by the data-file stamp the rest
 * of this page keys on.
 */
export function upcomingStamp(games: UpcomingGame[]): string {
  return games
    .map((game) => `${game.week}:${game.opponentCode}:${game.matchup?.rank ?? ""}`)
    .join("|");
}
