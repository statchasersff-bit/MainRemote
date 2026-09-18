/**
 * The questions a game log gets asked, answered from the weeks above them.
 *
 * The Stats tab's FAQ (stats-profile.ts) answers career questions — "how many
 * yards does he have". This one answers *weekly* ones: how many games, what a
 * week averages, which week was the best, where the weeks finished. Same split
 * the two tabs are built on, and the reason this is a second builder rather
 * than more branches inside the first: a question about Week 3 and a question
 * about a career total are different searches, and an FAQ that mixes them
 * answers neither.
 *
 * Every answer restates a number the table or the tiles already printed. Rule 3
 * in player-render.ts applies with no exceptions here — the FAQ is the easiest
 * place on the page to slip into saying what happens next, because that is what
 * the questions people type are usually reaching for. It never does.
 *
 * Tense follows the season. A season in progress reads "is averaging ... through
 * Week 5"; a filed one reads "averaged ... in 2024". The through-week clause is
 * the load-bearing half of that: "17 games through Week 18" is noise on a season
 * that ended, and "1 game in 2026" with no week attached reads like the season
 * is over when it is one Sunday old.
 *
 * Nothing here says "he". The generated prose names the player once in full and
 * by surname after (bio.ts gives the reason), which happens to keep every
 * sentence pronoun-free — worth preserving, since a pronoun is a fact about a
 * person that the game logs do not carry.
 */

import { TEAM_NAMES } from "../render";
import { surname } from "./bio";
import type { GameLogSummary } from "./metrics";
import { fpts, perGameRates } from "./metrics";
import { SCORING_LABELS, type ScoringFormat } from "./scoring";
import type { GameLogEntry } from "./types";

export interface GameLogFaq {
  question: string;
  answer: string;
}

