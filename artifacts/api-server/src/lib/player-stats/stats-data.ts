/**
 * Every read of `data/player-stats/`, plus the domain logic over it.
 *
 * Ported from the standalone NFL-Advanced-Player-Stats app
 * (statchasersff-bit/NFL-Advanced-Player-Stats), a Vite SPA that WordPress
 * mounted in an iframe at /nfl/nfl-player-stats/. It fetched one JSON table per
 * (position, season) in the browser and drew a sortable, grouped table from it,
 * with the StatChasers composite grades computed client-side and appended as
 * the last column group. Everything that decides WHAT the table says — the
 * column groups, the header labels, the tooltips, the default qualifiers, the
 * grade engines and their weights, the leader cards — is that app's and is
 * reproduced here unchanged. What is new is where it runs: on the server, so
 * `[statchasers_player_stats]` prints a finished table into the page the way
 * the other tools do.
 *
 * The data files are the ones that app's WordPress plugin shipped
 * (`dist/data/advanced/<pos>_advanced_stats_<season>.json`), renamed to
 * `<pos>_<season>.json`. They are NOT the same bytes as
 * `data/player/advanced_stats/`, which the player pages read: that copy is an
 * earlier cut of the same pipeline, with different default-visible flags and no
 * `airYardsPerAttempt` for quarterbacks — and the grade engine weights that
 * column. The player pages were built against theirs, so each tool keeps the
 * files it was built against rather than one of them silently changing.
 *
 * Two things that were client work over there are server work here:
 *
 *   - **player links** resolve through the player dictionary by Sleeper id
 *     (every row carries one) to this app's own player pages, instead of
 *     slugifying the display name into a statchasers.com URL. A player with no
 *     page keeps his row and loses his link, which is rule 1 of every renderer
 *     here — the standalone app linked every name, page or no page;
 *   - **headshots** on the leader cards come straight from the row's Sleeper
 *     id, rather than from the 14 MB Sleeper dictionary the standalone app
 *     downloaded into localStorage to look the id up by name.
 */

import fs from "node:fs";
import path from "node:path";
import { dataPath } from "../data-dir";
import { logger } from "../logger";
import { atLeast, type GradeOptions } from "./scores/percentiles";
import { loadIndexedSlugs, loadPlayers } from "../player/data";
import {
  computeQbCompositeScores,
  isQualifiedQb,
  QB_SCORE_CATEGORIES,
} from "./scores/qbCompositeScores";
import {
  computeRbCompositeScores,
  isQualifiedRb,
  RB_SCORE_CATEGORIES,
} from "./scores/rbCompositeScores";
import {
  computeTeCompositeScores,
  computeWrCompositeScores,
  inProgressCategories,
  isQualifiedTe,
  isQualifiedWr,
  TE_SCORE_CATEGORIES,
  WR_SCORE_CATEGORIES,
} from "./scores/receivingComposites";

const DATA_DIR = dataPath("player-stats");

/* ------------------------------------------------------------------- shape */

export const STATS_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export type StatsPosition = (typeof STATS_POSITIONS)[number];

/** A single season, or "all" for the multi-season table. */
export type StatsSeason = number | "all";

export const POSITION_NAMES: Record<StatsPosition, string> = {
  QB: "Quarterback",
  RB: "Running Back",
  WR: "Wide Receiver",
  TE: "Tight End",
};

export const POSITION_PLURALS: Record<StatsPosition, string> = {
  QB: "quarterbacks",
  RB: "running backs",
  WR: "wide receivers",
  TE: "tight ends",
};

export type ColumnType = "string" | "number" | "decimal";

export interface StatsColumn {
  key: string;
  label: string;
  type: ColumnType;
  tooltip: string | null;
  /** A StatChasers grade rather than a feed column. */
  isScore: boolean;
  /** A season total the Per Game switch divides by games played. */
  perGame: boolean;
  /**
   * Still covers weeks 1-18: the tables are cut to weeks 1-17, but this
   * column has no week-by-week source (see scripts/player-stats/buildWeeks.mjs).
   */
  fullSeason: boolean;
}

export interface StatsGroup {
  label: string;
  columns: StatsColumn[];
}

export interface StatsRow {
  /** The feed row plus the grade fields, keyed as the columns are. */
  values: Record<string, unknown>;
  name: string;
  team: string | null;
  /** Sleeper id, which is what the headshot URL is built from. */
  playerId: string | null;
  /** This app's player-page slug, when the player has a page. */
  slug: string | null;
  /** Meets the grade qualifier; the rest wear the "LS" badge. */
  qualified: boolean;
  /** Passes the position's default filters, so it shows before JS runs. */
  shownByDefault: boolean;
}

/** One leader as printed: the figure, a line of context under it, and who. */
export interface LeaderFigure {
  /** "277", "44.0%". */
  figure: string;
  /** "138.5 per game", "277 total", "on 22 targets". */
  note: string;
  player: StatsRow | null;
}

export interface LeaderCard {
  /** "Receiving Yards Leader". */
  title: string;
  key: string;
  total: LeaderFigure;
  /**
   * The same category led per game — shown while the Per Game switch is on,
   * and often a different player. Null for a figure that is already a rate.
   */
  perGame: LeaderFigure | null;
}

