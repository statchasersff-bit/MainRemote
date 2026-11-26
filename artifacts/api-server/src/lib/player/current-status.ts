/**
 * One normalized current-status record per player page (audit WEB-039).
 *
 * Before 2026-11-19 the player header, Outlook, Injury tab and FAQ printed
 * Sleeper's raw `injury_status`, which is not tied to a week, while the
 * matchup preview applied the week-aware rule in matchup/availability.ts. So
 * Luther Burden III read "Questionable" in his header and Outlook (his Week 10
 * tag) while the official Week 11 report had no designation for him.
 *
 * This runs the SAME rule (gameAvailability) for the player's next game and
 * keeps its three answers apart:
 *
 *   - designation: the official game status for THAT week (Out, Doubtful,
 *     Questionable), or null when none has been issued. Null is not "healthy".
 *   - rosterStatus: a reserve list (IR, PUP, NFI, suspension), which stands
 *     until he is activated and is not a game designation.
 *   - practice: the week's latest practice line ("DNP Wed"). Never promoted to
 *     a game status.
 *
 * And it says how old its inputs are, so a stale feed is shown as stale.
 *
 * Since 2026-11-24 (WEB-039 follow-up) a designation is ONLY an official
 * game status on the club's report for that week. A Sleeper status filed
 * since the last game is reported, not designated (the note says so), and
 * "no designation" reads "No designation yet" until the week's report has
 * its game statuses: a missing or empty report never reads as cleared.
 *
 * Every player component reads `PlayerPageData.designation`, which carries
 * displayedStatus(); none may fall back to `player.injury_status` (the raw
 * Sleeper field in players.json), which is what kept Burden "Questionable" in
 * the header after this record had expired it.
 */

import {
  gameAvailability,
  NO_DESIGNATION_YET,
  PENDING,
  type AvailabilityKind,
  type AvailabilityOptions,
  type PracticeDoc,
  type WeekReport,
} from "../matchup/availability";
import { dataPath } from "../data-dir";
import { readDataJson } from "../team/read-json";
import type { RosterPlayer } from "../team/roster";
import type { ScheduleGame } from "../team/schedule";
import type { NflTeam } from "../team/teams";

/** Older than this, a roster or report snapshot is flagged stale. */
export const STATUS_STALE_MS = 36 * 60 * 60 * 1000;

export type StatusFreshness = "current" | "stale" | "unavailable";

export interface CurrentStatus {
  playerId: string;
  season: number;
  /** The game week the designation is for; null when no next game is known. */
  week: number | null;
  /** The official game designation for `week`, or null when none is reported. */
  designation: string | null;
  /** True when `designation` is an official game status for `week` (availability.ts `designated`). */
  designated: boolean;
  /** What the status slot says: the designation, the reserve list, "No designation (yet)". */
  label: string;
  /** The club's official report for `week`: missing, pending (no game statuses yet) or final. */
  reportState: WeekReport["state"];
  /** IR / PUP / NFI / suspension, when he is on one. */
  rosterStatus: string | null;
  /** Latest practice line this week, e.g. "DNP Wed". */
  practice: string | null;
  /** The injury the designation names, when there is one ("hamstring"). */
  injury: string | null;
  kind: AvailabilityKind | "none";
  source: "nfl-report" | "sleeper" | "reserve" | "none";
  /** A previous week's designation, kept as history, never as current. */
  prior: { week: number; status: string } | null;
  /** The club's last game, when he did not play it (a pending status's reason); else null. */
  missedWeek: number | null;
  /** When the official report for `week` was fetched (ms), or null when none is on file. */
  reportFetchedAt: number | null;
  /** When the roster snapshot (reserve lists) was pulled (ms), or null. */
  rosterFetchedAt: number | null;
  freshness: StatusFreshness;
  /** One plain sentence for the page. Always says what is NOT known. */
  message: string;
}

/** The club's next regular-season game: the first with no result that is not final. */
export function nextGameWeek(games: ScheduleGame[] | null | undefined): number | null {
  return nextGame(games)?.week ?? null;
}

function nextGame(games: ScheduleGame[] | null | undefined): ScheduleGame | null {
  const open = (games ?? [])
    .filter((g) => g.seasonType === "regular" && g.status !== "final" && g.status !== "canceled" && g.result == null)
    .sort((a, b) => a.week - b.week);
  return open[0] ?? null;
}

