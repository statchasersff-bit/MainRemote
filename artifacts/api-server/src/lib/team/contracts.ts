/**
 * The team hub's Contracts tab: every active contract with a cap number this
 * season, the deal behind it, what the club's cap looks like, what the
 * league pays a player who produces like this one, and what a release would
 * do.
 *
 * Three committed files, all built by hand-run scripts (none is in the daily
 * chain; re-run after signings, releases and restructures, and weekly in
 * season for Worth, then commit):
 *
 *   data/team/contracts_<season>.json      scripts/team/buildContracts.mjs
 *     The nflverse contract register: every deal's terms and this season's
 *     cap row, plus a release estimate from the deal's structure. Figures in
 *     millions.
 *   data/team/cap_snapshot_<season>.json   scripts/team/buildCapSnapshot.mjs
 *     The club's cap page: cap space, top-51, dead money by player, roster
 *     status, and the published release and trade figures before and after
 *     June 1. Where it has a player, its figures replace the estimate.
 *   data/team/worth_<season>.json          scripts/team/buildWorth.mjs
 *     Worth and the Overpaid / Underpaid tags, keyed like the others by the
 *     register's player id. The model is documented in the builder and
 *     summarized on the page.
 *
 * The tab renders from the register alone; the other two add their columns
 * and blocks when present, so a stale or missing snapshot degrades to the
 * estimate rather than blanking the tab.
 */

import fs from "node:fs";
import { dataPath } from "../data-dir";
import { readDataJson } from "./read-json";

/* ----------------------------------------------------------- register */

export interface ContractRow {
  name: string;
  position: string;
  gsisId: string | null;
  otcId: number | null;
  /** This season's cap number, millions. */
  capNumber: number;
  /** Share of the league cap, 0-100 with one decimal. */
  capPct: number;
  baseSalary: number;
  proratedBonus: number;
  optionBonus: number;
  guaranteedSalary: number;
  cashPaid: number;
  /** The deal: average per year, total, guarantees at signing, millions. */
  apy: number;
  value: number;
  guaranteed: number;
  yearSigned: number | null;
  years: number | null;
  /** The deal's last season. */
  finalYear: number | null;
  contractType: string | null;
  /** The builder's estimate: cap freed by a standard release, floored at zero, and what stays. */
  cutSavings: number;
  deadIfCut: number;
  future: Array<{ year: number; capNumber: number; cashPaid: number }>;
}

/** A deal the register lists without a cap row yet: its terms only. */
export type PendingDeal = Pick<
  ContractRow,
  "name" | "position" | "gsisId" | "otcId" | "apy" | "value" | "guaranteed" | "yearSigned" | "years" | "finalYear" | "contractType"
>;

export interface ContractTeam {
  players: ContractRow[];
  /** Deals with terms but no cap row for the season (absent in older files). */
  pending?: PendingDeal[];
  /** Sum of every listed cap number, and of the largest 51, millions. */
  committed: number;
  top51: number;
  contracts: number;
}

export interface ContractsDoc {
  season: number;
  builtAt: string;
  contracts: number;
  ranks: { committed: Record<string, number>; top51: Record<string, number> };
  teams: Record<string, ContractTeam>;
}

/* ----------------------------------------------------------- snapshot */

export interface SnapshotMove {
  dead: number;
  /** Cap freed; negative when the move costs cap. */
  save: number;
}

export interface SnapshotPlayer {
  name: string;
  capNumber: number;
  cut: SnapshotMove | null;
  june1Cut: SnapshotMove | null;
  trade: SnapshotMove | null;
  june1Trade: SnapshotMove | null;
  restructure: number;
}

export interface SnapshotTeam {
  liabilities: number | null;
  top51: number;
  capSpace: number;
  offense: number | null;
  defense: number | null;
  special: number | null;
  deadTotal: number;
  dead: Array<{ otcId: number; name: string; amount: number }>;
  /** Reserve-list status by player id: IR, PUP, PS, SUSP, NFI, EXEMPT. */
  status: Record<string, string>;
  players: Record<string, SnapshotPlayer>;
  active: number;
}

export interface CapSnapshotDoc {
  season: number;
  builtAt: string;
  ranks: {
    capSpace: Record<string, number>;
    top51: Record<string, number>;
    deadTotal: Record<string, number>;
  };
  teams: Record<string, SnapshotTeam>;
}

/* -------------------------------------------------------------- worth */

export interface WorthRow {
  /** Millions: the average per year at this player's production rank. */
  worth: number;
  tag: "over" | "under" | null;
  production: number;
  productionLabel: string;
  rank: number;
  of: number;
  group: string;
}

