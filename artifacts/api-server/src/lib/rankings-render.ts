/**
 * Markup for the rest-of-season rankings board.
 *
 * Server-only, like team-render.ts, player-render.ts and fpa-render.ts. Every
 * board — all five panels, 230 players, every tier header — is in the response,
 * and client/rankings.ts only takes over the tab strip on top of it.
 *
 * That is the substantive change from the standalone app this came from. There,
 * the panels were React state: the HTML WordPress served was a container, and
 * the names only existed once a bundle had run. Here the panel that is not open
 * is still in the document, which is what makes "Bijan Robinson RB2" something a
 * crawler reads rather than something it would have to execute JavaScript to
 * find.
 *
 * The rules are the other tools':
 *
 * 1. A field we do not have is not rendered. A player the dictionary does not
 *    know keeps his row and loses his team badge and his link, rather than
 *    getting an empty badge or a link to a 404.
 * 2. Nothing predicts. These are the rankings as published, with the date they
 *    were published on; the page does not project, score or update them.
 *
 * And one this board needs specifically:
 *
 * 3. **Rank is positional, and the side-by-side view must not imply otherwise.**
 *    Four columns aligned by rank is a draft-board reading — what am I passing
 *    up at running back to take this receiver — not a claim that QB7 and RB7 go
 *    at the same pick. The caption says which of the two it is, because the
 *    shape of the table invites the wrong one.
 *
 * A note on colour. Tiers are nominal, not ordered: tier 3 is not "more" than
 * tier 2, it is a different group, so the tints are seven distinct hues at one
 * lightness rather than a ramp. They run at ~95% lightness, which keeps every
 * cell's text at its full contrast ratio against the tint and means the colour
 * is doing grouping work only. Every tinted cell also prints its rank, and the
 * tier tables print the tier number in its own column, so nothing here is
 * encoded in colour alone.
 */

import { escapeHtml, escapeJsonLd } from "./render";
import { rankingsHeading, rankingsPageCopy } from "./rankings-seo";
import {
  ALL_VIEW_COLLAPSED_ROWS,
  POSITIONS,
  POSITION_LIMITS,
  POSITION_NAMES,
  POSITION_PLURALS,
  STAT_POSITIONS,
  type AllRow,
  type PositionFilter,
  type RankedPlayer,
  type RankingsBoard,
  type RankingsData,
  type StatPosition,
  type TierGroup,
} from "./rankings/rankings-data";
import {
  RANKINGS_FAQ_HEADING,
  rankingsFaq,
  type RankingsFaq,
} from "./rankings/rankings-faq";
import { rankingsItemLists } from "./rankings/rankings-schema";

export interface RankingsRenderOptions {
  /**
   * Embedded inside a statchasers.com page: drops the standalone chrome,
   * because the host page supplies the H1 and the surrounding copy.
   */
  embed?: boolean;
  /**
   * The page the board lives at, and so where its position tabs point:
   * `<basePath>/rb` and so on. Defaults to this app's own
   * /rest-of-season-rankings.
   */
  basePath?: string;
  /**
   * Where the CSV link hangs, when that is not `basePath`.
   *
   * On a WordPress mount `basePath` is the page, and WordPress has never heard
   * of `/download.csv` under it — so the fragment route passes this app's own
   * origin here, the way the schedule's exports do.
   */
  downloadBase?: string;
  /** Where a player link points. Defaults to this app's own /player/. */
  playerPathPrefix?: string;
  /** Carried onto internal links so embed mode stays embed mode. */
  linkQuery?: string;
  /**
   * Carried onto the position tabs instead, when they need a different rule.
   *
   * The player links and the tabs can point at different hosts: on a
   * WordPress mount the tabs are the page's own addresses, where `?embed=1`
   * is a reserved query var that serves the oEmbed template instead of the
   * page. Defaults to `linkQuery`.
   */
  tabQuery?: string;
  /** Which panel opens first. The tab strip owns this once JS is up. */
  position?: PositionFilter;
  /** Which rankings file to render. The redraft board unless told otherwise. */
  board?: RankingsBoard;
}

