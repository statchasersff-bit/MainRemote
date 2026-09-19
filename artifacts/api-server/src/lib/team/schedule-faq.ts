/**
 * The questions a schedule gets asked, answered from the same fixtures.
 *
 * Fourth sibling to outlook-faq.ts, stats-faq.ts and depth-faq.ts, on the rule
 * all four share: every answer restates something the tab already printed. The
 * weeks, opponents, venues, networks and scores below are the rows of the table
 * directly above them, so an answer cannot put the bye in a different week than
 * the row that says "Bye week", or name a network the column does not.
 *
 * What is particular to this one is that a schedule is half memory and half
 * plan, and the same question changes tense in the middle of a season. So
 * nothing here is phrased from the calendar: a game is described as played
 * because it carries a result, and as upcoming because it does not. That is the
 * same distinction the table draws in its last column — see gameStatusCell() —
 * and it survives a postponed game, a Thursday night still in progress, and the
 * fortnight in February when the season is over but the page is still up.
 *
 * Two rules follow from it.
 *
 * First, "next" means strictly the next unplayed game. upcomingGames() falls
 * back to the tail of the season so the cards above never render empty, which
 * is right for a row of cards and wrong for a sentence: "the Lions' next game
 * is Week 18 against the Vikings" about a game played in January is a false
 * statement rather than a graceful degradation. When there is no unplayed game
 * left, this module asks no question about one.
 *
 * Second, nothing is derived from a week number. A team on bye has played fewer
 * games than the league week, and a schedule fetched mid-flex can be missing a
 * kickoff time; every count here is a count of rows, and every date comes from
 * that row's own kickoff.
 *
 * On dates: the table sets them short ("Sun, Sep 27") because it is a column.
 * Prose gets the long form, from the same epoch milliseconds, because a
 * sentence that says "Sun, Sep 27" is a table someone typed out. The time is
 * the preformatted Eastern string the rest of the page uses, so the FAQ and the
 * row cannot disagree about a kickoff.
 */

import { easternParts } from "../news-card";
import type { NflTeam } from "./teams";
import type { ScheduleGame, TeamSchedule } from "./schedule";

export interface ScheduleFaq {
  question: string;
  answer: string;
}

/**
 * A game is still "next" until it has been over for a while.
 *
 * Same four hours upcomingGames() allows, and for the same reason: a game that
 * kicked off two hours ago is the game a reader is asking about, and ESPN does
 * not always mark a final the moment one ends.
 */
const RECENTLY_ENDED_MS = 4 * 60 * 60 * 1000;

/** "the Lions'", "the Rams'" — the apostrophe-only form every current nickname takes. */
function possessive(nickname: string): string {
  return nickname.endsWith("s") ? `${nickname}'` : `${nickname}'s`;
}

/** "A", "A and B", "A, B and C" — the Oxford-less form the rest of the page uses. */
function listOf(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * "Sunday, September 27" — the long form, in the same timezone the page sets
 * every other kickoff in.
 *
 * Its own formatter rather than easternParts(), whose weekday and month are
 * abbreviated for a table cell. The time still comes from easternParts so the
 * "ET" and the 12-hour formatting are decided in one place.
 */
const LONG_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "long",
  month: "long",
  day: "numeric",
});

/**
 * "Sunday, September 27 at 1:00 PM ET", or the date alone, or "".
 *
 * Three states, because ESPN publishes a schedule before it publishes windows:
 * a fixture can have a real kickoff, a placeholder kickoff on the right day
 * (`timeValid` false, which is what a Sunday game with no window looks like),
 * or no date at all. The middle one keeps the date and drops the time — the
 * table does exactly this, and a sentence claiming 1:00 PM for a game the
 * league has not scheduled is the one error a reader would act on.
 */
function kickoffPhrase(game: ScheduleGame): string {
  if (game.kickoffMs === null) return "";
  const date = LONG_DATE.format(new Date(game.kickoffMs));
  if (!game.timeConfirmed) return date;
  return `${date} at ${easternParts(game.kickoffMs).time}`;
}

