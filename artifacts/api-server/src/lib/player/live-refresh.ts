/**
 * Player stats that catch up after each game window, without a redeploy.
 *
 * Player pages read committed JSON (data/player/game_logs/<season>.json and
 * game_scores.json), and those only moved when somebody ran the builders by
 * hand, committed and republished - so a Thursday night game was not on the
 * page until the next week's rebuild. This runs the same two builders from the
 * running server, after each window, and drops every cache derived from them.
 *
 * ## When
 *
 * A tick every ten minutes asks one question: has a refresh started since the
 * most recent moment one became due? A moment is due
 *
 *   - four hours after each kickoff that has happened (the game is over and
 *     Sleeper has posted its stats) - Thursday, the Sunday windows, Monday;
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
 * the builder keeps what it has when it does), the recaps' box scores, and
 * find-game-videos.mjs --live (the recaps' YouTube highlights, into
 * data/matchup/game-videos-live.json), and the FPA ingest (in-process, the
 * same run POST /api/fpa/ingest makes; Strength of Schedule reads its table).
 * The builders run as child processes rather
 * than re-implemented here, so the weekly manual rebuild and this job cannot
 * build different files. Both builders keep a week's rows on disk when its
 * request fails and write atomically, which is what makes unattended runs safe.
 *
 * ## And once a day, the rest of the weekly rebuild
 *
 * OFF since 2026-10-04 unless SC_DAILY_REFRESH=1 (see dailyRefreshEnabled).
 *
 * At 11:00 UTC (and once per boot, after the game logs), the builders that
 * used to be the manual weekly checklist, in dependency order:
 *
 *   1. new signings and trades - buildPlayersIndex.js (Sleeper), then
 *      migrateSlugs.js if that renamed anybody (it consumes the move list, so it
 *      is safe to chain), buildDepthCharts.js --strict (Ourlads; refuses a chart
 *      with a team missing), buildIndexedPlayers.js. WordPress then publishes
 *      the new players' pages from its own daily cron (plugin 1.10.10);
 *   2. ownership - buildRosterPct.mjs (Sleeper);
 *   3. RB handcuffs - refresh.mjs (Ourlads depth, Sleeper age and injury), then
 *      buildStats.mjs (nflverse);
 *   4. the strength-of-schedule Player SOS list - sos/buildPlayerPool.mjs
 *      (Sleeper projections for the weeks left; data/sos/player-pool.json),
 *      and the FPA ingest again, for a week nflverse posted late;
 *   5. advanced stats - player-stats/buildSeason.mjs (nflverse), twice: once
 *      for [statchasers_player_stats] (data/player-stats) and once, with
 *      --dir, for the player pages' Advanced tab (data/player/advanced_stats).
 *      The two directories hold differently shaped tables, so neither is a
 *      copy of the other. The Stats tab reads LAST season's advanced card
 *      from the second (stats-tab-data.ts), so a season never built there
 *      leaves next year's card empty.
 *
 * Each step is independent of the ones after it, except the signings chain,
 * which stops at its first failure. The nflverse builders never write fewer
 * weeks than the file already has, so running them daily while nflverse still
 * lags simply keeps what is there until the new week lands.
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
import { resetLiveVideos } from "../matchup/game-notes";
import { invalidateTeamRenderCache } from "../team-ssr";
import { invalidateStatsCache } from "../player-stats/stats-data";
import { invalidateHandcuffCache } from "../rb-handcuffs/handcuffs-data";
import { invalidateRankingsCache } from "../rankings/rankings-data";
import { dataPath } from "../data-dir";
import { restorePracticeReports, savePracticeReports } from "./practice-store";

const TICK_MS = 10 * 60 * 1000;
/**
 * When the daily rebuild runs: 7am ET in the DST season (6am once the clocks
 * fall back - still quiet, still after Sleeper's and nflverse's overnight
 * posts). Moved from 14:00 UTC so the rebuild no longer competes with
 * mid-morning reader traffic for the VM's memory; a week nflverse posts later
 * the same day is caught by the FPA backstop and the next morning's run.
 */
const DAILY_UTC_HOUR = 11;
/** Per daily step: the nflverse builders download several files each. */
const DAILY_STEP_TIMEOUT_MS = 10 * 60 * 1000;
/** After a failed run, before the next attempt. */
const FAILURE_BACKOFF_MS = 30 * 60 * 1000;
/** Per builder. The game-log build is 18 requests 250ms apart. */
const BUILDER_TIMEOUT_MS = 5 * 60 * 1000;
/**
 * Heap ceiling per builder, in MB. V8 sizes its default from the machine, not
 * from what the server leaves free, so a builder with a big live set grows
 * until the kernel OOM-kills the VM (2026-10-03: buildBioSources at 1.5GB
 * RSS). Capped, it dies alone as a "failed" step. The heaviest builder needs
 * about 256MB of heap since its CSVs became streamed.
 */