function reportFetchedAt(season: number, week: number, injected?: PracticeDoc | null): number | null {
  const doc = (injected as { weeks?: Record<string, { fetchedAt?: string }> } | null | undefined) ??
    readDataJson<{ weeks?: Record<string, { fetchedAt?: string }> }>(dataPath("player", "practice_reports", `${season}.json`));
  const at = doc?.weeks?.[String(week)]?.fetchedAt;
  const ms = at ? Date.parse(at) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

export interface CurrentStatusInput {
  playerId: string;
  team: NflTeam | null;
  season: number;
  /** The club's regular season, or null when the schedule could not be read. */
  games: ScheduleGame[] | null;
  /** His roster row, with Sleeper's raw injury_status. Null when the roster has none. */
  rosterRow: RosterPlayer | null;
  rosterFetchedAt: number | null;
  now: number;
  /** Injected stores, for the tests (matchup/availability.ts AvailabilityOptions). */
  deps?: Pick<AvailabilityOptions, "logs" | "practice">;
}

export function currentStatus(input: CurrentStatusInput): CurrentStatus {
  const { playerId, team, season, rosterRow, now } = input;
  const game = nextGame(input.games);
  const week = game?.week ?? null;
  const rosterFetchedAt = input.rosterFetchedAt && input.rosterFetchedAt > 0 ? input.rosterFetchedAt : null;
  const base: CurrentStatus = {
    playerId,
    season,
    week,
    designation: null,
    designated: false,
    label: NO_DESIGNATION_YET,
    reportState: "missing",
    rosterStatus: null,
    practice: null,
    injury: null,
    kind: "none",
    source: "none",
    prior: null,
    missedWeek: null,
    reportFetchedAt: week !== null ? reportFetchedAt(season, week, input.deps?.practice) : null,
    rosterFetchedAt,
    freshness: "unavailable",
    message: "No current injury information available.",
  };
  if (!team || !rosterRow) return base;

  const rosterAge = rosterFetchedAt === null ? Infinity : now - rosterFetchedAt;
  const freshness: StatusFreshness = rosterFetchedAt === null ? "unavailable" : rosterAge > STATUS_STALE_MS ? "stale" : "current";

  if (week === null) {
    // No game left (or no schedule): only a reserve list is a current status.
    const raw = (rosterRow.injuryStatus ?? "").trim();
    const reserve = gameAvailability(team, season, 99, [rosterRow], { ...input.deps, nextGame: false }).get(rosterRow.id);
    if (reserve?.kind === "reserve") {
      return { ...base, rosterStatus: raw, label: raw, kind: "reserve", source: "reserve", freshness, message: `On ${raw}.` };
    }
    return { ...base, label: "No designation", freshness, message: "No current game designation reported." };
  }

  const a = gameAvailability(team, season, week, [rosterRow], { ...input.deps, kickoffMs: game?.kickoffMs ?? null }).get(rosterRow.id);
  if (!a) return { ...base, freshness };
  const resolved = {
    label: a.label,
    reportState: a.report.state,
    reportFetchedAt: a.report.fetchedAt ?? base.reportFetchedAt,
    missedWeek: a.lastGame && !a.lastGame.played ? a.lastGame.week : null,
  };

  const priorWeek = a.lastGame?.week ?? null;
  // Sleeper's field stands in for last week's status only when no report
  // for this week is on file (the expired case); once the report has the
  // club, a Sleeper tag it does not carry is nobody's Week N-1 status.
  const priorStatus =
    a.priorStatus ?? (a.source === "none" && a.report.state === "missing" && rosterRow.injuryStatus ? rosterRow.injuryStatus : null);
  const prior = priorWeek !== null && priorStatus ? { week: priorWeek, status: cap(priorStatus) } : null;
  const injury = ((a.injury || rosterRow.injuryBodyPart) ?? "").trim().toLowerCase() || null;

  if (a.kind === "reserve") {
    return {
      ...base,
      ...resolved,
      rosterStatus: a.status,
      kind: "reserve",
      source: "reserve",
      injury,
      prior,
      freshness,
      message: `On ${a.status}${injury ? ` (${injury})` : ""}.`,
    };
  }
  if (a.kind === "pending") {
    return {
      ...base,
      ...resolved,
      practice: a.practice,
      kind: "pending",
      source: a.source,
      injury,
      prior,
      freshness,
      message: `No Week ${week} game designation reported yet. ${a.note ?? ""}`.trim(),
    };
  }
  if (a.designated && a.status) {
    return {
      ...base,
      ...resolved,
      designation: a.status,
      designated: true,
      practice: a.practice,
      kind: a.kind,
      source: a.source,
      injury,
      prior,
      freshness: a.source === "nfl-report" ? reportFreshness(resolved.reportFetchedAt, now) : freshness,
      // A Sleeper Out filed since the last game: real, but not yet on the
      // official report, and the message says so.
      message:
        a.source === "sleeper"
          ? `${a.status}${injury ? ` (${injury})` : ""}, reported after Week ${a.lastGame?.week ?? week - 1}; not yet on the official Week ${week} injury report.`
          : `${a.status} for Week ${week}${injury ? ` (${injury})` : ""}.`,
    };
  }
  if (a.status && a.status !== PENDING) {
    // A status that is neither a reserve list nor a game designation (an
    // unfamiliar Sleeper code): shown as it is, never as a game status.
    return { ...base, ...resolved, designation: a.status, kind: a.kind, source: a.source, injury, prior, freshness, message: `${a.status}.` };
  }
  // No designation. "Yet" while this week's report is missing or has no
  // game statuses: an empty feed is not a clean bill of health.
  const lead =
    a.report.state === "final"
      ? `No game designation for Week ${week}.`
      : a.report.state === "pending"
        ? `Game designation pending for Week ${week}; game statuses are not out.`
        : `Game designation pending for Week ${week}; the Week ${week} injury report is not on file.`;
  return {
    ...base,
    ...resolved,
    practice: a.practice,
    kind: "active",
    source: a.source,
    prior,
    freshness: a.report.state !== "missing" ? reportFreshness(resolved.reportFetchedAt, now) : freshness,
    message:
      lead +
      (a.practice ? ` Practice: ${a.practice}.` : "") +
      (a.source === "sleeper" && a.note ? ` ${a.note}` : prior ? ` Listed ${prior.status} for Week ${prior.week}.` : ""),
  };
}

function reportFreshness(at: number | null, now: number): StatusFreshness {
  if (at === null) return "unavailable";
  return now - at > STATUS_STALE_MS ? "stale" : "current";
}

function cap(s: string): string {
  const t = s.trim();
  return t.length <= 3 ? t.toUpperCase() : t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

/**
 * The status the page's designation slot should carry: a reserve list, else
 * the current game designation, else null. What header, Outlook, Injury tab
 * and FAQ all read (via PlayerPageData.designation).
 */
export function displayedStatus(status: CurrentStatus): string | null {
  return status.rosterStatus ?? status.designation;
}
