/**
 * The Fantasy Points Allowed routes.
 *
 *   GET /fpa                      - the standalone page
 *   GET /fpa?format=ppr&view=adjusted
 *   GET /fpa?embed=1              - the same page, stripped for embedding
 *   GET /fpa/download.csv         - the table on screen, as CSV
 *   GET /embed/fpa                - the bare fragment, for the WordPress mount
 *   POST /api/fpa/ingest          - refresh the figures now
 *
 * `/embed/fpa` is also what the bundle re-fetches when a reader changes scoring
 * format or view, which is why both page routes hand the markup an address for
 * it: the controls are links, but following one would change the address of the
 * page the reader is on, and six renderings of one table are one page.
 *
 * Mirrors routes/team.ts and routes/player.ts, including the posture that
 * matters: every route ships `noindex, indexifembedded`, so this origin does
 * not compete with statchasers.com - and by the same token the page is
 * invisible to search until `[statchasers_fpa]` embeds it.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../lib/logger";
import { devBarEnabled, injectDevBar } from "../lib/devbar";
import { liveReload } from "../lib/livereload";
import { canonicalUrl, publicOrigin } from "../lib/request";
import { browserEndpoint } from "../lib/embed-key";
import { renderFpaAppPage, renderFpaFragment } from "../lib/fpa-ssr";
import { renderFpaCsv } from "../lib/fpa-render";
import {
  fpaSnapshotState,
  getFpaTable,
  parseFpaFormat,
  parseFpaView,
  type FpaQuery,
} from "../lib/fpa/fpa-data";
import { refreshFpa } from "../lib/fpa/refresh";
import { requireIngestSecret } from "../lib/ingest-auth";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "public");

const router: IRouter = Router();

const TRUTHY = new Set(["1", "true", "yes", "on"]);

function isEmbed(req: Request): boolean {
  return TRUTHY.has(String(req.query["embed"] ?? "").trim().toLowerCase());
}

const FPA_BASE_PATH = "/fpa";
const FPA_FRAGMENT_PATH = "/embed/fpa";
const TEAM_PATH_PREFIX = "/team/";

/**
 * Only `embed`, and only as the canonical `?embed=1`.
 *
 * Echoing the whole query into every team link would let any parameter anyone
 * appends mint 32 more crawlable URLs - the duplicate URL space the canonical
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

/**
 * A season, or undefined.
 *
 * Honored only when it is plausibly one, so a hand-edited URL falls through to
 * the configured current season rather than querying for the year 3000.
 */
function season(value: unknown): number | undefined {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n >= 1999 && n <= 2100 ? n : undefined;
}

function query(req: Request): FpaQuery {
  const year = season(req.query["season"]);
  return {
    format: parseFpaFormat(String(req.query["format"] ?? "").trim().toLowerCase()),
    view: parseFpaView(String(req.query["view"] ?? "").trim().toLowerCase()),
    ...(year === undefined ? {} : { season: year }),
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
          // Relative is right here: this page is served from the same origin
          // the fragment is.
          endpoint: FPA_FRAGMENT_PATH,
        },
      );

      // Same rule as /embed/fpa, which already 404s: a season asked for by
      // name with no snapshots is a page that does not exist, not an empty
      // table. Only the default table's absence is the honest empty state.
      if (!result.data && query(req).season !== undefined) {
        noStoreHtml(
          res,
          404,
          `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />` +
          `<meta name="robots" content="noindex" /><title>Not found</title>` +
          `</head><body><h1>Not found</h1>` +
          `<p>There is no Fantasy Points Allowed table for that season.</p>` +
          `</body></html>`,
        );
        return;
      }

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
 * screen can never disagree - the standalone app generated its CSV from a
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
        // Absolute, and both have to be: this markup is printed inside a
        // statchasers.com page, where a relative /embed/fpa resolves against
        // WordPress. Built from the request rather than configured, so it is
        // whatever origin the plugin actually reached us on. The CSV is the
        // same kind of thing - a route on this server, not a page on theirs.
        endpoint: browserEndpoint(req, FPA_FRAGMENT_PATH),
        csvBase: `${publicOrigin(req)}${FPA_BASE_PATH}`,
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

/**
 * POST /api/fpa/ingest - refresh the figures now.
 *
 * The scheduled path. `scripts/ingest-fpa.mjs` writes to whatever database the
 * process running it is pointed at, which makes it the wrong tool for
 * production: run from a development shell it refreshes development, and the
 * deployment goes on serving whatever seeded it. This runs the ingest INSIDE
 * the deployment, against the database that deployment actually reads.
 *
 * Point a Replit Scheduled Deployment at `scripts/refresh-fpa.mjs` weekly, in
 * season, after Monday night.
 *
 * Answers when the ingest has finished - two ~7MB CSVs and a transaction, which
 * measured a second and a half from the workspace - because a scheduler needs
 * the verdict, and a 202 that always says "accepted" would report a broken
 * upstream as a successful refresh. A caller that gives up waiting does not
 * cancel anything: the run finishes and `/api/status` reports it.
 *
 * Guarded by INGEST_SECRET exactly as POST /api/ingest is, and for a sharper
 * reason than that one has - each call costs two large fetches from nflverse,
 * so an open endpoint is a way to spend someone else's bandwidth. Unset refuses.
 */
router.post("/api/fpa/ingest", (req, res) => {
  void (async () => {
    if (!requireIngestSecret(req, res)) return;

    // Both optional, and both plausibility-checked like the page's. They exist
    // for the week either season rolls over, when the answer is one run with
    // the seasons named rather than a redeploy to move an environment variable.
    const baselineSeason = season(req.query["baseline"]);
    const currentSeason = season(req.query["current"]);

    try {
      const { result, joined } = await refreshFpa({
        ...(baselineSeason === undefined ? {} : { baselineSeason }),
        ...(currentSeason === undefined ? {} : { currentSeason }),
      });

      // Read back rather than echoed from the ingest: this is the figure the
      // page will serve, and it comes from the same place the page reads.
      const snapshot = await fpaSnapshotState(result.currentSeason).catch(
        () => null,
      );

      res.set("Cache-Control", "no-store").json({
        ok: true,
        // True when a run was already going and this request waited on it -
        // one ingest, two callers, and nobody left guessing which.
        joined,
        season: result.currentSeason,
        baselineSeason: result.baselineSeason,
        weekNumber: result.weekNumber,
        dataMode: result.dataMode,
        isPreseason: result.isPreseason,
        snapshotRows: result.snapshotRows,
        gameRows: result.gameRows,
        snapshotWrittenAt: snapshot?.writtenAtMs
          ? new Date(snapshot.writtenAtMs).toISOString()
          : null,
      });
    } catch (err) {
      req.log.error({ err }, "FPA ingest failed");
      res
        .status(500)
        .set("Cache-Control", "no-store")
        .json({ ok: false, error: String(err) });
    }
  })();
});

export default router;
