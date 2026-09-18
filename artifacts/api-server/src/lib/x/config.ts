/**
 * Every switch the X integration has, in one file.
 *
 * All of it is read from the environment at call time rather than at module
 * load, so a value can be changed on a running process in a test without
 * reaching into module state — and so importing this file costs nothing and
 * can never throw on a deployment that has none of it set.
 */

/**
 * The master switch.
 *
 * Off by default. Absent this variable the scheduler never starts, no outbound
 * request is ever made, no route does any work, and the news tool behaves
 * exactly as it did before any of this existed. Turning it off again is a
 * restart, not a deploy.
 */
export function xIngestionEnabled(): boolean {
  const raw = (process.env["X_NEWS_INGESTION_ENABLED"] ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/**
 * Whether startup applies the seed account list.
 *
 * On by default — a fresh deployment should arrive with the reporters already
 * configured. Off is for a test, which needs the account table to contain
 * exactly the rows it put there and nothing else; 37 real handles appearing in
 * the middle of a fixture-driven run is not a seed, it is contamination.
 */
export function seedAccountsEnabled(): boolean {
  const raw = (process.env["X_SEED_ACCOUNTS"] ?? "").trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "no" || raw === "off");
}

/** Which provider to build. See lib/x/provider.ts. */
export function xProviderName(): string {
  return (process.env["X_PROVIDER"] ?? "public").trim().toLowerCase();
}

function envMs(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/**
 * How often the queue wakes up.
 *
 * The tick is short and the work per tick is small — that is what "staggered"
 * means here. Every 30 seconds the poller claims at most X_POLL_BATCH accounts
 * whose own interval has elapsed, so 37 accounts on a 5-minute interval spread
 * themselves across ten ticks instead of arriving as one burst of 37 outbound
 * requests. Nobody is checked more often for it; the same work is simply laid
 * out flat instead of stacked.
 */
export function tickIntervalMs(): number {
  return envMs("X_POLL_TICK_MS", 30_000);
}

/** Accounts claimed per tick. Small on purpose — see tickIntervalMs. */
export function pollBatchSize(): number {
  const raw = Number(process.env["X_POLL_BATCH"]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 4;
}

/**
 * How stale an account's last check must be before it is due, by priority.
 *
 * The brief's target is "roughly every 5 minutes", which is the normal lane.
 * High is for the national insiders whose posts are the ones worth having two
 * minutes sooner; low exists so an account can be kept without being paid for
 * every five minutes. All three are overridable, and the first implementation
 * deliberately does nothing cleverer than this.
 */
export function pollIntervalMs(priority: string | null | undefined): number {
  switch ((priority ?? "normal").trim().toLowerCase()) {
    case "high":
      return envMs("X_POLL_INTERVAL_HIGH_MS", 3 * 60_000);
    case "low":
      return envMs("X_POLL_INTERVAL_LOW_MS", 20 * 60_000);
    default:
      return envMs("X_POLL_INTERVAL_MS", 5 * 60_000);
  }
}

/**
 * Jitter added to each account's due time, as a fraction of its interval.
 *
 * Without it every account checked in the same tick stays in lockstep with the
 * others forever, and the stagger decays back into a burst the first time the
 * process restarts and checks everything at once. A few percent of drift is
 * enough to keep them spread.
 */
export function jitterFraction(): number {
  const raw = Number(process.env["X_POLL_JITTER"]);
  return Number.isFinite(raw) && raw >= 0 && raw < 1 ? raw : 0.15;
}

/**
 * Backoff after consecutive failures: interval * 2^failures, capped.
 *
 * An account whose profile has been renamed, or deleted, or is simply not
 * readable by this provider, must not cost a request every five minutes
 * forever. The cap keeps a recovered account from being stuck in a multi-hour
 * penalty box.
 */
export function backoffCapMs(): number {
  return envMs("X_POLL_BACKOFF_CAP_MS", 60 * 60_000);
}

/**
 * Pause between the requests inside one tick.
 *
 * Observed, not theorised: the public endpoint rate-limits by IP, and four
 * requests in under a second from this machine earned a 429 on all four. The
 * batch is checked one account at a time anyway (see runXSweep), and this
 * spreads those few requests over the front of the tick instead of firing them
 * back to back — which is what "stagger across the interval" has to mean when
 * the interval belongs to someone else's server.
 */
export function requestGapMs(): number {
  // Zero is a meaningful value here, unlike every other interval in this file —
  // it is what a test sets so a fixture-driven sweep does not spend six seconds
  // being polite to a local stub. So this reads the variable itself rather than
  // going through envMs(), whose "0 means unset" rule is right for the others.
  const raw = Number(process.env["X_POLL_REQUEST_GAP_MS"]);
  return Number.isFinite(raw) && raw >= 0 ? raw : 2_000;
}

/**
 * How long to stop polling entirely after being rate-limited.
 *
 * A 429 is not a fact about the account that happened to receive it — it is a
 * fact about this IP's budget, and backing off that one account while
 * continuing to hammer the other thirty-six with the same budget would be
 * exactly the wrong reading of it. Measured recovery was about two minutes;
 * five is the conservative version of that.
 */
export function rateLimitCooldownMs(): number {
  return envMs("X_RATE_LIMIT_COOLDOWN_MS", 5 * 60_000);
}

/** Posts requested per account per check. */
export function fetchLimit(): number {
  const raw = Number(process.env["X_FETCH_LIMIT"]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 25;
}

/**
 * Oldest post worth storing, in days.
 *
 * The public provider returns a cached slice of a timeline that can reach years
 * back (see public-provider.ts), and the archive never deletes a row. Without a
 * cutoff the very first sweep would backfill the feed with 2019 posts that
 * would then sit at the top of nothing and the bottom of everything forever.
 * Mirrors the club feeds' MAX_ITEM_AGE_DAYS, and for the same reason.
 */
export function maxPostAgeDays(): number {
  const raw = Number(process.env["X_MAX_POST_AGE_DAYS"]);
  return Number.isFinite(raw) && raw > 0 ? raw : 7;
}
