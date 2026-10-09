/**
 * The board: every team's handcuff, scored and ranked.
 *
 * A port of the standalone app's GET /api/handcuffs (server/routes.ts), step
 * for step, as a pure function of its inputs. That route read a Postgres
 * roster, a six-hour cache of the stats and a scheduled depth-chart fetch;
 * here the caller hands over the parsed files and gets the ranked players
 * back. The order of operations matters and is the original's:
 *
 *   1. score every backup's three pillars on their raw scales;
 *   2. sort and rank; rank each pillar across the pool;
 *   3. give each backup his badge from those raw ranks;
 *   4. re-express every score as a percentile of the pool;
 *   5. apply any pinned Player Quality, re-blend that backup's score, re-rank.
 *
 * What is new is the point of running it here: the pairings come from this
 * week's depth chart rather than a snapshot; the starter's CURRENT injury
 * status and age feed Path to Opportunity (the model always had a slot for the
 * status - a fresh one is a 15% overlay on the durability history - and the
 * app never filled it); and the stats basis is the current season, with
 * Player Quality read off each back's last six games played (week 18
 * excluded), reaching back into the previous season, because two weeks of a
 * backup's touches measure his role but not his talent.
 */

import { blendHandcuffScore, DEFAULT_WEIGHTS, type HandcuffWeights } from "../recompute";
import { computeBackupUsageShare, computePathToOpportunity, pathToOpportunityTopDrivers, type UsageInput } from "./path";
import {
  canonicalTeam,
  computeNorms,
  getTeamBackfields,
  lookupRBData,
  lookupRBProfile,
  normalizeName,
  type MergedRBData,
  type PlayerInjuryData,
} from "./stats";
import { computeBackfieldVolumeScores } from "./volume";
import {
  ypcWithoutLongest,
  computeRoleScoreCurrent,
  detectCommittee,
  getHandcuffBadge,
  getRiskFlags,
  getTopReasons,
  touchesToWorkloadScore,
  type ReasonContext,
} from "./scoring";
import type {
  BackfieldVolumeComponents,
  ComponentRank,
  PathToOpportunityResult,
  PlayerQualityResult,
} from "./types";

/* ------------------------------------------------------------------ inputs */

/** One team's backfield this week: the starter and the handcuff behind him. */
export interface Pairing {
  team: string;
  starter: string | null;
  backup: string;
}

/** What Sleeper says about a back now. */
export interface CurrentInfo {
  age: number | null;
  injuryStatus: string | null;
}

/**
 * The hand-kept part of the model. Everything here was a column or an
 * override in the standalone app's database, and every per-player value is
 * tied to the pairing it was written for: a note that says "behind Kyren
 * Williams" is wrong the week he is behind somebody else, so it is only
 * applied while `starter` is still his starter. The two exceptions describe
 * the player alone: `talentBackup`, and a pinned Player Quality for a back
 * with no stats.
 */
export interface Curation {
  /** Team context the reasons read. 50 is "not rated". */
  teams: Record<string, { offenseQuality?: number; oLine?: number }>;
  players: Record<string, CuratedPlayer>;
  /** A hand correction to Ourlads: team → the starter and the handcuff. */
  depth?: Record<string, { rb1: string; rb2: string }>;
}

export interface CuratedPlayer {
  /** The starter everything below (bar the player-only fields) was written against. */
  starter?: string;
  roleClarity?: number;
  talentBackup?: number;
  notes?: string;
  /** A short editor's note, shown from an icon beside his name on the board. */
  statchasersNote?: string;
  handcuffType?: string;
  starterDurabilityHistoryRisk?: number;
  pathToOpportunityScore?: number | null;
  playerQualityScore?: number;
  playerQualityPercentile?: number;
}

