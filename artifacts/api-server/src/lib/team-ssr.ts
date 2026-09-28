/**
 * Server-side rendering for the team hub, mirroring lib/ssr.ts.
 *
 * Two consumers, exactly as the news tool has:
 *   - the standalone page at /team/:slug, which fills public/team.html;
 *   - GET /embed/team/:slug, the bare fragment for the WordPress plugin to
 *     print into a statchasers.com page.
 *
 * The rendered fragment is cached per team and per option set, keyed on a
 * fingerprint of the underlying data (see dataVersion in team/team-data.ts).
 * That makes it an exact cache rather than a timed one: a background refresh of
 * any provider produces a new key and the next request re-renders, and nothing
 * else does.
 */

import fs from "node:fs";
import path from "node:path";
import { contentVersion, ensureFreshness } from "./freshness";
import { logger } from "./logger";
import { renderTeamPage, type TeamRenderOptions } from "./team-render";
import { dataVersion, getTeamPageData } from "./team/team-data";
import { renderTeamHeadTags, teamPageMeta } from "./team-seo";
import type { NflTeam } from "./team/teams";

export interface TeamSsrResult {
  html: string;
  /** Fingerprint of everything rendered — the response ETag. */
  version: string;
  season: number;
}

/**
 * Bounded fragment cache. 32 teams x two option sets (embedded and not) is the
 * realistic ceiling, so the bound is really a guard against an unexpected
 * option combination rather than a working constraint.
 */
const fragmentCache = new Map<string, TeamSsrResult>();
const FRAGMENT_CACHE_MAX = 96;

export function invalidateTeamRenderCache(): void {
  fragmentCache.clear();
}

function optionKey(options: TeamRenderOptions): string {
  return JSON.stringify([
    options.embed ?? false,
    options.teamPathPrefix ?? "",
    options.linkQuery ?? "",
    // The section scopes the whole render — one panel instead of five, a
    // different heading, no tab strip. Left out of the key, a request for
    // ?section=schedule poisons the cache for the hub at the same slug.
    options.section ?? "",
    // Whether the panel's heading was promoted to the page's <h1>. Same hazard
    // as the section directly above, and worse in its consequences: `?h1=1`
    // renders the opening heading as an <h1> and the plain request renders it
    // as an <h2>, so left out of the key WHICHEVER REQUEST ARRIVES FIRST pins
    // the answer for every later one at that slug. A host running "let the tool
    // supply the heading" — which also empties the theme's own title — then
    // serves pages with no <h1> at all, or a plain mount serves two.
    options.ownHeading ?? false,
  ]);
}

export async function renderTeamFragment(
  team: NflTeam,
  options: TeamRenderOptions = {},
): Promise<TeamSsrResult> {
  // Warm the news freshness snapshot before its version is read into the cache
  // key — the same ordering lib/ssr.ts needs, and for the same reason: a cold
  // first render would otherwise key itself on the empty version and then serve
  // that entry to requests looking at a different one.
  // Best effort: a database that cannot answer costs this page its news, not
  // the page. The version then keys on the last value loaded, or the empty one.
  await ensureFreshness().catch(() => undefined);

  const data = await getTeamPageData(team);
  const version = `${dataVersion(data, contentVersion())}-${hash(optionKey(options))}`;
  const key = `${team.abbreviation}:${optionKey(options)}`;

  const hit = fragmentCache.get(key);
  if (hit && hit.version === version) return hit;

  const result: TeamSsrResult = {
    html: renderTeamPage(data, options),
    version,
    season: data.state.season,
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
  const html = fs.readFileSync(path.join(publicDir, "team.html"), "utf8");
  if (process.env["NODE_ENV"] !== "development") templateCache = html;
  return html;
}

export interface RenderTeamAppPageOptions extends TeamRenderOptions {
  canonical: string;
}

export async function renderTeamAppPage(
  publicDir: string,
  team: NflTeam,
  options: RenderTeamAppPageOptions,
): Promise<TeamSsrResult> {
  const template = readTemplate(publicDir);
  const fragment = await renderTeamFragment(team, options);
  const meta = teamPageMeta(team, fragment.season, options.canonical, options.section);

  for (const marker of [HEAD_MARKER, BODY_MARKER, CLASS_MARKER]) {
    if (!template.includes(marker)) {
      logger.warn({ marker }, "team.html is missing an SSR marker");
    }
  }

  const html = template
    .replace(HEAD_MARKER, renderTeamHeadTags(meta))
    // The embedded page drops the standalone shell's background and padding so
    // the fragment sits flush inside whatever box WordPress gives it.
    .replace(CLASS_MARKER, options.embed ? " is-embed" : "")
    .replace(BODY_MARKER, fragment.html);

  return { ...fragment, html };
}
