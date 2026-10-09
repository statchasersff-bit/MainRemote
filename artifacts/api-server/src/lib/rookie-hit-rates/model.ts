/**
 * The rookie hit rate model: the standalone app's arithmetic, unchanged.
 *
 * Ported from statchasersff-bit/Rookie-Hit-Rate at 9c69b00 (2026-10-08) -
 * client/src/lib/cohort.ts, ranks.ts and data-context.tsx for the numbers, and
 * the insight generators, patience math and class-table logic that live
 * inside its page components (pages/overview.tsx, components/trends-chart.tsx,
 * components/cohort-survival-chart.tsx). Every threshold, sample floor and
 * tie-break is the source's, including the ones that look accidental - the
 * Draft Classes cards and the Year-by-Year tab, for one, ignore the season
 * range, because the source's do. A difference from the app would be a
 * difference in a number a reader has already seen there.
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
/** The Overview's one table, shown as the heatmap ("Simple") or the pick ranges ("Detailed"). */
export type TableView = "simple" | "detailed";
export type GroupBy = "pos" | "round";
export type Tone = "positive" | "negative" | "neutral";
export type Accent = "gold" | "blue" | "emerald" | "violet" | "rose" | "sky" | "red" | "slate";
export type SortDir = "asc" | "desc";
export type SortField = "player_name" | "current_nfl_team" | "rookie_year" | "rookie_round" | "best_finish" | "breakout_time";
/** The Draft Classes table's columns. */
export type ClassSortKey = "year" | Pos | "total";

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
  /**
   * Added by the server per request: where this server's headshot
   * derivatives and crest SVGs live, and each player's headshot version
   * (null: Sleeper has no photo; absent: not known yet, so `latest`).
   */
  assets?: RhrAssets;
}

export interface RhrAssets {
  origin: string;
  headshots: Record<string, string | null>;
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
  /** The heatmap cell the Best Finish card reads; null falls back to the first cohort, as the source. */
  selected: { pos: Pos; round: number } | null;
  tableView: TableView;
  /** The Draft Classes table's sort and which classes are open to their draft board. */
  classSort: { key: ClassSortKey; dir: SortDir };
  expandedYears: number[];
  groupBy: GroupBy;
  sortField: SortField;
  sortDir: SortDir;
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
    tableView: "simple",
    classSort: { key: "year", dir: "asc" },
    expandedYears: [],
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
function summarize(group: RookieDraft[], ranks: RankMap, filters: Filters, pos: Pos, round: number): CohortSummary {
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
    results.push(summarize(group, ranks, filters, pos as Pos, parseInt(round!, 10)));
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
      ...summarize(group, ranks, filters, pos, round),
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

/** Every selected cohort pooled by class year: what the class cards read. */
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

export interface PosAgg {
  pos: Pos;
  hits: number;
  n: number;
  hitRate: number;
}

/** Every selected series pooled by position, across rounds and classes: the position cards. */
export function trendByPosition(series: TrendSeries[]): PosAgg[] {
  const map = new Map<Pos, PosAgg>();
  for (const s of series) {
    const cur = map.get(s.pos) ?? { pos: s.pos, hits: 0, n: 0, hitRate: 0 };
    for (const t of s.raw) {
      cur.hits += t.hits;
      cur.n += t.n;
    }
    map.set(s.pos, cur);
  }
  const rows = Array.from(map.values());
  for (const r of rows) r.hitRate = r.n > 0 ? r.hits / r.n : 0;
  return rows;
}

/* --------------------------------------------------------- draft classes */

/** One draft class: how many rookies hit at each position, pooled across every round. */
export interface ClassRow {
  year: number;
  QB: number;
  RB: number;
  WR: number;
  TE: number;
  total: number;
}

/** A drafted rookie on a class's draft board. */
export interface BoardPlayer {
  id: string;
  name: string;
  pos: Pos;
  round: number;
  pick: number;
  sleeperId: string | null;
  hit: boolean;
}

/**
 * trends-chart.tsx classRows: one row per class in the season range (and no
 * later than the latest season with data). Always every position and round,
 * whatever the Position/Round filters say; the outcome and games floor apply.
 * A class that drafted nobody on this board is left out, one that hit nobody
 * is kept.
 */
export function classRows(drafts: RookieDraft[], ranks: RankMap, filters: Filters, latestSeason: number): ClassRow[] {
  const hitsByPos = new Map<Pos, Map<number, number>>();
  const drafted = new Map<number, number>();
  for (const pos of POSITIONS) {
    const m = new Map<number, number>();
    for (const round of ROUNDS) {
      for (const t of computeTrends(drafts, ranks, pos, round, filters.outcome, filters.minGames, latestSeason)) {
        m.set(t.year, (m.get(t.year) ?? 0) + t.hits);
        drafted.set(t.year, (drafted.get(t.year) ?? 0) + t.n);
      }
    }
    hitsByPos.set(pos, m);
  }
  const rows: ClassRow[] = [];
  const end = Math.min(filters.yearEnd, latestSeason);
  for (let y = filters.yearStart; y <= end; y++) {
    if ((drafted.get(y) ?? 0) === 0) continue;
    const at = (pos: Pos) => hitsByPos.get(pos)!.get(y) ?? 0;
    rows.push({ year: y, QB: at("QB"), RB: at("RB"), WR: at("WR"), TE: at("TE"), total: POSITIONS.reduce((s, p) => s + at(p), 0) });
  }
  return rows;
}

/** The class table sorted as the source's: ties fall back to the year, ascending. */
export function sortClassRows(rows: ClassRow[], sort: State["classSort"]): ClassRow[] {
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const diff = a[sort.key] - b[sort.key];
    return diff !== 0 ? diff * dir : a.year - b.year;
  });
}

