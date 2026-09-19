/**
 * The NFL Player Page routes.
 *
 *   GET /player                      — index of the indexed players
 *   GET /player/:slug                — the player page
 *   GET /player/:slug?embed=1        — the same page, stripped for embedding
 *   GET /player/:slug?format=half    — the same page in another scoring format
 *   GET /embed/player/:slug          — the bare fragment, for the WordPress mount
 *
 * Mirrors routes/team.ts, including the posture that matters most: every route
 * ships `noindex, indexifembedded`, so the bare tool URL does not compete with
 * statchasers.com — and, by the same token, these pages are invisible to search
 * until something embeds them. `[statchasers_player]` is that something.
 *
 * Unlike the team hub there is no alias redirect. A team has a handful of
 * well-known aliases worth resolving ("NE", "patriots"); a player slug has
 * thousands of near-misses and no canonical alias set, so a slug that does not
 * resolve is a 404 with a way back rather than a guess.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../lib/logger";
import { devBarEnabled, injectDevBar } from "../lib/devbar";
import { liveReload } from "../lib/livereload";
import { canonicalUrl } from "../lib/request";
import { renderPlayerAppPage, renderPlayerFragment } from "../lib/player-ssr";
import { renderPlayerIndex } from "../lib/player-render";
import { getAvailableSeasons } from "../lib/player/data";
import { indexedPlayers } from "../lib/player/player-data";
import { parseScoringFormat, type ScoringFormat } from "../lib/player/scoring";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "public");

const router: IRouter = Router();

/** Values that switch embedded mode on. Anything else leaves it off. */
const TRUTHY = new Set(["1", "true", "yes", "on"]);

function isEmbed(req: Request): boolean {
  return TRUTHY.has(String(req.query["embed"] ?? "").trim().toLowerCase());
}

/** This origin's own player path — the prefix used when nothing overrides it. */
const PLAYER_PATH_PREFIX = "/player/";
const TEAM_PATH_PREFIX = "/team/";
const MATCHUP_PATH_PREFIX = "/nfl/";
const FPA_PATH = "/fpa";

/**
 * Query string carried onto internal links.
 *
 * Only `embed`, and only as the canonical `?embed=1`. Echoing the whole query
 * back into every link would let any parameter anyone appends mint another
 * crawlable URL — the duplicate URL space the canonical work exists to prevent.
 * The scoring format is deliberately NOT carried: it is per-page state, and
 * propagating it would multiply every link by three.
 */
function linkQuery(req: Request): string {
  return isEmbed(req) ? "?embed=1" : "";
}

/**
 * The query appended to links in the WordPress fragment.
 *
 * Same reasoning as the team hub's: `?embed=1` only means anything against this
 * origin, and once SC_PLAYER_PATH_PREFIX points links at statchasers.com the
 * query is actively harmful, because `embed` is a reserved WordPress public
 * query var and `/nfl/players/<slug>/?embed=1` serves WordPress's oEmbed
 * template instead of the page.
 */
function fragmentLinkQuery(prefix: string): string {
  const override = process.env["SC_PLAYER_LINK_QUERY"];
  if (override !== undefined) return override.trim();
  return prefix === PLAYER_PATH_PREFIX ? "?embed=1" : "";
}

/** A slug shaped like one of ours. Anything else is not looked up at all. */
function safeSlug(value: unknown): string {
  const slug = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{1,63}$/.test(slug) ? slug : "";
}

/**
 * Which section this URL is scoped to, if any.
 *
 * A closed list, not free text: `?section=` reaches renderPlayerPage, and an
 * unrecognised id there would silently fall through to the full page under a
 * URL that promised one section. Ids match the tab ids in player-render.ts.
 */
const SECTIONS = new Set([
  "overview",
  "stats",
  "game-log",
  "outlook",
  "injury",
  "news",
  "bio",
]);

function section(req: Request): string | undefined {
  const raw = String(req.query["section"] ?? "").trim().toLowerCase();
  return SECTIONS.has(raw) ? raw : undefined;
}

