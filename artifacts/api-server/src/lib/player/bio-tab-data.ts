/**
 * Stage 4 of mak's Bio spec (2026-09-30): the page facts behind the Bio tab's
 * spec sections, computed from approved fact records and the game logs.
 *
 * Every figure here comes from one of two places, and nothing else:
 *
 *   - data/player/bio_sources.json, the fact store scripts/player/
 *     buildBioSources.mjs writes. Each record names its source, and the source
 *     table holds the URL and the retrieval time. Only `approved` records are
 *     read.
 *   - the weekly game logs (PlayerPageData.logCareer), so the stats on a stop
 *     are the Stats tab's stats.
 *
 * The text is template text: every sentence below is a fixed frame filled with
 * fact values, and a sentence whose facts are missing is left out. The spec's
 * model-written prose (Stages 5-7) is not built; nothing here comes from a
 * language model.
 *
 * Pure: no I/O, no clock beyond the `now` it is handed.
 */

import { getTeamByAbbreviation, type NflTeam } from "../team/teams";
import type { GameLogEntry } from "./types";
import type { LogSeason } from "./stats-tab-data";

/* ------------------------------------------------------------ fact store */

export interface BioSourceFact {
  field: string;
  value: unknown;
  source: string;
  url?: string;
  method: "structured" | "extracted" | "manual";
  confidence: number;
  status: "approved" | "candidate" | "rejected" | "superseded";
  agrees?: string[];
}

export interface BioSourceEntry {
  ids: Record<string, string>;
  facts: BioSourceFact[];
}

export interface BioSourceInfo {
  name: string;
  url: string;
  retrievedAt: string;
  revision: string | null;
}

export interface BioSourcesDoc {
  version: number;
  generatedAt: string;
  changedAt?: string;
  sources: Record<string, BioSourceInfo>;
  players: Record<string, BioSourceEntry>;
}

export interface DraftFact {
  year: number;
  round: number;
  pick: number;
  team: string | null;
}

/** Offensive snaps by season and club: games with a snap, at 50%+, at 25%+. */
type SnapCounts = Record<string, { g: number; s50: number; s25: number }>;

interface SuperBowlFact {
  season: number;
  team: string;
}

/** A club and its years, from the Wikipedia infobox; `offseason` marks an offseason or practice-squad-only stint. */
interface CareerTeam {
  team: string;
  from: number;
  to: number | null;
  offseason: boolean;
}

/** A dated move read from Wikipedia in session, quote-checked in code and approved by mak. */
export interface WikiTransaction {
  type: string;
  /** The fact-checked wording (search pass) or the official log's own kind of move. */
  headline?: string;
  /** "extracted" (Wikipedia, checked), "official-log", "search". */
  method?: string;
  date: string;
  precision: "day" | "month";
  team: string;
  terms?: { years?: number; totalM?: number };
  quote: string;
  url: string;
  /**
   * The move's distinct dated events when the sources separate them (mak,
   * 2026-10-01): "agreed" = terms reached, "signed" = contract signed,
   * "processed" = the club log's transaction-wire date. `date` above is the
   * event the page prints; these keep the others instead of discarding them.
   */
  events?: { date: string; status: "agreed" | "signed" | "processed" }[];
}

interface TradeFact {
  date: string;
  from: string;
  to: string;
  return: ({ player: string; pos: string | null } | { pick: { season: number | null; round: number | null; number: number | null; conditional: boolean } })[];
}

/** The approved value of one field, and the source that gave it. */
function fact<T>(entry: BioSourceEntry | null, field: string): { value: T; source: string } | null {
  const rec = entry?.facts.find((f) => f.field === field && f.status === "approved");
  return rec ? { value: rec.value as T, source: rec.source } : null;
}

/** Fields that count toward the index rule: facts beyond name, position and team. */
const INDEX_FIELDS = new Set([
  "birth_date", "birth_place", "height_in", "weight_lb", "high_school", "colleges",
  "draft", "undrafted", "pro_bowls", "all_pro", "trades", "team_by_season", "super_bowls", "career_teams", "super_bowl_titles",
]);

/**
 * Spec 2.11: a bio page is indexed when the player is on a roster (Tiers A and
 * B) or has at least six verified facts beyond name, position and team.
 * Otherwise noindex, follow, and out of the sitemap, until it has enough.
 */
export function bioIndexable(onRoster: boolean, entry: BioSourceEntry | null): boolean {
  if (onRoster) return true;
  const fields = new Set((entry?.facts ?? []).filter((f) => f.status === "approved" && INDEX_FIELDS.has(f.field)).map((f) => f.field));
  return fields.size >= 6;
}

/* ------------------------------------------------------------ page facts */

export interface QuickFact {
  label: string;
  value: string;
}

export interface StopStat {
  value: string;
  label: string;
}

export interface BioStop {
  id: string;
  code: string;
  team: NflTeam | null;
  /** The club's name in that era: "Oakland Raiders" for a 2018 stop. */
  name: string;
  /** Short label for the rail block: nickname when it has room, else the code. */
  short: string;
  primary: string;
  accent: string;
  from: number;
  to: number;
  /** Seasons, with a split season counted as a share (spec 2.3). */
  width: number;
  games: number;
  /** QB starts from nflverse's starting-quarterback column; null for other positions. */
  starts: number | null;
  /** Super Bowls won at the stop, by season. */
  superBowls: number[];
  /** The rail's headline figure and the line under it. */
  rail: { big: string; rest: string };
  chips: StopStat[];
  sentences: string[];
  best: { season: number; points: number; finish: number } | null;
  current: boolean;
  /** "second stint" and so on, for a return to a club. */
  spell: number;
}

/**
 * A roster move, dated only as precisely as its source allows: a trade has
 * its day; a team change read off the season rosters has only its season.
 */
export interface BioTransaction {
  /** For <time datetime>: "2017-09-02", "2024-03" or "2024". */
  date: string;
  precision: "day" | "month" | "season";
  /** "Sep 2, 2017", "Mar 2024", "2024 offseason", "2016 draft", "2019". */
  when: string;
  type: "Traded" | "Drafted" | "Signed" | "Joined" | "Re-signed" | "Released" | "Waived" | "Waived/Injured" | "Claimed" | "Placed on IR" | "Activated" | "Contract" | "Suspended" | "Commissioner's Exempt List" | "Injury settlement" | "Reinstated" | "Retired" | "Tender" | "Tag";
  text: string;
  /** Sort key, most recent first: the date, with season-level rows placed inside their year. */
  sort: string;
}

export type BioStatus = "active" | "free-agent" | "former";

