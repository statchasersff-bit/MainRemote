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

/**
 * Which form a table that paints SURNAMES must widen a name to so that no two
 * players in it read alike (team audit T1, 2026-11-24). The Fantasy Finishes
 * table shows surnames on phones, where "St. Brown" (Amon-Ra) and "Brown"
 * (Marquise) share a Detroit table and "Wilson" means three players on
 * Arizona's. Names are compared by the last word of the surname, suffix
 * dropped, so "St. Brown" and "Brown" or "Harrison Jr." and "Harrison"
 * count as the same; such a name gets its initial ("A. St. Brown",
 * "M. Brown"), and the full name when the initial clashes too ("Darrel
 * Williams", "Damien Williams"). Unclashed names are absent from the map and
 * keep the surname.
 */
export type NameForm = "initial" | "full";

function splitName(name: string): { initial: string; last: string } | null {
  const full = name.trim().replace(/\s+/g, " ");
  const gap = full.indexOf(" ");
  if (gap <= 0) return null;
  return { initial: full.charAt(0).toLowerCase(), last: full.slice(gap + 1) };
}

function surnameKey(last: string): string {
  const core = last.replace(/\s+(jr\.?|sr\.?|ii|iii|iv|v)$/i, "");
  return (core.split(" ").pop() ?? core).toLowerCase().replace(/[^a-z]/g, "");
}

export function surnameClashes(names: Iterable<string>): Map<string, NameForm> {
  const groups = new Map<string, Map<string, { initial: string }>>();
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/g, " ");
    const parts = splitName(name);
    if (!parts) continue;
    const key = surnameKey(parts.last);
    const group = groups.get(key) ?? new Map<string, { initial: string }>();
    group.set(name, { initial: parts.initial });
    groups.set(key, group);
  }
  const out = new Map<string, NameForm>();
  for (const group of groups.values()) {
    if (group.size < 2) continue;
    for (const [name, { initial }] of group) {
      const twins = [...group.values()].filter((g) => g.initial === initial).length;
      out.set(name, twins > 1 ? "full" : "initial");
    }
  }
  return out;
}
