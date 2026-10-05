/**
 * The rookie hit rate model: the standalone app's arithmetic, unchanged.
 *
 * Ported from statchasersff-bit/Rookie-Hit-Rate - client/src/lib/cohort.ts,
 * ranks.ts and data-context.tsx for the numbers, and the insight generators
 * that lived inside its page components (pages/overview.tsx,
 * pages/pick-range.tsx, components/trends-chart.tsx,
 * components/cohort-survival-chart.tsx). Every threshold, sample floor and
 * tie-break is the source's, including the ones that look accidental - the
 * Trends and Cohorts tabs, for one, ignore the season range, because the
 * source's do. A difference from the app would be a difference in a number a
 * reader has already seen there.
 *
 * Pure and dependency-free on purpose: the server renders the default view
 * with it and the browser bundle (client/rookie-hit-rates.ts) recomputes every
 * other view with the same module, so the two cannot disagree.
 */

export type Format = "1qb" | "sf";
export type Scoring = "ppr" | "hppr";
export type Pos = "QB" | "RB" | "WR" | "TE";
export type Outcome = "elite" | "starter" | "flex";
export type HitType = "elite" | "starter" | "flex" | "bust" | "too_early";
export type Tab = "overview" | "trends" | "cohorts" | "players";
export type ViewMode = "yearly" | "rolling3" | "cumulative";
export type GroupBy = "pos" | "round";
export type Tone = "positive" | "negative" | "neutral";
export type Accent = "gold" | "blue" | "emerald" | "violet" | "rose" | "sky" | "red" | "slate";
export type SortField =
  | "player_name"
  | "current_nfl_team"
  | "rookie_year"
  | "rookie_round"
  | "best_finish"
  | "best_finish_year"
  | "breakout_time";

export const POSITIONS: readonly Pos[] = ["QB", "RB", "WR", "TE"];
export const ROUNDS: readonly number[] = [1, 2, 3, 4, 5];
export const PICK_RANGES: readonly { start: number; end: number }[] = [
  { start: 1, end: 3 },
  { start: 4, end: 6 },
  { start: 7, end: 9 },
  { start: 10, end: 12 },
];
export const TABS: readonly Tab[] = ["overview", "trends", "cohorts", "players"];

/* ------------------------------------------------------------- the data */

/** [id, name, pos, rookieYear, team, age, height, weight, sleeperId] */
export type PackedPlayer = [string, string, Pos, number, string, number | null, string, number | null, string | null];
/** [playerIndex, posRank, round, pick] */
export type PackedPick = [number, number, number, number];
/** [season, pos, games, rankPpr, rankHppr, rankStd] */
export type PackedSeason = [number, Pos, number, number, number, number];

/** data/rookie-hit-rates/hit-rates.json (scripts/rookie-hit-rates/buildData.mjs). */
export interface PackedDataset {
  source: string;
  firstClass: number;
  lastClass: number;
  latestSeason: number;
  players: PackedPlayer[];
  boards: Record<string, PackedPick[]>;
  seasons: PackedSeason[][];
  /** Added by the server per request: the player's statchasers.com profile, when one is published. */
  profiles?: Record<string, string>;
}

export interface RookieDraft {
  player_id: string;
  player_name: string;
  pos: Pos;
  pos_rank: number;
  rookie_year: number;
  rookie_round: number;
  rookie_pick: number;
  current_nfl_team: string;
  current_age: number | null;
  height: string;
  weight: number | null;
  sleeper_id: string | null;
}

export interface RankedSeason {
  player_id: string;
  season: number;
  pos: Pos;
  games: number;
  pos_rank: number;
}

export type RankMap = Map<string, RankedSeason[]>;

export function boardKey(format: Format, scoring: Scoring): string {
  return `${format}-${scoring}`;
}

/** One ADP board, unpacked: the source's `filteredDrafts`. */
export function boardDrafts(data: PackedDataset, format: Format, scoring: Scoring): RookieDraft[] {
  const rows = data.boards[boardKey(format, scoring)] ?? [];
  return rows.map(([i, posRank, round, pick]) => {
    const p = data.players[i]!;
    return {
      player_id: p[0],
      player_name: p[1],
      pos: p[2],
      pos_rank: posRank,
      rookie_year: p[3],
      rookie_round: round,
      rookie_pick: pick,
      current_nfl_team: p[4],
      current_age: p[5],
      height: p[6],
      weight: p[7],
      sleeper_id: p[8],
    };
  });
}

/** ranks.ts computeRanks + buildRankMap: each season ranked under one scoring. */
export function rankMap(data: PackedDataset, scoring: Scoring): RankMap {
  const field = scoring === "ppr" ? 3 : 4;
  const map: RankMap = new Map();
  data.players.forEach((p, i) => {
    const rows = data.seasons[i] ?? [];
    if (!rows.length) return;
    map.set(
      p[0],
      rows.map((s) => ({ player_id: p[0], season: s[0], pos: s[1], games: s[2], pos_rank: s[field] as number })),
    );
  });
  return map;
}

/* -------------------------------------------------------------- filters */

export interface Filters {
  yearStart: number;
  yearEnd: number;
  format: Format;
  scoring: Scoring;
  outcome: Outcome;
  positions: Pos[];
  rounds: number[];
  minGames: number;
}

export interface State {
  tab: Tab;
  filters: Filters;
  /** The heatmap cell the Pick Lens reads; null falls back to the first cohort, as the source. */
  selected: { pos: Pos; round: number } | null;
  viewMode: ViewMode;
  movingAvg: boolean;
  groupBy: GroupBy;
  sortField: SortField;
  sortDir: "asc" | "desc";
  page: number;
  search: string;
}