export interface EngineInputs {
  /** The stats basis: the season every pillar is percentiled against. */
  stats: Map<string, MergedRBData>;
  /**
   * Games each team has played in the basis season: 17 for a finished one,
   * the count so far in season. A starter's missed games are measured
   * against it. Absent → 17, as the app assumed.
   */
  teamGames?: (team: string) => number;
  /**
   * The season before the basis. When given, it answers "games played last
   * season" (out of 17); otherwise that comes from the injury file's
   * `games_missed_prev`, as the app did.
   */
  previous?: Map<string, MergedRBData> | null;
  /**
   * Where Player Quality is read from, for the backup and the starter alike.
   * In season this is each back's last six games (see lastGames) - talent
   * carries over, role does not. Absent → `stats`,
   * as the app had it.
   */
  talent?: Map<string, MergedRBData> | null;
  /** Injury history, split at the season before the basis (see parseInjuries). */
  injuries: Map<string, PlayerInjuryData>;
  pairings: Pairing[];
  /** Keyed by normalizeName(). Absent → the 2025 file's age and no status. */
  current?: Map<string, CurrentInfo> | null;
  /** Whether `current`'s injury statuses are recent enough to count. */
  statusFresh?: boolean;
  curation: Curation;
  /** The pillar blend. Absent → DEFAULT_WEIGHTS, what the board is served at. */
  weights?: HandcuffWeights;
}

/* ------------------------------------------------------------------ output */

/** One ranked backup: what the renderer and the re-ranking read. */
export interface EnginePlayer {
  id: string;
  playerName: string;
  team: string;
  starterName: string | null;
  rank: number;
  handcuffScore: number;
  handcuffType: string;
  contingentUpsideScore: number | null;
  pathToOpportunityScore: number | null;
  pathToWorkloadScore: number | null;
  playerQualityScore: number;
  contingentUpsideRank: number | null;
  pathToOpportunityRank: number | null;
  playerQualityRank: number | null;
  poolSize: number;
  topReasons: string[];
  riskFlags: string[];
  committeeRisk: boolean;
  roleTrend: string | null;
  notes: string | null;
  statchasersNote: string | null;
  offenseQuality: number;
  starterTouchesPerGame: number | null;
  adpOrCost: number | null;
  rosteredPct: number | null;
  costScore: number | null;
  /** The starter's status on this week's report, when he has one. */
  starterInjuryStatus: string | null;
  overallInputs: {
    contingentUpside: number;
    pathToWorkload: number;
    playerQuality: number;
    cost: number | null;
    playerQualityPinned: boolean;
  };
  pathToOpportunityDetail: PathToOpportunityResult | null;
  backfieldVolumeComponents: BackfieldVolumeComponents | null;
  playerQualityDetail: PlayerQualityResult | null;
  pathComponentRanks: Record<string, ComponentRank> | null;
  backfieldComponentRanks: Record<string, ComponentRank> | null;
  playerQualityCategoryRanks: Record<string, number> | null;
  playerQualityCategoryPoolSize: number | null;
}

/* ----------------------------------------------------------------- helpers */

function toUsageInput(d: MergedRBData | null): UsageInput | null {
  if (!d) return null;
  const games = d.games > 0 ? d.games : 1;
  const touches = d.touches_per_gm ?? ((d.rush_att_per_gm ?? 0) + (d.targets_per_gm ?? 0) || null);
  return {
    touchesPerGame: touches,
    snapPct: d.snap_pct,
    routesPerGame: d.routes_per_gm,
    targetsPerGame: d.targets_per_gm,
    rzPerGame: d.rz_touches != null ? d.rz_touches / games : null,
  };
}

function starterTouchesPerGameOf(d: MergedRBData | null): number | null {
  return d?.touches_per_gm ?? ((d?.rush_att_per_gm ?? 0) + (d?.targets_per_gm ?? 0) || null);
}

/** A stable id: the team and the name. It is the card's address. */
export function playerId(team: string, name: string): string {
  return `${canonicalTeam(team).toLowerCase()}-${normalizeName(name).replace(/\s+/g, "-")}`;
}

