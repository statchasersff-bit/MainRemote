import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import compression from "compression";
import pinoHttp from "pino-http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import router from "./routes";
import embedRouter, { assetVersion } from "./routes/embed";
import teamRouter from "./routes/team";
import { matchupRouter } from "./routes/matchup";
import playerRouter from "./routes/player";
import fpaRouter from "./routes/fpa";
import rankingsRouter from "./routes/rankings";
import scheduleRouter from "./routes/schedule";
import playerStatsRouter from "./routes/player-stats";
import rbHandcuffsRouter from "./routes/rb-handcuffs";
import sosRouter from "./routes/sos";
import rookieHitRatesRouter from "./routes/rookie-hit-rates";
import previewRouter from "./routes/preview";
import xRouter from "./routes/x";
import { refreshIfStale } from "./routes/news";
import { logger } from "./lib/logger";
import { setupLiveReload } from "./lib/livereload";
import { renderAppPage } from "./lib/ssr";
import { canonicalUrl } from "./lib/request";
import { requireEmbedKey } from "./lib/embed-key";
import { linkTemplatesFromEnv, relatedLinksFromEnv } from "./lib/links";
import { devBarEnabled, injectDevBar } from "./lib/devbar";
import { contentVersion, ensureFreshness, freshness } from "./lib/freshness";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();
// Says nothing a client needs and names the framework to anyone probing.
app.disable("x-powered-by");

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
/**
 * gzip/brotli for everything except the dev live-reload stream, which is a
 * long-lived event stream that compression would buffer. Nothing here was
 * compressed before: 100-300KB fragments to WordPress (whose HTTP client asks
 * for gzip) and 200-250KB stylesheets to every browser went out raw.
 */
app.use(
  compression({
    filter: (req, res) =>
      !String(res.getHeader("Content-Type") ?? "").includes("text/event-stream") &&
      compression.filter(req, res),
  }),
);
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

// With SC_EMBED_KEY set, the fragments, the news feed and the standalone pages
// answer only WordPress (and anyone who has unlocked them with the key). Ahead
// of every router that serves them; see lib/embed-key.ts for what stays open.
app.use(requireEmbedKey);

// API routes
app.use("/api", router);

// Copy-paste embed snippet page (/embed and /embed.txt). Mounted before the
// static/SPA fallback so it isn't swallowed by the index.html catch-all.
app.use(embedRouter);

// NFL Team Hub: /team, /team/:slug and the /embed/team/:slug fragment. Mounted
// here for the same reason as the embed router - the 404 at the bottom of this
// file is deliberate and catches everything that gets past the routes above.
// It changes nothing about "/", which is still the news tool and nothing else.
app.use(teamRouter);

// Matchup pages: /nfl/<a>-vs-<b>/ and /embed/matchup/<a>-vs-<b>.
app.use(matchupRouter);

// NFL Player Pages: /player, /player/:slug and the /embed/player/:slug
// fragment. Mounted alongside the team router for the same reason - the 404 at
// the bottom of this file is deliberate and catches everything the routes above
// do not claim. It changes nothing about "/", which is still the news tool.
app.use(playerRouter);

// Fantasy Points Allowed: /fpa, /fpa/download.csv and the /embed/fpa fragment.
// Mounted alongside the other two tools, for the same reason.
app.use(fpaRouter);

// Rest of Season Rankings: /rest-of-season-rankings (and /qb, /rb, /wr, /te beneath
// it), its /download.csv, the /embed/rankings fragment, and 301s from the old
// /rankings. Mounted alongside the other tools, for the same reason.
app.use(rankingsRouter);

// NFL Schedule: /schedule, /schedule/download.csv, /schedule/schedule.ics and
// the /embed/schedule fragment. Mounted alongside the other tools, for the same
// reason.
app.use(scheduleRouter);

// Advanced player stats: /player-stats, /player-stats/:pos and the
// /embed/player-stats fragment. Mounted alongside the other tools, for the same
// reason.
app.use(playerStatsRouter);

