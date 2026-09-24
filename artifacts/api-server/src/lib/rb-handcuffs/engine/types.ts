/**
 * The engine's result shapes, from the standalone app's shared/schema.ts;
 * Player Quality's categories were redrawn on 2026-09-24. They are also what the renderer reads off each player.
 */

export type PlayerQualitySource = "stat" | "fallback";

export interface ComponentRank {
  rank: number;
  poolSize: number;
}

export interface PlayerQualityCategoryScore {
  score: number;               // 0–100, weighed by opportunity (toward 25 on a small sample)
  rawScore: number;            // 0–100, the plain percentile
  sampleSize: number;
  confidence: number;          // 0–100
}

export interface PlayerQualityResult {
  score: number;               // final 0–100 Player Quality (percentile-based, NOT pool-stretched)
  rawScore: number;            // blended category score before final shrinkage
  confidence: number;          // 0–100
  source: PlayerQualitySource;
  flags: string[];
  categories: {
    rushing: PlayerQualityCategoryScore;       // yards per carry
    receiving: PlayerQualityCategoryScore;     // yards per reception
    contact: PlayerQualityCategoryScore;       // YAC/att, elude %, fumble rate
    explosiveness: PlayerQualityCategoryScore; // the stats table's grade
  };
}

// One metric inside the Backfield Volume score: the combined starter+backup
// per-game value, its percentile vs all backfields, and its weight in the blend.
export interface BackfieldVolumeComponent {
  perGame: number | null;    // combined starter + backup per-game value (snaps = summed snap %)
  percentile: number | null; // 0–100 percentile vs the qualified backfield pool
  weight: number;            // weight within the volume blend (0–1)
}

export interface BackfieldVolumeComponents {
  rushAttempts: BackfieldVolumeComponent; // backfield carries / game (30%)
  snapPct: BackfieldVolumeComponent;      // backfield snap % (20%)
  targets: BackfieldVolumeComponent;      // backfield targets / game (20%)
  redZone: BackfieldVolumeComponent;      // backfield red-zone opportunities / game (15%)
  goalLine: BackfieldVolumeComponent;     // backfield goal-line carries / game (10%)
  routes: BackfieldVolumeComponent;       // backfield routes / game (5%)
}

// ---------------------------------------------------------------------------
// Path to Opportunity — how likely the BACKUP is to gain meaningful touches.
// Built fresh from available data (starter durability history, workload, age,
// backup usage share, starter quality vulnerability). Does NOT use the deleted
// `injuryRiskStarter` field.
// ---------------------------------------------------------------------------

export interface PathToOpportunityResult {
  score: number;             // final 0–100 (higher = better path for the backup)
  rawScore: number;          // before rounding/clamping
  confidence: number;        // 0–100
  source: "stat" | "mixed" | "fallback";
  flags: string[];
  components: {
    starterDurabilityHistoryRisk: {
      score: number;
      recentMissedGamesRisk?: number | null;       // 2025 single-season risk
      priorSeasonMissedGamesRisk?: number | null;   // 2024 single-season risk
      careerMissedGamesRisk?: number | null;        // all other years (career excl. 2025/2024)
      currentStatusRisk?: number | null;
    };
    starterWorkloadStress: {
      score: number;
      starterTouchesPerGame?: number | null;
    };
    starterAgeRisk: {
      score: number;
      age?: number | null;
    };
    backupUsageRatio: {
      score: number;
      backupUsageShare?: number | null;
      starterUsageScore?: number | null;
      backupUsageScore?: number | null;
    };
    starterQualityVulnerability: {
      score: number;
      starterPlayerQuality?: number | null;
      starterPlayerQualityConfidence?: number | null;
    };
  };
}
