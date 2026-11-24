/**
 * One game's state, as every matchup surface prints it (WEB-040 / WEB-003,
 * 2026-11-24).
 *
 * The audit (Colts at Texans, 2026-11-19): the head-to-head page showed the
 * preview through the whole game, the week URL answered 404 until 11:13 PM ET,
 * and the schedule printed the final beside a frozen "12:04 - 4TH". Three
 * surfaces, three readings of one game. This module is the one reading for
 * the matchup side: the week page, the head-to-head page's latest-game strip
 * and the browser's open-tab updates all print a GameStateRecord built here,
 * and the record is built from the same slate row (lib/schedule/
 * schedule-data.ts, its status decided once in lib/schedule/game-status.ts)
 * the schedule's own row is printed from. So the schedule row, the week page
 * and the head-to-head summary cannot disagree about the status, the score or
 * the clock: they are the same fields.
 *
 * Pure: no I/O and no clock of its own.
 */

import {
  GAME_END_ESTIMATE_MS,
  isRecentFinal,
  schedulePagePolicy,
  STATUS_PENDING_LABEL,
  type CachePolicy,
} from "../schedule/game-status";
import type { ScheduleGame as SlateGame } from "../schedule/schedule-data";

/**
 * What the page may say about the game right now.
 *
 * - scheduled: not started as far as any source says. The kickoff.
 * - live: in progress, a fresh ESPN read. Score, period and clock.
 * - halftime / break: in progress but the clock is stopped between halves or
 *   quarters ("Halftime", "End of 3rd"). Score and period, no running clock.
 * - delayed: weather or another stoppage. Score if one was read, no clock.
 * - postponed / canceled: the reported status; no clock, no score.
 * - pending: kicked off, but no source currently vouches for the status (ESPN
 *   stopped answering mid-game and the feed has no final yet). No clock, no
 *   score as the score; the last verified reading is carried separately.
 * - final: the final score, never a clock.
 */
export type GamePhase =
  | "scheduled"
  | "live"
  | "halftime"
  | "break"
  | "delayed"
  | "postponed"
  | "canceled"
  | "pending"
  | "final";

export interface GameStateSide {
  code: string;
  /** The score to print, or null when no score may be printed. */
  score: number | null;
}

export interface GameStateRecord {
  /** The slate's id, "2026_11_IND_HOU". The open-tab endpoint is keyed by it. */
  gameId: string;
  espnId: string | null;
  season: number;
  week: number;
  seasonType: "regular" | "post";
  phase: GamePhase;
  /** The status words, in the schedule's own wording: "12:04 - 4th", "Halftime", "Final/OT". */
  label: string;
  /** The running clock ("12:04"), only while the clock may be running. */
  clock: string | null;
  /** "1st" ... "4th", "OT", "2OT", or a break's own words; null when unknown. */
  period: string | null;
  away: GameStateSide;
  home: GameStateSide;
  kickoffMs: number | null;
  /**
   * When the printed score and clock were read from the source (ESPN's live
   * scoreboard): set while live, null otherwise. A final's time is not known.
   */
  scoreReadAtMs: number | null;
  /** When the slate's sources last answered: the "Updated" stamp. */
  sourceUpdatedAtMs: number | null;
  /**
   * A pending game's last verified reading: the score and clock ESPN last
   * gave and when. Printed as "last verified", never as the score.
   */
  lastVerified: { away: number; home: number; label: string | null; atMs: number } | null;
  /**
   * For a final: whether the detailed box score is in. False means the page
   * says "detailed stats are still arriving" and keeps checking. Null for any
   * other phase.
   */
  detailsReady: boolean | null;
  /** A stable fingerprint of everything above, for the client to compare. */
  version: string;
}

/** "12:04 - 4th" -> { clock: "12:04", period: "4th" }; "Halftime" -> no clock. */
export function parseStatusDetail(detail: string | null): { clock: string | null; period: string | null } {
  const text = (detail ?? "").trim();
  if (!text) return { clock: null, period: null };
  const m = /^(\d{1,2}:\d{2})\s*-\s*(.+)$/.exec(text);
  if (m) return { clock: m[1]!, period: m[2]!.trim() };
  return { clock: null, period: text };
}

function hash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i += 1) h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function phaseOf(game: SlateGame): GamePhase {
  const detail = (game.statusDetail ?? "").trim();
  switch (game.status) {
    case "final":
      return "final";
    case "postponed":
      return "postponed";
    case "canceled":
      return "canceled";
    case "live":
      if (game.statusConfirmed === false) return "pending";
      if (/^half/i.test(detail)) return "halftime";
      if (/delay/i.test(detail)) return "delayed";
      if (/^end of/i.test(detail)) return "break";
      return "live";
    default:
      if (game.statusConfirmed === false) return "pending";
      if (/delay/i.test(detail)) return "delayed";
      return "scheduled";
  }
}

