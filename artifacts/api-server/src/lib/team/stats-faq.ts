/**
 * The questions a team's stat lines get asked, answered from the same rows.
 *
 * Sibling to outlook-faq.ts and built on the same rule: every answer restates
 * something the tab already printed. Here that is literal — the numbers are
 * lifted as the preformatted `value` strings the ladders and tiles render, so
 * an answer cannot round differently from the tile six inches above it, and a
 * change to a metric's format changes both at once or neither.
 *
 * The difference from the outlook's FAQ is that these numbers move. An outlook
 * is written once and is stale or it is not; a stat line is a running average
 * over however many games have happened, and in September that is one. So this
 * module carries three pieces of care the other one does not need:
 *
 * First, the season it talks about is `stats.season`, never the calendar's.
 * getTeamStats() falls back a year while the new season has no completed
 * football in it, and a question reading "in 2026" over a block of 2025 numbers
 * is not a framing problem, it is a false statement. The Stats tab's own note
 * is keyed the same way and for the same reason.
 *
 * Second, the denominator is games played, not the league week. A team on bye
 * has played fewer games than the week number, and every figure here is a
 * per-game rate — "through 1 game" is what the average actually divides by, and
 * it is what the note above the ladders says.
 *
 * Third, a thin sample says so. Three games of ranks are real numbers and a
 * near-worthless prediction, and the answers most likely to be quoted out of
 * context are exactly the rank ones. The caveat is attached to those rather
 * than to all of them, because appending it to "how often do they pass" would
 * be noise on a question the sample answers perfectly well.
 *
 * On rank direction: the ladders carry a note saying 1st on defence means
 * fewest allowed, because a column of ranks needs it. A sentence does not get
 * that note, so defensive and volume ranks are spelled out as "the 5th-fewest"
 * and "the 3rd-most" instead. The reader never has to know which way the
 * column ran.
 */

import type { NflTeam } from "./teams";
import type { HistorySeason, StatRow, TeamStats } from "./stats";

export interface StatsFaq {
  question: string;
  answer: string;
}

function findRow(rows: readonly StatRow[], key: string): StatRow | undefined {
  return rows.find((row) => row.key === key);
}

/**
 * A rank as a sentence reads it.
 *
 * `superlative` is what removes the ambiguity a bare ordinal carries outside a
 * labelled column: "5th in points allowed" is read as fifth-worst by about half
 * of everyone, and "the 5th-fewest" cannot be. 1st drops the ordinal entirely,
 * because "the 1st-fewest" is not English.
 *
 * No "in the NFL" here. Two ranks in one sentence want it once at the end, and
 * a phrase that carries it cannot be used twice without saying it twice.
 *
 * Returns null rather than a guess when the metric could not be ranked — too
 * few teams reporting it, which is the ordinary state of an early season — and
 * every caller drops the clause rather than the answer.
 */
