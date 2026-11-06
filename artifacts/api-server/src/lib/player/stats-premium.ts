/**
 * The premium comparison version of the Stats tab (mak's brief, 2026-11-05):
 * the same season line, the same advanced metrics with the same ranks and
 * qualification note, the same career table and the same analysis
 * sentences, presented as a dashboard - navy gradient title bars with gold
 * icons, a KPI row, two metric cards with aligned bars and rank pills, a
 * restyled career table, and a branded analysis panel.
 *
 * Since mak approved it (2026-11-05, "remove the older version") this IS the
 * head of the Stats tab: player-render.ts mounts it above the chart, the
 * career rates and the career read, and the old production, ladder, career
 * table and analysis sections are gone from stats-tab.ts. Everything here is
 * read from statsPremiumModel() in stats-tab.ts, which builds it from the
 * same code paths those sections printed from.
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

const DASH = "-";

/* ------------------------------------------------------------------ icons */

const svg = (body: string, size = 16): string =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICON = {
  // The reference's KPI set: calendar, target, layers, football, trophy.
  calendar: svg(`<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M7 14h2M11 14h2M15 14h2M7 17.5h2M11 17.5h2"/>`),
  target: svg(`<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>`),
  layers: svg(`<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 12.5l9 5 9-5"/><path d="M3 16.5l9 5 9-5"/>`),
  football: svg(`<path d="M5.2 18.8c-2.3-2.3-1.4-8.1 2.6-12.1s9.8-4.9 12.1-2.6 1.4 8.1-2.6 12.1-9.8 4.9-12.1 2.6z"/><path d="M9 15l6-6"/><path d="M10.2 11.3l1.2 1.2M12.4 9.1l1.2 1.2M11.3 13.5l1.2 1.2"/>`),
  trophy: svg(`<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5v1.5A3.5 3.5 0 0 0 8.5 11M16 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5"/><path d="M12 13v3.5"/><path d="M8.5 20h7M10 16.5h4v3.5h-4z"/>`),
  intercept: svg(`<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>`),
  bars: svg(`<path d="M6 20v-7M12 20V4M18 20v-10"/>`),
  bolt: svg(`<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>`),
  route: svg(`<path d="M5 20V7a3 3 0 0 1 3-3h9"/><path d="M13 1l4 3-4 3"/><path d="M5 20h4"/>`),
  info: svg(`<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>`, 14),
};

/** The icon a KPI card wears, by its label (the reference's five, by kind). */
function cellIcon(label: string): string {
  const k = label.toLowerCase();
  if (k === "games") return ICON.calendar;
  if (k.includes("td")) return ICON.football;
  if (k === "int" || k.includes("interception")) return ICON.intercept;
  if (k.includes("%") || k.includes("catch") || k.includes("comp") || k.includes("/")) return ICON.trophy;
  if (k.includes("yard") || k.includes("yds")) return ICON.layers;
  if (k.includes("rec") || k.includes("receiving") || k.includes("target")) return ICON.target;
  return ICON.bars;
}

/* ------------------------------------------------------------------ atoms */

/**
 * The title, with the player's name in its own span when the title opens
 * with it: phones show "2026 Stats" and keep the name for crawlers and
 * screen readers (player.css, mak 2026-11-06). The heading's text is
 * unchanged.
 */
function titleHtml(title: string, name: string, tail = ""): string {
  if (!name || !title.startsWith(`${name} `)) return escapeHtml(title);
  let rest = title.slice(name.length + 1);
  // A trailing qualifier the phone drops too ("Career Stats by Season" reads
  // "Career Stats" there, mak 2026-11-06); same span, same rule.
  const cut = tail && rest.endsWith(tail) ? rest.slice(0, -tail.length) : "";
  if (cut) rest = cut;
  return `<span class="scp-stp-name">${escapeHtml(name)}</span> ${escapeHtml(rest)}` + (cut ? `<span class="scp-stp-name">${escapeHtml(tail)}</span>` : "");
}

