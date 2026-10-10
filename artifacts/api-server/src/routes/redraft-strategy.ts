/**
 * The redraft draft strategy routes.
 *
 *   GET /redraft-strategy                          - the tool, at its default view
 *   GET /redraft-strategy?embed=1                  - the same page, stripped for embedding
 *   GET /embed/redraft-strategy                    - the bare fragment, for the WordPress mount
 *   GET /embed/redraft-strategy/data/combo/<key>   - one league format in one season
 *   GET /embed/redraft-strategy/data/trends/<key>  - one league format across the seasons
 *   GET /embed/redraft-strategy/data/boards        - the real draft examples, with the headshot versions
 *
 * Mirrors routes/rookie-hit-rates.ts, including the posture that matters:
 * every page route ships `noindex, indexifembedded`, so this origin does not
 * compete with statchasers.com.
 *
 * No view is part of an address. The standalone app's WordPress build kept
 * its filters in memory and never wrote them to the URL, and the server
 * renders only the default. Every other view is the bundle's, from the slices
 * below - which are path segments, not a query string, because the WordPress
 * proxy forwards only `[A-Za-z0-9_/-]` paths (statchasers-proxy.php).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../lib/logger";
import { devBarEnabled, injectDevBar } from "../lib/devbar";
import { liveReload } from "../lib/livereload";
import { canonicalUrl } from "../lib/request";
import { browserEndpoint } from "../lib/embed-key";
import { rdsAssets, renderRdsAppPage, renderRdsFragment } from "../lib/redraft-strategy-ssr";
import { getRdsBoards, getRdsCombo, getRdsTrend, parseKey, rdsDataVersion } from "../lib/redraft-strategy/data";
import { imageVersionsEpoch } from "../lib/image-versions";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "public");

const router: IRouter = Router();

const TRUTHY = new Set(["1", "true", "yes", "on"]);

export const RDS_PAGE_PATH = "/redraft-strategy";
const RDS_FRAGMENT_PATH = "/embed/redraft-strategy";
export const RDS_DATA_PATH = "/embed/redraft-strategy/data";

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

router.get(RDS_PAGE_PATH, (req, res) => {
  const embed = isEmbed(req);
  try {
    const result = renderRdsAppPage(publicDir, {
      // Built from the path alone (lib/request.ts), so no query can mint a
      // second canonical.
      canonical: canonicalUrl(req),
      embed,
      // Relative is right here: this page is served from the same origin.
      dataUrl: RDS_DATA_PATH,
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
    logger.error({ err }, "Failed to render the redraft strategy page");
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
router.get(RDS_FRAGMENT_PATH, (req, res) => {
  try {
    const result = renderRdsFragment({
      embed: true,
      // Absolute: this markup is printed inside a statchasers.com page, where a
      // relative path resolves against WordPress. Through the proxy once the
      // embed key is on.
      dataUrl: browserEndpoint(req, RDS_DATA_PATH),
    });

    if (!result.ok) {
      res.status(404).set("Cache-Control", "no-store").type("text/plain").send("No redraft strategy data is available");
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
    logger.error({ err }, "Failed to render the redraft strategy fragment");
    res.status(503).type("text/plain").send("Redraft strategy fragment unavailable");
  }
});

/** One slice of the dataset: the same bytes the server rendered its view from. */
function sendSlice(req: Request, res: Response, body: unknown | null, what: string, version = rdsDataVersion()): void {
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

router.get(`${RDS_DATA_PATH}/combo/:key`, (req, res) => {
  try {
    const key = parseKey(String(req.params["key"] ?? ""));
    sendSlice(req, res, key ? getRdsCombo(key) : null, "such league format and season");
  } catch (err) {
    logger.error({ err }, "Failed to serve a redraft strategy combo");
    res.status(503).type("text/plain").send("Redraft strategy data unavailable");
  }
});

router.get(`${RDS_DATA_PATH}/trends/:key`, (req, res) => {
  try {
    const key = parseKey(String(req.params["key"] ?? ""));
    sendSlice(req, res, key ? getRdsTrend(key) : null, "such league format");
  } catch (err) {
    logger.error({ err }, "Failed to serve a redraft strategy trend");
    res.status(503).type("text/plain").send("Redraft strategy data unavailable");
  }
});

// The headshot versions ride along (rdsAssets), so the validator moves when
// they do as well as when the boards do.
router.get(`${RDS_DATA_PATH}/boards`, (req, res) => {
  try {
    const boards = getRdsBoards();
    sendSlice(req, res, boards ? { boards, assets: rdsAssets(boards) } : null, "draft example", `${rdsDataVersion()}-${imageVersionsEpoch()}`);
  } catch (err) {
    logger.error({ err }, "Failed to serve the redraft strategy boards");
    res.status(503).type("text/plain").send("Redraft strategy data unavailable");
  }
});

export default router;
