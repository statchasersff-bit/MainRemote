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
import {
  renderSosEmpty,
  renderSosPage,
  sosAnswerFor,
  sosPageCopy,
  type SosRenderOptions,
} from "./sos-render";
import {
  getSosBoard,
  SOS_POSITIONS,
  stateForPage,
  type SosBoard,
  type SosState,
} from "./sos/sos-data";
import { fpaSnapshotState } from "./fpa/fpa-data";
import type { FantasyPosition } from "./fpa/nflverse";
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
    options.page ?? "all",
    options.pageBase ?? "",
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

/**
 * One page's fragment. `state` is the view asked for; a position page pins the
 * position to its own and the playoffs page pins the Team tab (stateForPage),
 * so the caller may pass the raw query and get the page's board back.
 */
export async function renderSosFragment(
  requested: SosState,
  options: SosRenderOptions = {},
): Promise<SosSsrResult> {
  const page = options.page ?? "all";
  const state = stateForPage(page, requested);
  const board = await getSosBoard(state.position, state.scoring);
  if (!board) {
    return { html: renderSosEmpty(options), version: "empty", board: null };
  }

  // The overview's FAQ quotes the RB/PPR cards whatever the view (sos-faq.ts);
  // the same inputs as this view's board, so it is there whenever the board is.
  const rbBoard =
    page !== "all"
      ? null
      : board.position === "RB" && board.scoring === "ppr"
        ? board
        : await getSosBoard("RB", "ppr");
  const faq = page === "all" ? sosFaqFacts(rbBoard) : null;

  // The playoffs page reads every position's Weeks 15-17 at once.
  let boards: Partial<Record<FantasyPosition, SosBoard>> | undefined;
  if (page === "playoffs") {
    boards = {};
    for (const pos of SOS_POSITIONS) {
      const b = pos === board.position ? board : await getSosBoard(pos, state.scoring);
      if (b) boards[pos] = b;
    }
  }

  // The sub-pages carry an "Updated" line: the FPA table's own write time,
  // which is when the board last moved.
  const updatedAt = page === "all" ? null : (await fpaSnapshotState(board.season)).writtenAtMs;

  const key = optionKey(state, options);
  const versions = [
    board.version,
    rbBoard?.version ?? "x",
    ...(boards ? SOS_POSITIONS.map((p) => boards?.[p]?.version ?? "x") : []),
    updatedAt ?? "x",
  ];
  const version = `${versions.join("-")}-${hash(key)}`;
  const hit = fragmentCache.get(key);
  if (hit && hit.version === version) return hit;

  const result: SosSsrResult = {
    html: renderSosPage(board, state, { ...options, faq, boards, updatedAt }),
    version,
    board,
  };
  fragmentCache.set(key, result);
  return result;
}

/** The boards a page's copy is built from, for the head tags: the playoff page's four, else the one. */
async function boardsForCopy(
  page: SosRenderOptions["page"],
  board: SosBoard,
): Promise<Partial<Record<FantasyPosition, SosBoard>> | undefined> {
  if (page !== "playoffs") return undefined;
  const out: Partial<Record<FantasyPosition, SosBoard>> = {};
  for (const pos of SOS_POSITIONS) {
    const b = pos === board.position ? board : await getSosBoard(pos, board.scoring);
    if (b) out[pos] = b;
  }
  return out;
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
  const page = options.page ?? "all";
  const season = fragment.board?.season ?? options.fallbackSeason;
  const answer = fragment.board
    ? sosAnswerFor(page, fragment.board, await boardsForCopy(page, fragment.board))
    : "";
  const copy = sosPageCopy(season, page, answer);

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
