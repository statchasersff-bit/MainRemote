/**
 * The questions one week of the schedule gets asked, answered from that week's
 * own rows.
 *
 * Sixth sibling to team/outlook-faq.ts, team/stats-faq.ts, team/depth-faq.ts,
 * team/schedule-faq.ts and rankings/rankings-faq.ts, and it keeps the rule the
 * first four are built on: every answer restates something the board directly
 * above it already printed. The dates, kickoffs, networks, byes and matchups
 * below are the rows of the week, so an answer cannot put a game on a day the
 * row does not, or name a network the TV column does not.
 *
 * ## Why a week, and not the board
 *
 * The other tools' FAQs describe one page, because those tools are one page.
 * This one is eighteen: `/schedule/week-3` is a different slate of games from
 * `/schedule/week-4`, with its own title, description and canonical (see
 * schedule-seo.ts). So the questions are per week, they name the week, and they
 * are the one part of this tool whose text is different at every address —
 * which is the whole point of the week having an address.
 *
 * The season matrix gets no questions at all: a 32-by-18 grid is not a thing
 * anyone asks a question about in prose. A team's season is not asked here
 * either — that is answered at length on the team's own hub page by
 * team/schedule-faq.ts, which is also where this tool's team lens went.
 *
 * ## What it refuses to do
 *
 * The same three things the renderer refuses.
 *
 * 1. **Nothing is derived from the week number.** A week is described by the
 *    dates its games carry, so a week whose kickoffs the league has not
 *    published says so rather than inventing the usual Thursday-to-Monday.
 * 2. **A question with no answer is not asked.** No Saturday games, no
 *    Saturday question. No network anywhere on the slate — which is the normal
 *    state when ESPN is refusing this host, see schedule-data.ts — no claim
 *    about where to watch. A Sunday night doubleheader is not one Sunday Night
 *    Football game, so it is not described as one.
 * 3. **Home and away are stated in words.** Rule 4 in schedule-render.ts: "ATL
 *    at GB" reads left to right only if you can see it, and prose has no
 *    excuse at all.
 *
 * ## The whole week, not the filtered week
 *
 * These are built from every game in the week, never from the division or
 * international filter's subset — the same call the sidebar cards make. A
 * filter is a way of looking at one week, it does not change the canonical, and
 * a FAQPage node that loses eleven games because somebody arrived on a filtered
 * link would describe a page that does not exist.
 */

import {
  formatKickoff,
  formatLongDate,
  kickoffHour,
  weekdayName,
} from "./format";
import { TEAMS, type NflTeam } from "../team/teams";
import {
  byeTeams,
  weekGames,
  type ScheduleGame,
  type ScheduleSeason,
} from "./schedule-data";

export interface ScheduleFaq {
  question: string;
  answer: string;
}

/** The heading the block prints, kept beside the questions it introduces. */
export function scheduleFaqHeading(week: number): string {
  return `NFL Week ${week} Schedule FAQ`;
}

/**
 * The windows a Sunday is played in, on the Eastern clock the feed publishes.
 *
 * 1:00 and 4:05/4:25 are the two afternoon windows and 8:20 is the night game;
 * the boundaries sit between them rather than on them, so a 4:05 kickoff that
 * moves to 4:25 does not change which window it is in.
 */
const LATE_WINDOW_HOUR = 16;
const NIGHT_HOUR = 19;

/* ------------------------------------------------------------------ words */

