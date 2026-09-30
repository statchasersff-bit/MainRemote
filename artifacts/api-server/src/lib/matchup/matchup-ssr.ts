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
import { getMatchupData, matchupVersion, type MatchupData } from "./matchup-data";
import {
  matchupEventSchema,
  matchupFaqSchema,
  matchupRecapSchema,
  matchupScoreboardGame,
  renderMatchupPage,
  type MatchupRenderOptions,
} from "./matchup-render";
import { scoreboardHeading } from "./scoreboard-hero";
import { matchupPageMeta, matchupScoreLine } from "./matchup-seo";
import type { MatchupPair } from "./pair";
import { LruCache } from "../lru";

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
  /**
   * The page's H1, as the hero prints it: the game's own heading on a game
   * address ("{away} vs {home}, {round} {season}"), the pair's names on the
   * pair's. The plugin rewrites the holder page's title with it, so a theme
   * that prints its own H1 says what the hero would have said.
   */
  heading: string;
  /** The <title>, brand included when it fits. Same string the app page uses. */
  title: string;
}

/** 496 pairs × two option sets is the ceiling; most are never asked for. */
const FRAGMENT_CACHE_MAX = 512;
const fragmentCache = new LruCache<MatchupSsrResult>(FRAGMENT_CACHE_MAX);

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
  return (await renderWithData(pair, options)).result;
}

/**
 * The fragment and the data it was drawn from. The app page needs both — the
 * meta reads the state the fragment decided — and building the data is two
 * teams' news plus the FPA table, so it is built once and handed over.
 */
async function renderWithData(
  pair: MatchupPair,
  options: MatchupRenderOptions,
): Promise<{ result: MatchupSsrResult; data: MatchupData }> {
  // Best effort: a database that cannot answer costs this page its news, not
  // the page. The version then keys on the last value loaded, or the empty one.
  await ensureFreshness().catch(() => undefined);
  const data = await getMatchupData(pair, options.now, options.game ?? null);
  const version = `${hash(matchupVersion(data, contentVersion()))}-${hash(optionKey(options))}`;
  const key = `${pair.slug}:${optionKey(options)}`;

  const hit = fragmentCache.get(key);
  if (hit && hit.version === version) return { result: hit, data };

  const result: MatchupSsrResult = {
    html: renderMatchupPage(data, options),
    version,
    season: data.state.season,
    state: data.matchupState,
    scoreLine: matchupScoreLine(data),
    pinnedMissing: data.pinnedRequested && data.pinned === null,
    pinnedIsCurrent: data.pinnedIsCurrent,
    heading: pageHeadingFor(data),
    title: matchupPageMeta(data, "").title,
  };
  fragmentCache.set(key, result);
  return { result, data };
}

/** The H1 the hero prints — see renderHero() in matchup-render.ts. */
function pageHeadingFor(data: MatchupData): string {
  const game = data.pinned ? matchupScoreboardGame(data) : null;
  return game ? scoreboardHeading(game) : `${data.pair.a.fullName} vs ${data.pair.b.fullName}`;
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
  // The meta reads the same data the fragment was drawn from, so the title
  // and the page cannot disagree about the state.
  const { result: fragment, data } = await renderWithData(pair, options);
  const meta = matchupPageMeta(data, options.canonical);

  for (const marker of [HEAD_MARKER, BODY_MARKER, CLASS_MARKER]) {
    if (!template.includes(marker)) logger.warn({ marker }, "matchup.html is missing an SSR marker");
  }

  const html = template
    // Functions, not strings: a string replacement expands $& and $` inside
    // the content, so a headline carrying one rewrote the page.
    .replace(
      HEAD_MARKER,
      () =>
        renderTeamHeadTags(meta) +
          "\n  " +
          matchupEventSchema(data, false) +
          "\n  " +
          // The FAQ, from the same array the page's <details> were drawn from.
          matchupFaqSchema(data, options, false) +
          "\n  " +
          // Breadcrumbs and the highlights video, on a recap only.
          matchupRecapSchema(data, options, options.canonical),
    )
    .replace(CLASS_MARKER, options.embed ? " is-embed" : "")
    .replace(BODY_MARKER, () => fragment.html);
  return { ...fragment, html };
}
