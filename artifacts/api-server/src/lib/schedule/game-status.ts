/**
 * Where a game stands, decided once, from the evidence the schedule holds.
 *
 * Two sources speak to it. nflverse's games.csv carries a final score once the
 * game is over (hours after the whistle) and an `overtime` flag. ESPN's
 * scoreboard - the live layer - carries a state ("pre", "in", "post"), a
 * completion flag, a period, and a display string that is a clock while the
 * game runs ("12:04 - 4th") and a word after it ("Final", "Final/OT").
 *
 * WEB-040, 2026-11-19: IND @ HOU finished 3-26 and the Week 11 board printed
 * the right score beside "12:04 - 4TH". The layer had last reached ESPN with
 * the game in the fourth quarter and then stopped reaching it; nflverse posted
 * the final; the status became "final" from the feed while the display string
 * was still the layer's last clock. A score is not evidence of the status and
 * neither is a clock: the status is decided here, and the detail printed is
 * only ever one that agrees with it.
 *
 * Rules, in order:
 *   1. Final, from either source, prints "Final" - or "Final/OT" when ESPN's
 *      own final word, its period (5+), or nflverse's overtime flag says so.
 *      Never a clock, whatever period and clock the payload still carries.
 *   2. Postponed and canceled are ESPN's status names and print as such.
 *   3. In progress prints ESPN's detail (clock, "Halftime", "Delayed") only
 *      while the observation is fresh. An "in" entry nobody has refreshed for
 *      LIVE_STALE_MS is not evidence the game is still on, nor of its clock.
 *   4. Not started prints the kickoff - until the kickoff is well past with
 *      no source saying the game began, when the honest answer is neutral.
 *
 * Pure: no I/O, no clock of its own. Shared by the season grid, the weekly
 * board and the team hubs through schedule-data.ts's normalize().
 */

/**
 * Where a game stands.
 *
 * "postponed" and "canceled" come from ESPN's status (STATUS_POSTPONED,
 * STATUS_CANCELED); nflverse carries neither, so without the live layer a
 * postponed game reads as scheduled until the feed moves its date.
 */
export type GameStatus = "scheduled" | "live" | "final" | "postponed" | "canceled";

/**
 * How long an in-progress observation is trusted. The layer refreshes every
 * 30 seconds while a game is live, so ten minutes is twenty missed sweeps -
 * ESPN refusing this host, not a slow refresh.
 */
export const LIVE_STALE_MS = 10 * 60 * 1000;

/**
 * How long after kickoff a game nobody has reported on still shows its
 * kickoff. The idle layer refreshes every 15 minutes, so a game can sit "pre"
 * that long after it started without anything being wrong.
 */
export const KICKOFF_GRACE_MS = 20 * 60 * 1000;

/** The neutral word for a game whose status no source currently vouches for. */
export const STATUS_PENDING_LABEL = "Status pending";

/** ESPN status names this module reads. Anything else is carried by `state`. */
const POSTPONED = "STATUS_POSTPONED";
const CANCELED = "STATUS_CANCELED";
const DELAYED = new Set(["STATUS_DELAYED", "STATUS_RAIN_DELAY"]);

/** What the live layer saw of a game. Every field may be missing. */
export interface LiveObservation {
  state: "pre" | "in" | "post";
  completed: boolean;
  detail: string | null;
  /** ESPN's period: 1-4 regulation, 5+ overtime. Null when not recorded. */
  period?: number | null;
  /** ESPN's status name, kept only for the names this module reads. */
  statusName?: string | null;
  /** When this host last fetched the entry from ESPN. Null for an old entry. */
  seenAtMs?: number | null;
  awayScore?: number | null;
}

export interface StatusEvidence {
  /** nflverse has both scores for the game. */
  feedFinal: boolean;
  /** nflverse's overtime column says 1. */
  feedOvertime: boolean;
  live: LiveObservation | undefined;
  kickoffMs: number | null;
  nowMs: number;
}

