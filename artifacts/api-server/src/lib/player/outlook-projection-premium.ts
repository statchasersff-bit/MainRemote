/**
 * SINCE 2026-11-05 PM THIS IS THE TAB'S FIRST TWO SECTIONS: mak approved the
 * comparison ("remove this older version") and the original read, portrait,
 * sidebar and tiles came out of outlook-tab.ts. The titles are the approved
 * H2 ladder's, with the ids the originals carried.
 *
 * The premium comparison of the Outlook tab's first two sections (mak's brief
 * "Exact Premium Rest-of-Season Projection & Opportunity vs. Production
 * Redesign", 2026-11-05): a compact navy Rest-of-Season Projection bar, the
 * status badges, a full-width written summary (the takeaway with a gold rule,
 * then the read's sentences as check-marked observations), the green
 * Supports / red Threatens cards, the navy Redraft Command card and the Best
 * fit panel at the right; then Opportunity vs. Production under its own bar,
 * with the six figures split into a gold "Production Efficiency" group and a
 * blue "Opportunity Share" group, the takeaway rows, and the usage link.
 *
 * NO PORTRAIT: the brief rejected the version with his photograph; the
 * summary takes that width.
 *
 * A comparison only: rendered under the tab's own two sections
 * (player-render.ts), above the premium closing sections, never the default
 * until mak approves. Every word and number is outlookProjectionModel() in
 * outlook-tab.ts, the model the tab's sections print from. Titles are h3s so
 * the approved H2 ladder is not duplicated while both versions are on the
 * page. Markup is `scp-olr-` prefixed; every rule in player.css starts
 * `.scp .scp-olr`, so nothing reaches the sections above.
 */

import { escapeHtml } from "../render";
import { phoneHeading } from "./phone-heading";
import type { PlayerRenderOptions } from "../player-render";
import type { PlayerPageData } from "./player-data";
import { outlookProjectionModel, type Chip, type OpportunityTake, type OpportunityTile } from "./outlook-tab";
import { headArt, headIcon } from "./tab-head";

const e = escapeHtml;

const svg = (body: string): string =>
  `<svg class="scp-olr-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const ICON = {
  bars: svg(`<path d="M5 20v-6M12 20V9M19 20V4"/>`),
  checkCircle: svg(`<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>`),
  check: svg(`<path d="M5 12.5l4.5 4.5L19 7"/>`),
  alert: svg(`<circle cx="12" cy="12" r="9"/><path d="M12 8v4.5M12 16h.01"/>`),
  calendar: svg(`<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>`),
  warn: svg(`<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>`),
  up: svg(`<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>`),
  down: svg(`<path d="M3 7l6 6 4-4 8 8"/><path d="M15 17h6v-6"/>`),
  steady: svg(`<path d="M4 12h16"/><path d="M15 8l4 4-4 4"/>`),
  arrow: svg(`<path d="M5 12h14M13 6l6 6-6 6"/>`),
  crosshair: svg(`<circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>`),
  layers: svg(`<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 12.5l9 5 9-5"/><path d="M3 16.5l9 5 9-5"/>`),
  trophy: svg(`<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5v1.5A3.5 3.5 0 0 0 8.5 11M16 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5"/><path d="M12 13v3.5"/><path d="M8.5 20h7M10 16.5h4v3.5h-4z"/>`),
  target: svg(`<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>`),
  columns: svg(`<path d="M5 20v-5M10 20v-9M15 20v-7M20 20V8"/>`),
  eye: svg(`<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="3"/>`),
  football: svg(`<path d="M5.2 18.8c-2.3-2.3-1.4-8.1 2.6-12.1s9.8-4.9 12.1-2.6 1.4 8.1-2.6 12.1-9.8 4.9-12.1 2.6z"/><path d="M9 15l6-6"/>`),
  goal: svg(`<path d="M4 14l4-4 4 4 4-4 4 4"/><path d="M4 20l4-4 4 4 4-4 4 4"/>`),
};

/** The glyph a status badge wears: calendar for the schedule, check / alert / warning by color. */
function badgeIcon(c: Chip): string {
  if (c.label.toLowerCase().includes("schedule")) return ICON.calendar;
  if (c.kind === "good") return ICON.checkCircle;
  if (c.kind === "bad") return ICON.warn;
  return ICON.alert;
}

/** The brief's icon per figure: trophy, target, rising columns, target, eye, layers. */
function tileIcon(label: string): string {
  const k = label.toLowerCase();
  if (k.startsWith("ppr")) return ICON.trophy;
  if (k.startsWith("expected")) return ICON.target;
  if (k.startsWith("points over")) return ICON.columns;
  if (k.includes("first-read")) return ICON.eye;
  if (k.includes("snap")) return ICON.layers;
  if (k.includes("designed")) return ICON.football;
  if (k.includes("inside the")) return ICON.goal;
  if (k.includes("dropbacks") || k.includes("weighted")) return ICON.bars;
  return ICON.target;
}

