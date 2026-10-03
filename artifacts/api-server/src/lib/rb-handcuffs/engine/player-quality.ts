/**
 * RB Player Quality - how good a back is as a PLAYER, independent of whether he
 * currently has the starting role. mak's mix, 2026-09-24:
 *
 *   30% Yards per carry
 *   30% Yards per reception
 *   10% Yards after contact per attempt
 *    5% Elude % (tackles eluded per touch)
 *    5% Fumble rate (fumbles per carry, lower is better)
 *   20% Explosiveness - the advanced stats table's grade
 *
 * Everything is ranked the way the advanced stats table ranks it
 * (lib/player-stats/scores): a percentile against qualified RBs (50+ carries
 * or 25+ targets), with every back scored on that curve, and Explosiveness is
 * the table's own grade for the same rows.
 *
 * A back with little opportunity is not taken at his word (mak, 2026-09-24):
 * if he is not getting touches, he is probably not that good, so one long
 * catch must not make him the best receiver on the board. Each part starts
 * from a below-average prior (25) and moves to his real percentile as his
 * sample grows: yards per reception by catches, fully trusted at 10 in the
 * six games; the rest by carries, fully trusted at 40. A back with no catches
 * is therefore a 25 on yards per reception.
 *
 * The rows are each back's last six games (engine/stats lastGames).
 */

import { computeRbCompositeScores, isQualifiedRb } from "../../player-stats/scores/rbCompositeScores";
import { percentileColumnAgainst, toFiniteNumber as num } from "../../player-stats/scores/percentiles";
import type { PlayerQualityResult, PlayerQualityCategoryScore } from "./types";

// Raw advanced-stats row (subset of columns the model reads). All fields are
// optional/nullable - missing data is handled safely and never crashes.
export interface RBStatRow {
  playerName?: string | null;
  player?: string | null;
  team?: string | null;
  position?: string | null;
  season?: number | null;
  games?: number | null;
  rushAttempts?: number | null;
  targets?: number | null;
  receptions?: number | null;
  routes?: number | null;
  rushYards?: number | null;
  yardsPerCarry?: number | null;
  receivingYards?: number | null;
  yardsPerReception?: number | null;
  fantasyPoints?: number | null;
  explosiveRunPct?: number | null;
  breakawayRunPct?: number | null;
  rushes10Plus?: number | null;
  rushes20Plus?: number | null;
  rushes30Plus?: number | null;
  longestRush?: number | null;
  longestRushTouchdown?: number | null;
  brokenTackles?: number | null;
  rushAttemptsPerBrokenTackle?: number | null;
  yardsAfterContactPerAttempt?: number | null;
  tackleEludedRate?: number | null;
  receivingYardsAfterCatch?: number | null;
  fumbles?: number | null;
  [key: string]: unknown;
}

export const PLAYER_QUALITY_WEIGHTS = {
  yardsPerCarry: 0.3,
  yardsPerReception: 0.3,
  yardsAfterContactPerAttempt: 0.1,
  tackleEludedRate: 0.05,
  fumbleRate: 0.05,
  explosiveness: 0.2,
} as const;

/**
 * The card's breakdown: the six parts in four rows, each row's weight the sum
 * of its parts'. Contact is yards after contact, elude % and fumbles.
 */
export const PLAYER_QUALITY_CATEGORY_WEIGHTS = {
  rushing: 0.3,
  receiving: 0.3,
  contact: 0.2,
  explosiveness: 0.2,
} as const;

/** Finite number or 0 (for counts / denominators). */
function n0(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

const clampScore = (v: number): number => Math.max(0, Math.min(100, v));

/** Where a back with no sample starts: a below-average back. */
export const LOW_OPPORTUNITY_PRIOR = 25;
/** The sample, in the six-game window, at which a part is fully trusted. */
export const FULL_TRUST = { carries: 40, catches: 10 } as const;

/** Linear 0–100 confidence ramp from sample size. */
function scaleSample(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= min) return 0;
  if (value >= max) return 100;
  return ((value - min) / (max - min)) * 100;
}

function isRB(r: RBStatRow): boolean {
  const p = typeof r.position === "string" ? r.position.toUpperCase() : null;
  return p == null || p === "RB";
}

/**
 * A part's percentile, weighed by the opportunity behind it: the prior at no
 * sample, his percentile at `full` and beyond, and a straight line between.
 */
