/**
 * Everything the player pages compute about a player, as numbers.
 *
 * Pure functions over game-log entries: no clock, no DOM, no I/O, nothing
 * locale-dependent. The renderer turns these into markup and the tests assert
 * on them directly; keeping the two apart is what makes the page's claims
 * checkable without parsing HTML.
 *
 * A note on the tier thresholds, because there are deliberately two sets.
 *
 * `computeGameLogStats` buckets a player's WEEKS on a uniform 1-12 / 13-24 /
 * 25-36 / bust scale whatever the position. `seasonTierStats` buckets the same
 * weeks on a position-specific scale (QB and TE bust outside 18, WR outside 36,
 * everyone else outside 30). That is not a bug being tidied up on the way
 * across: the two numbers appear in different places on the live page, they
 * have been published to readers as they are, and unifying them would silently
 * restate every percentage on every profile. They stay as they are, and this
 * comment exists so the next person finds the answer rather than the surprise.
 */

import { getEntryPoints, type ScoringFormat } from "./scoring";
import { hasParticipation } from "./ranks";
import type {
  CareerSeasonStat,
  GameLogEntry,
  GameLogStats,
  SeasonTierStat,
} from "./types";

/** Points for one entry, in the active format. */
export function fpts(entry: GameLogEntry, format: ScoringFormat): number {
  return getEntryPoints(entry.stats, format);
}

function statValue(stats: GameLogStats, key: string): number {
  return (stats as unknown as Record<string, number | null | undefined>)[key] ?? 0;
}

function sumStat(entries: GameLogEntry[], key: string): number {
  return entries.reduce((sum, e) => sum + statValue(e.stats, key), 0);
}

/* ------------------------------------------------------------------ the tiers */

/** The weekly tier scale used by the on-page finish badges and distribution. */
export const WEEKLY_TIERS = { pos1End: 12, pos2End: 24, pos3End: 36 } as const;

export type WeeklyTier = "pos1" | "pos2" | "pos3" | "bust";

export function weeklyTier(rank: number | null | undefined): WeeklyTier | null {
  if (!rank) return null;
  if (rank <= WEEKLY_TIERS.pos1End) return "pos1";
  if (rank <= WEEKLY_TIERS.pos2End) return "pos2";
  if (rank <= WEEKLY_TIERS.pos3End) return "pos3";
  return "bust";
}

/**
 * The four finish tiers, as one hue in four monotone lightness steps.
 *
 * Validated rather than chosen: OKLCH lightness ascends 0.359 / 0.500 / 0.628 /
 * 0.754 in even steps, and the palest step still clears 2:1 against the white
 * surface these pages render on, which is the floor an ordinal ramp's light end
 * has to hold. Anchored on SC Blue so the page's data and the page's brand are
 * the same colour.
 */
export const TIER_FILL: Record<WeeklyTier, string> = {
  pos1: "#0b3a7a",
  pos2: "#2f63a8",
  pos3: "#5a8cc4",
  bust: "#8fb3da",
};

export function weeklyTierLabel(
  tier: WeeklyTier,
  position: string | null,
): string {
  const pos = position || "FLEX";
  if (tier === "bust") return "Bust";
  return `${pos}${tier === "pos1" ? 1 : tier === "pos2" ? 2 : 3}`;
}

/** The position-specific scale used by the season and career aggregates. */
export function seasonTierThresholds(position: string | null): {
  bust: number;
  hasTier3: boolean;
} {
  const bust = position === "QB" || position === "TE" ? 18 : position === "WR" ? 36 : 30;
  return { bust, hasTier3: bust > 24 };
}

export type FinishTier = "elite" | "starter" | "streaming" | "depth" | "poor";

export interface FinishBadge {
  label: string;
  tier: FinishTier;
  descriptor: string;
}

/**
 * How good a whole SEASON was, from its final positional rank.
 *
 * Coarser than the weekly badge and on a different scale, because a season and
 * a week are different questions: QB12 for a season is a every-week starter,
 * QB12 in one week is a middling afternoon.
 *
 * The scale a rank is read against is the POOL it came out of, which is why
 * there are three of them rather than one. Thirty-two clubs start one
 * quarterback and one kicker and as many as three receivers, so the same
 * number means three different things: WR12 is a first-round pick, QB12 is a
 * starter you could have had late, K12 is the median kicker in the league.
 */
