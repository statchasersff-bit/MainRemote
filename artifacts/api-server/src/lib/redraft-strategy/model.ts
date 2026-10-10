/**
 * The redraft draft strategy analyzer's model.
 *
 * A port of the standalone app (statchasersff-bit/RESEARCH-Redraft-Draft-Analysis
 * at 33f0cb3, artifacts/stat-chasers/src): its filter rules (lib/filter-utils.ts),
 * its statistics (lib/stats.ts), and the arithmetic its React components did
 * in render - the strategy table's floor/ceiling scores and row explanations
 * (StrategyTable.tsx), the ranking chart's tiers and axis (StrategyCharts.tsx),
 * the round value cut-off (RoundValueTable.tsx), the year-over-year
 * comparison's pooled and season-balanced averages, volatility and sample
 * gates (CompareTable.tsx, CompareRoundValueTable.tsx), the Robust RB period
 * chips (RobustRbRebound.tsx) and the draft board's grid, pick numbers and
 * positional ranks (DraftBoard.tsx). Pure: no DOM, no fs, so the server and
 * the browser bundle share it and agree.
 *
 * The data is the app's own pipeline output, trimmed by
 * scripts/redraft-strategy/buildData.mjs to the fields read here.
 */

/* --------------------------------------------------------------- filters */

export type Qb = "one_qb" | "superflex";
export type Scoring = "ppr" | "half_ppr";
export type Tep = "no_tep" | "tep";
export type Size = "10" | "12";
export type SeasonYear = "2021" | "2022" | "2023" | "2024" | "2025";
export type Season = SeasonYear | "compare";

export interface Filters {
  qb: Qb;
  scoring: Scoring;
  tep: Tep;
  size: Size;
  season: Season;
}

export const SEASON_YEARS: readonly SeasonYear[] = ["2021", "2022", "2023", "2024", "2025"];

/** The app's default route: /redraft-draft-strategy-analysis/2025/1qb/ppr/no-tep/12. */
export const DEFAULT_FILTERS: Filters = { qb: "one_qb", scoring: "ppr", tep: "no_tep", size: "12", season: "2025" };

export const SEASON_OPTIONS: { value: Season; label: string }[] = [
  { value: "2021", label: "2021" },
  { value: "2022", label: "2022" },
  { value: "2023", label: "2023" },
  { value: "2024", label: "2024" },
  { value: "2025", label: "2025" },
  { value: "compare", label: "2021-2025" },
];

export type FormatKey = "qb" | "scoring" | "tep" | "size";
const FORMAT_KEYS: FormatKey[] = ["qb", "scoring", "tep", "size"];

/**
 * League settings whose combination sampled too few leagues to report. The
 * app does not offer these; the pill that would complete one is disabled.
 */
export const UNSUPPORTED_FORMATS: Pick<Filters, FormatKey>[] = [
  { qb: "one_qb", scoring: "half_ppr", tep: "tep", size: "10" },
  { qb: "superflex", scoring: "half_ppr", tep: "tep", size: "10" },
];

export function isUnsupportedFormat(f: Pick<Filters, FormatKey>): boolean {
  return UNSUPPORTED_FORMATS.some((spec) => FORMAT_KEYS.every((k) => f[k] === spec[k]));
}

/** Would picking `value` for `key` land on an unsupported format? */
export function wouldSelectUnsupportedFormat<K extends FormatKey>(
  current: Pick<Filters, FormatKey>,
  key: K,
  value: Filters[K],
): boolean {
  return UNSUPPORTED_FORMATS.some(
    (spec) => spec[key] === value && FORMAT_KEYS.every((k) => k === key || current[k] === spec[k]),
  );
}

/** A stale address on an unsupported format is nudged to 12 teams. */
export function coerceSupportedFormat(f: Filters): Filters {
  return isUnsupportedFormat(f) ? { ...f, size: "12" } : f;
}

export function comboKey(f: Filters): string {
  return `${f.qb}__${f.scoring}__${f.tep}__${f.size}__${f.season}`;
}

/** The comparison has no season dimension. */
export function trendKey(f: Pick<Filters, FormatKey>): string {
  return `${f.qb}__${f.scoring}__${f.tep}__${f.size}`;
}

const KEY_RE = /^[a-z0-9_]{1,60}$/;

/** A combo or trend key as a request names it, or null for anything else. */
export function parseKey(value: string): string | null {
  return KEY_RE.test(value) ? value : null;
}

const QBS: Qb[] = ["one_qb", "superflex"];
const SCORINGS: Scoring[] = ["ppr", "half_ppr"];
const TEPS: Tep[] = ["no_tep", "tep"];
const SIZES: Size[] = ["10", "12"];
const SEASONS: Season[] = [...SEASON_YEARS, "compare"];

/** Filters out of loose strings (the bundle's controls); unknown values keep the default. */
export function parseFilters(raw: Partial<Record<keyof Filters, string | null | undefined>>): Filters {
  const pick = <T extends string>(list: readonly T[], v: string | null | undefined, d: T): T =>
    list.includes(v as T) ? (v as T) : d;
  return coerceSupportedFormat({
    qb: pick(QBS, raw.qb, DEFAULT_FILTERS.qb),
    scoring: pick(SCORINGS, raw.scoring, DEFAULT_FILTERS.scoring),
    tep: pick(TEPS, raw.tep, DEFAULT_FILTERS.tep),
    size: pick(SIZES, raw.size, DEFAULT_FILTERS.size),
    season: pick(SEASONS, raw.season, DEFAULT_FILTERS.season),
  });
}

