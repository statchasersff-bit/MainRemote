/**
 * The premium comparison version of the Stats tab (mak's brief, 2026-11-05):
 * the same season line, the same advanced metrics with the same ranks and
 * qualification note, the same career table and the same analysis
 * sentences, presented as a dashboard - navy gradient title bars with gold
 * icons, a KPI row, two metric cards with aligned bars and rank pills, a
 * restyled career table, and a branded analysis panel.
 *
 * Rendered UNDER the whole existing Stats section while
 * STATS_PREMIUM_COMPARE is on (player-render.ts mounts it), so both are on
 * the page for comparison. Everything here is read from statsPremiumModel()
 * in stats-tab.ts, which builds it from the code paths the current sections
 * print from: no second data pass, no figure of its own.
 *
 * The toggles reuse the page's own handlers: the Season totals / Per game
 * switch is a [data-scp-seg] whose section is this block, and the client
 * swaps every [data-total] figure inside it; the NFL stats / Fantasy switch
 * is a [data-scp-view-seg] over the table copy inside this block.
 */

import { escapeHtml } from "../render";
import { titleCase } from "./title-case";
import type { PlayerPageData } from "./player-data";
import type { AdvMetric } from "./stats-tab-data";
import {
  DEFS,
  figure,
  keyOf,
  ordinal,
  statsPremiumModel,
  TIERS,
  tierOf,
  tint,
  type Cell,
  type StatsPremiumModel,
} from "./stats-tab";

/** Flip off to drop the comparison block without touching the current tab. */
export const STATS_PREMIUM_COMPARE = true;

const DASH = "-";

/* ------------------------------------------------------------------ icons */

const svg = (body: string, size = 16): string =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICON = {
  games: svg(`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v5M16 4v5"/>`),
  catch: svg(`<path d="M4 15c3-6 8-9 16-9"/><path d="M14 4l6 2-2 6"/>`),
  yards: svg(`<path d="M4 18L20 6"/><path d="M4 10v8h8"/>`),
  td: svg(`<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>`),
  rate: svg(`<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>`),
  bars: svg(`<path d="M5 20V10M12 20V4M19 20v-7"/>`),
  bolt: svg(`<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>`),
  target: svg(`<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>`),
  layers: svg(`<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/><path d="M3 17l9 5 9-5"/>`),
  style: svg(`<path d="M4 20c4-1 6-3 8-7s4-6 8-9"/><path d="M14 4h6v6"/>`),
  info: svg(`<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>`, 14),
  profile: svg(`<path d="M3 17l5-6 4 4 4-7 5 5"/>`),
  impact: svg(`<path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2V17h5v-1.2c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3z"/><path d="M10 20h4"/>`),
};

/** The icon a KPI card wears, by its label. */
function cellIcon(label: string): string {
  const k = label.toLowerCase();
  if (k === "games") return ICON.games;
  if (k.includes("td")) return ICON.td;
  if (k.includes("%") || k.includes("catch") || k.includes("comp") || k.includes("/")) return ICON.rate;
  if (k.includes("yard") || k.includes("yds")) return ICON.yards;
  if (k.includes("rec") || k.includes("receiving") || k.includes("int")) return ICON.catch;
  return ICON.bars;
}

/* ------------------------------------------------------------------ atoms */

function bar(id: string, icon: string, title: string, sub: string, ctl = ""): string {
  return (
    `<header class="scp-stp-bar">` +
    `<span class="scp-stp-bar-rule" aria-hidden="true"></span>` +
    `<span class="scp-stp-bar-icon" aria-hidden="true">${icon}</span>` +
    `<div class="scp-stp-bar-text">` +
    `<h3 class="scp-stp-bar-title" id="${escapeHtml(id)}">${escapeHtml(title)}</h3>` +
    (sub ? `<p class="scp-stp-bar-sub">${sub}</p>` : "") +
    `</div>` +
    (ctl ? `<div class="scp-stp-bar-ctl">${ctl}</div>` : "") +
    `<span class="scp-stp-bar-stripes" aria-hidden="true"></span>` +
    `</header>`
  );
}

/* ----------------------------------------------------------- the KPI row */

/** The five cards per position, picked from the rail by label; the rail's first five when a label is missing. */
const KPI_ORDER: Record<string, string[]> = {
  QB: ["Games", "Pass yards", "Pass TD", "INT", "Comp %"],
  RB: ["Games", "Rush yards", "Rush TD", "Receiving", "Yds / carry"],
  WR: ["Games", "Receptions", "Rec yards", "Rec TD", "Catch %"],
  TE: ["Games", "Receptions", "Rec yards", "Rec TD", "Catch %"],
};