/** data-context.tsx defaultFilters, with the season range taken from the data. */
export function defaultFilters(data: Pick<PackedDataset, "firstClass" | "lastClass">): Filters {
  return {
    yearStart: data.firstClass,
    yearEnd: data.lastClass,
    format: "sf",
    scoring: "ppr",
    outcome: "elite",
    positions: [...POSITIONS],
    rounds: [...ROUNDS],
    minGames: 8,
  };
}

export function defaultState(data: Pick<PackedDataset, "firstClass" | "lastClass">): State {
  return {
    tab: "overview",
    filters: defaultFilters(data),
    selected: null,
    viewMode: "yearly",
    movingAvg: false,
    groupBy: "pos",
    sortField: "rookie_year",
    sortDir: "desc",
    page: 0,
    search: "",
  };
}

export const OUTCOME_LABELS: Record<Outcome, string> = { elite: "Top-12", starter: "Top-24", flex: "Top-36" };

export function outcomeThreshold(outcome: Outcome): number {
  return outcome === "elite" ? 12 : outcome === "starter" ? 24 : 36;
}

/* -------------------------------------------------------------- cohorts */

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

function wilsonCI(hits: number, total: number): { lower: number; upper: number; width: number } {
  if (total === 0) return { lower: 0, upper: 0, width: 0 };
  const z = 1.96;
  const p = hits / total;
  const denom = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denom;
  const margin = (z / denom) * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
    width: Math.min(1, center + margin) - Math.max(0, center - margin),
  };
}

