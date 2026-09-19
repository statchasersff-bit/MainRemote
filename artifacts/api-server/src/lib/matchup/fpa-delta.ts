/**
 * What one game did to the two defenses' fantasy-points-allowed ranks.
 *
 * The Fantasy Matchups block is a pregame question — "is my receiver in a good
 * spot this week" — and after the game it was still printing the season-to-date
 * answer as though nothing had happened. This turns it into the postgame one:
 * the rank each defense carried INTO the game, and the rank it carried out.
 *
 * Both are computed the same way and from the same rows, so the pair is
 * comparable by construction: `fantasy_points_allowed_games` holds one row per
 * defense per position per week, and the before-figure is the average over the
 * weeks strictly before this one while the after-figure is the average over the
 * weeks through it. Rank 1 is the most points allowed — the softest defense —
 * which is the direction the FPA page itself uses and states.
 *
 * A game in week 1 has nothing before it. That is reported as a null `before`
 * rather than as a rank of 32 or an arrow pointing nowhere, and the renderer
 * prints the new rank on its own.
 */

import { and, eq, lte } from "drizzle-orm";
import { db, fpaGames } from "../db";
import { FANTASY_POSITIONS, type FantasyPosition, type ScoringFormat } from "./../fpa/nflverse";
import type { NflTeam } from "../team/teams";

export interface RankMove {
  /** Rank going into the game, or null in week 1 and when nothing preceded it. */
  before: number | null;
  after: number;
  /** Points allowed per game after the game, for the figure beside the rank. */
  fpa: number;
}

export interface FpaDelta {
  season: number;
  week: number;
  format: ScoringFormat;
  /** Keyed by upper-case team abbreviation, then position. */
  byTeam: Record<string, Record<FantasyPosition, RankMove>>;
}

/** Rank 1 = most points allowed = softest matchup. Mirrors fpa-data.ts. */
function rankDescending(values: number[]): number[] {
  const order = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => b.value - a.value);
  const ranks = new Array<number>(values.length);
  order.forEach((entry, i) => {
    ranks[entry.index] = i + 1;
  });
  return ranks;
}

interface Accumulated {
  /** Points allowed, by position, summed over the weeks in the window. */
  points: Map<FantasyPosition, number>;
  /**
   * Distinct weeks this defense appears in at all — its games played.
   *
   * The denominator is deliberately not "weeks with a row for THIS position". A
   * defense that held every tight end to nothing has no TE row that week, and
   * dividing its TE points by the weeks it conceded any would turn its best
   * game into a missing one and inflate the average.
   */
  weeks: Set<number>;
}

function averages(
  rows: Array<{ defenseTeamAbbr: string; position: string; week: number; fantasyPoints: string }>,
  throughWeek: number,
): Map<string, Record<FantasyPosition, number>> | null {
  const acc = new Map<string, Accumulated>();
  for (const row of rows) {
    if (row.week > throughWeek) continue;
    const abbr = row.defenseTeamAbbr.toUpperCase();
    const entry =
      acc.get(abbr) ?? { points: new Map<FantasyPosition, number>(), weeks: new Set<number>() };
    entry.weeks.add(row.week);
    const position = row.position as FantasyPosition;
    if ((FANTASY_POSITIONS as readonly string[]).includes(position)) {
      const points = Number(row.fantasyPoints);
      if (Number.isFinite(points)) {
        entry.points.set(position, (entry.points.get(position) ?? 0) + points);
      }
    }
    acc.set(abbr, entry);
  }
  if (acc.size === 0) return null;

  const out = new Map<string, Record<FantasyPosition, number>>();
  for (const [abbr, entry] of acc) {
    const games = entry.weeks.size;
    if (games === 0) continue;
    out.set(
      abbr,
      Object.fromEntries(
        FANTASY_POSITIONS.map((position) => [
          position,
          (entry.points.get(position) ?? 0) / games,
        ]),
      ) as Record<FantasyPosition, number>,
    );
  }
  return out.size ? out : null;
}

/**
 * Ranks for every defense at both cutoffs, or null.
 *
 * Held in the process once computed: a finished week's figures never change
 * again, and every pair page whose featured game is that week asks the same
 * question.
 */
const cache = new Map<string, FpaDelta | null>();

export async function getFpaDelta(
  season: number,
  week: number,
  format: ScoringFormat,
): Promise<FpaDelta | null> {
  const key = `${season}:${week}:${format}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  let rows;
  try {
    rows = await db
      .select({
        defenseTeamAbbr: fpaGames.defenseTeamAbbr,
        position: fpaGames.position,
        week: fpaGames.week,
        fantasyPoints: fpaGames.fantasyPoints,
      })
      .from(fpaGames)
      .where(
        and(
          eq(fpaGames.season, season),
          eq(fpaGames.scoringFormat, format),
          eq(fpaGames.isBaseline, false),
          lte(fpaGames.week, week),
        ),
      );
  } catch {
    // The FPA ingest may never have run, and the database is not required for
    // a matchup page to render. One block declines; the page does not.
    cache.set(key, null);
    return null;
  }

  const after = averages(rows, week);
  if (!after) {
    cache.set(key, null);
    return null;
  }
  const before = week > 1 ? averages(rows, week - 1) : null;

  // The two rankings are taken over the same set of defenses, in the same
  // order, so a team's before and after are positions in comparable fields.
  const teams = [...after.keys()].sort();
  const afterRanks = Object.fromEntries(
    FANTASY_POSITIONS.map((position) => [
      position,
      rankDescending(teams.map((abbr) => after.get(abbr)![position])),
    ]),
  ) as Record<FantasyPosition, number[]>;

  const beforeTeams = before ? [...before.keys()].sort() : [];
  const beforeRanks = before
    ? (Object.fromEntries(
        FANTASY_POSITIONS.map((position) => [
          position,
          rankDescending(beforeTeams.map((abbr) => before.get(abbr)![position])),
        ]),
      ) as Record<FantasyPosition, number[]>)
    : null;

  const byTeam: FpaDelta["byTeam"] = {};
  teams.forEach((abbr, index) => {
    const beforeIndex = beforeTeams.indexOf(abbr);
    byTeam[abbr] = Object.fromEntries(
      FANTASY_POSITIONS.map((position) => [
        position,
        {
          before:
            beforeRanks && beforeIndex >= 0
              ? (beforeRanks[position][beforeIndex] ?? null)
              : null,
          after: afterRanks[position][index]!,
          fpa: Math.round(after.get(abbr)![position] * 10) / 10,
        } satisfies RankMove,
      ]),
    ) as Record<FantasyPosition, RankMove>;
  });

  const delta: FpaDelta = { season, week, format, byTeam };
  cache.set(key, delta);
  return delta;
}

/** One team's moves, or null when the table does not know it. */
export function movesFor(
  delta: FpaDelta | null,
  team: NflTeam,
): Record<FantasyPosition, RankMove> | null {
  if (!delta) return null;
  return (
    delta.byTeam[team.abbreviation.toUpperCase()] ??
    delta.byTeam[team.espnAbbr.toUpperCase()] ??
    null
  );
}

/** Cleared by the FPA ingest, which is the only thing that can change these. */
export function invalidateFpaDeltaCache(): void {
  cache.clear();
}
