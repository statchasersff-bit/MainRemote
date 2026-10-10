/**
 * Redraft draft strategy bundle.
 *
 * The tool is complete before this runs: the default view (1QB, PPR, no TE
 * premium, 12 teams, 2025), every number in the HTML. What the standalone
 * app's React state did, this does over that markup:
 *
 * 1. **The filters.** A pill or the season select loads the slice the view
 *    needs (/embed/redraft-strategy/data/combo/<key>, /trends/<key>, and the
 *    /boards once) and redraws the view with lib/redraft-strategy/render.ts -
 *    the module the server drew the default with - so a view here is exactly
 *    what the server would have sent.
 * 2. **The Strategy Ranking chart**: its metric switch, a hover read-out per
 *    bar, and a redraw at the column's real width.
 * 3. **The tables**: sortable headers, rows that open to their explanation,
 *    the First Five Rounds' low-sample toggle, the Round Value round select.
 * 4. **The comparison**: the Playoff % / Top 3 PF % switch, the pooled /
 *    season-balanced weighting, sorting, and the by-round select.
 * 5. **The draft board**: the strategy select and the previous / next pair.
 * 6. **The glossary** panel.
 *
 * Nothing is written to the URL. The app's WordPress build kept all of this
 * in memory, and so does this.
 */

import { wireFrameHeight } from "./enhance";
import {
  DEFAULT_WIDTHS,
  renderBarTip,
  renderChartSection,
  renderCompareRound,
  renderContextBar,
  renderDraftBoard,
  renderFilterBar,
  renderRoundValue,
  renderStrategyTable,
  renderView,
  type Widths,
} from "../lib/redraft-strategy/render";
import { rdsFaqFacts, renderRdsFaq } from "../lib/redraft-strategy/faq";
import {
  chartView,
  compareChartRows,
  comboKey,
  coerceSupportedFormat,
  defaultState,
  defaultTableState,
  mergeStrategies,
  nextCompareSort,
  nextSort,
  parseFilters,
  tableState,
  trendKey,
  type ChartMetric,
  type ChartView,
  type Combo,
  type CompareSortKey,
  type Dataset,
  type Filters,
  type State,
  type StrategyRow,
  type StrategySortKey,
  type Trend,
  type Weighting,
} from "../lib/redraft-strategy/model";

const ROOT_SELECTOR = "[data-scds-root]";

interface Tool {
  root: HTMLElement;
  dataUrl: string;
  data: Dataset;
  /** Slices on their way, by URL. */
  loading: Map<string, Promise<unknown>>;
  boardsLoaded: boolean;
  state: State;
  tip: HTMLElement;
  lastWidth: number;
}

/* ---------------------------------------------------------------- helpers */

function el<T extends HTMLElement = HTMLElement>(t: Tool, selector: string): T | null {
  return t.root.querySelector<T>(selector);
}

function widths(t: Tool): Widths {
  const chart = el(t, "[data-chart]");
  const view = el(t, "[data-scds-view]");
  const w = chart?.clientWidth || (view ? view.clientWidth - 34 : 0) || DEFAULT_WIDTHS.chart;
  return { chart: Math.max(280, Math.min(1400, w)) };
}

function currentCombo(t: Tool): Combo | null {
  const f = t.state.filters;
  return f.season === "compare" ? null : (t.data.combos[comboKey(f)] ?? null);
}

function currentTrend(t: Tool): Trend | null {
  const f = t.state.filters;
  return f.season === "compare" ? (t.data.trends[trendKey(f)] ?? null) : null;
}

function currentChartView(t: Tool): ChartView | null {
  const combo = currentCombo(t);
  if (combo) {
    return chartView([...combo.best_strategies, ...combo.worst_strategies], combo.baseline.playoff_rate, t.state.chartMetric);
  }
  const trend = currentTrend(t);
  if (trend) {
    const c = compareChartRows(trend);
    return chartView(c.rows, c.baseline, t.state.chartMetric);
  }
  return null;
}

/** The rows a strategy table block shows, by its id. */
function tableRows(t: Tool, id: string): StrategyRow[] {
  const combo = currentCombo(t);
  if (!combo) {
    if (id === "overall") return mergeStrategies(t.data.summary.best_overall_strategies, t.data.summary.worst_overall_strategies);
    return [];
  }
  if (id === "overall") return mergeStrategies(combo.best_strategies, combo.worst_strategies);
  if (id === "first-two") return combo.best_first_two_pick_combos;
  if (id === "first-five") return combo.best_first_five_builds;
  return [];
}

/* ------------------------------------------------------------ data load */

function fetchJson<T>(t: Tool, url: string): Promise<T | null> {
  const pending = t.loading.get(url);
  if (pending) return pending as Promise<T | null>;
  const p = fetch(url, { credentials: "omit" })
    .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
    .catch(() => null)
    .finally(() => t.loading.delete(url));
  t.loading.set(url, p);
  return p;
}