function median(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function inScope(d: RookieDraft, filters: Filters, latestSeason: number, positions: Pos[], rounds: number[]): boolean {
  if (d.rookie_year < filters.yearStart || d.rookie_year > filters.yearEnd) return false;
  if (d.rookie_year > latestSeason) return false;
  if (positions.length > 0 && !positions.includes(d.pos)) return false;
  if (rounds.length > 0 && !rounds.includes(d.rookie_round)) return false;
  return true;
}

/** The body of computeCohorts / computePickRangeCohorts, which the source wrote out twice. */
function summarise(group: RookieDraft[], ranks: RankMap, filters: Filters, pos: Pos, round: number): CohortSummary {
  let hits = 0;
  let eliteHits = 0;
  let starterHits = 0;
  let flexHits = 0;
  let bustCount = 0;
  const breakouts: number[] = [];
  let year1Hits = 0;
  let year2Hits = 0;
  let year3PlusHits = 0;
  const years = new Set<number>();
  const threshold = outcomeThreshold(filters.outcome);

  for (const draft of group) {
    years.add(draft.rookie_year);
    const seasons = ranks.get(draft.player_id) ?? [];
    const valid = seasons
      .filter((s) => s.games >= filters.minGames && s.season >= draft.rookie_year)
      .sort((a, b) => a.season - b.season);

    let isHit = false;
    let firstHitSeason: number | null = null;
    let bestRank = Infinity;
    for (const s of valid) {
      if (s.pos_rank < bestRank) bestRank = s.pos_rank;
      if (!isHit && s.pos_rank <= threshold) {
        isHit = true;
        firstHitSeason = s.season;
      }
    }

    if (bestRank <= 12) eliteHits++;
    else if (bestRank <= 24) starterHits++;
    else if (bestRank <= 36) flexHits++;
    else bustCount++;

    if (isHit) {
      hits++;
      if (firstHitSeason !== null) {
        const bt = firstHitSeason - draft.rookie_year + 1;
        breakouts.push(bt);
        if (bt === 1) year1Hits++;
        else if (bt === 2) year2Hits++;
        else year3PlusHits++;
      }
    }
  }

  const total = group.length;
  const ci = wilsonCI(hits, total);
  const rate = (n: number) => (total > 0 ? n / total : 0);
  return {
    pos,
    rookie_round: round,
    dynasty_years: Array.from(years).sort(),
    total,
    hits,
    hit_rate: rate(hits),
    elite_hits: eliteHits,
    elite_rate: rate(eliteHits),
    starter_hits: starterHits,
    starter_rate: rate(starterHits),
    flex_hits: flexHits,
    flex_rate: rate(flexHits),
    bust_count: bustCount,
    bust_rate: rate(bustCount),
    median_breakout: median(breakouts),
    hit_by_year: {
      year1: hits > 0 ? year1Hits / hits : 0,
      year2: hits > 0 ? year2Hits / hits : 0,
      year3_plus: hits > 0 ? year3PlusHits / hits : 0,
    },
    ci_lower: ci.lower,
    ci_upper: ci.upper,
    ci_width: ci.width,
  };
}

const posIndex = (p: Pos) => POSITIONS.indexOf(p);

/**
 * Hit rates by position and round. The Overview always spans every position
 * and round (its filter bar hides both), so callers pass empty lists there,
 * as data-context.tsx's overviewFilters did.
 */
export function computeCohorts(
  drafts: RookieDraft[],
  ranks: RankMap,
  filters: Filters,
  latestSeason: number,
  positions: Pos[] = [],
  rounds: number[] = [],
): CohortSummary[] {
  const groups = new Map<string, RookieDraft[]>();
  for (const d of drafts) {
    if (!inScope(d, filters, latestSeason, positions, rounds)) continue;
    const key = `${d.pos}-${d.rookie_round}`;
    const g = groups.get(key);
    if (g) g.push(d);
    else groups.set(key, [d]);
  }
  const results: CohortSummary[] = [];
  for (const [key, group] of groups) {
    const [pos, round] = key.split("-");
    results.push(summarise(group, ranks, filters, pos as Pos, parseInt(round!, 10)));
  }
  return results.sort((a, b) => posIndex(a.pos) - posIndex(b.pos) || a.rookie_round - b.rookie_round);
}

function pickRangeOf(pick: number): { start: number; end: number } {
  if (pick <= 3) return { start: 1, end: 3 };
  if (pick <= 6) return { start: 4, end: 6 };
  if (pick <= 9) return { start: 7, end: 9 };
  return { start: 10, end: 12 };
}

export function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

export function computePickRangeCohorts(
  drafts: RookieDraft[],
  ranks: RankMap,
  filters: Filters,
  latestSeason: number,
  positions: Pos[] = [],
  rounds: number[] = [],
): PickRangeCohortSummary[] {
  const groups = new Map<string, RookieDraft[]>();
  for (const d of drafts) {
    if (!inScope(d, filters, latestSeason, positions, rounds)) continue;
    const r = pickRangeOf(d.rookie_pick);
    const key = `${d.pos}-${d.rookie_round}-${r.start}-${r.end}`;
    const g = groups.get(key);
    if (g) g.push(d);
    else groups.set(key, [d]);
  }
  const results: PickRangeCohortSummary[] = [];
  for (const [key, group] of groups) {
    const parts = key.split("-");
    const pos = parts[0] as Pos;
    const round = parseInt(parts[1]!, 10);
    const pickStart = parseInt(parts[2]!, 10);
    const pickEnd = parseInt(parts[3]!, 10);
    results.push({
      ...summarise(group, ranks, filters, pos, round),
      pickStart,
      pickEnd,
      rangeLabel: `${round}.${pad2(pickStart)}-${round}.${pad2(pickEnd)}`,
    });
  }
  return results.sort(
    (a, b) => posIndex(a.pos) - posIndex(b.pos) || a.rookie_round - b.rookie_round || a.pickStart - b.pickStart,
  );
}

/* --------------------------------------------------------------- trends */

export interface TrendPoint {
  year: number;
  hitRate: number;
  n: number;
  hits: number;
  eliteHits: number;
  starterHits: number;
  bustCount: number;
  incomplete: boolean;
}

/** One position and round, class by class. Not filtered by the season range: the source's wasn't. */
export function computeTrends(
  drafts: RookieDraft[],
  ranks: RankMap,
  pos: Pos,
  round: number,
  outcome: Outcome,
  minGames: number,
  latestSeason: number,
): TrendPoint[] {
  const yearGroups = new Map<number, RookieDraft[]>();
  for (const d of drafts) {
    if (d.pos !== pos || d.rookie_round !== round) continue;
    if (d.rookie_year > latestSeason) continue;
    const g = yearGroups.get(d.rookie_year);
    if (g) g.push(d);
    else yearGroups.set(d.rookie_year, [d]);
  }
  const threshold = outcomeThreshold(outcome);
  const results: TrendPoint[] = [];
  for (const [year, group] of yearGroups) {
    let hits = 0;
    let eliteHits = 0;
    let starterHits = 0;
    let bustCount = 0;
    for (const d of group) {
      const seasons = ranks.get(d.player_id) ?? [];
      if (seasons.some((s) => s.games >= minGames && s.season >= d.rookie_year && s.pos_rank <= threshold)) hits++;
      let bestRank = Infinity;
      for (const s of seasons) {
        if (s.games >= minGames && s.pos_rank < bestRank) bestRank = s.pos_rank;
      }
      if (bestRank <= 12) eliteHits++;
      else if (bestRank <= 24) starterHits++;
      else if (bestRank > 36) bustCount++;
    }
    results.push({
      year,
      hitRate: group.length > 0 ? hits / group.length : 0,
      n: group.length,
      hits,
      eliteHits,
      starterHits,
      bustCount,
      incomplete: latestSeason - year < 3,
    });
  }
  return results.sort((a, b) => a.year - b.year);
}

export interface TrendSeries {
  pos: Pos;
  round: number;
  key: string;
  name: string;
  raw: TrendPoint[];
}

/** trends-chart.tsx: one series per selected position x round. */
export function trendSeries(
  drafts: RookieDraft[],
  ranks: RankMap,
  filters: Filters,
  latestSeason: number,
): TrendSeries[] {
  const positions = selectedPositions(filters);
  const rounds = selectedRounds(filters);
  const list: TrendSeries[] = [];
  for (const pos of positions) {
    for (const round of rounds) {
      list.push({
        pos,
        round,
        key: `${pos}_${round}`,
        name: `${pos} Rd${round}`,
        raw: computeTrends(drafts, ranks, pos, round, filters.outcome, filters.minGames, latestSeason),
      });
    }
  }
  return list;
}

/** The view mode, then the optional 3-year smoothing on top of it, as the source applied them. */
export function transformTrend(raw: TrendPoint[], viewMode: ViewMode, movingAvg: boolean): TrendPoint[] {
  let out = raw;
  if (viewMode === "cumulative") {
    let totalN = 0;
    let totalHits = 0;
    out = raw.map((t) => {
      totalN += t.n;
      totalHits += t.hits;
      return { ...t, hitRate: totalN > 0 ? totalHits / totalN : 0 };
    });
  } else if (viewMode === "rolling3") {
    out = raw.map((t, i) => {
      const slice = raw.slice(Math.max(0, i - 2), i + 1);
      const totalN = slice.reduce((s, d) => s + d.n, 0);
      const totalHits = slice.reduce((s, d) => s + d.hits, 0);
      return { ...t, hitRate: totalN > 0 ? totalHits / totalN : 0 };
    });
  }
  if (movingAvg) {
    const base = out;
    out = base.map((t, i) => {
      const slice = base.slice(Math.max(0, i - 2), i + 1);
      return { ...t, hitRate: slice.reduce((s, d) => s + d.hitRate, 0) / slice.length };
    });
  }
  return out;
}

/** Every selected cohort pooled by class year: what the insights, stability and average line read. */
export function pooledTrend(series: TrendSeries[]): TrendPoint[] {
  const byYear = new Map<number, TrendPoint>();
  for (const s of series) {
    for (const t of s.raw) {
      const cur =
        byYear.get(t.year) ??
        { year: t.year, hitRate: 0, n: 0, hits: 0, eliteHits: 0, starterHits: 0, bustCount: 0, incomplete: t.incomplete };
      cur.n += t.n;
      cur.hits += t.hits;
      cur.eliteHits += t.eliteHits;
      cur.starterHits += t.starterHits;
      cur.bustCount += t.bustCount;
      cur.incomplete = cur.incomplete || t.incomplete;
      byYear.set(t.year, cur);
    }
  }
  const rows = Array.from(byYear.values()).sort((a, b) => a.year - b.year);
  for (const r of rows) r.hitRate = r.n > 0 ? r.hits / r.n : 0;
  return rows;
}

export interface Stability {
  score: number;
  label: "Stable" | "Moderate" | "Volatile";
  stdDev: number;
  avg: number;
}

export function stabilityOf(pooled: TrendPoint[]): Stability {
  const rates = pooled.map((d) => d.hitRate);
  const avg = rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
  const variance = rates.length > 0 ? rates.reduce((sum, r) => sum + (r - avg) ** 2, 0) / rates.length : 0;
  const stdDev = Math.sqrt(variance);
  const score = Math.max(0, Math.min(100, Math.round((1 - stdDev / 0.5) * 100)));
  return { score, label: score >= 70 ? "Stable" : score >= 40 ? "Moderate" : "Volatile", stdDev, avg };
}

/* ------------------------------------------------------------- survival */

export interface SurvivalGroup {
  group: string;
  n: number;
  data: { year: number; pct: number; hits: number; eligible: number }[];
}

/**
 * Cumulative share with a first hit by each year after entry, never falling
 * year over year (the source's "survival rates never decrease" fix: a later
 * year has fewer eligible classes, so the raw share can dip).
 */
export function computeSurvival(
  drafts: RookieDraft[],
  ranks: RankMap,
  groupBy: GroupBy,
  outcome: Outcome,
  minGames: number,
  latestSeason: number,
  filterPos?: Pos[],
  filterRounds?: number[],
): SurvivalGroup[] {
  const groups = new Map<string, RookieDraft[]>();
  for (const d of drafts) {
    if (d.rookie_year > latestSeason) continue;
    if (filterPos && filterPos.length > 0 && !filterPos.includes(d.pos)) continue;
    if (filterRounds && filterRounds.length > 0 && !filterRounds.includes(d.rookie_round)) continue;
    const key = groupBy === "pos" ? d.pos : `Round ${d.rookie_round}`;
    const g = groups.get(key);
    if (g) g.push(d);
    else groups.set(key, [d]);
  }
  const threshold = outcomeThreshold(outcome);
  const results: SurvivalGroup[] = [];
  for (const [group, gDrafts] of groups) {
    const data: SurvivalGroup["data"] = [];
    for (let yr = 1; yr <= 6; yr++) {
      let hitsByYear = 0;
      let eligible = 0;
      for (const d of gDrafts) {
        if (d.rookie_year + yr - 1 > latestSeason) continue;
        eligible++;
        const seasons = ranks.get(d.player_id) ?? [];
        if (
          seasons.some(
            (s) =>
              s.games >= minGames &&
              s.season >= d.rookie_year &&
              s.season <= d.rookie_year + yr - 1 &&
              s.pos_rank <= threshold,
          )
        ) {
          hitsByYear++;
        }
      }
      const rawPct = eligible > 0 ? hitsByYear / eligible : 0;
      const prevPct = data.length > 0 ? data[data.length - 1]!.pct : 0;
      data.push({ year: yr, pct: Math.max(rawPct, prevPct), hits: hitsByYear, eligible });
    }
    results.push({ group, n: gDrafts.length, data });
  }
  return results.sort((a, b) => a.group.localeCompare(b.group));
}

const pctAt = (g: SurvivalGroup, year: number) => g.data.find((d) => d.year === year)?.pct ?? 0;

/** Share of eventual hits that came after Year 1. */
export function patienceIndex(group: SurvivalGroup): number {
  const ceiling = Math.max(...group.data.map((d) => d.pct), 0.001);
  return Math.round((1 - pctAt(group, 1) / ceiling) * 100);
}

export interface RosterRow {
  group: string;
  n: number;
  y1: number;
  y2: number;
  y3: number;
  ceiling: number;
  remY3: number;
}

/** The Remaining Hit Odds table, sorted by what is left after Year 3, and its takeaway line. */
export function rosterOdds(survival: SurvivalGroup[]): { rows: RosterRow[]; takeaway: string } {
  const rows = survival
    .map((g) => {
      const ceiling = Math.max(...g.data.map((d) => d.pct), 0.001);
      const y3 = pctAt(g, 3);
      return { group: g.group, n: g.n, y1: pctAt(g, 1), y2: pctAt(g, 2), y3, ceiling, remY3: Math.max(0, ceiling - y3) };
    })
    .sort((a, b) => b.remY3 - a.remY3);
  if (rows.length === 0) return { rows, takeaway: "" };
  const bottom = rows[rows.length - 1]!;
  const strong = rows.filter((r) => r.remY3 >= 0.06).map((r) => r.group);
  const lead =
    strong.length >= 2
      ? `${strong.slice(0, 2).join(" and ")} remain more viable late holds`
      : `${rows[0]!.group} remains the most viable late hold`;
  return { rows, takeaway: `${lead}; ${bottom.group}s lose most of their hit odds after Year 3.` };
}

/* -------------------------------------------------------------- players */

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
  sleeper_id: string | null;
  best_rank: number;
  best_finish: string;
  best_finish_year: number;
  breakout_time: number | null;
  hit_type: HitType;
  seasons: RankedSeason[];
}

