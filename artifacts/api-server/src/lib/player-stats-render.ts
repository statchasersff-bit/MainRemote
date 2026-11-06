/**
 * Markup for the NFL advanced player stats table.
 *
 * Server-only, like the other tools' renderers. Every row of the open table is
 * in the response - the players the default filters hide as well, marked
 * `hidden` - and client/player-stats.ts only takes over the controls on top of
 * it: sorting, the filter bar, the section pills and the season switch.
 *
 * That is the substantive change from the standalone app this came from. There
 * the table was React state inside an iframe, so the HTML statchasers.com
 * served at /nfl/nfl-player-stats/ was an empty frame and no crawler ever read
 * a number off it. Here "Josh Allen, 2025, 0.21 EPA per play" is in the page's
 * own HTML.
 *
 * The rules are the other tools':
 *
 * 1. A field we do not have is not rendered. A missing figure is a dash, a
 *    player with no page keeps his row and loses his link, a leader card with
 *    no headshot keeps the card.
 * 2. Nothing predicts. These are finished seasons, with the date the feed was
 *    built on; the page does not project them.
 *
 * And one this table needs specifically:
 *
 * 3. **A control that cannot work is not shown.** The filter bar, the section
 *    pills and the sort buttons do nothing without the bundle, so they ship
 *    `hidden` (the pills and filters) or are built by the bundle (the sort
 *    buttons, the banner's hide controls). The season and position controls
 *    are links, and work either way.
 */

import { escapeHtml, escapeJsonLd } from "./render";
import { headshotImg } from "./headshot-html";
import {
  ADVANCED_COPY,
  introCopy,
  STATS_FAQ_HEADING,
  STATS_FAQ_LABEL,
  statsFaq,
  statsPageCopy,
  type StatsFaq,
} from "./player-stats/stats-copy";
import {
  getStatsSeasons,
  POSITION_NAMES,
  POSITION_PLURALS,
  seasonShortLabel,
  STATS_POSITIONS,
  type LeaderCard,
  type LeaderFigure,
  type StatsColumn,
  type StatsPosition,
  type StatsRow,
  type StatsSeason,
  type StatsTable,
} from "./player-stats/stats-data";

export interface StatsRenderOptions {
  /**
   * Embedded inside a statchasers.com page: drops the standalone padding,
   * because the host page supplies the heading and the surrounding copy.
   */
  embed?: boolean;
  /**
   * Where the position links point: the QB table's address. The other three
   * are `<basePath>/rb` and so on, with a trailing slash when the base has one
   * - which is how a WordPress page path is written.
   */
  basePath?: string;
  /** Where a player link points. Defaults to this app's own /player/. */
  playerPathPrefix?: string;
  /** Carried onto player links so embed mode stays embed mode. */
  linkQuery?: string;
  /**
   * Carried onto the season and position links. Separate from `linkQuery`
   * because in the WordPress fragment those are statchasers.com addresses,
   * where `?embed=1` is a reserved query var - while a player link may still
   * point back at this origin.
   */
  pageQuery?: string;
  /** The season the page opens on when none is asked for. */
  defaultSeason?: StatsSeason | null;
  /**
   * Where the bundle fetches another season from. Absolute on the embed,
   * because a relative path printed inside a statchasers.com page resolves
   * against WordPress, not against this origin.
   */
  endpoint?: string;
}

const DEFAULT_BASE_PATH = "/player-stats";
const DEFAULT_PLAYER_PREFIX = "/player/";

/* ------------------------------------------------------------- formatting */

const MONTHS = [
  "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December",
];

/** "May 24, 2026", in UTC - no locale default, so the render is deterministic. */
function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

/** Thousands separators, fixed to en-US rather than whatever the host runs. */
function withCommas(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 20 });
}

/**
 * A cell's text. MIRRORS fmtCell() in the standalone app: integers as they
 * are, decimals to one place when the label is a percentage or the value is
 * three digits, to two otherwise.
 */
export function formatCell(value: unknown, column: StatsColumn): string | null {
  if (value == null) return null;
  if (column.type === "string") return String(value);
  const n = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (Number.isNaN(n)) return null;
  if (column.type === "number") return withCommas(n);
  if (column.label.includes("%")) return n.toFixed(1);
  if (Math.abs(n) >= 100) return n.toFixed(1);
  return n.toFixed(2);
}

/**
 * The grade's color band. The bands are the standalone app's - 90 elite,
 * 80 strong, 70 good, 50 average, below that poor - and the number is always
 * printed, so the color is a second reading of it and never the only one.
 */
function scoreBand(value: number): string {
  if (value >= 90) return "t90";
  if (value >= 80) return "t80";
  if (value >= 70) return "t70";
  if (value >= 50) return "t50";
  return "t0";
}