export interface WorthDoc {
  season: number;
  builtAt: string;
  throughWeek: number;
  minGames: number;
  ratio: number;
  floor: number;
  groups: Record<string, { contracts: number; scored: number }>;
  players: Record<string, WorthRow>;
}

/* ------------------------------------------------------------ readers */

export function getContractsDoc(season: number): ContractsDoc | null {
  return readDataJson<ContractsDoc>(dataPath("team", `contracts_${season}.json`));
}

export function getCapSnapshot(season: number): CapSnapshotDoc | null {
  return readDataJson<CapSnapshotDoc>(dataPath("team", `cap_snapshot_${season}.json`));
}

export function getWorthDoc(season: number): WorthDoc | null {
  return readDataJson<WorthDoc>(dataPath("team", `worth_${season}.json`));
}

/** The three files' mtimes, for the page cache key; "" for one that is absent. */
export function contractsVersion(season: number): string {
  const stamp = (name: string): string => {
    try {
      return String(fs.statSync(dataPath("team", name)).mtimeMs);
    } catch {
      return "";
    }
  };
  return [
    stamp(`contracts_${season}.json`),
    stamp(`cap_snapshot_${season}.json`),
    stamp(`worth_${season}.json`),
  ].join(":");
}

/* --------------------------------------------------------------- view */

/** One table row: the register's contract with the other files folded in. */
export interface ContractLine extends ContractRow {
  /** Reserve-list status, when the cap page lists one. */
  status: string | null;
  /**
   * True when the cap number came from the cap page because the register
   * has no cap row for the deal yet (this year's draft class, mostly). The
   * deal's terms are the register's where it has the deal, else unknown.
   */
  fromCapPage: boolean;
  /** Release before June 1: the cap page's figures, else the estimate. */
  cutSave: number;
  cutDead: number;
  /** Release after June 1: the cap page's figures, else the pre-June-1 pair. */
  june1Save: number;
  june1Dead: number;
  /** True when the pre-June-1 pair is the builder's estimate, not the page's. */
  cutEstimated: boolean;
  /** Trade before June 1, when the cap page has it. */
  tradeSave: number | null;
  tradeDead: number | null;
  worth: WorthRow | null;
}

export interface DeadMoneyLine {
  otcId: number;
  name: string;
  amount: number;
  /**
   * Where the player is under contract now, lowercase abbreviation; null when
   * no club's register carries him (a free agent, or retired). The club can
   * be this one: a player released and re-signed carries dead money here.
   */
  nowWith: string | null;
}

export interface ContractsView {
  season: number;
  players: ContractLine[];
  /** What the roster's contracts add up to (register) and its league rank. */
  committed: number;
  committedRank: number | null;
  /** The cap page's figures and ranks, when the snapshot has the club. */
  capSpace: number | null;
  capSpaceRank: number | null;
  top51: number;
  top51Rank: number | null;
  deadTotal: number | null;
  deadRank: number | null;
  dead: DeadMoneyLine[];
  /** True when any column came from the cap page rather than the estimate. */
  hasSnapshot: boolean;
  worth: WorthDoc | null;
  /** The cap page's total cap liabilities for the club, when it has one. */
  liabilities: number | null;
  /** The largest cap number on the roster. */
  largest: ContractLine | null;
  /** Players a pre-June-1 release would free the most cap on, savings first. */
  cutCandidates: ContractLine[];
  tagged: { over: number; under: number };
}

/** How many names the release rail shows. */
export const CUT_CANDIDATES = 6;

/** Every club a player id is under contract with, from the register. */
function clubsByPlayer(doc: ContractsDoc): Map<number, string> {
  const out = new Map<number, string>();
  for (const [abbr, team] of Object.entries(doc.teams)) {
    for (const p of team.players) if (p.otcId !== null) out.set(p.otcId, abbr);
  }
  return out;
}

