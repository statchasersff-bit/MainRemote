/**
 * The recap sidebar's card heads in the new design (mak, 2026-11-08: "like"
 * the team News tab's rail - Injury Watch, Next Game, Quick Links): a gold
 * icon, then the title in Title Case, over the 2px gold rule the CSS draws.
 *
 * The previous design prints the same cards, so a head there is the plain
 * H3 it always was, sentence case and no icon: `premium` false returns
 * exactly the old markup.
 */

import { escapeHtml } from "../render";

const svg = (d: string): string =>
  `<svg class="sct-rb-rhead-icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">` +
  `<g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</g></svg>`;

export const RAIL_ICON = {
  info: svg(`<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5h.01"/>`),
  leaders: svg(`<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8-4.3-4.1 5.9-.9z"/>`),
  beforeAfter: svg(`<path d="M4 8h13"/><path d="M14 5l3 3-3 3"/><path d="M20 16H7"/><path d="M10 13l-3 3 3 3"/>`),
  calendar: svg(`<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17"/><path d="M8 3v4"/><path d="M16 3v4"/>`),
} as const;

export type RailIcon = keyof typeof RAIL_ICON;

const SMALL = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "vs"]);

/** "Before and after" -> "Before and After"; "The Patriots' next games" -> "The Patriots' Next Games". */
export function railTitleCase(text: string): string {
  return text
    .split(" ")
    .map((word, i, all) =>
      i > 0 && i < all.length - 1 && SMALL.has(word.toLowerCase())
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
}

/** A sidebar card's heading: the icon head on the new design, the plain H3 on the previous one. */
export function railHead(icon: RailIcon, id: string, title: string, premium: boolean): string {
  const h3 = `<h3 class="sct-rb-h3" id="${escapeHtml(id)}">${escapeHtml(premium ? railTitleCase(title) : title)}</h3>`;
  return premium ? `<div class="sct-rb-rhead">${RAIL_ICON[icon]}${h3}</div>` : h3;
}
