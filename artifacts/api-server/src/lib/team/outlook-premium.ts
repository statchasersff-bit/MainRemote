/**
 * The premium comparison of the team hub's Fantasy Outlook (mak's brief
 * "Exact Premium NFL Team Fantasy Football Outlook & Stats Redesign",
 * 2026-11-05; no mockup image came with it, so the block is built from the
 * brief's words): the shared premium tab header (premium-head.ts: navy
 * gradient, gold-ringed glyph, gold rule, the "{Team} Fantasy Football
 * Outlook & Stats {season}" title with the stamp as its dek; mak, 2026-11-05
 * PM, replacing the light logo header the brief described),
 * the summary as plain prose, the five-cell context strip, then each of
 * the outlook's player groups as a two-column grid of scouting cards
 * (position-colored edge, round headshot, name, position and role badges,
 * the live designation, the card's facts as compact KPI tiles, the thesis,
 * the full note, a faint crest watermark), and the gold Bottom Line.
 *
 * The Outlook tab since 2026-11-05 (approved; the old stamp, lede, facts,
 * bands and bottom line and their renderers removed): renderOutlook()
 * (team-render.ts) returns this alone. Presentation only:
 * every word is TeamOutlook (team/outlook.ts) and the same live roster
 * match the original uses for the headshot and the designation, so the
 * two cannot disagree. The outlook has no stat-period field and no
 * featured-player field, so the tiles carry no period label and there is
 * no star. Markup `sct-tfo-` prefixed inside the premium wrapper
 * (`.sct-cp`, the `premium` size container); styles at the end of team.css.
 */

import { escapeHtml, searchKey } from "../render";
import { headshotImg } from "../headshot-html";
import { getPlayerProfileUrl } from "./links";
import type { OutlookFact, OutlookGroup, OutlookPlayer, TeamOutlook } from "./outlook";
import type { RosterPlayer } from "./roster";
import type { NflTeam } from "./teams";
import { injuryBadge, slotChip } from "../team-render";
import { premiumTabHead } from "./premium-head";

const e = escapeHtml;

const svg = (body: string, size = 24): string =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const ICON = {
  coach: svg(`<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>`),
  arriveIn: svg(`<path d="M4 12h12"/><path d="M11 7l5 5-5 5"/><path d="M20 5v14"/>`),
  depart: svg(`<path d="M20 12H8"/><path d="M13 7l-5 5 5 5"/><path d="M4 5v14"/>`),
  playbook: svg(`<circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M7.5 7.5L11 15.5M16.5 7.5L13 15.5"/>`),
  trophy: svg(`<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M9 21h6M10 17h4"/>`),
  fact: svg(`<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>`),
  target: svg(`<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>`),
};

/** The strip's icon, by the fact's label; the info glyph for a label the outlook has not used before. */
function factIcon(label: string): string {
  const l = label.toLowerCase();
  if (/coach/.test(l)) return ICON.coach;
  if (/arrival|addition|signing/.test(l)) return ICON.arriveIn;
  if (/departure|loss|gone/.test(l)) return ICON.depart;
  if (/caller|coordinator|scheme/.test(l)) return ICON.playbook;
  if (/win|projection|record/.test(l)) return ICON.trophy;
  return ICON.fact;
}

/** "Mike Vrabel (second season)" -> the name and the parenthetical as a sub-line. */
function splitValue(value: string): { main: string; sub: string } {
  const m = value.match(/^(.*?)\s*\(([^)]+)\)$/);
  return m ? { main: m[1], sub: m[2] } : { main: value, sub: "" };
}

/* ------------------------------------------------------------------ header */

function header(team: NflTeam, outlook: TeamOutlook, underway: boolean): string {
  const stamp = [underway ? "Written before Week 1" : "Preseason outlook", ...(outlook.updated ? [`Updated ${outlook.updated}`] : [])];
  return premiumTabHead({
    hook: "sct-tfo-head",
    icon: "outlook",
    // The panel's heading (.sct-h2, its gold rule suppressed by the shared
    // header), printed on a section page too.
    heading: `<h2 class="sct-h2 sct-up-h2 sct-tfo-title">${e(`${team.fullName} Fantasy Football Outlook & Stats ${outlook.season}`)}</h2>`,
    dekClass: "sct-tfo-stamp",
    dekHtml:
      `<span>${e(`${outlook.season} NFL Season`)}</span>` +
      stamp.map((s) => `<span class="sct-tfo-stamp-sep" aria-hidden="true">·</span><span>${e(s)}</span>`).join(""),
  });
}

/* ------------------------------------------------------------------- strip */

function strip(facts: OutlookFact[]): string {
  if (facts.length === 0) return "";
  const cells = facts.map((f) => {
    const { main, sub } = splitValue(f.value);
    const rank = f.rank ? ` <span class="sct-tfo-fact-rank">${e(f.rank)}<span class="sct-visually-hidden"> in the NFL</span></span>` : "";
    return (
      `<div class="sct-tfo-fact">` +
      `<span class="sct-tfo-fact-icon" aria-hidden="true">${factIcon(f.label)}</span>` +
      `<div class="sct-tfo-fact-text">` +
      `<dt class="sct-tfo-fact-label">${e(f.label)}</dt>` +
      `<dd class="sct-tfo-fact-value">${e(main)}${rank}${sub ? `<span class="sct-tfo-fact-sub">${e(sub)}</span>` : ""}</dd>` +
      `</div>` +
      `</div>`
    );
  });
  return `<dl class="sct-tfo-strip" style="--n:${facts.length}">${cells.join("")}</dl>`;
}

