/**
 * The edge pre-fetch (lib/edge-prefetch-core.ts): the versioned URLs it asks
 * Cloudflare for after a boot, and what it does when one is not answered.
 */
import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import { importModule, cleanupBundles } from "./helpers/bundle.mjs";

const mod = await importModule("lib/edge-prefetch-core");
const assets = await importModule("lib/hashed-assets");

after(cleanupBundles);

describe("edgeAssetUrls", () => {
  test("one versioned URL per hashed stylesheet and bundle, on the public origin", () => {
    const urls = mod.edgeAssetUrls("https://news.statchasers.com/", "abc123");
    assert.equal(urls.length, assets.HASHED_ASSET_PATHS.length);
    assert.ok(urls.includes("https://news.statchasers.com/team.css?ver=abc123"));
    assert.ok(urls.includes("https://news.statchasers.com/dist/statchasers-team.js?ver=abc123"));
    assert.ok(urls.includes("https://news.statchasers.com/styles.css?ver=abc123"), "the news tool's sheet is styles.css");
    assert.ok(urls.includes("https://news.statchasers.com/injury-impact.css?ver=abc123"));
    assert.ok(urls.every((u) => !u.includes("//team.css")), "no doubled slash after the origin");
  });
});

describe("prefetchEdgeAssets", () => {
  test("asks for every asset once and reports what the edge said", async () => {
    const asked = [];
    const notes = [];
    const summary = await mod.prefetchEdgeAssets({
      origin: "https://news.example",
      version: "v1",
      fetch: async (url) => {
        asked.push(url);
        return { status: 200, cache: "MISS" };
      },
      sleep: async () => assert.fail("nothing failed, so no retry wait"),
      note: (l) => notes.push(l),
    });
    assert.equal(asked.length, assets.HASHED_ASSET_PATHS.length);
    assert.equal(new Set(asked).size, asked.length);
    assert.equal(summary.cached, asked.length);
    assert.deepEqual(summary.failed, []);
    assert.ok(notes.some((l) => l.startsWith("MISS https://news.example/team.css?ver=v1")));
    assert.match(notes.at(-1), /^done: \d+\/\d+ at the edge$/);
  });

  test("retries only what failed, after a pause, and names what is still missing", async () => {
    const calls = new Map();
    const slept = [];
    const summary = await mod.prefetchEdgeAssets({
      origin: "https://news.example",
      version: "v1",
      retryDelayMs: 7,
      fetch: async (url) => {
        const n = (calls.get(url) ?? 0) + 1;
        calls.set(url, n);
        if (url.endsWith("/team.css?ver=v1")) return n === 1 ? { status: 502, cache: null } : { status: 200, cache: "MISS" };
        if (url.endsWith("/player.css?ver=v1")) throw new Error("timed out");
        return { status: 200, cache: "HIT" };
      },
      sleep: async (ms) => {
        slept.push(ms);
      },
      note: () => undefined,
    });
    assert.deepEqual(slept, [7]);
    assert.equal(calls.get("https://news.example/team.css?ver=v1"), 2);
    assert.equal(calls.get("https://news.example/player.css?ver=v1"), 2);
    assert.equal(calls.get("https://news.example/fpa.css?ver=v1"), 1, "a success is not asked again");
    assert.deepEqual(summary.failed, ["https://news.example/player.css?ver=v1"]);
    assert.equal(summary.cached, assets.HASHED_ASSET_PATHS.length - 1);
  });

  test("an unbuilt version (\"0\") warms nothing: there is no hashed URL to warm", async () => {
    const notes = [];
    const summary = await mod.prefetchEdgeAssets({
      origin: "https://news.example",
      version: "0",
      fetch: async () => assert.fail("must not fetch"),
      sleep: async () => undefined,
      note: (l) => notes.push(l),
    });
    assert.deepEqual(summary, { requested: 0, cached: 0, failed: [] });
    assert.match(notes[0], /no built asset version/);
  });

  test("fetches nothing until the origin says it is serving this build", async () => {
    const asked = [];
    const slept = [];
    const notes = [];
    let answers = ["old1", null, "new9"];
    const summary = await mod.prefetchEdgeAssets({
      origin: "https://news.example",
      version: "new9",
      retryDelayMs: 5,
      originVersion: async () => answers.shift() ?? null,
      fetch: async (url) => {
        asked.push(url);
        return { status: 200, cache: "MISS" };
      },
      sleep: async (ms) => {
        slept.push(ms);
      },
      note: (l) => notes.push(l),
    });
    assert.deepEqual(slept, [5, 5], "waited twice for the origin to catch up");
    assert.equal(asked.length, assets.HASHED_ASSET_PATHS.length, "then warmed everything");
    assert.equal(summary.cached, asked.length);
    assert.ok(notes.some((l) => l.includes("serving ver=old1, not this build (new9)")));
    assert.ok(notes.some((l) => l.includes("serving no readable version")));
  });

  test("gives up, warming nothing, when the origin never serves this build (a workspace run)", async () => {
    const notes = [];
    const summary = await mod.prefetchEdgeAssets({
      origin: "https://news.example",
      version: "local",
      retryDelayMs: 1,
      attempts: 2,
      originVersion: async () => "prod",
      fetch: async () => assert.fail("must not touch the edge"),
      sleep: async () => undefined,
      note: (l) => notes.push(l),
    });
    assert.deepEqual(summary, { requested: 0, cached: 0, failed: [] });
    assert.match(notes.at(-1), /giving up, nothing warmed/);
  });
});
