/**
 * Matchup pages: /nfl/<a>-vs-<b>/ and the fragment the plugin mounts.
 *
 * One address per pair. Every other spelling of the same pair - the teams
 * reversed, an abbreviation, a nickname - is a 301 to it, and anything that is
 * not a pair of two different real teams is a 404. Nothing falls through to a
 * team hub: a URL under /nfl/ that is not a matchup is not a page.
 *
 * Beneath the pair, one address per meeting: /nfl/<a>-vs-<b>/2026-week-1/. It
 * exists only once the pair's own page has stopped leading with that game -
 * inside RECENT_WINDOW_MS the dated URL 301s up to the pair, so the recap has
 * exactly one address at any moment and the two never compete.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../lib/logger";
import { devBarEnabled, injectDevBar } from "../lib/devbar";
import { liveReload } from "../lib/livereload";
import { canonicalUrl } from "../lib/request";
import { gamePath, matchupPath, matchupShare } from "../lib/matchup/matchup-render";
import { getMatchupData } from "../lib/matchup/matchup-data";
import { archivedGames } from "../lib/matchup/game-index";
import { renderShareImage } from "../lib/matchup/og-image";
import { renderMatchupAppPage, renderMatchupFragment } from "../lib/matchup/matchup-ssr";
import {
  parseGameSegment,
  parseMatchupSlug,
  type MatchupGameRef,
  type MatchupPair,
} from "../lib/matchup/pair";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "public");

const router: IRouter = Router();

const TRUTHY = new Set(["1", "true", "yes", "on"]);
function isEmbed(req: Request): boolean {
  return TRUTHY.has(String(req.query["embed"] ?? "").trim().toLowerCase());
}

/** This origin's own paths - the prefixes used when nothing overrides them. */
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

/**
 * GET /embed/matchup-games.json - every dated game page that exists this
 * season, for the WordPress sitemap. See lib/matchup/game-index.ts.
 */
router.get("/embed/matchup-games.json", (req, res) => {
  void (async () => {
    try {
      const { matchup } = publicPrefixes();
      const index = await archivedGames(matchup);
      res.set("Cache-Control", "public, max-age=1800").json({ ok: true, ...index });
    } catch (err) {
      logger.warn({ err }, "matchup game index failed");
      res.status(503).set("Cache-Control", "no-store").json({ ok: false, error: "unavailable" });
    }
  })();
});

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

router.get("/nfl/:pair/:game", (req, res) => {
  void (async () => {
    const parsed = parseMatchupSlug(String(req.params.pair ?? ""));
    if (!parsed) {
      notFound(res);
      return;
    }
    const game = parseGameSegment(String(req.params.game ?? ""));
    if (!game) {
      notFound(res);
      return;
    }
    if (!parsed.canonical) {
      res.redirect(
        301,
        `${gamePath(MATCHUP_PATH_PREFIX, parsed.pair.slug, game)}${isEmbed(req) ? "?embed=1" : ""}`,
      );
      return;
    }
    await sendMatchupPage(req, res, parsed.pair, game);
  })();
});

