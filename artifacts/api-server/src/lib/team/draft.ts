/**
 * The team hub's Draft tab: what a club holds in the next draft, and what it
 * did with the last five.
 *
 * Two files, both built by hand-run scripts and committed:
 *
 *   data/team/draft_picks_<year>.json   scripts/team/buildDraftPicks.mjs
 *     The next draft's ownership by round - own picks, picks acquired and the
 *     club each came from, picks sent away. Rebuilt after a trade that moves
 *     a pick and after the compensatory awards in March.
 *
 *   data/team/draft_history.json        scripts/team/buildDraftHistory.mjs
 *     Every pick of the last ten drafts from the nflverse register, with the
 *     career counters it carries. Rebuilt once a year when the new draft
 *     lands in the register, and whenever the counters are wanted fresh.
 *
 * Neither is in the daily chain: pick ownership moves with trades and the
 * history moves once a year, so both are run when something happened.
 *
 * The Prospects view (who the mocks send here) has no free source - the
 * aggregators sell that feed - so the tab carries the two views that can be
 * built from the register and the order, and leaves room for a third.
 */

import fs from "node:fs";
import { dataPath } from "../data-dir";
import { readDataJson } from "./read-json";

/* ------------------------------------------------------------------ types */

export interface DraftHeld {
  round: number;
  /** The club this pick came from, lowercase abbreviation; null for the club's own. */
  from: string | null;
}

export interface DraftSent {
  round: number;
  /** The club now holding this pick, lowercase abbreviation. */
  to: string;
}

export interface DraftCapitalDoc {
  draftYear: number;
  builtAt: string;
  slots: number;
  teams: Record<string, { holds: DraftHeld[]; sent: DraftSent[] }>;
}

export interface DraftPick {
  season: number;
  round: number;
  pick: number;
  name: string;
  position: string;
  /** The register's broad group: QB, RB, WR, TE, OL, DL, LB, DB, K, P, LS. */
  category: string;
  side: "O" | "D" | "S" | null;
  college: string;
  gsisId: string | null;
  age: number | null;
  lastSeason: number | null;
  games: number;
  seasonsStarted: number;
  proBowls: number;
  allPro: number;
}

export interface DraftHistoryDoc {
  builtAt: string;
  latestSeason: number;
  seasons: number[];
  teams: Record<string, DraftPick[]>;
  picks: number;
}

/* ---------------------------------------------------------------- readers */

export function getDraftCapital(draftYear: number): DraftCapitalDoc | null {
  return readDataJson<DraftCapitalDoc>(dataPath("team", `draft_picks_${draftYear}.json`));
}

export function getDraftHistory(): DraftHistoryDoc | null {
  return readDataJson<DraftHistoryDoc>(dataPath("team", "draft_history.json"));
}

/** Both files' mtimes, for the page cache key; "" for a file that is absent. */
export function draftVersion(draftYear: number): string {
  const stamp = (file: string): string => {
    try {
      return String(fs.statSync(file).mtimeMs);
    } catch {
      return "";
    }
  };
  return (
    stamp(dataPath("team", `draft_picks_${draftYear}.json`)) +
    ":" +
    stamp(dataPath("team", "draft_history.json"))
  );
}

/* ------------------------------------------------------------------- view */

/** The draft that is next: the one after the season being played. */
export function nextDraftYear(season: number): number {
  return season + 1;
}

/** How many drafts the History view shows. */
export const HISTORY_DRAFTS = 5;

/** Position groups, in the order the tendencies list them. */
export const CATEGORY_LABEL: Record<string, string> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  OL: "OL",
  DL: "DL",
  LB: "LB",
  DB: "DB",
  ST: "K/P/LS",
};

const CATEGORY_ORDER = Object.keys(CATEGORY_LABEL);

/** The register's group for a pick, with the specialists folded together. */
export function pickCategory(pick: DraftPick): string {
  const c = pick.category;
  if (c === "K" || c === "P" || c === "LS") return "ST";
  if (c in CATEGORY_LABEL) return c;
  // Two stray register rows name a position rather than a group.
  if (c === "FS") return "DB";
  if (c === "OG") return "OL";
  return pick.side === "D" ? "DL" : "OL";
}

export interface CategoryShare {
  category: string;
  label: string;
  count: number;
  /** 0-100, one decimal. */
  pct: number;
}

export interface DraftSeason {
  season: number;
  picks: DraftPick[];
}

export interface DraftCapitalView {
  draftYear: number;
  holds: DraftHeld[];
  sent: DraftSent[];
  /** Rounds 1-7, each with the picks held in it (possibly none). */
  rounds: Array<{ round: number; holds: DraftHeld[]; sent: DraftSent[] }>;
  total: number;
  firstRounders: number;
  acquired: number;
}

export interface DraftHistoryView {
  /** Newest first. */
  seasons: DraftSeason[];
  firstSeason: number;
  lastSeason: number;
  total: number;
  firstRounders: number;
  allPicks: CategoryShare[];
  roundOne: CategoryShare[];
}

export interface DraftView {
  capital: DraftCapitalView | null;
  history: DraftHistoryView | null;
}

function shares(picks: DraftPick[]): CategoryShare[] {
  const counts = new Map<string, number>();
  for (const pick of picks) {
    const c = pickCategory(pick);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const total = picks.length;
  return CATEGORY_ORDER.filter((c) => counts.has(c))
    .map((c) => ({
      category: c,
      label: CATEGORY_LABEL[c] ?? c,
      count: counts.get(c) ?? 0,
      pct: total ? Math.round(((counts.get(c) ?? 0) / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count || CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));
}

export function capitalView(doc: DraftCapitalDoc | null, abbr: string): DraftCapitalView | null {
  const team = doc?.teams[abbr];
  if (!doc || !team) return null;
  const rounds = [1, 2, 3, 4, 5, 6, 7].map((round) => ({
    round,
    holds: team.holds.filter((h) => h.round === round),
    sent: team.sent.filter((s) => s.round === round),
  }));
  return {
    draftYear: doc.draftYear,
    holds: team.holds,
    sent: team.sent,
    rounds,
    total: team.holds.length,
    firstRounders: team.holds.filter((h) => h.round === 1).length,
    acquired: team.holds.filter((h) => h.from !== null).length,
  };
}

export function historyView(doc: DraftHistoryDoc | null, abbr: string): DraftHistoryView | null {
  const picks = doc?.teams[abbr];
  if (!doc || !picks || picks.length === 0) return null;
  const years = doc.seasons.slice(-HISTORY_DRAFTS);
  const recent = picks.filter((p) => years.includes(p.season));
  if (recent.length === 0) return null;
  const seasons = years
    .map((season) => ({
      season,
      picks: recent.filter((p) => p.season === season).sort((a, b) => a.pick - b.pick),
    }))
    .filter((s) => s.picks.length > 0)
    .reverse();
  return {
    seasons,
    firstSeason: years[0] ?? doc.latestSeason,
    lastSeason: years[years.length - 1] ?? doc.latestSeason,
    total: recent.length,
    firstRounders: recent.filter((p) => p.round === 1).length,
    allPicks: shares(recent),
    roundOne: shares(recent.filter((p) => p.round === 1)),
  };
}

export function getDraftView(abbr: string, season: number): DraftView {
  const key = abbr.toLowerCase();
  return {
    capital: capitalView(getDraftCapital(nextDraftYear(season)), key),
    history: historyView(getDraftHistory(), key),
  };
}
