/**
 * Everything the matchup page renders, for one canonical pair.
 *
 * Built ON the team pages' data rather than beside it: each side is the same
 * TeamPageData the hub renders — record, schedule, stats, snapshot, injuries —
 * so a number on the matchup page is by construction the number on the team
 * page, and the providers behind them are cached once for both. What this
 * adds is the pair's own facts: the meetings between the two on the current
 * schedule, the meetings in the seasons before it, and which of three states
 * the page is in.
 *
 * The state is decided HERE, once. The renderer asks "which state" and lays the
 * page out for it; it never asks "is kickoff in the past" itself, so the rule
 * for what counts as upcoming or recent lives in one place and cannot drift
 * between sections.
 */

import { getTeamPostseason, getTeamSchedule, type ScheduleGame } from "../team/schedule";
import { getTeamPageData, dataVersion, type TeamPageData } from "../team/team-data";
import type { NflTeam } from "../team/teams";
import type { NflState } from "../team/nfl-state";
import type { MatchupGameRef, MatchupPair } from "./pair";
import { getFpaTable, parseFpaFormat, type FpaRow } from "../fpa/fpa-data";
import { getGameBoxscore, type GameBoxscore } from "./boxscore";
import { buildGameStats, type GameStats } from "./game-stats";
import { getFpaDelta, type FpaDelta } from "./fpa-delta";

export type MatchupState = "upcoming" | "recently_completed" | "historical";

/** One game between the two teams, from nobody's perspective. */
export interface Meeting {
  season: number;
  week: number;
  /**
   * Which half of the season the week number belongs to. A season has a week 1
   * in each, so this is half of a meeting's identity rather than a detail.
   */
  seasonType: ScheduleGame["seasonType"];
  /** "Week 1", or "Super Bowl" — what to print where a week number would go. */
  weekLabel: string;
  /** ESPN's id for the game, which the box score is keyed by. Often null. */
  espnEventId: string | null;
  kickoffMs: number | null;
  timeConfirmed: boolean;
  home: NflTeam;
  away: NflTeam;
  neutralSite: boolean;
  venue: string | null;
  venueCity: string | null;
  network: string | null;
  status: ScheduleGame["status"];
  /** Final score keyed by side; null until the game is final. */
  score: { home: number; away: number } | null;
  /** Null until final, and null for a tie. */
  winner: NflTeam | null;
}

export interface HeadToHead {
  aWins: number;
  bWins: number;
  ties: number;
  /** Meetings counted, regular season and postseason, oldest season included. */
  games: number;
  fromSeason: number | null;
}

/**
 * The two defenses' fantasy-points-allowed rows, and what season they describe.
 *
 * Null when the FPA ingest has not run — see getFpaTable(), which returns null
 * rather than 32 zeroes for exactly that case. A side is null on its own when
 * the table cannot resolve that team, which is the same tolerance the FPA page
 * itself has for an abbreviation it does not know.
 */
export interface MatchupFpa {
  a: FpaRow | null;
  b: FpaRow | null;
  season: number;
  /** "Week 3", "Preseason Baseline" — what the numbers are drawn from. */
  dataMode: string;
  format: string;
}

