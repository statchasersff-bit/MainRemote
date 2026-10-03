/**
 * The fantasy strength-of-schedule routes.
 *
 *   GET /strength-of-schedule                         - the board (Team SOS, RB, PPR)
 *   GET /strength-of-schedule?tab=player&pos=wr&scoring=half-ppr
 *   GET /strength-of-schedule?embed=1                 - the same page, stripped for embedding
 *   GET /sos/download.csv?tab&pos&scoring             - the view on screen, as CSV
 *   GET /embed/sos?tab&pos&scoring                    - the bare fragment, for the WordPress mount
 *
 * Mirrors routes/fpa.ts, including the posture that matters: every page route
 * ships `noindex, indexifembedded`, so this origin does not compete with
 * statchasers.com.
 *
 * The view is a query string, as it was in the source app's WordPress embed
 * (`?tab&pos&scoring`), and never part of a canonical: 24 combinations of one
 * board are one page. Each value has one spelling; anything else is the
 * default rather than a 404, as the source did it, so a hand-edited link
 * never lands on a blank board.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../lib/logger";
import { devBarEnabled, injectDevBar } from "../lib/devbar";
import { liveReload } from "../lib/livereload";
import { canonicalUrl, publicOrigin } from "../lib/request";
import { browserEndpoint } from "../lib/embed-key";
import { renderSosAppPage, renderSosFragment } from "../lib/sos-ssr";
import { renderSosCsv } from "../lib/sos-render";
import { getSosBoard, parseSosState, type SosState } from "../lib/sos/sos-data";
import { scheduleSeason } from "../lib/schedule/schedule-data";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "public");

const router: IRouter = Router();

const TRUTHY = new Set(["1", "true", "yes", "on"]);

export const SOS_PAGE_PATH = "/strength-of-schedule";
const SOS_FRAGMENT_PATH = "/embed/sos";
const SOS_CSV_PATH = "/sos/download.csv";

function isEmbed(req: Request): boolean {
  return TRUTHY.has(String(req.query["embed"] ?? "").trim().toLowerCase());
}

function state(req: Request): SosState {
  return parseSosState({
    tab: req.query["tab"],
    pos: req.query["pos"],
    scoring: req.query["scoring"],
  });
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

router.get(SOS_PAGE_PATH, (req, res) => {
  void (async () => {
    const embed = isEmbed(req);
    try {
      const result = await renderSosAppPage(publicDir, state(req), {
        // Built from the path alone (lib/request.ts), so no view can mint a
        // second canonical.
        canonical: canonicalUrl(req),
        fallbackSeason: scheduleSeason(),
        embed,
        linkQuery: embed ? "embed=1" : "",
        // Relative is right here: this page is served from the same origin.
        endpoint: SOS_FRAGMENT_PATH,
        csvBase: "/sos",
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
      logger.error({ err }, "Failed to render the strength of schedule page");
      noStoreHtml(res, 500, UNAVAILABLE);
    }
  })();
});

/**
 * The view as CSV, built from the same board the page renders, so the file
 * and the screen cannot disagree. Public, like the FPA CSV: the reader's
 * browser downloads it directly.
 */
router.get(SOS_CSV_PATH, (req, res) => {
  void (async () => {
    const view = state(req);
    try {
      const board = await getSosBoard(view.position, view.scoring);
      if (!board) {
        res.status(404).type("text/plain").send("No strength of schedule data is available");
        return;
      }
      const filename = `statchasers_${view.tab}_sos_${board.season}_${view.position}_${view.scoring}.csv`;
      res
        .set("Content-Disposition", `attachment; filename="${filename}"`)
        .set("Cache-Control", "public, max-age=300")
        .set("X-Robots-Tag", "noindex")
        .type("text/csv")
        .send(renderSosCsv(board, view.tab));
    } catch (err) {
      logger.error({ err }, "Failed to build the strength of schedule CSV");
      res.status(503).type("text/plain").send("CSV unavailable");
    }
  })();
});

/**
 * The bare fragment, for the WordPress plugin to print into a page - and for
 * the bundle to fetch another view from.
 *
 * Always rendered in embedded mode: the host page supplies the H1. No data
 * answers 404 rather than an empty shell, so the shortcode leaves the host
 * page intact instead of printing a hole in it.
 */
router.get(SOS_FRAGMENT_PATH, (req, res) => {
  void (async () => {
    try {
      const result = await renderSosFragment(state(req), {
        embed: true,
        linkQuery: "",
        // Absolute, both: this markup is printed inside a statchasers.com page,
        // where a relative path resolves against WordPress.
        endpoint: browserEndpoint(req, SOS_FRAGMENT_PATH),
        csvBase: `${publicOrigin(req)}/sos`,
      });

      if (!result.board) {
        res
          .status(404)
          .set("Cache-Control", "no-store")
          .type("text/plain")
          .send("No strength of schedule data is available");
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
      logger.error({ err }, "Failed to render the strength of schedule fragment");
      res.status(503).type("text/plain").send("Strength of schedule fragment unavailable");
    }
  })();
});

export default router;
