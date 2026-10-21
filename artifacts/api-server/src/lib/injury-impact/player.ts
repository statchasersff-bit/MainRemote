/**
 * The per-player panel's model: the injury risk profile (body regions and
 * the body map), the career timeline over the team's schedule, the weekly
 * report table and the play-by-play log. Ported from the app's
 * InjuryRiskProfile.tsx, SeasonTimeline.tsx, PlayerInjuryDialog.tsx and
 * lib/injuryApi.ts (c6a49ce). Pure: shared by the server and the bundle.
 */

import type { InGameInjuryEvent, InjuryRow, PlayerSearchResult, ScheduleMap, SchedGame, SeasonInjury } from "./types";

/* ------------------------------------------------------------- the search */

/** Shortest query worth matching; 1 char returns thousands of players. */
export const MIN_SEARCH_LEN = 2;
const SEARCH_LIMIT = 20;

/** One packed row of search-index.json: id, name, position, team, first season, last season, reports. */
export type PackedSearchRow = [string, string, string | null, string | null, number | null, number | null, number];

export function unpackSearchRow(r: PackedSearchRow): PlayerSearchResult {
  const seasons: number[] = [];
  if (r[4] != null) seasons.push(r[4]);
  if (r[5] != null && r[5] !== r[4]) seasons.push(r[5]);
  return { gsisId: r[0], fullName: r[1], position: r[2], team: r[3], seasons, reportCount: r[6] };
}

/** Name-prefix matches first, then most recently seen, then alphabetical. */
export function searchPlayers(index: PackedSearchRow[], query: string): PlayerSearchResult[] {
  const q = query.trim().toLowerCase();
  if (q.length < MIN_SEARCH_LEN) return [];
  return index
    .filter((p) => p[1].toLowerCase().includes(q))
    .map(unpackSearchRow)
    .sort((a, b) => {
      const ap = a.fullName.toLowerCase().startsWith(q) ? 0 : 1;
      const bp = b.fullName.toLowerCase().startsWith(q) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      const aLast = a.seasons[a.seasons.length - 1] ?? 0;
      const bLast = b.seasons[b.seasons.length - 1] ?? 0;
      if (bLast !== aLast) return bLast - aLast;
      return a.fullName.localeCompare(b.fullName);
    })
    .slice(0, SEARCH_LIMIT);
}

/** "2018-2024" (or "2021") for a search row. */
export function seasonSpan(seasons: number[]): string {
  if (seasons.length === 0) return "";
  const first = seasons[0] as number;
  const last = seasons[seasons.length - 1] as number;
  return first === last ? `${first}` : `${first}-${last}`;
}

/* --------------------------------------------------------------- phrases */

/**
 * "Primary · Secondary", falling back from the official report injury to the
 * practice-report injury, deduplicated when both name the same.
 */
