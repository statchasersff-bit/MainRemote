/**
 * The NFL Team Hub routes.
 *
 *   GET /team                     - index of all 32 teams
 *   GET /team/:slug               - the team hub page
 *   GET /team/:slug?embed=1       - the same page, stripped for embedding
 *   GET /embed/team/:slug         - the bare fragment, for the WordPress mount
 *   GET /embed/teams              - the index of all 32, for the container page
 *
 * A slug that is not canonical but still names a team - "/team/NE",
 * "/team/patriots", "/team/oakland" - is redirected to the canonical URL rather
 * than served. One page, one address: the same rule that makes the news tool
 * 404 everything except "/" (see app.ts). Anything that names no team at all is
 * a 404 with a way back, not a redirect to an arbitrary team.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../lib/logger";
import { devBarEnabled, injectDevBar } from "../lib/devbar";
import { liveReload } from "../lib/livereload";
import { canonicalUrl } from "../lib/request";
import { escapeHtml } from "../lib/render";
import { renderTeamAppPage, renderTeamFragment } from "../lib/team-ssr";
import {
  HUB_SECTION,
  PUBLIC_SECTIONS,
  renderTeamIndex,
  renderTeamIndexFragment,
  sectionPath,
} from "../lib/team-render";
import {
  getTeamBySlug,
  normalizeTeamName,
  TEAMS,
  type NflTeam,
} from "../lib/team/teams";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "public");

const router: IRouter = Router();

/** Values that switch embedded mode on. Anything else leaves it off. */
const TRUTHY = new Set(["1", "true", "yes", "on"]);

function isEmbed(req: Request): boolean {
  return TRUTHY.has(String(req.query["embed"] ?? "").trim().toLowerCase());
}

/**
 * Query string carried onto team-switcher links.
 *
 * Only `embed` is preserved, and only as the canonical `?embed=1`. Echoing the
 * whole query back into 31 links would let any parameter anyone appends mint 31
 * more crawlable URLs - the duplicate URL space the canonical work exists to
 * prevent.
 */
function switcherQuery(req: Request): string {
  return isEmbed(req) ? "?embed=1" : "";
}

/** This origin's own team path - the prefix used when nothing overrides it. */
const TEAM_PATH_PREFIX = "/team/";

/**
 * Which section this URL is scoped to, if any.
 *
 * A closed list, not free text: `?section=` reaches the renderer, and an
 * unrecognized id there would silently fall through to the hub under a URL that
 * promised one section. Ids match the tab ids in team-render.ts, and the list
 * is mirrored by STATCHASERS_TEAM_SECTIONS in the WordPress plugin - that is
 * what mints these URLs, so the two lists cannot drift without a rewrite rule
 * pointing at a section the API will not scope to.
 *
 * All six are public, `news` included: it was held back while an archive was
 * two stories deep, and the season has since filled it.
 */
const SECTIONS = new Set([
  "outlook",
  "usage",
  "stats",
  "news",
  "depth-chart",
  "schedule",
  "matchups",
]);

function section(req: Request): string | undefined {
  const raw = String(req.query["section"] ?? "").trim().toLowerCase();
  return SECTIONS.has(raw) ? raw : undefined;
}

/**
 * Whether a section has a pretty URL of its own.
 *
 * `/team/<slug>/<section>/` is the public address and the one the canonical
 * names; `?section=` is the internal form the WordPress plugin fetches with.
 * Only the public sections get the pretty route, so `/team/<slug>/news/` is a
 * 404 rather than a fifth indexable copy of the hub.
 */
function isPublicSection(id: string): id is (typeof PUBLIC_SECTIONS)[number] {
  return (PUBLIC_SECTIONS as readonly string[]).includes(id);
}

/** The query a redirect carries: `embed` only, never the section. */
function embedQuery(req: Request): string {
  return isEmbed(req) ? "?embed=1" : "";
}

/**
 * A section's address on this origin. The hub is `/team/<slug>` here, without
 * the slash sectionPath() gives it, because that is the form the hub's own
 * canonical names - so the Outlook, which is the hub, redirects there.
 */
function teamSectionPath(slug: string, section: string): string {
  return section === HUB_SECTION
    ? `${TEAM_PATH_PREFIX}${slug}`
    : sectionPath(TEAM_PATH_PREFIX, slug, section);
}

function teamNotFound(res: Response): void {
  noStoreHtml(
    res,
    404,
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />` +
      `<meta name="robots" content="noindex" /><title>Team not found</title>` +
      `</head><body><h1>Team not found</h1>` +
      `<p><a href="/team">Browse all 32 NFL teams</a></p></body></html>`,
  );
}

function sectionNotFound(res: Response, team: NflTeam): void {
  // A true 404, deliberately. Falling through to the hub here would let any
  // path segment mint an indexable copy of it.
  noStoreHtml(
    res,
    404,
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />` +
      `<meta name="robots" content="noindex" /><title>Page not found</title>` +
      `</head><body><h1>Page not found</h1>` +
      `<p><a href="/team/${escapeHtml(team.slug)}">${escapeHtml(team.fullName)} hub</a></p>` +
      `</body></html>`,
  );
}