export function finishBadge(
  rank: number | null | undefined,
  position: string | null,
): FinishBadge | null {
  if (!rank) return null;
  const pos = (position ?? "").toUpperCase();

  /*
   * Kickers, on the one-per-club scale rather than the receivers'.
   *
   * They used to fall through to the branch below, which is cut for a pool
   * thirty-six deep and reads the top twelve of it as elite. There are
   * thirty-two kickers, so that branch spent its whole scale on the top two
   * thirds: it called twelve of the thirty-two elite, twelve more strong
   * starters, and graded the worst kicker in the league "Flex" — a label that
   * means nothing about a kicker in the first place. The bottom two tiers
   * were unreachable, because no kicker has a rank to reach them with.
   *
   * The cuts are the QB/TE branch's, for the reason they are the QB/TE
   * branch's: one starter per club. The wording is this branch's own, because
   * "Backup range" describes a quarterback holding a clipboard and not a
   * kicker whose offence does not reach field-goal range — so these say where
   * a finish landed and leave the role out of it.
   */
  if (pos === "K") {
    if (rank <= 5) return { label: "Elite", tier: "elite", descriptor: "Top-5 finish" };
    if (rank <= 12) return { label: "Starter", tier: "starter", descriptor: "Top-12 finish" };
    if (rank <= 20) return { label: "Streaming", tier: "streaming", descriptor: "Top-20 finish" };
    if (rank <= 32) return { label: "Depth", tier: "depth", descriptor: "Top-32 finish" };
    return { label: "Poor", tier: "poor", descriptor: "Outside top-32" };
  }

  if (pos === "QB" || pos === "TE") {
    if (rank <= 5) return { label: "Elite", tier: "elite", descriptor: "Top-5 finish" };
    if (rank <= 12) return { label: "Starter", tier: "starter", descriptor: "Top-12 finish" };
    if (rank <= 20) return { label: "Streaming", tier: "streaming", descriptor: "Top-20 finish" };
    if (rank <= 32) return { label: "Depth", tier: "depth", descriptor: "Backup range" };
    return { label: "Poor", tier: "poor", descriptor: "Outside top-32" };
  }

  if (rank <= 12) return { label: "Elite", tier: "elite", descriptor: "Top-12 finish" };
  if (rank <= 24) return { label: "Strong Starter", tier: "starter", descriptor: "Top-24 finish" };
  if (rank <= 36) return { label: "Flex", tier: "streaming", descriptor: "Top-36 finish" };
  if (rank <= 60) return { label: "Depth", tier: "depth", descriptor: "Top-60 finish" };
  if (rank <= 90) return { label: "Bench", tier: "poor", descriptor: "Bench range" };
  return { label: "Poor", tier: "poor", descriptor: "Outside top-90" };
}

/* ----------------------------------------------------------- the season summary */

export interface GameLogSummary {
  gamesPlayed: number;
  totalPts: number;
  ppg: number;
  bestWeek: GameLogEntry | null;
  last4Ppg: number;
  pos1Pct: number;
  pos2Pct: number;
  pos3Pct: number;
  bustPct: number;
  pos1Games: number;
  pos2Games: number;
  pos3Games: number;
  bustGames: number;
  /** Sample standard deviation of weekly points. */
  volatility: number;
  gooseEggPct: number;
}

/**
 * The headline numbers for one season's worth of entries.
 *
 * Weeks the player did not play are excluded throughout. That is the single
 * most consequential decision in this file: including them turns points per
 * game into points per game on the roster, which flatters nobody and describes
 * nothing.
 */
