/**
 * The asset version, read the way the deployment runs.
 *
 * WordPress enqueues every tool's CSS and JS with `?ver=<the version
 * /embed/assets.json reports>`. The version was read from process.cwd(), which
 * is the package in development and in this suite, and somewhere else on the
 * deployment - so production answered "0", WordPress fell back to its own
 * constant, and no deploy ever busted a cached asset. The server here is
 * started from another directory on purpose.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, APP_DIR } from "./helpers/server.mjs";

const built = JSON.parse(
  fs.readFileSync(path.join(APP_DIR, "public", "dist", "version.json"), "utf8"),
).version;

let server;

before(async () => {
  server = await startServer({ NODE_ENV: "production" }, { cwd: os.tmpdir() });
});

after(async () => {
  await server?.stop();
});

describe("started from another directory", () => {
  test("assets.json reports the built version, not the 0 sentinel", async () => {
    const body = await (await fetch(`${server.origin}/embed/assets.json`)).json();
    assert.notEqual(body.version, "0");
    assert.equal(body.version, built);
  });

  test("a hashed asset at the current version is cached for good", async () => {
    const res = await fetch(`${server.origin}/player.css?ver=${built}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
  });

  test("source maps are not published", async () => {
    const res = await fetch(`${server.origin}/dist/statchasers-player.js.map`);
    assert.equal(res.status, 404);
  });

  test("any other ver is held an hour, so stale bytes cannot stick for long", async () => {
    // Phase 1 (2026-10-14): an hour rather than revalidated on every page
    // view. The versioned URL above is what the plugin prints; this bounds how
    // long the wrong bytes can live after a deploy for anything else.
    for (const url of ["/player.css?ver=1.7.0", "/player.css", "/dist/statchasers-vitals.js?ver=" + built]) {
      const res = await fetch(`${server.origin}${url}`);
      assert.equal(res.headers.get("cache-control"), "public, max-age=3600", url);
    }
  });
});
