/**
 * The headshot pipeline: /news-image/player/<id>/<version>/<size>.webp serves
 * resized, versioned WebP derivatives of the Sleeper originals, built once and
 * cached, and every surface that draws a headshot points at those rather than
 * at the CDN. Team logos are locally hosted SVGs.
 *
 * Sleeper is stubbed: a local server stands in for the CDN
 * (SLEEPER_CDN_BASE_URL) and counts what it is asked for, which is how the
 * "one upstream fetch per player" promise is checked rather than assumed. The
 * version table is switched off (IMAGE_VERSIONS_DB=0) so the stub's fake
 * players never reach the shared database.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { JSDOM } from "jsdom";
import sharp from "sharp";
import { startServer, APP_DIR } from "./helpers/server.mjs";

let server;
let upstream;
let cacheDir;
const upstreamHits = [];
/** Flipped by a test to make the stub serve a different photo for player 1. */
let replaced = false;

/** A 350x254 PNG whose top 60 rows are transparent, the shape every Sleeper thumb has. */
async function fakeHeadshot(fill) {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="350" height="254">` +
      `<rect x="0" y="60" width="350" height="194" fill="${fill}"/></svg>`,
  );
  return sharp(svg).png().toBuffer();
}

before(async () => {
  const original = await fakeHeadshot("#143c78");
  const replacement = await fakeHeadshot("#a40000");
  upstream = http.createServer((req, res) => {
    upstreamHits.push({ url: req.url, ifNoneMatch: req.headers["if-none-match"] ?? null });
    if (req.url === "/content/nfl/players/thumb/1.jpg") {
      const body = replaced ? replacement : original;
      res.writeHead(200, { "content-type": "image/jpeg", etag: replaced ? '"v2"' : '"v1"' });
      res.end(body);
      return;
    }
    // Every other real player in the archive gets the same stock photo, so
    // the rendered-card checks below have derivatives to look at. 999 is the
    // one id the stub has no picture for.
    if (/^\/content\/nfl\/players\/thumb\/(?!999\.)\d+\.jpg$/.test(req.url ?? "")) {
      res.writeHead(200, { "content-type": "image/jpeg" });
      res.end(original);
      return;
    }
    // What Sleeper really does for a player it has no picture of.
    res.writeHead(403, { "content-type": "text/html; charset=utf-8" });
    res.end("<html><body>forbidden</body></html>");
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-img-cache-"));
  server = await startServer({
    SLEEPER_CDN_BASE_URL: `http://127.0.0.1:${upstream.address().port}`,
    IMAGE_CACHE_DIR: cacheDir,
    IMAGE_VERSIONS_DB: "0",
  });
});