/** The thresholds the filter bar opens on. */
export interface Thresholds {
  minGP: number;
  minSnapPct: number;
  minRushAtt: number;
  minTgt: number;
  minPassAtt: number;
}

export interface StatsTable {
  position: StatsPosition;
  season: StatsSeason;
  /** "2025 Season", or "2023-2025" for the multi-season table. */
  seasonLabel: string;
  /** The week the feed runs through, when it says so. */
  week: number | null;
  /** "1-17" when the table is cut to the fantasy season. */
  weeks: string | null;
  /** ISO timestamp the feed was built at. */
  updatedAt: string | null;
  groups: StatsGroup[];
  /** Sorted by the overall grade, best first, which is the table's opening sort. */
  rows: StatsRow[];
  cards: LeaderCard[];
  defaults: Thresholds;
  overallKey: string;
  /** Tooltip on the "LS" badge. */
  lsTooltip: string;
  /** Short qualifier phrase for the footer. */
  lsFooter: string;
  /** Fingerprint of the file this was built from — the response ETag. */
  version: string;
}

/* --------------------------------------------------------- column grouping */

/*
 * Grouped column headers — a banner row spanning related columns — keyed by
 * position. Keys must match the JSON columns and appear in display order so
 * each group stays contiguous; a key the feed does not carry is skipped. QB
 * and RB started as the standalone app's ADVANCED_GROUPS; WR/TE diverge on
 * purpose — FPTS and AY/Rec moved into the receiving group.
 *
 * The labels are the SEO brief's (2026-09-23): each group is named for what
 * people search for — "Receiving Stats", "Rushing Stats", "Passing Stats" —
 * rather than for an abstraction like "Production". They are crawlable page
 * content, printed in the table's banner row and on the section pills.
 */
const WR_TE_GROUPS: Array<{ label: string; keys: string[] }> = [
  { label: "Player Info", keys: ["position", "age", "games"] },
  {
    label: "Usage & Opportunity",
    keys: [
      "snapPct", "routes", "routePct", "targets", "targetSharePct", "targetsPerRouteRun",
      "airYardsPerTarget", "airYardsSharePct", "wopr", "redZoneTargets", "endZoneTargets",
    ],
  },
  {
    label: "Receiving Stats",
    keys: [
      "fantasyPoints", "receptions", "receivingYards", "yardsPerReception", "airYardsPerReception",
      "yardsBeforeCatchPerReception", "yardsAfterCatchPerReception", "yardsPerRouteRun",
      "receivingTouchdowns", "epaPerPlay", "successRate",
    ],
  },
  {
    label: "Efficiency & Hands",
    keys: ["catchPct", "catchableTargets", "drops", "dropPct", "interceptionsWhenTargeted", "fumbles"],
  },
  { label: "YAC & Elusiveness", keys: ["avoidedTackleRate", "brokenTackles"] },
  {
    label: "Explosive Plays",
    keys: [
      "receptions10Plus", "receptions20Plus", "receptions30Plus", "receptions40Plus",
      "receptions50Plus", "longestReception",
    ],
  },
];

const FEED_GROUPS: Record<StatsPosition, Array<{ label: string; keys: string[] }>> = {
  QB: [
    { label: "Player Info", keys: ["age", "games", "fantasyPoints"] },
    {
      label: "Passing Stats",
      keys: [
        "attempts", "completions", "passingYards", "airYards", "completedAirYards",
        "redZoneAttempts", "passingTouchdowns",
      ],
    },
    { label: "Rushing Stats", keys: ["rushAttempts", "rushYards", "rushTouchdowns"] },
    {
      label: "Passing Efficiency",
      keys: [
        "airYardsPerAttempt", "completedAirYardsPerCompletion", "yardsPerCatch",
        "completionPct", "onTargetPct", "poorThrows", "badThrowPct", "interceptions",
        "epaPerPlay", "successRate", "cpoe",
      ],
    },
    {
      label: "Explosive Plays",
      keys: [
        "passes10Plus", "passes20Plus", "passes30Plus", "passes40Plus", "passes50Plus",
        "longestPass", "deepAttemptPct",
      ],
    },
    {
      label: "Pressure & Pocket",
      keys: [
        "pocketTime", "timeToThrow", "throwaways", "battedPasses", "scrambleRate",
        "yardsPerScramble", "hurries", "blitzes", "knockdowns", "sacks", "sackYardsLost",
        "fumbles", "pressurePct",
      ],
    },
  ],
  RB: [
    { label: "Player Info", keys: ["age", "games", "fantasyPoints"] },
    {
      label: "Usage & Opportunity",
      keys: [
        "snapPct", "routes", "rushAttempts", "redZoneOpportunities", "goalLineCarries",
        "targets", "targetSharePct", "receptions", "redZoneTargets", "endZoneTargets",
      ],
    },
    { label: "Rushing Stats", keys: ["rushYards", "yardsPerCarry", "rushTouchdowns", "epaPerPlay"] },
    {
      label: "Receiving Stats",
      keys: [
        "receivingYards", "yardsPerReception", "receivingYardsAfterCatch", "yardsPerRouteRun",
        "receivingTouchdowns",
      ],
    },
    {
      label: "Explosive Plays",
      keys: [
        "rushes10Plus", "rushes20Plus", "rushes30Plus", "rushes40Plus", "rushes50Plus",
        "explosiveRunPct", "breakawayRunPct", "longestRush", "longestRushTouchdown",
      ],
    },
    {
      label: "Contact & Tackle Breaking",
      keys: [
        "brokenTackles", "rushAttemptsPerBrokenTackle", "yardsBeforeContactPerAttempt",
        "yardsAfterContactPerAttempt", "tackleEludedRate",
      ],
    },
    {
      label: "Ball Security / Negative Plays",
      keys: ["fumbles", "tacklesForLoss", "tacklesForLossYards", "rushAttForNegativeYards"],
    },
  ],
  WR: WR_TE_GROUPS,
  TE: WR_TE_GROUPS,
};

