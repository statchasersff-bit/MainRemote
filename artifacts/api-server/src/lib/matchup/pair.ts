/**
 * The canonical team pair.
 *
 * One page per pair of teams, not one per direction: "Patriots vs Eagles" and
 * "Eagles vs Patriots" are the same query, and two pages answering it compete
 * with each other. So every place in the app that turns two teams into a URL
 * comes through canonicalizeMatchupPair(), which puts them in one fixed order
 * - the teams' canonical slugs, alphabetically - and the URL is built from
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
  /** `<a.slug>-vs-<b.slug>` - the URL segment. */
  slug: string;
}

/** The separator inside a pair slug. No team slug contains it. */
const SEPARATOR = "-vs-";

/**
 * How close the pair's next meeting has to be before the pair's own address
 * turns into its preview.
 *
 * Six days (the SEO brief of 2026-10-10): the searches a pair's address earns
 * are "{team} vs {team} match player stats", and a page that switched to a
 * preview the Tuesday after a divisional game was answering them with a game
 * thirteen weeks away. So the pair's page keeps the latest result - the full
 * recap and box score - until the rematch is within six days, and goes back
 * to it once the rematch has been played.
 *
 * It lives here, beside the two functions that spell an address, because it is
 * the rule that decides WHICH address a finished game is canonical at: while
 * the pair's page owns a game, the dated URL canonicalizes up to it and stays
 * out of the sitemap; once the pair's page has moved on, the dated URL is the
 * page. matchup-data.ts applies it when it decides what to lead with, and
 * anything building a link to a past meeting - the schedule board's row
 * links, for one - has to ask the same question or it links to a page that
 * declares itself a copy.
 *
 * Was a fourteen-day window ("RECENT_WINDOW_MS") until 2026-10-10, after which
 * the pair's page let the game go whatever came next; a pair with no rematch
 * now keeps its latest game for the rest of the season.
 */
export const PREVIEW_WINDOW_MS = 6 * 24 * 60 * 60 * 1000;

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

/** What the ownership rule needs to know about one of a pair's meetings. */
export interface MeetingFacts {
  kickoffMs: number | null;
  isFinal: boolean;
}

/**
 * Is the pair's own address in preview mode for its next meeting?
 *
 * `meetings` is every meeting between the two this season, played or not.
 * Preview mode when there is a meeting ahead and either nothing has been
 * played yet (there is no result to own) or the meeting ahead kicks off
 * within PREVIEW_WINDOW_MS. An undated fixture is not within six days of
 * anything, so a played game keeps the page until the league dates it.
 */
export function pairInPreviewMode(meetings: readonly MeetingFacts[], now: number): boolean {
  const next = nextMeeting(meetings, now);
  if (!next) return false;
  if (!meetings.some((m) => m.isFinal && m.kickoffMs !== null)) return true;
  return next.kickoffMs !== null && next.kickoffMs - now <= PREVIEW_WINDOW_MS;
}

/** The earliest upcoming meeting, undated ones last. */
function nextMeeting(meetings: readonly MeetingFacts[], now: number): MeetingFacts | null {
  let next: MeetingFacts | null = null;
  for (const m of meetings) {
    if (!isUpcomingFixture(m.isFinal, m.kickoffMs, now)) continue;
    if (!next) next = m;
    else if (m.kickoffMs !== null && (next.kickoffMs === null || m.kickoffMs < next.kickoffMs)) next = m;
  }
  return next;
}

/**
 * Is this finished meeting the one the pair's own address owns right now?
 *
 * The latest played meeting of the current season, while the pair's page is
 * not in preview mode. Only one game is ever owned, and a game from an
 * earlier season never is: those are archives at their own addresses.
 */
export function pairOwnsMeeting(
  game: MeetingFacts & { season: number },
  meetings: readonly MeetingFacts[],
  currentSeason: number,
  now: number,
): boolean {
  if (!game.isFinal || game.kickoffMs === null || game.season !== currentSeason) return false;
  const later = meetings.some((m) => m.isFinal && m.kickoffMs !== null && m.kickoffMs > game.kickoffMs!);
  if (later) return false;
  return !pairInPreviewMode(meetings, now);
}

/**
 * Is this finished meeting canonical at a dated address of its own?
 *
 * False while the pair's page owns it (pairOwnsMeeting), and false for
 * anything that is not a finished game with a kickoff behind it - there is no
 * recap of a fixture, so there is no dated page for one either.
 *
 * `meetings` is every meeting between the two in the game's season,
 * including this one; `currentSeason` is the league's. A game from a season
 * before it always has its own address.
 */
export function meetingHasOwnAddress(
  game: MeetingFacts & { season: number },
  meetings: readonly MeetingFacts[],
  currentSeason: number,
  now: number,
): boolean {
  if (!game.isFinal || game.kickoffMs === null) return false;
  return !pairOwnsMeeting(game, meetings, currentSeason, now);
}

/**
 * Resolve any two team names to their one pair, or null.
 *
 * Accepts whatever normalizeTeamName() accepts - slugs, abbreviations,
 * nicknames, retired codes - and refuses a team against itself and anything it
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
 * reader - or a search result - asks for a specific one instead. See
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
   * 1 again, so a pair that met in Week 5 and again in the Super Bowl - which
   * is postseason week 5 - has two games that a `{season, week}` would match
   * equally well. Defaulted nowhere: a caller that does not know which half it
   * means has a bug rather than a reasonable fallback.
   */
  seasonType: SeasonType;
}

/**
 * The postseason rounds, as they are spelled in an address.
 *
 * Named rather than numbered - `/2025-super-bowl/` rather than
 * `/2025-post-week-5/` - because the name is what a reader types and what a
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
 * site generates, so they are not addresses that lost their page - they are
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
