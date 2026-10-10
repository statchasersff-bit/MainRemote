/**
 * Server-side rendering for the redraft strategy analyzer, mirroring
 * rookie-hit-rates-ssr.ts.
 *
 * Two consumers:
 *   - the standalone page at /redraft-strategy, which fills
 *     public/redraft-strategy.html;
 *   - GET /embed/redraft-strategy, the bare fragment the WordPress plugin prints.
 *
 * There is one view to render - the default - because every other view is the
 * bundle's, drawn in the browser from the data routes with the same renderer.
 * So the cache is one entry per option set, keyed to the dataset's version.
 */

import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";
import { isPlayerId, renderRdsEmpty, renderRdsPage, rdsPageCopy, type RdsRenderOptions } from "./redraft-strategy/render";
import { defaultState, getRdsData, rdsDataVersion } from "./redraft-strategy/data";
import { renderRdsHeadTags } from "./redraft-strategy-seo";
import { LruCache } from "./lru";
import { currentAssetOrigin } from "./asset-origin";
import { enqueueImageResolve, imageVersionFor, imageVersionsEpoch, onImageVersionsChanged } from "./image-versions";
import type { Board, RdsAssets } from "./redraft-strategy/model";

export interface RdsSsrResult {
  html: string;
  /** Fingerprint of everything rendered - the response ETag. */
  version: string;
  /** False when there is no dataset. */
  ok: boolean;
}

const fragmentCache = new LruCache<RdsSsrResult>(8);

export function invalidateRdsRenderCache(): void {
  fragmentCache.clear();
}

// A learned headshot version changes the avatar URLs the board prints.
onImageVersionsChanged(invalidateRdsRenderCache);

/**
 * Where the browser finds this server's headshots, and which version each
 * pick's photo is at. Players the store has not met yet are left out (the
 * renderer prints `latest`) and queued for resolution in the background.
 */
export function rdsAssets(boards: Board[]): RdsAssets {
  const headshots: Record<string, string | null> = {};
  for (const b of boards) {
    for (const p of b.picks) {
      const id = p.player_id;
      if (!id || !isPlayerId(id) || id in headshots) continue;
      const version = imageVersionFor(id);
      if (version === undefined) {
        void enqueueImageResolve(id);
        continue;
      }
      headshots[id] = version;
    }
  }
  return { origin: currentAssetOrigin(), headshots };
}

/** Short, stable, non-cryptographic - this only has to differ, not resist. */
function hash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i += 1) {
    h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

export function renderRdsFragment(options: RdsRenderOptions = {}): RdsSsrResult {
  const data = getRdsData();
  if (!data) return { html: renderRdsEmpty(options), version: "empty", ok: false };
  // The origin and the known headshot versions are in the markup, so they
  // key the cache alongside the options.
  const assets = rdsAssets(data.boards);
  const key = JSON.stringify([options.embed ?? false, options.dataUrl ?? "", assets.origin]);
  const version = `${rdsDataVersion()}-${imageVersionsEpoch()}-${hash(key)}`;
  const hit = fragmentCache.get(key);
  if (hit && hit.version === version) return hit;
  const result: RdsSsrResult = { html: renderRdsPage({ ...data, assets }, defaultState(), options), version, ok: true };
  fragmentCache.set(key, result);
  return result;
}

const HEAD_MARKER = "<!--SSR-HEAD-->";
const BODY_MARKER = "<!--SSR-->";
const CLASS_MARKER = "<!--SSR-BODY-CLASS-->";

let templateCache: string | null = null;

function readTemplate(publicDir: string): string {
  if (templateCache !== null) return templateCache;
  const html = fs.readFileSync(path.join(publicDir, "redraft-strategy.html"), "utf8");
  if (process.env["NODE_ENV"] !== "development") templateCache = html;
  return html;
}

export interface RenderRdsAppPageOptions extends RdsRenderOptions {
  canonical: string;
}

export function renderRdsAppPage(publicDir: string, options: RenderRdsAppPageOptions): RdsSsrResult {
  const template = readTemplate(publicDir);
  const fragment = renderRdsFragment(options);
  const copy = rdsPageCopy();

  for (const marker of [HEAD_MARKER, BODY_MARKER, CLASS_MARKER]) {
    if (!template.includes(marker)) logger.warn({ marker }, "redraft-strategy.html is missing an SSR marker");
  }

  const html = template
    // Functions, not strings: a string replacement expands $& and $` inside
    // the content.
    .replace(HEAD_MARKER, () => renderRdsHeadTags({ ...copy, canonical: options.canonical }))
    .replace(CLASS_MARKER, options.embed ? " is-embed" : "")
    .replace(BODY_MARKER, () => fragment.html);

  return { ...fragment, html };
}