const BUILDER_HEAP_MB = 768;
/** The video scan: a Sunday's games are a few YouTube pages each, 1.2s apart. */
const VIDEO_SCAN_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * The package directory, resolved from this module - the lesson of
 * lib/data-dir.ts. Bundled, HERE is `<package>/dist`; unbundled it is
 * `<package>/src/lib/player`.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = [
  path.resolve(HERE, "..", "scripts"),
  path.resolve(HERE, "..", "..", "..", "scripts"),
].find((dir) => fs.existsSync(path.join(dir, "player", "buildGameLogs.js")));

/** One step of the daily rebuild, as /api/status reports it. */
export interface DailyStep {
  name: string;
  ok: boolean;
  error?: string;
}

export interface PlayerRefreshStatus {
  enabled: boolean;
  running: boolean;
  lastAttempt: string | null;
  lastSuccess: string | null;
  lastError: string | null;
  lastDueAt: string | null;
  daily: {
    enabled: boolean;
    lastAttempt: string | null;
    lastFinished: string | null;
    steps: DailyStep[];
  };
}

/** The one job running, game logs or daily: they read each other's files. */
let running: Promise<void> | null = null;
let dailyStartedMs = 0;
let dailyFinishedMs = 0;
let dailySteps: DailyStep[] = [];
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
    daily: {
      enabled: enabled && dailyRefreshEnabled(),
      lastAttempt: iso(dailyStartedMs),
      lastFinished: iso(dailyFinishedMs),
      steps: dailySteps,
    },
  };
}

/**
 * The VM's available memory in MB. /proc/meminfo's MemAvailable, which counts
 * reclaimable cache the OOM killer would free first; os.freemem() does not and
 * reads low on a box that is merely caching files.
 */
function availableMemMb(): number {
  try {
    const match = /MemAvailable:\s+(\d+) kB/.exec(fs.readFileSync("/proc/meminfo", "utf8"));
    if (match) return Math.round(Number(match[1]) / 1024);
  } catch {
    // Not Linux, or /proc unreadable: -1 below.
  }
  return -1;
}

/**
 * A breadcrumb the deployment's Logs pane can see. The app's own logging goes
 * through pino's worker files, which that pane does not show - only stderr
 * reaches it. When the VM is OOM-killed nothing gets to say so, so each
 * refresh step writes a line before and after itself: the step that was
 * running when the log went silent is the one that was killed.
 */
function refreshNote(event: string, what: string): void {
  process.stderr.write(
    `[refresh] ${new Date().toISOString()} ${event} ${what} (mem avail ${availableMemMb()}MB)\n`,
  );
}

