/**
 * Markup for the rookie hit rate tool.
 *
 * Shared by the server and the browser. The server renders the whole tool at
 * its default view - all four tabs, every number in the HTML - and
 * client/rookie-hit-rates.ts re-renders a panel with these same functions when
 * a filter changes, so a view the bundle draws is the view the server would
 * have drawn.
 *
 * The layout is the standalone app's (statchasersff-bit/Rookie-Hit-Rate,
 * client/src): the Overview / Trends / Cohorts / Players tabs over one filter
 * bar, and in each tab the same sections in the same order - insight cards,
 * then the heatmap with the Pick Lens beside it, the pick range breakdown, the
 * trend and breakout charts, the patience module, the player explorer and its
 * drawer. The dress is this app's, per the house-style rule for ported tools:
 * rookie-hit-rates.css, Inter, the brand navy and gold, no Tailwind. Kept from
 * the source because they carry meaning, not decoration: the position colours
 * (QB red, RB green, WR blue, TE gold), the heat scale's five steps, the
 * confidence dots and the chart line colours and dashes.
 */

import { escapeHtml, escapeJsonLd } from "../render";
import { headshotPath } from "../image-urls";
import { TEAM_LOGO_FILES } from "../team-logo-files";
import { renderBarChart, renderLineChart, niceTicks, type LineSeries } from "./charts";
import {
  OUTCOME_LABELS,
  PAGE_SIZE,
  PICK_RANGES,
  POSITIONS,
  ROUNDS,
  TABS,
  cohortsView,
  filterPlayers,
  makeBoard,
  outcomeThreshold,
  overviewView,
  pad2,
  playerSummaries,
  transformTrend,
  trendsView,
  type Board,
  type CohortSummary,
  type CohortsView,
  type Filters,
  type Insight,
  type PackedDataset,
  type PickRangeCohortSummary,
  type PlayerSummary,
  type Pos,
  type SortField,
  type State,
  type Tab,
  type TrendsView,
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

export const DEFAULT_WIDTHS: Widths = { chart: 760, lens: 268 };

export const RHR_H1 = "Dynasty Rookie Hit Rates";

/**
 * The page's words. The source's own title was "Rookie Hit Rates | StatChasers
 * Premium"; these follow it. NOT YET APPROVED by mak (2026-10-05): see
 * replit.md "Rookie Hit Rates" before the WordPress page goes live.
 */
export function rhrPageCopy(first: number, last: number): { title: string; h1: string; description: string } {
  return {
    title: `${RHR_H1} by Position, Round & Pick (${first}-${last})`,
    h1: RHR_H1,
    description:
      `How often dynasty rookie picks hit: Top-12, Top-24 and Top-36 rates by position, round and pick ` +
      `for every rookie class from ${first} to ${last}, with breakout timing and every player's best finish.`,
  };
}

const TAB_LABELS: Record<Tab, string> = { overview: "Overview", trends: "Trends", cohorts: "Cohorts", players: "Players" };

const POS_LINE: Record<Pos, string> = { QB: "#dc2626", RB: "#059669", WR: "#2563eb", TE: "#d4af37" };
const ROUND_LINE: Record<string, string> = {
  "Round 1": "#0b3a7a",
  "Round 2": "#2563eb",
  "Round 3": "#d4af37",
  "Round 4": "#9333ea",
  "Round 5": "#059669",
};
const ROUND_DASH: Record<number, string> = { 1: "", 2: "6 3", 3: "2 3", 4: "8 3 2 3", 5: "10 4" };

const pct0 = (v: number) => `${(v * 100).toFixed(0)}%`;
const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;

export function groupColor(group: string): string {
  return POS_LINE[group as Pos] ?? ROUND_LINE[group] ?? "#0b3a7a";
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

function posBadge(pos: Pos, extra = ""): string {
  return `<span class="schr-pos${extra ? ` ${extra}` : ""}" data-pos="${pos}">${pos}</span>`;
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
          `<p class="schr-card-context is-${i.tone}">${escapeHtml(i.body)}</p>` +
          `</article>`,
      )
      .join("") +
    `</div>`
  );
}

