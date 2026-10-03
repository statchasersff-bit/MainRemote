/**
 * The aggregates behind the Stats tab.
 *
 * The split this file exists to hold up: **Stats is totals, Game Log is
 * games.** A reader asking "how many yards does he have" and a reader asking
 * "what did he do in Week 3" want different pages, and answering both on one
 * makes a page that answers neither well. Everything here is a sum, a rate or a
 * record across seasons; nothing here knows what a week is.
 *
 * Two sources, joined:
 *
 *   - `player_production.json` reaches back ten seasons and carries the real
 *     counting line for each. It is the spine of the career table, and it is
 *     the ONLY place a career passing or receiving total exists - the game logs
 *     start in 2023.
 *   - The game logs cover the current season, which production does not have
 *     until the year is filed. So the current year is aggregated off the log
 *     and appended.
 *
 * Where they overlap, production wins: it is the filed snapshot, and preferring
 * it means a completed season's line does not change depending on which of two
 * derivations the page happened to use.
 *
 * Nothing here projects. Every number is a sum of games that were played.
 */

import type { CareerSeasonStat } from "./types";
import type { ProductionSeason, ProductionTotals } from "./player-data";

/** One row of the career table. */
export interface CareerStatRow {
  season: number;
  /** Whether this is the season in progress, for the "to date" marker. */
  inProgress: boolean;
  gamesPlayed: number;
  totals: ProductionTotals;
  /** Fantasy points in the page's scoring format. */
  points: number;
  ppg: number;
  /** Positional finish by total points, when the season has one. */
  finish: number | null;
}

const EMPTY: ProductionTotals = {
  passCmp: 0, passAtt: 0, passYd: 0, passTd: 0, passInt: 0,
  rushAtt: 0, rushYd: 0, rushTd: 0,
  tgt: 0, rec: 0, recYd: 0, recTd: 0,
};

function addTotals(a: ProductionTotals, b: ProductionTotals): ProductionTotals {
  return {
    passCmp: a.passCmp + b.passCmp,
    passAtt: a.passAtt + b.passAtt,
    passYd: a.passYd + b.passYd,
    passTd: a.passTd + b.passTd,
    passInt: a.passInt + b.passInt,
    rushAtt: a.rushAtt + b.rushAtt,
    rushYd: a.rushYd + b.rushYd,
    rushTd: a.rushTd + b.rushTd,
    tgt: a.tgt + b.tgt,
    rec: a.rec + b.rec,
    recYd: a.recYd + b.recYd,
    recTd: a.recTd + b.recTd,
  };
}

/** A game-log season row in the production file's shape. */
function fromCareerSeason(row: CareerSeasonStat): ProductionTotals {
  return {
    passCmp: row.pass_cmp,
    passAtt: row.pass_att,
    passYd: row.pass_yd,
    passTd: row.pass_td,
    passInt: row.pass_int,
    rushAtt: row.rush_att,
    rushYd: row.rush_yd,
    rushTd: row.rush_td,
    tgt: row.targets,
    rec: row.receptions,
    recYd: row.rec_yd,
    recTd: row.rec_td,
  };
}

/**
 * The career table, newest season first.
 *
 * `currentSeason` is appended from the game log when production has not filed
 * it yet, which is every year until the season is over.
 */
export function careerStatRows(
  production: ProductionSeason[],
  careerSeasons: CareerSeasonStat[],
  currentSeason: number,
): CareerStatRow[] {
  const rows = new Map<number, CareerStatRow>();

  for (const entry of production) {
    if (entry.gamesPlayed <= 0) continue;
    rows.set(entry.season, {
      season: entry.season,
      inProgress: false,
      gamesPlayed: entry.gamesPlayed,
      totals: entry.totals,
      points: entry.total,
      ppg: entry.ppg,
      finish: entry.posFinishTotal,
    });
  }

  // The season in progress, and any completed season production has not filed.
  for (const entry of careerSeasons) {
    if (entry.gp <= 0 || rows.has(entry.season)) continue;
    rows.set(entry.season, {
      season: entry.season,
      inProgress: entry.season >= currentSeason,
      gamesPlayed: entry.gp,
      totals: fromCareerSeason(entry),
      points: entry.ppg * entry.gp,
      ppg: entry.ppg,
      finish: entry.posRank,
    });
  }

  return [...rows.values()].sort((a, b) => b.season - a.season);
}

/**
 * How many games a season offered. Seventeen from 2021, sixteen before it.
 *
 * Exported because availability is computed in two places off two different
 * shapes - the career rows here and the game-log tiers in player-data.ts - and
 * a league rule written down twice is a league rule that will be updated once.
 */
export function seasonGames(season: number): number {
  return season >= 2021 ? 17 : 16;
}

export interface CareerAvailability {
  played: number;
  possible: number;
  pct: number;
  /** Completed seasons only - see below. */
  seasons: number;
}

