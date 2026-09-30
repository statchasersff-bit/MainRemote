/**
 * The strength-of-schedule board's inputs, read: the FPA table (adjusted
 * view), the season's schedule and the committed Player SOS list. The model
 * itself — ranks, buckets, spans, cards — is sos-model.ts, kept free of the
 * database and the network so the tests can load it on its own, as
 * fpa/math.ts is.
 */

import fs from "node:fs";
import { dataPath } from "../data-dir";
import { getFpaTable } from "../fpa/fpa-data";
import type { FantasyPosition } from "../fpa/nflverse";
import { getSchedule, scheduleSeason } from "../schedule/schedule-data";
import { buildSosBoard, SCORING_FORMAT, type Pool, type SosBoard, type SosScoring } from "./sos-model";

export * from "./sos-model";

let poolMemo: { mtimeMs: number; pool: Pool | null } | null = null;

function poolPath(): string {
  return dataPath("sos", "player-pool.json");
}

/** data/sos/player-pool.json (scripts/sos/buildPlayerPool.mjs), re-read when it changes. */
function readPool(): Pool | null {
  const file = poolPath();
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
  if (poolMemo && poolMemo.mtimeMs === mtimeMs) return poolMemo.pool;
  let pool: Pool | null = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<Pool>;
    pool = Array.isArray(parsed.players)
      ? { players: parsed.players, builtAt: String(parsed.builtAt ?? "") }
      : null;
  } catch {
    pool = null;
  }
  poolMemo = { mtimeMs, pool };
  return pool;
}

/**
 * The board for one position and scoring, or null when either input is
 * missing — no FPA ingested yet, or no schedule. Null rather than an empty
 * grid, for the FPA table's reason: 32 rows of dashes are worse than no board.
 */
export async function getSosBoard(
  position: FantasyPosition,
  scoring: SosScoring,
): Promise<SosBoard | null> {
  // The FPA table's own season (FPA_CURRENT_SEASON), not the schedule's: from
  // March 1 the schedule is next year's while FPA stays on the season just
  // played until its preseason switch in August — and that full season is the
  // right baseline for next year's slate. See docs/SEASON-ROLLOVER.md.
  const [fpa, schedule] = await Promise.all([
    getFpaTable({ format: SCORING_FORMAT[scoring], view: "adjusted" }),
    getSchedule(scheduleSeason()),
  ]);
  if (!fpa || !schedule) return null;
  return buildSosBoard(fpa, schedule, readPool(), position, scoring);
}