/**
 * trends-chart.tsx boardsByYear: every rookie drafted in a class, rounds 1-5,
 * in pick order, flagged with the same hit rule the class counts use.
 */
export function draftBoard(drafts: RookieDraft[], ranks: RankMap, filters: Filters, year: number): BoardPlayer[] {
  const threshold = outcomeThreshold(filters.outcome);
  const players: BoardPlayer[] = [];
  for (const d of drafts) {
    if (d.rookie_year !== year || !ROUNDS.includes(d.rookie_round)) continue;
    const seasons = ranks.get(d.player_id) ?? [];
    players.push({
      id: d.player_id,
      name: d.player_name,
      pos: d.pos,
      round: d.rookie_round,
      pick: d.rookie_pick,
      sleeperId: d.sleeper_id,
      hit: seasons.some((s) => s.games >= filters.minGames && s.season >= d.rookie_year && s.pos_rank <= threshold),
    });
  }
  return players.sort((a, b) => a.round - b.round || a.pick - b.pick);
}

/** "Ja'Marr Chase" -> "J. Chase", keeping a multi-word surname or suffix. */
export function abbreviateName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2 || !parts[0]) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
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

/**
 * Given a player has NOT hit by a checkpoint, the chance he still records a
 * first hit later: (ceiling - Hk) / (1 - Hk), where Hk is the cumulative hit
 * share by the checkpoint and the ceiling is the eventual (career) hit rate.
 * A 0-1 fraction; 0 when everyone has already hit, so nobody is left waiting.
 */
export function conditionalHitOdds(ceiling: number, hitByCheckpoint: number): number {
  const notYetHit = 1 - hitByCheckpoint;
  if (notYetHit <= 0) return 0;
  return Math.max(0, (ceiling - hitByCheckpoint) / notYetHit);
}

const ceilingOf = (g: SurvivalGroup) => Math.max(...g.data.map((d) => d.pct), 0);

export interface PatienceRow {
  group: string;
  n: number;
  /** Odds, in percent, of an eventual hit for a player who did not hit as a rookie. */
  odds: number;
}

/** The "Hit Rates After Year 1" table: Year 1 is the checkpoint. Highest odds first. */
export function patienceRows(survival: SurvivalGroup[]): PatienceRow[] {
  return survival
    .map((g) => ({ group: g.group, n: g.n, odds: conditionalHitOdds(ceilingOf(g), pctAt(g, 1)) * 100 }))
    .sort((a, b) => b.odds - a.odds);
}

export interface RosterRow {
  group: string;
  n: number;
  y1: number;
  y2: number;
  y3: number;
  ceiling: number;
  /** The conditional odds after each checkpoint; remY3 is afterY3, the sort key. */
  afterY1: number;
  afterY2: number;
  afterY3: number;
  remY3: number;
}

