/**
 * Server-side rendering for Fantasy Points Allowed, mirroring team-ssr.ts and
 * player-ssr.ts.
 *
 * Two consumers, as the other three tools have:
 *   - the standalone page at /fpa, which fills public/fpa.html;
 *   - GET /embed/fpa, the bare fragment the WordPress plugin prints.
 *
 * The fragment is cached per (season, format, view) on a fingerprint of the
 * snapshot rows, so a fresh ingest invalidates every rendering and nothing else
 * does. Six combinations against one small table - the bound is a guard, not a
 * working constraint.
 *
 * ## The lazy ingest
 *
 * A cold database renders nothing, which is correct but useless on a first
 * deploy, so the first request that finds no snapshots kicks off one ingest.
 * Three properties matter and are easy to get wrong:
 *
 *   - it runs ONCE. Concurrent requests share the in-flight promise rather than
 *     each starting a 7MB download;
 *   - it does not block the response. The caller gets the honest empty state
 *     immediately and the next request has data - a request that waited would
 *     hang for the length of two CSV parses;
 *   - a failure is remembered for a backoff period, so a broken upstream costs
 *     one attempt a minute rather than one per page view.
 *
 * Scheduled ingest is still the intended path - POST /api/fpa/ingest weekly,
 * or scripts/ingest-fpa.mjs against the database you mean to write to. This is
 * the safety net under it, and only that: it fires when the table is EMPTY, so
 * it can seed a cold database and can never refresh a stale one.
 */

import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";
import {
  renderFpaEmpty,
  renderFpaPage,
  TEASER_COUNT,
  type FpaRail,
  type FpaRenderOptions,
} from "./fpa-render";
import {
  getFpaTable,
  type FpaQuery,
  type FpaTableData,
} from "./fpa/fpa-data";
import { FANTASY_POSITIONS, type FantasyPosition } from "./fpa/nflverse";
import { fpaPageMeta, renderFpaHeadTags } from "./fpa-seo";
import { LruCache } from "./lru";
import { currentAssetOrigin } from "./asset-origin";
import { DEFAULT_STATE, getSosBoard, rosEasiest } from "./sos/sos-data";

export interface FpaSsrResult {
  html: string;
  /** Fingerprint of everything rendered - the response ETag. */
  version: string;
  /** Null when nothing is ingested; the caller decides what to do about it. */
  data: FpaTableData | null;
}

const FRAGMENT_CACHE_MAX = 24;
const fragmentCache = new LruCache<FpaSsrResult>(FRAGMENT_CACHE_MAX);

export function invalidateFpaRenderCache(): void {
  fragmentCache.clear();
}

/* ------------------------------------------------------------ lazy ingest */

let kicking = false;
let lastFailureAt = 0;
let lastSuccessAt = 0;
const FAILURE_BACKOFF_MS = 60_000;
/**
 * A run that succeeded and still left the default table empty (a season
 * rollover before its first games, say) would otherwise be followed by
 * another, and another, one per request.
 */
const SUCCESS_BACKOFF_MS = 60 * 60_000;

function kickLazyIngest(): void {
  if (kicking) return;
  if (Date.now() - lastFailureAt < FAILURE_BACKOFF_MS) return;
  if (Date.now() - lastSuccessAt < SUCCESS_BACKOFF_MS) return;

  kicking = true;
  logger.warn("No FPA snapshots found - starting a one-time background ingest");

  // Imported lazily so the ingest's nflverse code is not on the startup path of
  // a deployment that never needs it. What happens next belongs to
  // fpa/refresh.ts, which is also what POST /api/fpa/ingest calls: it holds the
  // one-at-a-time guarantee across both paths, drops every cache an ingest
  // invalidates, and records the outcome for /api/status.
  void import("./fpa/refresh")
    .then((m) => m.refreshFpa())
    .then(({ result, joined }) => {
      lastSuccessAt = Date.now();
      logger.info({ result, joined }, "Lazy FPA ingest finished");
    })
    .catch((err) => {
      lastFailureAt = Date.now();
      logger.error({ err }, "Lazy FPA ingest failed");
    })
    .finally(() => {
      kicking = false;
    });
}

/* -------------------------------------------------------------- the rail */

/**
 * The rail's teaser: the easiest remaining schedules per position, read from
 * the SAME boards the linked pages render, through the same helper their
 * answer sentence uses (rosEasiest), in the scoring those pages open on. One
 * computation, so the teaser and the top of the page it links to cannot
 * disagree. The version is the boards' own, so a schedule moving a week
 * forward refreshes the fragment the way a new ingest does.
 *
 * Only the live table has a rest of season. An archive, or any board that
 * cannot be built (no schedule yet), leaves the rail to its six links.
 */