/** Load what the current filters need; resolves true when the view can draw. */
async function ensureData(t: Tool): Promise<boolean> {
  const f = t.state.filters;
  const jobs: Promise<unknown>[] = [];
  if (f.season === "compare") {
    const key = trendKey(f);
    if (!t.data.trends[key]) {
      jobs.push(
        fetchJson<Trend>(t, `${t.dataUrl}/trends/${key}`).then((trend) => {
          if (trend) t.data.trends[key] = trend;
        }),
      );
    }
  } else {
    const key = comboKey(f);
    if (!t.data.combos[key]) {
      jobs.push(
        fetchJson<Combo>(t, `${t.dataUrl}/combo/${key}`).then((combo) => {
          if (combo) t.data.combos[key] = combo;
        }),
      );
    }
    jobs.push(ensureBoards(t));
  }
  if (!jobs.length) return true;
  t.root.setAttribute("aria-busy", "true");
  await Promise.all(jobs);
  t.root.removeAttribute("aria-busy");
  return f.season === "compare" ? !!t.data.trends[trendKey(f)] : !!t.data.combos[comboKey(f)];
}

async function ensureBoards(t: Tool): Promise<void> {
  if (t.boardsLoaded) return;
  const slice = await fetchJson<{ boards: Dataset["boards"]; assets: Dataset["assets"] }>(t, `${t.dataUrl}/boards`);
  if (slice && Array.isArray(slice.boards)) {
    t.data.boards = slice.boards;
    t.data.assets = slice.assets;
    t.boardsLoaded = true;
  }
}

/* ------------------------------------------------------------- rendering */

function redrawView(t: Tool): void {
  const view = el(t, "[data-scds-view]");
  if (!view) return;
  view.innerHTML = renderView(t.data, t.state, widths(t));
  hideTip(t);
}

/** The FAQ's sample sentences quote the open view; redrawn with the filters, open folds kept. */
function redrawFaq(t: Tool): void {
  const faq = el(t, "[data-scds-faq]");
  if (!faq) return;
  const open = new Set([...faq.querySelectorAll<HTMLDetailsElement>("details[open]")].map((d) => d.querySelector("h3")?.textContent ?? ""));
  faq.outerHTML = renderRdsFaq(rdsFaqFacts(t.data, t.state.filters));
  el(t, "[data-scds-faq]")?.querySelectorAll<HTMLDetailsElement>("details").forEach((d) => {
    if (open.has(d.querySelector("h3")?.textContent ?? "")) d.open = true;
  });
}

function redrawBar(t: Tool): void {
  const bar = el(t, "[data-scds-bar]");
  if (bar) bar.outerHTML = renderFilterBar(t.state.filters, t.state.glossaryOpen);
  const ctx = el(t, "[data-scds-ctx]");
  if (ctx) ctx.outerHTML = renderContextBar(t.state.filters, currentCombo(t), currentTrend(t), t.data.summary);
  t.root.dataset["scdsSeason"] = t.state.filters.season;
}

function redrawChart(t: Tool): void {
  const section = el(t, "[data-chart-section]");
  const view = currentChartView(t);
  if (!section || !view) return;
  section.outerHTML = renderChartSection(view, t.state.chartMetric, widths(t).chart);
  hideTip(t);
}

function redrawTable(t: Tool, id: string): void {
  const block = el(t, `[data-table="${id}"]`);
  if (!block) return;
  const minSample = Number(block.dataset["minSample"] ?? "0");
  const showTitleRate = block.dataset["titleRate"] === "1";
  const title = block.querySelector(".scds-h2")?.textContent ?? undefined;
  block.outerHTML = renderStrategyTable(tableRows(t, id), tableState(t.state, id), { id, title, minSample, showTitleRate });
}

function redrawRound(t: Tool): void {
  const section = el(t, "[data-round-section]");
  const combo = currentCombo(t);
  if (!section) return;
  section.outerHTML = renderRoundValue(combo ? combo.round_value.rounds : null, t.state.roundSel, tableState(t.state, "round").expanded, !!combo);
}

function redrawBoard(t: Tool): void {
  const section = el(t, "[data-board-section]");
  if (!section) return;
  section.outerHTML = renderDraftBoard(t.data.boards, t.state.board, t.data.assets);
}

function redrawCompareRound(t: Tool): void {
  const section = el(t, "[data-compare-round-section]");
  const trend = currentTrend(t);
  if (!section || !trend) return;
  section.outerHTML = renderCompareRound(trend.round_value, t.state.compare.roundSel);
}

/* --------------------------------------------------------------- filters */

