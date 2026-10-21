/**
 * Markup for the injury risk analysis dashboard.
 *
 * Shared by the server and the browser. The server renders the default view
 * (every season, ADP 1-180, 1+ games missed, the "Is the NFL safer?" tab) and
 * client/injury-impact.ts redraws sections with these same functions when a
 * filter, a sort, a legend or a tab changes.
 *
 * The layout is the standalone app's (RESEARCH-Injury-Impact-Analysis at
 * c6a49ce, pages/Dashboard.tsx): the executive summary, the question tabs,
 * the filter bar, six research-question sections each opened by an answer
 * card and closed by a fantasy implication, the risk outcomes and position
 * tables, the collapsed supporting charts, the final summary, the experimental
 * simulation and the methodology. The dress is this app's (injury-impact.css,
 * Inter, navy and gold). Kept from the source because they carry meaning: the
 * position colors, the age and workload ramps, the chart inks and the
 * classification colors.
 */

import { escapeHtml } from "../render";
import { renderBarChart, renderLegend, renderLineChart, renderScatter, tipHtml } from "./charts";
import type { DashState, Views } from "./dashboard";
import { isHidden } from "./dashboard";
import {
  AGE_BUCKETS,
  AGE_COLORS,
  CHART_COLORS,
  FINAL_SUMMARY,
  POS4,
  POS_COLORS,
  QUESTION_NAV,
  RULE_CHANGE_CAVEAT,
  SAFETY_CHANGES,
  SMALL_SAMPLE_MAX,
  TYPE_CLASS_COLOR,
  WORKLOAD_COLORS,
  WORKLOAD_TIERS,
  ADP_MIN,
  ADP_MAX,
  ADP_TIERS,
  INJ_SORT_MAP,
  INJURY_TOP_N,
  injurySortValue,
  posColor,
  slotPrep,
  type Filters,
  type PositionImpactRow,
  type QuestionTab,
  type SortState,
} from "./model";
import { renderDraftSim } from "./render-sim";
import { renderTagImpact } from "./render-tag";
import {
  DEFAULT_WIDTHS,
  EMPTY_ASSETS,
  boldText,
  calloutList,
  eyebrow,
  fantasyNote,
  fold,
  h2,
  h3,
  injuryPageCopy,
  labeled,
  n0,
  n1,
  n2,
  note,
  pctF,
  pctRaw,
  posSpan,
  posText,
  houseText,
  renderMetaIsland,
  select,
  smallSample,
  sortIcon,
  verdict,
  type InjuryRenderOptions,
  type Widths,
} from "./render-shared";
import type { InjuryDataset, PostReturnGroup } from "./types";

export { DEFAULT_WIDTHS, type InjuryRenderOptions, type Widths } from "./render-shared";

const GRID_W = 900;

/* ----------------------------------------------------------------- header */

export function renderHeader(options: InjuryRenderOptions): string {
  const copy = injuryPageCopy("analysis");
  return (
    `<header class="scin-head">` +
    eyebrow("Fantasy Football") +
    (options.embed ? "" : `<h1 class="scin-h1">${escapeHtml(copy.h1)}</h1>`) +
    `<p class="scin-lead">${escapeHtml(copy.description)}</p>` +
    `</header>`
  );
}

/* ---------------------------------------------------------- exec summary */

function execCard(href: string, question: string, answer: string, detail: string): string {
  return `<a class="scin-exec" href="${escapeHtml(href)}" data-tab-link><p class="scin-exec-q">${escapeHtml(question)}</p><p class="scin-exec-a">${escapeHtml(answer)}</p><p class="scin-exec-d">${detail}</p></a>`;
}

export function renderExecSummary(v: Views): string {
  const ex = v.exec;
  const fit = ex.trendFit;
  const pct0 = (x: number | null | undefined) => (x == null ? "-" : `${Math.round(x)}%`);
  const safer = ex.trendSignificant ? "Modestly, by this measure." : ex.trendRising && ex.regressionAgrees !== false ? "No. By this measure, injuries rose." : "Not clearly.";
  const saferDetail =
    ex.trendRising && fit
      ? `Adjusted time-loss injuries rose about ${fit.annualPct.toFixed(1)}% per year from ${fit.firstYear}-${fit.lastYear}${ex.regressionAgrees === false ? ", but the age-adjusted model was not statistically significant. Treat the increase as a trend to watch, not a settled conclusion." : ", a statistically reliable increase."}`
      : `Adjusted time-loss rates changed by ${fit ? `${ex.trendSignificant ? "" : "just "}${fit.annualPct >= 0 ? "+" : ""}${fit.annualPct.toFixed(1)}%` : "roughly 0%"} per year, with ${ex.trendSignificant ? "a" : "no"} statistically reliable decline. ${ex.trendSignificant ? "The decline is modest, so injury risk is still a major draft factor." : "In other words, the data does not show a clear trend that players are becoming meaningfully safer from time-loss injuries."}`;
  const predicts = ex.workloadSig ? "Heavy prior workload appears to matter more than age." : "Age and prior workload add little.";
  const predictsDetail = ex.workloadSig
    ? `Players with a heavy prior workload were injured at a ${pct0(ex.heavyInj)} rate, compared to ${pct0(ex.lightInj)} for players with lighter prior usage. The takeaway: mileage may matter more than birthdays.`
    : `Heavy-workload players were injured ${pct0(ex.heavyInj)} vs ${pct0(ex.lightInj)} for lighter workloads. Body-part-specific injury history is the more useful signal.`;
  const dc = v.dcr;
  const draftDetail = dc.mostFragile
    ? `${posText(dc.mostFragile.pos, `${dc.mostFragile.pos}s`)} ${slotPrep(dc.mostFragile.bucket)} ${escapeHtml(dc.mostFragile.bucket)} had the highest Fragility Tax${dc.bestValue ? `, while ${posText(dc.bestValue.pos, `${dc.bestValue.pos}s`)} ${slotPrep(dc.bestValue.bucket)} ${escapeHtml(dc.bestValue.bucket)} offered the best injury-adjusted value` : ""}.`
    : "The highest Fragility Tax and the best injury-adjusted value by position and draft slot are shown in the draft section.";
  return (
    `<section class="scin-exec-grid" aria-label="Headline answers">` +
    execCard("#q-safer", "Is the NFL Becoming Safer?", safer, escapeHtml(saferDetail)) +
    execCard("#q-risk", "What Predicts Injury?", predicts, escapeHtml(predictsDetail)) +
    execCard("#q-risk", "Are Previously Injured Players Injury-Prone?", "Only modestly.", escapeHtml(`Players with a prior injury were hurt ${pct0(ex.priorInj)} vs ${pct0(ex.noPriorInj)} with no known prior injury, with little increase in severity.`)) +
    execCard(
      "#q-return",
      "What Happens After Players Return?",
      "Active doesn't always mean recovered.",
      escapeHtml(`Players returned at about ${ex.retAll == null ? "-" : `${Math.round(ex.retAll * 100)}%`} of prior production over their first four games back; RBs averaged about ${ex.retRB == null ? "-" : `${Math.round(ex.retRB * 100)}%`}.`),
    ) +
    execCard("#q-draft", "Where Is Draft Capital Most Exposed?", "Mid-round RBs carry the biggest injury penalty.", draftDetail) +
    `</section>`
  );
}

/* ----------------------------------------------------------------- tabs */

export function renderTabs(active: QuestionTab): string {
  return (
    `<nav class="scin-tabs" aria-label="Research questions" data-scin-tabs><div class="scin-tabs-row" role="tablist">` +
    QUESTION_NAV.map((q) => `<a class="scin-tab${q.id === active ? " is-active" : ""}" href="#${q.id}" role="tab" aria-selected="${q.id === active}" data-tab="${q.id}">${escapeHtml(q.label)}</a>`).join("") +
    `</div></nav>`
  );
}

/* ------------------------------------------------------------ filter bar */

export function renderFilterBar(f: Filters, seasons: { year: number; hasData: boolean }[]): string {
  const seasonSel = select(
    "season",
    [{ value: "All", label: "All" }, ...seasons.map((s) => ({ value: String(s.year), label: s.hasData ? String(s.year) : `${s.year} · no data` }))],
    f.season,
    "Season",
    "is-navy",
  );
  return (
    `<div class="scin-bar" data-scin-bar>` +
    labeled("Season", seasonSel) +
    `<div class="scin-field is-range"><span class="scin-field-label">Fantasy ADP Range <output class="scin-range-out" data-adp-out>${f.adp[0]}-${f.adp[1]}</output></span>` +
    `<div class="scin-dual" style="--lo:${((f.adp[0] - ADP_MIN) / (ADP_MAX - ADP_MIN)) * 100}%;--hi:${((f.adp[1] - ADP_MIN) / (ADP_MAX - ADP_MIN)) * 100}%">` +
    `<input type="range" class="scin-range" min="${ADP_MIN}" max="${ADP_MAX}" step="1" value="${f.adp[0]}" data-adp-lo aria-label="ADP range start" />` +
    `<input type="range" class="scin-range" min="${ADP_MIN}" max="${ADP_MAX}" step="1" value="${f.adp[1]}" data-adp-hi aria-label="ADP range end" />` +
    `</div></div>` +
    `<div class="scin-field is-range is-single"><span class="scin-field-label">Min Games Missed <output class="scin-range-out" data-min-out>${f.minGames}</output></span>` +
    `<input type="range" class="scin-range" min="1" max="16" step="1" value="${f.minGames}" data-min-games aria-label="Minimum games missed" /></div>` +
    `<div class="scin-field is-search"><span class="scin-field-label">Search Player</span><div class="scin-search" data-scin-search>` +
    `<input type="search" class="scin-search-input" placeholder="Search any player…" autocomplete="off" aria-label="Search any player's injury history" data-search-input />` +
    `<div class="scin-search-list" data-search-list hidden></div></div></div>` +
    `</div>`
  );
}

/* --------------------------------------------------------- Q1: safer? */

function qHeader(n: number, question: string, intro: string): string {
  return `<header class="scin-q-head">${eyebrow(`Question ${n} · ${question}`)}${h2(question)}<p class="scin-q-intro">${intro}</p></header>`;
}