/** Each board's own address on this app, which is where its links default to. */
export const RANKINGS_BOARD_PATHS: Record<RankingsBoard, string> = {
  redraft: "/rankings",
  ros: "/rest-of-season-rankings",
};
const DEFAULT_PLAYER_PREFIX = "/player/";

function panelId(position: PositionFilter): string {
  return `scr-panel-${position.toLowerCase()}`;
}

/**
 * A position's own address: the base for All, `<base>/rb` for the rest.
 *
 * The base's trailing slash is the spelling to follow. WordPress page paths
 * carry one and the rewrite rule on that side accepts `/rb/`, so a WordPress
 * base gives `/fantasy-football/rest-of-season-rankings/rb/`; this app's own
 * routes are slashless and give `/rest-of-season-rankings/rb`.
 */
export function rankingsPositionPath(
  base: string,
  position: PositionFilter,
): string {
  if (position === "All") return base;
  const slash = base.endsWith("/") ? "/" : "";
  return `${joinPath(base, `/${position.toLowerCase()}`)}${slash}`;
}

/**
 * The "as of" line, as a `<time>` when we have an ISO form for it.
 *
 * A bare date string is the one a reader wants and the one a machine cannot
 * use; the element gives both without printing the timestamp twice.
 */
function renderUpdated(data: RankingsData): string {
  if (data.updatedAt === "") return "";
  const text = escapeHtml(data.updatedAt);
  return data.updatedAtIso
    ? `<time datetime="${escapeHtml(data.updatedAtIso)}">${text}</time>`
    : text;
}

/* ------------------------------------------------------------- the controls */

/**
 * The position tab strip.
 *
 * Each tab is the position's own address — `/rest-of-season-rankings/rb` —
 * the way the player pages' section bar links `/injury`. With scripting off a
 * tab is an ordinary link to a page the server renders with that panel open;
 * client's wireTabs() upgrades the strip to a real ARIA tablist that switches
 * in place and pushes the address, reading the panel from
 * `data-scr-panel-id`. The roles are deliberately NOT in this markup:
 * `role="tab"` promises arrow-key navigation, and promising it in static HTML
 * that may never get a bundle is worse than the honest list of links.
 */
function renderNav(
  data: RankingsData,
  options: RankingsRenderOptions,
): string {
  const active = options.position ?? "All";
  const base = options.basePath ?? RANKINGS_BOARD_PATHS[data.board];
  const query = options.tabQuery ?? options.linkQuery ?? "";

  const items = POSITIONS.map((position) => {
    const on = position === active;
    const label =
      position === "All"
        ? "All positions"
        : `${POSITION_NAMES[position as StatPosition]}s`;
    // The redraft board's tabs are in-page, as they always were: one page,
    // switched by `:target` with scripting off. Only the rest-of-season board
    // gives each position an address of its own.
    if (data.board === "redraft") {
      return (
        `<li><a class="scr-nav-link${on ? " is-active" : ""}"` +
        ` href="#${panelId(position)}"` +
        ` title="${escapeHtml(label)}">${escapeHtml(position)}</a></li>`
      );
    }
    return (
      `<li><a class="scr-nav-link${on ? " is-active" : ""}"` +
      ` href="${escapeHtml(rankingsPositionPath(base, position) + query)}"` +
      ` data-scr-panel-id="${panelId(position)}"` +
      // The board's heading, for the host page's H1 when a tab switches
      // boards in place — see rankingsHeading().
      ` data-scr-heading="${escapeHtml(rankingsHeading(data.season, position))}"` +
      ` title="${escapeHtml(label)}">${escapeHtml(position)}</a></li>`
    );
  }).join("");

  return (
    `<nav class="scr-nav" aria-label="Rankings by position" data-scr-nav>` +
    `<span class="scr-nav-label">Pos</span>` +
    `<ul class="scr-nav-list">${items}</ul>` +
    `</nav>`
  );
}

