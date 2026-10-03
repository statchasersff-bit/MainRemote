/**
 * Path to Opportunity - how likely the BACKUP is to gain meaningful touches.
 *
 * Higher score = better path for the backup. The score estimates opportunity
 * risk created by the STARTER (aging, durability concerns, heavy workload,
 * already sharing usage, or weaker Player Quality) plus how much of a role the
 * backup has already carved out.
 *
 * Final formula (all components 0–100):
 *   25% Starter Durability History Risk
 *   20% Starter Workload Stress
 *   10% Starter Age Risk
 *   25% Backup Usage Ratio
 *   20% Starter Quality Vulnerability
 *
 * This model is built fresh from available data. It does NOT use, fall back to,
 * or reintroduce the deleted `injuryRiskStarter` field - Starter Durability
 * History Risk is computed directly from games-missed / workload / age inputs.
 *
 * Backup Player Quality is intentionally NOT part of this score; it is handled
 * separately by the Player Quality model.
 */

import { clamp, scale, weightedAverage } from "./math";
import type { PathToOpportunityResult } from "./types";

export type { PathToOpportunityResult };

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/**
 * Where `value` sits among `pool`, 0–100: the pool's lowest scores 0, its
 * highest 100, ties share the middle of their places. The pool includes the
 * value itself. A pool of one (or none) says nothing: 50.
 */
export function poolPercentile(value: number, pool: number[]): number {
  const vals = pool.filter((v) => Number.isFinite(v));
  if (vals.length < 2) return 50;
  let below = 0;
  let equal = 0;
  for (const v of vals) {
    if (v < value) below++;
    else if (v === value) equal++;
  }
  const place = below + Math.max(0, equal - 1) / 2;
  return clamp((place / (vals.length - 1)) * 100);
}

/** Pull a score toward `mean` in proportion to how little we trust it (0–100 confidence). */
export function shrinkByConfidence(score: number, confidence: number, mean = 50): number {
  const trust = Math.max(0, Math.min(1, confidence / 100));
  return mean * (1 - trust) + score * trust;
}

/** RB-specific age curve. Older starter → higher risk → better path for the backup. */
export function getRbAgeRisk(age?: number | null): number {
  if (age == null || !Number.isFinite(age)) return 50;
  if (age <= 23) return 12;
  if (age === 24) return 18;
  if (age === 25) return 28;
  if (age === 26) return 40;
  if (age === 27) return 52;
  if (age === 28) return 64;
  if (age === 29) return 76;
  if (age === 30) return 86;
  if (age === 31) return 93;
  return 100;
}

/** Maps a fresh injury/practice status string to a 0–100 short-term risk. */
const CURRENT_STATUS_RISK_MAP: Record<string, number> = {
  healthy: 0,
  none: 0,
  rest: 5,
  limited: 25,
  questionable: 45,
  doubtful: 75,
  out: 90,
  ir: 100,
  pup: 100,
  nfi: 100,
};

function currentStatusRisk(status?: string | null): number | null {
  if (status == null) return null;
  const key = status.toString().trim().toLowerCase();
  if (!key) return null;
  return key in CURRENT_STATUS_RISK_MAP ? CURRENT_STATUS_RISK_MAP[key] : null;
}

// ---------------------------------------------------------------------------
// Usage Score (shared by starter and backup) - 0–100 per side
// ---------------------------------------------------------------------------

export interface UsageInput {
  touchesPerGame?: number | null;
  snapPct?: number | null;
  routesPerGame?: number | null;
  targetsPerGame?: number | null;
  rzPerGame?: number | null;
}

/** Each component normalized to 0–100, then weighted-blended over what's present. */
const USAGE_WEIGHTS = {
  touchesPerGame: 0.35,
  snapPct: 0.25,
  routesPerGame: 0.20,
  targetsPerGame: 0.10,
  rzPerGame: 0.10,
} as const;

/**
 * Weighted-average usage score (0–100). Missing components are dropped and the
 * remaining weights renormalized. Returns null when nothing usable is present.
 */