/*
 * Display-label overrides keyed by JSON column key. The feeds ship
 * inconsistent header labels across seasons, so these keep the headers stable
 * regardless of which file is open. Verbatim from the standalone app.
 */
const COLUMN_LABELS: Record<string, string> = {
  airYards: "Air Yds",
  airYardsPerAttempt: "AY / Att",
  completedAirYardsPerCompletion: "AY / Cmp",
  yardsPerCatch: "Yds / Cmp",
  onTargetPct: "% On Tgt",
  timeToThrow: "Time / Thrw",
  battedPasses: "Bat",
  scrambleRate: "SCR%",
  yardsPerScramble: "Yds / Scr",
  sacks: "SCK",
  routes: "RTS",
  targetSharePct: "TGT%",
  yardsPerCarry: "YDS/CAR",
  yardsPerReception: "YDS/REC",
  explosiveRunPct: "Expl %",
  breakawayRunPct: "Break Away%",
  brokenTackles: "BRKN TKL",
  tackleEludedRate: "Elude %",
  rushAttForNegativeYards: "Neg ATT",
  airYardsSharePct: "Air Yd Share%",
  routePct: "RTE%",
  yardsBeforeCatchPerReception: "YBC/REC",
  yardsAfterCatchPerReception: "YAC/REC",
};