function head(title: string, sub: string, level: 2 | 3 = 2): string {
  return (
    `<div class="schr-head">` +
    `<h${level} class="schr-h${level}">${escapeHtml(title)}</h${level}>` +
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

/* ------------------------------------------------------------- pick lens */

export function renderLens(c: CohortSummary | null, filters: Filters, width: number = DEFAULT_WIDTHS.lens): string {
  if (!c) {
    return (
      `<div class="schr-lens-empty"><p class="schr-lens-eyebrow">Pick Lens</p>` +
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
    Math.max(160, width - 28),
    120,
    `${name} hits by breakout year, ${c.pos} round ${c.rookie_round}`,
  );
  return (
    `<p class="schr-lens-eyebrow">Pick Lens</p>` +
    `<div class="schr-lens-title">${posBadge(c.pos, "is-sm")}<h3>${c.pos} · Round ${c.rookie_round}</h3></div>` +
    `<p class="schr-lens-meta">${seasonRange(filters)} · ${c.total} players</p>` +
    (c.total < 10 ? `<p class="schr-lens-low">Low sample · Directional only</p>` : "") +
    `<div class="schr-lens-stats">` +
    stat("Top-12", c.elite_rate, " is-gold") +
    stat("Top-24", c.starter_rate) +
    stat("Top-36", c.flex_rate) +
    stat("Bust", c.bust_rate, " is-bad") +
    `</div>` +
    `<div class="schr-lens-breakout"><span>Med. Breakout</span>` +
    `<strong>${c.median_breakout ? `Yr ${c.median_breakout.toFixed(1)}` : "N/A"}</strong></div>` +
    `<p class="schr-lens-counts"><span class="is-gold">${c.elite_hits} Top-12</span> · ${c.starter_hits} Top-24 · ` +
    `${c.flex_hits} Top-36 · <span class="is-bad">${c.bust_count} bust</span></p>` +
    `<p class="schr-lens-chart-title">${name} Hit by Year</p>` +
    `<div class="schr-lens-chart" data-chart="lens">${bars}</div>`
  );
}

/* --------------------------------------------------------------- heatmap */

export function lensCohort(cohorts: CohortSummary[], selected: State["selected"]): CohortSummary | null {
  if (!selected) return cohorts[0] ?? null;
  return cohorts.find((c) => c.pos === selected.pos && c.rookie_round === selected.round) ?? null;
}

function legendScale(): string {
  return (
    `<span class="schr-legend-item"><strong>Scale</strong>` +
    `<span class="schr-swatches">${[0, 1, 2, 3, 4].map((t) => `<i class="schr-swatch" data-tier="${t}"></i>`).join("")}</span>` +
    `<span class="schr-legend-nums">0 · 15 · 30 · 50 · 70%+</span></span>`
  );
}

function legendConfidence(withLowSample: boolean): string {
  return (
    `<span class="schr-legend-item"><strong>Confidence</strong>` +
    `<span><i class="schr-dot" data-conf="high"></i>High</span>` +
    `<span><i class="schr-dot" data-conf="med"></i>Med</span>` +
    `<span><i class="schr-dot" data-conf="low"></i>Low</span>` +
    (withLowSample ? `<span><i class="schr-swatch is-dashed"></i>Low sample</span>` : "") +
    `</span>`
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
    return `<tr><th scope="row">${posBadge(pos)}</th>${cells}</tr>`;
  }).join("");

  return (
    `<section class="schr-section schr-heat" aria-labelledby="schr-heat-h">` +
    `<div class="schr-head"><h2 class="schr-h2" id="schr-heat-h">Rookie Hit Rates</h2>` +
    `<p class="schr-sub"><strong>Hit Rate</strong> = share of rookies who reached a ${name}-or-better finish ` +
    `(top ${outcomeThreshold(f.outcome)} at their position), by rookie draft round · ${seasonRange(f)}.</p></div>` +
    `<div class="schr-heat-row">` +
    `<div class="schr-scroll"><table class="schr-table schr-heat-table">` +
    `<caption class="schr-sr">${escapeHtml(`${name} hit rate by position and rookie draft round, ${seasonRange(f)} classes. Select a cell for its breakdown.`)}</caption>` +
    `<thead><tr><td></td>${ROUNDS.map((r) => `<th scope="col">Rd ${r}</th>`).join("")}</tr></thead>` +
    `<tbody>${rows}</tbody></table></div>` +
    `<aside class="schr-lens" data-schr-lens aria-live="polite">${renderLens(lens, f, widths.lens)}</aside>` +
    `</div>` +
    `<div class="schr-legend">${legendScale()}${legendConfidence(true)}</div>` +
    `<p class="schr-note">Low-confidence cells (dashed border) use smaller samples - treat them as directional, not predictive.</p>` +
    `</section>`
  );
}

function renderPickRange(cohorts: PickRangeCohortSummary[], insights: Insight[], state: State): string {
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
          `<span>N=${c?.total ?? 0}</span></span>` +
          (c
            ? `<span class="schr-cell-esfb"><b>${c.elite_hits}E</b> · ${c.starter_hits}S · ${c.flex_hits}F · ${c.bust_count}B</span>`
            : "") +
          `</button></td>`
        );
      }).join(""),
    ).join("");
    return `<tr><th scope="row">${posBadge(pos, "is-pill")}</th>${cells}</tr>`;
  }).join("");

  return (
    `<section class="schr-section schr-pr" aria-labelledby="schr-pr-h">` +
    renderCards(insights, "pick-range") +
    `<div class="schr-head"><h2 class="schr-h2" id="schr-pr-h">Pick Range Breakdown</h2>` +
    `<p class="schr-sub">Hit rates by 3-pick ranges within each round (${seasonRange(f)})</p></div>` +
    `<div class="schr-scroll"><table class="schr-table schr-pr-table">` +
    `<caption class="schr-sr">${escapeHtml(`${OUTCOME_LABELS[f.outcome]} hit rate by position and 3-pick range within each rookie round, ${seasonRange(f)} classes.`)}</caption>` +
    `<thead><tr><th scope="col" class="schr-pr-pos">Pos</th>${head2}</tr></thead>` +
    `<tbody>${rows}</tbody></table></div>` +
    `<div class="schr-legend"><span class="schr-legend-item"><strong>Hit Rate</strong>` +
    [0, 1, 2, 3, 4]
      .map((t, i) => `<span><i class="schr-swatch" data-tier="${t}"></i>${["0%", "15%", "30%", "50%", "70%+"][i]}</span>`)
      .join("") +
    `</span>${legendConfidence(false)}</div>` +
    `</section>`
  );
}