/* ------------------------------------------------------------------ data */

export interface StrategyRow {
  strategy: string;
  sample_size: number;
  playoff_rate: number;
  championship_rate: number;
  top_3_pf_rate?: number;
  average_points_for: number;
  playoff_rate_lift: number;
  confidence_level: string;
}

export interface RoundPosition {
  strategy: string;
  sample_size: number;
  playoff_rate: number;
  championship_rate: number;
  top_3_pf_rate?: number;
  average_points_for?: number;
}

export interface RoundData {
  round: number;
  positions: RoundPosition[];
}

export interface Baseline {
  playoff_rate: number | null;
  championship_rate: number | null;
  top_3_pf_rate: number | null;
  average_points_for: number | null;
}

/** One league format in one season: data/redraft-strategy/combos/<key>.json. */
export interface Combo {
  label: string;
  sample_size: number;
  league_count: number;
  baseline: Baseline;
  best_strategies: StrategyRow[];
  worst_strategies: StrategyRow[];
  best_first_two_pick_combos: StrategyRow[];
  best_first_five_builds: StrategyRow[];
  round_value: { rounds: RoundData[] };
}

/** A strategy or pick combo across the seasons: one row of a trend. */
export interface TrendRow {
  strategy?: string;
  combo?: string;
  comparison_quality: string;
  trend_label: string;
  playoff_rate_change_pp?: number;
  [key: string]: string | number | undefined;
}

export interface TrendRoundPosition {
  position: string;
  comparison_quality: string;
  trend_label: string;
  [key: string]: string | number | undefined;
}

export interface TrendRound {
  round: number;
  positions: TrendRoundPosition[];
}

/** One league format across 2021-2025: data/redraft-strategy/trends/<key>.json. */
export interface Trend {
  label: string;
  overall_strategies: TrendRow[];
  first_two_pick_combos: TrendRow[];
  round_value: TrendRound[];
  [key: string]: string | number | TrendRow[] | TrendRound[] | undefined;
}

export interface Summary {
  generated_at: string;
  seasons: string[];
  total_leagues: number;
  total_teams: number;
  baseline: Baseline;
  best_overall_strategies: StrategyRow[];
  worst_overall_strategies: StrategyRow[];
}

export interface BoardPick {
  round: number;
  slot: number;
  roster_id: number;
  name: string;
  position: string;
  nfl_team: string;
  pick_no: number;
  /** The Sleeper player id, which the headshot pipeline keys on; absent when unresolved. */
  player_id?: string;
}

/**
 * Where the browser finds this server's headshots, and which version each
 * pick's photo is at: `null` for a player with no photo, absent when not yet
 * known (the renderer then asks for `latest`). Attached per request by the
 * server; the renderer runs in the browser too, so it cannot read the version
 * store itself.
 */
export interface RdsAssets {
  origin: string;
  headshots: Record<string, string | null>;
}

export interface BoardStrategy {
  strategy: string;
  roster_id: number;
  slot: number;
}

export interface Board {
  draft_id: string;
  label: string;
  index: number;
  total: number;
  num_teams: number;
  num_rounds: number;
  strategies: BoardStrategy[];
  picks: BoardPick[];
}

/** Everything the server renders the default view from. */
export interface Dataset {
  summary: Summary;
  combos: Record<string, Combo>;
  trends: Record<string, Trend>;
  boards: Board[];
  assets?: RdsAssets;
}

/** A number off a trend row, or undefined. */
export function num(row: Record<string, unknown>, key: string): number | undefined {
  const v = row[key];
  return typeof v === "number" ? v : undefined;
}

/* ------------------------------------------------------------ statistics */

/*
 * The app's lib/stats.ts. Every rate here is a proportion from a finite sample
 * of teams; these attach the uncertainty. The intervals treat teams as
 * independent, which understates the truth somewhat: a league has a fixed
 * number of playoff spots, so one team's success is another's failure. The
 * app says so on the page (the methodology note) and so does this.
 */

const Z_95 = 1.96;

export interface Interval {
  low: number;
  high: number;
  halfWidth: number;
}

/** Wilson score 95% interval for a proportion; null for an empty sample. */
export function wilson95(p: number, n: number): Interval | null {
  if (!Number.isFinite(p) || !Number.isFinite(n) || n <= 0) return null;
  const clamped = Math.min(1, Math.max(0, p));
  const z2 = Z_95 * Z_95;
  const denom = 1 + z2 / n;
  const center = (clamped + z2 / (2 * n)) / denom;
  const margin = (Z_95 / denom) * Math.sqrt((clamped * (1 - clamped)) / n + z2 / (4 * n * n));
  const low = Math.max(0, center - margin);
  const high = Math.min(1, center + margin);
  return { low, high, halfWidth: (high - low) / 2 };
}

export interface SeasonPoint {
  rate: number | undefined | null;
  n: number | undefined | null;
}

