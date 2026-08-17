import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import router from "./routes";
import embedRouter from "./routes/embed";
import { logger } from "./lib/logger";
import { setupLiveReload } from "./lib/livereload";
import { renderAppPage } from "./lib/ssr";
import { canonicalUrl } from "./lib/request";
import { linkTemplatesFromEnv, relatedLinksFromEnv } from "./lib/links";
import { contentVersion, freshness } from "./lib/freshness";

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

/**
 * Send the app shell with the news list already rendered into it.
 *
 * The page used to ship an empty <div> plus a spinner and let the browser fetch
 * the list, which meant a crawler received a page with no content on it. Now
 * the HTML that leaves here contains every headline, player, timestamp and
 * link; the client bundle only enhances what is already there.
 */
async function sendIndexHtml(req: Request, res: Response) {
  try {
    // Validators derived from the content itself, so a repeat visit revalidates
    // to a 304 instead of re-downloading ~95KB. contentVersion() changes only
    // when the news does — see lib/freshness.ts.
    const { changedAtMs } = freshness();
    res.set("ETag", `W/"${contentVersion()}"`);
    if (changedAtMs) {
      res.set("Last-Modified", new Date(changedAtMs).toUTCString());
    }
    if (req.fresh) {
      res.status(304).end();
      return;
    }

    // Canonical is built from the path alone — see lib/request.ts. Tool state
    // in the query string must never produce a different canonical.
    // Entity/related links come from the environment and are empty unless the
    // operator has configured pages that actually exist (see lib/links.ts).
    let html = await renderAppPage(publicDir, {
      canonical: canonicalUrl(req),
      links: linkTemplatesFromEnv(),
      relatedLinks: relatedLinksFromEnv(),
    });
    if (liveReload.enabled) html = liveReload.injectIntoHtml(html);
    res
      // The rendered list changes as news is ingested, so let shared caches
      // hold it only briefly and revalidate.
      .set("Cache-Control", "public, max-age=60")
      // Keep the bare tool URL from ranking on its own while still letting
      // Google use it when embedded in a StatChasers page. Mirrors the meta
      // tag in public/index.html; the header also covers non-HTML consumers.
      .set("X-Robots-Tag", "noindex, indexifembedded")
      .type("html")
      .send(html);
  } catch (err) {
    logger.error({ err }, "Failed to render index.html");
    res.status(500).type("html").send("<!doctype html><title>Error</title>");
  }
}

app.get(["/", "/index.html"], (req, res) => {
  void sendIndexHtml(req, res);
});

app.use(express.static(publicDir));

/**
 * Anything else is a 404 — deliberately.
 *
 * This used to fall back to index.html, which meant every URL on the host
 * returned a byte-identical 200: /anything, /nfl/foo, /?position=RB&scoring=ppr
 * were all the same page. That is an unbounded duplicate URL space of exactly
 * the kind that filter/sort parameters are notorious for creating, and it hands
 * a crawler infinite equivalent pages to work through. The app is a single
 * page; it lives at "/" and nowhere else.
 */
app.use((_req, res) => {
  res
    .status(404)
    .set("X-Robots-Tag", "noindex")
    .type("html")
    .send(
      `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />` +
        `<meta name="robots" content="noindex" />` +
        `<title>Not found</title></head><body>` +
        `<h1>Not found</h1><p><a href="/">Go to the news tool</a></p>` +
        `</body></html>`,
    );
});

export default app;
