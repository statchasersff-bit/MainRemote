/**
 * The Outlook tab's four closing sections (mak's brief, 2026-11-05, built
 * to attached_assets/garret1.png; the tab's own sections since the same
 * day, when mak approved them and the originals were removed): What Drives His
 * Fantasy Value as a ranked matrix (label + tier pill, value + unit, a
 * tick rail with his rank marked at its true ordinal position), the four
 * advanced cells as one strip; What Could Change His Value as green Upside
 * and red Risk cards with the gold Redraft Command strip; Upcoming Matchups
 * as four color-coded cards with the opponent's crest; the preseason piece
 * as a clean expandable archive.
 *
 * Rendered right after the tab's read and opportunity sections
 * (player-render.ts), before the FAQ. Every word and number is
 * outlookPremiumModel() in outlook-tab.ts, the same model the tab prints
 * from. Markup is `scp-olp-` prefixed; every rule in
 * player.css starts `.scp .scp-olp`, so nothing reaches the sections above.
 */

import { escapeHtml } from "../render";
import { titleCase } from "./title-case";
import type { PlayerPageData } from "./player-data";
import { outlookPremiumModel, type ScheduleCard, type TriggerItem } from "./outlook-tab";
import type { DriverRow } from "./outlook-tab-data";

const e = escapeHtml;

const svg = (body: string, cls = ""): string =>
  `<svg class="scp-olp-svg${cls ? ` ${cls}` : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const ICON = {
  bars: svg(`<path d="M5 20v-6M12 20V9M19 20V4"/>`),
  route: svg(`<path d="M4 20l6-6"/><path d="M14 4l6 6"/><path d="M4 4l5 5M9 4L4 9"/><circle cx="16" cy="18" r="2.5"/><path d="M12 12l2.5 2.5"/>`),
  calendar: svg(`<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>`),
  check: svg(`<path d="M5 12.5l4.5 4.5L19 7"/>`),
  dot: svg(`<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>`),
  up: svg(`<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>`),
  warn: svg(`<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>`),
  arrow: svg(`<path d="M5 12h14M13 6l6 6-6 6"/>`),
  crosshair: svg(`<circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>`),
  gauge: svg(`<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2"/><path d="M9 2h6"/>`),
  goal: svg(`<path d="M4 14l4-4 4 4 4-4 4 4"/><path d="M4 20l4-4 4 4 4-4 4 4"/>`),
  columns: svg(`<path d="M5 20v-5M10 20v-9M15 20v-7M20 20V8"/>`),
  chevron: svg(`<path d="M6 9l6 6 6-6"/>`),
  football: `<svg class="scp-olp-ball" viewBox="0 0 120 80" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 62C26 24 70 6 108 18 94 56 50 74 12 62z"/><path d="M38 52l44-26"/><path d="M48 44l3 5M54 40l3 5M60 36l3 5M66 33l3 5M72 29l3 5"/></g></svg>`,
};

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** Where a 1-based rank sits on a rail whose left edge is first: 0 to 100. */
export function rankPercent(rank: number, total: number): number {
  if (total <= 1) return 50;
  return Math.max(0, Math.min(100, ((rank - 1) / (total - 1)) * 100));
}

/** A navy bar: gold rule, gold icon, the title, an optional sub-line, the ball and the gold diagonals. */
function bar(icon: string, title: string, sub: string, hero = false): string {
  return (
    `<header class="scp-olp-bar${hero ? " is-hero" : ""}">` +
    `<span class="scp-olp-bar-rule" aria-hidden="true"></span>` +
    `<span class="scp-olp-bar-icon">${icon}</span>` +
    `<span class="scp-olp-bar-divider" aria-hidden="true"></span>` +
    `<div class="scp-olp-bar-text"><h2 class="scp-olp-bar-title">${e(titleCase(title))}</h2>${sub ? `<p class="scp-olp-bar-sub">${e(sub)}</p>` : ""}</div>` +
    ICON.football +
    `<span class="scp-olp-bar-stripes" aria-hidden="true"></span>` +
    `</header>`
  );
}

const ADV_ICON: Array<[RegExp, string]> = [
  [/depth of target|adot/i, ICON.crosshair],
  [/drop/i, ICON.gauge],
  [/red-zone|red zone|goal/i, ICON.goal],
  [/yac|yards after|per reception|per carry|per attempt/i, ICON.columns],
];

/* --------------------------------------------------------------- drivers */

function driverRow(d: DriverRow, posWord: string, name: string, minGames: number, season: number): string {
  const tier = d.tier === "good" ? "is-good" : d.tier === "bad" ? "is-bad" : "is-mid";
  let rail: string;
  if (d.rank === null) {
    rail = `<p class="scp-olp-unranked">${e(`Fewer than ${minGames} games in ${season}, so not ranked.`)}</p>`;
  } else {
    const at = rankPercent(d.rank, d.of);
    const label = `${ordinal(d.rank)} of ${d.of}`;
    rail =
      `<div class="scp-olp-rail" role="img" aria-label="${e(`${name} ranks ${ordinal(d.rank)} of ${d.of} qualifying ${posWord} in ${d.label.toLowerCase()}.`)}">` +
      `<span class="scp-olp-ticks" aria-hidden="true"></span>` +
      `<span class="scp-olp-me" aria-hidden="true" style="left:${at.toFixed(2)}%"></span>` +
      `</div>` +
      `<div class="scp-olp-axis" aria-hidden="true"><span>1st</span><b>${e(label)}</b><span>${e(ordinal(d.of))}</span></div>`;
  }
  return (
    `<div class="scp-olp-drv">` +
    `<div class="scp-olp-drv-label"><h3 class="scp-olp-h3">${e(d.label)}</h3>${d.word ? `<span class="scp-olp-tier ${tier}">${e(d.word)}</span>` : ""}</div>` +
    `<div class="scp-olp-drv-value"><strong>${e(d.value)}</strong><span>${e(d.unit)}</span></div>` +
    `<div class="scp-olp-drv-rail">${rail}</div>` +
    `</div>`
  );
}

