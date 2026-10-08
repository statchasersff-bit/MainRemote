/**
 * The <img> for a headshot on the server-rendered surfaces that are not the
 * news tool: the team hub's roster, outlook, depth and news cards, the player
 * page's hero and peer rail, the handcuff board. (The news tool's own card is
 * in lib/render.ts, which runs in the browser too and so cannot use this.)
 *
 * Given the Sleeper URL the data carries, prints the StatChasers-hosted,
 * versioned WebP derivatives for it (lib/image-urls.ts): absolute for the
 * current request's origin, with the version from the store, and `latest`
 * for a player the store has not met - whose resolution is kicked off in the
 * background so the next render has it. A player Sleeper has no photo for
 * prints nothing, so each caller can draw its own empty well. The same for
 * an ESPN headshot (the depth charts) and a club's editorial art (the club
 * feeds): anything imageKeyFor() recognises. An image from any other host is
 * printed as the data supplied it.
 */

import { assetUrl } from "./asset-origin";
import {
  HEADSHOT_VARIANTS,
  headshotSrcset,
  imageKeyFor,
  imagePath,
  isVariantFor,
  parseImageKey,
  type HeadshotVariant,
} from "./image-urls";
import { enqueueImageResolve, imageVersionFor } from "./image-versions";
import { escapeHtml } from "./render";

export interface HeadshotImgOptions {
  /** The Sleeper, ESPN or club-art URL (or any image URL) the data carries. */
  src: string | null | undefined;
  /** The image key (a bare Sleeper id is one), when the caller has it and `src` may be empty. */
  id?: string | null;
  className: string;
  alt: string;
  /**
   * Variants to offer, smallest first; those the image's source does not
   * produce are dropped, so a caller can name the club bands and the Sleeper
   * band together. The first survivor is `src`.
   */
  variants: readonly HeadshotVariant[];
  /** The `sizes` attribute, when more than one variant is offered. */
  sizes?: string;
  /** The attributes' aspect hint. Defaults to the first variant's pixels. */
  width?: number;
  height?: number;
  loading?: "lazy" | "eager";
  decoding?: "async" | "sync" | "auto";
  fetchpriority?: "high" | "low";
  /** Anything else, already escaped, e.g. ` aria-hidden="true"`. */
  extra?: string;
}

/**
 * The <img>, or null when the player is known to have no photo (or there is
 * nothing to point at). Callers decide what an absent photo looks like.
 */
export function headshotImg(options: HeadshotImgOptions): string | null {
  const key = options.id ?? imageKeyFor(options.src);
  const parts = parseImageKey(key);
  const variants = parts ? options.variants.filter((v) => isVariantFor(parts.source, v)) : [];
  const first = variants[0];
  const shape = first ? HEADSHOT_VARIANTS[first] : null;
  const width = options.width ?? shape?.width ?? 0;
  const height = options.height ?? shape?.height ?? 0;
  const common =
    ` alt="${escapeHtml(options.alt)}"` +
    (width && height ? ` width="${width}" height="${height}"` : "") +
    (options.loading ? ` loading="${options.loading}"` : "") +
    ` decoding="${options.decoding ?? "async"}"` +
    (options.fetchpriority ? ` fetchpriority="${options.fetchpriority}"` : "") +
    (options.extra ?? "");

  if (!key || !parts || !first) {
    if (!options.src) return null;
    return `<img class="${options.className}" src="${escapeHtml(options.src)}"${common} />`;
  }

  const version = imageVersionFor(key);
  if (version === null) return null;
  if (version === undefined) void enqueueImageResolve(key);

  const src = assetUrl(imagePath(key, version, first));
  const srcset =
    variants.length > 1
      ? ` srcset="${escapeHtml(headshotSrcset(key, version, variants, assetUrl("")))}"` +
        (options.sizes ? ` sizes="${escapeHtml(options.sizes)}"` : "")
      : "";
  return `<img class="${options.className}" src="${escapeHtml(src)}"${srcset}${common} />`;
}
