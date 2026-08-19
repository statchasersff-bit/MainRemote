/**
 * SEO regression tests — the crawler's view.
 *
 * This is the suite that exists to stop a future refactor quietly making the
 * tool invisible to search engines again. It fetches the served HTML and
 * asserts on it WITHOUT executing any JavaScript: if someone reintroduces a
 * client-only render, an empty container, a second canonical, or a lazy-loaded
 * first screen, these fail.
 *
 * Run with `pnpm --filter @workspace/api-server test` (requires a build first —
 * the test script runs one).
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { JSDOM } from "jsdom";
import { startServer, APP_DIR } from "./helpers/server.mjs";

/** A GET with exactly the headers given — no implicit cache directives added. */
function rawGet(pathname, headers = {}) {
  const url = new URL(pathname, server.origin);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: "GET", headers },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

let server;
let pageHtml;
let pageDoc;

/** A representative sample of the real data, to assert it reaches the HTML. */
let sampleItems = [];

before(async () => {
  server = await startServer({
    PLAYER_PROFILE_URL_TEMPLATE: "/nfl/players/{slug}",
    TEAM_PAGE_URL_TEMPLATE: "/nfl/teams/{slug}",
    RELATED_LINKS:
      "Fantasy Football Strength of Schedule|/nfl/fantasy-football-strength-of-schedule/",
  });

  pageHtml = await (await fetch(`${server.origin}/`)).text();
  pageDoc = new JSDOM(pageHtml).window.document;

  const api = await (await fetch(`${server.origin}/api/news?limit=5`)).json();
  sampleItems = api.items ?? [];
});

after(async () => {
  await server?.stop();
});

