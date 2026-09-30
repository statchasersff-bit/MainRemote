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
  type PlayerPageData,
} from "./player/player-data";
import { escapeJsonLd } from "./render";
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
    options.matchupPathPrefix ?? "",
    options.fpaPath ?? "",
    options.linkQuery ?? "",
    // The section scopes the whole render — one panel instead of seven, a
    // different heading, no tab strip. Left out of the key, a request for
    // ?section=injury poisons the cache for the full profile at the same slug.
    options.section ?? "",
    // Whether the panel's heading was promoted to the page's <h1>. Same hazard
    // as the section directly above, and worse in its consequences: `?h1=1`
    // renders the opening heading as an <h1> and the plain request renders it
    // as an <h2>, so left out of the key WHICHEVER REQUEST ARRIVES FIRST pins
    // the answer for every later one at that slug. A host running "let the tool
    // supply the heading" — which also empties the theme's own title — then
    // serves pages with no <h1> at all, or a plain mount serves two.
    options.ownHeading ?? false,
    data.format ?? "ppr",
    data.advancedSeason ?? 0,
    // The Game Log's season, for the same reason the section is here: two
    // requests differing only in ?log= render different tables.
    data.logSeason ?? 0,
  ]);
}

export async function renderPlayerFragment(
  slug: string,
  options: PlayerRenderOptions = {},
  dataOptions: PlayerDataOptions = {},
): Promise<PlayerSsrResult | null> {
  return (await renderWithData(slug, options, dataOptions))?.result ?? null;
}

/**
 * The fragment and the data it was drawn from. The app page needs both for
 * its meta, and building the data is three news queries, so it is built once
 * per request and handed over rather than built again.
 */
async function renderWithData(
  slug: string,
  options: PlayerRenderOptions,
  dataOptions: PlayerDataOptions,
): Promise<{ result: PlayerSsrResult; data: PlayerPageData } | null> {
  // Warm the news freshness snapshot before its version is read into the cache
  // key — the same ordering lib/ssr.ts and lib/team-ssr.ts need, and for the
  // same reason: a cold first render would otherwise key itself on the empty
  // version and then serve that entry to requests looking at a different one.
  // Best effort: a database that cannot answer costs this page its news, not
  // the page. The version then keys on the last value loaded, or the empty one.
  await ensureFreshness().catch(() => undefined);

  const data = await getPlayerPageData(slug, dataOptions);
  if (!data) return null;

  const key = `${slug}:${optionKey(options, dataOptions)}`;
  const version = playerDataVersion(data, contentVersion());

  const hit = fragmentCache.get(key);
  if (hit && hit.version === version) return { result: hit, data };

  const result: PlayerSsrResult = {
    html: renderPlayerPage(data, options) + pageDataIsland(data, options),
    version,
    season: data.season,
    name: data.player.name,
  };

  if (fragmentCache.size >= FRAGMENT_CACHE_MAX) {
    const oldest = fragmentCache.keys().next();
    if (!oldest.done) fragmentCache.delete(oldest.value);
  }
  fragmentCache.set(key, result);
  return { result, data };
}

/** The section URLs that are pages of their own: every section but Overview. */
const INDEXED_SECTIONS = new Set(["stats", "game-log", "outlook", "injury", "news", "bio"]);

/**
 * A section URL's title and description, as an inert island for the plugin.
 *
 * On WordPress a section URL is a rewrite onto the profile page, so Rank Math
 * would give it the profile's title, description and canonical: six pages
 * claiming to be one. The plugin reads this and hands Rank Math the section's
 * own copy — written here, once, by playerPageMeta(), the same words this
 * server's standalone page wears. The title goes without the site name; the
 * plugin appends its own. Embedded section fragments only: the profile's
 * title is the one stored on its page.
 */
function pageDataIsland(data: PlayerPageData, options: PlayerRenderOptions): string {
  if (!options.embed || !options.section || !INDEXED_SECTIONS.has(options.section)) {
    return "";
  }
  const meta = playerPageMeta(data, "", options.section);
  return (
    `<script type="application/json" class="scp-page-data">` +
    escapeJsonLd(
      JSON.stringify({
        title: meta.title.replace(/ \| StatChasers$/, ""),
        description: meta.description,
      }),
    ) +
    `</script>`
  );
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
  const template = readTemplate(publicDir);
  const rendered = await renderWithData(slug, options, dataOptions);
  if (!rendered) return null;
  const { result: fragment, data } = rendered;

  const meta = playerPageMeta(data, options.canonical, options.section);

  for (const marker of [HEAD_MARKER, BODY_MARKER, CLASS_MARKER]) {
    if (!template.includes(marker)) {
      logger.warn({ marker }, "player.html is missing an SSR marker");
    }
  }

  const html = template
    // Functions, not strings: a string replacement expands $& and $` inside
    // the content, so a headline carrying one rewrote the page.
    .replace(HEAD_MARKER, () => renderPlayerHeadTags(meta))
    // The embedded page drops the standalone shell's background and padding so
    // the fragment sits flush inside whatever box WordPress gives it.
    .replace(CLASS_MARKER, options.embed ? " is-embed" : "")
    .replace(BODY_MARKER, () => fragment.html);

  return { ...fragment, html };
}
