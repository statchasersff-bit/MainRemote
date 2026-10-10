/**
 * Markup for the redraft draft strategy analyzer.
 *
 * Shared by the server and the browser. The server renders the default view
 * (1QB, PPR, no TE premium, 12 teams, 2025) and client/redraft-strategy.ts
 * redraws the view with these same functions when a filter changes, so a view
 * the bundle draws is the view the server would have drawn.
 *
 * The layout is the standalone app's (statchasersff-bit/RESEARCH-Redraft-
 * Draft-Analysis at 33f0cb3, artifacts/stat-chasers/src/pages/Dashboard.tsx):
 * the filter bar with its glossary, the sample line, and then for a season
 * the Strategy Ranking chart, the Overall Strategies table, Round Value, First
 * Two Picks, First Five Rounds and the Real Draft Examples board; for the
 * 2021-2025 comparison the chart, Playoff % by Year, First Two Picks, Playoff %
 * by Round and the "Why Did Robust RB Rebound?" essay. The dress is this
 * app's, per the house-style rule for ported tools: redraft-strategy.css,
 * Inter, the brand navy and gold, no Tailwind. Kept from the source because
 * they carry meaning: the chart's five tier colors, the draft board's
 * position colors, and the lift and volatility colors.
 */

import { escapeHtml, escapeJsonLd } from "../render";
import { headshotPath } from "../image-urls";
import { renderRankingChart } from "./charts";
import { rdsFaqFacts, renderRdsFaq } from "./faq";
import {
  CHART_METRICS,
  COMPARE_ROUND_MIN_SAMPLE,
  GLOSSARY_SECTIONS,
  POSSIBLE_EXPLANATIONS,
  ROUND_MIN_SAMPLE,
  SEASON_OPTIONS,
  SEASON_YEARS,
  abbreviateFirstName,
  boardView,
  chartView,
  compareChartRows,
  compareRoundView,
  compareTableView,
  comboKey,
  fmtCiPp,
  fmtCiRange,
  fmtInt,
  fmtLift,
  fmtPct,
  initialsOf,
  mergeStrategies,
  periodPair,
  roundExplanation,
  roundView,
  strategyExplanation,
  strategyTableView,
  tableState,
  trendKey,
  trustTier,
  volatilityBadge,
  wilson95,
  wouldSelectUnsupportedFormat,
  type AggregateResult,
  type Board,
  type BoardPick,
  type BoardState,
  type ChartView,
  type Combo,
  type CompareMetric,
  type CompareSortKey,
  type CompareState,
  type Dataset,
  type Filters,
  type RdsAssets,
  type RoundData,
  type SeasonYear,
  type State,
  type StrategyRow,
  type StrategySortKey,
  type Summary,
  type TableState,
  type Trend,
  type TrendRound,
  type TrendRow,
  type Weighting,
} from "./model";

export interface RdsRenderOptions {
  /** Inside a statchasers.com page: no H1 (the page prints it) and a page-data island. */
  embed?: boolean;
  /** Where the bundle loads data slices from: `<dataUrl>/combo/<key>`, `/trends/<key>`, `/boards`. */
  dataUrl?: string;
}

export interface Widths {
  chart: number;
}

export const DEFAULT_WIDTHS: Widths = { chart: 900 };

export const RDS_H1 = "Redraft Draft Strategy Analysis";

/**
 * The page's words. These are the statchasers.com page's own as of 2026-10-10
 * (its Rank Math title and description, and the H1 of the hero its editor
 * built), carried here so the API owns them like every other tool's; applying
 * them changes nothing on the page. Any new wording needs mak's approval.
 */
export function rdsPageCopy(): { title: string; h1: string; description: string } {
  return {
    title: "Fantasy Football Redraft Strategy Analysis - StatChasers",
    h1: RDS_H1,
    description:
      "What real draft data reveals about the strategies that actually make the playoffs. " +
      "Analyze thousands of redraft teams across multiple seasons and league",
  };
}

const pct1 = (v: number | null | undefined) => fmtPct(v, 1);

/* ------------------------------------------------------------ small parts */

function h2(title: string, extra = ""): string {
  return `<h2 class="scds-h2">${escapeHtml(title)}</h2>${extra}`;
}

function headRow(title: string, control: string): string {
  return `<div class="scds-head-row"><div class="scds-head">${h2(title)}</div>${control ? `<div class="scds-head-ctl">${control}</div>` : ""}</div>`;
}

/** A two-way segmented switch, navy when on, as the app's MetricToggle. */
function segmented(name: string, options: { value: string; label: string }[], current: string, extraClass = ""): string {
  return (
    `<div class="scds-seg${extraClass ? ` ${extraClass}` : ""}" role="group">` +
    options
      .map(
        (o) =>
          `<button type="button" class="scds-seg-btn${o.value === current ? " is-active" : ""}" data-${name}="${escapeHtml(o.value)}" aria-pressed="${o.value === current}">${escapeHtml(o.label)}</button>`,
      )
      .join("") +
    `</div>`
  );
}