/** "D. Maye" - the phone's form of a name. MIRRORS abbreviateName(). */
function abbreviate(name: string): string {
  const trimmed = name.trim();
  const space = trimmed.indexOf(" ");
  return space === -1 ? trimmed : `${trimmed[0]}. ${trimmed.slice(space + 1)}`;
}

/* ------------------------------------------------------------------ links */

function positionHref(position: StatsPosition, options: StatsRenderOptions): string {
  const base = options.basePath ?? DEFAULT_BASE_PATH;
  if (position === "QB") return base;
  const slash = base.endsWith("/");
  return `${base.replace(/\/+$/, "")}/${position.toLowerCase()}${slash ? "/" : ""}`;
}

/**
 * An internal link with the season and the embed flag carried on it.
 *
 * The default season is left off, so the table a reader lands on from a
 * position link has one address rather than two.
 */
function withQuery(
  href: string,
  season: StatsSeason,
  options: StatsRenderOptions,
): string {
  const params: string[] = [];
  const extra = (options.pageQuery ?? "").replace(/^\?/, "");
  if (extra !== "") params.push(extra);
  if (season !== (options.defaultSeason ?? null)) params.push(`season=${season}`);
  return params.length === 0 ? href : `${href}?${params.join("&")}`;
}

function playerHref(slug: string, options: StatsRenderOptions): string {
  const prefix = options.playerPathPrefix ?? DEFAULT_PLAYER_PREFIX;
  return `${prefix}${slug}/${options.linkQuery ?? ""}`;
}

/**
 * A player's name, linked to his page when he has one.
 *
 * Both forms of the name are printed and the stylesheet picks one by the
 * width the table has, which is what the standalone app did with a JS media
 * hook. `target="_top"` for the reason the rankings give: the legacy iframe
 * mount still exists, and a profile opening inside it is a page in a box.
 */
function renderName(row: StatsRow, options: StatsRenderOptions, className: string): string {
  const inner =
    `<span class="sca-name-full">${escapeHtml(row.name)}</span>` +
    `<span class="sca-name-short" aria-hidden="true">${escapeHtml(abbreviate(row.name))}</span>`;
  if (!row.slug) return `<span class="${className}">${inner}</span>`;
  return (
    `<a class="${className}" href="${escapeHtml(playerHref(row.slug, options))}"` +
    ` target="_top">${inner}</a>`
  );
}

/* ------------------------------------------------------------ the controls */

/*
 * One command bar and, under it, one row of views:
 *
 *   WR Stats ▾ | 2026 ▾ | Totals / Per Game | More Filters ▾   Search
 *   Overview   Usage & Opportunity   Receiving   Efficiency   Advanced
 *
 * The position and season menus are <details> holding real links, so both
 * still work with scripting off. Everything else filters or rearranges rows
 * already on the page, and ships `hidden` until the bundle wires it.
 */

/** A dropdown: a <details> whose summary is the button and whose body floats. */
function renderMenu(
  className: string,
  summary: string,
  body: string,
  attrs = "",
): string {
  return (
    `<details class="sca-menu${className ? ` ${className}` : ""}"${attrs}>` +
    `<summary class="sca-menu-btn">${summary}</summary>` +
    `<div class="sca-menu-pop">${body}</div>` +
    `</details>`
  );
}

/**
 * The position menu, which is also the bar's title: "WR Stats". Real links to
 * real addresses - each position is its own page, as it was in the
 * standalone app's router.
 */
function renderPositions(table: StatsTable, options: StatsRenderOptions): string {
  const items = STATS_POSITIONS.map((position) => {
    const on = position === table.position;
    return (
      `<a class="sca-menu-item${on ? " is-active" : ""}"` +
      ` href="${escapeHtml(withQuery(positionHref(position, options), table.season, options))}"` +
      (on ? ` aria-current="page"` : "") +
      ` title="${escapeHtml(`NFL ${POSITION_NAMES[position]} Stats`)}">${position} Stats</a>`
    );
  }).join("");
  return renderMenu(
    "sca-menu-title",
    `${table.position} Stats`,
    `<nav aria-label="Position">${items}</nav>`,
    ` data-sca-positions`,
  );
}

function renderSeasons(table: StatsTable, options: StatsRenderOptions): string {
  const here = positionHref(table.position, options);
  const items = getStatsSeasons()
    .map((season) => {
      const on = season === table.season;
      return (
        `<a class="sca-menu-item${on ? " is-active" : ""}"` +
        ` href="${escapeHtml(withQuery(here, season, options))}"` +
        ` data-sca-season="${escapeHtml(String(season))}"` +
        (on ? ` aria-current="true"` : "") +
        ` rel="nofollow">${escapeHtml(seasonShortLabel(season))}</a>`
      );
    })
    .join("");
  return renderMenu(
    "",
    `<span class="sca-sr-only">Season: </span>${escapeHtml(seasonShortLabel(table.season))}`,
    `<nav aria-label="Season">${items}</nav>`,
    ` data-sca-seasons`,
  );
}