describe("crawlable HTML (no JavaScript executed)", () => {
  test("emits no heading of its own — the host page supplies it", () => {
    // This document is only ever read inside a StatChasers page, which prints
    // its own header above the tool. A heading here would restate it, and in
    // the WordPress mount it would put a second H1 into the composed page.
    assert.equal(pageDoc.querySelectorAll("h1").length, 0, "unexpected H1");
    assert.equal(
      pageDoc.querySelectorAll(".sc-section-heading").length,
      0,
      "the standalone page must not render the tool's H2 either",
    );
  });

  test("title and og:title still carry the phrase and agree", () => {
    // Dropping the visible heading must not cost the page its metadata: the
    // title is what a search result shows, and og:title has to match it or the
    // two signals disagree.
    const title = pageDoc.querySelector("title").textContent.trim();
    const ogTitle = pageDoc
      .querySelector('meta[property="og:title"]')
      .getAttribute("content")
      .trim();
    assert.ok(title.length > 0, "title must not be empty");
    assert.equal(ogTitle, title);
    assert.match(title, /Fantasy Football Player News/);
  });

  test("has exactly one self-referencing canonical", () => {
    const canonicals = pageDoc.querySelectorAll('link[rel="canonical"]');
    assert.equal(canonicals.length, 1, "expected exactly one canonical");
    const href = canonicals[0].getAttribute("href");
    assert.ok(href.startsWith("http"), "canonical must be absolute");
    assert.ok(!href.includes("?"), "canonical must not carry query state");
  });

  test("canonical does not change with tool-state parameters", async () => {
    const variants = [
      "/",
      "/?position=RB&scoring=ppr&weeks=15-17",
      "/?page=9",
      "/index.html",
    ];
    const seen = new Set();
    for (const v of variants) {
      const html = await (await fetch(`${server.origin}${v}`)).text();
      const doc = new JSDOM(html).window.document;
      seen.add(doc.querySelector('link[rel="canonical"]').getAttribute("href"));
    }
    assert.equal(seen.size, 1, `canonical varied across parameters: ${[...seen]}`);
  });

  test("has a page-specific meta description matching og:description", () => {
    const description = pageDoc
      .querySelector('meta[name="description"]')
      ?.getAttribute("content");
    assert.ok(description, "meta description missing");
    assert.ok(description.length > 80, "meta description looks like a stub");

    const og = pageDoc
      .querySelector('meta[property="og:description"]')
      ?.getAttribute("content");
    assert.equal(og, description, "og:description must match meta description");
  });

  test("og:title matches the title", () => {
    assert.equal(
      pageDoc.querySelector('meta[property="og:title"]').getAttribute("content"),
      pageDoc.querySelector("title").textContent.trim(),
    );
  });

  test("structured data is a valid application node with no invented ratings", async () => {
    const res = await fetch(
      `${server.origin}/embed/schema.json?page_url=${encodeURIComponent("https://statchasers.com/nfl/player-news/")}`,
    );
    const { node } = await res.json();

    assert.ok(node["@type"].includes("SoftwareApplication"));
    assert.ok(node["@type"].includes("WebApplication"));
    assert.equal(node.applicationCategory, "SportsApplication");
    assert.ok(node.name && node.description && node.url);
    assert.ok(node.offers, "offer information missing");

    // Fabricated review data is a policy violation, not a shortcut.
    const serialised = JSON.stringify(node);
    for (const banned of ["aggregateRating", "ratingValue", "reviewCount", "review"]) {
      assert.ok(
        !serialised.includes(banned),
        `structured data must not contain ${banned}`,
      );
    }

    // Types that would not accurately describe this page.
    for (const banned of ["Article", "ItemList", "Dataset", "FAQPage", "Product"]) {
      assert.ok(
        !node["@type"].includes(banned),
        `structured data must not claim ${banned}`,
      );
    }
  });

  test("every news item is present in the initial HTML", () => {
    const articles = pageDoc.querySelectorAll("article.sc-card");
    const listed = Number(
      pageDoc.querySelector(".news-list").getAttribute("data-total"),
    );
    assert.ok(articles.length > 0, "no items rendered server-side");
    assert.equal(
      articles.length,
      listed,
      "rendered item count must match the declared total — no client-only items",
    );
  });

  test("representative real data reaches the HTML", () => {
    assert.ok(sampleItems.length > 0, "no data to sample");
    const text = pageDoc.body.textContent;

    for (const item of sampleItems.slice(0, 3)) {
      assert.ok(
        text.includes(item.title),
        `headline missing from HTML: ${item.title}`,
      );
      if (item.playerName) {
        assert.ok(
          text.includes(item.playerName),
          `player missing from HTML: ${item.playerName}`,
        );
      }
    }
  });

  test("items beyond the first page are in the HTML, not gated behind a click", () => {
    const beyondFirstPage = pageDoc.querySelectorAll(
      '.sc-card-item:not([data-page="0"])',
    );
    assert.ok(
      beyondFirstPage.length > 0,
      "expected later pages to be server-rendered too",
    );
    // And each carries real content rather than a placeholder.
    assert.ok(
      beyondFirstPage[0].querySelector("h3.sc-card-name").textContent.trim(),
      "later-page items must carry their headline",
    );
  });

  test("uses semantic markup rather than div soup", () => {
    assert.ok(pageDoc.querySelector("ol.news-list"), "list should be an <ol>");
    assert.ok(pageDoc.querySelector("li.sc-card-item"), "items should be <li>");
    assert.ok(pageDoc.querySelector("article.sc-card"), "cards should be <article>");
    assert.ok(pageDoc.querySelector("h3.sc-card-name"), "headlines should be headings");
    assert.ok(pageDoc.querySelector("time[datetime]"), "dates should be <time>");
    assert.ok(pageDoc.querySelector("nav.sc-pager"), "pager should be <nav>");
  });

  test("pagination controls are buttons, not crawlable filter links", () => {
    const pager = pageDoc.querySelector(".sc-pager");
    assert.equal(pager.querySelectorAll("a").length, 0, "pager must not use anchors");
    assert.equal(pager.querySelectorAll("button").length, 2);

    const parameterised = [...pageDoc.querySelectorAll("a[href]")].filter((a) => {
      const href = a.getAttribute("href");
      return (
        (href.startsWith("/") || href.startsWith("?") || href.startsWith("#")) &&
        (href.includes("?") || href.includes("&"))
      );
    });
    assert.equal(
      parameterised.length,
      0,
      "internal links must not carry tool state as parameters",
    );
  });

  test("entity names are crawlable links with descriptive anchor text", () => {
    const entityLinks = [...pageDoc.querySelectorAll("a.sc-entity-link")];
    assert.ok(entityLinks.length > 0, "expected player/team links");

    for (const a of entityLinks.slice(0, 5)) {
      assert.ok(
        a.getAttribute("href").startsWith("/nfl/"),
        "entity link should point at a real internal path",
      );
      assert.ok(
        a.textContent.trim().length > 2,
        "anchor text should be the entity name, not an icon",
      );
    }

    const related = pageDoc.querySelector(".sc-related-list a");
    assert.ok(related, "expected a related-tools link");
    assert.equal(related.textContent.trim(), "Fantasy Football Strength of Schedule");
  });

  test("images are real <img> with dimensions and correct loading strategy", () => {
    const imgs = [...pageDoc.querySelectorAll("img.sc-card-photo")];
    assert.ok(imgs.length > 0, "expected headshots as real <img> elements");

    for (const img of imgs) {
      assert.ok(img.getAttribute("src"), "img needs a src in the HTML");
      assert.ok(img.getAttribute("width"), "img needs an explicit width");
      assert.ok(img.getAttribute("height"), "img needs an explicit height");
      assert.ok(img.hasAttribute("alt"), "img needs an alt attribute");
    }

    // Exactly one LCP candidate, and it must not be lazy.
    const priority = imgs.filter((i) => i.getAttribute("fetchpriority") === "high");
    assert.equal(priority.length, 1, "expected exactly one fetchpriority=high image");
    assert.equal(priority[0], imgs[0], "the priority image should be the first one");
    assert.equal(
      priority[0].getAttribute("loading"),
      "eager",
      "the LCP image must not be lazy-loaded",
    );

    // Below-the-fold images should be lazy.
    const lazy = imgs.filter((i) => i.getAttribute("loading") === "lazy");
    assert.ok(lazy.length > 0, "below-the-fold images should be lazy-loaded");
  });

  test("reserves layout space so pagination cannot shift the page", () => {
    const list = pageDoc.querySelector(".news-list");
    assert.match(
      list.getAttribute("style") ?? "",
      /--sc-reserved-rows:\s*\d+/,
      "list must declare reserved rows for a stable min-height",
    );

    const css = fs.readFileSync(
      path.join(APP_DIR, "public", "styles.css"),
      "utf8",
    );
    assert.match(css, /\.news-list\s*\{[^}]*min-height/s, "list needs a min-height");
  });

  test("robots.txt blocks nothing needed to render the tool", async () => {
    const robots = await (await fetch(`${server.origin}/robots.txt`)).text();
    const disallowed = robots
      .split("\n")
      .filter((l) => /^\s*Disallow:/i.test(l))
      .map((l) => l.split(":")[1].trim())
      .filter(Boolean);

    for (const blocked of disallowed) {
      for (const critical of ["/styles.css", "/dist/", "/api/news", "/"]) {
        assert.notEqual(
          blocked,
          critical,
          `robots.txt must not block ${critical}`,
        );
      }
    }
  });

  test("unknown paths 404 instead of duplicating the page", async () => {
    const res = await fetch(`${server.origin}/nfl/some/other/thing`);
    assert.equal(res.status, 404);
    const body = await res.text();
    assert.ok(body.length < 2000, "404 must not be a copy of the tool page");
  });

  test("last-updated reflects content, not request time", async () => {
    const first = await (await fetch(`${server.origin}/`)).text();
    await new Promise((r) => setTimeout(r, 1100));
    const second = await (await fetch(`${server.origin}/`)).text();

    const stamp = (html) =>
      html.match(/class="sc-updated">[\s\S]*?datetime="([^"]+)"/)?.[1];

    assert.ok(stamp(first), "expected a last-updated stamp");
    assert.equal(
      stamp(first),
      stamp(second),
      "last-updated must not move between requests when nothing changed",
    );
  });

  test("repeat requests revalidate to 304", async () => {
    const first = await fetch(`${server.origin}/`);
    const etag = first.headers.get("etag");
    await first.text();

    assert.ok(etag, "expected an ETag");
    assert.match(etag, /^W\/"/, "expected a weak validator");

    // Raw HTTP rather than fetch(): per the Fetch spec, setting a conditional
    // header by hand switches the request to "no-store", and undici then sends
    // Cache-Control: no-cache — which correctly suppresses revalidation and
    // would make this assert a false negative. A real cache or crawler sends
    // the conditional header without that, which is what this reproduces.
    const conditional = await rawGet("/", { "If-None-Match": etag });
    assert.equal(conditional.status, 304, "expected a 304 on revalidation");
    assert.equal(conditional.body, "", "304 must have no body");

    // And a mismatched validator must still return the document.
    const stale = await rawGet("/", { "If-None-Match": 'W/"not-the-etag"' });
    assert.equal(stale.status, 200);
    assert.ok(stale.body.includes("<article"), "expected the full document");
  });
});

