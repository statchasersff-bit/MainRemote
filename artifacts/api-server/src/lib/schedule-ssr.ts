/**
 * Server-side rendering for the NFL schedule, mirroring fpa-ssr.ts and
 * rankings-ssr.ts.
 *
 * Two consumers, as the other tools have:
 *   - the standalone page at /schedule, which fills public/schedule.html;
 *   - GET /embed/schedule, the bare fragment the WordPress plugin prints.
 *
 * The fragment is cached per (season, view, week, filter, link options)
 * on the season's own fingerprint, so a slate refresh or a score change
 * invalidates every rendering and nothing else does. The cache is bounded
 * because the state space is not: eighteen weeks times three filters plus the
 * matrix is around sixty renderings, and a WordPress page only ever asks for
 * the handful its shortcodes name.
 *
 * There is no lazy-ingest equivalent here. The FPA table has one because its
 * data lives in a database that starts empty; this tool's data is a file on
 * someone else's server, fetched on demand and cached, so a cold process is
 * one slow request rather than an empty page.
 */

import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";
import {
  renderScheduleEmpty,
  renderSchedulePage,
  resolveState,
  type ScheduleRenderOptions,
} from "./schedule-render";
import { getSchedule, type ScheduleSeason } from "./schedule/schedule-data";
import { schedulePageMeta, renderScheduleHeadTags } from "./schedule-seo";

export interface ScheduleSsrResult {
  html: string;
  /** Fingerprint of everything rendered — the response ETag. */
  version: string;
  /** Null when the feed is unavailable; the caller decides what to do. */
  data: ScheduleSeason | null;
}

const fragmentCache = new Map<string, ScheduleSsrResult>();
const FRAGMENT_CACHE_MAX = 64;

export function invalidateScheduleRenderCache(): void {
  fragmentCache.clear();
}

function optionKey(season: number, options: ScheduleRenderOptions): string {
  return JSON.stringify([
    season,
    options.view ?? "matrix",
    options.week ?? 0,
    options.filter ?? "all",
    options.embed ?? false,
    // The heading mode changes the markup that comes back — a fragment that
    // prints the page's <h1> against one that prints none — so a fragment
    // cached under one must not be served under the other.
    options.ownHeading ?? false,
    options.basePath ?? "",
    options.teamPathPrefix ?? "",
    options.matchupPathPrefix ?? "",
    options.downloadBase ?? "",
    options.linkQuery ?? "",
  ]);
}

export async function renderScheduleFragment(
  season: number,
  options: ScheduleRenderOptions = {},
): Promise<ScheduleSsrResult> {
  const data = await getSchedule(season, options.now ?? Date.now());

  if (!data) {
    return {
      html: renderScheduleEmpty(options),
      version: "empty",
      data: null,
    };
  }

  // The default week is resolved from the data, so two requests a minute apart
  // that both omit `week` must share a cache entry — which means the key has to
  // carry the week that was CHOSEN, not the one that was asked for.
  const resolved = resolveState(data, options);
  const key = optionKey(data.season, { ...options, week: resolved.week });
  const version = `${data.version}-${hash(key)}`;

  const hit = fragmentCache.get(key);
  if (hit && hit.version === version) return hit;

  const result: ScheduleSsrResult = {
    html: renderSchedulePage(data, options),
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

/** Short, stable, non-cryptographic — this only has to differ, not resist. */
function hash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i += 1) {
    h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

const HEAD_MARKER = "<!--SSR-HEAD-->";
const BODY_MARKER = "<!--SSR-->";
const CLASS_MARKER = "<!--SSR-BODY-CLASS-->";

let templateCache: string | null = null;

function readTemplate(publicDir: string): string {
  if (templateCache !== null) return templateCache;
  const html = fs.readFileSync(path.join(publicDir, "schedule.html"), "utf8");
  if (process.env["NODE_ENV"] !== "development") templateCache = html;
  return html;
}

export interface RenderScheduleAppPageOptions extends ScheduleRenderOptions {
  canonical: string;
}

export async function renderScheduleAppPage(
  publicDir: string,
  season: number,
  options: RenderScheduleAppPageOptions,
): Promise<ScheduleSsrResult> {
  const template = readTemplate(publicDir);
  const fragment = await renderScheduleFragment(season, options);

  const meta = schedulePageMeta(fragment.data, options.canonical, {
    view: options.view ?? "matrix",
    week: fragment.data
      ? resolveState(fragment.data, options).week
      : (options.week ?? 1),
  });

  for (const marker of [HEAD_MARKER, BODY_MARKER, CLASS_MARKER]) {
    if (!template.includes(marker)) {
      logger.warn({ marker }, "schedule.html is missing an SSR marker");
    }
  }

  const html = template
    .replace(HEAD_MARKER, renderScheduleHeadTags(meta))
    .replace(CLASS_MARKER, options.embed ? " is-embed" : "")
    .replace(BODY_MARKER, fragment.html);

  return { ...fragment, html };
}