export function renderSafer(ds: InjuryDataset, v: Views, state: DashState, widths: Widths): string {
  const t = v.trends;
  const ex = v.exec;
  const reg = ds.regression;
  const hidden = (state.tab === "q-safer" ? "" : " hidden");
  const intro =
    `Season trends for fantasy-relevant drafted players. ` +
    (t?.hasSnaps ? `Rates are per 1,000 offensive snaps, regular season + playoffs. Snap-normalized rates are only shown at the full ADP range. ` : `Exposure = drafted player-seasons. `) +
    `The <strong>adjusted</strong> line holds the league position mix fixed (direct standardization) so roster-composition shifts don't read as safety changes. Spans all seasons; ignores the season and Min-Games sliders.`;
  let verd: string;
  if (ex.trendRising && t?.fit) {
    verd = verdict(
      escapeHtml(`Adjusted time-loss injury risk has risen about ${t.fit.annualPct.toFixed(1)}% a year since ${t.fit.firstYear}, after adjusting for exposure and position mix.`),
      escapeHtml(
        `That is a statistically reliable increase in injuries per 1,000 offensive snaps${ex.regressionAgrees === false ? "; the age-adjusted regression below, which counts full-season injuries per full-season snap, doesn't find a significant change, so treat it as a trend to watch" : ""}. Injury burden can move independently of injury frequency, and individual body regions fluctuate more than the overall league rate.`,
      ),
    );
  } else if (ex.trendSignificant && t?.fit) {
    verd = verdict(
      escapeHtml(`Adjusted time-loss injury risk has declined about ${Math.abs(t.fit.annualPct).toFixed(1)}% a year since ${t.fit.firstYear}, after adjusting for exposure and position mix.`),
      "The decline is modest. Injury burden can move independently of injury frequency, and individual body regions fluctuate more than the overall league rate.",
    );
  } else {
    verd = verdict(
      "Overall time-loss injury risk has remained approximately flat after adjusting for exposure and position mix.",
      "Adjusted incidence shows no statistically reliable leaguewide decline over the study period. Injury burden can move independently of injury frequency, and individual body regions fluctuate more than the overall league rate.",
    );
  }
  if (!t || !v.heatmap) {
    return `<section class="scin-q" id="q-safer" data-section="q-safer"${hidden}>${qHeader(1, "Is the NFL becoming safer?", intro)}${verd}<p class="scin-empty">The season trends are not available.</p></section>`;
  }

  const parts: string[] = [];
  if (t.fit) {
    const fit = t.fit;
    parts.push(
      `<div class="scin-callout ${fit.annualPct < 0 ? "is-green" : "is-amber"}"><p class="scin-callout-eyebrow">Adjusted incidence trend, ${fit.firstYear}-${fit.lastYear}</p><p>` +
        `After holding position mix fixed, the injury rate changed <strong>${fit.annualPct >= 0 ? "+" : ""}${fit.annualPct.toFixed(1)}% per year</strong> (${fit.totalPct >= 0 ? "+" : ""}${fit.totalPct.toFixed(0)}% overall), ` +
        `${fit.p < 0.05 ? "a statistically significant trend" : "not statistically distinguishable from flat"} (p ≈ ${fit.p < 0.001 ? "<0.001" : fit.p.toFixed(3)}, log-linear fit${t.hasSnaps ? " on the per-1,000-snap rate" : ""}).` +
        (t.hasSnaps ? " Adjusts for position mix; age isn't in the data." : " Age and true snap exposure aren't in the data, so this adjusts for position mix only.") +
        (t.partialSeasons.length > 0 ? ` ${escapeHtml(t.partialSeasons.join(", "))} ${t.partialSeasons.length > 1 ? "are" : "is"} excluded from the fit (incomplete injury or snap data, or a non-comparable pool depth).` : "") +
        `</p></div>`,
    );
  }
  if (reg) {
    const st = reg.season_trend;
    parts.push(
      `<div class="scin-callout is-grey"><p class="scin-callout-eyebrow">Fully adjusted model: quasi-Poisson, ${n0(reg.n_player_seasons)} player-seasons</p><p>` +
        `Controlling for <strong>position and age</strong> with snaps as the exposure offset, the injury rate changed <strong>${st.annual_pct_change >= 0 ? "+" : ""}${st.annual_pct_change.toFixed(1)}% per year</strong> ` +
        `(95% CI ${st.ci95[0].toFixed(1)}% to ${st.ci95[1].toFixed(1)}%, p ≈ ${st.p < 0.001 ? "<0.001" : st.p.toFixed(2)}), ` +
        `${st.ci95[0] <= 0 && st.ci95[1] >= 0 ? "no significant change." : st.annual_pct_change < 0 ? "a significant decline." : "a significant rise."} ` +
        `Age barely mattered (${reg.age_effect.pct_per_year >= 0 ? "+" : ""}${reg.age_effect.pct_per_year.toFixed(1)}%/yr of age, p ≈ ${reg.age_effect.p < 0.001 ? "<0.001" : reg.age_effect.p.toFixed(2)}).</p>` +
        `<p class="scin-fine">log(E[episodes]) = β₀ + β·season + β·position + β·age + log(snaps). Overdispersion φ = ${reg.dispersion} (quasi-Poisson SEs).${reg.seasons_excluded.length > 0 ? ` Seasons ${escapeHtml(reg.seasons_excluded.join(", "))} excluded.` : ""} Contact/non-contact and routes aren't in the data, so they aren't controlled for.</p></div>`,
    );
  }

  // 1) adjusted injury-rate trend with the CI band.
  const cats = t.points.map((p) => p.season);
  const rateFmt = (x: number) => (t.hasSnaps ? `${Math.round(x * 100) / 100}` : `${Math.round(x * 10) / 10}%`);
  parts.push(
    `<div class="scin-block">${h3("Adjusted Injury-Rate Trend")}` +
      note(
        `${t.hasSnaps ? "Time-loss injuries per 1,000 offensive snaps per season." : "% of drafted players injured per season."} Band = 95% CI on the position-adjusted rate. Dashed = raw (unadjusted). Vertical markers flag major NFL rule changes as <strong>historical context only</strong>, not as causes of any movement in the trend (see caveats below).`,
      ) +
      renderLineChart({
        id: "trend",
        categories: cats,
        series: [
          { key: "adjusted", name: "Adjusted", color: CHART_COLORS.blue, values: t.points.map((p) => (t.hasSnaps ? p.stdRate : p.stdPct)), width: 3, dots: true, hidden: isHidden(state, "trend", "adjusted") },
          { key: "raw", name: "Raw", color: CHART_COLORS.slate, values: t.points.map((p) => (t.hasSnaps ? p.rawRate : p.rawPct)), width: 2, dashed: true, hidden: isHidden(state, "trend", "raw") },
        ],
        band: { lo: t.points.map((p) => (t.hasSnaps ? p.ciRate[0] : p.ci[0])), hi: t.points.map((p) => (t.hasSnaps ? p.ciRate[1] : p.ci[1])), color: CHART_COLORS.blue, name: "95% CI", format: (lo, hi) => `${rateFmt(lo)} to ${rateFmt(hi)}` },
        refX: SAFETY_CHANGES.filter((m) => cats.includes(m.season)).map((m) => ({ category: m.season, label: m.label })),
        width: widths.full,
        height: 300,
        yFormat: rateFmt,
        tipFormat: (x) => (t.hasSnaps ? `${rateFmt(x)} /1k snaps` : rateFmt(x)),
        ariaLabel: "Adjusted injury-rate trend by season",
      }) +
      `<p class="scin-fine is-italic">Rule markers are historical context only. This chart does not establish causation. Full rule-change caveats are in the Methodology &amp; Definitions fold.</p></div>`,
  );

  // 2) burden trend.
  parts.push(
    `<div class="scin-block">${h3("Injury-Burden Trend")}` +
      note(`${t.hasSnaps ? "Games missed per 1,000 offensive snaps." : "Games missed per drafted player-season."} Burden can move differently than incidence: more (or fewer) injuries doesn't have to mean more (or less) time lost.`) +
      renderLineChart({
        id: "burden",
        categories: cats,
        series: [
          { key: "adjusted", name: "Adjusted", color: CHART_COLORS.purple, values: t.points.map((p) => (t.hasSnaps ? p.burdenStdSnap : p.burdenStd)), width: 3, dots: true, hidden: isHidden(state, "burden", "adjusted") },
          { key: "raw", name: "Raw", color: CHART_COLORS.slate, values: t.points.map((p) => (t.hasSnaps ? p.burdenRawSnap : p.burdenRaw)), width: 2, dashed: true, hidden: isHidden(state, "burden", "raw") },
        ],
        refX: SAFETY_CHANGES.filter((m) => cats.includes(m.season)).map((m) => ({ category: m.season })),
        width: widths.full,
        height: 280,
        yFormat: (x) => `${Math.round(x * 100) / 100}`,
        ariaLabel: "Injury-burden trend by season",
      }) +
      `</div>`,
  );

  // 3) heatmap.
  const hm = v.heatmap;
  const partial = new Set(t.partialSeasons);
  const cell = (rate: number) => {
    const a = hm.max > 0 ? rate / hm.max : 0;
    return `style="background:rgba(166,8,8,${(0.05 + a * 0.85).toFixed(3)});color:${a > 0.55 ? "#fff" : "#334155"}"`;
  };
  parts.push(
    `<div class="scin-block">${h3("Body Region × Season")}` +
      `<div class="scin-note"><p><strong>What body parts get hurt, and when.</strong> Rates are shown per 1,000 drafted players so seasons compare fairly; darker means more injuries.</p>` +
      `<p><strong>Avg</strong> shows the long-term risk by body region; <strong>Total</strong> shows how injury-heavy each season was.</p>` +
      `<p>Ankles/feet and knees consistently rank among the most common injury areas. Knee injuries deserve particular attention because they also include major injuries such as ACL tears.</p></div>` +
      `<div class="scin-scroll"><div class="scin-heat" style="--scin-cols:${hm.seasons.length}">` +
      `<div class="scin-heat-head is-sticky">Region</div>` +
      hm.seasons.map((s) => `<div class="scin-heat-head${partial.has(s) ? " is-partial" : ""}"${partial.has(s) ? ' title="Excluded from trend fit (incomplete data or non-comparable pool depth)"' : ""}>${s}${partial.has(s) ? "*" : ""}</div>`).join("") +
      `<div class="scin-heat-head is-avg" title="All-season rate for this region: total injuries ÷ total drafted, per 1,000">Avg</div>` +
      hm.rows
        .map(
          (row) =>
            `<div class="scin-heat-label is-sticky">${escapeHtml(row.region)}</div>` +
            row.cells.map((c) => `<div class="scin-heat-cell" ${cell(c.rate)} title="${escapeHtml(`${row.region} · ${c.season}: ${c.rate} per 1,000`)}">${c.rate > 0 ? c.rate : "·"}</div>`).join("") +
            `<div class="scin-heat-cell is-avg" title="${escapeHtml(`${row.region} · all-season average: ${row.avg} per 1,000`)}">${row.avg > 0 ? row.avg : "·"}</div>`,
        )
        .join("") +
      `<div class="scin-heat-label is-sticky is-total">Total</div>` +
      hm.colTotals.map((c) => `<div class="scin-heat-cell is-total" title="${escapeHtml(`${c.season} · all regions: ${c.rate} per 1,000`)}">${c.rate > 0 ? c.rate : "·"}</div>`).join("") +
      `<div class="scin-heat-cell is-total is-grand" title="${escapeHtml(`Overall all-season rate: ${hm.grandRate} per 1,000`)}">${hm.grandRate > 0 ? hm.grandRate : "·"}</div>` +
      `</div></div></div>`,
  );

  // Three findings.
  parts.push(
    `<ul class="scin-findings">` +
      [
        ["The league isn't really getting safer", "Overall injury rates have stayed fairly steady. Rule changes and better medicine haven't clearly made drafted players less likely to get hurt."],
        ["Fewer injuries doesn't mean less damage", "Injury count and games missed are different. A season can look quiet and still be brutal if the injuries are severe."],
        ["Don't trust one scary number", "Individual body-part rates swing a lot year to year. One spike can come from just a few players, so real trends need multiple seasons."],
      ]
        .map(([title, body]) => `<li><p class="scin-finding-title">${escapeHtml(title as string)}</p><p>${escapeHtml(body as string)}</p></li>`)
        .join("") +
      `</ul>`,
  );

  // Supporting season data, folded.
  const metricsTable =
    `<div class="scin-block">${h3("Per-Season Metrics")}<div class="scin-scroll"><table class="scin-table is-plain"><thead><tr>` +
    `<th scope="col">Season</th><th scope="col" class="is-right" title="Distinct injured players">Injured</th><th scope="col" class="is-right" title="Mean games missed per episode">Mean GM</th><th scope="col" class="is-right" title="Median games missed per episode">Median GM</th>` +
    `<th scope="col" class="is-right" title="Share of episodes that ended the player's season">% Season-End</th><th scope="col" class="is-right" title="Share of episodes costing 2+ games">% 2+</th><th scope="col" class="is-right" title="Share of episodes costing 4+ games">% 4+</th><th scope="col" class="is-right" title="Share of episodes costing 8+ games">% 8+</th><th scope="col" class="is-right" title="Total fantasy value lost (sum of net value lost)">Fantasy Lost</th>` +
    `</tr></thead><tbody>` +
    v.metrics
      .map(
        (m) =>
          `<tr><td class="scin-strong">${m.season}${partial.has(m.season) ? ` <span class="scin-muted is-small">(excl.)</span>` : ""}</td><td class="is-right">${n0(m.players)}</td><td class="is-right">${m.meanGm.toFixed(1)}</td><td class="is-right">${m.medianGm}</td><td class="is-right">${m.pctEnding}%</td><td class="is-right">${m.pct2}%</td><td class="is-right">${m.pct4}%</td><td class="is-right">${m.pct8}%</td><td class="is-right">${n0(m.fantasyLost)}</td></tr>`,
      )
      .join("") +
    `</tbody></table></div>` +
    note(`Every episode here is a time-loss injury (1+ games), so "% 1+" is 100% by construction and is omitted. Still not available: routes run (per-1,000-routes rates), age groups, contact vs non-contact, and preseason vs regular season.`) +
    `</div>`;
  const workloadTable = v.workload
    ? `<div class="scin-block">${h3("Workload-Normalized Rates by Position")}<div class="scin-scroll"><table class="scin-table is-plain"><thead><tr>` +
      `<th scope="col">Position</th><th scope="col" class="is-right" title="Injury episodes per 1,000 offensive snaps">Inj / 1k snaps</th><th scope="col" class="is-right">Workload unit</th><th scope="col" class="is-right" title="Injury episodes per 1,000 of the position's natural workload unit">Inj / 1k unit</th><th scope="col" class="is-right" title="Games missed per 1,000 of the position's natural workload unit">GM / 1k unit</th>` +
      `</tr></thead><tbody>` +
      v.workload.map((r) => `<tr><td>${posSpan(r.position)}</td><td class="is-right">${r.injPerSnap == null ? "-" : r.injPerSnap.toFixed(2)}</td><td class="is-right scin-muted">${escapeHtml(r.unitLabel)}</td><td class="is-right">${r.injPerUnit == null ? "-" : r.injPerUnit.toFixed(2)}</td><td class="is-right">${r.gmPerUnit == null ? "-" : r.gmPerUnit.toFixed(2)}</td></tr>`).join("") +
      `</tbody></table></div></div>`
    : "";
  parts.push(fold("q1-support", "View supporting season data", metricsTable + workloadTable, state.open.includes("q1-support")));

  return `<section class="scin-q" id="q-safer" data-section="q-safer"${hidden}>${qHeader(1, "Is the NFL becoming safer?", intro)}${verd}${parts.join("")}</section>`;
}