export interface MatchupData {
  pair: MatchupPair;
  state: NflState;
  matchupState: MatchupState;
  /**
   * The game the page leads with: the next meeting when there is one, the
   * just-played one when there is not, the most recent of any season
   * otherwise. Null only when the two have not met in the window we look at.
   */
  featured: Meeting | null;
  /** Every meeting on the current schedule, in week order. */
  thisSeason: Meeting[];
  /** Completed meetings from prior seasons, newest first. */
  history: Meeting[];
  record: HeadToHead;
  a: TeamPageData;
  b: TeamPageData;
  /** What each defense gives up by position, for the Fantasy Matchups block. */
  fpa: MatchupFpa | null;
  /**
   * The featured game's box score, when it is final and ESPN answers.
   *
   * Null is the ordinary case, not an error: a meeting before the schedule
   * carried an event id, a game not yet played, an upstream that refused. Every
   * block built on it renders only when it is here.
   */
  boxscore: GameBoxscore | null;
  /** Who played in the featured game and what it meant. Null pregame. */
  gameStats: GameStats | null;
  /** What the featured game did to both defenses' FPA ranks. Null pregame. */
  fpaDelta: FpaDelta | null;
  /**
   * The meeting a game address pinned, when the URL asked for one.
   *
   * When set it REPLACES featured, so every postgame block on the page — hero,
   * line score, leaders, player stats, takeaways, usage — describes this game
   * rather than whichever one is current. Null on the pair's own address.
   */
  pinned: Meeting | null;
  /**
   * Whether a game address was asked for at all.
   *
   * The pair of this and a null `pinned` is the 404: a week these two did not
   * play, or played and never finished.
   */
  pinnedRequested: boolean;
  /**
   * Whether the pinned game is the one the pair's own address is already
   * leading with.
   *
   * The dated URL exists only once the pair page has let the game go. While it
   * is still inside RECENT_WINDOW_MS the recap has exactly one address, and the
   * route reads this to send the dated one there.
   */
  pinnedIsCurrent: boolean;
  /** Latest fetch stamp across the history schedules, for the cache key. */
  historyFetchedAt: number;
}

/** Prior seasons searched for meetings, in both halves of each — see schedule.ts. */
const HISTORY_SEASONS = 5;

/**
 * How long after kickoff a completed meeting still leads the page.
 *
 * Two weeks: long enough that a result is still the thing a reader arriving at
 * the pair's address is asking about, and short enough that the takeaways —
 * which are advice for the coming week — come off the page while they are still
 * true. A Sunday game therefore keeps the recap layout through the Sunday after
 * it, and lets go on the second Monday.
 */
const RECENT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** A game still counts as upcoming this long after its listed kickoff. */
const IN_PROGRESS_GRACE_MS = 4 * 60 * 60 * 1000;

/** A's schedule row against B, turned into a meeting between the two. */
function meetingFrom(game: ScheduleGame, season: number, a: NflTeam, b: NflTeam): Meeting {
  const aHome = game.homeAway === "home";
  const home = aHome ? a : b;
  const away = aHome ? b : a;
  const score = game.result
    ? aHome
      ? { home: game.result.teamScore, away: game.result.opponentScore }
      : { home: game.result.opponentScore, away: game.result.teamScore }
    : null;
  const winner = game.result
    ? game.result.outcome === "W"
      ? a
      : game.result.outcome === "L"
        ? b
        : null
    : null;
  return {
    season,
    week: game.week,
    seasonType: game.seasonType,
    weekLabel: game.weekLabel,
    espnEventId: game.espnEventId,
    kickoffMs: game.kickoffMs,
    timeConfirmed: game.timeConfirmed,
    home,
    away,
    neutralSite: game.neutralSite,
    venue: game.venue,
    venueCity: game.venueCity,
    network: game.network,
    status: game.status,
    score,
    winner,
  };
}

/** Regular season first, then the postseason, then by week within each. */
function inPlayingOrder(x: Meeting, y: Meeting): number {
  if (x.seasonType !== y.seasonType) return x.seasonType === "regular" ? -1 : 1;
  return x.week - y.week;
}

/**
 * Every meeting between the two in one season, across both halves of it.
 *
 * Takes a list of schedules rather than one: a season is a regular-season
 * document and a postseason document, and a pair that met in both — a division
 * rival in Week 3 and again in the Divisional Round — has meetings in each.
 * Before this took the postseason, a Super Bowl between the two was simply
 * absent from the record: the page said "2–0" of a pair that had played three
 * times, and the meeting a reader most wanted was the one it did not list.
 */
function meetingsIn(
  schedules: Array<ScheduleGame[] | undefined>,
  season: number,
  a: NflTeam,
  b: NflTeam,
): Meeting[] {
  return schedules
    .flatMap((games) => games ?? [])
    .filter((game) => game.opponent?.abbreviation === b.abbreviation)
    .map((game) => meetingFrom(game, season, a, b))
    .sort(inPlayingOrder);
}