/**
 * The scoring format row.
 *
 * One live option. The rankings are maintained in PPR and there is no separate
 * Standard or Half-PPR file, so those two are printed as what they are —
 * unavailable — rather than as buttons that quietly do nothing, which is what
 * the standalone app shipped. They are `<span>`s, not disabled links: there is
 * no URL behind them to disable.
 */
function renderScoring(data: RankingsData): string {
  const options = ["Standard", "Half PPR", "PPR"].map((format) => {
    const on = format.toLowerCase() === data.scoring.toLowerCase();
    return on
      ? `<span class="scr-opt is-active" aria-current="true">${escapeHtml(format)}</span>`
      : `<span class="scr-opt is-off" title="${escapeHtml(
          `These rankings are published in ${data.scoring} only`,
        )}">${escapeHtml(format)}</span>`;
  }).join("");

  return (
    `<div class="scr-scoring">` +
    `<span class="scr-nav-label">Format</span>` +
    `<div class="scr-opts">${options}</div>` +
    `</div>`
  );
}

/**
 * Join a base path to a sub-path without doubling the separator.
 *
 * SC_RANKINGS_PATH is a WordPress page path and WordPress page paths are
 * conventionally written with a trailing slash, so
 * `/fantasy-football/redraft-rankings/` + `/download.csv` would otherwise give
 * `//download.csv` — which a browser resolves as a protocol-relative URL to the
 * host `download.csv`, not as a path on this site. Trimming here rather than
 * asking the operator to write the variable a particular way.
 */
function joinPath(base: string, sub: string): string {
  return `${base.replace(/\/+$/, "")}${sub}`;
}

function renderControls(
  data: RankingsData,
  options: RankingsRenderOptions,
): string {
  const base =
    options.downloadBase ?? options.basePath ?? RANKINGS_BOARD_PATHS[data.board];
  const updated = renderUpdated(data);

  return (
    `<div class="scr-controls">` +
    renderNav(data, options) +
    renderScoring(data) +
    `<a class="scr-csv" href="${escapeHtml(
      joinPath(base, "/download.csv"),
    )}" rel="nofollow" download>Download CSV</a>` +
    `</div>` +
    (updated === ""
      ? ""
      : `<p class="scr-updated">Rankings updated ${updated}</p>`)
  );
}

/* ------------------------------------------------------------ player cells */

/**
 * A player's name, linked to his page when he has one.
 *
 * `target="_top"` for the same reason the FPA team links carry it: the board is
 * sometimes still inside the legacy iframe mount, and a link that opens inside
 * the frame puts a whole player page in a 600px box.
 */
function renderName(
  player: RankedPlayer,
  options: RankingsRenderOptions,
  className: string,
): string {
  const name = escapeHtml(player.name);
  if (!player.slug) return `<span class="${className}">${name}</span>`;

  const prefix = options.playerPathPrefix ?? DEFAULT_PLAYER_PREFIX;
  const query = options.linkQuery ?? "";
  return (
    `<a class="${className}" href="${escapeHtml(
      `${prefix}${player.slug}${query}`,
    )}" target="_top">${name}</a>`
  );
}

function renderTeam(player: RankedPlayer): string {
  return player.team
    ? `<span class="scr-team">${escapeHtml(player.team)}</span>`
    : "";
}

/* --------------------------------------------------- the side-by-side board */

function renderAllCell(
  player: RankedPlayer | null,
  options: RankingsRenderOptions,
): string {
  if (!player) return `<td class="scr-all-cell is-empty"></td>`;

  return (
    `<td class="scr-all-cell" data-tier="${player.tier}">` +
    renderName(player, options, "scr-all-name") +
    renderTeam(player) +
    `</td>`
  );
}

/**
 * The All panel.
 *
 * Every row is in the markup; the collapse is a `<details>` around the tail,
 * not a slice. The standalone app rendered the first fifty and kept the rest in
 * React state, which meant the other 180 players were not on the page at all
 * until someone clicked — the exact thing this rewrite exists to stop. A
 * `<details>` gets the same short first screen while leaving every name in the
 * document, and it opens with scripting off.
 */
