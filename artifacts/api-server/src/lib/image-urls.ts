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
 * Three sources, named by the path's first segment, and nothing else - the
 * route is not a resizing proxy for arbitrary URLs:
 *
 *   player  Sleeper's 350x254 thumb, by Sleeper id         (news, hub, players)
 *   espn    ESPN's 350x254 full headshot, by athlete id    (depth charts)
 *   club    a club site's editorial art, by its path       (club news feeds)
 *   yt      a YouTube video's hqdefault thumbnail, by id    (matchup highlights)
 *
 * An image is identified everywhere by one KEY string: the bare Sleeper id,
 * `espn:<id>`, `yt:<video id>`, or `club:<base64url of the path on
 * static.clubs.nfl.com>`.
 * The club key encodes the path rather than hashing it so the route can
 * recover the original without a lookup table, and the host is fixed by the
 * source, so a key can never name anything off that CDN.
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
  b480: { width: 480, height: 270 },
  b640: { width: 640, height: 360 },
  b960: { width: 960, height: 540 },
  /** 4:3, the shape of a YouTube hqdefault thumbnail, at the highlights box's widths. */
  r320: { width: 320, height: 240 },
  r480: { width: 480, height: 360 },
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

/** Where an original comes from; the first segment of the derivative's path. */
export type ImageSource = "player" | "espn" | "club" | "yt";

/**
 * The derivatives each source produces. The headshot sources share the
 * card squares, the full figures and the hub's 16:9 band. Club art is
 * landscape editorial photography, often 1920px wide, drawn in the news
 * card's square and in the hub's news wells at up to 640px: squares (centre
 * crop) and bands at the widths those wells are drawn, never the figures.
 */
export const VARIANTS_FOR: Record<ImageSource, readonly HeadshotVariant[]> = {
  player: ["160", "256", "320", "f160", "f200", "f350", "b350"],
  espn: ["160", "256", "320", "f160", "f200", "f350", "b350"],
  club: ["160", "256", "320", "b350", "b480", "b640", "b960"],
  yt: ["r320", "r480"],
};

/** The 4:3 thumbnails the matchup highlights box offers, smallest first. */
export const YT_THUMB_VARIANTS: readonly HeadshotVariant[] = ["r320", "r480"];

/** The bands the hub's news well offers for club art, smallest first. */
export const CLUB_BAND_VARIANTS: readonly HeadshotVariant[] = ["b350", "b480", "b640", "b960"];