function runBuilder(
  script: string,
  args: string[],
  timeoutMs: number = BUILDER_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!SCRIPTS_DIR) {
      reject(new Error("scripts/ not found beside the server"));
      return;
    }
    refreshNote("start", script);
    execFile(
      process.execPath,
      [`--max-old-space-size=${BUILDER_HEAP_MB}`, path.join(SCRIPTS_DIR, script), ...args],
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        refreshNote(err ? "failed" : "done", script);
        if (err) reject(new Error(`${script}: ${err.message}${stderr ? ` - ${stderr.slice(-500)}` : ""}`));
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

/**
 * Run the FPA ingest here, joining one in flight. Imported lazily so the
 * nflverse code stays off the startup path, as fpa-ssr.ts does. True on success.
 */
async function refreshFpaInProcess(caller: string): Promise<boolean> {
  // Noted like the builders, and more pointedly: this one runs inside the
  // server process, so its memory lands on top of everything already cached.
  refreshNote("start", "fpa (in-process)");
  try {
    const { refreshFpa } = await import("../fpa/refresh");
    const { result, joined } = await refreshFpa();
    logger.info({ weekNumber: result.weekNumber, joined }, `${caller}: FPA refreshed`);
    refreshNote("done", "fpa (in-process)");
    return true;
  } catch (err) {
    logger.warn({ err }, `${caller}: FPA not refreshed`);
    refreshNote("failed", "fpa (in-process)");
    return false;
  }
}

/** Run both builders and reload. Joins a run already in flight. */
export function refreshPlayerStats(): Promise<void> {
  if (running) return running;
  lastStartedMs = Date.now();
  const season = seasonYear();
  running = (async () => {
    try {
      await runBuilder("player/buildGameLogs.js", [String(season)]);
      // The W/L column. Best effort: ESPN refuses this host at times, and a
      // game log without a result is still worth publishing.
      await runBuilder("player/buildGameScores.js", [String(season)]).catch((err) => {
        logger.warn({ err }, "Player refresh: game scores not updated");
      });
      // The recap pages' stored box scores. Also best effort, for the same
      // reason: a game not stored yet is fetched live by the page instead.
      await runBuilder("matchup/buildBoxscores.mjs", [String(season)]).catch((err) => {
        logger.warn({ err }, "Player refresh: box scores not stored");
      });
      // Fantasy Points Allowed (and with it Strength of Schedule, which reads
      // the same table). In-process, the same run POST /api/fpa/ingest makes,
      // and joined if one is already going. Best effort, like the two above:
      // nflverse posts a week a day or more after it is played, and until it
      // does the ingest rewrites what it already had. It used to run only when
      // somebody called the endpoint, which is how the Sep 28 table sat
      // without Week 3's Monday game.
      await refreshFpaInProcess("Player refresh");
      // The recaps' highlights videos: the NFL's YouTube upload for each game
      // finished since the last publish, a miss retried until the game is four
      // days old. Best effort: YouTube or ESPN refusing costs only the videos.
      await runBuilder(
        "find-game-videos.mjs",
        ["--from", String(season), "--through", String(season), "--live"],
        VIDEO_SCAN_TIMEOUT_MS,
      )
        .then(resetLiveVideos)
        .catch((err) => {
          logger.warn({ err }, "Player refresh: highlights videos not searched");
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

/** Whether the last players-index build left renames not yet carried across. */
function slugMovesPending(): boolean {
  try {
    const ledger = JSON.parse(
      fs.readFileSync(dataPath("player", "player_slugs.json"), "utf8"),
    ) as { moves?: unknown[] };
    return Array.isArray(ledger.moves) && ledger.moves.length > 0;
  } catch {
    return false;
  }
}

/** The rest of the weekly rebuild. See the header. Joins a run in flight. */
export function refreshDailyData(): Promise<void> {
  if (running) return running;
  dailyStartedMs = Date.now();
  const season = String(seasonYear());
  running = (async () => {
    refreshNote("start", "daily rebuild");
    const steps: DailyStep[] = [];
    const step = async (name: string, script: string, args: string[] = []) => {
      try {
        await runBuilder(script, args, DAILY_STEP_TIMEOUT_MS);
        steps.push({ name, ok: true });
        return true;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        steps.push({ name, ok: false, error: error.slice(0, 600) });
        logger.warn({ name, err }, "Daily data step failed");
        return false;
      }
    };

    try {
      // A rename the last run could not carry across blocks the index build
      // until it is; migrateSlugs.js consumes the list, so running it first is
      // safe, and running it again after a build that renamed is what the
      // builder itself asks for.
      if (slugMovesPending()) await step("slug migration", "player/migrateSlugs.js");
      if (await step("players index", "player/buildPlayersIndex.js")) {
        if (slugMovesPending()) await step("slug migration", "player/migrateSlugs.js");
        if (await step("depth charts", "player/buildDepthCharts.js", ["--strict"])) {
          await step("indexed players", "player/buildIndexedPlayers.js");
        }
      }
      await step("ownership", "player/buildRosterPct.mjs");
      // The Bio tab's fact store: nflverse bulk files (conditional, so an
      // unchanged file is a 304), Wikidata when its last pass is a week old.
      await step("bio sources", "player/buildBioSources.mjs");
      await step("handcuff depth", "rb-handcuffs/refresh.mjs");
      await step("handcuff stats", "rb-handcuffs/buildStats.mjs", [season]);
      await step("sos player list", "sos/buildPlayerPool.mjs");
      // FPA again, daily: the backstop for a week nflverse posted after the
      // last game window's runs had stopped looking for it.
      steps.push(
        (await refreshFpaInProcess("Daily data"))
          ? { name: "fpa", ok: true }
          : { name: "fpa", ok: false, error: "FPA ingest failed; see the log and /api/status fpa" },
      );
      // The team hubs' Usage report. nflverse posts a week by about
      // Wednesday; the builder refuses to write fewer weeks than disk.
      await step("team usage", "team/buildUsage.mjs", [season]);
      // The Coaching tab's computed layer: every generated entry's tendency
      // numbers, score states and prose re-derive from the same nflverse
      // feeds. --force all regenerates every non-hand-written entry (the
      // builder preserves entries it did not generate, i.e. the Bills).
      await step("team coaching", "team/buildCoaching.mjs", [season, "--force", "all"]);
      // The Stats tab's Efficiency ladders: five per-play rates per unit from
      // the same play-by-play. Refuses to roll a hub back to fewer weeks.
      await step("team efficiency", "team/buildEfficiency.mjs", [season]);
      // Then check what the hubs now say: weeks against the games file, the
      // standings feed, head coaches against the research file, and the
      // sentences the 2026-10-03 audit removed. A FAIL here is a page saying
      // something wrong; docs/WEEKLY-TEAM-CHECKLIST.md says what to do.
      await step("team page check", "team/checkTeamPages.mjs", [season]);
      await step("advanced stats", "player-stats/buildSeason.mjs", [season]);
      await step("player advanced stats", "player-stats/buildSeason.mjs", [
        season,
        "--dir",
        dataPath("player", "advanced_stats"),
      ]);

      reloadPlayerStats();
      invalidateStatsCache();
      invalidateHandcuffCache();
      invalidateRankingsCache();
      invalidateTeamRenderCache();
      logger.info({ steps }, "Daily data rebuild finished");
    } finally {
      refreshNote("done", "daily rebuild");
      dailySteps = steps;
      dailyFinishedMs = Date.now();
      running = null;
    }
  })();
  return running;
}

/**
 * The Injury tab's practice grid (scripts/player/buildPracticeReports.mjs).
 *
 * NFL.com shows only the latest report of the week, so each day's
 * participation exists only if the page is read on that day, after the
 * mid-afternoon Eastern release. Three reads a day, UTC: 21:00, 23:30 and
 * 02:30 (5:00, 7:30 and 10:30 PM EDT) - the later two catch a late report,
 * and each overwrites that day's entry with what the page says. Its own lock
 * and clock: four small requests, and a failure costs only the grid.
 */
const PRACTICE_UTC_MINUTES = [21 * 60, 23 * 60 + 30, 2 * 60 + 30];
let practiceRunning: Promise<void> | null = null;
let practiceStartedMs = 0;

function lastPracticeMs(nowMs: number): number {
  let best = 0;
  for (const minutes of PRACTICE_UTC_MINUTES) {
    const at = new Date(nowMs);
    at.setUTCHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    if (at.getTime() > nowMs) at.setUTCDate(at.getUTCDate() - 1);
    best = Math.max(best, at.getTime());
  }
  return best;
}

export function refreshPracticeReports(): Promise<void> {
  if (practiceRunning) return practiceRunning;
  practiceStartedMs = Date.now();
  const season = seasonYear();
  practiceRunning = (async () => {
    // A publish ships the committed file over the reads filed since: put them
    // back first (practice-store.ts). A store failure costs only the history.
    try {
      await restorePracticeReports(season);
    } catch (err) {
      logger.warn({ err }, "Practice reports: store not read");
    }
    await runBuilder("player/buildPracticeReports.mjs", [String(season)]);
    try {
      await savePracticeReports(season);
    } catch (err) {
      logger.warn({ err }, "Practice reports: store not written");
    }
  })()
    .then(() => {
      // The page version reads the file's mtime; this drops what is cached.
      invalidatePlayerRenderCache();
    })
    .catch((err) => {
      logger.warn({ err }, "Practice reports not updated");
    })
    .finally(() => {
      practiceRunning = null;
    });
  return practiceRunning;
}

/** The most recent daily moment at or before `nowMs`. */
function lastDailyMs(nowMs: number): number {
  const at = new Date(nowMs);
  at.setUTCHours(DAILY_UTC_HOUR, 0, 0, 0);
  if (at.getTime() > nowMs) at.setUTCDate(at.getUTCDate() - 1);
  return at.getTime();
}

async function tick(): Promise<void> {
  const now = Date.now();
  // Beside the other two jobs rather than behind them: it reads no file they write.
  if (practiceStartedMs === 0 || practiceStartedMs < lastPracticeMs(now)) {
    void refreshPracticeReports();
  }
  if (running) return;
  // Game logs first: they are what readers notice.
  if (now - lastFailureMs >= FAILURE_BACKOFF_MS && (await gameLogsDue(now))) {
    await refreshPlayerStats();
    return;
  }
  // Then the daily rebuild, which also runs once per boot for the same reason
  // the game logs do: a publish ships the committed files. Off unless
  // SC_DAILY_REFRESH=1 since 2026-10-04 (mak: it kept taking the site down).
  if (!dailyRefreshEnabled()) return;
  if (dailyStartedMs === 0 || dailyStartedMs < lastDailyMs(now)) {
    await refreshDailyData();
  }
}

async function gameLogsDue(now: number): Promise<boolean> {
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
  return lastStartedMs === 0 || lastStartedMs < lastDueMs;
}

export function playerRefreshEnabled(): boolean {
  const raw = (process.env["SC_PLAYER_LIVE_REFRESH"] ?? "").trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return process.env["NODE_ENV"] === "production";
}

/**
 * The daily chain only. Off by default since 2026-10-04, when mak stopped it
 * after another production outage; the game-window and practice-report
 * refreshes still run. Its builders are run by hand in the workspace instead
 * (the weekly checklist), or SC_DAILY_REFRESH=1 turns it back on.
 */
export function dailyRefreshEnabled(): boolean {
  const raw = (process.env["SC_DAILY_REFRESH"] ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
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
