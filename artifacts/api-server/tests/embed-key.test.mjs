/**
 * Locking the app to WordPress (lib/embed-key.ts).
 *
 * With SC_EMBED_KEY set, fragments, the player index, the news feed and the
 * standalone pages answer only a request carrying the key (header, or the
 * cookie ?key= sets). Assets, /embed.js, the root page, the downloads and the
 * health route stay open. With SC_BROWSER_PROXY set, the widgets that fetch
 * from the reader's browser are pointed at the WordPress proxy.
 */

import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers/server.mjs";

const KEY = "test-key-0123456789";
const PROXY = "https://example.com/wp-json/statchasers/v1/p";

let server;
before(async () => {
  server = await startServer({ SC_EMBED_KEY: KEY, SC_BROWSER_PROXY: PROXY });
});
after(async () => {
  await server?.stop();
});

const get = (path, headers = {}) => fetch(`${server.origin}${path}`, { headers, redirect: "manual" });
const keyed = { "X-StatChasers-Key": KEY };

describe("the key", () => {
  test("protected surfaces refuse a request without it", async () => {
    for (const path of [
      "/embed/players.json",
      "/embed/player/jacoby-brissett",
      "/player/jacoby-brissett/",
      "/player/jacoby-brissett/stats/",
      "/team",
      "/schedule",
      "/embed/player-stats",
      "/embed/sos",
      "/strength-of-schedule",
      "/embed/rookie-hit-rates",
      "/embed/rookie-hit-rates/data",
      "/rookie-hit-rates",
      "/api/news",
    ]) {
      const res = await get(path);
      assert.equal(res.status, 403, path);
      assert.equal(res.headers.get("cache-control"), "no-store", path);
      assert.doesNotMatch(await res.text(), /Brissett/, path);
    }
  });

  test("a wrong key is refused like no key", async () => {
    const res = await get("/embed/players.json", { "X-StatChasers-Key": "nope" });
    assert.equal(res.status, 403);
  });

  test("with the header, the same requests are served, and vary on it", async () => {
    const res = await get("/embed/players.json", keyed);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("vary") ?? "", /X-StatChasers-Key/i);
    const body = await res.json();
    assert.ok(body.players.length > 0);
    assert.equal((await get("/player/jacoby-brissett/", keyed)).status, 200);
  });

  test("assets, the root page, /embed.js, health and the CSV downloads stay public", async () => {
    for (const path of ["/player.css", "/sos.css", "/rookie-hit-rates.css", "/embed.js", "/", "/api/healthz", "/sos/download.csv"]) {
      const res = await get(path);
      assert.notEqual(res.status, 403, path);
    }
  });

  test("?key= unlocks a browser with a cookie and drops the key from the URL", async () => {
    const res = await get("/player/jacoby-brissett/?key=" + KEY + "&format=half");
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/player/jacoby-brissett/?format=half");
    const cookie = res.headers.get("set-cookie") ?? "";
    assert.match(cookie, /sc_embed=[0-9a-f]{64}/);
    assert.match(cookie, /HttpOnly/i);
    assert.doesNotMatch(cookie, new RegExp(KEY), "the cookie never holds the key itself");
    const jar = cookie.split(";")[0];
    assert.equal((await get("/player/jacoby-brissett/", { Cookie: jar })).status, 200);
    assert.equal((await get("/player/jacoby-brissett/", { Cookie: "sc_embed=forged" })).status, 403);
  });

  test("a wrong ?key= sets nothing", async () => {
    const res = await get("/player/jacoby-brissett/?key=nope");
    assert.equal(res.status, 403);
    assert.equal(res.headers.get("set-cookie"), null);
  });
});

describe("the browser proxy", () => {
  test("embedded widgets fetch through WordPress, not this origin", async () => {
    const stats = await (await get("/embed/player-stats", keyed)).text();
    assert.match(stats, new RegExp(`data-sca-endpoint="${PROXY}/embed/player-stats"`));
    const handcuffs = await (await get("/embed/rb-handcuffs", keyed)).text();
    assert.match(handcuffs, new RegExp(`data-rbh-endpoint="${PROXY}/embed/rb-handcuffs"`));
    const sos = await get("/embed/sos", keyed);
    // 404 with no FPA ingested; when there is a board, its swaps go through the proxy.
    if (sos.status === 200) {
      assert.match(await sos.text(), new RegExp(`data-scsos-endpoint="${PROXY}/embed/sos"`));
    }
    const rhr = await (await get("/embed/rookie-hit-rates", keyed)).text();
    assert.match(rhr, new RegExp(`data-schr-data="${PROXY}/embed/rookie-hit-rates/data"`));
  });

  test("the news fragment names the proxy for its refresh, and keeps its asset origin", async () => {
    const res = await get("/embed/ssr", keyed);
    const { html } = await res.json();
    assert.match(html, new RegExp(`data-sc-api="${PROXY}"`));
    assert.match(html, /data-sc-origin="http:\/\/127\.0\.0\.1:\d+"/);
  });
});