/* ------------------------------------------------- Q2 + Q3: who is at risk */

function kmChart(id: string, rows: { week: number; [k: string]: number | null }[], series: { key: string; name: string; color: string; dashed?: boolean }[], state: DashState, width: number, height: number, yMin: number, label: string): string {
  return renderLineChart({
    id,
    categories: rows.map((r) => String(r.week)),
    series: series.map((s) => ({ key: s.key, name: s.name, color: s.color, values: rows.map((r) => (r[s.key] as number | null) ?? null), width: 2.5, ...(s.dashed ? { dashed: true } : {}), hidden: isHidden(state, id, s.key) })),
    width,
    height,
    yDomain: [yMin, 100],
    yFormat: (x) => `${x}%`,
    tipFormat: (x) => `${x.toFixed(1)}%`,
    tipTitle: (c) => `After Week ${c}`,
    xLabel: "NFL Week",
    ariaLabel: label,
  });
}

export function renderRisk(v: Views, state: DashState, widths: Widths): string {
  const ip = v.predictability;
  const aw = v.aw;
  const ex = v.exec;
  const showRisk = state.tab === "q-risk";
  const showRecur = state.tab === "q-recur";
  const hidden = showRisk || showRecur ? "" : " hidden";
  const pct0 = (x: number | null | undefined) => (x == null ? "-" : `${Math.round(x)}%`);

  const head =
    `<div data-subtab="q-risk"${showRecur ? " hidden" : ""}>` +
    qHeader(2, "Can we predict who will get injured?", "Two separate questions matter: who gets injured, and how severe the injury will be.") +
    (ex.workloadSig
      ? verdict("Injury prediction is limited, but heavy prior workload and specific injury history provide useful signals. Age contributes little to overall incidence.", "Age barely moves whether a player gets hurt; a heavy prior-season workload and body-part-specific history carry the real signal.")
      : verdict("Prediction is limited. Age and prior workload add little; specific injury history, especially to the same body part, is the strongest signal.")) +
    `<div class="scin-tiles">` +
    [
      ["Age", "Little effect", "Overall injury rates are similar across age groups."],
      ["Heavy prior workload", `${pct0(ex.heavyInj)} vs ${pct0(ex.lightInj)}`, "Injury rate with heavy vs light prior-season snaps."],
      ["Any prior injury", `${pct0(ex.priorInj)} vs ${pct0(ex.noPriorInj)}`, "Higher injury incidence, but no clear severity increase."],
      ["Prior same-region injury", "Moderate lift", "The clearest repeat-risk signal."],
    ]
      .map(([k, val, sub]) => `<div class="scin-tile"><p class="scin-tile-k">${escapeHtml(k as string)}</p><p class="scin-tile-v">${escapeHtml(val as string)}</p><p class="scin-tile-s">${escapeHtml(sub as string)}</p></div>`)
      .join("") +
    `</div></div>`;

  // Q1: KM by position.
  const kmPos =
    `<div class="scin-block">${h3("Q1 · Will they get hurt? Weeks to first time-loss injury (Kaplan-Meier)")}` +
    note(`Share of drafted players still injury-free through each week. Cohort = ${n0(ip.cohort["All"] ?? 0)} drafted player-seasons; events placed at the week of injury. Steeper, lower curves = earlier and more frequent injuries. Split by position (the only stratum the anonymous drafted pool supports).`) +
    kmChart("km", ip.km, [{ key: "All", name: "All", color: CHART_COLORS.slate, dashed: true }, ...POS4.map((p) => ({ key: p, name: p, color: POS_COLORS[p] as string }))], state, widths.full, 320, 50, "Weeks to first injury by position") +
    `<div class="scin-chips">${POS4.map((p) => `<span class="scin-chip">${posSpan(p)}<span>${ip.kmEnd[p] == null ? "-" : `${ip.kmEnd[p]}% injury-free by Wk 17`}</span></span>`).join("")}</div></div>`;

  // Q2: severity by prior.
  const sev =
    `<div class="scin-block is-rule">${h3("Q2 · How bad, if hurt? Severity by prior injury history")}` +
    note(`Among injured player-seasons only. "Prior injured seasons" counts earlier seasons with a recorded time-loss injury.`) +
    `<div class="scin-scroll"><table class="scin-table is-framed"><thead><tr><th scope="col"><span class="scin-sr">Prior history</span></th><th scope="col" class="is-right" title="Injured player-seasons in this group">Players</th><th scope="col" class="is-right" title="Mean games missed for this group's injuries">Avg. games missed</th><th scope="col" class="is-right" title="Share missing 8 or more games">Missed 8+</th><th scope="col" class="is-right" title="Share whose injury ended the season">Season-ending</th><th scope="col" class="is-right" title="Share labeled Severe (top-24 ADP, 8+ games)">Severe</th></tr></thead><tbody>` +
    ip.severityByPrior.map((r) => `<tr><td class="scin-strong">${escapeHtml(r.label)}</td><td class="is-right scin-muted">${n0(r.n)}</td><td class="is-right scin-strong">${r.meanGm.toFixed(1)}</td><td class="is-right">${r.p8.toFixed(0)}%</td><td class="is-right">${r.pEnd.toFixed(0)}%</td><td class="is-right">${r.severe.toFixed(0)}%</td></tr>`).join("") +
    `</tbody></table></div>` +
    note(`Prior injury history is a <strong>weak severity signal</strong>. Once a player is hurt, games missed barely change with prior history.`) +
    note(`Injury history is more useful for predicting <strong>whether and where</strong> a player gets hurt than <strong>how severe</strong> the injury will be.`) +
    `</div>`;

  // Q1 continued: age and workload.
  let awBlock = "";
  if (aw) {
    awBlock =
      `<div class="scin-block is-rule">${h3("Q1 continued · Does age or prior workload predict injury?")}` +
      note(`Measured across <strong>${n0(aw.totalN)} drafted player-seasons</strong> with known age and snaps; ${n0(aw.eligibleN)} also have prior-season workload data.`) +
      note(`Workload uses <strong>previous-season snaps within position</strong>. Current-season snaps are excluded because injuries themselves reduce playing time.`) +
      `<div class="scin-grid2">` +
      `<div><p class="scin-eyebrow">Weeks to first injury, by age group</p>` +
      kmChart("ageKM", aw.ageKm, AGE_BUCKETS.map((b) => ({ key: b, name: b, color: AGE_COLORS[b] as string })), state, widths.half, 260, 40, "Weeks to first injury by age group") +
      `<div class="scin-chips">${aw.ageSeverity.map((a) => `<span class="scin-chip"><span class="scin-pos" style="color:${AGE_COLORS[a.bucket]}">${escapeHtml(a.bucket)}</span><span>${a.injPct.toFixed(0)}% injured</span></span>`).join("")}</div></div>` +
      `<div><p class="scin-eyebrow">Weeks to first injury, by prior-season workload</p>` +
      kmChart("workloadKM", aw.workloadKm, WORKLOAD_TIERS.map((t) => ({ key: t, name: `${t} prior load`, color: WORKLOAD_COLORS[t] as string })), state, widths.half, 260, 40, "Weeks to first injury by prior-season workload") +
      `<div class="scin-chips">${aw.workloadStats.map((w) => `<span class="scin-chip"><span class="scin-pos" style="color:${WORKLOAD_COLORS[w.tier]}">${w.tier}</span><span>${w.injPct.toFixed(0)}% injured</span></span>`).join("")}</div></div>` +
      `</div>` +
      `<div class="scin-scroll scin-gap"><table class="scin-table is-framed"><thead><tr><th scope="col">Age (Q2 · severity if hurt)</th><th scope="col" class="is-right" title="Share of drafted players in this age group with a time-loss injury">Injured %</th><th scope="col" class="is-right" title="Mean games missed among the injured in this age group">Mean Games Missed</th><th scope="col" class="is-right" title="Share of injured missing 8+ games">% 8+ Games</th></tr></thead><tbody>` +
      aw.ageSeverity.map((a) => `<tr><td><span class="scin-pos" style="color:${AGE_COLORS[a.bucket]}">${escapeHtml(a.bucket)}</span></td><td class="is-right">${a.injPct.toFixed(0)}%</td><td class="is-right scin-strong">${a.meanGm.toFixed(1)}</td><td class="is-right">${a.p8.toFixed(0)}%</td></tr>`).join("") +
      `</tbody></table></div>` +
      `<div class="scin-gap"><p class="scin-eyebrow">Clean test · prior injury vs no known prior</p>` +
      note(`Restricted to <strong>fully observed careers</strong> (rookie year ≥ ${aw.priorClean.dataStart}), so "no prior injury" means no known prior injury across the player's full tracked career.`) +
      `<div class="scin-scroll"><table class="scin-table is-framed"><thead><tr><th scope="col"><span class="scin-sr">Group</span></th><th scope="col" class="is-right" title="Player-seasons in this group">Players</th><th scope="col" class="is-right" title="Share suffering a time-loss injury this season">Injured</th><th scope="col" class="is-right" title="Mean games missed among the injured">Avg. games missed</th><th scope="col" class="is-right" title="Share of injured missing 8+ games">Missed 8+</th></tr></thead><tbody>` +
      [
        ["No known prior injury", aw.priorClean.noPrior],
        ["≥1 prior injury", aw.priorClean.prior],
      ]
        .map(([k, g]) => {
          const gg = g as { n: number; injPct: number; meanGm: number; p8: number };
          return `<tr><td class="scin-strong">${escapeHtml(k as string)}</td><td class="is-right scin-muted">${n0(gg.n)}</td><td class="is-right scin-strong">${gg.injPct.toFixed(0)}%</td><td class="is-right">${gg.meanGm.toFixed(1)}</td><td class="is-right">${gg.p8.toFixed(0)}%</td></tr>`;
        })
        .join("") +
      `</tbody></table></div></div>` +
      calloutList(aw.callouts.map(boldText)) +
      `<p class="scin-body">Treat injury history as <strong>body-part-specific risk</strong>, not a blanket "injury-prone" label.</p></div>`;
  }

  // Q3: recurrence.
  const ABBR: Record<string, string> = { "Head/Neck": "Head", Shoulder: "Shld", "Arm/Hand": "Arm", "Chest/Core": "Core", "Hip/Groin": "Hip", Hamstring: "Ham", "Thigh/Quad": "Quad", Knee: "Knee", "Lower Leg": "L.Leg", "Ankle/Foot": "Ankle", "Other/Unknown": "Other" };
  const cellStyle = (c: { rr: number | null }) => {
    if (c.rr == null) return "background:#f8fafc;color:#cbd5e1";
    const inten = Math.min(Math.abs(Math.log(c.rr)) / (ip.matrix.maxAbsLog || 1), 1);
    const a = (0.08 + inten * 0.82).toFixed(3);
    const bg = c.rr >= 1 ? `rgba(166,8,8,${a})` : `rgba(37,99,235,${a})`;
    return `background:${bg};color:${inten > 0.5 ? "#fff" : "#334155"}`;
  };
  const recurHead =
    `<header class="scin-q-head">${eyebrow("Question 3 · Which injuries are most likely to recur?")}${h2("Which injuries are most likely to recur?")}</header>` +
    verdict("Prior injury is more predictive of where the next injury occurs than how severe it will be.", "Injury history is body-part-specific: recurrence clusters in the same region, most strongly head/neck, then knee and hamstring.") +
    `<div class="scin-tiles is-3">` +
    [
      ["Head/neck recurrence", ip.matrix.cells["Head/Neck"]?.["Head/Neck"]],
      ["Knee recurrence", ip.matrix.cells["Knee"]?.["Knee"]],
      ["Hamstring recurrence", ip.matrix.cells["Hamstring"]?.["Hamstring"]],
    ]
      .map(([label, c]) => {
        const cc = c as { rr: number | null } | undefined;
        return `<div class="scin-tile"><p class="scin-tile-k">${escapeHtml(label as string)}</p><p class="scin-tile-big">${cc?.rr == null ? "-" : `${cc.rr.toFixed(2)}×`}<span> baseline</span></p></div>`;
      })
      .join("") +
    `</div>` +
    `<p class="scin-body is-muted">Overall, a player's next injury lands in the same body region ${ip.obsSame.toFixed(0)}% of the time${ip.sameLift ? `, ${ip.sameLift.toFixed(2)}× what independence would predict` : ""}. The signal is same-body-part recurrence, not a blanket "injury-prone" tax.</p>`;
  const matrix =
    note(
      `Rows = prior injury region, columns = the player's next injury region (${n0(ip.transitions)} same-player transitions ≤3 seasons apart). Each cell = P(next=col | prior=row) ÷ P(next=col | prior≠row): <span class="scin-red">red &gt;1</span> elevated, <span class="scin-blue">blue &lt;1</span> suppressed, "·" = too few to estimate. The outlined diagonal is same-region recurrence.`,
    ) +
    `<div class="scin-scroll"><div class="scin-heat is-matrix" style="--scin-cols:${ip.matrix.regions.length}"><div class="scin-heat-head is-sticky">Prior ↓ / Next →</div>` +
    ip.matrix.regions.map((r) => `<div class="scin-heat-head" title="${escapeHtml(r)}">${escapeHtml(ABBR[r] || r)}</div>`).join("") +
    ip.matrix.regions
      .map(
        (A) =>
          `<div class="scin-heat-label is-sticky" title="${escapeHtml(A)}">${escapeHtml(A)}</div>` +
          ip.matrix.regions
            .map((B) => {
              const c = (ip.matrix.cells[A] as Record<string, { rr: number | null; n: number; denom: number }>)[B] as { rr: number | null; n: number; denom: number };
              return `<div class="scin-heat-cell${A === B ? " is-diag" : ""}" style="${cellStyle(c)}" title="${escapeHtml(`${A} → ${B}: ${c.rr == null ? "too few" : `${c.rr.toFixed(2)}× baseline`} (${c.n} of ${c.denom})`)}">${c.rr == null ? "·" : `${c.rr.toFixed(1)}×`}</div>`;
            })
            .join(""),
      )
      .join("") +
    `</div></div>`;
  const dynamics =
    `<div class="scin-grid2 is-rule">` +
    `<div>${h3("Does a healthy season reset the risk?")}${note(`Same-region recurrence by gap between injuries. Baseline under independence ≈ ${ip.expSamePct.toFixed(0)}%.`)}<div class="scin-bars">` +
    ip.sameByGap
      .map((g) => {
        const w = Math.min(100, (g.samePct / Math.max(1, ip.expSamePct)) * 33);
        return `<div class="scin-bar-row"><span class="scin-bar-label">${g.gap} season${g.gap > 1 ? "s" : ""} later</span><div class="scin-bar-track"><div class="scin-bar-fill" style="width:${Math.min(100, w).toFixed(1)}%"></div></div><span class="scin-bar-val">${g.samePct.toFixed(0)}% <span class="scin-muted">(n=${g.n})</span></span></div>`;
      })
      .join("") +
    `</div></div>` +
    `<div>${h3("Same-region recurrence by position")}${note("Share of a player's next injury that repeats the prior body region.")}<div class="scin-scroll"><table class="scin-table is-framed"><thead><tr><th scope="col">Position</th><th scope="col" class="is-right" title="Same-player injury transitions for this position">Transitions</th><th scope="col" class="is-right" title="Share whose next injury repeats the prior region">Same Region</th></tr></thead><tbody>` +
    ip.sameByPos.map((p) => `<tr><td>${posSpan(p.pos)}${p.n <= 20 ? smallSample() : ""}</td><td class="is-right scin-muted">${n0(p.n)}</td><td class="is-right scin-strong">${p.samePct.toFixed(0)}%</td></tr>`).join("") +
    `</tbody></table></div></div></div>`;
  const stays = `<div class="scin-block is-rule">${h3("What actually stays predictive, and how much to price in")}${calloutList(ip.callouts.map(boldText))}<p class="scin-body">${boldText(ip.calloutSummary)}</p></div>`;

  const recur = `<div id="q-recur" data-subtab="q-recur"${showRisk ? " hidden" : ""}>${recurHead}${fold("recur-matrix", "Detailed body-region transition matrix", matrix, state.open.includes("recur-matrix"))}${dynamics}${stays}</div>`;

  const scope = `<div class="scin-callout is-amber"><p class="scin-callout-eyebrow">Scope</p><p>Age and prior-season workload are modeled using matched snaps, touches, and age. Current-season snaps are excluded because injuries themselves reduce playing time.</p><p><strong>Still missing:</strong> routes run, contact vs. non-contact injury type, and clean identification of never-injured players. Height/weight/BMI are available but not yet included.</p></div>`;
  const fn = fantasyNote(
    ex.workloadSig
      ? `Do not apply a large blanket "injury-prone" penalty. Place more weight on heavy prior workload and specific body-part recurrence than on injury history alone.`
      : `Avoid large blanket penalties for age, workload, or prior injury. Put more weight on <strong>same-body-part recurrence</strong>, especially knee, hamstring, and head/neck injuries.`,
  );

  return `<section class="scin-q" id="q-risk" data-section="q-risk"${hidden}>${head}<div data-subtab="q-risk"${showRecur ? " hidden" : ""}>${kmPos}${sev}${awBlock}</div>${recur}${scope}${fn}</section>`;
}

