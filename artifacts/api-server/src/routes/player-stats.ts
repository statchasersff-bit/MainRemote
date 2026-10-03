/**
 * The advanced player stats routes.
 *
 *   GET /player-stats                - the quarterback table
 *   GET /player-stats/rb|wr|te       - the other three positions
 *   GET /player-stats/qb             - 301 to /player-stats
 *   GET /player-stats?season=2024    - another season of the same page
 *   GET /player-stats?embed=1        - the same page, stripped for embedding
 *   GET /embed/player-stats          - the bare fragment, for the WordPress mount
 *
 * Mirrors routes/rankings.ts, including the posture that matters: every route
 * ships `noindex, indexifembedded`, so this origin does not compete with
 * statchasers.com - and by the same token the tables are invisible to search
 * until `[statchasers_player_stats]` embeds them.
 *
 * **The path says which position this is.** That is the standalone app's own
 * routing (`/nfl/nfl-player-stats/qb|rb|wr|te`), kept because each position is
 * a different table of different players. The quarterback table is the bare
 * path, as it was there - the app normalised a bare address to `/qb` on load -
 * and `/qb` answers with a 301 back to it, so one table has one address. A
 * position the tool does not have, or a second spelling of one it does
 * (`/RB`), is a 404 rather than a copy.
 *
 * The season is a query argument and never part of a canonical. It is a
 * control: the standalone app kept it in component state, off the URL
 * entirely, and the bundle here swaps seasons without touching the address.
 * `?season=` exists so the season links work with scripting off.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../lib/logger";
import { devBarEnabled, injectDevBar } from "../lib/devbar";
import { liveReload } from "../lib/livereload";
import { canonicalUrl, publicOrigin } from "../lib/request";
import { browserEndpoint } from "../lib/embed-key";
import {
  renderStatsAppPage,
  renderStatsFragment,
} from "../lib/player-stats-ssr";
import {
  defaultSeason,
  parsePosition,
  parseSeason,
  type StatsPosition,
  type StatsSeason,
} from "../lib/player-stats/stats-data";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "public");

const router: IRouter = Router();

const TRUTHY = new Set(["1", "true", "yes", "on"]);

const STATS_BASE_PATH = "/player-stats";
const STATS_FRAGMENT_PATH = "/embed/player-stats";
const PLAYER_PATH_PREFIX = "/player/";

/**
 * Where the fragment's position links point when nothing says otherwise.
 *
 * The WordPress page the standalone app was mounted at, rather than this
 * origin's /player-stats: the fragment is only ever printed inside that page,
 * and a default that sent every position link to a path statchasers.com does
 * not have would be a default that is wrong everywhere it is used. It is the
 * same address the team hubs already link to (SC_PLAYER_STATS_URL).
 */
const EMBED_BASE_PATH = "/nfl/nfl-player-stats/";

function isEmbed(req: Request): boolean {
  return TRUTHY.has(String(req.query["embed"] ?? "").trim().toLowerCase());
}

/** Only `embed`, and only as the canonical `?embed=1`. See routes/rankings.ts. */
function linkQuery(req: Request): string {
  return isEmbed(req) ? "?embed=1" : "";
}

/**
 * `?embed=1` only means anything against this origin, and once
 * SC_PLAYER_PATH_PREFIX points links at statchasers.com the query is harmful,
 * because `embed` is a reserved WordPress query var.
 */
function fragmentLinkQuery(prefix: string): string {
  const override = process.env["SC_PLAYER_STATS_LINK_QUERY"];
  if (override !== undefined) return override.trim();
  return prefix === PLAYER_PATH_PREFIX ? "?embed=1" : "";
}

/** The season asked for, or the newest one. A season we do not have is ignored. */
function season(req: Request): StatsSeason | null {
  return parseSeason(req.query["season"]) ?? defaultSeason();
}

function noStoreHtml(res: Response, status: number, html: string): void {
  res
    .status(status)
    .set("X-Robots-Tag", "noindex")
    .set("Cache-Control", "no-store")
    .type("html")
    .send(html);
}

const UNAVAILABLE =
  `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />` +
  `<meta name="robots" content="noindex" /><title>Temporarily unavailable</title>` +
  `</head><body><h1>Temporarily unavailable</h1>` +
  `<p>This page could not be built. Please try again shortly.</p>` +
  `</body></html>`;

