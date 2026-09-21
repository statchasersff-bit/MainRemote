/**
 * The NFL Player Page routes.
 *
 *   GET /player                      — index of the indexed players
 *   GET /player/:slug                — the player page
 *   GET /player/:slug/:section/      — one section of it, at its own address
 *   GET /player/:slug?embed=1        — the same page, stripped for embedding
 *   GET /player/:slug?format=half    — the same page in another scoring format
 *   GET /embed/player/:slug          — the bare fragment, for the WordPress mount
 *   GET /embed/players               — the index of every profile, for /nfl/players/
 *
 * `/player/:slug/:section/` is the public spelling: the address the canonical
 * names, the tab strip links to and the WordPress rewrite mirrors under
 * /nfl/players/. `?section=` is the internal one, which is how the plugin
 * fetches a scoped fragment; on the page routes it is a 301 to the pretty
 * address, because one page gets one URL.
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
import { escapeHtml } from "../lib/render";
import { renderPlayerAppPage, renderPlayerFragment } from "../lib/player-ssr";
import { renderPlayerIndex, renderPlayerIndexFragment } from "../lib/player-render";
import { getAvailableSeasons } from "../lib/player/data";
import { indexedPlayers, playerDirectory } from "../lib/player/player-data";
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

/**
 * The public address of one section: `/player/<slug>/<section>/`.
 *
 * Mirrors sectionPath() on the team side, and exists for the same reason: the
 * profile answers seven different questions at one address, and one address
 * gets one title tag. It is also what the tab strip links to, which is what
 * stops those seven URLs being pages nothing on the site points at.
 */
function playerSectionPath(slug: string, section: string): string {
  return `${playerPath(slug)}/${section}/`;
}

/** The profile's own address on this origin. */
function playerPath(slug: string): string {
  return `${PLAYER_PATH_PREFIX}${slug}`;
}

/**
 * Has the host agreed to stand down its own page heading?
 *
 * `?h1=1` from the WordPress plugin's "the tool supplies the heading" mode.
 * Absent, the fragment keeps every heading at <h2> and the host's title is the
 * page's H1, which is the default and the safe answer for any other embedding.
 */
function ownHeading(req: Request): boolean {
  return String(req.query["h1"] ?? "").trim() === "1";
}

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

/**
 * A real player, a section we do not serve.
 *
 * A true 404, deliberately — falling through to the profile here would let any
 * path segment mint an indexable copy of it, once per player. The way back is
 * the profile the reader nearly reached, not the roster index: they have the
 * right player and the wrong page, and sending them to the top of the list is
 * answering a question they did not ask. Mirrors sectionNotFound() on the team
 * side.
 */
function sectionNotFound(res: Response, slug: string): void {
  noStoreHtml(
    res,
    404,
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />` +
      `<meta name="robots" content="noindex" /><title>Page not found</title>` +
      `</head><body><h1>Page not found</h1>` +
      `<p><a href="${escapeHtml(playerPath(slug))}">Back to the player page</a></p>` +
      `</body></html>`,
  );
}

router.get("/player", (req, res) => {
  const index = renderPlayerIndex(playerDirectory(format(req)), {
    // The standalone index links within this origin, so both prefixes are the
    // defaults. Only the embedded twin below points anywhere else.
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
/** djb2, as in the *-ssr modules: short, stable, and never a security claim. */
function indexHash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i += 1) {
    h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/**
 * The index as a fragment, for the container page at /nfl/players/.
 *
 * Every profile has a mount; the page that lists them did not, so it was left
 * as whatever the builder wrote into it once — a stub list in the theme's own
 * styling, in front of the profiles it points at. This is that page's mount,
 * and the twin of /embed/teams.
 *
 * Links point at the public site rather than this origin, exactly as the
 * profile fragment's do.
 */
router.get("/embed/players", (req, res) => {
  const prefix = (
    process.env["SC_PLAYER_PATH_PREFIX"] ?? PLAYER_PATH_PREFIX
  ).trim();
  // Where the club headings link. Same variable the profile fragment reads, so
  // a club named on the index and the same club named inside a profile are the
  // same address.
  const teamPrefix = (
    process.env["SC_TEAM_PATH_PREFIX"] ?? TEAM_PATH_PREFIX
  ).trim();
  const html = renderPlayerIndexFragment(playerDirectory(), {
    playerPathPrefix: prefix,
    teamPathPrefix: teamPrefix,
    linkQuery: fragmentLinkQuery(prefix),
  });

  // Fingerprinted over the markup, so a roster move or a prefix change is a
  // different fragment rather than the old one served for the rest of the TTL.
  res.set("ETag", `W/"${indexHash(html)}"`);
  if (req.fresh) {
    res.status(304).end();
    return;
  }

  res
    .set("Cache-Control", "public, max-age=300")
    .set("X-Robots-Tag", "noindex, indexifembedded")
    .type("html")
    .send(html);
});

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

    // `?section=` is the internal spelling — it is how the WordPress plugin
    // fetches a scoped fragment. A reader or a crawler holding it is sent to
    // the one public address that section has, or the same page would answer
    // at two URLs. The rest of the query rides along: ?format=half names a
    // different set of numbers, not a different page.
    const scoped = section(req);
    if (scoped) {
      const query = new URLSearchParams(
        Object.entries(req.query)
          .filter(([key]) => key !== "section")
          .map(([key, value]) => [key, String(value)]),
      ).toString();

      res.redirect(
        301,
        `${playerSectionPath(slug, scoped)}${query ? `?${query}` : ""}`,
      );
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
 * The pretty section URL: `/player/<slug>/<section>/`.
 *
 * The address the canonical names and the tab strip links to. The segment is
 * checked against the closed list BEFORE the player is looked up, so an unknown
 * section on a real player is a 404 rather than the full profile wearing a
 * second name — an unbounded supply of duplicates is exactly what the check
 * prevents.
 *
 * Everything else about the render is identical to the profile's: same hero,
 * same format toggle, same section markup. Only the panel count and the
 * metadata change, which is what makes the two addresses one component.
 */
router.get("/player/:slug/:section", (req, res) => {
  void (async () => {
    const slug = safeSlug(req.params.slug);
    // Exact, not normalised: /Stats/ resolving would be a second address for
    // the same page, and the point of this route is that there is one.
    const scoped = String(req.params.section ?? "");

    if (!slug) {
      notFound(res);
      return;
    }
    if (!SECTIONS.has(scoped)) {
      sectionNotFound(res, slug);
      return;
    }

    const embed = isEmbed(req);

    try {
      const result = await renderPlayerAppPage(
        publicDir,
        slug,
        {
          canonical: canonicalUrl(req),
          embed,
          linkQuery: linkQuery(req),
          section: scoped,
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
        .set("X-Robots-Tag", "noindex, indexifembedded")
        .type("html")
        .send(html);
    } catch (err) {
      logger.error({ err, slug, section: scoped }, "Failed to render player section");
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
          ownHeading: ownHeading(req),
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