/**
 * The opponent as a sentence names them: "the New York Jets".
 *
 * The article is attached here rather than at every call site because it is not
 * always right: ESPN names an opponent this server cannot resolve with whatever
 * string it has, and "the Opponent TBD" is a sentence about a team that does
 * not exist. A resolved club takes "the"; a bare name is printed as given.
 */
function opponentPhrase(game: ScheduleGame): string {
  return game.opponent ? `the ${game.opponent.fullName}` : game.opponentName;
}

/**
 * Where a game is played, as a phrase: "at Ford Field", else "at home".
 *
 * The venue is preferred over the home/away word wherever ESPN gives one,
 * because "at Allianz Arena" is the answer to the question a reader asking
 * about a home game in Munich actually has. The word is the fallback, not the
 * default — a fixture with no venue yet still has a side.
 */
function wherePhrase(game: ScheduleGame): string {
  if (game.venue) return `at ${game.venue}`;
  return game.homeAway === "home" ? "at home" : "on the road";
}

/** "beat", "lost to", "tied" — a result as a sentence states it. */
function resultVerb(outcome: "W" | "L" | "T"): string {
  return outcome === "W" ? "beat" : outcome === "L" ? "lost to" : "tied";
}

/**
 * The venue a team plays its ordinary home games in, or null.
 *
 * The most-used venue among home games rather than a stadium name held in the
 * team table: a club playing a season in a temporary ground, or an
 * international fixture nominally at home, is exactly the case where a stored
 * name would be wrong and this is right. Null when the schedule names no venue
 * at all, which is the state a fixture list published before its venues is in.
 */
