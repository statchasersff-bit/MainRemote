import app from "./app";
import { logger } from "./lib/logger";
import {
  CLUB_INTERVAL_MS,
  OUTLET_INTERVAL_MS,
  ROTOWIRE_INTERVAL_MS,
  WIRE_INTERVAL_MS,
  rotowireSweepEnabled,
  runClubIngest,
  runOutletIngest,
  runIngest,
  runRotowireIngest,
  wireIngestEnabled,
} from "./routes/news";
import { startXScheduler } from "./lib/x/scheduler";
import { startPlayerRefreshScheduler } from "./lib/player/live-refresh";
import { startWatchdog } from "./lib/watchdog";
import { startMemLog } from "./lib/mem-log";
import { warmRenders, warmupEnabled } from "./lib/warmup";
import { edgePrefetchEnabled, startEdgePrefetch } from "./lib/edge-prefetch";
import { liveWarmEnabled, startLiveWarm } from "./lib/live-warm";
import { loadImageVersions } from "./lib/image-versions";
import { reloadFreshness } from "./lib/freshness";
import { loadKnownNews } from "./lib/news-known";
import { ensureRuntimeTables } from "./lib/db-schema";
import { dbAccess } from "./lib/db-access";
// Registers the headshot resolver with the version store (import for effect).
import "./lib/image-cache";

/**
 * The one database visit a boot is allowed before serving: the runtime
 * tables, the headshot versions, the archive's freshness and the known-news
 * memory (lib/news-known.ts). Everything public is answered from these
 * in-memory copies afterwards, and the ingest that follows can tell a feed
 * that has not moved without a query. Each load fails on its own and says
 * so; none of them can keep the port from being served.
 */