/**
 * Each rookie's best finish, breakout year and outcome. The source's quirks
 * stand: Best Finish counts any season (even under the games minimum) while
 * the outcome badge counts only qualifying ones.
 */
export function computePlayerSummaries(
  drafts: RookieDraft[],
  ranks: RankMap,
  outcome: Outcome,
  minGames: number,
  latestSeason: number,
): PlayerSummary[] {
  const threshold = outcomeThreshold(outcome);
  return drafts.map((d) => {
    const seasons = [...(ranks.get(d.player_id) ?? [])].sort((a, b) => a.season - b.season);
    let bestRank = Infinity;
    let bestYear = d.rookie_year;
    let firstHitSeason: number | null = null;
    let bestQualifiedRank = Infinity;
    for (const s of seasons) {
      if (s.pos_rank < bestRank) {
        bestRank = s.pos_rank;
        bestYear = s.season;
      }
      if (firstHitSeason === null && s.games >= minGames && s.pos_rank <= threshold) firstHitSeason = s.season;
      if (s.games >= minGames && s.pos_rank < bestQualifiedRank) bestQualifiedRank = s.pos_rank;
    }
    let hitType: HitType = "bust";
    if (d.rookie_year > latestSeason) hitType = "too_early";
    else if (bestQualifiedRank <= 12) hitType = "elite";
    else if (bestQualifiedRank <= 24) hitType = "starter";
    else if (bestQualifiedRank <= 36) hitType = "flex";
    return {
      player_id: d.player_id,
      player_name: d.player_name,
      pos: d.pos,
      rookie_year: d.rookie_year,
      rookie_round: d.rookie_round,
      rookie_pick: d.rookie_pick,
      current_nfl_team: d.current_nfl_team,
      current_age: d.current_age,
      height: d.height,
      weight: d.weight,
      sleeper_id: d.sleeper_id,
      best_rank: bestRank,
      best_finish: bestRank <= 999 ? `${d.pos}${bestRank} (${bestYear})` : "N/A",
      best_finish_year: bestYear,
      breakout_time: firstHitSeason !== null ? firstHitSeason - d.rookie_year + 1 : null,
      hit_type: hitType,
      seasons,
    };
  });
}

