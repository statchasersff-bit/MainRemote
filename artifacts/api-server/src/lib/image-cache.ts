/**
 * The server side of the headshot pipeline (lib/image-urls.ts is the browser
 * side; lib/image-versions.ts the version store).
 *
 * A request for /news-image/player/4046/<version>/256.webp (or an `espn` or
 * `club` key's derivative, lib/image-urls.ts) is answered from,
 * in order: an in-memory LRU of finished derivatives; the disk cache under
 * data/img-cache/ (IMAGE_CACHE_DIR to move it); or one fetch of the Sleeper
 * original, which is resized into EVERY variant at once, written to disk and
 * kept in memory - so the three srcset candidates of a card cost Sleeper one
 * request and the second visitor costs it none. Concurrent requests for one
 * player share a single fetch.
 *
 * THE DISK IS NOT A STORE OF RECORD. The deployment's filesystem is replaced
 * on every publish (see lib/db.ts), so the disk cache is a convenience that
 * survives until the next deploy, and the memory cache until the next
 * restart. What has to survive is the VERSION of each photo, which the URLs
 * carry: that lives in Postgres (lib/image-versions.ts). After a publish the
 * derivatives are simply rebuilt on first request, behind Cloudflare, which
 * holds its own copy for a year.
 *
 * Versions. Each photo's version is the SHA-1 of the original's bytes,
 * truncated. A request for the current version is served with a year-long
 * immutable cache. A request for an older version this server still has on
 * disk is served the same way - that URL named those bytes, and still does.
 * A request for `latest`, or for a version this server does not hold, is a
 * redirect to the current version's URL, cached briefly. Nothing mutable is
 * ever served under an immutable URL.
 *
 * Sleeper answers 403 for a player it has no picture of; that is recorded as
 * version null, and the renderers stop printing an <img> for the player.
 * Stored versions older than a month are re-checked in the background with a
 * conditional request, so a replaced photo reaches new visitors.
 *
 * sharp is loaded lazily and treated as optional: if the native module fails
 * to load on some host, every image request reports an error and the route
 * falls back to redirecting at the original, rather than the server failing
 * to boot over pictures.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { DATA_ROOT, dataPath } from "./data-dir";
import { TEAM_LOGO_FILES } from "./team-logo-files";
import { logger } from "./logger";
import { LruCache } from "./lru";
import {
  CLUB_CDN,
  HEADSHOT_VARIANTS,
  LATEST_VERSION,
  VARIANTS_FOR,
  decodeClubPath,
  isVariantFor,
  parseImageKey,
  type HeadshotVariant,
  type ImageSource,
} from "./image-urls";
import {
  RECHECK_AFTER_MS,
  imageCheckedAt,
  imageEtagFor,
  imageVersionFor,
  recordImageVersion,
  setImageResolver,
  touchImageChecked,
} from "./image-versions";

export type HeadshotResult =
  | { status: "ok"; body: Buffer; version: string }
  /** Serve a redirect to this version's URL instead. */
  | { status: "redirect"; version: string }
  /** Sleeper has no such photo. */
  | { status: "missing" }
  /** Sleeper unreachable, or the image could not be processed. */
  | { status: "error"; reason: string };

const FETCH_TIMEOUT_MS = 8_000;
/** 512 finished WebPs of at most ~15KB each: a few megabytes, bounded. */
const MEMORY_ENTRIES = 512;
const WEBP_QUALITY = 82;
/**
 * YouTube's hqdefault is itself a hard-compressed JPEG: re-encoding its
 * noise at 82 came out LARGER than the original (31KB against 25KB for a
 * 480x360). At 60 the 480 lands under the original and the 320 at half,
 * and the thumbnail sits behind a play button, so the loss is invisible.
 */
const WEBP_QUALITY_FOR: Partial<Record<ImageSource, number>> = { yt: 60 };
const VERSION_LENGTH = 10;

function cdnBase(): string {
  return (process.env["SLEEPER_CDN_BASE_URL"]?.trim() || "https://sleepercdn.com").replace(/\/+$/, "");
}

function espnBase(): string {
  return (process.env["ESPN_CDN_BASE_URL"]?.trim() || "https://a.espncdn.com").replace(/\/+$/, "");
}

