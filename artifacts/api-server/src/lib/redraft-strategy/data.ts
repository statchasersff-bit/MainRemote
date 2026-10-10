/**
 * The redraft strategy dataset, read: data/redraft-strategy/, written by
 * scripts/redraft-strategy/buildData.mjs from the standalone app's pipeline
 * output. Static history - it moves only when the app's pipeline is re-run
 * and the output re-packed - so it is re-read when a file changes and never
 * fetched.
 *
 * Three readers: the whole set for the server render, and one combo, trend
 * or the boards for the bundle's data routes.
 */

import fs from "node:fs";
import path from "node:path";
import { dataPath } from "../data-dir";
import type { Board, Combo, Dataset, Summary, Trend } from "./model";

export * from "./model";

interface Memo {
  /** The newest mtime over every file, which is what a rebuild moves. */
  stamp: string;
  data: Dataset | null;
  version: string;
}

let memo: Memo | null = null;

export function rdsDataDir(): string {
  return dataPath("redraft-strategy");
}

/** Short, stable, non-cryptographic - this only has to differ, not resist. */
function hash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i += 1) {
    h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function listJson(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort();
  } catch {
    return [];
  }
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** A fingerprint of the directory: every file's name, size and mtime. */
function stampOf(dir: string): string {
  const parts: string[] = [];
  for (const rel of ["summary.json", "boards.json"]) {
    try {
      const s = fs.statSync(path.join(dir, rel));
      parts.push(`${rel}:${s.size}:${s.mtimeMs}`);
    } catch {
      parts.push(`${rel}:-`);
    }
  }
  for (const sub of ["combos", "trends"]) {
    for (const f of listJson(path.join(dir, sub))) {
      try {
        const s = fs.statSync(path.join(dir, sub, f));
        parts.push(`${sub}/${f}:${s.size}:${s.mtimeMs}`);
      } catch {
        // Raced a rebuild; the next read will see the new stamp.
      }
    }
  }
  return parts.join("|");
}

function read(): Memo {
  const dir = rdsDataDir();
  const stamp = stampOf(dir);
  if (memo && memo.stamp === stamp) return memo;
  const summary = readJson<Summary>(path.join(dir, "summary.json"));
  const boards = readJson<Board[]>(path.join(dir, "boards.json"));
  if (!summary || !Array.isArray(boards) || typeof summary.total_teams !== "number") {
    return (memo = { stamp, data: null, version: "empty" });
  }
  const combos: Record<string, Combo> = {};
  for (const f of listJson(path.join(dir, "combos"))) {
    const c = readJson<Combo>(path.join(dir, "combos", f));
    if (c && Array.isArray(c.best_strategies)) combos[f.slice(0, -5)] = c;
  }
  const trends: Record<string, Trend> = {};
  for (const f of listJson(path.join(dir, "trends"))) {
    const t = readJson<Trend>(path.join(dir, "trends", f));
    if (t && Array.isArray(t.overall_strategies)) trends[f.slice(0, -5)] = t;
  }
  const data: Dataset = { summary, combos, trends, boards };
  return (memo = { stamp, data, version: hash(stamp) });
}

/** The dataset, or null when the directory is missing or unreadable. */
export function getRdsData(): Dataset | null {
  return read().data;
}

/** Moves whenever any file does: the ETag of every rendering. */
export function rdsDataVersion(): string {
  return read().version;
}

export function getRdsCombo(key: string): Combo | null {
  return read().data?.combos[key] ?? null;
}

export function getRdsTrend(key: string): Trend | null {
  return read().data?.trends[key] ?? null;
}

export function getRdsBoards(): Board[] | null {
  return read().data?.boards ?? null;
}
