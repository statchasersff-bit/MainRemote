/**
 * Game status changes, and the pages each one makes stale (WEB-040,
 * 2026-11-24).
 *
 * Every page about a game is cached in front of WordPress for as long as its
 * state allows (game-state.ts, the plugin's cache policy), but a lifetime is
 * a ceiling, not a trigger: a preview cached for the six hours before
 * kickoff, or a final cached for an hour, is wrong the moment the game
 * starts or a stat correction lands. So the slate watches its own games:
 * whenever a game of the current season changes status (scheduled, live,
 * final, postponed, canceled) or a final's score changes, the pages that
 * print it are named and handed to a purge hook.
 *
 * The hook is a POST to `SC_PURGE_WEBHOOK` (the plugin's
 * /wp-json/statchasers/v1/purge-games) carrying `SC_PURGE_KEY`. Neither is
 * set anywhere yet: until they are, every event is logged and kept in memory
 * (recentGameEvents) and nothing leaves this process. Turning it on is a
 * production change that needs mak's OK (docs/WEB-040-LIVE-MATCHUP-2026-11-24b.md).
 *
 * Only transitions are reported, never the first sight of a game after a
 * restart: a process that starts mid-game has no "before" to compare with,
 * and purging the whole slate at every boot would empty the caches the boot
 * warm-up just filled.
 */

import { logger } from "../logger";
import { canonicalizeMatchupPair, gameSegment } from "../matchup/pair";
import { getTeamHubUrl } from "../team/links";
import type { ScheduleGame } from "./schedule-data";

export interface GameEvent {
  gameId: string;
  season: number;
  week: number;
  kind: "status" | "score";
  from: string;
  to: string;
  atMs: number;
  /** Site paths (root-relative) whose cached copies print this game. */
  paths: string[];
}

interface Seen {
  status: string;
  score: string;
}

const seen = new Map<string, Seen>();
const events: GameEvent[] = [];
const MAX_EVENTS = 200;

/** Queued paths per flush, so a sweep that finals six games sends one request. */
let pending: GameEvent[] = [];
let flushTimer: NodeJS.Timeout | null = null;
const FLUSH_DELAY_MS = 2_000;

/**
 * Every page that prints this game's state: the dated game page, the pair's
 * head-to-head page, the schedule's week page and its season page, and both
 * clubs' hubs and their schedule tabs.
 */
export function purgePathsFor(game: ScheduleGame, season: number): string[] {
  const paths = new Set<string>();
  const pair = game.away && game.home ? canonicalizeMatchupPair(game.away, game.home) : null;
  if (pair) {
    const pairPath = `/nfl/${pair.slug}/`;
    paths.add(`${pairPath}${gameSegment({ season, week: game.week, seasonType: "regular" })}/`);
    paths.add(pairPath);
  }
  paths.add(`/nfl/nfl-schedule/week-${game.week}/`);
  paths.add("/nfl/nfl-schedule/");
  for (const team of [game.away, game.home]) {
    const url = team ? getTeamHubUrl(team) : null;
    // The template may be absolute (https://statchasers.com/nfl/teams/x/):
    // the plugin wants the site path.
    const hub = url ? new URL(url, "https://statchasers.com").pathname : null;
    if (hub) {
      paths.add(hub);
      paths.add(`${hub.replace(/\/?$/, "/")}schedule/`);
    }
  }
  return [...paths];
}

function scoreOf(game: ScheduleGame): string {
  return game.status === "final" ? `${game.awayScore ?? ""}-${game.homeScore ?? ""}` : "";
}

/**
 * Compare a freshly assembled slate with the last one this process saw.
 * Returns the events found (also queued for the purge hook).
 */
export function observeGames(season: number, games: readonly ScheduleGame[], nowMs: number): GameEvent[] {
  const found: GameEvent[] = [];
  for (const game of games) {
    const now: Seen = {
      // An unconfirmed status is still the status: "pending" is not a new
      // state of the game, only of what this host knows about it.
      status: game.status,
      score: scoreOf(game),
    };
    const before = seen.get(game.id);
    seen.set(game.id, now);
    if (!before) continue;
    if (before.status !== now.status) {
      found.push({ gameId: game.id, season, week: game.week, kind: "status", from: before.status, to: now.status, atMs: nowMs, paths: purgePathsFor(game, season) });
    } else if (now.status === "final" && before.score !== now.score) {
      found.push({ gameId: game.id, season, week: game.week, kind: "score", from: before.score, to: now.score, atMs: nowMs, paths: purgePathsFor(game, season) });
    }
  }
  if (found.length) {
    events.push(...found);
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    pending.push(...found);
    if (!flushTimer) {
      flushTimer = setTimeout(() => void flush(), FLUSH_DELAY_MS);
      flushTimer.unref();
    }
  }
  return found;
}

/** The last events seen, newest last. For tests and /api diagnostics. */
export function recentGameEvents(): readonly GameEvent[] {
  return events;
}

async function flush(): Promise<void> {
  flushTimer = null;
  const batch = pending;
  pending = [];
  if (!batch.length) return;
  const paths = [...new Set(batch.flatMap((e) => e.paths))];
  const url = (process.env["SC_PURGE_WEBHOOK"] ?? "").trim();
  const key = (process.env["SC_PURGE_KEY"] ?? "").trim();
  const summary = batch.map((e) => `${e.gameId} ${e.kind} ${e.from}->${e.to}`);
  if (!url || !key) {
    logger.info({ events: summary, paths }, "game status changed; purge hook not configured, nothing sent");
    return;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-SC-Purge-Key": key },
      body: JSON.stringify({ paths, events: summary }),
      signal: AbortSignal.timeout(10_000),
    });
    logger.info({ status: res.status, events: summary, paths: paths.length }, "game status purge sent");
  } catch (err) {
    logger.warn({ err, events: summary }, "game status purge failed");
  }
}

/** Test seam: forget everything (a fresh process). */
export function resetGameEvents(): void {
  seen.clear();
  events.length = 0;
  pending = [];
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
}