/** "A", "A and B", "A, B and C" — the Oxford-less form the rest of the site uses. */
function listOf(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A team as a sentence names it: "the Green Bay Packers", or the bare code. */
function teamPhrase(team: NflTeam | null, code: string): string {
  return team ? `the ${team.fullName}` : code;
}

/**
 * One fixture as a clause: "the Atlanta Falcons play at the Green Bay Packers".
 *
 * Never "Falcons-Packers", and never the bare order the row draws them in —
 * rule 4 in schedule-render.ts. A neutral-site game has no host to play at, so
 * it is written as a meeting and the venue carries the rest; that is the same
 * distinction the board draws when it flags a game international.
 */
function matchupClause(game: ScheduleGame): string {
  const away = teamPhrase(game.away, game.awayCode);
  const home = teamPhrase(game.home, game.homeCode);
  return game.neutralSite ? `${away} meet ${home}` : `${away} play at ${home}`;
}

/**
 * The same fixture as a noun: "the Atlanta Falcons at the Green Bay Packers".
 *
 * For the sentences that name the broadcast first ("The Thursday Night Football
 * game in Week 3 is ..."), where a clause would not fit. The word "at" is still
 * doing the work, and a neutral-site game takes "vs" because neither club is
 * hosting — the same two words the team hub's schedule table prints in its own
 * column.
 */
function matchupNoun(game: ScheduleGame): string {
  const away = teamPhrase(game.away, game.awayCode);
  const home = teamPhrase(game.home, game.homeCode);
  return game.neutralSite ? `${away} vs ${home}` : `${away} at ${home}`;
}

/** "at Wembley Stadium in London", "at Lambeau Field", or "". */
function venuePhrase(game: ScheduleGame): string {
  if (!game.stadium) return "";
  const city = game.international && game.location ? ` in ${game.location}` : "";
  return `at ${game.stadium}${city}`;
}

/**
 * "on Thursday, September 24 at 8:15 PM ET", or as much of it as is published.
 *
 * Three states, the same three the board prints: a dated game with a kickoff, a
 * dated game the league has not given a window yet, and a fixture with no date
 * at all. Nothing is filled in — a sentence claiming 1:00 PM for a game nobody
 * has scheduled is exactly the error this tool exists not to make.
 */
function whenPhrase(game: ScheduleGame): string {
  const date = formatLongDate(game.date, game.weekday);
  if (!date) return "";
  return game.time ? `on ${date} at ${formatKickoff(game.time)}` : `on ${date}`;
}

/** " on NBC", or nothing at all when ESPN has not told us. */
function networkPhrase(game: ScheduleGame): string {
  return game.network ? ` on ${game.network}` : "";
}

/**
 * One game as a whole sentence: who, where, when, on what.
 *
 * Used by every day question, so a Thursday night game and a Saturday
 * afternoon game are described in the same shape and the reader is not asked to
 * learn two.
 */
function gameSentence(game: ScheduleGame): string {
  const parts = [matchupClause(game)];
  if (game.neutralSite || game.international) {
    const venue = venuePhrase(game);
    if (venue) parts.push(venue);
  }
  const when = whenPhrase(game);
  if (when) parts.push(when);
  return `${parts.join(" ")}${networkPhrase(game)}`;
}

/* ------------------------------------------------------------------- days */

interface DayGroup {
  /** "Thursday", or null when the feed has not dated these games. */
  day: string | null;
  games: ScheduleGame[];
}

/**
 * The week's games grouped by the day they are played, in date order.
 *
 * Grouped on the feed's own calendar date rather than on an instant, because
 * that is what a date in this feed is: an 8:20 PM Sunday kickoff is a Sunday
 * game to everyone, including the reader in Los Angeles for whom it starts at
 * 5:20. Games with no date yet come last, as their own group.
 */
function byDay(games: ScheduleGame[]): DayGroup[] {
  const groups = new Map<string, ScheduleGame[]>();
  const undated: ScheduleGame[] = [];

  for (const game of games) {
    if (!game.date) {
      undated.push(game);
      continue;
    }
    const bucket = groups.get(game.date);
    if (bucket) bucket.push(game);
    else groups.set(game.date, [game]);
  }

  const ordered = [...groups.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, list]) => ({
      day: weekdayName(date, list[0]?.weekday ?? null),
      games: list,
    }));

  return undated.length ? [...ordered, { day: null, games: undated }] : ordered;
}

/**
 * The holiday a whole group is played on, or null.
 *
 * Only when every game in it carries the same one: the Thursday of week 13 is
 * Thanksgiving and all three of its games are, but a Christmas Day game on a
 * Wednesday alongside a Wednesday game that is not would make "the Christmas
 * games" a claim about the wrong fixture.
 */