function renderAllBoard(
  data: RankingsData,
  options: RankingsRenderOptions,
): string {
  const head =
    `<tr>` +
    `<th scope="col" class="scr-all-th-rank">` +
    `<abbr title="Positional rank">#</abbr></th>` +
    STAT_POSITIONS.map(
      (pos) =>
        `<th scope="col"><abbr title="${escapeHtml(
          `${POSITION_NAMES[pos]} — ranked among ${POSITION_PLURALS[pos]}`,
        )}">${pos}</abbr></th>`,
    ).join("") +
    `</tr>`;

  const row = (entry: AllRow): string =>
    `<tr class="scr-all-row">` +
    `<th scope="row" class="scr-all-rank">${entry.rank}</th>` +
    STAT_POSITIONS.map((pos) => renderAllCell(entry[pos], options)).join("") +
    `</tr>`;

  const head_rows = data.all.slice(0, ALL_VIEW_COLLAPSED_ROWS);
  const tail_rows = data.all.slice(ALL_VIEW_COLLAPSED_ROWS);

  const caption =
    `Quarterback, running back, wide receiver and tight end rankings aligned ` +
    `by positional rank — row 7 is QB7 beside RB7, not a claim that they go at ` +
    `the same pick. ${data.scoring} scoring, ${data.all.length} rows` +
    (data.updatedAt === "" ? "." : `, updated ${data.updatedAt}.`);

  const table = (rows: AllRow[], withHead: boolean): string =>
    `<table class="scr-all-table">` +
    (withHead
      ? `<caption class="scr-sr-only">${escapeHtml(caption)}</caption>` +
        `<colgroup><col /><col span="4" class="scr-all-col" /></colgroup>` +
        `<thead>${head}</thead>`
      : `<caption class="scr-sr-only">${escapeHtml(
          `The remaining ${rows.length} rows of the same board.`,
        )}</caption>` +
        `<colgroup><col /><col span="4" class="scr-all-col" /></colgroup>`) +
    `<tbody>${rows.map(row).join("")}</tbody>` +
    `</table>`;

  return (
    `<div class="scr-card">` +
    `<div class="scr-scroll">${table(head_rows, true)}</div>` +
    (tail_rows.length === 0
      ? ""
      : `<details class="scr-more">` +
        `<summary class="scr-more-summary">` +
        `<span class="scr-more-open">Show all ${data.all.length} rows</span>` +
        `<span class="scr-more-close">Show the top ${ALL_VIEW_COLLAPSED_ROWS}</span>` +
        `</summary>` +
        `<div class="scr-scroll">${table(tail_rows, false)}</div>` +
        `</details>`) +
    `</div>`
  );
}

/* ----------------------------------------------------- the tiered positions */

function renderTierRow(
  player: RankedPlayer,
  index: number,
  options: RankingsRenderOptions,
): string {
  return (
    `<tr class="scr-row${index % 2 === 1 ? " is-alt" : ""}" data-tier="${player.tier}">` +
    `<td class="scr-tier-cell">${player.tier}</td>` +
    `<td class="scr-rank-cell">${player.rank}</td>` +
    // The name is the link, so the anchor text is the thing being linked to.
    `<th scope="row" class="scr-player">` +
    renderName(player, options, "scr-player-link") +
    renderTeam(player) +
    `</th>` +
    renderProfileCta(player, options) +
    `</tr>`
  );
}

/**
 * The "View profile" cell.
 *
 * A second target for the same destination as the name, for a reader who is
 * looking down the right edge of the table for something to click rather than
 * at the names. It is deliberately NOT a second stop for anyone navigating by
 * keyboard or by a screen reader's link list: two links per row, both landing
 * on the same page and the second one labelled generically, is noise in both
 * of those. `tabindex="-1"` and `aria-hidden="true"` leave the row with one
 * announced, focusable link — the name — and give the pointer a bigger one.
 *
 * Rule 1 still holds: a player the dictionary cannot place has no URL, so he
 * gets an empty cell rather than a button that goes nowhere.
 */
