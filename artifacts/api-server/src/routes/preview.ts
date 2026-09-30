/**
 * Shortcode preview harness. Development only.
 *
 * The six tools are shipped as FRAGMENTS: /embed/ssr.html,
 * /embed/team/:slug, /embed/player/:slug, /embed/fpa, /embed/rankings and
 * /embed/schedule return bare markup
 * with no stylesheet and no script, because on a real page WordPress enqueues those
 * separately. Opening any of them in a browser shows a wall of unstyled HTML — which makes the one
 * question you actually want to answer while working ("what does this shortcode
 * look like on a page?") the one question the app could not answer.
 *
 * These routes answer it. They assemble exactly what WordPress assembles:
 *
 *   [statchasers_news]    ->  /preview/news
 *   [statchasers_team]    ->  /preview/team/:slug
 *   [statchasers_player]  ->  /preview/player/:slug
 *   [statchasers_fpa]     ->  /preview/fpa
 *   [statchasers_rankings] -> /preview/rankings
 *   [statchasers_schedule] -> /preview/schedule
 *   [statchasers_player_stats] -> /preview/player-stats[/rb|wr|te]
 *   [statchasers_rb_handcuffs] -> /preview/rb-handcuffs
 *   [statchasers_strength_of_schedule] -> /preview/sos
 *
 * The fragment is the SAME markup the plugin fetches — it comes from the same
 * renderer the /embed endpoints use, not a second code path — wrapped in a mock
 * host page carrying the stylesheet and bundle the plugin registers
 * (statchasers-news.php: wp_register_style '/styles.css',
 * wp_register_script '/dist/statchasers-news.js'). What differs from the live
 * site is only the host page's own chrome, which is why it is drawn as an
 * obvious mock rather than as an imitation of statchasers.com.
 *
 * Guarded by the same NODE_ENV check as the dev bar: in production these are
 * 404, so this file can never put a second, differently-assembled copy of
 * either tool on the public internet.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import { devBarEnabled, injectDevBar } from "../lib/devbar";
import { liveReload } from "../lib/livereload";
import { escapeHtml } from "../lib/render";
import { linkTemplatesFromEnv, relatedLinksFromEnv } from "../lib/links";
import { publicOrigin } from "../lib/request";
import { renderNewsFragment } from "../lib/ssr";
import { renderTeamFragment } from "../lib/team-ssr";
import { renderPlayerFragment } from "../lib/player-ssr";
import { renderFpaFragment } from "../lib/fpa-ssr";
import { renderRankingsFragment } from "../lib/rankings-ssr";
import { POSITIONS } from "../lib/rankings/rankings-data";
import { renderScheduleFragment } from "../lib/schedule-ssr";
import { renderStatsFragment } from "../lib/player-stats-ssr";
import { renderHandcuffFragment } from "../lib/rb-handcuffs-ssr";
import { renderSosFragment } from "../lib/sos-ssr";
import { parseSosState } from "../lib/sos/sos-data";
import { parseFpaFormat, parseFpaView } from "../lib/fpa/fpa-data";
import {
  parseGameFilter,
  parseScheduleView,
  parseWeek,
  scheduleSeason,
} from "../lib/schedule/schedule-data";
import { normalizeTeamName } from "../lib/team/teams";
import {
  defaultSeason as statsDefaultSeason,
  parsePosition as parseStatsPosition,
  parseSeason as parseStatsSeason,
} from "../lib/player-stats/stats-data";

const router: IRouter = Router();

/**
 * Everything in this file is a development affordance.
 *
 * Scoped to the path, NOT bare. A bare `router.use(guard)` runs for every
 * request that passes through the router, and this router is mounted with
 * `app.use(previewRouter)` — so outside development it 404d the entire app,
 * including "/". The test suite runs with NODE_ENV=test and caught it.
 */
router.use("/preview", (_req, res, next) => {
  if (!devBarEnabled()) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }
  next();
});

interface HostPageOptions {
  /** The <title> and the host page's own H1. */
  title: string;
  /** The shortcode this page is standing in for. */
  shortcode: string;
  /** Stylesheets the WordPress plugin would enqueue for this shortcode. */
  styles: string[];
  /** Scripts the WordPress plugin would enqueue for this shortcode. */
  scripts: string[];
  /** The fragment, exactly as the plugin would receive it. */
  fragment: string;
}