function numberInput(
  name: string,
  label: string,
  value: number,
  attrs: string,
): string {
  return (
    `<label class="sca-num">` +
    `<span class="sca-num-label">${escapeHtml(label)}</span>` +
    `<input type="number" inputmode="numeric" name="${name}" value="${value}"` +
    ` data-default="${value}" ${attrs} />` +
    `</label>`
  );
}

/**
 * The filters: the snap-share, games and volume floors behind More Filters,
 * and the search box. `hidden` until the bundle wires
 * them - every input here filters rows that are already on the page, and
 * without the bundle it would be a form that does nothing.
 */
function renderFilters(table: StatsTable): string {
  const d = table.defaults;
  const position = table.position;
  const extra =
    position === "QB"
      ? numberInput("minPassAtt", "Min Pass Att", d.minPassAtt, `min="0" step="10"`)
      : position === "RB"
        ? numberInput("minRushAtt", "Min Rush Att", d.minRushAtt, `min="0" step="5"`)
        : numberInput("minTgt", "Min TGT", d.minTgt, `min="0" step="5"`);

  return (
    `<div class="sca-filters" data-sca-filters hidden>` +
    renderMenu(
      "",
      `More Filters <span class="sca-menu-val" data-sca-val="more" hidden></span>`,
      numberInput("minSnapPct", "Min Snap%", d.minSnapPct, `min="0" max="100" step="5"`) +
        numberInput("minGP", "Min GP", d.minGP, `min="0" max="17"`) +
        extra,
    ) +
    `<label class="sca-search">` +
    `<span class="sca-sr-only">Search players</span>` +
    `<input type="search" name="search" placeholder="Search players..." autocomplete="off" />` +
    `</label>` +
    `</div>`
  );
}

/**
 * The views a position's table can be read in, each a set of its column
 * groups by label. Player Info rides along with every one, and the grades
 * group is "Advanced". A view none of whose groups a season carries is left
 * out.
 */
const VIEWS: Record<StatsPosition, Array<{ label: string; groups: string[] }>> = {
  QB: [
    { label: "Passing", groups: ["Passing Stats", "Explosive Plays"] },
    { label: "Rushing", groups: ["Rushing Stats"] },
    { label: "Efficiency", groups: ["Passing Efficiency", "Pressure & Pocket"] },
  ],
  RB: [
    { label: "Usage & Opportunity", groups: ["Usage & Opportunity"] },
    { label: "Rushing", groups: ["Rushing Stats", "Explosive Plays"] },
    { label: "Receiving", groups: ["Receiving Stats"] },
    { label: "Efficiency", groups: ["Contact & Tackle Breaking", "Ball Security / Negative Plays"] },
  ],
  WR: [
    { label: "Usage & Opportunity", groups: ["Usage & Opportunity"] },
    { label: "Receiving", groups: ["Receiving Stats", "Explosive Plays"] },
    { label: "Efficiency", groups: ["Efficiency & Hands", "YAC & Elusiveness"] },
  ],
  TE: [
    { label: "Usage & Opportunity", groups: ["Usage & Opportunity"] },
    { label: "Receiving", groups: ["Receiving Stats", "Explosive Plays"] },
    { label: "Efficiency", groups: ["Efficiency & Hands", "YAC & Elusiveness"] },
  ],
};

/**
 * The view strip: Overview (every column) first, Advanced (the grades) last.
 * Each button names the group indexes it shows. Buttons, so `hidden` until
 * wired, as above - without the bundle the whole table is on screen anyway.
 */
function renderSections(table: StatsTable): string {
  const always = table.groups
    .map((group, i) => (group.label === "Player Info" ? i : -1))
    .filter((i) => i >= 0);
  const indexesOf = (labels: string[]): number[] =>
    table.groups.map((group, i) => (labels.includes(group.label) ? i : -1)).filter((i) => i >= 0);
  const grades = table.groups.map((group, i) => (group.columns.some((c) => c.isScore) ? i : -1)).filter((i) => i >= 0);

  const views = [
    { key: "overview", label: "Overview", groups: table.groups.map((_, i) => i) },
    ...VIEWS[table.position].map((view) => ({
      key: view.label.toLowerCase().replace(/[^a-z]+/g, "-"),
      label: view.label,
      groups: indexesOf(view.groups),
    })),
    { key: "advanced", label: "Advanced", groups: grades },
  ].filter((view) => view.groups.length > 0);

  const buttons = views
    .map((view, n) => {
      const groups = Array.from(new Set([...always, ...view.groups])).sort((a, b) => a - b);
      return (
        `<button type="button" class="sca-view${n === 0 ? " is-active" : ""}"` +
        ` data-view="${view.key}" data-groups="${groups.join(" ")}"` +
        ` aria-pressed="${n === 0 ? "true" : "false"}">${escapeHtml(view.label)}</button>`
      );
    })
    .join("");
  return `<nav class="sca-views" aria-label="Table view" data-sca-sections hidden>${buttons}</nav>`;
}

