/**
 * Markup for the rookie hit rate tool.
 *
 * Shared by the server and the browser. The server renders the whole tool at
 * its default view - all four tabs, every number in the HTML - and
 * client/rookie-hit-rates.ts re-renders a panel with these same functions when
 * a filter changes, so a view the bundle draws is the view the server would
 * have drawn.
 *
 * The layout is the standalone app's (statchasersff-bit/Rookie-Hit-Rate at
 * 9c69b00, client/src): the Overview / Draft Classes / Year-by-Year / Players
 * tabs over one filter bar, and in each tab the same sections in the same
 * order - insight cards, then the Overview's one table (the heatmap with the
 * Best Finish card beside it, or the pick-range breakdown, by a Simple /
 * Detailed toggle), the Players Who Hit by Class table with its expandable
 * draft boards, the breakout chart with the patience tables, the player
 * explorer. The dress is this app's, per the house-style rule for ported
 * tools: rookie-hit-rates.css, Inter, the brand navy and gold, no Tailwind.
 * Kept from the source because they carry meaning, not decoration: the
 * position colors (QB red, RB green, WR blue, TE gold), the heat scale's
 * five steps, the confidence dots and the chart line colors.
 */

import { escapeHtml, escapeJsonLd } from "../render";
import { headshotPath } from "../image-urls";
import { TEAM_LOGO_FILES } from "../team-logo-files";
import { renderBarChart, renderLineChart, niceTicks } from "./charts";
import {
  OUTCOME_LABELS,
  PAGE_SIZE,
  PICK_RANGES,
  POSITIONS,
  ROUNDS,
  TABS,
  abbreviateName,
  cohortsView,
  draftBoard,
  filterPlayers,
  makeBoard,
  overviewView,
  pad2,
  playerSummaries,
  sortClassRows,
  trendsView,
  type Board,
  type BoardPlayer,
  type ClassSortKey,
  type CohortSummary,
  type CohortsView,
  type Filters,
  type Insight,
  type PackedDataset,
  type PickRangeCohortSummary,
  type PlayerSummary,
  type Pos,
  type RosterRow,
  type SortField,
  type State,
  type Tab,
  type TableView,
  type RhrAssets,
} from "./model";

export interface RhrRenderOptions {
  /** Inside a statchasers.com page: no H1 (the page prints it) and a page-data island. */
  embed?: boolean;
  /** Where the bundle loads the dataset from. */
  dataUrl?: string;
}

export interface Widths {
  chart: number;
  lens: number;
}

export const DEFAULT_WIDTHS: Widths = { chart: 760, lens: 240 };

export const RHR_H1 = "Dynasty Rookie Hit Rates";

/**
 * The page's words. The source's own title was "Rookie Hit Rates | StatChasers
 * Premium"; these follow it. NOT YET APPROVED by mak (2026-10-05): see
 * replit.md "Rookie Hit Rates" before the WordPress page goes live.
 */
export function rhrPageCopy(first: number, last: number): { title: string; h1: string; description: string } {
  return {
    title: `Dynasty Rookie Hit Rates ${first}–${last} | StatChasers`,
    h1: RHR_H1,
    description:
      `How often drafted rookies become fantasy starters: Top-12, Top-24 and Top-36 hit rates by position, ` +
      `rookie draft round and pick range for the ${first}–${last} classes, with breakout timing and every player's best finish.`,
  };
}

const TAB_LABELS: Record<Tab, string> = {
  overview: "Overview",
  trends: "Draft Classes",
  cohorts: "Year-by-Year",
  players: "Players",
};

const POS_LINE: Record<Pos, string> = { QB: "#dc2626", RB: "#059669", WR: "#2563eb", TE: "#d4af37" };
const ROUND_LINE: Record<string, string> = {
  "Round 1": "#0b3a7a",
  "Round 2": "#2563eb",
  "Round 3": "#d4af37",
  "Round 4": "#9333ea",
  "Round 5": "#059669",
};

const pct0 = (v: number) => `${(v * 100).toFixed(0)}%`;
const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;

export function groupColor(group: string): string {
  return POS_LINE[group as Pos] ?? ROUND_LINE[group] ?? "#0b3a7a";
}

/** "Round 2" reads "2" in the patience tables' Round column, as the source's. */
function groupLabel(group: string): string {
  return group.replace(/^Round\s+/, "");
}

/** The heat scale's step: 0-14% · 15-29% · 30-49% · 50-69% · 70%+. */
export function heatTier(rate: number): number {
  if (rate >= 0.7) return 4;
  if (rate >= 0.5) return 3;
  if (rate >= 0.3) return 2;
  if (rate >= 0.15) return 1;
  return 0;
}

function confidence(total: number): { level: "high" | "med" | "low"; label: string } {
  if (total >= 20) return { level: "high", label: "High confidence" };
  if (total >= 10) return { level: "med", label: "Moderate confidence" };
  return { level: "low", label: "Low confidence (small sample)" };
}

/** The position, in its color: the heatmaps' row heads and the board's pills. */
function posText(pos: Pos): string {
  return `<span class="schr-pos" data-pos="${pos}">${pos}</span>`;
}

/**
 * The 160px square derivative of a player's headshot on the StatChasers
 * server (lib/image-urls.ts), versioned when the dataset's `assets` know the
 * version and `latest` otherwise. Empty for a player Sleeper has no photo
 * for, so the initials show instead. This renderer runs in the browser too,
 * so the origin and the versions travel with the data rather than being read
 * from a server module.
 */
function headshot(sleeperId: string | null, assets: RhrAssets | undefined): string {
  if (!sleeperId) return "";
  const version = assets?.headshots[sleeperId];
  if (version === null) return "";
  return `${assets?.origin ?? ""}${headshotPath(sleeperId, version, "160")}`;
}