export function computeUsageScore(u: UsageInput | null | undefined): number | null {
  if (!u) return null;
  const parts: Array<{ value: number; weight: number }> = [];
  const push = (raw: number | null | undefined, max: number, weight: number) => {
    if (raw == null || !Number.isFinite(raw)) return;
    parts.push({ value: scale(raw, 0, max), weight });
  };
  push(u.touchesPerGame, 25, USAGE_WEIGHTS.touchesPerGame);
  push(u.snapPct, 100, USAGE_WEIGHTS.snapPct);
  push(u.routesPerGame, 30, USAGE_WEIGHTS.routesPerGame);
  push(u.targetsPerGame, 8, USAGE_WEIGHTS.targetsPerGame);
  push(u.rzPerGame, 4, USAGE_WEIGHTS.rzPerGame);
  if (!parts.length) return null;
  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  return clamp(parts.reduce((s, p) => s + p.value * p.weight, 0) / totalWeight);
}

// ---------------------------------------------------------------------------
// Inputs & result shape
// ---------------------------------------------------------------------------

/**
 * The backup's share of the pair's usage, 0–1: his usage score over both. With
 * no starter usage the starter counts as a full bellcow (100), so the share is
 * not overstated. Null when the backup has no usage.
 */
export function computeBackupUsageShare(
  starter: UsageInput | null | undefined,
  backup: UsageInput | null | undefined,
): number | null {
  const b = computeUsageScore(backup);
  if (b == null) return null;
  const s = computeUsageScore(starter) ?? 100;
  return b / Math.max(s + b, 1);
}

export interface PathToOpportunityInput {
  // --- Durability (missed games by period) ---
  // Blended 2025 30% / 2024 20% / all other years 50%. Absent periods drop out
  // and the remaining weights renormalize over whatever is present.
  /** Games played in the most-recent season (2025) - weighted 30%. */
  starterGamesPlayed?: number | null;
  /** Games possible in 2025 (default 17 for a completed regular season). */
  starterGamesPossible?: number | null;
  /** Prior season (2024) games played - weighted 20% when present. */
  starterGamesPlayedPrev?: number | null;
  starterGamesPossiblePrev?: number | null;
  // --- Durability (all other years: career excluding 2025 + 2024) - weighted 50% ---
  /** Games missed across every season OTHER than 2025 and 2024. */
  priorGamesMissed?: number | null;
  /** Games possible across those same other seasons. */
  priorGamesPossible?: number | null;
  // --- Durability (current injury/practice status) ---
  currentStatus?: string | null;
  /** Only honored when the status is fresh; stale status is ignored + flagged. */
  currentStatusFresh?: boolean;

  // --- Workload ---
  starterTouchesPerGame?: number | null;
  /**
   * Every board starter's touches per game. When given, workload stress is his
   * place among them (the heaviest-worked starter 100, the lightest 0) instead
   * of a fixed 10–25 touch scale (mak, 2026-09-24).
   */
  starterWorkloadPool?: number[] | null;

  // --- Age ---
  starterAge?: number | null;

  // --- Backup usage ratio ---
  starterUsage?: UsageInput | null;
  backupUsage?: UsageInput | null;
  isCommittee?: boolean;
  /**
   * Every board backup's share of his two-back usage (see backupUsageShare).
   * When given, the usage ratio is his place among them instead of a fixed
   * 15–45% scale.
   */
  backupSharePool?: number[] | null;

  // --- Starter quality vulnerability ---
  starterPlayerQuality?: number | null;
  starterPlayerQualityConfidence?: number | null;

  // --- Manual override ---
  /**
   * Manual override for the Starter Durability History Risk component (0–100).
   * When set, it replaces the computed games-history score verbatim and is
   * treated as real signal (no "missing history" fallback).
   */
  starterDurabilityHistoryRiskOverride?: number | null;
}

export type PathToOpportunityConfidenceLabel = "High" | "Medium" | "Low" | "Very Low";

export function pathToOpportunityConfidenceLabel(v: number): PathToOpportunityConfidenceLabel {
  if (v >= 80) return "High";
  if (v >= 55) return "Medium";
  if (v >= 30) return "Low";
  return "Very Low";
}

export type PathToOpportunityBucket =
  | "Clear Path"
  | "Strong Path"
  | "Moderate Path"
  | "Thin Path"
  | "Blocked Path";

export function pathToOpportunityBucket(v: number): PathToOpportunityBucket {
  if (v >= 75) return "Clear Path";
  if (v >= 60) return "Strong Path";
  if (v >= 45) return "Moderate Path";
  if (v >= 30) return "Thin Path";
  return "Blocked Path";
}

// ---------------------------------------------------------------------------
// 1. Starter Durability History Risk - 25%
// ---------------------------------------------------------------------------