/**
 * A deliberately plain stand-in for a statchasers.com page.
 *
 * Its job is to supply the three things a host page supplies and the fragment
 * assumes: an H1 (which is why embed mode demotes the tool's own heading to an
 * h2), a bounded content column, and a page background the fragment sits on. It
 * is drawn as an obvious mock — banner at the top, no attempt at the real
 * theme — because a convincing imitation would invite conclusions about
 * spacing and type that only the real theme can settle.
 */
function hostPage(options: HostPageOptions): string {
  const styles = options.styles
    .map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}" />`)
    .join("");
  const scripts = options.scripts
    .map((src) => `<script src="${escapeHtml(src)}" defer></script>`)
    .join("");

  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0" />` +
    `<meta name="robots" content="noindex" />` +
    `<title>${escapeHtml(options.title)} — shortcode preview</title>` +
    `<link rel="preconnect" href="https://fonts.googleapis.com" />` +
    `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />` +
    `<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />` +
    styles +
    `<style>` +
    `.hostpage{margin:0;background:#f4f6fa;color:#0b1220;` +
    `font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}` +
    `.hp-note{background:#0b1220;color:#e2e8f0;padding:9px 16px;` +
    `font:600 12px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;` +
    `border-bottom:1px solid #24324d}` +
    `.hp-note b{color:#e8c766}` +
    `.hp-head{max-width:1180px;margin:0 auto;padding:34px 24px 0}` +
    `.hp-crumb{margin:0 0 10px;color:#64748b;font-size:.8rem;font-weight:600}` +
    `.hp-h1{margin:0;font-size:clamp(1.9rem,1.3rem+2.2vw,2.9rem);line-height:1.1;` +
    `font-weight:900;letter-spacing:-.03em;color:#0b1634}` +
    `.hp-lede{margin:12px 0 0;max-width:70ch;color:#475569;font-size:1.02rem}` +
    `.hp-main{max-width:1180px;margin:0 auto;padding:28px 24px 60px}` +
    // The fragment sits on the page's own surface, exactly as it does live.
    `.hp-slot{background:#fff;border-radius:14px;padding:26px 26px 30px;` +
    `box-shadow:0 8px 30px rgba(15,23,42,.06)}` +
    `.hp-foot{max-width:1180px;margin:0 auto;padding:0 24px 60px;` +
    `color:#94a3b8;font-size:.8rem}` +
    `@media (max-width:720px){.hp-head{padding:22px 16px 0}` +
    `.hp-main{padding:18px 16px 40px}.hp-slot{padding:16px 14px 20px;border-radius:12px}` +
    `.hp-foot{padding:0 16px 40px}}` +
    `</style></head>` +
    `<body class="hostpage">` +
    `<p class="hp-note">Mock host page &mdash; this is <b>${escapeHtml(options.shortcode)}</b> ` +
    `rendered with the stylesheet and bundle the WordPress plugin enqueues. ` +
    `The chrome around it is a stand-in, not the real theme.</p>` +
    `<header class="hp-head">` +
    `<p class="hp-crumb">StatChasers &rsaquo; Fantasy Football</p>` +
    `<h1 class="hp-h1">${escapeHtml(options.title)}</h1>` +
    `<p class="hp-lede">The host page owns this heading and the column width. ` +
    `Everything below the line is the shortcode's own output.</p>` +
    `</header>` +
    `<main class="hp-main"><div class="hp-slot">${options.fragment}</div></main>` +
    `<p class="hp-foot">&copy; StatChasers &mdash; mock footer.</p>` +
    scripts +
    `</body></html>`
  );
}

function send(req: Request, res: Response, html: string): void {
  let out = liveReload().enabled ? liveReload().injectIntoHtml(html) : html;
  out = injectDevBar(out, { path: req.path, embed: true });
  res
    .set("Cache-Control", "no-store")
    .set("X-Robots-Tag", "noindex")
    .type("html")
    .send(out);
}

/**
 * The literal fragment, shown as source.
 *
 * The bytes are the same ones /embed/ssr.html and /embed/team/:slug return, and
 * those endpoints stay bare — the plugin fetches markup, not a document, and
 * anything injected into them would be printed into a statchasers.com page.
 * That is also why the dev bar is never injected there, which used to mean the
 * Raw view had to open in a new tab or you would be stranded in a fragment with
 * no way back.
 *
 * Showing the response as escaped source instead solves both: the bytes are
 * exactly what the endpoint serves, and the page around them is an ordinary
 * page that carries the bar, so you never leave the pane.
 */