function rankPhrase(
  row: StatRow | undefined,
  superlative?: "fewest" | "most",
): string | null {
  if (!row || row.rank == null || !row.rankLabel) return null;

  const tied = row.rankLabel.startsWith("T-");
  const ordinal = tied ? row.rankLabel.slice(2) : row.rankLabel;

  const phrase = superlative
    ? row.rank === 1
      ? `the ${superlative}`
      : `the ${ordinal}-${superlative}`
    : ordinal;

  return tied ? `tied for ${phrase}` : phrase;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A history row's cell, when that season reported the metric at all. */
function historyCell(season: HistorySeason | undefined, key: string): StatRow | undefined {
  return season ? findRow(season.cells, key) : undefined;
}

export function statsFaq(input: {
  team: NflTeam;
  stats: TeamStats;
  /** The league's current season, which is not always the one on the tab. */
  currentSeason: number;
}): StatsFaq[] {
  const { team, stats, currentSeason } = input;

  const games = stats.gamesPlayed ?? 0;
  if (games <= 0) return [];

  const season = stats.season;
  // Numbers from a season the league has moved past are finished; the ones from
  // the season being played are still moving, and every tense below turns on it.
  const running = season >= currentSeason;

  const club = team.fullName;
  const nick = team.nickname;
  const city = team.city;
  const faq: StatsFaq[] = [];

  const when = running
    ? `through ${count(games, "game", "games")} of the ${season} season`
    : `in the ${season} regular season`;

  /**
   * Tense, in one place.
   *
   * Not a flourish. getTeamStats() serves the previous season for the whole of
   * the off-season and through the opening week, so "the Patriots are averaging
   * 28.8 points" runs over a season that finished in February for several
   * months of every year. The same split game-log-faq.ts is built on, applied
   * to the verbs a team page happens to need.
   */
  const v = {
    areAveraging: running ? "are averaging" : "averaged",
    isAveraging: running ? "is averaging" : "averaged",
    hasAveraged: running ? "has averaged" : "averaged",
    ranks: running ? "ranks" : "ranked",
    hasAllowed: running ? "has allowed" : "allowed",
    oppAveraging: running ? "are averaging" : "averaged",
    haveBeen: running ? "have been" : "were",
    run: running ? "run" : "ran",
    have: running ? "have" : "had",
    haveCommitted: running ? "have committed" : "committed",
    thatIs: running ? "That is" : "That was",
  };

  // Attached only to the answers whose whole content is a rank or a comparison.
  // Four games is where a per-game rate stops being mostly one afternoon.
  const thin =
    running && games < 4
      ? ` Only ${count(games, "game", "games")} ${games === 1 ? "has" : "have"} been played, so these figures and ranks will still move a lot.`
      : "";

  const off = stats.offense;
  const def = stats.defense;

  const points = findRow(off, "off-points");
  const totalYards = findRow(off, "off-total-yards");
  const passYards = findRow(off, "off-pass-yards");
  const rushYards = findRow(off, "off-rush-yards");
  const yardsPerPlay = findRow(off, "off-yards-per-play");
  const perAttempt = findRow(off, "off-yards-per-attempt");
  const perCarry = findRow(off, "off-yards-per-carry");

  const prior = stats.history[1];

  if (points) {
    const rank = rankPhrase(points);
    // Last season's scoring, when the history table has it. It is the context
    // that makes a one-game average legible, and it is already a row on this
    // tab — the same number, from the same place.
    const priorPoints = historyCell(prior, "off-points");
    faq.push({
      question: running
        ? `How many points per game are the ${club} averaging in ${season}?`
        : `How many points per game did the ${club} average in ${season}?`,
      answer:
        `The ${nick} ${v.areAveraging} ${points.value} points per game ${when}` +
        (rank ? `, ${rank} in the NFL.` : ".") +
        (priorPoints && prior
          ? ` They scored ${priorPoints.value} per game in ${prior.season}.`
          : "") +
        thin,
    });
  }

  if (totalYards) {
    const rank = rankPhrase(totalYards);
    const split =
      passYards && rushYards
        ? ` — ${passYards.value} passing and ${rushYards.value} rushing.`
        : ".";
    faq.push({
      question: running
        ? `How many yards per game are the ${nick} averaging in ${season}?`
        : `How many yards per game did the ${nick} average in ${season}?`,
      answer:
        `${city} ${v.isAveraging} ${totalYards.value} total yards per game ${when}` +
        (rank ? `, ${rank} in the NFL` : "") +
        split,
    });
  }

  // The rank question, answered with the two ranks rather than with a verdict.
  // "Near the bottom of the NFL" is a summary this module is not entitled to
  // write; 32nd and 30th are what the ladders say.
  if (points?.rankLabel || yardsPerPlay?.rankLabel) {
    // No "in the NFL" in either clause — the question just said it, and twice
    // in one sentence is how a generated answer starts sounding generated.
    const parts = [
      points?.rankLabel
        ? `${rankPhrase(points)} in points per game (${points.value})`
        : null,
      yardsPerPlay?.rankLabel
        ? `${rankPhrase(yardsPerPlay)} in yards per play (${yardsPerPlay.value})`
        : null,
    ].filter((part): part is string => part !== null);

    faq.push({
      question: running
        ? `How does the ${nick} offense rank in the NFL in ${season}?`
        : `How did the ${nick} offense rank in the NFL in ${season}?`,
      answer:
        `${when.charAt(0).toUpperCase()}${when.slice(1)}, the ${nick} offense ` +
        `${v.ranks} ${parts.join(" and ")}.` +
        thin,
    });
  }

  const defPoints = findRow(def, "def-points");
  const defYards = findRow(def, "def-total-yards");
  const defPerPlay = findRow(def, "def-yards-per-play");
  if (defPoints || defYards) {
    const allowed = [
      defPoints ? `${defPoints.value} points` : null,
      defYards ? `${defYards.value} total yards` : null,
    ].filter((part): part is string => part !== null);

    // The figures first, then a rank per sentence. Threading a rank clause
    // between two numbers ("13.0 points, the 6th-fewest, and 285.0 yards")
    // leaves the second one stranded on the far side of an aside.
    const pointsRank = rankPhrase(defPoints, "fewest");
    const perPlayRank = rankPhrase(defPerPlay, "fewest");

    faq.push({
      question: running
        ? `How good is the ${nick} defense in ${season}?`
        : `How good was the ${nick} defense in ${season}?`,
      answer:
        `${city} ${v.hasAllowed} ${allowed.join(" and ")} per game ${when}.` +
        (pointsRank ? ` ${v.thatIs} ${pointsRank} points allowed in the NFL.` : "") +
        (defPerPlay && perPlayRank
          ? ` Opponents ${v.oppAveraging} ${defPerPlay.value} yards a play, ` +
            `${perPlayRank} allowed.`
          : "") +
        thin,
    });
  }

  if (passYards && rushYards) {
    const rates =
      perAttempt && perCarry
        ? ` ${v.thatIs} ${perAttempt.value} yards per pass attempt compared with ` +
          `${perCarry.value} per carry.`
        : "";
    faq.push({
      question: running
        ? `Are the ${nick} better at passing or running the ball in ${season}?`
        : `Were the ${nick} better at passing or running the ball in ${season}?`,
      answer:
        `${city} ${v.hasAveraged} ${passYards.value} passing yards and ` +
        `${rushYards.value} rushing yards per game ${when}.${rates}`,
    });
  }

  if (stats.balance) {
    const plays = findRow(stats.volume, "plays");
    const pace = plays ? rankPhrase(plays, "most") : null;
    faq.push({
      question: running
        ? `How often do the ${nick} pass the ball?`
        : `How often did the ${nick} pass the ball in ${season}?`,
      answer:
        `${stats.balance.passPct.toFixed(1)}% of ${city}'s offensive plays ` +
        `${v.haveBeen} passes and ${stats.balance.rushPct.toFixed(1)}% runs ${when}.` +
        (plays && pace
          ? ` They ${v.run} ${plays.value} plays a game, ${pace} in the league.`
          : ""),
    });
  }

  const margin = findRow(stats.situational, "turnover-margin");
  if (margin) {
    const giveaways = findRow(stats.situational, "giveaways");
    const takeaways = findRow(stats.situational, "takeaways");
    // Season totals, not rates, which is why nothing here is divided by games.
    const detail =
      giveaways && takeaways
        ? ` They ${v.haveCommitted} ${giveaways.value} giveaways and forced ` +
          `${takeaways.value} takeaways.`
        : "";
    faq.push({
      question: running
        ? `What is the ${club} turnover margin in ${season}?`
        : `What was the ${club} turnover margin in ${season}?`,
      answer:
        `The ${nick} ${v.have} a ${margin.value} turnover margin ${when}.${detail}`,
    });
  }

  // Last, because it only means anything once the numbers above it have been
  // read — the same order the tab puts the history table in.
  if (prior) {
    const nowPoints = historyCell(stats.history[0], "off-points");
    const nowYards = historyCell(stats.history[0], "off-total-yards");
    const wasPoints = historyCell(prior, "off-points");
    const wasYards = historyCell(prior, "off-total-yards");

    // A season per sentence. Interleaving them ("10.0 against 28.8 and 277.0
    // against 379.4") makes the reader hold four numbers and two years at once
    // to extract a comparison that is the entire point of the answer.
    const now = [
      nowPoints ? `${nowPoints.value} points` : null,
      nowYards ? `${nowYards.value} total yards` : null,
    ].filter((part): part is string => part !== null);
    const was = [
      wasPoints ? `${wasPoints.value} points` : null,
      wasYards ? `${wasYards.value} total yards` : null,
    ].filter((part): part is string => part !== null);

    if (now.length && now.length === was.length) {
      faq.push({
        question: running
          ? `How do the ${season} ${nick} compare with the ${prior.season} team?`
          : `How did the ${season} ${nick} compare with the ${prior.season} team?`,
        answer:
          `${city} ${v.isAveraging} ${now.join(" and ")} per game ${when}. ` +
          `In ${prior.season} the ${nick} averaged ${was.join(" and ")}.` +
          (thin
            ? thin
            : running
              ? ` The ${season} season is still in progress, so that gap is a ` +
                `running one.`
              : ""),
      });
    }
  }

  return faq;
}