async function sendMatchupPage(
  req: Request,
  res: Response,
  pair: MatchupPair,
  game: MatchupGameRef | null = null,
): Promise<void> {
  const embed = isEmbed(req);
  try {
    const result = await renderMatchupAppPage(publicDir, pair, {
      canonical: canonicalUrl(req),
      embed,
      linkQuery: embed ? "?embed=1" : "",
      game,
    });

    // Both answers are cheap to reach and expensive to guess: whether the week
    // exists, and whether the pair page has let go of it, are facts about the
    // schedule that only the data layer has. The render that produced them is
    // discarded on these two paths, which costs one cached build on a request
    // that was never going to be a page.
    if (result.pinnedMissing) {
      notFound(res);
      return;
    }
    if (result.pinnedIsCurrent) {
      res.redirect(
        301,
        `${matchupPath(MATCHUP_PATH_PREFIX, pair.slug)}${embed ? "?embed=1" : ""}`,
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

/**
 * A completed game's share image: /og/<away>-vs-<home>-<season>-<round>.png.
 * Public (not behind the embed key), because the crawlers that read og:image
 * are not WordPress. Drawn once and kept on disk; see og-image.ts.
 */
const OG_FILE = /^([a-z0-9-]+?)-vs-([a-z0-9-]+?)-(\d{4}-(?:week-\d{1,2}|postseason-week-\d{1,2}|wild-card|divisional|conference-championship|super-bowl))\.png$/;

router.get("/og/:file", (req, res) => {
  void (async () => {
    const match = OG_FILE.exec(String(req.params.file ?? ""));
    const parsed = match ? parseMatchupSlug(`${match[1]}-vs-${match[2]}`) : null;
    const game = match ? parseGameSegment(match[3]!) : null;
    if (!match || !parsed || !game) {
      res.status(404).type("text/plain").send("Unknown image");
      return;
    }
    try {
      const data = await getMatchupData(parsed.pair, Date.now(), game);
      const share = matchupShare(data);
      // The file name must be the one the page advertises: away first.
      if (!share || share.file !== match[0]) {
        res.status(404).type("text/plain").send("Unknown image");
        return;
      }
      const png = await renderShareImage(share.file, share.input);
      res.set("Cache-Control", "public, max-age=86400").type("png").send(png);
    } catch (err) {
      logger.error({ err, file: match[0] }, "Failed to draw share image");
      res.status(503).type("text/plain").send("Image unavailable");
    }
  })();
});

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
    // `?game=2026-week-1` is how the plugin asks for a dated page. The pretty
    // path is the only public spelling - the same split the team sections use,
    // where WordPress owns the URL and this origin owns the fragment.
    const raw = String(req.query["game"] ?? "").trim();
    const game = raw ? parseGameSegment(raw) : null;
    if (raw && !game) {
      res.status(404).type("text/plain").send("Unknown game");
      return;
    }
    try {
      const result = await renderMatchupFragment(parsed.pair, {
        embed: true,
        teamPathPrefix: prefixes.team,
        matchupPathPrefix: prefixes.matchup,
        linkQuery: prefixes.linkQuery,
        game,
      });
      if (result.pinnedMissing) {
        res.status(404).type("text/plain").send("Unknown game");
        return;
      }
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
        // The score, for the postgame description the plugin mirrors. Empty
        // header rather than an absent one so the plugin reads one shape.
        .set("X-Matchup-Score", result.scoreLine)
        // "Week 2" while the pair's page leads with one of this season's
        // played games, for the plugin's title mirror; empty otherwise.
        .set("X-Matchup-Week", result.week)
        // The H1 and the <title>, so WordPress prints this origin's words
        // rather than rebuilding them: a game page's heading runs away-then-
        // home, which only the API knows. Percent-encoded, because the title's
        // score carries an en dash and a header value must be Latin-1.
        .set("X-Matchup-Heading", encodeURIComponent(result.heading))
        .set("X-Matchup-Title", encodeURIComponent(result.title))
        // The description and, on a completed game, the share image's path on
        // this origin and its alt text. Empty when there is none.
        .set("X-Matchup-Description", encodeURIComponent(result.description))
        .set("X-Matchup-Image", result.shareImage?.path ?? "")
        .set("X-Matchup-Image-Alt", encodeURIComponent(result.shareImage?.alt ?? ""))
        // "current" tells the plugin the pair page is still leading with this
        // game, so the dated WordPress URL must 301 up to the pair's - the
        // mirror of what this origin's own route does above. Empty when the
        // request was not a game address at all.
        .set(
          "X-Matchup-Game",
          game ? (result.pinnedIsCurrent ? "current" : "archived") : "",
        )
        .type("html")
        .send(result.html);
    } catch (err) {
      logger.error({ err, pair: parsed.pair.slug }, "Failed to render matchup fragment");
      res.status(503).type("text/plain").send("Matchup fragment unavailable");
    }
  })();
});

export { router as matchupRouter };
