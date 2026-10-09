/**
 * The shapes the player pages are built from.
 *
 * Ported from the standalone player-pages app's `shared/playerTypes.ts`. The
 * field names are upstream's - they come straight out of Sleeper's weekly stat
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
  /** The team's offensive snaps that week - the denominator for a snap share. */
  tm_off_snp?: number;
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

/**
 * One band on the range-of-outcomes spectrum.
 *
 * Positional ranks, so LOWER is better and `best` is always the smaller number.
 * A band rather than a point because a single projected rank is a precision
 * nobody has: "QB22–28" is the honest shape of the claim, and the spectrum is
 * drawn from these two numbers rather than from a decimal.
 */
export interface OutlookBand {
  /** The good end of the band - the smaller rank. */
  best: number;
  /** The bad end of the band - the larger rank. */
  worst: number;
  /** One line on what produces this outcome. */
  note: string;
}

/**
 * How to actually use the player, by format.
 *
 * `standard` and `deep` are deliberately not named for a format here: the
 * renderer labels them "1QB leagues" and "Superflex" for a quarterback and
 * "12-team" and "Deep leagues" for everyone else, because those are the two
 * questions each position's managers are actually asking.
 */
export interface OutlookUsage {
  standard: string;
  deep: string;
  bestWhen: string;
  avoidWhen: string;
}

/** The closing call. `call` is a short chip - "Hold / Stream", "Buy". */
export interface OutlookVerdict {
  call: string;
  rationale: string;
}

/**
 * The 2025 advanced line the outlook was written from.
 *
 * An index signature rather than a field per metric, for the reason the
 * Advanced Stats tab reads its tables the same way: these rows arrive from the
 * advanced-stats pipeline, they differ by position, and a table that starts
 * carrying a new metric must not become a type error in a server whose job is
 * to read what it is given. `outlook-drivers.ts` names the handful of keys it
 * needs and tolerates their absence.
 */
export interface OutlookKeyStats {
  [key: string]: number | string | null | undefined;
}

/**
 * The written 2026 outlook, and the decision layer on top of it.
 *
 * `headline` and `body` are the original two fields and are always present.
 * Everything below them is the Outlook tab's decision layer - the verdict, the
 * projected range, the triggers, the usage - and every one of them is OPTIONAL,
 * because a record generated before those fields existed simply does not carry
 * them and the tab must render what it has rather than a row of empty labels.
 *
 * All of it is authored, not derived: a rest-of-season rank, a floor and a
 * ceiling, and a buy/hold call are judgments, and this server has no data from
 * which to compute one. They are written by the same pass that writes `body`
 * (scripts/player/buildFantasyOutlook2026.js) and a record marked
 * `edited: true` is never overwritten by it.
 *
 * The four driver cards on the tab are NOT here, and deliberately: they are
 * measured from `keyStats` against the position's own distribution, so they
 * stay true without anybody rewriting them. See lib/player/outlook-drivers.ts.
 */
export interface FantasyOutlook2026 {
  /**
   * Identity, as the generator stamped it. Carried so a consumer reading the
   * file on its own - outlook-drivers.ts builds its position distributions
   * straight out of it - does not have to join back to players.json first.
   */
  slug?: string;
  name?: string;
  position?: string | null;
  team?: string | null;
  season?: number;

  headline: string;
  body: string;

  /** Two or three sentences. The whole take, above the fold. */
  quickTake?: string;
  /** "Spot Starter", "Lead Back", "Committee Back". */
  weeklyRole?: string;
  /** "QB3 / Matchup Play" - the rest-of-season call, in the site's shorthand. */
  restOfSeason?: string;
  confidence?: "High" | "Moderate" | "Low";

  range?: {
    floor: OutlookBand;
    expected: OutlookBand;
    ceiling: OutlookBand;
  };

  upsideTriggers?: string[];
  warningSigns?: string[];
  usage?: OutlookUsage;
  verdict?: OutlookVerdict;

  /** The advanced line this was written from. Present since the first build. */
  keyStats?: OutlookKeyStats | null;
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

/**
 * What Sleeper's leagues have done with a player, for one week.
 *
 * Built by scripts/player/buildRosterPct.mjs from Sleeper's research endpoint,
 * whose default cut is the redraft one - see that script for why there is no
 * 1QB-only cut to read. `started` is absent where the source gave no figure;
 * neither field is ever defaulted to zero, because "nobody rostered him" and
 * "no reading" are different answers and only one of them is knowable.
 */
export interface RosterPctDoc {
  season: number;
  week: number;
  /** When the builder read it, ISO. The figure is a reading of that moment. */
  readAt: string;
  players: Record<string, { owned: number; started?: number }>;
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
  /** Under eight career games - every rate on the card is noise, and says so. */
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
  /** Null when the player is below the volume threshold - see player-data.ts. */
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

/**
 * A row of `data/player/draft.json`. Absent for an undrafted player.
 *
 * `draft_team` is the team that made the pick, which is frequently not the team
 * on the player's current row and is never the one the timeline ends on.
 */
export interface DraftRecord {
  player_id?: string;
  name?: string;
  college?: string | null;
  rookie_year?: number | null;
  year?: number | null;
  round?: number | null;
  pick?: number | null;
  draft_team?: string | null;
}

/**
 * A row of `data/player/bio_facts.json` - the Bio tab's own source.
 *
 * `teams` is one entry per season the player was actually on a roster for,
 * oldest first, and it is the career timeline. Seasons he was not in the league
 * are absent rather than zero: see the guard in buildBioFacts.mjs, which exists
 * because the upstream API answers for every season with the player's CURRENT
 * team and an empty stat line.
 *
 * There is no hometown here. Sleeper's birth_city and birth_state are null for
 * every active player, so the field would be a column of blanks - and rule 1
 * says a field we do not have is not rendered.
 */
export interface BioFacts {
  /** ISO "YYYY-MM-DD", or null. */
  birthDate: string | null;
  college: string | null;
  highSchool: string | null;
  teams: { season: number; team: string }[];
}
