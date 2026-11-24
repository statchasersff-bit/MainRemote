/**
 * Everything the matchup page renders, for one canonical pair.
 *
 * Built ON the team pages' data rather than beside it: each side is the same
 * TeamPageData the hub renders - record, schedule, stats, snapshot, injuries -
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
import { isUpcomingFixture, pairInPreviewMode, PREVIEW_WINDOW_MS, type MatchupGameRef, type MatchupPair, type MeetingFacts } from "./pair";
import { getFpaTable, type FpaRow } from "../fpa/fpa-data";
import { getGameBoxscore, type GameBoxscore } from "./boxscore";
import { loadGamePbp } from "./play-by-play";
import { pbpScoringPlays, refineEspnDrives, withGameEnding } from "./play-facts";
import { findGameStoryEntry } from "./recap-overview";
import { buildGameStats, type GameStats } from "./game-stats";
import { logger } from "../logger";
import { getKickoffForecast, getWeekLines } from "./game-lines";
import { getPostseason, getSeasonSlate } from "../schedule/schedule-data";
import { gameStateRecord, matchupCachePolicy, type GameStateRecord, type MatchupCachePolicy } from "./game-state";
import { buildPreview, type Preview } from "./preview";

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
  /** "Week 1", or "Super Bowl" - what to print where a week number would go. */
  weekLabel: string;
  /** ESPN's id for the game, which the box score is keyed by. Often null. */
  espnEventId: string | null;
  /** The slate's id ("2026_11_IND_HOU"): how the game's live state is looked up. */
  gameId: string;
  kickoffMs: number | null;
  timeConfirmed: boolean;
  home: NflTeam;
  away: NflTeam;
  neutralSite: boolean;
  venue: string | null;
  venueCity: string | null;
  venueState: string | null;
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
 * Null when the FPA ingest has not run - see getFpaTable(), which returns null
 * rather than 32 zeroes for exactly that case. A side is null on its own when
 * the table cannot resolve that team, which is the same tolerance the FPA page
 * itself has for an abbreviation it does not know.
 */
export interface MatchupFpa {
  a: FpaRow | null;
  b: FpaRow | null;
  season: number;
  /** "Week 3", "Preseason Baseline" - what the numbers are drawn from. */
  dataMode: string;
  format: string;
  /**
   * The same two rows in each scoring (mak, 2026-11-02: the preview's
   * PPR / Half PPR / Standard switch drives every points-allowed figure). A
   * format whose table did not load is null there and the page falls back to
   * PPR for it.
   */
  byFormat: Record<"ppr" | "half" | "std", { a: FpaRow | null; b: FpaRow | null } | null>;
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
  /**
   * The winner's whole postseason, when the featured game is a playoff final:
   * what the win led to, for the recap. Null for a regular-season game, a tie,
   * or a document ESPN would not serve.
   */
  winnerPostseason: ScheduleGame[] | null;
  /**
   * Both clubs' whole seasons - regular season then postseason - for the
   * featured final: what the result meant, the game before and after it, and
   * where the winner went next. Null pregame; a side is empty when ESPN would
   * not serve its schedule.
   */
  seasonGames: { a: ScheduleGame[]; b: ScheduleGame[] } | null;
  /** Who played in the featured game and what it meant. Null pregame. */
  gameStats: GameStats | null;
  /**
   * The meeting a game address pinned, when the URL asked for one.
   *
   * When set it REPLACES featured, so every postgame block on the page - hero,
   * line score, leaders, player stats, takeaways, usage - describes this game
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
   * Whether the pinned FIXTURE is the one the pair's own address is
   * previewing (pairPreviewsMeeting in pair.ts): the dated preview then
   * canonicalizes up to the pair's address and carries no SportsEvent.
   *
   * Never true for a finished game since WEB-001 (2026-11-24): every finished
   * game is canonical at its own dated address. From 2026-10-10 until then
   * this was also true for this season's latest result, which folded the
   * dated recap onto the pair's URL.
   */
  pinnedIsCurrent: boolean;
  /**
   * An unplayed meeting a game address asked for (Team Pages Phase 7,
   * 2026-11-20): this season's, not canceled. When set, `pinned` stays null
   * and the page renders exactly what the pair's own address renders in
   * preview mode - the same preview, featured on this meeting - so a
   * rematch has its own preview before the pair's page gets to it.
   *
   * Only built when the caller can carry the indexing rules for it (the
   * plugin's X-SC-Matchup-Preview header, or this origin's own page); for
   * anyone else the address stays the 404 it always was.
   */
  pinnedFixture: Meeting | null;
  /**
   * The pinned fixture is NOT the one the pair's page is previewing: the
   * page is noindex and declares no canonical, so it never competes with an
   * indexed URL. Once the pair's page takes the game over, pinnedIsCurrent
   * is true instead and the existing canonical-up rule applies.
   */
  pinnedPreview: boolean;
  /**
   * The meeting the pair's page summarizes above its preview: the latest
   * played meeting this season, else the latest from the seasons before,
   * with its box score when one is stored. Null on every page but the
   * pair's own in preview mode, and when the two have never met.
   */
  lastMeeting: { meeting: Meeting; boxscore: GameBoxscore | null } | null;
  /** Latest fetch stamp across the history schedules, for the cache key. */
  historyFetchedAt: number;
  /**
   * The upcoming page's decision layer (lines, The Call, Start/Sit, leverage).
   * Null on every other state, and when the inputs are not there to build it.
   */
  preview: Preview | null;
  /**
   * The state of the game this page is about, from the slate row the
   * schedule prints (game-state.ts, WEB-040): the dated page's own game, or
   * the game the pair's page leads with. Null for a game from an earlier
   * season or a page with no current game.
   */
  gameState: GameStateRecord | null;
  /** How long a shared cache may keep this page (game-state.ts). */
  cachePolicy: MatchupCachePolicy;
}

