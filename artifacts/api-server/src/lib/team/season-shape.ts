/**
 * One team's season as a shape rather than as a list of fixtures.
 *
 * The schedule table three hundred pixels above this answers "when do they play
 * the Jets". It cannot answer "is this a hard draw", because that question is
 * about the eighteen weeks together: how the home games are spread, where the
 * bye falls, how many times the division comes round, which conference the
 * out-of-division opponents come from. Those are all arithmetic on rows the
 * table already prints - this module does the arithmetic once so the renderer
 * can draw it and schedule-faq.ts can keep quoting the same numbers.
 *
 * Ported from the standalone NFL schedule tool's team lens, whose four sidebar
 * cards were exactly these four readings. The numbers and the thresholds are
 * the same; what could not come across is the data shape. That tool holds a
 * whole league - a game carries `home` and `away` teams and is filtered down to
 * one club. The team hub holds one club's schedule, where a game carries
 * `homeAway` and an `opponent`, so the counting is rewritten against that
 * rather than the league rows being reconstructed from it.
 *
 * This is now the only copy. The lens has been removed from the schedule tool -
 * its `teamSeasonStats` went with it - because the two would otherwise be two
 * sets of arithmetic answering one question.
 *
 * ## What it refuses to do
 *
 * 1. **A gap is not a bye.** `TeamSchedule` derives the bye from an unbroken
 *    run of weeks and returns null rather than guessing (see schedule.ts). A
 *    week with no game that is not that bye is marked `none` and drawn as an
 *    empty cell, because "ESPN has not published this week yet" and "this team
 *    is off" are different facts and only one of them costs somebody a lineup.
 * 2. **Nothing is projected, and nothing is editorialized.** The thirds state
 *    how many home, road and neutral games fall in each; the line that used
 *    to call that "a balanced draw" is gone.
 * 3. **An unresolved opponent is not counted.** ESPN sometimes names a team
 *    this server cannot resolve; those games still appear in the totals and in
 *    the path, but they cannot be filed under a division or a conference, so
 *    they are left out of those two tallies rather than bucketed as a guess.
 */

import type { NflTeam } from "./teams";
import type { ScheduleGame, TeamSchedule } from "./schedule";

/** What one week of the strip is. A neutral site is its own kind, not a road game. */
export type WeekKind = "home" | "away" | "neutral" | "bye" | "none";

export interface WeekMark {
  week: number;
  kind: WeekKind;
  opponent: NflTeam | null;
  /** "vs NE", "at MIA", "Bye", "No game" - the cell's own label. */
  label: string;
}

export interface SeasonSegment {
  from: number;
  to: number;
  /** "3 home · 3 road · 1 neutral", or "No games". */
  detail: string;
}

/** One division's share of the opponents, as the bars draw it. */
export interface DivisionTally {
  division: string;
  count: number;
}

/** One divisional meeting, as the slate card lists it. */
export interface SlateGame {
  week: number;
  opponent: NflTeam | null;
  /** The opponent's nickname, or whatever ESPN called them. */
  name: string;
  atHome: boolean;
  site: "home" | "away" | "neutral";
}

export interface SeasonShape {
  season: number;
  total: number;
  home: number;
  away: number;
  /** Neutral-site games - London, Munich, a Super Bowl venue. home + away + neutral = total. */
  neutral: number;
  /** Games against the other three clubs in this team's own division. */
  division: number;
  /** Games not yet final. */
  remaining: number;
  bye: number | null;
  /** Week 1 through the last week the schedule reaches, in order. */
  marks: WeekMark[];
  segments: SeasonSegment[];
  slate: SlateGame[];
  slateHome: number;
  slateAway: number;
  /** Opponents by division, commonest first. */
  divisions: DivisionTally[];
  /** AFC and NFC opponent counts, always both, in that order. */
  conferences: Array<[string, number]>;
}

/**
 * Thirds of the season, which is how a schedule is actually talked about.
 *
 * Derived from the last week the fixtures reach rather than fixed at 6/6/6, so
 * a season the league lengthens again - or one ESPN has only published part of
 * - still splits into three comparable runs instead of into two runs and a
 * stub. At eighteen weeks this is exactly the 1–6 / 7–12 / 13–18 the standalone
 * tool hard-codes.
 */
