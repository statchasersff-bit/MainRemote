/**
 * Tab headings that drop the player's name on phones (mak, 2026-11-06):
 * "Gardner Minshew II Bio and Career" reads "Bio and Career" at 560px and
 * under. The heading's text is unchanged - the name sits in a .scp-stp-xs
 * span, which the phone CSS clips rather than removes, so crawlers and
 * screen readers still get the full heading and desktop shows it as before.
 *
 * `abbr` swaps one word on phones only: the word is clipped the same way and
 * a sibling .scp-ph-abbr span prints the short form from its data-abbr
 * attribute ("Rest-of-Season" -> "ROS"), adding no text to the heading.
 */
import { escapeHtml } from "../render";

export function phoneHeading(full: string, name: string, abbr?: { word: string; short: string }): string {
  const lead = name && full.startsWith(`${name} `) ? name : "";
  let rest = escapeHtml(lead ? full.slice(lead.length + 1) : full);
  if (abbr) {
    const word = escapeHtml(abbr.word);
    rest = rest.replace(word, `<span class="scp-stp-xs">${word}</span><span class="scp-ph-abbr" data-abbr="${escapeHtml(abbr.short)}"></span>`);
  }
  return lead ? `<span class="scp-stp-xs">${escapeHtml(lead)} </span>${rest}` : rest;
}
