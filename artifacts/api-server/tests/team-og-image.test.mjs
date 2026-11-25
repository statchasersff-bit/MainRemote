/**
 * The team pages' share card (mak, 2026-11-25): /og/team/<slug>.png is a
 * 1200x630 PNG for every club, public, and an unknown club is a 404. The
 * plugin prints it as og:image, twitter:image and primaryImageOfPage
 * (statchasers-team-pages.php statchasers_team_share_image, smoke "pageids").
 */
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, APP_DIR } from "./helpers/server.mjs";

const plugin = fs.readFileSync(path.join(APP_DIR, "..", "..", "wordpress-plugin", "statchasers-news", "statchasers-team-pages.php"), "utf8");
const slugs = [...plugin.matchAll(/'([a-z0-9-]+)'\s*=> array\( '[^']+', '[a-z]{2,3}', '[AN]FC /g)].map((m) => m[1]);

describe("team share card", () => {
  let server;
  before(async () => {
    server = await startServer();
  });
  after(async () => {
    await server?.stop();
  });

  test("the plugin's team table lists 32 clubs", () => {
    assert.equal(slugs.length, 32);
  });

  test("every club's card is a public 1200x630 PNG", async () => {
    for (const slug of slugs) {
      const res = await fetch(`${server.origin}/og/team/${slug}.png?v=1`, { headers: { connection: "close" } });
      assert.equal(res.status, 200, slug);
      assert.match(res.headers.get("content-type") ?? "", /^image\/png/, slug);
      const buf = Buffer.from(await res.arrayBuffer());
      assert.equal(buf.subarray(1, 4).toString("latin1"), "PNG", slug);
      assert.equal(buf.readUInt32BE(16), 1200, `${slug} width`);
      assert.equal(buf.readUInt32BE(20), 630, `${slug} height`);
    }
  });

  test("an unknown club, or a name that is not a PNG, is a 404", async () => {
    for (const file of ["not-a-team.png", "detroit-lions.jpg", "detroit-lions"]) {
      const res = await fetch(`${server.origin}/og/team/${file}`, { headers: { connection: "close" } });
      assert.equal(res.status, 404, file);
    }
  });

  test("the version the plugin prints is the one the API draws", async () => {
    const api = fs.readFileSync(path.join(APP_DIR, "src", "lib", "team", "og-image.ts"), "utf8");
    const apiVersion = api.match(/TEAM_SHARE_VERSION = "(\d+)"/)?.[1];
    const pluginVersion = plugin.match(/STATCHASERS_TEAM_SHARE_VERSION = '(\d+)'/)?.[1];
    assert.ok(apiVersion);
    assert.equal(pluginVersion, apiVersion);
  });
});