/** Hover explanations for every data column. Verbatim from the standalone app. */
const COLUMN_TOOLTIPS: Record<string, string> = {
  // Identity
  position: "Player position.",
  age: "Player age during the season.",
  games: "Games played.",
  fantasyPoints: "Total fantasy points scored.",
  totalYards: "Total yards from scrimmage (rushing + receiving).",
  snapPct: "Snap share — share of the team’s offensive snaps played.",

  // Passing volume
  attempts: "Pass attempts.",
  completions: "Completed passes.",
  completionPct: "Completion percentage — completions ÷ attempts.",
  passingYards: "Total passing yards.",
  passingTouchdowns: "Passing touchdowns.",
  interceptions: "Interceptions thrown.",
  yardsPerCatch: "Yards per completion.",
  redZoneAttempts: "Pass attempts inside the opponent’s 20-yard line.",

  // Air yards / aggressiveness
  airYards: "Air yards — total distance the ball traveled in the air on all attempts, measured to the target (completed or not).",
  completedAirYards: "Completed air yards — air yards on completed passes only.",
  completedAirYardsPerCompletion: "Average completed air yards per completion — how far downfield completions travel before the catch.",
  airYardsPerAttempt: "Air yards per attempt — average depth of target. Higher = more aggressive downfield passing.",
  deepAttemptPct: "Deep-attempt rate — share of pass attempts thrown 20+ yards downfield.",

  // Rushing (QB)
  rushAttempts: "Rushing attempts.",
  rushYards: "Rushing yards.",
  rushTouchdowns: "Rushing touchdowns.",
  scrambleRate: "Scramble rate — share of dropbacks that became scrambles.",
  yardsPerScramble: "Average yards gained per scramble.",

  // Accuracy
  onTargetPct: "On-target rate — share of throws placed on target (excludes spikes, throwaways, batted, and hit-as-thrown).",
  poorThrows: "Poor throws — count of inaccurately placed throws (excludes spikes/throwaways).",
  badThrowPct: "Bad-throw rate — share of throws graded as inaccurate.",

  // Efficiency
  epaPerPlay: "Expected Points Added per play — average value added over expectation on each play (dropback for QBs, rush/target for skill players).",
  successRate: "Success rate — share of plays that produced positive EPA.",
  cpoe: "Completion Percentage Over Expected — actual vs. expected completion rate given throw difficulty; isolates accuracy from scheme.",

  // Explosive pass plays
  passes10Plus: "Completed passes gaining 10+ yards.",
  passes20Plus: "Completed passes gaining 20+ yards.",
  passes30Plus: "Completed passes gaining 30+ yards.",
  passes40Plus: "Completed passes gaining 40+ yards.",
  passes50Plus: "Completed passes gaining 50+ yards.",
  longestPass: "Longest completed pass (yards).",

  // Pressure & pocket
  pocketTime: "Average seconds in the pocket before throwing, scrambling, or being sacked.",
  timeToThrow: "Average seconds from snap to release.",
  throwaways: "Throwaways — intentional incompletions thrown to avoid a sack.",
  battedPasses: "Passes batted down at the line of scrimmage.",
  hurries: "Times hurried by the pass rush.",
  blitzes: "Times the QB faced a blitz (5+ pass rushers).",
  knockdowns: "Knockdowns — times hit by a defender just after releasing the throw.",
  sacks: "Times sacked.",
  sackYardsLost: "Yards lost on sacks.",
  fumbles: "Fumbles.",
  pressurePct: "Pressure rate — share of dropbacks under pressure (hurried, hit, or sacked).",

  // Receiving (WR/TE)
  receptions: "Receptions (catches).",
  targets: "Times targeted.",
  receivingYards: "Receiving yards.",
  receivingTouchdowns: "Receiving touchdowns.",
  yardsPerReception: "Yards per reception.",
  longestReception: "Longest reception (yards).",
  catchPct: "Catch rate — receptions ÷ targets.",
  catchableTargets: "Catchable targets — targets graded as catchable.",
  drops: "Dropped catchable passes.",
  passesDropped: "Dropped catchable passes.",
  dropPct: "Drop rate — drops ÷ catchable targets.",
  routes: "Routes run.",
  routePct: "Route participation — share of team pass plays on which the player ran a route.",
  targetSharePct: "Target share — share of the team’s targets.",
  airYardsSharePct: "Air-yards share — share of the team’s air yards.",
  airYardsPerTarget: "Air yards per target — average depth of target.",
  airYardsPerReception: "Air yards per reception.",
  wopr: "Weighted Opportunity Rating — blends target share and air-yards share into one usage metric.",
  targetsPerRouteRun: "Targets per route run — how often a route earns a target.",
  yardsPerRouteRun: "Yards per route run — receiving yards ÷ routes run; a premier efficiency metric.",
  yardsAfterCatchPerReception: "Yards after the catch, per reception.",
  yardsBeforeCatchPerReception: "Yards before the catch, per reception (air yards on completions).",
  yardsAfterContactPerReception: "Yards after contact, per reception.",
  brokenTackles: "Broken / avoided tackles.",
  avoidedTackleRate: "Avoided-tackle rate — share of catches with a broken or avoided tackle.",
  contestedCatchRate: "Contested-catch rate — catch rate on contested targets.",
  redZoneTargets: "Targets inside the opponent’s 20-yard line.",
  endZoneTargets: "Targets thrown into the end zone.",
  interceptionsWhenTargeted: "Interceptions thrown on passes targeting this player.",
  receptions10Plus: "Receptions gaining 10+ yards.",
  receptions20Plus: "Receptions gaining 20+ yards.",
  receptions30Plus: "Receptions gaining 30+ yards.",
  receptions40Plus: "Receptions gaining 40+ yards.",
  receptions50Plus: "Receptions gaining 50+ yards.",

  // Rushing usage & opportunity (RB)
  redZoneOpportunities: "Red-zone opportunities — carries plus targets inside the opponent’s 20-yard line.",
  goalLineCarries: "Goal-line carries — rush attempts inside the opponent’s 5-yard line.",
  yardsPerCarry: "Yards per carry — rushing yards ÷ rush attempts.",
  receivingYardsAfterCatch: "Receiving yards after the catch (season total).",

  // Explosive runs (RB)
  rushes10Plus: "Rushes gaining 10+ yards.",
  rushes20Plus: "Rushes gaining 20+ yards.",
  rushes30Plus: "Rushes gaining 30+ yards.",
  rushes40Plus: "Rushes gaining 40+ yards.",
  rushes50Plus: "Rushes gaining 50+ yards.",
  explosiveRunPct: "Explosive-run rate — share of carries gaining 10+ yards.",
  breakawayRunPct: "Breakaway rate — share of rushing yards gained on runs of 15+ yards.",
  longestRush: "Longest rush (yards).",
  longestRushTouchdown: "Longest rushing touchdown (yards).",

  // Contact & tackle-breaking (RB)
  rushAttemptsPerBrokenTackle: "Rush attempts per broken tackle — carries needed per broken/avoided tackle (lower = more elusive).",
  yardsBeforeContactPerAttempt: "Yards before contact per attempt — open space created before first contact.",
  yardsAfterContactPerAttempt: "Yards after contact per attempt — yards earned after first contact (power & balance).",
  tackleEludedRate: "Tackles-eluded rate — share of touches with a broken or avoided tackle.",

  // Negative plays (RB)
  tacklesForLoss: "Times tackled behind the line of scrimmage.",
  tacklesForLossYards: "Yards lost on tackles for loss.",
  rushAttForNegativeYards: "Rush attempts that lost yardage (negative gain).",
};

/*
 * Which columns the Totals / Per Game switch divides. Every whole-number feed
 * column is a season count, except these: an age, the divisor itself, and the
 * single longest plays. FPTS is a decimal total and joins them. Rates,
 * averages and shares are already per something and never change.
 */
const NOT_PER_GAME = new Set([
  "age", "games", "longestPass", "longestRush", "longestRushTouchdown", "longestReception",
]);

function isPerGame(key: string, type: ColumnType): boolean {
  if (key === "fantasyPoints") return true;
  return type === "number" && !NOT_PER_GAME.has(key);
}

/* ------------------------------------------------------------- the grades */

