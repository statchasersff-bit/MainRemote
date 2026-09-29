/**
 * Small response-hygiene rules from the audit, each pinned once.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers/server.mjs";
import { importModule, cleanupBundles } from "./helpers/bundle.mjs";

let server;

before(async () => {
  server = await startServer();
});

after(async () => {
  await server?.stop();
  await cleanupBundles();
});

const canonical = (html) => /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];

describe("canonical URLs", () => {
  test("a forged X-Forwarded-Host does not reach the canonical", async () => {
    const html = await (
      await fetch(`${server.origin}/schedule`, { headers: { "X-Forwarded-Host": "evil.example" } })
    ).text();
    assert.ok(canonical(html), "the page has a canonical");
    assert.ok(!canonical(html).includes("evil.example"), canonical(html));
  });

  test("a trusted forwarded host is still used", async () => {
    const html = await (
      await fetch(`${server.origin}/schedule`, {
        headers: { "X-Forwarded-Host": "newsfeed.replit.app", "X-Forwarded-Proto": "https" },
      })
    ).text();
    assert.equal(canonical(html), "https://newsfeed.replit.app/schedule");
  });

  test("the path is lower-cased, so /Schedule is not its own canonical", async () => {
    const html = await (await fetch(`${server.origin}/Schedule`)).text();
    assert.equal(canonical(html), `${server.origin}/schedule`);
  });
});

describe("a season asked for by name that has no data", () => {
  test("is a 404 on /fpa, not an empty table", async () => {
    assert.equal((await fetch(`${server.origin}/fpa?season=2099`)).status, 404);
  });

  test("is a 404 on /rankings, not an empty board", async () => {
    assert.equal((await fetch(`${server.origin}/rankings?season=2099`)).status, 404);
  });
});

describe("headers", () => {
  test("no X-Powered-By", async () => {
    const res = await fetch(`${server.origin}/schedule`);
    assert.equal(res.headers.get("x-powered-by"), null);
  });
});

describe("the provider cache", () => {
  test("a stale value whose refresh just failed is served without another attempt", async () => {
    const { createKeyedCache } = await importModule("lib/team/cache");
    let calls = 0;
    let fail = false;
    const cache = createKeyedCache({
      name: "test",
      ttlMs: 1,
      errorBackoffMs: 60_000,
      load: async () => {
        calls += 1;
        if (fail) throw new Error("upstream down");
        return "value";
      },
    });
    assert.equal(await cache.ensure("k"), "value");
    fail = true;
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(await cache.ensure("k"), "value", "stale value served");
    await new Promise((r) => setTimeout(r, 20)); // let the background refresh fail
    const before = calls;
    for (let i = 0; i < 5; i += 1) assert.equal(await cache.ensure("k"), "value");
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(calls, before, "no refresh attempt inside the backoff");
  });
});