export interface GameStateOptions {
  season: number;
  seasonType: "regular" | "post";
  /** The slate's "Updated" stamp. */
  sourceUpdatedAtMs?: number | null;
  /** For a final: is the detailed box score in? */
  detailsReady?: boolean | null;
}

/** The record for one slate row. */
export function gameStateRecord(game: SlateGame, options: GameStateOptions): GameStateRecord {
  const phase = phaseOf(game);
  const scored = phase === "live" || phase === "halftime" || phase === "break" || phase === "delayed" || phase === "final";
  const parsed = parseStatusDetail(game.statusDetail);
  // A clock only while it can be running; every other phase prints its words.
  const clock = phase === "live" ? parsed.clock : null;
  const period =
    phase === "live" || phase === "halftime" || phase === "break" ? parsed.period : null;
  const label =
    phase === "pending"
      ? STATUS_PENDING_LABEL
      : phase === "final"
        ? (game.statusDetail ?? "Final")
        : phase === "postponed"
          ? "Postponed"
          : phase === "canceled"
            ? "Canceled"
            : phase === "delayed"
              ? "Delayed"
              : phase === "scheduled"
                ? "Scheduled"
                : (game.statusDetail ?? "Live");
  const last = game.liveLastSeen ?? null;
  const record: Omit<GameStateRecord, "version"> = {
    gameId: game.id,
    espnId: game.espnId,
    season: options.season,
    week: game.week,
    seasonType: options.seasonType,
    phase,
    label,
    clock,
    period,
    away: { code: game.awayCode, score: scored ? game.awayScore : null },
    home: { code: game.homeCode, score: scored ? game.homeScore : null },
    kickoffMs: game.kickoffMs,
    scoreReadAtMs: phase === "final" || phase === "scheduled" ? null : (game.statusObservedAtMs ?? null),
    sourceUpdatedAtMs: options.sourceUpdatedAtMs ?? null,
    lastVerified:
      phase === "pending" && last
        ? { away: last.awayScore, home: last.homeScore, label: last.detail, atMs: last.seenAtMs }
        : null,
    detailsReady: phase === "final" ? (options.detailsReady ?? null) : null,
  };
  // The stamp is left out on purpose: it moves on every sweep, and a client
  // comparing versions should redraw only when something it prints changed.
  const version = hash(
    JSON.stringify({ ...record, sourceUpdatedAtMs: null }),
  );
  return { ...record, version };
}

/* ------------------------------------------------------------- words */

const EASTERN = "America/New_York";

/** "9:41 PM ET". */
export function easternClock(ms: number): string {
  return `${new Intl.DateTimeFormat("en-US", { timeZone: EASTERN, hour: "numeric", minute: "2-digit" }).format(new Date(ms))} ET`;
}

/** The badge words. */
export function phaseBadge(record: GameStateRecord): string {
  switch (record.phase) {
    case "live":
    case "break":
      return "Live";
    case "halftime":
      return "Halftime";
    case "delayed":
      return "Delayed";
    case "postponed":
      return "Postponed";
    case "canceled":
      return "Canceled";
    case "pending":
      return "Status pending";
    case "final":
      return record.label || "Final";
    default:
      return "Scheduled";
  }
}

/**
 * The strip's inner text, as plain parts. Shared shape with the client
 * redraw, which builds the same three lines from the same record.
 */
export function stripParts(record: GameStateRecord): { score: string | null; status: string | null; note: string | null } {
  const a = record.away;
  const h = record.home;
  const score = a.score !== null && h.score !== null ? `${a.code} ${a.score}, ${h.code} ${h.score}` : null;
  let status: string | null = null;
  let note: string | null = null;
  switch (record.phase) {
    case "live":
      status = record.clock && record.period ? `${record.period} quarter, ${record.clock}`.replace(/^OT quarter/, "Overtime").replace(/^(\d?OT) quarter/, "$1") : record.label;
      break;
    case "break":
      status = record.period;
      break;
    case "halftime":
      status = "Halftime";
      break;
    case "delayed":
      status = "Play is delayed";
      break;
    case "postponed":
      status = "This game has been postponed.";
      break;
    case "canceled":
      status = "This game has been canceled.";
      break;
    case "pending":
      status = "Live updates are paused.";
      if (record.lastVerified) {
        note = `Last verified: ${a.code} ${record.lastVerified.away}, ${h.code} ${record.lastVerified.home}` +
          (record.lastVerified.label ? ` (${record.lastVerified.label})` : "") +
          ` at ${easternClock(record.lastVerified.atMs)}.`;
      }
      break;
    case "final":
      status = record.label;
      if (record.detailsReady === false) {
        note = "Detailed stats are still arriving. The box score and recap will appear here once they are in.";
      }
      break;
    default:
      break;
  }
  if (!note && record.scoreReadAtMs !== null && record.phase !== "final") {
    note = `Score as of ${easternClock(record.scoreReadAtMs)}`;
  }
  return { score, status, note };
}

