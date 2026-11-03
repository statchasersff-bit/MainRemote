/**
 * The depth-charts tool's data, for the team hub's Depth Chart tab.
 *
 * The tool itself is a WordPress plugin (wordpress-plugin/statchasers-depth-
 * charts/): it blends FantasyPros, Footballguys and ESPN on the WordPress host
 * and caches the result as one JSON document. The hub renders here, on a host
 * that cannot reach statchasers.com, so the plugin pushes that document to
 * POST /api/depth-charts/ingest after every refresh and this module is where
 * it lands:
 *
 *   - the file, data/depth-charts/statchasers/depth-charts.json - the same path
 *     the plugin's own preview reads (lib/depth-charts-preview.ts), so the hub
 *     and the tool preview always show one snapshot;
 *   - a row in Postgres, because every publish ships the committed snapshot
 *     over the file. The newer of the two wins (restoreDepthCharts()).
 *
 * Until the first push arrives the committed snapshot is what renders; it was
 * written by the plugin's own refresh (tests/depth-charts/snapshot.php).
 *
 * The views mirror the tool's TABS in assets/js/frontend.js column for column.
 * Two things are added on the way out, both from the tool's own document: the
 * Fantasy columns carry no injury status (FantasyPros has none), so each row
 * borrows its status from the same team's Offense column for that position;
 * and a row with no headshot borrows one from the same name elsewhere on the
 * team, as the tool's search does.
 */

import fs from "node:fs";
import path from "node:path";
import { dataPath } from "../data-dir";
import { dbAccess } from "../db-access";
import { ensureRuntimeTables } from "../db-schema";
import { logger } from "../logger";
import { readDataJson } from "./read-json";

export type Movement = "up" | "down" | "new";

interface ToolPlayer {
  rank: number;
  name: string;
  id: string | null;
  status: string | null;
  headshot?: string | null;
  movement: Movement | null;
}

/** A side of the ball, as the tool's document spells it. */
export type ToolSide = "offense" | "defense" | "specialTeams";

/**
 * One depth-chart slot as the club lists it (plugin 1.7.2, 2026-11-03): the
 * source's own key ("wr1", "lde", "nb"), its printed abbreviation and the
 * players in its order. Three WR slots are three entries. Older documents
 * have none, and the football chart is then folded from the columns.
 */
interface ToolSlot {
  key: string;
  slot: string;
  side: ToolSide;
  players: ToolPlayer[];
}

interface ToolTeam {
  team: { abbr: string; name: string; logo: string | null };
  positions: Record<string, ToolPlayer[]>;
  slots?: ToolSlot[];
  /** The formation each side's slots were read from: "3WR 1TE", "Base 3-4 D". */
  formations?: Partial<Record<ToolSide, string>>;
}

export interface DepthChartsDoc {
  version: 1;
  season: number;
  fetchedAt: string;
  teams: ToolTeam[];
}

/* ------------------------------------------------------------------ views */

export interface DepthColumnDef {
  /** The document's positions[] key: "FAN_QB", "LT". */
  key: string;
  /** What the column header prints, and the slot chip's color key. */
  pos: string;
  /** Spelled out, for the screen reader and the tooltip. */
  label: string;
}

export interface DepthViewDef {
  key: "fantasy" | "offense" | "defense" | "special";
  label: string;
  columns: DepthColumnDef[];
}

