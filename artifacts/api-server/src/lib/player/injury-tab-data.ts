/**
 * The data behind the Injury tab's spec sections (injury-tab.ts), to mak's
 * "Build Instructions: StatChasers Player Injury Tab" of 2026-09-30.
 *
 * Everything the spec says must agree across the page (Part 4.9: the injury
 * count, games missed, body parts, "latest", "longest") is computed here from
 * one list of events and nothing else, so the tiles, the map, the table, the
 * timeline and the FAQ cannot drift apart.
 *
 * Pure apart from the two loaders at the foot: the practice report file
 * (scripts/player/buildPracticeReports.mjs) and the game logs, for which club
 * he was with when he got hurt.
 */

import fs from "node:fs";
import path from "node:path";
import { dataPath } from "../data-dir";
import { loadGameLogs } from "./data";
import { getTeamByAbbreviation, normalizeTeamName } from "../team/teams";
import type { NflInjuryEntry } from "./injury";

/* ------------------------------------------------------------------ events */

export type Phase = "REG" | "PRE" | "POST";
export type Side = "R" | "L" | null;

/**
 * Where a category sits on the front-view figure. Coordinates are the spec's
 * table (4.3): the player's right is the viewer's left.
 */
interface Spot {
  /** [player's right, player's left], or one point for the centre line. */
  at: [number, number] | [number, number, number, number];
  center?: boolean;
}

interface Category {
  /** The table's plain name. */
  name: string;
  /** The map's location key; categories sharing one share a marker. */
  spot: string;
  keywords: string[];
}

/**
 * Checked in order, against the injury's type first and its body part second:
 * the record files a "Thumb Fracture" under body part "wrist", and the type is
 * the one that is right.
 */
const CATEGORIES: Category[] = [
  { name: "Concussion", spot: "head", keywords: ["concussion"] },
  { name: "Head", spot: "head", keywords: ["head", "face", "jaw", "eye", "nose", "skull"] },
  { name: "Neck", spot: "neck", keywords: ["neck", "stinger", "cervical"] },
  { name: "Achilles", spot: "calf", keywords: ["achilles"] },
  { name: "Hand / thumb", spot: "hand", keywords: ["thumb", "finger", "hand"] },
  { name: "Wrist", spot: "wrist", keywords: ["wrist"] },
  { name: "Elbow / arm", spot: "elbow", keywords: ["elbow", "forearm", "bicep", "tricep", "arm"] },
  { name: "Shoulder", spot: "shoulder", keywords: ["shoulder", "clavicle", "collarbone", "ac joint", "rotator", "labrum"] },
  { name: "Chest / ribs", spot: "chest", keywords: ["chest", "rib", "pec", "sternum"] },
  { name: "Abdomen", spot: "abdomen", keywords: ["abdom", "oblique", "core", "sports hernia"] },
  { name: "Back", spot: "back", keywords: ["back", "spine", "lumbar", "disc", "vertebra"] },
  { name: "Hip / groin", spot: "hip", keywords: ["hip", "groin", "pelvis", "glute", "adductor"] },
  { name: "Hamstring", spot: "thigh", keywords: ["hamstring"] },
  { name: "Quad / thigh", spot: "thigh", keywords: ["quad", "thigh", "femur"] },
  { name: "Knee", spot: "knee", keywords: ["knee", "acl", "mcl", "pcl", "lcl", "meniscus", "patella"] },
  { name: "Calf / shin", spot: "calf", keywords: ["calf", "shin", "tibia", "fibula", "leg"] },
  { name: "Ankle", spot: "ankle", keywords: ["ankle"] },
  { name: "Foot / toe", spot: "foot", keywords: ["foot", "toe", "heel", "lisfranc", "plantar", "turf toe"] },
];

const OTHER = "Other";

const SPOTS: Record<string, Spot> = {
  head: { at: [150, 42, 150, 42], center: true },
  neck: { at: [150, 68, 150, 68], center: true },
  shoulder: { at: [118, 90, 182, 90] },
  chest: { at: [136, 118, 164, 118] },
  back: { at: [150, 150, 150, 150], center: true },
  elbow: { at: [100, 150, 200, 150] },
  wrist: { at: [92, 200, 208, 200] },
  hand: { at: [89, 216, 211, 216] },
  abdomen: { at: [150, 172, 150, 172], center: true },
  hip: { at: [128, 190, 172, 190] },
  thigh: { at: [132, 248, 168, 248] },
  knee: { at: [132, 304, 168, 304] },
  calf: { at: [131, 340, 169, 340] },
  ankle: { at: [130, 368, 170, 368] },
  foot: { at: [130, 384, 170, 384] },
};

