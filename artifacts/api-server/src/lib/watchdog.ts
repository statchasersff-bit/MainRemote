/**
 * Detects the outage the platform does not: inbound dead, process fine.
 *
 * Twice now (2026-10-01, 2026-10-02) the deployment stopped answering inbound
 * requests while the process itself kept working - the 10-02 VM ran its 13:00
 * UTC corrections refresh, nflverse downloads and database writes included,
 * four hours into an outage that began around 09:00. Replit's proxy had lost
 * the route to the VM; nothing inside the app failed, so nothing inside the
 * app said a word, and the site stayed down until a human noticed and
 * republished.
 *
 * This is the app noticing for itself. Every five minutes it asks for its own
 * /api/healthz twice:
 *
 *   - through the deployment's own *.replit.app address (SC_SELF_URL) - the
 *     Replit proxy route, with nothing in front of it. During the 10-02
 *     outage this exact probe failed from the workspace, so it is known to
 *     exercise the broken route. Deliberately NOT the public name
 *     (news.statchasers.com, lib/request.ts): that sits behind Cloudflare,
 *     which can challenge this VM's egress address or have a bad day of its
 *     own, and neither is something a restart here can cure;
 *   - through 127.0.0.1 - the app itself, no proxy involved.
 *
 * Local up + public down, three probes running (~15 minutes), is the
 * signature of both outages, and the response is to say so loudly on stderr -
 * the only stream the deployment's Logs pane shows (see refreshNote in
 * live-refresh.ts) - and exit, so the supervisor restarts the process. A
 * restart may or may not re-establish the proxy route (both incidents were
 * cured by a full republish), but it is the strongest self-help available
 * from inside the VM, and a repeating [watchdog] exit line in the pane turns
 * a silent outage into a labelled, timestamped one.
 *
 * Local down too is not the proxy's fault - the app is wedged - and exiting
 * for a restart is then simply correct.
 *
 * Deliberately quiet while healthy: one line at startup, then lines only when
 * a probe fails or the state changes back. Production only, like the player
 * refresh; SC_WATCHDOG=0 turns it off entirely, SC_WATCHDOG_RESTART=0 keeps
 * the stderr lines but never exits.
 */

const PROBE_INTERVAL_MS = 5 * 60 * 1000;
/** Per request. Generous: a healthy cold cache answers healthz in well under a second. */
const PROBE_TIMEOUT_MS = 20 * 1000;
/** Consecutive public failures before the exit. Three = ~15 minutes down. */
const EXIT_AFTER_FAILURES = 3;
/** First probe: clear of the cold start, which is slow for honest reasons. */
const FIRST_PROBE_DELAY_MS = 3 * 60 * 1000;

function note(line: string): void {
  process.stderr.write(`[watchdog] ${new Date().toISOString()} ${line}\n`);
}

function flag(name: string, fallback: boolean): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return fallback;
}

export function watchdogEnabled(): boolean {
  return flag("SC_WATCHDOG", process.env["NODE_ENV"] === "production");
}

function publicOrigin(): string {
  const raw = (process.env["SC_SELF_URL"] ?? "https://newsfeed.replit.app").trim();
  return raw.replace(/\/+$/, "");
}

/** "ok" | short failure description. Any 2xx–4xx proves the route works; only no-answer counts. */
async function probe(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { "cache-control": "no-cache" },
    });
    if (res.status >= 500) return `answered ${res.status}`;
    await res.arrayBuffer();
    return "ok";
  } catch (err) {
    return err instanceof Error ? (err.name === "TimeoutError" ? "timed out" : err.message) : String(err);
  }
}

export interface WatchdogDeps {
  probe: (url: string) => Promise<string>;
  exit: (code: number) => void;
  note: (line: string) => void;
}

/** One probe cycle's counters, kept across ticks. Exported shape for the test. */
export interface WatchdogState {
  publicFailures: number;
}

/**
 * One tick: probe both routes, keep the failure count, exit on the third
 * consecutive public failure. Separated from the timer and injectable so the
 * test can run outages without a clock or a network.
 */
export async function watchdogTick(
  state: WatchdogState,
  port: number,
  deps: WatchdogDeps = { probe, exit: (code) => process.exit(code), note },
): Promise<void> {
  const publicUrl = `${publicOrigin()}/api/healthz`;
  const [viaProxy, viaLocal] = await Promise.all([
    deps.probe(publicUrl),
    deps.probe(`http://127.0.0.1:${port}/api/healthz`),
  ]);

  if (viaProxy === "ok") {
    if (state.publicFailures > 0) {
      deps.note(`recovered: public route answering again after ${state.publicFailures} failed probe(s)`);
    }
    state.publicFailures = 0;
    return;
  }

  state.publicFailures += 1;
  deps.note(
    `public route FAILED (${state.publicFailures}/${EXIT_AFTER_FAILURES}): ${publicUrl} ${viaProxy}; localhost ${
      viaLocal === "ok" ? "ok - inbound-only failure, the proxy has lost this VM" : `also failing (${viaLocal}) - the app is wedged`
    }`,
  );

  if (state.publicFailures < EXIT_AFTER_FAILURES) return;
  if (!flag("SC_WATCHDOG_RESTART", true)) {
    deps.note("restart disabled (SC_WATCHDOG_RESTART=0); staying up");
    return;
  }
  deps.note(
    `exiting for a supervisor restart: inbound unreachable for ${EXIT_AFTER_FAILURES} consecutive probes (~${Math.round((EXIT_AFTER_FAILURES * PROBE_INTERVAL_MS) / 60000)} minutes). If this line repeats, the restart did not heal the route - republish the deployment.`,
  );
  deps.exit(1);
}

export function startWatchdog(port: number): void {
  if (!watchdogEnabled()) return;
  const state: WatchdogState = { publicFailures: 0 };
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    watchdogTick(state, port)
      .catch((err) => note(`tick failed: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => {
        running = false;
      });
  };
  note(`watching ${publicOrigin()}/api/healthz every ${PROBE_INTERVAL_MS / 60000} minutes`);
  setTimeout(run, FIRST_PROBE_DELAY_MS).unref();
  setInterval(run, PROBE_INTERVAL_MS).unref();
}