export function renderOverviewPanel(board: Board, state: State, widths: Widths = DEFAULT_WIDTHS): string {
  const view = overviewView(board, state.filters);
  return (
    renderCards(view.insights, "overview") +
    renderHeatmap(view.cohorts, state, widths) +
    renderPickRange(view.pickRange, view.pickRangeInsights, state)
  );
}

/* ---------------------------------------------------------------- trends */

/** The merged rows the chart and its tooltip read: one per class year, one value per series. */
export function trendRows(view: TrendsView, state: State): Map<number, Map<string, { rate: number; n: number; hits: number }>> {
  const rows = new Map<number, Map<string, { rate: number; n: number; hits: number }>>();
  for (const s of view.series) {
    for (const t of transformTrend(s.raw, state.viewMode, state.movingAvg)) {
      let row = rows.get(t.year);
      if (!row) rows.set(t.year, (row = new Map()));
      row.set(s.key, { rate: t.hitRate, n: t.n, hits: t.hits });
    }
  }
  return rows;
}

export function renderTrendTip(view: TrendsView, state: State, year: number): string {
  const row = trendRows(view, state).get(year);
  if (!row) return "";
  return (
    `<p class="schr-tip-title">${year}</p>` +
    `<div class="schr-tip-rows">` +
    view.series
      .filter((s) => row.has(s.key))
      .map((s) => {
        const v = row.get(s.key)!;
        return (
          `<span><i class="schr-dot" style="background:${POS_LINE[s.pos]}"></i>${escapeHtml(s.name)}</span>` +
          `<strong>${pct1(v.rate)} <small>(${v.hits}/${v.n})</small></strong>`
        );
      })
      .join("") +
    `</div>`
  );
}

