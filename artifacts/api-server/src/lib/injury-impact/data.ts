/**
 * The injury impact datasets, read: data/injury-impact/, written by
 * scripts/injury-impact/buildData.mjs from the standalone app's pipeline
 * output. Static research: it moves when the app's pipeline is re-run and the
 * output re-packed, so files are re-read when they change and never fetched.
 *
 * Three readers: the dashboard dataset for the server render and the
 * bundle's one analysis slice; the packed search index; and one player's
 * slice, which joins the weekly reports and in-game events from the player's
 * shard with the impact seasons, the current season and the schedule for the
 * seasons they appear in. The history shards (12.9 MB over 100 files) are
 * never all in memory: an LRU keeps the few most recently asked for.
 */

import fs from "node:fs";
import path from "node:path";
import { dataPath } from "../data-dir";
import { LruCache } from "../lru";
import type { PackedSearchRow } from "./player";
import { hydrate, type Durability, type GridironDataset, type StudyIndex } from "./durability";
import { searchPlayers, unpackSearchRow } from "./player";
import type {
  CurrentInjuryFile,
  DraftSimData,
  ExposureEntry,
  InGameInjuryEvent,
  InjuryDataset,
  InjuryImpactData,
  InjuryRegression,
  InjuryRow,
  PanelRow,
  PlayerSlice,
  PostReturnData,
  ScheduleMap,
  SeasonInjury,
  TagImpactData,
} from "./types";

export function injuryDataDir(): string {
  return dataPath("injury-impact");
}

