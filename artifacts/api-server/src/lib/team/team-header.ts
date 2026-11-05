/**
 * The team page header (mak's pick, 2026-11-05, from the two premium
 * comparisons: "Design B", the bright royal-blue hero with the light strip).
 *
 * Two separate rounded blocks: a navy-to-royal hero with a distinct blue left
 * logo panel ending in an angled gold divider, the crest on a clean white
 * circle, the division and season, the club's name, the white switcher pill,
 * four white KPI cards with gold icons, the crest as a watermark and the
 * freshness line; then, after a small gap, a light blue-gray strip of nine
 * text-first tabs with the open one in a navy pill under a gold bar.
 *
 * Everything is handed in by team-render.ts from the page's own sources:
 * heroFactList(), teamSwitcher() (wired by the bundle through
 * data-sct-switch), navItems(). The club's name takes the heading tag the
 * caller decides (h1 standalone, h2 embedded, p under a promoted section
 * heading). The strip keeps the bundle's contract: `data-sct-nav` on the nav,
 * `.sct-nav-list` and `.sct-nav-link` with `{id}-tab` ids, `data-sct-panel-id`
 * / `data-sct-heading` / `data-sct-lead` / `data-sc-title` on every link (see
 * NavItem in team-render.ts). The standfirst carries `data-sct-lead`, which
 * client/team.ts sets to "off" when the line would wrap.
 *
 * Markup is `sct-tpb-` prefixed (the prefix is the comparison's, kept so the
 * stylesheet block and the tests did not have to be rewritten); every rule in
 * team.css is under `.sct .sct-tpb`.
 */

import { escapeHtml as e } from "../render";
import { easternParts } from "../news-card";
import type { NflTeam } from "./teams";
import type { HeroFact, NavItem } from "../team-render";

export interface TeamHeaderInput {
  team: NflTeam;
  season: number;
  /** The tag the club's name wears: h1 standalone, h2 embedded, p under a promoted heading. */
  headingTag: "h1" | "h2" | "p";
  facts: HeroFact[];
  updatedMs: number | null;
  /** The team switcher's markup (teamSwitcher()). */
  switcher: string;
  tabs: NavItem[];
}

const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

/** Lucide trophy / chart-column-increasing / user-round / calendar-days. */
const KPI_ICON: Record<string, string> = {
  Record: svg(
    `<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>`,
  ),
  Standing: svg(`<path d="M13 17V9"/><path d="M18 17V5"/><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M8 17v-3"/>`),
  "Head Coach": svg(`<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>`),
  Bye: svg(
    `<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/>`,
  ),
};

export function renderTeamHeader(input: TeamHeaderInput): string {
  const { team, season, headingTag, facts, updatedMs, switcher, tabs } = input;
  const kpis = facts
    .map(
      (f) =>
        `<li class="sct-tpb-kpi">` +
        `<span class="sct-tpb-kpi-icon">${KPI_ICON[f.label] ?? KPI_ICON["Standing"]}</span>` +
        `<span class="sct-tpb-kpi-div" aria-hidden="true"></span>` +
        `<span class="sct-tpb-kpi-text"><span class="sct-tpb-kpi-label">${e(f.label)}</span><span class="sct-tpb-kpi-value">${e(f.value)}</span></span>` +
        `</li>`,
    )
    .join("");
  const updated =
    updatedMs !== null
      ? (() => {
          const parts = easternParts(updatedMs);
          return (
            `<p class="sct-tpb-updated">Last updated ` +
            `<time datetime="${e(new Date(updatedMs).toISOString())}" data-ts="${updatedMs}">${e(`${parts.month} ${parts.day}, ${parts.time}`)}</time></p>`
          );
        })()
      : "";
  // Plain anchors to real addresses, text-first (no icons). With scripting
  // off each is a page load; with it, client/team.ts switches the panel in
  // place off the data attributes and pushes the address. ARIA roles are the
  // bundle's to add, for the reason wireTabs() gives.
  const strip = tabs.length
    ? `<nav class="sct-tpb-navigation" aria-label="Team sections" data-sct-nav><ul class="sct-nav-list">` +
      tabs
        .map(
          (t) =>
            `<li><a class="sct-nav-link${t.active ? " is-active" : ""}"` +
            ` id="${e(t.id)}-tab"` +
            ` href="${e(t.href)}"` +
            ` data-sct-panel-id="${e(t.id)}"` +
            ` data-sct-heading="${e(t.heading)}"` +
            ` data-sct-lead="${e(t.lead)}"` +
            ` data-sc-title="${e(t.title)}"` +
            (t.active ? ` aria-current="page"` : "") +
            `><span class="sct-tpb-tab-label">${e(t.label)}</span></a></li>`,
        )
        .join("") +
      `</ul></nav>`
    : "";
  return (
    `<div class="sct-tpb">` +
    `<header class="sct-tpb-hero">` +
    // The decoration is clipped in its own wrapper, never the hero: an open
    // switcher drops below the hero and a clipped hero would cut it off. The
    // left panel and its gold divider are two clip-path polygons on the same
    // slant (see team.css).
    `<span class="sct-tpb-decor" aria-hidden="true">` +
    `<span class="sct-tpb-bands"></span>` +
    `<span class="sct-tpb-watermark"></span>` +
    `<span class="sct-tpb-logo-panel"></span>` +
    `<span class="sct-tpb-divider"></span>` +
    `<span class="sct-tpb-gold-edge"></span>` +
    `<span class="sct-tpb-topline"></span>` +
    `</span>` +
    `<div class="sct-tpb-inner">` +
    // The crest is the page's likeliest LCP element, so it loads eagerly and
    // at high priority. It is the only image on the page that does.
    `<div class="sct-tpb-badge"><div class="sct-tpb-logo-circle">` +
    `<img class="sct-tpb-logo" src="${e(team.logo)}" alt="${e(`${team.fullName} logo`)}" width="112" height="112" fetchpriority="high" decoding="sync">` +
    `</div></div>` +
    `<div class="sct-tpb-identity">` +
    `<p class="sct-tpb-eyebrow">${e(`${team.division} · ${season} Season`)}</p>` +
    `<${headingTag} class="sct-tpb-title">${e(team.fullName)}</${headingTag}>` +
    // `data-sct-lead` ships with no value and stays in the markup at every
    // width; client/team.ts sets "off" after measuring, and team.css hides
    // that state only. A width cannot decide this: the line is the club's
    // own name plus four words, so it wraps at a different width per club.
    `<p class="sct-tpb-sub" data-sct-lead>${e(`${team.fullName} fantasy football hub`)}</p>` +
    `</div>` +
    `<div class="sct-tpb-actions">${switcher}</div>` +
    (kpis ? `<ul class="sct-tpb-stats">${kpis}</ul>` : "") +
    updated +
    `</div>` +
    `</header>` +
    strip +
    `</div>`
  );
}
