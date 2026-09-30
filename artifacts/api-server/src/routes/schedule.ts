/**
 * The NFL schedule routes.
 *
 *   GET /schedule                  — the standalone page: the season matrix
 *   GET /schedule/week-2           — one week of the board, its own address
 *   GET /schedule?embed=1          — the same page, stripped for embedding
 *   GET /schedule/download.csv     — what is on screen, as CSV
 *   GET /schedule/schedule.ics     — the same games as a calendar file
 *   GET /embed/schedule            — the bare fragment, for the WordPress mount
 *
 * The path says which view this is, and it is the only thing that does. The
 * bare path is the season matrix — the whole season, the same board in December
 * as in July, and the view that answers "when do they play" without first
 * asking which week. A week is a different slate of games, so it gets an
 * address: `/schedule/week-7`.
 *
 * That leaves `?view=` and `?week=` as old links to redirect and nothing else.
 * Neither renders anything, which is what stops a rendering from having two
 * spellings. `?view=team` is a third: the team lens moved to the team hub's
 * Schedule tab, and a link to it is redirected there rather than being dropped
 * on the board.
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
  resolveState,
  type ScheduleRenderOptions,
} from "../lib/schedule-render";
import {
  getSchedule,
  parseGameFilter,
  parseScheduleView,
  parseWeek,
  scheduleSeason,
  SCHEDULE_VIEWS,
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
/** Where matchup pages live. The same env var the team hub and /nfl/ read. */
const MATCHUP_PATH_PREFIX = "/nfl/";

