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
import { getEfficiencyDoc } from "./efficiency";
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
  /** For the headshot, from the id crosswalk; null when no pairing is known. */
  sleeperId?: string | null;
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

/** A school's crest: its NCAA team id for the image route, and the name ESPN files it under. */
export interface CollegeLogo {
  id: string;
  name: string;
}

interface CollegeLogosDoc {
  builtAt: string;
  logos: Record<string, CollegeLogo>;
}

/**
 * The register's college names paired with crest ids
 * (scripts/team/buildCollegeLogos.mjs); a school the file lacks prints its
 * name alone.
 */
export function collegeLogoFor(college: string): CollegeLogo | null {
  const doc = readDataJson<CollegeLogosDoc>(dataPath("team", "college_logos.json"));
  return doc?.logos[college.trim()] ?? null;
}

/** The files' mtimes, for the page cache key; "" for a file that is absent. */
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
    stamp(dataPath("team", "draft_history.json")) +
    ":" +
    stamp(dataPath("team", "college_logos.json")) +
    ":" +
    stamp(dataPath("team", "draft_status.json"))
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
  /** How many of the group's picks were Round 1 picks: the premium-capital-vs-volume split. */
  firstRounders: number;
}

export interface DraftSeason {
  season: number;
  picks: DraftPick[];
  /**
   * Regular-season games a pick of this class could have played by now: 17
   * for each finished season since, plus the club's games so far this year.
   */
  possible: number;
  /** Pro Bowls are shown once a class is old enough to have earned any. */
  showProBowls: boolean;
}

/* --------------------------------------------------------- roster status */

/** What a roster row reads as (scripts/team/buildDraftStatus.mjs kindOf). */
export type RosterKind =
  | "active"
  | "ir"
  | "pup"
  | "nfi"
  | "reserve"
  | "ps"
  | "suspended"
  | "exempt"
  | "cut"
  | "retired"
  | "none";

/** How a player's time with the drafting club ended, when the rosters show it. */
export type DepartureKind = "traded" | "waived" | "released" | "retired";

export interface DraftStatusEntry {
  now: { kind: RosterKind; club: string | null; week: number | null };
  left: { kind: DepartureKind; season: number; week: number } | null;
}

export interface DraftStatusDoc {
  builtAt: string;
  season: number;
  /** The latest roster week in the file: the status is as of this week. */
  week: number;
  players: Record<string, DraftStatusEntry>;
}

export function getDraftStatus(): DraftStatusDoc | null {
  return readDataJson<DraftStatusDoc>(dataPath("team", "draft_status.json"));
}

/** The Status column: a label, an optional second line, and whether the row is muted. */
export interface PickStatus {
  key: RosterKind | DepartureKind | "unknown";
  label: string;
  /** Where the player is now, when they are no longer with the drafting club. */
  sub: string | null;
  /** True for a player no longer in the league: the row reads muted. */
  gone: boolean;
}

export const ROSTER_LABEL: Record<RosterKind, string> = {
  active: "Active",
  ir: "Injured reserve",
  pup: "PUP list",
  nfi: "NFI list",
  reserve: "Reserve list",
  ps: "Practice squad",
  suspended: "Suspended",
  exempt: "Exempt list",
  cut: "Free agent",
  retired: "Retired",
  none: "Not on a roster",
};

export const DEPARTURE_LABEL: Record<DepartureKind, string> = {
  traded: "Traded",
  waived: "Waived",
  released: "Released",
  retired: "Retired",
};

/** "with MIA", "on ATL practice squad", "a free agent": the second line for a player who left. */
function whereNow(now: DraftStatusEntry["now"]): string {
  const club = now.club ? now.club.toUpperCase() : "";
  switch (now.kind) {
    case "active":
      return `now with ${club}`;
    case "ps":
      return `now on ${club} practice squad`;
    case "ir":
      return `now on ${club} injured reserve`;
    case "pup":
    case "nfi":
    case "reserve":
    case "exempt":
      return `now on ${club} ${ROSTER_LABEL[now.kind].toLowerCase()}`;
    case "suspended":
      return `now suspended (${club})`;
    case "cut":
      return "now a free agent";
    case "retired":
      return "now retired";
    case "none":
      return "not on a roster";
  }
}

/**
 * The Status column from the weekly rosters (2026-10-29, mak: "active,
 * waived, traded, etc."). A player still with the drafting club shows their
 * roster standing. One who left shows how, when the rosters say (traded,
 * waived, released, retired), with where they are now beneath; one whose
 * move happened between seasons, where the rosters give no reason, shows
 * their standing with the new club named. A pick the file does not know
 * falls back to the register's last season.
 */
