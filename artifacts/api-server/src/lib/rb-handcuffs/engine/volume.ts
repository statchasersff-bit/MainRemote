/**
 * RB Backfield Volume Score — drives "Backfield Opportunity" (a.k.a. "Starter
 * Role Value").
 *
 * What it measures: the total RB opportunity an offense generated in 2025 — the
 * combined per-game workload of the team's two highest-usage RBs that season
 * (the 2025 starter + top backup by total touches, identified in
 * rb-data-service.getTeamBackfields, NOT the current depth chart) — ranked as a
 * percentile against every other team's backfield in the 2025 pool.
 *
 * Method (per the product spec):
 *   1. Combine starter + backup PER-GAME stats (sum) into one backfield value
 *      for each of six workload/opportunity metrics. Snap% is summed uncapped
 *      (it is a rate, so "per game" = the season value itself).
 *   2. Percentile-rank — never raw values. Each metric is ranked against the
 *      distribution of qualified backfields, so a score is always relative to
 *      the season, never an absolute number.
 *   3. Qualified backfields set the curve: combined rushAttempts >= 50 OR
 *      combined targets >= 25 (season totals). Tiny-sample rooms would
 *      otherwise distort the distribution. Everyone still gets a score; they're
 *      just measured against the qualified curve.
 *   4. Weighted blend of the six metric percentiles, then clamped to 0–100:
 *        Rush Attempts 30% | Snap % 20% | Targets 20%
 *        Red Zone Opp  15% | Goal Line 10% | Routes 5%
 *      (weighted toward pure rushing volume, so bellcow backfields land high
 *      and committee/receiving-only rooms land lower).
 *
 * This is a BACKFIELD-level (team's 2025 top-2 RBs) score, so it is computed in
 * routes.ts over the per-team backfields — not per individual RB record.
 */

import type { MergedRBData } from "./stats";
import type { BackfieldVolumeComponents } from "./types";

/** Weighting of the six workload/opportunity metrics. Sums to 1.0. */
const VOLUME_WEIGHTS = {
  rushAttempts: 0.30,
  snapPct: 0.20,
  targets: 0.20,
  redZone: 0.15,
  goalLine: 0.10,
  routes: 0.05,
} as const;

/** Season-total qualification thresholds that set the percentile curve. */
const QUAL_RUSH_ATTEMPTS = 50;
const QUAL_TARGETS = 25;

type MetricKey = keyof typeof VOLUME_WEIGHTS;
const METRIC_KEYS = Object.keys(VOLUME_WEIGHTS) as MetricKey[];

/** Combined per-game workload of a backfield, plus the season totals used for qualification. */
interface BackfieldMetrics {
  rushAttempts: number | null; // combined rush attempts / game
  snapPct: number | null; // combined snap % (summed, uncapped)
  targets: number | null; // combined targets / game
  redZone: number | null; // combined red-zone opportunities / game
  goalLine: number | null; // combined goal-line carries / game
  routes: number | null; // combined routes / game
  rushTotal: number | null; // combined season rush attempts (qualification)
  targetTotal: number | null; // combined season targets (qualification)
}