interface ScoreSystem {
  groupLabel: string;
  categories: Array<{ key: string; label: string; description: string }>;
  /** Categories whose tooltips describe a season in progress, where they differ. */
  inProgressCategories?: Array<{ key: string; label: string; description: string }>;
  overallKey: string;
  compute: (rows: Array<Record<string, unknown>>, opts?: GradeOptions) => Array<Record<string, number>>;
  isQualified: (row: Record<string, unknown>, scale?: number) => boolean;
  /** `q` is a qualifier floor at the season's scale (see atLeast()). */
  lsTooltip: (q: (n: number) => number) => string;
  lsFooter: (q: (n: number) => number) => string;
}

/* ----------------------------------------------------------- leader cards */

interface StatCard {
  title: string;
  /** The feed column, or a name for `value` when there is no column. */
  key: string;
  /** For a figure the feed has no column for. */
  value?: (row: Record<string, unknown>) => number | null;
  /** A share, printed with a % sign. Already a rate, so never per game. */
  percent?: boolean;
  decimals?: number;
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return v == null || !Number.isFinite(n) ? null : n;
};

/** Receivers' air yards: the feed carries AY/TGT, not the total. */
const receiverAirYards = (row: Record<string, unknown>): number | null => {
  const perTarget = num(row["airYardsPerTarget"]);
  const targets = num(row["targets"]);
  return perTarget == null || targets == null ? null : perTarget * targets;
};

/**
 * The stat leaders over each position's table — the SEO brief's "NFL stats
 * leaders" (2026-09-23), which replaced a card per grade. Plain stats people
 * search for, each with its figure.
 */
const STAT_CARDS: Record<StatsPosition, StatCard[]> = {
  QB: [
    { title: "Fantasy Points Leader", key: "fantasyPoints", decimals: 1 },
    { title: "Passing Yards Leader", key: "passingYards" },
    { title: "Passing TD Leader", key: "passingTouchdowns" },
    { title: "Air Yards Leader", key: "airYards" },
    { title: "QB Rushing Yards Leader", key: "rushYards" },
  ],
  RB: [
    { title: "Fantasy Points Leader", key: "fantasyPoints", decimals: 1 },
    { title: "Rushing Yards Leader", key: "rushYards" },
    { title: "Rushing TD Leader", key: "rushTouchdowns" },
    { title: "Target Leader", key: "targets" },
    { title: "Receiving Yards Leader", key: "receivingYards" },
  ],
  WR: [
    { title: "Receiving Yards Leader", key: "receivingYards" },
    { title: "Target Leader", key: "targets" },
    { title: "Fantasy Points Leader", key: "fantasyPoints", decimals: 1 },
    { title: "Target Share Leader", key: "targetSharePct", percent: true, decimals: 1 },
    { title: "Air Yards Leader", key: "airYards", value: receiverAirYards },
  ],
  TE: [
    { title: "Receiving Yards Leader", key: "receivingYards" },
    { title: "Target Leader", key: "targets" },
    { title: "Fantasy Points Leader", key: "fantasyPoints", decimals: 1 },
    { title: "Target Share Leader", key: "targetSharePct", percent: true, decimals: 1 },
    { title: "Air Yards Leader", key: "airYards", value: receiverAirYards },
  ],
};

/** A season figure: "277", "51.7", "44.0%". */
function cardFigure(card: StatCard, value: number): string {
  const figure = value.toLocaleString("en-US", {
    minimumFractionDigits: card.decimals ?? 0,
    maximumFractionDigits: card.decimals ?? 0,
  });
  return card.percent ? `${figure}%` : figure;
}

/**
 * A per-game figure, as the table's Per Game switch prints one: two places
 * under ten ("0.47"), one from ten up ("92.3").
 */
function perGameFigure(value: number): string {
  return value.toFixed(Math.abs(value) >= 10 ? 1 : 2);
}

/** The pool's leader in one category, by `value`; ties go to feed order. */
function leaderOf(
  pool: StatsRow[],
  value: (row: StatsRow) => number | null,
): { row: StatsRow | null; value: number } {
  let best: StatsRow | null = null;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (const row of pool) {
    const v = value(row);
    if (v != null && v > bestValue) {
      bestValue = v;
      best = row;
    }
  }
  return { row: best, value: bestValue };
}

