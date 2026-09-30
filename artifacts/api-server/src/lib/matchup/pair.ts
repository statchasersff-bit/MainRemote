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

import type { SeasonType } from "../team/schedule";
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
 * How long a finished meeting keeps the pair's own address to itself.
 *
 * Two weeks: long enough that a result is still the thing a reader arriving at
 * the pair's address is asking about, and short enough that the takeaways —
 * which are advice for the coming week — come off the page while they are still
 * true. A Sunday game therefore keeps the recap layout through the Sunday after
 * it, and lets go on the second Monday.
 *
 * It lives here, beside the two functions that spell an address, because it is
 * the rule that decides WHICH address a finished game has: inside the window
 * the recap is the pair's page and the dated URL 301s up to it, outside it the
 * dated URL is the page. matchup-data.ts applies it when it decides what to
 * lead with, and anything building a link to a past meeting — the schedule
 * board's row links, for one — has to ask the same question or it generates
 * redirects.
 */
export const RECENT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** A game still counts as upcoming this long after its listed kickoff. */
export const IN_PROGRESS_GRACE_MS = 4 * 60 * 60 * 1000;

/**
 * Is this fixture still one the pair's page would lead with as upcoming?
 *
 * The same test matchup-data.ts decides the page's state with: not final, and
 * either undated or kicked off less than IN_PROGRESS_GRACE_MS ago.
 */
export function isUpcomingFixture(isFinal: boolean, kickoffMs: number | null, now: number): boolean {
  return !isFinal && (kickoffMs === null || kickoffMs + IN_PROGRESS_GRACE_MS > now);
}

/**
 * Does this finished meeting have a dated address of its own yet?
 *
 * False while it is still what the pair's page leads with, and false for
 * anything that is not a finished game with a kickoff behind it — there is no
 * recap of a fixture, so there is no dated page for one either.
 *
 * `rematchAhead` is whether the two clubs still have an upcoming meeting this
 * season. Upcoming beats recent on the pair's page, so a divisional game
 * inside the window is already let go of and its recap lives at the dated URL.
 */
export function meetingHasOwnAddress(
  kickoffMs: number | null,
  isFinal: boolean,
  now: number,
  rematchAhead = false,
): boolean {
  if (!isFinal || kickoffMs === null) return false;
  return rematchAhead || now - kickoffMs > RECENT_WINDOW_MS;
}

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

/**
 * One meeting, addressed by the season and week it was played.
 *
 * The pair's own address leads with whatever game is current; this is how a
 * reader — or a search result — asks for a specific one instead. See
 * gameSegment() for the spelling.
 */
export interface MatchupGameRef {
  season: number;
  week: number;
  /**
   * Which half of the season the week belongs to.
   *
   * Not optional, because a week number alone stopped identifying a game the
   * moment the postseason entered the history: ESPN numbers the postseason from
   * 1 again, so a pair that met in Week 5 and again in the Super Bowl — which
   * is postseason week 5 — has two games that a `{season, week}` would match
   * equally well. Defaulted nowhere: a caller that does not know which half it
   * means has a bug rather than a reasonable fallback.
   */
  seasonType: SeasonType;
}

/**
 * The postseason rounds, as they are spelled in an address.
 *
 * Named rather than numbered — `/2025-super-bowl/` rather than
 * `/2025-post-week-5/` — because the name is what a reader types and what a
 * search engine matches, and because "post week 5" is not a thing anybody calls
 * the Super Bowl. The numbers are ESPN's week numbers within its postseason.
 */
const ROUND_SLUGS: ReadonlyArray<readonly [number, string]> = [
  [1, "wild-card"],
  [2, "divisional"],
  [3, "conference-championship"],
  [5, "super-bowl"],
];

const SLUG_BY_ROUND = new Map<number, string>(ROUND_SLUGS);
const ROUND_BY_SLUG = new Map<string, number>(
  ROUND_SLUGS.map(([week, slug]) => [slug, week]),
);

/** The URL spelling of one game: `2026-week-1`, or `2025-super-bowl`. */
export function gameSegment(ref: MatchupGameRef): string {
  if (ref.seasonType === "post") {
    const slug = SLUG_BY_ROUND.get(ref.week);
    // A round this app has no name for still needs an address, and it needs one
    // that cannot collide with a regular-season week.
    return `${ref.season}-${slug ?? `postseason-week-${ref.week}`}`;
  }
  return `${ref.season}-week-${ref.week}`;
}

/**
 * Read a game out of a URL segment, or null.
 *
 * Deliberately strict, and a 404 rather than a 301 for anything near it:
 * `2026-week-01`, `2026-WEEK-1` and `2026-wk-1` are spellings nothing on this
 * site generates, so they are not addresses that lost their page — they are
 * addresses that never existed. The pair slug redirects every alternate
 * spelling because readers really do type "eagles vs patriots"; nobody types a
 * week number three ways.
 */
const GAME_SEGMENT = /^(\d{4})-week-([1-9]\d?)$/;
const ROUND_SEGMENT = /^(\d{4})-([a-z-]+)$/;
const POST_WEEK_SEGMENT = /^(\d{4})-postseason-week-([1-9]\d?)$/;

/** The schedule this app reads starts well after 1920. */
function seasonInRange(season: number): boolean {
  return season >= 1920 && season <= 2200;
}

export function parseGameSegment(segment: string): MatchupGameRef | null {
  const week = GAME_SEGMENT.exec(segment);
  if (week) {
    const season = Number(week[1]);
    const number = Number(week[2]);
    // A regular season is 18 weeks; the bounds are here to keep a
    // parsed-but-impossible ref from reaching the data layer, not to express a
    // real limit.
    if (!seasonInRange(season) || number > 25) return null;
    return { season, week: number, seasonType: "regular" };
  }

  const fallback = POST_WEEK_SEGMENT.exec(segment);
  if (fallback) {
    const season = Number(fallback[1]);
    const number = Number(fallback[2]);
    if (!seasonInRange(season) || number > 25) return null;
    return { season, week: number, seasonType: "post" };
  }

  const round = ROUND_SEGMENT.exec(segment);
  if (round) {
    const season = Number(round[1]);
    const number = ROUND_BY_SLUG.get(round[2] ?? "");
    if (!seasonInRange(season) || number === undefined) return null;
    return { season, week: number, seasonType: "post" };
  }

  return null;
}

/** The other team in the pair. */
export function opponentOf(pair: MatchupPair, team: NflTeam): NflTeam {
  return team.abbreviation === pair.a.abbreviation ? pair.b : pair.a;
}