function statOf(entry: GameLogEntry, key: string): number {
  const value = (entry.stats as unknown as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function sumStat(entries: GameLogEntry[], key: string): number {
  return entries.reduce((total, entry) => total + statOf(entry, key), 0);
}

/** "3 games", "1 game" — the count and its noun, which always agree. */
function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * "the Los Angeles Chargers", spelled out.
 *
 * The table prints "LAC" because a column is narrow and a reader scanning rows
 * reads abbreviations fine. A sentence is not a column, and an FAQ answer is
 * also what a voice assistant reads aloud, where "LAC" is not a word.
 */
function oppName(code: string): string {
  const key = code.replace(/^@/, "").toLowerCase();
  const full = TEAM_NAMES[key];
  return full ? `the ${full}` : code;
}

/** "2025, 2024 and 2023" — the form a sentence reads, not a comma list. */
function seasonList(years: number[]): string {
  if (years.length === 1) return String(years[0]);
  const head = years.slice(0, -1).join(", ");
  return `${head} and ${years[years.length - 1]}`;
}

export function gameLogFaq(input: {
  name: string;
  position: string | null;
  /** The season the tab is showing, which is not always the current one. */
  season: number;
  /** Whether that season is the one in progress, which sets every tense. */
  inProgress: boolean;
  /** The weeks actually played, in week order. */
  played: GameLogEntry[];
  stats: GameLogSummary;
  format: ScoringFormat;
  /** The other seasons the selector offers, newest first. */
  otherSeasons: number[];
}): GameLogFaq[] {
  const {
    name,
    position,
    season,
    inProgress,
    played,
    stats,
    format,
    otherSeasons,
  } = input;
  if (played.length === 0 || stats.gamesPlayed === 0) return [];

  const last = surname(name);
  const pos = position ?? "";
  const scoring = SCORING_LABELS[format];
  const faq: GameLogFaq[] = [];

  const num = (value: number, digits = 1): string => value.toFixed(digits);
  const whole = (value: number): string =>
    Math.round(value).toLocaleString("en-US");

  /* ---------------------------------------------------------- tense ---- */

  // Every sentence below is built from these three, so the whole FAQ turns
  // together. A season still being played takes the present continuous — the
  // number will be different next Sunday and the grammar should say so. A filed
  // season takes the simple past, because "has averaged" against a year that
  // ended is a sentence with one foot in each tense.
  const latestWeek = played.reduce((high, entry) => Math.max(high, entry.week), 0);
  const through = inProgress && latestWeek > 0 ? `through Week ${latestWeek}` : "";
  /** The clause most of these sentences end on. */
  const when = through ? `${through} of the ${season} season` : `in ${season}`;
  const soFar = inProgress ? " so far" : "";
  const averaging = inProgress ? "is averaging" : "averaged";
  /** "has X thrown" / "did X throw" — a question's auxiliary and its verb. */
  const asked = (verb: string, past: string): string =>
    inProgress ? `has ${name} ${verb}` : `did ${name} ${past}`;
  /** The same verb in the answer: "has thrown" / "threw". */
  const told = (verb: string, past: string): string =>
    inProgress ? `has ${verb}` : past;

  /* ------------------------------------------------------- the weeks ---- */

  faq.push({
    question: inProgress
      ? `How many games has ${name} played in ${season}?`
      : `How many games did ${name} play in ${season}?`,
    answer:
      `${name} ${inProgress ? "has played" : "played"} ` +
      `${count(stats.gamesPlayed, "game", "games")} in the ${season} season` +
      (through ? ` ${through}.` : "."),
  });

  faq.push({
    question: inProgress
      ? `How many fantasy points is ${name} averaging in ${season}?`
      : `How many fantasy points did ${name} average in ${season}?`,
    answer:
      `${last} ${averaging} ${num(stats.ppg)} ${scoring} fantasy points per ` +
      `game ${when}` +
      (stats.gamesPlayed > 1
        ? `, ${num(stats.totalPts)} in total across ` +
          `${count(stats.gamesPlayed, "game", "games")}.`
        : "."),
  });

  const best = stats.bestWeek;
  if (best) {
    faq.push({
      question: `What was ${name}'s best fantasy game in ${season}?`,
      answer:
        `${last}'s best game${soFar} came in Week ${best.week} against ` +
        `${oppName(best.opp)}, worth ${num(fpts(best, format))} ${scoring} ` +
        `fantasy points.`,
    });
  }

  // Only once there are enough weeks for a floor to mean something. With two
  // games "the worst" is just the other one, and printing it as a low says
  // something about the player that the sample does not support.
  if (best && stats.gamesPlayed >= 3) {
    const low = played.reduce((worst, entry) =>
      fpts(entry, format) < fpts(worst, format) ? entry : worst,
    );
    // A colon here where the best week takes "worth", because a bad week can
    // score negative points and nothing is "worth -0.1".
    if (low.week !== best.week) {
      faq.push({
        question: `What was ${name}'s worst fantasy game in ${season}?`,
        answer:
          `${last}'s lowest output${soFar} came in Week ${low.week} against ` +
          `${oppName(low.opp)}: ${num(fpts(low, format))} ${scoring} ` +
          `fantasy points.`,
      });
    }
  }

  /* ------------------------------------------------------- the rates ---- */

  // Off the same rates the tiles are built from, so the FAQ cannot disagree
  // with the row above it. Yardage first: it is what gets typed, and it is the
  // one rate that means the same thing at every position.
  //
  // The second rate is the position's opportunity number — carries, targets —
  // which is a genuinely different question from the yards it produced. A
  // quarterback gets no second rate: his would be touchdowns per game, and the
  // touchdown question two blocks down already answers that better.
  const rates = perGameRates(played, position).filter((rate) => rate.prose);
  const yards = rates.find((rate) => rate.prose?.includes("yards"));
  const volume =
    pos === "QB" ? undefined : rates.find((rate) => rate !== yards && !rate.pct);
  for (const rate of [yards, volume]) {
    if (!rate?.prose || rate.value <= 0) continue;
    faq.push({
      question: inProgress
        ? `How many ${rate.prose} is ${name} averaging per game?`
        : `How many ${rate.prose} did ${name} average per game in ${season}?`,
      answer:
        `${last} ${averaging} ${num(rate.value, rate.digits)} ${rate.prose} ` +
        `per game ${when}.`,
    });
  }

  /* --------------------------------------------------- the touchdowns ---- */

  const passAtt = sumStat(played, "pass_att");
  const rushTd = sumStat(played, "rush_td");
  const recTd = sumStat(played, "rec_td");

  if (pos === "QB" && passAtt > 0) {
    const passTd = sumStat(played, "pass_td");
    faq.push({
      question: `How many touchdowns ${asked("thrown", "throw")} in ${season}?`,
      answer:
        `${last} ${told("thrown", "threw")} ` +
        `${count(passTd, "passing touchdown", "passing touchdowns")} ${when}` +
        (rushTd > 0 ? ` and ran for ${whole(rushTd)} more.` : "."),
    });
    // A zero here is the answer to the question, not a missing field: "how many
    // interceptions" is asked precisely by people hoping the number is small.
    faq.push({
      question: `How many interceptions ${asked("thrown", "throw")} in ${season}?`,
      answer:
        `${last} ${told("thrown", "threw")} ` +
        `${count(sumStat(played, "pass_int"), "interception", "interceptions")} ` +
        `${when}.`,
    });
  } else if (sumStat(played, "rush_att") + sumStat(played, "rec_tgt") > 0) {
    const total = rushTd + recTd;
    faq.push({
      question: `How many touchdowns ${asked("scored", "score")} in ${season}?`,
      answer:
        `${last} ${told("scored", "scored")} ` +
        `${count(total, "touchdown", "touchdowns")} ${when}` +
        (rushTd > 0 && recTd > 0
          ? ` — ${whole(rushTd)} rushing and ${whole(recTd)} receiving.`
          : "."),
    });
  }

  /* ----------------------------------------------------- the finishes ---- */

  // Ranked weeks only. Without a rank behind them every count below is zero,
  // and "0 top-12 finishes" is then a false statement rather than a missing
  // one — the same guard the summary above the table uses.
  const ranked = played.filter((entry) => entry.pos_rank != null);
  if (ranked.length > 0) {
    const top24 = stats.pos1Games + stats.pos2Games;
    const bestFinish = ranked.reduce((pick, entry) =>
      (entry.pos_rank as number) < (pick.pos_rank as number) ? entry : pick,
    );
    faq.push(
      ranked.length === 1
        ? {
            question: `What was ${name}'s weekly fantasy finish in ${season}?`,
            answer:
              `${last} finished as the ${pos}${bestFinish.pos_rank} in Week ` +
              `${bestFinish.week}.`,
          }
        : {
            question: inProgress
              ? `How often has ${name} finished as a top-12 ${pos || "option"}?`
              : `How often did ${name} finish as a top-12 ${pos || "option"} in ${season}?`,
            answer:
              `${last} ${inProgress ? "has recorded" : "recorded"} ` +
              `${count(stats.pos1Games, `top-12 ${pos} finish`, `top-12 ${pos} finishes`)} ` +
              `and ${count(top24, "top-24 finish", "top-24 finishes")} in ` +
              `${count(ranked.length, "ranked week", "ranked weeks")}. ` +
              `The best was ${pos}${bestFinish.pos_rank} in Week ${bestFinish.week}.`,
          },
    );
  }

  /* ------------------------------------------------------ the archive ---- */

  if (otherSeasons.length > 0) {
    faq.push({
      question: `Can I view ${name}'s game logs from previous seasons?`,
      answer:
        `Yes. The season selector above the game log switches the table to ` +
        `${last}'s weekly results from ${seasonList(otherSeasons)}.`,
    });
  }

  return faq;
}