function clubBase(): string {
  return (process.env["CLUB_CDN_BASE_URL"]?.trim() || CLUB_CDN).replace(/\/+$/, "");
}

function ytBase(): string {
  return (process.env["YT_IMG_BASE_URL"]?.trim() || "https://i.ytimg.com").replace(/\/+$/, "");
}

function cacheRoot(): string {
  return process.env["IMAGE_CACHE_DIR"]?.trim() || dataPath("img-cache");
}

export function validPlayerId(id: string): boolean {
  return /^\d{1,12}$/.test(id);
}

/** True for a key the route serves: a Sleeper id, `espn:<id>` or `club:<path>`. */
export function validImageKey(key: string): boolean {
  return parseImageKey(key) !== null;
}

function sourceOf(key: string): ImageSource {
  return parseImageKey(key)?.source ?? "player";
}

/** The original a key's derivatives are built from. */
export function sourceUrl(key: string): string {
  const parts = parseImageKey(key);
  if (!parts || parts.source === "player") return `${cdnBase()}/content/nfl/players/thumb/${parts?.id ?? key}.jpg`;
  if (parts.source === "espn") return `${espnBase()}/i/headshots/nfl/players/full/${parts.id}.png`;
  if (parts.source === "yt") return `${ytBase()}/vi/${parts.id}/hqdefault.jpg`;
  return `${clubBase()}${decodeClubPath(parts.id) ?? ""}`;
}

/** A key as a file-name fragment: a Sleeper id as before, `espn-<id>`, `club-<path>`. */
function fileKey(key: string): string {
  return key.replace(":", "-");
}

function memoryKey(key: string, version: string, variant: HeadshotVariant): string {
  return `${key}/${version}/${variant}`;
}

function diskPath(key: string, version: string, variant: HeadshotVariant): string {
  return path.join(cacheRoot(), "headshot", `${fileKey(key)}-${version}-${variant}.webp`);
}

const memory = new LruCache<Buffer>(MEMORY_ENTRIES);
const inflight = new Map<string, Promise<string | null>>();

type SharpModule = typeof import("sharp")["default"];
let sharpLoader: Promise<SharpModule | null> | null = null;

function loadSharp(): Promise<SharpModule | null> {
  if (sharpLoader) return sharpLoader;
  sharpLoader = import("sharp")
    .then((mod) => {
      const sharp = mod.default;
      // One libvips thread and a small operation cache: this is a side job on
      // a server whose memory has been the problem before, not an image farm.
      sharp.concurrency(1);
      sharp.cache({ memory: 16, files: 0, items: 32 });
      return sharp;
    })
    .catch((err: unknown) => {
      logger.error({ err }, "sharp failed to load; image derivatives unavailable");
      return null;
    });
  return sharpLoader;
}

type Fetched =
  | { kind: "image"; body: Buffer; etag: string | null }
  | { kind: "unchanged" }
  | { kind: "none" };

/** Fetch the original, conditionally when an ETag is known. */
async function fetchSource(id: string, etag: string | null): Promise<Fetched> {
  const url = sourceUrl(id);
  const res = await fetch(url, {
    headers: {
      Accept: "image/*",
      "User-Agent": "StatChasers news tool (+https://statchasers.com)",
      ...(etag ? { "If-None-Match": etag } : {}),
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
  });
  if (res.status === 304) return { kind: "unchanged" };
  // 403 is what Sleeper returns for a player it has no picture of; ESPN, the
  // club CDN and YouTube say 404.
  if (res.status === 403 || res.status === 404 || res.status === 410) return { kind: "none" };
  if (!res.ok) throw new Error(`image source answered ${res.status} for ${url}`);
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  // A 200 carrying an HTML page is also "no picture"; sharp would reject it
  // anyway, but this spares the attempt.
  if (type.startsWith("text/")) return { kind: "none" };
  return {
    kind: "image",
    body: Buffer.from(await res.arrayBuffer()),
    etag: res.headers.get("etag"),
  };
}

async function writeVariant(file: string, body: Buffer): Promise<void> {
  try {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    // Write beside and rename, so a reader never sees a half-written file.
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, body);
    await fsp.rename(tmp, file);
  } catch (err) {
    // A read-only disk still serves the image from memory; it is just built
    // again after a restart.
    logger.warn({ err, file }, "image cache write failed");
  }
}