/**
 * The read's sentences with the figures bolded: percentages, decimals,
 * "6th of 97", "Week 9". Escaped first; the bolding adds markup only around
 * digits. A digit glued to a letter or hyphen ("Top-8", "WR16", "2QB") stays
 * plain.
 */
export function emphasize(text: string): string {
  // Split BEFORE escaping, so the digits of an entity ("&#39;") are never
  // matched; each piece is escaped on its own.
  const re = /(?<![A-Za-z\d-])(\d+(?:st|nd|rd|th) of \d+|Week \d+|[+−]?\d+(?:\.\d+)?%?)(?![A-Za-z\d])/g;
  let out = "";
  let last = 0;
  for (const m of text.matchAll(re)) {
    out += e(text.slice(last, m.index)) + `<strong>${e(m[0])}</strong>`;
    last = m.index + m[0].length;
  }
  return out + e(text.slice(last));
}

/** A navy title bar: gold icon, the title, an optional sub-line, the pattern and gold diagonals. */
function bar(title: string, sub: string, id: string, titleHtml = e(title)): string {
  // The tab's lead bar wears the team pages' tab header (tab-head.ts).
  const lead = id === "scp-ol-take-h";
  return (
    `<header class="scp-olr-bar${lead ? " scp-up-head" : ""}">` +
    (lead ? headIcon("outlook") : "") +
    `<span class="scp-olr-bar-icon">${ICON.bars}</span>` +
    // .is-lead marks the tab's lead heading for the page (no style of its own here).
    `<div class="scp-olr-bar-text"><h2 class="scp-olr-bar-title${lead ? " is-lead scp-up-h2" : ""}" id="${id}">${titleHtml}</h2>${sub ? `<p class="scp-olr-bar-sub${lead ? " scp-up-dek" : ""}">${e(sub)}</p>` : ""}</div>` +
    (lead ? headArt("outlook") : "") +
    `<span class="scp-olr-bar-grid" aria-hidden="true"></span>` +
    `<span class="scp-olr-bar-stripes" aria-hidden="true"></span>` +
    `</header>`
  );
}

function card(t: OpportunityTile): string {
  return (
    `<div class="scp-olr-kpi${t.lead ? " is-lead" : ""}">` +
    `<span class="scp-olr-kpi-icon">${tileIcon(t.label)}</span>` +
    `<dt>${e(t.label)}</dt><dd>${e(t.value)}</dd>` +
    (t.sub ? `<span class="scp-olr-kpi-sub">${e(t.sub)}</span>` : "") +
    `</div>`
  );
}

const TAKE_ICON: Record<OpportunityTake["kind"], string> = { ok: ICON.checkCircle, up: ICON.up, down: ICON.down, flat: ICON.steady, warn: ICON.alert };

