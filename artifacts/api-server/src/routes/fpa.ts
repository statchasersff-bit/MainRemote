/**
 * The Fantasy Points Allowed routes.
 *
 *   GET /fpa                      — the standalone page
 *   GET /fpa?format=ppr&view=adjusted
 *   GET /fpa?embed=1              — the same page, stripped for embedding
 *   GET /fpa/download.csv         — the table on screen, as CSV
 *   GET /embed/fpa                — the bare fragment, for the WordPress mount
 *
 * Mirrors routes/team.ts and routes/player.ts, including the posture that
 * matters: every route ships `noindex, indexifembedded`, so this origin does
 * not compete with statchasers.com — and by the same token the page is
 * invisible to search until `[statchasers_fpa]` embeds it.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../lib/logger";
import { devBarEnabled, injectDevBar } from "../lib/devbar";
import { liveReload } from "../lib/livereload";
import { canonicalUrl } from "../lib/request";
import { renderFpaAppPage, renderFpaFragment } from "../lib/fpa-ssr";
import { renderFpaCsv } from "../lib/fpa-render";
import {
  getFpaTable,
  parseFpaFormat,
  parseFpaView,
  type FpaQuery,
} from "../lib/fpa/fpa-data";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "public");

const router: IRouter = Router();

const TRUTHY = new Set(["1", "true", "yes", "on"]);

function isEmbed(req: Request): boolean {
  return TRUTHY.has(String(req.query["embed"] ?? "").trim().toLowerCase());
}

const FPA_BASE_PATH = "/fpa";
const TEAM_PATH_PREFIX = "/team/";

/**
 * Only `embed`, and only as the canonical `?embed=1`.
 *
 * Echoing the whole query into every team link would let any parameter anyone
 * appends mint 32 more crawlable URLs — the duplicate URL space the canonical
 * work exists to prevent. Format and view are page state and deliberately do
 * not propagate into links off the page.
 */
function linkQuery(req: Request): string {
  return isEmbed(req) ? "?embed=1" : "";
}

/**
 * Same reasoning as the other two fragments: `?embed=1` only means anything
 * against this origin, and once SC_TEAM_PATH_PREFIX points links at
 * statchasers.com the query is harmful, because `embed` is a reserved
 * WordPress query var.
 */
function fragmentLinkQuery(prefix: string): string {
  const override = process.env["SC_FPA_LINK_QUERY"];
  if (override !== undefined) return override.trim();
  return prefix === TEAM_PATH_PREFIX ? "?embed=1" : "";
}

function query(req: Request): FpaQuery {
  const season = Number.parseInt(String(req.query["season"] ?? ""), 10);
  return {
    format: parseFpaFormat(String(req.query["format"] ?? "").trim().toLowerCase()),
    view: parseFpaView(String(req.query["view"] ?? "").trim().toLowerCase()),
    // A season is honoured only when it is plausibly one: anything else falls
    // through to the configured current season rather than querying for it.
    ...(Number.isFinite(season) && season >= 1999 && season <= 2100
      ? { season }
      : {}),
  };
}

function noStoreHtml(res: Response, status: number, html: string): void {
  res
    .status(status)
    .set("X-Robots-Tag", "noindex")
    .set("Cache-Control", "no-store")
    .type("html")
    .send(html);
}

router.get("/fpa", (req, res) => {
  void (async () => {
    const embed = isEmbed(req);
    try {
      const result = await renderFpaAppPage(
        publicDir,
        query(req),
        {
          // Built from the path alone (lib/request.ts), so no combination of
          // format, view or embed can mint a second canonical.
          canonical: canonicalUrl(req),
          embed,
          basePath: FPA_BASE_PATH,
          linkQuery: linkQuery(req),
        },
      );

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
        // Longer than the other tools' 60s: this table changes once a week,
        // when the ingest runs, and the ETag catches the change immediately
        // either way.
        .set("Cache-Control", dev ? "no-store" : "public, max-age=300")
        .set("X-Robots-Tag", "noindex, indexifembedded")
        .type("html")
        .send(html);
    } catch (err) {
      logger.error({ err }, "Failed to render the FPA page");
      noStoreHtml(
        res,
        500,
        `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />` +
          `<meta name="robots" content="noindex" /><title>Temporarily unavailable</title>` +
          `</head><body><h1>Temporarily unavailable</h1>` +
          `<p>This page could not be built. Please try again shortly.</p>` +
          `</body></html>`,
      );
    }
  })();
});

/**
 * The table as CSV.
 *
 * Built from the same `getFpaTable` the page renders, so the file and the
 * screen can never disagree — the standalone app generated its CSV from a
 * second query and a second formatter.
 */
router.get("/fpa/download.csv", (req, res) => {
  void (async () => {
    try {
      const data = await getFpaTable(query(req));
      if (!data) {
        res.status(404).type("text/plain").send("No FPA data has been ingested");
        return;
      }
      const filename = `fpa-${data.season}-${data.format}-${data.view}.csv`;
      res
        .set("Content-Disposition", `attachment; filename="${filename}"`)
        .set("Cache-Control", "public, max-age=300")
        .set("X-Robots-Tag", "noindex")
        .type("text/csv")
        .send(renderFpaCsv(data));
    } catch (err) {
      logger.error({ err }, "Failed to build the FPA CSV");
      res.status(503).type("text/plain").send("CSV unavailable");
    }
  })();
});

/**
 * The bare fragment, for the WordPress plugin to print into a page.
 *
 * Always rendered in embedded mode: the host page supplies the H1 and the page
 * chrome. A cold database answers 404 rather than an empty shell, so the
 * shortcode leaves the host page intact instead of printing a hole in it.
 */
router.get("/embed/fpa", (req, res) => {
  void (async () => {
    const teamPrefix = (
      process.env["SC_TEAM_PATH_PREFIX"] ?? TEAM_PATH_PREFIX
    ).trim();
    const basePath = (process.env["SC_FPA_PATH"] ?? FPA_BASE_PATH).trim();

    try {
      const result = await renderFpaFragment(query(req), {
        embed: true,
        basePath,
        teamPathPrefix: teamPrefix,
        linkQuery: fragmentLinkQuery(teamPrefix),
      });

      if (!result.data) {
        res
          .status(404)
          .set("Cache-Control", "no-store")
          .type("text/plain")
          .send("No FPA data has been ingested");
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
      logger.error({ err }, "Failed to render the FPA fragment");
      res.status(503).type("text/plain").send("FPA fragment unavailable");
    }
  })();
});

export default router;