export const PAGE_SIZE = 50;

/** player-table.tsx: the season range, position, round and search filters, then the sort. */
export function filterPlayers(players: PlayerSummary[], state: State): PlayerSummary[] {
  const f = state.filters;
  let result = players.filter((p) => p.rookie_year >= f.yearStart && p.rookie_year <= f.yearEnd);
  if (f.positions.length > 0) result = result.filter((p) => f.positions.includes(p.pos));
  if (f.rounds.length > 0) result = result.filter((p) => f.rounds.includes(p.rookie_round));
  if (state.search) {
    const s = state.search.toLowerCase();
    result = result.filter((p) => p.player_name.toLowerCase().includes(s));
  }
  const dir = state.sortDir === "asc" ? 1 : -1;
  return [...result].sort((a, b) => {
    let cmp = 0;
    switch (state.sortField) {
      case "player_name":
        cmp = a.player_name.localeCompare(b.player_name);
        break;
      case "current_nfl_team":
        cmp = a.current_nfl_team.localeCompare(b.current_nfl_team);
        break;
      case "rookie_year":
        cmp = a.rookie_year - b.rookie_year;
        break;
      case "rookie_round":
        cmp = a.rookie_round - b.rookie_round || a.rookie_pick - b.rookie_pick;
        break;
      case "best_finish":
        // No finish is Infinity, and two of them compare equal, as the source's NaN did.
        cmp = a.best_rank - b.best_rank || 0;
        break;
      case "best_finish_year":
        cmp = a.best_finish_year - b.best_finish_year;
        break;
      case "breakout_time":
        cmp = (a.breakout_time ?? 99) - (b.breakout_time ?? 99);
        break;
    }
    return cmp * dir;
  });
}

/* ------------------------------------------------------------- insights */

export interface Insight {
  title: string;
  stat: string;
  body: string;
  tone: Tone;
  accent: Accent;
}

const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;
const pct0 = (v: number) => `${(v * 100).toFixed(0)}%`;