export interface BioPageFacts {
  status: BioStatus;
  quick: QuickFact[];
  /** The story's headline (bioStory); null when the facts support none. */
  headline: string | null;
  paragraphs: string[];
  stops: BioStop[];
  /** Rail axis: one label per season from the first stop to the last. */
  axis: number[];
  college: { names: string[] } | null;
  transactions: BioTransaction[];
  /** Super Bowls won, as shown in the Quick Facts; empty when the data cannot vouch for the full list. */
  superBowls: { season: number; name: string; team: string }[];
  /** True when every transaction is a trade: the section is titled "Trades". */
  tradesOnly: boolean;
  /** True when reviewed, dated Wikipedia moves are in the list: the section is titled "Transactions". */
  hasDatedMoves: boolean;
  /** Source names behind what is shown, for the footer and the transactions note. */
  sources: string[];
  transactionSources: string[];
  /** When the fact store's content last changed, ISO. */
  changedAt: string | null;
  seasonsPlayed: number;
  /** False when his career began before the game logs (2009): the stops are then the covered part only. */
  coversCareer: boolean;
  /** The approved values themselves, for the page's metadata and schema (bio-seo.ts). */
  raw: {
    birthDate: string | null;
    birthPlace: string | null;
    heightIn: number | null;
    weightLb: number | null;
    highSchool: string | null;
    colleges: string[];
    draft: DraftFact | null;
    undrafted: { year: number } | null;
    ids: Record<string, string>;
  };
  /** Spec 2.11's index rule: active (Tier A/B) or 6+ verified facts. */
  indexable: boolean;
}

export interface BioPageInput {
  name: string;
  position: string | null;
  number: number | string | null;
  /** The player's current club; null for a free agent. */
  team: NflTeam | null;
  entry: BioSourceEntry | null;
  sources: Record<string, BioSourceInfo>;
  changedAt: string | null;
  logCareer: LogSeason[];
  currentSeason: number;
  points: (e: GameLogEntry) => number;
  now: Date;
}

/* ----------------------------------------------------------------- words */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The long position name the bio text uses: "quarterback"; null for an unknown code. */
export function positionWord(pos: string | null | undefined): string | null {
  return POSITION_WORDS[pos ?? ""] ?? null;
}

const POSITION_WORDS: Record<string, string> = {
  QB: "quarterback",
  RB: "running back",
  WR: "wide receiver",
  TE: "tight end",
  K: "kicker",
  FB: "fullback",
};

const ORDINAL_WORDS = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh"];

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** "1992-12-11" -> { long: "December 11, 1992", short: "Dec 11, 1992" }. */
export function dateWords(iso: string): { long: string; short: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const month = Number(m[2]) - 1;
  if (!MONTHS[month]) return null;
  return { long: `${MONTHS[month]} ${Number(m[3])}, ${m[1]}`, short: `${MONTHS_SHORT[month]} ${Number(m[3])}, ${m[1]}` };
}

export function ageOn(iso: string, now: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  let age = now.getUTCFullYear() - Number(m[1]);
  const md = (now.getUTCMonth() + 1) * 100 + now.getUTCDate();
  if (md < Number(m[2]) * 100 + Number(m[3])) age -= 1;
  return age >= 0 && age < 110 ? age : null;
}

const fmt = (n: number): string => Math.round(n).toLocaleString("en-US");

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// Particles stay with the surname ("St. Brown", "Van Ginkel"), as the
// header's lastName() keeps them (the bio said "selected Brown").
const PARTICLES = new Set(["st", "de", "del", "della", "di", "da", "van", "von", "la", "le", "du"]);
function surname(full: string): string {
  const parts = full.trim().split(/\s+/);
  while (parts.length > 1 && /^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(parts[parts.length - 1] ?? "")) parts.pop();
  let i = parts.length - 1;
  while (i > 1 && PARTICLES.has((parts[i - 1] ?? "").toLowerCase().replace(/\.+$/, ""))) i -= 1;
  return parts.slice(i).join(" ") || full;
}

/* ----------------------------------------------------------- team eras */

/**
 * Clubs that moved or were renamed inside the game logs' span (2009 on). A
 * stop is named, and colored, for the era of its last season.
 */
const ERAS: Record<string, { until: number; name: string; nickname: string; primary: string; accent: string }[]> = {
  LV: [{ until: 2019, name: "Oakland Raiders", nickname: "Raiders", primary: "#000000", accent: "#A5ACAF" }],
  LAC: [{ until: 2016, name: "San Diego Chargers", nickname: "Chargers", primary: "#0C2340", accent: "#FFC20E" }],
  LAR: [
    { until: 2015, name: "St. Louis Rams", nickname: "Rams", primary: "#002244", accent: "#B3995D" },
    { until: 2019, name: "Los Angeles Rams", nickname: "Rams", primary: "#002244", accent: "#B3995D" },
  ],
  WAS: [
    { until: 2019, name: "Washington Redskins", nickname: "Redskins", primary: "#773141", accent: "#FFB612" },
    { until: 2021, name: "Washington Football Team", nickname: "Washington", primary: "#5A1414", accent: "#FFB612" },
  ],
};

function teamFor(code: string, season: number) {
  const team = getTeamByAbbreviation(code);
  const era = (ERAS[code] ?? []).find((e) => season <= e.until);
  return {
    team,
    name: era?.name ?? team?.fullName ?? code,
    nickname: era?.nickname ?? team?.nickname ?? code,
    primary: era?.primary ?? team?.primaryColor ?? "#34425A",
    accent: era?.accent ?? team?.secondaryColor ?? "transparent",
  };
}

/* ---------------------------------------------------------------- stops */

type Line = { season: number; week: number; team: string; entry: GameLogEntry | null };

function sum(entries: GameLogEntry[], key: string): number {
  return entries.reduce((n, e) => n + (Number((e.stats as unknown as Record<string, unknown>)[key]) || 0), 0);
}

function stopStats(pos: string, entries: GameLogEntry[], games: number): { rail: { big: string; rest: string }; chips: StopStat[] } {
  const g = `${games} ${games === 1 ? "game" : "games"}`;
  if (games === 0) return { rail: { big: "0", rest: "games played" }, chips: [{ value: "0", label: "games" }] };
  if (pos === "QB") {
    const yd = sum(entries, "pass_yd");
    const td = sum(entries, "pass_td");
    const int = sum(entries, "pass_int");
    return {
      rail: { big: fmt(yd), rest: `pass yds, ${td} pass TD, ${int} INT · ${g}` },
      chips: [{ value: String(games), label: "games" }, { value: fmt(yd), label: "pass yds" }, { value: String(td), label: "pass TD" }, { value: String(int), label: "INT" }],
    };
  }
  if (pos === "RB") {
    const yd = sum(entries, "rush_yd");
    const td = sum(entries, "rush_td");
    const rec = sum(entries, "rec");
    return {
      rail: { big: fmt(yd), rest: `rush yds, ${td} rush TD, ${rec} rec · ${g}` },
      chips: [{ value: String(games), label: "games" }, { value: fmt(yd), label: "rush yds" }, { value: String(td), label: "rush TD" }, { value: String(rec), label: "rec" }],
    };
  }
  if (pos === "WR" || pos === "TE") {
    const rec = sum(entries, "rec");
    const yd = sum(entries, "rec_yd");
    const td = sum(entries, "rec_td");
    return {
      rail: { big: fmt(yd), rest: `rec yds, ${rec} rec, ${td} rec TD · ${g}` },
      chips: [{ value: String(games), label: "games" }, { value: String(rec), label: "rec" }, { value: fmt(yd), label: "rec yds" }, { value: String(td), label: "rec TD" }],
    };
  }
  if (pos === "K") {
    const fgm = sum(entries, "fgm");
    const fga = sum(entries, "fga");
    return {
      rail: { big: `${fgm}/${fga}`, rest: `FG · ${g}` },
      chips: [{ value: String(games), label: "games" }, { value: `${fgm}/${fga}`, label: "FG" }],
    };
  }
  return { rail: { big: String(games), rest: games === 1 ? "game" : "games" }, chips: [{ value: String(games), label: "games" }] };
}

