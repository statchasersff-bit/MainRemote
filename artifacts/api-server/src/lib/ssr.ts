/**
 * Server-side rendering of the news tool.
 *
 * Two consumers:
 *   - the standalone app page (public/index.html), whose markers are replaced
 *     with rendered head metadata and rendered markup before the response goes
 *     out;
 *   - GET /embed/ssr, which serves the same list markup as a bare fragment for
 *     the WordPress plugin to inline into the parent page.
 *
 * Either way the HTML that leaves this server already contains every headline,
 * player name, timestamp, summary and link - plus the final title, canonical
 * and social metadata. Nothing important waits on a fetch, nothing waits on a
 * click, and nothing is patched up afterwards by JavaScript.
 */

import fs from "node:fs";
import path from "node:path";
import { listNews, MAX_LIMIT } from "./news-query";
import {
  renderFragment,
  DEFAULT_PAGE_SIZE,
  type LinkTemplates,
  type NewsItem,
  type RelatedLink,
} from "./render";
import { ensureTeams } from "./teams";
import { pageMeta, renderHeadTags, type PageMeta } from "./seo";
import { contentVersion, ensureFreshness } from "./freshness";
import { logger } from "./logger";
import {
  imageVersionsEpoch,
  onImageVersionsChanged,
  stampImageVersions,
} from "./image-versions";

export interface SsrOptions {
  limit?: number;
  pageSize?: number;
  origin?: string;
  heading?: boolean;
  headingText?: string;
  links?: LinkTemplates;
  relatedLinks?: RelatedLink[];
  relatedHeading?: string;
  vitalsEndpoint?: string;
  pageUrl?: string;
  /** The WordPress proxy the browser refreshes the feed through (lib/embed-key.ts). */
  apiBase?: string;
}

/**
 * Rendered-fragment cache.
 *
 * Rendering 250 cards means a database round trip plus a few hundred kilobytes of
 * string building. Doing that per request wastes TTFB - which is LCP's floor -
 * for output that only changes when the news does. Entries are keyed by the
 * render options *and* the content version, and dropped outright when an
 * ingest changes data, so this is an exact cache rather than a timed one: no
 * request ever serves stale HTML.
 */
const renderCache = new Map<string, string>();

/** Bound the map so unusual option combinations can't grow it without limit. */
const RENDER_CACHE_MAX = 32;

/**
 * The items behind each rendered fragment, keyed by content version and
 * limit, and kept SEPARATELY from the HTML. A learned headshot version only
 * changes the URLs a card prints, so it re-renders from these same items
 * rather than re-reading the archive: a re-read could surface a story the
 * freshness snapshot has not yet seen, and the page would change under an
 * ETag that had not - exactly what the freshness suite guards against.
 */
const itemsCache = new Map<string, NewsItem[]>();
const ITEMS_CACHE_MAX = 8;

/** The archive changed (an ingest ran): forget the items and the HTML. */
export function invalidateRenderCache(): void {
  renderCache.clear();
  itemsCache.clear();
}

// A learned headshot version changes the URLs a card prints, not the stories.
onImageVersionsChanged(() => renderCache.clear());

/**
 * How long the first render waits for headshot versions it has not met. One
 * round trip to Sleeper plus a resize is well under this; a feed full of new
 * faces after a cold start spills into the background and the cache listener
 * above re-renders when they land.
 */
const IMAGE_VERSION_BUDGET_MS = 1_500;

function cacheKey(options: SsrOptions, limit: number): string {
  return JSON.stringify([
    contentVersion(),
    imageVersionsEpoch(),
    limit,
    options.pageSize ?? DEFAULT_PAGE_SIZE,
    options.origin ?? "",
    options.heading ?? true,
    options.headingText ?? "",
    options.links?.playerUrl ?? "",
    options.links?.teamUrl ?? "",
    options.relatedHeading ?? "",
    options.relatedLinks ?? [],
    // Both of these are rendered into the root element's attributes, so they
    // must key the cache - otherwise a request that enables monitoring gets
    // served an earlier fragment that has it switched off.
    options.vitalsEndpoint ?? "",
    options.pageUrl ?? "",
    options.apiBase ?? "",
  ]);
}

/**
 * Render the embeddable fragment. Awaits the team map on the first call so the
 * very first server-rendered page already has team colours; later calls hit the
 * warm in-memory map and return synchronously fast.
 */
