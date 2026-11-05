/**
 * The Bio tab's "{Name} Bio and Career" block (mak's brief "Exact Premium NFL
 * Player Bio Tab Redesign", 2026-11-05, built to attached_assets/bio1.png;
 * the tab's own design since the same day, when mak said "remove the older
 * version"): a navy title banner with the club's crest, the four-cell
 * identity strip, the Career Overview prose, the Career Timeline
 * (team-colored blocks aligned to a year axis), then "What Happened at Each
 * Stop" as a vertical timeline beside the Quick Facts, Redraft Command and
 * "More on {last}" cards. The transactions log (bio-tab.ts) and the FAQ
 * follow it.
 *
 * Every word and number is BioPageFacts (bio-tab-data.ts): the prose, quick
 * facts, stops, axis and college; moreOnRows() and collegeCrest() from
 * bio-tab.ts give the links and the school's crest. Nothing here is computed
 * afresh and nothing is written for one player.
 *
 * Fantasy wording stays in the tab's marked places: the Redraft Command card
 * carries `.is-rc` and the best-season line `.scp-bo-best`, the classes the
 * fantasy-wording test allows (tests/player.test.mjs).
 *
 * Markup is `scp-bop-` prefixed; every rule in player.css starts
 * `.scp .scp-bop`. The banner title is an h2 (the page H1 stays the hero's
 * "{Name} Bio"); the section bars are h2s, the cards h3s.
 */

import { escapeHtml } from "../render";
import type { PlayerRenderOptions } from "../player-render";
import type { PlayerPageData } from "./player-data";
import { lastName } from "./header";
import { positionWord, type BioPageFacts, type BioStop } from "./bio-tab-data";
import { collegeCrest, moreOnRows, redraftCommandHref } from "./bio-tab";

const e = escapeHtml;

const svg = (body: string): string =>
  `<svg class="scp-bop-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const ICON = {
  jersey: svg(`<path d="M8 4l-5 3 2 4 2-1v10h10V10l2 1 2-4-5-3a3 3 0 0 1-8 0z"/>`),
  calendar: svg(`<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>`),
  ruler: svg(`<path d="M3 17L17 3l4 4L7 21z"/><path d="M8 12l2 2M11 9l2 2M14 6l2 2"/>`),
  cap: svg(`<path d="M2 9l10-4 10 4-10 4z"/><path d="M6 11v4c0 1.5 3 3 6 3s6-1.5 6-3v-4"/><path d="M22 9v5"/>`),
  bars: svg(`<path d="M5 20v-6M12 20V9M19 20V4"/>`),
  pin: svg(`<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.5"/>`),
  info: svg(`<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>`),
  trend: svg(`<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>`),
  list: svg(`<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>`),
  arrow: svg(`<path d="M5 12h14M13 6l6 6-6 6"/>`),
};

/** "2009 – 2022", "2025 – now" (or "present"), "2024" for a one-season stop. */
const years = (s: BioStop, now: string): string => (s.current ? `${s.from} – ${now}` : s.from === s.to ? String(s.from) : `${s.from} – ${s.to}`);

/** The section bar: gold icon, the h2, the gold diagonals. */
function bar(icon: string, title: string, id: string): string {
  return (
    `<header class="scp-bop-bar">` +
    `<span class="scp-bop-bar-icon">${icon}</span>` +
    `<h2 class="scp-bop-bar-title" id="${id}">${e(title)}</h2>` +
    `<span class="scp-bop-stripes" aria-hidden="true"></span>` +
    `</header>`
  );
}

/* ------------------------------------------------------------------ header */