/** The tool's four tabs, in its order. */
export const DEPTH_VIEWS: DepthViewDef[] = [
  {
    key: "fantasy",
    label: "Fantasy",
    columns: [
      { key: "FAN_QB", pos: "QB", label: "Quarterbacks" },
      { key: "FAN_RB", pos: "RB", label: "Running backs" },
      { key: "FAN_WR", pos: "WR", label: "Wide receivers" },
      { key: "FAN_TE", pos: "TE", label: "Tight ends" },
      { key: "FAN_K", pos: "K", label: "Kickers" },
    ],
  },
  {
    key: "offense",
    label: "Offense",
    columns: [
      { key: "QB", pos: "QB", label: "Quarterbacks" },
      { key: "RB", pos: "RB", label: "Running backs" },
      { key: "WR", pos: "WR", label: "Wide receivers" },
      { key: "TE", pos: "TE", label: "Tight ends" },
      { key: "LT", pos: "LT", label: "Left tackles" },
      { key: "LG", pos: "LG", label: "Left guards" },
      { key: "C", pos: "C", label: "Centers" },
      { key: "RG", pos: "RG", label: "Right guards" },
      { key: "RT", pos: "RT", label: "Right tackles" },
    ],
  },
  {
    key: "defense",
    label: "Defense",
    columns: [
      { key: "EDGE", pos: "EDGE", label: "Edge rushers" },
      { key: "DL", pos: "DL", label: "Defensive linemen" },
      { key: "LB", pos: "LB", label: "Linebackers" },
      { key: "CB", pos: "CB", label: "Cornerbacks" },
      { key: "S", pos: "S", label: "Safeties" },
    ],
  },
  {
    key: "special",
    label: "Special Teams",
    columns: [
      { key: "K", pos: "K", label: "Kickers" },
      { key: "P", pos: "P", label: "Punters" },
      { key: "LS", pos: "LS", label: "Long snappers" },
      { key: "KR", pos: "KR", label: "Kick returners" },
      { key: "PR", pos: "PR", label: "Punt returners" },
    ],
  },
];

export interface DepthRow {
  rank: number;
  name: string;
  /**
   * The tool's id for the row: a Sleeper id on the Fantasy columns, another
   * source's elsewhere. Null when the document has none.
   */
  id: string | null;
  /**
   * The designation as the hub's badge reads it: "Questionable", "Out", "IR".
   * The tool stores one-letter codes for the first three.
   */
  injuryStatus: string | null;
  injuryBodyPart: null;
  headshot: string | null;
  movement: Movement | null;
}

export interface DepthColumn extends DepthColumnDef {
  rows: DepthRow[];
}

export interface DepthView {
  key: DepthViewDef["key"];
  label: string;
  columns: DepthColumn[];
}

/** One row of the football chart: a slot and its depth string. */
export interface FootballSlot {
  /** The source's key, unique within the team: "wr1", "lde". */
  key: string;
  /** What the row label prints: "WR", "LDE", "K". */
  pos: string;
  /** Spelled out: "Wide receiver", "Left defensive end". */
  label: string;
  rows: DepthRow[];
}

export interface FootballSide {
  key: "offense" | "defense" | "special";
  label: string;
  /** The formation the slots were read from ("3WR 1TE"), or null. */
  formation: string | null;
  /**
   * True when the document carried no slots and these rows are the folded
   * columns, one row per column: a base offense's three WR slots read as one
   * WR row there.
   */
  folded: boolean;
  slots: FootballSlot[];
}

export interface TeamDepthCharts {
  fetchedAt: string;
  season: number;
  /** The tool's four views, in its order (Fantasy first). */
  views: DepthView[];
  /** The football chart: offense, defense, special teams, slot by slot. */
  football: FootballSide[];
}

/* ------------------------------------------------------------------ read */

/** SC_DEPTH_CHARTS_FILE moves it, so a test's pushes land in a scratch copy. */
export const DEPTH_CHARTS_FILE =
  process.env["SC_DEPTH_CHARTS_FILE"] || dataPath("depth-charts", "statchasers", "depth-charts.json");

function readDoc(): DepthChartsDoc | null {
  const doc = readDataJson<DepthChartsDoc>(DEPTH_CHARTS_FILE);
  return doc && Array.isArray(doc.teams) ? doc : null;
}

/** Changes whenever a push lands - part of the team page's cache key. */
export function depthChartsVersion(): string {
  return readDoc()?.fetchedAt ?? "";
}

const STATUS_WORDS: Record<string, string> = {
  Q: "Questionable",
  D: "Doubtful",
  O: "Out",
  SUSP: "Sus",
  SUS: "Sus",
};

function statusWord(code: string | null): string | null {
  const trimmed = (code ?? "").trim();
  if (!trimmed) return null;
  return STATUS_WORDS[trimmed.toUpperCase()] ?? trimmed;
}