/** Prior seasons searched for meetings, in both halves of each - see schedule.ts. */
export const HISTORY_SEASONS = 5;




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
    gameId: game.gameId,
    kickoffMs: game.kickoffMs,
    timeConfirmed: game.timeConfirmed,
    home,
    away,
    neutralSite: game.neutralSite,
    venue: game.venue,
    venueCity: game.venueCity,
    venueState: game.venueState ?? null,
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
 * document and a postseason document, and a pair that met in both - a division
 * rival in Week 3 and again in the Divisional Round - has meetings in each.
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
  return isUpcomingFixture(meeting.status === "final", meeting.kickoffMs, now, meeting.status === "live");
}

/** A meeting as the ownership rule in pair.ts reads it. */
function facts(meeting: Meeting): MeetingFacts {
  return { kickoffMs: meeting.kickoffMs, isFinal: meeting.status === "final", inPlay: meeting.status === "live" };
}

/**
 * Which state the page is in, and the meeting it leads with.
 *
 * The latest result keeps the page (pairInPreviewMode in pair.ts): with a
 * meeting behind and another ahead - a divisional pair in the back half of
 * the season - the page stays the recap of the one played until the rematch
 * is within six days, then turns into the preview, then goes back to being a
 * recap once the rematch is played. "recently_completed" is therefore the
 * state of every pair that has met this season and is not previewing a
 * rematch, however long ago the game was. The pair's page is the series page
 * and self-canonical; the game it leads with is canonical at its own dated
 * address (WEB-001), which the page links. A pair that has not met this season is "historical",
 * leading with the latest meeting of the seasons before.
 */
