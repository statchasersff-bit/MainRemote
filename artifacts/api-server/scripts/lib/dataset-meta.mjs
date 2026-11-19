/**
 * Dataset freshness metadata, kept apart from file modification times
 * (Phase 1.1, 2026-11-19).
 *
 * A file's mtime says when something last wrote it, not when its source was
 * last ingested: the scoring-event backfill of 2026-11-19 rewrote every game
 * log and made 2009's stats look fresh. Each dataset and season instead
 * carries, in data/dataset-meta.json:
 *
 *   lastIngestedAt      the last provider fetch that SUCCEEDED for every week
 *                       it asked for. A failed or partial fetch never moves it.
 *   lastAggregatedAt    the last time the published file was rebuilt from
 *                       ingested data (a partial rebuild that keeps old weeks
 *                       still counts: the file was aggregated).
 *   latestCompletedGame / throughWeek / complete
 *                       coverage against the stored schedule's finals.
 *   lastCorrectionAt    a backfill or correction that did not re-ingest.
 *   lastFailureAt / lastFailure
 *                       the newest failed run, for the status endpoint.
 *   provenance          how a value was established when not by a live run
 *                       (e.g. seeded from git history).
 *
 * Writes are atomic (tmp + rename). Readers: src/lib/dataset-meta.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// Follows the builders' test seam (SC_PLAYER_DATA_DIR), so a stub run never
// writes the committed metadata.
export const META_FILE =
  process.env.SC_DATASET_META_FILE?.trim() ||
  (process.env.SC_PLAYER_DATA_DIR?.trim()
    ? path.join(process.env.SC_PLAYER_DATA_DIR.trim(), "dataset-meta.json")
    : path.resolve(here, "..", "..", "data", "dataset-meta.json"));

export function readMeta(file = META_FILE) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { datasets: {} };
  }
}

/** Merge `patch` into datasets[dataset][season]. Undefined fields are left as they are. */
export function updateMeta(dataset, season, patch, file = META_FILE) {
  const doc = readMeta(file);
  doc.datasets ??= {};
  doc.datasets[dataset] ??= {};
  const cur = doc.datasets[dataset][String(season)] ?? {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) cur[k] = v;
  doc.datasets[dataset][String(season)] = cur;
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(doc, null, 2)}\n`);
  fs.renameSync(`${file}.tmp`, file);
  return cur;
}

export const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