export function computeGameLogStats(
  entries: GameLogEntry[],
  position: string | null,
  format: ScoringFormat,
): GameLogSummary | null {
  if (entries.length === 0) return null;

  const active = entries.filter((e) => e.game_status === "active");
  const played =
    active.length > 0
      ? active
      : entries.filter((e) => hasParticipation(e.stats, position));

  const gamesPlayed = played.length;
  const totalPts = played.reduce((s, e) => s + fpts(e, format), 0);
  const ppg = gamesPlayed > 0 ? totalPts / gamesPlayed : 0;

  const bestWeek =
    played.length > 0
      ? played.reduce((best, e) => (fpts(e, format) > fpts(best, format) ? e : best), played[0]!)
      : null;

  const last4 = played.slice(-4);
  const last4Ppg =
    last4.length > 0
      ? last4.reduce((s, e) => s + fpts(e, format), 0) / last4.length
      : 0;

  const ranked = played.filter((e) => e.pos_rank != null);
  const counts = { pos1: 0, pos2: 0, pos3: 0, bust: 0 };
  for (const e of ranked) {
    const tier = weeklyTier(e.pos_rank);
    if (tier) counts[tier] += 1;
  }

  const pct = (n: number) => (gamesPlayed > 0 ? (n / gamesPlayed) * 100 : 0);

  const points = played.map((e) => fpts(e, format));
  const mean = points.length > 0 ? points.reduce((a, b) => a + b, 0) / points.length : 0;
  const volatility =
    points.length > 1
      ? Math.sqrt(
          points.reduce((s, v) => s + (v - mean) ** 2, 0) / (points.length - 1),
        )
      : 0;

  const gooseEggs = points.filter((v) => v === 0).length;

  return {
    gamesPlayed,
    totalPts,
    ppg,
    bestWeek,
    last4Ppg,
    pos1Pct: pct(counts.pos1),
    pos2Pct: pct(counts.pos2),
    pos3Pct: pct(counts.pos3),
    bustPct: pct(counts.bust),
    pos1Games: counts.pos1,
    pos2Games: counts.pos2,
    pos3Games: counts.pos3,
    bustGames: counts.bust,
    volatility,
    gooseEggPct: pct(gooseEggs),
  };
}

/**
 * One season's tier-finish rates on the position-specific scale.
 *
 * See the note at the top of this file about why this scale differs from
 * `computeGameLogStats`.
 */
export function seasonTierStats(
  season: number,
  entries: GameLogEntry[],
  position: string | null,
  format: ScoringFormat,
): SeasonTierStat | null {
  const played = entries.filter((e) => hasParticipation(e.stats, position));
  if (played.length === 0) return null;

  const { bust, hasTier3 } = seasonTierThresholds(position);
  const pos2End = hasTier3 ? 24 : bust;
  const ranked = played.filter((e) => e.pos_rank != null);
  const inRange = (lo: number, hi: number) =>
    ranked.filter((e) => e.pos_rank! >= lo && e.pos_rank! <= hi).length;

  const gp = played.length;
  const totalPts = played.reduce((s, e) => s + fpts(e, format), 0);

  return {
    season,
    ppg: totalPts / gp,
    gamesPlayed: gp,
    pos1Pct: (inRange(1, 12) / gp) * 100,
    pos2Pct: (inRange(13, pos2End) / gp) * 100,
    pos3Pct: hasTier3 ? (inRange(25, bust) / gp) * 100 : 0,
    bustPct: (ranked.filter((e) => e.pos_rank! > bust).length / gp) * 100,
  };
}

/** One season's counting stats, for the career table. */
export function careerSeasonTotals(
  season: number,
  entries: GameLogEntry[],
  position: string | null,
  format: ScoringFormat,
  posRank: number | null,
): CareerSeasonStat | null {
  const played = entries.filter((e) => hasParticipation(e.stats, position));
  if (played.length === 0) return null;

  const total = (key: string) => sumStat(played, key);
  const pass_td = total("pass_td");
  const rush_td = total("rush_td");
  const rec_td = total("rec_td");
  const rush_yd = total("rush_yd");
  const rec_yd = total("rec_yd");

  return {
    season,
    gp: played.length,
    ppg: played.reduce((s, e) => s + fpts(e, format), 0) / played.length,
    posRank,
    pass_att: total("pass_att"),
    pass_cmp: total("pass_cmp"),
    pass_yd: total("pass_yd"),
    pass_td,
    pass_int: total("pass_int"),
    rush_att: total("rush_att"),
    rush_yd,
    rush_td,
    targets: total("rec_tgt"),
    receptions: total("rec"),
    rec_yd,
    rec_td,
    total_td: pass_td + rush_td + rec_td,
    scrimmage_yd: rush_yd + rec_yd,
  };
}

