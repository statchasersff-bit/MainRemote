/**
 * Server-side rendering for the injury tools, mirroring redraft-strategy-ssr.ts.
 *
 * Two pages, each with two consumers:
 *   - the standalone pages at /injury-impact and /injury-database, which fill
 *     public/injury-impact.html and public/injury-database.html;
 *   - GET /embed/injury-impact and /embed/injury-database, the bare fragments
 *     the WordPress plugin prints.
 *
 * Both pages are the same seven-tab tool (render-tool.ts), opened on a
 * different tab. There is one view to render per page - the default -
 * because every other view is the bundle's, drawn in the browser with the
 * same renderers from the data slices. So the cache is one entry per option
 * set, keyed to the dataset's version and the image epoch.
 */

import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";
import { LruCache } from "./lru";
import { currentAssetOrigin } from "./asset-origin";
import { enqueueImageResolve, imageVersionFor, imageVersionsEpoch, onImageVersionsChanged } from "./image-versions";
import { getDurability, getInjuryDataset, injuryDataVersion, photoIdsFor } from "./injury-impact/data";
import { renderInjuryEmpty } from "./injury-impact/render";
import { printedPlayerIds, renderInjuryTool } from "./injury-impact/render-tool";
import { injuryPageCopy, type InjuryPage, type InjuryRenderOptions } from "./injury-impact/render-shared";
import type { InjuryAssets } from "./injury-impact/types";
import { renderInjuryHeadTags } from "./injury-impact-seo";

export interface InjurySsrResult {
  html: string;
  /** Fingerprint of everything rendered - the response ETag. */
  version: string;
  /** False when there is no dataset. */
  ok: boolean;
}

const fragmentCache = new LruCache<InjurySsrResult>(8);

export function invalidateInjuryRenderCache(): void {
  fragmentCache.clear();
}

onImageVersionsChanged(invalidateInjuryRenderCache);

/**
 * Where the browser finds this server's headshots, and which version each
 * player's photo is at, for a list of GSIS ids. Players the image store has
 * not met yet are left out (the renderer prints `latest`) and queued.
 */
export function injuryAssets(gsisIds: Iterable<string | null | undefined>): InjuryAssets {
  const sleeper = photoIdsFor(gsisIds);
  const headshots: Record<string, string | null> = {};
  for (const id of Object.values(sleeper)) {
    if (id in headshots) continue;
    const version = imageVersionFor(id);
    if (version === undefined) {
      void enqueueImageResolve(id);
      continue;
    }
    headshots[id] = version;
  }
  return { origin: currentAssetOrigin(), headshots, sleeper };
}

/** Short, stable, non-cryptographic - this only has to differ, not resist. */
function hash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i += 1) {
    h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

export function renderInjuryFragment(page: InjuryPage, options: InjuryRenderOptions = {}): InjurySsrResult {
  const ds = getInjuryDataset();
  if (!ds) return { html: renderInjuryEmpty(page, options), version: "empty", ok: false };
  const key = JSON.stringify([page, options.embed ?? false, options.dataUrl ?? "", options.siblingUrl ?? "", currentAssetOrigin()]);
  const version = `${injuryDataVersion()}-${imageVersionsEpoch()}-${hash(key)}`;
  const hit = fragmentCache.get(key);
  if (hit && hit.version === version) return hit;
  const d = getDurability();
  const assets = injuryAssets(printedPlayerIds(d));
  const html = renderInjuryTool({ page, ds, d }, { ...options, assets });
  const result: InjurySsrResult = { html, version, ok: true };
  fragmentCache.set(key, result);
  return result;
}

const HEAD_MARKER = "<!--SSR-HEAD-->";
const BODY_MARKER = "<!--SSR-->";
const CLASS_MARKER = "<!--SSR-BODY-CLASS-->";

const templateCache = new Map<string, string>();

function readTemplate(publicDir: string, file: string): string {
  const cached = templateCache.get(file);
  if (cached !== undefined) return cached;
  const html = fs.readFileSync(path.join(publicDir, file), "utf8");
  if (process.env["NODE_ENV"] !== "development") templateCache.set(file, html);
  return html;
}

export interface RenderInjuryAppPageOptions extends InjuryRenderOptions {
  canonical: string;
}

export function renderInjuryAppPage(page: InjuryPage, publicDir: string, options: RenderInjuryAppPageOptions): InjurySsrResult {
  const file = page === "database" ? "injury-database.html" : "injury-impact.html";
  const template = readTemplate(publicDir, file);
  const fragment = renderInjuryFragment(page, options);
  const copy = injuryPageCopy(page);

  for (const marker of [HEAD_MARKER, BODY_MARKER, CLASS_MARKER]) {
    if (!template.includes(marker)) logger.warn({ marker, file }, "injury template is missing an SSR marker");
  }

  const html = template
    .replace(HEAD_MARKER, () => renderInjuryHeadTags({ ...copy, canonical: options.canonical }))
    .replace(CLASS_MARKER, options.embed ? " is-embed" : "")
    .replace(BODY_MARKER, () => fragment.html);

  return { ...fragment, html };
}