export function renderOutlookProjectionPremium(data: PlayerPageData, options: PlayerRenderOptions = {}): string {
  const m = outlookProjectionModel(data, options);
  if (!m) return "";
  const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
  const list = (items: string[]): string => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

  /* ---- Section A: the projection */
  const badges = m.chips.length
    ? `<div class="scp-olr-tags" role="list" aria-label="Outlook at a glance">` +
      m.chips.map((c) => `<span class="scp-olr-tag is-${c.kind}" role="listitem"><span class="scp-olr-tag-icon">${badgeIcon(c)}</span>${e(c.label)}</span>`).join("") +
      `</div>`
    : "";
  // The injured sentence, when the read carries one, is the last paragraph
  // and wears the alert glyph; every other observation a gold check.
  const obs = m.paragraphs
    .map((p, i) => {
      const injuredRow = Boolean(m.injured) && i === m.paragraphs.length - 1 && m.paragraphs.length > 1;
      return `<li class="scp-olr-ob${injuredRow ? " is-alert" : ""}"><span class="scp-olr-ob-icon">${injuredRow ? ICON.alert : ICON.check}</span><p>${emphasize(p)}</p></li>`;
    })
    .join("");
  const summary =
    `<div class="scp-olr-summary">` +
    (m.headline ? `<p class="scp-olr-thesis"><span class="scp-olr-thesis-rule" aria-hidden="true"></span><span>${e(m.headline)}</span></p>` : "") +
    `<ul class="scp-olr-obs">${obs}</ul>` +
    `</div>`;
  const factor = (kind: "up" | "risk", title: string, items: string[], empty: string): string =>
    `<div class="scp-olr-factor is-${kind}"><h4 class="scp-olr-factor-h"><span class="scp-olr-factor-icon">${kind === "up" ? ICON.up : ICON.warn}</span>${e(title)}</h4>` +
    `<p>${items.length ? emphasize(`${cap(list(items))}.`) : e(empty)}</p></div>`;
  const factors =
    m.supports.length || m.threatens.length
      ? `<div class="scp-olr-factors">` +
        factor("up", "What supports his value", m.supports, m.supportsEmpty) +
        factor("risk", "What threatens his value", m.threatens, m.threatensEmpty) +
        `</div>`
      : "";
  const rc =
    `<div class="scp-olr-rc">` +
    `<h4 class="scp-olr-rc-h"><span class="scp-olr-rc-icon">${ICON.crosshair}</span>Redraft Command</h4>` +
    `<span class="scp-olr-rc-rule" aria-hidden="true"></span>` +
    `<p>${e(m.rc.copy)}</p>` +
    `<a class="scp-olr-btn" href="${e(m.rc.href)}" data-cta="redraft-command-outlook-projection-premium">${e(m.rc.cta)}<span class="scp-olr-btn-arrow">${ICON.arrow}</span></a>` +
    `</div>`;
  const fits = m.fits
    ? `<div class="scp-olr-fit"><h4 class="scp-olr-fit-h"><span class="scp-olr-fit-icon">${ICON.layers}</span>Best fit</h4>` +
      `<div class="scp-olr-fit-rows" role="list" aria-label="Best fit by league type">` +
      m.fits.chips
        .map((chip, i) => `<div class="scp-olr-fit-row" role="listitem"><span class="scp-olr-fit-league">${e(m.fits!.leagues[i]!)}</span><span class="scp-olr-pill is-${chip.kind}">${e(chip.label)}</span></div>`)
        .join("") +
      `</div>` +
      `<p class="scp-olr-fit-note">${e(m.fits.note)}</p></div>`
    : "";
  const projection =
    `<section class="scp-olr-sec is-proj" aria-labelledby="scp-ol-take-h">` +
    bar(m.heading, m.asOf, "scp-ol-take-h", phoneHeading(m.heading, m.name, { word: "Rest-of-Season", short: "ROS" })) +
    `<div class="scp-olr-body"><div class="scp-olr-layout">` +
    `<div class="scp-olr-main">${badges}${summary}${factors}</div>` +
    `<aside class="scp-olr-side" aria-label="${e(`${m.last} in Redraft Command`)}">${rc}${fits}</aside>` +
    `</div></div></section>`;

  /* ---- Section B: opportunity vs. production */
  let opportunity = "";
  const o = m.opportunity;
  if (o) {
    const prod = o.tiles.slice(0, 3);
    const opp = o.tiles.slice(3);
    const group = (kind: "prod" | "opp", label: string, tiles: OpportunityTile[]): string =>
      tiles.length
        ? `<div class="scp-olr-group is-${kind}"><span class="scp-olr-group-label">${e(label)}</span><dl class="scp-olr-kpis" aria-label="${e(label)}">${tiles.map(card).join("")}</dl></div>`
        : "";
    const reads =
      `<div class="scp-olr-reads" role="list">` +
      o.takes
        .map(
          (t) =>
            `<div class="scp-olr-read is-${t.kind}" role="listitem"><span class="scp-olr-read-icon">${TAKE_ICON[t.kind]}</span>` +
            `<p><strong class="scp-olr-read-claim">${e(t.claim)}</strong><span class="scp-olr-read-text">${emphasize(t.text)}</span></p></div>`,
        )
        .join("") +
      `</div>`;
    const link = o.link ? `<p class="scp-olr-more"><a href="${e(o.link.href)}">${e(o.link.text)}<span class="scp-olr-more-arrow">${ICON.arrow}</span></a></p>` : "";
    opportunity =
      `<section class="scp-olr-sec is-opp" aria-labelledby="scp-ol-opp-h">` +
      bar("Opportunity vs. Production", "", "scp-ol-opp-h") +
      `<div class="scp-olr-body">` +
      `<p class="scp-olr-lede">${e(o.lede)}</p>` +
      `<div class="scp-olr-groups">${group("prod", "Production Efficiency", prod)}${group("opp", m.pos === "QB" ? "Opportunity Volume" : "Opportunity Share", opp)}</div>` +
      reads +
      link +
      `</div></section>`;
  }

  return (
    `<div class="scp-olr" id="outlook-projection-premium" data-scp-premium="outlook-projection">` +
    projection +
    opportunity +
    `</div>`
  );
}