function homeStadium(home: ScheduleGame[]): string | null {
  const tally = new Map<string, number>();
  for (const game of home) {
    if (!game.venue || game.neutralSite) continue;
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

  /* ------------------------------------------------------------- next game */

  // Unplayed, not "late in the list": see the note at the top of the file.
  const next = games.find(
    (game) =>
      game.status !== "final" &&
      (game.kickoffMs === null || game.kickoffMs + RECENTLY_ENDED_MS > now),
  );

  if (next) {
    const opponent = opponentPhrase(next);
    const when = kickoffPhrase(next);
    const where = wherePhrase(next);
    // A city only when it adds something. "at Ford Field in Detroit" is noise;
    // "at Allianz Arena in Munich" is the fact the fixture is famous for.
    const place =
      next.international && next.venueCity ? `${where} in ${next.venueCity}` : where;

    faq.push({
      question: `Who do the ${club} play next?`,
      answer:
        (next.status === "live"
          ? `The ${nick} are playing ${opponent} ${place} right now, in Week ${next.week} of the ${season} season.`
          : `The ${possessive(nick)} next game is Week ${next.week} against ${opponent} ${place}.` +
            (when
              ? ` Kickoff is scheduled for ${when}.`
              : ` A kickoff date has not been set.`)) +
        (next.network ? ` The game is on ${next.network}.` : ""),
    });
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
  const running = next !== undefined;
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
        `in ${season}, opening in Week ${opener.week} against ${opponentPhrase(opener)} ` +
        `${wherePhrase(opener)} and finishing in Week ${finale.week} against ` +
        `${opponentPhrase(finale)} ${wherePhrase(finale)}. Every week's date, opponent, ` +
        `venue, network and result is listed in the schedule above.`,
    });
  }

  /* --------------------------------------------------------------- bye week */

  // Only when the response supported exactly one answer — deriveByeWeek()
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
        ` The bye is listed in the schedule above as its own week, with no fixture against it.`,
    });
  }

  /* ------------------------------------------------------------- home games */

  const home = games.filter((game) => game.homeAway === "home");

  if (home.length) {
    const stadium = homeStadium(home);
    // Home games played somewhere other than the home ground: the London,
    // Munich and São Paulo fixtures, and any season played in a temporary
    // stadium. Counted as home games because that is what they are on the
    // schedule, and named separately because nobody driving to one should be
    // sent to the usual address.
    const elsewhere = stadium
      ? home.filter((game) => game.neutralSite || game.venue !== stadium)
      : [];
    const atStadium = home.length - elsewhere.length;

    faq.push({
      question: `How many home games do the ${club} have in ${season}?`,
      answer:
        `${city} ${v.has} ${count(home.length, "home game", "home games")} in ${season}` +
        (stadium
          ? elsewhere.length
            ? `, ${atStadium} of them at ${stadium}. ` +
              // A sentence each, rather than a list: two relocated home games
              // are two different venues in two different weeks, and a reader
              // going to one of them needs the pair kept apart.
              elsewhere
                .map(
                  (game) =>
                    `The Week ${game.week} home game against ${opponentPhrase(game)} is played ` +
                    `${wherePhrase(game)}${game.venueCity ? ` in ${game.venueCity}` : ""}.`,
                )
                .join(" ")
            : `, all of them at ${stadium}.`
          : `.`) +
        ` Each one is marked HOME in the schedule above.`,
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
    // normal shape of a division slate and it is not guaranteed — a partial
    // fetch, or a season played with a fixture relocated, breaks it — so the
    // phrase is earned from the rows rather than assumed from the format.
    const homeAndAway = rivals.every((rival) => {
      const meetings = meetingsWith(rival);
      return (
        meetings.length === 2 &&
        meetings.some((game) => game.homeAway === "home") &&
        meetings.some((game) => game.homeAway === "away")
      );
    });

    faq.push({
      question: `Who do the ${nick} play in the ${team.division}?`,
      answer:
        `The ${nick} ${v.play} ${count(divisionGames.length, "division game", "division games")} ` +
        `in ${season}, ${homeAndAway ? "home and away against the " : "against the "}` +
        `${listOf(rivals.map((rival) => rival.fullName))}. ` +
        `Division games are marked DIV in the schedule above.`,
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
                `Week ${game.week} ${wherePhrase(game)}` + (when ? ` on ${when}` : "")
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
    const unscheduled = games.filter((game) => !game.network).length;

    faq.push({
      question: `What channel are ${club} games on in ${season}?`,
      answer:
        `${season} ${nick} games ${v.areScheduled} on ` +
        `${listOf(ranked.map(([network]) => network))}. ` +
        (ranked.length > 1
          ? `${leader[0]} ${v.carries} the most with ${count(leader[1], "game", "games")}. `
          : "") +
        `The network for each week is shown in the schedule above` +
        (unscheduled
          ? `; ${count(unscheduled, "game", "games")} ${unscheduled === 1 ? "has" : "have"} ` +
            `no broadcast window assigned yet and ${unscheduled === 1 ? "shows" : "show"} none.`
          : `.`),
    });
  }

  /* ------------------------------------------------------ scores and results */

  const finals = games.filter((game) => game.result);

  if (finals.length) {
    const wins = finals.filter((game) => game.result?.outcome === "W").length;
    const losses = finals.filter((game) => game.result?.outcome === "L").length;
    const ties = finals.filter((game) => game.result?.outcome === "T").length;
    const record = ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
    const latest = finals[finals.length - 1] as ScheduleGame;
    const result = latest.result;

    faq.push({
      question: `Where can I see ${club} scores and results?`,
      answer:
        `Every completed game shows its final score in the schedule above` +
        // Dropped once there is nothing left to play: a finished season has no
        // row showing a date instead of a score, so the clause would describe
        // a table that is not there.
        (running ? `, and upcoming games show the date, venue and network instead` : ``) +
        `. ` +
        (running
          ? `The ${nick} are ${record} through ${count(finals.length, "game", "games")} in ${season}`
          : `The ${nick} finished ${season} at ${record}`) +
        // The latest result, while there is a next one to place it against.
        // "Most recently" about a season that ended in January is a phrase
        // pointing at nothing — the record above is the whole answer by then.
        (running && result
          ? `, most recently ${resultVerb(result.outcome)} ${opponentPhrase(latest)} ` +
            `${result.teamScore}-${result.opponentScore} in Week ${latest.week}.`
          : `.`),
    });
  } else {
    faq.push({
      question: `Where can I see ${club} scores and results?`,
      answer:
        `No ${season} ${nick} games have been played yet. Each row in the schedule ` +
        `above shows the date, venue and network now, and carries the final score ` +
        `once the game has been played.`,
    });
  }

  return faq;
}