function trendChart(view: TrendsView, state: State, width: number): string {
  const rows = trendRows(view, state);
  const xs = Array.from(rows.keys()).sort((a, b) => a - b);
  const series: LineSeries[] = view.series.map((s) => ({
    key: s.key,
    name: s.name,
    color: POS_LINE[s.pos],
    dash: ROUND_DASH[s.round],
    points: xs.filter((x) => rows.get(x)!.has(s.key)).map((x) => ({ x, y: rows.get(x)!.get(s.key)!.rate })),
  }));
  return renderLineChart({
    width,
    height: 288,
    xs,
    yMax: 1,
    yTicks: [0, 0.25, 0.5, 0.75, 1],
    series,
    refY: view.stability.avg,
    label: `${OUTCOME_LABELS[state.filters.outcome]} hit rate by draft class year`,
  });
}

function lineLegend(items: { name: string; color: string; dash?: string }[]): string {
  return (
    `<ul class="schr-line-legend">` +
    items
      .map(
        (i) =>
          `<li><svg viewBox="0 0 22 8" width="22" height="8" aria-hidden="true"><line x1="1" y1="4" x2="21" y2="4" stroke="${i.color}" stroke-width="2"` +
          (i.dash ? ` stroke-dasharray="${i.dash}"` : "") +
          ` /></svg>${escapeHtml(i.name)}</li>`,
      )
      .join("") +
    `</ul>`
  );
}