/** Per-position grade systems. Verbatim from the standalone app's SCORE_SYSTEMS. */
const SCORE_SYSTEMS: Record<StatsPosition, ScoreSystem> = {
  QB: {
    groupLabel: "StatChasers QB Grades",
    categories: QB_SCORE_CATEGORIES,
    overallKey: "overallQBGrade",
    compute: computeQbCompositeScores as unknown as ScoreSystem["compute"],
    isQualified: isQualifiedQb,
    lsTooltip: (q) =>
      `Limited sample — under qualifier (${q(5)}+ games, ${q(100)}+ attempts); graded against the qualified QB pool.`,
    lsFooter: (q) => `limited sample (under ${q(5)} G / ${q(100)} Att)`,
  },
  RB: {
    groupLabel: "StatChasers RB Grades",
    categories: RB_SCORE_CATEGORIES,
    overallKey: "overallRBGrade",
    compute: computeRbCompositeScores as unknown as ScoreSystem["compute"],
    isQualified: isQualifiedRb,
    lsTooltip: (q) =>
      `Limited sample — under qualifier (${q(50)}+ rush att or ${q(25)}+ targets); graded against the qualified RB pool.`,
    lsFooter: (q) => `limited sample (under ${q(50)} Rush Att / ${q(25)} Tgt)`,
  },
  WR: {
    groupLabel: "StatChasers WR Grades",
    categories: WR_SCORE_CATEGORIES,
    inProgressCategories: inProgressCategories(WR_SCORE_CATEGORIES),
    overallKey: "overallWRGrade",
    compute: computeWrCompositeScores as unknown as ScoreSystem["compute"],
    isQualified: isQualifiedWr,
    lsTooltip: (q) =>
      `Limited sample — under qualifier (${q(40)}+ targets or ${q(150)}+ routes); graded against the qualified WR pool.`,
    lsFooter: (q) => `limited sample (under ${q(40)} Tgt / ${q(150)} Routes)`,
  },
  TE: {
    groupLabel: "StatChasers TE Grades",
    categories: TE_SCORE_CATEGORIES,
    inProgressCategories: inProgressCategories(TE_SCORE_CATEGORIES),
    overallKey: "overallTEGrade",
    compute: computeTeCompositeScores as unknown as ScoreSystem["compute"],
    isQualified: isQualifiedTe,
    lsTooltip: (q) =>
      `Limited sample — under qualifier (${q(25)}+ targets or ${q(100)}+ routes); graded against the qualified TE pool.`,
    lsFooter: (q) => `limited sample (under ${q(25)} Tgt / ${q(100)} Routes)`,
  },
};

/* ------------------------------------------------------ default qualifiers */

/**
 * The thresholds the filter bar opens on for a position.
 *
 * The multi-season table tightens them — more games, more volume — so a
 * three-year leaderboard is not headed by small samples. Verbatim from the
 * standalone app's getDefaultFilters().
 *
 * A season in progress shrinks the single-season floors by `scale`, the share
 * of the season played, so week 2 does not open on an empty table.
 */
export function defaultThresholds(
  position: StatsPosition,
  multiSeason: boolean,
  scale = 1,
): Thresholds {
  if (multiSeason) {
    if (position === "RB") return { minGP: 18, minSnapPct: 10, minRushAtt: 60, minTgt: 0, minPassAtt: 0 };
    if (position === "QB") return { minGP: 15, minSnapPct: 25, minRushAtt: 0, minTgt: 0, minPassAtt: 150 };
    return { minGP: 15, minSnapPct: 25, minRushAtt: 0, minTgt: 75, minPassAtt: 0 };
  }
  return {
    minGP: atLeast(6, scale),
    minSnapPct: position === "RB" ? 10 : 25,
    minRushAtt: position === "RB" ? atLeast(20, scale) : 0,
    minTgt: position === "WR" || position === "TE" ? atLeast(25, scale) : 0,
    minPassAtt: position === "QB" ? atLeast(50, scale) : 0,
  };
}

/**
 * Does a row pass these thresholds?
 *
 * MIRRORS `passes()` in client/player-stats.ts, which runs the same test
 * against the filter bar's live values. Snap share is only tested where the
 * row has one — the multi-season files leave it null for some players, and a
 * missing figure is not a failing one.
 */
export function passesThresholds(
  row: Record<string, unknown>,
  position: StatsPosition,
  t: Thresholds,
): boolean {
  const n = (key: string): number => Number(row[key] ?? 0);
  if (t.minGP > 0 && n("games") < t.minGP) return false;
  if (t.minSnapPct > 0 && row["snapPct"] != null) {
    const snap = Number(row["snapPct"]);
    if (!Number.isNaN(snap) && snap < t.minSnapPct) return false;
  }
  if (position === "RB" && t.minRushAtt > 0 && n("rushAttempts") < t.minRushAtt) return false;
  if ((position === "WR" || position === "TE") && t.minTgt > 0 && n("targets") < t.minTgt) return false;
  if (position === "QB" && t.minPassAtt > 0 && n("attempts") < t.minPassAtt) return false;
  return true;
}

/* ------------------------------------------------------------ parsing */

export function parsePosition(raw: unknown): StatsPosition | null {
  const value = String(raw ?? "").trim().toUpperCase();
  return (STATS_POSITIONS as readonly string[]).includes(value)
    ? (value as StatsPosition)
    : null;
}

/** A season the files have, or null. `all` is the multi-season table. */
export function parseSeason(raw: unknown): StatsSeason | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "") return null;
  if (value === "all") return getStatsSeasons().includes("all") ? "all" : null;
  if (!/^\d{4}$/.test(value)) return null;
  const year = Number(value);
  return getStatsSeasons().includes(year) ? year : null;
}

/* ------------------------------------------------------------- the seasons */

let seasonsCache: StatsSeason[] | null = null;
/** Seasons whose tables are still being built week by week. */
let inProgressCache = new Set<number>();

/**
 * The seasons on disk, single seasons oldest first and then "all" — the order
 * the season control prints them in.
 *
 * Discovered from the QB files, since every position is published together.
 * Adding a season is a data drop, not a code change.
 */
