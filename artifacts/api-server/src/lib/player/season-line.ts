/**
 * One season's counting totals, and how the hero and the Overview print them.
 *
 * mak's player-entity brief (2026-11-03) puts the player's NFL production
 * ahead of his fantasy numbers at the top of the page: "39 REC, 533 YDS, 2
 * TD, 13.7 Y/R" under the name, and a short season table on the Overview
 * with a link to the Stats tab. Both read this module, so the two cannot
 * disagree - the number under the name is the number in the table, summed
 * from the same game log the Stats tab sums.
 *
 * A leaf module: the hero (header.ts) and the Overview (overview.ts) import
 * it, and it imports nothing of theirs.
 */

import type { GameLogEntry } from "./types";

export interface SeasonTotals {
  gp: number;
  att: number;
  cmp: number;
  passYd: number;
  passTd: number;
  int: number;
  rushAtt: number;
  rushYd: number;
  rushTd: number;
  tgt: number;
  rec: number;
  recYd: number;
  recTd: number;
  fgm: number;
  fga: number;
  xpm: number;
  xpa: number;
  pts: number;
}

const EMPTY: SeasonTotals = {
  gp: 0, att: 0, cmp: 0, passYd: 0, passTd: 0, int: 0, rushAtt: 0, rushYd: 0, rushTd: 0,
  tgt: 0, rec: 0, recYd: 0, recTd: 0, fgm: 0, fga: 0, xpm: 0, xpa: 0, pts: 0,
};

/** The played weeks of a log: the rows with a stat line behind them. */
export function playedEntries(log: GameLogEntry[]): GameLogEntry[] {
  return log.filter((e) => (e.game_status ?? "active") === "active" && e.stats);
}

/** Totals over the entries given, with their fantasy points under `pts`. */
export function seasonTotals(entries: GameLogEntry[], pts: (e: GameLogEntry) => number): SeasonTotals {
  const t: SeasonTotals = { ...EMPTY };
  const v = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  for (const e of entries) {
    const st = e.stats as unknown as Record<string, unknown>;
    t.gp += 1;
    t.att += v(st["pass_att"]); t.cmp += v(st["pass_cmp"]); t.passYd += v(st["pass_yd"]);
    t.passTd += v(st["pass_td"]); t.int += v(st["pass_int"]);
    t.rushAtt += v(st["rush_att"]); t.rushYd += v(st["rush_yd"]); t.rushTd += v(st["rush_td"]);
    t.tgt += v(st["rec_tgt"]); t.rec += v(st["rec"]); t.recYd += v(st["rec_yd"]); t.recTd += v(st["rec_td"]);
    t.fgm += v(st["fgm"]); t.fga += v(st["fga"]); t.xpm += v(st["xpm"]); t.xpa += v(st["xpa"]);
    t.pts += pts(e);
  }
  return t;
}

const DASH = "-";
const whole = (n: number): string => Math.round(n).toLocaleString("en-US");
const one = (n: number): string => n.toFixed(1);
const per = (a: number, b: number): string => (b > 0 ? one(a / b) : DASH);

export interface LineCell {
  /** The short label: "REC", "Y/R". */
  label: string;
  value: string;
  /** The spelled-out label, for a screen reader and a tooltip. */
  title: string;
}

/**
 * The four figures under the name, by position.
 *
 * Counting stats and one rate, the way a box score reads: what he did, not
 * how he scored. Empty for a position the logs carry nothing for, and for a
 * player with no games - the caller leaves the line out.
 */