/** The short noun a map label uses: "shoulder", "thumb", "Achilles". */
const SHORT: Record<string, string> = {
  Concussion: "Concussion",
  Head: "Head",
  Neck: "Neck",
  Achilles: "Achilles",
  Wrist: "wrist",
  "Elbow / arm": "elbow",
  Shoulder: "shoulder",
  "Chest / ribs": "ribs",
  Abdomen: "Abdomen",
  Back: "Back",
  "Hip / groin": "hip",
  Hamstring: "Hamstring",
  "Quad / thigh": "quad",
  Knee: "knee",
  "Calf / shin": "calf",
  Ankle: "ankle",
  "Foot / toe": "foot",
};

export function categorize(entry: Pick<NflInjuryEntry, "type" | "bodyPart">): string {
  for (const hay of [entry.type ?? "", entry.bodyPart ?? ""]) {
    const text = hay.toLowerCase();
    if (!text || text === "unknown") continue;
    for (const c of CATEGORIES) {
      if (c.keywords.some((k) => new RegExp(`\\b${k}`).test(text))) return c.name;
    }
  }
  return OTHER;
}

function categoryOf(name: string): Category | null {
  return CATEGORIES.find((c) => c.name === name) ?? null;
}

/** "thumb" for a hand injury that says thumb; the category's noun otherwise. */
function shortName(ev: InjuryEvent): string {
  if (ev.category === "Hand / thumb") {
    const t = `${ev.type} ${ev.bodyPart}`.toLowerCase();
    return t.includes("thumb") ? "thumb" : t.includes("finger") ? "finger" : "hand";
  }
  if (ev.category === "Foot / toe" && /toe/i.test(ev.type)) return "toe";
  return SHORT[ev.category] ?? ev.category.toLowerCase();
}

export interface InjuryEvent {
  id: string;
  season: number;
  /** Null for an entry without one; 0 is the record's preseason. */
  week: number | null;
  phase: Phase;
  category: string;
  bodyPart: string;
  side: Side;
  /** As the record names it: "Thumb Fracture", "Hamstring". */
  type: string;
  /** Regular-season games only (4.9); 0 for a postseason entry. */
  games: number;
  /** The record's own count, before the regular-season rule. */
  recordedGames: number;
  surgery: boolean;
  ir: boolean;
  note: string;
  /** His club's code when he got hurt, from the game logs; null when unknown. */
  team: string | null;
  /** How many records were folded into this one (a same-season re-aggravation). */
  merged: number;
}

/** The last regular-season week: 17 before the 2021 season, 18 since. */
export function lastRegularWeek(season: number): number {
  return season >= 2021 ? 18 : 17;
}

function phaseOf(season: number, week: number | null | undefined): Phase {
  if (week === 0) return "PRE";
  if (typeof week === "number" && week > lastRegularWeek(season)) return "POST";
  return "REG";
}

function sideOf(raw: string | undefined): Side {
  const s = (raw ?? "").toLowerCase();
  if (s === "right") return "R";
  if (s === "left") return "L";
  return null;
}

/**
 * The record, as the spec counts it (4.9).
 *
 * One event per distinct injury: the same body part (and side) hurt again in
 * the same season is one entry with its games summed. Games missed are
 * regular-season games; preseason and postseason entries stay on the page with
 * a count of zero (a preseason injury keeps the regular-season games it
 * cost). Most recent first.
 */