export interface ResolvedStatus {
  status: GameStatus;
  /** The detail to print, already consistent with `status`; null for a kickoff. */
  detail: string | null;
  /**
   * False when the status is the last thing anyone knew rather than what is
   * known now: a stale in-progress entry, or a kickoff well past with no word.
   */
  confirmed: boolean;
  /** For a confirmed in-progress game: when its clock was read. */
  observedAtMs: number | null;
  /** The live layer's score may be shown: it is current, or it is a final. */
  liveScoreUsable: boolean;
}

/** A final ESPN entry: completed, or "post" with a score and no postponement. */
function liveIsFinal(live: LiveObservation | undefined): boolean {
  if (!live) return false;
  if (live.completed) return true;
  if (live.state !== "post") return false;
  if (live.statusName === POSTPONED || live.statusName === CANCELED) return false;
  return live.awayScore !== null && live.awayScore !== undefined;
}

/**
 * "Final" or "Final/OT". ESPN's own word is kept when it is a final word
 * ("Final/OT", "Final/2OT"); a clock is never a final word.
 */
export function finalDetail(live: LiveObservation | undefined, feedOvertime: boolean): string {
  const word = (live?.detail ?? "").trim();
  if (live && liveIsFinal(live) && /^final\b/i.test(word)) {
    return word.replace(/^final/i, "Final");
  }
  if (live && liveIsFinal(live) && typeof live.period === "number" && live.period >= 5) {
    return "Final/OT";
  }
  return feedOvertime ? "Final/OT" : "Final";
}

export function resolveGameStatus(evidence: StatusEvidence): ResolvedStatus {
  const { feedFinal, feedOvertime, live, kickoffMs, nowMs } = evidence;

  if (feedFinal || liveIsFinal(live)) {
    return {
      status: "final",
      detail: finalDetail(live, feedOvertime),
      confirmed: true,
      observedAtMs: null,
      liveScoreUsable: liveIsFinal(live),
    };
  }

  if (live?.statusName === POSTPONED) {
    return { status: "postponed", detail: "Postponed", confirmed: true, observedAtMs: null, liveScoreUsable: false };
  }
  if (live?.statusName === CANCELED) {
    return { status: "canceled", detail: "Canceled", confirmed: true, observedAtMs: null, liveScoreUsable: false };
  }

  if (live?.state === "in") {
    const seen = typeof live.seenAtMs === "number" ? live.seenAtMs : null;
    const fresh = seen !== null && nowMs - seen <= LIVE_STALE_MS;
    const detail = (live.detail ?? "").trim();
    return fresh
      ? {
          status: "live",
          // A clock, "Halftime", "Delayed" - whatever ESPN says while it runs.
          detail: detail || null,
          confirmed: true,
          observedAtMs: seen,
          liveScoreUsable: true,
        }
      : { status: "live", detail: null, confirmed: false, observedAtMs: null, liveScoreUsable: false };
  }

  // Not started, as far as anyone has said.
  const delayed = live?.state === "pre" && DELAYED.has(live.statusName ?? "");
  const pastKickoff = kickoffMs !== null && nowMs >= kickoffMs + KICKOFF_GRACE_MS;
  return {
    status: "scheduled",
    detail: delayed ? "Delayed" : null,
    confirmed: delayed || !pastKickoff,
    observedAtMs: null,
    liveScoreUsable: false,
  };
}

/** The status fields of a game, as the renderers hold them. */
export interface StatusFields {
  status: GameStatus;
  statusDetail: string | null;
  /** Absent means confirmed: games built outside normalize() carry none. */
  statusConfirmed?: boolean;
}

/**
 * The words for a game that is not a kickoff, or null when the kickoff is
 * the right thing to print. Title case; callers that shout uppercase it.
 */
export function gameStatusLabel(game: StatusFields): string | null {
  if (game.statusConfirmed === false) return STATUS_PENDING_LABEL;
  switch (game.status) {
    case "final":
      return game.statusDetail ?? "Final";
    case "live":
      return game.statusDetail ?? "Live";
    case "postponed":
      return "Postponed";
    case "canceled":
      return "Canceled";
    default:
      return game.statusDetail;
  }
}
