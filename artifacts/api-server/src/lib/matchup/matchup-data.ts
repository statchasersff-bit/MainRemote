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

import { getTeamSchedule, type ScheduleGame } from "../team/schedule";
import { getTeamPageData, dataVersion, type TeamPageData } from "../team/team-data";
import type { NflTeam } from "../team/teams";
import type { NflState } from "../team/nfl-state";
import type { MatchupPair } from "./pair";
import { getFpaTable, type FpaRow } from "../fpa/fpa-data";

export type MatchupState = "upcoming" | "recently_completed" | "historical";

/** One game between the two teams, from nobody's perspective. */
export interface Meeting {
  season: number;
  week: number;
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
  /** Regular-season meetings counted, oldest season included. */
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
  /** Latest fetch stamp across the history schedules, for the cache key. */
  historyFetchedAt: number;
}

/** Prior seasons searched for meetings. Regular season only — see schedule.ts. */
const HISTORY_SEASONS = 5;

/** How long after kickoff a completed meeting still leads the page. */
const RECENT_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;

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

function meetingsIn(
  games: ScheduleGame[] | undefined,
  season: number,
  a: NflTeam,
  b: NflTeam,
): Meeting[] {
  return (games ?? [])
    .filter((game) => game.opponent?.abbreviation === b.abbreviation)
    .map((game) => meetingFrom(game, season, a, b))
    .sort((x, y) => x.week - y.week);
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
  const prior = await Promise.all(
    priorSeasons.map((season) =>
      getTeamSchedule(pair.a, season).catch(() => null),
    ),
  );

  const thisSeason = meetingsIn(a.schedule?.games, state.season, pair.a, pair.b);
  const history = prior
    .flatMap((schedule, i) =>
      schedule
        ? meetingsIn(schedule.games, priorSeasons[i] ?? 0, pair.a, pair.b).filter(
            (meeting) => meeting.status === "final",
          )
        : [],
    )
    .sort((x, y) => y.season - x.season || y.week - x.week);

  const { matchupState, featured } = decide(thisSeason, history, now);

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
    historyFetchedAt: prior.reduce((max, s) => Math.max(max, s?.fetchedAt ?? 0), 0),
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
  ].join("|");
}