/**
 * The Totals / Per Game switch. Buttons, not links - per-game figures are
 * worked out in the browser from the totals on the page - so `hidden` until
 * the bundle wires them. Outside the blocks a season swap replaces, so the
 * choice carries over to the next season.
 */
function renderMode(): string {
  return (
    `<div class="sca-mode" role="group" aria-label="Totals or per game" data-sca-mode hidden>` +
    `<button type="button" class="sca-mode-btn is-active" data-mode="total" aria-pressed="true">Totals</button>` +
    `<button type="button" class="sca-mode-btn" data-mode="game" aria-pressed="false">Per Game</button>` +
    `</div>`
  );
}

function renderControls(table: StatsTable, options: StatsRenderOptions): string {
  return (
    `<div class="sca-panel">` +
    `<div class="sca-controls">` +
    renderPositions(table, options) +
    renderSeasons(table, options) +
    renderMode() +
    renderFilters(table) +
    `</div>` +
    renderSections(table) +
    `</div>`
  );
}

/* ---------------------------------------------------------- leader cards */

/**
 * A section's head: the small label over the heading.
 */
function renderSectionHead(label: string, id: string, heading: string): string {
  return (
    `<header class="sca-section-head">` +
    `<p class="sca-eyebrow">${escapeHtml(label)}</p>` +
    `<h2 class="sca-section-title" id="${id}">${escapeHtml(heading)}</h2>` +
    `</header>`
  );
}

/*
 * The premium leader card (mak's brief, 2026-11-06): a navy header with the
 * category's icon and an accent stripe, the figure large with its context in
 * a pill, then who - portrait, a rule, name, position and team. The
 * look is keyed off the card's stat key only; the figures and the players
 * are stats-data.ts's, unchanged.
 */

/** Accent per kind of stat, one place. */
const LEADER_ACCENTS = {
  gold: "#d4af37",
  blue: "#168de8",
  purple: "#9063e8",
  teal: "#12b9a8",
  cyan: "#12c4d5",
  green: "#22a56b",
  violet: "#6f6cf2",
} as const;

/** 24px stroke icons, drawn in the accent. */
const LEADER_ICONS: Record<string, string> = {
  trophy:
    `<path d="M8 21h8M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/>` +
    `<path d="M7 6H4.5a2.5 2.5 0 0 0 2.6 4M17 6h2.5a2.5 2.5 0 0 1-2.6 4"/>`,
  football:
    `<path d="M4.6 19.4c-.9-4.6.6-9.4 4.2-12.4S17 3.7 19.4 4.6c.9 4.6-.6 9.4-4.2 12.4s-8.2 3.3-10.6 2.4z"/>` +
    `<path d="M9 15l6-6M10.2 11.4l2.4 2.4M11.8 9.8l2.4 2.4"/>`,
  goal: `<path d="M6 3v8h12V3"/><path d="M12 11v10M9 21h6"/>`,
  arc: `<path d="M3 20c2.5-8.5 8.5-13.5 17-15"/><path d="M15 4h5v5"/><circle cx="4" cy="19.5" r="1.3"/>`,
  runner:
    `<circle cx="15" cy="4.5" r="2"/><path d="M7.5 21l3.2-6.2 3.3 2.4.8 3.8"/>` +
    `<path d="M10.7 14.8l1.5-6.3-3.4 1.7-1.8 2.7M12.2 8.5l2.8 3 3.5.7"/>`,
  target: `<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/>`,
  hands:
    `<path d="M7 12V6.5a1.5 1.5 0 0 1 3 0V11M10 11V5a1.5 1.5 0 0 1 3 0v6M13 11V6a1.5 1.5 0 0 1 3 0v6"/>` +
    `<path d="M16 10.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.4a6 6 0 0 1-5-2.7L4.3 15a1.5 1.5 0 0 1 2.4-1.7L7 14"/>`,
  share: `<path d="M20.5 13.5A8.5 8.5 0 1 1 10.5 3.5v10z"/><path d="M14 3a7.5 7.5 0 0 1 7 7h-7z"/>`,
  chart: `<path d="M4 20h16"/><path d="M7 16v-5M12 16V6M17 16v-8"/>`,
};