interface DurabilityResult {
  score: number;
  confidence: number;
  recentMissedGamesRisk: number | null;       // 2025 single-season risk
  priorSeasonMissedGamesRisk: number | null;   // 2024 single-season risk
  careerMissedGamesRisk: number | null;        // all other years (career excl. 2025/2024)
  currentStatusRisk: number | null;
  flags: string[];
}

function missedPct(played: number | null | undefined, possible: number | null | undefined): number | null {
  if (played == null || !Number.isFinite(played)) return null;
  const poss = possible != null && Number.isFinite(possible) && possible > 0 ? possible : 17;
  return Math.max(0, poss - played) / Math.max(poss, 1);
}

function computeDurabilityHistoryRisk(input: PathToOpportunityInput): DurabilityResult {
  const flags: string[] = [];

  // Manual override - replaces the computed history score verbatim and counts as
  // real signal (high confidence, no "missing history" fallback).
  const ovr = input.starterDurabilityHistoryRiskOverride;
  if (ovr != null && Number.isFinite(ovr)) {
    return {
      score: clamp(ovr),
      confidence: 75,
      recentMissedGamesRisk: null,
      priorSeasonMissedGamesRisk: null,
      careerMissedGamesRisk: null,
      currentStatusRisk: null,
      flags,
    };
  }

  // Per-period missed-game rate → 0–100 risk.
  //  • 2025 and 2024 are single seasons → scaled over a 0–35% missed range
  //    (a single season can spike all the way to a full year out).
  //  • "All other years" is a multi-season average → scaled over a tighter
  //    0–25% range (career rates smooth out, so a high one is a stronger signal).
  const pct2025 = missedPct(input.starterGamesPlayed, input.starterGamesPossible);
  const pct2024 = missedPct(input.starterGamesPlayedPrev, input.starterGamesPossiblePrev);
  const priorPct =
    input.priorGamesMissed != null &&
    Number.isFinite(input.priorGamesMissed) &&
    input.priorGamesPossible != null &&
    Number.isFinite(input.priorGamesPossible) &&
    input.priorGamesPossible > 0
      ? input.priorGamesMissed / input.priorGamesPossible
      : null;

  const risk2025 = pct2025 != null ? scale(pct2025 * 100, 0, 35) : null;
  const risk2024 = pct2024 != null ? scale(pct2024 * 100, 0, 35) : null;
  const riskPrior = priorPct != null ? scale(priorPct * 100, 0, 25) : null;

  // Period weighting (mak, 2026-09-24): this season so far 20%, last season
  // 60%, career before that 20%. ("2025"/"2024" in the names are the app's:
  // they are the current and previous seasons.) Absent periods drop out and
  // the remaining weights renormalize over whatever is present.
  const periods = (
    [
      { risk: risk2025, weight: 0.2 },
      { risk: risk2024, weight: 0.6 },
      { risk: riskPrior, weight: 0.2 },
    ] as Array<{ risk: number | null; weight: number }>
  ).filter((p): p is { risk: number; weight: number } => p.risk != null);

  // Current injury/status risk - only honored when fresh.
  let statusRisk: number | null = null;
  const rawStatusRisk = currentStatusRisk(input.currentStatus);
  if (rawStatusRisk != null) {
    if (input.currentStatusFresh) {
      statusRisk = rawStatusRisk;
    } else {
      flags.push("stale_starter_status");
    }
  }

  let score: number;
  let confidence: number;

  if (periods.length) {
    const totalWeight = periods.reduce((s, p) => s + p.weight, 0);
    const historyScore = periods.reduce((s, p) => s + p.risk * p.weight, 0) / totalWeight;

    if (statusRisk != null) {
      // Fold fresh status in as a modest 15% overlay on top of the games history.
      score = 0.85 * historyScore + 0.15 * statusRisk;
    } else {
      score = historyScore;
    }
    // Confidence tracks how much of the 30/20/50 history is actually present
    // (full history → 75; a single 50%-weight period → 55).
    confidence = 35 + totalWeight * 40;
    if (statusRisk != null) confidence = Math.min(confidence + 5, 80);
  } else if (statusRisk != null) {
    score = statusRisk;
    confidence = 35;
  } else {
    score = 50;
    confidence = 15;
    flags.push("missing_starter_durability_history");
  }

  return {
    score: clamp(score),
    confidence: Math.round(confidence),
    recentMissedGamesRisk: risk2025 != null ? clamp(risk2025) : null,
    priorSeasonMissedGamesRisk: risk2024 != null ? clamp(risk2024) : null,
    careerMissedGamesRisk: riskPrior != null ? clamp(riskPrior) : null,
    currentStatusRisk: statusRisk != null ? clamp(statusRisk) : null,
    flags,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function computePathToOpportunity(input: PathToOpportunityInput): PathToOpportunityResult {
  const flags: string[] = [];

  // --- 1. Starter Durability History Risk (25%) ---
  const durability = computeDurabilityHistoryRisk(input);
  flags.push(...durability.flags);
  const durabilityFellBack = durability.flags.includes("missing_starter_durability_history");

  // --- 2. Starter Workload Stress (20%) ---
  const tpg = input.starterTouchesPerGame;
  let workloadStress: number;
  let workloadConfidence: number;
  let workloadFellBack = false;
  if (tpg != null && Number.isFinite(tpg)) {
    workloadStress = input.starterWorkloadPool?.length
      ? poolPercentile(tpg, input.starterWorkloadPool)
      : scale(tpg, 10, 25);
    workloadConfidence = 80;
    if (tpg >= 22) flags.push("high_starter_workload");
    if (tpg >= 25) flags.push("extreme_starter_workload");
  } else {
    workloadStress = 50;
    workloadConfidence = 15;
    workloadFellBack = true;
    flags.push("missing_starter_workload");
  }

  // --- 3. Starter Age Risk (10%) ---
  const age = input.starterAge;
  const hasAge = age != null && Number.isFinite(age);
  const ageRisk = getRbAgeRisk(age);
  let ageConfidence: number;
  if (hasAge) {
    ageConfidence = 90;
    if (age! >= 28) flags.push("older_starter");
    if (age! >= 30) flags.push("age_cliff_starter");
  } else {
    ageConfidence = 15;
    flags.push("missing_starter_age");
  }

  // --- 4. Backup Usage Ratio (25%) ---
  const starterUsageScore = computeUsageScore(input.starterUsage);
  const backupUsageScore = computeUsageScore(input.backupUsage);
  let backupUsageRatioScore: number;
  const backupUsageShare = computeBackupUsageShare(input.starterUsage, input.backupUsage);
  const shareScore = (share: number): number =>
    input.backupSharePool?.length ? poolPercentile(share, input.backupSharePool) : scale(share, 0.15, 0.45);
  let usageConfidence: number;
  let usageFellBack = false;
  if (backupUsageShare != null && starterUsageScore != null) {
    backupUsageRatioScore = shareScore(backupUsageShare);
    usageConfidence = 75;
  } else if (backupUsageShare != null) {
    // Only the backup side has usage data - treat the starter as a full bellcow so
    // the backup's share isn't overstated, but flag the reduced confidence.
    backupUsageRatioScore = shareScore(backupUsageShare);
    usageConfidence = 45;
    flags.push("partial_usage_data");
  } else {
    backupUsageRatioScore = 50;
    usageConfidence = 15;
    usageFellBack = true;
    flags.push("missing_usage_ratio");
  }

  if (input.isCommittee) {
    backupUsageRatioScore = Math.max(backupUsageRatioScore, 65);
    flags.push("committee_usage_detected");
  }
  if (backupUsageRatioScore >= 65) {
    flags.push("backup_already_has_role");
  }

  // --- 5. Starter Quality Vulnerability (20%) ---
  const spq = input.starterPlayerQuality;
  const spqConf = input.starterPlayerQualityConfidence;
  let starterQualityVulnerability: number;
  let qualityConfidence: number;
  let qualityFellBack = false;
  if (spq != null && Number.isFinite(spq)) {
    const inverted = 100 - spq;
    if (spqConf != null && Number.isFinite(spqConf)) {
      starterQualityVulnerability = shrinkByConfidence(inverted, spqConf, 50);
      qualityConfidence = clamp(spqConf);
      if (spqConf < 40) flags.push("low_starter_quality_confidence");
    } else {
      starterQualityVulnerability = inverted;
      qualityConfidence = 50;
    }
  } else {
    starterQualityVulnerability = 50;
    qualityConfidence = 15;
    qualityFellBack = true;
    flags.push("missing_starter_player_quality");
  }
  starterQualityVulnerability = clamp(starterQualityVulnerability);

  // --- Final blend ---
  // Components with no real data are DROPPED and their weight redistributed across
  // the rest (rather than diluting the score with a neutral 50). A committee read
  // counts as real usage signal even when raw usage was missing. With nothing left
  // to blend, the score falls back to a neutral 50.
  const usageHasData = !usageFellBack || !!input.isCommittee;
  const rawScore = weightedAverage(
    [
      { value: durabilityFellBack ? null : durability.score, weight: 0.25 },
      { value: workloadFellBack ? null : workloadStress, weight: 0.20 },
      { value: hasAge ? ageRisk : null, weight: 0.10 },
      { value: usageHasData ? backupUsageRatioScore : null, weight: 0.25 },
      { value: qualityFellBack ? null : starterQualityVulnerability, weight: 0.20 },
    ],
    50,
  );
  const score = Math.round(clamp(rawScore));

  // --- Confidence ---
  const confidence = Math.round(
    0.25 * durability.confidence +
      0.20 * workloadConfidence +
      0.10 * ageConfidence +
      0.25 * usageConfidence +
      0.20 * qualityConfidence,
  );

  // --- Source ---
  const fellBack = [
    durabilityFellBack,
    workloadFellBack,
    !hasAge,
    usageFellBack,
    qualityFellBack,
  ];
  const fallbackCount = fellBack.filter(Boolean).length;
  const source: "stat" | "mixed" | "fallback" =
    fallbackCount === fellBack.length ? "fallback" : fallbackCount === 0 ? "stat" : "mixed";

  return {
    score,
    rawScore: Math.round(rawScore),
    confidence,
    source,
    flags,
    components: {
      starterDurabilityHistoryRisk: {
        score: Math.round(durability.score),
        recentMissedGamesRisk:
          durability.recentMissedGamesRisk != null ? Math.round(durability.recentMissedGamesRisk) : null,
        priorSeasonMissedGamesRisk:
          durability.priorSeasonMissedGamesRisk != null ? Math.round(durability.priorSeasonMissedGamesRisk) : null,
        careerMissedGamesRisk:
          durability.careerMissedGamesRisk != null ? Math.round(durability.careerMissedGamesRisk) : null,
        currentStatusRisk:
          durability.currentStatusRisk != null ? Math.round(durability.currentStatusRisk) : null,
      },
      starterWorkloadStress: {
        score: Math.round(workloadStress),
        starterTouchesPerGame: tpg != null && Number.isFinite(tpg) ? tpg : null,
      },
      starterAgeRisk: {
        score: Math.round(ageRisk),
        age: hasAge ? age! : null,
      },
      backupUsageRatio: {
        score: Math.round(backupUsageRatioScore),
        backupUsageShare: backupUsageShare != null ? backupUsageShare : null,
        starterUsageScore: starterUsageScore != null ? Math.round(starterUsageScore) : null,
        backupUsageScore: backupUsageScore != null ? Math.round(backupUsageScore) : null,
      },
      starterQualityVulnerability: {
        score: Math.round(starterQualityVulnerability),
        starterPlayerQuality: spq != null && Number.isFinite(spq) ? spq : null,
        starterPlayerQualityConfidence: spqConf != null && Number.isFinite(spqConf) ? spqConf : null,
      },
    },
  };
}

/** Human-readable top drivers for the UI (highest-signal components first). */
export function pathToOpportunityTopDrivers(result: PathToOpportunityResult): string[] {
  const c = result.components;
  const f = result.flags;
  // A component that fell back to its neutral default has no real signal, so it
  // must not surface as a driver (e.g. a rookie's missing usage sitting at 50).
  const drivers: Array<{ text: string; weightedScore: number; missing: boolean }> = [
    { text: "Starter has elevated durability risk", weightedScore: 0.25 * c.starterDurabilityHistoryRisk.score, missing: f.includes("missing_starter_durability_history") },
    { text: "Starter has heavy workload", weightedScore: 0.20 * c.starterWorkloadStress.score, missing: f.includes("missing_starter_workload") },
    { text: "Starter is near RB age cliff", weightedScore: 0.15 * c.starterAgeRisk.score, missing: f.includes("missing_starter_age") },
    { text: "Backup already has meaningful role", weightedScore: 0.25 * c.backupUsageRatio.score, missing: f.includes("missing_usage_ratio") && !f.includes("committee_usage_detected") },
    { text: "Starter Player Quality is below average", weightedScore: 0.15 * c.starterQualityVulnerability.score, missing: f.includes("missing_starter_player_quality") },
  ];
  return drivers
    .filter((d) => !d.missing && d.weightedScore >= 0.15 * 55) // only surface real components pulling the score up
    .sort((a, b) => b.weightedScore - a.weightedScore)
    .slice(0, 3)
    .map((d) => d.text);
}