export function getStatsSeasons(): StatsSeason[] {
  if (seasonsCache) return seasonsCache;

  let names: string[] = [];
  try {
    names = fs.readdirSync(DATA_DIR);
  } catch {
    logger.warn("No data/player-stats directory; the advanced stats table will be empty");
  }

  const years = names
    .map((name) => /^qb_(\d{4})\.json$/.exec(name)?.[1])
    .filter((year): year is string => year !== undefined)
    .map(Number)
    .sort((a, b) => a - b);

  inProgressCache = new Set(
    years.filter((year) => {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `qb_${year}.json`), "utf8")) as RawTable;
        return raw.inProgress === true;
      } catch {
        return false;
      }
    }),
  );
  seasonsCache = names.includes("qb_all.json") ? [...years, "all"] : years;
  return seasonsCache;
}

/** The season a page opens on: the newest single season. */
export function defaultSeason(): StatsSeason | null {
  const years = getStatsSeasons().filter((s): s is number => s !== "all");
  return years.length > 0 ? years[years.length - 1]! : null;
}

/**
 * "2025 Season", or the span the multi-season table covers — the finished
 * seasons, since a season in progress is not in it.
 */
export function seasonLabel(season: StatsSeason): string {
  if (season !== "all") return `${season} Season`;
  const years = getStatsSeasons().filter(
    (s): s is number => s !== "all" && !inProgressCache.has(s),
  );
  return years.length > 0 ? `${years[0]}-${years[years.length - 1]}` : "All seasons";
}

/** The short form, for the season control: "2025" or "2023-2025". */
export function seasonShortLabel(season: StatsSeason): string {
  return season === "all" ? seasonLabel("all") : String(season);
}

/* --------------------------------------------------------- the player index */

let slugById: Map<string, string> | null = null;

/**
 * Sleeper id → player-page slug, for the players who have a page.
 *
 * By id rather than by name, because every row carries its Sleeper id and a
 * name is a guess: "Michael Penix Jr." in the feed is "Michael Penix" in the
 * dictionary.
 */
function playerSlug(id: string | null): string | null {
  if (!id) return null;
  if (!slugById) {
    const indexed = new Set(loadIndexedSlugs());
    slugById = new Map();
    for (const player of loadPlayers()) {
      if (indexed.has(player.slug)) slugById.set(String(player.id), player.slug);
    }
  }
  return slugById.get(id) ?? null;
}

/** Testing seam. */
export function invalidateStatsCache(): void {
  slugById = null;
  seasonsCache = null;
  tableCache.clear();
}

/* ------------------------------------------------------------------ loading */

interface RawColumn {
  key: string;
  label: string;
  type: ColumnType;
  defaultVisible: boolean;
}

interface RawTable {
  updated_at?: string;
  season?: number;
  week?: number;
  weeks?: string;
  fullSeason?: string[];
  /** A season in progress (buildSeason.mjs): the week it runs through is its sample. */
  inProgress?: boolean;
  /** Columns with no source yet, left out of the grades. */
  unavailable?: string[];
  columns?: RawColumn[];
  rows?: Array<Record<string, unknown>>;
}

/**
 * Sort the way the standalone table sorts: missing values last in either
 * direction, numbers numerically, anything else as text.
 */
export function compareValues(a: unknown, b: unknown, desc: boolean): number {
  const aNull = a == null;
  const bNull = b == null;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  const cmp =
    typeof a === "number" && typeof b === "number"
      ? a - b
      : String(a).localeCompare(String(b));
  return desc ? -cmp : cmp;
}

const tableCache = new Map<string, StatsTable>();

/** The identity columns, printed as the pinned cells rather than as metrics. */
const PINNED = new Set(["rank", "playerName", "team", "playerId"]);

/**
 * One position's table for one season, or null when there is no file for it.
 *
 * Cached on the file's mtime, as the rankings board is: replacing a file is
 * what invalidates a render, and nothing else does.
 */
