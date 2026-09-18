/**
 * Fantasy scoring, computed from raw stats rather than stored.
 *
 * Ported from the player-pages app's `shared/scoring.ts`. Raw stat lines are
 * stored once and every format is derived from them, which is what lets one
 * page answer for Standard, Half-PPR and PPR without three copies of the data —
 * and, more to the point, what keeps the weekly ranks, the tier-finish rates
 * and the volatility numbers consistent with whichever format is on screen.
 *
 * Pure: no clock, no locale, no I/O. Everything downstream of it is cacheable
 * on a key that includes the format.
 */

import type { GameLogStats } from "./types";

export type ScoringFormat = "standard" | "half" | "ppr";

export const SCORING_FORMATS: readonly ScoringFormat[] = [
  "standard",
  "half",
  "ppr",
] as const;

export const SCORING_LABELS: Record<ScoringFormat, string> = {
  standard: "Standard",
  half: "Half-PPR",
  ppr: "PPR",
};

/** The short form used on the format toggle. */
export const SCORING_SHORT: Record<ScoringFormat, string> = {
  standard: "STD",
  half: "HALF",
  ppr: "PPR",
};

export function parseScoringFormat(value: unknown): ScoringFormat {
  return value === "standard" || value === "half" || value === "ppr"
    ? value
    : "ppr";
}

export function getFantasyPoints(
  stats: GameLogStats,
  format: ScoringFormat,
): number {
  let pts = 0;
  pts += (stats.pass_yd ?? 0) * 0.04;
  pts += (stats.pass_td ?? 0) * 4;
  pts += (stats.pass_int ?? 0) * -1;
  pts += (stats.rush_yd ?? 0) * 0.1;
  pts += (stats.rush_td ?? 0) * 6;
  pts += (stats.rec_yd ?? 0) * 0.1;
  pts += (stats.rec_td ?? 0) * 6;
  pts += (stats.fgm ?? 0) * 3;
  pts += (stats.xpm ?? 0) * 1;

  if (format === "ppr") pts += stats.rec ?? 0;
  else if (format === "half") pts += (stats.rec ?? 0) * 0.5;

  return Math.round(pts * 100) / 100;
}

/**
 * Points for one entry, preferring the stored value where upstream has one.
 *
 * `pts_ppr` and `pts_half_ppr` come from Sleeper and include scoring this
 * function does not model (return yardage, two-point conversions, fumbles), so
 * using them where they exist keeps the page agreeing with the scoreboard the
 * reader saw. Standard has no stored counterpart and is always computed.
 */
export function getEntryPoints(
  stats: GameLogStats,
  format: ScoringFormat,
): number {
  if (format === "ppr") return stats.pts_ppr;
  if (format === "half" && stats.pts_half_ppr != null) return stats.pts_half_ppr;
  return getFantasyPoints(stats, format);
}