function decide(
  thisSeason: Meeting[],
  history: Meeting[],
  now: number,
): { matchupState: MatchupState; featured: Meeting | null } {
  const played = thisSeason.filter((meeting) => meeting.status === "final");
  const last = played[played.length - 1];

  if (pairInPreviewMode(thisSeason.map(facts), now)) {
    const next = thisSeason.find((meeting) => isUpcoming(meeting, now));
    if (next) return { matchupState: "upcoming", featured: next };
  }

  if (last) return { matchupState: "recently_completed", featured: last };

  return { matchupState: "historical", featured: history[0] ?? null };
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
  allowFixture = false,
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
  // decide() chose. Only a finished game with a score can be pinned - there is
  // no recap of a fixture, and a week that did not finish is not an address.
  // Matched on the season type as well as the week. Without it a pair that met
  // in Week 5 and again in the Super Bowl - postseason week 5 - would have two
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

  // An unplayed meeting at its own address (Phase 7). This season's only:
  // a fixture from another season is not a game anyone can preview, and a
  // canceled one is not a game at all. A finished game at the address wins.
  const pinnedFixture =
    game && !pinned && allowFixture && game.season === state.season
      ? (thisSeason.find(
          (meeting) =>
            meeting.week === game.week &&
            meeting.seasonType === game.seasonType &&
            meeting.status !== "final" &&
            meeting.status !== "canceled",
        ) ?? null)
      : null;

  const featured = pinned ?? pinnedFixture ?? natural.featured;
  // The dated preview is a preview whatever the pair's page is doing.
  const matchupState: MatchupState = pinnedFixture ? "upcoming" : natural.matchupState;
  // The pair's page is previewing this very fixture (pairPreviewsMeeting).
  // Matched on the meeting itself rather than the event id, which a schedule
  // row can lack. A finished game is never "current": it is canonical at its
  // own dated address (WEB-001).
  const pinnedIsCurrent =
    pinnedFixture !== null &&
    natural.matchupState === "upcoming" &&
    natural.featured === pinnedFixture;
  const pinnedPreview = pinnedFixture !== null && !pinnedIsCurrent;

  // What the preview summarizes: the latest meeting played, this season
  // first. Its box score is one stored read; a refusal costs the scorers,
  // not the line.
  let lastMeeting: MatchupData["lastMeeting"] = null;
  if (matchupState === "upcoming" && (!game || pinnedFixture)) {
    const played = thisSeason.filter((m) => m.status === "final" && m.score !== null);
    const meeting = played[played.length - 1] ?? history.find((m) => m.score !== null) ?? null;
    if (meeting) {
      lastMeeting = { meeting, boxscore: await getGameBoxscore(meeting.espnEventId) };
    }
  }

  // Allowed to fail on its own, like the prior-season schedules above: an FPA
  // table that will not load costs this page one block, not the page.
  // PPR, the format the matchup pages are called for (mak, 2026-10-05).
  const [fpaTable, fpaHalf, fpaStd] = await Promise.all([
    getFpaTable({ format: "ppr" }).catch(() => null),
    getFpaTable({ format: "half" }).catch(() => null),
    getFpaTable({ format: "standard" }).catch(() => null),
  ]);
  const rowFor = (table: typeof fpaTable, team: NflTeam): FpaRow | null =>
    table?.rows.find((row) => row.team?.abbreviation === team.abbreviation) ?? null;
  const fpaFor = (team: NflTeam): FpaRow | null => rowFor(fpaTable, team);
  const pairRows = (table: typeof fpaTable) => (table ? { a: rowFor(table, pair.a), b: rowFor(table, pair.b) } : null);
  const fpa: MatchupFpa | null = fpaTable
    ? {
        a: fpaFor(pair.a),
        b: fpaFor(pair.b),
        season: fpaTable.season,
        dataMode: fpaTable.dataMode,
        format: fpaTable.format,
        byFormat: { ppr: pairRows(fpaTable), half: pairRows(fpaHalf), std: pairRows(fpaStd) },
      }
    : null;

  // Everything below is about the featured game and exists only once it has
  // been played. Each piece is allowed to fail on its own, in the same way the
  // history schedules and the FPA table above are: a postgame block that cannot
  // be built is a block the page does not draw, never a page that does not
  // render.
  const isFinal = featured?.status === "final";
  const boxscore = isFinal ? withPlayByPlay(await getGameBoxscore(featured.espnEventId), featured) : null;

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

  // What the win led to. One more ESPN document, and only for a playoff final
  // - the same cached request the history above makes for pair.a.
  const winnerPostseason =
    isFinal && featured.seasonType === "post" && featured.winner
      ? ((await getTeamPostseason(featured.winner, featured.season).catch(() => null))
          ?.games ?? null)
      : null;

  const seasonGames = isFinal
    ? await Promise.all(
        [pair.a, pair.b].map(async (team) => {
          const [regular, post] = await Promise.all([
            getTeamSchedule(team, featured.season).catch(() => null),
            getTeamPostseason(team, featured.season).catch(() => null),
          ]);
          return [...(regular?.games ?? []), ...(post?.games ?? [])];
        }),
      ).then(([ga, gb]) => ({ a: ga ?? [], b: gb ?? [] }))
    : null;

  const data: MatchupData = {
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
    winnerPostseason,
    seasonGames,
    gameStats,
    pinned,
    pinnedRequested: game !== null,
    pinnedIsCurrent,
    pinnedFixture,
    pinnedPreview,
    lastMeeting,
    // Across both documents of every prior season, so a postseason that
    // refreshes on its own still moves the fragment's cache key.
    historyFetchedAt: prior
      .flat()
      .reduce((max, schedule) => Math.max(max, schedule?.fetchedAt ?? 0), 0),
    preview: null,
    gameState: null,
    cachePolicy: { state: "settled", changeAtMs: null },
  };

  // The game's state, from the same slate row the schedule prints. Only for
  // the current season: an earlier season's game is history, and its page
  // has nothing live to say.
  const subject = featured && featured.season === state.season ? featured : null;
  if (subject) {
    data.gameState = await loadGameState(subject, isFinal ? boxscore !== null : null).catch(() => null);
  }
  data.cachePolicy = matchupCachePolicy(data.gameState, now, pageChangeAt(thisSeason, data, now));

  // The decision layer, upcoming pair pages only. Lines and the forecast are
  // each allowed to fail; buildPreview leaves out what they would have fed.
  if (matchupState === "upcoming" && (!game || pinnedFixture) && featured) {
    const lines = await getWeekLines(state.season, featured.week, featured.seasonType === "post" ? "post" : "regular").catch(() => null);
    const line = lines?.games.find((g) => g.eventId === featured.espnEventId) ?? null;
    const forecast =
      line?.indoor === false
        ? await getKickoffForecast(featured.venueCity, featured.venueState, featured.kickoffMs).catch(() => null)
        : null;
    try {
      // The season slate's closing lines feed the betting trends; allowed to fail.
      const slate = featured.seasonType === "post" ? null : await getSeasonSlate(state.season, now).catch(() => null);
      data.preview = buildPreview(data, { lines, forecast, now, slate: slate?.games ?? null });
    } catch (err) {
      logger.warn({ err, matchup: pair.slug }, "Matchup preview failed");
    }
  }
  return data;
}

