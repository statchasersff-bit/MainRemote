/**
 * Shared markup renderer — the single source of truth for the news list HTML.
 *
 * This module is compiled into BOTH bundles: the Node server (which renders the
 * initial page/fragment server-side) and the browser client (which re-renders
 * after a background refresh). Because both sides run the same code, the
 * server-rendered DOM and any client re-render are byte-identical, so hydration
 * is a no-op rather than a teardown-and-rebuild.
 *
 * Hard constraint: NOTHING in this file may touch Node APIs or the DOM, and it
 * must be deterministic. In particular, no `Date.now()` and no locale/timezone
 * defaults — a server/client disagreement there is exactly what makes SSR
 * markup flicker on hydration. Timestamps are formatted in a fixed timezone and
 * carried in `datetime`/`data-ts`, and the client upgrades them to a relative
 * "3 hours ago" label after load.
 */

export interface NewsItem {
  id: string;
  title: string;
  link?: string | null;
  pubDate?: string | null;
  pubDateMs?: number | null;
  playerName?: string | null;
  image?: string | null;
  summary?: string | null;
  source?: string | null;
  /** Lowercase team abbreviation (e.g. "buf"), resolved server-side. */
  team?: string | null;
}

/** Cards shown per page once JavaScript takes over pagination. */
export const DEFAULT_PAGE_SIZE = 4;

/** The heading that introduces the tool. The host page keeps its own H1. */
export const SECTION_HEADING = "Latest NFL Player News";

/**
 * Primary brand color per NFL team, keyed by Sleeper's lowercase abbreviation.
 * Tints each card's headshot square instead of a single navy for all.
 */
export const TEAM_COLORS: Record<string, string> = {
  ari: "#97233F", atl: "#A71930", bal: "#241773", buf: "#00338D",
  car: "#0085CA", chi: "#0B162A", cin: "#FB4F14", cle: "#311D00",
  dal: "#041E42", den: "#FB4F14", det: "#0076B6", gb: "#203731",
  hou: "#03202F", ind: "#002C5F", jax: "#006778", kc: "#E31837",
  lac: "#0080C6", lar: "#003594", lv: "#101820", mia: "#008E97",
  min: "#4F2683", ne: "#002244", no: "#101820", nyg: "#0B2265",
  nyj: "#125740", phi: "#004C54", pit: "#101820", sea: "#002244",
  sf: "#AA0000", tb: "#D50A0A", ten: "#0C2340", was: "#5A1414",
};

/** Secondary/accent color per team, used for the strip along the photo's edge. */
export const TEAM_ACCENTS: Record<string, string> = {
  ari: "#FFB612", atl: "#A5ACAF", bal: "#9E7C0C", buf: "#C60C30",
  car: "#BFC0BF", chi: "#C83803", cin: "#000000", cle: "#FF3C00",
  dal: "#869397", den: "#002244", det: "#B0B7BC", gb: "#FFB612",
  hou: "#A71930", ind: "#FFFFFF", jax: "#D7A22A", kc: "#FFB81C",
  lac: "#FFC20E", lar: "#FFD100", lv: "#A5ACAF", mia: "#FC4C02",
  min: "#FFC62F", ne: "#C60C30", no: "#D3BC8D", nyg: "#A71930",
  nyj: "#FFFFFF", phi: "#A5ACAF", pit: "#FFB612", sea: "#69BE28",
  sf: "#B3995D", tb: "#FF7900", ten: "#4B92DB", was: "#FFB612",
};

/**
 * Full team names, keyed by the same lowercase abbreviation. Used as anchor
 * text: "Philadelphia Eagles" is a descriptive, crawlable link label in a way
 * that "PHI" is not.
 */
export const TEAM_NAMES: Record<string, string> = {
  ari: "Arizona Cardinals", atl: "Atlanta Falcons", bal: "Baltimore Ravens",
  buf: "Buffalo Bills", car: "Carolina Panthers", chi: "Chicago Bears",
  cin: "Cincinnati Bengals", cle: "Cleveland Browns", dal: "Dallas Cowboys",
  den: "Denver Broncos", det: "Detroit Lions", gb: "Green Bay Packers",
  hou: "Houston Texans", ind: "Indianapolis Colts", jax: "Jacksonville Jaguars",
  kc: "Kansas City Chiefs", lac: "Los Angeles Chargers", lar: "Los Angeles Rams",
  lv: "Las Vegas Raiders", mia: "Miami Dolphins", min: "Minnesota Vikings",
  ne: "New England Patriots", no: "New Orleans Saints", nyg: "New York Giants",
  nyj: "New York Jets", phi: "Philadelphia Eagles", pit: "Pittsburgh Steelers",
  sea: "Seattle Seahawks", sf: "San Francisco 49ers", tb: "Tampa Bay Buccaneers",
  ten: "Tennessee Titans", was: "Washington Commanders",
};