/* ------------------------------------------------------------------- cards */

/** "4,394 pass yds" -> the figure and its label; a phrase ("Offseason trade") is all label. */
function kpi(stat: string): string {
  const m = stat.match(/^([+-]?[\d,.]+%?)\s+(.+)$/);
  return m
    ? `<li class="sct-tfo-kpi"><span class="sct-tfo-kpi-v">${e(m[1])}</span><span class="sct-tfo-kpi-l">${e(m[2])}</span></li>`
    : `<li class="sct-tfo-kpi is-text"><span class="sct-tfo-kpi-l">${e(stat)}</span></li>`;
}

function card(player: OutlookPlayer, live: RosterPlayer | null, team: NflTeam): string {
  const position = player.position.toUpperCase();
  const photo =
    headshotImg({
      src: live?.headshot ?? null,
      className: "sct-tfo-photo",
      alt: "",
      variants: ["160"],
      width: 64,
      height: 64,
      loading: "lazy",
    }) ?? "";
  const href = getPlayerProfileUrl(player.name);
  const name = href ? `<a class="sct-tfo-link" href="${e(href)}" target="_top">${e(player.name)}</a>` : e(player.name);
  const watermark = team.logo ? `<img class="sct-tfo-wm" src="${e(team.logo)}" alt="" aria-hidden="true" width="120" height="120" loading="lazy" decoding="async">` : "";
  return (
    `<li class="sct-tfo-card" data-pos="${e(position)}">` +
    watermark +
    `<div class="sct-tfo-card-top">` +
    `<div class="sct-tfo-id">` +
    // The injury tag is pinned to the top-right of the headshot, not in the
    // badge row (mak, 2026-11-05 PM). The face wrapper is the badge's
    // positioning box; the well itself clips to its circle.
    `<span class="sct-tfo-face">` +
    `<span class="sct-tfo-well">${photo}</span>` +
    (live ? injuryBadge(live, "is-pinned sct-tfo-pin") : "") +
    `</span>` +
    `<div class="sct-tfo-who">` +
    `<h4 class="sct-tfo-name">${name}</h4>` +
    `<p class="sct-tfo-badges">` +
    slotChip(position, true) +
    (player.tier ? `<span class="sct-tfo-role">${e(player.tier)}</span>` : "") +
    `</p>` +
    `</div>` +
    `</div>` +
    (player.stats.length ? `<ul class="sct-tfo-kpis" aria-label="${e(`${player.name} figures`)}">${player.stats.map(kpi).join("")}</ul>` : "") +
    `</div>` +
    (player.thesis ? `<p class="sct-tfo-thesis">${e(player.thesis)}</p>` : "") +
    `<p class="sct-tfo-note">${e(player.note)}</p>` +
    `</li>`
  );
}

function group(g: OutlookGroup, live: Map<string, RosterPlayer>, team: NflTeam, index: number): string {
  if (g.players.length === 0) return "";
  const id = `sct-tfo-g${index}`;
  return (
    `<section class="sct-tfo-group" aria-labelledby="${id}">` +
    `<h3 class="sct-tfo-h3" id="${id}">${e(g.label)}</h3>` +
    `<ul class="sct-tfo-grid">${g.players.map((p) => card(p, live.get(searchKey(p.name)) ?? null, team)).join("")}</ul>` +
    `</section>`
  );
}

/* ------------------------------------------------------------------ public */

export function renderOutlookPremium(team: NflTeam, outlook: TeamOutlook, live: Map<string, RosterPlayer>, underway: boolean): string {
  const groups = outlook.groups.map((g, i) => group(g, live, team, i)).join("");
  if (!groups) return "";
  return (
    `<div class="sct-block sct-cp sct-tfo" id="outlook-premium">` +
    header(team, outlook, underway) +
    // The summary and the context strip in one frame under the header, the
    // way the Coaching page frames its profile and KPI cards (mak, 2026-11-05 PM).
    `<div class="sct-tfo-overview">` +
    `<p class="sct-tfo-lede">${e(outlook.summary)}</p>` +
    strip(outlook.facts) +
    `</div>` +
    groups +
    (outlook.bottomLine
      ? `<section class="sct-tfo-bl" aria-label="Bottom line">` +
        `<span class="sct-tfo-bl-id"><span class="sct-tfo-bl-icon" aria-hidden="true">${ICON.target}</span><span class="sct-tfo-bl-label">Bottom Line</span></span>` +
        `<span class="sct-tfo-bl-rule" aria-hidden="true"></span>` +
        `<p class="sct-tfo-bl-text">${e(outlook.bottomLine)}</p>` +
        `</section>`
      : "") +
    `</div>`
  );
}