/**
 * Games played against games there were to play, across COMPLETED seasons.
 *
 * The season in progress is left out of both sides, because neither way of
 * including it is true: counted whole, a player who has appeared in one of a
 * year's seventeen games has missed sixteen he has not yet had the chance to
 * miss; counted as one of one, a year he has barely started reads as perfect
 * attendance. A rate over the seasons that finished is the only one that means
 * what the word says.
 *
 * `currentSeason` is checked as well as the row's own `inProgress` flag,
 * because that flag only gets set on a season the game logs contributed. A
 * year production has already filed a PARTIAL line for arrives marked
 * finished, and counting it whole charged one player fourteen absences for
 * games his league had not played yet.
 *
 * Null for a player whose only season is the one in progress.
 */
export function careerAvailability(
  rows: CareerStatRow[],
  currentSeason: number,
): CareerAvailability | null {
  const done = rows.filter(
    (row) => !row.inProgress && row.season < currentSeason,
  );
  if (done.length === 0) return null;

  const played = done.reduce((sum, row) => sum + row.gamesPlayed, 0);
  const possible = done.reduce((sum, row) => sum + seasonGames(row.season), 0);

  return {
    played,
    possible,
    pct: possible > 0 ? (played / possible) * 100 : 0,
    seasons: done.length,
  };
}

export interface CareerTotalsRow {
  seasons: number;
  gamesPlayed: number;
  totals: ProductionTotals;
  points: number;
  ppg: number;
}

export function careerTotals(rows: CareerStatRow[]): CareerTotalsRow {
  let totals = EMPTY;
  let gamesPlayed = 0;
  let points = 0;
  for (const row of rows) {
    totals = addTotals(totals, row.totals);
    gamesPlayed += row.gamesPlayed;
    points += row.points;
  }
  return {
    seasons: rows.length,
    gamesPlayed,
    totals,
    points,
    ppg: gamesPlayed > 0 ? points / gamesPlayed : 0,
  };
}

/**
 * The NFL passer rating.
 *
 * The real formula, with all four components clamped to [0, 2.375] as the
 * league defines them - not an approximation. Null below one attempt, where it
 * is undefined rather than zero.
 */
export function passerRating(totals: ProductionTotals): number | null {
  const { passAtt: att, passCmp: cmp, passYd: yds, passTd: td, passInt: ints } = totals;
  if (att <= 0) return null;
  const clamp = (v: number): number => Math.max(0, Math.min(2.375, v));
  const a = clamp((cmp / att - 0.3) * 5);
  const b = clamp((yds / att - 3) * 0.25);
  const c = clamp((td / att) * 20);
  const d = clamp(2.375 - (ints / att) * 25);
  return ((a + b + c + d) / 6) * 100;
}

export interface CareerHigh {
  label: string;
  value: string;
  detail: string;
}

/**
 * The records, straight off the table above them.
 *
 * Position-aware, because "most passing touchdowns" is not a fact about a wide
 * receiver. A record with no seasons behind it is not rendered - there is no
 * "0 yards, never" row.
 */
export function careerHighs(
  rows: CareerStatRow[],
  position: string | null,
): CareerHigh[] {
  if (rows.length === 0) return [];

  const best = (pick: (row: CareerStatRow) => number): CareerStatRow | null => {
    let out: CareerStatRow | null = null;
    for (const row of rows) {
      if (pick(row) <= 0) continue;
      if (!out || pick(row) > pick(out)) out = row;
    }
    return out;
  };

  const totals = careerTotals(rows);
  const highs: CareerHigh[] = [];
  const num = (n: number): string => Math.round(n).toLocaleString("en-US");

  const isQb = position === "QB";
  const isRusher = position === "RB" || isQb;
  const isReceiver = position === "WR" || position === "TE" || position === "RB";

  if (isQb) {
    const yards = best((row) => row.totals.passYd);
    if (yards) {
      highs.push({
        label: "Best passing season",
        value: `${num(yards.totals.passYd)} yards`,
        detail: String(yards.season),
      });
    }
    const tds = best((row) => row.totals.passTd);
    if (tds) {
      highs.push({
        label: "Most passing TD",
        value: num(tds.totals.passTd),
        detail: String(tds.season),
      });
    }
  }

  if (isReceiver) {
    const yards = best((row) => row.totals.recYd);
    if (yards) {
      highs.push({
        label: "Best receiving season",
        value: `${num(yards.totals.recYd)} yards`,
        detail: String(yards.season),
      });
    }
    const recs = best((row) => row.totals.rec);
    if (recs) {
      highs.push({
        label: "Most receptions",
        value: num(recs.totals.rec),
        detail: String(recs.season),
      });
    }
  }

  if (isRusher && !isQb) {
    const yards = best((row) => row.totals.rushYd);
    if (yards) {
      highs.push({
        label: "Best rushing season",
        value: `${num(yards.totals.rushYd)} yards`,
        detail: String(yards.season),
      });
    }
  }

  const points = best((row) => row.points);
  if (points) {
    highs.push({
      label: "Best fantasy season",
      value: `${points.points.toFixed(1)} pts`,
      detail:
        points.finish !== null
          ? `${points.season} · ${position ?? ""}${points.finish}`
          : String(points.season),
    });
  }

  if (isQb && totals.totals.passYd > 0) {
    highs.push({
      label: "Career passing yards",
      value: num(totals.totals.passYd),
      detail: `${totals.seasons} season${totals.seasons === 1 ? "" : "s"}`,
    });
  } else if (isReceiver && totals.totals.recYd > 0) {
    highs.push({
      label: "Career receiving yards",
      value: num(totals.totals.recYd),
      detail: `${totals.seasons} season${totals.seasons === 1 ? "" : "s"}`,
    });
  } else if (totals.totals.rushYd > 0) {
    highs.push({
      label: "Career rushing yards",
      value: num(totals.totals.rushYd),
      detail: `${totals.seasons} season${totals.seasons === 1 ? "" : "s"}`,
    });
  }

  return highs.slice(0, 6);
}