function chevron(): string {
  return `<svg class="scds-chev" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function sortIcon(active: boolean, dir: "asc" | "desc"): string {
  if (!active) {
    return `<svg class="scds-sort-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M5 6.5L8 3.5l3 3M5 9.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  const d = dir === "asc" ? "M4 10l4-4 4 4" : "M4 6l4 4 4-4";
  return `<svg class="scds-sort-icon is-on" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function liftCell(lift: number): string {
  if (lift === 0) return `<span class="scds-muted">-</span>`;
  return `<span class="scds-lift ${lift > 0 ? "is-up" : "is-down"}">${escapeHtml(fmtLift(lift))}</span>`;
}

function roundSelect(name: string, rounds: number[], selected: number, label: (r: number) => string): string {
  return (
    `<select class="scds-select" data-${name} aria-label="Round">` +
    rounds.map((r) => `<option value="${r}"${r === selected ? " selected" : ""}>${escapeHtml(label(r))}</option>`).join("") +
    `</select>`
  );
}

/* ------------------------------------------------------------- filter bar */

interface PillOption {
  value: string;
  label: string;
  short?: string;
  disabled: boolean;
}

function pillGroup(label: string, name: string, options: PillOption[], current: string): string {
  return (
    `<div class="scds-control"><span class="scds-control-label">${escapeHtml(label)}</span>` +
    `<div class="scds-opts" role="group" aria-label="${escapeHtml(label)}">` +
    options
      .map((o) => {
        const on = o.value === current;
        const text = o.short
          ? `<span class="scds-long">${escapeHtml(o.label)}</span><span class="scds-short">${escapeHtml(o.short)}</span>`
          : escapeHtml(o.label);
        return (
          `<button type="button" class="scds-opt${on ? " is-active" : ""}" data-${name}="${escapeHtml(o.value)}"` +
          ` aria-pressed="${on && !o.disabled}"${o.disabled ? ' disabled title="Limited data: not enough leagues to show reliable results"' : ""}>${text}</button>`
        );
      })
      .join("") +
    `</div></div>`
  );
}

export function renderFilterBar(f: Filters, glossaryOpen: boolean): string {
  const dis = <K extends "qb" | "scoring" | "tep" | "size">(k: K, v: Filters[K]) => wouldSelectUnsupportedFormat(f, k, v);
  return (
    `<div class="scds-bar" data-scds-bar>` +
    pillGroup(
      "Format",
      "qb",
      [
        { value: "superflex", label: "Superflex", short: "SF", disabled: dis("qb", "superflex") },
        { value: "one_qb", label: "1QB", disabled: dis("qb", "one_qb") },
      ],
      f.qb,
    ) +
    pillGroup(
      "Scoring",
      "scoring",
      [
        { value: "ppr", label: "PPR", disabled: false },
        { value: "half_ppr", label: "Half PPR", short: "Half", disabled: dis("scoring", "half_ppr") },
      ],
      f.scoring,
    ) +
    pillGroup(
      "TE Premium",
      "tep",
      [
        { value: "no_tep", label: "No TEP", disabled: false },
        { value: "tep", label: "TEP", disabled: dis("tep", "tep") },
      ],
      f.tep,
    ) +
    pillGroup(
      "Team Size",
      "size",
      [
        { value: "10", label: "10-Team", short: "10T", disabled: dis("size", "10") },
        { value: "12", label: "12-Team", short: "12T", disabled: false },
      ],
      f.size,
    ) +
    `<div class="scds-control"><span class="scds-control-label">Season</span>` +
    `<select class="scds-select is-season" data-season aria-label="Season">` +
    SEASON_OPTIONS.map((o) => `<option value="${o.value}"${o.value === f.season ? " selected" : ""}>${escapeHtml(o.label)}</option>`).join("") +
    `</select></div>` +
    `<button type="button" class="scds-glossary-toggle" data-glossary-toggle aria-expanded="${glossaryOpen}" aria-controls="scds-glossary">` +
    `<span class="scds-glossary-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>` +
    `<span class="scds-glossary-text"><strong>Strategy Glossary</strong><span>What each draft strategy means</span></span>${chevron()}</button>` +
    `</div>`
  );
}

export function renderGlossary(open: boolean): string {
  return (
    `<div class="scds-glossary" id="scds-glossary" data-glossary${open ? "" : " hidden"}>` +
    GLOSSARY_SECTIONS.map(
      (s) =>
        `<div class="scds-glossary-section"><h3 class="scds-h3">${escapeHtml(s.title)}</h3><p class="scds-glossary-sub">${escapeHtml(s.subtitle)}</p>` +
        `<ul class="scds-glossary-list">` +
        s.entries.map((e) => `<li><strong>${escapeHtml(e.name)}</strong>: ${escapeHtml(e.def)}</li>`).join("") +
        `</ul></div>`,
    ).join("") +
    `</div>`
  );
}

/* ----------------------------------------------------------- context bar */

export function renderContextBar(f: Filters, combo: Combo | null, trend: Trend | null, summary: Summary): string {
  let body = "";
  if (f.season === "compare") {
    const parts: string[] = [];
    for (const y of SEASON_YEARS) {
      const n = trend ? (trend[`sample_${y}`] as number | undefined) : undefined;
      if (n != null) parts.push(`<span><strong>${fmtInt(n)}</strong> teams (${y})</span>`);
    }
    body = parts.join(`<span class="scds-ctx-sep">|</span>`);
  } else {
    const leagues = combo?.league_count ?? summary.total_leagues;
    const teams = combo?.sample_size ?? summary.total_teams;
    body =
      `<span><strong>${fmtInt(leagues)}</strong> leagues</span>` +
      `<span class="scds-ctx-sep">·</span>` +
      `<span><strong>${fmtInt(teams)}</strong> teams</span>`;
  }
  return `<div class="scds-ctx" data-scds-ctx><span class="scds-ctx-label">Current sample</span>${body}</div>`;
}

/* ------------------------------------------------------------------ chart */