/**
 * Which advanced-stats season the reader asked for.
 *
 * Constrained to the seasons that actually have a table, so `?adv=1998` is
 * ignored rather than rendering an empty tab.
 */
function advancedSeason(req: Request): number | undefined {
  const raw = Number.parseInt(String(req.query["adv"] ?? ""), 10);
  if (!Number.isFinite(raw)) return undefined;
  return getAvailableSeasons().includes(raw) ? raw : undefined;
}

/**
 * Which season the Game Log tab is pinned to.
 *
 * Same constraint as `?adv=`, and the same reason: a season with no log file
 * behind it is ignored rather than rendered as an empty table. Whether this
 * PLAYER played that season is the data layer's call, not the router's — it is
 * the only thing holding the list of seasons he appeared in.
 *
 * Deliberately not part of the canonical. One game log per player is the page
 * that ranks, the season selector carries rel="nofollow", and `?log=2023` is a
 * rendering of that page rather than a second one. See player-seo.ts.
 */
function logSeason(req: Request): number | undefined {
  const raw = Number.parseInt(String(req.query["log"] ?? ""), 10);
  if (!Number.isFinite(raw)) return undefined;
  return getAvailableSeasons().includes(raw) ? raw : undefined;
}

function format(req: Request): ScoringFormat {
  return parseScoringFormat(String(req.query["format"] ?? "").trim().toLowerCase());
}

function noStoreHtml(res: Response, status: number, html: string): void {
  res
    .status(status)
    .set("X-Robots-Tag", "noindex")
    .set("Cache-Control", "no-store")
    .type("html")
    .send(html);
}