async function railFor(data: FpaTableData): Promise<{ rail: FpaRail; version: string }> {
  if (data.kind !== "live") return { rail: { teaser: null }, version: "" };
  try {
    const boards = await Promise.all(
      FANTASY_POSITIONS.map((p) => getSosBoard(p, DEFAULT_STATE.scoring)),
    );
    const teaser = {} as NonNullable<FpaRail["teaser"]>;
    const versions: string[] = [];
    for (const [i, p] of FANTASY_POSITIONS.entries()) {
      const board = boards[i];
      if (!board) return { rail: { teaser: null }, version: "" };
      versions.push(board.version);
      const easiest = rosEasiest(board, TEASER_COUNT);
      const top = easiest[0];
      if (!top || !top.ros) return { rail: { teaser: null }, version: "" };
      // The delta is against the mean of every team with a rest of season,
      // as the SOS page's own cards figure theirs.
      const withRos = board.teams.filter((t) => t.ros !== null);
      const mean = withRos.reduce((a, t) => a + t.ros!.afpa, 0) / Math.max(1, withRos.length);
      teaser[p as FantasyPosition] = {
        top: {
          code: top.team.code,
          fullName: top.team.fullName,
          logo: top.team.logo,
          afpa: top.ros.afpa,
          delta: top.ros.afpa - mean,
        },
        easiest: easiest.map((row) => ({ code: row.team.code, fullName: row.team.fullName })),
      };
    }
    return { rail: { teaser }, version: versions.join(".") };
  } catch (err) {
    logger.warn({ err }, "FPA rail: the strength-of-schedule boards did not build; rail links only");
    return { rail: { teaser: null }, version: "" };
  }
}

/* ------------------------------------------------------------- the render */

function optionKey(query: FpaQuery, options: FpaRenderOptions): string {
  return JSON.stringify([
    // The request's asset origin: every crest in the table and the rail is
    // printed with it (lib/asset-origin.ts), and the standalone page's other
    // options are the same on every host. Without this, a localhost curl
    // cached crests at http://localhost:8080/... for the preview domain, and
    // the table showed no logos (the team hub had the same bug, 2026-10-23).
    currentAssetOrigin(),
    query.season ?? 0,
    query.format ?? "half",
    query.view ?? "raw",
    options.embed ?? false,
    options.basePath ?? "",
    options.teamPathPrefix ?? "",
    options.linkQuery ?? "",
    // Both are the request's origin, printed into the markup. Leaving them out
    // served the first caller's origin to everyone.
    options.endpoint ?? "",
    options.csvBase ?? "",
    options.sosBase ?? "",
  ]);
}

export async function renderFpaFragment(
  query: FpaQuery = {},
  options: FpaRenderOptions = {},
): Promise<FpaSsrResult> {
  const key = optionKey(query, options);
  const data = await getFpaTable(query);

  if (!data) {
    // Only for the default table. `season` comes off the query string, and an
    // ingest never writes a season it was not configured for, so a request for
    // ?season=2099 would re-run the whole ingest without ever filling it.
    if (query.season === undefined) kickLazyIngest();
    return { html: renderFpaEmpty(options), version: "empty", data: null };
  }

  const { rail, version: railVersion } = await railFor(data);
  const version = `${data.version}-${hash(key + railVersion)}`;
  const hit = fragmentCache.get(key);
  if (hit && hit.version === version) return hit;

  const result: FpaSsrResult = {
    html: renderFpaPage(data, options, rail),
    version,
    data,
  };
  fragmentCache.set(key, result);
  return result;
}

/** Short, stable, non-cryptographic - this only has to differ, not resist. */
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
  const html = fs.readFileSync(path.join(publicDir, "fpa.html"), "utf8");
  if (process.env["NODE_ENV"] !== "development") templateCache = html;
  return html;
}

export interface RenderFpaAppPageOptions extends FpaRenderOptions {
  canonical: string;
}

export async function renderFpaAppPage(
  publicDir: string,
  query: FpaQuery,
  options: RenderFpaAppPageOptions,
): Promise<FpaSsrResult> {
  const template = readTemplate(publicDir);
  const fragment = await renderFpaFragment(query, options);
  const meta = fpaPageMeta(fragment.data, options.canonical);

  for (const marker of [HEAD_MARKER, BODY_MARKER, CLASS_MARKER]) {
    if (!template.includes(marker)) {
      logger.warn({ marker }, "fpa.html is missing an SSR marker");
    }
  }

  const html = template
    // Functions, not strings: a string replacement expands $& and $` inside
    // the content, so a headline carrying one rewrote the page.
    .replace(HEAD_MARKER, () => renderFpaHeadTags(meta))
    .replace(CLASS_MARKER, options.embed ? " is-embed" : "")
    .replace(BODY_MARKER, () => fragment.html);

  return { ...fragment, html };
}