/* ------------------------------------------------------------ headline stat rows */

export interface KeyStat {
  label: string;
  total: number;
  perGame: number;
  /** Whether the per-game figure reads better with a decimal. */
  decimal: boolean;
}

/** The four counting stats that matter for this position. */
export function keyStatSummary(
  entries: GameLogEntry[],
  position: string | null,
): KeyStat[] {
  if (entries.length === 0) return [];
  const gp = entries.filter((e) => hasParticipation(e.stats, position)).length || 1;
  const row = (label: string, key: string, decimal = false): KeyStat => {
    const total = sumStat(entries, key);
    return { label, total, perGame: total / gp, decimal };
  };

  switch (position) {
    case "QB":
      return [
        row("Pass YDS", "pass_yd"),
        row("Pass TD", "pass_td", true),
        row("Rush YDS", "rush_yd"),
        row("INT", "pass_int", true),
      ];
    case "RB":
      return [
        row("Rush YDS", "rush_yd"),
        row("Rush TD", "rush_td", true),
        row("REC", "rec", true),
        row("Rec YDS", "rec_yd"),
      ];
    case "WR":
    case "TE":
      return [
        row("TGT", "rec_tgt", true),
        row("REC", "rec", true),
        row("Rec YDS", "rec_yd"),
        row("Rec TD", "rec_td", true),
      ];
    case "K":
      return [
        row("FGM", "fgm", true),
        row("FGA", "fga", true),
        row("XPM", "xpm", true),
      ];
    default:
      return [];
  }
}

/**
 * How the game log turns one stat line into one cell.
 *
 * "count" is the stat itself. "ratio" prints two stats over one another as
 * they are written on a box score — 27/37, not 0.73 — and "per" divides them
 * into a rate. The renderer owns the formatting; this file owns which stats a
 * position's log is actually about.
 */
export type LogColumnKind = "count" | "ratio" | "per";

export interface LogColumn {
  key: string;
  label: string;
  kind: LogColumnKind;
  /** The second stat, for "ratio" and "per". */
  over?: string;
  /** Dropped first when the table has to fit a phone. */
  secondary?: boolean;
}

/**
 * The game log's columns for this position.
 *
 * One list per position rather than one universal table, because the columns
 * ARE the page: a receiver's log with a PASS TD column in it is a template
 * someone pointed at a player, and a reader can tell. Fantasy points are not in
 * here — the renderer puts them immediately after the result, ahead of every
 * box-score column, which is the one ordering decision this table makes that
 * the mainstream sites do not.
 *
 * `conditionalRush` is the one exception to fixed columns: a receiver who ran
 * the ball six times this season has a rushing line worth a column, and one who
 * never did has three columns of zeroes.
 */
export function gameLogColumns(position: string | null): {
  columns: LogColumn[];
  conditionalRush: boolean;
} {
  switch (position) {
    case "QB":
      return {
        columns: [
          { key: "pass_cmp", over: "pass_att", label: "CMP/ATT", kind: "ratio" },
          { key: "pass_yd", label: "PASS YDS", kind: "count" },
          { key: "pass_td", label: "PASS TD", kind: "count" },
          { key: "pass_int", label: "INT", kind: "count" },
          { key: "rush_att", label: "CAR", kind: "count", secondary: true },
          { key: "rush_yd", label: "RUSH YDS", kind: "count" },
          { key: "rush_td", label: "RUSH TD", kind: "count" },
        ],
        conditionalRush: false,
      };
    case "RB":
      return {
        columns: [
          { key: "rush_att", label: "CAR", kind: "count" },
          { key: "rush_yd", label: "RUSH YDS", kind: "count" },
          { key: "rush_td", label: "RUSH TD", kind: "count" },
          { key: "rec_tgt", label: "TGT", kind: "count" },
          { key: "rec", label: "REC", kind: "count" },
          { key: "rec_yd", label: "REC YDS", kind: "count" },
          { key: "rec_td", label: "REC TD", kind: "count" },
        ],
        conditionalRush: false,
      };
    case "WR":
    case "TE":
      return {
        columns: [
          { key: "rec_tgt", label: "TGT", kind: "count" },
          { key: "rec", label: "REC", kind: "count" },
          { key: "rec_yd", label: "REC YDS", kind: "count" },
          { key: "rec_td", label: "REC TD", kind: "count" },
          { key: "rec_yd", over: "rec", label: "YPR", kind: "per", secondary: true },
        ],
        conditionalRush: true,
      };
    case "K":
      return {
        columns: [
          { key: "fgm", over: "fga", label: "FG", kind: "ratio" },
          { key: "xpm", over: "xpa", label: "XP", kind: "ratio" },
          { key: "fgm_lng", label: "LNG", kind: "count", secondary: true },
        ],
        conditionalRush: false,
      };
    default:
      return { columns: [], conditionalRush: false };
  }
}