function sourcePage(title: string, endpoint: string, fragment: string): string {
  const bytes = Buffer.byteLength(fragment, "utf8");
  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0" />` +
    `<meta name="robots" content="noindex" />` +
    `<title>${escapeHtml(title)} — raw fragment</title>` +
    `<style>` +
    `body{margin:0;background:#0b1220;color:#cbd5e1;` +
    `font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}` +
    `.rw-head{padding:22px 20px 16px;border-bottom:1px solid #24324d}` +
    `.rw-h1{margin:0 0 8px;color:#fff;font-size:1.05rem;font-weight:800}` +
    `.rw-meta{margin:0;color:#64748b}` +
    `.rw-meta b{color:#e8c766;font-weight:700}` +
    `.rw-src{margin:0;padding:18px 20px 60px;white-space:pre-wrap;` +
    `word-break:break-word;color:#9fb3d1;font-size:12px;line-height:1.7}` +
    `</style></head><body>` +
    `<div class="rw-head">` +
    `<p class="rw-h1">${escapeHtml(title)}</p>` +
    `<p class="rw-meta">The exact response body of <b>${escapeHtml(endpoint)}</b>` +
    ` &mdash; ${bytes.toLocaleString("en-US")} bytes, no stylesheet, no script.` +
    ` This is what the WordPress plugin fetches and prints.</p>` +
    `</div>` +
    `<pre class="rw-src">${escapeHtml(fragment)}</pre>` +
    `</body></html>`
  );
}

/** [statchasers_news] as it renders on a page. */
router.get("/preview/news", (req, res) => {
  void (async () => {
    try {
      const origin = publicOrigin(req);
      const fragment = await renderNewsFragment({
        limit: 250,
        pageSize: 4,
        // The plugin's own default. A host page that supplies its own section
        // heading passes heading="0"; this shows the shortcode as installed.
        heading: true,
        origin,
        links: linkTemplatesFromEnv(),
        relatedLinks: relatedLinksFromEnv(),
      });
      send(
        req,
        res,
        hostPage({
          title: "Fantasy Football Player News",
          shortcode: "[statchasers_news]",
          styles: ["/styles.css"],
          scripts: ["/dist/statchasers-news.js"],
          fragment,
        }),
      );
    } catch (err) {
      logger.error({ err }, "News shortcode preview failed");
      res.status(500).type("html").send("<h1>Preview failed</h1>");
    }
  })();
});

/** [statchasers_team team="…"] as it renders on a page. */
router.get("/preview/team/:slug", (req, res) => {
  void (async () => {
    const team = normalizeTeamName(String(req.params.slug ?? ""));
    if (!team) {
      res.status(404).type("text/plain").send("Unknown team");
      return;
    }
    try {
      const result = await renderTeamFragment(team, {
        embed: true,
        // Point the switcher at this harness rather than at the bare tool, so
        // picking a team from inside the preview keeps you inside the preview.
        teamPathPrefix: "/preview/team/",
      });
      send(
        req,
        res,
        hostPage({
          title: `${team.fullName} Fantasy Hub`,
          shortcode: `[statchasers_team team="${team.abbreviation}"]`,
          styles: ["/team.css"],
          scripts: ["/dist/statchasers-team.js"],
          fragment: result.html,
        }),
      );
    } catch (err) {
      logger.error({ err, team: team.abbreviation }, "Team shortcode preview failed");
      res.status(500).type("html").send("<h1>Preview failed</h1>");
    }
  })();
});

/** [statchasers_player slug="…"] as it renders on a page. */
router.get("/preview/player/:slug", (req, res) => {
  void (async () => {
    const slug = String(req.params.slug ?? "").trim().toLowerCase();
    try {
      const result = await renderPlayerFragment(slug, {
        embed: true,
        // Point links at this harness rather than at the bare tool, so moving
        // between players from inside the preview keeps you inside the preview.
        playerPathPrefix: "/preview/player/",
        teamPathPrefix: "/preview/team/",
        fpaPath: "/preview/fpa",
      });
      if (!result) {
        res.status(404).type("text/plain").send("Unknown player");
        return;
      }
      send(
        req,
        res,
        hostPage({
          title: `${result.name} Fantasy Football Stats`,
          shortcode: `[statchasers_player slug="${slug}"]`,
          styles: ["/player.css"],
          scripts: ["/dist/statchasers-player.js"],
          fragment: result.html,
        }),
      );
    } catch (err) {
      logger.error({ err, slug }, "Player shortcode preview failed");
      res.status(500).type("html").send("<h1>Preview failed</h1>");
    }
  })();
});