/** Stat key -> icon and accent. Anything unlisted gets the chart, in blue. */
const LEADER_STYLE: Record<string, { icon: string; accent: keyof typeof LEADER_ACCENTS }> = {
  fantasyPoints: { icon: "trophy", accent: "gold" },
  passingYards: { icon: "football", accent: "blue" },
  passingTouchdowns: { icon: "goal", accent: "purple" },
  airYards: { icon: "arc", accent: "violet" },
  rushYards: { icon: "runner", accent: "green" },
  rushTouchdowns: { icon: "goal", accent: "purple" },
  targets: { icon: "target", accent: "blue" },
  receivingYards: { icon: "hands", accent: "cyan" },
  targetSharePct: { icon: "share", accent: "teal" },
};

function leaderStyle(key: string): { icon: string; accent: string } {
  const style = LEADER_STYLE[key] ?? { icon: "chart", accent: "blue" as const };
  return { icon: LEADER_ICONS[style.icon] ?? LEADER_ICONS["chart"]!, accent: LEADER_ACCENTS[style.accent] };
}

/**
 * The figure and who: the number large, its other reading in a pill
 * ("138.5/G", "277 total", "on 22 targets"), then the player.
 */
function renderLeaderBody(
  leader: LeaderFigure,
  position: StatsPosition,
  options: StatsRenderOptions,
  className: string,
): string {
  const row = leader.player;
  // The leaders are the first thing on the page, so the photos are not lazy:
  // a lazy image in the first screen is requested later than an eager one
  // for no saving. width/height match the box player-stats.css draws, so the
  // footer keeps its height before the file arrives. skip-lazy / data-no-lazy
  // keep WP Rocket from swapping in its empty-SVG placeholder (drawn at
  // 300x150) on the WordPress host. The 160px square derivative on this
  // server (headshot-html.ts). The face well holds the size when a photo is
  // missing or fails (the bundle removes a broken one).
  const photo =
    (row?.playerId
      ? headshotImg({
          src: null,
          id: row.playerId,
          className: "sca-leader-photo skip-lazy",
          alt: "",
          variants: ["160"],
          width: 56,
          height: 56,
          extra: ` data-no-lazy="1"`,
        })
      : null) ?? "";

  const meta = [position, row?.team ?? ""].filter(Boolean);

  return (
    `<div class="${className}">` +
    `<p class="sca-leader-fig">` +
    `<span class="sca-leader-num">${escapeHtml(leader.figure || "-")}</span>` +
    (leader.note ? `<span class="sca-leader-note">${escapeHtml(leader.note)}</span>` : "") +
    `</p>` +
    `<div class="sca-leader-who">` +
    `<span class="sca-leader-face">${photo}</span>` +
    `<div class="sca-leader-id">` +
    `<h3 class="sca-leader-name">${row ? renderName(row, options, "sca-leader-link") : "-"}</h3>` +
    (row
      ? `<span class="sca-leader-meta">${meta
          .map((part, i) =>
            i === 1 ? `<span class="sca-leader-team">${escapeHtml(part)}</span>` : escapeHtml(part),
          )
          .join(`<span class="sca-leader-sep" aria-hidden="true"> · </span>`)}</span>`
      : "") +
    `</div>` +
    `</div>` +
    `</div>`
  );
}

/**
 * One leader: the category, then the season-total leader and - for a
 * counting stat - the per-game leader beside it. The stylesheet shows one
 * or the other off the root's `is-per-game` class, which the Per Game
 * switch sets, so switching needs no fetch and a season swap keeps it.
 */
function renderLeader(card: LeaderCard, position: StatsPosition, options: StatsRenderOptions): string {
  const style = leaderStyle(card.key);
  return (
    `<article class="sca-leader" style="--sca-la:${style.accent}">` +
    `<div class="sca-leader-head">` +
    `<span class="sca-leader-icon" aria-hidden="true">` +
    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"` +
    ` stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" focusable="false">${style.icon}</svg>` +
    `</span>` +
    `<p class="sca-leader-cat">${escapeHtml(card.title)}</p>` +
    `</div>` +
    renderLeaderBody(card.total, position, options, card.perGame ? "sca-leader-total" : "sca-leader-body") +
    (card.perGame ? renderLeaderBody(card.perGame, position, options, "sca-leader-pg") : "") +
    `</article>`
  );
}

/**
 * The category leaders, one per stat. Chosen under the DEFAULT filters plus
 * the grade qualifier (see stats-data.ts), so they are the season's leaders
 * and do not move when a reader edits the filters - which is why they can be
 * rendered once, here, rather than recomputed in the browser.
 */
function renderLeaders(table: StatsTable, options: StatsRenderOptions): string {
  if (table.cards.every((card) => card.total.player === null)) return "";
  // No label, heading or copy on screen: the figures say what the row is.
  return (
    `<section class="sca-section sca-leaders" aria-label="Stat leaders">` +
    `<div class="sca-leader-row">` +
    table.cards.map((card) => renderLeader(card, table.position, options)).join("") +
    `</div>` +
    `</section>`
  );
}

/* --------------------------------------------------------------- the table */