/** The rushing columns a receiver's log earns in a season he actually ran. */
export const RECEIVER_RUSH_COLUMNS: LogColumn[] = [
  { key: "rush_att", label: "CAR", kind: "count", secondary: true },
  { key: "rush_yd", label: "RUSH YDS", kind: "count" },
  { key: "rush_td", label: "RUSH TD", kind: "count" },
];

/* --------------------------------------------------- per-game rate summary */

/** One headline rate, ready to print. `pct` values are already 0-100. */
export interface RateStat {
  /** The tile's label — abbreviated, because a tile has one line for it. */
  label: string;
  value: number;
  digits: number;
  pct?: boolean;
  /**
   * The same rate named in prose, for the generated summary sentence.
   *
   * "240 pass yds/g" is right on a tile and wrong in a sentence, and a
   * generated paragraph that reads like a column header is the tell that
   * nobody wrote it. Absent for rates that do not belong in a list of
   * averages — a completion percentage is not something a player averaged.
   */
  prose?: string;
}

/**
 * The per-game line that belongs above a game log.
 *
 * Rates rather than totals, because this sits on the tab that answers "what
 * does a week from this player look like" — the totals are the Stats tab's
 * question and are answered there. Over the games PLAYED, for the reason
 * computeGameLogStats() gives: per-game over weeks on a roster is a number
 * about availability wearing the clothes of a number about production.
 *
 * Returns [] for a position with no defined line, which is how the caller knows
 * to render nothing rather than a row of dashes.
 */
export function perGameRates(
  entries: GameLogEntry[],
  position: string | null,
): RateStat[] {
  const played = entries.filter((e) => hasParticipation(e.stats, position));
  const gp = played.length;
  if (gp === 0) return [];

  const per = (key: string): number => sumStat(played, key) / gp;
  const share = (made: string, attempted: string): number => {
    const att = sumStat(played, attempted);
    return att > 0 ? (sumStat(played, made) / att) * 100 : 0;
  };

  switch (position) {
    case "QB":
      return [
        { label: "Pass yds/g", value: per("pass_yd"), digits: 0, prose: "passing yards" },
        {
          label: "Pass TD/g",
          value: per("pass_td"),
          digits: 1,
          prose: "passing touchdowns",
        },
        { label: "Cmp %", value: share("pass_cmp", "pass_att"), digits: 1, pct: true },
        {
          label: "Rush yds/g",
          value: per("rush_yd"),
          digits: 0,
          prose: "rushing yards",
        },
      ];
    case "RB":
      return [
        { label: "Carries/g", value: per("rush_att"), digits: 1, prose: "carries" },
        {
          label: "Rush yds/g",
          value: per("rush_yd"),
          digits: 1,
          prose: "rushing yards",
        },
        { label: "Rec/g", value: per("rec"), digits: 1, prose: "receptions" },
        {
          label: "Rec yds/g",
          value: per("rec_yd"),
          digits: 1,
          prose: "receiving yards",
        },
      ];
    case "WR":
    case "TE": {
      const rec = sumStat(played, "rec");
      return [
        { label: "Targets/g", value: per("rec_tgt"), digits: 1, prose: "targets" },
        { label: "Rec/g", value: per("rec"), digits: 1, prose: "receptions" },
        {
          label: "Rec yds/g",
          value: per("rec_yd"),
          digits: 1,
          prose: "receiving yards",
        },
        {
          label: "Yds/rec",
          value: rec > 0 ? sumStat(played, "rec_yd") / rec : 0,
          digits: 1,
        },
      ];
    }
    case "K":
      return [
        { label: "FG made/g", value: per("fgm"), digits: 1, prose: "field goals" },
        { label: "FG %", value: share("fgm", "fga"), digits: 0, pct: true },
        { label: "XP made/g", value: per("xpm"), digits: 1, prose: "extra points" },
      ];
    default:
      return [];
  }
}