export interface AggregateResult {
  rate: number;
  n: number;
  seasons: number;
  ci: Interval | null;
}

/** Every team equal weight: successes and samples summed across seasons. */
export function pooled(points: SeasonPoint[]): AggregateResult {
  let totalSucc = 0;
  let totalN = 0;
  let seasons = 0;
  for (const { rate, n } of points) {
    if (rate == null || n == null || n <= 0) continue;
    totalSucc += rate * n;
    totalN += n;
    seasons += 1;
  }
  const rate = totalN > 0 ? totalSucc / totalN : 0;
  return { rate, n: totalN, seasons, ci: wilson95(rate, totalN) };
}

/** Every season equal weight: the mean of the per-season rates, intervals combined. */
export function seasonBalanced(points: SeasonPoint[]): AggregateResult {
  const valid = points.filter((p): p is { rate: number; n: number } => p.rate != null && p.n != null && p.n > 0);
  const k = valid.length;
  let totalN = 0;
  for (const p of valid) totalN += p.n;
  if (k === 0) return { rate: 0, n: 0, seasons: 0, ci: null };
  const rate = valid.reduce((a, p) => a + p.rate, 0) / k;
  let sumSqHalf = 0;
  let anyCi = false;
  for (const p of valid) {
    const ci = wilson95(p.rate, p.n);
    if (ci) {
      sumSqHalf += ci.halfWidth * ci.halfWidth;
      anyCi = true;
    }
  }
  let ci: Interval | null = null;
  if (anyCi) {
    const halfWidth = Math.sqrt(sumSqHalf) / k;
    ci = { low: Math.max(0, rate - halfWidth), high: Math.min(1, rate + halfWidth), halfWidth };
  }
  return { rate, n: totalN, seasons: k, ci };
}

export type Weighting = "pooled" | "balanced";