function curatedFor(curation: Curation, name: string): CuratedPlayer | undefined {
  const exact = curation.players[name];
  if (exact) return exact;
  const key = normalizeName(name);
  for (const [n, c] of Object.entries(curation.players)) if (normalizeName(n) === key) return c;
  return undefined;
}

/** A per-pairing curated value, only while it describes this pairing. */
function samePairing(c: CuratedPlayer | undefined, starter: string | null): boolean {
  if (!c) return false;
  if (!c.starter) return true;
  return starter != null && normalizeName(c.starter) === normalizeName(starter);
}

/* -------------------------------------------------------------------- build */

export function buildBoard(inputs: EngineInputs): EnginePlayer[] {
  const { stats, injuries, curation } = inputs;
  const norms = computeNorms(stats);
  const current = inputs.current ?? null;
  const weights = inputs.weights ?? DEFAULT_WEIGHTS;

  // Backfield Opportunity is team-level: the 2025 top-two backs' combined
  // volume, percentiled across the league. Every backup on a team shares it.
  const backfields = getTeamBackfields(stats);
  const volumeByTeam = computeBackfieldVolumeScores(
    Array.from(backfields.entries()).map(([team, bf]) => ({ id: team, starter: bf.starter, backup: bf.backup })),
  );

  // Workload stress and the backup's usage share are places among the board's
  // own starters and backups (mak, 2026-09-24), so both pools are gathered
  // before any pairing is scored. Workload is read off the starter's last six
  // games (the talent rows, week 18 excluded), like his Player Quality: two
  // weeks of this season alone are one game script away from anything.
  const starterWorkloadPool: number[] = [];
  const backupSharePool: number[] = [];
  for (const pair of inputs.pairings) {
    const starterName = pair.starter;
    const backupData = lookupRBData(stats, pair.backup, pair.team);
    const starterData = starterName ? lookupRBData(stats, starterName, pair.team) : null;
    const starterProfile = starterName ? lookupRBProfile(stats, starterName, pair.team) : null;
    const starterWindow =
      inputs.talent && starterName ? lookupRBProfile(inputs.talent, starterName, pair.team) : starterProfile;
    const tpg = starterTouchesPerGameOf(starterWindow);
    if (tpg != null) starterWorkloadPool.push(tpg);
    const share = computeBackupUsageShare(toUsageInput(starterData), toUsageInput(backupData));
    if (share != null) backupSharePool.push(share);
  }

  const scored: EnginePlayer[] = inputs.pairings.map((pair) => {
    const name = pair.backup;
    const team = pair.team;
    const starterName = pair.starter;
    const curated = curatedFor(curation, name);
    const paired = samePairing(curated, starterName);
    const override = paired ? curated : undefined;

    const backupData = lookupRBData(stats, name, team);
    const starterData = starterName ? lookupRBData(stats, starterName, team) : null;
    const starterProfile = starterName ? lookupRBProfile(stats, starterName, team) : null;
    const talent = inputs.talent ?? null;
    const backupTalent = talent ? lookupRBProfile(talent, name, team) : backupData;
    const starterTalent = talent && starterName ? lookupRBProfile(talent, starterName, team) : starterProfile;

    const roleScoreCurrent = backupData ? computeRoleScoreCurrent(backupData, norms) : null;
    const starterRoleScore = starterData ? computeRoleScoreCurrent(starterData, norms) : 70;
    const committeeRisk = detectCommittee(starterData, backupData, starterRoleScore, roleScoreCurrent ?? 30);

    const backfieldVolume = volumeByTeam.get(canonicalTeam(team)) ?? null;
    const contingentUpsideScore = backfieldVolume?.score ?? null;

    const starterNow = starterName ? current?.get(normalizeName(starterName)) ?? null : null;
    const possible = inputs.teamGames ? inputs.teamGames(canonicalTeam(team)) : 17;
    const starterLast =
      starterName && inputs.previous ? lookupRBProfile(inputs.previous, starterName, team) : null;
    // A starter with no line this season but one last season has been on the
    // shelf: that is games missed, not missing data.
    const starterGames = starterProfile?.games ?? (starterLast ? 0 : null);
    const starterTouchesPerGame = starterTouchesPerGameOf(starterTalent);
    const starterInjury = starterName ? injuries.get(normalizeName(starterName)) ?? null : null;

    const pathComputed = computePathToOpportunity({
      starterGamesPlayed: starterGames,
      starterGamesPossible: starterGames != null ? Math.max(possible, starterGames) : null,
      starterGamesPlayedPrev: inputs.previous
        ? (starterLast?.games ?? null)
        : starterInjury
          ? Math.max(0, 17 - starterInjury.games_missed_prev)
          : null,
      starterGamesPossiblePrev: inputs.previous ? (starterLast ? 17 : null) : starterInjury ? 17 : null,
      priorGamesMissed: starterInjury?.games_missed_prior ?? null,
      priorGamesPossible: starterInjury?.games_possible_prior ?? null,
      currentStatus: starterNow?.injuryStatus ?? null,
      currentStatusFresh: inputs.statusFresh ?? false,
      starterTouchesPerGame,
      starterWorkloadPool,
      starterAge: starterNow?.age ?? starterProfile?.age ?? null,
      starterUsage: toUsageInput(starterData),
      backupUsage: toUsageInput(backupData),
      isCommittee: committeeRisk,
      backupSharePool,
      starterPlayerQuality: starterTalent?.player_quality?.score ?? null,
      starterPlayerQualityConfidence: starterTalent?.player_quality?.confidence ?? null,
      starterDurabilityHistoryRiskOverride: override?.starterDurabilityHistoryRisk ?? null,
    });
    // A forced Path score: null makes it N/A, a number replaces the headline
    // and keeps the computed breakdown for context.
    const pathOverride = override?.pathToOpportunityScore;
    const pathIsNA = pathOverride === null;
    const pathDetail = pathIsNA ? null : pathComputed;
    const pathScore: number | null = pathIsNA ? null : (pathOverride ?? pathComputed.score);

    const playerQualityDetail = backupTalent?.player_quality ?? null;
    const playerQualityScore = curated?.playerQualityScore ?? playerQualityDetail?.score ?? 50;

    const handcuffScore = blendHandcuffScore(
      contingentUpsideScore ?? 40,
      pathScore ?? 50,
      playerQualityScore,
      null,
      weights,
    );

    const ctx: ReasonContext = {
      workloadIfStarterOut: starterTouchesPerGame != null ? touchesToWorkloadScore(starterTouchesPerGame) : 50,
      offenseQuality: curation.teams[canonicalTeam(team)]?.offenseQuality ?? 50,
      oLine: curation.teams[canonicalTeam(team)]?.oLine ?? 50,
      roleClarity: override?.roleClarity ?? 50,
      talentBackup: curated?.talentBackup ?? 50,
      starterYpc: starterProfile?.yards_per_carry != null ? Math.round(starterProfile.yards_per_carry * 10) / 10 : null,
      starterCarries: starterProfile?.rush_att ?? null,
      starterGames: starterProfile?.games ?? null,
      starterYpcWithoutLongest: ypcWithoutLongest(
        starterProfile?.rush_att,
        starterProfile?.rush_yards,
        starterProfile?.longest_rush,
      ),
    };
    const drivers = pathDetail ? pathToOpportunityTopDrivers(pathDetail) : [];
    const topReasons = Array.from(new Set([...drivers, ...getTopReasons(ctx, backupData, committeeRisk)])).slice(0, 4);

    return {
      id: playerId(team, name),
      playerName: name,
      team: canonicalTeam(team),
      starterName,
      rank: 0,
      handcuffScore,
      handcuffType: "",
      contingentUpsideScore,
      pathToOpportunityScore: pathScore,
      pathToWorkloadScore: pathScore,
      playerQualityScore,
      contingentUpsideRank: null,
      pathToOpportunityRank: null,
      playerQualityRank: null,
      poolSize: 0,
      topReasons,
      riskFlags: getRiskFlags(ctx, backupData, committeeRisk),
      committeeRisk,
      roleTrend: backupData?.role_trend ?? null,
      notes: override?.notes ?? null,
      statchasersNote: override?.statchasersNote?.trim() || null,
      offenseQuality: ctx.offenseQuality,
      starterTouchesPerGame:
        starterTouchesPerGame != null ? Math.round(starterTouchesPerGame * 10) / 10 : null,
      adpOrCost: null,
      rosteredPct: null,
      costScore: null,
      starterInjuryStatus: starterNow?.injuryStatus ?? null,
      overallInputs: {
        contingentUpside: contingentUpsideScore ?? 40,
        pathToWorkload: pathScore ?? 50,
        playerQuality: playerQualityScore,
        cost: null,
        playerQualityPinned: curated?.playerQualityPercentile != null,
      },
      pathToOpportunityDetail: pathDetail,
      backfieldVolumeComponents: backfieldVolume?.components ?? null,
      playerQualityDetail,
      pathComponentRanks: null,
      backfieldComponentRanks: null,
      playerQualityCategoryRanks: null,
      playerQualityCategoryPoolSize: null,
    };
  });

  rankAndFinish(scored, curation, weights);
  return scored;
}