/**
 * The trailing slice of a season, for the "last five games" read.
 *
 * Played games only and in played order, so "last five" means the last five he
 * was on the field for rather than the last five weeks on the calendar — a
 * player back from a three-week absence has played one game recently, not four.
 */
export function recentGames(entries: GameLogEntry[], count: number): GameLogEntry[] {
  return entries.filter((e) => e.game_status === "active").slice(-count);
}

/* -------------------------------------------------------------- trend and shape */

/** Trailing mean over `window` entries, one value per entry. */
export function rollingAverage(values: number[], window = 3): number[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

export function rollingStatAverage(
  entries: GameLogEntry[],
  key: string,
  window = 3,
): number[] {
  return rollingAverage(
    entries.map((e) => statValue(e.stats, key)),
    window,
  );
}

export interface MomentumMetric {
  key: string;
  label: string;
  /** Rendered as a percentage rather than a count. */
  pct: boolean;
  /** How much this metric counts toward the role-direction score. */
  weight: number;
  /** Context only — shown, but not scored as the player's own usage. */
  context?: boolean;
}

/** The usage metrics whose direction actually describes this position's role. */
export function positionMomentumMetrics(position: string | null): MomentumMetric[] {
  if (position === "QB")
    return [
      { key: "pass_att", label: "Pass Att/G", pct: false, weight: 5 },
      { key: "rush_att", label: "Rush Att/G", pct: false, weight: 3 },
    ];
  if (position === "RB")
    return [
      { key: "snap_share", label: "Snap Share", pct: true, weight: 4 },
      { key: "rush_att", label: "Carries/G", pct: false, weight: 4 },
      { key: "rec_tgt", label: "Targets/G", pct: false, weight: 2 },
    ];
  if (position === "WR" || position === "TE")
    return [
      { key: "target_share", label: "Target Share (Team)", pct: true, weight: 6 },
      { key: "rec_tgt", label: "Targets/G", pct: false, weight: 2 },
      { key: "team_pass_att", label: "Team Pass Att/G", pct: false, weight: 2, context: true },
    ];
  if (position === "K")
    return [
      { key: "fga", label: "FG Att/G", pct: false, weight: 5 },
      { key: "fgm", label: "FG Made/G", pct: false, weight: 3 },
      { key: "xpa", label: "XP Att/G", pct: false, weight: 2 },
    ];
  return [];
}

/** Mean of one stat over all entries, or over the last `count` of them. */
export function metricAverage(
  entries: GameLogEntry[],
  key: string,
  count?: number,
): number {
  const src = count ? entries.slice(-count) : entries;
  if (src.length === 0) return 0;
  return src.reduce((s, e) => s + statValue(e.stats, key), 0) / src.length;
}

export interface TdDependency {
  pct: number;
  label: string;
  tag: string;
  isHigh: boolean;
}

/**
 * How much of the scoring came from touchdowns.
 *
 * The most useful single regression flag on the page: yards and targets carry
 * forward, and touchdown rate largely does not. The thresholds are
 * position-specific because a quarterback's baseline TD share is structurally
 * higher than a receiver's.
 */
export function tdDependency(
  entries: GameLogEntry[],
  position: string | null,
  format: ScoringFormat,
): TdDependency {
  const none: TdDependency = { pct: 0, label: "N/A", tag: "", isHigh: false };
  if (entries.length === 0) return none;

  let tdPts = 0;
  if (position === "QB") {
    tdPts = sumStat(entries, "pass_td") * 4 + sumStat(entries, "rush_td") * 6;
  } else if (position !== "K") {
    tdPts = (sumStat(entries, "rec_td") + sumStat(entries, "rush_td")) * 6;
  }

  const totalPts = entries.reduce((s, e) => s + fpts(e, format), 0);
  if (totalPts === 0) return none;

  const pct = (tdPts / totalPts) * 100;
  const { high, mid } =
    position === "QB"
      ? { high: 45, mid: 35 }
      : position === "RB" || position === "TE"
        ? { high: 40, mid: 25 }
        : { high: 35, mid: 20 };

  if (pct >= high)
    return { pct, label: "TD-Driven", tag: "High TD reliance", isHigh: true };
  if (pct >= mid)
    return { pct, label: "Balanced", tag: "Balanced production", isHigh: false };
  return { pct, label: "Volume-Backed", tag: "Volume-backed production", isHigh: false };
}

/* ----------------------------------------------------------------- the outlook */

export interface Outlook {
  hasData: boolean;
  formLabel: string;
  formDetail: string;
  formDirection: "up" | "down" | "flat";
  roleLabel: string;
  volatilityLabel: string;
  volatilityLevel: "low" | "moderate" | "high";
  tierProfile: string;
  bestWeekSentence: string;
  noDataMsg: string;
}

/**
 * The four-box summary at the top of the Overview tab.
 *
 * Every box is a restatement of numbers already on the page rather than a
 * projection. Nothing here predicts; it describes what happened and labels it.
 */
export function structuredOutlook(
  playerName: string,
  position: string | null,
  stats: GameLogSummary | null,
  format: ScoringFormat,
): Outlook {
  if (!stats || stats.gamesPlayed === 0) {
    return {
      hasData: false,
      formLabel: "No Data",
      formDetail: "",
      formDirection: "flat",
      roleLabel: "Unknown",
      volatilityLabel: "N/A",
      volatilityLevel: "moderate",
      tierProfile: "N/A",
      bestWeekSentence: "",
      noDataMsg: `${playerName} has not recorded any fantasy points this season.`,
    };
  }

  const pos = position || "FLEX";
  const ppgDelta = stats.ppg > 0 ? ((stats.last4Ppg - stats.ppg) / stats.ppg) * 100 : 0;
  const formDirection = ppgDelta > 5 ? "up" : ppgDelta < -10 ? "down" : "flat";

  const topRate = stats.pos1Pct + stats.pos2Pct;
  const roleLabel = topRate >= 60 ? "Starter" : topRate >= 35 ? "Flex" : "Depth";

  // Coefficient of variation, not raw standard deviation: eight points of
  // spread means something very different at 22 PPG than at 9.
  const cv = stats.ppg > 0 ? stats.volatility / stats.ppg : 2;
  const volatilityLevel = cv < 0.4 ? "low" : cv < 0.7 ? "moderate" : "high";

  const best = stats.bestWeek;

  return {
    hasData: true,
    formLabel: ppgDelta > 5 ? "Heating Up" : ppgDelta < -10 ? "Cooling" : "Stable",
    formDetail: `${ppgDelta > 0 ? "+" : ""}${ppgDelta.toFixed(0)}% vs season avg`,
    formDirection,
    roleLabel,
    volatilityLabel: volatilityLevel === "low" ? "Low" : volatilityLevel === "moderate" ? "Moderate" : "High",
    volatilityLevel,
    tierProfile: `${stats.pos1Pct.toFixed(0)}% ${pos}1 rate`,
    bestWeekSentence: best
      ? `Best outing: Wk ${best.week} vs ${best.opp} (${fpts(best, format).toFixed(1)} pts).`
      : "",
    noDataMsg: "",
  };
}

/** Percentile of `value` within an ascending array, 0-100. Null under 2 points. */
export function percentileOf(sorted: number[], value: number): number | null {
  const n = sorted.length;
  if (n <= 1) return null;
  let rank = 0;
  for (const v of sorted) {
    if (v < value) rank += 1;
    else if (v === value) rank += 0.5;
  }
  return Math.round((rank / (n - 1)) * 100);
}