export function buildEvents(
  nfl: NflInjuryEntry[],
  teamFor: (season: number, week: number | null) => string | null = () => null,
): InjuryEvent[] {
  const byKey = new Map<string, InjuryEvent>();
  const ordered = [...nfl].sort(
    (a, b) => a.season - b.season || (a.week ?? 0) - (b.week ?? 0),
  );
  for (const e of ordered) {
    const week = typeof e.week === "number" ? e.week : null;
    const phase = phaseOf(e.season, week);
    const category = categorize(e);
    const side = sideOf(e.side);
    const recorded = Math.max(0, Number(e.gamesMissed) || 0);
    // The record counts regular-season games for a preseason injury too (it
    // has no preseason games to count), so only a postseason entry drops out.
    const games = phase === "POST" ? 0 : recorded;
    const note = (e.description ?? "").trim();
    const text = `${e.type ?? ""} ${note}`;
    const key = `${e.season}|${category}|${side ?? "-"}`;
    const prior = category === OTHER ? undefined : byKey.get(key);
    if (prior) {
      prior.games += games;
      prior.recordedGames += recorded;
      prior.merged += 1;
      if (note && !prior.note.includes(note)) prior.note = `${prior.note} ${note}`.trim();
      prior.surgery ||= /surgery/i.test(text);
      prior.ir ||= /injured reserve|\bIR\b/.test(text);
      continue;
    }
    const ev: InjuryEvent = {
      id: `${e.season}-${week ?? "x"}-${category}-${side ?? "u"}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
      season: e.season,
      week,
      phase,
      category,
      bodyPart: (e.bodyPart ?? "").toLowerCase(),
      side,
      type: (e.type ?? "").trim() || category,
      games,
      recordedGames: recorded,
      surgery: /surgery/i.test(text),
      ir: /injured reserve|\bIR\b/.test(text),
      note,
      team: teamFor(e.season, week),
      merged: 1,
    };
    byKey.set(category === OTHER ? `${key}|${byKey.size}` : key, ev);
  }
  return [...byKey.values()].sort(
    (a, b) => b.season - a.season || (b.week ?? -1) - (a.week ?? -1),
  );
}

/* ------------------------------------------------------------------ totals */

export interface PartRow {
  category: string;
  injuries: number;
  games: number;
}

export interface InjuryTotals {
  injuries: number;
  games: number;
  /** Distinct categories, side ignored (4.9). */
  parts: number;
  rows: PartRow[];
  latest: InjuryEvent | null;
  longest: InjuryEvent | null;
}

export function totals(events: InjuryEvent[]): InjuryTotals {
  const byCat = new Map<string, PartRow>();
  for (const ev of events) {
    const row = byCat.get(ev.category) ?? { category: ev.category, injuries: 0, games: 0 };
    row.injuries += 1;
    row.games += ev.games;
    byCat.set(ev.category, row);
  }
  const rows = [...byCat.values()].sort(
    (a, b) => b.games - a.games || b.injuries - a.injuries || a.category.localeCompare(b.category),
  );
  let longest: InjuryEvent | null = null;
  for (const ev of events) if (ev.games > 0 && (!longest || ev.games > longest.games)) longest = ev;
  return {
    injuries: events.length,
    games: events.reduce((n, ev) => n + ev.games, 0),
    parts: byCat.size,
    rows,
    latest: events[0] ?? null,
    longest,
  };
}

/* ------------------------------------------------------------ risk factors */

export type Level = "good" | "mid" | "bad";

export interface Factor {
  title: string;
  evidence: string;
  level: Level;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The four rows of 4.3, each from the spec's own thresholds. */
export function riskFactors(
  events: InjuryEvent[],
  t: InjuryTotals,
  season: number,
  seasonsPlayed: number,
): Factor[] {
  const out: Factor[] = [];

  // Recurring injuries.
  const byCat = new Map<string, InjuryEvent[]>();
  for (const ev of events) {
    if (ev.category === OTHER) continue;
    byCat.set(ev.category, [...(byCat.get(ev.category) ?? []), ev]);
  }
  let recurring: Level = "good";
  let worst: { cat: string; evs: InjuryEvent[] } | null = null;
  for (const [cat, evs] of byCat) {
    if (evs.length < 2) continue;
    // Twice within two seasons, with games missed both times, is "high" too.
    const close = evs.some((a) =>
      evs.some((b) => a !== b && Math.abs(a.season - b.season) <= 2 && a.games > 0 && b.games > 0),
    );
    const level: Level = evs.length >= 3 || close ? "bad" : "mid";
    const better =
      !worst ||
      rank(level) > rank(recurring) ||
      (rank(level) === rank(recurring) && evs.length > worst.evs.length);
    if (better) {
      worst = { cat, evs: [...evs].sort((a, b) => a.season - b.season) };
      recurring = level;
    }
  }
  out.push({
    title: "Recurring injuries",
    level: recurring,
    evidence: worst
      ? `${worst.cat} injuries in ${listWords(worst.evs.map((e) => String(e.season)))}`
      : "No body part injured twice",
  });

  // Recent history.
  const thisSeason = events.filter((e) => e.season === season);
  const lastSeason = events.filter((e) => e.season === season - 1);
  let recent: Level;
  let recentText: string;
  if (thisSeason.some((e) => e.games > 0)) {
    const g = thisSeason.reduce((n, e) => n + e.games, 0);
    recent = "bad";
    recentText = `${plural(g, "game")} missed to injury in ${season}`;
  } else if (thisSeason.length) {
    recent = "mid";
    recentText = `${cap(thisSeason[0]!.type.toLowerCase())} in ${season}; played through`;
  } else if (lastSeason.length) {
    recent = "mid";
    const g = lastSeason.reduce((n, e) => n + e.games, 0);
    recentText = `${cap(lastSeason[0]!.type.toLowerCase())} in ${season - 1}${g ? `, ${plural(g, "game")} missed` : ", played through"}`;
  } else {
    recent = "good";
    recentText = t.latest ? `Last logged injury: ${t.latest.season}` : "No logged injuries";
  }
  out.push({ title: "Recent history", level: recent, evidence: recentText });

  // Career time lost.
  const per = seasonsPlayed > 0 ? t.games / seasonsPlayed : 0;
  const lost: Level = per > 3 ? "bad" : per >= 1.5 ? "mid" : "good";
  const peak = t.longest;
  out.push({
    title: "Career time lost",
    level: lost,
    evidence:
      `${plural(t.games, "game")} in ${plural(seasonsPlayed, "season")}` +
      (peak && peak.games > 0 && t.games > peak.games ? `, ${peak.games} of them in ${peak.season}` : ""),
  });

  // Injury concentration.
  const ratio = t.parts > 0 ? t.injuries / t.parts : 0;
  const conc: Level = ratio > 2 ? "bad" : ratio > 1.25 ? "mid" : "good";
  out.push({
    title: "Injury concentration",
    level: conc,
    evidence: `${plural(t.injuries, "injury", "injuries")} spread across ${plural(t.parts, "body part")}`,
  });

  return out;
}

const rank = (l: Level): number => (l === "bad" ? 2 : l === "mid" ? 1 : 0);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------------------------------------------------------------- body map */

export interface Marker {
  x: number;
  y: number;
  r: number;
  thru: boolean;
  title: string;
  sub: string;
  aria: string;
}

export interface MapLabel {
  marker: Marker;
  column: "left" | "right";
  y: number;
}

export interface BodyMap {
  markers: Marker[];
  labels: MapLabel[];
  /** Categories whose side is not recorded, for the caption. */
  sideless: string[];
  /** Entries the figure has nowhere to put ("Other"). */
  unplaced: string[];
}

const LABEL_GAP = 36;

/** Rough label width in viewBox units: 12px bold title, 11px regular line. */
export function labelWidth(title: string, sub: string): number {
  return Math.max(title.length * 6.9, sub.length * 5.5);
}
const Y_MIN = 30;
const Y_MAX = 390;

/** "2021, 2023" */
function yearList(years: number[]): string {
  return [...new Set(years)].sort((a, b) => a - b).join(", ");
}

export function bodyMap(events: InjuryEvent[]): BodyMap {
  interface Group {
    spot: string;
    side: Side;
    center: boolean;
    evs: InjuryEvent[];
  }
  const groups = new Map<string, Group>();
  const sideless = new Set<string>();
  const unplaced: string[] = [];

  for (const ev of events) {
    const cat = categoryOf(ev.category);
    if (!cat) {
      unplaced.push(ev.type);
      continue;
    }
    const spot = SPOTS[cat.spot]!;
    const center = Boolean(spot.center);
    if (!center && ev.side === null) sideless.add(cat.name);
    // Side not recorded: the player's left column (4.3).
    const side: Side = center ? null : ev.side ?? "L";
    const key = `${cat.spot}|${side ?? "c"}`;
    const g = groups.get(key) ?? { spot: cat.spot, side, center, evs: [] };
    g.evs.push(ev);
    groups.set(key, g);
  }

  const markers: Marker[] = [];
  for (const g of groups.values()) {
    const spot = SPOTS[g.spot]!;
    const [rx, ry, lx, ly] = spot.at as [number, number, number, number];
    const [x, y] = g.side === "L" ? [lx, ly] : [rx, ry];
    const games = g.evs.reduce((n, e) => n + e.games, 0);
    const thru = games === 0;
    const r = thru ? 8 : Math.min(8 + games, 16);
    const names = [...new Set(g.evs.map((e) => cap(shortName(e))))];
    const recorded = g.evs.some((e) => e.side !== null);
    const prefix = g.center || !recorded ? "" : g.side === "R" ? "R. " : "L. ";
    const count = g.evs.length > 1 ? ` ×${g.evs.length}` : "";
    const name = names.length === 1 ? (prefix ? `${prefix}${names[0]!.toLowerCase()}` : names[0]!) : names.join(" / ");
    const years = yearList(g.evs.map((e) => e.season));
    const outcome = thru ? "played thru" : `${games} game${games === 1 ? "" : "s"}`;
    const sub = g.evs.length > 1 && !thru ? `${years}: ${outcome}` : `${years}, ${outcome}`;
    const sideWord = g.center || !recorded ? "" : g.side === "R" ? "right " : "left ";
    const ariaOutcome = thru ? "played through" : `${games} game${games === 1 ? "" : "s"} missed`;
    markers.push({
      x,
      y,
      r,
      thru,
      title: `${name}${count}`,
      sub,
      aria: `${sideWord}${names.map((n) => n.toLowerCase()).join(" and ")} ${years}, ${ariaOutcome}`,
    });
  }

  // Draw big to small, so a small marker is never hidden under a big one.
  markers.sort((a, b) => b.r - a.r || a.y - b.y);

  // Labels: the viewer's left for markers left of centre, right for right;
  // centre markers go wherever there is more room.
  const left: Marker[] = [];
  const right: Marker[] = [];
  for (const m of [...markers].sort((a, b) => a.y - b.y)) {
    if (m.x < 150) left.push(m);
    else if (m.x > 150) right.push(m);
  }
  for (const m of [...markers].filter((m) => m.x === 150).sort((a, b) => a.y - b.y)) {
    (left.length <= right.length ? left : right).push(m);
  }
  const place = (col: Marker[], column: "left" | "right"): MapLabel[] => {
    // A label as wide as the gap to its marker would run under it (a hand
    // marker sits 89px in): that one goes below its marker instead.
    const want = (m: Marker): number => {
      const w = labelWidth(m.title, m.sub);
      const clash = column === "left" ? 8 + w > m.x - m.r - 4 : 292 - w < m.x + m.r + 4;
      return clash ? m.y + m.r + 16 : m.y;
    };
    const sorted = [...col].sort((a, b) => want(a) - want(b));
    const ys = sorted.map((m) => Math.min(Math.max(want(m), Y_MIN), Y_MAX));
    for (let i = 1; i < ys.length; i += 1) ys[i] = Math.max(ys[i]!, ys[i - 1]! + LABEL_GAP);
    // Pushed off the bottom: walk back up.
    if (ys.length && ys[ys.length - 1]! > Y_MAX) {
      ys[ys.length - 1] = Y_MAX;
      for (let i = ys.length - 2; i >= 0; i -= 1) ys[i] = Math.min(ys[i]!, ys[i + 1]! - LABEL_GAP);
    }
    return sorted.map((marker, i) => ({ marker, column, y: Math.max(ys[i]!, Y_MIN) }));
  };

  return {
    markers,
    labels: [...place(left, "left"), ...place(right, "right")],
    sideless: [...sideless].map((n) => SHORT[n]?.toLowerCase() ?? n.toLowerCase()),
    unplaced,
  };
}

/* ------------------------------------------------------------- the clubs */

/** His club at a week of a season, off the game logs. */
export function clubAt(playerId: string, season: number, week: number | null): string | null {
  const log = [...(loadGameLogs(season)[playerId] ?? [])]
    .filter((e) => e.team)
    .sort((a, b) => a.week - b.week);
  if (log.length === 0) return null;
  const at =
    week && week > 0
      ? [...log].reverse().find((e) => e.week <= week) ?? log[0]
      : log[0];
  const code = at?.team ?? null;
  return code ? getTeamByAbbreviation(code)?.code ?? code.toUpperCase() : null;
}

/* ---------------------------------------------------------------- practice */

export type PracticeValue = "FULL" | "LIMITED" | "DNP" | "NONE";

interface StoredRow {
  name: string;
  pos: string;
  injury: string | null;
  gameStatus: string | null;
  final: string;
  days: Record<string, string>;
}

interface PracticeDoc {
  season: number;
  source: string;
  updatedAt: string | null;
  weeks: Record<string, { fetchedAt: string; url: string; teams: Record<string, Record<string, StoredRow>> }>;
}

let practiceCache: { season: number; mtimeMs: number; doc: PracticeDoc | null } | null = null;

function practiceFile(season: number): string {
  return path.join(dataPath("player"), "practice_reports", `${season}.json`);
}

export function loadPracticeReports(season: number): PracticeDoc | null {
  const file = practiceFile(season);
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
  if (practiceCache && practiceCache.season === season && practiceCache.mtimeMs === mtimeMs) {
    return practiceCache.doc;
  }
  let doc: PracticeDoc | null = null;
  try {
    doc = JSON.parse(fs.readFileSync(file, "utf8")) as PracticeDoc;
  } catch {
    doc = null;
  }
  practiceCache = { season, mtimeMs, doc };
  return doc;
}

/** For the render cache key: the file moves whenever a report is filed. */
export function practiceStamp(season: number): string {
  try {
    const st = fs.statSync(practiceFile(season));
    return `${Math.round(st.mtimeMs)}.${st.size}`;
  } catch {
    return "0";
  }
}

const fold = (s: string): string =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z]/g, "");

export interface ReportRow {
  week: number;
  injury: string | null;
  gameStatus: string | null;
  final: string;
  days: Record<string, string>;
}

/** His row on each week's report, matched on club and name. */
export function reportRows(doc: PracticeDoc | null, teamCode: string | null, name: string): ReportRow[] {
  if (!doc || !teamCode) return [];
  const want = fold(name);
  const out: ReportRow[] = [];
  for (const [wk, week] of Object.entries(doc.weeks ?? {})) {
    for (const [club, players] of Object.entries(week.teams ?? {})) {
      if (normalizeTeamName(club)?.code !== teamCode) continue;
      for (const row of Object.values(players)) {
        if (fold(row.name) !== want) continue;
        out.push({ week: Number(wk), injury: row.injury, gameStatus: row.gameStatus, final: row.final, days: row.days ?? {} });
      }
    }
  }
  return out.sort((a, b) => b.week - a.week);
}

const DAY_MS = 86_400_000;
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * The three report days before a game, from its Eastern date: Wed/Thu/Fri for
 * Sunday, Mon/Tue/Wed for Thursday, Thu/Fri/Sat for Monday, and the three days
 * before for a Saturday or Friday game.
 */
export function practiceDays(gameDate: string): Array<{ date: string; day: string }> {
  const game = Date.parse(`${gameDate}T12:00:00Z`);
  const dow = new Date(game).getUTCDay();
  const back = dow === 0 || dow === 1 ? [4, 3, 2] : [3, 2, 1];
  return back.map((n) => {
    const d = new Date(game - n * DAY_MS);
    return { date: d.toISOString().slice(0, 10), day: WEEKDAY[d.getUTCDay()]! };
  });
}

export function parseValue(raw: string | undefined): { value: PracticeValue; estimated: boolean } | null {
  if (!raw) return null;
  const estimated = raw.endsWith("*");
  const v = raw.replace("*", "") as PracticeValue;
  if (!["FULL", "LIMITED", "DNP", "NONE"].includes(v)) return null;
  return { value: v, estimated };
}

/** "What it means" (4.1), from the days reported so far. */
export function practiceRead(values: PracticeValue[], injury: string | null, veteran: boolean): string | null {
  const seen = values.filter((v) => v !== "NONE");
  if (seen.length === 0) return null;
  const first = seen[0]!;
  const last = seen[seen.length - 1]!;
  if (seen.every((v) => v === "DNP")) {
    if (!injury && veteran && seen.length === 1) return "A veteran's rest day with no injury listed, not a concern.";
    return "Didn't practice all week so far: unlikely to play.";
  }
  if (first === "FULL") return "A full practice to open the week is the lowest-concern signal on an injury report.";
  if (seen.every((v) => v === "LIMITED")) return "Limited all week: a game-time decision, so have a backup plan.";
  if (first === "LIMITED" && last === "FULL") return "Limited, then full: trending toward playing.";
  if (first === "DNP" && (last === "LIMITED" || last === "FULL")) return "Improving from a missed practice, but still uncertain.";
  return null;
}

export { OTHER as OTHER_CATEGORY };
