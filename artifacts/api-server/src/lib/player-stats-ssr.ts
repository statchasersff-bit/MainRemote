/**
 * Server-side rendering for the advanced player stats table, mirroring
 * rankings-ssr.ts.
 *
 * Two consumers, as the other tools have:
 *   - the standalone pages at /player-stats and /player-stats/:pos, which fill
 *     public/player-stats.html;
 *   - GET /embed/player-stats, the bare fragment the WordPress plugin prints.
 *
 * The fragment is cached per (position, season, options) on the data file's
 * mtime, so replacing `data/player-stats/wr_2025.json` invalidates every
 * rendering of it and nothing else does. The cache is here because a render is
 * ten thousand cells of string concatenation on a request path — the widest
 * table, three seasons of receivers, is 319 rows by fifty columns.
 */

import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";
import {
  renderStatsEmpty,
  renderStatsPage,
  type StatsRenderOptions,
} from "./player-stats-render";
import {
  getStatsTable,
  type StatsPosition,
  type StatsSeason,
  type StatsTable,
} from "./player-stats/stats-data";
import { renderStatsHeadTags, statsPageMeta } from "./player-stats-seo";
import { LruCache } from "./lru";

export interface StatsSsrResult {
  html: string;
  /** Fingerprint of everything rendered — the response ETag. */
  version: string;
  /** Null when there is no file for this position and season. */
  table: StatsTable | null;
}

const FRAGMENT_CACHE_MAX = 32;
const fragmentCache = new LruCache<StatsSsrResult>(FRAGMENT_CACHE_MAX);

export function invalidateStatsRenderCache(): void {
  fragmentCache.clear();
}

function optionKey(
  position: StatsPosition,
  season: StatsSeason,
  options: StatsRenderOptions,
): string {
  return JSON.stringify([
    position,
    season,
    options.embed ?? false,
    options.basePath ?? "",
    options.playerPathPrefix ?? "",
    options.linkQuery ?? "",
    options.pageQuery ?? "",
    options.defaultSeason ?? null,
    options.endpoint ?? "",
  ]);
}

/** Short, stable, non-cryptographic — this only has to differ, not resist. */
function hash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i += 1) {
    h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

export function renderStatsFragment(
  position: StatsPosition,
  season: StatsSeason,
  options: StatsRenderOptions = {},
): StatsSsrResult {
  const key = optionKey(position, season, options);
  const table = getStatsTable(position, season);

  if (!table) {
    return { html: renderStatsEmpty(options), version: "empty", table: null };
  }

  const version = `${table.version}-${hash(key)}`;
  const hit = fragmentCache.get(key);
  if (hit && hit.version === version) return hit;

  const result: StatsSsrResult = {
    html: renderStatsPage(table, options),
    version,
    table,
  };
  fragmentCache.set(key, result);
  return result;
}

const HEAD_MARKER = "<!--SSR-HEAD-->";
const BODY_MARKER = "<!--SSR-->";
const CLASS_MARKER = "<!--SSR-BODY-CLASS-->";

let templateCache: string | null = null;

function readTemplate(publicDir: string): string {
  if (templateCache !== null) return templateCache;
  const html = fs.readFileSync(path.join(publicDir, "player-stats.html"), "utf8");
  if (process.env["NODE_ENV"] !== "development") templateCache = html;
  return html;
}

export interface RenderStatsAppPageOptions extends StatsRenderOptions {
  canonical: string;
}

export function renderStatsAppPage(
  publicDir: string,
  position: StatsPosition,
  season: StatsSeason,
  options: RenderStatsAppPageOptions,
): StatsSsrResult {
  const template = readTemplate(publicDir);
  const fragment = renderStatsFragment(position, season, options);
  const meta = statsPageMeta(position, fragment.table, options.canonical);

  for (const marker of [HEAD_MARKER, BODY_MARKER, CLASS_MARKER]) {
    if (!template.includes(marker)) {
      logger.warn({ marker }, "player-stats.html is missing an SSR marker");
    }
  }

  const html = template
    // Functions, not strings: a string replacement expands $& and $` inside
    // the content, so a headline carrying one rewrote the page.
    .replace(HEAD_MARKER, () => renderStatsHeadTags(meta))
    .replace(CLASS_MARKER, options.embed ? " is-embed" : "")
    .replace(BODY_MARKER, () => fragment.html);

  return { ...fragment, html };
}