function renderProfileCta(
  player: RankedPlayer,
  options: RankingsRenderOptions,
): string {
  if (!player.slug) return `<td class="scr-cta-cell is-empty"></td>`;

  const prefix = options.playerPathPrefix ?? DEFAULT_PLAYER_PREFIX;
  const query = options.linkQuery ?? "";

  return (
    `<td class="scr-cta-cell">` +
    `<a class="scr-cta" href="${escapeHtml(
      `${prefix}${player.slug}${query}`,
    )}" target="_top" tabindex="-1" aria-hidden="true">` +
    `<span class="scr-cta-text">View profile</span>` +
    `<span class="scr-cta-arrow">&rarr;</span>` +
    `</a>` +
    `</td>`
  );
}

function renderPositionBoard(
  position: StatPosition,
  groups: TierGroup[],
  data: RankingsData,
  options: RankingsRenderOptions,
): string {
  const count = groups.reduce((sum, group) => sum + group.players.length, 0);

  if (count === 0) {
    return (
      `<div class="scr-card"><p class="scr-empty">${escapeHtml(
        `No ${POSITION_PLURALS[position]} are ranked in this file.`,
      )}</p></div>`
    );
  }

  // Screen-reader-only, on the same terms as the All board's caption. Depth,
  // scoring and the updated date are all printed above the panels already — the
  // controls carry the format and the date, and the tab strip names the
  // position — so on screen this bar was the third telling. A table still owes
  // its reader a caption, so it is hidden rather than dropped: the one route
  // into this table that does NOT pass the controls is a screen reader landing
  // on the table itself.
  const caption =
    `Top ${Math.min(count, POSITION_LIMITS[position])} ` +
    `${POSITION_PLURALS[position]} by tier, ${data.scoring} scoring` +
    (data.updatedAt === "" ? "." : `, updated ${data.updatedAt}.`);

  // One <tbody> per tier, with the tier header as its rowgroup heading. That is
  // what makes "Tier 3" a boundary a screen reader announces rather than a
  // styled row it reads out as data.
  const bodies = groups
    .map(
      (group) =>
        `<tbody class="scr-tier" data-tier="${group.tier}">` +
        `<tr class="scr-tier-head">` +
        `<th scope="rowgroup" colspan="4">Tier ${group.tier}</th>` +
        `</tr>` +
        group.players
          .map((player, i) => renderTierRow(player, i, options))
          .join("") +
        `</tbody>`,
    )
    .join("");

  return (
    `<div class="scr-card"><div class="scr-scroll">` +
    `<table class="scr-table">` +
    `<caption class="scr-sr-only">${escapeHtml(caption)}</caption>` +
    `<colgroup><col class="scr-col-tier" /><col class="scr-col-rank" /><col />` +
    `<col class="scr-col-cta" /></colgroup>` +
    `<thead><tr>` +
    `<th scope="col">Tier</th>` +
    `<th scope="col">Rank</th>` +
    `<th scope="col" class="scr-th-player">Player</th>` +
    // The column has a name for the row headers to be scoped against; it does
    // not need one on screen, and "Profile" over a column of identical buttons
    // would be the third label for one idea.
    `<th scope="col" class="scr-th-cta"><span class="scr-sr-only">Profile</span></th>` +
    `</tr></thead>` +
    bodies +
    `</table></div></div>`
  );
}

/* --------------------------------------------------------- page assembly */

/**
 * The tier legend.
 *
 * Present because the All board's cells are tinted, and a colour scale with no
 * key is decoration. It names each tier in words as well as in colour, and it
 * sits with the All panel because that is the only board where the tint is the
 * only place the tier appears — the position tables print it in a column.
 */
