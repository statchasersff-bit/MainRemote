/**
 * Player links inside written copy (WEB-044, 2026-11-24).
 *
 * The team tabs link a player wherever a table or card names him, but their
 * sentences - the Usage situational takeaways, the FAQ answers - named the
 * same players as plain text. This links the FIRST mention of each player in
 * a block of copy, the way an editor would, and leaves every later mention
 * alone.
 *
 * Identity is never read from the copy. The caller hands over the players the
 * block can be about (the club's usage rows), each already resolved to a
 * published profile by its ids (playerProfileUrl); this only finds where
 * those exact full names are written. A surname alone ("Gibbs's Workload")
 * is not matched, a name two of the players share is not linked at all, and a
 * player with no published page has no href and is skipped.
 *
 * Works on escaped HTML. Existing anchors (the FAQ's tool links) and any tag
 * are opaque: a name is never linked inside another link or an attribute.
 */

import { escapeHtml as e } from "../render";
import { playerProfileUrl } from "./links";
import { usageRef } from "./overview";
import type { UsageView } from "./usage";

export interface ProsePlayer {
  name: string;
  href: string | null;
}

/** Opaque runs: a whole anchor, or any other tag. */
const OPAQUE = /(<a\b[^>]*>[\s\S]*?<\/a>|<[^>]+>)/i;

const WORD = /[A-Za-z0-9À-ɏ]/;

/** The candidates worth looking for: published, full names, and unique in the list. */
function candidates(players: readonly ProsePlayer[]): Array<{ needle: string; href: string; name: string }> {
  const count = new Map<string, number>();
  for (const p of players) {
    const k = p.name.trim().toLowerCase();
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  const seen = new Set<string>();
  const out: Array<{ needle: string; href: string; name: string }> = [];
  for (const p of players) {
    const name = p.name.trim();
    const k = name.toLowerCase();
    if (!p.href || !name.includes(" ") || count.get(k)! > 1 || seen.has(k)) continue;
    seen.add(k);
    out.push({ needle: e(name), href: p.href, name });
  }
  // Longest first, so "Michael Pittman Jr." is found before "Michael Pittman".
  return out.sort((a, b) => b.needle.length - a.needle.length);
}

/** The first whole-word occurrence of `needle` in `text`, or -1. */
function wordIndex(text: string, needle: string): number {
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at < 0) return -1;
    const before = at > 0 ? text.charAt(at - 1) : "";
    const after = text.charAt(at + needle.length);
    if (!(before && WORD.test(before)) && !(after && WORD.test(after))) return at;
    from = at + 1;
  }
}

/**
 * `html` with the first mention of each player linked. `className` is added
 * beside `sct-player-link`.
 */
export function linkFirstMentions(html: string, players: readonly ProsePlayer[], className = "sct-prose-player"): string {
  const wanted = candidates(players);
  if (wanted.length === 0 || !html) return html;
  // Segments alternate text / opaque; only text segments are searched.
  const parts = html.split(OPAQUE);
  for (const w of wanted) {
    for (let i = 0; i < parts.length; i += 2) {
      const text = parts[i]!;
      const at = wordIndex(text, w.needle);
      if (at < 0) continue;
      const anchor = `<a class="${className} sct-player-link" href="${e(w.href)}" target="_top">${w.needle}</a>`;
      // Split the text segment around the new anchor, which becomes opaque.
      parts.splice(i, 1, text.slice(0, at), anchor, text.slice(at + w.needle.length));
      break;
    }
  }
  return parts.join("");
}

/** The club's usage rows as prose candidates, each resolved like the hub's rows (by id). */
export function usageProsePlayers(view: UsageView | null): ProsePlayer[] {
  return (view?.all ?? []).map((p) => ({ name: p.name, href: playerProfileUrl(p.name, usageRef(p)) }));
}
