/**
 * The club feeds are read with conditional GETs.
 *
 * A club publishes a few times a day and is swept every half hour, so a sweep
 * that re-downloads every feed is mostly downloading documents it already has.
 * The validators from the last 200 go back on the next request, and a 304 is
 * answered with the items that 200 carried.
 *
 * No network: `fetch` is replaced for the duration of each test.
 */

import test, { after, afterEach, describe } from "node:test";
import assert from "node:assert/strict";

import { cleanupBundles, importModule } from "./helpers/bundle.mjs";

const { __internals } = await importModule("lib/club-news");
const { fetchClub, feedMemo } = __internals;

after(cleanupBundles);

const NE = { abbreviation: "ne", siteDomain: "patriots.com" };

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Patriots</title>
<item><title>Patriots sign a kicker</title><link>https://www.patriots.com/news/k</link>
<guid isPermaLink="false">abc-1</guid><pubDate>Mon, 28 Sep 2026 12:00:00 GMT</pubDate></item>
</channel></rss>`;

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  feedMemo.clear();
});

/** Replace fetch with a script of responses, recording each request's headers. */
function script(...responses) {
  const seen = [];
  globalThis.fetch = async (_url, init) => {
    seen.push(new Headers(init?.headers));
    const next = responses.shift();
    if (!next) throw new Error("unexpected extra request");
    return next();
  };
  return seen;
}

describe("club feed conditional GET", () => {
  test("a 200's validators go back on the next request, and a 304 answers with its items", async () => {
    const seen = script(
      () =>
        new Response(RSS, {
          status: 200,
          headers: { ETag: '"v1"', "Last-Modified": "Mon, 28 Sep 2026 12:00:00 GMT" },
        }),
      () => new Response(null, { status: 304 }),
    );

    const first = await fetchClub(NE);
    assert.equal(first.length, 1);
    assert.equal(seen[0].get("if-none-match"), null, "a cold read sends no validators");

    const second = await fetchClub(NE);
    assert.equal(seen[1].get("if-none-match"), '"v1"');
    assert.equal(seen[1].get("if-modified-since"), "Mon, 28 Sep 2026 12:00:00 GMT");
    assert.deepEqual(second, first, "the 304 is answered with what the 200 carried");
  });

  test("a feed that sends no validators is read in full every time", async () => {
    const seen = script(
      () => new Response(RSS, { status: 200 }),
      () => new Response(RSS, { status: 200 }),
    );
    await fetchClub(NE);
    await fetchClub(NE);
    assert.equal(seen[1].get("if-none-match"), null);
    assert.equal(seen[1].get("if-modified-since"), null);
  });

  test("a failure keeps the memo, so the next sweep can still be a 304", async () => {
    const seen = script(
      () => new Response(RSS, { status: 200, headers: { ETag: '"v1"' } }),
      () => new Response("down", { status: 503 }),
      () => new Response(null, { status: 304 }),
    );
    await fetchClub(NE);
    await assert.rejects(fetchClub(NE), /503/);
    const third = await fetchClub(NE);
    assert.equal(seen[2].get("if-none-match"), '"v1"');
    assert.equal(third.length, 1);
  });
});