/**
 * A header label, stacked the way the standalone app stacked it: a label with
 * a slash is a fraction (numerator over a rule over denominator), and a label
 * of more than two words breaks in the middle. Two short lines are what keep
 * fifty columns from being fifty wide ones.
 */
function renderLabel(label: string): string {
  const slash = label.indexOf("/");
  if (slash >= 0) {
    return (
      `<span class="sca-frac">` +
      `<span>${escapeHtml(label.slice(0, slash).trim())}</span>` +
      `<span>${escapeHtml(label.slice(slash + 1).trim())}</span>` +
      `</span>`
    );
  }
  const words = label.split(/\s+/);
  const lines =
    words.length <= 2
      ? words
      : [
          words.slice(0, Math.ceil(words.length / 2)).join(" "),
          words.slice(Math.ceil(words.length / 2)).join(" "),
        ];
  return `<span class="sca-lines">${lines
    .map((line) => `<span>${escapeHtml(line)}</span>`)
    .join("")}</span>`;
}

function renderHead(table: StatsTable): string {
  // The first banner spans the pinned cells too - #, Player and Team - which
  // is how the standalone app drew it. The bundle recomputes the spans when a
  // group is hidden.
  const banner = table.groups
    .map((group, i) => {
      const span = group.columns.length + (i === 0 ? 3 : 0);
      return (
        `<th scope="colgroup" colspan="${span}" class="sca-band" data-g="${i}"` +
        ` data-span="${group.columns.length}">${escapeHtml(group.label)}</th>`
      );
    })
    .join("");

  const cols = table.groups
    .flatMap((group, i) =>
      group.columns.map((col, ci) => {
        const edge = ci === group.columns.length - 1 && i < table.groups.length - 1;
        const opening = col.key === table.overallKey;
        const marked = col.fullSeason && table.weeks !== null;
        const title = marked
          ? `${col.tooltip ?? col.label} Covers weeks 1–18: there is no week-by-week source for it.`
          : col.tooltip;
        const classes = [
          "sca-th",
          col.isScore ? "is-score" : col.type === "string" ? "is-text" : "is-num",
          edge ? "is-edge" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          `<th scope="col" class="${classes}" data-g="${i}" data-key="${escapeHtml(col.key)}"` +
          ` data-sort-type="${col.type === "string" ? "text" : "number"}"` +
          (opening ? ` data-sort-default="descending"` : "") +
          (col.perGame ? ` data-pg` : "") +
          (title ? ` title="${escapeHtml(title)}"` : "") +
          `>${renderLabel(col.label)}` +
          (marked ? `<span class="sca-fs" aria-hidden="true">†</span>` : "") +
          `</th>`
        );
      }),
    )
    .join("");

  return (
    `<thead>` +
    `<tr class="sca-banner">${banner}</tr>` +
    `<tr class="sca-head">` +
    `<th scope="col" class="sca-th-rank"><abbr title="Rank in the table as sorted">#</abbr></th>` +
    `<th scope="col" class="sca-th-player" data-sort-type="text" data-key="playerName">Player</th>` +
    `<th scope="col" class="sca-th-team" data-g="0" data-sort-type="text" data-key="team">Team</th>` +
    cols +
    `</tr>` +
    `</thead>`
  );
}

/**
 * One figure.
 *
 * Deliberately bare: a plain number is `<td>354</td>` and nothing else. The
 * widest table is 319 rows by fifty columns, and the classes and data
 * attributes a cell could carry - its group, its sort value - were two thirds
 * of a 1.1 MB page. The bundle reads the group off the header cell above it,
 * and the sort value off the text (commas stripped). Only the cells whose text
 * is NOT their value say otherwise: a dash, a grade's band, a group's edge.
 */
function renderCell(
  row: StatsRow,
  column: StatsColumn,
  edge: boolean,
  overallKey: string,
): string {
  const value = row.values[column.key];
  const classes: string[] = [];
  if (edge) classes.push("is-edge");

  if (column.isScore) {
    const n = value == null ? Number.NaN : Number(value);
    if (!Number.isFinite(n)) {
      classes.unshift("sca-score", "is-missing");
      return `<td class="${classes.join(" ")}">-</td>`;
    }
    const rounded = Math.round(n);
    classes.unshift("sca-score", `is-${scoreBand(rounded)}`);
    if (column.key === overallKey) classes.push("is-overall");
    return `<td class="${classes.join(" ")}">${rounded}</td>`;
  }

  const text = formatCell(value, column);
  if (text === null) classes.push("is-missing");
  else if (column.type === "string") classes.push("is-text");
  const attr = classes.length > 0 ? ` class="${classes.join(" ")}"` : "";
  return `<td${attr}>${text === null ? "-" : escapeHtml(text)}</td>`;
}