function kpiCards(m: StatsPremiumModel): string {
  const byLabel = new Map(m.cells.map((c) => [c.label, c]));
  const picked = (KPI_ORDER[m.pos] ?? []).map((l) => byLabel.get(l)).filter((c): c is Cell => Boolean(c));
  const cells = picked.length === 5 ? picked : m.cells.slice(0, 5);
  return (
    `<ul class="scp-stp-kpis">` +
    cells
      .map((c) => {
        const main = c.main
          .map((s, i) => (i ? `<i class="scp-stp-kpi-dot"> · </i>` : "") + figure(s) + (s.unit ? ` <small>${escapeHtml(s.unit)}</small>` : ""))
          .join("");
        const sub = c.sub.map((s) => `${figure(s)} ${escapeHtml(s.label)}`).join(" · ");
        return (
          `<li class="scp-stp-kpi">` +
          `<span class="scp-stp-kpi-icon" aria-hidden="true">${cellIcon(c.label)}</span>` +
          `<span class="scp-stp-kpi-label">${escapeHtml(c.label)}</span>` +
          `<span class="scp-stp-kpi-value">${main}</span>` +
          (sub ? `<span class="scp-stp-kpi-sub">${sub}</span>` : "") +
          `</li>`
        );
      })
      .join("") +
    `</ul>`
  );
}

/* ------------------------------------------------------ the metric cards */

/**
 * One metric row: label, bar, value, rank pill. The bar and the tint are the
 * current ladder's (a better rank fills more of it; the tint follows the
 * percentile on the metric's own direction, so a low raw value that is good
 * never reads red). Usage rows wear green, as the brief asks.
 */
function metricRow(m: AdvMetric, family: "eff" | "use" | "style" | "context"): string {
  const t = tint(m);
  const tier = t === "bad" ? "poor" : t === "muted" ? "none" : t;
  const ranked = m.rank != null && m.of != null && m.of > 0;
  const fill = ranked ? ((m.of! - m.rank! + 1) / m.of!) * 100 : m.pctl ?? null;
  const def = DEFS[keyOf(m)];
  const pill = ranked
    ? `<span class="scp-stp-rank" data-tier="${tier}" title="${escapeHtml(m.read)}">${escapeHtml(`${ordinal(m.rank!)} of ${m.of}`)}</span>`
    : m.pctl == null
      ? `<span class="scp-stp-rank" data-tier="none" title="${escapeHtml(m.read)}">Unranked</span>`
      : `<span class="scp-stp-rank" data-tier="${tier}" title="${escapeHtml(m.read)}">${escapeHtml(ordinal(m.pctl))}<span class="scp-sr"> percentile</span></span>`;
  return (
    `<li class="scp-stp-row" data-family="${family}">` +
    `<span class="scp-stp-row-label"${def ? ` title="${escapeHtml(def)}"` : ""}>${escapeHtml(m.label)}</span>` +
    (fill == null
      ? `<span class="scp-stp-bar-track is-empty" aria-hidden="true"></span>`
      : `<span class="scp-stp-bar-track" data-tier="${tier}" aria-hidden="true"><span class="scp-stp-bar-fill" style="width:${Math.max(3, Math.min(100, fill)).toFixed(1)}%"></span></span>`) +
    `<span class="scp-stp-row-value">${escapeHtml(m.value)}</span>` +
    pill +
    `</li>`
  );
}

function metricCards(m: StatsPremiumModel): string {
  const adv = m.advanced;
  if (!adv || adv.cols.length === 0) return "";
  const groups = adv.cols
    .map((col) => {
      const ms = (col.card.all ?? col.card.metrics).filter((x) => x.value !== DASH);
      if (ms.length === 0) return "";
      const known = ms.some((x) => TIERS.some((t) => t.keys.includes(keyOf(x))));
      const head = adv.cols.length > 1 ? `<p class="scp-stp-colhead">${escapeHtml(col.title)}${col.sub ? ` <small>${escapeHtml(col.sub)}</small>` : ""}</p>` : "";
      if (!known) {
        return (
          head +
          `<div class="scp-stp-cards"><div class="scp-stp-card is-wide">` +
          `<h4 class="scp-stp-card-title"><span class="scp-stp-card-icon">${ICON.bars}</span>Metrics</h4>` +
          `<ul class="scp-stp-rows">${ms.map((x) => metricRow(x, "eff")).join("")}</ul>` +
          `</div></div>`
        );
      }
      const of = (i: number): AdvMetric[] => ms.filter((x) => tierOf(keyOf(x)) === i);
      const eff = of(0);
      const use = of(1);
      const style = of(2);
      const ctx = of(3);
      const left = eff.length
        ? `<div class="scp-stp-card is-eff">` +
          `<h4 class="scp-stp-card-title"><span class="scp-stp-card-icon">${ICON.bolt}</span>Efficiency</h4>` +
          `<ul class="scp-stp-rows">${eff.map((x) => metricRow(x, "eff")).join("")}</ul>` +
          `</div>`
        : "";
      const right =
        use.length || style.length || ctx.length
          ? `<div class="scp-stp-card is-use">` +
            `<h4 class="scp-stp-card-title"><span class="scp-stp-card-icon">${ICON.target}</span>${use.length ? "Usage" : ""}${use.length && style.length ? " &amp; " : ""}${style.length ? "Style" : ""}${!use.length && !style.length ? "Context" : ""}</h4>` +
            (use.length ? `<ul class="scp-stp-rows">${use.map((x) => metricRow(x, "use")).join("")}</ul>` : "") +
            (style.length
              ? `<h5 class="scp-stp-subhead"><span class="scp-stp-card-icon">${ICON.style}</span>Style</h5>` +
                `<ul class="scp-stp-rows">${style.map((x) => metricRow(x, "style")).join("")}</ul>`
              : "") +
            (ctx.length
              ? `<h5 class="scp-stp-subhead"><span class="scp-stp-card-icon">${ICON.info}</span>Context</h5>` +
                `<ul class="scp-stp-rows">${ctx.map((x) => metricRow(x, "context")).join("")}</ul>`
              : "") +
            `</div>`
          : "";
      return head + `<div class="scp-stp-cards">${left}${right}</div>`;
    })
    .join("");
  return groups;
}