/* ------------------------------------------------------------------ public */

export function renderOutlookPremium(data: PlayerPageData): string {
  const m = outlookPremiumModel(data);
  if (!m) return "";
  const parts: string[] = [];

  if (m.drivers) {
    const dm = m.drivers;
    const strip = dm.advanced.length
      ? `<dl class="scp-olp-adv" aria-label="${e(`${dm.season} advanced profile`)}">` +
        dm.advanced
          .map((c) => {
            const icon = ADV_ICON.find(([re]) => re.test(c.label))?.[1] ?? ICON.bars;
            return `<div class="scp-olp-adv-cell"><span class="scp-olp-adv-icon">${icon}</span><div><dt>${e(c.label)}</dt><dd>${e(c.value)}</dd></div></div>`;
          })
          .join("") +
        `</dl>`
      : "";
    parts.push(
      `<section class="scp-olp-sec is-drivers" aria-label="${e(dm.title)}">` +
        bar(ICON.bars, dm.title, dm.lede, true) +
        `<div class="scp-olp-body"><div class="scp-olp-matrix">${dm.rows.map((d) => driverRow(d, dm.posWord, m.name, dm.minGames, dm.season)).join("")}</div>${strip}</div>` +
        `</section>`,
    );
  }

  const { up, risk } = m.triggers;
  if (up.length || risk.length) {
    const item = (i: TriggerItem, icon: string): string =>
      `<li><span class="scp-olp-item-icon">${icon}</span><div><span class="scp-olp-claim">${e(i.claim)}</span><span class="scp-olp-evid">${e(i.evidence)}</span></div></li>`;
    const card = (kind: "up" | "risk", title: string, items: TriggerItem[]): string =>
      items.length
        ? `<div class="scp-olp-card is-${kind}"><h3 class="scp-olp-card-h"><span class="scp-olp-card-icon">${kind === "up" ? ICON.up : ICON.warn}</span>${title}</h3>` +
          `<ul class="scp-olp-items">${items.map((i) => item(i, kind === "up" ? ICON.check : ICON.dot)).join("")}</ul></div>`
        : "";
    parts.push(
      `<section class="scp-olp-sec is-change" aria-label="What could change his value">` +
        bar(ICON.route, "What Could Change His Value", "") +
        `<div class="scp-olp-body">` +
        `<div class="scp-olp-factors">${card("up", "Upside", up)}${card("risk", "Risk", risk)}</div>` +
        `<div class="scp-olp-cta"><span class="scp-olp-cta-text">${e(m.cta)}</span>` +
        `<a class="scp-olp-cta-btn" href="${e(m.rc)}" data-cta="redraft-command-outlook-premium">Compare them in Redraft Command<span class="scp-olp-cta-arrow">${ICON.arrow}</span></a></div>` +
        `</div></section>`,
    );
  }

  if (m.schedule) {
    const sm = m.schedule;
    const card = (c: ScheduleCard): string => {
      const logo = c.g.opponent?.logo ?? "";
      return (
        `<li class="scp-olp-game is-${c.kind}">` +
        `<span class="scp-olp-wk">${e(`Wk ${c.g.week}`)}</span>` +
        `<span class="scp-olp-opp">${e(c.opp)}</span>` +
        `<span class="scp-olp-rank">${e(c.rankText)}</span>` +
        `<span class="scp-olp-chip is-${c.kind}">${e(c.word)}</span>` +
        (logo ? `<img class="scp-olp-crest" src="${e(logo)}" alt="${e(`${c.g.opponentName} logo`)}" width="40" height="40" loading="lazy" decoding="async">` : "") +
        `</li>`
      );
    };
    parts.push(
      `<section class="scp-olp-sec is-schedule" aria-label="${e(sm.title)}">` +
        bar(ICON.calendar, sm.title, sm.lede, true) +
        `<div class="scp-olp-body">` +
        `<ul class="scp-olp-games" aria-label="Next opponents">${sm.cards.map(card).join("")}</ul>` +
        `<p class="scp-olp-read">${e(sm.verdict)}</p>` +
        (sm.playoffs ? `<p class="scp-olp-read is-playoffs">${e(sm.playoffs)}</p>` : "") +
        `</div></section>`,
    );
  }

  if (m.archive) {
    const am = m.archive;
    parts.push(
      `<section class="scp-olp-sec is-archive" aria-label="Preseason outlook">` +
        `<details class="scp-olp-prev"><summary class="scp-olp-prev-sum"><span class="scp-olp-prev-chev">${ICON.chevron}</span><span class="scp-olp-prev-title">${e(am.summary)}</span></summary>` +
        `<div class="scp-olp-prev-body"><p class="scp-olp-stamp">${e(am.stamp)}</p>${am.paras.map((p) => `<p>${e(p)}</p>`).join("")}</div>` +
        `</details></section>`,
    );
  }

  if (!parts.length) return "";
  return `<div class="scp-olp" id="outlook-premium" data-scp-premium="outlook">${parts.join("")}</div>`;
}