/** "LI" -> 2016, the season it ended; "50" -> 2015. */
export function superBowlSeasonOf(name: string): number | null {
  if (/^\d+$/.test(name)) return Number(name) + 1965;
  const v: Record<string, number> = { I: 1, V: 5, X: 10, L: 50 };
  let n = 0;
  for (let i = 0; i < name.length; i += 1) {
    const a = v[name[i]!] ?? 0;
    const b = v[name[i + 1] ?? ""] ?? 0;
    if (!a) return null;
    n += a < b ? -a : a;
  }
  return n > 0 ? n + 1965 : null;
}

const NUMBER_WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/**
 * A contract row in the source's own terms (mak, 2026-09-30): "agreed to" is
 * not "signed" (an agreement is reported before the contract is executed),
 * an extension is not a new contract, and a restructure is neither. The verb
 * comes from the quote the fact was read from; "Signed" only when the quote
 * says signed.
 */
export function contractWords(team: string, t: { quote?: string; terms?: { years?: number; totalM?: number } }, plain: string | null): string {
  const q = t.quote ?? "";
  // "signing bonus" is money, not the act.
  const signed = /\bsign(ed|s)\b|\bsigning\b(?! bonus)/i.test(q);
  const agreed = /\bagree(d|s)?\b|\breached (an|a) (agreement|deal)\b/i.test(q);
  const verb = signed ? "Signed" : agreed ? "Agreed to" : "Signed";
  if (/\brestructur/i.test(q) && !/\bextension\b/i.test(q)) return `Restructured his contract with the ${team}.`;
  const kind = /\bextension\b/i.test(q) ? "contract extension" : "contract";
  const years = t.terms?.years ? `${NUMBER_WORDS[t.terms.years] ?? t.terms.years}-year` : "";
  const total = t.terms?.totalM ? `$${t.terms.totalM} million` : "";
  if (years && total) return `${verb} a ${years}, ${total} ${kind} with the ${team}.`;
  if (plain && kind === "contract") return plain;
  return `${verb} a ${kind} with the ${team}.`;
}

// A fact-checked headline ("Agreed to a three-year, $67.5 million contract
// extension") is printed as written, with the club added when it is not named.
function headlineText(team: string, t: WikiTransaction): string {
  const h = (t.headline ?? "").replace(/\.$/, "");
  // Suspensions, reinstatements and retirements are league or player actions,
  // not club ones: no club is appended, matching the headline-less
  // "Suspended by the NFL." / "Retired." forms.
  if (t.type === "Suspended" || t.type === "Reinstated" || t.type === "Retired") return `${h}.`;
  const nick = team.split(" ").pop() ?? team;
  // Naming the club by city counts too ("...the franchise tag from Washington").
  const city = team.slice(0, team.length - nick.length).trim();
  if (h.includes(nick) || (city && h.includes(city))) return `${h}.`;
  const by = t.type === "Tag" || /practice squad$|exercised$|^Designated|^Tendered/i.test(h);
  return `${h} ${by ? "by" : "with"} the ${team}.`;
}
const WIKI_TEXT: Record<string, (team: string, t: WikiTransaction) => string> = {
  Signed: (team, t) => contractWords(team, t, `Signed with the ${team}.`),
  "Re-signed": (team) => `Re-signed with the ${team}.`,
  Released: (team) => `Released by the ${team}.`,
  Waived: (team) => `Waived by the ${team}.`,
  Claimed: (team) => `Claimed off waivers by the ${team}.`,
  Traded: (team) => `Traded to the ${team}.`,
  "Placed on IR": (team) => `Placed on injured reserve by the ${team}.`,
  Activated: (team) => `Activated by the ${team}.`,
  Contract: (team, t) => contractWords(team, t, null),
  Suspended: () => `Suspended by the NFL.`,
  Retired: () => `Retired.`,
  Tender: (team) => `Signed his free-agent tender with the ${team}.`,
};

/**
 * The row a reviewed transaction prints. Shared with the review page
 * (scripts/player/bio/candidates.mjs), so what mak approves is what shows.
 * Null for a type the page does not print.
 */
export function wikiTransactionText(team: string, t: WikiTransaction): string | null {
  if (t.headline) return headlineText(team, t);
  return WIKI_TEXT[t.type]?.(team, t) ?? null;
}