/** [statchasers_fpa] as it renders on a page. */
router.get("/preview/fpa", (req, res) => {
  void (async () => {
    const format = parseFpaFormat(String(req.query["format"] ?? ""));
    const view = parseFpaView(String(req.query["view"] ?? ""));
    try {
      const result = await renderFpaFragment(
        { format, view },
        {
          embed: true,
          // Point the table's own controls back into the harness, so switching
          // format from inside the preview keeps you inside the preview.
          basePath: "/preview/fpa",
          teamPathPrefix: "/preview/team/",
        },
      );
      send(
        req,
        res,
        hostPage({
          title: "Fantasy Points Allowed",
          shortcode: `[statchasers_fpa format="${format}" view="${view}"]`,
          styles: ["/fpa.css"],
          scripts: ["/dist/statchasers-fpa.js"],
          fragment: result.html,
        }),
      );
    } catch (err) {
      logger.error({ err }, "FPA shortcode preview failed");
      res.status(500).type("html").send("<h1>Preview failed</h1>");
    }
  })();
});

/**
 * [statchasers_rankings] as it renders on a page, and on each position's
 * address beneath it — the tabs link `/preview/rankings/rb`, as they link
 * `/fantasy-football/rest-of-season-rankings/rb/` on the real page.
 */
const RANKINGS_PREVIEW_PATHS = ["/preview/rankings", "/preview/rankings/:pos"];

router.get(RANKINGS_PREVIEW_PATHS, (req, res, next) => {
  const segment = String(req.params["pos"] ?? "");
  const position = POSITIONS.find(
    (p) => p !== "All" && p.toLowerCase() === segment,
  );
  if (segment !== "" && !position) {
    next();
    return;
  }
  try {
    const result = renderRankingsFragment(undefined, {
      embed: true,
      // Point the board's own links back into the harness, so following a
      // player or a tab from inside the preview keeps you inside the preview.
      basePath: "/preview/rankings",
      playerPathPrefix: "/preview/player/",
      position: position ?? "All",
    });
    send(
      req,
      res,
      hostPage({
        title: "Rest of Season Rankings",
        shortcode: "[statchasers_rankings]",
        styles: ["/rankings.css"],
        scripts: ["/dist/statchasers-rankings.js"],
        fragment: result.html,
      }),
    );
  } catch (err) {
    logger.error({ err }, "Rankings shortcode preview failed");
    res.status(500).type("html").send("<h1>Preview failed</h1>");
  }
});

/**
 * [statchasers_schedule] as it renders on a page.
 *
 * The board carries four pieces of state in its query string, so the harness
 * reads the same four the real route reads — a preview that could only ever
 * show Week 1 of the weekly view would not answer the question it exists for.
 */
router.get("/preview/schedule", (req, res) => {
  void (async () => {
    const view = parseScheduleView(String(req.query["view"] ?? ""));
    const week = parseWeek(String(req.query["week"] ?? ""));
    const team = normalizeTeamName(String(req.query["team"] ?? ""));
    const filter = parseGameFilter(String(req.query["filter"] ?? ""));
    try {
      const result = await renderScheduleFragment(scheduleSeason(), {
        embed: true,
        // Point the board's own controls back into the harness, so changing
        // week or team from inside the preview keeps you inside the preview.
        basePath: "/preview/schedule",
        teamPathPrefix: "/preview/team/",
        view,
        filter,
        ...(week === null ? {} : { week }),
        ...(team === null ? {} : { team }),
      });
      send(
        req,
        res,
        hostPage({
          title: "NFL Schedule",
          shortcode:
            `[statchasers_schedule view="${view}"` +
            (team ? ` team="${team.abbreviation}"` : "") +
            `]`,
          styles: ["/schedule.css"],
          scripts: ["/dist/statchasers-schedule.js"],
          fragment: result.html,
        }),
      );
    } catch (err) {
      logger.error({ err }, "Schedule shortcode preview failed");
      res.status(500).type("html").send("<h1>Preview failed</h1>");
    }
  })();
});

