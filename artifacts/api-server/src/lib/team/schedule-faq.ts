/**
 * The questions a schedule gets asked, answered from the same fixtures.
 *
 * Fourth sibling to outlook-faq.ts, stats-faq.ts and depth-faq.ts, on the rule
 * all four share: every answer restates something the tab already printed. The
 * weeks, opponents, venues, networks and scores below are the rows of the table
 * directly above them, so an answer cannot put the bye in a different week than
 * the row that says "Bye week", or name a network the column does not.
 *
 * Since 2026-11-03 every reading here comes from lib/team/schedule.ts's own
 * helpers - nextGame(), lastResult(), splitSchedule(), siteCounts(),
 * recordThrough() - which are the same functions the next-game card, the two
 * tables and the snapshot call. That is what makes the no-contradiction rule
 * mechanical rather than a matter of care: one game has one status, one
 * kickoff and one site, read once.
 *
 * Three rules the answers keep.
 *
 * 1. "Next" means strictly the next game not yet final. A game that ended an
 *    hour ago is never "next", and once the season is played out the question
 *    is not asked at all - "the Lions' next game is Week 18" in February is a
 *    false statement, not a graceful degradation.
 * 2. A kickoff the league has not set is said to be unset. The feeds hold a
 *    placeholder Sunday for those games and the model refuses it (see
 *    schedule-data.ts, resolveKickoff), so there is nothing here to print but
 *    "TBD" - and that is what is printed.
 * 3. A neutral-site game is neither a home game nor a road game. It is
 *    counted apart and named with its venue and city.
 *
 * On dates: the table sets them short ("Nov 8") because it is a column. Prose
 * gets the long form, from the same epoch milliseconds, because a sentence that
 * says "Sun, Nov 8" is a table someone typed out.
 */

import { easternParts } from "../news-card";
import { easternDate } from "../schedule/schedule-data";
import type { NflTeam } from "./teams";
import {
  isOnDate,
  lastResult,
  nextGame,
  recordThrough,
  siteCounts,
  splitSchedule,
  type ScheduleGame,
  type TeamSchedule,
} from "./schedule";

export interface ScheduleFaq {
  question: string;
  answer: string;
}

/** "the Lions'", "the Rams'" - the apostrophe-only form every current nickname takes. */
function possessive(nickname: string): string {
  return nickname.endsWith("s") ? `${nickname}'` : `${nickname}'s`;
}

/** "A", "A and B", "A, B and C" - the Oxford-less form the rest of the page uses. */
function listOf(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * "Sunday, November 8" - the long form, in the same timezone the page sets
 * every other kickoff in.
 */
const LONG_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "long",
  month: "long",
  day: "numeric",
});

/** "Nov 8" - the short form, for a list of many games. */
function shortDate(game: ScheduleGame): string | null {
  if (game.kickoffMs === null || !game.dateConfirmed) return null;
  const parts = easternParts(game.kickoffMs);
  return `${parts.month} ${parts.day}`;
}

/**
 * "Sunday, November 8 at 1:00 PM ET", or "" for a game the league has not
 * scheduled. There is no middle state any more: the model clears the date
 * along with the time when a window is TBD, because the only date it could
 * keep is the feeds' filing-convention Sunday.
 */
function kickoffPhrase(game: ScheduleGame): string {
  if (game.kickoffMs === null || !game.dateConfirmed) return "";
  const date = LONG_DATE.format(new Date(game.kickoffMs));
  if (!game.timeConfirmed) return date;
  return `${date} at ${easternParts(game.kickoffMs).time}`;
}

/** What to say about a kickoff that has none. */
const TBD_PHRASE = "the NFL has not set the date and time yet";

/**
 * The opponent as a sentence names them: "the New York Jets".
 *
 * The article is attached here rather than at every call site because it is not
 * always right: a feed can name an opponent this server cannot resolve, and
 * "the Opponent TBD" is a sentence about a team that does not exist. A resolved
 * club takes "the"; a bare name is printed as given.
 */
function opponentPhrase(game: ScheduleGame): string {
  return game.opponent ? `the ${game.opponent.fullName}` : game.opponentName;
}

/**
 * Where a game is played, as a phrase: "at Ford Field", "at Tottenham Hotspur
 * in London, UK (a neutral-site game)", else "at home" / "on the road".
 *
 * The venue is preferred over the home/away word wherever a feed gives one,
 * because "at Allianz Arena" is the answer to the question a reader asking
 * about a game in Munich actually has. A neutral site always says so.
 */
function wherePhrase(game: ScheduleGame): string {
  const venue = game.venue ? `at ${game.venue}` : null;
  if (game.site === "neutral") {
    const place = venue
      ? game.venueCity
        ? `${venue} in ${game.venueCity}`
        : venue
      : "at a neutral site";
    return `${place} (a neutral-site game)`;
  }
  if (venue) return venue;
  return game.site === "home" ? "at home" : "on the road";
}