function isUpcoming(meeting: Meeting, now: number): boolean {
  return (
    meeting.status !== "final" &&
    (meeting.kickoffMs === null || meeting.kickoffMs + IN_PROGRESS_GRACE_MS > now)
  );
}

/**
 * Which state the page is in, and the meeting it leads with.
 *
 * Upcoming beats recent: with a meeting behind and another ahead — a divisional
 * pair in the back half of the season — the reader wants the one they can
 * still watch. Recent means final within RECENT_WINDOW_MS of kickoff, which is
 * long enough to cover the week after and short enough that a September result
 * is not still "recent" in November.
 */
function decide(
  thisSeason: Meeting[],
  history: Meeting[],
  now: number,
): { matchupState: MatchupState; featured: Meeting | null } {
  const next = thisSeason.find((meeting) => isUpcoming(meeting, now));
  if (next) return { matchupState: "upcoming", featured: next };

  const played = thisSeason.filter((meeting) => meeting.status === "final");
  const last = played[played.length - 1];
  if (
    last &&
    last.kickoffMs !== null &&
    now - last.kickoffMs <= RECENT_WINDOW_MS
  ) {
    return { matchupState: "recently_completed", featured: last };
  }

  return { matchupState: "historical", featured: last ?? history[0] ?? null };
}

function tally(meetings: Meeting[], a: NflTeam, b: NflTeam): HeadToHead {
  const record: HeadToHead = { aWins: 0, bWins: 0, ties: 0, games: 0, fromSeason: null };
  for (const meeting of meetings) {
    if (meeting.status !== "final" || !meeting.score) continue;
    record.games += 1;
    if (meeting.winner?.abbreviation === a.abbreviation) record.aWins += 1;
    else if (meeting.winner?.abbreviation === b.abbreviation) record.bWins += 1;
    else record.ties += 1;
    record.fromSeason =
      record.fromSeason === null ? meeting.season : Math.min(record.fromSeason, meeting.season);
  }
  return record;
}