export function renderChartSection(view: ChartView | null, metric: State["chartMetric"], width: number): string {
  if (!view) return "";
  const toggle = segmented("chart-metric", CHART_METRICS.map((m) => ({ value: m.key, label: m.label })), metric);
  return (
    `<section class="scds-section" data-chart-section>` +
    headRow("Strategy Ranking", toggle) +
    `<div class="scds-chart-card"><div class="scds-chart" data-chart>${renderRankingChart(view, width, "Strategy ranking by the chosen rate, with the league average")}</div></div>` +
    `</section>`
  );
}

/** The hover read-out for a bar, as the app's BarTooltip. */
export function renderBarTip(view: ChartView, index: number): string {
  const d = view.bars[index];
  if (!d) return "";
  const lift = d.playoff_rate - view.baseline;
  const row = (k: string, v: string, cls = "") => `<span>${k}</span><strong class="${cls}">${v}</strong>`;
  return (
    `<p class="scds-tip-title">${escapeHtml(d.name)}</p><div class="scds-tip-grid">` +
    row("Playoff Rate", pct1(d.playoff_rate)) +
    row("Championship Rate", pct1(d.championship_rate)) +
    (d.top_3_pf_rate != null ? row("Top-3 Points", pct1(d.top_3_pf_rate)) : "") +
    row("vs League Avg", `${lift >= 0 ? "+" : ""}${(lift * 100).toFixed(1)}%`, lift >= 0 ? "is-up" : "is-down") +
    row("Sample", `${fmtInt(d.sample_size)} teams`) +
    row("Confidence", escapeHtml(d.confidence_level)) +
    `</div>`
  );
}

/* --------------------------------------------------------- strategy table */

interface StrategyTableOptions {
  id: string;
  title?: string;
  minSample?: number;
  showTitleRate?: boolean;
}

interface ColDef {
  key: StrategySortKey;
  label: string;
  right?: boolean;
  tooltip?: string;
  hideOnMobile?: boolean;
}

function strategyColumns(showTitleRate: boolean): ColDef[] {
  return [
    { key: "strategy", label: "Strategy" },
    { key: "playoff_rate", label: "Playoff Rate", right: true },
    { key: "top_3_pf_rate", label: "Top 3 PF %", right: true, hideOnMobile: true },
    ...(showTitleRate
      ? [
          {
            key: "championship_rate" as StrategySortKey,
            label: "Title %",
            right: true,
            tooltip: "Share of teams using this build that won the league title (secondary, higher-variance result).",
          },
        ]
      : []),
    {
      key: "playoff_rate_lift",
      label: "vs Average",
      right: true,
      tooltip: "Percentage-point difference in playoff rate vs. the overall baseline for this format.",
    },
    { key: "sample_size", label: "Sample", right: true, hideOnMobile: true },
  ];
}

export function renderStrategyTable(rows: StrategyRow[], state: TableState, o: StrategyTableOptions): string {
  const minSample = o.minSample ?? 0;
  const showTitleRate = o.showTitleRate ?? false;
  const columns = strategyColumns(showTitleRate);
  const attrs = ` data-table="${escapeHtml(o.id)}" data-min-sample="${minSample}"${showTitleRate ? ' data-title-rate="1"' : ""}`;
  if (!rows.length) {
    return `<div class="scds-table-block"${attrs}>${o.title ? h2(o.title) : ""}<p class="scds-empty-note">No data available for this view.</p></div>`;
  }
  const view = strategyTableView(rows, state, minSample);
  const toggle =
    minSample > 0 && view.hiddenCount > 0
      ? `<button type="button" class="scds-low-toggle" data-low-toggle aria-pressed="${state.showLow}">` +
        (state.showLow
          ? `Hide low-sample data`
          : `Show ${view.hiddenCount} low-sample directional build${view.hiddenCount !== 1 ? "s" : ""}`) +
        `</button>`
      : "";
  const head = o.title || toggle ? `<div class="scds-head-row">${o.title ? `<div class="scds-head">${h2(o.title)}</div>` : "<span></span>"}${toggle ? `<div class="scds-head-ctl">${toggle}</div>` : ""}</div>` : "";
  const thead = columns
    .map((c) => {
      const active = c.key === state.sortKey;
      return (
        `<th scope="col" class="${c.right ? "is-right" : ""}${c.hideOnMobile ? " is-wide" : ""}"${active ? ` aria-sort="${state.sortDir === "asc" ? "ascending" : "descending"}"` : ""}>` +
        `<button type="button" class="scds-sort${active ? " is-active" : ""}" data-sort="${c.key}"${c.tooltip ? ` title="${escapeHtml(c.tooltip)}"` : ""}>${escapeHtml(c.label)}${sortIcon(active, state.sortDir)}</button></th>`
      );
    })
    .join("");
  const body = view.rows
    .map((r) => {
      const open = state.expanded.includes(r.strategy);
      const ci = wilson95(r.playoff_rate, r.sample_size);
      return (
        `<tr class="scds-row${open ? " is-open" : ""}" data-row="${escapeHtml(r.strategy)}" aria-expanded="${open}" tabindex="0">` +
        `<td class="scds-name"><span class="scds-name-in">${chevron()}${escapeHtml(r.strategy)}</span></td>` +
        `<td class="is-right scds-strong">${pct1(r.playoff_rate)}</td>` +
        `<td class="is-right is-wide scds-muted">${r.top_3_pf_rate != null ? pct1(r.top_3_pf_rate) : "-"}</td>` +
        (showTitleRate ? `<td class="is-right scds-muted">${r.championship_rate != null ? pct1(r.championship_rate) : "-"}</td>` : "") +
        `<td class="is-right">${liftCell(r.playoff_rate_lift ?? 0)}</td>` +
        `<td class="is-right is-wide scds-muted">${fmtInt(r.sample_size)}</td>` +
        `</tr>` +
        `<tr class="scds-detail"${open ? "" : " hidden"}><td colspan="${columns.length}"><div class="scds-detail-in">` +
        `<div class="scds-detail-stats">` +
        `<span>Playoff 95% CI <strong>${escapeHtml(fmtCiRange(ci))}</strong></span>` +
        `<span>Top 3 PF <strong>${r.top_3_pf_rate != null ? pct1(r.top_3_pf_rate) : "-"}</strong></span>` +
        `<span>Champ <small>(secondary)</small> <strong>${pct1(r.championship_rate)}</strong></span>` +
        `<span>Sample <strong>${fmtInt(r.sample_size)}</strong></span>` +
        `<span>Confidence <strong>${escapeHtml(r.confidence_level ?? trustTier(r.sample_size).label)}</strong></span>` +
        `</div><p class="scds-detail-text">${escapeHtml(strategyExplanation(r))}</p></div></td></tr>`
      );
    })
    .join("");
  return (
    `<div class="scds-table-block"${attrs}>${head}` +
    `<div class="scds-scroll"><table class="scds-table"><thead><tr>${thead}</tr></thead><tbody>${body}</tbody></table></div>` +
    `</div>`
  );
}

