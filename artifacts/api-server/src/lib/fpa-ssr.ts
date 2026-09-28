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
 * does. Six combinations against one small table — the bound is a guard, not a
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
 *     immediately and the next request has data — a request that waited would
 *     hang for the length of two CSV parses;
 *   - a failure is remembered for a backoff period, so a broken upstream costs
 *     one attempt a minute rather than one per page view.
 *
 * Scheduled ingest is still the intended path — POST /api/fpa/ingest weekly,
 * or scripts/ingest-fpa.mjs against the database you mean to write to. This is
 * the safety net under it, and only that: it fires when the table is EMPTY, so
 * it can seed a cold database and can never refresh a stale one.
 */

import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";
import { renderFpaEmpty, renderFpaPage, type FpaRenderOptions } from "./fpa-render";
import {
  getFpaTable,
  type FpaQuery,
  type FpaTableData,
} from "./fpa/fpa-data";
import { fpaPageMeta, renderFpaHeadTags } from "./fpa-seo";

export interface FpaSsrResult {
  html: string;
  /** Fingerprint of everything rendered — the response ETag. */
  version: string;
  /** Null when nothing is ingested; the caller decides what to do about it. */
  data: FpaTableData | null;
}

const fragmentCache = new Map<string, FpaSsrResult>();
const FRAGMENT_CACHE_MAX = 24;

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
  logger.warn("No FPA snapshots found — starting a one-time background ingest");

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

/* ------------------------------------------------------------- the render */

function optionKey(query: FpaQuery, options: FpaRenderOptions): string {
  return JSON.stringify([
    query.season ?? 0,
    query.format ?? "half",
    query.view ?? "raw",
    options.embed ?? false,
    options.basePath ?? "",
    options.teamPathPrefix ?? "",
    options.linkQuery ?? "",
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

  const version = `${data.version}-${hash(key)}`;
  const hit = fragmentCache.get(key);
  if (hit && hit.version === version) return hit;

  const result: FpaSsrResult = {
    html: renderFpaPage(data, options),
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
    .replace(HEAD_MARKER, renderFpaHeadTags(meta))
    .replace(CLASS_MARKER, options.embed ? " is-embed" : "")
    .replace(BODY_MARKER, fragment.html);

  return { ...fragment, html };
}
