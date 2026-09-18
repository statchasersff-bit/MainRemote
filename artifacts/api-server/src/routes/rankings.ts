/**
 * The redraft rankings routes.
 *
 *   GET /rankings                 — the standalone page
 *   GET /rankings?season=2026     — an older published board, if the file is kept
 *   GET /rankings?embed=1         — the same page, stripped for embedding
 *   GET /rankings/download.csv    — the boards on screen, as CSV
 *   GET /embed/rankings           — the bare fragment, for the WordPress mount
 *
 * Mirrors routes/fpa.ts, including the posture that matters: every route ships
 * `noindex, indexifembedded`, so this origin does not compete with
 * statchasers.com — and by the same token the page is invisible to search until
 * `[statchasers_rankings]` embeds it.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../lib/logger";
import { devBarEnabled, injectDevBar } from "../lib/devbar";
import { liveReload } from "../lib/livereload";
import { canonicalUrl } from "../lib/request";
import {
  renderRankingsAppPage,
  renderRankingsFragment,
} from "../lib/rankings-ssr";
import { renderRankingsCsv } from "../lib/rankings-render";
import {
  getRankings,
  POSITIONS,
  type PositionFilter,
} from "../lib/rankings/rankings-data";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "public");

const router: IRouter = Router();

const TRUTHY = new Set(["1", "true", "yes", "on"]);

function isEmbed(req: Request): boolean {
  return TRUTHY.has(String(req.query["embed"] ?? "").trim().toLowerCase());
}

const RANKINGS_BASE_PATH = "/rankings";
const PLAYER_PATH_PREFIX = "/player/";

/**
 * Only `embed`, and only as the canonical `?embed=1`.
 *
 * Same reasoning as the FPA fragment: echoing the whole query into every player
 * link would let any parameter anyone appends mint 230 more crawlable URLs.
 */
function linkQuery(req: Request): string {
  return isEmbed(req) ? "?embed=1" : "";
}

/**
 * `?embed=1` only means anything against this origin, and once
 * SC_PLAYER_PATH_PREFIX points links at statchasers.com the query is harmful,
 * because `embed` is a reserved WordPress query var.
 */
function fragmentLinkQuery(prefix: string): string {
  const override = process.env["SC_RANKINGS_LINK_QUERY"];
  if (override !== undefined) return override.trim();
  return prefix === PLAYER_PATH_PREFIX ? "?embed=1" : "";
}

/**
 * A season is honoured only when it is plausibly one; anything else falls
 * through to the newest published board. A hard-coded season is a page that
 * silently shows last year's rankings next August.
 */
function season(req: Request): number | undefined {
  const value = Number.parseInt(String(req.query["season"] ?? ""), 10);
  return Number.isFinite(value) && value >= 1999 && value <= 2100
    ? value
    : undefined;
}

/**
 * Which panel opens first.
 *
 * The tab strip itself is fragment links, so this only sets the server's guess
 * for a reader arriving cold — and it is deliberately a query rather than a
 * path, so it never mints a second canonical.
 */
function position(req: Request): PositionFilter {
  const raw = String(req.query["pos"] ?? "").trim().toLowerCase();
  return (
    POSITIONS.find((p) => p.toLowerCase() === raw) ?? "All"
  );
}

function noStoreHtml(res: Response, status: number, html: string): void {
  res
    .status(status)
    .set("X-Robots-Tag", "noindex")
    .set("Cache-Control", "no-store")
    .type("html")
    .send(html);
}

router.get("/rankings", (req, res) => {
  const embed = isEmbed(req);
  try {
    const result = renderRankingsAppPage(publicDir, season(req), {
      // Built from the path alone (lib/request.ts), so no combination of
      // season, pos or embed can mint a second canonical.
      canonical: canonicalUrl(req),
      embed,
      basePath: RANKINGS_BASE_PATH,
      linkQuery: linkQuery(req),
      position: position(req),
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
      // Longer than the news tool's 60s, like FPA: a rankings file changes when
      // somebody commits one, and the ETag catches that immediately either way.
      .set("Cache-Control", dev ? "no-store" : "public, max-age=300")
      .set("X-Robots-Tag", "noindex, indexifembedded")
      .type("html")
      .send(html);
  } catch (err) {
    logger.error({ err }, "Failed to render the rankings page");
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
});

/**
 * The boards as CSV.
 *
 * Built from the same `getRankings` the page renders, so the file and the
 * screen can never disagree — and it carries the derived tier and team columns,
 * which the source file does not have.
 */
router.get("/rankings/download.csv", (req, res) => {
  try {
    const data = getRankings(season(req));
    if (!data) {
      res.status(404).type("text/plain").send("No rankings have been published");
      return;
    }
    res
      .set(
        "Content-Disposition",
        `attachment; filename="statchasers-redraft-${data.season}.csv"`,
      )
      .set("Cache-Control", "public, max-age=300")
      .set("X-Robots-Tag", "noindex")
      .type("text/csv")
      .send(renderRankingsCsv(data));
  } catch (err) {
    logger.error({ err }, "Failed to build the rankings CSV");
    res.status(503).type("text/plain").send("CSV unavailable");
  }
});

/**
 * The bare fragment, for the WordPress plugin to print into a page.
 *
 * Always rendered in embedded mode: the host page supplies the H1 and the page
 * chrome. A deployment with no rankings file answers 404 rather than an empty
 * shell, so the shortcode leaves the host page intact instead of printing a
 * hole in it.
 */
router.get("/embed/rankings", (req, res) => {
  const playerPrefix = (
    process.env["SC_PLAYER_PATH_PREFIX"] ?? PLAYER_PATH_PREFIX
  ).trim();
  const basePath = (
    process.env["SC_RANKINGS_PATH"] ?? RANKINGS_BASE_PATH
  ).trim();

  try {
    const result = renderRankingsFragment(season(req), {
      embed: true,
      basePath,
      playerPathPrefix: playerPrefix,
      linkQuery: fragmentLinkQuery(playerPrefix),
      position: position(req),
    });

    if (!result.data) {
      res
        .status(404)
        .set("Cache-Control", "no-store")
        .type("text/plain")
        .send("No rankings have been published");
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
    logger.error({ err }, "Failed to render the rankings fragment");
    res.status(503).type("text/plain").send("Rankings fragment unavailable");
  }
});

export default router;