/** "vs" / "at" - the short form the remaining-schedule list uses. */
function versus(game: ScheduleGame): string {
  return game.site === "away" ? "at" : "vs";
}

/** "beat", "lost to", "tied" - a result as a sentence states it. */
function resultVerb(outcome: "W" | "L" | "T"): string {
  return outcome === "W" ? "beat" : outcome === "L" ? "lost to" : "tied";
}

/**
 * The venue a team plays its ordinary home games in, or null.
 *
 * The most-used venue among true home games rather than a stadium name held
 * in the team table: a club playing a season in a temporary ground is exactly
 * the case where a stored name would be wrong and this is right. Null when the
 * schedule names no venue at all.
 */
function homeStadium(home: ScheduleGame[]): string | null {
  const tally = new Map<string, number>();
  for (const game of home) {
    if (!game.venue) continue;
    tally.set(game.venue, (tally.get(game.venue) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [venue, n] of tally) {
    if (n > bestCount) {
      best = venue;
      bestCount = n;
    }
  }
  return best;
}

export function scheduleFaq(input: {
  team: NflTeam;
  schedule: TeamSchedule;
  /** The clock the page is being rendered against, so "next" means next. */
  now: number;
}): ScheduleFaq[] {
  const { team, schedule, now } = input;
  const games = schedule.games;

  // A schedule that rendered no rows answers no questions about one. The table
  // above is already showing the unavailable state in that case.
  if (games.length === 0) return [];

  const season = schedule.season;
  const club = team.fullName;
  const nick = team.nickname;
  const city = team.city;
  const faq: ScheduleFaq[] = [];

  const next = nextGame(schedule, now);
  const latest = lastResult(schedule);
  const { results, remaining } = splitSchedule(schedule);
  const sites = siteCounts(games);
  const record = recordThrough(games);
  const today = easternDate(now);

  /* ------------------------------------------------------------- next game */

  if (next) {
    const opponent = opponentPhrase(next);
    const when = kickoffPhrase(next);
    const where = wherePhrase(next);
    const onTv = next.network ? ` The game is on ${next.network}.` : "";

    let answer: string;
    if (next.status === "live") {
      answer =
        `The ${nick} are playing ${opponent} ${where} right now, in ${next.weekLabel} of the ${season} season.` +
        onTv;
    } else if (next.status === "postponed") {
      answer =
        `The ${possessive(nick)} next game is ${next.weekLabel} against ${opponent} ${where}. ` +
        `It has been postponed, and a new date has not been announced.`;
    } else if (isOnDate(next, today)) {
      // "Today" only when it is: this sentence is generated per render, so it
      // is true on the day and gone the next.
      answer =
        `The ${nick} play today, ${when}, against ${opponent} ${where} in ${next.weekLabel}.` + onTv;
    } else {
      answer =
        `The ${possessive(nick)} next game is ${next.weekLabel} against ${opponent} ${where}.` +
        (when ? ` Kickoff is ${when}.` : ` Kickoff is TBD: ${TBD_PHRASE}.`) +
        onTv;
    }

    faq.push({ question: `Who do the ${club} play next?`, answer });
  }

  /**
   * Tense, in one place.
   *
   * A schedule outlives its season. The page stays up through February and all
   * of the off-season with last year's fixtures on it, and "the Lions play 17
   * games in 2026" over a season that finished in January is the same kind of
   * false statement stats-faq.ts splits its verbs to avoid. The signal is the
   * one this module already computed: no unplayed game left is a season that
   * has been played.
   */
  const running = next !== null;
  const v = {
    play: running ? "play" : "played",
    has: running ? "has" : "had",
    areOn: running ? "are on" : "were on",
    areScheduled: running ? "are scheduled" : "were scheduled",
    carries: running ? "carries" : "carried",
  };

  /* -------------------------------------------------------- the whole season */

  const opener = games[0];
  const finale = games[games.length - 1];

  if (opener && finale && opener !== finale) {
    faq.push({
      question: `What is the ${club} schedule for ${season}?`,
      answer:
        `The ${nick} ${v.play} ${count(games.length, "regular-season game", "regular-season games")} ` +
        `in ${season}: ${sites.home} at home, ${sites.away} on the road` +
        (sites.neutral ? ` and ${count(sites.neutral, "neutral-site game", "neutral-site games")}` : "") +
        `. They open in Week ${opener.week} against ${opponentPhrase(opener)} ` +
        `${wherePhrase(opener)} and finish in Week ${finale.week} against ` +
        `${opponentPhrase(finale)} ${wherePhrase(finale)}. Every game's date, opponent, ` +
        `kickoff time, TV network, venue and result is listed in the schedule above` +
        (running
          ? `; a game the NFL has not scheduled yet is marked TBD.`
          : `.`),
    });
  }

  /* --------------------------------------------------------------- bye week */

  // Only when the response supported exactly one answer - deriveByeWeek()
  // returns null rather than guessing, and a guessed bye is the answer in this
  // block most likely to cost somebody a lineup.
  const bye = schedule.byeWeek;
  if (bye) {
    const before = games.find((game) => game.week === bye - 1);
    const after = games.find((game) => game.week === bye + 1);
    faq.push({
      question: `When is the ${club} bye week in ${season}?`,
      answer:
        `The ${nick} ${v.areOn} bye in Week ${bye} of the ${season} season` +
        (before && after
          ? `, between their Week ${before.week} game against ${opponentPhrase(before)} ` +
            `and their Week ${after.week} game against ${opponentPhrase(after)}.`
          : `.`) +
        ` The bye is listed in the schedule above as its own week, with no game against it.`,
    });
  }

  /* ------------------------------------------------------ remaining schedule */

  if (running && remaining.length) {
    const items = remaining.map((game) => {
      const date = shortDate(game);
      const name = game.opponent?.nickname ?? game.opponentName;
      const where = game.site === "neutral" ? ` (neutral site)` : "";
      return `Week ${game.week} ${versus(game)} ${name}${where} (${date ?? "TBD"})`;
    });
    const tbd = remaining.filter((game) => !game.dateConfirmed).length;
    faq.push({
      question: `What is the ${club} remaining schedule?`,
      answer:
        `The ${nick} have ${count(remaining.length, "game", "games")} left in ${season}: ` +
        `${listOf(items)}.` +
        (tbd
          ? ` ${count(tbd, "game", "games")} ${tbd === 1 ? "is" : "are"} marked TBD because ${TBD_PHRASE}.`
          : "") +
        ` The full remaining schedule, with kickoff times, TV networks and venues, is above.`,
    });
  }

  /* ------------------------------------------------------------- home games */

  const home = games.filter((game) => game.site === "home");
  const neutral = games.filter((game) => game.site === "neutral");

  if (home.length) {
    const stadium = homeStadium(home);
    // True home games played somewhere other than the usual home ground: a
    // season in a temporary stadium, or a home game relocated. Named
    // separately because nobody driving to one should be sent to the usual
    // address. A neutral-site game is not a home game and is listed after.
    const elsewhere = stadium ? home.filter((game) => game.venue !== stadium) : [];
    const atStadium = home.length - elsewhere.length;

    faq.push({
      question: `How many home games do the ${club} have in ${season}?`,
      answer:
        `${city} ${v.has} ${count(home.length, "home game", "home games")} in ${season}` +
        (stadium
          ? elsewhere.length
            ? `, ${atStadium} of them at ${stadium}. ` +
              elsewhere
                .map(
                  (game) =>
                    `The Week ${game.week} home game against ${opponentPhrase(game)} is played ` +
                    `${wherePhrase(game)}${game.venueCity ? ` in ${game.venueCity}` : ""}.`,
                )
                .join(" ")
            : `, all of them at ${stadium}.`
          : `.`) +
        ` The other ${count(sites.away, "game is", "games are")} on the road` +
        (neutral.length
          ? `, and ${count(neutral.length, "game is", "games are")} at a neutral site: ` +
            neutral
              .map(
                (game) =>
                  `Week ${game.week} against ${opponentPhrase(game)} ${wherePhrase(game)}`,
              )
              .join("; ") +
            `.`
          : `.`) +
        ` Home games are marked "vs" in the schedule above and road games "at".`,
    });
  }

  /* -------------------------------------------------------- division games */

  const divisionGames = games.filter((game) => game.divisional && game.opponent);
  // In schedule order, deduplicated: the two meetings with one rival are one
  // opponent, and the first one is where they belong in the list.
  const rivals: NflTeam[] = [];
  for (const game of divisionGames) {
    const opponent = game.opponent as NflTeam;
    if (!rivals.some((rival) => rival.abbreviation === opponent.abbreviation)) {
      rivals.push(opponent);
    }
  }

  const meetingsWith = (rival: NflTeam): ScheduleGame[] =>
    divisionGames.filter((game) => game.opponent?.abbreviation === rival.abbreviation);

  if (rivals.length) {
    // "home and away" only when the schedule actually reads that way. It is the
    // normal shape of a division slate and it is not guaranteed - a partial
    // fetch, or a season played with a fixture relocated, breaks it - so the
    // phrase is earned from the rows rather than assumed from the format.
    const homeAndAway = rivals.every((rival) => {
      const meetings = meetingsWith(rival);
      return (
        meetings.length === 2 &&
        meetings.some((game) => game.site === "home") &&
        meetings.some((game) => game.site === "away")
      );
    });

    faq.push({
      question: `Who do the ${nick} play in the ${team.division}?`,
      answer:
        `The ${nick} ${v.play} ${count(divisionGames.length, "division game", "division games")} ` +
        `in ${season}, ${homeAndAway ? "home and away against the " : "against the "}` +
        `${listOf(rivals.map((rival) => rival.fullName))}. ` +
        `Each meeting is listed in the ${team.division} schedule beside the table above.`,
    });
  }

  /* ----------------------------------------------- one question per rival */

  // The searches the division question does not answer: somebody looking for
  // one fixture wants its week, its venue and its kickoff, not the six games
  // it belongs to.
  for (const rival of rivals) {
    const meetings = meetingsWith(rival);
    const played = meetings.filter((game) => game.result);
    const upcoming = meetings.filter((game) => !game.result);

    const sentences: string[] = [];

    for (const game of played) {
      const result = game.result;
      if (!result) continue;
      sentences.push(
        `${city} ${resultVerb(result.outcome)} the ${rival.fullName} ` +
          `${result.teamScore}-${result.opponentScore} in Week ${game.week} ${wherePhrase(game)}.`,
      );
    }

    if (upcoming.length) {
      sentences.push(
        `${played.length ? "They meet again in " : `The ${nick} face the ${rival.fullName} in `}` +
          `${listOf(
            upcoming.map((game) => {
              const when = kickoffPhrase(game);
              return (
                `Week ${game.week} ${wherePhrase(game)}` +
                (when ? ` on ${when}` : ` (date and time TBD)`)
              );
            }),
          )}.`,
      );
    }

    if (sentences.length) {
      faq.push({
        question: `When do the ${nick} play the ${rival.nickname}?`,
        answer: sentences.join(" "),
      });
    }
  }

  /* ---------------------------------------------------------------- on TV */

  const networkTally = new Map<string, number>();
  for (const game of games) {
    if (!game.network) continue;
    networkTally.set(game.network, (networkTally.get(game.network) ?? 0) + 1);
  }

  if (networkTally.size) {
    // Most-carried first, which is the order the question is really asking for:
    // "what channel are the games on" is answered best by the one that has most
    // of them.
    const ranked = [...networkTally.entries()].sort((a, b) => b[1] - a[1]);
    const leader = ranked[0] as [string, number];
    // Only the games still to be played can be waiting on a network; a played
    // game with none is a gap in the record, not a pending assignment.
    const unassigned = remaining.filter((game) => !game.network).length;

    faq.push({
      question: `What channel are ${club} games on in ${season}?`,
      answer:
        `${season} ${nick} games ${v.areScheduled} on ` +
        `${listOf(ranked.map(([network]) => network))}. ` +
        (ranked.length > 1
          ? `${leader[0]} ${v.carries} the most with ${count(leader[1], "game", "games")}. `
          : "") +
        (next && next.network
          ? `The next game, ${next.weekLabel} against ${opponentPhrase(next)}, is on ${next.network}. `
          : "") +
        `The network for each game is shown in the TV column of the schedule above` +
        (unassigned
          ? `; ${count(unassigned, "upcoming game", "upcoming games")} ${unassigned === 1 ? "does" : "do"} ` +
            `not have a network assigned yet and ${unassigned === 1 ? "shows" : "show"} TBD.`
          : `.`),
    });
  }

  /* ------------------------------------------------------ scores and results */

  if (results.length && latest?.result) {
    const result = latest.result;
    faq.push({
      question: `Where can I see ${club} scores and results?`,
      answer:
        `Every completed game shows its final score and the ${possessive(nick)} record after it ` +
        `in the results table above` +
        (running ? `, and the remaining schedule lists the games still to be played` : ``) +
        `. ` +
        (running
          ? `The ${nick} are ${record.text} through ${count(results.length, "game", "games")} in ${season}`
          : `The ${nick} finished ${season} at ${record.text}`) +
        // The latest result, while there is a next one to place it against.
        // "Most recently" about a season that ended in January is a phrase
        // pointing at nothing - the record above is the whole answer by then.
        (running
          ? `, most recently ${resultVerb(result.outcome)} ${opponentPhrase(latest)} ` +
            `${result.teamScore}-${result.opponentScore} in ${latest.weekLabel}. ` +
            `Each completed game links to its recap and box score.`
          : `.`),
    });
  } else {
    faq.push({
      question: `Where can I see ${club} scores and results?`,
      answer:
        `No ${season} ${nick} games have been played yet. Each game in the schedule ` +
        `above shows its date, kickoff time, TV network and venue now, and moves to the ` +
        `results table with its final score once it has been played.`,
    });
  }

  return faq;
}