/* ------------------------------------------------------------ open tabs */

/** How far ahead of kickoff an open preview starts asking. */
export const POLL_LEAD_MS = 30 * 60 * 1000;

/**
 * Should an open tab keep asking, and how often?
 *
 * Inside half an hour of kickoff and while the game runs: every 30 seconds,
 * the live layer's own refresh. A final still waiting for its box score: every
 * two minutes; a final in its first 48 hours: every five, so a corrected
 * score reaches an open tab. Otherwise not at all (the client backs off on
 * errors and pauses while the tab is hidden).
 */
export function pollPlan(record: GameStateRecord, nowMs: number): { active: boolean; everyMs: number } {
  switch (record.phase) {
    case "live":
    case "halftime":
    case "break":
    case "delayed":
    case "pending":
      return { active: true, everyMs: 30_000 };
    case "final":
      // Waiting for the box score: every two minutes. In the first 48 hours
      // with the box score in: every five, for a corrected final. Then stop.
      if (!isRecentFinal(record.kickoffMs, nowMs)) return { active: false, everyMs: 0 };
      return record.detailsReady === false ? { active: true, everyMs: 120_000 } : { active: true, everyMs: 300_000 };
    case "scheduled":
      return record.kickoffMs !== null &&
        record.kickoffMs - nowMs <= POLL_LEAD_MS &&
        nowMs - record.kickoffMs < GAME_END_ESTIMATE_MS
        ? { active: true, everyMs: 30_000 }
        : { active: false, everyMs: 0 };
    default:
      return { active: false, everyMs: 0 };
  }
}

/* ------------------------------------------------------- cache policy */

/**
 * How long a matchup page about this game may sit in a shared cache.
 *
 * The schedule's rule (schedulePagePolicy) on the one game, plus:
 * - "recent" for a final in its first 48 hours, or one whose box score has not
 *   arrived: corrections and the box score itself still land.
 * - `changeAtMs`, when the page will change on its own clock with no data
 *   change at all - the pair's page turning into the preview six days before
 *   a rematch. The plugin never lets the edge keep the page past it.
 */
export interface MatchupCachePolicy {
  state: CachePolicy["state"];
  /** The next kickoff (pregame), or the moment the page's own state flips; null if none. */
  changeAtMs: number | null;
}

export function matchupCachePolicy(
  record: GameStateRecord | null,
  nowMs: number,
  changeAtMs: number | null = null,
): MatchupCachePolicy {
  const atOrNull = (ms: number | null): number | null => (ms !== null && ms > nowMs ? ms : null);
  if (!record) return { state: "settled", changeAtMs: atOrNull(changeAtMs) };
  const policy = schedulePagePolicy(
    [
      {
        status:
          record.phase === "final"
            ? "final"
            : record.phase === "canceled"
              ? "canceled"
              : record.phase === "postponed"
                ? "postponed"
                : record.phase === "scheduled"
                  ? "scheduled"
                  : "live",
        statusDetail: record.phase === "delayed" ? "Delayed" : null,
        statusConfirmed: record.phase === "pending" ? false : true,
        kickoffMs: record.kickoffMs,
      },
    ],
    nowMs,
  );
  if (policy.state === "settled" && record.phase === "final") {
    if (record.detailsReady === false || isRecentFinal(record.kickoffMs, nowMs)) {
      return { state: "recent", changeAtMs: atOrNull(changeAtMs) };
    }
  }
  if (policy.state === "pregame") {
    const next = policy.nextKickoffMs;
    const soonest = [next, atOrNull(changeAtMs)].filter((v): v is number => v !== null);
    return { state: "pregame", changeAtMs: soonest.length ? Math.min(...soonest) : null };
  }
  return { state: policy.state, changeAtMs: policy.state === "live" ? null : atOrNull(changeAtMs) };
}
