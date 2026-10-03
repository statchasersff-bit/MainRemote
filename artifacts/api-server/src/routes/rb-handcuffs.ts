/**
 * The RB handcuff rankings routes.
 *
 *   GET /rb-handcuff-rankings                - the board
 *   GET /rb-handcuff-rankings?embed=1        - the same page, stripped for embedding
 *   GET /embed/rb-handcuffs                  - the bare fragment, for the WordPress mount
 *   GET /embed/rb-handcuffs/player/:id       - one player's card, for the drawer
 *
 * Mirrors routes/player-stats.ts, including the posture that matters: every
 * route ships `noindex, indexifembedded`, so this origin does not compete with
 * statchasers.com - and by the same token the board is invisible to search
 * until `[statchasers_rb_handcuffs]` embeds it.
 *
 * The path is the WordPress page's, `/rb-handcuff-rankings/`, as the rankings
 * board's is. There is one board and one address: the weights, the sort, the
 * open rows and the compare tray are controls, and none of them is in a URL.
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
  renderHandcuffAppPage,
  renderHandcuffCardFragment,
  renderHandcuffFragment,
} from "../lib/rb-handcuffs-ssr";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "public");

const router: IRouter = Router();

const TRUTHY = new Set(["1", "true", "yes", "on"]);

const PAGE_PATH = "/rb-handcuff-rankings";
const FRAGMENT_PATH = "/embed/rb-handcuffs";
const PLAYER_PATH_PREFIX = "/player/";

/** Card ids are "<team>-<name>", lower case. Anything else is not worth a lookup. */
const CARD_ID = /^[a-z0-9-]{3,80}$/;

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
  const override = process.env["SC_RB_HANDCUFFS_LINK_QUERY"];
  if (override !== undefined) return override.trim();
  return prefix === PLAYER_PATH_PREFIX ? "?embed=1" : "";
}

function fragmentPlayerPrefix(): string {
  return (process.env["SC_PLAYER_PATH_PREFIX"] ?? PLAYER_PATH_PREFIX).trim();
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

router.get(PAGE_PATH, (req, res) => {
  const embed = isEmbed(req);
  try {
    const result = renderHandcuffAppPage(publicDir, {
      // Built from the path alone (lib/request.ts), so no query can mint a
      // second canonical.
      canonical: canonicalUrl(req),
      embed,
      linkQuery: linkQuery(req),
      // Relative is right here: this page is served from the same origin the
      // card endpoint is.
      endpoint: FRAGMENT_PATH,
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
    logger.error({ err }, "Failed to render the RB handcuff rankings page");
    noStoreHtml(res, 500, UNAVAILABLE);
  }
});

/**
 * The bare fragment, for the WordPress plugin to print into a page.
 *
 * Always rendered in embedded mode: the host page supplies the heading and the
 * page chrome. With no snapshot it answers 404 rather than an empty shell, so
 * the shortcode leaves the host page intact instead of printing a hole in it.
 */
router.get(FRAGMENT_PATH, (req, res) => {
  const prefix = fragmentPlayerPrefix();
  try {
    const result = renderHandcuffFragment({
      embed: true,
      playerPathPrefix: prefix,
      linkQuery: fragmentLinkQuery(prefix),
      // Absolute, and it has to be: this markup is printed inside a
      // statchasers.com page, where a relative path resolves against
      // WordPress. Built from the request, so it is whatever origin the
      // plugin actually reached us on.
      endpoint: browserEndpoint(req, FRAGMENT_PATH),
    });

    if (!result.board) {
      res
        .status(404)
        .set("Cache-Control", "no-store")
        .type("text/plain")
        .send("No RB handcuff rankings have been published");
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
    logger.error({ err }, "Failed to render the RB handcuff rankings fragment");
    res.status(503).type("text/plain").send("RB handcuff rankings fragment unavailable");
  }
});

/**
 * One player's card. Fetched by the bundle, cross-origin from a statchasers.com
 * page (the app's CORS policy is open), when a reader opens it - the card is
 * most of the board's weight and few readers open more than a handful, which is
 * why the standalone app split it into a lazy chunk.
 *
 * Its player links follow the fragment's, since that is where it is shown.
 */
router.get(`${FRAGMENT_PATH}/player/:id`, (req, res) => {
  const id = String(req.params["id"] ?? "");
  if (!CARD_ID.test(id)) {
    res.status(404).set("Cache-Control", "no-store").type("text/plain").send("No such player");
    return;
  }
  const embedded = isEmbed(req) || req.query["from"] === "embed";
  const prefix = embedded ? fragmentPlayerPrefix() : PLAYER_PATH_PREFIX;
  try {
    const result = renderHandcuffCardFragment(id, {
      embed: true,
      playerPathPrefix: prefix,
      linkQuery: embedded ? fragmentLinkQuery(prefix) : "",
    });
    if (!result) {
      res.status(404).set("Cache-Control", "no-store").type("text/plain").send("No such player");
      return;
    }

    res.set("ETag", `W/"${result.version}"`);
    if (req.fresh) {
      res.status(304).end();
      return;
    }

    res
      .set("Cache-Control", "public, max-age=300")
      .set("X-Robots-Tag", "noindex")
      .type("html")
      .send(result.html);
  } catch (err) {
    logger.error({ err, id }, "Failed to render an RB handcuff player card");
    res.status(503).type("text/plain").send("Player card unavailable");
  }
});

export default router;