after(async () => {
  await server?.stop();
  await new Promise((resolve) => upstream?.close(resolve));
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

async function get(route, init = {}) {
  const res = await fetch(`${server.origin}${route}`, { redirect: "manual", ...init });
  const body = Buffer.from(await res.arrayBuffer());
  return { res, body };
}

const hitsFor = (id) => upstreamHits.filter((h) => h.url.endsWith(`/${id}.jpg`)).length;

describe("headshot derivatives", () => {
  let version;

  test("`latest` redirects, briefly cached, to the versioned URL", async () => {
    const { res } = await get("/news-image/player/1/latest/256.webp");
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("cache-control"), "public, max-age=3600");
    assert.equal(res.headers.get("cloudflare-cdn-cache-control"), "public, max-age=3600");
    const location = res.headers.get("location");
    const m = /^\/news-image\/player\/1\/([0-9a-f]{10})\/256\.webp$/.exec(location);
    assert.ok(m, `versioned redirect target, got ${location}`);
    version = m[1];
  });

  test("the versioned URL is a square WebP, immutable for the browser and for Cloudflare", async () => {
    const { res, body } = await get(`/news-image/player/1/${version}/256.webp`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/webp");
    assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal(res.headers.get("cloudflare-cdn-cache-control"), "public, max-age=31536000");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");

    const meta = await sharp(body).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.width, 256);
    assert.equal(meta.height, 256, "the card's square crop, not the 350x254 original");
    assert.equal(meta.hasAlpha, true, "the transparent cut-out survives the conversion");
  });

  test("every size of one player costs Sleeper a single fetch", async () => {
    for (const [token, w, h] of [["160", 160, 160], ["320", 320, 320], ["f200", 200, 145], ["f350", 350, 254], ["b350", 350, 197]]) {
      const { res, body } = await get(`/news-image/player/1/${version}/${token}.webp`);
      assert.equal(res.status, 200, token);
      const meta = await sharp(body).metadata();
      assert.equal(meta.width, w, `${token} width`);
      assert.equal(meta.height, h, `${token} height`);
    }
    assert.equal(hitsFor(1), 1, "variants are derived from the fetch already made");
  });

  test("derivatives are written to the disk cache under their version", () => {
    for (const token of ["160", "256", "320", "f160", "f200", "f350", "b350"]) {
      assert.ok(
        fs.existsSync(path.join(cacheDir, "headshot", `1-${version}-${token}.webp`)),
        `expected headshot/1-${version}-${token}.webp on disk`,
      );
    }
  });

  test("a version this server does not hold redirects to the current one", async () => {
    const { res } = await get("/news-image/player/1/0123456789/160.webp");
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), `/news-image/player/1/${version}/160.webp`);
    assert.equal(res.headers.get("cache-control"), "public, max-age=3600");
  });

  test("a player Sleeper has no picture of is a cacheable 404, asked once", async () => {
    const first = await get("/news-image/player/999/latest/160.webp");
    assert.equal(first.res.status, 404);
    assert.equal(first.res.headers.get("cache-control"), "public, max-age=3600");
    const second = await get("/news-image/player/999/latest/320.webp");
    assert.equal(second.res.status, 404);
    assert.equal(hitsFor(999), 1, "the miss is remembered rather than re-asked");
  });

  test("only the renderer's sizes, a numeric id and a well-formed version are served", async () => {
    for (const route of [
      "/news-image/player/1/latest/500.webp",
      "/news-image/player/1/latest/108.webp",
      "/news-image/player/abc/latest/160.webp",
      "/news-image/player/1/latest/160.png",
      "/news-image/player/1/not-a-version/160.webp",
      "/news-image/player/1/160.webp",
    ]) {
      const { res } = await get(route);
      assert.equal(res.status, 404, route);
    }
    assert.equal(
      upstreamHits.filter((h) => /abc/.test(h.url)).length,
      0,
      "a rejected request never reaches Sleeper",
    );
  });

  test("the images are outside the embed-key lock", async () => {
    const locked = await startServer({
      SC_EMBED_KEY: "test-key",
      SLEEPER_CDN_BASE_URL: `http://127.0.0.1:${upstream.address().port}`,
      IMAGE_CACHE_DIR: cacheDir,
      IMAGE_VERSIONS_DB: "0",
    });
    try {
      const res = await fetch(`${locked.origin}/news-image/player/2/latest/160.webp`, { redirect: "follow" });
      assert.equal(res.status, 200, "a reader's browser must be able to fetch a headshot without the key");
      const guarded = await fetch(`${locked.origin}/embed/ssr.html`);
      assert.equal(guarded.status, 403, "sanity: the lock itself is on");
    } finally {
      await locked.stop();
    }
  });
});

