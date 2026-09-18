/**
 * The shapes the player pages are built from.
 *
 * Ported from the standalone player-pages app's `shared/playerTypes.ts`. The
 * field names are upstream's — they come straight out of Sleeper's weekly stat
 * objects and out of the JSON in `data/player/`, so renaming them here would
 * mean renaming them in every build script too.
 *
 * Two fields are worth reading twice, because getting them the wrong way round
 * produces copy that is confidently wrong rather than merely missing:
 * `team` is where the player is NOW, and `seasonTeam` is who they actually
 * played for during the season being described. Forward-looking copy uses the
 * first; a completed-season recap uses the second.
 */

/** One week's raw stat line. Everything optional: Sleeper omits what is zero. */
export interface GameLogStats {
  pts_ppr: number;
  pts_half_ppr?: number | null;
  pass_att?: number;
  pass_cmp?: number;
  pass_yd?: number;
  pass_td?: number;
  pass_int?: number;
  rush_att?: number;
  rush_yd?: number;
  rush_td?: number;
  rec_tgt?: number;
  rec?: number;
  rec_yd?: number;
  rec_td?: number;
  fgm?: number;
  fga?: number;
  fgm_lng?: number;
  xpm?: number;
  xpa?: number;
  off_snp?: number;
  /** Derived in enrichWithTeamMetrics(), not present in the source data. */
  target_share?: number | null;
  team_pass_rate?: number | null;
  team_tgt?: number;
  team_pass_att?: number;
}

export interface GameScore {
  r: "W" | "L" | "T";
  tm: number;
  opp: number;
}

export interface GameLogEntry {
  week: number;
  opp: string;
  team?: string | null;
  stats: GameLogStats;
  pos_rank?: number | null;
  opp_rank_vs_pos?: number | null;
  game_status?: "active" | "bye" | "out" | null;
  score?: GameScore | null;
}

export interface NewsEntry {
  title: string;
  source: string;
  publishedAt: string;
  url: string;
  summary?: string;
}

export interface DynastyFormatValues {
  rank: number;
  positionalRank: number;
  value: number;
  overallTier: number;
  positionalTier: number;
  trend30: number;
  trend7: number;
  posTrend30: number;
  posTrend7: number;
  adp: number | null;
  startupAdp: number | null;
  tradeCount: number;
}

export interface DynastyData extends DynastyFormatValues {
  age: number;
  position: string;
  team: string;
  ageCurveTier: string;
  ktcSlug: string;
  draftRound: number | null;
  draftPick: number | null;
  draftYear: number | null;
  /** Superflex values, when KeepTradeCut has them. */
  sf: DynastyFormatValues | null;
}

export interface FantasyOutlook2026 {
  headline: string;
  body: string;
}

/** A row of `data/player/players.json`. */
export interface Player {
  id: string;
  name: string;
  slug: string;
  position: string | null;
  /** Current team, post-offseason. Forward-looking copy only. */
  team: string | null;
  status: string | null;
  injury_status: string | null;
  age: number | null;
  height: string | null;
  weight: string | null;
  number: number | null;
  depth_chart_order: number | null;
  years_exp: number | null;
  headshotUrl: string | null;
  news?: NewsEntry[];
}

/** One season's totals, for the career table. */
export interface CareerSeasonStat {
  season: number;
  gp: number;
  ppg: number;
  posRank: number | null;
  pass_att: number;
  pass_cmp: number;
  pass_yd: number;
  pass_td: number;
  pass_int: number;
  rush_att: number;
  rush_yd: number;
  rush_td: number;
  targets: number;
  receptions: number;
  rec_yd: number;
  rec_td: number;
  total_td: number;
  scrimmage_yd: number;
}

/** One season's tier-finish rates, for the finish timeline. */
export interface SeasonTierStat {
  season: number;
  ppg: number;
  gamesPlayed: number;
  pos1Pct: number;
  pos2Pct: number;
  pos3Pct: number;
  bustPct: number;
}

export interface CareerProfile {
  ppg: number;
  gamesPlayed: number;
  maxGames: number;
  durabilityPct: number;
  pos1Pct: number;
  pos2Pct: number;
  pos3Pct: number;
  bustPct: number;
  volatility: number;
  volatilityLabel: string;
  seasons: number;
  seasonPpgs: { season: number; ppg: number }[];
  /** Under eight career games — every rate on the card is noise, and says so. */
  smallSample: boolean;
}

export interface PositionAverages {
  yardsPerCatch: number | null;
  catchPct: number | null;
  tdPerTarget: number | null;
  fpPerUsage?: number | null;
}

export interface PlayerBenchmarks {
  position: string;
  season: number;
  qualifiedThreshold: number;
  posAvg: PositionAverages;
  posStdDev: { tdPerTarget: number; fpPerUsage?: number };
  /** Null when the player is below the volume threshold — see player-data.ts. */
  percentile: {
    yardsPerCatch: number | null;
    catchPct: number | null;
    tdPerTarget: number | null;
    fpPerUsage: number | null;
  } | null;
  playerQualified: boolean;
}

/** A row of `data/player/bios.json`. Free-form by design; rendered defensively. */
export interface PlayerBio {
  snapshot_bullets?: string[];
  style?: {
    how_he_wins?: string;
    fantasy_translation?: string;
    tags?: string[];
  };
  timeline?: { label?: string; season?: number | string; detail?: string }[];
  career_context_tiles?: { label?: string; value?: string; detail?: string }[];
  narrative_paragraphs?: string[];
  last_updated?: string;
  sources?: string[];
}