function renderLegend(data: RankingsData): string {
  const tiers = new Set<number>();
  for (const pos of STAT_POSITIONS) {
    for (const group of data.byPosition[pos]) tiers.add(group.tier);
  }

  const items = Array.from(tiers)
    .sort((a, b) => a - b)
    .map(
      (tier) =>
        `<li class="scr-legend-item">` +
        `<span class="scr-legend-swatch" data-tier="${tier}" aria-hidden="true"></span>` +
        `<span>Tier ${tier}</span></li>`,
    )
    .join("");

  return (
    `<div class="scr-legend-wrap">` +
    `<ul class="scr-legend">${items}</ul>` +
    `<p class="scr-legend-note">${escapeHtml(
      "Tiers are per position: a tier 2 running back and a tier 2 receiver are " +
        "each second-group at their own position, not equals.",
    )}</p>` +
    `</div>`
  );
}

/* --------------------------------------------------------------------- faq */

/**
 * The questions, and the FAQPage built from the same list.
 *
 * Outside the panels, not inside one. The five boards are one page — the tab
 * strip swaps a panel, it does not navigate — so questions that belong to any
 * of them belong to all of them, and a copy per panel would put the same ten
 * questions in the document five times over. It sits after the last panel
 * because that is where a reader who has finished with the board arrives.
 *
 * Each question is its own <details>, shut by default, exactly as the team hub
 * does it and for the same reason: the questions are the index, so they all
 * show, and the answer opens under the one that was actually asked. The block
 * itself never folds. Open state is a browser concern either way — the answers
 * are in the DOM regardless, which is what the FAQPage node describes.
 *
 * The <h2> is safe in both modes. The embed drops the H1 because the WordPress
 * page owns it; an H2 under that page's own heading is where these questions
 * belong in its outline, and the questions take <h3> beneath it.
 */
function renderFaq(data: RankingsData, options: RankingsRenderOptions): string {
  const items = rankingsFaq(data);
  if (items.length === 0) return "";

  const body = items
    .map(
      (entry) =>
        `<details class="scr-faq-item">` +
        `<summary class="scr-faq-q-row">` +
        `<h3 class="scr-faq-q">${escapeHtml(entry.question)}</h3>` +
        `</summary>` +
        `<p class="scr-faq-a">${escapeHtml(entry.answer)}</p>` +
        `</details>`,
    )
    .join("");

  return (
    `<section class="scr-faq-block" aria-labelledby="scr-faq-title">` +
    `<h2 class="scr-faq-title" id="scr-faq-title">${escapeHtml(
      RANKINGS_FAQ_HEADING,
    )}</h2>` +
    `<div class="scr-faq">${body}</div>` +
    `</section>` +
    renderFaqSchema(items, options)
  );
}

/**
 * The FAQPage node, or the inert island the plugin builds it from.
 *
 * Same two-mode arrangement as team-render.ts's faqSchema(), for the reason
 * given at length there: standalone this page owns its document and emits the
 * node itself; embedded, WordPress owns the document and Rank Math owns its
 * graph, so a second <script type="application/ld+json"> arriving from inside a
 * mounted fragment competes with that graph instead of joining it. The island
 * is the same questions as data, and statchasers-rankings.php lifts them into
 * the one <script> the host page already prints, then strips the island.
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
  items: RankingsFaq[],
  options: RankingsRenderOptions,
): string {
  if (items.length === 0) return "";

  if (options.embed) {
    return (
      `<script type="application/json" class="scr-faq-data">` +
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

/**
 * The boards as ItemLists — see rankings/rankings-schema.ts.
 *
 * The same two modes as renderFaqSchema() above: an inert island in an embed,
 * for statchasers-rankings.php to graft into Rank Math's graph and strip, and
 * JSON-LD of its own on the standalone page.
 */
function renderListSchema(
  data: RankingsData,
  options: RankingsRenderOptions,
): string {
  const lists = rankingsItemLists(data, options.position ?? "All");
  if (lists.length === 0) return "";

  if (options.embed) {
    return (
      `<script type="application/json" class="scr-list-data">` +
      escapeJsonLd(JSON.stringify(lists)) +
      `</script>`
    );
  }

  return lists
    .map(
      (node) =>
        `<script type="application/ld+json">` +
        escapeJsonLd(JSON.stringify({ "@context": "https://schema.org", ...node })) +
        `</script>`,
    )
    .join("");
}

