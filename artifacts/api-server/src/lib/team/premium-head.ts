/**
 * The premium tab header shared by Snap Counts & Player Usage, Depth Chart,
 * Contracts, Draft, Stats, Coaching, (since 2026-11-05 PM, mak: "use this
 * header design ... on the outlook tab header") the Fantasy Outlook and
 * (2026-11-05 evening, mak: the Schedule header "should have the same design
 * as the [Draft] header") the Schedule, and (same evening, mak: match "the
 * coaching tabs header") the News tab.
 *
 * mak, 2026-11-05: "I really like this design [the Formations & Personnel
 * panel header] ... apply it to [the six tab headers] so they are all
 * consistent." So this is that header, lifted out of the coaching
 * tendencies panel: navy gradient, diagonal geometry fading in on the right,
 * two slim gold accents at the edge, a gold-ringed icon tile, a gold rule,
 * the white title with its dek, and the faint play-art. One markup here, one
 * CSS block (`.sct-up-head*` in team.css). The per-tab `hook` class carries
 * no style; it is there for the tests and nothing else.
 */

import { escapeHtml } from "../render";

const stroke = (d: string): string =>
  `<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</g></svg>`;

/** One glyph per tab, in the Formations header's stroke style. */
export const PREMIUM_HEAD_ICON = {
  usage: stroke(`<path d="M12 3l9 4.5-9 4.5-9-4.5z"/><path d="M3 12l9 4.5 9-4.5"/><path d="M3 16.5L12 21l9-4.5"/>`),
  depth: stroke(`<path d="M4 5h16"/><path d="M6 10h12"/><path d="M8 15h8"/><path d="M10 20h4"/>`),
  contracts: stroke(`<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M12 9v9"/><path d="M14 11h-3a1.5 1.5 0 0 0 0 3h2a1.5 1.5 0 0 1 0 3h-3"/>`),
  draft: stroke(`<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M12 8l1.4 2.9 3.1.4-2.3 2.2.6 3.1-2.8-1.5-2.8 1.5.6-3.1-2.3-2.2 3.1-.4z"/>`),
  stats: stroke(`<path d="M4 20h16"/><path d="M7 16v-5M12 16V8M17 16v-3"/><path d="M5 9l4-4 4 3 6-5"/>`),
  coaching: stroke(`<path d="M5 6l4 4M9 6l-4 4"/><circle cx="17" cy="7" r="2.4"/><path d="M6 19c4-7 9-7 13-3"/><path d="M16.5 14.5l3 1.5-.8 3"/>`),
  outlook: stroke(`<path d="M4 19l5-6 4 3 7-9"/><path d="M16 7h4v4"/><path d="M4 5v14h16"/>`),
  news: stroke(`<path d="M4 5h13v14H6a2 2 0 0 1-2-2z"/><path d="M17 9h3v8a2 2 0 0 1-2 2"/><path d="M7 9h7M7 12h7M7 15h4"/>`),
  schedule: stroke(`<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4M16 3v4"/><path d="M8 14h3M13 14h3M8 18h3"/>`),
} as const;

export type PremiumHeadIcon = keyof typeof PREMIUM_HEAD_ICON;

/** The Formations & Personnel panel's play-art: routes, Xs and Os, faint on the right. */
const ART =
  `<svg viewBox="0 0 260 90" width="260" height="90" aria-hidden="true" class="sct-up-art">` +
  `<g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">` +
  `<path d="M18 72c30-38 62-44 96-30"/><path d="M106 44l10-4-2 10"/><path d="M60 78c26-10 40-28 54-52"/>` +
  `<path d="M150 76c20-2 38-16 52-40"/><path d="M196 40l8-3-1 9"/><path d="M118 80c24 2 40-8 52-22"/></g>` +
  `<g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">` +
  `<path d="M28 24l10 10M38 24l-10 10"/><path d="M62 16l10 10M72 16l-10 10"/><path d="M212 62l10 10M222 62l-10 10"/></g>` +
  `<g fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="140" cy="18" r="6"/><circle cx="174" cy="12" r="6"/>` +
  `<circle cx="238" cy="24" r="6"/><circle cx="92" cy="60" r="6"/></g></svg>`;

export interface PremiumTabHeadOptions {
  /** A per-tab class for the tests (e.g. "sct-dpp-hero"); no CSS reads it. */
  hook?: string;
  icon: PremiumHeadIcon;
  /** The heading, already marked up: `<h2 class="sct-h2 sct-up-h2 ...">` (promoted to the H1 on a section address). */
  heading: string;
  /** Plain text; escaped here. */
  dek?: string;
  /**
   * The dek already marked up (the Outlook stamp with its gold separators);
   * printed as-is inside the `.sct-up-dek` paragraph. Wins over `dek`.
   */
  dekHtml?: string;
  /** An extra class on the dek paragraph (the Outlook's `.sct-tfo-stamp`). */
  dekClass?: string;
}

export function premiumTabHead(o: PremiumTabHeadOptions): string {
  return (
    `<header class="sct-up-head${o.hook ? ` ${o.hook}` : ""}">` +
    `<span class="sct-up-head-icon">${PREMIUM_HEAD_ICON[o.icon]}</span>` +
    `<span class="sct-up-head-rule" aria-hidden="true"></span>` +
    `<div class="sct-up-head-text">${o.heading}<p class="sct-up-dek${o.dekClass ? ` ${o.dekClass}` : ""}">${o.dekHtml ?? escapeHtml(o.dek ?? "")}</p></div>` +
    ART +
    `</header>`
  );
}