function renderHeader(data: PlayerPageData): string {
  const team = data.team;
  const club = team ? `${team.city} ${team.nickname}` : null;
  const crest = team
    ? `<img class="scp-bop-crest" src="${e(team.logo)}" alt="${e(`${team.nickname} logo`)}" width="56" height="56" loading="lazy" decoding="async">`
    : "";
  const parts: string[] = [];
  if (data.player.position) parts.push(data.player.position);
  parts.push(club ?? "Free agent");
  const number = data.player.number;
  if (club && number !== null && number !== undefined) parts.push(`#${number}`);
  const sub = parts.map((p) => `<span>${e(p)}</span>`).join(`<span class="scp-bop-sep" aria-hidden="true">•</span>`);
  return (
    `<header class="scp-bop-hero">` +
    crest +
    `<span class="scp-bop-hero-rule" aria-hidden="true"></span>` +
    `<div class="scp-bop-hero-t">` +
    `<h2 class="scp-bop-title" id="scp-bop-title">${e(`${data.player.name} Bio and Career`)}</h2>` +
    `<p class="scp-bop-sub">${sub}</p>` +
    `</div>` +
    `<span class="scp-bop-hero-geo" aria-hidden="true"></span>` +
    `<span class="scp-bop-stripes" aria-hidden="true"></span>` +
    `</header>`
  );
}

/* -------------------------------------------------------------- fact strip */

/**
 * The four identity cells: Position, Born, Height / Weight, College. Each is
 * the Quick Facts' own value, joined the way the mockup joins them; a cell
 * with no fact behind it is left out rather than printed empty.
 */
function renderFacts(data: PlayerPageData, page: BioPageFacts): string {
  const quick = (label: string): string | null => page.quick.find((f) => f.label === label)?.value ?? null;
  const cells: { icon: string; label: string; value: string }[] = [];

  const pos = positionWord(data.player.position);
  if (pos) cells.push({ icon: ICON.jersey, label: "Position", value: pos.replace(/\b\w/g, (c) => c.toUpperCase()) });

  const born = quick("Born");
  const age = quick("Age");
  if (born) cells.push({ icon: ICON.calendar, label: "Born", value: age ? `${born} (Age ${age})` : born });

  const height = quick("Height");
  const weight = quick("Weight");
  if (height || weight) {
    cells.push({ icon: ICON.ruler, label: height && weight ? "Height / Weight" : height ? "Height" : "Weight", value: [height, weight].filter(Boolean).join(" / ") });
  }

  const college = quick("College") ?? quick("Colleges");
  // "College" whatever the count: the cell names the education path, as the mockup does.
  if (college) cells.push({ icon: ICON.cap, label: "College", value: college });

  if (cells.length === 0) return "";
  return (
    `<dl class="scp-bop-facts" aria-label="Player facts">` +
    cells
      .map(
        (c) =>
          `<div class="scp-bop-fact"><span class="scp-bop-fact-icon">${c.icon}</span>` +
          `<div><dt>${e(c.label)}</dt><dd>${e(c.value)}</dd></div></div>`,
      )
      .join("") +
    `</dl>`
  );
}

/* ---------------------------------------------------------------- overview */

function renderOverview(page: BioPageFacts): string {
  if (page.paragraphs.length === 0) return "";
  return (
    `<section class="scp-bop-sec is-overview" aria-labelledby="scp-bop-ov-h">` +
    `<h2 class="scp-bop-h2" id="scp-bop-ov-h">Career Overview</h2>` +
    `<div class="scp-bop-prose">${page.paragraphs.map((p) => `<p>${e(p)}</p>`).join("")}</div>` +
    `</section>`
  );
}

/* ---------------------------------------------------------------- timeline */

/**
 * The team-colored blocks over a year axis in the same columns. Each stop's
 * column is as wide as its stop was long, with a floor so a two-season stop
 * still has room for its totals, and its seasons are spread inside the
 * column, so the labels stay under the block that covers them (the mockup
 * does the same). A season no stop covers is an empty column in both rows.
 * Below the floor widths the box scrolls sideways rather than squeezing.
 */