/** The Remaining Hit Odds table, sorted by the odds left after Year 3, and its takeaway line. */
export function rosterOdds(survival: SurvivalGroup[]): { rows: RosterRow[]; takeaway: string } {
  const rows = survival
    .map((g) => {
      const ceiling = ceilingOf(g);
      const y1 = pctAt(g, 1);
      const y2 = pctAt(g, 2);
      const y3 = pctAt(g, 3);
      const afterY3 = conditionalHitOdds(ceiling, y3);
      return {
        group: g.group,
        n: g.n,
        y1,
        y2,
        y3,
        ceiling,
        afterY1: conditionalHitOdds(ceiling, y1),
        afterY2: conditionalHitOdds(ceiling, y2),
        afterY3,
        remY3: afterY3,
      };
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
 * the outcome badge counts only qualifying ones. Only seasons from the rookie
 * year on count: a few source rows carry an earlier player's history under
 * the same id, which read as a hit (and a negative breakout year) before the
 * rookie entered the league.
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
    const seasons = (ranks.get(d.player_id) ?? [])
      .filter((s) => s.season >= d.rookie_year)
      .sort((a, b) => a.season - b.season);
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

/**
 * A row with no value ("-") sorts last whichever way the column runs; null
 * when both rows have one, so the caller compares them.
 */
function missingLast(aMissing: boolean, bMissing: boolean): number | null {
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return null;
}

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
      case "best_finish": {
        const m = missingLast(a.best_finish === "N/A", b.best_finish === "N/A");
        if (m !== null) return m;
        cmp = a.best_rank - b.best_rank;
        break;
      }
      case "breakout_time": {
        const m = missingLast(a.breakout_time === null, b.breakout_time === null);
        if (m !== null) return m;
        cmp = (a.breakout_time as number) - (b.breakout_time as number);
        break;
      }
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

/** pages/overview.tsx generateOverviewInsights. The page shows the first six. */
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
    tone: "neutral",
    accent: "slate",
  });

  const byPosition = new Map<Pos, { hits: number; total: number }>();
  for (const c of cohorts) {
    const agg = byPosition.get(c.pos) ?? { hits: 0, total: 0 };
    agg.hits += c.hits;
    agg.total += c.total;
    byPosition.set(c.pos, agg);
  }
  const positionRates = Array.from(byPosition.entries())
    .filter(([, v]) => v.total > 0)
    .map(([pos, v]) => ({ pos, hits: v.hits, total: v.total, rate: v.hits / v.total }));
  if (positionRates.length > 1) {
    const bestPos = positionRates.reduce((a, b) => (b.rate > a.rate ? b : a));
    insights.push({
      title: "Highest Position Hit Rate",
      stat: pct1(bestPos.rate),
      body: `${bestPos.pos} hits most often: ${bestPos.hits}/${bestPos.total} rookies reached the ${lower} threshold.`,
      tone: "neutral",
      accent: "gold",
    });
    const worstPos = positionRates.reduce((a, b) => (b.rate < a.rate ? b : a));
    if (worstPos.pos !== bestPos.pos) {
      insights.push({
        title: "Lowest Position Hit Rate",
        stat: pct1(worstPos.rate),
        body: `${worstPos.pos} hits least often: ${worstPos.hits}/${worstPos.total} rookies reached the ${lower} threshold.`,
        tone: "neutral",
        accent: "red",
      });
    }
  }

  const withHits = cohorts.filter((c) => c.total >= 5);
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
      tone: "neutral",
      accent: "slate",
    });
  }
  return insights;
}