export function aggregate(points: SeasonPoint[], weighting: Weighting): AggregateResult {
  return weighting === "pooled" ? pooled(points) : seasonBalanced(points);
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "-";
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtCiPp(ci: Interval | null): string {
  if (!ci) return "";
  return `±${(ci.halfWidth * 100).toFixed(1)} pp`;
}

export function fmtCiRange(ci: Interval | null): string {
  if (!ci) return "";
  return `[${(ci.low * 100).toFixed(1)}%, ${(ci.high * 100).toFixed(1)}%]`;
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/* ---------------------------------------------------------- trust tiers */

export interface TrustTier {
  label: string;
  rank: number;
}

/** The app's lib/trustScore.ts: a label for a sample size. */
export function trustTier(sampleSize: number): TrustTier {
  if (sampleSize >= 5000) return { label: "Elite Sample", rank: 5 };
  if (sampleSize >= 1000) return { label: "Strong Sample", rank: 4 };
  if (sampleSize >= 250) return { label: "Reliable", rank: 3 };
  if (sampleSize >= 50) return { label: "Directional", rank: 2 };
  return { label: "Insufficient", rank: 1 };
}

/* -------------------------------------------------------- strategy table */

export interface ScoredRow extends StrategyRow {
  safety_score: number;
  upside_score: number;
}

export type SortDir = "asc" | "desc";
export type StrategySortKey = keyof ScoredRow;

export interface TableState {
  sortKey: StrategySortKey;
  sortDir: SortDir;
  /** Rows under the table's sample threshold are shown too. */
  showLow: boolean;
  /** Open rows, by strategy name. */
  expanded: string[];
}

export function defaultTableState(): TableState {
  return { sortKey: "playoff_rate_lift", sortDir: "desc", showLow: false, expanded: [] };
}

/**
 * Best and worst lists merged into one set, first occurrence kept. The table
 * sorts by lift, so the best land at the top and the worst at the bottom.
 */
export function mergeStrategies(...lists: Array<StrategyRow[] | undefined>): StrategyRow[] {
  const byName = new Map<string, StrategyRow>();
  for (const list of lists) {
    for (const row of list ?? []) {
      if (row?.strategy != null && !byName.has(row.strategy)) byName.set(row.strategy, row);
    }
  }
  return Array.from(byName.values());
}

/**
 * Floor and ceiling scores, 0-100, normalized over the rows in view, so the
 * best row in any table reads "High" and the worst "Low".
 */
export function computeScores(rows: StrategyRow[]): ScoredRow[] {
  if (!rows.length) return [];
  const prs = rows.map((r) => r.playoff_rate);
  const minPR = Math.min(...prs);
  const maxPR = Math.max(...prs);
  const ups = rows.map((r) => r.championship_rate * 0.6 + (r.top_3_pf_rate ?? 0) * 0.4);
  const minUP = Math.min(...ups);
  const maxUP = Math.max(...ups);
  const norm = (v: number, lo: number, hi: number) => (hi === lo ? 50 : Math.round(((v - lo) / (hi - lo)) * 100));
  return rows.map((r) => ({
    ...r,
    safety_score: norm(r.playoff_rate, minPR, maxPR),
    upside_score: norm(r.championship_rate * 0.6 + (r.top_3_pf_rate ?? 0) * 0.4, minUP, maxUP),
  }));
}

export function sortRows<T extends object>(rows: T[], key: keyof T, dir: SortDir): T[] {
  return [...rows].sort((a, b) => {
    const av = a[key] as unknown as string | number | undefined;
    const bv = b[key] as unknown as string | number | undefined;
    if (typeof av === "string" && typeof bv === "string") {
      return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    const an = typeof av === "number" ? av : 0;
    const bn = typeof bv === "number" ? bv : 0;
    return dir === "asc" ? an - bn : bn - an;
  });
}

export interface StrategyTableView {
  rows: ScoredRow[];
  hiddenCount: number;
}

/** The rows a strategy table shows, scored over what is visible and sorted. */
export function strategyTableView(rows: StrategyRow[], state: TableState, minSample = 0): StrategyTableView {
  const visible = minSample > 0 && !state.showLow ? rows.filter((r) => r.sample_size >= minSample) : rows;
  const hiddenCount = minSample > 0 ? rows.filter((r) => r.sample_size < minSample).length : 0;
  const scored = computeScores(visible);
  return { rows: sortRows(scored, state.sortKey, state.sortDir), hiddenCount };
}

/** A sort click: the same column flips, a new one starts descending (names ascending). */
export function nextSort(state: TableState, key: StrategySortKey): TableState {
  if (key === state.sortKey) return { ...state, sortDir: state.sortDir === "asc" ? "desc" : "asc" };
  return { ...state, sortKey: key, sortDir: key === "strategy" ? "asc" : "desc" };
}

export interface ScoreBadge {
  label: string;
  tone: "good" | "solid" | "average" | "low";
}

export function scoreBadge(score: number, type: "safety" | "upside"): ScoreBadge {
  const isSafety = type === "safety";
  if (score >= 75) return { label: isSafety ? "High Floor" : "High Ceiling", tone: "good" };
  if (score >= 50) return { label: isSafety ? "Solid" : "Good", tone: "solid" };
  if (score >= 25) return { label: "Average", tone: "average" };
  return { label: isSafety ? "Low" : "Limited", tone: "low" };
}

/** "+4.2pp", "-11.9pp", or "-" for no lift. */
export function fmtLift(lift: number): string {
  if (lift === 0) return "-";
  return `${lift > 0 ? "+" : ""}${lift.toFixed(1)}pp`;
}

/** The open row's paragraph, as the app's buildRowExplanation. */
export function strategyExplanation(row: StrategyRow): string {
  const lift = row.playoff_rate_lift ?? 0;
  const baseline = row.playoff_rate * 100 - lift;
  const dir = lift >= 0 ? "above" : "below";
  const prCi = wilson95(row.playoff_rate, row.sample_size);
  const parts: string[] = [
    `In this sample, ${row.strategy} teams made the playoffs at a ${fmtPct(row.playoff_rate)} rate, ` +
      `${Math.abs(lift).toFixed(1)} percentage points ${dir} the overall baseline of ${baseline.toFixed(1)}%.`,
  ];
  if (prCi) parts.push(`95% confidence interval: ${fmtCiRange(prCi)} (n=${fmtInt(row.sample_size)}).`);
  if (row.top_3_pf_rate != null) {
    parts.push(`Teams using this build also finished in the top 3 for points scored ${fmtPct(row.top_3_pf_rate)} of the time.`);
  }
  parts.push(`Championship rate (a secondary, higher-variance result): ${fmtPct(row.championship_rate)}.`);
  parts.push(`Confidence: ${row.confidence_level ?? trustTier(row.sample_size).label}.`);
  return parts.join(" ");
}

/* --------------------------------------------------------------- chart */

export type ChartMetric = "playoff_rate" | "championship_rate" | "top_3_pf_rate";

export const CHART_METRICS: { key: ChartMetric; label: string }[] = [
  { key: "playoff_rate", label: "Playoff Rate" },
  { key: "championship_rate", label: "Championship" },
  { key: "top_3_pf_rate", label: "Top-3 Points" },
];

/** The ranking bars' five tiers around the baseline, with the app's palette. */
export const BAR_TIERS = [
  { key: "majorEdge", color: "#15803d", label: "Major Edge (>5pp above avg)" },
  { key: "positive", color: "#5ea982", label: "Positive Edge (2-5pp)" },
  { key: "neutral", color: "#94a3b8", label: "Neutral (±2pp)" },
  { key: "negative", color: "#cf9191", label: "Negative Edge (2-5pp)" },
  { key: "majorTrap", color: "#a83232", label: "Major Trap (>5pp below avg)" },
] as const;

export function barTier(value: number, baseline: number): (typeof BAR_TIERS)[number] {
  const lift = value - baseline;
  if (lift >= 0.05) return BAR_TIERS[0];
  if (lift >= 0.02) return BAR_TIERS[1];
  if (lift >= -0.02) return BAR_TIERS[2];
  if (lift >= -0.05) return BAR_TIERS[3];
  return BAR_TIERS[4];
}

export interface BarEntry {
  name: string;
  value: number;
  playoff_rate: number;
  championship_rate: number;
  top_3_pf_rate?: number;
  average_points_for: number;
  sample_size: number;
  confidence_level: string;
}

export interface ChartView {
  bars: BarEntry[];
  baseline: number;
  domMin: number;
  domMax: number;
  bandLo: number;
  bandHi: number;
}

function metricOf(s: StrategyRow, metric: ChartMetric): number {
  return metric === "top_3_pf_rate" ? (s.top_3_pf_rate ?? 0) : s[metric];
}

/**
 * The Strategy Ranking chart's data. Rows are deduplicated by name and sorted
 * by the chosen metric, ascending: the app fed recharts that order, and a
 * recharts vertical layout draws the first row at the top, so the lowest
 * bar sits first. The baseline is the format's playoff rate for the playoff
 * metric and the mean of the rows for the other two. The axis is snapped to
 * 5pp steps around the bars, and a ±2pp band marks the neutral zone.
 */
export function chartView(strategies: StrategyRow[], baselinePlayoffRate: number | null | undefined, metric: ChartMetric): ChartView | null {
  const seen = new Set<string>();
  const deduped = strategies.filter((s) => {
    const n = (s.strategy ?? "").trim();
    if (seen.has(n)) return false;
    seen.add(n);
    return true;
  });
  if (!deduped.length) return null;
  const playoffBaseline = baselinePlayoffRate ?? 0.5;
  const bars: BarEntry[] = [...deduped]
    .sort((a, b) => metricOf(a, metric) - metricOf(b, metric))
    .map((s) => ({
      name: s.strategy.trim(),
      value: metricOf(s, metric),
      playoff_rate: s.playoff_rate,
      championship_rate: s.championship_rate,
      top_3_pf_rate: s.top_3_pf_rate,
      average_points_for: s.average_points_for,
      sample_size: s.sample_size,
      confidence_level: s.confidence_level,
    }));
  let baseline = playoffBaseline;
  if (metric !== "playoff_rate") {
    const vals = deduped.map((s) => metricOf(s, metric)).filter((v) => v > 0);
    baseline = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : playoffBaseline;
  }
  const vals = bars.map((b) => b.value);
  const rawMin = Math.min(...vals);
  const rawMax = Math.max(...vals);
  const domMin = Math.max(0, Math.floor((rawMin - 0.03) * 20) / 20);
  const domMax = Math.min(1, Math.ceil((rawMax + 0.02) * 20) / 20);
  return {
    bars,
    baseline,
    domMin,
    domMax,
    bandLo: Math.max(domMin, baseline - 0.02),
    bandHi: Math.min(domMax, baseline + 0.02),
  };
}

/* ----------------------------------------------------------- round value */

export const ROUND_MIN_SAMPLE = 250;

export interface RoundView {
  rounds: number[];
  round: number;
  qualifying: RoundPosition[];
  omitted: string[];
}

/** One round's positions with enough sample, best playoff rate first. */
export function roundView(rounds: RoundData[], selected: number): RoundView {
  const data = rounds.find((r) => r.round === selected);
  const all = data?.positions ?? [];
  return {
    rounds: rounds.map((r) => r.round),
    round: selected,
    qualifying: all.filter((p) => p.sample_size >= ROUND_MIN_SAMPLE).sort((a, b) => b.playoff_rate - a.playoff_rate),
    omitted: all.filter((p) => p.sample_size > 0 && p.sample_size < ROUND_MIN_SAMPLE).map((p) => p.strategy),
  };
}

export function roundExplanation(pos: RoundPosition, round: number): string {
  const parts: string[] = [
    `In Round ${round}, drafting a ${pos.strategy} led to a ${fmtPct(pos.playoff_rate)} playoff rate across ${fmtInt(pos.sample_size)} teams.`,
    `Championship rate: ${fmtPct(pos.championship_rate)}.`,
  ];
  if (pos.top_3_pf_rate != null) parts.push(`Top-3 points finish: ${fmtPct(pos.top_3_pf_rate)}.`);
  if (pos.average_points_for != null) parts.push(`Average points scored: ${fmtInt(pos.average_points_for)}.`);
  return parts.join(" ");
}

/* ------------------------------------------------------------- comparison */

export type CompareMetric = "playoff" | "pf";

export type CompareSortKey =
  | "name"
  | "rate_2021"
  | "rate_2022"
  | "rate_2023"
  | "rate_2024"
  | "rate_2025"
  | "avg_rate"
  | "sample"
  | "volatility";

export interface CompareState {
  sortKey: CompareSortKey;
  sortDir: SortDir;
  weighting: Weighting;
  metric: CompareMetric;
}

export function defaultCompareState(): CompareState {
  return { sortKey: "avg_rate", sortDir: "desc", weighting: "pooled", metric: "playoff" };
}

export function nextCompareSort(state: CompareState, key: CompareSortKey): CompareState {
  if (key === state.sortKey) return { ...state, sortDir: state.sortDir === "asc" ? "desc" : "asc" };
  return { ...state, sortKey: key, sortDir: key === "name" || key === "volatility" ? "asc" : "desc" };
}

export function compareName(row: TrendRow): string {
  return row.strategy ?? row.combo ?? "";
}

function rateKey(metric: CompareMetric): string {
  return metric === "playoff" ? "playoff_rate" : "top_3_pf_rate";
}

/** A season's rate for the metric: 2024 and 2025 read 0 when missing, earlier years undefined, as the app. */
export function compareRate(row: TrendRow, metric: CompareMetric, year: SeasonYear): number | undefined {
  const v = num(row, `${rateKey(metric)}_${year}`);
  if (year === "2024" || year === "2025") return metric === "playoff" ? v : (v ?? 0);
  return v;
}

export interface CompareYears {
  has2021: boolean;
  has2022: boolean;
  has2023: boolean;
}

/** Which early seasons any row in the table has data for; 2024 and 2025 always show. */
export function compareYears(rows: TrendRow[], metric: CompareMetric): CompareYears {
  const has = (year: SeasonYear) =>
    rows.some((r) => compareRate(r, metric, year) != null && (num(r, `sample_${year}`) ?? 0) > 0);
  return { has2021: has("2021"), has2022: has("2022"), has2023: has("2023") };
}

export function compareShownYears(years: CompareYears): SeasonYear[] {
  const out: SeasonYear[] = [];
  if (years.has2021) out.push("2021");
  if (years.has2022) out.push("2022");
  if (years.has2023) out.push("2023");
  out.push("2024", "2025");
  return out;
}

function seasonPoints(row: TrendRow, metric: CompareMetric, years: CompareYears): SeasonPoint[] {
  const pts: SeasonPoint[] = [];
  for (const y of compareShownYears(years)) {
    pts.push({ rate: compareRate(row, metric, y) ?? (y >= "2024" ? 0 : undefined), n: num(row, `sample_${y}`) });
  }
  return pts;
}

export function compareAggregate(row: TrendRow, metric: CompareMetric, weighting: Weighting, years: CompareYears): AggregateResult {
  return aggregate(seasonPoints(row, metric, years), weighting);
}

/** Standard deviation of the shown seasons' rates, in percentage points. */
export function compareVolatility(row: TrendRow, metric: CompareMetric, years: CompareYears): number {
  const rates: number[] = [];
  for (const y of ["2021", "2022", "2023"] as SeasonYear[]) {
    const has = y === "2021" ? years.has2021 : y === "2022" ? years.has2022 : years.has2023;
    const r = compareRate(row, metric, y);
    if (has && r != null && (num(row, `sample_${y}`) ?? 0) > 0) rates.push(r);
  }
  rates.push(compareRate(row, metric, "2024") ?? 0, compareRate(row, metric, "2025") ?? 0);
  const mean = rates.reduce((a, v) => a + v, 0) / rates.length;
  const variance = rates.reduce((a, v) => a + (v - mean) ** 2, 0) / rates.length;
  return Math.sqrt(variance) * 100;
}

export interface VolatilityBadge {
  label: "Low" | "Mid" | "High";
  pp: number;
}

export function volatilityBadge(pp: number): VolatilityBadge {
  return { label: pp < 2 ? "Low" : pp < 5 ? "Mid" : "High", pp };
}

export interface CompareRowView {
  row: TrendRow;
  name: string;
  rates: Partial<Record<SeasonYear, number | undefined>>;
  agg: AggregateResult;
  volatility: number;
}

export interface CompareTableView {
  years: CompareYears;
  shown: SeasonYear[];
  rows: CompareRowView[];
}

/** The comparison table's rows: gated on both recent seasons' samples, then sorted. */
export function compareTableView(rows: TrendRow[], state: CompareState, minSample = 10): CompareTableView {
  const years = compareYears(rows, state.metric);
  const shown = compareShownYears(years);
  const filtered =
    minSample > 0
      ? rows.filter((r) => Math.min(num(r, "sample_2024") ?? 0, num(r, "sample_2025") ?? 0) >= minSample)
      : rows;
  const views: CompareRowView[] = filtered.map((row) => {
    const rates: Partial<Record<SeasonYear, number | undefined>> = {};
    for (const y of shown) rates[y] = compareRate(row, state.metric, y);
    return {
      row,
      name: compareName(row),
      rates,
      agg: compareAggregate(row, state.metric, state.weighting, years),
      volatility: compareVolatility(row, state.metric, years),
    };
  });
  const value = (v: CompareRowView): number | string => {
    switch (state.sortKey) {
      case "name":
        return v.name;
      case "avg_rate":
        return v.agg.rate;
      case "sample":
        return v.agg.n;
      case "volatility":
        return v.volatility;
      default:
        return v.rates[state.sortKey.slice(5) as SeasonYear] ?? 0;
    }
  };
  views.sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    if (typeof av === "string" && typeof bv === "string") {
      return state.sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    return state.sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
  });
  return { years, shown, rows: views };
}

/* -------------------------------------------------- comparison round value */

export const COMPARE_ROUND_MIN_SAMPLE = 50;

export interface CompareRoundRow {
  pos: TrendRoundPosition;
  rates: Partial<Record<SeasonYear, number | undefined>>;
  avg: number;
  volatility: number;
}

export interface CompareRoundView {
  rounds: number[];
  round: number;
  years: CompareYears;
  shown: SeasonYear[];
  rows: CompareRoundRow[];
}

/** The by-round comparison: positions with 50+ teams in both recent seasons, 2025 best first. */
export function compareRoundView(rounds: TrendRound[], selected: number): CompareRoundView {
  const data = rounds.find((r) => r.round === selected);
  const positions = data?.positions ?? [];
  const has = (y: SeasonYear) => positions.some((p) => num(p, `playoff_rate_${y}`) != null && (num(p, `sample_${y}`) ?? 0) > 0);
  const years: CompareYears = { has2021: has("2021"), has2022: has("2022"), has2023: has("2023") };
  const shown = compareShownYears(years);
  const qualifying = positions.filter(
    (p) => Math.min(num(p, "sample_2024") ?? 0, num(p, "sample_2025") ?? 0) >= COMPARE_ROUND_MIN_SAMPLE,
  );
  const rows: CompareRoundRow[] = [...qualifying]
    .sort((a, b) => (num(b, "playoff_rate_2025") ?? 0) - (num(a, "playoff_rate_2025") ?? 0))
    .map((pos) => {
      const rates: Partial<Record<SeasonYear, number | undefined>> = {};
      const vals: number[] = [];
      for (const y of shown) {
        const r = num(pos, `playoff_rate_${y}`);
        rates[y] = r;
        if (y >= "2024") vals.push(r ?? 0);
        else if (r != null && (num(pos, `sample_${y}`) ?? 0) > 0) vals.push(r);
      }
      const mean = vals.reduce((a, v) => a + v, 0) / vals.length;
      const variance = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length;
      return { pos, rates, avg: mean, volatility: Math.sqrt(variance) * 100 };
    });
  return { rounds: rounds.map((r) => r.round), round: selected, years, shown, rows };
}

/* ---------------------------------------------------- comparison chart */

/**
 * The comparison's ranking chart: every strategy's rates averaged across the
 * seasons, weighted by each season's sample, and the baseline the same way.
 */
export function compareChartRows(trend: Trend): { rows: StrategyRow[]; baseline: number } {
  const years = SEASON_YEARS;
  const samples = years.map((y) => num(trend, `sample_${y}`) ?? 0);
  const baselines = years.map((y) => num(trend, `baseline_playoff_rate_${y}`) ?? 0);
  const bTotal = samples.reduce((a, b) => a + b, 0);
  const baseline =
    bTotal > 0
      ? baselines.reduce((a, b, i) => a + b * samples[i]!, 0) / bTotal
      : (baselines[3]! + baselines[4]!) / 2;
  const rows = trend.overall_strategies.map((s) => {
    const n = years.map((y) => num(s, `sample_${y}`) ?? 0);
    const total = n.reduce((a, b) => a + b, 0);
    const wa = (prefix: string) => {
      const v = years.map((y) => num(s, `${prefix}_${y}`) ?? 0);
      return total > 0 ? v.reduce((a, b, i) => a + b * n[i]!, 0) / total : (v[3]! + v[4]!) / 2;
    };
    const playoff_rate = wa("playoff_rate");
    return {
      strategy: s.strategy ?? "",
      sample_size: total,
      average_points_for: wa("avg_pts"),
      playoff_rate,
      championship_rate: wa("championship_rate"),
      top_3_pf_rate: wa("top_3_pf_rate"),
      playoff_rate_lift: (playoff_rate - baseline) * 100,
      confidence_level: s.comparison_quality,
    };
  });
  return { rows, baseline };
}

/* ----------------------------------------------------- Robust RB rebound */

export interface PeriodPair {
  early: AggregateResult;
  late: AggregateResult;
}

/** A strategy's playoff rate pooled over 2021-2023 and over 2024-2025. */
export function periodPair(trend: Trend, name: string): PeriodPair | null {
  const s = trend.overall_strategies.find((r) => r.strategy === name);
  if (!s) return null;
  const pt = (y: SeasonYear): SeasonPoint => ({ rate: num(s, `playoff_rate_${y}`), n: num(s, `sample_${y}`) });
  return { early: pooled([pt("2021"), pt("2022"), pt("2023")]), late: pooled([pt("2024"), pt("2025")]) };
}

export const POSSIBLE_EXPLANATIONS = [
  "Better production from early-round running backs",
  "Different RB and WR ADP environments",
  "A stronger early-round RB player pool",
  "Weaker results from early-round wide receivers",
  "Better late-round WR availability",
  "Changes in NFL scoring or offensive usage",
  "Injuries",
  "Normal season-to-season variance",
];

/* ------------------------------------------------------------ draft board */

export const MAX_ROUNDS_SHOWN = 20;

export interface BoardState {
  index: number;
  /** The highlighted strategy; "" means the first on the board. */
  strategy: string;
}

export interface BoardCell {
  round: number;
  slot: number;
  pick: BoardPick | null;
  /** "1.01" */
  label: string;
  /** "RB3": the position's draft rank. */
  rank: string;
  featured: boolean;
}

export interface BoardView {
  board: Board;
  chosen: string;
  activeSlots: number[];
  groups: { strategy: string; slots: number[] }[];
  slots: number[];
  rounds: number[];
  cells: BoardCell[][];
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** The real snake grid, keyed by round and slot, with pick labels and positional ranks. */
export function boardView(board: Board, state: BoardState): BoardView {
  const strategies = board.strategies;
  const chosen = state.strategy && strategies.some((s) => s.strategy === state.strategy) ? state.strategy : (strategies[0]?.strategy ?? "");
  const activeSlots = strategies.filter((s) => s.strategy === chosen).map((s) => s.slot);
  const groupMap = new Map<string, number[]>();
  for (const s of strategies) groupMap.set(s.strategy, [...(groupMap.get(s.strategy) ?? []), s.slot]);
  const groups = Array.from(groupMap, ([strategy, slots]) => ({ strategy, slots: [...slots].sort((a, b) => a - b) }));

  const numTeams = board.num_teams;
  const totalRounds = Math.min(board.num_rounds, MAX_ROUNDS_SHOWN);
  const slots = Array.from({ length: numTeams }, (_, i) => i + 1);
  const rounds = Array.from({ length: totalRounds }, (_, i) => i + 1);

  const grid = new Map<string, BoardPick>();
  for (const p of board.picks) {
    if (p.round > MAX_ROUNDS_SHOWN) continue;
    grid.set(`${p.round}-${p.slot}`, p);
  }
  const rankByPick = new Map<number, number>();
  const counts: Record<string, number> = {};
  for (const p of [...board.picks].sort((a, b) => a.pick_no - b.pick_no)) {
    counts[p.position] = (counts[p.position] ?? 0) + 1;
    rankByPick.set(p.pick_no, counts[p.position]!);
  }

  const cells = rounds.map((round) =>
    slots.map((slot): BoardCell => {
      const pick = grid.get(`${round}-${slot}`) ?? null;
      const isOdd = round % 2 === 1;
      const pickInRound = pick ? pick.pick_no - (round - 1) * numTeams : isOdd ? slot : numTeams - slot + 1;
      const rank = pick ? `${pick.position}${rankByPick.get(pick.pick_no) ?? ""}` : "";
      return { round, slot, pick, label: `${round}.${pad2(pickInRound)}`, rank, featured: activeSlots.includes(slot) };
    }),
  );
  return { board, chosen, activeSlots, groups, slots, rounds, cells };
}

/** "Christian McCaffrey" reads "C. McCaffrey"; very compact, "CM". */
export function abbreviateFirstName(name: string, veryCompact = false): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  if (veryCompact) return parts.map((p) => p[0]).join("").toUpperCase();
  return `${parts[0]![0]}. ${parts.slice(1).join(" ")}`;
}

export function initialsOf(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[p.length - 1]?.[0] ?? "")).toUpperCase();
}