function groupHoliday(games: ScheduleGame[]): string | null {
  const first = games[0]?.holiday ?? null;
  if (!first) return null;
  return games.every((game) => game.holiday === first) ? first : null;
}

/** "Thanksgiving", "Christmas" — the feed's shout-case, as a sentence sets it. */
function holidayName(holiday: string): string {
  return holiday
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * The night games in a group — the ones a broadcast is named after.
 *
 * A window, not a network: "Sunday Night Football" is a 8:20 kickoff whoever is
 * carrying it, and deriving it from the network would lose it on every week
 * ESPN has not answered us about.
 */
function nightGames(games: ScheduleGame[]): ScheduleGame[] {
  return games.filter((game) => {
    const hour = kickoffHour(game.time);
    return hour !== null && hour >= NIGHT_HOUR;
  });
}

/**
 * A named broadcast window, as its own sentence.
 *
 * "The Sunday Night Football game in Week 3 is the Los Angeles Rams at the
 * Denver Broncos, on Sunday, September 27 at 8:20 PM ET on NBC."
 *
 * The date is spelled out even though the question already names the day,
 * because a question in a FAQPage node is read on its own — a crawler quoting
 * "the Rams at the Broncos" with no date attached has quoted nothing useful.
 */
function broadcastSentence(
  label: string,
  week: number,
  game: ScheduleGame,
  is: string,
): string {
  const venue = game.neutralSite || game.international ? venuePhrase(game) : "";
  const when = whenPhrase(game);
  return (
    `The ${label} game in Week ${week} ${is} ${matchupNoun(game)}` +
    (venue ? `, ${venue}` : "") +
    (when ? `, ${when}` : "") +
    `${networkPhrase(game)}.`
  );
}

/* ------------------------------------------------------------- the answers */

export function scheduleFaq(input: {
  schedule: ScheduleSeason;
  week: number;
}): ScheduleFaq[] {
  const { schedule, week } = input;
  // The whole week, never the filtered subset — see the note at the top.
  const games = weekGames(schedule, week, "all");

  // A week with no published games answers no questions about one. The board
  // above is already saying so in its own words.
  if (games.length === 0) return [];

  const season = schedule.season;
  const faq: ScheduleFaq[] = [];
  const days = byDay(games);
  const dated = games.filter((game) => game.date);

  /**
   * Tense, in one place.
   *
   * A schedule outlives its season: week 3 is still an address in February, and
   * "Week 3 runs from Thursday through Monday" about a week played five months
   * ago is the same false statement team/schedule-faq.ts splits its verbs to
   * avoid. The signal is the rows themselves — a week every game of which is
   * final is a week that has been played — rather than the calendar, so a
   * postponed game keeps the week in the present tense until it is actually
   * played.
   */
  const played = games.every((game) => game.status === "final");
  const v = {
    runs: played ? "ran" : "runs",
    is: played ? "was" : "is",
    has: played ? "had" : "has",
    areScheduled: played ? "were played" : "are scheduled",
    includes: played ? "included" : "includes",
    play: played ? "played" : "play",
  };

  /* ------------------------------------------------------- the week itself */

  const first = dated[0];
  const last = dated[dated.length - 1];
  const opensOn = formatLongDate(first?.date ?? null, first?.weekday ?? null);
  const closesOn = formatLongDate(last?.date ?? null, last?.weekday ?? null);

  faq.push({
    question: `What is the NFL Week ${week} schedule?`,
    answer:
      opensOn === ""
        ? `Week ${week} of the ${season} NFL regular season ${v.has} ` +
          `${count(games.length, "game", "games")}. The league has not published ` +
          `dates or kickoff times for them yet, so every game in the schedule ` +
          `above shows TBD until it does.`
        : `Week ${week} of the ${season} NFL regular season ${
            opensOn === closesOn
              ? `${v.is} played on ${opensOn}`
              : `${v.runs} from ${opensOn} through ${closesOn}`
          }. The schedule above lists every matchup, kickoff time in ET, TV ` +
          `network and game status for the week.`,
  });

  /* ----------------------------------------------------------- how many */

  // Counted off the rows, not off 32: a week whose slate the feed has only
  // partly published should say what it is showing rather than what a week
  // normally holds.
  const playing = new Set<string>();
  for (const game of games) {
    if (game.away) playing.add(game.away.abbreviation);
    if (game.home) playing.add(game.home.abbreviation);
  }

  faq.push({
    question: `How many NFL games are in Week ${week}?`,
    answer:
      `There ${games.length === 1 ? (played ? "was" : "is") : played ? "were" : "are"} ` +
      `${count(games.length, "game", "games")} in Week ${week} of the ${season} NFL ` +
      `season` +
      (playing.size
        ? `, with ${count(playing.size, "team", "teams")} in action.`
        : `.`),
  });

  /* ----------------------------------------------------- one day at a time */

  for (const group of days) {
    if (group.day === null) {
      faq.push({
        question: `Which Week ${week} games have no date yet?`,
        answer:
          `Week ${week} ${v.has} ${count(group.games.length, "game", "games")} with no ` +
          `date yet: ${listOf(group.games.map((game) => matchupClause(game)))}. ` +
          `${group.games.length === 1 ? "It shows" : "They show"} TBD in the schedule ` +
          `above until the league publishes one.`,
      });
      continue;
    }

    const holiday = groupHoliday(group.games);
    const nights = nightGames(group.games);
    const named = group.day === "Sunday" ? null : holiday;

    /* ------------------------------------------------------------ Sunday */

    if (group.day === "Sunday") {
      const early = group.games.filter((game) => {
        const hour = kickoffHour(game.time);
        return hour !== null && hour < LATE_WINDOW_HOUR;
      });
      const late = group.games.filter((game) => {
        const hour = kickoffHour(game.time);
        return hour !== null && hour >= LATE_WINDOW_HOUR && hour < NIGHT_HOUR;
      });
      const untimed = group.games.filter(
        (game) => kickoffHour(game.time) === null,
      );

      const windows = [
        early.length ? `${early.length} in the early afternoon window` : "",
        late.length ? `${late.length} in the late afternoon window` : "",
        nights.length
          ? `${count(nights.length, "game", "games")} at night`
          : "",
        untimed.length
          ? `${count(untimed.length, "game", "games")} with no kickoff time assigned yet`
          : "",
      ].filter(Boolean);

      faq.push({
        question: `What NFL games are on Sunday in Week ${week}?`,
        answer:
          `Week ${week} ${v.includes} ${count(group.games.length, "Sunday game", "Sunday games")}` +
          (windows.length ? `: ${listOf(windows)}.` : `.`) +
          ` Every Sunday kickoff time and network is listed in the schedule above.`,
      });

      // Sunday Night Football, but only when the slate actually has one. Two
      // night games is a doubleheader and neither of them is "the" Sunday
      // night game, so the question goes unasked rather than answered with a
      // coin toss.
      const snf = nights.length === 1 ? nights[0] : undefined;
      if (snf) {
        faq.push({
          question: `What is the Sunday Night Football game in Week ${week}?`,
          answer: broadcastSentence("Sunday Night Football", week, snf, v.is),
        });
      }
      continue;
    }

    /* ------------------------------------------------ Thursday and the rest */

    // A single night game on its own day is the broadcast everybody knows it
    // as; three games on Thanksgiving is not "Thursday Night Football", and a
    // Saturday triple-header in December is not either.
    const soleNight = !named && group.games.length === 1 && nights.length === 1;
    const only = group.games[0] as ScheduleGame;

    if (soleNight) {
      faq.push({
        question: `What is the ${group.day} Night Football game in Week ${week}?`,
        answer: broadcastSentence(`${group.day} Night Football`, week, only, v.is),
      });
      continue;
    }

    faq.push({
      question: named
        ? `What NFL games are on ${holidayName(named)} in Week ${week}?`
        : `What NFL games are on ${group.day} in Week ${week}?`,
      answer:
        group.games.length === 1
          ? `${capitalize(gameSentence(only))}.`
          : `Week ${week} ${v.has} ` +
            `${count(group.games.length, `${group.day} game`, `${group.day} games`)}` +
            (named ? ` on ${holidayName(named)}` : "") +
            `: ${listOf(group.games.map((game) => gameSentence(game)))}.`,
    });
  }

  /* -------------------------------------------------------------- the byes */

  /*
   * Only when every team in the week resolved.
   *
   * A bye is not a row in the feed — it is the absence of one — so it is only
   * as trustworthy as the week's slate. A game whose teams this server cannot
   * name is a game that cannot rule its two clubs out of the bye list, and a
   * FAQ that puts a playing team on bye is the answer here most likely to cost
   * somebody a lineup. The card beside the board is derived the same way and
   * says the same thing; this one simply declines when it cannot be sure.
   */
  const resolved = games.every((game) => game.away && game.home);
  if (resolved) {
    const byes = byeTeams(schedule, week, TEAMS);
    faq.push({
      question: `Are any NFL teams on bye in Week ${week}?`,
      answer: byes.length
        ? `Week ${week} of the ${season} NFL season ${v.has} ` +
          `${count(byes.length, "team", "teams")} on bye: ` +
          `${listOf(byes.map((team) => team.fullName))}. ` +
          `${byes.length === 1 ? "It is" : "They are"} also listed in the Bye week ` +
          `card beside the schedule above.`
        : `No teams are on bye in Week ${week} of the ${season} NFL season. ` +
          `All ${playing.size} teams ${v.play} this week.`,
    });
  }

  /* ----------------------------------------------------- international games */

  const international = games.filter((game) => game.international);
  if (international.length) {
    faq.push({
      question:
        international.length === 1
          ? `Is there an international game in Week ${week}?`
          : `Which Week ${week} games are played outside the United States?`,
      answer:
        `Week ${week} ${v.has} ${count(international.length, "international game", "international games")}: ` +
        `${listOf(international.map((game) => gameSentence(game)))}.`,
    });
  }

  /* --------------------------------------------------------- division games */

  const divisional = games.filter((game) => game.divisional);
  if (divisional.length) {
    faq.push({
      question: `Which Week ${week} games are division matchups?`,
      answer:
        `Week ${week} ${v.has} ${count(divisional.length, "division matchup", "division matchups")}: ` +
        `${listOf(divisional.map((game) => matchupClause(game)))}. ` +
        `Division games are marked DIV in the schedule above.`,
    });
  }

  /* ------------------------------------------------------------------- TV */

  const networks: string[] = [];
  for (const game of games) {
    if (!game.network) continue;
    // A simulcast arrives as "NBC / Peacock" and is two places to watch, which
    // is how the TV column draws it and how it is counted here.
    for (const part of game.network.split("/")) {
      const name = part.trim();
      if (name && !networks.includes(name)) networks.push(name);
    }
  }

  const unassigned = games.filter((game) => !game.network).length;

  faq.push({
    question: `Where can I watch NFL Week ${week} games?`,
    answer: networks.length
      ? `Week ${week} games ${v.areScheduled} on ${listOf(networks)}. ` +
        `The network for each matchup is shown in the TV column of the schedule above` +
        (unassigned
          ? `; ${count(unassigned, "game", "games")} ${unassigned === 1 ? "has" : "have"} ` +
            `no broadcast assigned yet and ${unassigned === 1 ? "reads" : "read"} TBD.`
          : `.`)
      : `Broadcast assignments for Week ${week} have not been published yet, so the ` +
        `TV column of the schedule above reads TBD. It fills in from ESPN as the ` +
        `networks are announced.`,
  });

  return faq;
}

/** Sentence case for a phrase that was built to sit mid-sentence. */
function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