async function setFilters(t: Tool, change: Partial<Filters>): Promise<void> {
  const next = coerceSupportedFormat({ ...t.state.filters, ...change });
  if (JSON.stringify(next) === JSON.stringify(t.state.filters)) return;
  t.state.filters = next;
  // A new format or season starts its tables, rounds and board afresh, as a
  // route change did in the app.
  t.state.tables = {};
  t.state.roundSel = 1;
  t.state.compare.roundSel = 1;
  t.state.board = { index: 0, strategy: "" };
  redrawBar(t);
  const ok = await ensureData(t);
  // The reader may have moved on while this loaded.
  if (JSON.stringify(next) !== JSON.stringify(t.state.filters)) return;
  redrawBar(t);
  if (ok) {
    redrawView(t);
    redrawFaq(t);
  } else {
    const view = el(t, "[data-scds-view]");
    if (view) view.innerHTML = `<div class="scds-callout is-warn"><p>This view could not be loaded. Please try again.</p></div>`;
  }
}

/* ---------------------------------------------------------------- tooltip */

function showTip(t: Tool, html: string, x: number, y: number): void {
  if (!html) return hideTip(t);
  const tip = t.tip;
  tip.innerHTML = html;
  tip.hidden = false;
  const host = t.root.getBoundingClientRect();
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  let left = x - host.left + 14;
  let top = y - host.top - th / 2;
  if (left + tw > host.width - 4) left = x - host.left - tw - 14;
  left = Math.max(4, Math.min(left, host.width - tw - 4));
  top = Math.max(0, top);
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}

function hideTip(t: Tool): void {
  t.tip.hidden = true;
}

/* ------------------------------------------------------------------ rows */

function toggleRow(t: Tool, row: HTMLElement): void {
  const key = row.dataset["row"] ?? "";
  const block = row.closest<HTMLElement>("[data-table], [data-round-section]");
  const id = block?.dataset["table"] ?? "round";
  const ts = { ...tableState(t.state, id), expanded: [...tableState(t.state, id).expanded] };
  const open = !ts.expanded.includes(key);
  ts.expanded = open ? [...ts.expanded, key] : ts.expanded.filter((k) => k !== key);
  t.state.tables[id] = ts;
  row.classList.toggle("is-open", open);
  row.setAttribute("aria-expanded", String(open));
  const detail = row.nextElementSibling as HTMLElement | null;
  if (detail?.classList.contains("scds-detail")) detail.hidden = !open;
}

/* ---------------------------------------------------------------- wiring */