export function getStatsTable(
  position: StatsPosition,
  season: StatsSeason,
): StatsTable | null {
  const file = path.join(DATA_DIR, `${position.toLowerCase()}_${season}.json`);

  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }

  const cacheKey = `${position}_${season}`;
  const version = `${cacheKey}-${Math.round(mtimeMs).toString(36)}`;
  const hit = tableCache.get(cacheKey);
  if (hit && hit.version === version) return hit;

  let raw: RawTable;
  try {
    // The pipeline has been known to emit a bare NaN, which is not JSON. The
    // standalone app scrubbed it on every fetch; this does it once per file.
    raw = JSON.parse(
      fs.readFileSync(file, "utf8").replace(/:\s*NaN\b/g, ": null"),
    ) as RawTable;
  } catch (err) {
    logger.warn({ err, file }, "Could not read an advanced stats table");
    return null;
  }

  const feedRows = Array.isArray(raw.rows) ? raw.rows : [];
  const feedColumns = Array.isArray(raw.columns) ? raw.columns : [];
  if (feedRows.length === 0) return null;

  const system = SCORE_SYSTEMS[position];

  // Grades are percentiles across the WHOLE season's pool, so they stay put
  // however the table is later filtered or sorted.
  // A season in progress is graded and filtered on floors shrunk to the share
  // of the season played; see GradeOptions.
  const scale =
    raw.inProgress && typeof raw.week === "number" && raw.week > 0
      ? Math.min(1, raw.week / 17)
      : 1;
  const q = (n: number): number => atLeast(n, scale);
  const scores = system.compute(feedRows, {
    scale,
    omit: new Set(Array.isArray(raw.unavailable) ? raw.unavailable : []),
  });
  const scored = feedRows.map((row, i) => ({ ...row, ...scores[i] }));

  // Every column that could be shown: the feed's visible columns, relabelled,
  // then the grade columns.
  const available = new Map<string, StatsColumn>();
  const fullSeason = new Set(Array.isArray(raw.fullSeason) ? raw.fullSeason : []);
  for (const col of feedColumns) {
    if (!col.defaultVisible || PINNED.has(col.key)) continue;
    available.set(col.key, {
      key: col.key,
      label: COLUMN_LABELS[col.key] ?? col.label,
      type: col.type,
      tooltip: COLUMN_TOOLTIPS[col.key] ?? null,
      isScore: false,
      // A weeks 1-18 total over weeks 1-17 games would overstate the rate.
      perGame: isPerGame(col.key, col.type) && !fullSeason.has(col.key),
      fullSeason: fullSeason.has(col.key),
    });
  }

  const groups: StatsGroup[] = FEED_GROUPS[position]
    .map((group) => ({
      label: group.label,
      columns: group.keys
        .map((key) => available.get(key))
        .filter((col): col is StatsColumn => col !== undefined),
    }))
    .concat({
      label: system.groupLabel,
      columns: ((scale < 1 && system.inProgressCategories) || system.categories).map((cat) => ({
        key: cat.key,
        label: cat.label,
        type: "number" as const,
        tooltip: cat.description,
        isScore: true,
        perGame: false,
        fullSeason: false,
      })),
    })
    .filter((group) => group.columns.length > 0);

  const multi = season === "all";
  const defaults = defaultThresholds(position, multi, scale);

  const rows: StatsRow[] = scored.map((values) => {
    const id = values["playerId"] == null ? null : String(values["playerId"]);
    const team = String(values["team"] ?? "").trim();
    return {
      values,
      name: String(values["playerName"] ?? ""),
      team: team === "" ? null : team,
      playerId: id,
      slug: playerSlug(id),
      qualified: system.isQualified(values, scale),
      shownByDefault: passesThresholds(values, position, defaults),
    };
  });

  // Leader cards are the season's stat leaders under the DEFAULT thresholds
  // plus the grade qualifier — not the live filters — so a backup with three
  // great snaps never headlines a share. Found in feed order, before the sort
  // below, which is how the standalone app broke ties.
  const eligible = rows.filter((row) => row.shownByDefault && row.qualified);
  const pool = eligible.length > 0 ? eligible : rows;
  // The per-game leaders come from the same pool, less anyone who has played
  // under three quarters of the most games in it — 2 of 2 in week 2, 13 of
  // 17 at the end — so one big game does not lead a per-game category.
  const mostGames = Math.max(0, ...pool.map((row) => num(row.values["games"]) ?? 0));
  const gamesFloor = Math.ceil(mostGames * 0.75);
  const perGamePool = pool.filter((row) => (num(row.values["games"]) ?? 0) >= gamesFloor);
  //
  // The line under each figure is the other reading of it: a total's leader
  // shows their per-game rate, a per-game leader their season total, and a
  // share the volume it was earned on.
  const cards: LeaderCard[] = STAT_CARDS[position].map((card) => {
    const total = (row: StatsRow): number | null =>
      card.value ? card.value(row.values) : num(row.values[card.key]);
    const perGameOf = (row: StatsRow): number | null => {
      const t = total(row);
      const games = num(row.values["games"]);
      return t == null || games == null || games <= 0 ? null : t / games;
    };
    const none: LeaderFigure = { figure: "", note: "", player: null };

    const best = leaderOf(pool, total);
    let note = "";
    if (best.row && card.percent) {
      const targets = num(best.row.values["targets"]);
      note = targets == null ? "" : `on ${targets} targets`;
    } else if (best.row) {
      const pg = perGameOf(best.row);
      note = pg == null ? "" : `${perGameFigure(pg)} per game`;
    }
    const totalFigure: LeaderFigure = best.row
      ? { figure: cardFigure(card, best.value), note, player: best.row }
      : none;

    let perGame: LeaderFigure | null = null;
    if (!card.percent) {
      const top = leaderOf(perGamePool, perGameOf);
      const t = top.row ? total(top.row) : null;
      perGame = top.row
        ? {
            figure: perGameFigure(top.value),
            note: t == null ? "" : `${cardFigure(card, t)} total`,
            player: top.row,
          }
        : none;
    }

    return { title: card.title, key: card.key, total: totalFigure, perGame };
  });

  rows.sort((a, b) =>
    compareValues(a.values[system.overallKey], b.values[system.overallKey], true),
  );

  const table: StatsTable = {
    position,
    season,
    seasonLabel: seasonLabel(season),
    week: typeof raw.week === "number" ? raw.week : null,
    weeks: typeof raw.weeks === "string" ? raw.weeks : null,
    updatedAt: typeof raw.updated_at === "string" ? raw.updated_at : null,
    groups,
    rows,
    cards,
    defaults,
    overallKey: system.overallKey,
    lsTooltip: system.lsTooltip(q),
    lsFooter: system.lsFooter(q),
    version,
  };

  tableCache.set(cacheKey, table);
  logger.info(
    { position, season, players: rows.length },
    "Loaded an advanced stats table",
  );
  return table;
}