/* ------------------------------------------------------ Q4: which matter */

export function renderMatter(ds: InjuryDataset, v: Views, state: DashState, widths: Widths): string {
  const tr = v.typeRisk;
  const hidden = state.tab === "q-matter" ? "" : " hidden";
  const table =
    `<div class="scin-scroll"><table class="scin-table is-framed is-nowrap"><thead class="is-navy"><tr>` +
    `<th scope="col" class="is-sticky">Injury</th><th scope="col" class="is-right" title="Episodes (time-loss)">n</th><th scope="col" class="is-right" title="Median games missed">Med GM</th><th scope="col" class="is-right" title="Probability of missing 8+ games">8+ %</th><th scope="col" class="is-right" title="Mean fantasy value-over-replacement lost per injury">VORP / inj</th><th scope="col" class="is-right" title="Post-return points/game vs the player's pre-injury baseline">Vs Baseline</th><th scope="col" class="is-right" title="Re-sidelined (Out/Doubtful/IR) within 8 weeks of returning">Reinjury 8wk</th><th scope="col" title="Most-affected position">Pos</th><th scope="col">Classification</th>` +
    `</tr></thead><tbody>` +
    tr.rows
      .map(
        (r) =>
          `<tr><td class="is-sticky scin-strong">${escapeHtml(r.type)}</td><td class="is-right scin-muted">${r.n}</td><td class="is-right">${r.medGM}</td><td class="is-right">${r.p8}%</td><td class="is-right scin-strong">${r.vorpEp}</td><td class="is-right">${r.ret == null ? "-" : `${Math.round(r.ret * 100)}%`}</td><td class="is-right">${r.rein8 == null ? "-" : `${r.rein8}%`}</td><td>${posSpan(r.topPos)}</td>` +
          `<td><span class="scin-class" style="background:${TYPE_CLASS_COLOR[r.cls]}">${escapeHtml(r.cls)}</span>${r.tags.map((t) => `<span class="scin-badge">${escapeHtml(t)}</span>`).join("")}</td></tr>`,
      )
      .join("") +
    `</tbody></table></div>`;
  return (
    `<section class="scin-q" id="q-matter" data-section="q-matter"${hidden}>` +
    qHeader(
      4,
      "Which injuries hurt fantasy teams most?",
      `Not just the injuries that cost the most total points. Each type is ranked by <strong>frequency × damage</strong>, using games missed, 8+ game risk, fantasy VORP lost, re-injury risk, and post-injury production. Injuries are also flagged for <strong>high recurrence</strong> or a <strong>lingering return</strong> when relevant.`,
    ) +
    verdict("The most important injuries combine frequency, missed time, recurrence, value lost, and diminished performance after return.", "Don't rank by total fantasy points lost; that mostly rewards common injuries and larger position samples. The classification below weighs all five dimensions.") +
    table +
    note(`<strong>Frequent &amp; damaging</strong> injuries like knee issues deserve the most caution. <strong>Frequent &amp; manageable</strong> injuries such as ankle and concussion are easier to absorb with normal depth, while <strong>rare but catastrophic</strong> injuries like quad/thigh issues can derail a season.`) +
    note(`<em>High recurrence</em> flags injuries that often return, while <em>Lingering return</em> marks injuries where production can stay depressed even after the player is active again.`) +
    `<div id="q-tag" class="scin-block is-rule">${eyebrow("Gameday · What does an injury-report tag cost that week?")}${h3("What does an injury-report tag cost that week?")}${renderTagImpact(ds.tagImpact, widths.full)}</div>` +
    fantasyNote(`The biggest concerns are injuries that stack multiple risks: <strong>knee</strong> for frequency, severity, and recurrence; <strong>hamstring</strong> for meaningful re-injury risk; and <strong>quad/thigh</strong> for poor post-return production and re-sidelining. Ankle injuries are common, but usually more manageable.`) +
    `<p class="scin-fine is-italic">Minimum 30 episodes; non-diagnostic "undisclosed" injuries excluded.</p>` +
    `</section>`
  );
}