/** Short, stable, non-cryptographic - this only has to differ, not resist. */
function hash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i += 1) {
    h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

const TOP_FILES = ["analysis.json", "current.json", "exposure.json", "regression.json", "panel.json", "post-return.json", "tag-impact.json", "draft-sim.json", "search-index.json", "schedule.json", "sleeper-ids.json", "gridiron.json", "corrections.json"];

/* ------------------------------------------------------------ corrections */

/** One entry of data/injury-impact/corrections.json: a body part the imported data got wrong or left Undisclosed. */
export interface InjuryCorrection {
  gsisId: string;
  player?: string;
  season: number;
  /** The week of injury, when the season has more than one event. */
  week?: number;
  bodyPart: string;
  type: "soft" | "structural" | "head" | "other";
  side?: string;
  why?: string;
}

const WEEK_OF = /from week (\d+)|out week (\d+)/;

/** "Left heel" for the label; the bare part when no side is named. */
const sidedLabel = (c: InjuryCorrection): string => (c.side ? `${c.side} ${c.bodyPart.toLowerCase()}` : c.bodyPart);

/**
 * Apply the corrections to the durability dataset (the inj tuples: label,
 * body part, type and side), the current-season rows and the impact seasons,
 * in place. The games, severity, re-injury flag and timing are the data's.
 */
export function applyCorrections(corrections: InjuryCorrection[], gridiron: GridironDataset | null, current: CurrentInjuryFile | null, analysis: InjuryImpactData | null): void {
  for (const c of corrections) {
    const sameEvent = (season: number, week: number | null | undefined) => season === c.season && (c.week == null || week == null || week === c.week);
    if (gridiron) {
      const p = gridiron.players.find((x) => x.id === c.gsisId);
      for (const t of p?.inj ?? []) {
        const label = String(t[1] ?? "");
        const m = WEEK_OF.exec(label);
        if (!sameEvent(Number(t[0]), m ? Number(m[1] ?? m[2]) : null)) continue;
        const dash = label.indexOf(" — ");
        t[1] = dash >= 0 ? `${sidedLabel(c)}${label.slice(dash)}` : label;
        t[2] = c.bodyPart;
        t[5] = c.type;
        t[7] = c.side ?? "";
      }
    }
    for (const r of current?.rows ?? []) {
      if (r.gsis_id === c.gsisId && sameEvent(r.season, r.week_of_injury)) r.injury = c.bodyPart;
    }
    for (const r of analysis?.player_injury_impacts ?? []) {
      if (r.gsis_id === c.gsisId && sameEvent(r.season, r.week_of_injury)) r.injury = c.bodyPart;
    }
  }
}

/** A fingerprint of the directory: every top-level file's size and mtime. */
function stampOf(dir: string): string {
  return TOP_FILES.map((rel) => {
    try {
      const s = fs.statSync(path.join(dir, rel));
      return `${rel}:${s.size}:${s.mtimeMs}`;
    } catch {
      return `${rel}:-`;
    }
  }).join("|");
}

interface Memo {
  stamp: string;
  version: string;
  dataset: InjuryDataset | null;
  /** The durability dataset (gridiron.json), raw for the bundle and hydrated for the server. */
  gridiron: GridironDataset | null;
  durability: Durability | null;
  index: PackedSearchRow[];
  schedule: ScheduleMap;
  sleeper: Record<string, string>;
  /** GSIS id -> this player's impact seasons, for the player slice. */
  impactsById: Map<string, SeasonInjury[]>;
  currentById: Map<string, SeasonInjury[]>;
  indexById: Map<string, PackedSearchRow>;
}

let memo: Memo | null = null;

function read(): Memo {
  const dir = injuryDataDir();
  const stamp = stampOf(dir);
  if (memo && memo.stamp === stamp) return memo;
  shardCache.clear();

  const analysis = readJson<InjuryImpactData>(path.join(dir, "analysis.json"));
  const corrections = readJson<{ entries: InjuryCorrection[] }>(path.join(dir, "corrections.json"))?.entries ?? [];
  const empty: Memo = { stamp, version: "empty", dataset: null, gridiron: null, durability: null, index: [], schedule: {}, sleeper: {}, impactsById: new Map(), currentById: new Map(), indexById: new Map() };
  if (!analysis || !Array.isArray(analysis.player_injury_impacts) || !analysis.meta) return (memo = empty);

  const panelPacked = readJson<{ keys: string[]; rows: unknown[][] }>(path.join(dir, "panel.json"));
  const panel: PanelRow[] | null = panelPacked ? panelPacked.rows.map((r) => Object.fromEntries(panelPacked.keys.map((k, i) => [k, r[i]])) as unknown as PanelRow) : null;
  const current = readJson<CurrentInjuryFile>(path.join(dir, "current.json"));
  const dataset: InjuryDataset = {
    analysis,
    exposure: readJson<ExposureEntry[]>(path.join(dir, "exposure.json")),
    regression: readJson<InjuryRegression>(path.join(dir, "regression.json")),
    panel,
    postReturn: readJson<PostReturnData>(path.join(dir, "post-return.json")),
    tagImpact: readJson<TagImpactData>(path.join(dir, "tag-impact.json")),
    draftSim: readJson<DraftSimData>(path.join(dir, "draft-sim.json")),
    current: current && Array.isArray(current.rows) ? current : null,
  };

  const schedule = readJson<ScheduleMap>(path.join(dir, "schedule.json")) ?? {};
  const gridironRaw = readJson<GridironDataset>(path.join(dir, "gridiron.json"));
  const gridiron = gridironRaw && Array.isArray(gridironRaw.years) && gridironRaw.years.length && Array.isArray(gridironRaw.players) && gridironRaw.players.length ? gridironRaw : null;
  // The season in progress's bye weeks ride with the dataset, so the bundle's
  // hydrate projects the same returns as the server's.
  if (gridiron && gridiron.current) gridiron.byes = byeWeeks(schedule[String(gridiron.current.season)]);
  // The study's draft cost and impact labels ride with it too, for the Injury database's columns.
  if (gridiron) gridiron.study = studyIndex(analysis, current && Array.isArray(current.rows) ? current : null);
  // Local fixes to the imported data, before the index maps and the hydrate read it.
  applyCorrections(corrections, gridiron, dataset.current, analysis);

  const impactsById = new Map<string, SeasonInjury[]>();
  for (const p of analysis.player_injury_impacts) {
    if (!p.gsis_id) continue;
    const list = impactsById.get(p.gsis_id) ?? [];
    list.push({ season: p.season, team: p.team, injury: p.injury, week_of_injury: p.week_of_injury, games_missed: p.games_missed, season_ending: p.season_ending });
    impactsById.set(p.gsis_id, list);
  }
  const currentById = new Map<string, SeasonInjury[]>();
  for (const c of dataset.current?.rows ?? []) {
    const list = currentById.get(c.gsis_id) ?? [];
    list.push({ season: c.season, team: c.team, injury: c.injury, week_of_injury: c.week_of_injury, games_missed: c.games_missed, season_ending: c.season_ending, ...(c.ongoing ? { ongoing: true } : {}) });
    currentById.set(c.gsis_id, list);
  }
  const index = readJson<PackedSearchRow[]>(path.join(dir, "search-index.json")) ?? [];
  const indexById = new Map(index.map((r) => [r[0], r] as const));

  return (memo = {
    stamp,
    version: hash(stamp),
    dataset,
    gridiron,
    durability: gridiron ? hydrate(gridiron) : null,
    index,
    schedule,
    sleeper: readJson<Record<string, string>>(path.join(dir, "sleeper-ids.json")) ?? {},
    impactsById,
    currentById,
    indexById,
  });
}

/**
 * The impact study by player-season, for the durability dataset's event rows:
 * the redraft ADP the study priced the player at that season, and its impact
 * label per week of injury (the season in progress's rows have ADP only).
 */
export function studyIndex(analysis: InjuryImpactData, current: CurrentInjuryFile | null): StudyIndex {
  const out: StudyIndex = {};
  const rows: { gsis_id: string | null; season: number; overall_adp: number | null; week_of_injury: number | null; impact_label?: string }[] = [
    ...analysis.player_injury_impacts,
    ...(current?.rows ?? []).map((c) => ({ gsis_id: c.gsis_id, season: c.season, overall_adp: c.overall_adp, week_of_injury: c.week_of_injury, impact_label: undefined })),
  ];
  for (const r of rows) {
    if (!r.gsis_id) continue;
    const entry = (out[`${r.gsis_id}|${r.season}`] ??= { a: null, l: {} });
    if (r.overall_adp != null) entry.a = r.overall_adp;
    if (r.impact_label && r.week_of_injury != null) entry.l[String(r.week_of_injury)] = r.impact_label;
  }
  return out;
}

/** Team code -> bye week for one season's schedule: the regular-season week no game names. */
export function byeWeeks(season: ScheduleMap[string] | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!season) return out;
  for (const [team, games] of Object.entries(season)) {
    const reg = games.filter((g) => g.t === "REG").map((g) => g.w);
    if (!reg.length) continue;
    const last = Math.max(...reg);
    for (let w = 1; w <= last; w += 1) {
      if (!reg.includes(w)) {
        out[team] = w;
        break;
      }
    }
  }
  return out;
}

