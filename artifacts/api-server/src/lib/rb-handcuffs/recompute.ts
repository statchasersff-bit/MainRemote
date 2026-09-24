/**
 * The handcuff score, recomputed from the scoring weights.
 *
 * Shared by the server, which renders the table at the default weights, and by
 * client/rb-handcuffs.ts, which re-ranks it when a reader changes them — so the
 * two produce identical numbers by construction rather than by keeping two
 * copies in step. Nothing here may import a Node module: esbuild inlines this
 * file into the browser bundle.
 *
 * Ported from `shared/handcuff-recompute.ts` in the standalone RB handcuffs app
 * (statchasersff-bit/Redraft-RB-Handcuff-Rankings), formula for formula. There
 * it mirrored `computeNewHandcuffScore` in the app's server; the snapshot in
 * data/rb-handcuffs/ was produced by that server, and the tests assert that
 * recomputing it at the default weights reproduces its scores and ranks
 * exactly.
 */

export interface HandcuffWeights {
  contingentUpsideWeight: number;
  pathToWorkloadWeight: number;
  playerQualityWeight: number;
  costWeight: number;
}

/**
 * The model's defaults: Backfield Opportunity 35%, Path to Opportunity 45%,
 * Player Quality 20%, and cost off. The standalone app shipped 15 / 25 / 60;
 * mak moved them on 2026-09-23. APP_WEIGHTS keeps the app's, for the test
 * that holds the engine to the board the app last published.
 */
export const DEFAULT_WEIGHTS: HandcuffWeights = {
  contingentUpsideWeight: 0.35,
  pathToWorkloadWeight: 0.45,
  playerQualityWeight: 0.2,
  costWeight: 0,
};

/** The standalone app's `defaultWeights`: what its published boards were scored at. */
export const APP_WEIGHTS: HandcuffWeights = {
  contingentUpsideWeight: 0.15,
  pathToWorkloadWeight: 0.25,
  playerQualityWeight: 0.6,
  costWeight: 0,
};

/**
 * The weight-independent inputs to the blend, as the snapshot carries them on
 * every player (`overallInputs`), plus the three displayed pillar scores a
 * pinned player re-blends from.
 */
export interface RecomputeInput {
  contingentUpside: number;
  pathToWorkload: number;
  playerQuality: number;
  cost: number | null;
  /** True when a displayed-percentile pin re-blends Overall. */
  pinned: boolean;
  shownContingentUpside: number | null;
  shownPathToOpportunity: number | null;
  shownPlayerQuality: number;
}

/** The weighted blend of the pillars. MIRRORS blendHandcuffScore(). */
export function blendHandcuffScore(
  contingentUpside: number,
  pathToWorkload: number,
  playerQuality: number,
  costScore: number | null,
  weights: HandcuffWeights,
): number {
  const cu = weights.contingentUpsideWeight;
  const pw = weights.pathToWorkloadWeight;
  const pq = weights.playerQualityWeight;
  const cw = weights.costWeight;

  if (costScore === null || cw === 0) {
    const base = cu + pw + pq;
    if (base === 0) return 0;
    return Math.round((cu * contingentUpside + pw * pathToWorkload + pq * playerQuality) / base);
  }
  const base = cu + pw + pq + cw;
  if (base === 0) return 0;
  return Math.round(
    (cu * contingentUpside + pw * pathToWorkload + pq * playerQuality + cw * costScore) / base,
  );
}

/**
 * Every player's score for these weights, in input order. MIRRORS
 * recomputeRankings():
 *
 *   1. a raw blend per player from the weight-independent inputs;
 *   2. the raw blend as a percentile of the pool — the displayed score;
 *   3. except for a pinned player, whose score is re-blended from the pillar
 *      percentiles the table displays.
 *
 * Ranking is left to the caller, which sorts by this and numbers the result.
 */
export function recomputeScores(
  items: readonly RecomputeInput[],
  weights: HandcuffWeights,
): number[] {
  const raw = items.map((p) =>
    blendHandcuffScore(p.contingentUpside, p.pathToWorkload, p.playerQuality, p.cost, weights),
  );

  // The mean of the strictly-less and less-or-equal counts, so a tie lands in
  // the middle of the band it shares rather than at either edge.
  const n = raw.length;
  const percentile = (v: number): number => {
    if (n === 0) return 0;
    let less = 0;
    let lessEqual = 0;
    for (const x of raw) {
      if (x < v) less += 1;
      if (x <= v) lessEqual += 1;
    }
    return Math.round(((less + lessEqual) / 2 / n) * 100);
  };

  return items.map((p, i) =>
    p.pinned
      ? blendHandcuffScore(
          p.shownContingentUpside ?? 40,
          p.shownPathToOpportunity ?? 50,
          p.shownPlayerQuality,
          p.cost,
          weights,
        )
      : percentile(raw[i]!),
  );
}

/**
 * The order the table ranks in: score, best first. A stable sort, so players
 * on the same score keep the order they came in — which for the server is the
 * snapshot's, and for the bundle is the order it read the rows in.
 */
export function rankOrder(scores: readonly number[]): number[] {
  return scores
    .map((score, index) => ({ score, index }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.index);
}