/* --------------------------------------------------- injury type table */

export function renderInjuryTypeTable(v: Views, state: DashState): string {
  const rows = v.sortedInj;
  const other = v.display.other;
  const showMost = state.injuryPos === "all";
  const th = (label: string, key: string, right: boolean, title: string) => {
    const active = state.injSort.key === key;
    return `<th scope="col" class="${right ? "is-right" : ""}" title="${escapeHtml(title)}"${active ? ` aria-sort="${state.injSort.dir === "asc" ? "ascending" : "descending"}"` : ""}><button type="button" class="scin-sort${active ? " is-active" : ""}" data-inj-sort="${key}">${escapeHtml(label)}${sortIcon(active, state.injSort.dir)}</button></th>`;
  };
  const body = rows.length
    ? rows
        .map(
          (row) =>
            `<tr><td class="scin-strong is-nowrap">${escapeHtml(row.type)}${row.count <= SMALL_SAMPLE_MAX ? smallSample() : ""}</td><td><span class="scin-cat is-${row.category.toLowerCase().replace(/[^a-z]+/g, "-")}">${escapeHtml(row.category)}</span></td><td class="is-right">${n0(row.count)}</td><td class="is-right">${n1(row.avg_games_missed)}</td>` +
            `<td class="is-right scin-strong${v.injWorst.points === row.type ? " scin-red" : ""}">${n0(Math.abs(row.points_lost))}</td>` +
            `<td class="is-right">${v.injWorst.avg === row.type ? `<span class="scin-worst">${n1(Math.abs(row.avg_loss))}</span>` : n1(Math.abs(row.avg_loss))}</td>` +
            (showMost ? `<td class="is-right">${row.most_affected_pos.split(" / ").filter(Boolean).map(posSpan).join(" ")}</td>` : "") +
            `</tr>`,
        )
        .join("")
    : `<tr><td colspan="${showMost ? 7 : 6}" class="scin-empty-cell">No injuries match these filters.</td></tr>`;
  const otherRow = other
    ? `<tr class="is-other"><td class="is-nowrap">${escapeHtml(other.type)}</td><td><span class="scin-cat">${v.display.hiddenCount} additional types</span></td><td class="is-right">${n0(other.count)}</td><td class="is-right">${n1(other.avg_games_missed)}</td><td class="is-right scin-strong">${n0(Math.abs(other.points_lost))}</td><td class="is-right">${n1(Math.abs(other.avg_loss))}</td>${showMost ? `<td class="is-right scin-muted">-</td>` : ""}</tr>`
    : "";
  const toggle =
    v.visible.length > INJURY_TOP_N
      ? `<button type="button" class="scin-more" data-inj-toggle>${state.showAllInjuries ? "Show fewer injury types" : `View all ${v.visible.length} injury types`}</button>`
      : "";
  return (
    `<div class="scin-framed" data-inj-table><div class="scin-scroll is-tall"><table class="scin-table"><thead class="is-navy"><tr>` +
    th("Injury", "type", false, "Injury type") +
    th("Area", "category", false, "Body-area category") +
    th("Occurrences", "count", true, "Number of injuries of this type") +
    th("Avg Games Missed", "avg_games_missed", true, "Average games missed per injury of this type") +
    th("Fantasy Pts Lost", "points_lost", true, "Total estimated fantasy points lost") +
    th("Avg Pts Lost", "avg_loss", true, "Average fantasy points lost per injury") +
    (showMost ? th("Most Affected", "most_affected_pos", true, "Position(s) most affected by this injury type") : "") +
    `</tr></thead><tbody>${body}${otherRow}</tbody></table></div>${toggle}</div>`
  );
}

export function renderInjuryTypeSection(v: Views, state: DashState): string {
  const hidden = state.tab === "q-matter" ? "" : " hidden";
  const toolbar =
    `<div class="scin-toolbar">` +
    labeled("Area", select("inj-category", [{ value: "all", label: "All areas" }, ...v.categoryOptions.map((c) => ({ value: c, label: c }))], state.injuryCategory, "Area")) +
    labeled("Position", select("inj-pos", [{ value: "all", label: "All positions" }, ...v.posOptions.map((p) => ({ value: p, label: p }))], state.injuryPos, "Position")) +
    labeled(
      "Sort",
      select(
        "inj-sort-select",
        [
          { value: "impact", label: "Fantasy Impact" },
          { value: "occurrences", label: "Occurrences" },
          { value: "avgGames", label: "Avg Games Missed" },
          { value: "perInjury", label: "Avg Pts Lost" },
          { value: "name", label: "Injury (A-Z)" },
        ],
        injurySortValue(state.injSort),
        "Sort",
      ),
    ) +
    `<label class="scin-field is-search-inj"><span class="scin-field-label">Search injuries</span><input type="search" class="scin-input" placeholder="Search injuries…" value="${escapeHtml(state.injurySearch)}" data-inj-search aria-label="Search injuries" /></label>` +
    `</div>`;
  const empty = v.breakdown.length === 0 && !state.injurySearch && state.injuryCategory === "all";
  return (
    `<section class="scin-sec" data-section="injury-types"${hidden}>` +
    `<header class="scin-sec-head">${h2("Injury Impact by Type")}<p class="scin-q-intro">See which injuries occur most often, keep players out longest, and cause the greatest fantasy impact.</p></header>` +
    (empty ? `<p class="scin-empty">No injuries match the current filters.</p>` : toolbar + renderInjuryTypeTable(v, state)) +
    `</section>`
  );
}

/* ------------------------------------------------------- Q5: after return */