/** The tool's normNameKey(): case, periods, apostrophes and Jr./III dropped. */
export function nameKey(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[.']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/);
  const suffixes = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
  while (words.length > 1 && suffixes.has(words[words.length - 1] ?? "")) words.pop();
  return words.join(" ");
}

/**
 * What a slot abbreviation spells out, for the row's screen-reader text and
 * tooltip. ESPN's abbreviations, plus the folded columns' for an old document.
 */
const SLOT_LABELS: Record<string, string> = {
  QB: "Quarterback",
  RB: "Running back",
  HB: "Halfback",
  FB: "Fullback",
  WR: "Wide receiver",
  TE: "Tight end",
  LT: "Left tackle",
  LG: "Left guard",
  C: "Center",
  RG: "Right guard",
  RT: "Right tackle",
  OL: "Offensive line",
  DE: "Defensive end",
  LDE: "Left defensive end",
  RDE: "Right defensive end",
  DT: "Defensive tackle",
  LDT: "Left defensive tackle",
  RDT: "Right defensive tackle",
  NT: "Nose tackle",
  DL: "Defensive line",
  EDGE: "Edge rusher",
  LB: "Linebacker",
  MLB: "Middle linebacker",
  ILB: "Inside linebacker",
  LILB: "Left inside linebacker",
  RILB: "Right inside linebacker",
  OLB: "Outside linebacker",
  LOLB: "Left outside linebacker",
  ROLB: "Right outside linebacker",
  WLB: "Weakside linebacker",
  SLB: "Strongside linebacker",
  CB: "Cornerback",
  LCB: "Left cornerback",
  RCB: "Right cornerback",
  NB: "Nickel back",
  NCB: "Nickel back",
  DB: "Defensive back",
  S: "Safety",
  SS: "Strong safety",
  FS: "Free safety",
  K: "Kicker",
  PK: "Kicker",
  P: "Punter",
  LS: "Long snapper",
  KR: "Kick returner",
  PR: "Punt returner",
  H: "Holder",
};

/** "K" for ESPN's "PK"; every other abbreviation prints as the source has it. */
function slotPos(slot: string): string {
  return slot === "PK" ? "K" : slot;
}

export function slotLabel(slot: string): string {
  return SLOT_LABELS[slot] ?? slot;
}

const SIDES: Array<{ side: ToolSide; key: FootballSide["key"]; label: string }> = [
  { side: "offense", key: "offense", label: "Offense" },
  { side: "defense", key: "defense", label: "Defense" },
  { side: "specialTeams", key: "special", label: "Special Teams" },
];

/** One team's four views, or null when the document has no entry for it. */
export function getTeamDepthCharts(abbreviation: string): TeamDepthCharts | null {
  const doc = readDoc();
  if (!doc) return null;
  const abbr = abbreviation.toUpperCase();
  const entry = doc.teams.find((team) => team.team?.abbr === abbr);
  if (!entry) return null;
  const positions = entry.positions ?? {};

  const headshots = new Map<string, string>();
  for (const players of Object.values(positions)) {
    for (const player of players ?? []) {
      const key = nameKey(player.name);
      if (player.headshot && !headshots.has(key)) headshots.set(key, player.headshot);
    }
  }

  const toRow = (player: ToolPlayer, borrowFrom: ToolPlayer[]): DepthRow => {
    const key = nameKey(player.name);
    const status =
      player.status ?? borrowFrom.find((other) => nameKey(other.name) === key)?.status ?? null;
    return {
      rank: player.rank,
      name: player.name,
      id: typeof player.id === "string" && player.id ? player.id : null,
      injuryStatus: statusWord(status),
      injuryBodyPart: null,
      headshot: player.headshot ?? headshots.get(key) ?? null,
      movement: player.movement ?? null,
    };
  };

  const views = DEPTH_VIEWS.map((view) => ({
    key: view.key,
    label: view.label,
    columns: view.columns.map((column) => {
      // Fantasy rows: the status the Offense column has for the same name.
      const borrowFrom = column.key.startsWith("FAN_") ? positions[column.key.slice(4)] ?? [] : [];
      const rows = [...(positions[column.key] ?? [])]
        .sort((a, b) => a.rank - b.rank)
        .map((player) => toRow(player, borrowFrom));
      return { ...column, rows };
    }),
  }));

  // The football chart. From the document's slots when it has them: the
  // source's rows in the source's order, never re-sorted by anything here
  // (and never by a fantasy rank - that order lives in the Fantasy view
  // alone). An older document is folded from the column views, one row per
  // column, and says so.
  const slots = Array.isArray(entry.slots) ? entry.slots : [];
  const football: FootballSide[] = SIDES.map(({ side, key, label }) => {
    const formation = entry.formations?.[side]?.trim() || null;
    if (slots.length > 0) {
      const own = slots
        .filter((slot) => slot.side === side && slot.players?.length)
        .map(
          (slot): FootballSlot => ({
            key: slot.key,
            pos: slotPos(slot.slot),
            label: slotLabel(slot.slot),
            rows: [...slot.players].sort((a, b) => a.rank - b.rank).map((p) => toRow(p, [])),
          }),
        );
      return { key, label, formation, folded: false, slots: own };
    }
    const view = views.find((v) => v.key === key);
    const own = (view?.columns ?? [])
      .filter((column) => column.rows.length)
      .map(
        (column): FootballSlot => ({
          key: column.key.toLowerCase(),
          pos: column.pos,
          label: slotLabel(column.pos),
          rows: column.rows,
        }),
      );
    return { key, label, formation, folded: true, slots: own };
  });

  return { fetchedAt: doc.fetchedAt, season: doc.season, views, football };
}

/* ----------------------------------------------------------- slot index */

export interface DepthSlot {
  /** The club whose chart lists the player. */
  abbr: string;
  /** The chart's own slot: LT, EDGE, CB, RB ... */
  slot: string;
  rank: number;
}

/** Return slots, the fantasy mirrors and the DEF unit are not depth positions. */
const NOT_A_SLOT = new Set(["PR", "KR", "DEF"]);

interface SlotIndex {
  /** Club + exact name key: every real slot that name holds there. */
  exact: Map<string, DepthSlot[]>;
  /** Club + first initial + last name: the exact keys it could mean. */
  loose: Map<string, Set<string>>;
}

let slotIndexFor = "";
let slotIndex: SlotIndex | null = null;

/** "a borregales" for Andy or Andres Borregales; null for a one-word name. */
function looseKey(name: string): string | null {
  const words = nameKey(name).split(" ");
  const first = words[0];
  const last = words[words.length - 1];
  return words.length > 1 && first && last ? `${first.charAt(0)} ${last}` : null;
}

/**
 * Every real depth slot in the document, keyed by club and name: where a
 * name sits on a club's chart. Rebuilt when a push lands.
 */
function readSlotIndex(): SlotIndex {
  const doc = readDoc();
  const version = doc?.fetchedAt ?? "";
  if (doc && slotIndex && version === slotIndexFor) return slotIndex;
  const next: SlotIndex = { exact: new Map(), loose: new Map() };
  for (const team of doc?.teams ?? []) {
    const abbr = team.team?.abbr;
    if (!abbr) continue;
    for (const [slot, players] of Object.entries(team.positions ?? {})) {
      if (slot.startsWith("FAN_") || NOT_A_SLOT.has(slot)) continue;
      for (const player of players ?? []) {
        if (!player?.name || typeof player.rank !== "number") continue;
        const key = `${abbr} ${nameKey(player.name)}`;
        const list = next.exact.get(key) ?? [];
        list.push({ abbr, slot, rank: player.rank });
        next.exact.set(key, list);
        const loose = looseKey(player.name);
        if (loose) {
          const set = next.loose.get(`${abbr} ${loose}`) ?? new Set<string>();
          set.add(key);
          next.loose.set(`${abbr} ${loose}`, set);
        }
      }
    }
  }
  slotIndexFor = version;
  slotIndex = next;
  return next;
}

/**
 * The slot a player holds on one club's chart ("LT2", as slot + rank), or
 * null when that club does not list them. A name at two slots takes the
 * higher one. The Draft tab's Pos column reads this (mak, 2026-10-29).
 *
 * The chart writes the name a player goes by and the draft register the
 * one on the card (Andy / Andres Borregales, Dax / Daxton Hill), so when
 * the exact name misses, first initial + last name on the same club is
 * accepted when it points at exactly one player there. Checked across all
 * 32 clubs on 2026-10-29: ten pairings, every one the same person.
 */
export function depthSlotFor(name: string, abbreviation: string): DepthSlot | null {
  const abbr = abbreviation.toUpperCase();
  const index = readSlotIndex();
  let slots = index.exact.get(`${abbr} ${nameKey(name)}`);
  if (!slots) {
    const loose = looseKey(name);
    const keys = loose ? index.loose.get(`${abbr} ${loose}`) : undefined;
    if (keys && keys.size === 1) slots = index.exact.get([...keys][0] ?? "");
  }
  let best: DepthSlot | null = null;
  for (const slot of slots ?? []) {
    if (!best || slot.rank < best.rank) best = slot;
  }
  return best;
}

/* --------------------------------------------------------------- ingest */

const MOVEMENTS = new Set(["up", "down", "new"]);

function str(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

/**
 * The pushed body, checked and copied field by field: only what the views
 * read is kept, so a malformed or oversized push cannot put anything else on
 * disk. Returns the reason when it is not a depth-charts document.
 */
export function parseDepthChartsDoc(body: unknown): { doc: DepthChartsDoc } | { error: string } {
  if (!body || typeof body !== "object") return { error: "body is not a JSON object" };
  const raw = body as Record<string, unknown>;
  if (raw["version"] !== 1) return { error: "unsupported version" };
  const season = raw["season"];
  if (typeof season !== "number" || !Number.isInteger(season) || season < 2000 || season > 2100) {
    return { error: "season is missing or invalid" };
  }
  const fetchedAt = str(raw["fetchedAt"], 40);
  if (!fetchedAt || Number.isNaN(Date.parse(fetchedAt))) return { error: "fetchedAt is missing or invalid" };
  const teamsIn = raw["teams"];
  if (!Array.isArray(teamsIn) || teamsIn.length === 0 || teamsIn.length > 40) {
    return { error: "teams must be a non-empty array" };
  }

  const teams: ToolTeam[] = [];
  for (const item of teamsIn) {
    const team = (item as Record<string, unknown> | null)?.["team"] as Record<string, unknown> | undefined;
    const abbr = str(team?.["abbr"], 4);
    if (!abbr || !/^[A-Z]{2,3}$/.test(abbr)) return { error: "a team has no valid abbr" };
    const positionsIn = (item as Record<string, unknown>)["positions"];
    if (!positionsIn || typeof positionsIn !== "object") return { error: `${abbr} has no positions` };

    const players = (list: unknown): ToolPlayer[] =>
      (Array.isArray(list) ? list : []).slice(0, 20).flatMap((p): ToolPlayer[] => {
        const player = p as Record<string, unknown> | null;
        const name = str(player?.["name"], 80);
        const rank = player?.["rank"];
        if (!name || typeof rank !== "number" || !Number.isFinite(rank)) return [];
        const headshot = str(player?.["headshot"], 300);
        const movement = str(player?.["movement"], 8);
        return [
          {
            rank,
            name,
            id: str(player?.["id"], 40),
            status: str(player?.["status"], 12),
            headshot: headshot && /^https:\/\//.test(headshot) ? headshot : null,
            movement: movement && MOVEMENTS.has(movement) ? (movement as Movement) : null,
          },
        ];
      });

    const positions: Record<string, ToolPlayer[]> = {};
    for (const [key, list] of Object.entries(positionsIn as Record<string, unknown>)) {
      if (!/^[A-Z_]{1,8}$/.test(key) || !Array.isArray(list)) continue;
      positions[key] = players(list);
    }

    // The slot rows (optional): the same field checks, plus a key and a side.
    const slotsIn = (item as Record<string, unknown>)["slots"];
    const slots: ToolSlot[] = [];
    const seenSlotKeys = new Set<string>();
    for (const raw of Array.isArray(slotsIn) ? slotsIn.slice(0, 60) : []) {
      const slot = raw as Record<string, unknown> | null;
      const key = str(slot?.["key"], 12);
      const pos = str(slot?.["slot"], 8);
      const side = str(slot?.["side"], 16);
      if (!key || !/^[a-z0-9]{1,8}$/.test(key) || seenSlotKeys.has(key)) continue;
      if (!pos || !/^[A-Z]{1,6}$/.test(pos)) continue;
      if (side !== "offense" && side !== "defense" && side !== "specialTeams") continue;
      const list = players(slot?.["players"]);
      if (list.length === 0) continue;
      seenSlotKeys.add(key);
      slots.push({ key, slot: pos, side, players: list });
    }

    const formationsIn = (item as Record<string, unknown>)["formations"];
    const formations: Partial<Record<ToolSide, string>> = {};
    if (formationsIn && typeof formationsIn === "object") {
      for (const side of ["offense", "defense", "specialTeams"] as const) {
        const name = str((formationsIn as Record<string, unknown>)[side], 40);
        if (name) formations[side] = name;
      }
    }

    const logo = str(team?.["logo"], 300);
    teams.push({
      team: {
        abbr,
        name: str(team?.["name"], 80) ?? abbr,
        logo: logo && /^https:\/\//.test(logo) ? logo : null,
      },
      positions,
      ...(slots.length ? { slots } : {}),
      ...(Object.keys(formations).length ? { formations } : {}),
    });
  }
  return { doc: { version: 1, season, fetchedAt, teams } };
}

function writeFile(doc: DepthChartsDoc): void {
  fs.mkdirSync(path.dirname(DEPTH_CHARTS_FILE), { recursive: true });
  const tmp = `${DEPTH_CHARTS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(doc));
  fs.renameSync(tmp, DEPTH_CHARTS_FILE);
}

const time = (iso: string | null | undefined): number => (iso ? Date.parse(iso) || 0 : 0);

/** The database, imported lazily: @workspace/db throws at import without DATABASE_URL. */
async function database() {
  // Created once per process by lib/db-schema.ts (same definition as
  // schema/depth-charts.ts), so a publish that skipped the schema push still
  // keeps the pushes without a CREATE TABLE round trip on every one.
  if (!(await ensureRuntimeTables())) return null;
  const { pool } = await import("@workspace/db");
  return pool;
}

export interface IngestResult {
  /** False when the file already held this refresh or a newer one. */
  stored: boolean;
  /** False when there is no database or the write to it failed. */
  saved: boolean;
  fetchedAt: string;
  teams: number;
}

/**
 * Store a push: the file for the renderer, the database for the next publish.
 * An older refresh than the one on disk is ignored - two pushes racing, or a
 * retry arriving late, must not roll the chart back.
 */
export async function ingestDepthCharts(doc: DepthChartsDoc): Promise<IngestResult> {
  const result: IngestResult = { stored: false, saved: false, fetchedAt: doc.fetchedAt, teams: doc.teams.length };
  if (time(doc.fetchedAt) <= time(readDoc()?.fetchedAt)) return result;
  writeFile(doc);
  result.stored = true;
  try {
    const pool = await database();
    if (pool) {
      dbAccess("depth_chart_write", { season: doc.season });
      await pool.query(
        "INSERT INTO depth_charts (season, doc, updated_at) VALUES ($1, $2, now()) ON CONFLICT (season) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()",
        [doc.season, JSON.stringify(doc)],
      );
      result.saved = true;
    }
  } catch (err) {
    logger.warn({ err }, "Depth charts: push not saved to the database");
  }
  return result;
}

let restoring: Promise<void> | null = null;

/**
 * Put the last push back over the committed snapshot, once per process. A
 * failure costs only freshness: the snapshot still renders.
 */
export function restoreDepthCharts(): Promise<void> {
  restoring ??= (async () => {
    try {
      const pool = await database();
      if (!pool) return;
      // The file's own season: a row for any other season is not this chart.
      const season = readDoc()?.season ?? new Date().getUTCFullYear();
      dbAccess("depth_chart_read", { season });
      const res = await pool.query<{ doc: DepthChartsDoc }>(
        "SELECT doc FROM depth_charts WHERE season = $1",
        [season],
      );
      const stored = res.rows[0]?.doc;
      if (stored && time(stored.fetchedAt) > time(readDoc()?.fetchedAt)) {
        writeFile(stored);
        logger.info({ fetchedAt: stored.fetchedAt }, "Depth charts: restored the last push");
      }
    } catch (err) {
      logger.warn({ err }, "Depth charts: store not read");
    }
  })();
  return restoring;
}
