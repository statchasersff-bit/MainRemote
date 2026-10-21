/**
 * The injury impact datasets, as the standalone app typed them
 * (artifacts/injury-impact/src/hooks/use-injury-data.ts, use-draft-sim.ts,
 * lib/injuryApi.ts and components/InjuryTagImpact.tsx at c6a49ce). Field
 * names are the app's own so its arithmetic ports verbatim and the fixture
 * generated from its code compares like for like.
 */

/* ------------------------------------------------------------- analysis */

export interface Methodology {
  injury_data_source: string;
  adp_data_source: string;
  player_matching: string;
  points_lost_estimation: string;
  replacement_value: string;
  adp_tiers: string;
  impact_labels: string;
  limitations?: string[];
}

export interface MetaData {
  last_updated: string;
  seasons: number[];
  description: string;
  methodology: Methodology;
  callouts: string[];
}

export interface PlayerInjuryImpact {
  season: number;
  player: string;
  /** nflverse GSIS id; null when the player is not in the crosswalk. */
  gsis_id: string | null;
  team: string;
  position: string;
  overall_adp: number;
  positional_adp: number;
  draft_round: number;
  adp_tier: string;
  injury: string;
  status: string;
  week_of_injury: number;
  /** Full-season games missed (regular season + the team's playoff games). */
  games_missed: number;
  /** Regular-season games missed only (basis for fantasy-value math). */
  reg_games_missed?: number;
  playoff_games_missed?: number;
  season_ending: boolean;
  expected_fantasy_points: number;
  actual_fantasy_points: number;
  estimated_points_lost: number;
  replacement_level_points: number;
  net_value_lost: number;
  impact_label: string;
}

export interface DraftedPoolEntry {
  season: number;
  position: string;
  overall_adp: number;
}

export interface InjuryImpactData {
  meta: MetaData;
  player_injury_impacts: PlayerInjuryImpact[];
  drafted_pool: DraftedPoolEntry[];
}

export interface ExposureEntry {
  season: number;
  position: string;
  snaps?: number;
  routes?: number;
  touches?: number;
  targets?: number;
  pass_attempts?: number;
  kickoff_returns?: number;
  reg_snaps?: number;
  reg_touches?: number;
  reg_targets?: number;
  reg_pass_attempts?: number;
  reg_kickoff_returns?: number;
  mean_age?: number | null;
  player_seasons?: number;
}

export interface InjuryRegression {
  model: string;
  offset: string;
  n_player_seasons: number;
  dispersion: number;
  seasons_used: number[];
  seasons_excluded: number[];
  mean_age: number;
  season_trend: { annual_pct_change: number; ci95: [number, number]; p: number };
  age_effect: { pct_per_year: number; p: number };
  terms: { name: string; irr: number; p: number }[];
}

export interface PanelRow {
  season: number;
  position: string;
  age: number;
  snaps: number;
  touches: number;
  prev_snaps: number;
  prev_touches: number;
  prior_inj: number;
  rookie_year: number;
  episodes: number;
  first_week: number;
  games_missed: number;
  severe: boolean;
}

export interface PostReturnGroup {
  key?: string;
  episodes: number;
  returned: number;
  returned_pct: number | null;
  n_with_baseline: number;
  median_return_ratio: number | null;
  pct_below_80: number | null;
  median_snap_delta: number | null;
  reinjury_2wk: number | null;
  reinjury_4wk: number | null;
  reinjury_8wk: number | null;
}

export interface PostReturnData {
  meta: { post_window_games: number; min_pre_games: number; matched_episodes: number; notes: string };
  overall: PostReturnGroup;
  byPosition: PostReturnGroup[];
  byRegion: PostReturnGroup[];
  byType: PostReturnGroup[];
}

/* ------------------------------------------------------- current season */

export interface SeasonInjury {
  season: number;
  team: string;
  injury: string;
  week_of_injury: number;
  games_missed: number;
  season_ending: boolean;
  ongoing?: boolean;
}

export interface CurrentInjuryRow extends SeasonInjury {
  gsis_id: string;
  player: string;
  position: string;
  status: string;
  overall_adp: number | null;
  positional_adp: number | null;
  draft_round: number | null;
  adp_tier: string | null;
  return_week?: number | null;
}

export interface CurrentInjuryFile {
  season: number;
  through_week: number;
  generated?: string;
  rows: CurrentInjuryRow[];
}

/* ------------------------------------------------------------ tag impact */

export interface TagGroup {
  key: string;
  label: string;
  listed: number;
  played_pct: number;
  n: number;
  fp_ratio: number | null;
  fp_ratio_lo: number | null;
  fp_ratio_hi: number | null;
  expected_ratio: number | null;
  fp_delta: number | null;
  snap_delta: number | null;
  dud_pct: number | null;
  small_sample: boolean;
}

