/**
 * Fantasy scoring, computed from raw stats rather than stored.
 *
 * Ported from the player-pages app's `shared/scoring.ts`. Raw stat lines are
 * stored once and every format is derived from them, which is what lets one
 * page answer for Standard, Half-PPR and PPR without three copies of the data -
 * and, more to the point, what keeps the weekly ranks, the tier-finish rates
 * and the volatility numbers consistent with whichever format is on screen.
 *
 * Pure: no clock, no locale, no I/O. Everything downstream of it is cacheable
 * on a key that includes the format.
 */

import type { GameLogStats } from "./types";
import {
  HOUSE_RULES,
  RECEPTION_POINTS,
  SCORING_FORMATS as HOUSE_FORMATS,
  SCORING_LABELS as HOUSE_LABELS,
  scoreLine,
  type ScoringFormat as HouseFormat,
  type ScoringLine,
} from "../scoring/house-rules";

export type ScoringFormat = HouseFormat;

export const SCORING_FORMATS: readonly ScoringFormat[] = HOUSE_FORMATS;

export const SCORING_LABELS: Record<ScoringFormat, string> = HOUSE_LABELS;

/** The short form, for a label with no room to say "Half-PPR" in full. */
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

/** A game-log stat line in the shared scoring module's terms. */
export function toScoringLine(stats: GameLogStats): ScoringLine {
  return {
    passYd: stats.pass_yd,
    passTd: stats.pass_td,
    passInt: stats.pass_int,
    rushYd: stats.rush_yd,
    rushTd: stats.rush_td,
    rec: stats.rec,
    recYd: stats.rec_yd,
    recTd: stats.rec_td,
    fumLost: stats.fum_lost,
    twoPt: (stats.pass_2pt ?? 0) + (stats.rush_2pt ?? 0) + (stats.rec_2pt ?? 0),
    otherTd: (stats.st_td ?? 0) + (stats.fum_rec_td ?? 0),
    fgm: stats.fgm,
    xpm: stats.xpm,
  };
}

/**
 * Points for one game computed from its stat line under the house rules
 * (lib/scoring/house-rules.ts). Since 2026-11-19 this includes fumbles lost,
 * two-point conversions and return/fumble-recovery touchdowns, which it used
 * to leave out - so a computed Standard total no longer overstates a player
 * who lost a fumble.
 */
export function getFantasyPoints(
  stats: GameLogStats,
  format: ScoringFormat,
): number {
  return Math.round(scoreLine(toScoringLine(stats), format) * 100) / 100;
}

/**
 * Points for one entry, preferring the stored per-game total where upstream
 * has one.
 *
 * `pts_ppr`, `pts_half_ppr` and `pts_std` are Sleeper's per-game totals, which
 * use the same settings as the house rules (checked 2026-11-19: every 2026
 * week reproduces exactly from the stat line). Preferring them keeps the page
 * agreeing with the scoreboard the reader saw, and keeps all three formats
 * from the same source so PPR minus Standard is always the receptions. The
 * stats tables sum this same function, so the hub and the tables cannot
 * disagree for the same snapshot.
 */
export function getEntryPoints(
  stats: GameLogStats,
  format: ScoringFormat,
): number {
  if (format === "ppr") return stats.pts_ppr;
  if (format === "half" && stats.pts_half_ppr != null) return stats.pts_half_ppr;
  if (format === "standard" && stats.pts_std != null) return stats.pts_std;
  return getFantasyPoints(stats, format);
}

/** One line of a weekly scoring breakdown: what produced the points. */
export interface PointsComponent {
  label: string;
  /** The countable behind it - "277 yds", "2 TD". Empty when there is none. */
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
 * `getEntryPoints` - that value can come from Sleeper and include scoring this
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

  add("Passing yards", stats.pass_yd ?? 0, HOUSE_RULES.passYd, "yds");
  add("Passing TD", stats.pass_td ?? 0, HOUSE_RULES.passTd, "TD");
  add("Interceptions", stats.pass_int ?? 0, HOUSE_RULES.passInt, "INT");
  add("Rushing yards", stats.rush_yd ?? 0, HOUSE_RULES.rushYd, "yds");
  add("Rushing TD", stats.rush_td ?? 0, HOUSE_RULES.rushTd, "TD");
  if (format !== "standard") {
    add("Receptions", stats.rec ?? 0, RECEPTION_POINTS[format], "rec");
  }
  add("Receiving yards", stats.rec_yd ?? 0, HOUSE_RULES.recYd, "yds");
  add("Receiving TD", stats.rec_td ?? 0, HOUSE_RULES.recTd, "TD");
  add("Field goals", stats.fgm ?? 0, HOUSE_RULES.fgm, "FG");
  add("Extra points", stats.xpm ?? 0, HOUSE_RULES.xpm, "XP");
  // From the log's own fumble column (kept since 2026-11-04): -2 a lost ball
  // in every format, the way Sleeper's stored points count it.
  add("Fumbles lost", stats.fum_lost ?? 0, HOUSE_RULES.fumLost, "lost");
  add(
    "Two-point conversions",
    (stats.pass_2pt ?? 0) + (stats.rush_2pt ?? 0) + (stats.rec_2pt ?? 0),
    HOUSE_RULES.twoPt,
    "2PT",
  );
  add("Return / fumble-recovery TD", (stats.st_td ?? 0) + (stats.fum_rec_td ?? 0), HOUSE_RULES.otherTd, "TD");

  return rows;
}