export function heroCells(position: string | null, t: SeasonTotals): LineCell[] {
  if (t.gp === 0) return [];
  switch (position) {
    case "QB":
      return [
        { label: "CMP/ATT", value: `${whole(t.cmp)}/${whole(t.att)}`, title: "Completions and attempts" },
        { label: "PASS YDS", value: whole(t.passYd), title: "Passing yards" },
        { label: "PASS TD", value: whole(t.passTd), title: "Passing touchdowns" },
        { label: "INT", value: whole(t.int), title: "Interceptions" },
      ];
    case "RB":
      return [
        { label: "CAR", value: whole(t.rushAtt), title: "Carries" },
        { label: "RUSH YDS", value: whole(t.rushYd), title: "Rushing yards" },
        { label: "TD", value: whole(t.rushTd + t.recTd), title: "Rushing and receiving touchdowns" },
        { label: "REC", value: whole(t.rec), title: "Receptions" },
      ];
    case "WR":
    case "TE":
      return [
        { label: "REC", value: whole(t.rec), title: "Receptions" },
        { label: "YDS", value: whole(t.recYd), title: "Receiving yards" },
        { label: "TD", value: whole(t.recTd), title: "Receiving touchdowns" },
        { label: "Y/R", value: per(t.recYd, t.rec), title: "Yards per reception" },
      ];
    case "K":
      return [
        { label: "FG", value: `${whole(t.fgm)}/${whole(t.fga)}`, title: "Field goals made and attempted" },
        { label: "XP", value: `${whole(t.xpm)}/${whole(t.xpa)}`, title: "Extra points made and attempted" },
      ];
    default:
      return [];
  }
}

export interface TableCol {
  label: string;
  title: string;
  of: (t: SeasonTotals) => string;
}

/**
 * The Overview's season table, by position: games, the counting stats,
 * the one rate, then the fantasy total and rate the rest of the page is
 * measured in. The fantasy columns close the row rather than open it (the
 * brief's hierarchy: the player's production first).
 */
export function tableCols(position: string | null, scoring: string): TableCol[] {
  const games: TableCol = { label: "GP", title: "Games played", of: (t) => whole(t.gp) };
  const fantasy: TableCol[] = [
    { label: `${scoring} PTS`, title: `${scoring} fantasy points`, of: (t) => one(t.pts) },
    { label: "PPG", title: "Fantasy points per game", of: (t) => per(t.pts, t.gp) },
  ];
  switch (position) {
    case "QB":
      return [
        games,
        { label: "CMP", title: "Completions", of: (t) => whole(t.cmp) },
        { label: "ATT", title: "Pass attempts", of: (t) => whole(t.att) },
        { label: "PASS YDS", title: "Passing yards", of: (t) => whole(t.passYd) },
        { label: "PASS TD", title: "Passing touchdowns", of: (t) => whole(t.passTd) },
        { label: "INT", title: "Interceptions", of: (t) => whole(t.int) },
        { label: "RUSH YDS", title: "Rushing yards", of: (t) => whole(t.rushYd) },
        { label: "RUSH TD", title: "Rushing touchdowns", of: (t) => whole(t.rushTd) },
        ...fantasy,
      ];
    case "RB":
      return [
        games,
        { label: "CAR", title: "Carries", of: (t) => whole(t.rushAtt) },
        { label: "RUSH YDS", title: "Rushing yards", of: (t) => whole(t.rushYd) },
        { label: "YPC", title: "Yards per carry", of: (t) => per(t.rushYd, t.rushAtt) },
        { label: "RUSH TD", title: "Rushing touchdowns", of: (t) => whole(t.rushTd) },
        { label: "TGT", title: "Targets", of: (t) => whole(t.tgt) },
        { label: "REC", title: "Receptions", of: (t) => whole(t.rec) },
        { label: "REC YDS", title: "Receiving yards", of: (t) => whole(t.recYd) },
        { label: "REC TD", title: "Receiving touchdowns", of: (t) => whole(t.recTd) },
        ...fantasy,
      ];
    case "WR":
    case "TE":
      return [
        games,
        { label: "TGT", title: "Targets", of: (t) => whole(t.tgt) },
        { label: "REC", title: "Receptions", of: (t) => whole(t.rec) },
        { label: "YDS", title: "Receiving yards", of: (t) => whole(t.recYd) },
        { label: "Y/R", title: "Yards per reception", of: (t) => per(t.recYd, t.rec) },
        { label: "TD", title: "Receiving touchdowns", of: (t) => whole(t.recTd) },
        { label: "RUSH YDS", title: "Rushing yards", of: (t) => whole(t.rushYd) },
        ...fantasy,
      ];
    case "K":
      return [
        games,
        { label: "FGM", title: "Field goals made", of: (t) => whole(t.fgm) },
        { label: "FGA", title: "Field goals attempted", of: (t) => whole(t.fga) },
        { label: "XPM", title: "Extra points made", of: (t) => whole(t.xpm) },
        { label: "XPA", title: "Extra points attempted", of: (t) => whole(t.xpa) },
        ...fantasy,
      ];
    default:
      return [];
  }
}
