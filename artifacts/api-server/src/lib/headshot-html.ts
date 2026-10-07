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
 * prints nothing, so each caller can draw its own empty well. An image that is
 * not a Sleeper thumb is printed as the data supplied it.
 */

import { assetUrl } from "./asset-origin";
import {
  HEADSHOT_VARIANTS,
  headshotPath,
  headshotSrcset,
  sleeperHeadshotId,
  type HeadshotVariant,
} from "./image-urls";
import { enqueueImageResolve, imageVersionFor } from "./image-versions";
import { escapeHtml } from "./render";

export interface HeadshotImgOptions {
  /** The Sleeper thumb URL (or any image URL) the data carries. */
  src: string | null | undefined;
  /** The Sleeper id, when the caller has it and `src` may be empty. */
  id?: string | null;
  className: string;
  alt: string;
  /** Variants to offer, smallest first. The first is `src`. */
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
  const first = options.variants[0];
  if (!first) return null;
  const shape = HEADSHOT_VARIANTS[first];
  const width = options.width ?? shape.width;
  const height = options.height ?? shape.height;
  const common =
    ` alt="${escapeHtml(options.alt)}" width="${width}" height="${height}"` +
    (options.loading ? ` loading="${options.loading}"` : "") +
    ` decoding="${options.decoding ?? "async"}"` +
    (options.fetchpriority ? ` fetchpriority="${options.fetchpriority}"` : "") +
    (options.extra ?? "");

  const id = options.id ?? sleeperHeadshotId(options.src);
  if (!id) {
    if (!options.src) return null;
    return `<img class="${options.className}" src="${escapeHtml(options.src)}"${common} />`;
  }

  const version = imageVersionFor(id);
  if (version === null) return null;
  if (version === undefined) void enqueueImageResolve(id);

  const src = assetUrl(headshotPath(id, version, first));
  const srcset =
    options.variants.length > 1
      ? ` srcset="${escapeHtml(headshotSrcset(id, version, options.variants, assetUrl("")))}"` +
        (options.sizes ? ` sizes="${escapeHtml(options.sizes)}"` : "")
      : "";
  return `<img class="${options.className}" src="${escapeHtml(src)}"${srcset}${common} />`;
}
