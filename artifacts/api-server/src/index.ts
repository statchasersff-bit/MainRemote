import app from "./app";
import { logger } from "./lib/logger";
import { runClubIngest, runIngest, wireIngestEnabled } from "./routes/news";
import { startXScheduler } from "./lib/x/scheduler";
import { startPlayerRefreshScheduler } from "./lib/player/live-refresh";

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

  // The wire: on startup, then every 10 minutes. Not in the development
  // workspace unless asked for — see wireIngestEnabled().
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
  setTimeout(clubSweep, 60 * 1000);
  setInterval(clubSweep, 30 * 60 * 1000);

  // Player game logs, refreshed after each game window. Production only unless
  // SC_PLAYER_LIVE_REFRESH says otherwise; see lib/player/live-refresh.ts.
  startPlayerRefreshScheduler();

  // The X poller, if it is switched on (X_NEWS_INGESTION_ENABLED).
  //
  // Wrapped, and last, on purpose: this is the newest and least critical of the
  // three providers, and the one reading a source nobody here controls. Nothing
  // it can do — not a bad configuration, not an unreachable provider, not a
  // database it cannot read — may be allowed to stop a server that has already
  // bound its port from serving the news it already has. startXScheduler() is
  // itself written not to throw; this is the second line of that defence.
  try {
    startXScheduler();
  } catch (err) {
    logger.error({ err }, "[X INGEST] scheduler failed to start — continuing without it");
  }
});
