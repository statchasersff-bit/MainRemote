/**
 * Fantasy points for one player in one game, from his box-score line.
 *
 * The one scoring engine the matchup pages use. The Sleeper logs carry their
 * own PPR figure, but only for the regular season's offensive players; a
 * playoff game has no log at all. Computing from the line means every game -
 * Wild Card included - scores the same way, and a figure on the page can be
 * checked by hand against the stats printed beside it.
 *
 * Pure: a stat line and a format in, a number rounded to one decimal out.
 */

import { scoreLine, roundPoints, type ScoringFormat } from "../scoring/house-rules";

export type { ScoringFormat };

/**
 * The counting stats scoring reads. Every field is optional: a receiver has
 * no passing line, and a missing field is a zero, not an unknown.
 */
export interface FantasyStatLine {
  passYds?: number;
  passTd?: number;
  passInt?: number;
  rushYds?: number;
  rushTd?: number;
  rec?: number;
  recYds?: number;
  recTd?: number;
  fumblesLost?: number;
  /** Two-point conversions this player scored, running or catching. */
  twoPtScored?: number;
  /** Two-point conversions this player threw. */
  twoPtPassed?: number;
}

/**
 * The house rules (lib/scoring/house-rules.ts), the same function the player
 * pages, FPA and the stats tables score with: -1 per interception (mak,
 * 2026-09-30, overriding the recap build spec's -2), -2 per fumble lost, 2 per
 * two-point conversion.
 */
export function fantasyPoints(stats: FantasyStatLine, format: ScoringFormat): number {
  return roundPoints(
    scoreLine(
      {
        passYd: stats.passYds,
        passTd: stats.passTd,
        passInt: stats.passInt,
        rushYd: stats.rushYds,
        rushTd: stats.rushTd,
        rec: stats.rec,
        recYd: stats.recYds,
        recTd: stats.recTd,
        fumLost: stats.fumblesLost,
        twoPt: (stats.twoPtScored ?? 0) + (stats.twoPtPassed ?? 0),
      },
      format,
    ),
    1,
  );
}

/* ---------------------------------------------------------------- kickers */

/**
 * A kicker's game. Made field goals are listed by distance because the tiers
 * pay by distance; a miss costs the same from anywhere, so misses are a count.
 */
export interface KickerLine {
  fgMade: number[];
  fgAtt: number;
  xpMade: number;
  xpAtt: number;
}

/** 0–39 yards 3, 40–49 4, 50+ 5; a made extra point 1; any miss −1. Same in every format. */
export function kickerPoints(line: KickerLine): number {
  const made = line.fgMade.reduce((sum, yards) => sum + (yards >= 50 ? 5 : yards >= 40 ? 4 : 3), 0);
  const misses =
    Math.max(0, line.fgAtt - line.fgMade.length) + Math.max(0, line.xpAtt - line.xpMade);
  return Math.round((made + line.xpMade - misses) * 10) / 10;
}

/* ------------------------------------------------------ defense / special teams */

export interface DefenseLine {
  sacks: number;
  ints: number;
  fumRec: number;
  safeties: number;
  defTd: number;
  retTd: number;
  pointsAllowed: number;
}

/** The points-allowed tier: a shutout 10, 1–6 7, 7–13 4, 14–20 1, 21–27 0, 28–34 −1, 35+ −4. */
export function pointsAllowedTier(allowed: number): number {
  if (allowed <= 0) return 10;
  if (allowed <= 6) return 7;
  if (allowed <= 13) return 4;
  if (allowed <= 20) return 1;
  if (allowed <= 27) return 0;
  if (allowed <= 34) return -1;
  return -4;
}

export function defensePoints(line: DefenseLine): number {
  const points =
    line.sacks +
    (line.ints + line.fumRec + line.safeties) * 2 +
    (line.defTd + line.retTd) * 6 +
    pointsAllowedTier(line.pointsAllowed);
  return Math.round(points * 10) / 10;
}

/* ------------------------------------------------ individual defensive players */

export interface IdpLine {
  solo?: number;
  ast?: number;
  tfl?: number;
  sacks?: number;
  qbHits?: number;
  pd?: number;
  int?: number;
  ff?: number;
  fr?: number;
  td?: number;
}

/**
 * 1 per solo tackle, 0.5 per assist, +1 per tackle for loss, 2 per sack, 1 per
 * QB hit, 1 per pass defended, 3 per interception, 2 per forced fumble or
 * recovery, 6 per touchdown.
 */
export function idpPoints(line: IdpLine): number {
  const n = (value: number | undefined): number =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;
  const points =
    n(line.solo) +
    n(line.ast) * 0.5 +
    n(line.tfl) +
    n(line.sacks) * 2 +
    n(line.qbHits) +
    n(line.pd) +
    n(line.int) * 3 +
    (n(line.ff) + n(line.fr)) * 2 +
    n(line.td) * 6;
  return Math.round(points * 10) / 10;
}