/** The club's locally hosted SVG crest; nothing for a free agent. */
function teamLogo(code: string, assets: RhrAssets | undefined): string {
  const file = code && code !== "FA" ? TEAM_LOGO_FILES[code.toLowerCase()] : undefined;
  return file ? `${assets?.origin ?? ""}${file}` : "";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function seasonRange(f: Filters): string {
  return `${f.yearStart}–${f.yearEnd}`;
}

function avatar(name: string, sleeperId: string | null, assets: RhrAssets | undefined): string {
  const src = headshot(sleeperId, assets);
  return (
    `<span class="schr-avatar" aria-hidden="true">` +
    (src
      ? `<img src="${escapeHtml(src)}" alt="" width="24" height="24" loading="lazy" decoding="async" data-fallback="${escapeHtml(initials(name))}" />`
      : `<span>${escapeHtml(initials(name))}</span>`) +
    `</span>`
  );
}

/** A name in both lengths; the stylesheet shows one, by the table's `is-abbrev`. */
function nameSpans(name: string): string {
  return (
    `<span class="schr-name-full">${escapeHtml(name)}</span>` +
    `<span class="schr-name-short">${escapeHtml(abbreviateName(name))}</span>`
  );
}

/* ----------------------------------------------------------------- cards */

function renderCards(insights: Insight[], kind: string): string {
  if (!insights.length) return "";
  return (
    `<div class="schr-cards is-${kind}">` +
    insights
      .map(
        (i) =>
          `<article class="schr-card" data-accent="${i.accent}">` +
          `<p class="schr-card-label">${escapeHtml(i.title)}</p>` +
          `<p class="schr-card-value">${escapeHtml(i.stat)}</p>` +
          `<p class="schr-card-context">${escapeHtml(i.body)}</p>` +
          `</article>`,
      )
      .join("") +
    `</div>`
  );
}

function head(id: string, title: string, sub: string): string {
  return (
    `<div class="schr-head">` +
    `<h2 class="schr-h2" id="${id}">${escapeHtml(title)}</h2>` +
    (sub ? `<p class="schr-sub">${sub}</p>` : "") +
    `</div>`
  );
}

/* --------------------------------------------------------------- tooltips */

/** The heatmap and pick-range tooltip body. The bundle shows it on hover and focus. */
export function renderCohortTip(c: CohortSummary | undefined, title: string, withLowNote: boolean): string {
  if (!c) return `<p class="schr-tip-title">${escapeHtml(title)}</p><p>No data</p>`;
  const row = (k: string, v: string) => `<span>${k}</span><strong>${v}</strong>`;
  const conf = confidence(c.total);
  return (
    `<p class="schr-tip-title">${escapeHtml(title)}</p>` +
    (withLowNote
      ? `<p class="schr-tip-counts">${c.elite_hits} Top-12 · ${c.starter_hits} Top-24 · ${c.flex_hits} Top-36 · ${c.bust_count} bust</p>`
      : "") +
    `<div class="schr-tip-grid">` +
    row("Top-12 (1–12):", pct1(c.elite_rate)) +
    row("Top-24 (13–24):", pct1(c.starter_rate)) +
    row("Top-36 (25–36):", pct1(c.flex_rate)) +
    row("Bust (37+):", pct1(c.bust_rate)) +
    `<span>Sample:</span><strong>N=${c.total} <i class="schr-dot" data-conf="${conf.level}"></i></strong>` +
    row("Median Breakout:", `Year ${c.median_breakout !== null ? c.median_breakout.toFixed(1) : "-"}`) +
    `</div>` +
    (c.ci_width > 0 ? `<p class="schr-tip-ci">95% CI: ${pct1(c.ci_lower)}–${pct1(c.ci_upper)}</p>` : "") +
    (withLowNote && c.total < 10
      ? `<p class="schr-tip-warn">High hit rate but a small sample (N=${c.total}). Treat this as directional, not predictive.</p>`
      : "") +
    `<div class="schr-tip-years"><span>Hit by Year:</span>` +
    `<span>Y1: ${pct0(c.hit_by_year.year1)}</span><span>Y2: ${pct0(c.hit_by_year.year2)}</span>` +
    `<span>Y3+: ${pct0(c.hit_by_year.year3_plus)}</span></div>`
  );
}

/** One-line text for a cell's `title`: what a reader without the bundle hovers. */
function cellTitle(c: CohortSummary | undefined, title: string): string {
  if (!c) return `${title}: no data`;
  return (
    `${title}: ${pct1(c.hit_rate)} hit rate, N=${c.total}. ` +
    `Top-12 ${pct1(c.elite_rate)}, Top-24 ${pct1(c.starter_rate)}, Top-36 ${pct1(c.flex_rate)}, bust ${pct1(c.bust_rate)}.`
  );
}

/* ------------------------------------------------------------ best finish */

/** The card beside the heatmap: the hovered or pinned cohort's outcomes and hit-by-year bars. */
export function renderLens(c: CohortSummary | null, filters: Filters, width: number = DEFAULT_WIDTHS.lens): string {
  if (!c) {
    return (
      `<div class="schr-lens-empty"><p class="schr-lens-eyebrow">Best Finish</p>` +
      `<p>Hover or tap any cell in the grid to break down that cohort's outcomes.</p></div>`
    );
  }
  const name = OUTCOME_LABELS[filters.outcome];
  const stat = (label: string, value: number, cls = "") =>
    `<div class="schr-lens-stat${cls}"><strong>${pct1(value)}</strong><span>${label}</span></div>`;
  const bars = renderBarChart(
    [
      { name: "Year 1", value: c.hit_by_year.year1, color: "#0b3a7a" },
      { name: "Year 2", value: c.hit_by_year.year2, color: "#1a5ab8" },
      { name: "Year 3+", value: c.hit_by_year.year3_plus, color: "#d4af37" },
    ],
    Math.max(120, width - 12),
    110,
    `${name} hits by breakout year, ${c.pos} round ${c.rookie_round}`,
  );
  return (
    `<div class="schr-lens-card">` +
    `<div class="schr-lens-card-head"><p class="schr-lens-eyebrow">Best Finish</p>` +
    (c.total < 10 ? `<span class="schr-lens-low">Low sample</span>` : "") +
    `</div>` +
    `<p class="schr-sr">${c.pos} round ${c.rookie_round}, ${c.total} players, ${seasonRange(filters)}</p>` +
    `<div class="schr-lens-stats">` +
    stat("Top-12", c.elite_rate, " is-gold") +
    stat("13-24", c.starter_rate) +
    stat("25-36", c.flex_rate) +
    stat("Bust", c.bust_rate, " is-bad") +
    `</div></div>` +
    `<div class="schr-lens-card is-chart">` +
    `<p class="schr-lens-chart-title">${name} Hit by Year</p>` +
    `<div class="schr-lens-chart" data-chart="lens">${bars}</div>` +
    `</div>`
  );
}

/* --------------------------------------------------------------- heatmap */

export function lensCohort(cohorts: CohortSummary[], selected: State["selected"]): CohortSummary | null {
  if (!selected) return cohorts[0] ?? null;
  return cohorts.find((c) => c.pos === selected.pos && c.rookie_round === selected.round) ?? null;
}

/** The legend both Overview tables share, as the source's HeatLegend. */
function renderHeatLegend(): string {
  return (
    `<div class="schr-legend"><span class="schr-legend-item"><strong>Hit Rate:</strong>` +
    [0, 1, 2, 3, 4]
      .map((t, i) => `<span><i class="schr-swatch" data-tier="${t}"></i>${["0%", "15%", "30%", "50%", "70%+"][i]}</span>`)
      .join("") +
    `</span><span class="schr-legend-item"><i class="schr-legend-bar">|</i><strong>Confidence:</strong>` +
    `<span><i class="schr-dot" data-conf="high"></i>High</span>` +
    `<span><i class="schr-dot" data-conf="med"></i>Med</span>` +
    `<span><i class="schr-dot" data-conf="low"></i>Low</span>` +
    `</span></div>`
  );
}

/** The Simple / Detailed switch in each Overview table's heading row. */
function tableToggle(view: TableView): string {
  const btn = (id: TableView, label: string) =>
    `<button type="button" class="schr-opt${view === id ? " is-active" : ""}" role="tab" data-table-view="${id}"` +
    ` aria-selected="${view === id}">${label}</button>`;
  return (
    `<div class="schr-opts is-small schr-view-toggle" role="tablist" aria-label="Table view">` +
    btn("simple", "Simple") +
    btn("detailed", "Detailed") +
    `</div>`
  );
}

function renderHeatmap(cohorts: CohortSummary[], state: State, widths: Widths): string {
  const f = state.filters;
  const map = new Map(cohorts.map((c) => [`${c.pos}-${c.rookie_round}`, c]));
  const lens = lensCohort(cohorts, state.selected);
  const name = OUTCOME_LABELS[f.outcome];

  const rows = POSITIONS.map((pos) => {
    const cells = ROUNDS.map((round) => {
      const c = map.get(`${pos}-${round}`);
      const rate = c?.hit_rate ?? 0;
      const conf = c ? confidence(c.total) : null;
      const selected = !!c && !!lens && lens.pos === pos && lens.rookie_round === round;
      const low = !!c && c.total < 10;
      return (
        `<td><button type="button" class="schr-cell${low ? " is-low" : ""}${selected ? " is-selected" : ""}"` +
        ` data-tier="${heatTier(rate)}" data-pos="${pos}" data-round="${round}" aria-pressed="${selected}"` +
        ` title="${escapeHtml(cellTitle(c, `${pos} Round ${round}`))}">` +
        `<span class="schr-cell-pct">${c ? pct0(rate) : "-"}</span>` +
        `<span class="schr-cell-n">${conf ? `<i class="schr-dot" data-conf="${conf.level}" title="${conf.label}"></i>` : ""}` +
        `<span>n=${c?.total ?? 0}</span></span>` +
        `</button></td>`
      );
    }).join("");
    return `<tr><th scope="row">${posText(pos)}</th>${cells}</tr>`;
  }).join("");

  return (
    `<div class="schr-table-view" data-table-view-panel="simple"${state.tableView === "simple" ? "" : " hidden"}>` +
    `<div class="schr-head-row">` +
    head(
      "schr-heat-h",
      "Rookie Hit Rates",
      `<strong>Hit Rate</strong> = share of rookies who reached a ${name.toLowerCase()}-or-better finish at their position at one point in their career.`,
    ) +
    tableToggle("simple") +
    `</div>` +
    `<div class="schr-heat-row">` +
    `<div class="schr-scroll"><table class="schr-table schr-heat-table">` +
    `<caption class="schr-sr">${escapeHtml(`${name} hit rate by position and rookie draft round, ${seasonRange(f)} classes. Select a cell for its breakdown.`)}</caption>` +
    `<thead><tr><th scope="col">Pos</th>${ROUNDS.map((r) => `<th scope="col">Rd ${r}</th>`).join("")}</tr></thead>` +
    `<tbody>${rows}</tbody></table></div>` +
    `<aside class="schr-lens" data-schr-lens aria-live="polite">${renderLens(lens, f, widths.lens)}</aside>` +
    `</div>` +
    renderHeatLegend() +
    `</div>`
  );
}

function renderPickRange(cohorts: PickRangeCohortSummary[], state: State): string {
  const f = state.filters;
  const map = new Map(cohorts.map((c) => [`${c.pos}-${c.rookie_round}-${c.pickStart}`, c]));
  const head2 = ROUNDS.map((r, ri) =>
    PICK_RANGES.map(
      (pr, pi) =>
        `<th scope="col"${pi === 0 && ri > 0 ? ` class="is-round-start"` : ""}>` +
        `<span class="schr-pr-rd">Rd ${r}</span><span>${pad2(pr.start)}–${pad2(pr.end)}</span></th>`,
    ).join(""),
  ).join("");

  const rows = POSITIONS.map((pos) => {
    const cells = ROUNDS.map((round, ri) =>
      PICK_RANGES.map((pr, pi) => {
        const c = map.get(`${pos}-${round}-${pr.start}`);
        const rate = c?.hit_rate ?? 0;
        const conf = c ? confidence(c.total) : null;
        const label = `${pos} Picks ${round}.${pad2(pr.start)}–${round}.${pad2(pr.end)}`;
        return (
          `<td${pi === 0 && ri > 0 ? ` class="is-round-start"` : ""}>` +
          `<button type="button" class="schr-cell is-pr${c && c.total < 5 ? " is-thin" : ""}" data-tier="${heatTier(rate)}"` +
          ` data-pos="${pos}" data-round="${round}" data-pick="${pr.start}" title="${escapeHtml(cellTitle(c, label))}">` +
          `<span class="schr-cell-pct">${c ? pct0(rate) : "-"}</span>` +
          `<span class="schr-cell-n">${conf ? `<i class="schr-dot" data-conf="${conf.level}" title="${conf.label}"></i>` : ""}` +
          `<span>n=${c?.total ?? 0}</span></span>` +
          `</button></td>`
        );
      }).join(""),
    ).join("");
    return `<tr><th scope="row">${posText(pos)}</th>${cells}</tr>`;
  }).join("");

  return (
    `<div class="schr-table-view" data-table-view-panel="detailed"${state.tableView === "detailed" ? "" : " hidden"}>` +
    `<div class="schr-head-row">` +
    head("schr-pr-h", "Pick Range Breakdown", `Hit rates by 3-pick ranges within each round (${seasonRange(f)})`) +
    tableToggle("detailed") +
    `</div>` +
    `<div class="schr-scroll"><table class="schr-table schr-pr-table">` +
    `<caption class="schr-sr">${escapeHtml(`${OUTCOME_LABELS[f.outcome]} hit rate by position and 3-pick range within each rookie round, ${seasonRange(f)} classes.`)}</caption>` +
    `<thead><tr><th scope="col" class="schr-pr-pos">Pos</th>${head2}</tr></thead>` +
    `<tbody>${rows}</tbody></table></div>` +
    renderHeatLegend() +
    `</div>`
  );
}

export function renderOverviewPanel(board: Board, state: State, widths: Widths = DEFAULT_WIDTHS): string {
  const view = overviewView(board, state.filters);
  return (
    renderCards(view.insights, "overview") +
    `<section class="schr-section schr-overview-table" aria-label="Rookie hit rates by draft slot">` +
    renderHeatmap(view.cohorts, state, widths) +
    renderPickRange(view.pickRange, state) +
    `</section>`
  );
}

/* --------------------------------------------------------- draft classes */

const CLASS_COLUMNS: { key: ClassSortKey; label: string; right: boolean }[] = [
  { key: "year", label: "Draft Class", right: false },
  ...POSITIONS.map((pos) => ({ key: pos as ClassSortKey, label: pos, right: true })),
  { key: "total", label: "Total", right: true },
];

const CHEVRON_UPDOWN =
  `<svg class="schr-sort-icon" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">` +
  `<path d="M3.5 4.5 6 2l2.5 2.5M3.5 7.5 6 10l2.5-2.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CHEVRON_UP =
  `<svg class="schr-sort-icon" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">` +
  `<path d="M3 7.5 6 4.5l3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CHEVRON_DOWN =
  `<svg class="schr-sort-icon" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">` +
  `<path d="M3 4.5 6 7.5l3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CHEVRON_RIGHT =
  `<svg class="schr-class-chevron" viewBox="0 0 12 12" width="14" height="14" aria-hidden="true">` +
  `<path d="M4.5 3 7.5 6l-3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/**
 * One class's draft board: every rookie drafted that year, a column per
 * round, in pick order. Hits at full strength, misses faded. The bundle picks
 * the layout rung (board-layout.ts) once it can measure the names; until then
 * this is the roomy default.
 */
export function renderDraftBoard(players: BoardPlayer[], assets: RhrAssets | undefined): string {
  if (!players.length) return `<p class="schr-board-empty">No draft board available for this class.</p>`;
  const byRound = new Map<number, BoardPlayer[]>();
  for (const p of players) {
    const list = byRound.get(p.round);
    if (list) list.push(p);
    else byRound.set(p.round, [p]);
  }
  const rounds = Array.from(byRound.keys()).sort((a, b) => a - b);
  return (
    `<div class="schr-board" data-board data-cols="${rounds.length}" data-chrome="normal" style="grid-template-columns:repeat(${rounds.length},minmax(0,1fr))">` +
    rounds
      .map(
        (rd) =>
          `<div class="schr-board-round"><p class="schr-board-round-title">Round ${rd}</p>` +
          `<ul class="schr-board-list">` +
          byRound
            .get(rd)!
            .map(
              (p) =>
                `<li class="schr-board-pill${p.hit ? " is-hit" : " is-miss"}" data-pos="${p.pos}" data-round="${p.round}" data-name="${escapeHtml(p.name)}">` +
                avatar(p.name, p.sleeperId, assets) +
                `<span class="schr-board-text"><span class="schr-board-name">${nameSpans(p.name)}</span>` +
                `<span class="schr-board-meta"><span class="schr-num">${p.round}.${pad2(p.pick)}</span>` +
                `<b${p.hit ? ` data-pos="${p.pos}"` : ""}>${p.pos}</b></span></span>` +
                `</li>`,
            )
            .join("") +
          `</ul></div>`,
      )
      .join("") +
    `</div>`
  );
}

export function renderTrendsPanel(board: Board, state: State, _widths: Widths = DEFAULT_WIDTHS): string {
  const view = trendsView(board, state.filters);
  const name = OUTCOME_LABELS[state.filters.outcome];
  const sort = state.classSort;
  const open = new Set(state.expandedYears);

  const th = CLASS_COLUMNS.map((col) => {
    const active = sort.key === col.key;
    const ariaSort = active ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
    const icon = active ? (sort.dir === "asc" ? CHEVRON_UP : CHEVRON_DOWN) : CHEVRON_UPDOWN;
    return (
      `<th scope="col" class="${col.right ? "is-right" : ""}${active ? " is-active" : ""}" aria-sort="${ariaSort}"` +
      (col.key !== "year" && col.key !== "total" ? ` data-pos="${col.key}"` : "") +
      `><button type="button" class="schr-sort" data-class-sort="${col.key}">` +
      `<span>${col.label}</span>${icon}</button></th>`
    );
  }).join("");

  const body = sortClassRows(view.classes, sort)
    .map((r) => {
      const isOpen = open.has(r.year);
      return (
        `<tr class="schr-class-row${isOpen ? " is-open" : ""}" data-class-row="${r.year}">` +
        `<th scope="row"><button type="button" class="schr-class-toggle" id="schr-class-${r.year}" data-class-toggle="${r.year}"` +
        ` aria-expanded="${isOpen}" aria-controls="schr-board-${r.year}">${CHEVRON_RIGHT}<span>${r.year}</span></button></th>` +
        POSITIONS.map((pos) => `<td class="schr-num is-right">${r[pos]}</td>`).join("") +
        `<td class="schr-num is-right is-total">${r.total}</td>` +
        `</tr>` +
        `<tr class="schr-board-row" id="schr-board-${r.year}"${isOpen ? "" : " hidden"}><td colspan="${CLASS_COLUMNS.length}">` +
        (isOpen ? renderDraftBoard(draftBoard(board.drafts, board.ranks, state.filters, r.year), board.data.assets) : "") +
        `</td></tr>`
      );
    })
    .join("");

  return (
    renderCards(view.insights, "trends") +
    `<section class="schr-section schr-classes" aria-labelledby="schr-classes-h">` +
    head(
      "schr-classes-h",
      "Players Who Hit by Class",
      `Number of players who hit ${name.toLowerCase()} at each position per draft class, pooled across every rookie round. Click a class to see its full draft board.`,
    ) +
    (view.classes.length === 0
      ? `<p class="schr-note">No draft classes in the selected range.</p>`
      : `<div class="schr-scroll"><table class="schr-table schr-class-table">` +
        `<caption class="schr-sr">${escapeHtml(`Rookies who hit ${name} by draft class and position, ${seasonRange(state.filters)}. Each class opens to its draft board.`)}</caption>` +
        `<thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`) +
    `</section>`
  );
}

/* --------------------------------------------------------------- cohorts */

export function renderSurvivalTip(view: CohortsView, year: number): string {
  const rows = view.survival
    .map((g) => ({ g, pct: g.data.find((d) => d.year === year)?.pct ?? 0 }))
    .sort((a, b) => b.pct - a.pct);
  return (
    `<p class="schr-tip-title">Year ${year}</p>` +
    `<div class="schr-tip-rows">` +
    rows
      .map(
        ({ g, pct }) =>
          `<span><i class="schr-dot" style="background:${groupColor(g.group)}"></i>${escapeHtml(g.group)} <small>(N=${g.n})</small></span>` +
          `<strong>${pct1(pct)}</strong>`,
      )
      .join("") +
    `</div>`
  );
}

function survivalChart(view: CohortsView, state: State, width: number): string {
  const xs = [1, 2, 3, 4, 5, 6];
  const all = view.survival.flatMap((g) => g.data.map((d) => d.pct));
  const max = Math.max(0, ...all);
  const { max: yMax, ticks } = niceTicks(max);
  // The axis starts just under the lowest point (5 points below, floored at
  // 0), as the source's `domain={[yMin, "auto"]}`, so the lines fill the plot.
  const step = ticks.length > 1 ? ticks[1]! - ticks[0]! : yMax;
  const low = all.length ? Math.max(0, Math.min(...all) - 0.05) : 0;
  const yMin = step > 0 ? Math.floor(low / step + 1e-9) * step : 0;
  const yTicks = ticks.filter((t) => t >= yMin - 1e-9);
  return renderLineChart({
    width,
    height: 320,
    xs,
    yMin,
    yMax,
    yTicks,
    xLabel: "Years After Entry",
    refX: { x: 3, label: "Year 3" },
    series: view.survival.map((g) => ({
      key: g.group,
      name: g.group,
      color: groupColor(g.group),
      width: 2.5,
      ringed: true,
      dotRadius: 4,
      points: xs.map((x) => ({ x, y: g.data.find((d) => d.year === x)?.pct ?? 0 })),
    })),
    label: `Cumulative share with a first ${OUTCOME_LABELS[state.filters.outcome]} finish by years after entry`,
  });
}

function lineLegend(items: { name: string; color: string }[]): string {
  return (
    `<ul class="schr-line-legend">` +
    items
      .map(
        (i) =>
          `<li><svg viewBox="0 0 22 8" width="22" height="8" aria-hidden="true"><line x1="1" y1="4" x2="21" y2="4" stroke="${i.color}" stroke-width="2" /></svg>${escapeHtml(i.name)}</li>`,
      )
      .join("") +
    `</ul>`
  );
}

function oddsCell(r: RosterRow, v: number): string {
  if (r.ceiling <= 0) return `<td class="is-right is-muted">-</td>`;
  const cls = v >= 0.15 ? " is-strong" : v < 0.05 ? " is-faint" : "";
  return `<td class="schr-num is-right${cls}">${pct1(Math.max(0, v))}</td>`;
}

export function renderCohortsPanel(board: Board, state: State, widths: Widths = DEFAULT_WIDTHS): string {
  const view = cohortsView(board, state.filters, state.groupBy);
  const name = OUTCOME_LABELS[state.filters.outcome];
  const groupHead = state.groupBy === "round" ? "Round" : "Pos";
  const groupBtn = (id: State["groupBy"], label: string) =>
    `<button type="button" class="schr-opt${state.groupBy === id ? " is-active" : ""}" data-group-by="${id}"` +
    ` aria-pressed="${state.groupBy === id}">${label}</button>`;
  const groupCell = (group: string) =>
    `<th scope="row" class="schr-group" style="color:${groupColor(group)}">${escapeHtml(groupLabel(group))}</th>`;

  const patience = view.patience
    .map(
      (p) =>
        `<tr>${groupCell(p.group)}` +
        `<td class="schr-num is-right is-strong">${p.odds.toFixed(1)}%</td>` +
        `<td class="schr-odds-gauge"><span class="schr-meter"><i style="width:${Math.min(100, Math.max(0, p.odds)).toFixed(1)}%"></i></span></td>` +
        `</tr>`,
    )
    .join("");

  const roster = view.roster.rows
    .map((r) => `<tr>${groupCell(r.group)}${oddsCell(r, r.afterY1)}${oddsCell(r, r.afterY2)}${oddsCell(r, r.afterY3)}</tr>`)
    .join("");

  return (
    renderCards(view.insights, "cohorts") +
    `<section class="schr-section schr-cohorts" aria-labelledby="schr-cohorts-h">` +
    `<div class="schr-head-row">` +
    head("schr-cohorts-h", "Time to Breakout", `Cumulative % who have achieved first ${name} hit by years after entering the league`) +
    `<div class="schr-opts is-small" role="group" aria-label="Group by">${groupBtn("pos", "Position")}${groupBtn("round", "Round")}</div>` +
    `</div>` +
    `<div class="schr-chart-card">` +
    lineLegend(view.survival.map((g) => ({ name: g.group, color: groupColor(g.group) }))) +
    `<div class="schr-chart" data-chart="survival">${survivalChart(view, state, widths.chart)}</div>` +
    `</div>` +
    `<div class="schr-patience">` +
    head("schr-patience-h", "Patience & Roster Decision Aid", "How long should dynasty managers wait before moving on?") +
    `<div class="schr-patience-grid">` +
    `<div class="schr-patience-block"><p class="schr-block-title">Hit Rates After Year 1</p>` +
    `<p class="schr-block-sub">Odds of an eventual ${name} hit if a player doesn't hit in his rookie season</p>` +
    `<table class="schr-table schr-odds is-patience"><thead><tr><th scope="col">${groupHead}</th><th scope="col" class="is-right">Hit %</th>` +
    `<th scope="col" class="schr-odds-gauge"><span class="schr-sr">Hit odds gauge</span></th></tr></thead><tbody>${patience}</tbody></table></div>` +
    `<div class="schr-patience-block"><p class="schr-block-title">Remaining Hit Odds</p>` +
    `<p class="schr-block-sub">Odds of an eventual ${name} hit if a player has not hit by each season checkpoint</p>` +
    `<table class="schr-table schr-odds"><thead><tr><th scope="col">${groupHead}</th><th scope="col" class="is-right">After Y1</th>` +
    `<th scope="col" class="is-right">After Y2</th><th scope="col" class="is-right">After Y3</th></tr></thead><tbody>${roster}</tbody></table></div>` +
    `</div>` +
    (view.roster.takeaway
      ? `<div class="schr-takeaway"><p class="schr-takeaway-label">Key Takeaway</p><p>${escapeHtml(view.roster.takeaway)}</p></div>`
      : "") +
    `</div>` +
    `</section>`
  );
}

/* --------------------------------------------------------------- players */

const COLUMNS: { field: SortField; label: string }[] = [
  { field: "player_name", label: "Player" },
  { field: "current_nfl_team", label: "Team" },
  { field: "rookie_year", label: "Drafted" },
  { field: "rookie_round", label: "Pick" },
  { field: "best_finish", label: "Best Finish" },
  { field: "breakout_time", label: "Breakout" },
];

function team(code: string, assets: RhrAssets | undefined): string {
  const src = teamLogo(code, assets);
  return (
    `<span class="schr-team">` +
    (src
      ? `<img src="${escapeHtml(src)}" alt="" width="20" height="20" loading="lazy" decoding="async" />`
      : `<span class="schr-team-fa">${escapeHtml(code === "FA" ? "FA" : code.slice(0, 2))}</span>`) +
    `<span>${escapeHtml(code)}</span></span>`
  );
}

function breakoutLabel(time: number | null): string {
  if (!time) return "-";
  return time === 1 ? "Rookie" : `Year ${time}`;
}

export function renderPlayersPanel(board: Board, state: State, summaries?: PlayerSummary[]): string {
  const all = summaries ?? playerSummaries(board, state.filters);
  const rows = filterPlayers(all, state);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(state.page, pages - 1);
  const start = page * PAGE_SIZE;
  const shown = rows.slice(start, start + PAGE_SIZE);
  const profiles = board.data.profiles ?? {};
  const assets = board.data.assets;

  const th = COLUMNS.map((c, i) => {
    const active = state.sortField === c.field;
    const sort = active ? (state.sortDir === "asc" ? "ascending" : "descending") : "none";
    return (
      `<th scope="col"${i >= 2 ? ` class="is-center"` : ""} aria-sort="${sort}">` +
      `<button type="button" class="schr-sort${active ? " is-active" : ""}" data-sort="${c.field}">${c.label}</button></th>`
    );
  }).join("");

  const body = shown.length
    ? shown
        .map((p) => {
          const url = profiles[p.player_id];
          const name = url
            ? `<a class="schr-plink" href="${escapeHtml(url)}">${nameSpans(p.player_name)}</a>`
            : `<span class="schr-pname-text">${nameSpans(p.player_name)}</span>`;
          return (
            `<tr data-player="${escapeHtml(p.player_id)}">` +
            `<th scope="row" class="schr-pname">${avatar(p.player_name, p.sleeper_id, assets)}${name}</th>` +
            `<td>${team(p.current_nfl_team, assets)}</td>` +
            `<td class="is-center schr-num is-muted">${p.rookie_year}</td>` +
            `<td class="is-center schr-num is-muted">${p.rookie_round}.${pad2(p.rookie_pick)}</td>` +
            `<td class="is-center">` +
            (p.best_finish === "N/A"
              ? `<span class="is-muted">-</span>`
              : `<span class="schr-finish" data-pos="${p.pos}">${escapeHtml(p.best_finish.split(" (")[0]!)}</span>`) +
            `</td>` +
            `<td class="is-center schr-num">${breakoutLabel(p.breakout_time)}</td>` +
            `</tr>`
          );
        })
        .join("")
    : `<tr><td colspan="${COLUMNS.length}" class="schr-empty"><strong>No players match your filters</strong>` +
      `<span>Try widening the season range or clearing position/round filters${state.search ? " and the search box" : ""}.</span></td></tr>`;

  const pager = rows.length
    ? `<div class="schr-pager">` +
      `<span>Showing <strong>${start + 1}–${Math.min(start + PAGE_SIZE, rows.length)}</strong> of <strong>${rows.length}</strong></span>` +
      `<span class="schr-pager-nav">` +
      `<button type="button" class="schr-page-btn" data-page="${page - 1}"${page === 0 ? " disabled" : ""} aria-label="Previous page">‹ <span>Prev</span></button>` +
      `<span>Page <strong>${page + 1}</strong> / ${pages}</span>` +
      `<button type="button" class="schr-page-btn" data-page="${page + 1}"${page >= pages - 1 ? " disabled" : ""} aria-label="Next page"><span>Next</span> ›</button>` +
      `</span></div>`
    : "";

  return (
    `<section class="schr-section schr-players" aria-labelledby="schr-players-h">` +
    head("schr-players-h", "Player Explorer", "Every drafted rookie in range with their best positional finish, breakout timing, and outcome.") +
    `<p class="schr-count"><strong>${rows.length}</strong> player${rows.length === 1 ? "" : "s"}</p>` +
    `<div class="schr-scroll schr-players-scroll" data-players-scroll><table class="schr-table schr-players-table">` +
    `<caption class="schr-sr">Drafted rookies with their best positional finish and breakout year. A player's name opens his profile.</caption>` +
    `<thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>` +
    pager +
    `</section>`
  );
}

/* ------------------------------------------------------------ filter bar */

function optButton(attr: string, value: string, active: boolean, long: string, short?: string): string {
  return (
    `<button type="button" class="schr-opt${active ? " is-active" : ""}" ${attr}="${value}" aria-pressed="${active}">` +
    (short ? `<span class="schr-long">${long}</span><span class="schr-short">${short}</span>` : long) +
    `</button>`
  );
}

function control(label: string, inner: string, tabs?: Tab[], cls = ""): string {
  return (
    `<div class="schr-control${cls}"${tabs ? ` data-tabs="${tabs.join(" ")}"` : ""}>` +
    `<span class="schr-control-label">${label}</span>${inner}</div>`
  );
}

/**
 * The filter bar. Every control is printed and the tab hides the ones it does
 * not use: the Overview spans every position and round, the Draft Classes
 * table every position (its cards still read the Round filter), and only the
 * Players tab searches.
 */
function renderFilterBar(state: State, first: number, last: number): string {
  const f = state.filters;
  return (
    `<div class="schr-filters" data-schr-filters>` +
    `<div class="schr-filter-panel" id="schr-filter-panel">` +
    control(
      "Search",
      `<input type="search" class="schr-search" placeholder="Search players..." value="${escapeHtml(state.search)}"` +
        ` aria-label="Search players by name" data-schr-search />`,
      ["players"],
      " is-search",
    ) +
    control(
      "Seasons",
      `<div class="schr-range" data-schr-range>` +
        `<span class="schr-range-val" data-range-label="start">${f.yearStart}</span>` +
        `<span class="schr-range-track"><span class="schr-range-fill" data-range-fill></span>` +
        `<input type="range" min="${first}" max="${last}" step="1" value="${f.yearStart}" data-range="start" aria-label="First rookie class" />` +
        `<input type="range" min="${first}" max="${last}" step="1" value="${f.yearEnd}" data-range="end" aria-label="Last rookie class" />` +
        `</span>` +
        `<span class="schr-range-val" data-range-label="end">${f.yearEnd}</span>` +
        `</div>`,
      undefined,
      " is-range",
    ) +
    control(
      "Format",
      `<div class="schr-opts" role="group" aria-label="Format">` +
        optButton("data-format", "sf", f.format === "sf", "Superflex", "SF") +
        optButton("data-format", "1qb", f.format === "1qb", "1QB", "1QB") +
        `</div>`,
    ) +
    control(
      "Scoring",
      `<div class="schr-opts" role="group" aria-label="Scoring">` +
        optButton("data-scoring", "ppr", f.scoring === "ppr", "PPR") +
        optButton("data-scoring", "hppr", f.scoring === "hppr", ".5PPR") +
        `</div>`,
    ) +
    control(
      "Outcome",
      `<div class="schr-opts" role="group" aria-label="Outcome">` +
        (["elite", "starter", "flex"] as const).map((o) => optButton("data-outcome", o, f.outcome === o, OUTCOME_LABELS[o])).join("") +
        `</div>`,
    ) +
    control(
      "Position",
      `<div class="schr-opts" role="group" aria-label="Position">` +
        POSITIONS.map((p) =>
          `<button type="button" class="schr-opt is-pos${f.positions.includes(p) ? " is-active" : ""}" data-position="${p}"` +
          ` data-pos="${p}" aria-pressed="${f.positions.includes(p)}">${p}</button>`,
        ).join("") +
        `</div>`,
      ["cohorts", "players"],
    ) +
    control(
      "Round",
      `<div class="schr-opts" role="group" aria-label="Round">` +
        ROUNDS.map((r) =>
          `<button type="button" class="schr-opt is-round${f.rounds.includes(r) ? " is-active" : ""}" data-round-toggle="${r}"` +
          ` aria-pressed="${f.rounds.includes(r)}" aria-label="Round ${r}"><span class="schr-long">${r}</span><span class="schr-short">R${r}</span></button>`,
        ).join("") +
        `</div>`,
      ["trends", "cohorts", "players"],
    ) +
    control(
      "Min Games",
      `<span class="schr-games"><input type="number" inputmode="numeric" min="1" max="17" value="${f.minGames}"` +
        ` aria-label="Minimum games played" data-schr-min-games /><span class="schr-short">min games</span></span>`,
    ) +
    `</div></div>`
  );
}

/* --------------------------------------------------------- page assembly */

function renderMetaIsland(data: PackedDataset, options: RhrRenderOptions): string {
  if (!options.embed) return "";
  return (
    `<script type="application/json" class="schr-page-data">` +
    escapeJsonLd(JSON.stringify(rhrPageCopy(data.firstClass, data.lastClass))) +
    `</script>`
  );
}

/**
 * Apply the tab's visibility rules to the filter bar's markup: the server
 * prints every control and hides the ones this tab does not use, so the bundle
 * can switch tabs without rebuilding (and refocusing) the bar.
 */
function hideForTab(html: string, tab: Tab): string {
  return html.replace(/data-tabs="([^"]+)"/g, (m, tabs: string) => (tabs.split(" ").includes(tab) ? m : `${m} hidden`));
}