export async function getMatchupData(
  pair: MatchupPair,
  now: number = Date.now(),
  game: MatchupGameRef | null = null,
): Promise<MatchupData> {
  const [a, b] = await Promise.all([getTeamPageData(pair.a), getTeamPageData(pair.b)]);
  const state = a.state;

  // Prior seasons, requested together. Each is one ESPN document and each is
  // allowed to fail on its own: a season that will not load is a season the
  // history is silent on, not a page that will not render.
  const priorSeasons = Array.from(
    { length: HISTORY_SEASONS },
    (_, i) => state.season - 1 - i,
  );
  // Two documents per season: the regular season and the postseason. Both are
  // allowed to fail on their own, and for most teams in most years the second
  // is legitimately empty.
  const prior = await Promise.all(
    priorSeasons.map((season) =>
      Promise.all([
        getTeamSchedule(pair.a, season).catch(() => null),
        getTeamPostseason(pair.a, season).catch(() => null),
      ]),
    ),
  );

  // The current season's regular schedule is already loaded with the team page
  // data; only its postseason has to be asked for here.
  const thisPostseason = await getTeamPostseason(pair.a, state.season).catch(
    () => null,
  );

  const thisSeason = meetingsIn(
    [a.schedule?.games, thisPostseason?.games],
    state.season,
    pair.a,
    pair.b,
  );
  const history = prior
    .flatMap(([regular, post], i) =>
      meetingsIn(
        [regular?.games, post?.games],
        priorSeasons[i] ?? 0,
        pair.a,
        pair.b,
      ).filter((meeting) => meeting.status === "final"),
    )
    // Newest first, and within a season the postseason came last so it is
    // listed first.
    .sort((x, y) => y.season - x.season || -inPlayingOrder(x, y));

  const natural = decide(thisSeason, history, now);

  // A game address pins its meeting; the pair's own address takes whatever
  // decide() chose. Only a finished game with a score can be pinned — there is
  // no recap of a fixture, and a week that did not finish is not an address.
  // Matched on the season type as well as the week. Without it a pair that met
  // in Week 5 and again in the Super Bowl — postseason week 5 — would have two
  // meetings answering to one address, and find() would hand back whichever the
  // playing order put first, which is never the one the address named.
  const pinned = game
    ? ([...thisSeason, ...history].find(
        (meeting) =>
          meeting.season === game.season &&
          meeting.week === game.week &&
          meeting.seasonType === game.seasonType &&
          meeting.status === "final" &&
          meeting.score !== null,
      ) ?? null)
    : null;

  const featured = pinned ?? natural.featured;
  const matchupState = natural.matchupState;
  const pinnedIsCurrent =
    pinned !== null &&
    natural.matchupState === "recently_completed" &&
    natural.featured?.espnEventId === pinned.espnEventId;

  // Allowed to fail on its own, like the prior-season schedules above: an FPA
  // table that will not load costs this page one block, not the page.
  const fpaTable = await getFpaTable().catch(() => null);
  const fpaFor = (team: NflTeam): FpaRow | null =>
    fpaTable?.rows.find(
      (row) => row.team?.abbreviation === team.abbreviation,
    ) ?? null;
  const fpa: MatchupFpa | null = fpaTable
    ? {
        a: fpaFor(pair.a),
        b: fpaFor(pair.b),
        season: fpaTable.season,
        dataMode: fpaTable.dataMode,
        format: fpaTable.format,
      }
    : null;

  // Everything below is about the featured game and exists only once it has
  // been played. Each piece is allowed to fail on its own, in the same way the
  // history schedules and the FPA table above are: a postgame block that cannot
  // be built is a block the page does not draw, never a page that does not
  // render.
  const isFinal = featured?.status === "final";
  const boxscore = isFinal ? await getGameBoxscore(featured.espnEventId) : null;

  // The takeaways flag a player who is on the CURRENT injury report, which is
  // the one thing on a postgame page that is about next week. Keyed by the
  // Sleeper id both sides of the join already use.
  const injured = new Map<string, string>();
  if (isFinal) {
    for (const side of [a, b]) {
      for (const player of side.injuries) {
        if (player.id && player.injuryStatus) injured.set(player.id, player.injuryStatus);
      }
    }
  }

  const gameStats = isFinal ? buildGameStats(featured, injured) : null;

  const fpaDelta =
    isFinal && featured.season === (fpaTable?.season ?? state.season)
      ? await getFpaDelta(
          featured.season,
          featured.week,
          parseFpaFormat(fpaTable?.format),
        ).catch(() => null)
      : null;

  return {
    pair,
    state,
    matchupState,
    featured,
    thisSeason,
    history,
    record: tally([...thisSeason, ...history], pair.a, pair.b),
    a,
    b,
    fpa,
    boxscore,
    gameStats,
    fpaDelta,
    pinned,
    pinnedRequested: game !== null,
    pinnedIsCurrent,
    // Across both documents of every prior season, so a postseason that
    // refreshes on its own still moves the fragment's cache key.
    historyFetchedAt: prior
      .flat()
      .reduce((max, schedule) => Math.max(max, schedule?.fetchedAt ?? 0), 0),
  };
}

/** Fingerprint of everything rendered, for the fragment cache. */
export function matchupVersion(data: MatchupData, contentVersion: string): string {
  return [
    data.pair.slug,
    dataVersion(data.a, contentVersion),
    dataVersion(data.b, contentVersion),
    data.historyFetchedAt,
    data.matchupState,
    // The pinned game is part of the identity of the render, not of the pair:
    // two URLs for one pair draw different pages from the same upstream data.
    data.pinned
      ? `${data.pinned.season}${data.pinned.seasonType === "post" ? "p" : "w"}${data.pinned.week}`
      : "",
    // The postgame layer is keyed by the game it describes and by whether each
    // piece resolved: an ESPN refusal that later succeeds has to redraw the
    // page, and a cached fragment from the refusal would otherwise outlive it.
    data.featured?.espnEventId ?? "",
    data.boxscore ? "box" : "",
    data.gameStats ? "stats" : "",
    data.fpaDelta ? "delta" : "",
  ].join("|");
}
