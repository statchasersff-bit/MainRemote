import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import router from "./routes";
import embedRouter from "./routes/embed";
import teamRouter from "./routes/team";
import { matchupRouter } from "./routes/matchup";
import playerRouter from "./routes/player";
import fpaRouter from "./routes/fpa";
import rankingsRouter from "./routes/rankings";
import previewRouter from "./routes/preview";
import xRouter from "./routes/x";
import { refreshIfStale } from "./routes/news";
import { logger } from "./lib/logger";
import { setupLiveReload } from "./lib/livereload";
import { renderAppPage } from "./lib/ssr";
import { canonicalUrl } from "./lib/request";
import { linkTemplatesFromEnv, relatedLinksFromEnv } from "./lib/links";
import { devBarEnabled, injectDevBar } from "./lib/devbar";
import { contentVersion, ensureFreshness, freshness } from "./lib/freshness";

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

// Keep the archive moving on a deployment that idles between requests, where
// the in-process refresh timer never gets to fire. Hung off "finish" so it runs
// after the response has been written and can never add latency to it, and
// throttled inside refreshIfStale() so this costs one ingest per ten minutes
// however much traffic arrives.
app.use((_req, res, next) => {
  res.on("finish", refreshIfStale);
  next();
});

// API routes
app.use("/api", router);

// Copy-paste embed snippet page (/embed and /embed.txt). Mounted before the
// static/SPA fallback so it isn't swallowed by the index.html catch-all.
app.use(embedRouter);

// NFL Team Hub: /team, /team/:slug and the /embed/team/:slug fragment. Mounted
// here for the same reason as the embed router — the 404 at the bottom of this
// file is deliberate and catches everything that gets past the routes above.
// It changes nothing about "/", which is still the news tool and nothing else.
app.use(teamRouter);

// Matchup pages: /nfl/<a>-vs-<b>/ and /embed/matchup/<a>-vs-<b>.
app.use(matchupRouter);

// NFL Player Pages: /player, /player/:slug and the /embed/player/:slug
// fragment. Mounted alongside the team router for the same reason — the 404 at
// the bottom of this file is deliberate and catches everything the routes above
// do not claim. It changes nothing about "/", which is still the news tool.
app.use(playerRouter);

// Fantasy Points Allowed: /fpa, /fpa/download.csv and the /embed/fpa fragment.
// Mounted alongside the other two tools, for the same reason.
app.use(fpaRouter);

// Redraft Rankings: /rankings, /rankings/download.csv and the /embed/rankings
// fragment. Mounted alongside the other tools, for the same reason.
app.use(rankingsRouter);

// Shortcode preview harness (/preview/*). Development only — the router's own
// first middleware 404s the whole thing outside development.
app.use(previewRouter);

// The X integration's API (/api/x/...) and its admin page (/admin/x). Mounted
// here for the same reason as the routers above — the 404 at the bottom of this
// file catches everything that gets past them. Mounting it costs nothing when
// the integration is switched off: the routes exist, the poller does not run,
// and /api/x/status says so.
app.use(xRouter);

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
    // when the news does — see lib/freshness.ts. The load has to complete before
    // the ETag is read, or a cold server would answer with a version string that
    // does not describe what it is about to send.
    const { changedAtMs } = await ensureFreshness();
    // Development sends no validators and no cache at all, because this page is
    // the one whose ETag does not describe its own bytes: contentVersion()
    // tracks the NEWS, and the dev switcher is injected downstream of the
    // renderer, so the two are independent. A browser holding a copy of this
    // page from before the bar existed revalidates, gets a 304 (the news has
    // not changed since), and re-renders its bar-less copy — with no amount of
    // reloading able to fix it, because a reload is exactly what produces the
    // 304. That is not hypothetical: it is what hid the switcher. Production
    // keeps the validators; there they are worth ~95KB a repeat visit.
    if (!devBarEnabled()) {
      res.set("ETag", `W/"${contentVersion()}"`);
      if (changedAtMs) {
        res.set("Last-Modified", new Date(changedAtMs).toUTCString());
      }
      if (req.fresh) {
        res.status(304).end();
        return;
      }
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
    // Development only, and injected here rather than in the renderer: this
    // page's markup IS the WordPress fragment, so a switcher inside it would
    // ship to statchasers.com. See lib/devbar.ts.
    if (devBarEnabled()) {
      html = injectDevBar(html, { path: req.path, embed: false });
    }
    res
      // The rendered list changes as news is ingested, so let shared caches
      // hold it only briefly and revalidate. Never in development — see above.
      .set(
        "Cache-Control",
        devBarEnabled() ? "no-store" : "public, max-age=60",
      )
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
app.use((req, res) => {
  const html =
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />` +
    `<meta name="robots" content="noindex" />` +
    `<title>Not found</title></head><body>` +
    `<h1>Not found</h1><p><a href="/">Go to the news tool</a>` +
    ` &middot; <a href="/team">Go to the team hubs</a>` +
    ` &middot; <a href="/player">Go to the player pages</a>` +
    ` &middot; <a href="/fpa">Go to fantasy points allowed</a>` +
    ` &middot; <a href="/rankings">Go to the redraft rankings</a></p>` +
    `</body></html>`;
  res
    .status(404)
    .set("X-Robots-Tag", "noindex")
    .type("html")
    // Development only, and the reason this handler takes `req`: a mistyped URL
    // inside the Replit preview pane has no address bar to recover from, so the
    // switcher has to be on the 404 too. See lib/devbar.ts.
    .send(injectDevBar(html, { path: req.path, embed: false }));
});

export default app;
