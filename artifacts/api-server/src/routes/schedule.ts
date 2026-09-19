/**
 * The NFL schedule routes.
 *
 *   GET /schedule                  — the standalone page
 *   GET /schedule?view=team&team=ne
 *   GET /schedule?embed=1          — the same page, stripped for embedding
 *   GET /schedule/download.csv     — what is on screen, as CSV
 *   GET /schedule/schedule.ics     — the same games as a calendar file
 *   GET /embed/schedule            — the bare fragment, for the WordPress mount
 *
 * Mirrors routes/fpa.ts and routes/rankings.ts, including the posture that
 * matters: every route ships `noindex, indexifembedded`, so this origin does
 * not compete with statchasers.com — and by the same token the page is
 * invisible to search until `[statchasers_schedule]` embeds it.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../lib/logger";
import { devBarEnabled, injectDevBar } from "../lib/devbar";
import { liveReload } from "../lib/livereload";
import { canonicalUrl, publicOrigin } from "../lib/request";
import { normalizeTeamName, type NflTeam } from "../lib/team/teams";
import {
  renderScheduleAppPage,
  renderScheduleFragment,
} from "../lib/schedule-ssr";
import {
  renderScheduleCsv,
  renderScheduleIcs,
  type ScheduleRenderOptions,
} from "../lib/schedule-render";
import {
  getSchedule,
  parseGameFilter,
  parseScheduleView,
  parseWeek,
  scheduleSeason,
  type GameFilter,
  type ScheduleView,
} from "../lib/schedule/schedule-data";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "public");

const router: IRouter = Router();

const TRUTHY = new Set(["1", "true", "yes", "on"]);

function isEmbed(req: Request): boolean {
  return TRUTHY.has(String(req.query["embed"] ?? "").trim().toLowerCase());
}

const SCHEDULE_BASE_PATH = "/schedule";
const TEAM_PATH_PREFIX = "/team/";

function seasonFrom(req: Request): number {
  const asked = Number.parseInt(String(req.query["season"] ?? ""), 10);
  // A season is honoured only when it is plausibly one; anything else falls
  // through to the configured current season rather than querying for it.
  return Number.isFinite(asked) && asked >= 1999 && asked <= 2100
    ? asked
    : scheduleSeason();
}

interface ScheduleQueryState {
  view: ScheduleView;
  week: number | null;
  team: NflTeam | null;
  filter: GameFilter;
}

function state(req: Request): ScheduleQueryState {
  return {
    view: parseScheduleView(String(req.query["view"] ?? "")),
    week: parseWeek(String(req.query["week"] ?? "")),
    // Anything that plausibly names a team resolves — "ne", "NE", "patriots",
    // "new-england-patriots" — through the one canonical table.
    team: normalizeTeamName(String(req.query["team"] ?? "")),
    filter: parseGameFilter(String(req.query["filter"] ?? "")),
  };
}

/**
 * Only `embed`, and only as the canonical `?embed=1`.
 *
 * Echoing the whole query into every outgoing link would let any parameter
 * anyone appends mint another crawlable URL — the duplicate URL space the
 * canonical work exists to prevent. View, week, team and filter are page state
 * and are composed deliberately by the renderer, not copied wholesale.
 */
function linkQuery(req: Request): string {
  return isEmbed(req) ? "?embed=1" : "";
}

/**
 * Same reasoning as the other fragments: `?embed=1` only means anything against
 * this origin, and once SC_TEAM_PATH_PREFIX points links at statchasers.com the
 * query is harmful, because `embed` is a reserved WordPress query var.
 */
