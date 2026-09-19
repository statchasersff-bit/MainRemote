/**
 * The canonical team pair.
 *
 * One page per pair of teams, not one per direction: "Patriots vs Eagles" and
 * "Eagles vs Patriots" are the same query, and two pages answering it compete
 * with each other. So every place in the app that turns two teams into a URL
 * comes through canonicalizeMatchupPair(), which puts them in one fixed order
 * — the teams' canonical slugs, alphabetically — and the URL is built from
 * that and nothing else. Which team's hub the reader came from cannot reach
 * the URL.
 *
 * Alphabetical because it is the one ordering that needs no data: home and
 * away swap between meetings, and "the team that hosts next" would move the
 * page every season. 32 teams give 32 × 31 / 2 = 496 pairs.
 */

import { getTeamBySlug, normalizeTeamName, type NflTeam } from "../team/teams";

export interface MatchupPair {
  /** Alphabetically first by slug. */
  a: NflTeam;
  /** Alphabetically second by slug. */
  b: NflTeam;
  /** `<a.slug>-vs-<b.slug>` — the URL segment. */
  slug: string;
}

/** The separator inside a pair slug. No team slug contains it. */
const SEPARATOR = "-vs-";

/**
 * Resolve any two team names to their one pair, or null.
 *
 * Accepts whatever normalizeTeamName() accepts — slugs, abbreviations,
 * nicknames, retired codes — and refuses a team against itself and anything it
 * cannot resolve. There is no partial answer: either both teams are real and
 * different, or there is no pair.
 */
export function canonicalizeMatchupPair(
  first: string | NflTeam | null | undefined,
  second: string | NflTeam | null | undefined,
): MatchupPair | null {
  const x = resolve(first);
  const y = resolve(second);
  if (!x || !y || x.abbreviation === y.abbreviation) return null;
  const [a, b] = x.slug < y.slug ? [x, y] : [y, x];
  return { a, b, slug: `${a.slug}${SEPARATOR}${b.slug}` };
}

function resolve(team: string | NflTeam | null | undefined): NflTeam | null {
  if (!team) return null;
  if (typeof team !== "string") return team;
  const raw = team.trim();
  if (!raw) return null;
  return getTeamBySlug(raw) ?? normalizeTeamName(raw);
}

export interface ParsedMatchupSlug {
  pair: MatchupPair;
  /** True when the slug given is already the canonical one, byte for byte. */
  canonical: boolean;
}

/**
 * Read a pair out of a URL segment.
 *
 * `new-england-patriots-vs-philadelphia-eagles` parses; so does
 * `philadelphia-eagles-vs-new-england-patriots` and `phi-vs-ne`, each with
 * `canonical: false` so the route can 301 them to the one address. The split
 * is on the FIRST "-vs-": team slugs never contain it, so there is exactly one.
 */
export function parseMatchupSlug(segment: string): ParsedMatchupSlug | null {
  const at = segment.indexOf(SEPARATOR);
  if (at <= 0) return null;
  const left = segment.slice(0, at);
  const right = segment.slice(at + SEPARATOR.length);
  if (!right || right.includes(SEPARATOR)) return null;
  const pair = canonicalizeMatchupPair(left, right);
  if (!pair) return null;
  return { pair, canonical: pair.slug === segment };
}

/** The other team in the pair. */
export function opponentOf(pair: MatchupPair, team: NflTeam): NflTeam {
  return team.abbreviation === pair.a.abbreviation ? pair.b : pair.a;
}
