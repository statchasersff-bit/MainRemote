/**
 * The injury impact routes.
 *
 *   GET /injury-impact                              - the analysis dashboard
 *   GET /injury-database                            - the injury database
 *   GET /embed/injury-impact                        - the dashboard fragment, for the WordPress mount
 *   GET /embed/injury-database                      - the database fragment
 *   GET /embed/injury-impact/data/analysis          - the dashboard dataset (analysis, panel, exposure,
 *                                                     regression, post-return, current season), one fetch
 *   GET /embed/injury-impact/data/search            - the packed player search index
 *   GET /embed/injury-impact/data/sim               - the draft simulation, for the sandbox's controls
 *   GET /embed/injury-impact/data/gridiron          - the durability dataset (every drafted player's
 *                                                     seasons and injuries), for the durability tabs
 *   GET /embed/injury-impact/data/player/<gsis>     - one player's reports, events, seasons and schedule
 *
 * Mirrors routes/redraft-strategy.ts, including the posture that matters:
 * every page route ships `noindex, indexifembedded`, so this origin does not
 * compete with statchasers.com.
 *
 * No filter is part of an address. The app kept its filters in React state,
 * and the server renders only the default; the bundle redraws every other
 * view from the analysis slice. The slices are path segments, not a query
 * string, because the WordPress proxy forwards only `[A-Za-z0-9_/-]` paths.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../lib/logger";
import { devBarEnabled, injectDevBar } from "../lib/devbar";
import { liveReload } from "../lib/livereload";
import { canonicalUrl } from "../lib/request";
import { browserEndpoint } from "../lib/embed-key";
import { imageVersionFor, imageVersionsEpoch } from "../lib/image-versions";
import { injuryAssets, renderInjuryAppPage, renderInjuryFragment } from "../lib/injury-impact-ssr";
import { getGridiron, getInjuryDataset, getPlayerSlice, getSearchIndex, injuryDataVersion, isGsisId } from "../lib/injury-impact/data";
import type { InjuryPage } from "../lib/injury-impact/render-shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "public");

const router: IRouter = Router();

const TRUTHY = new Set(["1", "true", "yes", "on"]);

export const INJURY_PAGE_PATH = "/injury-impact";
export const INJURY_DB_PAGE_PATH = "/injury-database";
const INJURY_FRAGMENT_PATH = "/embed/injury-impact";
const INJURY_DB_FRAGMENT_PATH = "/embed/injury-database";
export const INJURY_DATA_PATH = "/embed/injury-impact/data";

function isEmbed(req: Request): boolean {
  return TRUTHY.has(String(req.query["embed"] ?? "").trim().toLowerCase());
}

function noStoreHtml(res: Response, status: number, html: string): void {
  res.status(status).set("X-Robots-Tag", "noindex").set("Cache-Control", "no-store").type("html").send(html);
}

const UNAVAILABLE =
  `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />` +
  `<meta name="robots" content="noindex" /><title>Temporarily unavailable</title>` +
  `</head><body><h1>Temporarily unavailable</h1>` +
  `<p>This page could not be built. Please try again shortly.</p>` +
  `</body></html>`;

function pageRoute(page: InjuryPage, pagePath: string, siblingPath: string): void {
  router.get(pagePath, (req, res) => {
    const embed = isEmbed(req);
    try {
      const result = renderInjuryAppPage(page, publicDir, {
        canonical: canonicalUrl(req),
        embed,
        // Relative is right here: this page is served from the same origin.
        dataUrl: INJURY_DATA_PATH,
        siblingUrl: siblingPath,
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
      if (devBarEnabled()) html = injectDevBar(html, { path: req.path, embed });

      res
        .set("Cache-Control", dev ? "no-store" : "public, max-age=300")
        .set("X-Robots-Tag", "noindex, indexifembedded")
        .type("html")
        .send(html);
    } catch (err) {
      logger.error({ err, page }, "Failed to render an injury page");
      noStoreHtml(res, 500, UNAVAILABLE);
    }
  });
}

pageRoute("analysis", INJURY_PAGE_PATH, INJURY_DB_PAGE_PATH);
pageRoute("database", INJURY_DB_PAGE_PATH, INJURY_PAGE_PATH);

/**
 * The bare fragments, for the WordPress plugin to print into a page.
 *
 * Always rendered in embedded mode: the host page supplies the H1. No data
 * answers 404 rather than an empty shell, so the shortcode leaves the host
 * page intact instead of printing a hole in it. The sibling link is left out:
 * the plugin does not know where the other page is mounted.
 */
