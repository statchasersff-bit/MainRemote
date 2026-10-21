/**
 * The dashboard's state and the views computed from it: every figure the
 * sections print, in one object, so the server and the bundle draw from the
 * same numbers. `computeViews` is the app's chain of memos run once.
 */

import {
  DEFAULT_FILTERS,
  DEFAULT_SIM_STATE,
  INJURY_SORT_ACCESSORS,
  POSITION_SORT_ACCESSORS,
  agingWorkload,
  avgGamesMissedData,
  chart1Data,
  chart2Data,
  chart4Data,
  draftCapitalRisk,
  draftedByPosition,
  execSummary,
  filteredPlayers,
  injuryCategoryOptions,
  injuryOutcomes,
  injuryPosOptions,
  injuryPredictability,
  injuryRateData,
  injuryTiming,
  injuryTypeBreakdown,
  injuryTypeDisplay,
  injuryTypeRisk,
  injuryTypeVisible,
  positionImpact,
  regionHeatmap,
  seasonMetrics,
  seasonOptions,
  seasonTrends,
  sortRows,
  workloadRates,
  worstOf,
  type AgingWorkload,
  type DraftCapitalRisk,
  type ExecSummary,
  type Filters,
  type InjuryOutcomes,
  type InjuryPredictability,
  type InjuryTiming,
  type InjuryTypeDisplay,
  type InjuryTypeRisk,
  type InjuryTypeRow,
  type PositionImpactRow,
  type QuestionTab,
  type RegionHeatmap,
  type ScatterPoint,
  type SeasonMetric,
  type SeasonOption,
  type SeasonSeries,
  type SeasonTrends,
  type SimState,
  type SortState,
  type WorkloadRate,
} from "./model";
import type { InjuryDataset, PlayerInjuryImpact } from "./types";

export interface DashState {
  filters: Filters;
  tab: QuestionTab;
  posSort: SortState;
  injSort: SortState;
  injuryCategory: string;
  injuryPos: string;
  injurySearch: string;
  showAllInjuries: boolean;
  /** Chart id -> the series keys hidden by its legend. */
  hidden: Record<string, string[]>;
  /** The folds (details) that are open. */
  open: string[];
  sim: SimState;
}

export function defaultDashState(): DashState {
  return {
    filters: { ...DEFAULT_FILTERS, adp: [...DEFAULT_FILTERS.adp] },
    tab: "q-safer",
    posSort: { key: null, dir: "desc" },
    injSort: { key: null, dir: "desc" },
    injuryCategory: "all",
    injuryPos: "all",
    injurySearch: "",
    showAllInjuries: false,
    hidden: {},
    open: [],
    sim: { ...DEFAULT_SIM_STATE, hidden: [] },
  };
}

export function isHidden(state: DashState, chart: string, key: string): boolean {
  return (state.hidden[chart] ?? []).includes(key);
}

export function toggleHidden(state: DashState, chart: string, key: string): void {
  const cur = state.hidden[chart] ?? [];
  state.hidden[chart] = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
}

export interface Views {
  seasonOptions: SeasonOption[];
  filtered: PlayerInjuryImpact[];
  outcomes: InjuryOutcomes;
  dcr: DraftCapitalRisk;
  predictability: InjuryPredictability;
  aw: AgingWorkload | null;
  timing: InjuryTiming;
  typeRisk: InjuryTypeRisk;
  trends: SeasonTrends | null;
  metrics: SeasonMetric[];
  heatmap: RegionHeatmap | null;
  workload: WorkloadRate[] | null;
  drafted: Record<string, number>;
  posImpact: PositionImpactRow[];
  sortedPos: PositionImpactRow[];
  breakdown: InjuryTypeRow[];
  categoryOptions: string[];
  posOptions: string[];
  visible: InjuryTypeRow[];
  display: InjuryTypeDisplay;
  sortedInj: InjuryTypeRow[];
  injWorst: { points: string | null; avg: string | null };
  chart1: SeasonSeries[];
  chart2: SeasonSeries[];
  avgGames: SeasonSeries[];
  injuryRate: SeasonSeries[];
  scatter: ScatterPoint[];
  exec: ExecSummary;
  multiSeason: boolean;
}

/** Everything the sections print, from the dataset and the state's filters. */
export function computeViews(ds: InjuryDataset, state: DashState): Views {
  const data = ds.analysis;
  const f = state.filters;
  const filtered = filteredPlayers(data, f);
  const drafted = draftedByPosition(data, f);
  const posImpact = positionImpact(filtered, drafted);
  const breakdown = injuryTypeBreakdown(filtered, state.injuryPos);
  const visible = injuryTypeVisible(breakdown, state.injuryCategory, state.injurySearch);
  const display = injuryTypeDisplay(visible, state.showAllInjuries);
  const sortedInj = sortRows(display.rows, state.injSort, INJURY_SORT_ACCESSORS);
  const trends = seasonTrends(data, ds.exposure, f.adp);
  const aw = agingWorkload(ds.panel);
  return {
    seasonOptions: seasonOptions(data),
    filtered,
    outcomes: injuryOutcomes(data, ds.exposure, f),
    dcr: draftCapitalRisk(data, f.season),
    predictability: injuryPredictability(data),
    aw,
    timing: injuryTiming(data),
    typeRisk: injuryTypeRisk(data, ds.postReturn),
    trends,
    metrics: seasonMetrics(data, f.adp),
    heatmap: regionHeatmap(data, f.adp),
    workload: workloadRates(data, ds.exposure),
    drafted,
    posImpact,
    sortedPos: sortRows(posImpact, state.posSort, POSITION_SORT_ACCESSORS),
    breakdown,
    categoryOptions: injuryCategoryOptions(breakdown),
    posOptions: injuryPosOptions(filtered),
    visible,
    display,
    sortedInj,
    injWorst: {
      points: worstOf(sortedInj, (r) => r.points_lost, (r) => r.type),
      avg: worstOf(sortedInj, (r) => r.avg_loss, (r) => r.type),
    },
    chart1: chart1Data(filtered),
    chart2: chart2Data(filtered),
    avgGames: avgGamesMissedData(data, f, filtered),
    injuryRate: injuryRateData(data, f, filtered),
    scatter: chart4Data(filtered),
    exec: execSummary(trends, aw, ds.postReturn, ds.regression),
    multiSeason: f.season === "All",
  };
}