export interface StatsFaq {
  question: string;
  answer: string;
}

/**
 * The questions people type, answered from the totals above them.
 *
 * Every answer restates a number already rendered on the page. Nothing here
 * forecasts a game that has not been played - see rule 3 in player-render.ts.
 */
export function statsFaq(input: {
  name: string;
  position: string | null;
  season: number;
  seasonRow: CareerStatRow | null;
  totals: CareerTotalsRow;
  seasonRank: number | null;
}): StatsFaq[] {
  const { name, position, season, seasonRow, totals, seasonRank } = input;
  const faq: StatsFaq[] = [];
  const num = (n: number): string => Math.round(n).toLocaleString("en-US");
  const isQb = position === "QB";

  if (isQb && totals.totals.passYd > 0) {
    faq.push({
      question: `How many passing yards does ${name} have?`,
      answer:
        `${name} has ${num(totals.totals.passYd)} career passing yards across ` +
        `${totals.seasons} season${totals.seasons === 1 ? "" : "s"}` +
        (seasonRow && seasonRow.totals.passYd > 0
          ? `, including ${num(seasonRow.totals.passYd)} in ${season}.`
          : "."),
    });
    faq.push({
      question: `How many touchdowns does ${name} have?`,
      answer:
        `${name} has thrown ${num(totals.totals.passTd)} career touchdown pass${totals.totals.passTd === 1 ? "" : "es"}` +
        (totals.totals.rushTd > 0
          ? ` and run for ${num(totals.totals.rushTd)} more.`
          : "."),
    });
  } else if (totals.totals.recYd > 0 || totals.totals.rushYd > 0) {
    const scrimmage = totals.totals.recYd + totals.totals.rushYd;
    faq.push({
      question: `How many yards does ${name} have?`,
      answer:
        `${name} has ${num(scrimmage)} career yards from scrimmage across ` +
        `${totals.seasons} season${totals.seasons === 1 ? "" : "s"}` +
        (totals.totals.recYd > 0 && totals.totals.rushYd > 0
          ? ` - ${num(totals.totals.recYd)} receiving and ${num(totals.totals.rushYd)} rushing.`
          : "."),
    });
    const tds = totals.totals.recTd + totals.totals.rushTd;
    if (tds > 0) {
      faq.push({
        question: `How many touchdowns does ${name} have?`,
        answer: `${name} has scored ${num(tds)} career touchdown${tds === 1 ? "" : "s"}.`,
      });
    }
  }

  faq.push({
    question: `How many fantasy points does ${name} have?`,
    answer:
      (seasonRow
        ? `${name} has ${seasonRow.points.toFixed(1)} fantasy points in ${season}, ` +
          `${seasonRow.ppg.toFixed(1)} per game` +
          (seasonRank !== null ? `, which ranks ${position ?? ""}${seasonRank}.` : ".")
        : `${name} has not scored fantasy points in ${season}.`) +
      ` His career total is ${totals.points.toFixed(1)} across ${totals.gamesPlayed} games.`,
  });

  faq.push({
    question: `What are ${name}'s career stats?`,
    answer:
      `Across ${totals.seasons} season${totals.seasons === 1 ? "" : "s"} and ` +
      `${totals.gamesPlayed} games, ${name} has ` +
      (isQb
        ? `${num(totals.totals.passYd)} passing yards, ${num(totals.totals.passTd)} touchdowns and ${num(totals.totals.passInt)} interceptions`
        : `${num(totals.totals.recYd + totals.totals.rushYd)} yards from scrimmage and ${num(totals.totals.recTd + totals.totals.rushTd)} touchdowns`) +
      `, for ${totals.points.toFixed(1)} fantasy points.`,
  });

  return faq;
}