export function renderReturn(ds: InjuryDataset, v: Views, state: DashState): string {
  const pr = ds.postReturn;
  const timing = v.timing;
  const ex = v.exec;
  const hidden = state.tab === "q-return" ? "" : " hidden";
  const ratioPct = (x: number | null) => (x == null ? "-" : `${Math.round(x * 100)}%`);
  const verd = verdict(
    escapeHtml(`Returning players average ${pr?.overall?.median_return_ratio != null ? `${Math.round(pr.overall.median_return_ratio * 100)}%` : "most"} of their prior fantasy production during their first four games back.`),
    escapeHtml(`Active does not mean fully recovered: ${ex.retAll == null ? "many" : `${pr?.overall?.pct_below_80 ?? 45}% of`} returns come back below 80% of baseline, and the drop is steepest at RB.`),
  );
  const hero =
    ex.retAll != null
      ? `<div class="scin-hero-stat"><div><p class="scin-hero-num">${Math.round(ex.retAll * 100)}%</p><p class="scin-hero-sub">of prior production in the first four games back</p></div><ul class="scin-hero-list"><li><strong>${pr?.overall?.pct_below_80 ?? "-"}%</strong> returned below 80% of baseline</li><li>RBs returned at <strong>${ex.retRB == null ? "-" : `${Math.round(ex.retRB * 100)}%`}</strong>; QBs at <strong>${ex.retQB == null ? "-" : `${Math.round(ex.retQB * 100)}%`}</strong></li></ul></div>`
      : "";
  const recoveryTable = (rows: PostReturnGroup[], head: string, colorByPos: boolean) =>
    `<div class="scin-scroll"><table class="scin-table is-framed"><thead><tr><th scope="col">${escapeHtml(head)}</th><th scope="col" class="is-right" title="Injury episodes with usable weekly data">n</th><th scope="col" class="is-right" title="Share who played again the same season">Returned</th><th scope="col" class="is-right" title="Median post-return points/game as a share of the player's pre-injury baseline (first 4 games back)">Vs Baseline</th><th scope="col" class="is-right" title="Share returning below 80% of their pre-injury production">Came Back &lt;80%</th><th scope="col" class="is-right" title="Share sidelined again (Out/Doubtful/IR) within 8 weeks of returning">Reinjury 8wk</th></tr></thead><tbody>` +
    rows
      .map(
        (r) =>
          `<tr><td>${colorByPos ? posSpan(r.key ?? "") : `<span class="scin-strong">${escapeHtml(r.key ?? "")}</span>`}</td><td class="is-right scin-muted">${r.episodes}</td><td class="is-right">${r.returned_pct == null ? "-" : `${r.returned_pct}%`}</td><td class="is-right scin-strong">${ratioPct(r.median_return_ratio)}</td><td class="is-right">${r.pct_below_80 == null ? "-" : `${r.pct_below_80}%`}</td><td class="is-right">${r.reinjury_8wk == null ? "-" : `${r.reinjury_8wk}%`}</td></tr>`,
      )
      .join("") +
    `</tbody></table></div>`;
  const parts: string[] = [];
  if (pr) {
    parts.push(
      `<div class="scin-block">${h3("Post-return performance: the injury keeps costing after the return")}` +
        note(
          `Across ${n0(pr.overall.n_with_baseline)} injuries with a clean pre-injury baseline, returning players average <strong>${ratioPct(pr.overall.median_return_ratio)}</strong> of their prior points/game in the first ${pr.meta.post_window_games} games back, and <strong>${pr.overall.pct_below_80}%</strong> come back below 80%. Reinjury = a new Out/Doubtful/IR report within N weeks (from the weekly report feed, so byes don't inflate it).`,
        ) +
        `<div class="scin-grid2"><div><p class="scin-eyebrow">By position (worst recovery first)</p>${recoveryTable(pr.byPosition, "Position", true)}</div><div><p class="scin-eyebrow">By body region (worst recovery first)</p>${recoveryTable(pr.byRegion, "Region", false)}</div></div></div>`,
    );
  }
  if (timing.totalInj > 0) {
    const ph = timing.phase;
    parts.push(
      `<div class="scin-block is-rule">${h3("Injury timing: a Week-2 injury and a Week-16 injury are not equal")}` +
        note(
          `When injuries strike (by week of injury): <strong>${Math.round((ph.early / timing.totalInj) * 100)}%</strong> Weeks 1-6, <strong>${Math.round((ph.mid / timing.totalInj) * 100)}%</strong> Weeks 7-13, <strong>${Math.round((ph.late / timing.totalInj) * 100)}%</strong> Weeks 14-17. A player injured in week W missing G games is treated as out through week W+G-1, so it reaches the fantasy playoffs (Weeks 15-17) when that lands at Week 15 or later. G counts regular-season games only; NFL-playoff-only injuries are left out.`,
        ) +
        `<div class="scin-scroll"><table class="scin-table is-framed"><thead><tr><th scope="col">Position</th><th scope="col" class="is-right" title="Injury episodes">Injuries</th><th scope="col" class="is-right" title="Share of drafted players at this position who miss at least one fantasy-playoff week (15-17) to injury">Miss a Playoff Wk</th><th scope="col" class="is-right" title="Share of this position's injuries whose absence reaches the fantasy playoffs">Injuries Reaching Playoffs</th><th scope="col" class="is-right" title="Average share of the REMAINING season (from injury week to Week 17) lost to the injury">Avg % Rest-of-Season Lost</th></tr></thead><tbody>` +
        timing.byPos.map((r) => `<tr><td>${posSpan(r.pos)}</td><td class="is-right scin-muted">${n0(r.injuries)}</td><td class="is-right scin-strong">${r.playoffMissRate == null ? "-" : `${r.playoffMissRate.toFixed(0)}%`}</td><td class="is-right">${r.pctHitPlayoffs.toFixed(0)}%</td><td class="is-right">${r.avgRemPct.toFixed(0)}%</td></tr>`).join("") +
        `</tbody></table></div></div>`,
    );
  }
  const take: string[] = [];
  if (pr) {
    const first = pr.byPosition[0];
    take.push(
      `<strong>Returning doesn't mean recovered.</strong> Players return at about <strong>${Math.round((pr.overall.median_return_ratio ?? 0) * 100)}% of prior production</strong>, and ${pr.overall.pct_below_80}% come back below 80% of baseline.${first ? ` ${escapeHtml(first.key ?? "")}s recover worst at roughly <strong>${Math.round((first.median_return_ratio ?? 0) * 100)}%</strong>.` : ""}`,
    );
    const worstRein = [...pr.byRegion].sort((a, b) => (b.reinjury_8wk ?? 0) - (a.reinjury_8wk ?? 0))[0];
    if (worstRein) {
      take.push(
        `<strong>Some injuries linger.</strong> ${worstRein.key === "Hamstring" ? "Hamstrings have" : `${escapeHtml(worstRein.key ?? "")} injuries have`} about a <strong>${worstRein.reinjury_8wk}% re-sidelining rate within 8 weeks</strong>, while thigh/quad and lower-leg injuries show some of the weakest post-return production.`,
      );
    }
  }
  if (timing.worstPlayoff) {
    const wp = timing.worstPlayoff;
    take.push(
      `<strong>Timing matters.</strong> ${posText(wp.pos, `${wp.pos}s`)} miss a fantasy-playoff week <strong>${wp.playoffMissRate?.toFixed(0)}%</strong> of the time and lose about <strong>${wp.avgRemPct.toFixed(0)}% of the season remaining when injured</strong>. A Week 3 injury and Week 16 injury should not be treated the same.`,
    );
  }
  return (
    `<section class="scin-q" id="q-return" data-section="q-return"${hidden}>` +
    qHeader(
      5,
      "What happens after a player returns?",
      `"Did they return" isn't the same as "are they the same player." Recovery compares each player's first 4 games back to their <em>own</em> pre-injury baseline (PPR points/game); timing asks how much of the season, and how many fantasy-playoff weeks, the injury actually costs. Post-return is matched over all seasons; timing is from the injury log.`,
    ) +
    verd +
    hero +
    (parts.length ? parts.join("") : `<p class="scin-empty">The post-return study is not available.</p>`) +
    (take.length ? calloutList(take) : "") +
    fantasyNote(`Treat recently activated players as <strong>partially recovered</strong>, especially RBs and players returning from hamstring, thigh/quad, lower-leg, ankle, or knee injuries.`) +
    `</section>`
  );
}

/* ------------------------------------------------------- Q6: how to draft */

export function renderDraft(v: Views, state: DashState, widths: Widths): string {
  const dcr = v.dcr;
  const hidden = state.tab === "q-draft" ? "" : " hidden";
  const pctFmt = (x: number | null) => (x == null ? "-" : `${(x * 100).toFixed(0)}%`);
  const num1 = (x: number | null) => (x == null ? "-" : n1(x));
  const num0 = (x: number | null) => (x == null ? "-" : n0(x));
  let body: string;
  if (dcr.rows.length === 0) {
    body = `<p class="scin-empty">No drafted players match the current filters.</p>`;
  } else {
    const cards: string[] = [];
    if (dcr.mostFragile) {
      cards.push(`<div class="scin-callout is-red"><p class="scin-callout-eyebrow">Highest Fragility Tax</p><p class="scin-callout-title">${posSpan(dcr.mostFragile.pos)} · ${escapeHtml(dcr.mostFragile.bucket)}</p><p class="scin-fine">Injuries erase about <strong>${pctFmt(dcr.mostFragile.fragility)} of value over replacement</strong>, the largest penalty on the board.</p></div>`);
    }
    if (dcr.topKiller) {
      cards.push(`<div class="scin-callout is-amber"><p class="scin-callout-eyebrow">Most Season-Killing Slot</p><p class="scin-callout-title">${posSpan(dcr.topKiller.pos)} · ${escapeHtml(dcr.topKiller.bucket)}</p><p class="scin-fine">About <strong>${pctFmt(dcr.topKiller.pKiller)}</strong> miss 8+ games and finish below replacement.</p></div>`);
    }
    if (dcr.bestValue) {
      cards.push(`<div class="scin-callout is-green"><p class="scin-callout-eyebrow">Best Injury-Adjusted Value</p><p class="scin-callout-title">${posSpan(dcr.bestValue.pos)} · ${escapeHtml(dcr.bestValue.bucket)}</p><p class="scin-fine">Retains the most value after injury risk: <strong>~${num0(dcr.bestValue.injAdjVorp)} points over replacement</strong>.</p></div>`);
    }
    const table =
      `<div class="scin-scroll"><table class="scin-table is-framed is-nowrap"><thead class="is-navy"><tr>` +
      `<th scope="col" class="is-sticky">Draft Slot</th><th scope="col" class="is-right" title="Drafted player-seasons in this position + bucket: the exposure denominator">Sample</th><th scope="col" class="is-right" title="Probability a drafted pick misses at least one game to injury">Miss 1+</th><th scope="col" class="is-right" title="Probability a drafted pick misses 2 or more games">Miss 2+</th><th scope="col" class="is-right" title="Probability a drafted pick misses 4 or more games">Miss 4+</th><th scope="col" class="is-right" title="Probability a drafted pick misses 8 or more games (roughly half the season)">Miss 8+</th>` +
      `<th scope="col" class="is-right" title="Expected games missed per drafted pick (non-injured count as 0)">Exp. Games</th><th scope="col" class="is-right" title="Expected fantasy points lost to injury per drafted pick">Exp. Pts Lost</th><th scope="col" class="is-right" title="Expected value-over-replacement lost to injury per drafted pick">Exp. VORP Lost</th><th scope="col" class="is-right" title="Probability a drafted pick finishes below replacement level after an injury (injury-driven bust rate)">Below Repl.</th><th scope="col" class="is-right" title="Probability of a season-killing selection: a genuine starter that missed 8+ regular-season games AND still finished below replacement">Season-Killer</th><th scope="col" class="is-right" title="What % of the value you buy at this slot is historically erased by injury: expected VORP lost ÷ draft-cost VORP">Fragility Tax</th>` +
      `</tr></thead><tbody>` +
      POS4.map((pos) => {
        const posRows = dcr.rows.filter((r) => r.pos === pos);
        if (!posRows.length) return "";
        return (
          `<tr class="is-group"><td colspan="12" class="is-sticky">${posSpan(pos)}</td></tr>` +
          posRows
            .map((r) => {
              const isFragileWorst = dcr.mostFragile === r;
              const isKillerWorst = dcr.topKiller === r;
              return (
                `<tr><td class="is-sticky ${r.exploratory ? "scin-muted" : "scin-strong"}">${escapeHtml(r.bucket)}${r.exploratory ? `<span class="scin-badge" title="Fewer than ${dcr.minDisplay} player-seasons: exploratory only, excluded from the frontier and headline takeaways">exploratory</span>` : ""}</td>` +
                `<td class="is-right scin-muted">${n0(r.drafted)}</td><td class="is-right">${pctFmt(r.pMiss1)}</td><td class="is-right">${pctFmt(r.pMiss2)}</td><td class="is-right">${pctFmt(r.pMiss4)}</td><td class="is-right">${pctFmt(r.pMiss8)}</td><td class="is-right">${num1(r.eGames)}</td><td class="is-right">${num0(r.ePts)}</td><td class="is-right scin-strong">${num1(r.eVorpLost)}</td><td class="is-right">${pctFmt(r.pBelow)}</td>` +
                `<td class="is-right scin-strong${isKillerWorst ? " scin-red" : ""}">${pctFmt(r.pKiller)}</td><td class="is-right">${r.fragility == null ? `<span class="scin-muted">-</span>` : isFragileWorst ? `<span class="scin-worst">${pctFmt(r.fragility)}</span>` : `<span class="scin-strong">${pctFmt(r.fragility)}</span>`}</td></tr>`
              );
            })
            .join("")
        );
      }).join("") +
      `</tbody></table></div>`;
    const fpoints = dcr.frontier.map((f) => ({
      x: Math.round(f.injAdjVorp * 10) / 10,
      y: Math.round((f.pKiller ?? 0) * 1000) / 10,
      z: 181 - (f.lo + f.hi) / 2,
      label: `${f.pos} ${f.round}`,
      color: posColor(f.pos),
      series: f.pos,
      tip:
        `<div class="scin-tip-title" style="color:${posColor(f.pos)}">${escapeHtml(`${f.pos} · ${f.bucket}`)}</div>` +
        `<div class="scin-tip-line">Injury-adjusted VORP: <strong>${f.injAdjVorp.toFixed(1)}</strong></div><div class="scin-tip-line">Season-killer prob: <strong>${((f.pKiller ?? 0) * 100).toFixed(1)}%</strong></div><div class="scin-tip-line">Draft-cost VORP: ${f.draftCostVorp.toFixed(1)}</div><div class="scin-tip-line">Expected VORP lost: ${f.eVorpLost == null ? "-" : f.eVorpLost.toFixed(1)}</div><div class="scin-tip-line">Fragility tax: ${f.fragility == null ? "-" : `${(f.fragility * 100).toFixed(0)}%`}</div><div class="scin-tip-line scin-muted">${f.drafted} drafted</div>`,
    }));
    const frontier =
      `<div class="scin-block is-rule">${h3("Risk / Reward Frontier")}<div class="scin-note"><p>Each point represents a position × round with at least ${dcr.minDisplay} player-seasons.</p><ul class="scin-list"><li><strong>X-axis:</strong> injury-adjusted value over replacement; higher is better</li><li><strong>Y-axis:</strong> season-killing risk; lower is better</li><li><strong>Point size:</strong> draft cost; earlier picks are larger</li></ul><p>A point is <strong>dominated</strong> when another slot in the same cost tier offers more value with less downside.</p></div>` +
      (dcr.frontier.length === 0
        ? `<p class="scin-empty">Not enough sample in any slot to chart a frontier for this filter.</p>`
        : renderScatter({
            id: "frontier",
            points: fpoints,
            groups: POS4.map((p) => ({ key: p, name: p, color: POS_COLORS[p] as string, hidden: isHidden(state, "frontier", p) })),
            width: widths.full,
            height: 440,
            xFormat: (x) => `${x}`,
            yFormat: (x) => `${x}%`,
            xLabel: "Injury-adjusted VORP (higher is better)",
            yLabel: "Severe downside (season-killer %)",
            radius: [6, 16],
            ariaLabel: "Risk and reward frontier by position and draft slot",
          })) +
      `</div>`;
    body =
      (cards.length ? `<div class="scin-callout-grid">${cards.join("")}</div>` : "") +
      table +
      note(`<strong>Fragility Tax</strong> = the share of value over replacement historically lost to injury at that draft slot.`) +
      note(`Slots with fewer than <strong>${dcr.minDisplay} player-seasons</strong> are <span class="scin-badge">exploratory</span>; headlines require at least <strong>${dcr.minTakeaway}</strong>. A "-" means the slot sits near replacement value, leaving little excess value for injury to erase.`) +
      frontier;
  }
  return (
    `<section class="scin-q" id="q-draft" data-section="q-draft"${hidden}>` +
    qHeader(6, "How should injury risk affect draft decisions?", `What matters is <strong>value lost over replacement</strong>, not injury frequency alone. Losing an 18-point RB when his replacement scores 9 hurts far more than losing an 8-point TE with a 7-point replacement.`) +
    verdict("Price injury risk by how much drafted value it can erase.") +
    body +
    fantasyNote(`Early RBs carry greater severe injury downside, but injury risk alone does not decide whether they are good picks. Second-round WRs have historically retained strong injury-adjusted value, while mid-round RB and TE investments can lose a larger share of the value being purchased. This measures the injury component of draft cost; the separate Redraft Strategy Analysis determines which complete strategies won.`) +
    `</section>`
  );
}

