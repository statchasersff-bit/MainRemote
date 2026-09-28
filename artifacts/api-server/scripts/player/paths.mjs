/**
 * Where the player data lives, for every build script in this directory.
 *
 * One constant, imported rather than recomputed, because these scripts arrived
 * from a standalone app where the data sat at `<repo>/data` and each of them
 * derived that path its own way — some from `__dirname/../data`, some from
 * `process.cwd()/data`. Here the data is one tool's among three, at
 * `artifacts/api-server/data/player`, and sixteen independent derivations of
 * that would be sixteen chances to write a rebuilt file somewhere the server
 * does not read.
 *
 * Derived from this file's own location, so the scripts work from any working
 * directory — `node scripts/player/buildGameLogs.js` and `cd scripts/player &&
 * node buildGameLogs.js` write to the same place.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** artifacts/api-server — the app these scripts feed. */
export const APP_DIR = path.resolve(here, "..", "..");

/** artifacts/api-server/data/player — read by src/lib/player/data.ts. */
export const DATA_DIR =
  // A test seam: the builders' tests point this at a temporary directory so a
  // run against a stub API cannot touch the committed data.
  process.env.SC_PLAYER_DATA_DIR?.trim() || path.resolve(APP_DIR, "data", "player");

export const GAME_LOGS_DIR = path.resolve(DATA_DIR, "game_logs");
export const ADVANCED_STATS_DIR = path.resolve(DATA_DIR, "advanced_stats");