export function renderRankingsPage(
  data: RankingsData,
  options: RankingsRenderOptions = {},
): string {
  const active = options.position ?? "All";

  /*
   * Every panel heading is in the document and out of the picture.
   *
   * The filter strip is the heading: the selected chip already says which board
   * is open, so "Wide Receiver rankings" printed under "Wide Receiver" restates
   * the control that put it there. The All panel was hidden on that reasoning
   * from the start and the four position panels now follow it.
   *
   * Hidden, not dropped. It is still an <h2> so each panel keeps its place in
   * the heading outline for anyone navigating by headings rather than by eye,
   * and the section keeps the same text as its accessible name.
   */
  const panel = (
    position: PositionFilter,
    heading: string,
    body: string,
  ): string =>
    `<section class="scr-section${
      position === active ? " is-default is-active" : ""
    }" id="${panelId(position)}" data-scr-panel` +
    ` aria-label="${escapeHtml(heading)}">` +
    `<h2 class="scr-sr-only">${escapeHtml(heading)}</h2>` +
    body +
    `</section>`;

  const panels =
    panel(
      "All",
      "All positions, ranked side by side",
      renderAllBoard(data, options) + renderLegend(data),
    ) +
    STAT_POSITIONS.map((pos) =>
      panel(
        pos,
        `${POSITION_NAMES[pos]} rankings`,
        renderPositionBoard(pos, data.byPosition[pos], data, options),
      ),
    ).join("");

  return (
    `<div class="scr${options.embed ? " is-embed" : ""}" data-scr-root="1"` +
    ` data-scr-board="${data.board}"` +
    ` data-season="${escapeHtml(String(data.season))}"` +
    ` data-scoring="${escapeHtml(data.scoring)}">` +
    renderControls(data, options) +
    panels +
    renderFaq(data, options) +
    renderListSchema(data, options) +
    renderMetaIsland(data, options) +
    `</div>`
  );
}

/**
 * The title, H1 and description of the board this fragment opens on, as an
 * inert island the WordPress plugin reads and strips — player-stats-render.ts
 * ships the same thing as `sca-page-data`. Embedded only: standalone, they are
 * already in the page's own <head>.
 */
function renderMetaIsland(
  data: RankingsData,
  options: RankingsRenderOptions,
): string {
  // The redraft page keeps the title and heading its editor gave it.
  if (!options.embed || data.board !== "ros") return "";
  return (
    `<script type="application/json" class="scr-page-data">` +
    escapeJsonLd(JSON.stringify(rankingsPageCopy(data, options.position ?? "All"))) +
    `</script>`
  );
}

/**
 * The board when there is no rankings file.
 *
 * An honest empty state rather than five empty tables, and it says what is
 * missing — because the only person who ever sees this is whoever is setting
 * the tool up. Readers never reach it: the shortcode renders nothing at all in
 * that case and leaves the host page intact.
 */
export function renderRankingsEmpty(
  options: RankingsRenderOptions = {},
): string {
  return (
    `<div class="scr${options.embed ? " is-embed" : ""}" data-scr-root="1" data-empty="1">` +
    `<p class="scr-empty">${escapeHtml(
      "No rest-of-season rankings have been published yet. Add a " +
        "data/rankings/redraft-<season>.csv file.",
    )}</p></div>`
  );
}

/** The boards as CSV, matching what is on screen exactly. */
export function renderRankingsCsv(data: RankingsData): string {
  const quote = (value: string | number): string => {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const lines = STAT_POSITIONS.flatMap((pos) =>
    data.byPosition[pos].flatMap((group) =>
      group.players.map((player) =>
        [player.position, player.rank, player.tier, player.name, player.team ?? ""]
          .map(quote)
          .join(","),
      ),
    ),
  );

  return [
    ["Position", "Rank", "Tier", "Player", "Team"].join(","),
    ...lines,
  ].join("\n");
}