/** pages/overview.tsx generateOverviewInsights. The page shows the first four. */
export function overviewInsights(cohorts: CohortSummary[], outcomeName: string): Insight[] {
  if (cohorts.length < 2) return [];
  const insights: Insight[] = [];
  const lower = outcomeName.toLowerCase();

  const totalPlayers = cohorts.reduce((s, c) => s + c.total, 0);
  const totalHits = cohorts.reduce((s, c) => s + c.hits, 0);
  const overallRate = totalPlayers > 0 ? totalHits / totalPlayers : 0;
  insights.push({
    title: "Overall Hit Rate",
    stat: pct1(overallRate),
    body: `${totalHits} of ${totalPlayers} rookies reached the ${lower} threshold.`,
    tone: overallRate > 0.3 ? "positive" : overallRate > 0.15 ? "neutral" : "negative",
    accent: "slate",
  });

  const withHits = cohorts.filter((c) => c.total >= 5);
  if (withHits.length > 0) {
    const best = withHits.reduce((a, b) => (b.hit_rate > a.hit_rate ? b : a));
    insights.push({
      title: "Best Cohort",
      stat: pct1(best.hit_rate),
      body:
        `${best.pos} Round ${best.rookie_round} (${best.hits}/${best.total} players).` +
        (best.elite_rate > 0.2 ? ` ${pct0(best.elite_rate)} reach Top-12.` : ""),
      tone: "positive",
      accent: "gold",
    });
    const worst = withHits.reduce((a, b) => (b.hit_rate < a.hit_rate ? b : a));
    if (worst.hit_rate < best.hit_rate) {
      insights.push({
        title: "Toughest Cohort",
        stat: `${((1 - worst.hit_rate) * 100).toFixed(0)}% Miss`,
        body: `${worst.pos} Round ${worst.rookie_round} - only ${worst.hits}/${worst.total} players hit at the ${lower} threshold.`,
        tone: "negative",
        accent: "red",
      });
    }
  }

  const fast = withHits
    .filter((c) => c.hit_by_year.year1 > 0.4 && c.hits >= 3)
    .sort((a, b) => b.hit_by_year.year1 - a.hit_by_year.year1);
  if (fast.length > 0) {
    const top = fast[0]!;
    const second = fast[1];
    insights.push({
      title: "Rookie-Year Impact",
      stat: `${pct0(top.hit_by_year.year1)} Year 1`,
      body:
        `${top.pos} Rd${top.rookie_round} hits break out immediately.` +
        (second ? ` ${second.pos} Rd${second.rookie_round}: ${pct0(second.hit_by_year.year1)}.` : ""),
      tone: "positive",
      accent: "slate",
    });
  }

  const slow = withHits
    .filter((c) => c.hit_by_year.year3_plus > 0.4 && c.hits >= 3)
    .sort((a, b) => b.hit_by_year.year3_plus - a.hit_by_year.year3_plus);
  if (slow.length > 0) {
    const top = slow[0]!;
    insights.push({
      title: "Slow Developers",
      stat: "Year 3+",
      body: `${top.pos} Rd${top.rookie_round} - ${pct0(top.hit_by_year.year3_plus)} of hits don't break out until Year 3 or later.`,
      tone: "neutral",
      accent: "slate",
    });
  }

  const highBust = withHits.filter((c) => c.bust_rate > 0.7 && c.total >= 10).sort((a, b) => b.bust_rate - a.bust_rate);
  if (highBust.length > 0) {
    insights.push({
      title: "High Bust Zones",
      stat: `${pct0(highBust[0]!.bust_rate)}+`,
      body: `${highBust
        .slice(0, 3)
        .map((c) => `${c.pos} Rd${c.rookie_round} (${pct0(c.bust_rate)})`)
        .join(", ")}. Manage expectations from these slots.`,
      tone: "negative",
      accent: "red",
    });
  }
  return insights;
}

/** pages/pick-range.tsx generateInsights. */
export function pickRangeInsights(cohorts: PickRangeCohortSummary[], outcomeName: string): Insight[] {
  if (cohorts.length < 2) return [];
  const insights: Insight[] = [];
  const withData = cohorts.filter((c) => c.total >= 3);

  if (withData.length > 0) {
    const best = withData.reduce((a, b) => (b.hit_rate > a.hit_rate ? b : a));
    insights.push({
      title: "Best Pick Range",
      stat: pct1(best.hit_rate),
      body:
        `${best.pos} picks ${best.rangeLabel} (${best.hits}/${best.total}).` +
        (best.elite_rate > 0.2 ? ` ${pct0(best.elite_rate)} reach Top-12.` : ""),
      tone: "positive",
      accent: "emerald",
    });
  }

  for (const round of [1, 2, 3]) {
    const roundCohorts = withData.filter((c) => c.rookie_round === round && c.total >= 3);
    if (roundCohorts.length < 2) continue;
    const top3 = roundCohorts.filter((c) => c.pickStart === 1);
    const late = roundCohorts.filter((c) => c.pickStart === 10);
    if (top3.length > 0 && late.length > 0) {
      const topRate = top3.reduce((s, c) => s + c.hit_rate * c.total, 0) / top3.reduce((s, c) => s + c.total, 0);
      const lateRate = late.reduce((s, c) => s + c.hit_rate * c.total, 0) / late.reduce((s, c) => s + c.total, 0);
      const diff = topRate - lateRate;
      if (Math.abs(diff) > 0.1) {
        insights.push({
          title: `Rd ${round} Drop-off`,
          stat: `${diff > 0 ? "+" : ""}${(diff * 100).toFixed(0)}pp`,
          body: `Picks ${round}.01-${round}.03 hit at ${pct0(topRate)} vs ${pct0(lateRate)} for ${round}.10-${round}.12.`,
          tone: diff > 0.2 ? "negative" : "neutral",
          accent: "violet",
        });
        break;
      }
    }
  }

  const fast = withData
    .filter((c) => c.hit_by_year.year1 > 0.5 && c.hits >= 3)
    .sort((a, b) => b.hit_by_year.year1 - a.hit_by_year.year1);
  if (fast.length > 0) {
    const top = fast[0]!;
    insights.push({
      title: "Instant Impact Range",
      stat: `${pct0(top.hit_by_year.year1)} Year 1`,
      body: `${top.pos} picks ${top.rangeLabel} - most hits break out immediately as rookies.`,
      tone: "positive",
      accent: "gold",
    });
  }

  const highBust = withData.filter((c) => c.bust_rate > 0.75 && c.total >= 5).sort((a, b) => b.bust_rate - a.bust_rate);
  if (highBust.length > 0) {
    insights.push({
      title: "High Bust Ranges",
      stat: `${pct0(highBust[0]!.bust_rate)}+`,
      body: `${highBust
        .slice(0, 3)
        .map((c) => `${c.pos} ${c.rangeLabel} (${pct0(c.bust_rate)})`)
        .join(", ")}. Pick placement within the round matters.`,
      tone: "negative",
      accent: "red",
    });
  }

  const worst = withData.filter((c) => c.total >= 5).sort((a, b) => a.hit_rate - b.hit_rate)[0];
  if (worst && worst.hit_rate < 0.15) {
    insights.push({
      title: "Toughest Range",
      stat: `${((1 - worst.hit_rate) * 100).toFixed(0)}% Miss`,
      body: `${worst.pos} picks ${worst.rangeLabel} - only ${worst.hits}/${worst.total} ever hit at ${outcomeName.toLowerCase()} level.`,
      tone: "negative",
      accent: "rose",
    });
  }
  return insights;
}