/* ----------------------------------------------------- always-on sections */

export function renderOutcomes(v: Views): string {
  const o = v.outcomes;
  const inc = (x: number | null) => (x == null ? "-" : n2(x));
  const LABELS: Record<string, string> = { snaps: "snaps", routes: "routes", touches: "touches", targets: "targets", pass_attempts: "pass att", kickoff_returns: "KO ret" };
  const metrics = ["snaps", "routes", "touches", "targets", "pass_attempts", "kickoff_returns"].filter((k) => o.rows.some((r) => r.per1k[k]));
  const main =
    `<div class="scin-scroll"><table class="scin-table is-plain"><thead><tr><th scope="col">Position</th><th scope="col" class="is-right" title="Drafted player-seasons in the selected ADP range: the exposure denominator">Players</th><th scope="col" class="is-right" title="Injury episodes that cost 1+ games ÷ exposure (the source is time-loss only, so this also equals overall injury incidence)">Time-Loss Incidence</th><th scope="col" class="is-right" title="Total games missed ÷ exposure (games missed per drafted player-season)">Injury Burden</th><th scope="col" class="is-right" title="Sum of (expected minus replacement) fantasy points across episodes">Fantasy Burden</th></tr></thead><tbody>` +
    [...o.rows, o.total]
      .map((r) => {
        const isTotal = r.position === "All";
        return `<tr${isTotal ? ' class="is-total"' : ""}><td>${isTotal ? `<span class="scin-pos" style="color:${CHART_COLORS.slate}">All</span>` : posSpan(r.position)}</td><td class="is-right">${n0(r.exposure)}</td><td class="is-right">${inc(r.timeLossIncidence)}</td><td class="is-right">${r.injuryBurden == null ? "-" : n1(r.injuryBurden)}</td><td class="is-right">${n0(r.fantasyBurden)}</td></tr>`;
      })
      .join("") +
    `</tbody></table></div>`;
  const exposure = o.hasExposure
    ? `<div class="scin-block is-rule"><p class="scin-eyebrow">Exposure-normalized rates (per 1,000)</p>` +
      note(`Use <strong>per 1,000 snaps</strong> for cross-position comparisons because snaps are the common exposure across every position.`) +
      note(`Per-touch and per-pass-attempt rates are best used <strong>within positions only</strong>. Carries and targets don't capture all injury exposure, so they shouldn't be used to call one position "safer" than another.`) +
      `<div class="scin-scroll"><table class="scin-table is-plain"><thead><tr><th scope="col">Position</th>` +
      metrics.map((k) => `<th scope="col" class="is-right" title="Injury episodes per 1,000 ${LABELS[k]}">Inj / 1k ${LABELS[k]}</th>`).join("") +
      metrics.map((k) => `<th scope="col" class="is-right" title="Games missed per 1,000 ${LABELS[k]}">GM / 1k ${LABELS[k]}</th>`).join("") +
      `</tr></thead><tbody>` +
      o.rows.map((r) => `<tr><td>${posSpan(r.position)}</td>${metrics.map((k) => `<td class="is-right">${r.per1k[k] ? n2(r.per1k[k]?.inj) : "-"}</td>`).join("")}${metrics.map((k) => `<td class="is-right">${r.per1k[k] ? n2(r.per1k[k]?.gm) : "-"}</td>`).join("")}</tr>`).join("") +
      `</tbody></table></div></div>`
    : note(`Per-1,000-exposure rates (snaps, routes, touches, pass attempts, kickoff returns) appear here once the exposure file is supplied.`);
  return (
    `<section class="scin-sec" data-section="outcomes"><header class="scin-sec-head">${h2("Injury Risk Outcomes")}<p class="scin-q-intro">Risk is measured by <strong>injury episodes relative to drafted player-seasons</strong> in the selected ADP range. Each episode is one player-season injury, not a weekly report entry. The source only includes injuries that caused at least one missed game, so minor non-time-loss injuries are not included.</p></header>` +
    main +
    exposure +
    `</section>`
  );
}

export function renderPositionTable(rows: PositionImpactRow[], sort: SortState): string {
  const th = (label: string, key: string, right: boolean, title: string) => {
    const active = sort.key === key;
    return `<th scope="col" class="${right ? "is-right" : ""}" title="${escapeHtml(title)}"${active ? ` aria-sort="${sort.dir === "asc" ? "ascending" : "descending"}"` : ""}><button type="button" class="scin-sort${active ? " is-active" : ""}" data-pos-sort="${key}">${escapeHtml(label)}${sortIcon(active, sort.dir)}</button></th>`;
  };
  return (
    `<div class="scin-framed" data-pos-table><div class="scin-scroll"><table class="scin-table"><thead class="is-navy"><tr>` +
    th("Position", "position", false, "Position") +
    th("Player Sample", "total_drafted", true, "Players drafted at this position within the selected ADP range: the sample the rates are measured against") +
    th("Injured Players", "players_injured", true, "Distinct injured player-seasons (a player hurt in two seasons counts once per season)") +
    th("Injury Rate", "injury_rate", true, "Injured player-seasons divided by drafted player-seasons at this position in the selected ADP range") +
    th("Games Missed", "games_missed", true, "Total games missed (regular season + playoffs)") +
    th("Games Missed %", "pct_games_missed", true, "Regular-season games missed as a share of all possible games across the drafted pool (drafted players × 17)") +
    th("Severe Injury %", "severe_rate", true, "Share of injuries labeled Severe") +
    `</tr></thead><tbody>` +
    rows
      .map(
        (row) =>
          `<tr><td>${posSpan(row.position)}${row.injuries <= SMALL_SAMPLE_MAX ? smallSample() : ""}</td><td class="is-right">${n0(row.total_drafted)}</td><td class="is-right">${n0(row.players_injured)}</td><td class="is-right">${row.injury_rate == null ? "-" : `${row.injury_rate}%`}</td><td class="is-right">${n0(row.games_missed)}</td><td class="is-right">${row.pct_games_missed}%</td><td class="is-right">${row.severe_rate}%</td></tr>`,
      )
      .join("") +
    `</tbody></table></div></div>`
  );
}

export function renderPositionSection(v: Views, state: DashState): string {
  return (
    `<section class="scin-sec" data-section="positions"><header class="scin-sec-head">${h2("Injury Impact by Position")}<p class="scin-q-intro">Compare injury frequency, time missed, and fantasy production lost across positions.</p></header>` +
    (v.posImpact.length === 0 ? `<p class="scin-empty">No injuries match the current filters.</p>` : renderPositionTable(v.sortedPos, state.posSort)) +
    `</section>`
  );
}

function posSeries(rows: { season: string; [k: string]: number | string }[], chart: string, state: DashState): { key: string; name: string; color: string; values: number[]; hidden: boolean }[] {
  return POS4.map((p) => ({ key: p, name: p, color: POS_COLORS[p] as string, values: rows.map((r) => Number(r[p] ?? 0)), hidden: isHidden(state, chart, p) }));
}