const ESPN_HEADSHOT =
  /^https?:\/\/a\.espncdn\.com\/i\/headshots\/nfl\/players\/full\/(\d{1,12})\.png(?:[?#].*)?$/i;

/** The one host club art is fetched from; the key carries only a path on it. */
export const CLUB_CDN = "https://static.clubs.nfl.com";
const CLUB_ART = /^https:\/\/static\.clubs\.nfl\.com(\/image\/[A-Za-z0-9_,./-]{1,300}\.(?:jpe?g|png|webp))(?:[?#].*)?$/i;
const CLUB_PATH = /^\/image\/[A-Za-z0-9_,./-]{1,300}\.(?:jpe?g|png|webp)$/i;
const CLUB_ID = /^[A-Za-z0-9_-]{8,420}$/;
const NUMERIC_ID = /^\d{1,12}$/;

/** Any size of a video's thumbnail names the video; the route fetches hqdefault. */
const YT_THUMB = /^https?:\/\/i\.ytimg\.com\/vi\/([A-Za-z0-9_-]{6,20})\/(?:hq|mq|sd|maxres)default\.jpg(?:[?#].*)?$/i;
const YT_ID = /^[A-Za-z0-9_-]{6,20}$/;

// base64url without padding, over ASCII only (the path regex guarantees it).
// btoa/atob are globals in browsers and in Node 16+, which keeps this file
// free of Buffer for the browser bundle.
function toBase64Url(ascii: string): string {
  return btoa(ascii).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(id: string): string | null {
  const b64 = id.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (id.length % 4)) % 4);
  try {
    return atob(b64);
  } catch {
    return null;
  }
}

/** The club-art path a `club` key encodes, or null when it is not one. */
export function decodeClubPath(id: string): string | null {
  if (!CLUB_ID.test(id)) return null;
  const path = fromBase64Url(id);
  return path && CLUB_PATH.test(path) && !path.includes("..") ? path : null;
}

/**
 * The key for an image URL the data carries, or null for anything from a
 * host the route does not serve - which is printed as the feed supplied it.
 */
export function imageKeyFor(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = url.trim();
  const sleeper = SLEEPER_THUMB.exec(u);
  if (sleeper) return sleeper[1]!;
  const espn = ESPN_HEADSHOT.exec(u);
  if (espn) return `espn:${espn[1]}`;
  const club = CLUB_ART.exec(u);
  if (club && !club[1]!.includes("..")) return `club:${toBase64Url(club[1]!)}`;
  const yt = YT_THUMB.exec(u);
  if (yt) return `yt:${yt[1]}`;
  return null;
}

export interface ImageKeyParts {
  source: ImageSource;
  id: string;
}

/** A key's source and id, or null for a string that is not a valid key. */
export function parseImageKey(key: string | null | undefined): ImageKeyParts | null {
  if (!key) return null;
  if (NUMERIC_ID.test(key)) return { source: "player", id: key };
  const m = /^(espn|club|yt):(.+)$/.exec(key);
  if (!m) return null;
  if (m[1] === "espn") return NUMERIC_ID.test(m[2]!) ? { source: "espn", id: m[2]! } : null;
  if (m[1] === "yt") return YT_ID.test(m[2]!) ? { source: "yt", id: m[2]! } : null;
  return decodeClubPath(m[2]!) ? { source: "club", id: m[2]! } : null;
}

/** The key the route builds from its path segments, or null when they name none. */
export function imageKeyFrom(source: string, id: string): string | null {
  const key =
    source === "player"
      ? id
      : source === "espn" || source === "club" || source === "yt"
        ? `${source}:${id}`
        : null;
  return key && parseImageKey(key) ? key : null;
}

export function isVariantFor(source: ImageSource, token: string): token is HeadshotVariant {
  return isHeadshotVariant(token) && VARIANTS_FOR[source].includes(token);
}

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

/** The path of one derivative of a key. An unknown version asks for `latest`. */
export function imagePath(
  key: string,
  version: string | null | undefined,
  variant: HeadshotVariant,
): string {
  const parts = parseImageKey(key);
  const source = parts?.source ?? "player";
  const id = parts?.id ?? key;
  return `/news-image/${source}/${id}/${version || LATEST_VERSION}/${variant}.webp`;
}

/** imagePath() by its older name: `id` is a key (a bare Sleeper id is one). */
export function headshotPath(
  id: string,
  version: string | null | undefined,
  variant: HeadshotVariant,
): string {
  return imagePath(id, version, variant);
}

/** A srcset over the given variants, each with its width descriptor. */
export function headshotSrcset(
  key: string,
  version: string | null | undefined,
  variants: readonly HeadshotVariant[],
  origin = "",
): string {
  const base = assetOrigin(origin);
  return variants
    .map((v) => `${base}${imagePath(key, version, v)} ${HEADSHOT_VARIANTS[v].width}w`)
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
  key: string,
  version: string | null | undefined,
  origin = "",
): HeadshotSources {
  const smallest = CARD_HEADSHOT_VARIANTS[0]!;
  return {
    src: `${assetOrigin(origin)}${imagePath(key, version, smallest)}`,
    srcset: headshotSrcset(key, version, CARD_HEADSHOT_VARIANTS, origin),
    sizes: HEADSHOT_SIZES,
    width: HEADSHOT_VARIANTS[smallest].width,
    height: HEADSHOT_VARIANTS[smallest].height,
  };
}