export function injuryLabel(row: Pick<InjuryRow, "reportPrimaryInjury" | "reportSecondaryInjury" | "practicePrimaryInjury" | "practiceSecondaryInjury">): string {
  const parts = [row.reportPrimaryInjury ?? row.practicePrimaryInjury, row.reportSecondaryInjury ?? row.practiceSecondaryInjury].filter((x): x is string => Boolean(x));
  const seen = new Set<string>();
  return parts
    .filter((p) => {
      const k = p.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .join(" · ");
}

/** The status chip's tone: out, doubtful, questionable, other. */
export function statusTone(status: string | null): "out" | "doubtful" | "questionable" | "other" {
  switch ((status ?? "").toLowerCase()) {
    case "out":
      return "out";
    case "doubtful":
      return "doubtful";
    case "questionable":
      return "questionable";
    default:
      return "other";
  }
}

export function formatInjury(s: string): string {
  return s.replace(/_/g, " ");
}

/* ----------------------------------------------------------- body regions */

export type Shape = { t: "ellipse"; cx: number; cy: number; rx: number; ry: number } | { t: "rect"; x: number; y: number; w: number; h: number; rx: number };

export interface Region {
  key: string;
  label: string;
  keywords: string[];
  shapes: Shape[];
}

/** Front-facing mannequin, viewBox 0 0 200 430. Paired limbs share one region. */
export const REGIONS: Region[] = [
  { key: "head", label: "Head", keywords: ["head", "concussion", "face", "jaw", "eye", "nose", "skull", "chin"], shapes: [{ t: "ellipse", cx: 100, cy: 28, rx: 19, ry: 23 }] },
  { key: "neck", label: "Neck", keywords: ["neck", "stinger", "cervical", "throat"], shapes: [{ t: "rect", x: 91, y: 49, w: 18, h: 13, rx: 4 }] },
  {
    key: "shoulder",
    label: "Shoulder",
    keywords: ["shoulder", "clavicle", "collarbone", "ac joint", "rotator", "labrum", "trapezius", "trap"],
    shapes: [
      { t: "ellipse", cx: 69, cy: 76, rx: 15, ry: 13 },
      { t: "ellipse", cx: 131, cy: 76, rx: 15, ry: 13 },
    ],
  },
  { key: "chest", label: "Chest / Ribs", keywords: ["chest", "pectoral", "sternum", "rib", "ribs", "lung"], shapes: [{ t: "rect", x: 74, y: 66, w: 52, h: 40, rx: 10 }] },
  {
    key: "core",
    label: "Core / Back",
    keywords: ["back", "spine", "lumbar", "disc", "abdomen", "abdominal", "core", "oblique", "kidney", "stomach", "hernia", "tailbone", "coccyx", "buttock"],
    shapes: [{ t: "rect", x: 77, y: 104, w: 46, h: 42, rx: 10 }],
  },
  {
    key: "arm",
    label: "Arm / Elbow",
    keywords: ["arm", "bicep", "tricep", "elbow", "forearm"],
    shapes: [
      { t: "rect", x: 52, y: 82, w: 15, h: 46, rx: 7 },
      { t: "rect", x: 133, y: 82, w: 15, h: 46, rx: 7 },
      { t: "rect", x: 49, y: 128, w: 14, h: 46, rx: 7 },
      { t: "rect", x: 137, y: 128, w: 14, h: 46, rx: 7 },
    ],
  },
  {
    key: "hand",
    label: "Hand / Wrist",
    keywords: ["hand", "wrist", "finger", "thumb"],
    shapes: [
      { t: "ellipse", cx: 55, cy: 182, rx: 8, ry: 11 },
      { t: "ellipse", cx: 145, cy: 182, rx: 8, ry: 11 },
    ],
  },
  { key: "hip", label: "Hip / Groin", keywords: ["hip", "groin", "pelvis", "adductor", "glute", "flexor"], shapes: [{ t: "rect", x: 79, y: 144, w: 42, h: 28, rx: 10 }] },
  {
    key: "thigh",
    label: "Thigh",
    keywords: ["thigh", "hamstring", "quad", "quadriceps", "femur"],
    shapes: [
      { t: "rect", x: 80, y: 170, w: 18, h: 68, rx: 9 },
      { t: "rect", x: 102, y: 170, w: 18, h: 68, rx: 9 },
    ],
  },
  {
    key: "knee",
    label: "Knee",
    keywords: ["knee", "acl", "mcl", "pcl", "lcl", "meniscus", "patella"],
    shapes: [
      { t: "ellipse", cx: 89, cy: 244, rx: 10, ry: 9 },
      { t: "ellipse", cx: 111, cy: 244, rx: 10, ry: 9 },
    ],
  },
  {
    key: "calf",
    label: "Calf / Shin",
    keywords: ["calf", "shin", "achilles", "tibia", "fibula", "lower leg"],
    shapes: [
      { t: "rect", x: 81, y: 252, w: 16, h: 66, rx: 8 },
      { t: "rect", x: 103, y: 252, w: 16, h: 66, rx: 8 },
    ],
  },
  {
    key: "ankle",
    label: "Ankle",
    keywords: ["ankle"],
    shapes: [
      { t: "ellipse", cx: 89, cy: 324, rx: 8, ry: 7 },
      { t: "ellipse", cx: 111, cy: 324, rx: 8, ry: 7 },
    ],
  },
  {
    key: "foot",
    label: "Foot / Toe",
    keywords: ["foot", "feet", "toe", "heel", "plantar", "midfoot", "lisfranc", "metatarsal", "arch"],
    shapes: [
      { t: "rect", x: 81, y: 332, w: 16, h: 14, rx: 6 },
      { t: "rect", x: 103, y: 332, w: 16, h: 14, rx: 6 },
    ],
  },
];

/** Every body region an injury phrase names; [] when nothing localizable matches. */
export function classify(phrase: string): string[] {
  const p = phrase.toLowerCase();
  const keys: string[] = [];
  for (const r of REGIONS) {
    if (r.keywords.some((kw) => p.includes(kw))) keys.push(r.key);
  }
  return keys;
}

export const NEUTRAL_COLOR = { fill: "#e5e7eb", stroke: "#cbd5e1" };

/** Shade by severity (games the region cost), not report frequency. */
export function severityColor(gamesMissed: number, severe: boolean): { fill: string; stroke: string } {
  if (severe) return { fill: "#ef4444", stroke: "#b91c1c" };
  if (gamesMissed <= 0) return { fill: "#fde9c8", stroke: "#f2c99a" };
  if (gamesMissed <= 2) return { fill: "#fbbf24", stroke: "#d97706" };
  if (gamesMissed <= 5) return { fill: "#fb923c", stroke: "#ea580c" };
  return { fill: "#ef4444", stroke: "#b91c1c" };
}

export interface NotableInjury {
  injury: string;
  season: number;
  gamesMissed: number;
  seasonEnding: boolean;
}

export interface RegionStat {
  count: number;
  gamesMissed: number;
  labels: Map<string, { count: number; season: number | null; week: number | null }>;
  severe: boolean;
  notable: NotableInjury[];
}

export interface LastInjury {
  label: string;
  season: number | null;
  week: number | null;
  seasonEnding?: boolean;
}

export interface RiskModel {
  perRegion: Map<string, RegionStat>;
  maxCount: number;
  regionsAffected: number;
  seasonsAffected: number;
  weeksOut: number;
  lastInjury: LastInjury | null;
  gamesMissed: number | null;
  seasonEnding: number | null;
  unlocalized: number;
}

export function riskModel(rows: InjuryRow[], impacts: SeasonInjury[] | undefined): RiskModel {
  const perRegion = new Map<string, RegionStat>();
  let unlocalized = 0;
  const seenSeasonRegion = new Set<string>();
  const outWeeksSeen = new Set<string>();
  const outBySeasonRegion = new Map<string, number>();
  const blank = (): RegionStat => ({ count: 0, gamesMissed: 0, labels: new Map(), severe: false, notable: [] });

  for (const row of rows) {
    const phrases = [row.reportPrimaryInjury ?? row.practicePrimaryInjury, row.reportSecondaryInjury ?? row.practiceSecondaryInjury].filter((x): x is string => Boolean(x));
    for (const phrase of phrases) {
      const keys = classify(phrase);
      if (keys.length === 0) {
        unlocalized += 1;
        continue;
      }
      for (const key of keys) {
        let stat = perRegion.get(key);
        if (!stat) {
          stat = blank();
          perRegion.set(key, stat);
        }
        stat.count += 1;
        const existing = stat.labels.get(phrase);
        if (existing) existing.count += 1;
        else stat.labels.set(phrase, { count: 1, season: row.season, week: row.week });
        if (row.season != null) seenSeasonRegion.add(`${row.season}|${key}`);
        if (row.season != null && row.week != null && (row.reportStatus ?? "").toLowerCase() === "out") {
          const owk = `${row.season}|${row.week}|${key}`;
          if (!outWeeksSeen.has(owk)) {
            outWeeksSeen.add(owk);
            const srk = `${row.season}|${key}`;
            outBySeasonRegion.set(srk, (outBySeasonRegion.get(srk) ?? 0) + 1);
          }
        }
      }
    }
  }

  const addedImpact = new Set<string>();
  const impactCovered = new Set<string>();
  for (const im of impacts ?? []) {
    for (const key of classify(im.injury)) {
      let stat = perRegion.get(key);
      if (!stat) {
        stat = blank();
        perRegion.set(key, stat);
      }
      const sk = `${im.season}|${key}`;
      if (!seenSeasonRegion.has(sk) && !addedImpact.has(sk)) {
        addedImpact.add(sk);
        stat.count += 1;
      }
      if (im.season_ending) stat.severe = true;
      stat.gamesMissed += im.games_missed || 0;
      impactCovered.add(sk);
      stat.notable.push({ injury: formatInjury(im.injury), season: im.season, gamesMissed: im.games_missed, seasonEnding: im.season_ending });
      const label = formatInjury(im.injury);
      const cur = stat.labels.get(label);
      if (!cur) stat.labels.set(label, { count: 1, season: im.season, week: im.week_of_injury || null });
      else if ((im.season ?? 0) > (cur.season ?? 0)) {
        cur.season = im.season;
        cur.week = im.week_of_injury || null;
      }
    }
  }
  for (const [srk, cnt] of outBySeasonRegion) {
    if (impactCovered.has(srk)) continue;
    const region = srk.slice(srk.indexOf("|") + 1);
    const stat = perRegion.get(region);
    if (stat) stat.gamesMissed += cnt;
  }
  for (const stat of perRegion.values()) stat.notable.sort((a, b) => b.season - a.season);

  const maxCount = Math.max(0, ...Array.from(perRegion.values()).map((s) => s.count));
  const regionsAffected = perRegion.size;
  const seasonsAffected = new Set<number>([...rows.map((r) => r.season).filter((s): s is number => s != null), ...(impacts ?? []).map((i) => i.season)]).size;
  const weeksOut = rows.filter((r) => (r.reportStatus ?? "").toLowerCase() === "out").length;

  let lastInjury: LastInjury | null = null;
  const rank = (s: number | null, w: number | null) => (s ?? 0) * 100 + (w ?? 0);
  for (const row of rows) {
    const label = injuryLabel(row);
    if (label) {
      lastInjury = { label, season: row.season, week: row.week };
      break;
    }
  }
  for (const im of impacts ?? []) {
    const cand: LastInjury = { label: formatInjury(im.injury), season: im.season, week: im.week_of_injury || null, seasonEnding: im.season_ending };
    if (!lastInjury || rank(cand.season, cand.week) > rank(lastInjury.season, lastInjury.week)) lastInjury = cand;
  }

  const gamesMissed = impacts && impacts.length ? impacts.reduce((sum, i) => sum + (i.games_missed || 0), 0) : null;
  const seasonEnding = impacts && impacts.length ? impacts.filter((i) => i.season_ending).length : null;

  return { perRegion, maxCount, regionsAffected, seasonsAffected, weeksOut, lastInjury, gamesMissed, seasonEnding, unlocalized };
}

/** Affected-region chips, most impactful first. */
export function regionChips(m: RiskModel): { region: Region; stat: RegionStat }[] {
  return Array.from(m.perRegion.entries())
    .map(([key, stat]) => ({ region: REGIONS.find((r) => r.key === key) as Region, stat }))
    .filter((c) => c.region)
    .sort((a, b) => Number(b.stat.severe) - Number(a.stat.severe) || b.stat.gamesMissed - a.stat.gamesMissed || b.stat.count - a.stat.count);
}

/* --------------------------------------------------------------- timeline */

/** Era/source codes to modern franchise codes, so a team lines up with the schedule keys. */
export const TEAM_NORM: Record<string, string> = {
  ARZ: "ARI",
  BLT: "BAL",
  CLV: "CLE",
  HST: "HOU",
  SL: "LA",
  STL: "LA",
  LAR: "LA",
  SD: "LAC",
  SDG: "LAC",
  OAK: "LV",
  LVR: "LV",
  JAC: "JAX",
  WSH: "WAS",
  GNB: "GB",
  KAN: "KC",
  NWE: "NE",
  NOR: "NO",
  SFO: "SF",
  TAM: "TB",
};
export const normTeam = (t: string | null | undefined): string => (t ? (TEAM_NORM[t] ?? t) : "");

const ROUND_LABEL: Record<string, string> = { WC: "WC", DIV: "DIV", CON: "CON", SB: "SB" };

export interface TimelineCell {
  week: number;
  label: string;
  bye: boolean;
  playoff: boolean;
  game?: SchedGame;
  missed: boolean;
  onset: boolean;
  status: string | null;
  injury: string | null;
  onsetInjury: string | null;
}

export interface TimelineSeason {
  season: number;
  team: string;
  cells: TimelineCell[];
  gamesMissed: number;
  onsetInjuries: string[];
}

/**
 * `audited` is the season in progress and the last week its episodes were
 * audited through (current.json's through_week): a week listed Out after it is
 * a missed game the audit has not counted yet, and is drawn as one.
 */
export function timelineModel(rows: InjuryRow[], impacts: SeasonInjury[] | undefined, schedule: ScheduleMap | null, audited: { season: number; week: number } | null = null): TimelineSeason[] {
  const rowsBySeason = new Map<number, InjuryRow[]>();
  for (const r of rows) {
    if (r.season == null) continue;
    const list = rowsBySeason.get(r.season) ?? [];
    list.push(r);
    rowsBySeason.set(r.season, list);
  }
  const impactsBySeason = new Map<number, SeasonInjury[]>();
  for (const im of impacts ?? []) {
    const list = impactsBySeason.get(im.season) ?? [];
    list.push(im);
    impactsBySeason.set(im.season, list);
  }
  const allSeasons = Array.from(new Set([...rowsBySeason.keys(), ...impactsBySeason.keys()])).sort((a, b) => b - a);

  const out: TimelineSeason[] = [];
  for (const season of allSeasons) {
    const sRows = rowsBySeason.get(season) ?? [];
    const sImpacts = impactsBySeason.get(season) ?? [];

    let team = normTeam(sImpacts[0]?.team);
    if (!team) {
      const counts = new Map<string, number>();
      for (const r of sRows) {
        const t = normTeam(r.team);
        if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
      }
      team = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    }

    const games = schedule?.[String(season)]?.[team] ?? null;
    const regGames = games?.filter((g) => g.t === "REG") ?? [];
    const playoffGames = games?.filter((g) => g.t !== "REG").sort((a, b) => a.w - b.w) ?? [];
    const maxRegWeek = regGames.length ? Math.max(...regGames.map((g) => g.w)) : season >= 2021 ? 18 : 17;
    const gameByWeek = new Map<number, SchedGame>();
    for (const g of games ?? []) gameByWeek.set(g.w, g);

    const missed = new Set<number>();
    const onset = new Set<number>();
    const onsetInjuryByWeek = new Map<number, string>();

    for (const im of sImpacts) {
      const w = im.week_of_injury;
      if (w && w >= 1) {
        onset.add(w);
        onsetInjuryByWeek.set(
          w,
          `${formatInjury(im.injury)} · ${im.games_missed} game${im.games_missed === 1 ? "" : "s"} missed${im.ongoing ? " so far (still out)" : ""}${im.season_ending ? " (season-ending)" : ""}`,
        );
        if (im.games_missed > 0) {
          if (games && games.length) {
            let count = 0;
            for (const g of games) {
              if (g.w >= w && count < im.games_missed) {
                missed.add(g.w);
                count += 1;
              }
            }
          } else {
            for (let k = 0; k < im.games_missed; k += 1) missed.add(w + k);
          }
        }
      }
    }
    if (sImpacts.length === 0) {
      for (const r of sRows) {
        if (r.week != null && (r.reportStatus ?? "").toLowerCase() === "out") missed.add(r.week);
      }
    } else if (audited && season === audited.season) {
      const late = sRows
        .filter((r): r is InjuryRow & { week: number } => r.week != null && r.week > audited.week && (r.reportStatus ?? "").toLowerCase() === "out")
        .sort((a, b) => a.week - b.week);
      for (const r of late) missed.add(r.week);
      // A new absence after the audit is its own onset; a still-out episode just runs on.
      const first = late[0];
      if (first && !sImpacts.some((im) => im.ongoing) && !onset.has(first.week)) {
        onset.add(first.week);
        onsetInjuryByWeek.set(first.week, `${injuryLabel(first) || "Injury"} · listed Out (not yet audited)`);
      }
    }
    if (onset.size === 0 && missed.size > 0) onset.add(Math.min(...missed));

    const rowByWeek = new Map<number, InjuryRow>();
    for (const r of sRows) if (r.week != null && !rowByWeek.has(r.week)) rowByWeek.set(r.week, r);

    const buildCell = (week: number, playoff: boolean): TimelineCell => {
      const game = gameByWeek.get(week);
      const bye = !playoff && !game;
      const r = rowByWeek.get(week);
      const cell: TimelineCell = {
        week,
        label: playoff ? (ROUND_LABEL[game?.t ?? ""] ?? String(week)) : String(week),
        bye,
        playoff,
        missed: missed.has(week),
        onset: onset.has(week),
        status: r?.reportStatus ?? null,
        injury: r ? injuryLabel(r) || null : null,
        onsetInjury: onsetInjuryByWeek.get(week) ?? null,
      };
      if (game) cell.game = game;
      return cell;
    };

    const cells: TimelineCell[] = [];
    for (let w = 1; w <= maxRegWeek; w += 1) cells.push(buildCell(w, false));
    for (const g of playoffGames) cells.push(buildCell(g.w, true));

    const gamesMissed = cells.filter((c) => c.missed && (c.game || c.playoff)).length;
    out.push({ season, team, cells, gamesMissed, onsetInjuries: [...onsetInjuryByWeek.values()] });
  }
  return out;
}

/* --------------------------------------------------------- weekly + plays */

export function formatUpdated(dateModified: string | null): string | null {
  if (!dateModified) return null;
  const d = new Date(dateModified);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** "Q3" for regulation quarters, "OT" for the 5th period. */
export function quarterLabel(qtr: number | null): string {
  if (qtr == null) return "";
  return qtr >= 5 ? "OT" : `Q${qtr}`;
}

/** "Jan 17, 2021 · Divisional": game date plus a week or round label. */
export function gameContext(e: InGameInjuryEvent): string {
  let when = "";
  if (e.date) {
    const d = new Date(e.date);
    if (!Number.isNaN(d.getTime())) when = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  }
  const round =
    e.seasonType === "POST"
      ? (({ 18: "Wild Card", 19: "Divisional", 20: "Conf. Championship", 22: "Super Bowl" } as Record<number, string>)[e.week ?? 0] ?? "Playoffs")
      : e.week != null
        ? `Week ${e.week}`
        : "";
  return [when, round].filter(Boolean).join(" · ");
}

export function countStatus(rows: InjuryRow[], status: string): number {
  return rows.filter((r) => (r.reportStatus ?? "").toLowerCase() === status).length;
}

/** Up to two initials from a player's name, for the no-photo fallback. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1] as string)[0] ?? "" : "";
  return (first + last).toUpperCase();
}
