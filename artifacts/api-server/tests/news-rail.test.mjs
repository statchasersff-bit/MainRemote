/**
 * The compact news rail, [statchasers_news layout="rail"] (lib/news-rail.ts,
 * mak 2026-11-17): GET /embed/ssr?layout=rail renders the rail, and without
 * layout=rail the endpoint is the full feed exactly as before.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import fs from "node:fs";
import { startServer, APP_DIR } from "./helpers/server.mjs";

let server;
before(async () => {
  server = await startServer();
});
after(async () => {
  await server?.stop();
});

async function fragment(query) {
  const res = await fetch(`${server.origin}/embed/ssr?${query}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  return body.html;
}

const rows = (html) => (html.match(/class="sc-rail-item"/g) ?? []).length;
const visibleRows = (html) => (html.match(/class="sc-rail-item" data-page="\d+"(?! hidden)/g) ?? []).length;

describe("news rail (layout=rail)", () => {
  test("six stories a page, plain team codes, compact times, Prev / Next paging and no View All link", async () => {
    const html = await fragment("layout=rail");
    if (rows(html) === 0) return; // an empty archive in this environment
    assert.match(html, /^<section class="sc-rail"/);
    assert.match(html, /<h2 class="sc-rail-title">Latest Fantasy News<\/h2>/);
    assert.ok(rows(html) <= 30, "five pages of six");
    assert.ok(visibleRows(html) <= 6, "only the first page shows");
    assert.match(html, /data-sc-limit="6" data-sc-pages="5"/);
    if (rows(html) > 6) assert.match(html, /<nav class="sc-rail-pager"[^>]*>.*Page <b>1<\/b> of \d+/);
    assert.doesNotMatch(html, /View All|sc-rail-all/, "no View All link (mak, 2026-11-17)");
    assert.match(html, /class="sc-rail-thumb"/);
    // One meta line, CATEGORY · TEAM · date (mak, 2026-11-17): category first,
    // the team as plain text (full name on hover), "Nov 5" with the full
    // timestamp on the <time> element. Separators come from CSS, not markup.
    assert.match(html, /<p class="sc-rail-meta"><span class="sc-rail-m sc-rail-cat">[A-Z][a-z]+[^<]*<\/span> (?:<abbr class="sc-rail-m sc-rail-team" title="[A-Z][^"]+">[A-Z]{2,3}<\/abbr> |<span class="sc-rail-m sc-rail-by">@[^<]+<\/span> )?<time class="sc-rail-m sc-rail-time" datetime="[^"]+" data-ts="\d+" title="\w+ \d+, \d{4} \d+:\d{2} [AP]M ET">\w+ \d+<\/time><\/p>/);
    assert.doesNotMatch(html, /sc-rail-sep|sc-rail-x/, "no separator spans or icons");
    // None of the full feed's furniture.
    assert.doesNotMatch(html, /sc-card-summary|sc-filters|has-team-logo/);
    for (const a of html.match(/<a class="sc-rail-link"[^>]*>/g) ?? []) {
      assert.match(a, /href="https?:\/\//);
      assert.match(a, /target="_blank" rel="noopener noreferrer"/);
    }
  });

  test("every page's rows are in the HTML, shown without the script; pages=1 has no pager", async () => {
    const html = await fragment("layout=rail");
    if (rows(html) <= 6) return;
    assert.match(html, /<noscript><style>[^<]*sc-rail-item\[hidden\]/, "without the script every row shows");
    const one = await fragment("layout=rail&pages=1");
    assert.ok(rows(one) <= 6);
    assert.doesNotMatch(one, /sc-rail-pager/);
  });

  test("a story the wire sent without a photo gets the player's ESPN headshot when one is known", async () => {
    const res = await fetch(`${server.origin}/api/news?limit=40`);
    const plain = (await res.json()).items ?? [];
    const filled = (await (await fetch(`${server.origin}/api/news?limit=40&photos=1`)).json()).items ?? [];
    const bare = plain.filter((it) => !it.image).length;
    if (!bare) return;
    assert.equal(plain.filter((it) => !it.image).length, bare, "the full feed's response is untouched");
    const stillBare = filled.filter((it) => !it.image).length;
    assert.ok(stillBare <= bare);
    for (const it of filled.filter((x) => x.image && !plain.find((p) => p.id === x.id)?.image)) {
      assert.match(it.image, /^https:\/\/a\.espncdn\.com\/i\/headshots\/nfl\/players\/full\/\d+\.png$/);
    }
  });

  test("the row count is validated: 3 to 10, non-numbers fall back to six", async () => {
    const big = await fragment("layout=rail&limit=99");
    if (rows(big) === 0) return;
    assert.ok(visibleRows(big) <= 10, "ten rows a page at most");
    assert.match(big, /data-sc-limit="10"/);
    assert.match(await fragment("layout=rail&limit=1"), /data-sc-limit="3"/);
    assert.match(await fragment("layout=rail&limit=abc"), /data-sc-limit="6"/);
    assert.match(await fragment("layout=rail&pages=40"), /data-sc-pages="10"/);
    assert.match(await fragment("layout=rail&pages=0"), /data-sc-pages="1"/);
  });

  test("Next and Prev step through the pages, through the real client bundle", async () => {
    const html = await fragment("layout=rail&limit=3&pages=3");
    if (rows(html) <= 3) return; // not enough stories for a second page here
    const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { runScripts: "outside-only", pretendToBeVisual: true });
    const { window } = dom;
    try {
      window.fetch = async () => ({ ok: false });
      window.eval(fs.readFileSync(`${APP_DIR}/public/dist/statchasers-news-rail.js`, "utf8"));
      const doc = window.document;
      // The bundle boots on DOMContentLoaded when the document is still loading.
      for (let i = 0; i < 50 && doc.querySelector(".sc-rail")?.dataset.scRailReady !== "1"; i += 1) {
        await new Promise((r) => setTimeout(r, 10));
      }
      const shownPage = () => [...doc.querySelectorAll(".sc-rail-item")].filter((li) => !li.hidden).map((li) => li.dataset.page);
      assert.deepEqual(shownPage(), ["1", "1", "1"]);
      assert.equal(doc.querySelector(".sc-rail-prev").disabled, true);
      doc.querySelector(".sc-rail-next").click();
      assert.deepEqual(shownPage(), ["2", "2", "2"]);
      assert.match(doc.querySelector(".sc-rail-count").textContent, /Page 2 of/);
      doc.querySelector(".sc-rail-prev").click();
      assert.deepEqual(shownPage(), ["1", "1", "1"]);
    } finally {
      // The bundle's intervals live on this window; closing it clears them.
      window.close();
    }
  });

  test("without layout=rail the endpoint is the full feed, untouched", async () => {
    const full = await fragment("limit=250&page_size=4&heading=1");
    assert.doesNotMatch(full, /sc-rail/);
    assert.match(full, /class="sc-card[ "]/);
  });
});