/** The news fragment as source. */
router.get("/preview/raw/news", (req, res) => {
  void (async () => {
    try {
      const fragment = await renderNewsFragment({
        limit: 250,
        pageSize: 4,
        heading: true,
        origin: publicOrigin(req),
        links: linkTemplatesFromEnv(),
        relatedLinks: relatedLinksFromEnv(),
      });
      send(req, res, sourcePage("[statchasers_news]", "/embed/ssr.html", fragment));
    } catch (err) {
      logger.error({ err }, "News fragment source view failed");
      res.status(500).type("html").send("<h1>Preview failed</h1>");
    }
  })();
});

/** The team fragment as source. */
router.get("/preview/raw/team/:slug", (req, res) => {
  void (async () => {
    const team = normalizeTeamName(String(req.params.slug ?? ""));
    if (!team) {
      res.status(404).type("text/plain").send("Unknown team");
      return;
    }
    try {
      const result = await renderTeamFragment(team, { embed: true });
      send(
        req,
        res,
        sourcePage(
          `[statchasers_team team="${team.abbreviation}"]`,
          `/embed/team/${team.slug}`,
          result.html,
        ),
      );
    } catch (err) {
      logger.error({ err, team: team.abbreviation }, "Team fragment source view failed");
      res.status(500).type("html").send("<h1>Preview failed</h1>");
    }
  })();
});

/** The player fragment as source. */
router.get("/preview/raw/player/:slug", (req, res) => {
  void (async () => {
    const slug = String(req.params.slug ?? "").trim().toLowerCase();
    try {
      const result = await renderPlayerFragment(slug, { embed: true });
      if (!result) {
        res.status(404).type("text/plain").send("Unknown player");
        return;
      }
      send(
        req,
        res,
        sourcePage(
          `[statchasers_player slug="${slug}"]`,
          `/embed/player/${slug}`,
          result.html,
        ),
      );
    } catch (err) {
      logger.error({ err, slug }, "Player fragment source view failed");
      res.status(500).type("html").send("<h1>Preview failed</h1>");
    }
  })();
});

/** The FPA fragment as source. */
router.get("/preview/raw/fpa", (req, res) => {
  void (async () => {
    const format = parseFpaFormat(String(req.query["format"] ?? ""));
    const view = parseFpaView(String(req.query["view"] ?? ""));
    try {
      const result = await renderFpaFragment({ format, view }, { embed: true });
      send(
        req,
        res,
        sourcePage(
          `[statchasers_fpa format="${format}" view="${view}"]`,
          "/embed/fpa",
          result.html,
        ),
      );
    } catch (err) {
      logger.error({ err }, "FPA fragment source view failed");
      res.status(500).type("html").send("<h1>Preview failed</h1>");
    }
  })();
});

/**
 * [statchasers_player_stats] as it renders on a page, at /preview/player-stats
 * for the quarterbacks and /preview/player-stats/rb (wr, te) for the rest —
 * the same shape as the WordPress addresses, so the table's own position links
 * stay inside the harness.
 */
router.get(["/preview/player-stats", "/preview/player-stats/:pos"], (req, res) => {
  const raw = String(req.params["pos"] ?? "qb");
  const position = parseStatsPosition(raw);
  const season = parseStatsSeason(req.query["season"]) ?? statsDefaultSeason();
  if (!position || season === null) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }
  try {
    const result = renderStatsFragment(position, season, {
      embed: true,
      basePath: "/preview/player-stats",
      playerPathPrefix: "/preview/player/",
      defaultSeason: statsDefaultSeason(),
      endpoint: "/embed/player-stats",
    });
    send(
      req,
      res,
      hostPage({
        title: "Advanced Player Stats",
        shortcode: "[statchasers_player_stats]",
        styles: ["/player-stats.css"],
        scripts: ["/dist/statchasers-player-stats.js"],
        fragment: result.html,
      }),
    );
  } catch (err) {
    logger.error({ err }, "Advanced stats shortcode preview failed");
    res.status(500).type("html").send("<h1>Preview failed</h1>");
  }
});

/** The advanced stats fragment as source. */
router.get("/preview/raw/player-stats", (req, res) => {
  const season = statsDefaultSeason();
  if (season === null) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }
  try {
    const result = renderStatsFragment("QB", season, {
      embed: true,
      defaultSeason: season,
    });
    send(
      req,
      res,
      sourcePage("[statchasers_player_stats]", "/embed/player-stats", result.html),
    );
  } catch (err) {
    logger.error({ err }, "Advanced stats fragment source view failed");
    res.status(500).type("html").send("<h1>Preview failed</h1>");
  }
});

/**
 * [statchasers_rb_handcuffs] as it renders on a page. The player links stay in
 * the harness; the cards come from the real endpoint, as they do on a page.
 */
