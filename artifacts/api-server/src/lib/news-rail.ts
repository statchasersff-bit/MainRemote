/**
 * The compact news rail (mak, 2026-11-17): the Fantasy Feed's latest stories
 * as a vertical sidebar list for the homepage, `[statchasers_news
 * layout="rail" limit="6"]`.
 *
 * A second VIEW of the same feed, never a second pipeline: the rows are the
 * same NewsItems /api/news serves the full feed, with the same links, times,
 * images and attribution. What the rail leaves out is the full feed's
 * furniture - excerpts, team watermarks, date badges, filters, pager.
 *
 * Shared by the server (GET /embed/ssr?layout=rail) and the rail's own small
 * client bundle (src/client/news-rail.ts), which refreshes the rows and keeps
 * the relative times honest on a page the edge may hold for days. Pure
 * string building, safe in both.
 *
 * Everything is scoped under `.sc-rail` (public/news-rail.css), so nothing
 * here can reach the full feed's cards, and the full feed's stylesheet and
 * script are never needed for it.
 */

import {
  TEAM_COLORS,
  TEAM_NAMES,
  escapeHtml,
  formatAbsoluteDate,
  isXItem,
  itemTimestamp,
  safeUrl,
  teamLogoAssetUrl,
  type NewsItem,
} from "./render";
import { categoryLabel } from "./news-category";
import { headshotSources, imageKeyFor } from "./image-urls";

/** Rows per page when the shortcode does not say; and the bounds it may say. */
export const RAIL_DEFAULT_LIMIT = 6;
export const RAIL_MIN_LIMIT = 3;
export const RAIL_MAX_LIMIT = 10;
/**
 * Pages a reader can step through with Prev / Next (mak, 2026-11-17: no
 * View All link; paging, five pages of six by default).
 */
export const RAIL_DEFAULT_PAGES = 5;
export const RAIL_MIN_PAGES = 1;
export const RAIL_MAX_PAGES = 10;

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function clampRailLimit(value: unknown): number {
  return clampInt(value, RAIL_DEFAULT_LIMIT, RAIL_MIN_LIMIT, RAIL_MAX_LIMIT);
}

export function clampRailPages(value: unknown): number {
  return clampInt(value, RAIL_DEFAULT_PAGES, RAIL_MIN_PAGES, RAIL_MAX_PAGES);
}

export interface RailOptions {
  /** The tool server's origin, for image URLs (absolute in the WordPress mount). */
  origin?: string;
  /** Where the browser refreshes the rows from, when not the origin (the WordPress proxy). */
  apiBase?: string;
  /** Rows per page. */
  limit: number;
  /** Pages of `limit` rows the reader can step through. */
  pages: number;
  /** The rail's heading text. */
  heading?: string;
  /** Render time, for the client's "is this copy stale?" check. */
  renderedMs?: number;
}

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "35m ago" / "2h ago" for a story under a day old, else null and the
 * compact date stands. Read by the client only: the server cannot print a
 * relative time into a page the edge may serve for days.
 */
