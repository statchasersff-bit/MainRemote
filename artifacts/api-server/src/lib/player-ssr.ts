/**
 * Server-side rendering for the player pages, mirroring lib/team-ssr.ts.
 *
 * Two consumers, exactly as the other two tools have:
 *   - the standalone page at /player/:slug, which fills public/player.html;
 *   - GET /embed/player/:slug, the bare fragment for the WordPress plugin to
 *     print into a statchasers.com page.
 *
 * The rendered fragment is cached per player and per option set, keyed on a
 * fingerprint of the underlying data. That makes it an exact cache rather than
 * a timed one — a rebuilt data file or a new news item produces a new key and
 * the next request re-renders, and nothing else does.
 *
 * The cache is bounded and larger than the team hub's, because the population
 * is: there are 32 teams and several hundred indexed players. It is a memory
 * ceiling, not a working constraint — a miss costs one render, and a render is
 * arithmetic over JSON already in memory.
 */

import fs from "node:fs";
import path from "node:path";
import { contentVersion, ensureFreshness } from "./freshness";
import { logger } from "./logger";
import { renderPlayerPage, type PlayerRenderOptions } from "./player-render";
import {
  getPlayerPageData,
  playerDataVersion,
  type PlayerDataOptions,
} from "./player/player-data";
import { playerPageMeta, renderPlayerHeadTags } from "./player-seo";

export interface PlayerSsrResult {
  html: string;
  /** Fingerprint of everything rendered — the response ETag. */
  version: string;
  season: number;
  /** The player's display name, for the 404-vs-500 distinction upstream. */
  name: string;
}

const fragmentCache = new Map<string, PlayerSsrResult>();
const FRAGMENT_CACHE_MAX = 256;

export function invalidatePlayerRenderCache(): void {
  fragmentCache.clear();
}

function optionKey(
  options: PlayerRenderOptions,
  data: PlayerDataOptions,
): string {
  return JSON.stringify([
    options.embed ?? false,
    options.playerPathPrefix ?? "",
    options.teamPathPrefix ?? "",
    options.linkQuery ?? "",
    data.format ?? "ppr",
    data.advancedSeason ?? 0,
  ]);
}

export async function renderPlayerFragment(
  slug: string,
  options: PlayerRenderOptions = {},
  dataOptions: PlayerDataOptions = {},
): Promise<PlayerSsrResult | null> {
  // Warm the news freshness snapshot before its version is read into the cache
  // key — the same ordering lib/ssr.ts and lib/team-ssr.ts need, and for the
  // same reason: a cold first render would otherwise key itself on the empty
  // version and then serve that entry to requests looking at a different one.
  await ensureFreshness();

  const data = await getPlayerPageData(slug, dataOptions);
  if (!data) return null;

  const key = `${slug}:${optionKey(options, dataOptions)}`;
  const version = playerDataVersion(data, contentVersion());

  const hit = fragmentCache.get(key);
  if (hit && hit.version === version) return hit;

  const result: PlayerSsrResult = {
    html: renderPlayerPage(data, options),
    version,
    season: data.season,
    name: data.player.name,
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
  const html = fs.readFileSync(path.join(publicDir, "player.html"), "utf8");
  if (process.env["NODE_ENV"] !== "development") templateCache = html;
  return html;
}

export interface RenderPlayerAppPageOptions extends PlayerRenderOptions {
  canonical: string;
}

export async function renderPlayerAppPage(
  publicDir: string,
  slug: string,
  options: RenderPlayerAppPageOptions,
  dataOptions: PlayerDataOptions = {},
): Promise<PlayerSsrResult | null> {
  const data = await getPlayerPageData(slug, dataOptions);
  if (!data) return null;

  const template = readTemplate(publicDir);
  const fragment = await renderPlayerFragment(slug, options, dataOptions);
  if (!fragment) return null;

  const meta = playerPageMeta(data, options.canonical);

  for (const marker of [HEAD_MARKER, BODY_MARKER, CLASS_MARKER]) {
    if (!template.includes(marker)) {
      logger.warn({ marker }, "player.html is missing an SSR marker");
    }
  }

  const html = template
    .replace(HEAD_MARKER, renderPlayerHeadTags(meta))
    // The embedded page drops the standalone shell's background and padding so
    // the fragment sits flush inside whatever box WordPress gives it.
    .replace(CLASS_MARKER, options.embed ? " is-embed" : "")
    .replace(BODY_MARKER, fragment.html);

  return { ...fragment, html };
}
