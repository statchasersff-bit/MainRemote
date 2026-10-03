/**
 * Server-side rendering for the RB handcuff rankings, mirroring
 * player-stats-ssr.ts.
 *
 * Three consumers:
 *   - the standalone page at /rb-handcuff-rankings, which fills
 *     public/rb-handcuffs.html;
 *   - GET /embed/rb-handcuffs, the bare fragment the WordPress plugin prints;
 *   - GET /embed/rb-handcuffs/player/:id, one player's card, which the bundle
 *     fetches when a reader opens it.
 *
 * The fragment is cached per option set against the board's version, which
 * changes when any file under `data/rb-handcuffs/` does (or when the injury
 * statuses go stale), and nothing else invalidates it.
 */

import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";
import {
  renderHandcuffCard,
  renderHandcuffEmpty,
  renderHandcuffPage,
  type HandcuffRenderOptions,
} from "./rb-handcuffs-render";
import {
  getHandcuffBoard,
  getHandcuffPlayer,
  type HandcuffBoard,
} from "./rb-handcuffs/handcuffs-data";
import { handcuffPageMeta, renderHandcuffHeadTags } from "./rb-handcuffs-seo";
import { LruCache } from "./lru";

export interface HandcuffSsrResult {
  html: string;
  /** Fingerprint of everything rendered - the response ETag. */
  version: string;
  /** Null when the board could not be built. */
  board: HandcuffBoard | null;
}

const FRAGMENT_CACHE_MAX = 16;
const fragmentCache = new LruCache<HandcuffSsrResult>(FRAGMENT_CACHE_MAX);

export function invalidateHandcuffRenderCache(): void {
  fragmentCache.clear();
}

function optionKey(options: HandcuffRenderOptions): string {
  return JSON.stringify([
    options.embed ?? false,
    options.playerPathPrefix ?? "",
    options.linkQuery ?? "",
    options.endpoint ?? "",
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

export function renderHandcuffFragment(
  options: HandcuffRenderOptions = {},
): HandcuffSsrResult {
  const board = getHandcuffBoard();
  if (!board) {
    return { html: renderHandcuffEmpty(options), version: "empty", board: null };
  }

  const key = optionKey(options);
  const version = `${board.version}-${hash(key)}`;
  const hit = fragmentCache.get(key);
  if (hit && hit.version === version) return hit;

  const result: HandcuffSsrResult = {
    html: renderHandcuffPage(board, options),
    version,
    board,
  };
  fragmentCache.set(key, result);
  return result;
}

/** One player's card, or null when there is no such player. */
export function renderHandcuffCardFragment(
  id: string,
  options: HandcuffRenderOptions = {},
): { html: string; version: string } | null {
  const board = getHandcuffBoard();
  const player = board ? getHandcuffPlayer(id) : null;
  if (!board || !player) return null;
  return {
    html: renderHandcuffCard(player, options, board.statusFresh, board.statsSeason),
    version: `${board.version}-${hash(`${id}|${optionKey(options)}`)}`,
  };
}

const HEAD_MARKER = "<!--SSR-HEAD-->";
const BODY_MARKER = "<!--SSR-->";
const CLASS_MARKER = "<!--SSR-BODY-CLASS-->";

let templateCache: string | null = null;

function readTemplate(publicDir: string): string {
  if (templateCache !== null) return templateCache;
  const html = fs.readFileSync(path.join(publicDir, "rb-handcuffs.html"), "utf8");
  if (process.env["NODE_ENV"] !== "development") templateCache = html;
  return html;
}

export interface RenderHandcuffAppPageOptions extends HandcuffRenderOptions {
  canonical: string;
}

export function renderHandcuffAppPage(
  publicDir: string,
  options: RenderHandcuffAppPageOptions,
): HandcuffSsrResult {
  const template = readTemplate(publicDir);
  const fragment = renderHandcuffFragment(options);
  const meta = handcuffPageMeta(fragment.board, options.canonical);

  for (const marker of [HEAD_MARKER, BODY_MARKER, CLASS_MARKER]) {
    if (!template.includes(marker)) {
      logger.warn({ marker }, "rb-handcuffs.html is missing an SSR marker");
    }
  }

  const html = template
    // Functions, not strings: a string replacement expands $& and $` inside
    // the content, so a headline carrying one rewrote the page.
    .replace(HEAD_MARKER, () => renderHandcuffHeadTags(meta))
    .replace(CLASS_MARKER, options.embed ? " is-embed" : "")
    .replace(BODY_MARKER, () => fragment.html);

  return { ...fragment, html };
}