/**
 * The query string appended to switcher links in the WordPress fragment.
 *
 * `?embed=1` is only meaningful against this origin's `/team/:slug`, where it
 * asks for the chrome-less render. Once SC_TEAM_PATH_PREFIX points the switcher
 * at statchasers.com the query is not just useless, it is harmful: `embed` is a
 * reserved WordPress public query var, so `/nfl/teams/dallas-cowboys/?embed=1`
 * serves WordPress's oEmbed template instead of the page. Every team page would
 * carry 31 links to that, and each one is a crawlable URL variant of a page
 * that already exists at a clean address.
 *
 * So it is derived rather than fixed: keep it while the prefix is still local,
 * drop it once the links leave this origin. SC_TEAM_LINK_QUERY overrides both
 * for a mount that needs something else; set it to a single space to force it
 * empty while the prefix is still the default.
 */
function fragmentLinkQuery(prefix: string): string {
  const override = process.env["SC_TEAM_LINK_QUERY"];
  if (override !== undefined) return override.trim();
  return prefix === TEAM_PATH_PREFIX ? "?embed=1" : "";
}

function noStoreHtml(res: Response, status: number, html: string): void {
  res
    .status(status)
    .set("X-Robots-Tag", "noindex")
    .set("Cache-Control", "no-store")
    .type("html")
    .send(html);
}

async function sendTeamPage(
  req: Request,
  res: Response,
  team: NflTeam,
  scoped?: string,
): Promise<void> {
  const embed = isEmbed(req);
  try {
    const result = await renderTeamAppPage(publicDir, team, {
      // Built from the path alone (lib/request.ts), so ?embed=1 can never mint
      // a second canonical for the same page - and on a section URL the path
      // IS the pretty form, so the canonical is self-referencing for free.
      canonical: canonicalUrl(req),
      embed,
      linkQuery: switcherQuery(req),
      section: scoped,
    });

    // Development only: the same reload snippet the news page gets, so editing
    // team.css or team.html refreshes the Replit preview. Inert in production -
    // liveReload() is a no-op unless setupLiveReload() actually armed it.
    const dev = liveReload().enabled;

    // The version fingerprints every input to the RENDER - the data, not the
    // shell - so in development an edit to team.html would revalidate to a 304
    // and the preview would keep showing the old markup. Validators are for
    // production; a dev response is always fresh and never conditional.
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
      // Same posture as the news tool: keep this origin out of the index as a
      // standalone result while letting Google use the content on the
      // statchasers.com page that embeds it. See lib/team-seo.ts.
      .set("X-Robots-Tag", "noindex, indexifembedded")
      .type("html")
      .send(html);
  } catch (err) {
    logger.error({ err, team: team.abbreviation }, "Failed to render team page");
    noStoreHtml(
      res,
      500,
      `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />` +
        `<meta name="robots" content="noindex" /><title>Temporarily unavailable</title>` +
        `</head><body><h1>Temporarily unavailable</h1>` +
        `<p>This team page could not be built. Please try again shortly.</p>` +
        `</body></html>`,
    );
  }
}