/* ------------------------------------------------------------ round value */

export function renderRoundValue(rounds: RoundData[] | null, selected: number, expanded: string[], hasCombo: boolean): string {
  const title = h2("Round Value");
  if (!hasCombo) {
    return (
      `<section class="scds-section" data-round-section>${title}` +
      `<div class="scds-callout"><p class="scds-callout-title">Format context required</p>` +
      `<p>Round value changes significantly by format. Round 1 QB in Superflex is a completely different decision than in 1QB leagues. ` +
      `Select your QB format, scoring, and TEP settings above to see format-specific round value.</p>` +
      `<p class="scds-muted">Use the filter bar above to lock in your league settings.</p></div></section>`
    );
  }
  if (!rounds || !rounds.length) {
    return `<section class="scds-section" data-round-section>${title}<p class="scds-empty-note">No round value data available yet.</p></section>`;
  }
  const v = roundView(rounds, selected);
  const select = roundSelect("round-select", v.rounds, v.round, (r) => `Rd ${r}`);
  let body: string;
  if (!v.qualifying.length) {
    body = `<p class="scds-empty-note">No data for Round ${v.round} with sufficient sample.</p>`;
  } else {
    body =
      `<div class="scds-scroll"><table class="scds-table"><thead><tr>` +
      `<th scope="col">Position</th><th scope="col" class="is-right is-wide">Sample</th><th scope="col" class="is-right">Playoff Rate</th>` +
      `<th scope="col" class="is-right">Champ Rate</th><th scope="col" class="is-right is-wide">Top-3 PF Rate</th></tr></thead><tbody>` +
      v.qualifying
        .map((p) => {
          const key = `${v.round}-${p.strategy}`;
          const open = expanded.includes(key);
          return (
            `<tr class="scds-row${open ? " is-open" : ""}" data-row="${escapeHtml(key)}" aria-expanded="${open}" tabindex="0">` +
            `<td class="scds-name"><span class="scds-name-in">${chevron()}${escapeHtml(p.strategy)}</span></td>` +
            `<td class="is-right is-wide scds-muted">${fmtInt(p.sample_size)}</td>` +
            `<td class="is-right scds-strong">${pct1(p.playoff_rate)}</td>` +
            `<td class="is-right">${pct1(p.championship_rate)}</td>` +
            `<td class="is-right is-wide">${p.top_3_pf_rate != null ? pct1(p.top_3_pf_rate) : "-"}</td></tr>` +
            `<tr class="scds-detail"${open ? "" : " hidden"}><td colspan="5"><div class="scds-detail-in"><div class="scds-detail-stats">` +
            `<span>Playoff Rate <strong>${pct1(p.playoff_rate)}</strong></span>` +
            `<span>Champ <strong>${pct1(p.championship_rate)}</strong></span>` +
            `<span>Top-3 PF <strong>${p.top_3_pf_rate != null ? pct1(p.top_3_pf_rate) : "-"}</strong></span>` +
            `<span>Sample <strong>${fmtInt(p.sample_size)}</strong></span>` +
            `</div><p class="scds-detail-text">${escapeHtml(roundExplanation(p, v.round))}</p></div></td></tr>`
          );
        })
        .join("") +
      `</tbody></table></div>` +
      (v.omitted.length
        ? `<p class="scds-note"><strong>${escapeHtml(v.omitted.join(", "))}</strong> hidden: sample too small (n &lt; ${ROUND_MIN_SAMPLE}) to draw reliable conclusions.</p>`
        : "");
  }
  return `<section class="scds-section" data-round-section><div class="scds-head-row"><div class="scds-head">${title}</div><div class="scds-head-ctl">${select}</div></div>${body}</section>`;
}

/* ------------------------------------------------------------ draft board */

const POSITION_CLASS: Record<string, string> = { QB: "qb", RB: "rb", WR: "wr", TE: "te", K: "k" };

function posClass(position: string): string {
  return POSITION_CLASS[position] ?? "other";
}

/** A Sleeper player id is numeric; a team defense's is its club code. */
export function isPlayerId(id: string): boolean {
  return /^\d+$/.test(id);
}