export function renderAdditionalTrends(v: Views, state: DashState, widths: Widths): string {
  const ms = v.multiSeason;
  const cats1 = v.chart1.map((r) => r.season);
  const cats2 = v.chart2.map((r) => r.season);
  const catsA = v.avgGames.map((r) => r.season);
  const catsR = v.injuryRate.map((r) => r.season);
  const tierColors: Record<string, string> = { Elite: CHART_COLORS.navy, Early: CHART_COLORS.blue, Mid: CHART_COLORS.purple, Late: CHART_COLORS.gold, Deep: CHART_COLORS.slate };
  const body =
    `<div class="scin-grid2">` +
    `<div class="scin-mini">${h3(`Games Missed by Position${ms ? " per Year" : ""}`)}${renderBarChart({ id: "gamesMissed", categories: cats1, series: posSeries(v.chart1, "gamesMissed", state), width: widths.half, height: 300, yFormat: (x) => `${x}`, ariaLabel: "Games missed by position per year" })}</div>` +
    `<div class="scin-mini">${h3(`Injuries by ADP Tier${ms ? " per Season" : ""}`)}${renderBarChart({ id: "adpTier", categories: cats2, series: ADP_TIERS.map((t) => ({ key: t, name: t, color: tierColors[t] as string, values: v.chart2.map((r) => Number(r[t] ?? 0)), hidden: isHidden(state, "adpTier", t) })), stacked: true, maxBarSize: 50, width: widths.half, height: 300, yFormat: (x) => `${x}`, ariaLabel: "Injuries by ADP tier per season" })}</div>` +
    `<div class="scin-mini">${h3(`Avg Games Missed per Drafted Player by Position${ms ? " Each Year" : ""}`)}${renderLineChart({ id: "gamesMissedLine", categories: catsA, series: posSeries(v.avgGames, "gamesMissedLine", state).map((s) => ({ ...s, width: 3, dots: true })), width: widths.half, height: 300, yFormat: (x) => `${x}`, ariaLabel: "Average games missed per drafted player by position" })}</div>` +
    `<div class="scin-mini">${h3(`% Players Injured${ms ? " YoY" : ""} by Position`)}${renderLineChart({ id: "injuryRate", categories: catsR, series: posSeries(v.injuryRate, "injuryRate", state).map((s) => ({ ...s, width: 3, dots: true })), width: widths.half, height: 300, yFormat: (x) => `${x}%`, tipFormat: (x) => `${x.toFixed(1)}%`, ariaLabel: "Share of drafted players injured by position" })}</div>` +
    `</div>`;
  return `<section class="scin-sec" data-section="additional">${fold("additional-trends", "Additional Trends", body, state.open.includes("additional-trends"), "Raw by-position and by-tier yearly charts: supporting detail for the questions above.")}</section>`;
}

/**
 * Collapsed by default and drawn only once opened: 1,200 points with a
 * read-out each are 900 KB of markup the app itself demoted to "kept for
 * validation". The bundle draws it on the fold's first open.
 */
export function renderAdpScatter(v: Views, state: DashState, widths: Widths): string {
  const open = state.open.includes("adp-scatter");
  const body = open ? renderAdpScatterChart(v, state, widths) : `<p class="scin-empty" data-lazy="adp-scatter">Drawing the scatter…</p>`;
  return `<section class="scin-sec" data-section="adp-scatter">${fold("adp-scatter", "ADP vs Games Missed (detail)", body, open, "Raw scatter of every injured player: mostly noise, little ADP relationship. For draft decisions use the risk/reward frontier in the draft-capital section above; this is kept collapsed for validation.")}</section>`;
}

export function renderAdpScatterChart(v: Views, state: DashState, widths: Widths): string {
  const pts = v.scatter.map((d) => ({
    x: d.adp,
    y: d.games_missed,
    z: d.points_lost,
    color: posColor(d.position),
    series: d.position,
    tip: tipHtml(`${d.name} (${d.position})`, [
      { name: "ADP", value: `${d.adp}` },
      { name: "Games Missed", value: `${d.games_missed}` },
      { name: "Est. Points Lost", value: d.points_lost.toFixed(1) },
    ]),
  }));
  return renderScatter({
    id: "adpScatter",
    points: pts,
    groups: POS4.map((p) => ({ key: p, name: p, color: POS_COLORS[p] as string, hidden: isHidden(state, "adpScatter", p) })),
    width: widths.full,
    height: 400,
    xDomain: [1, Math.max(ADP_MAX, ...pts.map((p) => p.x))],
    xFormat: (x) => `${x}`,
    yFormat: (x) => `${x}`,
    xLabel: "ADP",
    yLabel: "Games Missed",
    radius: [3, 10],
    ariaLabel: "ADP against games missed, one point per injury",
  });
}

export function renderFinalSummary(v: Views): string {
  const items = FINAL_SUMMARY.map((c, i) => (i === 1 && !v.exec.workloadSig ? "Neither age nor prior workload strongly predicts who gets hurt." : c));
  return (
    `<section class="scin-sec" id="final-summary" data-section="final"><header class="scin-sec-head">${h2("What This Means for Fantasy Managers")}<p class="scin-q-intro">The durable takeaways, in one place: how to price injury risk into player, position, and draft-slot decisions.</p></header>` +
    calloutList(items.map(escapeHtml)) +
    `</section>`
  );
}

export function renderHowToUse(): string {
  return (
    `<section class="scin-sec" data-section="how"><header class="scin-sec-head">${h2("How to Use This with Strategy Research")}</header>` +
    `<div class="scin-fantasy"><p class="scin-fantasy-body">This dashboard measures the <strong>injury risk tied to players, positions, and draft slots</strong>. It does not tell you which full draft strategies win.</p><p class="scin-fantasy-body">Use observed fantasy-team results to judge strategy performance; use this dashboard to understand the injury downside behind those choices.</p></div>` +
    `</section>`
  );
}

/**
 * Collapsed by default and drawn only once opened, like the scatter: seven
 * charts and a table for nine strategies are 200 KB the reader asked for by
 * opening the fold. The bundle fetches /data/sim then and draws it.
 */
export function renderExperimentalSim(ds: InjuryDataset, state: DashState, widths: Widths): string {
  if (!ds.draftSim) return "";
  const open = state.open.includes("experimental-sim");
  const body =
    `<div class="scin-callout is-amber"><p>This simulation isolates selected injury and replacement assumptions. It is not a ranking of real-world draft strategies and should not override results from observed fantasy-team data.</p></div>` +
    (open ? renderDraftSim(ds.draftSim, state.sim, widths, state.open.includes("sim-how")) : `<p class="scin-empty" data-lazy="experimental-sim">Loading the simulation…</p>`);
  return `<section class="scin-sec" data-section="sim">${fold("experimental-sim", "Experimental Injury-Only Draft Simulation", body, open, "Collapsed by default · isolated injury/replacement assumptions · not a real-world strategy ranking.")}</section>`;
}

export function renderMethodology(ds: InjuryDataset, state: DashState): string {
  const m = ds.analysis.meta.methodology;
  const card = (title: string, body: string) => `<div class="scin-method-card"><h4>${escapeHtml(title)}</h4><p>${body}</p></div>`;
  const text = (t: string) => escapeHtml(houseText(t));
  const body =
    `<div class="scin-method-grid">` +
    card("Injury Data Source", `${text(m.injury_data_source)} Games missed include the team's playoff games; fantasy-value figures (points lost, VORP, % of the 17-game season) use regular-season games only.`) +
    card("ADP Data Source", text(m.adp_data_source)) +
    card("Player Matching", text(m.player_matching)) +
    card("Points Lost Estimation", text(m.points_lost_estimation)) +
    card("Replacement Value", text(m.replacement_value)) +
    card("ADP Tiers", text(m.adp_tiers)) +
    card("Impact Labels", text(m.impact_labels)) +
    `</div>` +
    (m.limitations ? `<div class="scin-method-card is-amber"><h4>Limitations</h4><ul class="scin-list">${m.limitations.map((l) => `<li>${text(l)}</li>`).join("")}</ul></div>` : "") +
    `<div class="scin-method-card"><h4>Rule-Change Limitations</h4><ul class="scin-list">${RULE_CHANGE_CAVEAT.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul></div>` +
    `<div class="scin-method-grid is-3">` +
    card("Fantasy VORP", "Value over replacement: a player's expected fantasy points minus a waiver-level replacement starter at the same draft slot. Losing an early-round starter who sits well above replacement costs far more than losing a late flier already near replacement.") +
    card("Season-Killer", "A genuine starter (real value over replacement) that missed 8+ games <em>and</em> still finished below a waiver-level replacement: a selection whose cost was effectively wasted by injury.") +
    card("Fragility Tax", "The share of the value-over-replacement you buy at a draft slot that injury historically erases: expected VORP lost ÷ draft-cost VORP. Slots at about replacement value have little to erode, so their tax is undefined.") +
    `</div>`;
  return `<section class="scin-sec" data-section="methodology">${fold("methodology", "Methodology & Definitions", body, state.open.includes("methodology"))}</section>`;
}

/* ------------------------------------------------------------------ page */

/** The sections under the filter bar, in the app's visual order. */
export function renderMain(ds: InjuryDataset, v: Views, state: DashState, widths: Widths): string {
  return (
    renderSafer(ds, v, state, widths) +
    renderRisk(v, state, widths) +
    renderMatter(ds, v, state, widths) +
    renderInjuryTypeSection(v, state) +
    renderReturn(ds, v, state) +
    renderDraft(v, state, widths) +
    renderFinalSummary(v) +
    renderHowToUse() +
    renderOutcomes(v) +
    renderPositionSection(v, state) +
    renderAdditionalTrends(v, state, widths) +
    renderAdpScatter(v, state, widths) +
    renderExperimentalSim(ds, state, widths) +
    renderMethodology(ds, state)
  );
}

/** The whole dashboard at one state: what the server sends. */
/**
 * The dashboard as its own page. The server composes the seven-tab tool
 * instead (render-tool.ts, which takes the pieces above); this is the
 * standalone arrangement, kept for the Impact study on its own.
 */
export function renderInjuryPage(ds: InjuryDataset, v: Views, state: DashState, options: InjuryRenderOptions = {}, widths: Widths = DEFAULT_WIDTHS): string {
  const assets = options.assets ?? EMPTY_ASSETS;
  return (
    `<div class="scin${options.embed ? " is-embed" : ""}" data-scin-root="1" data-scin-page="analysis" data-scin-tab="${state.tab}"` +
    (options.dataUrl ? ` data-scin-data="${escapeHtml(options.dataUrl)}"` : "") +
    ` data-scin-assets="${escapeHtml(assets.origin)}"` +
    (options.siblingUrl ? ` data-scin-sibling="${escapeHtml(options.siblingUrl)}"` : "") +
    `>` +
    renderHeader(options) +
    renderExecSummary(v) +
    renderTabs(state.tab) +
    renderFilterBar(state.filters, v.seasonOptions) +
    `<div class="scin-main" data-scin-main>${renderMain(ds, v, state, widths)}</div>` +
    (options.siblingUrl ? `<p class="scin-cross">Looking for one player's full injury history? Open the <a href="${escapeHtml(options.siblingUrl)}">NFL Injury Database</a>.</p>` : "") +
    `<div class="scin-tip" data-scin-tip hidden role="tooltip"></div>` +
    `<div class="scin-dialog" data-scin-dialog hidden></div>` +
    renderMetaIsland("analysis", options) +
    `</div>`
  );
}

/** No dataset on disk: a sentence, not an empty dashboard. */
export function renderInjuryEmpty(page: "analysis" | "database", options: InjuryRenderOptions = {}): string {
  const copy = injuryPageCopy(page);
  return (
    `<div class="scin${options.embed ? " is-embed" : ""}" data-scin-root="1" data-scin-page="${page}" data-empty="1">` +
    (options.embed ? "" : `<h1 class="scin-h1">${escapeHtml(copy.h1)}</h1>`) +
    `<p class="scin-empty">${page === "database" ? "The injury database" : "The injury analysis"} is not available right now. Please check back soon.</p>` +
    `</div>`
  );
}

export { INJ_SORT_MAP, pctF, pctRaw, renderLegend };
