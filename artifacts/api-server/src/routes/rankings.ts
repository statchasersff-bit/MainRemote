/**
 * The rest-of-season rankings routes.
 *
 *   GET /rest-of-season-rankings              — the standalone page, All board
 *   GET /rest-of-season-rankings/qb|rb|wr|te  — the same page, that board open
 *   GET /rest-of-season-rankings?season=2026  — an older published board, if kept
 *   GET /rest-of-season-rankings?embed=1      — the same page, stripped for embedding
 *   GET /rest-of-season-rankings/download.csv — the boards on screen, as CSV
 *   GET /embed/rankings                       — the bare fragment, for the WordPress mount
 *
 * Every position page carries all five boards — the tabs switch in place once
 * the bundle is up — so the path only decides which one is open, and what the
 * title and canonical say.
 *
 * The old addresses answer with a 301: `/rankings` and its `?pos=` to the path
 * form, `/rankings/download.csv` to its new home. `/embed/rankings` keeps its
 * name; it is an API the plugin calls, not a page anyone visits.
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
import { canonicalUrl, publicOrigin } from "../lib/request";
import {
  renderRankingsAppPage,
  renderRankingsFragment,
} from "../lib/rankings-ssr";
import {
  rankingsPositionPath,
  renderRankingsCsv,
} from "../lib/rankings-render";
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

const RANKINGS_BASE_PATH = "/rest-of-season-rankings";
const LEGACY_BASE_PATH = "/rankings";
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
 * The position a `?pos=` names, or null when it names none.
 *
 * Only the fragment route and the redirects read it now. The page itself takes
 * its position from the path.
 */
function queryPosition(req: Request): PositionFilter | null {
  const raw = String(req.query["pos"] ?? "").trim().toLowerCase();
  if (raw === "") return null;
  return POSITIONS.find((p) => p.toLowerCase() === raw) ?? null;
}

/** The position a path segment names — `rb`, not `RB` or `all`. */
function pathPosition(segment: string): PositionFilter | null {
  return (
    POSITIONS.find((p) => p !== "All" && p.toLowerCase() === segment) ?? null
  );
}

/**
 * The request's query string with `pos` taken out, `?`-prefixed or empty.
 *
 * What a redirect carries across: `?season=` and `?embed=` still mean what
 * they meant, and `pos` has become the path.
 */
function queryWithoutPos(req: Request): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query)) {
    if (key === "pos") continue;
    for (const v of Array.isArray(value) ? value : [value]) {
      if (typeof v === "string") params.append(key, v);
    }
  }
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

function redirectTo(
  req: Request,
  res: Response,
  position: PositionFilter,
): void {
  res.redirect(
    301,
    rankingsPositionPath(RANKINGS_BASE_PATH, position) + queryWithoutPos(req),
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

function renderPage(
  req: Request,
  res: Response,
  position: PositionFilter,
): void {
  const embed = isEmbed(req);
  try {
    const result = renderRankingsAppPage(publicDir, season(req), {
      // Built from the path alone (lib/request.ts), so each position is its
      // own canonical and no combination of season or embed mints another.
      canonical: canonicalUrl(req),
      embed,
      basePath: RANKINGS_BASE_PATH,
      linkQuery: linkQuery(req),
      position,
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
}

router.get(RANKINGS_BASE_PATH, (req, res) => {
  // `?pos=rb` was the old way to open a board. It is the path's job now, and
  // a query that can do it too is a second address for every board.
  if (req.query["pos"] !== undefined) {
    redirectTo(req, res, queryPosition(req) ?? "All");
    return;
  }
  renderPage(req, res, "All");
});

/**
 * The boards as CSV.
 *
 * Built from the same `getRankings` the page renders, so the file and the
 * screen can never disagree — and it carries the derived tier and team columns,
 * which the source file does not have.
 */
router.get(`${RANKINGS_BASE_PATH}/download.csv`, (req, res) => {
  try {
    const data = getRankings(season(req));
    if (!data) {
      res.status(404).type("text/plain").send("No rankings have been published");
      return;
    }
    res
      .set(
        "Content-Disposition",
        `attachment; filename="statchasers-rest-of-season-${data.season}.csv"`,
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
 * One board open: `/rest-of-season-rankings/rb`.
 *
 * Lower case only, and `all` is not a segment — the All board is the bare
 * path. Those spellings redirect rather than render, so each board has exactly
 * one address. Anything else is not a position and falls through to the 404.
 */
router.get(`${RANKINGS_BASE_PATH}/:pos`, (req, res, next) => {
  const segment = String(req.params["pos"] ?? "");
  const position = pathPosition(segment);
  if (position !== null) {
    if (req.query["pos"] !== undefined) {
      redirectTo(req, res, position);
      return;
    }
    renderPage(req, res, position);
    return;
  }

  const loose =
    segment.toLowerCase() === "all"
      ? "All"
      : pathPosition(segment.toLowerCase());
  if (loose !== null) {
    redirectTo(req, res, loose);
    return;
  }
  next();
});

/* ------------------------------------------------------ the old addresses */

router.get(LEGACY_BASE_PATH, (req, res) => {
  redirectTo(req, res, queryPosition(req) ?? "All");
});

router.get(`${LEGACY_BASE_PATH}/download.csv`, (req, res) => {
  res.redirect(
    301,
    `${RANKINGS_BASE_PATH}/download.csv${queryWithoutPos(req)}`,
  );
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
      // WordPress has never heard of `/download.csv` under its page, so the
      // CSV link is given this origin outright — the schedule's exports do
      // the same.
      downloadBase: `${publicOrigin(req)}${RANKINGS_BASE_PATH}`,
      linkQuery: fragmentLinkQuery(playerPrefix),
      // `?embed=1` means something only to this app. Once SC_RANKINGS_PATH
      // points the tabs at the WordPress page they must not carry it.
      tabQuery: basePath === RANKINGS_BASE_PATH ? "?embed=1" : "",
      position: queryPosition(req) ?? "All",
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