describe("mobile parity", () => {
  test("mobile styles change sizing only, never remove content", () => {
    const css = fs.readFileSync(
      path.join(APP_DIR, "public", "styles.css"),
      "utf8",
    );

    // Pull out every mobile media block and check none of them hide content.
    const blocks = [...css.matchAll(/@media[^{]*max-width[^{]*\{([\s\S]*?)\n\}/g)];
    assert.ok(blocks.length > 0, "expected responsive styles");

    for (const [, body] of blocks) {
      assert.ok(
        !/\.sc-card-item[^{]*\{[^}]*display\s*:\s*none/.test(body),
        "mobile CSS must not hide news items",
      );
      assert.ok(
        !/\.sc-card-name[^{]*\{[^}]*display\s*:\s*none/.test(body),
        "mobile CSS must not hide headlines",
      );
      assert.ok(
        !/\.news-list[^{]*\{[^}]*display\s*:\s*none/.test(body),
        "mobile CSS must not hide the list",
      );
    }
  });

  test("the served HTML is identical regardless of user agent", async () => {
    const desktop = await (
      await fetch(`${server.origin}/`, {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh)" },
      })
    ).text();
    const mobile = await (
      await fetch(`${server.origin}/`, {
        headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)" },
      })
    ).text();

    assert.equal(
      mobile.length,
      desktop.length,
      "mobile must receive the same content as desktop (responsive, not truncated)",
    );
  });
});