export interface TagImpactData {
  meta: { seasons: number[]; listed_player_weeks: number; with_baseline: number; min_base_games: number; min_base_ppg: number; notes: string[] };
  by_status: TagGroup[];
  by_practice: TagGroup[];
  matrix: TagGroup[];
  by_position: TagGroup[];
  questionable_by_body: TagGroup[];
  questionable_by_season: TagGroup[];
}

/* ------------------------------------------------------------- draft sim */

export interface StrategyResult {
  n: number;
  mean_points: number;
  median_points: number;
  sd_points: number;
  cvar10: number;
  min_points: number;
  max_points: number;
  quantiles: { q05: number; q10: number; q25: number; q50: number; q75: number; q90: number; q95: number };
  playoff_rate: number;
  championship_rate: number;
  top10pct_rate: number;
  p_exceed_playoff_threshold: number;
  p_both_top2_miss4: number;
  avg_starter_weeks_lost: number;
  avg_vorp_lost: number;
  avg_waiver_pickups: number;
  p_lose_1_starter: number;
  p_lose_2_starters: number;
  p_lose_3plus_starters: number;
  histogram: { x0: number; x1: number; count: number }[];
  cdf: { x: number; p: number }[];
}

export interface SeasonPoint {
  season: number;
  n: number;
  mean_points: number;
  cvar10: number;
  playoff_rate: number;
  championship_rate: number;
}

export type ReplacementModelKey = "none" | "normal" | "aggressive" | "bestball";

export interface DraftSimData {
  meta: {
    title: string;
    description: string;
    generated: string;
    seasons: number[];
    teams: number;
    roster_size: number;
    regular_season_weeks: number;
    starter_slots: string[];
    sims_per_strategy: number;
    total_sims: number;
    playoff_threshold: number;
    points_domain: [number, number];
    replacement_models: { key: ReplacementModelKey; label: string }[];
    notes: string[];
  };
  strategies: { key: string; label: string; description: string }[];
  results: Record<ReplacementModelKey, Record<string, StrategyResult>>;
  results_by_season: Record<ReplacementModelKey, Record<string, SeasonPoint[]>>;
}

/* ---------------------------------------------------------- player panel */

/** One weekly injury-report row, trimmed to what the panel renders. */
export interface InjuryRow {
  season: number | null;
  week: number | null;
  team: string | null;
  reportPrimaryInjury: string | null;
  reportSecondaryInjury: string | null;
  practicePrimaryInjury: string | null;
  practiceSecondaryInjury: string | null;
  reportStatus: string | null;
  practiceStatus: string | null;
  dateModified: string | null;
}

/** One in-game injury event, from play-by-play. */
export interface InGameInjuryEvent {
  season: number;
  week: number | null;
  seasonType: string;
  gameId: string;
  date: string | null;
  team: string;
  opponent: string;
  qtr: number | null;
  clock: string | null;
  status: string | null;
  desc: string;
}

/** One scheduled game: week, opponent, home flag, game type (REG/WC/DIV/CON/SB). */
export interface SchedGame {
  w: number;
  o: string;
  h: 0 | 1;
  t: string;
}

/** season -> team -> games. */
export type ScheduleMap = Record<string, Record<string, SchedGame[]>>;

/** One player in the search index. */
export interface PlayerSearchResult {
  gsisId: string;
  fullName: string;
  position: string | null;
  team: string | null;
  seasons: number[];
  reportCount: number;
}

/**
 * Everything the per-player panel draws, in one slice from
 * /embed/injury-impact/data/player/<gsis>. The schedule carries only the
 * seasons the player appears in.
 */
export interface PlayerSlice {
  gsisId: string;
  name: string;
  position: string | null;
  team: string | null;
  rows: InjuryRow[];
  inGame: InGameInjuryEvent[];
  impacts: SeasonInjury[];
  schedule: ScheduleMap;
  /** The season in progress and the week its episodes are audited through, for the timeline. */
  audited: { season: number; week: number } | null;
  /** Sleeper id for the headshot, when the crosswalk has one. */
  photoId: string | null;
  headshotVersion: string | null;
}

/** Where the browser finds this server's headshots, and which version each is at. */
export interface InjuryAssets {
  origin: string;
  /** Sleeper id -> version; null = no photo on file. */
  headshots: Record<string, string | null>;
  /** GSIS id -> Sleeper id, for the players in view. */
  sleeper: Record<string, string>;
}

/** The whole dashboard dataset, as the server reads it. */
export interface InjuryDataset {
  analysis: InjuryImpactData;
  exposure: ExposureEntry[] | null;
  regression: InjuryRegression | null;
  panel: PanelRow[] | null;
  postReturn: PostReturnData | null;
  tagImpact: TagImpactData | null;
  draftSim: DraftSimData | null;
  current: CurrentInjuryFile | null;
}
