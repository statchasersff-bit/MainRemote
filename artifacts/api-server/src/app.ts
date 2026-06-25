import express, { type Express, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import router from "./routes";
import embedRouter from "./routes/embed";
import { logger } from "./lib/logger";
import { setupLiveReload } from "./lib/livereload";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API routes
app.use("/api", router);

// Copy-paste embed snippet page (/embed and /embed.txt). Mounted before the
// static/SPA fallback so it isn't swallowed by the index.html catch-all.
app.use(embedRouter);

// Serve static frontend files
const publicDir = path.resolve(__dirname, "..", "public");

// Development-only live reload: watches publicDir and refreshes the browser.
const liveReload = setupLiveReload(app, publicDir);

function sendIndexHtml(res: Response) {
  const indexPath = path.join(publicDir, "index.html");
  if (!liveReload.enabled) {
    res.sendFile(indexPath);
    return;
  }
  fs.readFile(indexPath, "utf8", (err, html) => {
    if (err) {
      res.status(500).send("index.html not found");
      return;
    }
    res.type("html").send(liveReload.injectIntoHtml(html));
  });
}

// In development, serve index.html with the live-reload client injected.
if (liveReload.enabled) {
  app.get(["/", "/index.html"], (_req, res) => sendIndexHtml(res));
}

app.use(express.static(publicDir));

// Fallback to index.html for any non-API route
app.use((_req, res) => sendIndexHtml(res));

export default app;
