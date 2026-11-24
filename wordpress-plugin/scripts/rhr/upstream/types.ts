export type Format = "1qb" | "sf";
export type Scoring = "ppr" | "hppr" | "std";
export type Pos = "QB" | "RB" | "WR" | "TE";
export type Outcome = "elite" | "starter" | "flex";

export interface RookieDraft {
  player_id: string;
  player_name: string;
  pos: Pos;
  pos_rank: number;
  rookie_year: number;
  adp_format: Format;
  scoring_format: Scoring;
  rookie_round: number;
  rookie_pick: number;
  current_nfl_team: string;
  current_age: number | null;
  height: string;
  weight: number | null;
}

export interface SeasonFinish {
  player_id: string;
  season: number;
  pos: Pos;
  games: number;
  fantasy_points_ppr: number;
  fantasy_points_hppr: number;
  fantasy_points_std: number;
  rank_ppr: number;
  rank_hppr: number;
  rank_std: number;
}

export interface RankedSeason extends SeasonFinish {
  pos_rank: number;
}

export interface PlayerSummary {
  player_id: string;
  player_name: string;
  pos: Pos;
  rookie_year: number;
  rookie_round: number;
  rookie_pick: number;
  current_nfl_team: string;
  current_age: number | null;
  height: string;
  weight: number | null;
  best_finish: string;
  best_finish_year: number;
  breakout_year: number | null;
  breakout_time: number | null;
  hit_type: "elite" | "starter" | "flex" | "bust" | "too_early";
  seasons: RankedSeason[];
}

export interface CohortSummary {
  pos: Pos;
  rookie_round: number;
  dynasty_years: number[];
  total: number;
  hits: number;
  hit_rate: number;
  elite_hits: number;
  elite_rate: number;
  starter_hits: number;
  starter_rate: number;
  flex_hits: number;
  flex_rate: number;
  bust_count: number;
  bust_rate: number;
  median_breakout: number | null;
  hit_by_year: { year1: number; year2: number; year3_plus: number };
  ci_lower: number;
  ci_upper: number;
  ci_width: number;
}

export interface PickRangeCohortSummary extends CohortSummary {
  pickStart: number;
  pickEnd: number;
  rangeLabel: string;
}

export interface Filters {
  yearStart: number;
  yearEnd: number;
  format: Format;
  scoring: Scoring;
  outcome: Outcome;
  positions: Pos[];
  rounds: number[];
  minGames: number;
  showConfidence: boolean;
}

export interface HoveredCell {
  pos: Pos;
  round: number;
}