function versionOf(body: Buffer): string {
  return createHash("sha1").update(body).digest("hex").slice(0, VERSION_LENGTH);
}

/** Resize the original into every variant; memory and disk both get a copy. */
async function buildVariants(id: string, version: string, source: Buffer): Promise<boolean> {
  const sharp = await loadSharp();
  if (!sharp) return false;
  try {
    await sharp(source, { failOn: "none" }).metadata();
  } catch {
    return false;
  }
  const writes: Promise<void>[] = [];
  const source_ = sourceOf(id);
  for (const token of VARIANTS_FOR[source_]) {
    const shape = HEADSHOT_VARIANTS[token];
    const image = sharp(source, { failOn: "none" });
    const resized = token.startsWith("f")
      ? // The full figure at its own ratio. Never enlarged past the source.
        image.resize({ width: shape.width, withoutEnlargement: true })
      : // Square (or 16:9 band) cover crop. For a headshot it is anchored at
        // the top: the same pixels `object-fit: cover; object-position:
        // center top` showed. The 320 square is a little larger than the
        // 254px-tall source allows, so it is the one derivative that is
        // upscaled; it serves 3x phones, where a 108px box would otherwise
        // read a 256px image at 1.27x. Club art is a landscape photograph
        // with its subject in the middle, so that crops from the center; a
        // YouTube thumbnail is already 4:3 and is only scaled.
        image.resize({
          width: shape.width,
          height: shape.height,
          fit: "cover",
          position: source_ === "player" || source_ === "espn" ? "top" : "center",
        });
    const body = await resized
      .webp({ quality: WEBP_QUALITY_FOR[source_] ?? WEBP_QUALITY, alphaQuality: 90, effort: 4 })
      .toBuffer();
    memory.set(memoryKey(id, version, token), body);
    writes.push(writeVariant(diskPath(id, version, token), body));
  }
  await Promise.all(writes);
  return true;
}

async function haveAllVariants(id: string, version: string): Promise<boolean> {
  const checks = VARIANTS_FOR[sourceOf(id)].map(async (token) => {
    if (memory.get(memoryKey(id, version, token))) return true;
    try {
      await fsp.access(diskPath(id, version, token));
      return true;
    } catch {
      return false;
    }
  });
  return (await Promise.all(checks)).every(Boolean);
}

/**
 * Fetch a player's photo and establish its version, building the derivatives
 * when they are not already here. Resolves to the current version, or null
 * when Sleeper has no photo. Throws when it could not be done.
 */
async function resolve(id: string): Promise<string | null> {
  const knownVersion = imageVersionFor(id);
  const complete = knownVersion ? await haveAllVariants(id, knownVersion) : false;
  // Conditional only when a 304 would save work: with the derivatives in
  // hand, "unchanged" is the whole answer. Without them the bytes are needed.
  const fetched = await fetchSource(id, complete ? imageEtagFor(id) : null);
  if (fetched.kind === "unchanged") {
    touchImageChecked(id);
    return knownVersion ?? null;
  }
  if (fetched.kind === "none") {
    recordImageVersion(id, null, null);
    return null;
  }
  const version = versionOf(fetched.body);
  if (version === knownVersion && complete) {
    touchImageChecked(id);
    return version;
  }
  const built = await buildVariants(id, version, fetched.body);
  if (!built) throw new Error("image could not be processed");
  recordImageVersion(id, version, fetched.etag);
  return version;
}

/** One resolution per player at a time; everyone asking shares it. */
function resolveShared(id: string): Promise<string | null> {
  const pending = inflight.get(id);
  if (pending) return pending;
  const job = resolve(id).finally(() => {
    inflight.delete(id);
  });
  inflight.set(id, job);
  return job;
}

// The version store's background resolver: what enqueueImageResolve() runs.
setImageResolver(resolveShared);

