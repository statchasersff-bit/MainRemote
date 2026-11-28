/**
 * The Bio tab's "{Name} Bio and Career" block. The 2026-11-05 premium brief
 * gave it a navy banner, a fact strip, a team-colored Career Timeline, stop
 * cards and three sidebar cards; mak's 2026-11-28 brief made it adapt to the
 * career instead, in one card: the banner, then the biography (its headline
 * and story, bioStory in bio-tab-data.ts) with the NFL team history under it
 * for a player with more than one stint, or career milestones for a
 * one-stint player whose data has at least two distinct events; an unboxed
 * Player Details list beside it; one row of links across the foot. The
 * transactions log (bio-tab.ts) and the FAQ follow it.
 *
 * Every word and number is BioPageFacts: the story, quick facts, stops and
 * honors; moreOnRows() and redraftCommandHref() from bio-tab.ts give the
 * links. Nothing here is computed afresh and nothing is written for one
 * player.
 *
 * Fantasy wording stays in the tab's marked places: the start/sit link
 * carries `.is-rc` and the best-season chip `.scp-bo-best`, the classes the
 * fantasy-wording test allows (tests/player.test.mjs).
 *
 * Markup is `scp-bop-` prefixed. The banner title is an h2 (the page H1
 * stays the hero's "{Name} Bio"); the story headline and the column titles
 * are h3s.
 */

import { escapeHtml } from "../render";
import { phoneHeading } from "./phone-heading";
import type { PlayerRenderOptions } from "../player-render";
import type { PlayerPageData } from "./player-data";
import { lastName } from "./header";
import type { BioPageFacts, BioStop } from "./bio-tab-data";
import { moreOnRows, redraftCommandHref } from "./bio-tab";
import { headArt, headIcon } from "./tab-head";

const e = escapeHtml;

/** "2009 – 2022", "2025 – now" (or "present"), "2024" for a one-season stop. */
const years = (s: BioStop, now: string): string => (s.current ? `${s.from} – ${now}` : s.from === s.to ? String(s.from) : `${s.from} – ${s.to}`);

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
    `<header class="scp-bop-hero scp-up-head">` +
    headIcon("bio") +
    crest +
    `<span class="scp-bop-hero-rule" aria-hidden="true"></span>` +
    `<div class="scp-bop-hero-t">` +
    `<h2 class="scp-bop-title scp-up-h2" id="scp-bop-title">${phoneHeading(`${data.player.name} Bio and Career`, data.player.name)}</h2>` +
    `<p class="scp-bop-sub scp-up-dek">${sub}</p>` +
    `</div>` +
    headArt("bio") +
    `<span class="scp-bop-hero-geo" aria-hidden="true"></span>` +
    `<span class="scp-bop-stripes" aria-hidden="true"></span>` +
    `</header>`
  );
}

/* ---------------------------------------------------------------- overview */

function renderOverview(page: BioPageFacts): string {
  if (page.paragraphs.length === 0) return "";
  return (
    // No visible "Career Overview" heading (mak, 2026-11-06): the prose sits
    // straight under the fact strip in the intro card. Since 2026-11-28 the
    // story opens with its own headline when the facts support one (bioStory).
    `<section class="scp-bop-sec is-overview" aria-label="Career overview">` +
    (page.headline ? `<h3 class="scp-bop-story-h">${e(page.headline)}</h3>` : "") +
    `<div class="scp-bop-prose">${page.paragraphs.map((p) => `<p>${e(p)}</p>`).join("")}</div>` +
    `</section>`
  );
}

/* ----------------------------------------------------------- team history */

/**
 * The NFL team history, multi-stint players only (mak, 2026-11-28): one
 * compact row a stint, "Years · Team · one detail", oldest first, a return to
 * a club its own row. "present" only on the stop the roster data marks
 * current. When the logs begin after his career did, the list says it holds
 * the stops since then rather than claiming the whole career.
 */
function stopDetail(s: BioStop): string {
  const champs = s.sentences.find((t) => /Super Bowl/.test(t));
  if (champs) return champs;
  return s.sentences.find((t) => /^He was /.test(t)) ?? s.sentences[0] ?? "";
}

function renderHistory(page: BioPageFacts): string {
  const stops = page.stops;
  if (stops.length < 2) return "";
  const rows = stops.map((s) => {
    const tag = s.spell > 1 ? `, ${["", "", "second", "third", "fourth"][s.spell] ?? `${s.spell}th`} stint` : "";
    const logo = s.team?.logo ? `<img class="scp-bop-hist-logo" src="${e(s.team.logo)}" alt="" width="20" height="20" loading="lazy" decoding="async">` : `<span class="scp-bop-hist-logo" aria-hidden="true"></span>`;
    const detail = stopDetail(s);
    return (
      `<li class="scp-bop-hist-row${s.current ? " is-cur" : ""}">` +
      `<span class="scp-bop-hist-years">${e(years(s, "present") + tag)}</span>` +
      `<span class="scp-bop-hist-team">${logo}<span>${e(s.name)}</span></span>` +
      (detail ? `<span class="scp-bop-hist-detail">${e(detail)}</span>` : "") +
      `</li>`
    );
  });
  const note = page.coversCareer ? "" : `<p class="scp-bop-hist-note">${e(`Stops since ${page.axis[0]}; earlier seasons are not in the data.`)}</p>`;
  return (
    `<section class="scp-bop-history" aria-labelledby="scp-bop-hist-h">` +
    `<h3 class="scp-bop-sub-h" id="scp-bop-hist-h">NFL Team History</h3>` +
    `<ol class="scp-bop-hist">${rows.join("")}</ol>` +
    note +
    `</section>`
  );
}

