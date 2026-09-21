/**
 * Markup for the NFL schedule.
 *
 * Server-only, like team-render.ts, player-render.ts, fpa-render.ts and
 * rankings-render.ts. The weekly board and the season matrix are both drawn
 * here as strings, and client/schedule.ts only smooths the controls on top of
 * what is already in the response.
 *
 * That is the substantive change from the standalone app this came from. There,
 * every view was React state over a JSON payload the browser fetched: the HTML
 * WordPress printed was an empty container with a loading skeleton, so "Bills
 * at Dolphins, Week 3, 1:00 PM ET on CBS" only existed after a bundle ran. Here
 * it is in the bytes, which is what makes it something a crawler reads and a
 * reader sees before any JavaScript arrives.
 *
 * The rules are the other tools':
 *
 * 1. A field we do not have is not rendered. A flexed week with no kickoff time
 *    prints "TBD", not a plausible Sunday afternoon; a game whose broadcast
 *    ESPN has not assigned prints "TBD", not a guess.
 * 2. Nothing predicts. The market's spread and total are reported as what the
 *    market has posted, with the coverage caveat attached when the slate is
 *    only part priced; the page does not project a score or tell anyone to
 *    start a player.
 *
 * And two this tool needs specifically:
 *
 * 3. **One view at a time, and the view is in the URL.** Eighteen weekly
 *    boards and a matrix is far too much markup to ship at once, so — unlike
 *    the rankings, where every panel is in the document — the view, week and
 *    filter are ordinary query state and the controls are ordinary links. That
 *    works with scripting off, it is what makes the
 *    shortcode's attributes mean anything, and it keeps a page weight a phone
 *    can afford. The canonical stays on the bare path regardless (see
 *    schedule-seo.ts), so this is one page with several states rather than
 *    several hundred URLs.
 * 4. **Home and away are stated, never only positioned.** "ATL at GB" reads
 *    left to right as away-then-home, which is the convention and is also
 *    invisible to anyone who cannot see the layout. Every matchup carries the
 *    word "at" in its text.
 *
 * ## What used to be here
 *
 * A third view, the team lens: one club's season as a five-column table with
 * four summary cards beside it. It moved to the team hub's Schedule tab, which
 * is a page already about that team — see team-render.ts's renderFullSchedule()
 * and renderSeasonShape(). Links to it are redirected there by routes/schedule.ts.
 */

import { escapeHtml, escapeJsonLd } from "./render";
import { networkMarkFor } from "./team/network-marks";
import { TEAMS, type NflTeam } from "./team/teams";
import {
  formatGameDate,
  formatKickoff,
} from "./schedule/format";
import {
  scheduleFaq,
  scheduleFaqHeading,
  type ScheduleFaq,
} from "./schedule/schedule-faq";
import {
  byeTeams,
  currentWeek,
  opponentOf,
  teamGames,
  venueFlag,
  weekGames,
  TOTAL_WEEKS,
  type GameFilter,
  type ScheduleGame,
  type ScheduleSeason,
  type ScheduleView,
} from "./schedule/schedule-data";

export interface ScheduleRenderOptions {
  /**
   * Embedded inside a statchasers.com page: drops the standalone chrome and
   * demotes the title to an <h2>, because the host page supplies the H1.
   */
  embed?: boolean;
  /** Where the tool's own controls point. Defaults to this app's own /schedule. */
  basePath?: string;
  /** Where a team link points. Defaults to this app's own /team/. */
  teamPathPrefix?: string;
  /**
   * Where the CSV and calendar exports live.
   *
   * Separate from `basePath` because the exports are served by THIS app and the
   * controls are not: on a WordPress page `basePath` is the WordPress page's own
   * path, and hanging `/download.csv` off it would point the button at a URL
   * WordPress has never heard of. Defaults to `basePath`, which is right for
   * the standalone page.
   */
  downloadBase?: string;
  /** Carried onto internal links so embed mode stays embed mode. */
  linkQuery?: string;
  view?: ScheduleView;
  /** The week the board opens on. Defaults to the one the season is in. */
  week?: number;
  filter?: GameFilter;
  /** Injected for testability; the cache keys on the data, not on this. */
  now?: number;
}

const DEFAULT_BASE_PATH = "/schedule";
const DEFAULT_TEAM_PREFIX = "/team/";
const DASH = "—";

/* ------------------------------------------------------------------ links */

/**
 * Join a base path to a sub-path without doubling the separator.
 *
 * SC_SCHEDULE_PATH is a WordPress page path and those are conventionally
 * written with a trailing slash, so `/nfl/schedule/` + `/download.csv` would
 * otherwise give `//download.csv` — which a browser resolves as a
 * protocol-relative URL to the host `download.csv`. Same reasoning as
 * rankings-render.ts.
 */
function joinPath(base: string, sub: string): string {
  return `${base.replace(/\/+$/, "")}${sub}`;
}

/**
 * The address of one week of the board: `/schedule/week-2`.
 *
 * The weekly board is the one view with a week of its own to name, so it gets
 * paths rather than a parameter — eighteen pages, each about one slate, instead
 * of eighteen spellings of one page.
 *
 * The trailing slash is kept where it was, because `base` is two different
 * kinds of thing: this app's own `/schedule`, which has none, and the
 * WordPress page's path on an embed, which conventionally does and whose
 * rewrite rule wants it back.
 */
