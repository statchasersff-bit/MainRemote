/**
 * Player headshots: where the browser is sent for them, and what it is told
 * about them before they arrive.
 *
 * Every headshot the app shows is a Sleeper thumbnail - a 350x254 PNG with a
 * transparent background, served as image/jpeg - and the cards used to point
 * straight at it, downloading the whole file to draw a 108px square. Now they
 * point at this server:
 *
 *   /news-image/player/<sleeperId>/<version>/<size>.webp
 *
 * which serves a resized WebP built once from the original (lib/image-cache.ts,
 * routes/images.ts). `version` is derived from the original's bytes, so the
 * URL changes when Sleeper replaces a photo and is otherwise safe to cache for
 * a year; `latest` stands in for a version the renderer does not know yet and
 * is answered with a short-lived redirect to the versioned URL. Only the sizes
 * below exist, so a URL can never ask for an arbitrary dimension.
 *
 * Pure on purpose: render.ts runs in the browser bundle as well as on the
 * server, so everything here is string arithmetic. Fetching, resizing, the
 * version store and caching live in server-only modules.
 */

/**
 * The derivatives the route produces, by the token that names each in the
 * URL. The plain numbers are the SQUARE crops the cards and wells draw -
 * cover-fit and anchored at the top, which is exactly what `object-fit:
 * cover; object-position: center top` did to the landscape original. The
 * `f` sizes keep the full 350x254 figure for the player page hero, and the
 * `b` size is the 16:9 band the team hub's news tab cuts.
 */
export const HEADSHOT_VARIANTS = {
  "160": { width: 160, height: 160 },
  "256": { width: 256, height: 256 },
  "320": { width: 320, height: 320 },
  f160: { width: 160, height: 116 },
  f200: { width: 200, height: 145 },
  f350: { width: 350, height: 254 },
  b350: { width: 350, height: 197 },
} as const;

export type HeadshotVariant = keyof typeof HEADSHOT_VARIANTS;

/** The three square widths a news card offers: 1x, between, and 2x-3x phones. */
export const CARD_HEADSHOT_VARIANTS: readonly HeadshotVariant[] = ["160", "256", "320"];

/** The version token for "whatever Sleeper has now"; answered with a redirect. */
export const LATEST_VERSION = "latest";

/**
 * The card thumbnail is a 108px square, 80px under 640px. The derivatives are
 * square too, so `sizes` is simply the box: 160w on a 1x desktop, 256w on a
 * 2x one, 256w on a 3x phone.
 */
export const HEADSHOT_SIZES = "(max-width: 640px) 80px, 108px";

/** The shape of the Sleeper original, for the full-figure variants' ratio. */
export const HEADSHOT_SOURCE_WIDTH = 350;
export const HEADSHOT_SOURCE_HEIGHT = 254;

const SLEEPER_THUMB =
  /^https?:\/\/(?:[a-z0-9-]+\.)?sleepercdn\.com\/content\/nfl\/players\/thumb\/(\d{1,12})\.(?:jpe?g|png|webp)(?:[?#].*)?$/i;

const VERSION = /^[0-9a-f]{6,16}$/;

/**
 * The Sleeper player id in a headshot URL, or null for anything that is not a
 * Sleeper thumb. Only a thumb is rewritten: an image from anywhere else is
 * left as the feed supplied it, because the image route is not an open proxy.
 */
export function sleeperHeadshotId(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = SLEEPER_THUMB.exec(url.trim());
  return match?.[1] ?? null;
}

export function isHeadshotVariant(token: string): token is HeadshotVariant {
  return Object.prototype.hasOwnProperty.call(HEADSHOT_VARIANTS, token);
}

export function isImageVersion(token: string): boolean {
  return token === LATEST_VERSION || VERSION.test(token);
}

/** An origin with no trailing slash, or "" for same-origin (relative) paths. */
export function assetOrigin(origin: string | null | undefined): string {
  return (origin ?? "").trim().replace(/\/+$/, "");
}

/** The path of one derivative. An unknown version asks for `latest`. */
export function headshotPath(
  id: string,
  version: string | null | undefined,
  variant: HeadshotVariant,
): string {
  return `/news-image/player/${id}/${version || LATEST_VERSION}/${variant}.webp`;
}

/** A srcset over the given variants, each with its width descriptor. */
export function headshotSrcset(
  id: string,
  version: string | null | undefined,
  variants: readonly HeadshotVariant[],
  origin = "",
): string {
  const base = assetOrigin(origin);
  return variants
    .map((v) => `${base}${headshotPath(id, version, v)} ${HEADSHOT_VARIANTS[v].width}w`)
    .join(", ");
}

export interface HeadshotSources {
  src: string;
  srcset: string;
  sizes: string;
  width: number;
  height: number;
}

/**
 * Everything a news card's <img> needs for one headshot. `src` is the
 * smallest square, for anything that ignores srcset; `width`/`height` are
 * that square's pixels, so the 1:1 ratio is on the element before any bytes
 * arrive (the box itself is sized by the stylesheet).
 */
export function headshotSources(
  id: string,
  version: string | null | undefined,
  origin = "",
): HeadshotSources {
  const smallest = CARD_HEADSHOT_VARIANTS[0]!;
  return {
    src: `${assetOrigin(origin)}${headshotPath(id, version, smallest)}`,
    srcset: headshotSrcset(id, version, CARD_HEADSHOT_VARIANTS, origin),
    sizes: HEADSHOT_SIZES,
    width: HEADSHOT_VARIANTS[smallest].width,
    height: HEADSHOT_VARIANTS[smallest].height,
  };
}