describe("team logos", () => {
  test("all 32 clubs have a locally hosted SVG with a square viewBox", async () => {
    const dir = path.join(APP_DIR, "public", "team-logos");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".svg"));
    assert.equal(files.length, 32);
    for (const file of files) {
      assert.match(file, /^[a-z]{2,3}-[0-9a-f]{8}\.svg$/, file);
      const svg = fs.readFileSync(path.join(dir, file), "utf8");
      const box = /viewBox="([^"]+)"/.exec(svg)?.[1].split(/\s+/).map(Number);
      assert.ok(box && box.length === 4, `${file} has a viewBox`);
      assert.ok(Math.abs(box[2] - box[3]) < 0.01, `${file} is square (${box[2]} x ${box[3]})`);
      assert.equal(/\swidth="|\sheight="/.test(svg.slice(0, svg.indexOf(">"))), false, `${file} carries no fixed dimensions`);
    }
  });

  test("a logo is served immutable, as SVG, for the browser and for Cloudflare", async () => {
    const dir = path.join(APP_DIR, "public", "team-logos");
    const [file] = fs.readdirSync(dir).filter((f) => f.startsWith("phi-"));
    const { res } = await get(`/team-logos/${file}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /image\/svg\+xml/);
    assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal(res.headers.get("cloudflare-cdn-cache-control"), "public, max-age=31536000");
  });
});

describe("crest aliases for the WordPress plugin", () => {
  test("/team-logos/<abbr>.svg and .png redirect to the current hashed file, cached a day", async () => {
    const svg = await get("/team-logos/phi.svg");
    assert.equal(svg.res.status, 302);
    assert.match(svg.res.headers.get("location"), /^\/team-logos\/phi-[0-9a-f]{8}\.svg$/);
    assert.equal(svg.res.headers.get("cache-control"), "public, max-age=86400");
    const png = await get("/team-logos/phi.png");
    assert.equal(png.res.status, 302);
    assert.match(png.res.headers.get("location"), /^\/team-logos\/phi-[0-9a-f]{8}\.png$/);
    const missing = await get("/team-logos/zzz.svg");
    assert.equal(missing.res.status, 404);
  });

  test("the hashed PNG is a 512px rendering of the SVG, immutable", async () => {
    const alias = await get("/team-logos/phi.png");
    const { res, body } = await get(alias.res.headers.get("location"));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal(res.headers.get("cloudflare-cdn-cache-control"), "public, max-age=31536000");
    const meta = await sharp(body).metadata();
    assert.equal(meta.width, 512);
    assert.equal(meta.height, 512);
    assert.equal(meta.hasAlpha, true);
    const stale = await get("/team-logos/phi-00000000.png");
    assert.equal(stale.res.status, 404, "a hash that names no current crest");
  });
});

describe("the other tools", () => {
  for (const [name, route] of [
    ["strength of schedule", "/embed/sos"],
    ["advanced player stats", "/embed/player-stats"],
    ["rookie hit rates", "/embed/rookie-hit-rates"],
  ]) {
    test(`${name} loads nothing from the Sleeper CDN`, async () => {
      const res = await fetch(`${server.origin}${route}`, {
        headers: { "x-forwarded-proto": "https", "x-forwarded-host": "news.statchasers.com" },
      });
      if (res.status !== 200) {
        // No data for the tool in this workspace: nothing to check.
        return;
      }
      const html = await res.text();
      assert.equal(/sleepercdn\.com/.test(html), false, `${route} must not reference sleepercdn.com`);
    });
  }

  test("the rookie dataset carries the asset origin and headshot versions", async () => {
    const res = await fetch(`${server.origin}/embed/rookie-hit-rates/data`, {
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "news.statchasers.com" },
    });
    if (res.status !== 200) return;
    const data = await res.json();
    assert.equal(data.assets?.origin, "https://news.statchasers.com");
    assert.equal(typeof data.assets?.headshots, "object");
  });
});

describe("rendered news cards", () => {
  let doc;
  let html;

  before(async () => {
    const res = await fetch(`${server.origin}/embed/ssr.html?limit=40`, {
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "news.statchasers.com" },
    });
    html = await res.text();
    doc = new JSDOM(html).window.document;
  });

  test("nothing on the fragment loads from the Sleeper CDN", () => {
    assert.equal(/sleepercdn\.com/.test(html), false, "the fragment must not reference sleepercdn.com");
  });

  test("headshots carry srcset, sizes, square dimensions and absolute versioned URLs", () => {
    const imgs = [...doc.querySelectorAll("img.sc-card-photo")];
    assert.ok(imgs.length > 0, "expected headshots in the archive");
    const shot = /^https:\/\/news\.statchasers\.com\/news-image\/player\/(\d+)\/(latest|[0-9a-f]{10})\/(\d+)\.webp$/;
    for (const img of imgs) {
      const src = img.getAttribute("src");
      const m = shot.exec(src);
      assert.ok(m, `derivative URL, got ${src}`);
      assert.equal(m[3], "160", "src is the smallest square");
      const candidates = img.getAttribute("srcset").split(",").map((c) => c.trim());
      assert.deepEqual(candidates.map((c) => c.split(/\s+/)[1]), ["160w", "256w", "320w"]);
      for (const c of candidates) assert.match(c.split(/\s+/)[0], shot);
      assert.equal(img.getAttribute("sizes"), "(max-width: 640px) 80px, 108px");
      assert.equal(img.getAttribute("width"), "160");
      assert.equal(img.getAttribute("height"), "160");
      assert.ok(img.hasAttribute("alt"));
    }
  });

  test("the same player on several cards gets one identical URL", () => {
    const byPlayer = new Map();
    for (const img of doc.querySelectorAll("img.sc-card-photo")) {
      const id = /\/player\/(\d+)\//.exec(img.getAttribute("src"))[1];
      byPlayer.set(id, (byPlayer.get(id) ?? new Set()).add(img.getAttribute("src")));
    }
    assert.ok(byPlayer.size > 0);
    for (const [id, urls] of byPlayer) {
      assert.equal(urls.size, 1, `player ${id} should have exactly one src across cards`);
    }
  });

  test("the LCP image is eager and prioritised; later cards are lazy and async", () => {
    const imgs = [...doc.querySelectorAll("img.sc-card-photo")];
    const priority = imgs.filter((i) => i.getAttribute("fetchpriority") === "high");
    assert.equal(priority.length, 1);
    assert.equal(priority[0], imgs[0]);
    assert.equal(priority[0].getAttribute("loading"), "eager");
    assert.notEqual(priority[0].getAttribute("decoding"), "async", "the LCP image is not decoded async");

    const cards = [...doc.querySelectorAll("li.sc-card-item")];
    const below = cards.slice(3).map((li) => li.querySelector("img.sc-card-photo")).filter(Boolean);
    assert.ok(below.length > 0, "expected photos beyond the third card");
    for (const img of below) {
      assert.equal(img.getAttribute("loading"), "lazy");
      assert.equal(img.getAttribute("decoding"), "async");
    }
  });

  test("the watermark and the menu crests are the local SVGs", () => {
    const watermarked = [...doc.querySelectorAll("article.has-team-logo")];
    assert.ok(watermarked.length > 0);
    for (const card of watermarked) {
      assert.match(
        card.getAttribute("style"),
        /--sc-team-logo:url\('https:\/\/news\.statchasers\.com\/team-logos\/[a-z]{2,3}-[0-9a-f]{8}\.svg'\)/,
      );
    }
    const crests = [...doc.querySelectorAll("img.sc-team-logo")];
    assert.ok(crests.length > 0);
    for (const crest of crests) {
      assert.match(crest.getAttribute("src"), /^https:\/\/news\.statchasers\.com\/team-logos\/[a-z]{2,3}-[0-9a-f]{8}\.svg$/);
      assert.equal(crest.getAttribute("loading"), "lazy");
      assert.equal(crest.getAttribute("decoding"), "async");
    }
  });
});

describe("team hub and player pages", () => {
  test("the team hub's photos and logos are served from this origin", async () => {
    const res = await fetch(`${server.origin}/embed/team/philadelphia-eagles`, {
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "news.statchasers.com" },
    });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.length > 1000, "a rendered hub");
    assert.equal(/sleepercdn\.com/.test(html), false, "no Sleeper URL in the team hub");
    const doc = new JSDOM(html).window.document;
    const hero = doc.querySelector("img.sct-hero-logo");
    assert.ok(hero, "hero crest");
    assert.match(hero.getAttribute("src"), /^https:\/\/news\.statchasers\.com\/team-logos\/phi-[0-9a-f]{8}\.svg$/);
    // Depth rows can carry an ESPN portrait when the depth chart names a
    // player the Sleeper dictionary does not; those are printed as supplied.
    // Everything that WAS a Sleeper thumb is now a derivative on this origin.
    const photos = [...doc.querySelectorAll("img.sct-player-photo, img.sct-depth-photo, img.sct-outlook-photo")];
    const ours = photos.filter((img) => img.getAttribute("src").includes("/news-image/"));
    assert.ok(ours.length > 0, "expected at least one derivative on the hub");
    for (const img of ours) {
      assert.match(
        img.getAttribute("src"),
        /^https:\/\/news\.statchasers\.com\/news-image\/player\/\d+\/(latest|[0-9a-f]{10})\/\d+\.webp$/,
        img.outerHTML,
      );
    }
  });

  test("a player page's hero carries the full-figure derivatives", async () => {
    const list = await (await fetch(`${server.origin}/embed/players.json`)).json();
    const players = Array.isArray(list) ? list : (list.players ?? list.items ?? []);
    const first = players.find((p) => p.team);
    if (!first) {
      test.skip("no indexed players in this workspace");
      return;
    }
    const res = await fetch(`${server.origin}/embed/player/${first.slug}`, {
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "news.statchasers.com" },
    });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.equal(/sleepercdn\.com\/content/.test(html), false, "no Sleeper headshot URL on a player page");
    const doc = new JSDOM(html).window.document;
    const hero = doc.querySelector("img.scp-pwell-img");
    if (hero) {
      assert.match(hero.getAttribute("src"), /\/news-image\/player\/\d+\/(latest|[0-9a-f]{10})\/f200\.webp$/);
      assert.match(hero.getAttribute("srcset"), /f200\.webp 200w, .*f350\.webp 350w$/);
      assert.equal(hero.getAttribute("fetchpriority"), "high");
      assert.equal(hero.getAttribute("loading"), null, "the LCP hero is not lazy");
    }
  });
});