function bar(id: string, icon: string, title: string, sub: string, ctl = "", hero = false, name = "", tail = ""): string {
  return (
    `<header class="scp-stp-bar${hero ? " is-hero" : ""}">` +
    `<span class="scp-stp-bar-rule" aria-hidden="true"></span>` +
    (hero ? "" : `<span class="scp-stp-bar-icon" aria-hidden="true">${icon}</span>`) +
    `<div class="scp-stp-bar-text">` +
    // The tab's H2s, with the ids the SEO ladder and the H1 promotion key on
    // (scp-st-prod-h is the lead heading; player-render promotes it).
    `<h2 class="scp-ox-h2 scp-stp-bar-title${hero ? " is-lead" : ""}" id="${escapeHtml(id)}">${titleHtml(title, name, tail)}</h2>` +
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
          // Each figure keeps its unit on its own line ("203 YDS" never splits).
          .map((s, i) => (i ? `<i class="scp-stp-kpi-dot"> · </i>` : "") + `<span class="scp-stp-kpi-fig">${figure(s)}${s.unit ? ` <small>${escapeHtml(s.unit)}</small>` : ""}</span>`)
          .join("");
        const sub = c.sub.map((s) => `${figure(s)} ${escapeHtml(s.label)}`).join(" · ");
        return (
          `<li class="scp-stp-kpi${c.label === "Games" ? " is-games" : ""}">` +
          `<span class="scp-stp-kpi-icon" aria-hidden="true">${cellIcon(c.label)}</span>` +
          `<span class="scp-stp-kpi-label">${escapeHtml(c.label)}</span>` +
          // Value and support on one wrapping line: a wide figure ("25 REC ·
          // 203 YDS", "65.9%" with "135/205") drops its support under it
          // rather than past the card's edge.
          `<span class="scp-stp-kpi-line"><span class="scp-stp-kpi-value">${main}</span>` +
          (sub ? `<span class="scp-stp-kpi-sub">${sub}</span>` : "") +
          `</span></li>`
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
          `<h4 class="scp-stp-card-title"><span class="scp-stp-card-icon">${ICON.target}</span>Efficiency</h4>` +
          `<ul class="scp-stp-rows">${eff.map((x) => metricRow(x, "eff")).join("")}</ul>` +
          `</div>`
        : "";
      const right =
        use.length || style.length || ctx.length
          ? `<div class="scp-stp-card is-use">` +
            // "Usage" heads the panel; Style is its own labelled subsection below,
            // so the title never reads "Usage & Style" (the reference).
            `<h4 class="scp-stp-card-title"><span class="scp-stp-card-icon">${use.length ? ICON.bars : style.length ? ICON.route : ICON.info}</span>${use.length ? "Usage" : style.length ? "Style" : "Context"}</h4>` +
            (use.length ? `<ul class="scp-stp-rows">${use.map((x) => metricRow(x, "use")).join("")}</ul>` : "") +
            (style.length
              ? (use.length ? `<h5 class="scp-stp-subhead"><span class="scp-stp-card-icon">${ICON.route}</span>Style</h5>` : "") +
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

  // The hero band (the reference): title over the lede, no icon tile.
  // Games played as a small label beside the toggle (mak, 2026-11-06): on
  // the phone it replaces the Games card, which spent ~140px on one number.
  // Desktop keeps the card and hides the label (player.css).
  const gp = m.cells.find((c) => c.label === "Games")?.main[0]?.total;
  const gpLabel = gp && gp !== "0" ? `<span class="scp-stp-gp">${escapeHtml(`${gp} ${gp === "1" ? "game" : "games"}`)}</span>` : "";
  const seasonHead = bar(
    "scp-st-prod-h",
    ICON.bars,
    `${m.name} ${m.season} Stats`,
    m.lede,
    `<div class="scp-st-seg scp-stp-seg" role="group" aria-label="Show stats as" data-scp-seg>` +
      `<button type="button" data-mode="total" aria-pressed="true">Season totals</button>` +
      `<button type="button" data-mode="pg" aria-pressed="false">Per game</button>` +
      `</div>` +
      gpLabel,
    true,
    m.name,
  );

  const advHead = m.advanced
    ? bar("scp-st-adv-h", ICON.bars, `${m.name} ${titleCase(cats)} Stats`, m.advanced.summary)
    : "";
  const note = m.advanced
    ? `<p class="scp-stp-note"><span class="scp-stp-note-icon" aria-hidden="true">${ICON.info}</span>${escapeHtml(`Ranks: ${m.advanced.notes.join(" · ")}.`)}</p>`
    : "";

  const careerHead = m.careerTable
    ? bar(
        "scp-st-career-h",
        ICON.layers,
        `${m.name} Career Stats by Season`,
        "",
        `<div class="scp-st-seg scp-stp-seg" role="group" aria-label="Show columns" data-scp-view-seg>` +
          `<button type="button" data-view="nfl" aria-pressed="true">NFL<span class="scp-stp-xs"> stats</span></button>` +
          `<button type="button" data-view="fantasy" aria-pressed="false">Fantasy</button>` +
          `</div>`,
        false,
        m.name,
        " by Season",
      )
    : "";

  // The hero's lede ("Touchdowns account for 61% of his fantasy
  // production...") belongs with the fantasy-impact read: on the phone it is
  // printed there and hidden in the heading (mak's mobile brief, 2026-11-05).
  // The desktop keeps it under the title. One copy shows at any width.
  const ledeMoves = Boolean(m.lede) && m.analysis.some((p) => p.title === "Fantasy impact");
  const analysis = m.analysis.length
    ? `<div class="scp-stp-analysis">` +
      `<div class="scp-stp-brand"><span class="scp-stp-brand-rule" aria-hidden="true"></span><span class="scp-stp-brand-text"><span>StatChasers</span> <span>Analysis</span></span></div>` +
      `<div class="scp-stp-analysis-cols">` +
      m.analysis
        .map(
          (p, i) =>
            `<div class="scp-stp-analysis-part">` +
            `<h4 class="scp-stp-analysis-h"><span class="scp-stp-card-icon">${i === 0 && m.analysis.length > 1 ? ICON.target : ICON.bars}</span>${escapeHtml(p.title)}</h4>` +
            (ledeMoves && p.title === "Fantasy impact" ? `<p class="scp-stp-analysis-lede">${m.lede}</p>` : "") +
            `<p>${p.html}</p>` +
            (p.note ? `<p class="scp-stp-analysis-note">${escapeHtml(p.note)}</p>` : "") +
            `</div>`,
        )
        .join("") +
      `</div></div>`
    : "";

  // The Stats tab's head since 2026-11-05 (mak approved the premium version
  // and had the old sections removed): one wrapper, three sections, the
  // analysis panel.
  return (
    `<div class="scp-stp" data-scp-premium="stats">` +
    // On the phone the lede never sits in the intro (mak, 2026-11-06): it
    // goes to the fantasy-impact read, or, with no such read, under the
    // production cards it describes.
    `<section class="scp-ox-sec scp-stp-sec" aria-labelledby="scp-st-prod-h">${m.lede ? seasonHead.replace('<p class="scp-stp-bar-sub">', '<p class="scp-stp-bar-sub is-moved">') : seasonHead}<div class="scp-stp-body">${kpiCards(m)}${m.lede && !ledeMoves ? `<p class="scp-stp-prod-lede">${m.lede}</p>` : ""}</div></section>` +
    (m.advanced
      ? `<section class="scp-ox-sec scp-stp-sec" aria-labelledby="scp-st-adv-h">${advHead}<div class="scp-stp-body">${metricCards(m)}${note}</div></section>`
      : "") +
    (m.careerTable
      ? `<section class="scp-ox-sec scp-stp-sec" aria-labelledby="scp-st-career-h">${careerHead}<div class="scp-stp-body scp-stp-tablewrap">${m.careerTable}</div></section>`
      : "") +
    analysis +
    `</div>`
  );
}
