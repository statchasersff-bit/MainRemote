/**
 * The fantasy strength-of-schedule routes.
 *
 *   GET /strength-of-schedule                         - the overview (Team SOS, RB, PPR)
 *   GET /strength-of-schedule?tab=player&scoring=half-ppr
 *   GET /strength-of-schedule/rb                      - the RB page (and /qb, /wr, /te, /playoffs)
 *   GET /strength-of-schedule?pos=rb                  - 301 to /strength-of-schedule/rb
 *   GET /strength-of-schedule?embed=1                 - the same page, stripped for embedding
 *   GET /sos/download.csv?tab&pos&scoring             - the view on screen, as CSV
 *   GET /embed/sos?page&tab&scoring                   - the bare fragment, for the WordPress mount
 *
 * Mirrors routes/fpa.ts, including the posture that matters: every page route
 * ships `noindex, indexifembedded`, so this origin does not compete with
 * statchasers.com.
 *
 * Since mak's spec of 2026-10-09 each position is a page of its own, the way
 * the rest-of-season rankings' are (routes/rankings.ts): `/rb` has its own
 * title, H1, description and canonical, and `?pos=rb` 301s to it. The tab and
 * the scoring stay in the query string and never mint a canonical. Each value
 * has one spelling; anything else is the default rather than a 404, as the
 * source did it, so a hand-edited link never lands on a blank board.
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
import { renderSosCsv, SOS_DEFAULT_PAGE_BASE, sosPagePath } from "../lib/sos-render";
import {
  getSosBoard,
  parseSosPage,
  parseSosState,
  SOS_SUB_PAGES,
  type SosPage,
  type SosState,
} from "../lib/sos/sos-data";
import { scheduleSeason } from "../lib/schedule/schedule-data";
import { getSOSUrl } from "../lib/team/links";

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

/**
 * `?pos=rb` on any page route is the RB page's address now: 301 there, with
 * the rest of the query along for the ride minus the defaults (`tab=team`,
 * `scoring=ppr`), so `?tab=team&pos=rb` lands on a clean `/rb`.
 */
function redirectToPage(req: Request, res: Response, page: SosPage): void {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query)) {
    if (key === "pos") continue;
    for (const v of Array.isArray(value) ? value : [value]) {
      if (typeof v !== "string") continue;
      const clean = v.trim().toLowerCase();
      if (key === "tab" && (clean === "team" || clean === "")) continue;
      if (key === "scoring" && (clean === "ppr" || clean === "")) continue;
      params.append(key, v);
    }
  }
  const query = params.toString();
  res.redirect(301, sosPagePath(SOS_DEFAULT_PAGE_BASE, page) + (query ? `?${query}` : ""));
}

/** The page a `?pos=` names, or null when the query carries none that is one. */
function queryPage(req: Request): SosPage | null {
  if (req.query["pos"] === undefined) return null;
  const page = parseSosPage(req.query["pos"]);
  return page === "all" ? null : page;
}

/**
 * Where the WordPress fragment's sub-page links go: the public SOS page
 * (SC_SOS_URL, lib/team/links.ts), so `/rb/` is the WordPress address.
 */
function embedPageBase(): string {
  return getSOSUrl() ?? SOS_DEFAULT_PAGE_BASE;
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

function renderPage(req: Request, res: Response, page: SosPage): void {
  void (async () => {
    const embed = isEmbed(req);
    try {
      const result = await renderSosAppPage(publicDir, state(req), {
        // Built from the path alone (lib/request.ts), so each page is its own
        // canonical and no view can mint a second one.
        canonical: canonicalUrl(req),
        fallbackSeason: scheduleSeason(),
        embed,
        page,
        pageBase: SOS_DEFAULT_PAGE_BASE,
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
      logger.error({ err, page }, "Failed to render the strength of schedule page");
      noStoreHtml(res, 500, UNAVAILABLE);
    }
  })();
}

router.get(SOS_PAGE_PATH, (req, res) => {
  const page = queryPage(req);
  if (page) {
    redirectToPage(req, res, page);
    return;
  }
  renderPage(req, res, "all");
});

/**
 * One page open: `/strength-of-schedule/rb`, or `/playoffs`. Lower case only;
 * the other spellings redirect, so each page has exactly one address, and a
 * segment that is not a page falls through to the 404.
 */
router.get(`${SOS_PAGE_PATH}/:page`, (req, res, next) => {
  const segment = String(req.params["page"] ?? "");
  const page = parseSosPage(segment);
  if (page === "all" || !(SOS_SUB_PAGES as readonly string[]).includes(page)) {
    next();
    return;
  }
  if (segment !== page || req.query["pos"] !== undefined) {
    redirectToPage(req, res, page);
    return;
  }
  renderPage(req, res, page);
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
        // `?page=rb` is the RB page's fragment; `?pos=` alone still picks the
        // overview's board, as it always did.
        page: parseSosPage(req.query["page"]),
        pageBase: embedPageBase(),
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
