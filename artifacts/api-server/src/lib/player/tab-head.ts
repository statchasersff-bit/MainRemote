/**
 * The team pages' premium tab header (team/premium-head.ts, `.sct-up-head`)
 * on the player pages (mak, 2026-11-06: "apply this to the player pages as
 * well so it is consistent"). Navy band in the team's colors, a gold-ringed
 * icon tile, a gold rule, the white title over its dek, the faint art on the
 * right and the two slim gold accents at the edge.
 *
 * Applied to each tab's EXISTING lead banner rather than replacing it: the
 * banner keeps its own classes, which the phone rules (560px and under) and
 * the client scripts key on, and gains `scp-up-head` plus these pieces.
 * player.css draws the shared look above 560px and hides the banner's old
 * decoration there; on phones the pieces here are hidden and the banner's
 * phone treatment is unchanged. Rules start `.scp`, nothing reaches team.css.
 */

import { PREMIUM_HEAD_ICON, TAB_ART } from "../team/premium-head";

const stroke = (d: string): string =>
  `<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</g></svg>`;

const ICONS = {
  ...PREMIUM_HEAD_ICON,
  overview: stroke(`<rect x="3" y="4" width="8" height="7" rx="1.5"/><rect x="13" y="4" width="8" height="4" rx="1.5"/><rect x="13" y="10" width="8" height="10" rx="1.5"/><rect x="3" y="13" width="8" height="7" rx="1.5"/>`),
  gamelog: PREMIUM_HEAD_ICON.schedule,
  injury: stroke(`<path d="M12 21s-7-4.4-9-9.2C1.6 8.4 3.6 5 7 5c2 0 3.3 1.1 5 3 1.7-1.9 3-3 5-3 3.4 0 5.4 3.4 4 6.8-2 4.8-9 9.2-9 9.2z"/><path d="M12 10v5M9.5 12.5h5"/>`),
  bio: stroke(`<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.4"/><path d="M5.5 16.5c.8-1.8 2-2.6 3.5-2.6s2.7.8 3.5 2.6"/><path d="M14.5 10h4M14.5 13h4"/>`),
} as const;

export type PlayerHeadIcon = keyof typeof ICONS;

const svgArt = (body: string): string =>
  `<svg viewBox="0 0 260 90" width="260" height="90" aria-hidden="true" focusable="false" class="scp-up-art">${body}</svg>`;

/** Injury: a heart-rate trace across the band, a medical cross, a practice-report grid. */
const INJURY_ART = svgArt(
  `<g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M10 52h40l8-18 10 34 10-30 6 14h34"/>` +
    `<rect x="132" y="22" width="40" height="40" rx="8"/><path d="M152 30v24M140 42h24"/>` +
    `</g>` +
    `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    `<rect x="186" y="14" width="64" height="62" rx="4"/><path d="M186 28h64M207 14v62M228 14v62"/>` +
    `<path d="M192 40l4 4 6-7M213 40l4 4 6-7M236 38l6 6M242 38l-6 6"/>` +
    `<path d="M192 58l4 4 6-7M216 58h8M236 56l6 6M242 56l-6 6"/>` +
    `</g>`,
);

/** Bio: a career path, stop to stop, ending at a jersey. */
const BIO_ART = svgArt(
  `<g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M14 70h46l18-22h44l18 20h40"/>` +
    `<circle cx="14" cy="70" r="6"/><circle cx="78" cy="48" r="6"/><circle cx="122" cy="48" r="6"/><circle cx="140" cy="68" r="6"/>` +
    `<path d="M196 22l-14 8 6 12 6-3v30h28V39l6 3 6-12-14-8a8 8 0 0 1-16 0z"/>` +
    `<path d="M202 50h16M210 44v14"/>` +
    `</g>` +
    `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 30h30M20 38h20M84 20h30M84 28h18"/></g>`,
);

/** Overview: a dashboard - a bar chart beside two stat tiles and a trend line. */
const OVERVIEW_ART = svgArt(
  `<g fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M76 78h82"/><path d="M86 78V54M100 78V40M114 78V60M128 78V30M142 78V48"/>` +
    `<rect x="170" y="12" width="36" height="28" rx="4"/><path d="M178 22h12M178 30h20"/>` +
    `<rect x="214" y="12" width="36" height="28" rx="4"/><path d="M222 22h12M222 30h20"/>` +
    `<rect x="170" y="48" width="80" height="32" rx="4"/><path d="M178 72l14-10 12 6 14-12 12 4 12-8"/>` +
    `</g>`,
);

const ARTS = {
  ...TAB_ART,
  injury: INJURY_ART,
  bio: BIO_ART,
  overview: OVERVIEW_ART,
} as const;

export type PlayerHeadArt = keyof typeof ARTS;

/** The gold-ringed icon tile; goes first in the banner. */
export function headIcon(icon: PlayerHeadIcon): string {
  return `<span class="scp-up-head-icon" aria-hidden="true">${ICONS[icon]}</span><span class="scp-up-head-rule" aria-hidden="true"></span>`;
}

/** The faint art on the right; goes last in the banner. */
export function headArt(art: PlayerHeadArt): string {
  // The team arts carry team.css's class; ours is the player one.
  return ARTS[art].replace('class="sct-up-art"', 'class="scp-up-art"');
}
