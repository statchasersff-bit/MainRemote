/**
 * The per-backup rules around the three pillars: the role score and committee
 * read, the workload a backup would inherit, the rank-based badge, and the
 * "why this rank" reasons and risk flags.
 *
 * Each MIRRORS the function of the same name in the standalone app's
 * server/scoring.ts or server/routes.ts. The legacy scores that file still
 * carried (opportunity, upside, bench pressure, confidence) fed nothing the
 * board shows, and were not brought over.
 */

import type { DataNorms, MergedRBData } from "./stats";

/** Min-max to 0–1, clamped. MIRRORS norm(). */
function norm(value: number | null | undefined, max: number, min = 0, fallback = 0.5): number {
  if (value == null || max <= min) return fallback;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

/** How much of his backfield a back runs, 0–100. MIRRORS computeRoleScoreCurrent(). */
export function computeRoleScoreCurrent(data: MergedRBData, n: DataNorms): number {
  const games = Math.max(data.games, 1);
  const rzPerGm = (data.rz_touches ?? data.rz_rush_att ?? 0) / games;
  const glPerGm = (data.goal_line_att ?? 0) / games;
  return Math.round(
    100 *
      (0.25 * norm(data.touches_per_gm, n.touches_per_gm, 0, 0) +
        0.2 * norm(data.snap_pct, n.snap_pct, 0, 0) +
        0.15 * norm(data.rush_att_per_gm, n.rush_att_per_gm, 0, 0) +
        0.1 * norm(data.targets_per_gm, n.targets_per_gm, 0, 0) +
        0.1 * norm(data.route_pct, n.route_pct, 0, 0) +
        0.1 * norm(rzPerGm, n.rz_per_gm, 0, 0) +
        0.05 * norm(glPerGm, n.goal_line_per_gm, 0, 0) +
        0.05 * norm(data.usage_role_score, 100, 0, 0)),
  );
}

/** Are the two backs splitting the work? MIRRORS detectCommittee(). */
export function detectCommittee(
  starterData: MergedRBData | null,
  backupData: MergedRBData | null,
  starterRoleScore: number,
  backupRoleScore: number,
  flagged = false,
): boolean {
  if (flagged) return true;
  if (!starterData || !backupData) return false;
  const starterTpg = starterData.touches_per_gm ?? 0;
  const backupTpg = backupData.touches_per_gm ?? 0;
  if (backupTpg < 7) return false;
  if (Math.abs(starterRoleScore - backupRoleScore) <= 20 && backupTpg >= 9) return true;
  if (starterTpg >= 10 && backupTpg / starterTpg >= 0.7) return true;
  return false;
}

/** The workload a backup inherits, from the starter's touches a game. MIRRORS touchesToWorkloadScore(). */
export function touchesToWorkloadScore(touchesPerGame: number): number {
  if (touchesPerGame <= 0) return 0;
  if (touchesPerGame >= 25) return 95;
  return Math.round((touchesPerGame / 25) * 95);
}

/** The curated and derived context the reasons read. */
export interface ReasonContext {
  workloadIfStarterOut: number;
  offenseQuality: number;
  roleClarity: number;
  talentBackup: number;
  oLine: number;
  /** The starter's rushing line this season, read by the efficiency flags below. */
  starterYpc: number | null;
  starterCarries: number | null;
  starterGames: number | null;
  /** Yards per carry with his longest run taken out - see ypcWithoutLongest(). */
  starterYpcWithoutLongest: number | null;
}

/*
 * When a starter's efficiency is allowed to speak (mak, 2026-10-08).
 *
 * The flags used to read yards per carry alone, with no floor: Saquon Barkley
 * came out "excelling" in week 4 on 36 carries at 5.06, where one 42-yard run
 * was the whole margin - take it out and the other 35 went 4.0 - while nine
 * carries a game said the Eagles were not feeding him at all. A back who is
 * excelling has a real sample, a lead back's share, and an average that
 * survives losing his best run. DIVERGES from the standalone app, which had
 * the bare 5.0 / 3.5 reads.
 *
 * 40 carries is the model's own trust threshold (FULL_TRUST in Player
 * Quality); 12 a game is roughly a lead back's share; 4.5 without the longest
 * run is where an efficient back still stands once his best play is set aside
 * (Hubbard 4.57 keeps the flag at 5.02; Barkley 4.0 and Gordon 3.39 lose it).
 */
export const STARTER_SAMPLE_CARRIES = 40;
export const STARTER_LEAD_CARRIES_PER_GAME = 12;
export const EXCELLING_YPC = 5.0;
export const EXCELLING_YPC_WITHOUT_LONGEST = 4.5;
export const POOR_YPC = 3.5;

/**
 * Yards per carry with the longest run removed: the outlier check. One
 * breakaway on a thin season is most of the average; the other carries are
 * the back. Null until there are two carries to compare.
 */
export function ypcWithoutLongest(
  carries: number | null | undefined,
  yards: number | null | undefined,
  longest: number | null | undefined,
): number | null {
  if (carries == null || yards == null || longest == null || carries < 2) return null;
  return Math.round(((yards - longest) / (carries - 1)) * 100) / 100;
}

/** Enough carries this season for his average to mean anything. */
function starterHasSample(ctx: ReasonContext): boolean {
  return ctx.starterCarries != null && ctx.starterCarries >= STARTER_SAMPLE_CARRIES;
}

/** Excelling: efficient on a real sample, at a lead back's share, and still efficient without his best run. */
export function starterIsExcelling(ctx: ReasonContext): boolean {
  if (ctx.starterYpc == null || ctx.starterYpc < EXCELLING_YPC) return false;
  if (!starterHasSample(ctx)) return false;
  if (ctx.starterGames == null || ctx.starterGames <= 0) return false;
  if (ctx.starterCarries! / ctx.starterGames < STARTER_LEAD_CARRIES_PER_GAME) return false;
  return ctx.starterYpcWithoutLongest != null && ctx.starterYpcWithoutLongest >= EXCELLING_YPC_WITHOUT_LONGEST;
}

/** Struggling: the same sample floor, so a handful of runs cannot call him inefficient either. */
export function starterIsStruggling(ctx: ReasonContext): boolean {
  return ctx.starterYpc != null && ctx.starterYpc < POOR_YPC && starterHasSample(ctx);
}

/** MIRRORS getTopReasons() (with no depth-chart disagreement signal to report). */
export function getTopReasons(
  ctx: ReasonContext,
  backupData: MergedRBData | null,
  committeeRisk: boolean,
): string[] {
  const reasons: string[] = [];
  if (ctx.workloadIfStarterOut >= 75) reasons.push("Would inherit a high-touch backfield if the starter misses time");
  if (ctx.offenseQuality >= 75) reasons.push("High-scoring offense creates consistent opportunity");
  if (ctx.roleClarity >= 75) reasons.push("Clear next-man-up on the depth chart");
  if (ctx.talentBackup >= 70 && !backupData) reasons.push("Above-average talent profile");
  if (ctx.oLine >= 70) reasons.push("Top-tier offensive line");
  if (starterIsStruggling(ctx)) reasons.push("Starter showing poor efficiency");
  if (backupData?.role_trend === "Rising Fast") reasons.push("Role is rising fast in recent weeks");
  if (backupData?.role_trend === "Trending Up") reasons.push("Trending upward in usage and snaps");
  if (backupData?.efficiency_score != null && backupData.efficiency_score >= 80) {
    reasons.push("Strong efficiency profile: high runner score and explosive run rate");
  }
  if (backupData?.targets_per_gm != null && backupData.targets_per_gm >= 3) {
    reasons.push("Already has standalone usage through targets and routes");
  }
  if (committeeRisk) reasons.push("Committee situation limits pure handcuff value but creates standalone upside");
  return reasons.slice(0, 4);
}

/** MIRRORS getRiskFlags() (with no depth-chart disagreement signal to report). */
export function getRiskFlags(
  ctx: ReasonContext,
  backupData: MergedRBData | null,
  committeeRisk: boolean,
): string[] {
  const flags: string[] = [];
  if (ctx.roleClarity < 45 || committeeRisk) flags.push("Committee risk");
  if (ctx.workloadIfStarterOut < 40) flags.push("Timeshare if starter out");
  if (ctx.oLine < 35) flags.push("Weak offensive line");
  if (ctx.offenseQuality < 35) flags.push("Poor offense");
  if (starterIsExcelling(ctx)) flags.push("Starter is excelling - low bench risk");
  if (backupData?.role_trend === "Trending Down" || backupData?.role_trend === "Falling Fast") {
    flags.push("Role trending downward");
  }
  if (backupData != null && (backupData.games ?? 0) < 5) flags.push("Limited sample size");
  return flags;
}

/**
 * The archetype, from where a backup ranks in the pool on each pillar. Top 8
 * and top 12, bottom 8, 12 and 24. MIRRORS getHandcuffBadge().
 */
export function getHandcuffBadge(
  playerQualityRank: number | null | undefined,
  pathToOpportunityRank: number | null | undefined,
  backfieldOpportunityRank: number | null | undefined,
  poolSize: number,
): string {
  const top8 = (r?: number | null) => r != null && r <= 8;
  const top12 = (r?: number | null) => r != null && r <= 12;
  const outside8 = (r?: number | null) => r != null && r >= 9;
  const outside12 = (r?: number | null) => r != null && r >= 13;
  const bottom8 = (r?: number | null) => r != null && r >= poolSize - 7;
  const bottom12 = (r?: number | null) => r != null && r >= poolSize - 11;
  const bottom24 = (r?: number | null) => r != null && r >= poolSize - 23;

  const pq = playerQualityRank;
  const path = pathToOpportunityRank;
  const bf = backfieldOpportunityRank;

  if (top8(pq) && top12(path) && top12(bf)) return "Premium Handcuff";
  if (top8(pq) && outside12(path) && top12(bf)) return "Premium Contingency";
  if (top12(pq) && outside8(path) && outside8(bf)) return "Talent Stash";
  if (outside8(pq) && !bottom12(pq) && top12(bf) && top12(path)) return "Opportunity Stash";
  if (bottom12(pq) && bottom12(path) && bottom12(bf)) return "Trap Handcuff";
  if (top12(bf) && top12(path) && bottom12(pq)) return "Low-Ceiling Backup";
  if (bottom8(bf) && bottom24(path)) return "Dead-Zone Handcuff";
  return "";
}

/** A pillar's rank band for one archetype, inclusive; null is "any rank". */
type Band = readonly [lo: number, hi: number] | null;

/**
 * The archetypes above as rank bands - Player Quality, Path to Opportunity,
 * Backfield Opportunity - in the same order, so a back who fits one exactly
 * gets the same answer from either function.
 */
function archetypeBands(n: number): Array<[label: string, bands: readonly [Band, Band, Band]]> {
  const top8: Band = [1, 8];
  const top12: Band = [1, 12];
  const outside8: Band = [9, n];
  const outside12: Band = [13, n];
  const bottom8: Band = [n - 7, n];
  const bottom12: Band = [n - 11, n];
  const bottom24: Band = [n - 23, n];
  return [
    ["Premium Handcuff", [top8, top12, top12]],
    ["Premium Contingency", [top8, outside12, top12]],
    ["Talent Stash", [top12, outside8, outside8]],
    ["Opportunity Stash", [[9, n - 12], top12, top12]],
    ["Trap Handcuff", [bottom12, bottom12, bottom12]],
    ["Low-Ceiling Backup", [bottom12, top12, top12]],
    ["Dead-Zone Handcuff", [null, bottom24, bottom8]],
  ];
}

/**
 * The badge for a back no archetype fits exactly: the closest one. Each
 * archetype is three rank bands; the back takes the one he misses by the
 * fewest places in total, the legend's order breaking ties. Two guards keep
 * the player-driven badges honest: the Premium badges need a top-12 Player
 * Quality and Talent Stash an upper-half one, so a mid-pack talent in a good
 * spot reads as an Opportunity Stash, not a premium piece. A back with no
 * rank on a pillar is left unbadged, as before.
 *
 * Only reached when getHandcuffBadge() returns "", so every exact fit keeps
 * its badge (mak, 2026-10-09: no backup should sit on the board without one).
 */
export function nearestHandcuffBadge(
  playerQualityRank: number | null | undefined,
  pathToOpportunityRank: number | null | undefined,
  backfieldOpportunityRank: number | null | undefined,
  poolSize: number,
): string {
  if (playerQualityRank == null || pathToOpportunityRank == null || backfieldOpportunityRank == null) return "";
  const ranks = [playerQualityRank, pathToOpportunityRank, backfieldOpportunityRank];
  const miss = (r: number, band: Band): number =>
    band == null ? 0 : r < band[0] ? band[0] - r : r > band[1] ? r - band[1] : 0;
  let best: { label: string; distance: number } | null = null;
  for (const [label, bands] of archetypeBands(poolSize)) {
    if (label.startsWith("Premium") && playerQualityRank > 12) continue;
    if (label === "Talent Stash" && playerQualityRank > Math.floor(poolSize / 2)) continue;
    const distance = bands.reduce((sum, band, i) => sum + miss(ranks[i]!, band), 0);
    if (!best || distance < best.distance) best = { label, distance };
  }
  return best?.label ?? "";
}
