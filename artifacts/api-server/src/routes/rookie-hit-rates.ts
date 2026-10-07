/**
 * The rookie hit rate routes.
 *
 *   GET /rookie-hit-rates                   - the tool, at its default view
 *   GET /rookie-hit-rates?embed=1           - the same page, stripped for embedding
 *   GET /embed/rookie-hit-rates             - the bare fragment, for the WordPress mount
 *   GET /embed/rookie-hit-rates/data        - the dataset the bundle recomputes views from
 *
 * Mirrors routes/sos.ts, including the posture that matters: every page route
 * ships `noindex, indexifembedded`, so this origin does not compete with
 * statchasers.com.
 *
 * Unlike SOS, no view is part of an address. The standalone app kept its tab
 * and filters in component state and never wrote them to the URL; there are
 * thousands of combinations of nine filters, and the server renders only the
 * default. Every other view is the bundle's, from the dataset below.
 *
 * The data route has no extension because the WordPress proxy forwards only
 * `[A-Za-z0-9_/-]` paths (statchasers-proxy.php), and readers' browsers reach
 * it through that proxy once the embed key is on.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../lib/logger";
import { devBarEnabled, injectDevBar } from "../lib/devbar";
import { liveReload } from "../lib/livereload";
import { canonicalUrl } from "../lib/request";
import { browserEndpoint } from "../lib/embed-key";
import { renderRhrAppPage, renderRhrFragment , rhrAssets } from "../lib/rookie-hit-rates-ssr";
import { getRhrData, rhrDataVersion, rhrProfiles } from "../lib/rookie-hit-rates/data";
import { imageVersionsEpoch } from "../lib/image-versions";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "public");

const router: IRouter = Router();

const TRUTHY = new Set(["1", "true", "yes", "on"]);

export const RHR_PAGE_PATH = "/rookie-hit-rates";
const RHR_FRAGMENT_PATH = "/embed/rookie-hit-rates";
export const RHR_DATA_PATH = "/embed/rookie-hit-rates/data";

function isEmbed(req: Request): boolean {
  return TRUTHY.has(String(req.query["embed"] ?? "").trim().toLowerCase());
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

router.get(RHR_PAGE_PATH, (req, res) => {
  const embed = isEmbed(req);
  try {
    const result = renderRhrAppPage(publicDir, {
      // Built from the path alone (lib/request.ts), so no query can mint a
      // second canonical.
      canonical: canonicalUrl(req),
      embed,
      // Relative is right here: this page is served from the same origin.
      dataUrl: RHR_DATA_PATH,
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
      .set("Cache-Control", dev ? "no-store" : "public, max-age=300")
      .set("X-Robots-Tag", "noindex, indexifembedded")
      .type("html")
      .send(html);
  } catch (err) {
    logger.error({ err }, "Failed to render the rookie hit rates page");
    noStoreHtml(res, 500, UNAVAILABLE);
  }
});

/**
 * The bare fragment, for the WordPress plugin to print into a page.
 *
 * Always rendered in embedded mode: the host page supplies the H1. No data
 * answers 404 rather than an empty shell, so the shortcode leaves the host
 * page intact instead of printing a hole in it.
 */
router.get(RHR_FRAGMENT_PATH, (req, res) => {
  try {
    const result = renderRhrFragment({
      embed: true,
      // Absolute: this markup is printed inside a statchasers.com page, where a
      // relative path resolves against WordPress. Through the proxy once the
      // embed key is on.
      dataUrl: browserEndpoint(req, RHR_DATA_PATH),
    });

    if (!result.ok) {
      res
        .status(404)
        .set("Cache-Control", "no-store")
        .type("text/plain")
        .send("No rookie hit rate data is available");
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
    logger.error({ err }, "Failed to render the rookie hit rates fragment");
    res.status(503).type("text/plain").send("Rookie hit rates fragment unavailable");
  }
});

/**
 * The packed dataset, plus each player's profile link. The same bytes the
 * server rendered the default view from, so the bundle's views and the
 * server's agree.
 */
router.get(RHR_DATA_PATH, (req, res) => {
  try {
    const data = getRhrData();
    if (!data) {
      res.status(404).set("Cache-Control", "no-store").type("text/plain").send("No rookie hit rate data is available");
      return;
    }
    // The headshot versions ride along (rhrAssets), so the validator moves
    // when they do as well as when the dataset does.
    res.set("ETag", `W/"${rhrDataVersion()}-${imageVersionsEpoch()}"`);
    if (req.fresh) {
      res.status(304).end();
      return;
    }
    res
      .set("Cache-Control", "public, max-age=300")
      .set("X-Robots-Tag", "noindex")
      .type("application/json")
      .send(JSON.stringify({ ...data, profiles: rhrProfiles(), assets: rhrAssets(data) }));
  } catch (err) {
    logger.error({ err }, "Failed to serve the rookie hit rates data");
    res.status(503).type("text/plain").send("Rookie hit rates data unavailable");
  }
});

export default router;