/** components/trends-chart.tsx generateInsights, over the pooled selection. */
export function trendInsights(data: TrendPoint[], label: string, outcomeName: string): Insight[] {
  if (data.length < 2) return [];
  const insights: Insight[] = [];
  const rates = data.map((d) => d.hitRate);
  const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
  const total = data.reduce((a, d) => a + d.n, 0);

  insights.push({
    title: "Overall Average",
    stat: pct1(avg),
    body: `${data.length} classes, ${total} players. ${label} produce a ${outcomeName.toLowerCase()} at this rate.`,
    tone: avg > 0.4 ? "positive" : avg > 0.2 ? "neutral" : "negative",
    accent: "blue",
  });

  const best = data.reduce((a, b) => (b.hitRate > a.hitRate ? b : a));
  if (best.hitRate > 0) {
    insights.push({
      title: "Best Class",
      stat: `${pct0(best.hitRate)} (${best.year})`,
      body: `${best.hits}/${best.n} players hit.${best.n < 5 ? " (Small sample)" : ""}`,
      tone: "positive",
      accent: "emerald",
    });
  }

  const worst = data.reduce((a, b) => (b.hitRate < a.hitRate ? b : a));
  if (worst.hitRate < best.hitRate) {
    insights.push({
      title: "Weakest Class",
      stat: `${pct0(worst.hitRate)} (${worst.year})`,
      body: `${worst.hits}/${worst.n} players.${worst.hitRate === 0 ? " Complete shutout." : ""}`,
      tone: "negative",
      accent: "rose",
    });
  }

  const recent = data.slice(-3);
  const older = data.slice(0, Math.max(1, data.length - 3));
  if (recent.length >= 2 && older.length >= 1) {
    const recentAvg = recent.reduce((a, d) => a + d.hitRate, 0) / recent.length;
    const olderAvg = older.reduce((a, d) => a + d.hitRate, 0) / older.length;
    const diff = recentAvg - olderAvg;
    if (Math.abs(diff) > 0.05) {
      insights.push({
        title: "Recent Trend",
        stat: `${diff > 0 ? "+" : ""}${(diff * 100).toFixed(1)}pts`,
        body: `Last 3 classes: ${pct1(recentAvg)} vs earlier ${pct1(olderAvg)}.`,
        tone: diff > 0 ? "positive" : "negative",
        accent: diff > 0 ? "emerald" : "red",
      });
    } else {
      insights.push({
        title: "Stable Trend",
        stat: `±${(Math.abs(diff) * 100).toFixed(1)}pts`,
        body: `Recent classes (${pct1(recentAvg)}) track close to historical (${pct1(olderAvg)}).`,
        tone: "neutral",
        accent: "slate",
      });
    }
  }

  const stability = stabilityOf(data);
  const sd = stability.stdDev;
  insights.push({
    title: "Stability Score",
    stat: `${stability.score}/100`,
    body:
      `${stability.label} (±${(sd * 100).toFixed(1)}% volatility). ` +
      (sd > 0.15
        ? "Outcomes vary heavily by class."
        : sd < 0.08
          ? "Consistent, predictable slot."
          : "Moderate year-to-year variation."),
    tone: sd > 0.15 ? "negative" : sd < 0.08 ? "positive" : "neutral",
    accent: "gold",
  });

  const zero = data.filter((d) => d.hitRate === 0);
  if (zero.length > 0 && zero.length < data.length) {
    insights.push({
      title: "Shutout Classes",
      stat: `${zero.length}/${data.length}`,
      body: `Zero-hit years: ${zero.map((d) => d.year).join(", ")}.${zero.length >= 3 ? " High bust risk." : ""}`,
      tone: "negative",
      accent: "red",
    });
  }
  return insights;
}