function seasonFrom(req: Request): number {
  const asked = Number.parseInt(String(req.query["season"] ?? ""), 10);
  const current = scheduleSeason();
  // A season is honoured only when it can have a schedule: nflverse starts in
  // 1999 and has nothing past the one being played. Anything else falls
  // through to the current season rather than querying for it — a future
  // season has no rows, and each one asked for re-downloaded the whole
  // games.csv once a minute to find that out again.
  return Number.isFinite(asked) && asked >= 1999 && asked <= current
    ? asked
    : current;
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

/**
 * The query the destination of a redirect understands, and nothing else.
 *
 * Echoing `req.query` wholesale into a redirect would let anything anyone
 * appends survive into another address — the duplicate URL space the canonical
 * work exists to prevent. `view` is never carried, because the path being
 * redirected TO already says which view it is; `filter` is carried only to the
 * weekly board, because the matrix ignores it and `/schedule?filter=division`
 * would be a second address for the grid. `?filter=all` is dropped for the
 * same reason — it is the bare path with extra words. `team` is not carried at
 * all: the page has no team state since the lens moved, and the exports read it
 * from the request themselves.
 */
function carriedQuery(req: Request, view: ScheduleView): URLSearchParams {
  const params = new URLSearchParams();
  const keys =
    view === "week" ? ["filter", "season", "embed"] : ["season", "embed"];
  for (const key of keys) {
    const raw = req.query[key];
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (value === "") continue;
    params.set(key, value);
  }
  if (parseGameFilter(params.get("filter") ?? "") === "all") {
    params.delete("filter");
  }
  return params;
}

/** The matrix's address: the bare path, with nothing the grid does not read. */
function matrixUrl(req: Request): string {
  return withQuery(SCHEDULE_BASE_PATH, carriedQuery(req, "matrix"));
}

/** One week's address. */
function weekUrl(req: Request, week: number): string {
  return withQuery(
    `${SCHEDULE_BASE_PATH}/week-${week}`,
    carriedQuery(req, "week"),
  );
}

/**
 * The view a request names outright, or null when it names none.
 *
 * Read from the raw query rather than from `parseScheduleView`, because by the
 * time that has run an absent `?view=` and an explicit `?view=matrix` look
 * identical — and they are not: one is the address, the other is a spelling of
 * it to redirect away.
 */
function askedView(req: Request): ScheduleView | null {
  const raw = String(req.query["view"] ?? "").trim().toLowerCase();
  if (raw === "") return null;
  return (SCHEDULE_VIEWS as readonly string[]).includes(raw)
    ? (raw as ScheduleView)
    : null;
}

function withQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/**
 * The canonical for this rendering: its own path, and nothing else.
 *
 * Every rendering now has exactly one address — the matrix at `/schedule`, a
 * week at `/schedule/week-3` — so there is nothing left to point anywhere but
 * at itself. The query string is discarded exactly as it was before: no view,
 * team, filter or season can mint a second one.
 *
 * This used to send `/schedule` forward to the current week, because the bare
 * path WAS the weekly board and the week it happened to be showing deserved
 * the address. It is the matrix now, which is a page in its own right and the
 * same page all season.
 */
function scheduleCanonical(req: Request): string {
  return canonicalUrl(req);
}

/**
 * The standalone page.
 *
 * `week` comes from the path or not at all — see the two routes above — and it
 * is also what says which view this is: a week is the weekly board, no week is
 * the season matrix. Reading the view from the path rather than from `?view=`
 * is what keeps the two views from each having two addresses.
 */
function sendSchedulePage(
  req: Request,
  res: Response,
  week: number | null,
): void {
  void (async () => {
    const embed = isEmbed(req);
    const query = state(req);
    const season = seasonFrom(req);

    try {
      const options: ScheduleRenderOptions = {
        embed,
        basePath: SCHEDULE_BASE_PATH,
        linkQuery: linkQuery(req),
        view: week === null ? "matrix" : "week",
        filter: query.filter,
        ...(week === null ? {} : { week }),
      };

      const result = await renderScheduleAppPage(publicDir, season, {
        ...options,
        canonical: scheduleCanonical(req),
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
}

/**
 * Where a team lens link goes now.
 *
 * `?view=team&team=ne` was this tool's third view until the team hub's Schedule
 * tab took it over — the same table and the same four cards, on the page that
 * is already about that team. The view is gone, so `parseScheduleView` reads
 * "team" as the week board, and without this every one of those links would
 * quietly land on Week 3 instead of on the season it asked for.
 *
 * The raw query is read rather than the parsed view for exactly that reason:
 * by the time the state is parsed, "team" no longer exists to test for.
 *
 * A team that does not resolve — "?view=team" alone, or a name this table does
 * not know — has no page to be sent to, so it falls back to the bare path: the
 * season grid, which is the one view that can stand in for a lens on any team.
 */
function movedLens(req: Request): string | null {
  if (String(req.query["view"] ?? "").trim().toLowerCase() !== "team") {
    return null;
  }
  const team = normalizeTeamName(String(req.query["team"] ?? ""));
  if (!team) return matrixUrl(req);
  return `${TEAM_PATH_PREFIX}${team.slug}/schedule/`;
}

router.get("/schedule", (req, res) => {
  const moved = movedLens(req);
  if (moved !== null) {
    res.redirect(301, moved);
    return;
  }

  // `?view=` and `?week=` are both leftovers now that the path carries the
  // view: neither renders anything, which is what stops a rendering from
  // having two spellings.
  //
  // The view is settled first, because `?view=matrix&week=5` is a request for
  // the grid with a week attached and the grid has no week — the parameter
  // goes with the view it belongs to rather than deciding the address.
  const view = askedView(req);
  if (view === "matrix") {
    res.redirect(301, matrixUrl(req));
    return;
  }

  // `?week=` was this board's address before the weeks had paths, and it is
  // still what an old link, a bookmark or a pasted URL carries. One permanent
  // redirect settles each of them.
  const asked = parseWeek(String(req.query["week"] ?? ""));
  if (asked !== null) {
    res.redirect(301, weekUrl(req, asked));
    return;
  }

  // `?view=week` with no week named means the week the season is on, which is
  // an address — resolve it and send the reader there, rather than rendering
  // the board at a URL that does not say which week it is showing.
  if (view === "week") {
    void (async () => {
      const data = await getSchedule(seasonFrom(req));
      // No feed, no current week to resolve: Week 1 is the only honest guess,
      // and it is a real address either way.
      const week = data ? resolveState(data, { view: "week" }).week : 1;
      res.redirect(302, weekUrl(req, week));
    })();
    return;
  }

  sendSchedulePage(req, res, null);
});

/**
 * One week of the board, at its own address.
 *
 * The "week-" prefix cannot collide with `/schedule/download.csv` or
 * `/schedule/schedule.ics`, so the three routes are order-independent.
 */
router.get("/schedule/week-:week", (req, res, next) => {
  const raw = String(req.params["week"] ?? "");
  const week = parseWeek(raw);

  // Strict, and deliberately unforgiving: "week-02" and "week-19" are not this
  // address rather than being redirected to one, the same call matchup/pair.ts
  // makes about a game segment. A path is an assertion about what exists; the
  // alternative is eighteen weeks with an unbounded number of spellings each.
  if (week === null || String(week) !== raw) {
    next();
    return;
  }

  // A team lens link that also named a week goes where every other one goes.
  const moved = movedLens(req);
  if (moved !== null) {
    res.redirect(301, moved);
    return;
  }

  // The matrix has nothing to do with a week. Rather than render it at an
  // address naming a week it ignores, send it to the view's own URL and drop
  // the week on the way. An explicit `?view=week` here is merely saying what
  // the path already says, so it is dropped the same way.
  const view = askedView(req);
  if (view === "matrix") {
    res.redirect(301, matrixUrl(req));
    return;
  }
  if (view === "week") {
    res.redirect(301, weekUrl(req, week));
    return;
  }

  sendSchedulePage(req, res, week);
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
      // Named after the season served, not the one asked for: March to May
      // the current season falls back to the last one, and a "2026" file
      // holding 2025's games is worse than no file.
      const scope = query.team
        ? query.team.abbreviation
        : query.week
          ? `week-${query.week}`
          : "season";

      res
        .set(
          "Content-Disposition",
          `attachment; filename="nfl-schedule-${data.season}-${scope}.csv"`,
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
          `attachment; filename="nfl-schedule-${data.season}-${scope}.ics"`,
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
    const matchupPrefix = (
      process.env["SC_MATCHUP_PATH_PREFIX"] ?? MATCHUP_PATH_PREFIX
    ).trim();
    const basePath = (
      process.env["SC_SCHEDULE_PATH"] ?? SCHEDULE_BASE_PATH
    ).trim();
    const downloadBase = `${publicOrigin(req)}${SCHEDULE_BASE_PATH}`;
    const query = state(req);

    try {
      // The fragment has no path to read the view off, so the shortcode names
      // it — and a caller that named a week and no view has named the weekly
      // board, because a week is not something the grid can show. The plugin
      // always sends both; this is what keeps a hand-built `?week=5` honest.
      const view: ScheduleView =
        askedView(req) ?? (query.week === null ? "matrix" : "week");

      const result = await renderScheduleFragment(seasonFrom(req), {
        embed: true,
        basePath,
        teamPathPrefix: teamPrefix,
        matchupPathPrefix: matchupPrefix,
        downloadBase,
        linkQuery: fragmentLinkQuery(teamPrefix),
        // `?h1=1` — the host has emptied its own page title, so this
        // fragment's heading becomes the page's <h1>. Same contract as
        // routes/team.ts and routes/player.ts.
        ownHeading: String(req.query["h1"] ?? "").trim() === "1",
        view,
        filter: query.filter,
        ...(query.week === null ? {} : { week: query.week }),
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