/** components/trends-chart.tsx generateInsights: the best and worst class, then position. */
export function trendInsights(data: TrendPoint[], byPosition: PosAgg[], outcomeName: string): Insight[] {
  if (data.length < 1) return [];
  const insights: Insight[] = [];
  const lower = outcomeName.toLowerCase();

  const best = data.reduce((a, b) => (b.hitRate > a.hitRate ? b : a));
  insights.push({
    title: "Best Overall Class",
    stat: `${pct0(best.hitRate)} (${best.year})`,
    body: `${best.hits}/${best.n} players hit ${lower}.${best.n < 5 ? " (Small sample)" : ""}`,
    tone: "positive",
    accent: "emerald",
  });

  const worst = data.reduce((a, b) => (b.hitRate < a.hitRate ? b : a));
  if (worst.year !== best.year) {
    insights.push({
      title: "Worst Overall Class",
      stat: `${pct0(worst.hitRate)} (${worst.year})`,
      body: `${worst.hits}/${worst.n} players hit ${lower}.${worst.hitRate === 0 ? " Complete shutout." : ""}`,
      tone: "negative",
      accent: "rose",
    });
  }

  const posWithData = byPosition.filter((p) => p.n > 0);
  if (posWithData.length > 0) {
    const bestPos = posWithData.reduce((a, b) => (b.hitRate > a.hitRate ? b : a));
    insights.push({
      title: "Best Overall Position",
      stat: `${pct0(bestPos.hitRate)} (${bestPos.pos})`,
      body: `${bestPos.hits}/${bestPos.n} hit ${lower} across ${data.length} classes.`,
      tone: "positive",
      accent: "emerald",
    });
    if (posWithData.length > 1) {
      const worstPos = posWithData.reduce((a, b) => (b.hitRate < a.hitRate ? b : a));
      if (worstPos.pos !== bestPos.pos) {
        insights.push({
          title: "Worst Overall Position",
          stat: `${pct0(worstPos.hitRate)} (${worstPos.pos})`,
          body: `${worstPos.hits}/${worstPos.n} hit ${lower} across ${data.length} classes.`,
          tone: "negative",
          accent: "rose",
        });
      }
    }
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
      stat: fastest.group,
      body:
        `${pct1(fastest.y1)} by Year 1 (N=${fastest.n}). Breaks out fastest.` +
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
      title: "Highest Chance to Hit",
      stat: highest.group,
      body:
        `${pct1(highest.ceiling)} long-term (N=${highest.n}). Leads the field.` +
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

  const plateau = deltaAfter3.filter((g) => g.delta < 0.03 && g.y3 > 0.1);
  if (plateau.length > 0) {
    insights.push({
      title: "Early Plateau",
      stat: plateau.map((g) => g.group).join(", "),
      body: "Plateau by Year 3. If they haven't hit, they likely won't.",
      tone: "negative",
      accent: "rose",
    });
  }

  const late = deltaAfter3.filter((g) => g.delta >= 0.08);
  if (late.length > 0) {
    insights.push({
      title: "Late Bloomers",
      stat: late.map((g) => g.group).join(", "),
      body: `+${late.map((g) => (g.delta * 100).toFixed(1)).join(", ")}pts past Year 3, so they develop late. Hold longer before cutting.`,
      tone: "neutral",
      accent: "violet",
    });
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
}

export function overviewView(board: Board, filters: Filters): OverviewView {
  const latest = board.data.latestSeason;
  const cohorts = computeCohorts(board.drafts, board.ranks, filters, latest);
  return {
    cohorts,
    insights: overviewInsights(cohorts, OUTCOME_LABELS[filters.outcome]).slice(0, 6),
    pickRange: computePickRangeCohorts(board.drafts, board.ranks, filters, latest),
  };
}

export interface TrendsView {
  /** One per selected position x round: what the cards pool. */
  series: TrendSeries[];
  pooled: TrendPoint[];
  byPosition: PosAgg[];
  insights: Insight[];
  /** The class table: every position and round, in the season range. */
  classes: ClassRow[];
}

export function trendsView(board: Board, filters: Filters): TrendsView {
  const series = trendSeries(board.drafts, board.ranks, filters, board.data.latestSeason);
  const pooled = pooledTrend(series);
  const byPosition = trendByPosition(series);
  return {
    series,
    pooled,
    byPosition,
    insights: trendInsights(pooled, byPosition, OUTCOME_LABELS[filters.outcome]),
    classes: classRows(board.drafts, board.ranks, filters, board.data.latestSeason),
  };
}

export interface CohortsView {
  survival: SurvivalGroup[];
  insights: Insight[];
  patience: PatienceRow[];
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
    patience: patienceRows(survival),
    roster: rosterOdds(survival),
  };
}

export function playerSummaries(board: Board, filters: Filters): PlayerSummary[] {
  return computePlayerSummaries(board.drafts, board.ranks, filters.outcome, filters.minGames, board.data.latestSeason);
}