// RB handcuff rankings: /rb-handcuff-rankings, the /embed/rb-handcuffs fragment
// and the player cards beneath it. Mounted alongside the other tools, for the
// same reason.
app.use(rbHandcuffsRouter);

// Fantasy strength of schedule: /strength-of-schedule, its CSV and the
// /embed/sos fragment. Mounted alongside the other tools, for the same reason.
app.use(sosRouter);

// Dynasty rookie hit rates: /rookie-hit-rates, the /embed/rookie-hit-rates
// fragment and the dataset its bundle recomputes views from. Mounted alongside
// the other tools, for the same reason.
app.use(rookieHitRatesRouter);

// Shortcode preview harness (/preview/*). Development only - the router's own
// first middleware 404s the whole thing outside development.
app.use(previewRouter);

// The X integration's API (/api/x/...) and its admin page (/admin/x). Mounted
// here for the same reason as the routers above - the 404 at the bottom of this
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
    // when the news does - see lib/freshness.ts. The load has to complete before
    // the ETag is read, or a cold server would answer with a version string that
    // does not describe what it is about to send.
    const { changedAtMs } = await ensureFreshness();
    // Development sends no validators and no cache at all, because this page is
    // the one whose ETag does not describe its own bytes: contentVersion()
    // tracks the NEWS, and the dev switcher is injected downstream of the
    // renderer, so the two are independent. A browser holding a copy of this
    // page from before the bar existed revalidates, gets a 304 (the news has
    // not changed since), and re-renders its bar-less copy - with no amount of
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

    // Canonical is built from the path alone - see lib/request.ts. Tool state
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
      // hold it only briefly and revalidate. Never in development - see above.
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

/**
 * The files build.mjs hashes into the asset version. WordPress enqueues each
 * with `?ver=<that hash>`, so a URL carrying the current hash names exactly
 * this build's bytes and can be cached for good - without it every page view
 * on statchasers.com revalidated 200KB+ stylesheets against this origin.
 * Anything else (a stale or fallback ver, or a file the hash does not cover)
 * keeps express.static's default, because a year-long copy of the wrong bytes
 * is worse than a revalidation.
 */
const HASHED_ASSETS = new Set(
  [
    "news", "team", "player", "fpa", "rankings", "schedule", "player-stats", "rb-handcuffs", "sos",
    "rookie-hit-rates",
  ].flatMap((name) => [
    `/dist/statchasers-${name}.js`,
    `/${name === "news" ? "styles" : name}.css`,
  ]),
);

let builtAssetVersion: string | null = null;

// The bundles' source maps are a build artefact for this workspace, not
// something to publish: in production they 404 like any other unknown path.
app.use((req, res, next) => {
  if (process.env["NODE_ENV"] === "production" && req.path.endsWith(".map")) {
    res.status(404).set("X-Robots-Tag", "noindex").type("text").send("Not found");
    return;
  }
  next();
});

app.use(
  express.static(publicDir, {
    setHeaders(res, filePath) {
      if (process.env["NODE_ENV"] !== "production") return;
      const rel = `/${path.relative(publicDir, filePath).split(path.sep).join("/")}`;
      if (!HASHED_ASSETS.has(rel)) return;
      builtAssetVersion ??= assetVersion();
      const ver = (res as Response).req?.query["ver"];
      if (builtAssetVersion !== "0" && ver === builtAssetVersion) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  }),
);

/**
 * Anything else is a 404 - deliberately.
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
    ` &middot; <a href="/rest-of-season-rankings">Go to the rest-of-season rankings</a>` +
    ` &middot; <a href="/schedule">Go to the NFL schedule</a>` +
    ` &middot; <a href="/player-stats">Go to the advanced player stats</a>` +
    ` &middot; <a href="/rb-handcuff-rankings">Go to the RB handcuff rankings</a>` +
    ` &middot; <a href="/strength-of-schedule">Go to strength of schedule</a></p>` +
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