function sendPage(req: Request, res: Response, position: StatsPosition): void {
  const embed = isEmbed(req);
  const chosen = season(req);
  if (chosen === null) {
    noStoreHtml(res, 503, UNAVAILABLE);
    return;
  }

  try {
    const result = renderStatsAppPage(publicDir, position, chosen, {
      // Built from the path alone (lib/request.ts), so no season or embed
      // flag can mint a second canonical.
      canonical: canonicalUrl(req),
      embed,
      basePath: STATS_BASE_PATH,
      linkQuery: linkQuery(req),
      pageQuery: linkQuery(req),
      defaultSeason: defaultSeason(),
      // Relative is right here: this page is served from the same origin the
      // fragment is.
      endpoint: STATS_FRAGMENT_PATH,
    });

    const dev = liveReload().enabled;

    if (!dev) {
      res.set("ETag", `W/"${result.version}"`);
      if (req.fresh) {
        res.status(304).end();
        return;
      }
    }

    let html = dev ? liveReload().injectIntoHtml(result.html) : result.html;
    if (devBarEnabled()) {
      html = injectDevBar(html, { path: req.path, embed });
    }

    res
      // A data file changes when somebody commits one; the ETag catches that
      // immediately either way.
      .set("Cache-Control", dev ? "no-store" : "public, max-age=300")
      .set("X-Robots-Tag", "noindex, indexifembedded")
      .type("html")
      .send(html);
  } catch (err) {
    logger.error({ err, position }, "Failed to render the advanced stats page");
    noStoreHtml(res, 500, UNAVAILABLE);
  }
}

router.get("/player-stats", (req, res) => {
  sendPage(req, res, "QB");
});

router.get("/player-stats/:pos", (req, res, next) => {
  const raw = String(req.params["pos"] ?? "");

  // The quarterback table's address is the bare path. Its query goes with it,
  // so `/qb?season=2024` lands on the 2024 table rather than the newest.
  if (raw === "qb") {
    const q = req.originalUrl.indexOf("?");
    res.redirect(301, `${STATS_BASE_PATH}${q >= 0 ? req.originalUrl.slice(q) : ""}`);
    return;
  }

  // One spelling per position: lower case only, so `/RB` is not a second
  // address for `/rb`. Anything else falls through to the app's 404.
  const position = raw === raw.toLowerCase() ? parsePosition(raw) : null;
  if (!position) {
    next();
    return;
  }
  sendPage(req, res, position);
});

/**
 * The bare fragment, for the WordPress plugin to print into a page - and for
 * the bundle to fetch another season from.
 *
 * Always rendered in embedded mode: the host page supplies the heading and the
 * page chrome. A position or season with no file answers 404 rather than an
 * empty shell, so the shortcode leaves the host page intact instead of printing
 * a hole in it.
 */
router.get(STATS_FRAGMENT_PATH, (req, res) => {
  const playerPrefix = (
    process.env["SC_PLAYER_PATH_PREFIX"] ?? PLAYER_PATH_PREFIX
  ).trim();
  const basePath = (
    process.env["SC_PLAYER_STATS_PATH"] ?? EMBED_BASE_PATH
  ).trim();
  const position = parsePosition(req.query["pos"]) ?? "QB";
  const chosen = season(req);

  if (chosen === null) {
    res
      .status(404)
      .set("Cache-Control", "no-store")
      .type("text/plain")
      .send("No advanced stats have been published");
    return;
  }

  try {
    const result = renderStatsFragment(position, chosen, {
      embed: true,
      basePath,
      playerPathPrefix: playerPrefix,
      linkQuery: fragmentLinkQuery(playerPrefix),
      // Nothing on the season and position links: they are the WordPress
      // page's own addresses.
      pageQuery: "",
      defaultSeason: defaultSeason(),
      // Absolute, and it has to be: this markup is printed inside a
      // statchasers.com page, where a relative path resolves against
      // WordPress. Built from the request, so it is whatever origin the
      // plugin actually reached us on.
      endpoint: browserEndpoint(req, STATS_FRAGMENT_PATH),
    });

    if (!result.table) {
      res
        .status(404)
        .set("Cache-Control", "no-store")
        .type("text/plain")
        .send("No advanced stats for this position and season");
      return;
    }

    res.set("ETag", `W/"${result.version}"`);
    if (req.fresh) {
      res.status(304).end();
      return;
    }

    res
      .set("Cache-Control", "public, max-age=300")
      .set("X-Robots-Tag", "noindex, indexifembedded")
      .type("html")
      .send(result.html);
  } catch (err) {
    logger.error({ err }, "Failed to render the advanced stats fragment");
    res.status(503).type("text/plain").send("Advanced stats fragment unavailable");
  }
});

export default router;