router.get("/team", (req, res) => {
  const index = renderTeamIndex(TEAMS, { linkQuery: switcherQuery(req) });
  let html = liveReload().enabled
    ? liveReload().injectIntoHtml(index)
    : index;
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

router.get("/team/:slug", (req, res) => {
  void (async () => {
    const raw = String(req.params.slug ?? "");
    const scoped = section(req);
    const canonicalTeam = getTeamBySlug(raw);

    if (canonicalTeam) {
      // `?section=` is the internal spelling. A public section has one address
      // - the pretty one - so the query form is sent there rather than served,
      // or the same page would answer at two URLs.
      if (scoped && isPublicSection(scoped)) {
        res.redirect(
          301,
          `${teamSectionPath(canonicalTeam.slug, scoped)}${embedQuery(req)}`,
        );
        return;
      }
      // Anything else scoped (`news`) has no public address and renders here.
      await sendTeamPage(req, res, canonicalTeam, scoped);
      return;
    }

    // Not the canonical slug, but it may still name a team: an abbreviation, a
    // nickname, or a retired code. 301 to the real URL so there is exactly one
    // address per team. The section rides along: /team/ne?section=schedule is
    // a request for the schedule, and dropping it here would land the reader
    // on the hub via a 301 they cannot see happening.
    const alias = normalizeTeamName(raw);
    if (alias) {
      if (scoped && isPublicSection(scoped)) {
        res.redirect(
          301,
          `${teamSectionPath(alias.slug, scoped)}${embedQuery(req)}`,
        );
        return;
      }
      const params = new URLSearchParams();
      if (isEmbed(req)) params.set("embed", "1");
      if (scoped) params.set("section", scoped);
      const query = params.toString();
      res.redirect(301, `/team/${alias.slug}${query ? `?${query}` : ""}`);
      return;
    }

    teamNotFound(res);
  })();
});

/**
 * The pretty section URL: `/team/<slug>/<section>/`.
 *
 * This is the address the canonical names, the sitemap lists and the hub links
 * to. The segment is checked against the public list BEFORE the team, so an
 * unknown section on a real team is a 404 and not the hub under a new name.
 */
router.get("/team/:slug/:section", (req, res) => {
  void (async () => {
    const raw = String(req.params.slug ?? "");
    // Exact, not normalized: /Stats/ resolving would be a second address for
    // the same page, and the point of this route is that there is one.
    const scoped = String(req.params.section ?? "");
    const canonicalTeam = getTeamBySlug(raw);

    if (canonicalTeam) {
      if (!isPublicSection(scoped)) {
        sectionNotFound(res, canonicalTeam);
        return;
      }
      // The Outlook is the hub. See HUB_SECTION.
      if (scoped === HUB_SECTION) {
        res.redirect(301, `${teamSectionPath(canonicalTeam.slug, scoped)}${embedQuery(req)}`);
        return;
      }
      await sendTeamPage(req, res, canonicalTeam, scoped);
      return;
    }

    const alias = normalizeTeamName(raw);
    if (alias) {
      if (!isPublicSection(scoped)) {
        sectionNotFound(res, alias);
        return;
      }
      res.redirect(
        301,
        `${teamSectionPath(alias.slug, scoped)}${embedQuery(req)}`,
      );
      return;
    }

    teamNotFound(res);
  })();
});

/**
 * The bare fragment, for the WordPress plugin to print into a page.
 *
 * The direct mount is what makes the content belong to the statchasers.com URL
 * rather than to an iframe - the same reason the news tool has /embed/ssr. The
 * fragment is always rendered in embedded mode: the host page supplies the H1
 * and the page chrome.
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
 * The index as a fragment, for the container page at /nfl/teams/.
 *
 * The 32 hubs each have a mount; the page that lists them did not, so it was
 * left as whatever WordPress content the plugin wrote into it once - a stub
 * list in the theme's styling, in front of 32 pages that look nothing like it.
 * This is that page's mount.
 *
 * Links point at the public site, not at this origin, exactly as the hub
 * fragment's switcher does: a reader clicking a team inside a WordPress page
 * belongs on statchasers.com, not on the bare tool.
 */
router.get("/embed/teams", (req, res) => {
  const prefix = (process.env["SC_TEAM_PATH_PREFIX"] ?? TEAM_PATH_PREFIX).trim();
  const html = renderTeamIndexFragment(TEAMS, {
    teamPathPrefix: prefix,
    linkQuery: fragmentLinkQuery(prefix),
  });

  // The list is the 32 teams and their crests - it changes when a team moves,
  // which is to say never in a season. Fingerprinted over the markup itself, so
  // a path-prefix change is a different fragment rather than the old one served
  // for the rest of the TTL. Same djb2 the SSR caches key on.
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

router.get("/embed/team/:slug", (req, res) => {
  void (async () => {
    const team = normalizeTeamName(String(req.params.slug ?? ""));
    if (!team) {
      res.status(404).type("text/plain").send("Unknown team");
      return;
    }

    // Switcher links point at the public site's team pages, not at this
    // origin - otherwise clicking a team inside a WordPress page would send
    // the reader to the bare tool.
    const prefix = (process.env["SC_TEAM_PATH_PREFIX"] ?? TEAM_PATH_PREFIX).trim();

    try {
      const result = await renderTeamFragment(team, {
        embed: true,
        teamPathPrefix: prefix,
        linkQuery: fragmentLinkQuery(prefix),
        section: section(req),
        // `?h1=1` - the host has emptied its own page title, so the panel's
        // heading becomes the page's <h1>. Same contract as routes/player.ts.
        ownHeading: String(req.query["h1"] ?? "").trim() === "1",
        matchupPathPrefix: (process.env["SC_MATCHUP_PATH_PREFIX"] ?? "/nfl/").trim(),
      });
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
      logger.error({ err, team: team.abbreviation }, "Failed to render team fragment");
      res.status(503).type("text/plain").send("Team fragment unavailable");
    }
  })();
});

export default router;
