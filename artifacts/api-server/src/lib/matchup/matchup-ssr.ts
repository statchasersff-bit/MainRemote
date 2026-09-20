/**
 * Server-side rendering for matchup pages, mirroring team-ssr.ts.
 *
 * Two consumers: the standalone page at /nfl/<a>-vs-<b>/, which fills
 * public/matchup.html, and GET /embed/matchup/<a>-vs-<b>, the bare fragment
 * for the WordPress plugin. Cached per pair and option set on a fingerprint of
 * both teams' data plus the history schedules — an exact cache, not a timed
 * one.
 */

import fs from "node:fs";
import path from "node:path";
import { contentVersion, ensureFreshness } from "../freshness";
import { logger } from "../logger";
import { renderTeamHeadTags } from "../team-seo";
import { getMatchupData, matchupVersion } from "./matchup-data";
import { renderMatchupPage, type MatchupRenderOptions } from "./matchup-render";
import { matchupPageMeta, matchupScoreLine } from "./matchup-seo";
import type { MatchupPair } from "./pair";

export interface MatchupSsrResult {
  html: string;
  version: string;
  season: number;
  state: string;
  /**
   * The result in one clause — "Seahawks won 13-10" — or "" when the page has
   * no final score.
   *
   * Carried out to the plugin as a header for one reason: the description
   * WordPress writes for an indexed matchup page mirrors this app's, and the
   * postgame description leads with the score. Without this the plugin would
   * have to parse it back out of the markup, or the two would drift, which the
   * comment at the top of matchup-seo.ts exists to prevent.
   */
  scoreLine: string;
  /**
   * A game address asked for a meeting that is not there — a week these two did
   * not play, or one that never finished. The route turns this into the 404;
   * the render is thrown away.
   */
  pinnedMissing: boolean;
  /**
   * A game address asked for the meeting the pair's own address is still
   * leading with. The route 301s to the pair, so that inside the two-week
   * window exactly one URL carries the recap.
   */
  pinnedIsCurrent: boolean;
}

/** 496 pairs × two option sets is the ceiling; most are never asked for. */
const fragmentCache = new Map<string, MatchupSsrResult>();
const FRAGMENT_CACHE_MAX = 512;

export function invalidateMatchupRenderCache(): void {
  fragmentCache.clear();
}

function optionKey(options: MatchupRenderOptions): string {
  return JSON.stringify([
    options.embed ?? false,
    options.teamPathPrefix ?? "",
    options.matchupPathPrefix ?? "",
    options.linkQuery ?? "",
    options.game ? `${options.game.season}w${options.game.week}` : "",
  ]);
}

function hash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i += 1) h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export async function renderMatchupFragment(
  pair: MatchupPair,
  options: MatchupRenderOptions = {},
): Promise<MatchupSsrResult> {
  await ensureFreshness();
  const data = await getMatchupData(pair, options.now, options.game ?? null);
  const version = `${hash(matchupVersion(data, contentVersion()))}-${hash(optionKey(options))}`;
  const key = `${pair.slug}:${optionKey(options)}`;

  const hit = fragmentCache.get(key);
  if (hit && hit.version === version) return hit;

  const result: MatchupSsrResult = {
    html: renderMatchupPage(data, options),
    version,
    season: data.state.season,
    state: data.matchupState,
    scoreLine: matchupScoreLine(data),
    pinnedMissing: data.pinnedRequested && data.pinned === null,
    pinnedIsCurrent: data.pinnedIsCurrent,
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
  const html = fs.readFileSync(path.join(publicDir, "matchup.html"), "utf8");
  if (process.env["NODE_ENV"] !== "development") templateCache = html;
  return html;
}

export interface RenderMatchupAppPageOptions extends MatchupRenderOptions {
  canonical: string;
}

export async function renderMatchupAppPage(
  publicDir: string,
  pair: MatchupPair,
  options: RenderMatchupAppPageOptions,
): Promise<MatchupSsrResult> {
  const template = readTemplate(publicDir);
  const fragment = await renderMatchupFragment(pair, options);
  // The meta needs the state, which the fragment decided; re-deriving it is one
  // cached data call and keeps the title and the page reading the same state.
  const data = await getMatchupData(pair, options.now, options.game ?? null);
  const meta = matchupPageMeta(data, options.canonical);

  for (const marker of [HEAD_MARKER, BODY_MARKER, CLASS_MARKER]) {
    if (!template.includes(marker)) logger.warn({ marker }, "matchup.html is missing an SSR marker");
  }

  const html = template
    .replace(HEAD_MARKER, renderTeamHeadTags(meta))
    .replace(CLASS_MARKER, options.embed ? " is-embed" : "")
    .replace(BODY_MARKER, fragment.html);
  return { ...fragment, html };
}
