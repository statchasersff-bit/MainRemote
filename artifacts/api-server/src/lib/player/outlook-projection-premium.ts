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
import { fitNoteHtml, outlookPremiumModel, outlookProjectionModel, type OpportunityTake, type OpportunityTile } from "./outlook-tab";
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

/**
 * One two-line card (mak, 2026-11-28, the matchup cards' logic): the label
 * with the figure at the right edge, then the rank or the note. No icon, no
 * tinted lead card; a signed figure (points over expected) is green when
 * positive and red when negative.
 */
function card(t: OpportunityTile): string {
  const tone = /^\+/.test(t.value) && !/^\+0(\.0+)?$/.test(t.value) ? " is-up" : /^[-\u2212]/.test(t.value) && !/^[-\u2212]0(\.0+)?$/.test(t.value) ? " is-down" : "";
  return (
    `<div class="scp-olr-kpi${t.lead ? " is-lead" : ""}">` +
    `<dt>${e(t.label)}</dt><dd class="scp-olr-kpi-v${tone}">${e(t.value)}</dd>` +
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

  /* ---- Section A: the projection (mak, 2026-11-27)
   * One full-width section, no sidebar: the verdict on the left of one row
   * with his start/sit link on the right (it wraps under the verdict on
   * phones), the read's observations under it, the supports / threatens
   * cards when the data has them, then one compact Best fit row. The status
   * pills (they repeated the verdict) and the Redraft Command promo card
   * (the link in the verdict row is its one action) are gone. */
  // The injured sentence, when the read carries one, is the last paragraph
  // and wears the alert glyph; every other observation a gold check.
  const obs = m.paragraphs
    .map((p, i) => {
      const injuredRow = Boolean(m.injured) && i === m.paragraphs.length - 1 && m.paragraphs.length > 1;
      return `<li class="scp-olr-ob${injuredRow ? " is-alert" : ""}"><span class="scp-olr-ob-icon">${injuredRow ? ICON.alert : ICON.check}</span><p>${emphasize(p)}</p></li>`;
    })
    .join("");
  const cta = m.rc
    ? `<a class="scp-olr-btn is-verdict" href="${e(m.rc.href)}" data-cta="startsit-outlook-projection-premium">${e(m.rc.cta)}<span class="scp-olr-btn-arrow">${ICON.arrow}</span></a>`
    : "";
  const verdict =
    m.headline || cta
      ? `<div class="scp-olr-verdict">` +
        (m.headline ? `<p class="scp-olr-thesis"><span class="scp-olr-thesis-rule" aria-hidden="true"></span><span>${e(m.headline)}</span></p>` : "") +
        cta +
        `</div>`
      : "";
  // What could change his value (More snaps, The red-zone role, an injury
  // risk) joins the read here when the matchups section prints (mak,
  // 2026-11-28): it belongs with the outlook, and the matchups section goes
  // straight from the cards to the playoff schedule. The schedule items stay
  // out, the cards say them.
  const pm = outlookPremiumModel(data);
  const changes = pm?.schedule
    ? (["up", "risk"] as const)
        .flatMap((kind) =>
          pm.triggers[kind]
            .filter((i) => !i.schedule)
            .map(
              (i) =>
                `<li class="scp-olr-ob is-change is-${kind}${kind === "risk" ? " is-alert" : ""}"><span class="scp-olr-ob-icon">${kind === "up" ? ICON.check : ICON.alert}</span>` +
                `<p><b>${e(`${i.claim}:`)}</b> ${e(i.evidence)}</p></li>`,
            ),
        )
        .join("")
    : "";
  const summary = `<div class="scp-olr-summary">${verdict}<ul class="scp-olr-obs">${obs}${changes}</ul></div>`;
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
  const fits = m.fits
    ? `<div class="scp-olr-fit is-row"><h4 class="scp-olr-fit-h"><span class="scp-olr-fit-icon">${ICON.layers}</span>Best fit</h4>` +
      `<div class="scp-olr-fit-rows" role="list" aria-label="Best fit by league type">` +
      m.fits.chips
        .map((chip, i) => `<div class="scp-olr-fit-row" role="listitem"><span class="scp-olr-fit-league">${e(m.fits!.leagues[i]!)}</span><span class="scp-olr-pill is-${chip.kind}">${e(chip.label)}</span></div>`)
        .join("") +
      `</div>` +
      `<p class="scp-olr-fit-note">${fitNoteHtml(m.fits)}</p></div>`
    : "";
  const projection =
    `<section class="scp-olr-sec is-proj" aria-labelledby="scp-ol-take-h">` +
    // No "Through Week N" line under the heading (mak, 2026-11-06).
    bar(m.heading, "", "scp-ol-take-h", phoneHeading(m.heading, m.name, { word: "Rest-of-Season", short: "ROS" })) +
    `<div class="scp-olr-body"><div class="scp-olr-layout is-one">` +
    `<div class="scp-olr-main">${summary}${factors}${fits}</div>` +
    `</div></div></section>`;

  /* ---- Section B: opportunity vs. production (mak, 2026-11-27)
   * Actual, expected and the difference as the primary row; the volume
   * figures as one secondary row under it; the production callout is one
   * sentence on what the gap means. The trend readings, when the data has
   * them, keep their rows. */
  let opportunity = "";
  const o = m.opportunity;
  if (o) {
    const prod = o.tiles.slice(0, 3);
    const opp = o.tiles.slice(3);
    const primary = prod.length ? `<dl class="scp-olr-kpis is-primary" aria-label="Production Efficiency">${prod.map(card).join("")}</dl>` : "";
    const secondary = opp.length
      ? `<dl class="scp-olr-vol" aria-label="${e(m.pos === "QB" ? "Opportunity Volume" : "Opportunity Share")}">` +
        opp
          .map(
            (t) =>
              `<div class="scp-olr-vol-item"><dd>${e(t.value)}</dd><dt>${e(t.label.charAt(0).toLowerCase() + t.label.slice(1))}</dt>` +
              (t.sub ? `<span class="scp-olr-vol-sub">${e(t.sub)}</span>` : "") +
              `</div>`,
          )
          .join("") +
        `</dl>`
      : "";
    const [gapTake, ...trend] = o.takes;
    // The production reading's one sentence on what the gap means; the
    // sentence before it restated the two figures in the row above.
    const gap = gapTake ? (gapTake.meaning ?? gapTake.text) : "";
    const reads = trend.length
      ? `<div class="scp-olr-reads" role="list">` +
        trend
          .map(
            (t) =>
              `<div class="scp-olr-read is-${t.kind}" role="listitem"><span class="scp-olr-read-icon">${TAKE_ICON[t.kind]}</span>` +
              `<p><strong class="scp-olr-read-claim">${e(t.claim)}</strong><span class="scp-olr-read-text">${emphasize(t.text)}</span></p></div>`,
          )
          .join("") +
        `</div>`
      : "";
    const link = o.link ? `<p class="scp-olr-more"><a href="${e(o.link.href)}">${e(o.link.text)}<span class="scp-olr-more-arrow">${ICON.arrow}</span></a></p>` : "";
    opportunity =
      `<section class="scp-olr-sec is-opp" aria-labelledby="scp-ol-opp-h">` +
      bar("Opportunity vs. Production", "", "scp-ol-opp-h") +
      `<div class="scp-olr-body">` +
      `<p class="scp-olr-lede">${e(o.lede)}</p>` +
      `<div class="scp-olr-groups is-stacked">${primary}${secondary}</div>` +
      (gap ? `<p class="scp-olr-gap is-${gapTake!.kind}">${emphasize(gap)}</p>` : "") +
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
