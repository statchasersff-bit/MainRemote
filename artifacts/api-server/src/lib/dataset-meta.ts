/**
 * Reader for data/dataset-meta.json (written by scripts/lib/dataset-meta.mjs).
 *
 * Phase 1.1 (2026-11-19): freshness labels and /api/status read these fields,
 * never a file's modification time. A backfill or correction rewrites a file
 * without re-ingesting it, and must not make old stats look freshly fetched.
 */

import fs from "node:fs";
import { dataPath } from "./data-dir";

export interface DatasetSeasonMeta {
  source?: string;
  /** Last provider fetch that succeeded for every week asked for. */
  lastIngestedAt?: string | null;
  /** Last time the published file was rebuilt from ingested data. */
  lastAggregatedAt?: string | null;
  latestCompletedGame?: string | null;
  throughWeek?: number | null;
  complete?: boolean | null;
  missingGames?: string[] | null;
  /** A backfill or correction that did not re-ingest. */
  lastCorrectionAt?: string | null;
  lastCorrection?: string | null;
  lastFailureAt?: string | null;
  lastFailure?: string | null;
  provenance?: string | null;
}

export type DatasetName = "game_logs" | "player_stats";

let cache: { mtimeMs: number; doc: { datasets?: Record<string, Record<string, DatasetSeasonMeta>> } } | null = null;

/** Injected for the tests; the stored file by default. */
let override: { datasets?: Record<string, Record<string, DatasetSeasonMeta>> } | null = null;
export function setDatasetMetaForTests(doc: typeof override): void {
  override = doc;
}

function doc() {
  if (override) return override;
  const file = dataPath("dataset-meta.json");
  try {
    const { mtimeMs } = fs.statSync(file);
    if (cache && cache.mtimeMs === mtimeMs) return cache.doc;
    cache = { mtimeMs, doc: JSON.parse(fs.readFileSync(file, "utf8")) };
    return cache.doc;
  } catch {
    return { datasets: {} };
  }
}

export function datasetMeta(dataset: DatasetName, season: number): DatasetSeasonMeta | null {
  return doc().datasets?.[dataset]?.[String(season)] ?? null;
}

/** Last successful provider ingestion, in ms; null when none is recorded. */
export function lastIngestedMs(dataset: DatasetName, season: number): number | null {
  const at = datasetMeta(dataset, season)?.lastIngestedAt;
  const ms = at ? Date.parse(at) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

/** The deployed bundle's build stamp (dist/build-info.json), when present. */
export function buildInfo(): { builtAt: string | null; commit: string | null } {
  try {
    const raw = JSON.parse(fs.readFileSync(new URL("./build-info.json", import.meta.url), "utf8")) as Record<string, unknown>;
    return { builtAt: typeof raw["builtAt"] === "string" ? raw["builtAt"] : null, commit: typeof raw["commit"] === "string" ? raw["commit"] : null };
  } catch {
    return { builtAt: null, commit: null };
  }
}
