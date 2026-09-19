/**
 * Matchup pages: /nfl/<a>-vs-<b>/ and the fragment the plugin mounts.
 *
 * One address per pair. Every other spelling of the same pair — the teams
 * reversed, an abbreviation, a nickname — is a 301 to it, and anything that is
 * not a pair of two different real teams is a 404. Nothing falls through to a
 * team hub: a URL under /nfl/ that is not a matchup is not a page.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../lib/logger";
import { devBarEnabled, injectDevBar } from "../lib/devbar";
import { liveReload } from "../lib/livereload";
import { canonicalUrl } from "../lib/request";
import { matchupPath } from "../lib/matchup/matchup-render";
import { renderMatchupAppPage, renderMatchupFragment } from "../lib/matchup/matchup-ssr";
import { parseMatchupSlug, type MatchupPair } from "../lib/matchup/pair";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "public");

const router: IRouter = Router();

const TRUTHY = new Set(["1", "true", "yes", "on"]);
function isEmbed(req: Request): boolean {
  return TRUTHY.has(String(req.query["embed"] ?? "").trim().toLowerCase());
}

/** This origin's own paths — the prefixes used when nothing overrides them. */
const MATCHUP_PATH_PREFIX = "/nfl/";
const TEAM_PATH_PREFIX = "/team/";

/** Where the public pages live, for the fragment's links. */
function publicPrefixes(): { team: string; matchup: string; linkQuery: string } {
  const team = (process.env["SC_TEAM_PATH_PREFIX"] ?? TEAM_PATH_PREFIX).trim();
  const matchup = (process.env["SC_MATCHUP_PATH_PREFIX"] ?? MATCHUP_PATH_PREFIX).trim();
  // Same rule as the team fragment: ?embed=1 only while links stay on this
  // origin, where it means something.
  const override = process.env["SC_TEAM_LINK_QUERY"];
  const linkQuery =
    override !== undefined ? override.trim() : team === TEAM_PATH_PREFIX ? "?embed=1" : "";
  return { team, matchup, linkQuery };
}

function noStoreHtml(res: Response, status: number, html: string): void {
  res.status(status).set("X-Robots-Tag", "noindex").set("Cache-Control", "no-store").type("html").send(html);
}

function notFound(res: Response): void {
  noStoreHtml(
    res,
    404,
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />` +
      `<meta name="robots" content="noindex" /><title>Matchup not found</title>` +
      `</head><body><h1>Matchup not found</h1>` +
      `<p>A matchup is two different NFL teams, as <code>/nfl/&lt;team&gt;-vs-&lt;team&gt;/</code>. ` +
      `<a href="/team">Browse all 32 teams</a></p></body></html>`,
  );
}

router.get("/nfl/:pair", (req, res) => {
  void (async () => {
    const parsed = parseMatchupSlug(String(req.params.pair ?? ""));
    if (!parsed) {
      notFound(res);
      return;
    }
    if (!parsed.canonical) {
      res.redirect(
        301,
        `${matchupPath(MATCHUP_PATH_PREFIX, parsed.pair.slug)}${isEmbed(req) ? "?embed=1" : ""}`,
      );
      return;
    }
    await sendMatchupPage(req, res, parsed.pair);
  })();
});

async function sendMatchupPage(req: Request, res: Response, pair: MatchupPair): Promise<void> {
  const embed = isEmbed(req);
  try {
    const result = await renderMatchupAppPage(publicDir, pair, {
      canonical: canonicalUrl(req),
      embed,
      linkQuery: embed ? "?embed=1" : "",
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
      .set("Cache-Control", dev ? "no-store" : "public, max-age=60")
      .set("X-Robots-Tag", "noindex, indexifembedded")
      .type("html")
      .send(html);
  } catch (err) {
    logger.error({ err, pair: pair.slug }, "Failed to render matchup page");
    noStoreHtml(
      res,
      500,
      `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />` +
        `<meta name="robots" content="noindex" /><title>Temporarily unavailable</title>` +
        `</head><body><h1>Temporarily unavailable</h1>` +
        `<p>This matchup page could not be built. Please try again shortly.</p></body></html>`,
    );
  }
}

/** The bare fragment for the WordPress plugin. Always embedded. */
router.get("/embed/matchup/:pair", (req, res) => {
  void (async () => {
    const parsed = parseMatchupSlug(String(req.params.pair ?? ""));
    if (!parsed) {
      res.status(404).type("text/plain").send("Unknown matchup");
      return;
    }
    // The plugin resolves the canonical order itself and 301s before fetching;
    // a non-canonical fetch here is served rather than refused, since the
    // fragment carries no URL of its own.
    const prefixes = publicPrefixes();
    try {
      const result = await renderMatchupFragment(parsed.pair, {
        embed: true,
        teamPathPrefix: prefixes.team,
        matchupPathPrefix: prefixes.matchup,
        linkQuery: prefixes.linkQuery,
      });
      res.set("ETag", `W/"${result.version}"`);
      if (req.fresh) {
        res.status(304).end();
        return;
      }
      res
        .set("Cache-Control", "public, max-age=60")
        .set("X-Robots-Tag", "noindex, indexifembedded")
        // The plugin reads these to write the title for the state the page is in.
        .set("X-Matchup-State", result.state)
        .set("X-Matchup-Season", String(result.season))
        .type("html")
        .send(result.html);
    } catch (err) {
      logger.error({ err, pair: parsed.pair.slug }, "Failed to render matchup fragment");
      res.status(503).type("text/plain").send("Matchup fragment unavailable");
    }
  })();
});

export { router as matchupRouter };
