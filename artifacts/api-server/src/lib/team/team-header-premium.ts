/**
 * The premium comparison of the team page header (mak's brief, 2026-11-05:
 * the dark navy-and-gold design): a layered navy hero with the crest in a
 * gold-ringed badge, the division and season, the club's name, the switcher,
 * four white KPI cards with gold icons, the crest as a watermark, the
 * freshness line, and a dark navy tab strip with icons and a gold open tab.
 *
 * Rendered DIRECTLY UNDER the original hero and strip (team-render.ts),
 * labeled; the originals are untouched and stay the working navigation.
 * Everything here is handed in by the caller from the same sources the
 * originals print: heroFactList(), teamSwitcher() (a copy the bundle does
 * not wire), navItems(). The title is a <p>, never a heading, so the page
 * keeps its one H1; the tabs are plain links with no ids and none of the
 * bundle's hooks. Markup is `sct-tp-` prefixed; every rule in team.css is
 * under `.sct .sct-tp`.
 *
 * No mockup was on disk for this brief (the "teamshead" images are the
 * current light header); built from the brief's words.
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
  /** The team switcher's markup, the premium variant. */
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

const TAB_ICON: Record<string, string> = {
  outlook: svg(`<path d="M3 11l2-6h4l1 3h4l1-3h4l2 6"/><circle cx="7" cy="15" r="3.5"/><circle cx="17" cy="15" r="3.5"/><path d="M10.5 15h3"/>`),
  usage: svg(`<path d="M5 20v-6M12 20V9M19 20V4"/>`),
  coaching: svg(`<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>`),
  stats: svg(`<path d="M4 20h16"/><path d="M7 16l4-5 3 3 5-7"/><path d="M16 7h3v3"/>`),
  draft: svg(`<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>`),
  contracts: svg(`<path d="M6 3h8l4 4v6"/><path d="M14 3v4h4M6 3v18h7"/><path d="M15 20l5-5-2-2-5 5v2z"/>`),
  news: svg(`<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h5v4H7zM14 9h3M14 13h3M7 16h10"/>`),
  "depth-chart": svg(`<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 12.5l9 5 9-5"/><path d="M3 16.5l9 5 9-5"/>`),
  schedule: svg(`<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M8 14h2M12 14h2M16 14h2"/>`),
  matchups: svg(`<path d="M4 12h16M13 6l6 6-6 6"/>`),
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
  const strip = tabs.length
    ? `<nav class="sct-tp-nav" aria-label="Team sections (new design preview)"><ul class="sct-tp-nav-list">` +
      tabs
        .map(
          (t) =>
            `<li><a class="sct-tp-tab${t.active ? " is-active" : ""}" href="${e(t.href)}"${t.active ? ` aria-current="page"` : ""}>` +
            `<span class="sct-tp-tab-icon">${TAB_ICON[t.id] ?? TAB_ICON["stats"]}</span><span class="sct-tp-tab-label">${e(t.label)}</span></a></li>`,
        )
        .join("") +
      `</ul></nav>`
    : "";
  return (
    `<div class="sct-tp" data-sct-premium="team-header">` +
    `<p class="sct-cp-flag">Premium Design A · Dark Navy</p>` +
    `<section class="sct-tp-hero" aria-label="${e(`${team.fullName} header, new design preview`)}">` +
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
