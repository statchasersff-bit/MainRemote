/**
 * Player stats that catch up after each game window, without a redeploy.
 *
 * Player pages read committed JSON (data/player/game_logs/<season>.json and
 * game_scores.json), and those only moved when somebody ran the builders by
 * hand, committed and republished — so a Thursday night game was not on the
 * page until the next week's rebuild. This runs the same two builders from the
 * running server, after each window, and drops every cache derived from them.
 *
 * ## When
 *
 * A tick every ten minutes asks one question: has a refresh started since the
 * most recent moment one became due? A moment is due
 *
 *   - four hours after each kickoff that has happened (the game is over and
 *     Sleeper has posted its stats) — Thursday, the Sunday windows, Monday;
 *   - at 13:00 UTC on any day within three days of a game, which picks up the
 *     stat corrections that land the morning after and on Tuesday.
 *
 * On boot nothing has run yet, so the first tick refreshes. That matters on
 * the deployment: a publish ships the committed files, which can be a week
 * older than what the last process had written, and this brings them level
 * again straight away. About six runs a week in season; in the offseason, one
 * per boot.
 *
 * ## What
 *
 * scripts/player/buildGameLogs.js (Sleeper, 18 requests) and then
 * buildGameScores.js (ESPN, the W/L column; ESPN refuses this host at times and
 * the builder keeps what it has when it does). Run as child processes rather
 * than re-implemented here, so the weekly manual rebuild and this job cannot
 * build different files. Both builders keep a week's rows on disk when its
 * request fails and write atomically, which is what makes unattended runs safe.
 *
 * Ownership, advanced stats and the RB handcuff inputs stay with the weekly
 * manual rebuild: their sources lag the games by days anyway.
 *
 * ## Where it is on
 *
 * Production by default. Elsewhere only with SC_PLAYER_LIVE_REFRESH=1: in the
 * workspace these files are tracked in git, and a background job rewriting
 * them would put a data diff into every auto-commit.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../logger";
import { seasonYear } from "../seo";
import { getSchedule, scheduleSeason } from "../schedule/schedule-data";
import { resetPlayerData } from "./data";
import { latestDueMs } from "./refresh-schedule";
import { resetRankCaches } from "./ranks";
import { resetBenchmarkCache } from "./benchmarks";
import { resetDriverCache } from "./outlook-drivers";
import { resetAppearanceCaches } from "../matchup/appearances";
import { invalidatePlayerRenderCache } from "../player-ssr";
import { invalidateMatchupRenderCache } from "../matchup/matchup-ssr";

const TICK_MS = 10 * 60 * 1000;
/** After a failed run, before the next attempt. */
const FAILURE_BACKOFF_MS = 30 * 60 * 1000;
/** Per builder. The game-log build is 18 requests 250ms apart. */
const BUILDER_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * The package directory, resolved from this module — the lesson of
 * lib/data-dir.ts. Bundled, HERE is `<package>/dist`; unbundled it is
 * `<package>/src/lib/player`.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = [
  path.resolve(HERE, "..", "scripts", "player"),
  path.resolve(HERE, "..", "..", "..", "scripts", "player"),
].find((dir) => fs.existsSync(path.join(dir, "buildGameLogs.js")));

export interface PlayerRefreshStatus {
  enabled: boolean;
  running: boolean;
  lastAttempt: string | null;
  lastSuccess: string | null;
  lastError: string | null;
  lastDueAt: string | null;
}

let running: Promise<void> | null = null;
let lastStartedMs = 0;
let lastSuccessMs = 0;
let lastFailureMs = 0;
let lastError: string | null = null;
let lastDueMs = 0;
let enabled = false;

export function playerRefreshStatus(): PlayerRefreshStatus {
  const iso = (ms: number) => (ms ? new Date(ms).toISOString() : null);
  return {
    enabled,
    running: running !== null,
    lastAttempt: iso(lastStartedMs),
    lastSuccess: iso(lastSuccessMs),
    lastError,
    lastDueAt: iso(lastDueMs),
  };
}

function runBuilder(script: string, season: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!SCRIPTS_DIR) {
      reject(new Error("scripts/player not found beside the server"));
      return;
    }
    execFile(
      process.execPath,
      [path.join(SCRIPTS_DIR, script), String(season)],
      { timeout: BUILDER_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        if (err) reject(new Error(`${script}: ${err.message}${stderr ? ` — ${stderr.slice(-500)}` : ""}`));
        else resolve();
      },
    );
  });
}

/** Everything derived from the game logs or the scores, dropped together. */
export function reloadPlayerStats(): void {
  resetPlayerData();
  resetRankCaches();
  resetBenchmarkCache();
  resetDriverCache();
  resetAppearanceCaches();
  invalidatePlayerRenderCache();
  invalidateMatchupRenderCache();
}

/** Run both builders and reload. Joins a run already in flight. */
export function refreshPlayerStats(): Promise<void> {
  if (running) return running;
  lastStartedMs = Date.now();
  const season = seasonYear();
  running = (async () => {
    try {
      await runBuilder("buildGameLogs.js", season);
      // The W/L column. Best effort: ESPN refuses this host at times, and a
      // game log without a result is still worth publishing.
      await runBuilder("buildGameScores.js", season).catch((err) => {
        logger.warn({ err }, "Player refresh: game scores not updated");
      });
      reloadPlayerStats();
      lastSuccessMs = Date.now();
      lastError = null;
      logger.info({ season }, "Player stats refreshed");
    } catch (err) {
      lastFailureMs = Date.now();
      lastError = err instanceof Error ? err.message : String(err);
      logger.error({ err }, "Player stats refresh failed");
    } finally {
      running = null;
    }
  })();
  return running;
}

async function tick(): Promise<void> {
  const now = Date.now();
  if (running || now - lastFailureMs < FAILURE_BACKOFF_MS) return;

  let kickoffs: number[] = [];
  try {
    const schedule = await getSchedule(scheduleSeason(), now);
    kickoffs = (schedule?.games ?? [])
      .map((game) => game.kickoffMs)
      .filter((ms): ms is number => ms !== null);
  } catch {
    // No schedule: fall through with none, which still refreshes once a boot.
  }

  lastDueMs = latestDueMs(kickoffs, now);
  // `lastStartedMs === 0` is the boot run: bring the shipped files level with
  // the games played since they were committed.
  if (lastStartedMs === 0 || lastStartedMs < lastDueMs) {
    await refreshPlayerStats();
  }
}

export function playerRefreshEnabled(): boolean {
  const raw = (process.env["SC_PLAYER_LIVE_REFRESH"] ?? "").trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return process.env["NODE_ENV"] === "production";
}

export function startPlayerRefreshScheduler(): void {
  enabled = playerRefreshEnabled();
  if (!enabled) return;
  const run = () => {
    tick().catch((err) => logger.error({ err }, "Player refresh tick failed"));
  };
  // A minute after boot, clear of the startup work.
  setTimeout(run, 60_000).unref();
  setInterval(run, TICK_MS).unref();
}