/** The Super Bowl played after a season: 2016 -> "LI"; the 2015 season's was "50". */
export function superBowlName(season: number): string {
  const n = season - 1965;
  if (n === 50) return "50";
  const table: [number, string][] = [[50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  let left = n;
  for (const [v, r] of table) while (left >= v) (out += r), (left -= v);
  return out;
}

/**
 * Role off quarterback, from offensive snap share (nflverse snap counts, 2012
 * on): a starter played half the snaps or more in most of his games there, a
 * rotational player a quarter or more, a reserve less.
 */
export function snapRole(c: { g: number; s50: number; s25: number }): "starter" | "rotational" | "reserve" | null {
  if (c.g <= 0) return null;
  if (c.s50 * 2 > c.g) return "starter";
  if (c.s25 * 2 > c.g) return "rotational";
  return "reserve";
}

export const FIRST_SNAP_SEASON = 2012;
/** The game logs, and so the stops, start here. */
export const FIRST_LOG_SEASON = 2009;
/** The weekly rosters behind the Super Bowl facts start here. */
export const FIRST_WEEKLY_ROSTER_SEASON = 2002;

/** Spec 2.4's role table: starts over games at the stop. */
export function roleWords(starts: number, games: number): string {
  if (games <= 0) return "";
  if (starts === 0) return "a backup";
  const share = starts / games;
  if (share >= 0.75) return "the starter";
  if (share >= 0.25) return "a part-time starter";
  return `made ${starts} ${starts === 1 ? "start" : "starts"}`;
}

/**
 * The career, cut into stops: continuous runs with one club, across seasons.
 *
 * Games come from the logs, week by week, so a mid-season trade splits the
 * season between two stops. A season with no games takes its club from the
 * nflverse season roster; the same club as the run before continues the run
 * (a season on injured reserve is still time at the stop), a different club is
 * a stop of its own with no games. A season with neither is a gap, and a gap
 * ends a stop: nothing here claims he was with a club the data does not place
 * him at.
 */
function buildStops(
  input: BioPageInput,
  rosters: Record<string, string>,
  starts: Record<string, number>,
  snaps: SnapCounts,
  superBowls: SuperBowlFact[],
  trades: TradeFact[],
  draft: DraftFact | null,
): BioStop[] {
  const pos = input.position ?? "";
  const byseason = new Map(input.logCareer.map((s) => [s.season, s]));
  const seasons = [...new Set([...input.logCareer.map((s) => s.season), ...Object.keys(rosters).map(Number)])]
    .filter((s) => Number.isFinite(s) && s <= input.currentSeason)
    .sort((a, b) => a - b);

  const lines: Line[] = [];
  for (const season of seasons) {
    const played = byseason.get(season)?.weeks ?? [];
    const withTeam = played.filter((e) => e.team);
    if (withTeam.length) {
      for (const e of withTeam) lines.push({ season, week: e.week, team: String(e.team).toUpperCase(), entry: e });
    } else if (rosters[String(season)]) {
      lines.push({ season, week: 0, team: rosters[String(season)] as string, entry: null });
    }
  }
  if (lines.length === 0) return [];

  // Runs of one club with no season missing between them.
  const runs: Line[][] = [];
  for (const line of lines) {
    const run = runs[runs.length - 1];
    const last = run?.[run.length - 1];
    if (run && last && last.team === line.team && line.season - last.season <= 1) run.push(line);
    else runs.push([line]);
  }

  // Each season's weeks split across the clubs he played for that year.
  const clubsIn = new Map<number, Set<string>>();
  for (const l of lines) (clubsIn.get(l.season) ?? clubsIn.set(l.season, new Set()).get(l.season)!).add(l.team);

  const finishes = new Map(input.logCareer.map((s) => [s.season, s.finish]));
  const currentCode = input.team?.code ?? null;

  return runs.map((run, index) => {
    const code = run[0]!.team;
    const from = run[0]!.season;
    const to = run[run.length - 1]!.season;
    const runSeasons = [...new Set(run.map((l) => l.season))];
    const width = runSeasons.reduce((w, s) => w + 1 / (clubsIn.get(s)?.size ?? 1), 0);
    const entries = run.map((l) => l.entry).filter((e): e is GameLogEntry => e !== null);
    const games = entries.length;
    const era = teamFor(code, to);
    const last = index === runs.length - 1;
    const current = last && currentCode === code && to >= input.currentSeason - 1;
    const spell = runs.slice(0, index).filter((r) => r[0]!.team === code).length + 1;

    const qbStarts = pos === "QB" ? runSeasons.reduce((n, s) => n + (starts[`${s}:${code}`] ?? 0), 0) : null;
    const { rail, chips } = stopStats(pos, entries, games);

    // Best fantasy season at the stop: a top-24 finish, most points.
    let best: BioStop["best"] = null;
    for (const s of runSeasons) {
      const finish = finishes.get(s);
      if (!finish || finish > 24) continue;
      const pts = entries.filter((e) => run.some((l) => l.entry === e && l.season === s)).reduce((n, e) => n + input.points(e), 0);
      if (!best || pts > best.points) best = { season: s, points: Math.round(pts * 10) / 10, finish };
    }

    const sentences: string[] = [];
    const drafted = index === 0 && draft && draft.year === from && draft.team === code;
    if (drafted && draft) {
      sentences.push(`Selected in round ${draft.round}, pick ${draft.pick}, of the ${draft.year} NFL Draft.`);
    }
    const tradeIn = trades.find((t) => t.to === code && Number(t.date.slice(0, 4)) >= from - 1 && Number(t.date.slice(0, 4)) <= to);
    if (tradeIn && index > 0) {
      const d = dateWords(tradeIn.date);
      sentences.push(`Acquired in a trade with the ${teamFor(tradeIn.from, Number(tradeIn.date.slice(0, 4))).name}${d ? ` on ${d.long}` : ""}.`);
    }
    if (qbStarts !== null && games > 0) {
      const role = roleWords(qbStarts, games);
      const counts = `${qbStarts} ${qbStarts === 1 ? "start" : "starts"} in ${games} ${games === 1 ? "game" : "games"}`;
      sentences.push(
        qbStarts === 0
          ? `He was a backup, appearing in ${games} ${games === 1 ? "game" : "games"} without a start.`
          : role.startsWith("made")
            ? `He ${role} in ${games} ${games === 1 ? "game" : "games"}.`
            : `He was ${role}, with ${counts}.`,
      );
    }
    // Off quarterback, the role comes from snap counts, and only for a stop
    // they cover in full (2012 on); an earlier stop shows its games alone.
    if (qbStarts === null && pos !== "K" && games > 0 && from >= FIRST_SNAP_SEASON) {
      const c = runSeasons.reduce((n, s) => {
        const x = snaps[`${s}:${code}`];
        return x ? { g: n.g + x.g, s50: n.s50 + x.s50, s25: n.s25 + x.s25 } : n;
      }, { g: 0, s50: 0, s25: 0 });
      const role = snapRole(c);
      const of = (n: number) => `${n} of ${c.g} ${c.g === 1 ? "game" : "games"}`;
      if (role === "starter") sentences.push(`He was a starter, playing at least half the offensive snaps in ${of(c.s50)}.`);
      else if (role === "rotational") sentences.push(`He was a rotational player, playing at least a quarter of the offensive snaps in ${of(c.s25)}.`);
      else if (role === "reserve") sentences.push(`He was a reserve, playing less than a quarter of the offensive snaps in ${of(c.g - c.s25)}.`);
    }
    const rings = superBowls.filter((b) => b.team === code && b.season >= from && b.season <= to).map((b) => b.season).sort((a, b) => a - b);
    for (const y of rings) sentences.push(`Member of the Super Bowl ${superBowlName(y)} champion ${teamFor(code, y).nickname}.`);
    if (games === 0) sentences.push(`Listed on the ${to === from ? `${from}` : `${from}–${to}`} roster; no regular-season stats recorded.`);

    return {
      id: `${code.toLowerCase()}-${from}`,
      code,
      team: era.team,
      name: era.name,
      short: width >= 2 ? era.nickname : code,
      primary: era.primary,
      accent: era.accent,
      from,
      to,
      width: Math.round(width * 100) / 100,
      games,
      starts: qbStarts,
      superBowls: rings,
      rail,
      chips,
      sentences,
      best,
      current,
      spell,
    };
  });
}

/* ------------------------------------------------------------ the story */

/**
 * The Bio & Career story (mak's brief, 2026-11-28): how he got to the NFL
 * and what he has done since, in chronological order, under a headline the
 * facts support. Its job is distinct from the tabs around it: no lineup
 * advice or fantasy finishes (Outlook), no birth date, high school or
 * jersey number (Player Profile), no guessed reasons for a transfer or a
 * team change. Every figure is regular season, from the same weekly logs
 * the stops sum, with its time frame named: "first" only when his whole
 * career is in the logs, otherwise the seasons are named.
 */
interface BioStoryInput {
  name: string;
  last: string;
  pos: string;
  posWord: string | null;
  status: BioStatus;
  team: NflTeam | null;
  colleges: string[];
  draft: DraftFact | null;
  undrafted: { year: number } | null;
  stops: BioStop[];
  trades: TradeFact[];
  wikiTx: WikiTransaction[];
  proBowls: number | null;
  allPro: number | null;
  rings: SuperBowlFact[];
  logCareer: LogSeason[];
  currentSeason: number;
  /** His first season is in the logs, so "first" and career totals are true. */
  fullCareer: boolean;
}

const n2w = (n: number): string => (n === 0 ? "zero" : NUMBER_WORDS[n] ?? String(n));
const ROUND_WORDS = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh"];

/** "Denver" for a sentence's subject; the full name where the city is shared or the era is old. */
function clubSubject(code: string, season: number): string {
  const t = teamFor(code, season);
  const city = t.name.endsWith(` ${t.nickname}`) ? t.name.slice(0, -t.nickname.length - 1) : null;
  if (!city || /^(Los Angeles|New York|LA)$/.test(city)) return `The ${t.name}`;
  return city;
}

/** A season line in the position's own terms; "" when he has nothing to show. */
function productionLine(pos: string, es: GameLogEntry[], past: boolean, opts: { scrimmage?: boolean } = {}): string[] {
  const v = (has: string, had: string): string => (past ? had : has);
  const out: string[] = [];
  if (pos === "QB") {
    const att = sum(es, "pass_att");
    if (!att) return out;
    const td = sum(es, "pass_td");
    const int = sum(es, "pass_int");
    const tdInt = [td ? `${n2w(td)} ${td === 1 ? "touchdown" : "touchdowns"}` : null, int ? `${n2w(int)} ${int === 1 ? "interception" : "interceptions"}` : null].filter(Boolean) as string[];
    out.push(`completed ${fmt(sum(es, "pass_cmp"))} of ${fmt(att)} passes for ${fmt(sum(es, "pass_yd"))} yards${tdInt.length ? `, with ${list(tdInt)}` : ""}`);
    const ryd = sum(es, "rush_yd");
    const rtd = sum(es, "rush_td");
    if (ryd >= 100 || rtd >= 2) out.push(`${v("ran", "ran")} for ${fmt(ryd)} yards${rtd ? ` and ${n2w(rtd)} ${rtd === 1 ? "touchdown" : "touchdowns"}` : ""}`);
    return out;
  }
  if (pos === "RB" || pos === "FB") {
    const ryd = sum(es, "rush_yd");
    const rtd = sum(es, "rush_td");
    const rec = sum(es, "rec");
    const recYd = sum(es, "rec_yd");
    if (sum(es, "rush_att")) out.push(`rushed for ${fmt(ryd)} yards${rtd ? ` and ${n2w(rtd)} ${rtd === 1 ? "touchdown" : "touchdowns"}` : ""}`);
    if (rec) {
      out.push(
        `caught ${fmt(rec)} ${rec === 1 ? "pass" : "passes"} for ${fmt(recYd)} yards` +
          (opts.scrimmage && ryd > 0 ? `, bringing his total to ${fmt(ryd + recYd)} yards from scrimmage` : ""),
      );
    }
    return out;
  }
  if (pos === "WR" || pos === "TE") {
    const rec = sum(es, "rec");
    const td = sum(es, "rec_td");
    if (rec) out.push(`caught ${fmt(rec)} ${rec === 1 ? "pass" : "passes"} for ${fmt(sum(es, "rec_yd"))} yards${td ? ` and ${n2w(td)} ${td === 1 ? "touchdown" : "touchdowns"}` : ""}`);
    return out;
  }
  if (pos === "K") {
    const fga = sum(es, "fga");
    if (fga) out.push(`made ${sum(es, "fgm")} of ${fga} field-goal attempts`);
  }
  return out;
}

/** The season that defines him by the position's own measure; null with fewer than two full seasons. */
function definingSeason(pos: string, logCareer: LogSeason[]): { season: number; entries: GameLogEntry[]; value: number; label: string } | null {
  const measure = (es: GameLogEntry[]): number =>
    pos === "QB" ? sum(es, "pass_yd") : pos === "RB" || pos === "FB" ? sum(es, "rush_yd") + sum(es, "rec_yd") : pos === "K" ? sum(es, "fgm") : sum(es, "rec_yd");
  const label = pos === "QB" ? "passing yards" : pos === "RB" || pos === "FB" ? "yards from scrimmage" : pos === "K" ? "field goals" : "receiving yards";
  const full = logCareer.filter((s) => s.weeks.length >= 8);
  if (full.length < 2) return null;
  const best = full.map((s) => ({ season: s.season, entries: s.weeks, value: measure(s.weeks) })).sort((a, b) => b.value - a.value)[0]!;
  return best.value > 0 ? { ...best, label } : null;
}

export function bioStory(input: BioStoryInput): { headline: string | null; paragraphs: string[] } {
  const { last, pos, posWord, status, draft, undrafted, stops } = input;
  const colleges = input.colleges.map((c) => c.replace(/\.+$/, (m) => (/\b(Univ|St|Inst|Coll)$/.test(c.slice(0, -m.length)) ? "." : "")));
  const past = status === "former";
  const paragraphs: string[] = [];
  const all = input.logCareer.flatMap((s) => s.weeks);
  const seasonsPlayed = input.logCareer.filter((s) => s.weeks.length > 0).sort((a, b) => a.season - b.season);
  const clubs = [...new Set(stops.map((s) => s.code))];
  const firstStop = stops[0] ?? null;
  const lastStop = stops[stops.length - 1] ?? null;
  const entryYear = draft?.year ?? undrafted?.year ?? null;

  const signedUdfa = undrafted ? input.wikiTx.find((t) => t.type === "Signed" && Number(t.date.slice(0, 4)) === undrafted.year) : undefined;
  const undraftedClub = undrafted
    ? signedUdfa ? teamFor(signedUdfa.team, undrafted.year).name : stops.find((s) => s.from === undrafted.year)?.name ?? null
    : null;
  const udfaNick = undrafted
    ? signedUdfa ? teamFor(signedUdfa.team, undrafted.year).nickname : (() => { const st = stops.find((x) => x.from === undrafted.year); return st ? teamFor(st.code, st.from).nickname : null; })()
    : null;

  /* ---- 1. the route into the league ---- */
  const p1: string[] = [];
  if (colleges.length === 1) p1.push(`${last} played college football at ${colleges[0]}.`);
  else if (colleges.length === 2) p1.push(`${last} began his college career at ${colleges[0]} before transferring to ${colleges[1]}.`);
  // Three or more schools: the data's order is not always the path (Hill:
  // Garden City CC came first), so no order is claimed.
  else if (colleges.length > 2) p1.push(`${last} played college football at ${list(colleges)}.`);
  if (draft) {
    const by = draft.team ? clubSubject(draft.team, draft.year) : "An NFL team";
    const who = p1.length ? `the ${posWord ?? "player"}` : last;
    p1.push(`${by} selected ${who} in the ${ROUND_WORDS[draft.round] ?? ordinal(draft.round)} round of the ${draft.year} NFL Draft with the ${ordinal(draft.pick)} overall pick.`);
  } else if (undrafted) {
    // The documented signing: a reviewed signing in his undrafted year, else
    // the club whose roster he first appears on that year.
    const club = undraftedClub;
    p1.push(club ? `He went undrafted in ${undrafted.year} and signed with the ${club}.` : `He went undrafted in ${undrafted.year}.`);
  } else if (firstStop) {
    p1.push(`His first season on record is ${firstStop.from}, with the ${firstStop.name}.`);
  }
  if (p1.length) paragraphs.push(p1.join(" "));

  /* ---- 2. what he has done since arriving ---- */
  const p2: string[] = [];
  const oneClub = clubs.length === 1 && firstStop !== null;
  const rookieCareer = seasonsPlayed.length <= 1 && input.fullCareer;
  if (all.length === 0) {
    if (status === "active" && input.team && entryYear === input.currentSeason) p2.push(`He has yet to appear in a regular-season game.`);
  } else if (rookieCareer) {
    const club = firstStop ? ` with the ${teamFor(firstStop.code, firstStop.from).nickname}` : "";
    const lines = productionLine(pos, all, past, { scrimmage: true });
    const frame = all.length === 1 ? `In his first regular-season game${club}, ${last}` : `In his first ${n2w(all.length)} regular-season games${club}, ${last}`;
    if (lines.length >= 2 && (pos === "RB" || pos === "FB")) p2.push(`${frame} ${lines[0]}. He also ${lines[1]}.`);
    else if (lines.length) p2.push(`${frame} ${lines.join(", and ")}.`);
    else p2.push(`${frame.replace(`, ${last}`, "")}, ${last} ${past ? "did" : "has"} not recorded a ${pos === "QB" ? "pass attempt" : "touch"}.`.replace(`In his first`, `Through his first`));
  } else {
    const games = all.length;
    const first = seasonsPlayed[0]!.season;
    const lastSeason = seasonsPlayed[seasonsPlayed.length - 1]!.season;
    const span = first === lastSeason ? `in ${first}` : input.fullCareer ? `since ${first}` : `from ${first} through ${lastSeason}`;
    if (oneClub) {
      const nick = teamFor(firstStop!.code, firstStop!.from).nickname;
      const seasons = seasonsPlayed.length;
      p2.push(
        input.fullCareer
          ? `${last} ${past ? "spent" : "has spent"} all ${n2w(seasons)} of his NFL seasons with the ${nick}, appearing in ${games} regular-season games.`
          : `${last} appeared in ${games} regular-season games for the ${nick} ${span}.`,
      );
    } else {
      // The chronology of clubs: consecutive stops in one clause, a return
      // or the current club with its own verb; trades with their dates.
      const segs: string[] = [];
      const seen = new Set<string>();
      let run: string[] = [];
      const flush = (): void => {
        if (run.length) segs.push(`played for the ${list(run)}`);
        run = [];
      };
      stops.forEach((st, i) => {
        const back = seen.has(st.code);
        seen.add(st.code);
        // Before 2009 the logs cannot date his first club: "through 2022".
        const yrs =
          i === 0 && !input.fullCareer && draft?.team === st.code
            ? `THROUGH${st.to}`
            : st.from === st.to ? `${st.from}` : `${st.from} to ${st.to}`;
        // A trade into his first club is a draft-day pick trade, not his.
        const trade = i > 0 ? input.trades.find((t) => t.to === st.code && Number(t.date.slice(0, 4)) >= st.from - 1 && Number(t.date.slice(0, 4)) <= st.from) : undefined;
        if (trade) {
          flush();
          segs.push(`was traded to the ${st.name} in ${Number(trade.date.slice(0, 4))}`);
        } else if (back) {
          flush();
          segs.push(`returned to the ${st.name} in ${st.from}`);
        } else if (st.current && !past && i > 0) {
          flush();
          segs.push(`joined the ${st.name} in ${st.from}`);
        } else {
          run.push(yrs.startsWith("THROUGH") ? `${st.name} through ${yrs.slice(7)}` : `${st.name} (${yrs})`);
        }
      });
      flush();
      p2.push(`${last} ${list(segs)}.`);
      p2.push(`${past ? "He appeared" : "He has appeared"} in ${games} regular-season games ${span}.`);
    }
    const peak = definingSeason(pos, input.logCareer);
    if (peak) {
      const lines = productionLine(pos, peak.entries, true);
      const club = (() => {
        const codes = [...new Set(peak.entries.map((e) => String(e.team ?? "").toUpperCase()).filter(Boolean))];
        return codes.length === 1 && !oneClub ? ` with the ${teamFor(codes[0]!, peak.season).nickname}` : "";
      })();
      if (lines.length) {
        p2.push(
          `${input.fullCareer ? "His most productive season" : `His most productive season in that span`} came in ${peak.season}${club}, when he ${lines.join(", and ")} in ${peak.entries.length} games.`,
        );
      }
    }
  }
  if (p2.length) paragraphs.push(p2.join(" "));

  /* ---- 3. honors, when there are any ---- */
  const p3: string[] = [];
  const rings = [...input.rings].sort((a, b) => a.season - b.season);
  if (rings.length) {
    p3.push(
      rings.length === 1
        ? `He won Super Bowl ${superBowlName(rings[0]!.season)} with the ${teamFor(rings[0]!.team, rings[0]!.season).nickname} after the ${rings[0]!.season} season.`
        : new Set(rings.map((r) => r.team)).size === 1
          ? `${past ? "He won" : "He has won"} Super Bowls ${list(rings.map((r) => superBowlName(r.season)))} with the ${teamFor(rings[0]!.team, rings[0]!.season).nickname}.`
          : `${past ? "He won" : "He has won"} ${n2w(rings.length)} Super Bowls: ${list(rings.map((r) => `${superBowlName(r.season)} with the ${teamFor(r.team, r.season).nickname}`))}.`,
    );
  }
  const honors: string[] = [];
  if (input.proBowls) honors.push(`${input.proBowls === 1 ? "a Pro Bowl" : `${n2w(input.proBowls)} Pro Bowls`}`);
  if (input.allPro) honors.push(`${input.allPro === 1 ? "an All-Pro team" : `${n2w(input.allPro)} All-Pro teams`}`);
  if (honors.length) p3.push(`He ${past ? "was" : "has been"} named to ${list(honors)}.`);
  if (p3.length) paragraphs.push(p3.join(" "));

  /* ---- the headline: the angle with the clearest facts ---- */
  let headline: string | null = null;
  const draftClub = draft?.team ? clubSubject(draft.team, draft.year).replace(/^The /, "the ") : null;
  const nickOf = (st: BioStop | null): string | null => (st ? teamFor(st.code, st.from).nickname : null);
  if (rings.length >= 2) headline = `${cap(n2w(rings.length))} Super Bowl titles${new Set(rings.map((r) => r.team)).size === 1 ? ` with the ${teamFor(rings[0]!.team, rings[0]!.season).nickname}` : ""}`;
  else if (input.proBowls && input.proBowls >= 3) headline = `${/^(eight|eleven|18)/.test(n2w(input.proBowls)) ? "An" : "A"} ${n2w(input.proBowls)}-time Pro Bowl ${posWord ?? "selection"}`;
  else if (rings.length === 1) headline = `A Super Bowl champion with the ${teamFor(rings[0]!.team, rings[0]!.season).nickname}`;
  else if (draft && draft.round >= 3 && input.proBowls && posWord) headline = `A ${ROUND_WORDS[draft.round] ?? ordinal(draft.round)}-round pick turned Pro Bowl ${posWord}`;
  else if (colleges.length >= 2 && colleges.length <= 2 && draftClub && seasonsPlayed.length <= 3) headline = `From ${colleges.join(" to ")} and on to ${draftClub}`;
  else if (oneClub && input.fullCareer && seasonsPlayed.length >= 5) headline = `${cap(n2w(seasonsPlayed.length))} seasons, all with the ${nickOf(firstStop)}`;
  else if (clubs.length >= 4 && input.fullCareer && firstStop && lastStop) headline = `${cap(n2w(clubs.length))} clubs in ${n2w(lastStop.to - firstStop.from + 1)} seasons`;
  else if (lastStop && lastStop.current && !past && stops.slice(0, -1).some((x) => x.code === lastStop.code))
    headline = `Back with the ${nickOf(lastStop)} in ${lastStop.from}`;
  else if (undrafted && all.length > 0 && nickOf(lastStop)) headline = `From undrafted free agent to the ${nickOf(lastStop)}`;
  else if (undrafted && all.length === 0 && udfaNick) headline = `An undrafted signing with the ${udfaNick}`;
  else if (clubs.length >= 2 && clubs.length <= 3 && input.fullCareer && firstStop && lastStop && seasonsPlayed.length > 3 && lastStop.code !== firstStop.code)
    headline = `From the ${nickOf(firstStop)} to the ${nickOf(lastStop)}`;
  else if (draft && draft.round === 1 && colleges.length) headline = `A first-round pick out of ${colleges[colleges.length - 1]}`;
  else if (colleges.length === 1 && draftClub && seasonsPlayed.length <= 3) headline = `From ${colleges[0]} to ${draftClub}`;
  else if (input.trades.length && clubs.length >= 2) {
    // The trade's own destination and year, never the club he is with now.
    const t = [...input.trades].sort((a, b) => a.date.localeCompare(b.date)).at(-1)!;
    const yr = Number(t.date.slice(0, 4));
    if (!draft || yr > draft.year) headline = `Traded to the ${teamFor(t.to, yr).nickname} in ${yr}`;
  }
  // A school name that ends in an abbreviation ("Univ.") ends its sentence.
  return { headline, paragraphs: paragraphs.map((x) => x.replace(/\.\./g, ".")) };
}

const cap = (x: string): string => x.charAt(0).toUpperCase() + x.slice(1);

/* ----------------------------------------------------------------- page */

export function buildBioPage(input: BioPageInput): BioPageFacts | null {
  const { entry } = input;
  if (!entry) return null;
  const used = new Set<string>();
  const get = <T>(field: string): T | null => {
    const f = fact<T>(entry, field);
    if (f) used.add(f.source);
    return f ? f.value : null;
  };

  const pos = input.position ?? "";
  const posWord = POSITION_WORDS[pos] ?? null;
  const last = surname(input.name);
  const birth = get<string>("birth_date");
  const birthPlace = get<string>("birth_place");
  const height = get<number>("height_in");
  const weight = get<number>("weight_lb");
  const hs = get<string>("high_school");
  const colleges = get<string[]>("colleges");
  const draft = get<DraftFact>("draft");
  const undrafted = get<{ year: number }>("undrafted");
  const proBowls = get<number>("pro_bowls");
  const allPro = get<number>("all_pro");
  const rosters = get<Record<string, string>>("team_by_season") ?? {};
  const starts = pos === "QB" ? get<Record<string, number>>("qb_starts") ?? {} : {};
  const snaps = pos !== "QB" && pos !== "K" ? get<SnapCounts>("snap_games") ?? {} : {};
  const rosterRings = get<SuperBowlFact[]>("super_bowls") ?? [];
  const careerTeams = get<CareerTeam[]>("career_teams");
  const titles = get<string[]>("super_bowl_titles");
  const wikiTx = get<WikiTransaction[]>("wiki_transactions") ?? [];
  const tradeFact = fact<TradeFact[]>(entry, "trades");
  const trades = tradeFact?.value ?? [];

  const stops = buildStops(input, rosters, starts, snaps, rosterRings, trades, draft);
  const gameSeasons = input.logCareer.filter((s) => s.weeks.length > 0).map((s) => s.season);
  const priorSeasons = gameSeasons.filter((s) => s < input.currentSeason).length;
  const lastGameSeason = gameSeasons.length ? Math.max(...gameSeasons) : null;
  const status: BioStatus = input.team ? "active" : lastGameSeason !== null && lastGameSeason >= input.currentSeason - 1 ? "free-agent" : "former";
  const clubs = [...new Set(stops.map((s) => s.code))];
  // A career that began before the data does: counts of seasons, clubs and
  // Super Bowls would be counts of what the data covers, not of his career,
  // so they are not shown. Unknown entry year, same caution.
  const entryYear = draft?.year ?? undrafted?.year ?? null;
  const fromLogs = entryYear !== null && entryYear >= FIRST_LOG_SEASON;
  const fromRosters = entryYear !== null && entryYear >= FIRST_WEEKLY_ROSTER_SEASON;
  // The infobox's career history covers the whole career, so it can say what
  // the logs cannot: the club count, and whose roster each title came with.
  const boxTeams = (careerTeams ?? []).filter((t) => !t.offseason);
  const clubAt = (season: number) => boxTeams.find((t) => season >= t.from && season <= (t.to ?? input.currentSeason))?.team ?? null;
  // Super Bowls: the weekly rosters when they cover the career; otherwise the
  // infobox's titles, each placed with the club the infobox has him at.
  const superBowls: SuperBowlFact[] = fromRosters
    ? rosterRings
    : (titles ?? []).map((t) => {
        const season = superBowlSeasonOf(t);
        const team = season ? clubAt(season) : null;
        return season && team ? { season, team } : null;
      }).filter((x): x is SuperBowlFact => x !== null);
  const ringsKnown = fromRosters || (titles !== null && superBowls.length === (titles?.length ?? 0));

  /* ---- quick facts (spec 2.2): a row only when the fact exists ---- */
  const quick: QuickFact[] = [];
  const born = birth ? dateWords(birth) : null;
  if (born) quick.push({ label: "Born", value: born.short });
  if (birthPlace) quick.push({ label: "Birthplace", value: birthPlace });
  const age = birth ? ageOn(birth, input.now) : null;
  if (age !== null) quick.push({ label: "Age", value: String(age) });
  if (height) quick.push({ label: "Height", value: `${Math.floor(height / 12)}'${height % 12}"` });
  if (weight) quick.push({ label: "Weight", value: `${weight} lb` });
  if (hs) quick.push({ label: "High school", value: hs });
  if (colleges?.length) quick.push({ label: colleges.length > 1 ? "Colleges" : "College", value: colleges.join(", ") });
  if (draft) quick.push({ label: "Drafted", value: `${draft.year}, Rd ${draft.round}, #${draft.pick}${draft.team ? ` (${draft.team})` : ""}` });
  else if (undrafted) quick.push({ label: "Drafted", value: `Undrafted (${undrafted.year})` });
  if (status === "active" && input.number !== null && input.number !== "" && input.number !== undefined) quick.push({ label: "Jersey", value: `No. ${input.number}` });
  if (status === "active" && fromLogs) quick.push({ label: "Experience", value: priorSeasons === 0 ? "Rookie" : `${ordinal(priorSeasons + 1)} season` });
  const teamCount = fromLogs ? clubs.length : new Set(boxTeams.map((t) => t.team)).size;
  if (teamCount) quick.push({ label: "Teams", value: String(teamCount) });
  const rings = ringsKnown ? [...superBowls].sort((a, b) => a.season - b.season) : [];
  if (rings.length) {
    quick.push({
      label: rings.length > 1 ? "Super Bowls" : "Super Bowl",
      value: rings.map((b) => `${superBowlName(b.season)} (${b.season} ${teamFor(b.team, b.season).nickname})`).join(", "),
    });
  }
  if (proBowls) quick.push({ label: "Pro Bowls", value: String(proBowls) });
  if (allPro) quick.push({ label: "All-Pro", value: String(allPro) });

  /* ---- the bio story (mak's brief, 2026-11-28): bioStory() above ---- */
  const story = bioStory({
    name: input.name,
    last,
    pos,
    posWord,
    status,
    team: input.team,
    colleges: colleges ?? [],
    draft,
    undrafted,
    stops,
    trades,
    wikiTx,
    proBowls,
    allPro,
    rings: ringsKnown ? superBowls : [],
    logCareer: input.logCareer.filter((s) => s.weeks.length > 0),
    currentSeason: input.currentSeason,
    fullCareer: fromLogs,
  });
  const paragraphs = story.paragraphs;

  /* ---- transactions (spec 2.7, as amended by mak 2026-09-30) ----
   * Every row is dated as precisely as its source allows, never more: a trade
   * has its day (nflverse trades); the draft has its year; a team change read
   * off the season rosters has its season, and "offseason" only when his first
   * game with the new club was in Week 1. A team change a dated trade explains
   * is not listed twice. No row carries a reason its source does not give. */
  const transactions: BioTransaction[] = [];
  const txSources = new Set<string>();
  for (const t of trades) {
    const d = dateWords(t.date);
    if (!d) continue;
    const yr = Number(t.date.slice(0, 4));
    const back = t.return
      .map((r) => {
        if ("player" in r) return `${r.pos ? `${r.pos} ` : ""}${r.player}`;
        const p = r.pick;
        if (!p.season || !p.round) return null;
        return `a ${p.season} ${ORDINAL_WORDS[p.round] ?? ordinal(p.round)}-round pick${p.conditional ? " (conditional)" : ""}`;
      })
      .filter((x): x is string => x !== null);
    transactions.push({
      date: t.date,
      precision: "day",
      when: d.short,
      type: "Traded",
      text: `Traded by the ${teamFor(t.from, yr).name} to the ${teamFor(t.to, yr).name}${back.length === t.return.length && back.length ? ` for ${list(back)}` : ""}.`,
      sort: t.date,
    });
    if (tradeFact) txSources.add(tradeFact.source);
  }
  const draftFact = fact<DraftFact>(entry, "draft");
  if (draft && draftFact) {
    const by = draft.team ? teamFor(draft.team, draft.year).name : null;
    transactions.push({
      date: String(draft.year),
      precision: "season",
      when: `${draft.year} draft`,
      type: "Drafted",
      text: `Selected${by ? ` by the ${by}` : ""} in round ${draft.round}, pick ${draft.pick}.`,
      sort: `${draft.year}-04`,
    });
    txSources.add(draftFact.source);
  } else if (undrafted) {
    const firstStop = stops.find((s) => s.from === undrafted.year);
    transactions.push({
      date: String(undrafted.year),
      precision: "season",
      when: `${undrafted.year} offseason`,
      type: "Signed",
      text: `Signed as an undrafted free agent${firstStop ? ` with the ${firstStop.name}` : ""}.`,
      sort: `${undrafted.year}-05`,
    });
    const u = fact(entry, "undrafted");
    if (u) txSources.add(u.source);
  }
  // Reviewed Wikipedia moves (quote-checked, approved by mak): the day or month
  // the article states. A trade nflverse already dates is not listed twice.
  const wikiFact = fact(entry, "wiki_transactions");
  for (const t of wikiTx) {
    const text = wikiTransactionText(teamFor(t.team, Number(t.date.slice(0, 4))).name, t);
    if (!text) continue;
    if (t.type === "Traded" && trades.some((x) => x.date === t.date || (x.to === t.team && x.date.slice(0, 7) === t.date.slice(0, 7)))) continue;
    const y = Number(t.date.slice(0, 4));
    const mo = Number(t.date.slice(5, 7));
    const when = t.precision === "day" ? dateWords(t.date)?.short : `${MONTHS_SHORT[mo - 1]} ${y}`;
    if (!when) continue;
    transactions.push({
      date: t.date,
      precision: t.precision,
      when,
      type: t.type as BioTransaction["type"],
      text,
      sort: t.date,
    });
    if (wikiFact) txSources.add(wikiFact.source);
  }
  // A club he signed with or was claimed by on a stated date needs no "Joined" row.
  const datedArrival = (code: string, season: number) =>
    wikiTx.some((t) => {
      if (t.team !== code || !["Signed", "Re-signed", "Claimed", "Traded", "Contract"].includes(t.type)) return false;
      const y = Number(t.date.slice(0, 4));
      const mo = Number(t.date.slice(5, 7));
      return y === season || (y === season - 1 && mo >= 2);
    });

  const rosterFact = fact(entry, "team_by_season");
  const firstWeek = (code: string, season: number): number | null => {
    const weeks = input.logCareer.find((x) => x.season === season)?.weeks.filter((e) => String(e.team ?? "").toUpperCase() === code) ?? [];
    return weeks.length ? Math.min(...weeks.map((e) => e.week)) : null;
  };
  stops.forEach((s, i) => {
    if (i === 0) return;
    const traded = trades.some((t) => t.to === s.code && Number(t.date.slice(0, 4)) >= s.from - 1 && Number(t.date.slice(0, 4)) <= s.from);
    if (traded || datedArrival(s.code, s.from)) return;
    const back = stops.slice(0, i).some((x) => x.code === s.code);
    const wk = firstWeek(s.code, s.from);
    const offseason = wk === 1;
    transactions.push({
      date: String(s.from),
      precision: "season",
      when: offseason ? `${s.from} offseason` : String(s.from),
      type: "Joined",
      text: `${back ? "Returned to" : "Joined"} the ${s.name}${offseason ? "" : wk ? `; his first game with them was Week ${wk}` : ""}.`,
      // Sorting only, never shown: a mid-season arrival sits by his first
      // game's rough date (Week 1 about Sep 7), so it follows an earlier trade.
      sort: offseason ? `${s.from}-03` : wk ? new Date(Date.UTC(s.from, 8, 7 + 7 * (wk - 1))).toISOString().slice(0, 10) : `${s.from}-06`,
    });
    if (rosterFact) txSources.add(rosterFact.source);
  });
  transactions.sort((a, b) => b.sort.localeCompare(a.sort));
  for (const k of txSources) used.add(k);

  const axis: number[] = [];
  if (stops.length) for (let y = stops[0]!.from; y <= stops[stops.length - 1]!.to; y += 1) axis.push(y);

  const name = (key: string) => input.sources[key]?.name ?? key;
  return {
    raw: { birthDate: birth, birthPlace, heightIn: height, weightLb: weight, highSchool: hs, colleges: colleges ?? [], draft, undrafted, ids: entry.ids },
    indexable: bioIndexable(input.team !== null, entry),
    status,
    quick,
    headline: story.headline,
    paragraphs,
    stops,
    axis,
    college: colleges?.length ? { names: colleges } : null,
    transactions,
    superBowls: rings.map((b) => ({ season: b.season, name: superBowlName(b.season), team: teamFor(b.team, b.season).name })),
    tradesOnly: transactions.every((t) => t.type === "Traded"),
    hasDatedMoves: transactions.some((t) => t.precision !== "season" && t.type !== "Traded"),
    sources: [...used].map(name),
    transactionSources: [...txSources].map(name),
    changedAt: input.changedAt,
    seasonsPlayed: gameSeasons.length,
    coversCareer: fromLogs,
  };
}
