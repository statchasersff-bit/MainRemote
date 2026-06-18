import app from "./app";
import { logger } from "./lib/logger";
import { runIngest } from "./routes/news";

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

  // Run ingest on startup
  runIngest()
    .then((result) => {
      logger.info(result, "Startup ingest complete");
    })
    .catch((err) => {
      logger.error({ err }, "Startup ingest failed");
    });

  // Re-run every 10 minutes
  setInterval(() => {
    runIngest()
      .then((result) => {
        logger.info(result, "Scheduled ingest complete");
      })
      .catch((err) => {
        logger.error({ err }, "Scheduled ingest failed");
      });
  }, 10 * 60 * 1000);
});