async function readVariant(id: string, version: string, variant: HeadshotVariant): Promise<Buffer | null> {
  const key = memoryKey(id, version, variant);
  const warm = memory.get(key);
  if (warm) return warm;
  try {
    const body = await fsp.readFile(diskPath(id, version, variant));
    memory.set(key, body);
    return body;
  } catch {
    return null;
  }
}

/**
 * The derivative for one request. `requested` is a version token from the
 * URL: `latest`, the current version, or an older one.
 */
export async function getHeadshot(
  id: string,
  requested: string,
  variant: HeadshotVariant,
): Promise<HeadshotResult> {
  const parts = parseImageKey(id);
  if (!parts || !isVariantFor(parts.source, variant)) return { status: "missing" };

  // An older version this server still holds names exactly those bytes.
  if (requested !== LATEST_VERSION && requested !== imageVersionFor(id)) {
    const held = await readVariant(id, requested, variant);
    if (held) return { status: "ok", body: held, version: requested };
  }

  let current = imageVersionFor(id);
  try {
    if (current === undefined) {
      current = await resolveShared(id);
    } else if (current !== null) {
      const have = await readVariant(id, current, variant);
      if (have) {
        const checked = imageCheckedAt(id) ?? 0;
        if (Date.now() - checked > RECHECK_AFTER_MS) {
          resolveShared(id).catch((err: unknown) =>
            logger.warn({ err, id }, "background headshot re-check failed"),
          );
        }
        return requested === current
          ? { status: "ok", body: have, version: current }
          : { status: "redirect", version: current };
      }
      // Known version, no derivatives here (a fresh deployment): rebuild.
      current = await resolveShared(id);
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn({ err, id }, "headshot derivative failed");
    return { status: "error", reason };
  }

  if (current === null) return { status: "missing" };
  if (requested !== current) return { status: "redirect", version: current };
  const body = await readVariant(id, current, variant);
  return body ? { status: "ok", body, version: current } : { status: "error", reason: "derivative not built" };
}

/** What is cached, for /api/status. Counts files rather than bytes: cheap. */
export function imageCacheStatus(): { dir: string; headshotFiles: number; inMemory: number } {
  let headshotFiles = 0;
  try {
    headshotFiles = fs.readdirSync(path.join(cacheRoot(), "headshot")).filter((f) => f.endsWith(".webp")).length;
  } catch {
    // Nothing built yet.
  }
  return { dir: cacheRoot(), headshotFiles, inMemory: memory.size };
}

// --- team crests as PNG ----------------------------------------------------

/** How wide the PNG rendering of a crest is: a featured image, not an icon. */
export const TEAM_LOGO_PNG_SIZE = 512;

/** The hash in a crest's file name, or null when it is not the current file. */
export function teamLogoHash(abbr: string): string | null {
  const file = TEAM_LOGO_FILES[abbr];
  return file ? (/-([0-9a-f]{8})\.svg$/.exec(file)?.[1] ?? null) : null;
}

/**
 * A club's crest as a PNG, for the places that cannot take an SVG - the
 * WordPress media library, which sideloads a crest as each team page's
 * featured image and does not accept SVG uploads. Rendered from the local SVG
 * with sharp, once, and cached like a headshot derivative. Null when the
 * abbreviation or hash names no current crest.
 */
export async function getTeamLogoPng(abbr: string, hash: string): Promise<Buffer | null> {
  if (teamLogoHash(abbr) !== hash) return null;
  const key = `crest/${abbr}-${hash}`;
  const warm = memory.get(key);
  if (warm) return warm;
  const file = path.join(cacheRoot(), "team", `${abbr}-${hash}.png`);
  try {
    const body = await fsp.readFile(file);
    memory.set(key, body);
    return body;
  } catch {
    // Not rendered yet.
  }
  const sharp = await loadSharp();
  if (!sharp) return null;
  const svg = await fsp.readFile(path.resolve(DATA_ROOT, "..", "public", TEAM_LOGO_FILES[abbr]!.replace(/^\//, "")));
  const body = await sharp(svg, { density: 384 })
    .resize(TEAM_LOGO_PNG_SIZE, TEAM_LOGO_PNG_SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  memory.set(key, body);
  await writeVariant(file, body);
  return body;
}

