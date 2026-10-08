/**
 * GET /news-image/player/<sleeperId>/<version>/<size>.webp
 * GET /news-image/espn/<athleteId>/<version>/<size>.webp
 * GET /news-image/club/<base64url path>/<version>/<size>.webp
 * GET /news-image/yt/<video id>/<version>/<size>.webp
 *
 * The StatChasers-hosted headshot derivatives the news cards, team hub and
 * player pages point at instead of the Sleeper CDN (lib/image-urls.ts says
 * why; lib/image-cache.ts does the work). A reader's browser requests these
 * directly, cross-origin from statchasers.com, so they are deliberately
 * outside the embed-key lock (lib/embed-key.ts lists what is protected; this
 * is not).
 *
 * Only the sizes the renderers emit are served, and only for the four
 * sources lib/image-urls.ts names - a Sleeper or ESPN numeric id, a YouTube
 * video id, or a path on the clubs' CDN. This is not a resizing proxy for arbitrary URLs or
 * dimensions.
 *
 * Headers. The current version of a photo is immutable for a year, for the
 * browser and for Cloudflare (Cloudflare-CDN-Cache-Control), because the
 * version in the URL changes when the photo does. `latest`, or a version this
 * server does not hold, is a redirect to the current version's URL, cached
 * for an hour. A player Sleeper has no photo for is a 404 cached for an hour.
 * If the derivative cannot be built at all - Sleeper down, sharp missing -
 * the request is redirected at the original, uncached, so a pipeline fault
 * costs bytes rather than pictures.
 */

import { Router, type IRouter } from "express";
import { getHeadshot, getTeamLogoPng, sourceUrl } from "../lib/image-cache";
import { imageKeyFrom, imagePath, isImageVersion, isVariantFor, parseImageKey } from "../lib/image-urls";
import { TEAM_LOGO_FILES } from "../lib/team-logo-files";

const router: IRouter = Router();

const YEAR = "public, max-age=31536000, immutable";
const CDN_YEAR = "public, max-age=31536000";
const HOUR = "public, max-age=3600";

router.get("/news-image/:source/:id/:version/:file", (req, res) => {
  void (async () => {
    const id = imageKeyFrom(String(req.params["source"] ?? ""), String(req.params["id"] ?? ""));
    const version = String(req.params["version"] ?? "");
    const file = String(req.params["file"] ?? "");
    const variant = file.endsWith(".webp") ? file.slice(0, -5) : "";
    const source = parseImageKey(id)?.source;
    if (!id || !source || !isImageVersion(version) || !isVariantFor(source, variant)) {
      res.status(404).set("Cache-Control", HOUR).type("text/plain").send("Not found");
      return;
    }

    const result = await getHeadshot(id, version, variant);
    switch (result.status) {
      case "ok":
        res
          .status(200)
          .set("Cache-Control", YEAR)
          .set("Cloudflare-CDN-Cache-Control", CDN_YEAR)
          .set("X-Content-Type-Options", "nosniff")
          .type("image/webp")
          .send(result.body);
        return;
      case "redirect":
        res
          .status(302)
          .set("Cache-Control", HOUR)
          .set("Cloudflare-CDN-Cache-Control", HOUR)
          .set("Location", imagePath(id, result.version, variant))
          .type("text/plain")
          .send("See the current version of this image");
        return;
      case "missing":
        res
          .status(404)
          .set("Cache-Control", HOUR)
          .set("Cloudflare-CDN-Cache-Control", HOUR)
          .type("text/plain")
          .send("No image");
        return;
      default:
        res.status(302).set("Cache-Control", "no-store").redirect(sourceUrl(id));
    }
  })();
});

/**
 * Crest aliases for consumers that cannot know the content hash - the
 * WordPress plugin and its page builders, which have an origin and a team
 * code and nothing else. `/team-logos/phi.svg` and `/team-logos/phi.png`
 * redirect to the current hashed file, cached for a day so a rebuilt crest
 * is picked up without a plugin release. The hashed PNG is rendered from the
 * SVG for the one consumer that cannot take a vector: the media library,
 * which sideloads each team page's featured image.
 */
const DAY = "public, max-age=86400";

router.get(/^\/team-logos\/([a-z]{2,3})\.(svg|png)$/, (req, res) => {
  const abbr = String(req.params[0] ?? "");
  const ext = String(req.params[1] ?? "");
  const file = TEAM_LOGO_FILES[abbr];
  if (!file) {
    res.status(404).set("Cache-Control", HOUR).type("text/plain").send("Not found");
    return;
  }
  res
    .status(302)
    .set("Cache-Control", DAY)
    .set("Cloudflare-CDN-Cache-Control", DAY)
    .set("Location", ext === "png" ? file.replace(/\.svg$/, ".png") : file)
    .type("text/plain")
    .send("See the current crest");
});

router.get(/^\/team-logos\/([a-z]{2,3})-([0-9a-f]{8})\.png$/, (req, res) => {
  void (async () => {
    const abbr = String(req.params[0] ?? "");
    const hash = String(req.params[1] ?? "");
    const body = await getTeamLogoPng(abbr, hash).catch(() => null);
    if (!body) {
      res.status(404).set("Cache-Control", HOUR).type("text/plain").send("Not found");
      return;
    }
    res
      .status(200)
      .set("Cache-Control", YEAR)
      .set("Cloudflare-CDN-Cache-Control", CDN_YEAR)
      .set("X-Content-Type-Options", "nosniff")
      .type("image/png")
      .send(body);
  })();
});

export default router;
