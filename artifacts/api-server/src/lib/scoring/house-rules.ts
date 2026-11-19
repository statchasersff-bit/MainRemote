/**
 * The StatChasers house scoring rules - the one place a fantasy point is defined.
 *
 * Every skill-player fantasy figure on the site comes from scoreLine(): the
 * player hub and its tabs (via player/scoring.ts), the matchup box scores and
 * recaps (matchup/fantasy-points.ts), Fantasy Points Allowed (fpa/nflverse.ts)
 * and the NFL Player Stats tables (player-stats/stats-data.ts, through the
 * player game logs). Each consumer maps its own stat names onto ScoringLine and
 * calls this; none of them carries a coefficient of its own.
 *
 * The rules (verified 2026-11-19 against every existing implementation and
 * against Sleeper's stored per-game totals, which use the same settings):
 *
 *   passing   0.04 per yard (1 per 25), 4 per TD, -1 per interception
 *   rushing   0.1 per yard, 6 per TD
 *   receiving 0.1 per yard, 6 per TD, per reception 0 / 0.5 / 1
 *   turnover  -2 per fumble lost (a fumble recovered by the offense is 0)
 *   2-pt      2 per conversion, thrown, run or caught
 *   other TD  6 per kick/punt return or fumble-recovery touchdown
 *   kicking   3 per field goal, 1 per extra point (the player hub's flat rule;
 *             the matchup pages' distance-tiered kicker scoring is separate)
 *
 * -1 per interception is mak's rule (2026-09-30). nflverse's own
 * fantasy_points column charges -2 and was what the stats tables printed until
 * 2026-11-19 (audit WEB-031/036).
 *
 * Pure: no I/O. Unrounded - each consumer rounds for display.
 */

export type ScoringFormat = "standard" | "half" | "ppr";

export const SCORING_FORMATS: readonly ScoringFormat[] = ["standard", "half", "ppr"] as const;

/** Default format for player profiles and the NFL Player Stats tables. */
export const DEFAULT_SCORING_FORMAT: ScoringFormat = "ppr";

export const SCORING_LABELS: Record<ScoringFormat, string> = {
  standard: "Standard",
  half: "Half-PPR",
  ppr: "PPR",
};

/** Points per reception, by format. The only coefficient that varies. */
export const RECEPTION_POINTS: Record<ScoringFormat, number> = {
  standard: 0,
  half: 0.5,
  ppr: 1,
};

/** Every coefficient except the reception, which is RECEPTION_POINTS. */
export const HOUSE_RULES = {
  passYd: 0.04,
  passTd: 4,
  passInt: -1,
  rushYd: 0.1,
  rushTd: 6,
  recYd: 0.1,
  recTd: 6,
  fumLost: -2,
  twoPt: 2,
  otherTd: 6,
  fgm: 3,
  xpm: 1,
} as const;

/** The scoring events. Every field optional: a missing one is a zero. */
export interface ScoringLine {
  passYd?: number;
  passTd?: number;
  passInt?: number;
  rushYd?: number;
  rushTd?: number;
  rec?: number;
  recYd?: number;
  recTd?: number;
  fumLost?: number;
  /** Two-point conversions of any kind: thrown, run or caught. */
  twoPt?: number;
  /** Kick/punt return and fumble-recovery touchdowns. */
  otherTd?: number;
  fgm?: number;
  xpm?: number;
}

const n = (value: number | undefined | null): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/** Fantasy points for one stat line under the house rules. Unrounded. */
export function scoreLine(line: ScoringLine, format: ScoringFormat): number {
  const r = HOUSE_RULES;
  return (
    n(line.passYd) * r.passYd +
    n(line.passTd) * r.passTd +
    n(line.passInt) * r.passInt +
    n(line.rushYd) * r.rushYd +
    n(line.rushTd) * r.rushTd +
    n(line.recYd) * r.recYd +
    n(line.recTd) * r.recTd +
    n(line.rec) * RECEPTION_POINTS[format] +
    n(line.fumLost) * r.fumLost +
    n(line.twoPt) * r.twoPt +
    n(line.otherTd) * r.otherTd +
    n(line.fgm) * r.fgm +
    n(line.xpm) * r.xpm
  );
}

/** Round to `places` decimals through an integer, so 0.1 * 3 prints 0.3. */
export function roundPoints(points: number, places = 1): number {
  const f = 10 ** places;
  return Math.round(points * f) / f;
}

/**
 * The visible label for a fantasy figure: "Fantasy Points (PPR)",
 * "PPR Points/Game". Kept here so a format switch relabels everything at once.
 */
export function pointsLabel(format: ScoringFormat, unit?: "game" | "target" | "touch"): string {
  const name = SCORING_LABELS[format];
  if (!unit) return `Fantasy Points (${name})`;
  return `${name} Points/${unit[0].toUpperCase()}${unit.slice(1)}`;
}

/**
 * "Fantasy points per target" -> "PPR points per target": a metric label
 * carries the format it was computed in (audit WEB-031). Labels that name no
 * fantasy figure pass through.
 */
export function formatMetricLabel(label: string, format: ScoringFormat): string {
  return label.replace(/^Fantasy points per /, `${SCORING_LABELS[format]} points per `);
}
