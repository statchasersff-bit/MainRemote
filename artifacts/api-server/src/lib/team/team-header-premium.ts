/**
 * "Premium Design A · Dark Navy": the dark navy-and-gold comparison of the
 * team page header (mak's brief, 2026-11-05): a layered navy hero with the
 * crest in a gold-ringed badge, the division and season, the club's name,
 * the switcher, four white KPI cards with gold icons, the crest as a
 * watermark, the freshness line, and under it the header's light text-first
 * strip (the dark icon strip it had went at mak's request, 2026-11-05).
 *
 * Rendered DIRECTLY UNDER the header (team/team-header.ts, the design mak
 * kept the same day), labeled; brought back at mak's request after it had
 * been removed. Not the default. Everything here is handed in by the caller
 * from the same sources the header prints: heroFactList(), teamSwitcher() (a
 * copy the bundle does not wire), navItems(). The title is a <p>, never a
 * heading, so the page keeps its one H1; the tabs are plain links with no ids
 * and none of the bundle's hooks. Markup is `sct-tp-` prefixed; every rule in
 * team.css is under `.sct .sct-tp`.
 *
 * No mockup was on disk for this brief; built from the brief's words.
 */

import { escapeHtml as e } from "../render";
import { easternParts } from "../news-card";
import type { NflTeam } from "./teams";
import type { NavItem } from "../team-render";

export interface PremiumTeamHeaderInput {
  team: NflTeam;
  season: number;
  facts: Array<{ label: string; value: string }>;
  updatedMs: number | null;
  /** The team switcher's markup, the unwired copy. */
  switcher: string;
  tabs: NavItem[];
}

const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

const KPI_ICON: Record<string, string> = {
  Record: svg(`<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5v1.5A3.5 3.5 0 0 0 8.5 11M16 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5"/><path d="M12 13v3.5"/><path d="M8.5 20h7M10 16.5h4v3.5h-4z"/>`),
  Standing: svg(`<path d="M5 20v-6M12 20V9M19 20V4"/><path d="M3 20h18"/>`),
  "Head Coach": svg(`<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><path d="M4 14a2 2 0 0 1 2-2h1v6H6a2 2 0 0 1-2-2z"/><path d="M20 14a2 2 0 0 0-2-2h-1v6h1a2 2 0 0 0 2-2z"/><path d="M17 18v1a2 2 0 0 1-2 2h-2"/>`),
  Bye: svg(`<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>`),
};


export function renderPremiumTeamHeader(input: PremiumTeamHeaderInput): string {
  const { team, season, facts, updatedMs, switcher, tabs } = input;
  const kpis = facts
    .map(
      (f) =>
        `<li class="sct-tp-kpi">` +
        `<span class="sct-tp-kpi-icon">${KPI_ICON[f.label] ?? KPI_ICON["Standing"]}</span>` +
        `<span class="sct-tp-kpi-div" aria-hidden="true"></span>` +
        `<span class="sct-tp-kpi-text"><span class="sct-tp-kpi-label">${e(f.label)}</span><span class="sct-tp-kpi-value">${e(f.value)}</span></span>` +
        `</li>`,
    )
    .join("");
  const updated =
    updatedMs !== null
      ? (() => {
          const parts = easternParts(updatedMs);
          return (
            `<p class="sct-tp-updated">Last updated ` +
            `<time datetime="${e(new Date(updatedMs).toISOString())}" data-ts="${updatedMs}">${e(`${parts.month} ${parts.day}, ${parts.time}`)}</time></p>`
          );
        })()
      : "";
  // The light, text-first strip of the header (mak, 2026-11-05: "add the
  // menu row from the light design, remove the darker design's"), as a
  // separate rounded bar under the dark hero; unwired, like the switcher copy.
  const strip = tabs.length
    ? `<nav class="sct-tp-nav" aria-label="Team sections (Design A preview)"><ul class="sct-tp-nav-list">` +
      tabs
        .map(
          (t) =>
            `<li><a class="sct-tp-tab${t.active ? " is-active" : ""}" href="${e(t.href)}"${t.active ? ` aria-current="page"` : ""}>` +
            `<span class="sct-tp-tab-label">${e(t.label)}</span></a></li>`,
        )
        .join("") +
      `</ul></nav>`
    : "";
  return (
    `<div class="sct-tp" data-sct-premium="team-header">` +
    `<p class="sct-cp-flag">Premium Design A · Dark Navy</p>` +
    `<section class="sct-tp-hero" aria-label="${e(`${team.fullName} header, Design A preview`)}">` +
    `<span class="sct-tp-decor" aria-hidden="true"><span class="sct-tp-bands"></span><span class="sct-tp-gold is-tl"></span><span class="sct-tp-gold is-br"></span><span class="sct-tp-watermark"></span></span>` +
    `<div class="sct-tp-inner">` +
    `<div class="sct-tp-badge"><img class="sct-tp-logo" src="${e(team.logo)}" alt="" width="120" height="120" loading="lazy" decoding="async"></div>` +
    `<div class="sct-tp-text">` +
    `<p class="sct-tp-eyebrow"><span class="sct-tp-eyebrow-rule" aria-hidden="true"></span>${e(`${team.division} · ${season} Season`)}</p>` +
    `<p class="sct-tp-title">${e(team.fullName)}</p>` +
    `<p class="sct-tp-sub">${e(`${team.fullName} fantasy football hub`)}</p>` +
    `</div>` +
    `<div class="sct-tp-actions">${switcher}</div>` +
    (kpis ? `<ul class="sct-tp-kpis">${kpis}</ul>` : "") +
    updated +
    `</div>` +
    `</section>` +
    strip +
    `</div>`
  );
}