function thirds(lastWeek: number): Array<[number, number]> {
  const size = Math.max(1, Math.ceil(lastWeek / 3));
  const spans: Array<[number, number]> = [];
  for (let from = 1; from <= lastWeek; from += size) {
    spans.push([from, Math.min(from + size - 1, lastWeek)]);
  }
  return spans;
}

/** "3 home · 3 road · 1 neutral · 1 bye", in that order, omitting whatever is zero. */
function segmentDetail(marks: WeekMark[]): string {
  const home = marks.filter((mark) => mark.kind === "home").length;
  const away = marks.filter((mark) => mark.kind === "away").length;
  const neutral = marks.filter((mark) => mark.kind === "neutral").length;
  const bye = marks.filter((mark) => mark.kind === "bye").length;
  return (
    [
      home ? `${home} home` : "",
      away ? `${away} road` : "",
      neutral ? `${neutral} neutral` : "",
      bye ? `${bye} bye` : "",
    ]
      .filter(Boolean)
      .join(" · ") || "No games"
  );
}

// The "takeaway" line ("Balanced draw", "Late-season road grind") is gone
// (mak, 2026-11-03): it was autogenerated commentary, and the thirds above it
// already state the facts it was summarizing.

/** "vs NE", "at MIA", "vs WAS (neutral site)" - the form the table's own rows use. */
function markLabel(game: ScheduleGame): string {
  const code = game.opponent?.code ?? game.opponentName;
  if (game.site === "neutral") return `vs ${code} (neutral site)`;
  return `${game.site === "home" ? "vs" : "at"} ${code}`;
}

export function seasonShape(
  schedule: TeamSchedule,
  _team: NflTeam,
): SeasonShape | null {
  const games = schedule.games;
  // A schedule that rendered no rows has no shape. The table above is already
  // showing the unavailable state in that case.
  if (games.length === 0) return null;

  const byWeek = new Map(games.map((game) => [game.week, game]));
  const lastWeek = Math.max(
    ...games.map((game) => game.week),
    schedule.byeWeek ?? 0,
  );

  const marks: WeekMark[] = [];
  for (let week = 1; week <= lastWeek; week += 1) {
    const game = byWeek.get(week);
    if (game) {
      marks.push({
        week,
        kind: game.site,
        opponent: game.opponent,
        label: markLabel(game),
      });
      continue;
    }
    const isBye = schedule.byeWeek === week;
    marks.push({
      week,
      kind: isBye ? "bye" : "none",
      opponent: null,
      label: isBye ? "Bye" : "No game",
    });
  }

  const slateGames = games.filter((game) => game.divisional);
  const slate: SlateGame[] = slateGames.map((game) => ({
    week: game.week,
    opponent: game.opponent,
    name: game.opponent?.nickname ?? game.opponentName,
    atHome: game.site === "home",
    site: game.site,
  }));

  const byDivision = new Map<string, number>();
  const byConference = new Map<string, number>();
  for (const game of games) {
    const opponent = game.opponent;
    if (!opponent) continue;
    byDivision.set(opponent.division, (byDivision.get(opponent.division) ?? 0) + 1);
    byConference.set(
      opponent.conference,
      (byConference.get(opponent.conference) ?? 0) + 1,
    );
  }

  return {
    season: schedule.season,
    total: games.length,
    home: games.filter((game) => game.site === "home").length,
    away: games.filter((game) => game.site === "away").length,
    neutral: games.filter((game) => game.site === "neutral").length,
    division: slateGames.length,
    remaining: games.filter((game) => !(game.status === "final" && game.result)).length,
    bye: schedule.byeWeek,
    marks,
    segments: thirds(lastWeek).map(([from, to]) => ({
      from,
      to,
      detail: segmentDetail(
        marks.filter((mark) => mark.week >= from && mark.week <= to),
      ),
    })),
    slate,
    slateHome: slate.filter((game) => game.site === "home").length,
    slateAway: slate.filter((game) => game.site === "away").length,
    // Commonest first, and alphabetically within a tie so the bars do not
    // reorder themselves between two teams with the same draw.
    divisions: [...byDivision.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([division, count]) => ({ division, count })),
    conferences: (["AFC", "NFC"] as const).map((conference) => [
      conference,
      byConference.get(conference) ?? 0,
    ]),
  };
}