/** The slate row for one meeting, as a GameStateRecord, or null when the slate has none. */
async function loadGameState(meeting: Meeting, detailsReady: boolean | null): Promise<GameStateRecord | null> {
  if (meeting.seasonType === "post") {
    const rounds = await getPostseason(meeting.season);
    const row = rounds.find((g) => g.id === meeting.gameId);
    return row ? gameStateRecord(row, { season: meeting.season, seasonType: "post", detailsReady }) : null;
  }
  const slate = await getSeasonSlate(meeting.season);
  const row = slate?.games.find((g) => g.id === meeting.gameId);
  return row
    ? gameStateRecord(row, {
        season: meeting.season,
        seasonType: "regular",
        sourceUpdatedAtMs: slate?.updatedAtMs ?? null,
        detailsReady,
      })
    : null;
}

/**
 * When the page changes on its own clock with no data change: the pair's
 * page turns into the preview six days before the next meeting
 * (PREVIEW_WINDOW_MS). Only the pair's own address leads by that rule; a
 * dated page is always its own game. Null when nothing is scheduled to flip.
 */
function pageChangeAt(thisSeason: Meeting[], data: MatchupData, now: number): number | null {
  if (data.pinnedRequested || data.matchupState === "upcoming") return null;
  const next = thisSeason
    .filter((m) => m.status !== "final" && m.status !== "canceled" && m.kickoffMs !== null && m.kickoffMs > now)
    .sort((x, y) => (x.kickoffMs ?? 0) - (y.kickoffMs ?? 0))[0];
  return next?.kickoffMs != null ? next.kickoffMs - PREVIEW_WINDOW_MS : null;
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
    // A dated preview, and whether the pair's page has taken it over: the
    // switch changes the page's canonical and robots, so it must change the
    // ETag too, or a cache holding the noindex copy would get a 304.
    data.pinnedFixture
      ? `fx${data.pinnedFixture.season}${data.pinnedFixture.seasonType === "post" ? "p" : "w"}${data.pinnedFixture.week}${data.pinnedIsCurrent ? "own" : "pv"}`
      : "",
    // The postgame layer is keyed by the game it describes and by whether each
    // piece resolved: an ESPN refusal that later succeeds has to redraw the
    // page, and a cached fragment from the refusal would otherwise outlive it.
    data.featured?.espnEventId ?? "",
    data.boxscore ? "box" : "",
    data.winnerPostseason ? `post${data.winnerPostseason.length}` : "",
    data.gameStats ? "stats" : "",
    data.preview ? `pv${data.preview.updatedMs}` : "",
    // The game's live state, which the strip under the hero prints
    // (WEB-040). Mostly covered by the slate fingerprint above; this also
    // catches the box score arriving for a final.
    data.gameState ? `gs${data.gameState.version}` : "",
    // The preview's "Last meeting" block: which game, and whether its box
    // score was there to draw the scorers from.
    data.lastMeeting
      ? `last${data.lastMeeting.meeting.season}${data.lastMeeting.meeting.seasonType === "post" ? "p" : "w"}${data.lastMeeting.meeting.week}${data.lastMeeting.boxscore ? "box" : ""}`
      : "",
  ].join("|");
}

/**
 * The featured game's box score checked against its play-by-play (WEB-037,
 * play-facts.ts): each scoring play carries the snap's clock, the same one
 * the drive log, the recap and the win-probability list print, and the score
 * that ended the game says so; ESPN's "Missed FG" drives that were blocked
 * kicks say "blocked". A copy; the cached box score is not changed. Without
 * a stored play-by-play the box score is returned as it is.
 */
function withPlayByPlay(box: GameBoxscore | null, meeting: Meeting): GameBoxscore | null {
  if (!box) return box;
  const away = meeting.away.code.toUpperCase();
  const home = meeting.home.code.toUpperCase();
  const entry = findGameStoryEntry({ season: meeting.season, week: meeting.week, seasonType: meeting.seasonType, home, away });
  // The drive chart says how the game ended; a play-by-play alone cannot (WEB-037).
  const pbp = withGameEnding(entry ? loadGamePbp(meeting.season, entry.id) : null, box.drives);
  return {
    ...box,
    scoringPlays: pbpScoringPlays(box.scoringPlays ?? [], pbp, away, home),
    drives: box.drives ? refineEspnDrives(box.drives, pbp) : box.drives,
  };
}