/* ------------------------------------------------------------- milestones */

/**
 * Career milestones for a one-stint player (mak, 2026-11-28): a year and a
 * specific event each, only events the data vouches for (Super Bowl wins,
 * his best season), and only when there are at least two of them.
 */
function renderMilestones(page: BioPageFacts): string {
  if (page.stops.length > 1) return "";
  const stop = page.stops[0];
  const rows: { year: number; html: string }[] = page.superBowls.map((sb) => ({
    year: sb.season,
    html: e(`Won Super Bowl ${sb.name} with the ${sb.team}`),
  }));
  if (stop?.best && page.seasonsPlayed >= 3) {
    // One of the bio's marked fantasy spots: the chip carries .scp-bo-best.
    rows.push({
      year: stop.best.season,
      html: `Career-best season <span class="scp-bo-best scp-bop-best">${e(`Best: ${stop.best.points.toFixed(1)} pts (${stop.best.season})`)}</span>`,
    });
  }
  if (rows.length < 2) return "";
  rows.sort((a, b) => a.year - b.year);
  return (
    `<section class="scp-bop-history is-milestones" aria-labelledby="scp-bop-ms-h">` +
    `<h3 class="scp-bop-sub-h" id="scp-bop-ms-h">Career Milestones</h3>` +
    `<ol class="scp-bop-hist">${rows.map((r) => `<li class="scp-bop-hist-row"><span class="scp-bop-hist-years">${r.year}</span><span class="scp-bop-hist-detail">${r.html}</span></li>`).join("")}</ol>` +
    `</section>`
  );
}

/* --------------------------------------------------------- player details */

/**
 * Player Details (mak, 2026-11-28): a compact, unboxed list beside the
 * biography. Birth date with age, height, weight, high school, jersey, the
 * draft and any honors; the biography carries the college path, and "Teams"
 * is dropped.
 */
const DETAIL_ORDER = ["Born", "Height", "Weight", "High school", "Jersey", "Drafted", "Super Bowl", "Super Bowls", "Pro Bowls", "All-Pro"];

function renderDetails(page: BioPageFacts): string {
  const quick = new Map(page.quick.map((f) => [f.label, f.value]));
  const rows = DETAIL_ORDER.filter((label) => quick.has(label)).map((label) => {
    let value = quick.get(label)!;
    if (label === "Born" && quick.has("Age")) value = `${value} (age ${quick.get("Age")})`;
    return `<div class="scp-bop-row"><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`;
  });
  if (rows.length === 0) return "";
  return (
    `<aside class="scp-bop-details" aria-labelledby="scp-bop-det-h">` +
    `<h3 class="scp-bop-sub-h" id="scp-bop-det-h">Player Details</h3>` +
    `<dl class="scp-bop-dl">${rows.join("")}</dl>` +
    `</aside>`
  );
}

/* ------------------------------------------------------------------ links */

/**
 * One row of links under the biography (mak, 2026-11-28): Career stats ·
 * Game log · Injury history · {season} outlook, then his start/sit page as a
 * text link. The start/sit link is one of the bio's marked fantasy spots
 * (.is-rc).
 */
function renderLinks(data: PlayerPageData, page: BioPageFacts, options: PlayerRenderOptions): string {
  const last = lastName(data.player.name);
  const links = moreOnRows(data, page, options)
    .filter((r) => r.label !== "Team")
    .map((r) => `<a href="${e(r.href)}">${e(r.label)}</a>`);
  const rcHref = page.status === "active" ? redraftCommandHref(data) : "";
  if (rcHref) links.push(`<span class="is-rc"><a href="${e(rcHref)}" data-cta="startsit-bio-premium">${e(`Should I start ${last}?`)}</a></span>`);
  if (links.length === 0) return "";
  return `<nav class="scp-bop-links" aria-label="${e(`More on ${last}`)}">${links.join(`<span class="scp-bop-sep" aria-hidden="true">·</span>`)}</nav>`;
}

/* ------------------------------------------------------------------ public */

/**
 * The tab (mak, 2026-11-28): one card. The banner, then the biography (its
 * headline and story) with the team history or milestones under it when the
 * career has them, Player Details beside it, and one row of links across
 * the foot. Phones stack biography, details, links. The Career Timeline,
 * the stop cards, the fact strip and the sidebar cards are gone.
 */
export function renderBioPremium(data: PlayerPageData, options: PlayerRenderOptions = {}): string {
  const page = data.bioPage;
  if (!page) return "";
  const details = renderDetails(page);
  return (
    `<div class="scp-bop" aria-labelledby="scp-bop-title">` +
    `<section class="scp-bop-intro" aria-labelledby="scp-bop-title">` +
    renderHeader(data) +
    `<div class="scp-bop-intro-body scp-bop-grid${details ? "" : " is-solo"}">` +
    `<div class="scp-bop-main">${renderOverview(page)}${renderHistory(page)}${renderMilestones(page)}</div>` +
    details +
    renderLinks(data, page, options) +
    `</div></section>` +
    `</div>`
  );
}