function category(rawScore: number, sampleSize: number, full: number): PlayerQualityCategoryScore {
  const trust = full > 0 ? Math.max(0, Math.min(1, sampleSize / full)) : 1;
  return {
    score: Math.round(clampScore(LOW_OPPORTUNITY_PRIOR + (rawScore - LOW_OPPORTUNITY_PRIOR) * trust)),
    rawScore: Math.round(rawScore),
    sampleSize,
    confidence: Math.round(scaleSample(sampleSize, 0, full)),
  };
}

/** Fumbles per carry, as the table's Elusiveness grade reads it. No carries → 0. */
const fumbleRate = (r: RBStatRow): number => {
  const a = num(r.rushAttempts);
  return a > 0 ? num(r.fumbles) / a : 0;
};

/**
 * Player Quality for every RB row, ranked against the whole pool the way the
 * advanced stats table ranks a season. Pass the full pool, not a subset: the
 * scores are percentiles within it.
 *
 * `scale` is the share of a 17-game season the rows cover - 6/17 for the last
 * six games. The table's qualifier shrinks by it, as the table's does for a
 * season in progress, and so do the full-trust samples (FULL_TRUST is for the
 * six-game window; a full season would need 17/6 of it).
 */
export function scorePlayerQuality(rows: RBStatRow[], scale = 1): Map<RBStatRow, PlayerQualityResult> {
  const rbRows = rows.filter(isRB);
  const baseline = rbRows.filter((r) => isQualifiedRb(r, scale));
  const pcol = (get: (r: RBStatRow) => number, direction: "higherIsBetter" | "lowerIsBetter" = "higherIsBetter") =>
    percentileColumnAgainst<RBStatRow, RBStatRow>(rbRows, get, baseline, direction);
  const ypc = pcol((r) => num(r.yardsPerCarry));
  const ypr = pcol((r) => num(r.yardsPerReception));
  const yac = pcol((r) => num(r.yardsAfterContactPerAttempt));
  const elude = pcol((r) => num(r.tackleEludedRate));
  const fumbles = pcol(fumbleRate, "lowerIsBetter");
  const grades = computeRbCompositeScores(rbRows, { scale });
  const full = (n: number): number => n * Math.min(1, scale);
  const trusted = (n: number): number => (n * scale * 17) / 6;
  const out = new Map<RBStatRow, PlayerQualityResult>();
  const w = PLAYER_QUALITY_WEIGHTS;
  const cw = PLAYER_QUALITY_CATEGORY_WEIGHTS;

  rbRows.forEach((r, i) => {
    const rushAttempts = n0(r.rushAttempts);
    const receptions = n0(r.receptions);
    const targets = n0(r.targets);
    const totalOpp = rushAttempts + targets;

    const contactRaw =
      (w.yardsAfterContactPerAttempt * yac[i]! + w.tackleEludedRate * elude[i]! + w.fumbleRate * fumbles[i]!) /
      cw.contact;
    const carriesFull = trusted(FULL_TRUST.carries);
    const rushing = category(ypc[i]!, rushAttempts, carriesFull);
    const receiving = category(ypr[i]!, receptions, trusted(FULL_TRUST.catches));
    const contact = category(contactRaw, rushAttempts, carriesFull);
    const explosiveness = category(grades[i]!.explosivenessScore, rushAttempts, carriesFull);

    const playerQualityRaw =
      cw.rushing * rushing.score +
      cw.receiving * receiving.score +
      cw.contact * contact.score +
      cw.explosiveness * explosiveness.score;

    const score = clampScore(playerQualityRaw);
    const confidence = Math.round(
      cw.rushing * rushing.confidence +
        cw.receiving * receiving.confidence +
        cw.contact * contact.confidence +
        cw.explosiveness * explosiveness.confidence,
    );

    const flags: string[] = [];
    if (rushAttempts < full(25)) flags.push("limited_rushing_sample");
    if (rushAttempts === 0) flags.push("no_rushing_attempts");
    if (receptions === 0) flags.push("no_receptions");
    if (totalOpp < full(25)) flags.push("limited_sample");
    if (rushAttempts < carriesFull || receptions < trusted(FULL_TRUST.catches)) flags.push("score_weighed_by_opportunity");
    if (r.yardsAfterContactPerAttempt == null) flags.push("missing_yards_after_contact");

    out.set(r, {
      score: Math.round(score),
      rawScore: Math.round(playerQualityRaw),
      confidence,
      source: totalOpp > 0 ? "stat" : "fallback",
      flags,
      categories: { rushing, receiving, contact, explosiveness },
    });
  });
  return out;
}
