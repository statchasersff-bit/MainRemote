/**
 * A player's name printed ONCE, in a shape CSS can show three ways (WEB-044,
 * 2026-11-24).
 *
 * The team tabs used to print every name they shortened two or three times
 * over - "Jared Goff", "J. Goff" and a visually hidden "Jared Goff" in the
 * Usage tables, a surname in the Fantasy Finishes table and the full name in
 * its phone copy - and let CSS pick one. Crawlers, copy-paste and anything
 * reading the HTML saw every copy. This prints the full name as text, once,
 * with the first name split so the stylesheet can render:
 *
 *   - the full name ("Jared Goff"): nothing hidden;
 *   - the short form ("J. Goff"): `.sct-nm-r` hidden and a "." added after
 *     `.sct-nm-i` with `::after`. Generated content keeps the page text the
 *     plain name ("Jared Goff") for crawlers and anything reading the HTML;
 *     a copy of the painted short form gets its "." back from the team
 *     bundle's copy handler (client/team.ts wireNameCopy, 2026-11-24 review);
 *   - the surname ("Goff", "St. Brown"): `.sct-nm-first` hidden.
 *
 * Same rule as the short forms it replaces (shortName in
 * usage-premium-dashboard.ts): the first letter of the first word, so
 * "A.J. Brown" is "A. Brown" and a suffix stays with the surname
 * ("Marvin Harrison Jr." -> "M. Harrison Jr." / "Harrison Jr."). A one-word
 * name has no forms and prints as it is.
 *
 * Which form shows is the caller's CSS (team.css, "Name forms"); the link or
 * cell around it should carry the full name for assistive technology
 * (aria-label / title), since a hidden first name is also hidden from it.
 */

import { escapeHtml as e } from "../render";

export function nameForms(name: string): string {
  const full = name.trim().replace(/\s+/g, " ");
  const gap = full.indexOf(" ");
  if (gap <= 0) return e(full);
  const first = full.slice(0, gap);
  const rest = full.slice(gap + 1);
  const initial = first.charAt(0);
  const tail = first.slice(1);
  return (
    `<span class="sct-nm-first"><span class="sct-nm-i">${e(initial)}</span>` +
    (tail ? `<span class="sct-nm-r">${e(tail)}</span>` : "") +
    ` </span><span class="sct-nm-last">${e(rest)}</span>`
  );
}
