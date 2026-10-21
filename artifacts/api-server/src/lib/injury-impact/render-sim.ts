/**
 * The experimental injury-only draft simulation: simulated season outcomes
 * under isolated injury and replacement assumptions. Ported from the app's
 * DraftStrategySection.tsx. Collapsed by default on the page, and labelled
 * as a sandbox, never a ranking of real strategies.
 */

import { escapeHtml } from "../render";
import { renderBarChart, renderLineChart, renderScatter, tipHtml } from "./charts";
import { STRAT_COLORS, simAcrossModels, simCdf, simLabelFor, simLoss, simRows, simScatter, simTrend, type SimState, type SimTrendMetric } from "./model";
import { fold, h3, houseText, note, segmented, type Widths } from "./render-shared";
import type { DraftSimData, StrategyResult } from "./types";

const pct = (v: number) => `${Math.round(v * 100)}%`;
const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;
const loc = (v: number | undefined) => (v == null ? "-" : v.toLocaleString("en-US"));

/** Horizontal box-and-whisker per strategy, positioned by share of the points domain. */
function boxPlot(rows: { key: string; label: string; r?: StrategyResult }[], domain: [number, number], threshold: number): string {
  const [lo, hi] = domain;
  const span = hi - lo || 1;
  const pos = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / span) * 100)).toFixed(2)}%`;
  return (
    `<div class="scin-box"><div class="scin-box-cut" style="--x:${pos(threshold)}">playoff cut</div>` +
    rows
      .map((row) => {
        const r = row.r;
        if (!r) return "";
        const c = STRAT_COLORS[row.key] ?? "#64748b";
        return (
          `<div class="scin-box-row"><div class="scin-box-label">${escapeHtml(row.label)}</div><div class="scin-box-track" style="--c:${c}">` +
          `<div class="scin-box-thr" style="left:${pos(threshold)}"></div>` +
          `<div class="scin-box-whisker" style="left:${pos(r.quantiles.q05)};width:calc(${pos(r.quantiles.q95)} - ${pos(r.quantiles.q05)})"></div>` +
          `<div class="scin-box-iqr" style="left:${pos(r.quantiles.q25)};width:calc(${pos(r.quantiles.q75)} - ${pos(r.quantiles.q25)})"></div>` +
          `<div class="scin-box-med" style="left:${pos(r.quantiles.q50)}"></div>` +
          `<div class="scin-box-cvar" style="left:${pos(r.cvar10)}" title="${escapeHtml(`worst-10% avg: ${loc(r.cvar10)}`)}"></div>` +
          `</div><div class="scin-box-mean">${loc(r.mean_points)}</div></div>`
        );
      })
      .join("") +
    `<div class="scin-box-axis"><span>${loc(lo)}</span><span>${loc(Math.round((lo + hi) / 2))}</span><span>${loc(hi)}</span></div></div>`
  );
}

export function renderDraftSim(data: DraftSimData, state: SimState, widths: Widths, howOpen: boolean): string {
  const rows = simRows(data, state);
  const hidden = new Set(state.hidden);
  const domain = data.meta.points_domain ?? [1100, 1750];
  const threshold = data.meta.playoff_threshold ?? 0;
  const strategies = data.strategies;
  const series = (values: (s: string) => (number | null)[], cats: number) =>
    strategies.map((s) => ({ key: s.key, name: s.label, color: STRAT_COLORS[s.key] ?? "#64748b", values: values(s.key).slice(0, cats), width: 2, hidden: hidden.has(s.key) }));

  const cdf = simCdf(data, state.model);
  const loss = simLoss(rows);
  const scatter = simScatter(data, state.model);
  const across = simAcrossModels(data);
  const trend = simTrend(data, state.model, state.trendMetric);
  const metricLabel = state.trendMetric === "playoff_rate" ? "playoff rate" : state.trendMetric === "mean_points" ? "mean season points" : "worst-10% outcome (CVaR₁₀)";

  const columns: [string, string][] = [
    ["Strategy", "label"],
    ["Mean", "mean_points"],
    ["CVaR₁₀ (worst 10%)", "cvar10"],
    ["Playoff %", "playoff_rate"],
    ["Champ %", "championship_rate"],
    ["Top-10% %", "top10pct_rate"],
    ["Both top-2 miss 4+", "p_both_top2_miss4"],
    ["Starter wks lost", "avg_starter_weeks_lost"],
    ["VORP lost", "avg_vorp_lost"],
    ["Waiver adds", "avg_waiver_pickups"],
  ];
  const table =
    `<div class="scin-scroll"><table class="scin-table is-framed is-nowrap"><thead class="is-navy"><tr>` +
    columns.map(([label, key]) => (key === "label" ? `<th scope="col">${escapeHtml(label)}</th>` : `<th scope="col" class="is-right"><button type="button" class="scin-sort${state.sortKey === key ? " is-active" : ""}" data-sim-sort="${key}">${escapeHtml(label)}</button></th>`)).join("") +
    `</tr></thead><tbody>` +
    rows
      .map(
        (row) =>
          `<tr><td class="scin-strong is-nowrap"><span class="scin-swatch" style="background:${STRAT_COLORS[row.key] ?? "#64748b"}"></span>${escapeHtml(row.label)}</td><td class="is-right scin-strong">${loc(row.r?.mean_points)}</td><td class="is-right">${loc(row.r?.cvar10)}</td><td class="is-right">${row.r ? pct(row.r.playoff_rate) : "-"}</td><td class="is-right">${row.r ? pct(row.r.championship_rate) : "-"}</td><td class="is-right">${row.r ? pct(row.r.top10pct_rate) : "-"}</td><td class="is-right">${row.r ? pct1(row.r.p_both_top2_miss4) : "-"}</td><td class="is-right">${row.r?.avg_starter_weeks_lost ?? "-"}</td><td class="is-right">${loc(row.r?.avg_vorp_lost)}</td><td class="is-right">${row.r?.avg_waiver_pickups ?? "-"}</td></tr>`,
      )
      .join("") +
    `</tbody></table></div>` +
    note("Click a numeric header to sort. Playoff / championship computed within each simulated 12-team league. VORP lost = starter points lost to injury above waiver-replacement value.");

  const chips =
    `<div class="scin-sim-chips"><span class="scin-field-label">Strategies</span>` +
    strategies.map((s) => `<button type="button" class="scin-chip is-toggle${hidden.has(s.key) ? " is-off" : ""}" data-sim-strategy="${escapeHtml(s.key)}" aria-pressed="${!hidden.has(s.key)}"><span class="scin-swatch" style="background:${hidden.has(s.key) ? "#cbd5e1" : STRAT_COLORS[s.key] ?? "#64748b"}"></span>${escapeHtml(s.label)}</button>`).join("") +
    `</div>`;

  const cdfX = cdf.map((r) => String(r["x"]));
  const how = fold(
    "sim-how",
    "How this simulation works",
    `<p class="scin-fine">Format: ${data.meta.teams}-team PPR, ${data.meta.roster_size} roster spots, starters ${escapeHtml(data.meta.starter_slots.join(" / "))}, weeks 1-${data.meta.regular_season_weeks}. Each strategy team drafts by its priority template against 11 opponents drafting best-available by (noisy) ADP; ${data.meta.sims_per_strategy.toLocaleString("en-US")} drafts per strategy.</p>` +
      `<ul class="scin-list is-fine">${data.meta.notes.map((n) => `<li>${escapeHtml(houseText(n))}</li>`).join("")}</ul>` +
      `<p class="scin-fine is-italic">All strategies are evaluated in one standard 1-QB league for apples-to-apples comparison, so "Superflex QB-heavy" reflects the cost of spending premium picks on quarterbacks you cannot all start.</p>`,
    howOpen,
  );

  return (
    `<div class="scin-sim" data-scin-sim>` +
    `<header class="scin-sec-head">${h3("Simulated season outcomes under isolated injury assumptions")}<p class="scin-q-intro">${data.meta.total_sims.toLocaleString("en-US")} simulated 12-team PPR drafts across ${data.meta.seasons[0]}-${data.meta.seasons[data.meta.seasons.length - 1]}, using real preseason ADP boards and real player outcomes (points-per-game + injury week timing). This is an experimental sandbox for the <strong>injury component</strong> of downside risk: it isolates selected injury and replacement assumptions and is <strong>not a ranking of real-world draft strategies</strong>. For which complete strategies actually win, use the observed fantasy-team Redraft Strategy Analysis.</p></header>` +
    `<div class="scin-sim-row"><span class="scin-field-label">Waiver / replacement model</span>${segmented("sim-model", data.meta.replacement_models.map((m) => ({ value: m.key, label: m.label })), state.model, "is-wrap")}</div>` +
    chips +
    `<div class="scin-block">${h3("Distribution of simulated season points by strategy")}${note("Box = middle 50% (25th-75th pct), whisker = 5th-95th pct, vertical tick = median, ◆ = worst-10% average (CVaR₁₀). A tighter box farther right is both higher-scoring and safer.")}${boxPlot(rows, domain, threshold)}</div>` +
    table +
    `<div class="scin-grid2">` +
    `<div class="scin-mini">${h3("Cumulative probability of exceeding a points threshold")}${note(`P(season points &gt; x). The dashed line marks the average playoff cut (${loc(threshold)} pts). Lines farther right are stronger at every threshold.`)}` +
    renderLineChart({ id: "simCdf", categories: cdfX, xNumeric: true, xDomain: domain, xFormat: (x) => loc(x), series: series((k) => cdf.map((r) => r[k] ?? null), cdf.length), width: widths.half, height: 300, yDomain: [0, 100], yFormat: (x) => `${x}%`, tipFormat: (x) => `${x.toFixed(0)}%`, tipTitle: (c) => `${loc(Number(c))} pts`, refX: [{ category: cdfX.find((c) => Number(c) >= threshold) ?? "" }], legend: false, ariaLabel: "Probability of exceeding a points threshold by strategy" }) +
    `</div>` +
    `<div class="scin-mini">${h3("Mean result vs worst-10% outcome")}${note("Up = higher average; right = higher floor (better worst case). The top-right corner is the rational sweet spot for managed redraft.")}` +
    renderScatter({
      id: "simScatter",
      points: scatter.filter((d) => !hidden.has(d.key)).map((d) => ({ x: d.x, y: d.y, label: d.label, color: STRAT_COLORS[d.key] ?? "#64748b", series: d.key, tip: tipHtml(d.label, [{ name: "Mean", value: loc(d.y) }, { name: "Worst-10%", value: loc(d.x) }]) })),
      groups: [],
      width: widths.half,
      height: 300,
      xDomain: [Math.min(...scatter.map((d) => d.x)) - 10, Math.max(...scatter.map((d) => d.x)) + 10],
      yDomain: [Math.min(...scatter.map((d) => d.y)) - 10, Math.max(...scatter.map((d) => d.y)) + 10],
      xFormat: (x) => loc(Math.round(x)),
      yFormat: (x) => loc(Math.round(x)),
      xLabel: "Worst-10% (CVaR₁₀)",
      yLabel: "Mean",
      radius: [6, 6],
      legend: false,
      ariaLabel: "Mean result against the worst-10% outcome by strategy",
    }) +
    `</div>` +
    `<div class="scin-mini">${h3("Probability of losing starters simultaneously")}${note("Chance that, in some week, 1+ / 2+ / 3+ of a roster's intended starters are all out at once.")}` +
    renderBarChart({
      id: "simLoss",
      categories: loss.map((l) => l.label),
      series: [
        { key: "one", name: "≥1 starter", color: "#93c5fd", values: loss.map((l) => l["≥1 starter"]) },
        { key: "two", name: "≥2 starters", color: "#3b82f6", values: loss.map((l) => l["≥2 starters"]) },
        { key: "three", name: "≥3 starters", color: "#1e3a8a", values: loss.map((l) => l["≥3 starters"]) },
      ],
      width: widths.half,
      height: 300,
      yFormat: (x) => `${x}%`,
      tipFormat: (x) => `${x.toFixed(0)}%`,
      tiltLabels: true,
      legend: false,
      ariaLabel: "Probability of losing starters simultaneously by strategy",
    }) +
    `</div>` +
    `<div class="scin-mini">${h3("Strategy performance by waiver assumption")}${note("Mean points as the replacement model changes. Steep lines gain most from an active wire; flat lines are self-sufficient. Best ball absorbs losses through depth, not waivers.")}` +
    renderLineChart({ id: "simAcross", categories: across.map((r) => String(r["model"])), series: series((k) => across.map((r) => Number(r[k] ?? 0)), across.length).map((s) => ({ ...s, dots: true })), width: widths.half, height: 300, yDomain: [Math.min(...strategies.flatMap((s) => across.map((r) => Number(r[s.key] ?? 0)))) - 15, Math.max(...strategies.flatMap((s) => across.map((r) => Number(r[s.key] ?? 0)))) + 15], yFormat: (x) => loc(Math.round(x)), legend: false, ariaLabel: "Mean points by replacement model and strategy" }) +
    `</div></div>` +
    `<div class="scin-block"><div class="scin-head-row">${h3("Strategy edge by season: consistent, or driven by a few years?")}${segmented("sim-trend", [{ value: "playoff_rate", label: "Playoff %" }, { value: "mean_points", label: "Mean points" }, { value: "cvar10", label: "Worst-10%" }], state.trendMetric)}</div>` +
    note(`Each strategy's ${metricLabel} in each individual season (${data.meta.sims_per_strategy / data.meta.seasons.length} drafts per year). A flat line is a robust edge; big year-to-year swings mean the pooled number leans on a few seasons. Toggle strategies with the chips above.`) +
    renderLineChart({
      id: "simTrend",
      categories: trend.map((r) => String(r["season"])),
      series: series((k) => trend.map((r) => (r[k] == null ? null : Number(r[k]))), trend.length).map((s) => ({ ...s, dots: true })),
      width: widths.full,
      height: 320,
      ...(state.trendMetric === "playoff_rate" ? { yDomain: [0, 100] as [number, number], refY: [{ value: 50, label: "50%" }] } : {}),
      yFormat: (x) => (state.trendMetric === "playoff_rate" ? `${x}%` : loc(Math.round(x))),
      tipFormat: (x) => (state.trendMetric === "playoff_rate" ? `${x.toFixed(0)}%` : loc(x)),
      tipTitle: (c) => `${c} season`,
      legend: false,
      ariaLabel: "Strategy edge by season",
    }) +
    `</div>` +
    how +
    `</div>`
  );
}

export { simLabelFor, type SimTrendMetric };