function renderTimeline(page: BioPageFacts): string {
  const stops = page.stops;
  if (stops.length === 0) return "";
  const STOP_MIN = 200;
  const GAP_MIN = 28;
  const YEAR_MIN = 46;

  const cols: string[] = [];
  const blocks: string[] = [];
  const axis: string[] = [];
  let minWidth = (stops.length - 1) * 10;
  const yearCell = (from: number, to: number): string => {
    const years: string[] = [];
    for (let y = from; y <= to; y += 1) years.push(`<span>${y}</span>`);
    return `<span class="scp-bop-axis-years" style="grid-template-columns:repeat(${years.length},1fr)">${years.join("")}</span>`;
  };
  stops.forEach((s, i) => {
    const prev = stops[i - 1];
    if (prev && s.from > prev.to + 1) {
      const n = s.from - prev.to - 1;
      cols.push(`minmax(${GAP_MIN}px, ${n}fr)`);
      blocks.push(`<div class="scp-bop-gap" aria-hidden="true"></div>`);
      axis.push(`<li class="scp-bop-axis-cell is-gap">${yearCell(prev.to + 1, s.from - 1)}</li>`);
      minWidth += Math.max(GAP_MIN, n * YEAR_MIN) + 10;
    }
    cols.push(`minmax(${STOP_MIN}px, ${s.width}fr)`);
    minWidth += Math.max(STOP_MIN, (s.to - s.from + 1) * YEAR_MIN);
    const logo = s.team?.logo
      ? `<img class="scp-bop-seg-logo" src="${e(s.team.logo)}" alt="" width="40" height="40" loading="lazy" decoding="async">`
      : `<span class="scp-bop-seg-logo" aria-hidden="true"></span>`;
    const label = s.team?.nickname ?? s.short;
    blocks.push(
      `<div class="scp-bop-seg${s.current ? " is-cur" : ""}" role="listitem" style="--c:${e(s.primary)};--a:${e(s.accent)}">` +
        `<div class="scp-bop-seg-head">${logo}<div class="scp-bop-seg-t">` +
        `<span class="scp-bop-seg-name">${e(label)}<span class="scp-bop-sr">${e(` (${s.name})`)}</span></span>` +
        `<span class="scp-bop-seg-years">${e(years(s, "now"))}</span></div></div>` +
        `<div class="scp-bop-seg-body">` +
        `<b class="scp-bop-seg-big">${e(s.rail.big)}</b>` +
        `<span class="scp-bop-seg-rest">${e(s.rail.rest)}</span>` +
        // One of the bio's three marked fantasy spots (the class is the
        // fantasy-wording test's allowance), the same line the block above prints.
        (s.best ? `<span class="scp-bo-best scp-bop-best">${e(`Best: ${s.best.points.toFixed(1)} pts (${s.best.season})`)}</span>` : "") +
        `</div></div>`,
    );
    axis.push(
      `<li class="scp-bop-axis-cell" style="--c:${e(s.primary)}"><span class="scp-bop-axis-bar" aria-hidden="true"></span>${yearCell(s.from, s.to)}</li>`,
    );
  });
  const grid = `grid-template-columns:${cols.join(" ")};min-width:${minWidth}px`;
  return (
    `<section class="scp-bop-sec is-timeline" aria-labelledby="scp-bop-tl-h">` +
    bar(ICON.bars, "Career Timeline", "scp-bop-tl-h") +
    `<div class="scp-bop-tl">` +
    `<div class="scp-bop-segs" role="list" style="${grid}">${blocks.join("")}</div>` +
    `<ol class="scp-bop-axis" aria-label="Seasons" style="${grid}">${axis.join("")}</ol>` +
    `</div></section>`
  );
}

/* ------------------------------------------------------- stops + sidebar */