export function contractsView(
  doc: ContractsDoc | null,
  snapshot: CapSnapshotDoc | null,
  worth: WorthDoc | null,
  abbr: string,
): ContractsView | null {
  const team = doc?.teams[abbr];
  if (!doc || !team || team.players.length === 0) return null;
  const snap = snapshot?.teams[abbr] ?? null;

  const players: ContractLine[] = team.players.map((p) => {
    const sp = p.otcId !== null && snap ? (snap.players[String(p.otcId)] ?? null) : null;
    const cut = sp?.cut ?? null;
    const june1 = sp?.june1Cut ?? null;
    const w = p.otcId !== null && worth ? (worth.players[String(p.otcId)] ?? null) : null;
    // The estimate unfloored, so a release that costs cap reads negative
    // here the way the cap page's figures do, and the scenario sums match.
    const estSave = Math.round((p.capNumber - p.deadIfCut) * 1000) / 1000;
    return {
      ...p,
      status: p.otcId !== null && snap ? (snap.status[String(p.otcId)] ?? null) : null,
      fromCapPage: false,
      cutSave: cut ? cut.save : estSave,
      cutDead: cut ? cut.dead : p.deadIfCut,
      june1Save: june1 ? june1.save : cut ? cut.save : estSave,
      june1Dead: june1 ? june1.dead : cut ? cut.dead : p.deadIfCut,
      cutEstimated: !cut,
      tradeSave: sp?.trade?.save ?? null,
      tradeDead: sp?.trade?.dead ?? null,
      worth: w,
    };
  });

  // Everyone the cap page has on the club and the register does not: the
  // page's cap number and release figures, the register's terms where it
  // holds the deal without a cap row, and a bare name otherwise.
  if (snap) {
    const onSheet = new Set(players.map((p) => p.otcId));
    const terms = new Map((team.pending ?? []).map((d) => [d.otcId, d]));
    for (const [id, sp] of Object.entries(snap.players)) {
      const otcId = Number(id);
      if (onSheet.has(otcId) || sp.capNumber <= 0) continue;
      const d = terms.get(otcId) ?? null;
      const cut = sp.cut ?? null;
      const june1 = sp.june1Cut ?? null;
      players.push({
        name: d?.name ?? sp.name,
        position: d?.position ?? "",
        gsisId: d?.gsisId ?? null,
        otcId,
        capNumber: sp.capNumber,
        capPct: 0,
        baseSalary: 0,
        proratedBonus: 0,
        optionBonus: 0,
        guaranteedSalary: 0,
        cashPaid: 0,
        apy: d?.apy ?? 0,
        value: d?.value ?? 0,
        guaranteed: d?.guaranteed ?? 0,
        yearSigned: d?.yearSigned ?? null,
        years: d?.years ?? null,
        finalYear: d?.finalYear ?? null,
        contractType: d?.contractType ?? null,
        deadIfCut: cut ? cut.dead : 0,
        cutSavings: cut ? Math.max(0, cut.save) : 0,
        future: [],
        status: snap.status[id] ?? null,
        fromCapPage: true,
        cutSave: cut ? cut.save : 0,
        cutDead: cut ? cut.dead : 0,
        june1Save: june1 ? june1.save : cut ? cut.save : 0,
        june1Dead: june1 ? june1.dead : cut ? cut.dead : 0,
        cutEstimated: !cut,
        tradeSave: sp.trade?.save ?? null,
        tradeDead: sp.trade?.dead ?? null,
        worth: worth?.players[id] ?? null,
      });
    }
    players.sort((a, b) => b.capNumber - a.capNumber || a.name.localeCompare(b.name));
  }

  const clubs = clubsByPlayer(doc);
  const dead: DeadMoneyLine[] = (snap?.dead ?? []).map((d) => {
    return { ...d, nowWith: clubs.get(d.otcId) ?? null };
  });

  const cutCandidates = players
    .filter((p) => p.cutSave >= 0.5)
    .sort((a, b) => b.cutSave - a.cutSave || a.cutDead - b.cutDead)
    .slice(0, CUT_CANDIDATES);

  return {
    season: doc.season,
    players,
    committed: team.committed,
    committedRank: doc.ranks.committed[abbr] ?? null,
    capSpace: snap?.capSpace ?? null,
    capSpaceRank: snap ? (snapshot?.ranks.capSpace[abbr] ?? null) : null,
    top51: snap?.top51 ?? team.top51,
    top51Rank: snap ? (snapshot?.ranks.top51[abbr] ?? null) : (doc.ranks.top51[abbr] ?? null),
    deadTotal: snap?.deadTotal ?? null,
    deadRank: snap ? (snapshot?.ranks.deadTotal[abbr] ?? null) : null,
    dead,
    hasSnapshot: snap !== null,
    worth,
    liabilities: snap?.liabilities ?? null,
    largest: players[0] ?? null,
    cutCandidates,
    tagged: {
      over: players.filter((p) => p.worth?.tag === "over").length,
      under: players.filter((p) => p.worth?.tag === "under").length,
    },
  };
}

export function getContractsView(abbr: string, season: number): ContractsView | null {
  return contractsView(getContractsDoc(season), getCapSnapshot(season), getWorthDoc(season), abbr.toLowerCase());
}