/* ------------------------------------------------------------ glossary */

export const GLOSSARY_SECTIONS = [
  {
    title: "Core Draft Strategies",
    subtitle: "Each team belongs to exactly one core archetype based on rounds 1-5.",
    entries: [
      { name: "Zero RB", def: "0 RBs in rounds 1-5. Prioritizes WRs and other positions early, targeting RB value in mid/late rounds." },
      { name: "Hero RB", def: "Exactly 1 RB in rounds 1-5. One high-upside RB anchor paired with heavy WR investment." },
      { name: "Robust RB", def: "3+ RBs in rounds 1-5. Heavy early investment in the RB position for depth and volume." },
      { name: "WR Heavy", def: "3+ WRs in rounds 1-5 with fewer than 3 RBs. Commits to wide receiver depth and upside." },
      { name: "Balanced", def: "Exactly 2 RBs and fewer than 3 WRs in rounds 1-5. A mixed start without extreme positional concentration." },
    ],
  },
  {
    title: "Positional Timing",
    subtitle: "Independent overlays: a team can be Hero RB + Late QB at the same time.",
    entries: [
      { name: "Elite QB", def: "First QB drafted in rounds 1-4." },
      { name: "Late QB", def: "First QB not drafted until round 8 or later." },
      { name: "Elite TE", def: "First TE drafted in rounds 1-2." },
      { name: "Late TE", def: "First TE not drafted until round 8 or later." },
    ],
  },
  {
    title: "Draft Openings",
    subtitle: "First two picks, tracked separately as an additional analysis layer.",
    entries: [
      { name: "RB/RB", def: "RB in both rounds 1 and 2." },
      { name: "WR/WR", def: "WR in both rounds 1 and 2." },
      { name: "RB/WR", def: "RB in round 1, WR in round 2." },
      { name: "WR/RB", def: "WR in round 1, RB in round 2." },
    ],
  },
];

/* ---------------------------------------------------------------- state */

/** Everything the bundle keeps between redraws; the server renders the default. */
export interface State {
  filters: Filters;
  chartMetric: ChartMetric;
  glossaryOpen: boolean;
  tables: Record<string, TableState>;
  roundSel: number;
  compare: { overall: CompareState; firstTwo: CompareState; roundSel: number };
  board: BoardState;
}

export function defaultState(filters: Filters = DEFAULT_FILTERS): State {
  return {
    filters,
    chartMetric: "playoff_rate",
    glossaryOpen: false,
    tables: {},
    roundSel: 1,
    compare: { overall: defaultCompareState(), firstTwo: defaultCompareState(), roundSel: 1 },
    board: { index: 0, strategy: "" },
  };
}

export function tableState(state: State, id: string): TableState {
  return state.tables[id] ?? defaultTableState();
}