/** components/cohort-survival-chart.tsx generateCohortInsights. */
export function cohortInsights(survival: SurvivalGroup[]): Insight[] {
  if (survival.length === 0) return [];
  const insights: Insight[] = [];

  const withY1 = survival
    .map((g) => ({ group: g.group, n: g.n, y1: pctAt(g, 1) }))
    .filter((g) => g.y1 > 0)
    .sort((a, b) => b.y1 - a.y1);
  if (withY1.length > 0) {
    const fastest = withY1[0]!;
    const slowest = withY1[withY1.length - 1]!;
    insights.push({
      title: "Fastest to Hit",
      stat: `${pct1(fastest.y1)} Year 1`,
      body:
        `${fastest.group} (N=${fastest.n}) breaks out fastest.` +
        (withY1.length > 1 ? ` ${slowest.group}: just ${pct1(slowest.y1)}.` : ""),
      tone: "positive",
      accent: "gold",
    });
  }

  const withCeiling = survival
    .map((g) => ({ group: g.group, n: g.n, ceiling: Math.max(...g.data.map((d) => d.pct)) }))
    .sort((a, b) => b.ceiling - a.ceiling);
  if (withCeiling.length > 0) {
    const highest = withCeiling[0]!;
    const lowest = withCeiling[withCeiling.length - 1]!;
    insights.push({
      title: "Highest Ceiling",
      stat: pct1(highest.ceiling),
      body:
        `${highest.group} leads long-term (N=${highest.n}).` +
        (withCeiling.length > 1 && lowest.ceiling < highest.ceiling
          ? ` ${lowest.group} caps at ${pct1(lowest.ceiling)}.`
          : ""),
      tone: "positive",
      accent: "emerald",
    });
  }

  const deltaAfter3 = survival
    .map((g) => {
      const y3 = pctAt(g, 3);
      const y6 = pctAt(g, 6);
      return { group: g.group, y3, y6, delta: y6 - y3 };
    })
    .filter((g) => g.y3 > 0)
    .sort((a, b) => b.delta - a.delta);

  if (deltaAfter3.length > 0 && deltaAfter3[0]!.delta > 0.02) {
    const top = deltaAfter3[0]!;
    insights.push({
      title: "Post-Year 3 Growth",
      stat: `+${(top.delta * 100).toFixed(1)}pts`,
      body: `${top.group}: ${pct1(top.y3)} → ${pct1(top.y6)} between Years 3–6. Patience rewarded.`,
      tone: "neutral",
      accent: "sky",
    });
  }

  const plateau = deltaAfter3.filter((g) => g.delta < 0.03 && g.y3 > 0.1);
  if (plateau.length > 0) {
    insights.push({
      title: "Early Plateau",
      stat: "Year 3",
      body: `${plateau.map((g) => g.group).join(", ")} plateau by Year 3. If they haven't hit, they likely won't.`,
      tone: "negative",
      accent: "rose",
    });
  }

  const late = deltaAfter3.filter((g) => g.delta >= 0.08);
  if (late.length > 0) {
    insights.push({
      title: "Late Bloomers",
      stat: `+${late.map((g) => (g.delta * 100).toFixed(1)).join(", ")}pts`,
      body: `${late.map((g) => g.group).join(", ")} develop well past Year 3. Hold longer before cutting.`,
      tone: "neutral",
      accent: "violet",
    });
  }

  if (survival.length >= 3) {
    const y6 = survival.map((g) => ({ group: g.group, y6: pctAt(g, 6) })).sort((a, b) => b.y6 - a.y6);
    const top = y6[0]!;
    const bottom = y6[y6.length - 1]!;
    const spread = top.y6 - bottom.y6;
    if (spread > 0.15) {
      insights.push({
        title: "Wide Separation",
        stat: `${(spread * 100).toFixed(1)}pt gap`,
        body: `${top.group} (${pct1(top.y6)}) vs ${bottom.group} (${pct1(bottom.y6)}). Draft capital matters.`,
        tone: "neutral",
        accent: "blue",
      });
    }
  }
  return insights;
}

/* ----------------------------------------------------------- the views */

export function selectedPositions(filters: Filters): Pos[] {
  return filters.positions.length > 0 ? POSITIONS.filter((p) => filters.positions.includes(p)) : [...POSITIONS];
}

export function selectedRounds(filters: Filters): number[] {
  return filters.rounds.length > 0 ? ROUNDS.filter((r) => filters.rounds.includes(r)) : [...ROUNDS];
}

/**
 * Everything one board needs, computed once per (format, scoring): the
 * unpacked drafts and the rank map. What every view below starts from.
 */
export interface Board {
  data: PackedDataset;
  drafts: RookieDraft[];
  ranks: RankMap;
}

export function makeBoard(data: PackedDataset, format: Format, scoring: Scoring): Board {
  return { data, drafts: boardDrafts(data, format, scoring), ranks: rankMap(data, scoring) };
}

export interface OverviewView {
  cohorts: CohortSummary[];
  insights: Insight[];
  pickRange: PickRangeCohortSummary[];
  pickRangeInsights: Insight[];
}

export function overviewView(board: Board, filters: Filters): OverviewView {
  const latest = board.data.latestSeason;
  const name = OUTCOME_LABELS[filters.outcome];
  const cohorts = computeCohorts(board.drafts, board.ranks, filters, latest);
  const pickRange = computePickRangeCohorts(board.drafts, board.ranks, filters, latest);
  return {
    cohorts,
    insights: overviewInsights(cohorts, name).slice(0, 4),
    pickRange,
    pickRangeInsights: pickRangeInsights(pickRange, name),
  };
}

export interface TrendsView {
  series: TrendSeries[];
  pooled: TrendPoint[];
  stability: Stability;
  insights: Insight[];
}

export function trendsView(board: Board, filters: Filters): TrendsView {
  const series = trendSeries(board.drafts, board.ranks, filters, board.data.latestSeason);
  const pooled = pooledTrend(series);
  const label = `${selectedPositions(filters).join("/")} Rd ${selectedRounds(filters).join("/")}`;
  return {
    series,
    pooled,
    stability: stabilityOf(pooled),
    insights: trendInsights(pooled, label, OUTCOME_LABELS[filters.outcome]),
  };
}

export interface CohortsView {
  survival: SurvivalGroup[];
  insights: Insight[];
  patience: { group: string; n: number; pi: number }[];
  roster: { rows: RosterRow[]; takeaway: string };
}

export function cohortsView(board: Board, filters: Filters, groupBy: GroupBy): CohortsView {
  const survival = computeSurvival(
    board.drafts,
    board.ranks,
    groupBy,
    filters.outcome,
    filters.minGames,
    board.data.latestSeason,
    filters.positions.length > 0 ? filters.positions : undefined,
    filters.rounds.length > 0 ? filters.rounds : undefined,
  );
  return {
    survival,
    insights: cohortInsights(survival),
    patience: survival.map((g) => ({ group: g.group, n: g.n, pi: patienceIndex(g) })).sort((a, b) => b.pi - a.pi),
    roster: rosterOdds(survival),
  };
}

export function playerSummaries(board: Board, filters: Filters): PlayerSummary[] {
  return computePlayerSummaries(board.drafts, board.ranks, filters.outcome, filters.minGames, board.data.latestSeason);
}
