/**
 * The polling queue's clock, and the state /api/status reports.
 *
 * Small on purpose. The queue itself is the claim in the database (see
 * claimDueAccounts) — not a list held in this process — so this file owns only
 * three things: a timer, a guard against a tick overlapping itself, and a
 * record of how the last tick went.
 *
 * That split is what makes a restart uneventful. Nothing here is state worth
 * keeping: on a cold start the timer begins again, the first tick asks the
 * database what is due, and the database's answer already accounts for whatever
 * the previous process managed to do before it died. No queue to drain, no
 * cursor to recover, and no post processed twice for having been in flight.
 */

import { logger } from "../logger";
import { runXSweep, type XSweepResult } from "./ingest";
import { enabledAccountCount, seedAccounts } from "./accounts";

/**
 * Roughly how many accounts the free public provider can carry before its rate
 * limit starts refusing sweeps. A guide for the warning below, not a cap: the
 * operator's watchlist is the operator's to decide.
 */
const PUBLIC_PROVIDER_SAFE_ACCOUNTS = 8;
import {
  seedAccountsEnabled,
  tickIntervalMs,
  xIngestionEnabled,
  xProviderName,
} from "./config";

interface SchedulerState {
  running: boolean;
  startedAtMs: number | null;
  lastTickMs: number | null;
  lastResult: XSweepResult | null;
  lastError: string | null;
  ticks: number;
  postsStored: number;
  consecutiveTickErrors: number;
}

const state: SchedulerState = {
  running: false,
  startedAtMs: null,
  lastTickMs: null,
  lastResult: null,
  lastError: null,
  ticks: 0,
  postsStored: 0,
  consecutiveTickErrors: 0,
};

/**
 * Guard against a tick starting while the previous one is still going.
 *
 * A tick is bounded by its batch size and each fetch has a timeout, so this
 * should not happen — but "should not" and "cannot" differ by one slow network,
 * and overlapping ticks would double the outbound traffic at exactly the moment
 * the far end is already struggling.
 */
let inFlight = false;
let timer: NodeJS.Timeout | null = null;

export function xSchedulerStatus(): SchedulerState & {
  enabled: boolean;
  provider: string;
} {
  return {
    ...state,
    enabled: xIngestionEnabled(),
    provider: xProviderName(),
  };
}

/** Run one tick now, whatever the timer is doing. Never throws. */
export async function tick(): Promise<XSweepResult | null> {
  if (inFlight) return null;
  inFlight = true;

  try {
    const result = await runXSweep();
    state.lastTickMs = Date.now();
    state.lastResult = result;
    state.ticks++;
    state.postsStored += result.stored;
    state.consecutiveTickErrors = 0;

    // Quiet by design. A tick that found nothing is the normal case — 37
    // reporters do not all post every five minutes — and logging each one would
    // bury the lines that matter under ~2,800 a day. Per-post and per-failure
    // lines are logged where they happen, in lib/x/ingest.ts.
    if (result.cooldownMs) {
      state.lastError = `rate limited — polling paused for ${Math.round(result.cooldownMs / 1000)}s`;
    } else if (result.stored > 0 || result.errors > 0) {
      logger.info(
        {
          checked: result.checked,
          stored: result.stored,
          errors: result.errors,
        },
        "[X INGEST] sweep complete",
      );
    }

    return result;
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : String(err);
    state.consecutiveTickErrors++;
    // runXSweep already swallows everything it can; reaching here means
    // something unforeseen. Logged once per crossing rather than per tick, the
    // way the wire's ingest alert is, so a persistent fault does not become
    // noise that gets scrolled past.
    if (state.consecutiveTickErrors === 3) {
      logger.error(
        { lastError: state.lastError },
        "[X INGEST] three consecutive tick failures — X ingestion is not working",
      );
    }
    return null;
  } finally {
    inFlight = false;
  }
}

/**
 * Start the poller, if it is switched on.
 *
 * Returns whether it started, and never throws: this is called from the
 * server's listen callback, and an X integration that cannot start must not be
 * able to stop the news tool from serving. The same reasoning as the club
 * sweep's delayed first run applies to the initial delay — a cold start is
 * already fetching the wire, the roster and the club feeds, and this can wait
 * for the process to be idle.
 */
export function startXScheduler(): boolean {
  if (timer) return true;

  if (!xIngestionEnabled()) {
    logger.info(
      "[X INGEST] disabled (set X_NEWS_INGESTION_ENABLED=true to enable)",
    );
    return false;
  }

  state.running = true;
  state.startedAtMs = Date.now();

  // Seeding is additive and idempotent (see seedAccounts) and must not block
  // or break startup, so it is fire-and-forget with its own catch.
  if (seedAccountsEnabled()) {
    seedAccounts().catch((err: unknown) => {
      logger.error({ err }, "[X INGEST] could not seed monitored accounts");
    });
  }

  // The free provider's measured ceiling, said out loud at startup.
  //
  // syndication.twitter.com rate-limits by IP, and hard: from this deployment,
  // twelve requests spaced NINE SECONDS apart were all refused with 429, while
  // an occasional single request succeeds. So the public route can carry a
  // handful of reporters at a slow cadence and cannot carry a full watchlist at
  // any cadence. An operator who turns this on with 37 accounts and the default
  // provider would otherwise learn that from a wall of failures.
  if (xProviderName() === "public") {
    enabledAccountCount()
      .then((count) => {
        if (count > PUBLIC_PROVIDER_SAFE_ACCOUNTS) {
          logger.warn(
            { enabled: count, safeLimit: PUBLIC_PROVIDER_SAFE_ACCOUNTS },
            "[X INGEST] the free public provider will be rate-limited at this many accounts — " +
              "disable some, raise X_POLL_INTERVAL_MS, or set X_PROVIDER=api (see docs/x-ingestion.md)",
          );
        }
      })
      .catch(() => {
        /* advisory only — never a reason to fail startup */
      });
  }

  const interval = tickIntervalMs();

  timer = setInterval(() => {
    void tick();
  }, interval);
  // Never hold the process open for a poll: if everything else has finished,
  // the right thing is to exit, not to wait for the next tick.
  timer.unref?.();

  logger.info(
    { intervalMs: interval, provider: xProviderName() },
    "[X INGEST] scheduler started",
  );

  return true;
}

/** Stop the poller. For tests and for a clean shutdown. */
export function stopXScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  state.running = false;
}
