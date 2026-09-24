/**
 * Server-side rendering for the rankings boards (redraft and rest-of-season),
 * mirroring fpa-ssr.ts.
 *
 * Two consumers, as the other four tools have:
 *   - the standalone page at /rest-of-season-rankings (and /rb, /wr, …),
 *     which fills public/rankings.html;
 *   - GET /embed/rankings, the bare fragment the WordPress plugin prints.
 *
 * The fragment is cached per (season, options) on the CSV's mtime, so replacing
 * `data/rankings/redraft-2026.csv` invalidates every rendering and nothing else
 * does. Five panels over one 14 kB file — the cache is here because a render is
 * 230 rows of string concatenation on a request path, not because the parse is
 * expensive.
 *
 * There is no lazy ingest and no backfill, which is the one structural
 * difference from FPA. These rankings are not derived from anything: they are a
 * file somebody publishes. A deployment without one has nothing to compute, so
 * it renders the honest empty state and says which file is missing.
 */

import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";
import {
  renderRankingsEmpty,
  renderRankingsPage,
  type RankingsRenderOptions,
} from "./rankings-render";
import { getRankings, type RankingsData } from "./rankings/rankings-data";
import { rankingsPageMeta, renderRankingsHeadTags } from "./rankings-seo";

export interface RankingsSsrResult {
  html: string;
  /** Fingerprint of everything rendered — the response ETag. */
  version: string;
  /** Null when no rankings file exists; the caller decides what to do. */
  data: RankingsData | null;
}

const fragmentCache = new Map<string, RankingsSsrResult>();
const FRAGMENT_CACHE_MAX = 16;

export function invalidateRankingsRenderCache(): void {
  fragmentCache.clear();
}

function optionKey(season: number | undefined, options: RankingsRenderOptions): string {
  return JSON.stringify([
    season ?? 0,
    options.embed ?? false,
    options.basePath ?? "",
    options.downloadBase ?? "",
    options.playerPathPrefix ?? "",
    options.linkQuery ?? "",
    options.tabQuery ?? "",
    options.position ?? "All",
    options.board ?? "redraft",
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

export function renderRankingsFragment(
  season?: number,
  options: RankingsRenderOptions = {},
): RankingsSsrResult {
  const key = optionKey(season, options);
  const data = getRankings(season, options.board ?? "redraft");

  if (!data) {
    return { html: renderRankingsEmpty(options), version: "empty", data: null };
  }

  const version = `${data.version}-${hash(key)}`;
  const hit = fragmentCache.get(key);
  if (hit && hit.version === version) return hit;

  const result: RankingsSsrResult = {
    html: renderRankingsPage(data, options),
    version,
    data,
  };

  if (fragmentCache.size >= FRAGMENT_CACHE_MAX) {
    const oldest = fragmentCache.keys().next();
    if (!oldest.done) fragmentCache.delete(oldest.value);
  }
  fragmentCache.set(key, result);
  return result;
}

const HEAD_MARKER = "<!--SSR-HEAD-->";
const BODY_MARKER = "<!--SSR-->";
const CLASS_MARKER = "<!--SSR-BODY-CLASS-->";

let templateCache: string | null = null;

function readTemplate(publicDir: string): string {
  if (templateCache !== null) return templateCache;
  const html = fs.readFileSync(path.join(publicDir, "rankings.html"), "utf8");
  if (process.env["NODE_ENV"] !== "development") templateCache = html;
  return html;
}

export interface RenderRankingsAppPageOptions extends RankingsRenderOptions {
  canonical: string;
}

export function renderRankingsAppPage(
  publicDir: string,
  season: number | undefined,
  options: RenderRankingsAppPageOptions,
): RankingsSsrResult {
  const template = readTemplate(publicDir);
  const fragment = renderRankingsFragment(season, options);
  const meta = rankingsPageMeta(
    fragment.data,
    options.canonical,
    options.position,
  );

  for (const marker of [HEAD_MARKER, BODY_MARKER, CLASS_MARKER]) {
    if (!template.includes(marker)) {
      logger.warn({ marker }, "rankings.html is missing an SSR marker");
    }
  }

  const html = template
    .replace(HEAD_MARKER, renderRankingsHeadTags(meta))
    .replace(CLASS_MARKER, options.embed ? " is-embed" : "")
    .replace(BODY_MARKER, fragment.html);

  return { ...fragment, html };
}