router.get("/preview/rb-handcuffs", (req, res) => {
  try {
    const result = renderHandcuffFragment({
      embed: true,
      playerPathPrefix: "/preview/player/",
      endpoint: "/embed/rb-handcuffs",
    });
    if (!result.board) {
      res.status(404).type("text/plain").send("Not found");
      return;
    }
    send(
      req,
      res,
      hostPage({
        title: "RB Handcuff Rankings",
        shortcode: "[statchasers_rb_handcuffs]",
        styles: ["/rb-handcuffs.css"],
        scripts: ["/dist/statchasers-rb-handcuffs.js"],
        fragment: result.html,
      }),
    );
  } catch (err) {
    logger.error({ err }, "RB handcuffs shortcode preview failed");
    res.status(500).type("html").send("<h1>Preview failed</h1>");
  }
});

/** The RB handcuffs fragment as source. */
router.get("/preview/raw/rb-handcuffs", (req, res) => {
  try {
    const result = renderHandcuffFragment({ embed: true });
    send(
      req,
      res,
      sourcePage("[statchasers_rb_handcuffs]", "/embed/rb-handcuffs", result.html),
    );
  } catch (err) {
    logger.error({ err }, "RB handcuffs fragment source view failed");
    res.status(500).type("html").send("<h1>Preview failed</h1>");
  }
});

/**
 * [statchasers_strength_of_schedule] as it renders on a page. The view comes
 * off the query string, as the plugin forwards it; swaps go to the real
 * endpoint.
 */
router.get("/preview/sos", (req, res) => {
  void (async () => {
    try {
      const view = parseSosState({ tab: req.query["tab"], pos: req.query["pos"], scoring: req.query["scoring"] });
      const result = await renderSosFragment(view, { embed: true, endpoint: "/embed/sos", csvBase: "/sos" });
      if (!result.board) {
        res.status(404).type("text/plain").send("Not found");
        return;
      }
      send(
        req,
        res,
        hostPage({
          title: "Fantasy Football Strength of Schedule",
          shortcode: "[statchasers_strength_of_schedule]",
          styles: ["/sos.css"],
          scripts: ["/dist/statchasers-sos.js"],
          fragment: result.html,
        }),
      );
    } catch (err) {
      logger.error({ err }, "SOS shortcode preview failed");
      res.status(500).type("html").send("<h1>Preview failed</h1>");
    }
  })();
});

/** The SOS fragment as source. */
router.get("/preview/raw/sos", (req, res) => {
  void (async () => {
    try {
      const view = parseSosState({ tab: req.query["tab"], pos: req.query["pos"], scoring: req.query["scoring"] });
      const result = await renderSosFragment(view, { embed: true });
      send(req, res, sourcePage("[statchasers_strength_of_schedule]", "/embed/sos", result.html));
    } catch (err) {
      logger.error({ err }, "SOS fragment source view failed");
      res.status(500).type("html").send("<h1>Preview failed</h1>");
    }
  })();
});

/** The rankings fragment as source. */
router.get("/preview/raw/rankings", (req, res) => {
  try {
    const result = renderRankingsFragment(undefined, { embed: true });
    send(
      req,
      res,
      sourcePage("[statchasers_rankings]", "/embed/rankings", result.html),
    );
  } catch (err) {
    logger.error({ err }, "Rankings fragment source view failed");
    res.status(500).type("html").send("<h1>Preview failed</h1>");
  }
});

/** The schedule fragment as source. */
router.get("/preview/raw/schedule", (req, res) => {
  void (async () => {
    const view = parseScheduleView(String(req.query["view"] ?? ""));
    const week = parseWeek(String(req.query["week"] ?? ""));
    const team = normalizeTeamName(String(req.query["team"] ?? ""));
    const filter = parseGameFilter(String(req.query["filter"] ?? ""));
    try {
      const result = await renderScheduleFragment(scheduleSeason(), {
        embed: true,
        view,
        filter,
        ...(week === null ? {} : { week }),
        ...(team === null ? {} : { team }),
      });
      send(
        req,
        res,
        sourcePage(
          `[statchasers_schedule view="${view}"]`,
          "/embed/schedule",
          result.html,
        ),
      );
    } catch (err) {
      logger.error({ err }, "Schedule fragment source view failed");
      res.status(500).type("html").send("<h1>Preview failed</h1>");
    }
  })();
});

export default router;