function notFound(res: Response): void {
  noStoreHtml(
    res,
    404,
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />` +
      `<meta name="robots" content="noindex" /><title>Player not found</title>` +
      `</head><body><h1>Player not found</h1>` +
      `<p><a href="/player">Browse NFL players</a></p></body></html>`,
  );
}

router.get("/player", (req, res) => {
  const index = renderPlayerIndex(indexedPlayers(), {
    linkQuery: linkQuery(req),
  });
  let html = liveReload().enabled ? liveReload().injectIntoHtml(index) : index;
  if (devBarEnabled()) {
    html = injectDevBar(html, { path: req.path, embed: isEmbed(req) });
  }

  res
    // Not cached in development, or the preview would keep serving the copy
    // from before your last edit.
    .set(
      "Cache-Control",
      liveReload().enabled ? "no-store" : "public, max-age=3600",
    )
    .set("X-Robots-Tag", "noindex, indexifembedded")
    .type("html")
    .send(html);
});

/**
 * The machine-readable roster, for whatever creates the WordPress pages.
 *
 * `scripts/create-player-pages.sh` needs a name, a position and a team for
 * every page it creates, and the alternative to this endpoint is a copy of the
 * player list pasted into the script — which is stale the moment a rookie is
 * added. The deployment is the thing that knows which slugs resolve, so it is
 * the thing that answers.
 *
 * Only the INDEXED players: the dictionary holds every player in the league,
 * and most of them have no game log, no advanced row and no bio. Creating a
 * WordPress page for each would be several thousand thin pages, which is the
 * opposite of what these pages are for.
 *
 * Team defences are excluded for the same reason one step further on. They are
 * in the indexed list because the news tool ranks them, but nothing this page
 * renders applies to one: no game log, no efficiency percentiles, no injury
 * history, no bio. A defence's page already exists and it is the team hub.
 */
router.get("/embed/players.json", (_req, res) => {
  const players = indexedPlayers().map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    position: row.position,
    team: row.team?.code ?? null,
    teamName: row.team?.fullName ?? null,
    teamSlug: row.team?.slug ?? null,
    headshot: row.headshot,
  }));

  res
    .set("Cache-Control", "public, max-age=3600")
    .set("X-Robots-Tag", "noindex")
    .json({ ok: true, count: players.length, players });
});

router.get("/player/:slug", (req, res) => {
  void (async () => {
    const slug = safeSlug(req.params.slug);
    if (!slug) {
      notFound(res);
      return;
    }

    const embed = isEmbed(req);

    try {
      const result = await renderPlayerAppPage(
        publicDir,
        slug,
        {
          // Built from the path alone (lib/request.ts), so neither ?embed=1 nor
          // ?format=half can mint a second canonical for the same page.
          canonical: canonicalUrl(req),
          embed,
          linkQuery: linkQuery(req),
          section: section(req),
        },
        {
          format: format(req),
          advancedSeason: advancedSeason(req),
          logSeason: logSeason(req),
        },
      );

      if (!result) {
        notFound(res);
        return;
      }

      const dev = liveReload().enabled;

      // The version fingerprints every input to the RENDER — the data, not the
      // shell — so in development an edit to player.html would revalidate to a
      // 304 and the preview would keep showing the old markup. Validators are
      // for production; a dev response is always fresh and never conditional.
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
        .set("Cache-Control", dev ? "no-store" : "public, max-age=60")
        // Same posture as the news tool and the team hubs: keep this origin out
        // of the index as a standalone result while letting Google use the
        // content on the statchasers.com page that embeds it.
        .set("X-Robots-Tag", "noindex, indexifembedded")
        .type("html")
        .send(html);
    } catch (err) {
      logger.error({ err, slug }, "Failed to render player page");
      noStoreHtml(
        res,
        500,
        `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />` +
          `<meta name="robots" content="noindex" /><title>Temporarily unavailable</title>` +
          `</head><body><h1>Temporarily unavailable</h1>` +
          `<p>This player page could not be built. Please try again shortly.</p>` +
          `</body></html>`,
      );
    }
  })();
});

/**
 * The bare fragment, for the WordPress plugin to print into a page.
 *
 * The direct mount is what makes the content belong to the statchasers.com URL
 * rather than to an iframe — the same reason the news tool has /embed/ssr and
 * the hubs have /embed/team/:slug. Always rendered in embedded mode: the host
 * page supplies the H1 and the page chrome.
 */
router.get("/embed/player/:slug", (req, res) => {
  void (async () => {
    const slug = safeSlug(req.params.slug);
    if (!slug) {
      res.status(404).type("text/plain").send("Unknown player");
      return;
    }

    // Links point at the public site's pages, not at this origin — otherwise
    // clicking a team inside a WordPress page would send the reader to the bare
    // tool.
    const playerPrefix = (
      process.env["SC_PLAYER_PATH_PREFIX"] ?? PLAYER_PATH_PREFIX
    ).trim();
    const teamPrefix = (
      process.env["SC_TEAM_PATH_PREFIX"] ?? TEAM_PATH_PREFIX
    ).trim();
    // The same variable routes/fpa.ts reads, so the two tools agree on where
    // the points-allowed page lives once it is mounted on WordPress.
    const fpaPath = (process.env["SC_FPA_PATH"] ?? FPA_PATH).trim();
    // And the same one routes/team.ts and routes/matchup.ts read, so a "View
    // matchup" button on a player card lands on the same page the team hub's
    // schedule sends a reader to.
    const matchupPrefix = (
      process.env["SC_MATCHUP_PATH_PREFIX"] ?? MATCHUP_PATH_PREFIX
    ).trim();

    try {
      const result = await renderPlayerFragment(
        slug,
        {
          embed: true,
          playerPathPrefix: playerPrefix,
          teamPathPrefix: teamPrefix,
          matchupPathPrefix: matchupPrefix,
          fpaPath,
          linkQuery: fragmentLinkQuery(playerPrefix),
          section: section(req),
        },
        {
          format: format(req),
          advancedSeason: advancedSeason(req),
          logSeason: logSeason(req),
        },
      );

      if (!result) {
        res.status(404).type("text/plain").send("Unknown player");
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
        .type("html")
        .send(result.html);
    } catch (err) {
      logger.error({ err, slug }, "Failed to render player fragment");
      res.status(503).type("text/plain").send("Player fragment unavailable");
    }
  })();
});

export default router;
