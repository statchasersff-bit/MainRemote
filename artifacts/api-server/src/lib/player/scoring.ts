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

/** One line of a weekly scoring breakdown: what produced the points. */
export interface PointsComponent {
  label: string;
  /** The countable behind it — "277 yds", "2 TD". Empty when there is none. */
  detail: string;
  points: number;
}

/**
 * Where one week's fantasy points came from.
 *
 * The inverse of getFantasyPoints(): the same coefficients, kept as a list
 * instead of a sum. Its whole reason for existing is that "16.5" is a number a
 * reader has to trust, and a breakdown is the difference between trusting it
 * and checking it.
 *
 * Components worth nothing are dropped, so a passing line does not print four
 * empty rushing rows. It deliberately does NOT reconcile itself against
 * `getEntryPoints` — that value can come from Sleeper and include scoring this
 * function does not model. The renderer prints the difference as its own line
 * rather than quietly padding one of these, because an unexplained remainder is
 * exactly the thing a breakdown is supposed to reveal.
 */
export function pointsBreakdown(
  stats: GameLogStats,
  format: ScoringFormat,
): PointsComponent[] {
  const rows: PointsComponent[] = [];
  const add = (label: string, count: number, rate: number, unit: string): void => {
    if (!count) return;
    const points = Math.round(count * rate * 100) / 100;
    if (points === 0) return;
    rows.push({ label, detail: `${count} ${unit}`, points });
  };

  add("Passing yards", stats.pass_yd ?? 0, 0.04, "yds");
  add("Passing TD", stats.pass_td ?? 0, 4, "TD");
  add("Interceptions", stats.pass_int ?? 0, -1, "INT");
  add("Rushing yards", stats.rush_yd ?? 0, 0.1, "yds");
  add("Rushing TD", stats.rush_td ?? 0, 6, "TD");
  if (format !== "standard") {
    add("Receptions", stats.rec ?? 0, format === "ppr" ? 1 : 0.5, "rec");
  }
  add("Receiving yards", stats.rec_yd ?? 0, 0.1, "yds");
  add("Receiving TD", stats.rec_td ?? 0, 6, "TD");
  add("Field goals", stats.fgm ?? 0, 3, "FG");
  add("Extra points", stats.xpm ?? 0, 1, "XP");

  return rows;
}