/**
 * The 160px square derivative of a pick's headshot on the StatChasers server
 * (lib/image-urls.ts), versioned when the assets know the version and
 * `latest` otherwise. Empty for a player with no photo, or no id, so the
 * initials show instead.
 */
function headshot(pick: BoardPick, assets: RdsAssets | undefined): string {
  // A team defense's id is its club code; it has no headshot, and its
  // initials ("DL") say which it is.
  if (!pick.player_id || !isPlayerId(pick.player_id)) return "";
  const version = assets?.headshots[pick.player_id];
  if (version === null) return "";
  return `${assets?.origin ?? ""}${headshotPath(pick.player_id, version, "160")}`;
}

function avatar(pick: BoardPick, assets: RdsAssets | undefined): string {
  const src = headshot(pick, assets);
  const initials = escapeHtml(initialsOf(pick.name));
  return (
    `<span class="scds-cell-avatar" aria-hidden="true">` +
    (src
      ? `<img src="${escapeHtml(src)}" alt="" width="30" height="30" loading="lazy" decoding="async" data-fallback="${initials}" />`
      : initials) +
    `</span>`
  );
}

export function renderDraftBoard(boards: Board[], state: BoardState, assets?: RdsAssets): string {
  const board = boards[Math.min(Math.max(0, state.index), boards.length - 1)];
  if (!board) return `<section class="scds-section" data-board-section>${h2("Real Draft Examples")}<p class="scds-empty-note">No draft examples are available.</p></section>`;
  const v = boardView(board, state);
  const select =
    `<select class="scds-select" data-board-strategy aria-label="Strategy examples">` +
    v.groups
      .map((g) => {
        const slots = g.slots.length === 1 ? `Slot ${g.slots[0]}` : `Slots ${g.slots.join(", ")}`;
        return `<option value="${escapeHtml(g.strategy)}"${g.strategy === v.chosen ? " selected" : ""}>${escapeHtml(g.strategy)} · ${slots}</option>`;
      })
      .join("") +
    `</select>`;
  const nav =
    `<div class="scds-board-nav"><span class="scds-board-count">Draft Board ${board.index + 1} of ${boards.length}</span>` +
    `<button type="button" class="scds-board-btn" data-board-prev aria-label="Previous draft example"${board.index === 0 ? " disabled" : ""}><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` +
    `<button type="button" class="scds-board-btn" data-board-next aria-label="Next draft example"${board.index >= boards.length - 1 ? " disabled" : ""}><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>`;
  const star = `<svg class="scds-star" viewBox="0 0 24 24" width="10" height="10" aria-hidden="true"><path d="M12 2l2.9 6.6 7.1.7-5.3 4.8 1.6 7L12 17.5 5.7 21l1.6-7L2 9.3l7.1-.7z" fill="currentColor"/></svg>`;
  const header =
    `<div class="scds-board-row is-head"><div class="scds-board-corner">R</div>` +
    v.slots
      .map((s) => `<div class="scds-board-slot${v.activeSlots.includes(s) ? " is-me" : ""}">${v.activeSlots.includes(s) ? star : ""}Slot ${s}</div>`)
      .join("") +
    `</div>`;
  const rows = v.cells
    .map((cells, i) => {
      const round = v.rounds[i]!;
      return (
        `<div class="scds-board-row${round % 2 === 0 ? " is-even" : ""}${round === 5 ? " is-cut" : ""}">` +
        `<div class="scds-board-round${round <= 5 ? " is-strategy" : ""}">R${round}</div>` +
        cells
          .map((c) => {
            if (!c.pick) {
              return `<div class="scds-cell is-empty${c.featured ? " is-featured" : ""}"><span class="scds-cell-pick">${c.label}</span></div>`;
            }
            const p = c.pick;
            return (
              `<div class="scds-cell is-${posClass(p.position)}${c.featured ? " is-featured" : ""}" title="${escapeHtml(`${c.label} · ${p.name} · ${c.rank}`)}">` +
              `<span class="scds-cell-rank">${escapeHtml(c.rank)}</span>` +
              `<span class="scds-cell-pick">${c.label}</span>` +
              `<span class="scds-cell-name" title="${escapeHtml(p.name)}"><span class="scds-cell-name-full">${escapeHtml(abbreviateFirstName(p.name))}</span><span class="scds-cell-name-short">${escapeHtml(abbreviateFirstName(p.name, true))}</span></span>` +
              `<span class="scds-cell-meta">${escapeHtml(p.position)}${p.nfl_team ? ` · ${escapeHtml(p.nfl_team)}` : ""}</span>` +
              avatar(p, assets) +
              `</div>`
            );
          })
          .join("") +
        `</div>`
      );
    })
    .join("");
  return (
    `<section class="scds-section" data-board-section>${h2("Real Draft Examples")}` +
    `<div class="scds-board-module"><div class="scds-board-pick"><p class="scds-eyebrow">Strategy examples</p>${select}</div>${nav}</div>` +
    `<div class="scds-board-surface"><div class="scds-board-scroll"><div class="scds-board-grid" style="--scds-teams:${v.slots.length}" data-board-label="${escapeHtml(board.label)}">${header}${rows}</div></div></div>` +
    `</section>`
  );
}

/* ------------------------------------------------------------ season view */