/** The dashboard dataset, or null when the directory is missing or unreadable. */
export function getInjuryDataset(): InjuryDataset | null {
  return read().dataset;
}

/** The durability dataset as the file holds it, for the bundle. */
export function getGridiron(): GridironDataset | null {
  return read().gridiron;
}

/** The durability dataset, hydrated: scores, event rows and aggregates. */
export function getDurability(): Durability | null {
  return read().durability;
}

/** Moves whenever any file does: the ETag of every rendering. */
export function injuryDataVersion(): string {
  return read().version;
}

export function getSearchIndex(): PackedSearchRow[] {
  return read().index;
}

export function searchInjuryPlayers(query: string) {
  return searchPlayers(read().index, query);
}

/** GSIS id -> Sleeper id, for the players in a list. */
export function photoIdsFor(gsisIds: Iterable<string | null | undefined>): Record<string, string> {
  const m = read().sleeper;
  const out: Record<string, string> = {};
  for (const id of gsisIds) {
    if (id && m[id]) out[id] = m[id] as string;
  }
  return out;
}

/* ------------------------------------------------------------------ shards */

interface Shard {
  keys: { h: string[]; g: string[] };
  players: Record<string, { h: unknown[][]; g: unknown[][] }>;
}

const shardCache = new LruCache<Shard | null>(12);

const GSIS = /^00-\d{7}$/;

export function isGsisId(id: string): boolean {
  return GSIS.test(id);
}

function shardFor(gsisId: string): Shard | null {
  const key = gsisId.slice(-2);
  const hit = shardCache.peek(key);
  if (hit !== undefined) return hit;
  const shard = readJson<Shard>(path.join(injuryDataDir(), "history", `${key}.json`));
  shardCache.set(key, shard);
  return shard;
}

function expand<T>(keys: string[], rows: unknown[][]): T[] {
  return rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? null])) as T);
}

/**
 * One player's slice, or null when the id is not in the injury data. The
 * schedule carries the seasons the player appears in, for the timeline.
 */
export function getPlayerSlice(gsisId: string): PlayerSlice | null {
  if (!isGsisId(gsisId)) return null;
  const m = read();
  const shard = shardFor(gsisId);
  const entry = shard?.players[gsisId];
  const indexRow = m.indexById.get(gsisId);
  const impacts = m.impactsById.get(gsisId) ?? [];
  const current = m.currentById.get(gsisId) ?? [];
  if (!entry && !indexRow && !impacts.length && !current.length) return null;
  const rows = entry && shard ? expand<InjuryRow>(shard.keys.h, entry.h) : [];
  const inGame = entry && shard ? expand<InGameInjuryEvent>(shard.keys.g, entry.g) : [];
  // The season in progress is kept out of the impact analysis; the panel merges it in.
  const currentSeasons = new Set(current.map((c) => c.season));
  const seasonInjuries = [...impacts.filter((im) => !currentSeasons.has(im.season)), ...current];
  const seasons = new Set<number>([...rows.map((r) => r.season).filter((s): s is number => s != null), ...seasonInjuries.map((s) => s.season)]);
  const schedule: ScheduleMap = {};
  for (const s of seasons) {
    const sched = m.schedule[String(s)];
    if (sched) schedule[String(s)] = sched;
  }
  const info = indexRow ? unpackSearchRow(indexRow) : null;
  const name = info?.fullName ?? m.dataset?.analysis.player_injury_impacts.find((p) => p.gsis_id === gsisId)?.player ?? current[0]?.team ?? gsisId;
  return {
    gsisId,
    name,
    position: info?.position ?? null,
    team: info?.team ?? null,
    rows,
    inGame,
    impacts: seasonInjuries,
    schedule,
    audited: m.dataset?.current ? { season: m.dataset.current.season, week: m.dataset.current.through_week } : null,
    photoId: m.sleeper[gsisId] ?? null,
    headshotVersion: null,
  };
}