function renderRow(
  row: StatsRow,
  rank: number | null,
  table: StatsTable,
  options: StatsRenderOptions,
): string {
  const cells = table.groups
    .flatMap((group, i) =>
      group.columns.map((col, ci) =>
        renderCell(
          row,
          col,
          ci === group.columns.length - 1 && i < table.groups.length - 1,
          table.overallKey,
        ),
      ),
    )
    .join("");

  const limited = row.qualified
    ? ""
    : ` <abbr class="sca-ls" title="${escapeHtml(table.lsTooltip)}">LS</abbr>`;
  const teamInline = row.team
    ? ` <span class="sca-team-inline">${escapeHtml(row.team)}</span>`
    : "";

  return (
    `<tr class="sca-row"${row.shownByDefault ? "" : " hidden"}` +
    ` data-name="${escapeHtml(row.name.toLowerCase())}"` +
    ` data-team="${escapeHtml(row.team ?? "")}"` +
    ` data-games="${escapeHtml(String(row.values["games"] ?? ""))}"` +
    ` data-snap="${escapeHtml(String(row.values["snapPct"] ?? ""))}"` +
    ` data-att="${escapeHtml(String(row.values["attempts"] ?? ""))}"` +
    ` data-rush="${escapeHtml(String(row.values["rushAttempts"] ?? ""))}"` +
    ` data-tgt="${escapeHtml(String(row.values["targets"] ?? ""))}">` +
    `<td class="sca-rank">${rank ?? ""}</td>` +
    `<th scope="row" class="sca-player">` +
    renderName(row, options, "sca-player-link") +
    teamInline +
    limited +
    `</th>` +
    `<td class="sca-team">${escapeHtml(row.team ?? "")}</td>` +
    cells +
    `</tr>`
  );
}