export function teamLogoUrl(team: string | null | undefined): string | null {
  return team ? `https://sleepercdn.com/images/team_logos/nfl/${team}.png` : null;
}

/**
 * URL templates for turning entity names already shown in the tool into real
 * internal links.
 *
 * Both are empty by default and must be opted into, because we cannot verify
 * from here that the target pages exist — linking every player name to a
 * profile page that 404s would be worse than not linking at all.
 *
 * Placeholders: `{slug}` (kebab-cased name) and, for teams, `{team}` (the
 * lowercase abbreviation).
 */
export interface LinkTemplates {
  /** e.g. "/nfl/players/{slug}" */
  playerUrl?: string;
  /** e.g. "/nfl/teams/{slug}" or "/nfl/teams/{team}" */
  teamUrl?: string;
}

/** Kebab-case a name for use in a URL path. Deterministic and ASCII-only. */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    // Strip combining marks so "Ekelér" -> "ekeler" rather than dropping them
    // into the non-alphanumeric bucket below.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Only allow URLs we're willing to put in an href. Same-site paths are the
 * normal case here; protocol-relative and scheme URLs other than http(s) are
 * rejected so a bad template can't inject `javascript:`.
 */
export function safeInternalUrl(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  // A single leading slash: site-root-relative. "//host" is protocol-relative
  // and points off-site, so it isn't treated as internal.
  if (/^\/(?!\/)/.test(raw)) return raw;
  return null;
}

function applyTemplate(
  template: string | undefined,
  values: Record<string, string>,
): string | null {
  if (!template) return null;
  const filled = template.replace(/\{(\w+)\}/g, (_match, key: string) =>
    encodeURIComponent(values[key] ?? ""),
  );
  // A template whose placeholder resolved to nothing yields a URL pointing at a
  // parent path — drop it rather than linking somewhere arbitrary.
  if (/\/\/$|\/$/.test(filled) && Object.values(values).some((v) => !v)) {
    return null;
  }
  return safeInternalUrl(filled);
}

/** Internal profile URL for a player, or null when not configured. */
export function playerUrl(
  name: string | null | undefined,
  links: LinkTemplates | undefined,
): string | null {
  const slug = slugify(name ?? "");
  if (!slug) return null;
  return applyTemplate(links?.playerUrl, { slug });
}

/** Internal page URL for a team, or null when not configured. */
export function teamUrl(
  team: string | null | undefined,
  links: LinkTemplates | undefined,
): string | null {
  if (!team) return null;
  const name = TEAM_NAMES[team];
  if (!name) return null;
  return applyTemplate(links?.teamUrl, { slug: slugify(name), team });
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] as string,
  );
}

/**
 * Only allow URLs we're willing to put in an href/src. Feed data is third-party,
 * so a `javascript:` link must never survive into the markup.
 */
export function safeUrl(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  return null;
}

/**
 * The form a name is matched in: lowercase, unaccented, punctuation folded to
 * spaces. Rendered onto each card as `data-player` and applied to whatever the
 * reader types, so "jamarr" finds "Ja'Marr" and "andre" finds "André" without
 * the filter having to know about either spelling.
 */