/** The whole tool at one state: what the server sends, every tab rendered. */
export function renderRhrPage(data: PackedDataset, state: State, options: RhrRenderOptions = {}): string {
  const board = makeBoard(data, state.filters.format, state.filters.scoring);
  const summaries = playerSummaries(board, state.filters);
  const panels: Record<Tab, string> = {
    overview: renderOverviewPanel(board, state),
    trends: renderTrendsPanel(board, state),
    cohorts: renderCohortsPanel(board, state),
    players: renderPlayersPanel(board, state, summaries),
  };
  const tabs = TABS.map((t) => {
    const active = t === state.tab;
    return (
      `<button type="button" class="schr-tab${active ? " is-active" : ""}" role="tab" id="schr-tab-${t}"` +
      ` aria-selected="${active}" aria-controls="schr-panel-${t}" tabindex="${active ? 0 : -1}" data-tab="${t}">${TAB_LABELS[t]}</button>`
    );
  }).join("");

  return (
    `<div class="schr${options.embed ? " is-embed" : ""}" data-schr-root="1" data-tab="${state.tab}"` +
    (options.dataUrl ? ` data-schr-data="${escapeHtml(options.dataUrl)}"` : "") +
    `>` +
    (options.embed ? "" : `<h1 class="schr-h1">${escapeHtml(RHR_H1)}</h1>`) +
    `<div class="schr-bar">` +
    `<div class="schr-tabs" role="tablist" aria-label="Analysis views">${tabs}</div>` +
    hideForTab(renderFilterBar(state, data.firstClass, data.lastClass), state.tab) +
    `</div>` +
    TABS.map(
      (t) =>
        `<div class="schr-panel" id="schr-panel-${t}" role="tabpanel" aria-labelledby="schr-tab-${t}" data-panel="${t}"` +
        `${t === state.tab ? "" : " hidden"}>${panels[t]}</div>`,
    ).join("") +
    renderMetaIsland(data, options) +
    `</div>`
  );
}

/** No dataset on disk: a sentence, not an empty grid. */
export function renderRhrEmpty(options: RhrRenderOptions = {}): string {
  return (
    `<div class="schr${options.embed ? " is-embed" : ""}" data-schr-root="1" data-empty="1">` +
    (options.embed ? "" : `<h1 class="schr-h1">${escapeHtml(RHR_H1)}</h1>`) +
    `<p class="schr-empty">Rookie hit rates are not available right now. Please check back soon.</p>` +
    `</div>`
  );
}
