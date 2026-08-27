/**
 * The NFL Team Hub routes.
 *
 *   GET /team                     — index of all 32 teams
 *   GET /team/:slug               — the team hub page
 *   GET /team/:slug?embed=1       — the same page, stripped for embedding
 *   GET /embed/team/:slug         — the bare fragment, for the WordPress mount
 *
 * A slug that is not canonical but still names a team — "/team/NE",
 * "/team/patriots", "/team/oakland" — is redirected to the canonical URL rather
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
import { renderTeamAppPage, renderTeamFragment } from "../lib/team-ssr";
import { renderTeamIndex } from "../lib/team-render";
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
 * more crawlable URLs — the duplicate URL space the canonical work exists to
 * prevent.
 */
function switcherQuery(req: Request): string {
  return isEmbed(req) ? "?embed=1" : "";
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
): Promise<void> {
  const embed = isEmbed(req);
  try {
    const result = await renderTeamAppPage(publicDir, team, {
      // Built from the path alone (lib/request.ts), so ?embed=1 can never mint
      // a second canonical for the same page.
      canonical: canonicalUrl(req),
      embed,
      linkQuery: switcherQuery(req),
    });

    // Development only: the same reload snippet the news page gets, so editing
    // team.css or team.html refreshes the Replit preview. Inert in production —
    // liveReload() is a no-op unless setupLiveReload() actually armed it.
    const dev = liveReload().enabled;

    // The version fingerprints every input to the RENDER — the data, not the
    // shell — so in development an edit to team.html would revalidate to a 304
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
    const canonicalTeam = getTeamBySlug(raw);

    if (canonicalTeam) {
      await sendTeamPage(req, res, canonicalTeam);
      return;
    }

    // Not the canonical slug, but it may still name a team: an abbreviation, a
    // nickname, or a retired code. 301 to the real URL so there is exactly one
    // address per team.
    const alias = normalizeTeamName(raw);
    if (alias) {
      res.redirect(301, `/team/${alias.slug}${switcherQuery(req)}`);
      return;
    }

    noStoreHtml(
      res,
      404,
      `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />` +
        `<meta name="robots" content="noindex" /><title>Team not found</title>` +
        `</head><body><h1>Team not found</h1>` +
        `<p><a href="/team">Browse all 32 NFL teams</a></p></body></html>`,
    );
  })();
});

/**
 * The bare fragment, for the WordPress plugin to print into a page.
 *
 * The direct mount is what makes the content belong to the statchasers.com URL
 * rather than to an iframe — the same reason the news tool has /embed/ssr. The
 * fragment is always rendered in embedded mode: the host page supplies the H1
 * and the page chrome.
 */
router.get("/embed/team/:slug", (req, res) => {
  void (async () => {
    const team = normalizeTeamName(String(req.params.slug ?? ""));
    if (!team) {
      res.status(404).type("text/plain").send("Unknown team");
      return;
    }

    try {
      const result = await renderTeamFragment(team, {
        embed: true,
        // Switcher links point at the public site's team pages, not at this
        // origin — otherwise clicking a team inside a WordPress page would send
        // the reader to the bare tool.
        teamPathPrefix: (process.env["SC_TEAM_PATH_PREFIX"] ?? "/team/").trim(),
        linkQuery: "?embed=1",
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
