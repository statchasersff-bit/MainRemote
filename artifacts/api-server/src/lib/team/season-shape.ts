/**
 * One team's season as a shape rather than as a list of fixtures.
 *
 * The schedule table three hundred pixels above this answers "when do they play
 * the Jets". It cannot answer "is this a hard draw", because that question is
 * about the eighteen weeks together: how the home games are spread, where the
 * bye falls, how many times the division comes round, which conference the
 * out-of-division opponents come from. Those are all arithmetic on rows the
 * table already prints — this module does the arithmetic once so the renderer
 * can draw it and schedule-faq.ts can keep quoting the same numbers.
 *
 * Ported from the standalone NFL schedule tool's team lens, whose four sidebar
 * cards were exactly these four readings. The numbers and the thresholds are
 * the same; what could not come across is the data shape. That tool holds a
 * whole league — a game carries `home` and `away` teams and is filtered down to
 * one club. The team hub holds one club's schedule, where a game carries
 * `homeAway` and an `opponent`, so the counting is rewritten against that
 * rather than the league rows being reconstructed from it.
 *
 * This is now the only copy. The lens has been removed from the schedule tool —
 * its `teamSeasonStats` went with it — because the two would otherwise be two
 * sets of arithmetic answering one question.
 *
 * ## What it refuses to do
 *
 * 1. **A gap is not a bye.** `TeamSchedule` derives the bye from an unbroken
 *    run of weeks and returns null rather than guessing (see schedule.ts). A
 *    week with no game that is not that bye is marked `none` and drawn as an
 *    empty cell, because "ESPN has not published this week yet" and "this team
 *    is off" are different facts and only one of them costs somebody a lineup.
 * 2. **Nothing is projected.** The takeaway counts home games in the opening
 *    and closing thirds and says which way the draw leans. It never says
 *    whether that makes the team good.
 * 3. **An unresolved opponent is not counted.** ESPN sometimes names a team
 *    this server cannot resolve; those games still appear in the totals and in
 *    the path, but they cannot be filed under a division or a conference, so
 *    they are left out of those two tallies rather than bucketed as a guess.
 */

import type { NflTeam } from "./teams";
import type { ScheduleGame, TeamSchedule } from "./schedule";

/** What one week of the strip is. */
export type WeekKind = "home" | "away" | "bye" | "none";

export interface WeekMark {
  week: number;
  kind: WeekKind;
  opponent: NflTeam | null;
  /** "vs NE", "at MIA", "Bye", "No game" — the cell's own label. */
  label: string;
}

export interface SeasonSegment {
  from: number;
  to: number;
  /** "3 home · 3 road", or "No games". */
  detail: string;
}

export interface SeasonTakeaway {
  title: string;
  body: string;
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
}

export interface SeasonShape {
  season: number;
  total: number;
  home: number;
  away: number;
  /** Games against the other three clubs in this team's own division. */
  division: number;
  bye: number | null;
  /** Week 1 through the last week the schedule reaches, in order. */
  marks: WeekMark[];
  segments: SeasonSegment[];
  takeaway: SeasonTakeaway;
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
 * a season the league lengthens again — or one ESPN has only published part of
 * — still splits into three comparable runs instead of into two runs and a
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

/** "3 home · 3 road · 1 bye", in that order, omitting whatever is zero. */
function segmentDetail(marks: WeekMark[]): string {
  const home = marks.filter((mark) => mark.kind === "home").length;
  const away = marks.filter((mark) => mark.kind === "away").length;
  const bye = marks.filter((mark) => mark.kind === "bye").length;
  return (
    [home ? `${home} home` : "", away ? `${away} road` : "", bye ? `${bye} bye` : ""]
      .filter(Boolean)
      .join(" · ") || "No games"
  );
}

/**
 * Which way the draw leans, in a headline and a sentence.
 *
 * The four branches and their thresholds are the standalone tool's, unchanged,
 * so a reader who meets this card on both pages is told the same thing about
 * the same season. `scheduled` excludes the bye: "final 6 games" means six
 * games, not six weeks.
 */
function takeawayFor(scheduled: WeekMark[], team: NflTeam): SeasonTakeaway {
  const first = scheduled.slice(0, 6);
  const last = scheduled.slice(-6);
  const homeFirst = first.filter((mark) => mark.kind === "home").length;
  const homeLast = last.filter((mark) => mark.kind === "home").length;

  if (last.length === 0) {
    return {
      title: "Path pending",
      body: "No games are scheduled for this team yet.",
    };
  }
  if (homeLast >= 4) {
    return {
      title: "Late-season home edge",
      body: `${homeLast} of ${team.city}'s final ${last.length} scheduled games are at home.`,
    };
  }
  if (homeLast <= 2) {
    return {
      title: "Late-season road grind",
      body: `${last.length - homeLast} of ${team.city}'s final ${last.length} scheduled games are on the road.`,
    };
  }
  if (homeFirst <= 2) {
    return {
      title: "Early road gauntlet",
      body: `${first.length - homeFirst} of the opening ${first.length} games are away from home.`,
    };
  }
  return {
    title: "Balanced draw",
    body: "Home and road games stay evenly spread from September through January.",
  };
}

/** "vs NE", "at MIA" — the form the table's own rows use. */
function markLabel(game: ScheduleGame): string {
  const side = game.homeAway === "home" ? "vs" : "at";
  return `${side} ${game.opponent?.code ?? game.opponentName}`;
}

export function seasonShape(
  schedule: TeamSchedule,
  team: NflTeam,
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
        kind: game.homeAway === "home" ? "home" : "away",
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

  const scheduled = marks.filter(
    (mark) => mark.kind === "home" || mark.kind === "away",
  );

  const slateGames = games.filter((game) => game.divisional);
  const slate: SlateGame[] = slateGames.map((game) => ({
    week: game.week,
    opponent: game.opponent,
    name: game.opponent?.nickname ?? game.opponentName,
    atHome: game.homeAway === "home",
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
    home: marks.filter((mark) => mark.kind === "home").length,
    away: marks.filter((mark) => mark.kind === "away").length,
    division: slateGames.length,
    bye: schedule.byeWeek,
    marks,
    segments: thirds(lastWeek).map(([from, to]) => ({
      from,
      to,
      detail: segmentDetail(
        marks.filter((mark) => mark.week >= from && mark.week <= to),
      ),
    })),
    takeaway: takeawayFor(scheduled, team),
    slate,
    slateHome: slate.filter((game) => game.atHome).length,
    slateAway: slate.filter((game) => !game.atHome).length,
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