export function railRelativeLabel(ts: number, now = Date.now()): string | null {
  const diff = now - ts;
  if (diff < 0 || diff >= DAY_MS) return null;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

/**
 * "Nov 5": the rail's compact date (mak, 2026-11-17: keep the meta line
 * short). The full timestamp rides on the <time> element (datetime + title).
 */
export function railShortDate(ms: number): string {
  const m = /^(\w+ \d+), \d{4} /.exec(formatAbsoluteDate(ms));
  return m ? m[1]! : formatAbsoluteDate(ms);
}

/** One story: thumbnail, headline (the link), and one meta line. `page` is 1-based; rows off the shown page are `hidden`. */
export function renderRailItem(item: NewsItem, origin = "", eager = false, page = 1, shown = 1): string {
  const link = safeUrl(item.link);
  const title = escapeHtml(item.title);
  const who = escapeHtml((item.playerName ?? "").trim());
  const loading = eager ? "eager" : "lazy";

  const image = safeUrl(item.image);
  const imageKey = item.imageKey ?? imageKeyFor(image);
  let thumb: string;
  if (imageKey && item.imageVersion !== null) {
    const photo = headshotSources(imageKey, item.imageVersion, origin);
    thumb =
      `<img class="sc-rail-photo" src="${escapeHtml(photo.src)}" srcset="${escapeHtml(photo.srcset)}"` +
      ` sizes="52px" alt="${who}" width="52" height="52" loading="${loading}" decoding="async" />`;
  } else if (image && !imageKey) {
    thumb = `<img class="sc-rail-photo" src="${escapeHtml(image)}" alt="${who}" width="52" height="52" loading="${loading}" decoding="async" />`;
  } else {
    thumb = `<span class="sc-rail-photo-fallback" aria-hidden="true"></span>`;
  }

  // The meta line: who it is about (team), what kind of story, and when. An
  // X post's attribution is its author, as on the full feed's cards.
  const team = item.team ?? null;
  const teamName = team ? TEAM_NAMES[team] : null;
  const crest = teamLogoAssetUrl(team, origin);
  const color = team ? TEAM_COLORS[team] : null;
  // One editorial meta line (mak, 2026-11-17): CATEGORY · TEAM · date.
  // Each piece is one unbreakable unit; the separators are drawn by CSS
  // after each unit but the last, so a narrow column wraps between pieces,
  // never inside one, and no line starts with a stray dot. An X post's author takes the
  // team's slot: on a post, the reporter is the attribution.
  const parts: string[] = [
    `<span class="sc-rail-m sc-rail-cat">${escapeHtml(categoryLabel(item.category))}</span>`,
  ];
  if (isXItem(item) && item.authorHandle) {
    parts.push(`<span class="sc-rail-m sc-rail-by">@${escapeHtml(item.authorHandle)}</span>`);
  } else if (teamName && team) {
    parts.push(`<abbr class="sc-rail-m sc-rail-team" title="${escapeHtml(teamName)}">${escapeHtml(team.toUpperCase())}</abbr>`);
  }
  const ts = itemTimestamp(item);
  if (ts) {
    parts.push(
      `<time class="sc-rail-m sc-rail-time" datetime="${escapeHtml(new Date(ts).toISOString())}" data-ts="${ts}" title="${escapeHtml(formatAbsoluteDate(ts))}">${escapeHtml(railShortDate(ts))}</time>`,
    );
  }

  const headline = link
    ? `<a class="sc-rail-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${title}</a>`
    : title;

  return (
    `<li class="sc-rail-item" data-page="${page}"${page === shown ? "" : " hidden"}${color ? ` style="--sc-rail-team:${escapeHtml(color)}"` : ""}>` +
    // The club's crest on the photo's bottom-right corner (mak, 2026-11-17).
    // Decorative: the team code is already in the meta line as text.
    `<span class="sc-rail-avatar"><span class="sc-rail-thumb">${thumb}</span>` +
    (crest ? `<img class="sc-rail-crest" src="${escapeHtml(crest)}" alt="" aria-hidden="true" width="20" height="20" loading="${loading}" decoding="async" />` : "") +
    `</span>` +
    `<div class="sc-rail-body">` +
    `<h3 class="sc-rail-headline">${headline}</h3>` +
    `<p class="sc-rail-meta">${parts.join(" ")}</p>` +
    `</div>` +
    `</li>`
  );
}

/** The rows alone, every page of them, with `shown` (1-based) visible: what the client swaps in on a refresh. */
export function renderRailItems(items: NewsItem[], origin = "", perPage = RAIL_DEFAULT_LIMIT, shown = 1): string {
  return items
    .map((item, i) => {
      const page = Math.floor(i / perPage) + 1;
      return renderRailItem(item, origin, i < 2, page, shown);
    })
    .join("");
}

/** How many pages a set of rows fills. */
export function railPageCount(count: number, perPage: number): number {
  return Math.max(1, Math.ceil(count / Math.max(1, perPage)));
}

/** The pager: Previous, "Page 1 of 5", Next. Buttons, not links: paging never changes the URL. */
export function renderRailPager(page: number, pages: number): string {
  if (pages <= 1) return "";
  return (
    `<nav class="sc-rail-pager" aria-label="More news">` +
    `<button type="button" class="sc-rail-prev" data-dir="-1"${page <= 1 ? " disabled" : ""} aria-label="Previous news page"><span aria-hidden="true">&lsaquo;</span> Prev</button>` +
    `<span class="sc-rail-count" aria-live="polite">Page <b>${page}</b> of ${pages}</span>` +
    `<button type="button" class="sc-rail-next" data-dir="1"${page >= pages ? " disabled" : ""} aria-label="Next news page">Next <span aria-hidden="true">&rsaquo;</span></button>` +
    `</nav>`
  );
}

/** A cheap fingerprint of the rows, so a refresh that changed nothing redraws nothing. */
export function railSignature(items: NewsItem[]): string {
  return items.map((item) => `${item.id}:${item.pubDateMs ?? 0}:${item.imageVersion ?? ""}`).join("|");
}

/** The whole rail. */
export function renderNewsRail(items: NewsItem[], options: RailOptions): string {
  const origin = options.origin ?? "";
  const shown = items.slice(0, options.limit * options.pages);
  const heading = options.heading?.trim() || "Latest Fantasy News";
  const pages = railPageCount(shown.length, options.limit);
  return (
    `<section class="sc-rail" aria-label="${escapeHtml(heading)}" data-sc-rail="1"` +
    ` data-sc-limit="${options.limit}" data-sc-pages="${options.pages}"` +
    (origin ? ` data-sc-origin="${escapeHtml(origin)}"` : "") +
    (options.apiBase ? ` data-sc-api="${escapeHtml(options.apiBase)}"` : "") +
    (options.renderedMs ? ` data-sc-rendered="${options.renderedMs}"` : "") +
    ` data-sc-sig="${escapeHtml(railSignature(shown))}">` +
    `<div class="sc-rail-head"><h2 class="sc-rail-title">${escapeHtml(heading)}</h2></div>` +
    `<ol class="sc-rail-list">${renderRailItems(shown, origin, options.limit, 1)}</ol>` +
    renderRailPager(1, pages) +
    // Without the rail's script there is no pager to press: show every row.
    (pages > 1 ? `<noscript><style>.sc-rail .sc-rail-item[hidden]{display:grid!important}.sc-rail .sc-rail-pager{display:none!important}</style></noscript>` : "") +
    `</section>`
  );
}