export interface BackfieldInput {
  /** Stable id this backfield is keyed by in the result map (e.g. team abbr). */
  id: string;
  starter: MergedRBData | null;
  backup: MergedRBData | null;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Sum two nullable values; null + null stays null, so a metric with no data anywhere is "unknown". */
function sumNullable(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

/** Extract one player's per-game metric values (and season totals) from their merged record. */
function perGame(r: MergedRBData | null) {
  if (!r) return null;
  const g = r.games > 0 ? r.games : 1;
  return {
    rushAttempts: r.rush_att_per_gm, // already per-game
    snapPct: r.snap_pct, // a rate — "per game" is the value itself
    targets: r.targets_per_gm, // already per-game
    redZone: r.rz_touches != null ? r.rz_touches / g : null, // total -> per-game
    goalLine: r.goal_line_att != null ? r.goal_line_att / g : null, // total -> per-game
    routes: r.routes_per_gm, // already per-game
    rushTotal: r.rush_att_per_gm != null ? r.rush_att_per_gm * g : null,
    targetTotal: r.targets_per_gm != null ? r.targets_per_gm * g : null,
  };
}

/** Combine a starter and backup into one backfield's per-game metrics (summed). */
function combineBackfield(starter: MergedRBData | null, backup: MergedRBData | null): BackfieldMetrics {
  const s = perGame(starter);
  const b = perGame(backup);
  return {
    rushAttempts: sumNullable(s?.rushAttempts ?? null, b?.rushAttempts ?? null),
    snapPct: sumNullable(s?.snapPct ?? null, b?.snapPct ?? null),
    targets: sumNullable(s?.targets ?? null, b?.targets ?? null),
    redZone: sumNullable(s?.redZone ?? null, b?.redZone ?? null),
    goalLine: sumNullable(s?.goalLine ?? null, b?.goalLine ?? null),
    routes: sumNullable(s?.routes ?? null, b?.routes ?? null),
    rushTotal: sumNullable(s?.rushTotal ?? null, b?.rushTotal ?? null),
    targetTotal: sumNullable(s?.targetTotal ?? null, b?.targetTotal ?? null),
  };
}

/** A backfield qualifies to set the curve if its combined season volume clears either threshold. */
function isQualified(m: BackfieldMetrics): boolean {
  return (m.rushTotal ?? 0) >= QUAL_RUSH_ATTEMPTS || (m.targetTotal ?? 0) >= QUAL_TARGETS;
}

/**
 * Mean-rank percentile of `value` within a sorted-ascending distribution.
 * Ties share the average of their ranks. Returns 0–100.
 */
function meanRankPercentile(sortedAsc: number[], value: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 50; // no curve to rank against — neutral
  let countLess = 0;
  let countLessEqual = 0;
  for (const v of sortedAsc) {
    if (v < value) countLess++;
    if (v <= value) countLessEqual++;
  }
  const rank = (countLess + countLessEqual) / 2;
  return (rank / n) * 100;
}

export interface BackfieldVolumeResult {
  score: number | null;
  components: BackfieldVolumeComponents;
}

/**
 * Compute the backfield Volume Score (0–100) for every input, with a per-metric
 * breakdown (combined per-game value + percentile + weight for each of the six
 * metrics) so the UI can show exactly what went into the score.
 *
 * The percentile curve is built from QUALIFIED backfields only, but every
 * backfield is scored against it. Metrics with no data anywhere in a backfield
 * are dropped and the remaining weights are renormalized, so a missing stat
 * doesn't drag the score to zero. `score` is null only when no metric has data.
 */
export function computeBackfieldVolumeScores(inputs: BackfieldInput[]): Map<string, BackfieldVolumeResult> {
  const metrics = inputs.map((i) => ({ id: i.id, m: combineBackfield(i.starter, i.backup) }));

  // Build the per-metric distributions from qualified backfields only.
  const distributions: Record<MetricKey, number[]> = {
    rushAttempts: [],
    snapPct: [],
    targets: [],
    redZone: [],
    goalLine: [],
    routes: [],
  };
  for (const { m } of metrics) {
    if (!isQualified(m)) continue;
    for (const key of METRIC_KEYS) {
      const v = m[key];
      if (v != null) distributions[key].push(v);
    }
  }
  for (const key of METRIC_KEYS) distributions[key].sort((a, b) => a - b);

  const result = new Map<string, BackfieldVolumeResult>();
  for (const { id, m } of metrics) {
    let weightedSum = 0;
    let weightUsed = 0;
    const components = {} as BackfieldVolumeComponents;
    for (const key of METRIC_KEYS) {
      const v = m[key];
      const pct = v == null ? null : meanRankPercentile(distributions[key], v);
      if (v != null && pct != null) {
        weightedSum += VOLUME_WEIGHTS[key] * pct; // unknown metrics excluded → renormalized
        weightUsed += VOLUME_WEIGHTS[key];
      }
      components[key] = {
        perGame: v,
        percentile: pct == null ? null : Math.round(pct),
        weight: VOLUME_WEIGHTS[key],
      };
    }
    result.set(id, {
      score: weightUsed > 0 ? Math.round(clamp(weightedSum / weightUsed, 0, 100)) : null,
      components,
    });
  }
  return result;
}
