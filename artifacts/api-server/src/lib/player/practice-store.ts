/**
 * The practice grid's reads, kept in Postgres so a publish cannot wipe them.
 *
 * buildPracticeReports.mjs files each evening's NFL.com read under that day in
 * data/player/practice_reports/<season>.json. On the deployment that file is
 * on the VM's own disk, and every publish ships the committed copy over it, so
 * before this store the Wednesday and Thursday of a week rarely survived to
 * Sunday (Week 4 of 2026: both gone, wiped by the 10-01 and 10-02 publishes).
 *
 * The store holds one document per season. Before each read the server merges
 * it into the file (days are a union, so nothing either side holds is lost);
 * after each read it saves the file back. Off without DATABASE_URL, which
 * leaves the file-only behavior.
 */

import fs from "node:fs";
import path from "node:path";
import { dataPath } from "../data-dir";

interface Row {
  name: string;
  pos: string;
  injury: string | null;
  gameStatus: string | null;
  final: string;
  days: Record<string, string>;
}
interface Week {
  fetchedAt: string;
  url: string;
  teams: Record<string, Record<string, Row>>;
}
export interface PracticeDoc {
  season: number;
  source: string;
  updatedAt: string | null;
  weeks: Record<string, Week>;
}

const time = (iso: string | null | undefined): number => (iso ? Date.parse(iso) || 0 : 0);

/**
 * Two copies of a season folded into one. Per week, the later read's header
 * and per-player fields win; days are a union, the later read winning a date
 * both hold. A player or club only one side has is kept.
 */
export function mergePracticeDocs(a: PracticeDoc | null, b: PracticeDoc | null): PracticeDoc | null {
  if (!a) return b;
  if (!b) return a;
  const weeks: Record<string, Week> = {};
  for (const wk of new Set([...Object.keys(a.weeks ?? {}), ...Object.keys(b.weeks ?? {})])) {
    const x = a.weeks?.[wk];
    const y = b.weeks?.[wk];
    if (!x || !y) {
      weeks[wk] = (x ?? y)!;
      continue;
    }
    const [old, neu] = time(x.fetchedAt) <= time(y.fetchedAt) ? [x, y] : [y, x];
    const teams: Week["teams"] = {};
    for (const club of new Set([...Object.keys(old.teams ?? {}), ...Object.keys(neu.teams ?? {})])) {
      const o = old.teams?.[club] ?? {};
      const n = neu.teams?.[club] ?? {};
      const players: Record<string, Row> = {};
      for (const slug of new Set([...Object.keys(o), ...Object.keys(n)])) {
        const po = o[slug];
        const pn = n[slug];
        players[slug] = po && pn ? { ...pn, days: { ...po.days, ...pn.days } } : (pn ?? po)!;
      }
      teams[club] = players;
    }
    weeks[wk] = { ...neu, teams };
  }
  return {
    ...(time(a.updatedAt) <= time(b.updatedAt) ? b : a),
    weeks,
  };
}

function practiceFile(season: number): string {
  return path.join(dataPath("player"), "practice_reports", `${season}.json`);
}

function readFile(season: number): PracticeDoc | null {
  try {
    return JSON.parse(fs.readFileSync(practiceFile(season), "utf8")) as PracticeDoc;
  } catch {
    return null;
  }
}

/** The database, imported lazily: @workspace/db throws at import without DATABASE_URL. */
async function database() {
  if (!process.env.DATABASE_URL) return null;
  const { pool } = await import("@workspace/db");
  // Created here as well as by the drizzle schema, so a publish that skipped
  // the schema push still keeps the reads. Same definition as schema/practice.ts.
  await pool.query(
    "CREATE TABLE IF NOT EXISTS practice_reports (season integer PRIMARY KEY, doc jsonb NOT NULL, updated_at timestamp with time zone NOT NULL DEFAULT now())",
  );
  return pool;
}

/** Fold the stored copy into the file. True when the file changed. */
export async function restorePracticeReports(season: number): Promise<boolean> {
  const pool = await database();
  if (!pool) return false;
  const res = await pool.query<{ doc: PracticeDoc }>("SELECT doc FROM practice_reports WHERE season = $1", [season]);
  const stored = res.rows[0]?.doc ?? null;
  if (!stored) return false;
  const file = readFile(season);
  const merged = mergePracticeDocs(file, stored);
  if (!merged || JSON.stringify(merged) === JSON.stringify(file)) return false;
  const out = practiceFile(season);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(`${out}.tmp`, JSON.stringify(merged));
  fs.renameSync(`${out}.tmp`, out);
  return true;
}

/** Save the file to the store, merged with what is already there. */
export async function savePracticeReports(season: number): Promise<void> {
  const pool = await database();
  if (!pool) return;
  const file = readFile(season);
  if (!file) return;
  const res = await pool.query<{ doc: PracticeDoc }>("SELECT doc FROM practice_reports WHERE season = $1", [season]);
  const merged = mergePracticeDocs(res.rows[0]?.doc ?? null, file);
  await pool.query(
    "INSERT INTO practice_reports (season, doc, updated_at) VALUES ($1, $2, now()) ON CONFLICT (season) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()",
    [season, JSON.stringify(merged)],
  );
}
