import app from "./app";
import { logger } from "./lib/logger";
import { runClubIngest, runIngest, wireIngestEnabled } from "./routes/news";
import { startXScheduler } from "./lib/x/scheduler";
import { startPlayerRefreshScheduler } from "./lib/player/live-refresh";
import { startWatchdog } from "./lib/watchdog";
import { loadImageVersions } from "./lib/image-versions";
// Registers the headshot resolver with the version store (import for effect).
import "./lib/image-cache";

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
  // cache listeners re-render once it has.
  loadImageVersions()
    .then((count) => logger.info({ count }, "Player image versions loaded"))
    .catch((err) => logger.warn({ err }, "Player image versions failed to load"));

  // The wire: on startup, then every 10 minutes. Not in the development
  // workspace unless asked for - see wireIngestEnabled().
  if (wireIngestEnabled()) {
    runIngest()
      .then((result) => {
        logger.info(result, "Startup ingest complete");
      })
      .catch((err) => {
        logger.error({ err }, "Startup ingest failed");
      });

    setInterval(() => {
      runIngest()
        .then((result) => {
          logger.info(result, "Scheduled ingest complete");
        })
        .catch((err) => {
          logger.error({ err }, "Scheduled ingest failed");
        });
    }, 10 * 60 * 1000);
  }

  // The 32 club feeds, on their own slower cadence.
  //
  // Half-hourly rather than every ten minutes, and deliberately not attached to
  // the traffic-triggered refresh the wire uses. One sweep is 32 outbound
  // requests to 32 independent sites; at the wire's cadence that is ~4,600 a
  // day to re-read feeds that a club updates a handful of times, and it is the
  // kind of traffic that earns an IP a rate limit. Clubs publish on a news
  // cycle, not a wire's.
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
    setInterval(clubSweep, 30 * 60 * 1000);
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
