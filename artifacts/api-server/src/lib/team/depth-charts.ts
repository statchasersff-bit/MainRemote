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

interface ToolTeam {
  team: { abbr: string; name: string; logo: string | null };
  positions: Record<string, ToolPlayer[]>;
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

export interface TeamDepthCharts {
  fetchedAt: string;
  season: number;
  views: DepthView[];
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

  const views = DEPTH_VIEWS.map((view) => ({
    key: view.key,
    label: view.label,
    columns: view.columns.map((column) => {
      // Fantasy rows: the status the Offense column has for the same name.
      const borrowFrom = column.key.startsWith("FAN_") ? positions[column.key.slice(4)] ?? [] : [];
      const rows = [...(positions[column.key] ?? [])]
        .sort((a, b) => a.rank - b.rank)
        .map((player): DepthRow => {
          const key = nameKey(player.name);
          const status =
            player.status ?? borrowFrom.find((other) => nameKey(other.name) === key)?.status ?? null;
          return {
            rank: player.rank,
            name: player.name,
            injuryStatus: statusWord(status),
            injuryBodyPart: null,
            headshot: player.headshot ?? headshots.get(key) ?? null,
            movement: player.movement ?? null,
          };
        });
      return { ...column, rows };
    }),
  }));

  return { fetchedAt: doc.fetchedAt, season: doc.season, views };
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

    const positions: Record<string, ToolPlayer[]> = {};
    for (const [key, list] of Object.entries(positionsIn as Record<string, unknown>)) {
      if (!/^[A-Z_]{1,8}$/.test(key) || !Array.isArray(list)) continue;
      positions[key] = list.slice(0, 20).flatMap((p): ToolPlayer[] => {
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
    }
    const logo = str(team?.["logo"], 300);
    teams.push({
      team: {
        abbr,
        name: str(team?.["name"], 80) ?? abbr,
        logo: logo && /^https:\/\//.test(logo) ? logo : null,
      },
      positions,
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