function weekPath(base: string, week: number): string {
  const trailing = base.endsWith("/") ? "/" : "";
  return `${joinPath(base, `/week-${week}`)}${trailing}`;
}

interface ViewState {
  view: ScheduleView;
  week: number;
  filter: GameFilter;
}

/**
 * A URL for some other state of this page.
 *
 * The week lives in the path (`/schedule/week-2`) and everything else lives in
 * the query string. That split is not cosmetic: a week is a different slate of
 * games and deserves an address, while the view and the filter are ways of
 * looking at one — and `week` never appears as a parameter, so no rendering has
 * two spellings.
 *
 * Only what differs from the default is written, so the links stay short.
 * `linkQuery` is merged in rather than appended, because it carries `embed=1`
 * and two question marks is not a URL.
 */
function stateUrl(
  base: string,
  current: ViewState,
  next: Partial<ViewState>,
  linkQuery: string,
): string {
  const merged = { ...current, ...next };
  const params = new URLSearchParams(linkQuery.replace(/^\?/, ""));

  if (merged.view !== "week") params.set("view", merged.view);
  else params.delete("view");

  // Never a parameter, on any view: the weekly board carries it in the path and
  // the other two views do not carry it at all, because a team lens that
  // remembered a week would be a second URL for one rendering.
  params.delete("week");

  // Never a parameter now: the team lens that took one has moved to the team
  // hub, and a stray ?team= on a board or a matrix URL is a second address for
  // the same page.
  params.delete("team");

  if (merged.view === "week" && merged.filter !== "all") {
    params.set("filter", merged.filter);
  } else params.delete("filter");

  const path = merged.view === "week" ? weekPath(base, merged.week) : base;
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** Where the game stands: the clock while it runs, the word FINAL after. */
function statusText(game: ScheduleGame): string {
  if (game.status === "live") {
    return (game.statusDetail ?? "Live").toUpperCase();
  }
  if (game.status === "final") {
    return (game.statusDetail ?? "Final").toUpperCase();
  }
  return formatKickoff(game.time);
}

function spreadLabel(game: ScheduleGame): string {
  if (game.spreadLine === null || game.spreadLine === 0) return "Pick'em";
  const favored = game.spreadLine > 0 ? game.homeCode : game.awayCode;
  return `${favored} −${Math.abs(game.spreadLine)}`;
}

/* ------------------------------------------------------------- the marks */

/**
 * A broadcaster as its own logo, or as its name when we have no artwork.
 *
 * The <use> points at a symbol defined once per fragment by networkDefs() — a
 * week carries the same five or six networks across sixteen rows, and repeating
 * the path data on each is the same picture sixteen times. Same machinery as
 * the team hub's schedule table, with its own id prefix so the two fragments
 * can sit on one WordPress page without duplicate ids.
 *
 * A simulcast arrives as "NBC / Peacock" and draws both marks, because the
 * question the column answers is "where can I watch this" and the answer is
 * genuinely two places. They are drawn stacked rather than side by side — a
 * wordmark and a roundel on one row read as one wide smear.
 */
/**
 * How big a broadcaster's mark is drawn.
 *
 * Every mark gets the same AREA rather than the same height, and that is the
 * whole point. ESPN's wordmark is 4:1 and the ABC roundel is 1:1, so at a
 * shared height the wordmark is four times the ink — which is what made ESPN
 * look enormous in a cell it shares with ABC. Equal area is what "the same
 * size" actually means to an eye comparing two shapes.
 *
 * The height cap is what stops the rule inverting on the two TALL marks
 * (Netflix's N is 0.55:1): equal area would make them taller than the row to
 * pay for being narrow. Capped, they simply sit at the row height and are
 * narrower, which is correct — they have less to say.
 *
 * Computed here rather than in CSS because the honest expression of it needs a
 * square root, and `sqrt()` is too new to rely on inside somebody's WordPress
 * theme.
 */
const NET_MARK_AREA = 676;
export const NET_MARK_MAX_HEIGHT = 24;

export function netMarkStyle(aspect: number): string {
  const height = Math.min(
    NET_MARK_MAX_HEIGHT,
    Math.sqrt(NET_MARK_AREA / Math.max(aspect, 0.01)),
  );
  return (
    `--scs-net-h:${height.toFixed(2)}px;` +
    `--scs-net-aspect:${aspect}`
  );
}

function networkHtml(network: string | null): string {
  if (!network) {
    return `<span class="scs-tv scs-tv-tbd">TBD</span>`;
  }

  const parts = network
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  const rendered = parts.map((part) => {
    const mark = networkMarkFor(part);
    if (!mark) {
      return `<span class="scs-net-text">${escapeHtml(part)}</span>`;
    }
    return (
      `<svg class="scs-net-mark" viewBox="${mark.viewBox}"` +
      ` preserveAspectRatio="xMidYMid meet"` +
      ` style="${netMarkStyle(mark.aspect)}"` +
      ` role="img" aria-label="${escapeHtml(mark.title)}">` +
      `<use href="#scs-net-${mark.key}" /></svg>`
    );
  });

  // One row, hairline between: a 4:1 wordmark beside a roundel reads as a
  // single wide smear without a divider. See .scs-tv.
  return (
    `<span class="scs-tv" title="${escapeHtml(network)}">` +
    rendered.join(`<span class="scs-net-sep" aria-hidden="true"></span>`) +
    `</span>`
  );
}

/** The symbols the marks in this fragment point at, defined once. */
function networkDefs(games: ScheduleGame[]): string {
  const marks = new Map<string, NonNullable<ReturnType<typeof networkMarkFor>>>();
  for (const game of games) {
    if (!game.network) continue;
    for (const part of game.network.split("/")) {
      const mark = networkMarkFor(part.trim());
      if (mark) marks.set(mark.key, mark);
    }
  }
  if (marks.size === 0) return "";

  return (
    `<svg class="scs-net-defs" aria-hidden="true" focusable="false"><defs>` +
    [...marks.values()]
      .map(
        (mark) =>
          `<symbol id="scs-net-${mark.key}" viewBox="${mark.viewBox}">` +
          mark.paths
            .map(
              (part) =>
                `<path fill="${part.fill}"` +
                (part.evenOdd ? ` fill-rule="evenodd"` : "") +
                ` d="${part.d}" />`,
            )
            .join("") +
          `</symbol>`,
      )
      .join("") +
    `</defs></svg>`
  );
}

/* ------------------------------------------------------------- the teams */

function teamLogo(team: NflTeam | null, size: number, className: string): string {
  if (!team) return `<span class="${className} scs-logo-blank"></span>`;
  return (
    `<img class="${className}" src="${escapeHtml(team.logo)}" alt=""` +
    ` width="${size}" height="${size}" loading="lazy" decoding="async" />`
  );
}

function teamHref(
  team: NflTeam | null,
  options: ScheduleRenderOptions,
): string | null {
  if (!team) return null;
  const prefix = options.teamPathPrefix ?? DEFAULT_TEAM_PREFIX;
  return `${prefix}${team.slug}${options.linkQuery ?? ""}`;
}

/**
 * The same team, at the page that now holds its season.
 *
 * This tool used to answer "what does one team's year look like" with a view of
 * its own, and the bye card and the matrix pointed at it. That view is gone —
 * the team hub's Schedule tab holds it, with the same table and the same four
 * cards — so those links point one level deeper instead of at the team's front
 * page, and a reader who clicks a crest still lands on the season they clicked
 * for.
 */
function teamScheduleHref(
  team: NflTeam | null,
  options: ScheduleRenderOptions,
): string | null {
  if (!team) return null;
  const prefix = options.teamPathPrefix ?? DEFAULT_TEAM_PREFIX;
  return `${prefix}${team.slug}/schedule/${options.linkQuery ?? ""}`;
}

/* ------------------------------------------------------------ week board */

/**
 * One game on the weekly board.
 *
 * Three columns: when it is, who is playing, and where to watch. The matchup
 * reads away-then-home with the word "at" between, and the visually hidden line
 * restates the whole fixture — a screen reader should not have to infer home
 * and away from the order two logos were printed in.
 */
function renderGameRow(
  game: ScheduleGame,
  options: ScheduleRenderOptions,
): string {
  const live = game.status === "live";
  const hasScore = game.awayScore !== null && game.homeScore !== null;

  const side = (
    team: NflTeam | null,
    code: string,
    score: number | null,
    align: "away" | "home",
  ): string => {
    const name = team?.nickname ?? code;
    const href = teamHref(team, options);
    const label =
      href === null
        ? `<span class="scs-game-name">${escapeHtml(name)}</span>`
        : `<a class="scs-game-name" href="${escapeHtml(href)}" target="_top">${escapeHtml(name)}</a>`;
    const scoreHtml = hasScore
      ? `<strong class="scs-game-score">${escapeHtml(String(score))}</strong>`
      : "";
    const text =
      `<span class="scs-game-text">${label}` +
      `<span class="scs-game-code">${escapeHtml(code)}</span></span>`;

    return (
      `<span class="scs-game-side" data-side="${align}">` +
      (align === "away"
        ? text + scoreHtml + teamLogo(team, 32, "scs-game-logo")
        : teamLogo(team, 32, "scs-game-logo") + scoreHtml + text) +
      `</span>`
    );
  };

  const spoken =
    `${game.away?.fullName ?? game.awayCode} at ` +
    `${game.home?.fullName ?? game.homeCode}` +
    (hasScore ? `, ${game.awayScore} to ${game.homeScore}` : "") +
    `, ${formatGameDate(game.date, game.weekday)}, ${statusText(game)}`;

  return (
    `<article class="scs-game" data-status="${game.status}" id="${escapeHtml(
      `scs-game-${game.id}`,
    )}">` +
    `<p class="scs-visually-hidden">${escapeHtml(spoken)}</p>` +
    `<div class="scs-game-when">` +
    `<span class="scs-game-date">${escapeHtml(
      formatGameDate(game.date, game.weekday),
    )}</span>` +
    // The kickoff rides along ONLY while the game is still a kickoff. Once it
    // is live or final this cell holds a clock or the word FINAL, and a bundle
    // that rewrote it into a local time would erase the score's own status.
    `<span class="scs-game-status"${
      game.kickoffMs === null || game.status !== "scheduled"
        ? ""
        : ` data-kickoff="${game.kickoffMs}"`
    }>` +
    (live ? `<span class="scs-live-dot" aria-hidden="true"></span>` : "") +
    `${escapeHtml(statusText(game))}</span>` +
    `</div>` +
    `<div class="scs-game-teams" aria-hidden="true">` +
    side(game.away, game.awayCode, game.awayScore, "away") +
    `<span class="scs-game-at">at</span>` +
    side(game.home, game.homeCode, game.homeScore, "home") +
    `</div>` +
    `<div class="scs-game-meta">` +
    networkHtml(game.network) +
    `</div>` +
    `</article>`
  );
}

function renderEmpty(title: string, body: string): string {
  return (
    `<div class="scs-empty">` +
    `<p class="scs-empty-title">${escapeHtml(title)}</p>` +
    `<p class="scs-empty-body">${escapeHtml(body)}</p>` +
    `</div>`
  );
}

/** The week strip. Eighteen links, the current one marked. */
function renderWeekRail(
  base: string,
  state: ViewState,
  linkQuery: string,
): string {
  const items = Array.from({ length: TOTAL_WEEKS }, (_, index) => {
    const week = index + 1;
    const on = week === state.week;
    return (
      `<li><a class="scs-rail-link${on ? " is-active" : ""}"` +
      ` href="${escapeHtml(stateUrl(base, state, { week, view: "week" }, linkQuery))}"` +
      (on ? ` aria-current="page"` : "") +
      `><span class="scs-visually-hidden">Week </span>${week}</a></li>`
    );
  }).join("");

  return (
    `<nav class="scs-rail" aria-label="Weeks" data-scs-rail>` +
    `<ul class="scs-rail-list">${items}</ul></nav>`
  );
}

const FILTER_LABELS: Record<GameFilter, string> = {
  all: "All games",
  division: "Division",
  international: "International",
};

/* --------------------------------------------------------- sidebar cards */

function card(label: string, body: string, kind = ""): string {
  return (
    `<section class="scs-card"${kind ? ` data-kind="${kind}"` : ""}>` +
    `<h3 class="scs-card-label">${escapeHtml(label)}</h3>${body}</section>`
  );
}

/** A compact away-at-home line, for the sidebar cards. */
function miniMatchup(game: ScheduleGame): string {
  const side = (team: NflTeam | null, code: string, which: string): string =>
    `<span class="scs-mini-side" data-side="${which}">` +
    teamLogo(team, 24, "scs-mini-logo") +
    `<span class="scs-mini-code">${escapeHtml(code)}</span></span>`;

  return (
    `<p class="scs-mini">` +
    side(game.away, game.awayCode, "away") +
    `<span class="scs-mini-at">at</span>` +
    side(game.home, game.homeCode, "home") +
    `</p>`
  );
}

/**
 * The market has to have priced most of the slate before a "highest" or
 * "lowest" claim means anything.
 *
 * Below the floor the card says what it is missing instead of ranking four
 * games and calling one of them the week's best. Early in a week that is the
 * honest state, and it is the state the standalone app rendered as a confident
 * answer over whatever three lines had opened.
 */
const LINE_COVERAGE_FLOOR = 0.5;

function renderMarketCards(games: ScheduleGame[], week: number): string {
  const priced = games.filter((game) => game.totalLine !== null);
  const spreads = games
    .filter((game) => game.spreadLine !== null)
    .sort(
      (a, b) => Math.abs(a.spreadLine ?? 99) - Math.abs(b.spreadLine ?? 99),
    );

  if (games.length === 0) return "";

  if (priced.length / games.length < LINE_COVERAGE_FLOOR) {
    return card(
      `Week ${week} market`,
      `<p class="scs-card-note">` +
        escapeHtml(
          priced.length === 0
            ? `Betting lines for Week ${week} have not posted yet. This fills in as the market opens.`
            : `Only ${priced.length} of ${games.length} Week ${week} games have posted lines ${DASH} too few to rank the slate.`,
        ) +
        `</p>`,
      "market",
    );
  }

  const byTotal = [...priced].sort(
    (a, b) => (b.totalLine ?? 0) - (a.totalLine ?? 0),
  );
  const highest = byTotal[0];
  const lowest = byTotal.length > 1 ? byTotal[byTotal.length - 1] : null;
  const closest = spreads[0] ?? null;
  const biggest = spreads.length > 1 ? spreads[spreads.length - 1] : null;
  const coverage =
    priced.length === games.length
      ? ""
      : `<p class="scs-card-fine">${escapeHtml(
          `${priced.length} of ${games.length} games priced`,
        )}</p>`;

  const figure = (game: ScheduleGame, value: string, note: string): string =>
    miniMatchup(game) +
    `<p class="scs-card-figure">${escapeHtml(value)}</p>` +
    `<p class="scs-card-note">${escapeHtml(note)}</p>`;

  return [
    highest
      ? card(
          "Highest total",
          figure(
            highest,
            `O/U ${highest.totalLine}`,
            "Highest posted over/under this week",
          ) + coverage,
          "market",
        )
      : "",
    lowest
      ? card(
          "Lowest total",
          figure(
            lowest,
            `O/U ${lowest.totalLine}`,
            "Lowest posted over/under this week",
          ),
          "market",
        )
      : "",
    closest
      ? card(
          "Closest spread",
          figure(closest, spreadLabel(closest), "Tightest line on the board"),
          "market",
        )
      : "",
    biggest
      ? card(
          "Biggest spread",
          figure(biggest, spreadLabel(biggest), "Widest line on the board"),
          "market",
        )
      : "",
  ].join("");
}

function renderByeCard(
  schedule: ScheduleSeason,
  week: number,
  options: ScheduleRenderOptions,
): string {
  const byes = byeTeams(schedule, week, TEAMS);
  if (byes.length === 0) {
    return card(
      "Bye week",
      `<p class="scs-card-note">No teams on bye.</p>`,
      "bye",
    );
  }

  const items = byes
    .map(
      (team) =>
        `<li><a class="scs-bye" href="${escapeHtml(
          teamScheduleHref(team, options) ?? "",
        )}" target="_top">` +
        teamLogo(team, 24, "scs-bye-logo") +
        `<span>${escapeHtml(team.nickname)}</span></a></li>`,
    )
    .join("");

  return card("Bye week", `<ul class="scs-bye-list">${items}</ul>`, "bye");
}

function renderTravelCard(games: ScheduleGame[]): string {
  const intl = games.filter((game) => game.international);
  if (intl.length === 0) {
    return card(
      "Travel alert",
      `<p class="scs-card-note">No international travel this week.</p>`,
      "travel",
    );
  }
  const items = intl
    .map(
      (game) =>
        `<li>${miniMatchup(game)}<p class="scs-card-fine">` +
        `${venueFlag(game.location)} ${escapeHtml(
          game.location ?? game.stadium ?? "International",
        )}</p></li>`,
    )
    .join("");
  return card("Travel alert", `<ul class="scs-plain-list">${items}</ul>`, "travel");
}

function renderDivisionCard(games: ScheduleGame[]): string {
  const divisional = games.filter((game) => game.divisional);
  if (divisional.length === 0) {
    return card(
      "Divisional games",
      `<p class="scs-card-note">No divisional games this week.</p>`,
      "division",
    );
  }
  return card(
    "Divisional games",
    `<p class="scs-card-figure">${divisional.length} ${
      divisional.length === 1 ? "matchup" : "matchups"
    }</p>` +
      `<ul class="scs-plain-list">${divisional
        .map((game) => `<li>${miniMatchup(game)}</li>`)
        .join("")}</ul>`,
    "division",
  );
}

/* -------------------------------------------------------------- the week */

function renderWeekView(
  schedule: ScheduleSeason,
  options: ScheduleRenderOptions,
  state: ViewState,
): string {
  const base = options.basePath ?? DEFAULT_BASE_PATH;
  const linkQuery = options.linkQuery ?? "";
  const games = weekGames(schedule, state.week, state.filter);
  const all = weekGames(schedule, state.week, "all");

  const board =
    games.length > 0
      ? games.map((game) => renderGameRow(game, options)).join("")
      : renderEmpty(
          `No games match`,
          state.filter === "all"
            ? `Week ${state.week} has no published matchups yet.`
            : `No ${FILTER_LABELS[state.filter].toLowerCase()} games in Week ${state.week}.`,
        );

  // The heading and the rail sit INSIDE the main column, not above the grid,
  // so the side column's first card starts level with "Week N / 18" rather
  // than level with the board, and so the rail cannot overhang the board.
  return (
    `<div class="scs-layout scs-layout-week">` +
    `<div class="scs-main">` +
    `<div class="scs-viewhead">` +
    `<h2 class="scs-view-title">Week ${state.week}` +
    `<span class="scs-view-sub"> / ${TOTAL_WEEKS}</span></h2>` +
    `</div>` +
    renderWeekRail(base, state, linkQuery) +
    `<div class="scs-board">` +
    `<div class="scs-board-head" aria-hidden="true">` +
    `<span>When</span><span>Matchup</span><span>TV</span></div>` +
    board +
    `</div></div>` +
    `<aside class="scs-side" aria-label="Week ${state.week} at a glance">` +
    renderMarketCards(all, state.week) +
    renderByeCard(schedule, state.week, options) +
    renderTravelCard(all) +
    renderDivisionCard(all) +
    `</aside></div>`
  );
}

/* ------------------------------------------------------------ the matrix */

/**
 * Every team, every week, in one table.
 *
 * A real `<table>` with row and column headers rather than the grid of divs the
 * standalone app drew: thirty-two rows of eighteen opponent codes is exactly
 * the case where a screen reader needs to be able to say "Bills, Week 7, at
 * Miami" — which it can only do if the cell knows which row and column it is
 * in.
 */
function renderMatrixView(
  schedule: ScheduleSeason,
  options: ScheduleRenderOptions,
  state: ViewState,
): string {
  const base = options.basePath ?? DEFAULT_BASE_PATH;
  const linkQuery = options.linkQuery ?? "";

  const byTeamWeek = new Map<string, ScheduleGame>();
  for (const game of schedule.games) {
    if (game.away) byTeamWeek.set(`${game.away.abbreviation}:${game.week}`, game);
    if (game.home) byTeamWeek.set(`${game.home.abbreviation}:${game.week}`, game);
  }

  const head =
    `<tr><th scope="col" class="scs-matrix-corner">Team</th>` +
    Array.from({ length: TOTAL_WEEKS }, (_, index) => {
      const week = index + 1;
      return (
        `<th scope="col"><a href="${escapeHtml(
          stateUrl(base, state, { view: "week", week }, linkQuery),
        )}">${week}</a></th>`
      );
    }).join("") +
    `</tr>`;

  const rows = TEAMS.map((team) => {
    const cells = Array.from({ length: TOTAL_WEEKS }, (_, index) => {
      const week = index + 1;
      const game = byTeamWeek.get(`${team.abbreviation}:${week}`);
      if (!game) {
        return `<td class="scs-matrix-bye">BYE</td>`;
      }
      const atHome = game.home?.abbreviation === team.abbreviation;
      const opponent = opponentOf(game, team);
      const code = opponent?.code ?? (atHome ? game.awayCode : game.homeCode);
      return (
        `<td class="scs-matrix-cell" data-home="${atHome ? "1" : "0"}">` +
        `<a href="${escapeHtml(
          stateUrl(base, state, { view: "week", week }, linkQuery),
        )}" title="${escapeHtml(
          `${team.fullName} ${atHome ? "vs" : "at"} ${opponent?.fullName ?? code}, Week ${week}`,
        )}">${atHome ? "" : "@"}${escapeHtml(code)}</a></td>`
      );
    }).join("");

    return (
      `<tr><th scope="row" class="scs-matrix-team">` +
      `<a href="${escapeHtml(
        teamScheduleHref(team, options) ?? "",
      )}" target="_top">${teamLogo(team, 22, "scs-matrix-logo")}` +
      `<span class="scs-matrix-labels">` +
      `<span class="scs-matrix-name">${escapeHtml(team.nickname)}</span>` +
      `<span class="scs-matrix-code">${escapeHtml(team.code)}</span></span></a></th>` +
      cells +
      `</tr>`
    );
  }).join("");

  return (
    `<div class="scs-viewhead">` +
    `<h2 class="scs-view-title">Every team. Every week.</h2>` +
    `<p class="scs-view-note">` +
    `A cell is the opponent; <strong>@</strong> marks a road game. Choose one to open that week's board.` +
    `</p></div>` +
    `<div class="scs-matrix-scroll" tabindex="0" role="region" aria-label="Season matrix">` +
    `<table class="scs-matrix"><caption class="scs-visually-hidden">` +
    `${schedule.season} NFL regular-season opponents by team and week</caption>` +
    `<thead>${head}</thead><tbody>${rows}</tbody></table></div>`
  );
}

/* --------------------------------------------------------------- the top */

function renderViewNav(
  base: string,
  state: ViewState,
  linkQuery: string,
): string {
  const items: Array<[ScheduleView, string]> = [
    ["week", "Weekly board"],
    ["matrix", "Season matrix"],
  ];

  return (
    `<nav class="scs-views" aria-label="Schedule views">` +
    `<ul class="scs-view-list">` +
    items
      .map(([view, label]) => {
        const on = view === state.view;
        return (
          `<li><a class="scs-view-link${on ? " is-active" : ""}"` +
          ` href="${escapeHtml(stateUrl(base, state, { view }, linkQuery))}"` +
          (on ? ` aria-current="page"` : "") +
          `>${escapeHtml(label)}</a></li>`
        );
      })
      .join("") +
    `</ul></nav>`
  );
}

/**
 * The line under the tool that says where the numbers came from.
 *
 * It names both upstreams and it names the one that can be missing, because a
 * TV column full of "TBD" should read as "ESPN has not assigned these yet"
 * rather than as the tool being broken.
 */
function renderSource(schedule: ScheduleSeason): string {
  const hasNetworks = schedule.games.some((game) => game.network !== null);
  return (
    `<p class="scs-source">Slate from nflverse. ` +
    (hasNetworks
      ? `Broadcast and live scoring from ESPN.`
      : `Broadcast assignments are not available right now, so the TV column reads TBD.`) +
    ` Kickoffs are US Eastern.</p>`
  );
}

/* --------------------------------------------------------------------- faq */

/**
 * The week's questions, and the FAQPage built from the same list.
 *
 * **On the weekly board only.** The questions name a week and are answered from
 * that week's rows, so they belong to `/schedule/week-3` and to nothing else —
 * which is also what makes them worth having: the week is the one piece of this
 * tool's state with an address of its own, and eighteen addresses that differ
 * only in a number on a table are eighteen pages a search engine has no reason
 * to tell apart. The matrix gets none: nobody asks a 32-by-18 grid a
 * question in prose.
 *
 * It sits after the board and before the source line, which is where a reader
 * who has finished with the week arrives.
 *
 * Each question is its own <details>, shut by default, exactly as the rankings
 * and the team hub do it and for the same reason: the questions are the index,
 * so they all show, and the answer opens under the one that was actually asked.
 * The block itself never folds. Open state is a browser concern either way —
 * the answers are in the DOM regardless, which is what the FAQPage node
 * describes.
 *
 * The <h2> is safe in both modes. The embed drops the H1 because the WordPress
 * page owns it; an H2 under that page's own heading is where these questions
 * belong in its outline, and the questions take <h3> beneath it.
 */
function renderFaq(
  schedule: ScheduleSeason,
  state: ViewState,
  options: ScheduleRenderOptions,
): string {
  if (state.view !== "week") return "";

  const items = scheduleFaq({ schedule, week: state.week });
  if (items.length === 0) return "";

  const body = items
    .map(
      (entry) =>
        `<details class="scs-faq-item">` +
        `<summary class="scs-faq-q-row">` +
        `<h3 class="scs-faq-q">${escapeHtml(entry.question)}</h3>` +
        `</summary>` +
        `<p class="scs-faq-a">${escapeHtml(entry.answer)}</p>` +
        `</details>`,
    )
    .join("");

  return (
    `<section class="scs-faq-block" aria-labelledby="scs-faq-title">` +
    `<h2 class="scs-faq-title" id="scs-faq-title">${escapeHtml(
      scheduleFaqHeading(state.week),
    )}</h2>` +
    `<div class="scs-faq">${body}</div>` +
    `</section>` +
    renderFaqSchema(items, options)
  );
}

/**
 * The FAQPage node, or the inert island the plugin builds it from.
 *
 * Same two-mode arrangement as rankings-render.ts and team-render.ts, for the
 * reason given at length there: standalone, this page owns its document and
 * emits the node itself; embedded, WordPress owns the document and Rank Math
 * owns its graph, so a second <script type="application/ld+json"> arriving from
 * inside a mounted fragment competes with that graph instead of joining it. The
 * island is the same questions as data, and statchasers-schedule.php lifts them
 * into the one <script> the host page already prints, then strips the island.
 *
 * Data rather than the plugin re-reading the rendered markup: by then every
 * answer has been escaped for display, and un-escaping prose in PHP to feed a
 * crawler is a worse job than handing over the array it was built from.
 *
 * Note that the standalone page ships `noindex, indexifembedded`, so this node
 * is not what ranks — the WordPress copy is. It is emitted anyway because a
 * page that describes itself only when embedded is a page whose structured data
 * nobody can check without WordPress in front of it.
 */
function renderFaqSchema(
  items: ScheduleFaq[],
  options: ScheduleRenderOptions,
): string {
  if (items.length === 0) return "";

  if (options.embed) {
    return (
      `<script type="application/json" class="scs-faq-data">` +
      escapeJsonLd(
        JSON.stringify(
          items.map((entry) => ({ q: entry.question, a: entry.answer })),
        ),
      ) +
      `</script>`
    );
  }

  return (
    `<script type="application/ld+json">` +
    escapeJsonLd(
      JSON.stringify({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: items.map((entry) => ({
          "@type": "Question",
          name: entry.question,
          acceptedAnswer: { "@type": "Answer", text: entry.answer },
        })),
      }),
    ) +
    `</script>`
  );
}

/* -------------------------------------------------------------- the page */

/**
 * Resolve the requested state against the data.
 *
 * A week nobody asked for becomes the week the season is actually in — the page
 * always opens on something real rather than on an empty Week 1 in December.
 */
export function resolveState(
  schedule: ScheduleSeason,
  options: ScheduleRenderOptions,
): ViewState {
  return {
    view: options.view ?? "week",
    week:
      options.week && options.week >= 1 && options.week <= TOTAL_WEEKS
        ? options.week
        : currentWeek(schedule, options.now ?? Date.now()),
    filter: options.filter ?? "all",
  };
}

export function renderSchedulePage(
  schedule: ScheduleSeason,
  options: ScheduleRenderOptions = {},
): string {
  const base = options.basePath ?? DEFAULT_BASE_PATH;
  const linkQuery = options.linkQuery ?? "";
  const state = resolveState(schedule, options);

  const body =
    state.view === "matrix"
      ? renderMatrixView(schedule, options, state)
      : renderWeekView(schedule, options, state);

  // Only the games this rendering actually prints contribute symbols; the
  // matrix prints none, so it carries no artwork at all.
  const drawn =
    state.view === "week"
      ? weekGames(schedule, state.week, state.filter)
      : [];

  const heading = `${schedule.season} NFL Schedule`;
  const head = options.embed
    ? ""
    : `<header class="scs-head"><h1 class="scs-title">${escapeHtml(heading)}</h1>` +
      `<p class="scs-lede">Every regular-season game, week by week or all at once ` +
      `${DASH} with kickoff times, TV, byes, division games and the market's lines.</p></header>`;

  return (
    `<section class="scs${options.embed ? " is-embed" : ""}" data-scs-root` +
    ` data-scs-view="${state.view}"` +
    ` data-scs-season="${schedule.season}"` +
    (options.embed ? ` data-scs-embed="1"` : "") +
    ` aria-label="${escapeHtml(heading)}">` +
    networkDefs(drawn) +
    head +
    `<div class="scs-controlbar">` +
    renderViewNav(base, state, linkQuery) +
    `</div>` +
    body +
    renderFaq(schedule, state, options) +
    renderSource(schedule) +
    `</section>`
  );
}

/**
 * What to print when the slate cannot be loaded at all.
 *
 * An honest empty state rather than a skeleton: there is no client-side render
 * to fall back to, and a page that says nothing is better than one that
 * pretends to be loading something that is not coming.
 */
export function renderScheduleEmpty(
  options: ScheduleRenderOptions = {},
): string {
  return (
    `<section class="scs${options.embed ? " is-embed" : ""}" data-scs-root data-scs-empty="1"` +
    (options.embed ? ` data-scs-embed="1"` : "") +
    ` aria-label="NFL schedule">` +
    (options.embed
      ? ""
      : `<header class="scs-head"><h1 class="scs-title">NFL Schedule</h1></header>`) +
    renderEmpty(
      "Schedule unavailable",
      "The season feed could not be loaded. It is fetched from nflverse and cached for six hours, so this usually clears on its own.",
    ) +
    `</section>`
  );
}

/* ------------------------------------------------------------ the exports */

export interface ScheduleExportQuery {
  week?: number | null;
  team?: NflTeam | null;
  filter?: GameFilter;
}

/** The games an export covers, from the same helpers the views use. */
export function exportGames(
  schedule: ScheduleSeason,
  query: ScheduleExportQuery,
): ScheduleGame[] {
  if (query.team) return teamGames(schedule, query.team.abbreviation);
  if (query.week) return weekGames(schedule, query.week, query.filter ?? "all");
  return schedule.games;
}

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The slate as CSV.
 *
 * Built from the same normalized games the page renders, so the file and the
 * screen can never disagree — the standalone app generated its CSV in the
 * browser from a second formatter, which is how they drift.
 */
export function renderScheduleCsv(
  schedule: ScheduleSeason,
  query: ScheduleExportQuery = {},
): string {
  const header = [
    "season",
    "week",
    "date",
    "kickoff_et",
    "away",
    "home",
    "away_score",
    "home_score",
    "status",
    "network",
    "stadium",
    "location",
    "division_game",
    "international",
    "holiday",
    "spread_line",
    "total_line",
  ];

  const rows = exportGames(schedule, query).map((game) =>
    [
      schedule.season,
      game.week,
      game.date,
      game.time,
      game.awayCode,
      game.homeCode,
      game.awayScore,
      game.homeScore,
      game.status,
      game.network,
      game.stadium,
      game.location,
      game.divisional ? "TRUE" : "FALSE",
      game.international ? "TRUE" : "FALSE",
      game.holiday,
      game.spreadLine,
      game.totalLine,
    ]
      .map(csvCell)
      .join(","),
  );

  return [header.join(","), ...rows].join("\n") + "\n";
}

/** RFC 5545 escaping: commas, semicolons, backslashes and newlines. */
function icsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function icsStamp(ms: number): string {
  return `${new Date(ms).toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
}

/**
 * The slate as a calendar file.
 *
 * A game with no confirmed kickoff is omitted rather than dropped into the
 * calendar at a guessed time — the same rule the renderer follows, and the one
 * that matters most here, because a wrong VEVENT sets somebody's alarm.
 *
 * Three hours is the duration, which is the regular-season average with a
 * little air; it is a calendar block, not a claim about when the game ends.
 */
export function renderScheduleIcs(
  schedule: ScheduleSeason,
  query: ScheduleExportQuery = {},
  nowMs: number = Date.now(),
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//StatChasers//NFL Schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(
      query.team
        ? `${query.team.fullName} ${schedule.season} schedule`
        : `${schedule.season} NFL schedule`,
    )}`,
  ];

  for (const game of exportGames(schedule, query)) {
    if (game.kickoffMs === null) continue;
    const title = `${game.away?.fullName ?? game.awayCode} at ${
      game.home?.fullName ?? game.homeCode
    }`;
    const description = [
      `Week ${game.week}`,
      game.network ? `TV: ${game.network}` : null,
      game.divisional ? "Division game" : null,
      game.international && game.location ? `International: ${game.location}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    lines.push(
      "BEGIN:VEVENT",
      `UID:${icsText(`${game.id}@statchasers.com`)}`,
      `DTSTAMP:${icsStamp(nowMs)}`,
      `DTSTART:${icsStamp(game.kickoffMs)}`,
      `DTEND:${icsStamp(game.kickoffMs + 3 * 60 * 60 * 1000)}`,
      `SUMMARY:${icsText(title)}`,
      `DESCRIPTION:${icsText(description)}`,
      ...(game.stadium ? [`LOCATION:${icsText(game.stadium)}`] : []),
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  // CRLF is what the spec says, and what Outlook enforces.
  return lines.join("\r\n") + "\r\n";
}
