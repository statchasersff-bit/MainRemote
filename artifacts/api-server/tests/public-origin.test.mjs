/**
 * The newsfeed's public origin is https://news.statchasers.com, and the
 * markup says so whichever host carried the request.
 *
 * The deployment answers on its *.replit.app address too, and the WordPress
 * plugin may fetch a fragment over either name. Before the pin, a fragment
 * fetched over the Replit host came back with Replit image URLs, printed
 * into statchasers.com. A production process now names the canonical origin
 * for the canonical link, the embed snippet and every absolute
 * /news-image/ and /team-logos/ URL, no matter what the Host header says;
 * PUBLIC_ORIGIN overrides it, and the literal `request` switches it off.
 * Development and test processes keep following the request, so a local
 * page loads its images from the local server (tests/hygiene.test.mjs).
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers/server.mjs";

const CANONICAL = "https://news.statchasers.com";
const canonical = (html) => /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
const assetUrls = (html) =>
  [...html.matchAll(/(?:src|srcset|href|content)="([^"]*\/(?:news-image|team-logos)\/[^"\s]+)/g)].map(
    (m) => m[1],
  );

describe("a production process", () => {
  let server;

  before(async () => {
    // No watchdog: it would probe the live deployment from the test run.
    server = await startServer({ NODE_ENV: "production", SC_WATCHDOG: "0" });
  });

  after(async () => {
    await server?.stop();
  });

  test("names the canonical origin with no forwarded headers at all", async () => {
    const html = await (await fetch(`${server.origin}/schedule`)).text();
    assert.equal(canonical(html), `${CANONICAL}/schedule`);
  });

  test("names it when the request came in over another trusted host", async () => {
    const html = await (
      await fetch(`${server.origin}/schedule`, {
        headers: { "X-Forwarded-Host": "newsfeed.replit.app", "X-Forwarded-Proto": "https" },
      })
    ).text();
    assert.equal(canonical(html), `${CANONICAL}/schedule`);
  });

  test("prints absolute image and crest URLs on the canonical origin", async () => {
    const res = await fetch(`${server.origin}/embed/ssr.html?limit=40`, {
      headers: { "X-Forwarded-Host": "newsfeed.replit.app", "X-Forwarded-Proto": "https" },
    });
    assert.equal(res.status, 200);
    const urls = assetUrls(await res.text());
    assert.ok(urls.length > 0, "the fragment prints at least one headshot or crest");
    for (const url of urls) {
      assert.ok(url.startsWith(`${CANONICAL}/`), url);
    }
  });

  test("the embed snippet points WordPress at the canonical origin", async () => {
    const res = await fetch(`${server.origin}/embed`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /STATCHASERS_NEWS_ORIGIN', 'https:\/\/news\.statchasers\.com'/);
    assert.ok(!html.includes("127.0.0.1"), "the snippet must not name the internal host");
  });

  test("the rookie dataset carries the canonical asset origin", async () => {
    const res = await fetch(`${server.origin}/embed/rookie-hit-rates/data`);
    if (res.status !== 200) return; // no dataset in this workspace
    const data = await res.json();
    assert.equal(data.assets?.origin, CANONICAL);
  });
});

describe("PUBLIC_ORIGIN", () => {
  test("names another origin for a deployment behind its own name", async () => {
    const server = await startServer({ PUBLIC_ORIGIN: "https://staging.example/" });
    try {
      const html = await (
        await fetch(`${server.origin}/schedule`, {
          headers: { "X-Forwarded-Host": "news.statchasers.com", "X-Forwarded-Proto": "https" },
        })
      ).text();
      assert.equal(canonical(html), "https://staging.example/schedule");
    } finally {
      await server.stop();
    }
  });

  test("`request` switches the pin off in production", async () => {
    const server = await startServer({
      NODE_ENV: "production",
      SC_WATCHDOG: "0",
      PUBLIC_ORIGIN: "request",
    });
    try {
      const html = await (await fetch(`${server.origin}/schedule`)).text();
      assert.equal(canonical(html), `${server.origin}/schedule`);
    } finally {
      await server.stop();
    }
  });
});