/* ------------------------------------------------------------- the block */

export function renderPremiumStats(data: PlayerPageData, inserts: { careerTable?: string } = {}): string {
  const m = statsPremiumModel(data, inserts);
  if (!m) return "";
  const cats = m.advanced?.cats ?? (m.pos === "QB" ? "passing" : m.pos === "RB" ? "rushing" : "receiving");

  const seasonHead = bar(
    "scp-stp-season-h",
    ICON.bars,
    `${m.name} ${m.season} Stats`,
    m.lede,
    `<div class="scp-st-seg scp-stp-seg" role="group" aria-label="Show stats as" data-scp-seg>` +
      `<button type="button" data-mode="total" aria-pressed="true">Season totals</button>` +
      `<button type="button" data-mode="pg" aria-pressed="false">Per game</button>` +
      `</div>`,
  );

  const advHead = m.advanced
    ? bar("scp-stp-adv-h", m.pos === "QB" ? ICON.bolt : m.pos === "RB" ? ICON.yards : ICON.catch, `${m.name} ${titleCase(cats)} Stats`, m.advanced.summary)
    : "";
  const note = m.advanced
    ? `<p class="scp-stp-note"><span class="scp-stp-note-icon" aria-hidden="true">${ICON.info}</span>${escapeHtml(`Ranks: ${m.advanced.notes.join(" · ")}.`)}</p>`
    : "";

  const careerHead = m.careerTable
    ? bar(
        "scp-stp-career-h",
        ICON.layers,
        `${m.name} Career Stats by Season`,
        "",
        `<div class="scp-st-seg scp-stp-seg" role="group" aria-label="Show columns" data-scp-view-seg>` +
          `<button type="button" data-view="nfl" aria-pressed="true">NFL stats</button>` +
          `<button type="button" data-view="fantasy" aria-pressed="false">Fantasy</button>` +
          `</div>`,
      )
    : "";

  const analysis = m.analysis.length
    ? `<div class="scp-stp-analysis">` +
      `<div class="scp-stp-brand"><span class="scp-stp-brand-rule" aria-hidden="true"></span><span class="scp-stp-brand-text"><span>StatChasers</span> <span>Analysis</span></span></div>` +
      `<div class="scp-stp-analysis-cols">` +
      m.analysis
        .map(
          (p, i) =>
            `<div class="scp-stp-analysis-part">` +
            `<h4 class="scp-stp-analysis-h"><span class="scp-stp-card-icon">${i === 0 && m.analysis.length > 1 ? ICON.profile : ICON.impact}</span>${escapeHtml(p.title)}</h4>` +
            `<p>${p.html}</p>` +
            (p.note ? `<p class="scp-stp-analysis-note">${escapeHtml(p.note)}</p>` : "") +
            `</div>`,
        )
        .join("") +
      `</div></div>`
    : "";

  return (
    `<p class="scp-stp-label" aria-hidden="true">New design - comparison</p>` +
    `<section class="scp-ox-sec scp-stp" aria-label="Premium stats (comparison)" data-scp-premium="stats">` +
    `<section class="scp-stp-sec" aria-labelledby="scp-stp-season-h">${seasonHead}<div class="scp-stp-body">${kpiCards(m)}</div></section>` +
    (m.advanced
      ? `<section class="scp-stp-sec" aria-labelledby="scp-stp-adv-h">${advHead}<div class="scp-stp-body">${metricCards(m)}${note}</div></section>`
      : "") +
    (m.careerTable
      ? `<section class="scp-stp-sec" aria-labelledby="scp-stp-career-h">${careerHead}<div class="scp-stp-body scp-stp-tablewrap">${m.careerTable}</div></section>`
      : "") +
    analysis +
    `</section>`
  );
}