/* --------------------------------------------------------- the pool steps */

type Scored = EnginePlayer;

/** Competition ranking: ties share a rank; a null gets none. */
function rankByMetric(
  scored: Scored[],
  scoreKey: "contingentUpsideScore" | "pathToOpportunityScore" | "playerQualityScore",
  rankKey: "contingentUpsideRank" | "pathToOpportunityRank" | "playerQualityRank",
): void {
  for (const p of scored) {
    const v = p[scoreKey];
    if (v == null) {
      p[rankKey] = null;
      continue;
    }
    const higher = scored.reduce((acc, o) => acc + ((o[scoreKey] ?? -Infinity) > v ? 1 : 0), 0);
    p[rankKey] = higher + 1;
  }
}

function rankComponent(values: Array<number | null>): Array<ComponentRank | undefined> {
  const present = values.filter((v): v is number => v != null);
  return values.map((v) => {
    if (v == null) return undefined;
    return { rank: present.reduce((acc, o) => acc + (o > v ? 1 : 0), 0) + 1, poolSize: present.length };
  });
}

function sortAndNumber(scored: Scored[]): void {
  scored.sort((a, b) => b.handcuffScore - a.handcuffScore);
  scored.forEach((p, i) => {
    p.rank = i + 1;
  });
}

/** Steps 2–5 of the header. MIRRORS the tail of GET /api/handcuffs. */
function rankAndFinish(scored: Scored[], curation: Curation, weights: HandcuffWeights): void {
  sortAndNumber(scored);

  const poolSize = scored.length;
  rankByMetric(scored, "contingentUpsideScore", "contingentUpsideRank");
  rankByMetric(scored, "pathToOpportunityScore", "pathToOpportunityRank");
  rankByMetric(scored, "playerQualityScore", "playerQualityRank");
  for (const p of scored) p.poolSize = poolSize;

  // Player Quality categories, ranked across the backups that have them.
  const qualityPool = scored.filter((p) => p.playerQualityDetail);
  const categories = ["rushing", "receiving", "contact", "explosiveness"] as const;
  for (const p of qualityPool) {
    const ranks: Record<string, number> = {};
    for (const key of categories) {
      const v = p.playerQualityDetail!.categories[key].score;
      ranks[key] = qualityPool.reduce((acc, o) => acc + (o.playerQualityDetail!.categories[key].score > v ? 1 : 0), 0) + 1;
    }
    p.playerQualityCategoryRanks = ranks;
    p.playerQualityCategoryPoolSize = qualityPool.length;
  }

  // Path drivers, ranked across the backups that show them - the same
  // predicates the card uses to hide a driver, so the "of N" matches.
  const pathSpecs: Array<{ key: string; value: (p: Scored) => number | null }> = [
    {
      key: "starterDurabilityHistoryRisk",
      value: (p) => {
        const d = p.pathToOpportunityDetail;
        return d && !d.flags.includes("missing_starter_durability_history")
          ? d.components.starterDurabilityHistoryRisk.score
          : null;
      },
    },
    {
      key: "starterWorkloadStress",
      value: (p) => {
        const d = p.pathToOpportunityDetail;
        return d && !d.flags.includes("missing_starter_workload") ? d.components.starterWorkloadStress.score : null;
      },
    },
    {
      key: "starterAgeRisk",
      value: (p) => {
        const d = p.pathToOpportunityDetail;
        return d && !d.flags.includes("missing_starter_age") ? d.components.starterAgeRisk.score : null;
      },
    },
    {
      key: "backupUsageRatio",
      value: (p) => {
        const d = p.pathToOpportunityDetail;
        if (!d) return null;
        const hidden = d.flags.includes("missing_usage_ratio") && !d.flags.includes("committee_usage_detected");
        return hidden ? null : d.components.backupUsageRatio.score;
      },
    },
    {
      key: "starterQualityVulnerability",
      value: (p) => {
        const d = p.pathToOpportunityDetail;
        return d && !d.flags.includes("missing_starter_player_quality")
          ? d.components.starterQualityVulnerability.score
          : null;
      },
    },
  ];
  for (const spec of pathSpecs) {
    rankComponent(scored.map(spec.value)).forEach((r, i) => {
      if (r) (scored[i]!.pathComponentRanks ??= {})[spec.key] = r;
    });
  }
  for (const key of ["rushAttempts", "snapPct", "targets", "redZone", "goalLine", "routes"] as const) {
    rankComponent(scored.map((p) => p.backfieldVolumeComponents?.[key]?.percentile ?? null)).forEach((r, i) => {
      if (r) (scored[i]!.backfieldComponentRanks ??= {})[key] = r;
    });
  }

  // The badge, from the raw ranks - before the percentile step below.
  for (const p of scored) {
    const c = curatedFor(curation, p.playerName);
    const forced = samePairing(c, p.starterName) ? c?.handcuffType : undefined;
    p.handcuffType =
      forced ?? getHandcuffBadge(p.playerQualityRank, p.pathToOpportunityRank, p.contingentUpsideRank, poolSize);
  }

  // Every displayed score as a percentile of the pool (mean rank). Monotonic,
  // so the ranks and badges above still hold.
  const toPoolPercentile = (
    key: "handcuffScore" | "contingentUpsideScore" | "pathToOpportunityScore" | "playerQualityScore",
  ): void => {
    const vals = scored.map((p) => p[key]).filter((v): v is number => v != null);
    const n = vals.length;
    if (n === 0) return;
    for (const p of scored) {
      const v = p[key];
      if (v == null) continue;
      let less = 0;
      let lessEqual = 0;
      for (const x of vals) {
        if (x < v) less += 1;
        if (x <= v) lessEqual += 1;
      }
      (p as unknown as Record<string, number>)[key] = Math.round(((less + lessEqual) / 2 / n) * 100);
    }
  };
  toPoolPercentile("handcuffScore");
  toPoolPercentile("contingentUpsideScore");
  toPoolPercentile("pathToOpportunityScore");
  toPoolPercentile("playerQualityScore");

  // A pinned Player Quality is the displayed number, and that backup's score
  // is re-blended from the displayed pillars.
  for (const p of scored) {
    const pin = curatedFor(curation, p.playerName)?.playerQualityPercentile;
    if (pin == null) continue;
    p.playerQualityScore = pin;
    p.handcuffScore = blendHandcuffScore(
      p.contingentUpsideScore ?? 40,
      p.pathToOpportunityScore ?? 50,
      pin,
      p.costScore,
      weights,
    );
  }
  rankByMetric(scored, "playerQualityScore", "playerQualityRank");
  sortAndNumber(scored);
  for (const p of scored) p.pathToWorkloadScore = p.pathToOpportunityScore;
}