async function restoreStartupState(): Promise<void> {
  dbAccess("startup_restore", { trigger: "boot" });
  const results = await Promise.allSettled([
    ensureRuntimeTables(),
    loadImageVersions().then((count) => logger.info({ count }, "Player image versions loaded")),
    reloadFreshness().then((f) => logger.info({ items: f.count }, "Archive freshness loaded")),
    loadKnownNews().then((keys) => logger.info({ keys }, "Known news loaded")),
  ]);
  for (const result of results) {
    if (result.status === "rejected") logger.warn({ err: result.reason }, "Startup restore step failed");
  }
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Which headshot version each player is at, from the table, so the first
  // renders after a (re)start print versioned image URLs rather than
  // redirects. Not awaited: a render before it lands prints `latest` and the
  // cache listeners re-render once it has. The same visit loads the archive's
  // freshness and the known-news memory; see restoreStartupState().
  const restored = restoreStartupState();

  // Cloudflare's copies of this build's stylesheets and bundles, asked for
  // now, while the process is idle - a visitor's browser must never be the
  // first to ask the cold origin for them (lib/edge-prefetch.ts).
  if (edgePrefetchEnabled()) {
    startEdgePrefetch().catch((err) => logger.warn({ err }, "Edge prefetch failed"));
  }

  // The live site's pages, asked for through WordPress one every 1.6 s once
  // the boot chain is done and the public origin reports this build, so the
  // page and fragment caches hold a render before a visitor asks for one
  // (lib/live-warm.ts, scripts/warm-live.mjs). A child process, not a walk
  // through our own port: the 2026-10 in-process warm-up is off for a reason.
  if (liveWarmEnabled()) {
    startLiveWarm().catch((err) => logger.warn({ err }, "Live warm crawl failed"));
  }

  // The hot renders, one at a time through our own port, once the headshot
  // versions and the news freshness are in memory (lib/warmup.ts). The club
  // sweep and the builders wait for it below.
  const warmed: Promise<unknown> = warmupEnabled()
    ? restored.then(() => warmRenders(port))
    : Promise.resolve();

  // The wire: on startup, then every ROTOWIRE_INTERVAL_MS (ten minutes). Not
  // in the development workspace unless asked for - see wireIngestEnabled().
  // The startup run waits for the restore so that a note the archive already
  // holds is recognized from memory rather than looked up (and keeps the time
  // it has - see lib/rotowire-news.ts).
  //
  // Since 2026-11-05 the sweep of RotoWire's team pages is the wire, and the
  // Dynasty Command relay (runIngest) is its fallback: only when the sweep
  // itself fails - RotoWire unreachable, the page template changed - is the
  // relay read, so the archive keeps moving on the relay's thinner feed
  // rather than stopping. WIRE_INTERVAL_MS no longer drives a timer.
  const relayRead = (label: string) =>
    runIngest()
      .then((result) => {
        logger.info(result, `${label} ingest complete`);
      })
      .catch((err) => {
        logger.error({ err }, `${label} ingest failed`);
      });

  const sweepRead = (label: string) => {
    runRotowireIngest()
      .then((result) => {
        logger.info(result, `${label} RotoWire sweep complete`);
      })
      .catch((err) => {
        logger.error({ err }, `${label} RotoWire sweep failed; reading the relay instead`);
        return relayRead(label);
      });
  };

  // SC_ROTOWIRE_SWEEP=0: the relay alone, at its own cadence, as before.
  const sweeping = rotowireSweepEnabled();
  const wireRead = sweeping ? sweepRead : relayRead;

  if (wireIngestEnabled()) {
    void restored.then(() => wireRead("Startup"));
    setInterval(() => wireRead("Scheduled"), sweeping ? ROTOWIRE_INTERVAL_MS : WIRE_INTERVAL_MS);
  }

  // The 32 club feeds, on their own slower cadence.
  //
  // Hourly (CLUB_INTERVAL_MS), and deliberately not attached to the wire's
  // timer. One sweep is 32 outbound requests to 32 independent sites; at the
  // wire's cadence that is thousands a day to re-read feeds that a club
  // updates a handful of times, and it is the kind of traffic that earns an
  // IP a rate limit. Clubs publish on a news cycle, not a wire's.
  const clubSweep = () => {
    runClubIngest()
      .then((result) => {
        logger.info(result, "Scheduled club news sweep complete");
      })
      .catch((err) => {
        logger.error({ err }, "Scheduled club news sweep failed");
      });
  };

  // Not at startup alongside the wire: a cold start is already fetching the
  // feed, the roster index and the team pages' providers, and 32 more requests
  // in that same second is the worst moment to spend them. A minute later the
  // process is idle and nobody is waiting.
  //
  // Same switch as the wire. The workspace sweeping too doubled what the 32
  // clubs saw from us, for a dev database nobody reads the club lane of.
  // POST /api/ingest/clubs still runs one by hand.
  //
  // Since 2026-10-21 the minute is a floor: the sweep also waits for the boot
  // warm-up, which is the process's busiest stretch now, capped at five
  // minutes so a slow warm-up cannot hold the clubs' news back.
  if (wireIngestEnabled()) {
    const minute = new Promise((resolve) => setTimeout(resolve, 60 * 1000));
    const cap = new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
    void Promise.all([minute, Promise.race([warmed, cap])]).then(clubSweep);
    setInterval(clubSweep, CLUB_INTERVAL_MS);
  }

  // The national outlets (ProFootballTalk, Yahoo Sports, CBS Sports;
  // lib/outlet-news.ts): three RSS feeds, every half hour, behind the same
  // switch and the same post-boot delay as the clubs.
  const outletSweep = () => {
    runOutletIngest()
      .then((result) => {
        logger.info(result, "Scheduled national outlet sweep complete");
      })
      .catch((err) => {
        logger.error({ err }, "Scheduled national outlet sweep failed");
      });
  };
  if (wireIngestEnabled()) {
    const minutes = new Promise((resolve) => setTimeout(resolve, 2 * 60 * 1000));
    void minutes.then(outletSweep);
    setInterval(outletSweep, OUTLET_INTERVAL_MS);
  }

  // Player game logs, refreshed after each game window. Production only unless
  // SC_PLAYER_LIVE_REFRESH says otherwise; see lib/player/live-refresh.ts. Its
  // first run waits for the warm-up, and it warms the renders again after a
  // refresh has reloaded the data from under them.
  startPlayerRefreshScheduler({
    afterBoot: warmed,
    rewarm: warmupEnabled() ? () => warmRenders(port) : undefined,
  });

  // The inbound-route watchdog: the 10-01/10-02 outages were Replit's proxy
  // losing this VM while the process stayed healthy, so the app probes its own
  // public URL and restarts itself when inbound goes dark. Production only;
  // see lib/watchdog.ts.
  startWatchdog(port);

  // One stderr line every ten minutes with the process's size against V8's
  // heap ceiling and the VM's headroom (lib/mem-log.ts): the trend the
  // 10-21/10-22 deaths never left behind.
  startMemLog();

  // The X poller, if it is switched on (X_NEWS_INGESTION_ENABLED).
  //
  // Wrapped, and last, on purpose: this is the newest and least critical of the
  // three providers, and the one reading a source nobody here controls. Nothing
  // it can do - not a bad configuration, not an unreachable provider, not a
  // database it cannot read - may be allowed to stop a server that has already
  // bound its port from serving the news it already has. startXScheduler() is
  // itself written not to throw; this is the second line of that defense.
  try {
    startXScheduler();
  } catch (err) {
    logger.error({ err }, "[X INGEST] scheduler failed to start - continuing without it");
  }
});
