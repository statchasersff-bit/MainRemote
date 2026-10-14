import app from "./app";
import { logger } from "./lib/logger";
import {
  CLUB_INTERVAL_MS,
  WIRE_INTERVAL_MS,
  runClubIngest,
  runIngest,
  wireIngestEnabled,
} from "./routes/news";
import { startXScheduler } from "./lib/x/scheduler";
import { startPlayerRefreshScheduler } from "./lib/player/live-refresh";
import { startWatchdog } from "./lib/watchdog";
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

  // The wire: on startup, then every WIRE_INTERVAL_MS (twenty minutes). Not
  // in the development workspace unless asked for - see wireIngestEnabled().
  // The startup run waits for the restore so that a feed which has not moved
  // since the last process is recognized from memory rather than looked up.
  if (wireIngestEnabled()) {
    void restored.then(() =>
      runIngest()
        .then((result) => {
          logger.info(result, "Startup ingest complete");
        })
        .catch((err) => {
          logger.error({ err }, "Startup ingest failed");
        }),
    );

    setInterval(() => {
      runIngest()
        .then((result) => {
          logger.info(result, "Scheduled ingest complete");
        })
        .catch((err) => {
          logger.error({ err }, "Scheduled ingest failed");
        });
    }, WIRE_INTERVAL_MS);
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
  if (wireIngestEnabled()) {
    setTimeout(clubSweep, 60 * 1000);
    setInterval(clubSweep, CLUB_INTERVAL_MS);
  }

  // Player game logs, refreshed after each game window. Production only unless
  // SC_PLAYER_LIVE_REFRESH says otherwise; see lib/player/live-refresh.ts.
  startPlayerRefreshScheduler();

  // The inbound-route watchdog: the 10-01/10-02 outages were Replit's proxy
  // losing this VM while the process stayed healthy, so the app probes its own
  // public URL and restarts itself when inbound goes dark. Production only;
  // see lib/watchdog.ts.
  startWatchdog(port);

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