function renderStops(page: BioPageFacts): string {
  const stops = page.stops;
  if (stops.length === 0 && !page.college) return "";
  const items = [...stops].reverse().map((s) => {
    const tag = s.spell > 1 ? `, ${["", "", "second", "third", "fourth"][s.spell] ?? `${s.spell}th`} stint` : "";
    const crest = s.team?.logo
      ? `<img src="${e(s.team.logo)}" alt="" width="44" height="44" loading="lazy" decoding="async">`
      : "";
    return (
      `<li class="scp-bop-stop${s.current ? " is-cur" : ""}" style="--c:${e(s.primary)}">` +
      `<span class="scp-bop-node" aria-hidden="true"></span>` +
      `<div class="scp-bop-card">` +
      `<div class="scp-bop-card-head"><span class="scp-bop-card-crest" aria-hidden="true">${crest}</span>` +
      `<h3 class="scp-bop-card-h">${e(s.name)}</h3>` +
      (s.current ? `<span class="scp-bop-chip">Current team</span>` : "") +
      `<span class="scp-bop-card-years">${e(years(s, "present") + tag)}</span></div>` +
      (s.sentences.length ? `<p class="scp-bop-card-p">${e(s.sentences.join(" "))}</p>` : "") +
      `</div></li>`
    );
  });
  if (page.college) {
    items.push(
      `<li class="scp-bop-stop is-college">` +
        `<span class="scp-bop-node" aria-hidden="true"></span>` +
        `<div class="scp-bop-card"><div class="scp-bop-card-head">` +
        `<span class="scp-bop-card-crest" aria-hidden="true">${collegeCrest(page, "scp-bop-college")}</span>` +
        `<h3 class="scp-bop-card-h">${e(`College: ${page.college.names.join(", ")}`)}</h3>` +
        `</div></div></li>`,
    );
  }
  return (
    `<section class="scp-bop-sec is-stops" aria-labelledby="scp-bop-st-h">` +
    bar(ICON.pin, "What Happened at Each Stop", "scp-bop-st-h") +
    `<ol class="scp-bop-stops">${items.join("")}</ol>` +
    `</section>`
  );
}

function card(cls: string, icon: string, title: string, body: string, label = ""): string {
  return (
    `<div class="scp-bop-card-side ${cls}"${label ? ` aria-label="${e(label)}"` : ""}>` +
    `<h3 class="scp-bop-side-h"><span class="scp-bop-side-icon">${icon}</span>${e(title)}</h3>` +
    body +
    `</div>`
  );
}

function renderSidebar(data: PlayerPageData, page: BioPageFacts, options: PlayerRenderOptions): string {
  const last = lastName(data.player.name);
  const facts = page.quick.map((f) => `<div class="scp-bop-row"><dt>${e(f.label)}</dt><dd>${e(f.value)}</dd></div>`).join("");
  const quick = facts ? card("is-facts", ICON.info, "Quick Facts", `<dl class="scp-bop-dl">${facts}</dl>`) : "";

  // One of the bio's three marked fantasy spots: `.is-rc`, as on the card above.
  const rc =
    page.status === "active"
      ? card(
          "is-rc",
          ICON.trend,
          "Redraft Command",
          `<p class="scp-bop-rc-p">${e(`See how Redraft Command values ${last} for the rest of ${data.leagueSeason ?? data.season}.`)}</p>` +
            `<a class="scp-bop-btn" href="${e(redraftCommandHref(data))}" data-cta="redraft-command-bio-premium">${e(`Open ${last} in Redraft Command`)}<span class="scp-bop-btn-icon">${ICON.arrow}</span></a>`,
        )
      : "";

  const rows = moreOnRows(data, page, options);
  const more = rows.length
    ? card(
        "is-more",
        ICON.list,
        `More on ${last}`,
        `<dl class="scp-bop-dl is-links">${rows.map((r) => `<div class="scp-bop-row"><dt>${e(r.label)}</dt><dd><a href="${e(r.href)}">${e(r.text)}</a></dd></div>`).join("")}</dl>`,
      )
    : "";

  if (!quick && !rc && !more) return "";
  return `<aside class="scp-bop-side" aria-label="${e(`More on ${last}`)}">${quick}${rc}${more}</aside>`;
}

/* ------------------------------------------------------------------ public */

export function renderBioPremium(data: PlayerPageData, options: PlayerRenderOptions = {}): string {
  const page = data.bioPage;
  if (!page) return "";
  const stops = renderStops(page);
  const side = renderSidebar(data, page, options);
  const lower = stops || side ? `<div class="scp-bop-lower">${stops}${side}</div>` : "";
  return (
    `<div class="scp-bop" aria-labelledby="scp-bop-title">` +
    renderHeader(data) +
    renderFacts(data, page) +
    renderOverview(page) +
    renderTimeline(page) +
    lower +
    `</div>`
  );
}