export function searchKey(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    // Combining marks, i.e. the accents that NFD just split off.
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * A stable, human-readable date. Rendered in a fixed timezone (US Eastern, the
 * league's own) so the server and the client never disagree about the string —
 * a locale-dependent format would differ per visitor and break SSR caching.
 */
export function formatAbsoluteDate(ms: number): string {
  // en-US parts in a pinned zone; the pieces are reassembled by hand so the
  // output format can't drift between Node and browser ICU builds.
  const d = new Date(ms);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);

  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";

  const month = MONTHS[Number(get("month")) - 1] ?? "";
  const dayPeriod = get("dayPeriod").toUpperCase();
  return `${month} ${get("day")}, ${get("year")} ${get("hour")}:${get("minute")} ${dayPeriod} ET`;
}

/** Epoch-ms for an item, preferring the pre-parsed column. */
export function itemTimestamp(item: NewsItem): number | null {
  if (typeof item.pubDateMs === "number" && !Number.isNaN(item.pubDateMs)) {
    return item.pubDateMs;
  }
  if (item.pubDate) {
    const parsed = Date.parse(item.pubDate);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

export interface RenderCardOptions {
  /** Zero-based page this card belongs to; drives lazy-loading and paging. */
  pageIndex: number;
  /** When configured, player/team names become internal links. */
  links?: LinkTemplates;
  /** True for the single most likely LCP image (the first card's headshot). */
  lcpCandidate?: boolean;
}

/**
 * The player/team byline.
 *
 * These names are already on the card — this only upgrades them to links when
 * the site actually has somewhere to point them. The anchor text is the name
 * itself ("DeVonta Smith", "Philadelphia Eagles"), which is exactly the
 * descriptive, crawlable text a link should carry.
 */
function renderByline(
  playerName: string,
  team: string | null,
  links: LinkTemplates | undefined,
): string {
  const parts: string[] = [];

  if (playerName) {
    const href = playerUrl(playerName, links);
    parts.push(
      href
        ? `<a class="sc-entity-link" href="${escapeHtml(href)}">${escapeHtml(playerName)}</a>`
        : escapeHtml(playerName),
    );
  }

  const teamName = team ? TEAM_NAMES[team] : null;
  if (teamName) {
    const href = teamUrl(team, links);
    parts.push(
      href
        ? `<a class="sc-entity-link" href="${escapeHtml(href)}">${escapeHtml(teamName)}</a>`
        : escapeHtml(teamName),
    );
  }

  if (parts.length === 0) return "";

  return (
    `<p class="sc-card-player">` +
    parts.join(`<span class="sc-byline-sep" aria-hidden="true"> &middot; </span>`) +
    `</p>`
  );
}

/**
 * One news item as a self-contained <article>.
 *
 * The headline is a real <h3> containing the only <a> in the card, rather than
 * an <a> wrapping the whole card: that gives assistive tech (and crawlers) a
 * meaningful link name instead of an entire card's worth of text. Full-card
 * clickability is restored in CSS with a stretched-link overlay.
 */
export function renderCard(item: NewsItem, options: RenderCardOptions): string {
  const { pageIndex, links } = options;

  const link = safeUrl(item.link);
  const image = safeUrl(item.image);
  const rawPlayerName = (item.playerName ?? "").trim();
  const playerName = escapeHtml(rawPlayerName);
  const title = escapeHtml(item.title);
  const summary = item.summary ? escapeHtml(item.summary) : "";
  const source = escapeHtml(item.source || "Dynasty Command");

  const ts = itemTimestamp(item);
  const timeHtml = ts
    ? `<time class="sc-chip" datetime="${escapeHtml(new Date(ts).toISOString())}" data-ts="${ts}">${escapeHtml(formatAbsoluteDate(ts))}</time>`
    : "";

  // Cards on the first page are visible immediately, so they load eagerly;
  // everything behind the pager is lazy. All of it is in the HTML either way,
  // as a plain <img src> — discoverable by the preload scanner without running
  // JavaScript, and indexable in a way a CSS background image would not be.
  //
  // The very first card's headshot is the likeliest LCP element, so it also
  // gets fetchpriority="high" to jump the queue. Marking more than one would
  // just dilute the signal.
  const isLcpCandidate = options.lcpCandidate === true;
  const loading = pageIndex === 0 ? "eager" : "lazy";
  const priority = isLcpCandidate ? ` fetchpriority="high"` : "";
  const decoding = isLcpCandidate ? "sync" : "async";
  const mediaInner = image
    ? `<img class="sc-card-photo" src="${escapeHtml(image)}" alt="${playerName}" width="108" height="108" loading="${loading}" decoding="${decoding}"${priority} />`
    : // No headshot for this player: the badge shows the StatChasers logo,
      // painted by styles.css as a background rather than an <img>. The mark is
      // decoration standing in for a missing photo, not content — so it stays
      // out of the accessibility tree and out of the image index, and the URL
      // resolves against the stylesheet's own origin, which is the tool server
      // in both mounts. An <img> here would need the origin threaded through
      // every render path just to avoid pointing at the host site.
      `<span class="sc-card-photo-fallback" aria-hidden="true"></span>`;

  const team = item.team ?? null;
  const logo = teamLogoUrl(team);
  const color = team ? TEAM_COLORS[team] : null;
  const accent = team ? TEAM_ACCENTS[team] : null;

  const styleParts: string[] = [];
  if (logo) styleParts.push(`--sc-team-logo:url('${logo}')`);
  if (color) styleParts.push(`--sc-team-color:${color}`);
  if (accent) styleParts.push(`--sc-team-accent:${accent}`);
  const styleAttr = styleParts.length
    ? ` style="${escapeHtml(styleParts.join(";"))}"`
    : "";

  const cardClass = logo ? "sc-card has-team-logo" : "sc-card";

  const headline = link
    ? `<a class="sc-card-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${title}</a>`
    : title;

  return (
    `<article class="${cardClass}"${styleAttr}>` +
    `<div class="sc-card-media">${mediaInner}</div>` +
    `<div class="sc-card-body">` +
    `<div class="sc-card-toprow">` +
    `<span class="sc-card-label">Player News</span>` +
    timeHtml +
    `</div>` +
    `<h3 class="sc-card-name">${headline}</h3>` +
    renderByline(rawPlayerName, team, links) +
    (summary ? `<p class="sc-card-summary">${summary}</p>` : "") +
    `<p class="sc-card-cta"><span class="sc-card-source">${source}</span>` +
    (link ? `<span class="sc-card-more">Read article <span aria-hidden="true">&rarr;</span></span>` : "") +
    `</p>` +
    `</div>` +
    `</article>`
  );
}

export interface RenderListOptions {
  pageSize?: number;
  links?: LinkTemplates;
}

/**
 * A cheap fingerprint of the rendered data.
 *
 * The server stamps it onto the list and the client recomputes it from each
 * refresh payload. When they match there is nothing to redraw, which spares the
 * main thread from rebuilding hundreds of cards every couple of minutes — the
 * single largest task this tool can run, and one that would otherwise land in
 * the middle of someone's interaction and wreck INP.
 */
export function itemsSignature(items: NewsItem[]): string {
  return items
    .map((item) => `${item.id}:${item.pubDateMs ?? 0}:${item.summary ? 1 : 0}`)
    .join(",");
}

/**
 * The full list — EVERY item, not just the first page.
 *
 * Pagination is a display concern applied on top of complete markup: the list
 * carries `data-paged="1"` so the stylesheet hides pages after the first, and
 * the client only toggles that visibility. Nothing is fetched or built in
 * response to a click, so a crawler that never clicks still receives every
 * headline, player, timestamp, and link in the initial HTML response.
 */
export function renderList(
  items: NewsItem[],
  options: RenderListOptions = {},
): string {
  const pageSize = Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE);

  if (items.length === 0) {
    return `<p class="sc-empty">No player news has been archived yet.</p>`;
  }

  const cards = items
    .map((item, index) => {
      const pageIndex = Math.floor(index / pageSize);
      return (
        // data-player/data-team are what the filters read. Matching an
        // attribute keeps the work off the rendered text, so filtering never
        // has to walk into a card or care how the byline is marked up.
        `<li class="sc-card-item" data-page="${pageIndex}"` +
        ` data-player="${escapeHtml(searchKey(item.playerName))}"` +
        (item.team ? ` data-team="${escapeHtml(item.team)}"` : "") +
        `>` +
        renderCard(item, {
          pageIndex,
          ...(index === 0 ? { lcpCandidate: true } : {}),
          ...(options.links ? { links: options.links } : {}),
        }) +
        `</li>`
      );
    })
    .join("");

  const pages = Math.max(1, Math.ceil(items.length / pageSize));

  // The list reserves height for exactly one page up front, so neither
  // hydration nor a page change can resize the container and shift whatever
  // sits below it. Without this the list collapses from all-items-tall to
  // one-page-tall the moment the client paginates — a large layout shift on
  // every first load.
  const reservedRows = Math.min(pageSize, items.length);

  return (
    `<ol id="newsList" class="news-list" data-paged="1" data-page-size="${pageSize}" data-total="${items.length}"` +
    ` data-sig="${escapeHtml(itemsSignature(items))}"` +
    ` style="--sc-reserved-rows:${reservedRows}">` +
    cards +
    `</ol>` +
    renderPager(0, pages) +
    // Without JavaScript the pager can't work, so reveal every page instead of
    // stranding the reader on page 1 behind a button that does nothing.
    `<noscript><style>.news-list[data-paged] .sc-card-item{display:block!important}.sc-pager{display:none!important}</style></noscript>`
  );
}

/**
 * Team dropdown + player search.
 *
 * Deliberately NOT wrapped in a <form>: a form with no action submits to the
 * current URL, so one Enter keypress in the search box would reload the page
 * with a query string attached and hand crawlers a duplicate URL — the exact
 * thing the canonical work exists to prevent. These are bare controls whose
 * state lives in the DOM, filtering cards that are already on the page. Nothing
 * here fetches, and nothing here writes to the URL.
 *
 * Ships `hidden` like the pager: without JavaScript the controls cannot filter
 * anything, and a dead dropdown is worse than none. The <noscript> block in
 * renderList reveals every card in that case.
 *
 * The dropdown lists only teams that actually appear in the rendered items —
 * filtering is DOM-only, so an option for a team with no cards could only ever
 * produce an empty list.
 */
export function renderFilters(items: NewsItem[]): string {
  const teams = Array.from(
    new Set(items.map((item) => item.team).filter((t): t is string => !!t)),
  )
    .map((code) => ({ code, name: TEAM_NAMES[code] ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const options = [`<option value="">All teams</option>`]
    .concat(
      teams.map(
        (t) =>
          `<option value="${escapeHtml(t.code)}">${escapeHtml(t.name)}</option>`,
      ),
    )
    .join("");

  return (
    `<div class="sc-filters" hidden>` +
    `<label class="sc-filter">` +
    `<span class="sc-filter-label">Search players</span>` +
    `<input id="scFilterPlayer" class="sc-filter-input" type="search"` +
    ` placeholder="Player name" autocomplete="off" />` +
    `</label>` +
    `<label class="sc-filter">` +
    `<span class="sc-filter-label">Team</span>` +
    `<select id="scFilterTeam" class="sc-filter-select">${options}</select>` +
    `</label>` +
    // Announces the result count to screen readers as the filters change, and
    // gives everyone else a plain "showing N of M" they can trust.
    `<p class="sc-filter-status" role="status"></p>` +
    `</div>`
  );
}

/**
 * The pager. Rendered server-side but `hidden` until the client un-hides it —
 * see renderList: with no JS every page is visible and a pager is meaningless.
 */
export function renderPager(currentPage: number, totalPages: number): string {
  if (totalPages <= 1) return "";
  return (
    `<nav id="pager" class="sc-pager" aria-label="News pagination" hidden>` +
    `<button type="button" class="sc-pager-btn" data-dir="prev"${currentPage === 0 ? " disabled" : ""}>&larr; Prev</button>` +
    `<span class="sc-pager-status" role="status">${currentPage + 1} <span>of</span> ${totalPages}</span>` +
    `<button type="button" class="sc-pager-btn" data-dir="next"${currentPage >= totalPages - 1 ? " disabled" : ""}>Next &rarr;</button>` +
    `</nav>`
  );
}

/**
 * "Last updated" stamp.
 *
 * Reflects a real change to the archive's contents, not the time this response
 * was generated — see lib/freshness.ts. A date that moves on every page view is
 * a freshness lie, and a `lastmod` derived from one is worthless.
 */
export function renderUpdatedStamp(updatedAtMs: number | null | undefined): string {
  if (typeof updatedAtMs !== "number" || !(updatedAtMs > 0)) return "";
  return (
    `<p class="sc-updated">Last updated ` +
    `<time datetime="${escapeHtml(new Date(updatedAtMs).toISOString())}" data-ts="${updatedAtMs}">` +
    `${escapeHtml(formatAbsoluteDate(updatedAtMs))}</time></p>`
  );
}

/** A crawlable link to another page, with its own descriptive anchor text. */
export interface RelatedLink {
  label: string;
  href: string;
}

/**
 * Links out to other tools/pages.
 *
 * Plain `<a href>` with concise descriptive text — "Fantasy Football Strength
 * of Schedule" rather than "click here" — so the target is discoverable and the
 * anchor says what it is. Rendered server-side; there is no JS-only navigation
 * anywhere in this tool.
 */
export function renderRelatedLinks(
  links: RelatedLink[],
  heading = "More fantasy football tools",
): string {
  const items = links
    .map((link) => {
      const href = safeInternalUrl(link.href);
      const label = (link.label ?? "").trim();
      if (!href || !label) return "";
      return `<li><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></li>`;
    })
    .filter(Boolean)
    .join("");

  if (!items) return "";

  return (
    `<nav class="sc-related" aria-label="${escapeHtml(heading)}">` +
    `<h2 class="sc-related-heading">${escapeHtml(heading)}</h2>` +
    `<ul class="sc-related-list">${items}</ul>` +
    `</nav>`
  );
}

export interface RenderFragmentOptions extends RenderListOptions {
  /** Origin the client bundle should call for refreshes (cross-origin mount). */
  origin?: string;
  /** Set false to omit the section heading (host page supplies its own). */
  heading?: boolean;
  /**
   * Text for the section heading. Overridable so the tool's H2 can be worded to
   * agree with the host page's H1 and <title> — Google may draw the displayed
   * result title from any of them, so they should not contradict each other.
   */
  headingText?: string;
  /**
   * Item cap this fragment was rendered with. Carried into the markup so a
   * background refresh asks for the same number of items — otherwise a page
   * configured with limit="30" would quietly grow to the server default.
   */
  limit?: number;
  /** Crawlable links to other tools, rendered below the list. */
  relatedLinks?: RelatedLink[];
  /** Heading for the related-links block. */
  relatedHeading?: string;
  /**
   * Epoch ms the content last materially changed. Rendered as a visible
   * "Last updated" stamp. Must reflect a real change to the data — see
   * lib/freshness.ts — never the time the page happened to be served.
   */
  updatedAtMs?: number | null;
  /** Endpoint for real-user Core Web Vitals reports. Omit to disable entirely. */
  vitalsEndpoint?: string;
  /** URL of the host page, so framed metrics attach to the ranked URL. */
  pageUrl?: string;
}

/**
 * The complete embeddable fragment: root container + heading + list + pager.
 * This is what the WordPress plugin drops straight into the page body, and what
 * the standalone app puts inside its own <body>.
 */
export function renderFragment(
  items: NewsItem[],
  options: RenderFragmentOptions = {},
): string {
  const { origin, heading = true } = options;
  const originAttr = origin ? ` data-sc-origin="${escapeHtml(origin)}"` : "";
  const pageSize = Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE);
  const limitAttr =
    typeof options.limit === "number" && options.limit > 0
      ? ` data-sc-limit="${Math.floor(options.limit)}"`
      : "";

  // The link templates travel with the markup so a client re-render rebuilds
  // the same anchors the server did, rather than silently dropping them.
  const links = options.links;
  const linkAttrs =
    (links?.playerUrl ? ` data-sc-player-url="${escapeHtml(links.playerUrl)}"` : "") +
    (links?.teamUrl ? ` data-sc-team-url="${escapeHtml(links.teamUrl)}"` : "");

  const vitalsAttrs =
    (options.vitalsEndpoint
      ? ` data-sc-vitals-endpoint="${escapeHtml(options.vitalsEndpoint)}"`
      : "") +
    (options.pageUrl ? ` data-sc-page-url="${escapeHtml(options.pageUrl)}"` : "");

  return (
    `<div class="statchasers-news" data-sc-root="1"${originAttr} data-sc-page-size="${pageSize}"${limitAttr}${linkAttrs}${vitalsAttrs}>` +
    (heading
      ? `<h2 class="sc-section-heading">${escapeHtml(options.headingText || SECTION_HEADING)}</h2>`
      : "") +
    renderUpdatedStamp(options.updatedAtMs) +
    // Outside renderList on purpose: a background refresh replaces the list and
    // pager wholesale, and the reader's half-typed search and chosen team must
    // survive that.
    (items.length > 0 ? renderFilters(items) : "") +
    renderList(items, {
      pageSize,
      ...(links ? { links } : {}),
    }) +
    // Shown by the client when the filters exclude everything. Rendered here,
    // hidden, rather than created on demand so the message is one string in one
    // place instead of markup built in the browser.
    (items.length > 0
      ? `<p class="sc-empty sc-no-matches" hidden>No player news matches those filters.</p>`
      : "") +
    (options.relatedLinks?.length
      ? renderRelatedLinks(options.relatedLinks, options.relatedHeading)
      : "") +
    `</div>`
  );
}