export async function renderNewsFragment(
  options: SsrOptions = {},
): Promise<string> {
  await ensureTeams();
  // Warm the freshness snapshot before cacheKey() reads contentVersion() from
  // it. Without this the first render after a restart would key itself on the
  // empty "0-0-0" version and then serve that entry to later requests, which
  // are looking at a different version string.
  await ensureFreshness();
  const limit = options.limit ?? MAX_LIMIT;

  const key = cacheKey(options, limit);
  const hit = renderCache.get(key);
  if (hit !== undefined) return hit;

  const itemsKey = JSON.stringify([contentVersion(), limit]);
  let items = itemsCache.get(itemsKey);
  if (!items) {
    items = await listNews({ limit });
    if (itemsCache.size >= ITEMS_CACHE_MAX) {
      const oldest = itemsCache.keys().next();
      if (!oldest.done) itemsCache.delete(oldest.value);
    }
    itemsCache.set(itemsKey, items);
  }
  await stampImageVersions(items, IMAGE_VERSION_BUDGET_MS);
  const html = renderFragment(items, {
    limit,
    pageSize: options.pageSize ?? DEFAULT_PAGE_SIZE,
    ...(options.origin !== undefined ? { origin: options.origin } : {}),
    ...(options.heading !== undefined ? { heading: options.heading } : {}),
    ...(options.headingText !== undefined
      ? { headingText: options.headingText }
      : {}),
    ...(options.links ? { links: options.links } : {}),
    ...(options.relatedLinks?.length
      ? { relatedLinks: options.relatedLinks }
      : {}),
    ...(options.relatedHeading !== undefined
      ? { relatedHeading: options.relatedHeading }
      : {}),
    ...(options.vitalsEndpoint
      ? { vitalsEndpoint: options.vitalsEndpoint }
      : {}),
    ...(options.pageUrl ? { pageUrl: options.pageUrl } : {}),
    ...(options.apiBase ? { apiBase: options.apiBase } : {}),
  });

  // Simple FIFO eviction - entries are all equivalent in cost and the map only
  // grows when a host asks for an unusual option combination.
  if (renderCache.size >= RENDER_CACHE_MAX) {
    const oldest = renderCache.keys().next();
    if (!oldest.done) renderCache.delete(oldest.value);
  }
  renderCache.set(key, html);

  return html;
}

/**
 * index.html with the SSR markers replaced. The template is re-read per request
 * in development (so live reload picks up edits) and cached in production.
 */
const HEAD_MARKER = "<!--SSR-HEAD-->";
const BODY_MARKER = "<!--SSR-->";

let templateCache: string | null = null;

function readTemplate(publicDir: string): string {
  if (templateCache !== null) return templateCache;
  const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
  if (process.env["NODE_ENV"] !== "development") templateCache = html;
  return html;
}

export interface RenderAppPageOptions extends SsrOptions {
  /** Canonical URL for this response - query string already stripped. */
  canonical: string;
  /** Injected for testability. */
  now?: Date;
}

export async function renderAppPage(
  publicDir: string,
  options: RenderAppPageOptions,
): Promise<string> {
  const template = readTemplate(publicDir);
  const meta: PageMeta = pageMeta(options.canonical, options.now ?? new Date());

  let fragment: string;
  try {
    fragment = await renderNewsFragment({
      ...options,
      // No heading of any kind on this page. It is never read on its own -
      // it is consumed inside a StatChasers page (the WordPress mount, or the
      // legacy iframe), and that page already prints its own header directly
      // above the tool. A heading here would restate it. The <title> and
      // og:title still carry the phrase for search results; see lib/seo.ts.
      heading: false,
    });
  } catch (err) {
    // A rendering failure must not blank the page: ship the shell and let the
    // client bundle fetch and render the list instead.
    logger.error({ err }, "Server-side render failed; sending shell only");
    fragment = "";
  }

  for (const marker of [HEAD_MARKER, BODY_MARKER]) {
    if (!template.includes(marker)) {
      logger.warn({ marker }, "index.html is missing an SSR marker");
    }
  }

  return template
    // Functions, not strings: a string replacement expands $& and $` inside
    // the content, so a headline carrying one rewrote the page.
    .replace(HEAD_MARKER, () => renderHeadTags(meta))
    .replace(BODY_MARKER, () => fragment);
}