function fragmentRoute(page: InjuryPage, fragmentPath: string): void {
  router.get(fragmentPath, (req, res) => {
    try {
      const result = renderInjuryFragment(page, {
        embed: true,
        // Absolute: this markup is printed inside a statchasers.com page, where a
        // relative path resolves against WordPress. Through the proxy once the
        // embed key is on.
        dataUrl: browserEndpoint(req, INJURY_DATA_PATH),
      });

      if (!result.ok) {
        res.status(404).set("Cache-Control", "no-store").type("text/plain").send("No injury data is available");
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
      logger.error({ err, page }, "Failed to render an injury fragment");
      res.status(503).type("text/plain").send("Injury fragment unavailable");
    }
  });
}

fragmentRoute("analysis", INJURY_FRAGMENT_PATH);
fragmentRoute("database", INJURY_DB_FRAGMENT_PATH);

/** One slice of the dataset: the same bytes the server rendered its view from. */
function sendSlice(req: Request, res: Response, body: unknown | null, what: string, version = injuryDataVersion()): void {
  if (!body) {
    res.status(404).set("Cache-Control", "no-store").type("text/plain").send(`No ${what} is available`);
    return;
  }
  res.set("ETag", `W/"${version}"`);
  if (req.fresh) {
    res.status(304).end();
    return;
  }
  res.set("Cache-Control", "public, max-age=300").set("X-Robots-Tag", "noindex").type("application/json").send(JSON.stringify(body));
}

// The dashboard's whole dataset in one fetch (1.5 MB before compression): the
// bundle recomputes every view from it when a filter moves, as the app did.
router.get(`${INJURY_DATA_PATH}/analysis`, (req, res) => {
  try {
    const ds = getInjuryDataset();
    if (!ds) return sendSlice(req, res, null, "injury analysis");
    const { tagImpact: _tag, draftSim: _sim, ...rest } = ds;
    void _tag;
    void _sim;
    sendSlice(req, res, rest, "injury analysis");
  } catch (err) {
    logger.error({ err }, "Failed to serve the injury analysis slice");
    res.status(503).type("text/plain").send("Injury data unavailable");
  }
});

router.get(`${INJURY_DATA_PATH}/sim`, (req, res) => {
  try {
    sendSlice(req, res, getInjuryDataset()?.draftSim ?? null, "draft simulation");
  } catch (err) {
    logger.error({ err }, "Failed to serve the injury draft simulation");
    res.status(503).type("text/plain").send("Injury data unavailable");
  }
});

// The durability dataset, as the file holds it: the bundle hydrates it with
// the same model the server scored the default views with.
router.get(`${INJURY_DATA_PATH}/gridiron`, (req, res) => {
  try {
    sendSlice(req, res, getGridiron(), "durability data");
  } catch (err) {
    logger.error({ err }, "Failed to serve the injury durability dataset");
    res.status(503).type("text/plain").send("Injury data unavailable");
  }
});

router.get(`${INJURY_DATA_PATH}/search`, (req, res) => {
  try {
    const index = getSearchIndex();
    sendSlice(req, res, index.length ? index : null, "player index");
  } catch (err) {
    logger.error({ err }, "Failed to serve the injury search index");
    res.status(503).type("text/plain").send("Injury data unavailable");
  }
});

// The headshot version rides along, so the validator moves when it does.
router.get(`${INJURY_DATA_PATH}/player/:gsis`, (req, res) => {
  try {
    const id = String(req.params["gsis"] ?? "");
    if (!isGsisId(id)) return sendSlice(req, res, null, "such player");
    const slice = getPlayerSlice(id);
    if (!slice) return sendSlice(req, res, null, "such player");
    const assets = injuryAssets([id]);
    const version = slice.photoId ? imageVersionFor(slice.photoId) : null;
    sendSlice(req, res, { ...slice, headshotVersion: version ?? null, assets }, "such player", `${injuryDataVersion()}-${imageVersionsEpoch()}-${id}`);
  } catch (err) {
    logger.error({ err }, "Failed to serve an injury player slice");
    res.status(503).type("text/plain").send("Injury data unavailable");
  }
});

export default router;