export function renderTrendsPanel(board: Board, state: State, widths: Widths = DEFAULT_WIDTHS): string {
  const view = trendsView(board, state.filters);
  const name = OUTCOME_LABELS[state.filters.outcome];
  const modes: [State["viewMode"], string][] = [
    ["yearly", "By Year"],
    ["rolling3", "Rolling 3-Yr"],
    ["cumulative", "Cumulative"],
  ];
  return (
    renderCards(view.insights, "trends") +
    `<section class="schr-section schr-trends" aria-labelledby="schr-trends-h">` +
    `<div class="schr-head"><h2 class="schr-h2" id="schr-trends-h">Hit Rate Trends</h2>` +
    `<p class="schr-sub">${name} hit rate by draft class year - one line per selected position &amp; round</p></div>` +
    `<div class="schr-chart-controls">` +
    `<div class="schr-control"><span class="schr-control-label">View Mode</span>` +
    `<div class="schr-opts is-small" role="group" aria-label="View mode">` +
    modes
      .map(
        ([id, label]) =>
          `<button type="button" class="schr-opt${state.viewMode === id ? " is-active" : ""}" data-view-mode="${id}"` +
          ` aria-pressed="${state.viewMode === id}">${label}</button>`,
      )
      .join("") +
    `</div></div>` +
    `<div class="schr-control is-inline"><span class="schr-control-label" id="schr-ma-l">3-Yr Avg</span>` +
    `<button type="button" class="schr-switch" role="switch" aria-checked="${state.movingAvg}" aria-labelledby="schr-ma-l" data-moving-avg>` +
    `<span class="schr-switch-knob"></span></button></div>` +
    `</div>` +
    `<div class="schr-stability" data-level="${view.stability.label.toLowerCase()}">` +
    `<span class="schr-control-label">Stability</span>` +
    `<span class="schr-meter"><i style="width:${view.stability.score}%"></i></span>` +
    `<strong>${view.stability.score}/100</strong><span class="schr-stability-label">(${view.stability.label})</span>` +
    `</div>` +
    `<div class="schr-chart-card">` +
    `<div class="schr-chart" data-chart="trends">${trendChart(view, state, widths.chart)}</div>` +
    lineLegend(view.series.map((s) => ({ name: s.name, color: POS_LINE[s.pos], dash: ROUND_DASH[s.round] }))) +
    `</div>` +
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
  const max = Math.max(0, ...view.survival.flatMap((g) => g.data.map((d) => d.pct)));
  const { max: yMax, ticks } = niceTicks(max);
  return renderLineChart({
    width,
    height: 320,
    xs,
    yMax,
    yTicks: ticks,
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

export function renderCohortsPanel(board: Board, state: State, widths: Widths = DEFAULT_WIDTHS): string {
  const view = cohortsView(board, state.filters, state.groupBy);
  const name = OUTCOME_LABELS[state.filters.outcome];
  const groupBtn = (id: State["groupBy"], label: string) =>
    `<button type="button" class="schr-opt${state.groupBy === id ? " is-active" : ""}" data-group-by="${id}"` +
    ` aria-pressed="${state.groupBy === id}">${label}</button>`;

  const patience = view.patience
    .map(
      (p) =>
        `<li><i class="schr-dot" style="background:${groupColor(p.group)}"></i>` +
        `<span class="schr-pi-group">${escapeHtml(p.group)}</span>` +
        `<strong>${p.pi}%</strong><span class="schr-meter is-thin"><i style="width:${Math.max(0, Math.min(100, p.pi))}%"></i></span></li>`,
    )
    .join("");

  const cell = (r: (typeof view.roster.rows)[number], v: number) => {
    if (r.ceiling <= 0) return `<td class="is-muted">-</td>`;
    const cls = v >= 0.15 ? " is-strong" : v < 0.05 ? " is-faint" : "";
    return `<td class="schr-num${cls}">${pct1(Math.max(0, v))}</td>`;
  };
  const roster = view.roster.rows
    .map((r) => {
      const color = groupColor(r.group);
      return (
        `<tr><th scope="row"><span class="schr-group-chip" style="color:${color};background:${color}1f">${escapeHtml(r.group)}</span></th>` +
        cell(r, r.ceiling - r.y1) +
        cell(r, r.ceiling - r.y2) +
        cell(r, r.ceiling - r.y3) +
        `</tr>`
      );
    })
    .join("");

  return (
    renderCards(view.insights, "cohorts") +
    `<section class="schr-section schr-cohorts" aria-labelledby="schr-cohorts-h">` +
    `<div class="schr-head-row"><div class="schr-head"><h2 class="schr-h2" id="schr-cohorts-h">Time to Breakout</h2>` +
    `<p class="schr-sub">Cumulative % who have achieved first ${name} hit by years after entering the league</p></div>` +
    `<div class="schr-opts is-small" role="group" aria-label="Group by">${groupBtn("pos", "Position")}${groupBtn("round", "Round")}</div>` +
    `</div>` +
    `<div class="schr-chart-card">` +
    lineLegend(view.survival.map((g) => ({ name: `${g.group} (N=${g.n})`, color: groupColor(g.group) }))) +
    `<div class="schr-chart" data-chart="survival">${survivalChart(view, state, widths.chart)}</div>` +
    `</div>` +
    `<div class="schr-patience">` +
    head("Patience & Roster Decision Aid", "How long should dynasty managers wait before moving on?", 3) +
    `<div class="schr-patience-grid">` +
    `<div class="schr-patience-block"><p class="schr-block-title">Patience Index</p>` +
    `<p class="schr-block-sub">Share of eventual hits that came after Year 1 · higher = more patience required before declaring a miss</p>` +
    `<ul class="schr-pi">${patience}</ul></div>` +
    `<div class="schr-patience-block"><p class="schr-block-title">Remaining Hit Odds</p>` +
    `<p class="schr-block-sub">Odds of an eventual ${name} hit if a player has not hit by each season checkpoint</p>` +
    `<table class="schr-table schr-odds"><thead><tr><th scope="col">Pos</th><th scope="col">After Y1</th>` +
    `<th scope="col">After Y2</th><th scope="col">After Y3</th></tr></thead><tbody>${roster}</tbody></table></div>` +
    `</div>` +
    (view.roster.takeaway
      ? `<p class="schr-takeaway"><strong>Key Takeaway:</strong> ${escapeHtml(view.roster.takeaway)}</p>`
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
  { field: "best_finish_year", label: "Finish Yr" },
  { field: "breakout_time", label: "Breakout" },
];

function avatar(p: Pick<PlayerSummary, "player_name" | "sleeper_id">, assets: RhrAssets | undefined): string {
  const src = headshot(p.sleeper_id, assets);
  return (
    `<span class="schr-avatar" aria-hidden="true">` +
    (src
      ? `<img src="${escapeHtml(src)}" alt="" width="24" height="24" loading="lazy" decoding="async" data-fallback="${escapeHtml(initials(p.player_name))}" />`
      : `<span>${escapeHtml(initials(p.player_name))}</span>`) +
    `</span>`
  );
}

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

export function renderPlayersPanel(board: Board, state: State, summaries?: PlayerSummary[]): string {
  const all = summaries ?? playerSummaries(board, state.filters);
  const rows = filterPlayers(all, state);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(state.page, pages - 1);
  const start = page * PAGE_SIZE;
  const shown = rows.slice(start, start + PAGE_SIZE);

  const th = COLUMNS.map((c, i) => {
    const active = state.sortField === c.field;
    const sort = active ? (state.sortDir === "asc" ? "ascending" : "descending") : "none";
    return (
      `<th scope="col"${i >= 2 ? ` class="is-center"` : ""} aria-sort="${sort}">` +
      `<button type="button" class="schr-sort${active ? " is-active" : ""}" data-sort="${c.field}">${c.label}` +
      (active ? `<span class="schr-sort-dir" aria-hidden="true">${state.sortDir === "asc" ? "▲" : "▼"}</span>` : "") +
      `</button></th>`
    );
  }).join("");

  const body = shown.length
    ? shown
        .map(
          (p) =>
            `<tr data-player="${escapeHtml(p.player_id)}" tabindex="0" aria-label="${escapeHtml(`${p.player_name} details`)}">` +
            `<th scope="row" class="schr-pname">${avatar(p, board.data.assets)}<span>${escapeHtml(p.player_name)}</span></th>` +
            `<td>${team(p.current_nfl_team, board.data.assets)}</td>` +
            `<td class="is-center schr-num is-muted">${p.rookie_year}</td>` +
            `<td class="is-center schr-num is-muted">${p.rookie_round}.${pad2(p.rookie_pick)}</td>` +
            `<td class="is-center">` +
            (p.best_finish === "N/A"
              ? `<span class="is-muted">-</span>`
              : `<span class="schr-finish" data-pos="${p.pos}">${escapeHtml(p.best_finish.split(" (")[0]!)}</span>`) +
            `</td>` +
            `<td class="is-center schr-num is-muted">${p.best_finish === "N/A" ? "-" : p.best_finish_year}</td>` +
            `<td class="is-center schr-num">${p.breakout_time ? `Year ${p.breakout_time}` : "-"}</td>` +
            `</tr>`,
        )
        .join("")
    : `<tr><td colspan="7" class="schr-empty"><strong>No players match your filters</strong>` +
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
    `<div class="schr-head"><h2 class="schr-h2" id="schr-players-h">Player Explorer</h2>` +
    `<p class="schr-sub">Every drafted rookie in range with their best positional finish, breakout timing, and outcome.</p></div>` +
    `<p class="schr-count"><strong>${rows.length}</strong> player${rows.length === 1 ? "" : "s"}</p>` +
    `<div class="schr-scroll schr-players-scroll"><table class="schr-table schr-players-table">` +
    `<caption class="schr-sr">Drafted rookies with their best positional finish and breakout year. Select a row for the season history.</caption>` +
    `<thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>` +
    pager +
    `</section>`
  );
}

const HIT_LABELS: Record<PlayerSummary["hit_type"], string> = {
  elite: "Top-12",
  starter: "Top-24",
  flex: "Top-36",
  bust: "Bust",
  too_early: "Too Early",
};

/** The player drawer: the source's slide-in panel, opened over the page by the bundle. */
export function renderDrawer(p: PlayerSummary, profileUrl: string | null): string {
  const firstHit = p.breakout_time ? p.rookie_year + p.breakout_time - 1 : null;
  const vitals = [
    p.current_age ? `Age ${p.current_age}` : "",
    p.height ? escapeHtml(p.height) : "",
    p.weight ? `${p.weight} lbs` : "",
  ].filter(Boolean);
  const seasons = p.seasons.length
    ? p.seasons
        .map((s) => {
          const isFirst = firstHit === s.season;
          return (
            `<li${isFirst ? ` class="is-first-hit"` : ""}><span class="schr-season-year">${s.season}` +
            (isFirst ? `<span class="schr-first-hit">First Hit</span>` : "") +
            `</span><span class="schr-season-stat"><span>${s.games} GP</span><strong>${s.pos}${s.pos_rank}</strong></span></li>`
          );
        })
        .join("")
    : `<li class="is-empty">No qualifying seasons</li>`;
  return (
    `<div class="schr-drawer" role="dialog" aria-modal="true" aria-labelledby="schr-drawer-name">` +
    `<div class="schr-drawer-scrim" data-close></div>` +
    `<div class="schr-drawer-panel">` +
    `<header class="schr-drawer-head">` +
    `<div><h2 class="schr-drawer-name" id="schr-drawer-name">${escapeHtml(p.player_name)}</h2>` +
    `<p class="schr-drawer-meta"><span>${p.pos}</span><span>${escapeHtml(p.current_nfl_team)}</span>` +
    `<span>Class of ${p.rookie_year}</span><span>Rd ${p.rookie_round}, Pick ${p.rookie_pick}</span></p>` +
    (vitals.length ? `<p class="schr-drawer-vitals">${vitals.map((v) => `<span>${v}</span>`).join("")}</p>` : "") +
    (profileUrl
      ? `<a class="schr-drawer-link" href="${escapeHtml(profileUrl)}">View full profile →</a>`
      : "") +
    `</div>` +
    `<button type="button" class="schr-drawer-close" data-close aria-label="Close">×</button>` +
    `</header>` +
    `<div class="schr-drawer-body">` +
    `<div class="schr-drawer-stats">` +
    `<div><span>Status</span><strong class="schr-hit-badge" data-hit="${p.hit_type}">${HIT_LABELS[p.hit_type]}</strong></div>` +
    `<div><span>Best Finish</span><strong>${escapeHtml(p.best_finish)}</strong></div>` +
    `<div><span>Breakout</span><strong>${p.breakout_time ? `Year ${p.breakout_time}` : "N/A"}</strong></div>` +
    `</div>` +
    `<h3 class="schr-h3">Season History</h3>` +
    `<ul class="schr-seasons">${seasons}</ul>` +
    `</div></div></div>`
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

/** How many filters differ from the defaults: the mobile toggle's badge. */
export function activeFilterCount(f: Filters, tab: Tab, first: number, last: number): number {
  let n = 0;
  if (f.yearStart !== first || f.yearEnd !== last) n++;
  if (f.format !== "sf") n++;
  if (f.scoring !== "ppr") n++;
  if (f.outcome !== "elite") n++;
  if (tab !== "overview" && f.positions.length < POSITIONS.length) n += f.positions.length;
  if (tab !== "overview" && f.rounds.length < ROUNDS.length) n += f.rounds.length;
  if (f.minGames !== 8) n++;
  return n;
}

function renderFilterBar(state: State, first: number, last: number): string {
  const f = state.filters;
  const notOverview: Tab[] = ["trends", "cohorts", "players"];
  const count = activeFilterCount(f, state.tab, first, last);
  return (
    `<div class="schr-filters" data-schr-filters>` +
    `<button type="button" class="schr-filter-toggle" aria-expanded="true" aria-controls="schr-filter-panel" data-filter-toggle>` +
    `<span>Filters</span><span class="schr-filter-count" data-filter-count${count ? "" : " hidden"}>${count}</span>` +
    `<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M3 4.5 6 7.5l3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>` +
    `</button>` +
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
      notOverview,
    ) +
    control(
      "Round",
      `<div class="schr-opts" role="group" aria-label="Round">` +
        ROUNDS.map((r) =>
          `<button type="button" class="schr-opt is-round${f.rounds.includes(r) ? " is-active" : ""}" data-round-toggle="${r}"` +
          ` aria-pressed="${f.rounds.includes(r)}" aria-label="Round ${r}">${r}</button>`,
        ).join("") +
        `</div>`,
      notOverview,
    ) +
    control(
      "Min Games",
      `<span class="schr-games"><input type="number" inputmode="numeric" min="1" max="17" value="${f.minGames}"` +
        ` aria-label="Minimum games played" data-schr-min-games /><span>games</span></span>`,
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