function wire(t: Tool): void {
  const root = t.root;

  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const btn = target.closest<HTMLElement>("button, [data-row]");
    if (!btn || !root.contains(btn)) return;
    const ds = btn.dataset;

    for (const key of ["qb", "scoring", "tep", "size"] as const) {
      if (ds[key] !== undefined) {
        if ((btn as HTMLButtonElement).disabled) return;
        void setFilters(t, { [key]: ds[key] } as Partial<Filters>);
        return;
      }
    }
    if (ds["glossaryToggle"] !== undefined) {
      t.state.glossaryOpen = !t.state.glossaryOpen;
      const panel = el(t, "[data-glossary]");
      if (panel) panel.hidden = !t.state.glossaryOpen;
      btn.setAttribute("aria-expanded", String(t.state.glossaryOpen));
      return;
    }
    if (ds["chartMetric"] !== undefined) {
      t.state.chartMetric = ds["chartMetric"] as ChartMetric;
      redrawChart(t);
      return;
    }
    if (ds["sort"] !== undefined) {
      const block = btn.closest<HTMLElement>("[data-table]");
      const id = block?.dataset["table"];
      if (!id) return;
      t.state.tables[id] = nextSort(tableState(t.state, id), ds["sort"] as StrategySortKey);
      redrawTable(t, id);
      return;
    }
    if (ds["lowToggle"] !== undefined) {
      const block = btn.closest<HTMLElement>("[data-table]");
      const id = block?.dataset["table"];
      if (!id) return;
      const ts = tableState(t.state, id);
      t.state.tables[id] = { ...ts, showLow: !ts.showLow };
      redrawTable(t, id);
      return;
    }
    if (ds["compareMetric"] !== undefined || ds["weighting"] !== undefined || ds["compareSort"] !== undefined) {
      const section = btn.closest<HTMLElement>("[data-compare-section]");
      const id = section?.dataset["compareSection"] === "first-two" ? "firstTwo" : "overall";
      const cs = t.state.compare[id];
      if (ds["compareMetric"] !== undefined) t.state.compare[id] = { ...cs, metric: ds["compareMetric"] === "pf" ? "pf" : "playoff" };
      else if (ds["weighting"] !== undefined) t.state.compare[id] = { ...cs, weighting: ds["weighting"] as Weighting };
      else t.state.compare[id] = nextCompareSort(cs, ds["compareSort"] as CompareSortKey);
      redrawView(t);
      return;
    }
    if (ds["boardPrev"] !== undefined || ds["boardNext"] !== undefined) {
      const delta = ds["boardPrev"] !== undefined ? -1 : 1;
      void ensureBoards(t).then(() => {
        const last = Math.max(0, t.data.boards.length - 1);
        t.state.board = { index: Math.max(0, Math.min(last, t.state.board.index + delta)), strategy: "" };
        redrawBoard(t);
      });
      return;
    }
    if (ds["row"] !== undefined && btn.classList.contains("scds-row") && !btn.classList.contains("is-static")) {
      toggleRow(t, btn);
    }
  });

  root.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = (event.target as HTMLElement | null)?.closest<HTMLElement>(".scds-row[data-row]");
    if (!row || row.classList.contains("is-static") || event.target !== row) return;
    event.preventDefault();
    toggleRow(t, row);
  });

  root.addEventListener("change", (event) => {
    const sel = event.target as HTMLSelectElement | null;
    if (!sel || sel.tagName !== "SELECT") return;
    const ds = sel.dataset;
    if (ds["season"] !== undefined) {
      void setFilters(t, parseFilters({ ...t.state.filters, season: sel.value }));
    } else if (ds["roundSelect"] !== undefined) {
      t.state.roundSel = Number(sel.value) || 1;
      redrawRound(t);
    } else if (ds["compareRoundSelect"] !== undefined) {
      t.state.compare.roundSel = Number(sel.value) || 1;
      redrawCompareRound(t);
    } else if (ds["boardStrategy"] !== undefined) {
      void ensureBoards(t).then(() => {
        t.state.board = { ...t.state.board, strategy: sel.value };
        redrawBoard(t);
      });
    }
  });

  // The chart's hover read-out, hung on each row's hit band.
  root.addEventListener("mousemove", (event) => {
    const hit = (event.target as HTMLElement | null)?.closest<SVGElement>(".scds-hit");
    if (!hit) {
      if (!t.tip.hidden) hideTip(t);
      return;
    }
    const view = currentChartView(t);
    if (!view) return;
    showTip(t, renderBarTip(view, Number(hit.getAttribute("data-bar"))), event.clientX, event.clientY);
  });
  root.addEventListener("mouseleave", () => hideTip(t));

  // A headshot that fails to load gives way to the initials it carries.
  root.addEventListener(
    "error",
    (e) => {
      const img = e.target as HTMLImageElement;
      if (img.tagName !== "IMG" || !img.dataset["fallback"]) return;
      img.replaceWith(document.createTextNode(img.dataset["fallback"]));
    },
    true,
  );

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      const w = widths(t).chart;
      if (Math.abs(w - t.lastWidth) < 8) return;
      t.lastWidth = w;
      redrawChart(t);
    }, 150);
  });

  // The server drew the chart at a nominal width; take the column's now.
  const w = widths(t).chart;
  if (Math.abs(w - DEFAULT_WIDTHS.chart) >= 8) {
    t.lastWidth = w;
    redrawChart(t);
  } else {
    t.lastWidth = w;
  }
}

/* ----------------------------------------------------------------- mount */

function stateFromMarkup(root: HTMLElement): State {
  const read = (name: string) => root.querySelector<HTMLElement>(`[data-${name}].is-active`)?.dataset[name];
  const season = root.querySelector<HTMLSelectElement>("[data-season]")?.value;
  return defaultState(parseFilters({ qb: read("qb"), scoring: read("scoring"), tep: read("tep"), size: read("size"), season }));
}

function mount(root: HTMLElement): void {
  if (root.dataset["empty"] === "1") return;
  const tip = root.querySelector<HTMLElement>("[data-scds-tip]") ?? document.createElement("div");
  const state = stateFromMarkup(root);
  // The server's tables start at the default sort; the markup says so too.
  for (const id of ["overall", "first-two", "first-five"]) state.tables[id] = defaultTableState();
  const t: Tool = {
    root,
    dataUrl: (root.dataset["scdsData"] ?? "/embed/redraft-strategy/data").replace(/\/+$/, ""),
    data: {
      summary: { generated_at: "", seasons: [], total_leagues: 0, total_teams: 0, baseline: { playoff_rate: null, championship_rate: null, top_3_pf_rate: null, average_points_for: null }, best_overall_strategies: [], worst_overall_strategies: [] },
      combos: {},
      trends: {},
      boards: [],
    },
    loading: new Map(),
    boardsLoaded: false,
    state,
    tip,
    lastWidth: DEFAULT_WIDTHS.chart,
  };
  wire(t);
  wireFrameHeight(root);
  // The default view's own slice, so the first interaction redraws at once.
  void ensureData(t);
}

function init(): void {
  document.querySelectorAll<HTMLElement>(ROOT_SELECTOR).forEach(mount);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