export function renderSeasonView(data: Dataset, state: State, widths: Widths = DEFAULT_WIDTHS): string {
  const f = state.filters;
  const combo = data.combos[comboKey(f)] ?? null;
  const parts: string[] = [];
  if (combo) {
    const merged = mergeStrategies(combo.best_strategies, combo.worst_strategies);
    parts.push(renderChartSection(chartView([...combo.best_strategies, ...combo.worst_strategies], combo.baseline.playoff_rate, state.chartMetric), state.chartMetric, widths.chart));
    parts.push(
      `<section class="scds-section">${renderStrategyTable(merged, tableState(state, "overall"), { id: "overall", title: "Overall Strategies", showTitleRate: true })}</section>`,
    );
    parts.push(renderRoundValue(combo.round_value.rounds, state.roundSel, tableState(state, "round").expanded, true));
    if (combo.best_first_two_pick_combos.length) {
      parts.push(
        `<section class="scds-section">${renderStrategyTable(combo.best_first_two_pick_combos, tableState(state, "first-two"), { id: "first-two", title: "First Two Picks" })}</section>`,
      );
    }
    if (combo.best_first_five_builds.length) {
      parts.push(
        `<section class="scds-section">${renderStrategyTable(combo.best_first_five_builds, tableState(state, "first-five"), { id: "first-five", title: "First Five Rounds", minSample: 250 })}</section>`,
      );
    }
  } else {
    const merged = mergeStrategies(data.summary.best_overall_strategies, data.summary.worst_overall_strategies);
    parts.push(
      `<section class="scds-section">${renderStrategyTable(merged, tableState(state, "overall"), { id: "overall", title: "Overall Strategies", showTitleRate: true })}</section>`,
    );
    parts.push(renderRoundValue(null, state.roundSel, [], false));
  }
  parts.push(renderDraftBoard(data.boards, state.board, data.assets));
  return parts.join("");
}

/* ---------------------------------------------------------- compare view */

const COMPARE_METRICS: { value: CompareMetric; label: string }[] = [
  { value: "playoff", label: "Playoff %" },
  { value: "pf", label: "Top 3 PF %" },
];

const WEIGHTINGS: { value: Weighting; label: string }[] = [
  { value: "pooled", label: "Pooled" },
  { value: "balanced", label: "Season-balanced" },
];

function volatilityCell(pp: number): string {
  const b = volatilityBadge(pp);
  return `<span class="scds-vol is-${b.label.toLowerCase()}">${b.label} <span class="scds-vol-pp">±${pp.toFixed(1)}pp</span></span>`;
}

export function renderCompareTable(id: string, rows: TrendRow[], state: CompareState, nameLabel: string, minSample: number): string {
  if (!rows.length) return `<p class="scds-empty-note">No comparison data available.</p>`;
  const v = compareTableView(rows, state, minSample);
  const metricLabel = state.metric === "playoff" ? "Playoff %" : "Top 3 PF %";
  const avgLabel = `${state.weighting === "pooled" ? "Pooled" : "Balanced"} ${metricLabel} (95% CI)`;
  const columns: { key: CompareSortKey; label: string; right?: boolean; hideOnMobile?: boolean }[] = [
    { key: "name", label: nameLabel },
    ...v.shown.map((y) => ({ key: `rate_${y}` as CompareSortKey, label: y, right: true })),
    { key: "avg_rate", label: avgLabel, right: true },
    { key: "sample", label: "Sample", right: true, hideOnMobile: true },
    { key: "volatility", label: "Volatility", right: true },
  ];
  const note =
    state.weighting === "pooled"
      ? "Pooled: every team counts equally (larger seasons weigh more)."
      : "Season-balanced: every season counts equally (thin seasons weigh the same as large ones).";
  const thead = columns
    .map((c) => {
      const active = c.key === state.sortKey;
      return (
        `<th scope="col" class="${c.right ? "is-right" : ""}${c.hideOnMobile ? " is-wide" : ""}"${active ? ` aria-sort="${state.sortDir === "asc" ? "ascending" : "descending"}"` : ""}>` +
        `<button type="button" class="scds-sort${active ? " is-active" : ""}" data-compare-sort="${c.key}">${escapeHtml(c.label)}${sortIcon(active, state.sortDir)}</button></th>`
      );
    })
    .join("");
  const cls = (key: CompareSortKey) => (state.sortKey === key ? "scds-strong" : "scds-muted");
  const body = v.rows
    .map(
      (r) =>
        `<tr class="scds-row is-static">` +
        `<td class="scds-name ${cls("name")}">${escapeHtml(r.name)}</td>` +
        v.shown.map((y) => `<td class="is-right ${cls(`rate_${y}` as CompareSortKey)}">${r.rates[y] != null ? pct1(r.rates[y]) : "-"}</td>`).join("") +
        `<td class="is-right ${cls("avg_rate")}"><span class="scds-num">${pct1(r.agg.rate)}</span>${r.agg.ci ? `<span class="scds-ci">${escapeHtml(fmtCiPp(r.agg.ci))}</span>` : ""}</td>` +
        `<td class="is-right is-wide ${cls("sample")}">${fmtInt(r.agg.n)}</td>` +
        `<td class="is-right${state.sortKey === "volatility" ? " scds-strong" : ""}">${volatilityCell(r.volatility)}</td>` +
        `</tr>`,
    )
    .join("");
  return (
    `<div class="scds-compare" data-compare="${escapeHtml(id)}" data-min-sample="${minSample}">` +
    `<div class="scds-compare-note"><p class="scds-note">${note} Shown with 95% confidence intervals and sample sizes.</p>${segmented("weighting", WEIGHTINGS, state.weighting)}</div>` +
    `<div class="scds-scroll"><table class="scds-table"><thead><tr>${thead}</tr></thead><tbody>${body}</tbody></table></div>` +
    `</div>`
  );
}