export function pickStatus(pick: DraftPick, club: string, doc: DraftStatusDoc | null, currentSeason: number): PickStatus {
  const entry = pick.gsisId ? doc?.players[pick.gsisId] : undefined;
  if (!entry) {
    const gone = pick.lastSeason !== null && pick.lastSeason < currentSeason;
    return gone ? { key: "none", label: ROSTER_LABEL.none, sub: null, gone: true } : { key: "unknown", label: "-", sub: null, gone: false };
  }
  const { now, left } = entry;
  const gone = now.kind === "none" || now.kind === "retired" || now.kind === "cut";
  if (left) {
    const sub = left.kind === "retired" || (left.kind !== "traded" && now.kind === "none") ? null : whereNow(now);
    return { key: left.kind, label: DEPARTURE_LABEL[left.kind], sub, gone };
  }
  if (now.club && now.club !== club && now.kind !== "retired") {
    return { key: now.kind, label: ROSTER_LABEL[now.kind], sub: now.kind === "cut" ? null : `with ${now.club.toUpperCase()}`, gone };
  }
  return { key: now.kind, label: ROSTER_LABEL[now.kind], sub: null, gone };
}

/** Games in a regular season: 17 since 2021, 16 before. */
export function seasonGames(season: number): number {
  return season >= 2021 ? 17 : 16;
}

/** A class is old enough for its Pro Bowl column after this many drafts. */
export const PRO_BOWL_AGE = 3;

/** Shares of the possible games that tint the Games bar green and amber. */
export const REGULAR_RATE = 0.75;
export const ROTATIONAL_RATE = 0.35;


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
  /** The Round 1 picks themselves, newest first: at three or four of them the names are the signal. */
  roundOnePicks: DraftPick[];
  allPicks: CategoryShare[];
}

export interface DraftView {
  capital: DraftCapitalView | null;
  history: DraftHistoryView | null;
}

function shares(picks: DraftPick[]): CategoryShare[] {
  const counts = new Map<string, number>();
  const firsts = new Map<string, number>();
  for (const pick of picks) {
    const c = pickCategory(pick);
    counts.set(c, (counts.get(c) ?? 0) + 1);
    if (pick.round === 1) firsts.set(c, (firsts.get(c) ?? 0) + 1);
  }
  const total = picks.length;
  return CATEGORY_ORDER.filter((c) => counts.has(c))
    .map((c) => ({
      category: c,
      label: CATEGORY_LABEL[c] ?? c,
      count: counts.get(c) ?? 0,
      pct: total ? Math.round(((counts.get(c) ?? 0) / total) * 1000) / 10 : 0,
      firstRounders: firsts.get(c) ?? 0,
    }))
    // Ties keep the investment convention (QB > RB > WR > TE > OL > DL >
    // LB > DB > specialists), so K/P/LS at 4 never ranks above QB at 4
    // (mak's critique, 2026-10-29).
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

/**
 * @param currentSeason the season being played, which bounds every class's
 *   possible games
 * @param gamesThisSeason the club's games so far this season; null when the
 *   count is unknown, in which case the newest class's own counters stand in
 */
export function historyView(
  doc: DraftHistoryDoc | null,
  abbr: string,
  currentSeason: number,
  gamesThisSeason: number | null,
): DraftHistoryView | null {
  const picks = doc?.teams[abbr];
  if (!doc || !picks || picks.length === 0) return null;
  const years = doc.seasons.slice(-HISTORY_DRAFTS);
  const recent = picks.filter((p) => years.includes(p.season));
  if (recent.length === 0) return null;
  const thisYear =
    gamesThisSeason ?? Math.max(0, ...recent.filter((p) => p.season === currentSeason).map((p) => p.games));
  const possibleFor = (season: number): number => {
    let n = 0;
    for (let y = season; y < currentSeason; y += 1) n += seasonGames(y);
    return n + (season <= currentSeason ? thisYear : 0);
  };
  const seasons = years
    .map((season) => ({
      season,
      picks: recent.filter((p) => p.season === season).sort((a, b) => a.pick - b.pick),
      possible: possibleFor(season),
      showProBowls: currentSeason - season >= PRO_BOWL_AGE,
    }))
    .filter((s) => s.picks.length > 0)
    .reverse();
  const roundOnePicks = recent
    .filter((p) => p.round === 1)
    .sort((a, b) => b.season - a.season || a.pick - b.pick);
  return {
    seasons,
    firstSeason: years[0] ?? doc.latestSeason,
    lastSeason: years[years.length - 1] ?? doc.latestSeason,
    total: recent.length,
    firstRounders: roundOnePicks.length,
    roundOnePicks,
    allPicks: shares(recent),
  };
}

export function getDraftView(abbr: string, season: number): DraftView {
  const key = abbr.toLowerCase();
  const played = getEfficiencyDoc(season)?.teams[key]?.games ?? null;
  return {
    capital: capitalView(getDraftCapital(nextDraftYear(season)), key),
    history: historyView(getDraftHistory(), key, season, played),
  };
}
