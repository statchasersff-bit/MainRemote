/**
 * Server-side rendering for the strength-of-schedule board, mirroring
 * fpa-ssr.ts.
 *
 * Two consumers:
 *   - the standalone page at /strength-of-schedule, which fills public/sos.html;
 *   - GET /embed/sos, the bare fragment the WordPress plugin prints and the
 *     bundle fetches another view from.
 *
 * The fragment is cached per (view, options) against the board's version,
 * which moves with the FPA table, the schedule and the player list - so a
 * fresh FPA ingest invalidates every rendering and nothing else does.
 *
 * No lazy ingest of its own: the board reads the FPA table, and a cold FPA
 * table already kicks one (fpa-ssr.ts) the first time anything asks for it.
 */

import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";
import { renderSosEmpty, renderSosPage, sosPageCopy, type SosRenderOptions } from "./sos-render";
import { getSosBoard, type SosBoard, type SosState } from "./sos/sos-data";
import { renderSosHeadTags } from "./sos-seo";
import { sosFaqFacts } from "./sos-faq";
import { LruCache } from "./lru";

export interface SosSsrResult {
  html: string;
  /** Fingerprint of everything rendered - the response ETag. */
  version: string;
  /** Null when there is no FPA table or no schedule. */
  board: SosBoard | null;
}

const FRAGMENT_CACHE_MAX = 64;
const fragmentCache = new LruCache<SosSsrResult>(FRAGMENT_CACHE_MAX);

export function invalidateSosRenderCache(): void {
  fragmentCache.clear();
}

function optionKey(state: SosState, options: SosRenderOptions): string {
  return JSON.stringify([
    state.tab,
    state.position,
    state.scoring,
    options.embed ?? false,
    options.linkQuery ?? "",
    // Both are the request's origin, printed into the markup.
    options.endpoint ?? "",
    options.csvBase ?? "",
  ]);
}

/** Short, stable, non-cryptographic - this only has to differ, not resist. */
function hash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i += 1) {
    h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

export async function renderSosFragment(
  state: SosState,
  options: SosRenderOptions = {},
): Promise<SosSsrResult> {
  const board = await getSosBoard(state.position, state.scoring);
  if (!board) {
    return { html: renderSosEmpty(options), version: "empty", board: null };
  }

  // The FAQ quotes the RB/PPR cards whatever the view (sos-faq.ts); the same
  // inputs as this view's board, so it is there whenever the board is.
  const rbBoard =
    board.position === "RB" && board.scoring === "ppr" ? board : await getSosBoard("RB", "ppr");
  const faq = sosFaqFacts(rbBoard);

  const key = optionKey(state, options);
  const version = `${board.version}-${rbBoard?.version ?? "x"}-${hash(key)}`;
  const hit = fragmentCache.get(key);
  if (hit && hit.version === version) return hit;

  const result: SosSsrResult = {
    html: renderSosPage(board, state, { ...options, faq }),
    version,
    board,
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
  const html = fs.readFileSync(path.join(publicDir, "sos.html"), "utf8");
  if (process.env["NODE_ENV"] !== "development") templateCache = html;
  return html;
}

export interface RenderSosAppPageOptions extends SosRenderOptions {
  canonical: string;
  /** The season to title an empty page with. */
  fallbackSeason: number;
}

export async function renderSosAppPage(
  publicDir: string,
  state: SosState,
  options: RenderSosAppPageOptions,
): Promise<SosSsrResult> {
  const template = readTemplate(publicDir);
  const fragment = await renderSosFragment(state, options);
  const copy = sosPageCopy(fragment.board?.season ?? options.fallbackSeason);

  for (const marker of [HEAD_MARKER, BODY_MARKER, CLASS_MARKER]) {
    if (!template.includes(marker)) {
      logger.warn({ marker }, "sos.html is missing an SSR marker");
    }
  }

  const html = template
    // Functions, not strings: a string replacement expands $& and $` inside
    // the content.
    .replace(HEAD_MARKER, () =>
      renderSosHeadTags({ ...copy, canonical: options.canonical }),
    )
    .replace(CLASS_MARKER, options.embed ? " is-embed" : "")
    .replace(BODY_MARKER, () => fragment.html);

  return { ...fragment, html };
}
