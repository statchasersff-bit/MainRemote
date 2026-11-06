/**
 * The post-publish warm crawl: which sitemap URLs scripts/warm-live.mjs
 * walks and in what order, how it treats a rate limit, and the server-side
 * guard in lib/live-warm.ts that keeps it from crawling the previous build.
 */
import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import { importModule, cleanupBundles } from "./helpers/bundle.mjs";

const script = await import("../scripts/warm-live.mjs");
const lib = await importModule("lib/live-warm-core");

after(cleanupBundles);

const LOCS = [
  "https://statchasers.com/about/",
  "https://statchasers.com/nfl/players/josh-allen/stats/",
  "https://statchasers.com/nfl/players/josh-allen/",
  "https://statchasers.com/nfl/teams/buffalo-bills/usage/",
  "https://statchasers.com/nfl/teams/",
  "https://statchasers.com/nfl/teams/buffalo-bills/",
  "https://statchasers.com/nfl/players/",
  "https://statchasers.com/nfl/players/josh-allen/",
];

describe("selectUrls", () => {
  test("teams (every tab) first, then the player index and hubs; tabs only with --all-tabs; no duplicates", () => {
    const urls = script.selectUrls(LOCS);
    assert.deepEqual(urls, [
      "https://statchasers.com/nfl/teams/buffalo-bills/usage/",
      "https://statchasers.com/nfl/teams/",
      "https://statchasers.com/nfl/teams/buffalo-bills/",
      "https://statchasers.com/nfl/players/",
      "https://statchasers.com/nfl/players/josh-allen/",
    ]);
    assert.deepEqual(script.selectUrls(LOCS, { teamsOnly: true }).length, 3);
    const all = script.selectUrls(LOCS, { allTabs: true });
    assert.equal(all.at(-1), "https://statchasers.com/nfl/players/josh-allen/stats/");
  });

  test("sitemapLocs reads an index and a page sitemap alike", () => {
    const locs = script.sitemapLocs("<sitemapindex><sitemap><loc>https://x/page-sitemap1.xml</loc></sitemap><sitemap><loc> https://x/post-sitemap.xml </loc></sitemap></sitemapindex>");
    assert.deepEqual(locs, ["https://x/page-sitemap1.xml", "https://x/post-sitemap.xml"]);
  });
});

describe("crawl", () => {
  test("backs off on a 429 and retries that page once; counts slow and failed pages", async () => {
    const calls = [];
    const waits = [];
    let first = true;
    const summary = await script.crawl(["https://x/a/", "https://x/b/", "https://x/c/"], {
      rateMs: 7,
      wait: async (ms) => waits.push(ms),
      fetchPage: async (url) => {
        calls.push(url);
        if (url.endsWith("/a/") && first) {
          first = false;
          return { status: 429, ms: 10, cache: "-" };
        }
        if (url.endsWith("/b/")) return { status: 200, ms: 6000, cache: "MISS" };
        if (url.endsWith("/c/")) return { status: 0, ms: 90000, cache: "-", error: "timeout" };
        return { status: 200, ms: 100, cache: "HIT" };
      },
    });
    assert.deepEqual(calls, ["https://x/a/", "https://x/a/", "https://x/b/", "https://x/c/"]);
    assert.equal(waits[0], 20000, "the rate-limit pause comes first");
    assert.deepEqual(waits.slice(1), [7, 7], "one rate wait between pages, none after the last");
    assert.equal(summary.ok, 2);
    assert.equal(summary.slow, 2);
    assert.equal(summary.failed, 1);
    assert.match(script.summaryLine(summary), /^warm-live complete: 3 pages, 2 ok, 2 slow \(>5s\), 1 failed, \d+s$/);
    assert.equal(summary.slowest[0].url, "https://x/c/");
  });
});

describe("runLiveWarm", () => {
  const base = (over) => ({
    version: "abc",
    sleep: async () => {},
    note: () => {},
    run: async () => "warm-live complete: 1 pages, 1 ok, 0 slow (>5s), 0 failed, 2s\n",
    originVersion: async () => "abc",
    startDelayMs: 0,
    retryDelayMs: 0,
    ...over,
  });

  test("crawls once the origin reports this build and returns the summary line", async () => {
    const notes = [];
    const versions = ["old", "old", "abc"];
    let ran = 0;
    const out = await lib.runLiveWarm(base({
      note: (l) => notes.push(l),
      originVersion: async () => versions.shift() ?? "abc",
      run: async () => { ran += 1; return "noise\nwarm-live complete: 864 pages, 864 ok, 0 slow (>5s), 0 failed, 1400s\n"; },
    }));
    assert.equal(ran, 1);
    assert.equal(out, "warm-live complete: 864 pages, 864 ok, 0 slow (>5s), 0 failed, 1400s");
    assert.ok(notes.some((l) => l.startsWith("start: origin serves abc")));
  });

  test("never crawls while the origin serves another build", async () => {
    const notes = [];
    let ran = 0;
    const out = await lib.runLiveWarm(base({
      attempts: 3,
      note: (l) => notes.push(l),
      originVersion: async () => "old",
      run: async () => { ran += 1; return ""; },
    }));
    assert.equal(ran, 0);
    assert.equal(out, null);
    assert.match(notes.at(-1), /skipped: origin still serves old after 3 checks/);
  });

  test("a build without a version is skipped", async () => {
    let ran = 0;
    const out = await lib.runLiveWarm(base({ version: "0", run: async () => { ran += 1; return ""; } }));
    assert.equal(ran, 0);
    assert.equal(out, null);
  });
});

describe("runLiveWarm waits for WordPress to print this build (2026-11-05)", () => {
  const fake = (over) => ({
    version: "new123",
    originVersion: async () => "new123",
    run: async () => "warm-live complete: 1 pages",
    sleep: async () => {},
    note: () => {},
    startDelayMs: 0,
    retryDelayMs: 0,
    ...over,
  });
  test("crawls only once a fresh render prints the new ?ver=", async () => {
    const seen = ["old999", "old999", "new123"];
    let ran = 0;
    const out = await lib.runLiveWarm(fake({ siteVersion: async () => seen.shift(), run: async () => { ran += 1; return "warm-live complete: 1 pages"; } }));
    assert.equal(ran, 1);
    assert.match(out, /warm-live complete/);
    assert.equal(seen.length, 0, "it kept checking until the new version showed");
  });
  test("skips the crawl when WordPress never prints the new ?ver=", async () => {
    let ran = 0;
    const notes = [];
    const out = await lib.runLiveWarm(fake({ siteVersion: async () => "old999", siteAttempts: 3, note: (l) => notes.push(l), run: async () => { ran += 1; return ""; } }));
    assert.equal(out, null);
    assert.equal(ran, 0, "no page is warmed with the old stylesheet");
    assert.ok(notes.some((l) => /WordPress still prints old999/.test(l)));
  });
});