function renderTable(table: StatsTable, options: StatsRenderOptions): string {
  const shown = table.rows.filter((row) => row.shownByDefault).length;
  let rank = 0;
  const body = table.rows
    .map((row) => renderRow(row, row.shownByDefault ? ++rank : null, table, options))
    .join("");

  const updated = formatDate(table.updatedAt);
  const meta = [
    `<span class="sca-meta-season">${escapeHtml(table.seasonLabel)}</span>`,
    // Shown by the stylesheet while the Per Game switch is on.
    `<span class="sca-meta-mode">Per Game</span>`,
    `<span>${table.rows.length} players</span>`,
    table.weeks !== null
      ? `<span>Weeks ${escapeHtml(table.weeks.replace("-", "–"))}</span>`
      : table.week !== null && table.season !== "all"
        ? `<span>through week ${table.week}</span>`
        : "",
    updated && table.updatedAt
      ? `<span class="sca-meta-updated">Updated <time datetime="${escapeHtml(
          table.updatedAt,
        )}">${escapeHtml(updated)}</time></span>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  const caption =
    `${table.seasonLabel} advanced stats for NFL ${POSITION_PLURALS[table.position]}` +
    (table.weeks !== null ? `, weeks ${table.weeks}` : "") +
    `, with StatChasers grades from 0 to 100. Sorted by overall grade.`;

  // The columns still on weeks 1-18 are marked † in the header; say what † is.
  const fullSeason = table.weeks !== null && table.groups.some((g) => g.columns.some((c) => c.fullSeason))
    ? ` · <span class="sca-fs">†</span> = weeks 1–18 (no week-by-week source)`
    : "";

  return (
    `<section class="sca-section sca-stats" aria-label="Player stats">` +
    `<div class="sca-meta">${meta}</div>` +
    `<div class="sca-scroll">` +
    `<table class="sca-table" data-sca-table>` +
    `<caption class="sca-sr-only">${escapeHtml(caption)}</caption>` +
    renderHead(table) +
    `<tbody>${body}</tbody>` +
    `</table>` +
    `</div>` +
    `<div class="sca-foot">` +
    `<span><span data-sca-count>${shown}</span> player${shown === 1 ? "" : "s"}` +
    ` <span data-sca-sort-hint hidden>· click any column header to sort</span>` +
    ` · <abbr class="sca-ls" title="${escapeHtml(table.lsTooltip)}">LS</abbr> = ${escapeHtml(
      table.lsFooter,
    )}${fullSeason}</span>` +
    `<span class="sca-foot-tag">Advanced Stats · ${table.position} · ${escapeHtml(
      seasonShortLabel(table.season),
    )}</span>` +
    `</div>` +
    `</section>`
  );
}

/* ---------------------------------------------------------------- the page */

/** The season the address opens on, which is the one its copy names. */
function openingSeason(table: StatsTable, options: StatsRenderOptions): number {
  if (typeof options.defaultSeason === "number") return options.defaultSeason;
  return typeof table.season === "number" ? table.season : new Date().getFullYear();
}

function renderIntro(season: number): string {
  return (
    `<div class="sca-intro">` +
    introCopy(season).map((p) => `<p>${escapeHtml(p)}</p>`).join("") +
    `</div>`
  );
}

function renderAdvancedCopy(): string {
  return (
    `<section class="sca-section sca-copy" aria-labelledby="sca-advanced-title">` +
    renderSectionHead(ADVANCED_COPY.label, "sca-advanced-title", ADVANCED_COPY.heading) +
    ADVANCED_COPY.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("") +
    `</section>`
  );
}

/**
 * The questions, as the rankings page prints its own: each a <details> shut
 * by default under one <h2>, the answers in the DOM regardless.
 */
function renderFaq(items: StatsFaq[], options: StatsRenderOptions): string {
  return (
    `<section class="sca-section sca-faq-block" aria-labelledby="sca-faq-title">` +
    renderSectionHead(STATS_FAQ_LABEL, "sca-faq-title", STATS_FAQ_HEADING) +
    `<div class="sca-faq">` +
    items
      .map(
        (entry) =>
          `<details class="sca-faq-item">` +
          `<summary class="sca-faq-q-row"><h3 class="sca-faq-q">${escapeHtml(entry.question)}</h3></summary>` +
          `<p class="sca-faq-a">${escapeHtml(entry.answer)}</p>` +
          `</details>`,
      )
      .join("") +
    `</div>` +
    `</section>` +
    renderFaqSchema(items, options)
  );
}

/**
 * The FAQPage node, or the inert island the plugin builds it from - the
 * two-mode arrangement of rankings-render.ts's renderFaqSchema(), for the
 * reason given there: embedded, Rank Math owns the page's graph, and
 * statchasers-player-stats.php lifts these questions into it and strips the
 * island.
 */
function renderFaqSchema(items: StatsFaq[], options: StatsRenderOptions): string {
  if (options.embed) {
    return (
      `<script type="application/json" class="sca-faq-data">` +
      escapeJsonLd(JSON.stringify(items.map((e) => ({ q: e.question, a: e.answer })))) +
      `</script>`
    );
  }
  return (
    `<script type="application/ld+json">` +
    escapeJsonLd(
      JSON.stringify({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: items.map((e) => ({
          "@type": "Question",
          name: e.question,
          acceptedAnswer: { "@type": "Answer", text: e.answer },
        })),
      }),
    ) +
    `</script>`
  );
}

/**
 * The address's title, H1, description and hero lead, for the WordPress plugin to print
 * - so the plugin keeps no copy of the words and the season in them is the
 * API's. Embedded only; the plugin strips it once read.
 */
function renderMetaIsland(table: StatsTable, options: StatsRenderOptions): string {
  if (!options.embed) return "";
  const season = openingSeason(table, options);
  return (
    `<script type="application/json" class="sca-page-data">` +
    escapeJsonLd(
      JSON.stringify({
        ...statsPageCopy(table.position, season),
        // The intro as one paragraph: the site hero's description, when the
        // plugin prints the hero (it then drops .sca-intro from the fragment).
        lead: introCopy(season).join(" "),
      }),
    ) +
    `</script>`
  );
}

export function renderStatsPage(
  table: StatsTable,
  options: StatsRenderOptions = {},
): string {
  const season = openingSeason(table, options);
  return (
    `<div class="sca${options.embed ? " is-embed" : ""}" data-sca-root="1"` +
    ` data-position="${table.position}"` +
    ` data-season="${escapeHtml(String(table.season))}"` +
    (options.defaultSeason != null
      ? ` data-default-season="${escapeHtml(String(options.defaultSeason))}"`
      : "") +
    (options.endpoint ? ` data-sca-endpoint="${escapeHtml(options.endpoint)}"` : "") +
    `>` +
    // Standalone, the page is this markup and needs its own H1; embedded, the
    // WordPress page prints it (from renderMetaIsland()).
    (options.embed
      ? ""
      : `<h1 class="sca-h1">${escapeHtml(statsPageCopy(table.position, season).h1)}</h1>` +
        `<div class="sca-h1-underline" aria-hidden="true"></div>`) +
    renderIntro(season) +
    renderControls(table, options) +
    // One block, because it is the unit a season switch replaces: the cards
    // can be absent for one season and present for another.
    `<div class="sca-body" data-sca-body>` +
    renderLeaders(table, options) +
    renderTable(table, options) +
    `</div>` +
    renderAdvancedCopy() +
    renderFaq(statsFaq(season), options) +
    renderMetaIsland(table, options) +
    `</div>`
  );
}

export function renderStatsEmpty(options: StatsRenderOptions = {}): string {
  return (
    `<div class="sca${options.embed ? " is-embed" : ""}" data-sca-root="1" data-empty="1">` +
    `<p class="sca-empty">${escapeHtml(
      "Advanced stats are not available for this selection yet.",
    )}</p></div>`
  );
}