export function renderCompareRound(rounds: TrendRound[], selected: number): string {
  if (!rounds.length) {
    return `<section class="scds-section" data-compare-round-section>${h2("Playoff % by Round")}<p class="scds-empty-note">No round value comparison data.</p></section>`;
  }
  const v = compareRoundView(rounds, selected);
  const select = roundSelect("compare-round-select", v.rounds, v.round, (r) => `Round ${r}`);
  const early = v.shown.filter((y) => y < "2024").join(", ");
  const allYears = [early, "2024", "2025"].filter(Boolean).join(" and ");
  let body: string;
  if (!v.rows.length) {
    body = `<p class="scds-empty-note">Insufficient sample for Round ${v.round} position comparison.</p>`;
  } else {
    body =
      `<div class="scds-scroll"><table class="scds-table"><thead><tr><th scope="col">Position</th>` +
      v.shown.map((y) => `<th scope="col" class="is-right">${y}</th>`).join("") +
      `<th scope="col" class="is-right">Avg</th><th scope="col" class="is-right">Volatility</th>` +
      v.shown.map((y) => `<th scope="col" class="is-right">n (${y})</th>`).join("") +
      `</tr></thead><tbody>` +
      v.rows
        .map(
          (r, i) =>
            `<tr class="scds-row is-static${i === 0 ? " is-top" : ""}"><td class="scds-name scds-strong">${escapeHtml(r.pos.position)}</td>` +
            v.shown.map((y) => `<td class="is-right scds-muted">${r.rates[y] != null ? pct1(r.rates[y]) : "-"}</td>`).join("") +
            `<td class="is-right scds-strong">${pct1(r.avg)}</td><td class="is-right">${volatilityCell(r.volatility)}</td>` +
            v.shown.map((y) => `<td class="is-right scds-muted">${fmtInt((r.pos[`sample_${y}`] as number | undefined) ?? 0)}</td>`).join("") +
            `</tr>`,
        )
        .join("") +
      `</tbody></table></div>`;
  }
  return (
    `<section class="scds-section" data-compare-round-section><div class="scds-head-row"><div class="scds-head">${h2("Playoff % by Round")}</div><div class="scds-head-ctl">${select}</div></div>` +
    body +
    `<p class="scds-note">Positions with fewer than ${COMPARE_ROUND_MIN_SAMPLE} teams in either 2024 or 2025 are excluded. Volatility = standard deviation across ${allYears || "2024 and 2025"}.</p>` +
    `</section>`
  );
}

function periodChip(label: string, early: AggregateResult, late: AggregateResult): string {
  const diff = early.n > 0 && late.n > 0 ? (late.rate - early.rate) * 100 : null;
  const period = (title: string, p: AggregateResult) =>
    `<div class="scds-period"><span class="scds-period-label">${title}</span><strong>${p.n > 0 ? fmtPct(p.rate) : "-"}</strong>` +
    `<span class="scds-period-ci">${p.n > 0 ? `${escapeHtml(fmtCiPp(p.ci))} · n=${fmtInt(p.n)}` : ""}</span></div>`;
  return (
    `<div class="scds-chip"><p class="scds-chip-label">${escapeHtml(label)}</p><div class="scds-chip-row">` +
    period("2021-2023 playoff rate", early) +
    `<span class="scds-chip-arrow" aria-hidden="true">&rarr;</span>` +
    period("2024-2025 playoff rate", late) +
    (diff != null ? `<span class="scds-chip-delta ${diff > 0 ? "is-up" : "is-down"}">Change: ${diff > 0 ? "+" : ""}${diff.toFixed(1)} pp</span>` : "") +
    `</div></div>`
  );
}

export function renderRobustRb(trend: Trend | null): string {
  const robust = trend ? periodPair(trend, "Robust RB") : null;
  const zero = trend ? periodPair(trend, "Zero RB") : null;
  const chips =
    robust || zero
      ? `<div class="scds-chips">${robust ? periodChip("Robust RB", robust.early, robust.late) : ""}${zero ? periodChip("Zero RB", zero.early, zero.late) : ""}</div>`
      : "";
  return (
    `<section class="scds-essay" data-robust-section>` +
    `<p class="scds-eyebrow is-gold">StatChasers Analysis</p>` +
    `<h2 class="scds-essay-h2">Why Did Robust RB Rebound?</h2>` +
    `<p class="scds-essay-lead">Robust RB improved sharply in 2024-2025, but the data cannot tell us exactly why.</p>` +
    `<div class="scds-essay-body">` +
    `<p>Across the 2021-2025 sample, most redraft draft strategies did not show a clear year-over-year trend. WR Heavy, Late TE, and Balanced builds were fairly steady, while several other strategies moved around without forming a strong long-term pattern.</p>` +
    `<p>The biggest exception was RB-heavy construction.</p>` +
    `<p><strong>Robust RB</strong> struggled from 2021-2023, then improved substantially in 2024 and remained strong in 2025. <strong>Zero RB</strong> moved in the opposite direction, performing well earlier in the sample before declining in 2024 and 2025.</p>` +
    `<p>These are observed fantasy-team outcomes only. They show what happened, not why it happened.</p>` +
    `</div>` +
    chips +
    `<div class="scds-essay-body">` +
    `<p><strong>This project cannot determine the cause of the Robust RB rebound.</strong> The dashboard measures how draft builds performed, but it does not track why individual players produced, missed time, or changed roles.</p>` +
    `<p>Several factors could have contributed, including:</p>` +
    `<ul class="scds-reasons">${POSSIBLE_EXPLANATIONS.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>` +
    `<p>These are <em>possible explanations, not conclusions</em>.</p>` +
    `<p>We do <strong>not</strong> claim that running backs became safer or more durable. That question would require injury-level data that is not included in this project.</p>` +
    `</div>` +
    `<div class="scds-method"><p class="scds-eyebrow">Methodology</p>` +
    `<p>This dashboard measures strategy <strong>outcomes</strong>, not the causes behind those outcomes.</p>` +
    `<p>Results are based on observed fantasy-team outcomes from the 2021-2025 team dataset. <strong>Top-Three Points Rate</strong> and <strong>Playoff Rate</strong> are the primary evaluation metrics. <strong>Championship Rate</strong> is included as a secondary result because it is more volatile.</p>` +
    `<p>Strategy comparisons include sample sizes and 95% confidence intervals.</p>` +
    `<p>Confidence intervals treat teams as independent. In reality, teams from the same league are not fully independent because each league has a fixed number of playoff spots. That means the true uncertainty is likely somewhat wider than shown.</p>` +
    `<p>League-level clustered intervals would require per-strategy league identifiers, which are not currently included in the aggregated dataset.</p>` +
    `</div>` +
    `<div class="scds-takeaway"><div class="scds-takeaway-in"><p class="scds-eyebrow is-gold">Key Takeaway</p>` +
    `<p>Robust RB's recent improvement is real and worth watching, but the cause remains unresolved.</p>` +
    `<p>The old assumption that early running backs are always the fragile bet may be worth re-examining. This data does not prove that RB-heavy drafting is safer now, but it does show that RB-heavy builds performed much better in the 2024-2025 sample than they did from 2021-2023.</p>` +
    `</div></div>` +
    `</section>`
  );
}