function fragmentLinkQuery(prefix: string): string {
  const override = process.env["SC_SCHEDULE_LINK_QUERY"];
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

router.get("/schedule", (req, res) => {
  void (async () => {
    const embed = isEmbed(req);
    const query = state(req);

    try {
      const options: ScheduleRenderOptions & { canonical: string } = {
        // Built from the path alone (lib/request.ts), so no combination of
        // view, week, team or filter can mint a second canonical.
        canonical: canonicalUrl(req),
        embed,
        basePath: SCHEDULE_BASE_PATH,
        linkQuery: linkQuery(req),
        view: query.view,
        filter: query.filter,
        ...(query.week === null ? {} : { week: query.week }),
        ...(query.team === null ? {} : { team: query.team }),
      };

      const result = await renderScheduleAppPage(
        publicDir,
        seasonFrom(req),
        options,
      );

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
        // Short, because a live score is the one thing on this page that can
        // change minute to minute. The ETag catches a change immediately either
        // way; this only bounds how long a shared cache may skip asking.
        .set(
          "Cache-Control",
          dev
            ? "no-store"
            : result.data?.liveNow
              ? "public, max-age=30"
              : "public, max-age=300",
        )
        .set("X-Robots-Tag", "noindex, indexifembedded")
        .type("html")
        .send(html);
    } catch (err) {
      logger.error({ err }, "Failed to render the schedule page");
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
  })();
});

/**
 * The games on screen, as a file.
 *
 * Both exports are built from the same `getSchedule` the page renders, so the
 * file and the screen can never disagree — the standalone app generated its CSV
 * from a second formatter in the browser, which is how they drift. A team
 * export is that team's season, a week export is that week; asking for neither
 * gets the whole slate.
 */
function exportQuery(req: Request) {
  const query = state(req);
  return {
    ...(query.week === null ? {} : { week: query.week }),
    ...(query.team === null ? {} : { team: query.team }),
    filter: query.filter,
  };
}

router.get("/schedule/download.csv", (req, res) => {
  void (async () => {
    try {
      const season = seasonFrom(req);
      const data = await getSchedule(season);
      if (!data) {
        res
          .status(503)
          .type("text/plain")
          .send("The schedule feed is unavailable");
        return;
      }
      const query = exportQuery(req);
      const scope = query.team
        ? query.team.abbreviation
        : query.week
          ? `week-${query.week}`
          : "season";

      res
        .set(
          "Content-Disposition",
          `attachment; filename="nfl-schedule-${season}-${scope}.csv"`,
        )
        .set("Cache-Control", "public, max-age=300")
        .set("X-Robots-Tag", "noindex")
        .type("text/csv")
        .send(renderScheduleCsv(data, query));
    } catch (err) {
      logger.error({ err }, "Failed to build the schedule CSV");
      res.status(503).type("text/plain").send("CSV unavailable");
    }
  })();
});

router.get("/schedule/schedule.ics", (req, res) => {
  void (async () => {
    try {
      const season = seasonFrom(req);
      const data = await getSchedule(season);
      if (!data) {
        res
          .status(503)
          .type("text/plain")
          .send("The schedule feed is unavailable");
        return;
      }
      const query = exportQuery(req);
      const scope = query.team ? query.team.abbreviation : "season";

      res
        .set(
          "Content-Disposition",
          `attachment; filename="nfl-schedule-${season}-${scope}.ics"`,
        )
        .set("Cache-Control", "public, max-age=300")
        .set("X-Robots-Tag", "noindex")
        .type("text/calendar")
        .send(renderScheduleIcs(data, query));
    } catch (err) {
      logger.error({ err }, "Failed to build the schedule calendar");
      res.status(503).type("text/plain").send("Calendar unavailable");
    }
  })();
});

/**
 * The bare fragment, for the WordPress plugin to print into a page.
 *
 * Always rendered in embedded mode: the host page supplies the H1 and the page
 * chrome. An unavailable feed answers 503 rather than an empty shell, so the
 * shortcode leaves the host page intact — and so the plugin can tell "down
 * right now" from "nothing to show", which it caches very differently.
 *
 * The export links are the one thing that cannot point at `basePath` here.
 * `SC_SCHEDULE_PATH` is the WordPress page's own path, and WordPress has never
 * heard of `/download.csv` under it, so the exports are given this origin
 * explicitly.
 */
router.get("/embed/schedule", (req, res) => {
  void (async () => {
    const teamPrefix = (
      process.env["SC_TEAM_PATH_PREFIX"] ?? TEAM_PATH_PREFIX
    ).trim();
    const basePath = (
      process.env["SC_SCHEDULE_PATH"] ?? SCHEDULE_BASE_PATH
    ).trim();
    const downloadBase = `${publicOrigin(req)}${SCHEDULE_BASE_PATH}`;
    const query = state(req);

    try {
      const result = await renderScheduleFragment(seasonFrom(req), {
        embed: true,
        basePath,
        teamPathPrefix: teamPrefix,
        downloadBase,
        linkQuery: fragmentLinkQuery(teamPrefix),
        view: query.view,
        filter: query.filter,
        ...(query.week === null ? {} : { week: query.week }),
        ...(query.team === null ? {} : { team: query.team }),
      });

      if (!result.data) {
        res
          .status(503)
          .set("Cache-Control", "no-store")
          .type("text/plain")
          .send("The schedule feed is unavailable");
        return;
      }

      res.set("ETag", `W/"${result.version}"`);
      if (req.fresh) {
        res.status(304).end();
        return;
      }

      res
        .set(
          "Cache-Control",
          result.data.liveNow ? "public, max-age=30" : "public, max-age=300",
        )
        .set("X-Robots-Tag", "noindex, indexifembedded")
        .type("html")
        .send(result.html);
    } catch (err) {
      logger.error({ err }, "Failed to render the schedule fragment");
      res.status(503).type("text/plain").send("Schedule fragment unavailable");
    }
  })();
});

export default router;
