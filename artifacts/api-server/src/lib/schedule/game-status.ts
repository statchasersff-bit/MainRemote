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
 * What each source can prove. ESPN carries an explicit completion indicator
 * (`status.type.completed`, `STATUS_FINAL`) and an explicit in-progress state
 * with a read time. nflverse carries no status field at all: its data
 * dictionary says only that `away_score` / `home_score` are "NA for games
 * which haven't yet been played", and promises nothing about when during or
 * after a game they fill in. So a feed score is evidence of a final only when
 * no fresh ESPN read says the game is still going.
 *
 * Rules, in order:
 *   1. ESPN says completed: final. Prints ESPN's final word ("Final",
 *      "Final/OT") or Final/OT by period 5+ or nflverse's overtime flag - never
 *      a clock, whatever period and clock the payload still carries.
 *   2. ESPN read the game in progress within LIVE_STALE_MS: live, with ESPN's
 *      clock and ESPN's score - even if the feed already has scores, which may
 *      be partial (the feed has no completion flag to say otherwise).
 *   3. nflverse has both scores and nothing fresh contradicts it: final
 *      ("Final" / "Final/OT" by its overtime column). This is the 2026-11-19
 *      case: ESPN's last read was a 4th-quarter clock that had gone stale.
 *   4. Postponed and canceled are ESPN's status names and print as such.
 *   5. A stale in-progress read with no final anywhere: status pending.
 *   6. Not started prints the kickoff - until the kickoff is well past with
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
  /** Test seam: how old an in-progress read may be. Defaults to LIVE_STALE_MS. */
  liveStaleMs?: number;
  /** Test seam: the kickoff grace. Defaults to KICKOFF_GRACE_MS. */
  kickoffGraceMs?: number;
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

/** A final ESPN entry: completed, STATUS_FINAL, or "post" with a score and no postponement. */
function liveIsFinal(live: LiveObservation | undefined): boolean {
  if (!live) return false;
  if (live.completed || live.statusName === "STATUS_FINAL") return true;
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
  const staleMs = evidence.liveStaleMs ?? LIVE_STALE_MS;
  const graceMs = evidence.kickoffGraceMs ?? KICKOFF_GRACE_MS;

  // 1. ESPN's explicit completion.
  if (liveIsFinal(live)) {
    return {
      status: "final",
      detail: finalDetail(live, feedOvertime),
      confirmed: true,
      observedAtMs: null,
      liveScoreUsable: true,
    };
  }

  const seen = typeof live?.seenAtMs === "number" ? live.seenAtMs : null;
  const freshLive = live?.state === "in" && seen !== null && nowMs - seen <= staleMs;

  // 2. A fresh in-progress read outranks feed scores that may be partial.
  if (freshLive) {
    const detail = (live?.detail ?? "").trim();
    return {
      status: "live",
      // A clock, "Halftime", "Delayed" - whatever ESPN says while it runs.
      detail: detail || null,
      confirmed: true,
      observedAtMs: seen,
      liveScoreUsable: true,
    };
  }

  // 3. The feed's scores, with nothing fresh against them.
  if (feedFinal) {
    return {
      status: "final",
      detail: finalDetail(live, feedOvertime),
      confirmed: true,
      observedAtMs: null,
      liveScoreUsable: false,
    };
  }

  if (live?.statusName === POSTPONED) {
    return { status: "postponed", detail: "Postponed", confirmed: true, observedAtMs: null, liveScoreUsable: false };
  }
  if (live?.statusName === CANCELED) {
    return { status: "canceled", detail: "Canceled", confirmed: true, observedAtMs: null, liveScoreUsable: false };
  }

  // 5. In progress once, nobody has said anything since.
  if (live?.state === "in") {
    return { status: "live", detail: null, confirmed: false, observedAtMs: null, liveScoreUsable: false };
  }

  // 6. Not started, as far as anyone has said.
  const delayed = live?.state === "pre" && DELAYED.has(live.statusName ?? "");
  const pastKickoff = kickoffMs !== null && nowMs >= kickoffMs + graceMs;
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

/* ------------------------------------------------------- cache policy */

/** The status fields the cache policy reads. */
export interface PolicyGame extends StatusFields {
  kickoffMs: number | null;
}

/**
 * How long a rendering of these games may sit in a shared cache (WEB-040).
 *
 * - "live": a game is in progress, pending, delayed, or past its kickoff with
 *   no word yet. The words can change minute to minute.
 * - "pregame": nothing is in play, but a game is still to come. The page is
 *   good until `nextKickoffMs` - the earliest kickoff still ahead - and not a
 *   moment after; null when the games ahead have no confirmed kickoff.
 * - "settled": every game is final or canceled. A completed week's page.
 *
 * The caller decides the view: a week's games for the weekly board, the
 * whole season for the season grid.
 */
export interface CachePolicy {
  state: "live" | "pregame" | "recent" | "settled";
  nextKickoffMs: number | null;
}

/**
 * How long a final stays "recent" (WEB-040 matchup pages, 2026-11-24): the
 * first 48 hours after the game, when box scores, stat corrections and the
 * recap still land. Counted from the end estimate below, because no source
 * here records the moment a game ended.
 */
export const RECENT_FINAL_MS = 48 * 60 * 60 * 1000;

/** When a game is taken to have ended: kickoff plus a long game (overtime included). */
export const GAME_END_ESTIMATE_MS = 4 * 60 * 60 * 1000;

/** Is this final inside its first 48 hours? False without a kickoff. */
export function isRecentFinal(kickoffMs: number | null, nowMs: number): boolean {
  return kickoffMs !== null && kickoffMs + GAME_END_ESTIMATE_MS + RECENT_FINAL_MS > nowMs;
}

/**
 * A settled policy whose games include a final in its first 48 hours becomes
 * "recent": short enough at the edge (about an hour) that a stat correction or
 * a late box score reaches readers the same day, long enough that a finished
 * game costs almost nothing. Any other policy is returned unchanged.
 */
export function withRecentFinal(policy: CachePolicy, games: readonly PolicyGame[], nowMs: number): CachePolicy {
  if (policy.state !== "settled") return policy;
  const recent = games.some((game) => game.status === "final" && isRecentFinal(game.kickoffMs, nowMs));
  return recent ? { state: "recent", nextKickoffMs: null } : policy;
}

export function schedulePagePolicy(games: readonly PolicyGame[], nowMs: number): CachePolicy {
  let open = false;
  let next: number | null = null;
  for (const game of games) {
    if (game.status === "final" || game.status === "canceled") {
      if (game.statusConfirmed === false) return { state: "live", nextKickoffMs: null };
      continue;
    }
    if (game.status === "live" || game.statusConfirmed === false || game.statusDetail === "Delayed") {
      return { state: "live", nextKickoffMs: null };
    }
    open = true;
    if (game.status === "scheduled" && game.kickoffMs !== null) {
      // Kicked off, nobody has said so yet: the next read may say live.
      if (game.kickoffMs <= nowMs) return { state: "live", nextKickoffMs: null };
      if (next === null || game.kickoffMs < next) next = game.kickoffMs;
    }
  }
  return open ? { state: "pregame", nextKickoffMs: next } : { state: "settled", nextKickoffMs: null };
}
