/**
 * Server-side rendering for the rookie hit rate tool, mirroring sos-ssr.ts.
 *
 * Two consumers:
 *   - the standalone page at /rookie-hit-rates, which fills
 *     public/rookie-hit-rates.html;
 *   - GET /embed/rookie-hit-rates, the bare fragment the WordPress plugin prints.
 *
 * There is one view to render - the default - because every other view is the
 * bundle's, computed in the browser from the same model. So the cache is one
 * entry per option set, keyed to the dataset's version.
 */

import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";
import { renderRhrEmpty, renderRhrPage, rhrPageCopy, type RhrRenderOptions } from "./rookie-hit-rates/render";
import { defaultState, getRhrData, rhrDataVersion } from "./rookie-hit-rates/data";
import { renderRhrHeadTags } from "./rookie-hit-rates-seo";
import { LruCache } from "./lru";

export interface RhrSsrResult {
  html: string;
  /** Fingerprint of everything rendered - the response ETag. */
  version: string;
  /** False when there is no dataset. */
  ok: boolean;
  firstClass: number | null;
  lastClass: number | null;
}

const fragmentCache = new LruCache<RhrSsrResult>(16);

export function invalidateRhrRenderCache(): void {
  fragmentCache.clear();
}

/** Short, stable, non-cryptographic - this only has to differ, not resist. */
function hash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i += 1) {
    h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

export function renderRhrFragment(options: RhrRenderOptions = {}): RhrSsrResult {
  const data = getRhrData();
  if (!data) {
    return { html: renderRhrEmpty(options), version: "empty", ok: false, firstClass: null, lastClass: null };
  }
  const key = JSON.stringify([options.embed ?? false, options.dataUrl ?? ""]);
  const version = `${rhrDataVersion()}-${hash(key)}`;
  const hit = fragmentCache.get(key);
  if (hit && hit.version === version) return hit;
  const result: RhrSsrResult = {
    html: renderRhrPage(data, defaultState(data), options),
    version,
    ok: true,
    firstClass: data.firstClass,
    lastClass: data.lastClass,
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
  const html = fs.readFileSync(path.join(publicDir, "rookie-hit-rates.html"), "utf8");
  if (process.env["NODE_ENV"] !== "development") templateCache = html;
  return html;
}

export interface RenderRhrAppPageOptions extends RhrRenderOptions {
  canonical: string;
}

export function renderRhrAppPage(publicDir: string, options: RenderRhrAppPageOptions): RhrSsrResult {
  const template = readTemplate(publicDir);
  const fragment = renderRhrFragment(options);
  const copy = rhrPageCopy(fragment.firstClass ?? 2017, fragment.lastClass ?? 2025);

  for (const marker of [HEAD_MARKER, BODY_MARKER, CLASS_MARKER]) {
    if (!template.includes(marker)) {
      logger.warn({ marker }, "rookie-hit-rates.html is missing an SSR marker");
    }
  }

  const html = template
    // Functions, not strings: a string replacement expands $& and $` inside
    // the content.
    .replace(HEAD_MARKER, () => renderRhrHeadTags({ ...copy, canonical: options.canonical }))
    .replace(CLASS_MARKER, options.embed ? " is-embed" : "")
    .replace(BODY_MARKER, () => fragment.html);

  return { ...fragment, html };
}