export function renderCompareView(data: Dataset, state: State, widths: Widths = DEFAULT_WIDTHS): string {
  const trend = data.trends[trendKey(state.filters)] ?? null;
  if (!trend) {
    return `<div class="scds-callout is-warn"><p>Year-over-year comparison data is not available for this format yet.</p></div>`;
  }
  const chart = compareChartRows(trend);
  const parts: string[] = [];
  parts.push(renderChartSection(chartView(chart.rows, chart.baseline, state.chartMetric), state.chartMetric, widths.chart));
  parts.push(
    `<section class="scds-section" data-compare-section="overall">${headRow("Playoff % by Year", segmented("compare-metric", COMPARE_METRICS, state.compare.overall.metric))}` +
      renderCompareTable("overall", trend.overall_strategies, state.compare.overall, "Strategy", 10) +
      `</section>`,
  );
  parts.push(
    `<section class="scds-section" data-compare-section="first-two">${headRow("First Two Picks", segmented("compare-metric", COMPARE_METRICS, state.compare.firstTwo.metric))}` +
      renderCompareTable("first-two", trend.first_two_pick_combos, state.compare.firstTwo, "Pick Combo", 25) +
      `</section>`,
  );
  parts.push(renderCompareRound(trend.round_value, state.compare.roundSel));
  parts.push(renderRobustRb(trend));
  return parts.join("");
}

/* ------------------------------------------------------------------ page */

/** The season view or the comparison, whichever the filters name. */
export function renderView(data: Dataset, state: State, widths: Widths = DEFAULT_WIDTHS): string {
  return state.filters.season === "compare" ? renderCompareView(data, state, widths) : renderSeasonView(data, state, widths);
}

function renderMetaIsland(options: RdsRenderOptions): string {
  if (!options.embed) return "";
  return `<script type="application/json" class="scds-page-data">${escapeJsonLd(JSON.stringify(rdsPageCopy()))}</script>`;
}

/** The whole tool at one state: what the server sends. */
export function renderRdsPage(data: Dataset, state: State, options: RdsRenderOptions = {}, widths: Widths = DEFAULT_WIDTHS): string {
  const f = state.filters;
  const combo = f.season === "compare" ? null : (data.combos[comboKey(f)] ?? null);
  const trend = f.season === "compare" ? (data.trends[trendKey(f)] ?? null) : null;
  return (
    `<div class="scds${options.embed ? " is-embed" : ""}" data-scds-root="1" data-scds-season="${f.season}"` +
    (options.dataUrl ? ` data-scds-data="${escapeHtml(options.dataUrl)}"` : "") +
    `>` +
    (options.embed ? "" : `<h1 class="scds-h1">${escapeHtml(RDS_H1)}</h1>`) +
    renderFilterBar(f, state.glossaryOpen) +
    renderGlossary(state.glossaryOpen) +
    renderContextBar(f, combo, trend, data.summary) +
    `<div class="scds-view" data-scds-view>${renderView(data, state, widths)}</div>` +
    // Outside .scds-view, so a view redraw leaves the open folds alone; the
    // bundle redraws it on a filter change, when its sample sentences move.
    renderRdsFaq(rdsFaqFacts(data, f)) +
    `<div class="scds-tip" data-scds-tip hidden role="tooltip"></div>` +
    renderMetaIsland(options) +
    `</div>`
  );
}

/** No dataset on disk: a sentence, not an empty dashboard. */
export function renderRdsEmpty(options: RdsRenderOptions = {}): string {
  return (
    `<div class="scds${options.embed ? " is-embed" : ""}" data-scds-root="1" data-empty="1">` +
    (options.embed ? "" : `<h1 class="scds-h1">${escapeHtml(RDS_H1)}</h1>`) +
    `<p class="scds-empty">The draft strategy analysis is not available right now. Please check back soon.</p>` +
    `</div>`
  );
}
