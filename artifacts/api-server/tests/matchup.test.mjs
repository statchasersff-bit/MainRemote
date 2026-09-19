/**
 * Matchup page regression tests.
 *
 * Same posture as team.test.mjs: fetch the served HTML and assert on it with
 * no JavaScript run. What these lock is the URL contract — one address per
 * pair, every other spelling a 301, everything else a 404 — and that the page
 * lays itself out for the state the data declares rather than for a date.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { startServer } from "./helpers/server.mjs";

let server;
before(async () => {
  server = await startServer();
});
after(async () => {
  await server?.stop();
});

async function get(pathname) {
  const res = await fetch(`${server.origin}${pathname}`, { redirect: "manual" });
  return { status: res.status, headers: res.headers, body: await res.text() };
}

async function dom(pathname) {
  const res = await get(pathname);
  assert.equal(res.status, 200, `${pathname} should be 200`);
  return { ...res, doc: new JSDOM(res.body).window.document };
}

const CANON = "/nfl/new-england-patriots-vs-philadelphia-eagles/";

describe("one address per pair", () => {
  test("the canonical order serves the page", async () => {
    const { doc } = await dom(CANON);
    const root = doc.querySelector("[data-sct-root]");
    assert.equal(root.getAttribute("data-matchup"), "new-england-patriots-vs-philadelphia-eagles");
    const h1 = doc.querySelectorAll("h1");
    assert.equal(h1.length, 1);
    assert.equal(h1[0].textContent.trim(), "New England Patriots vs Philadelphia Eagles");
  });

  test("every other spelling of the pair is a 301 to it", async () => {
    // Reversed, abbreviated, nicknamed — the reader's route in cannot mint a
    // second page for the same query.
    for (const path of [
      "/nfl/philadelphia-eagles-vs-new-england-patriots/",
      "/nfl/phi-vs-ne/",
      "/nfl/ne-vs-phi",
      "/nfl/eagles-vs-patriots/",
    ]) {
      const res = await get(path);
      assert.equal(res.status, 301, path);
      assert.equal(res.headers.get("location"), CANON, path);
    }
    const embedded = await get("/nfl/phi-vs-ne/?embed=1");
    assert.equal(embedded.headers.get("location"), `${CANON}?embed=1`);
  });

  test("anything that is not two different real teams is a 404", async () => {
    // Nothing falls through to a hub or to a generic page: a fake team, a team
    // against itself, a third segment, a bare slug, the /nfl/teams/ container.
    for (const path of [
      "/nfl/new-england-patriots-vs-fake-team/",
      "/nfl/new-england-patriots-vs-new-england-patriots/",
      "/nfl/ne-vs-ne/",
      "/nfl/new-england-patriots/",
      "/nfl/teams/",
      "/nfl/-vs-philadelphia-eagles/",
      "/nfl/new-england-patriots-vs-philadelphia-eagles-vs-buffalo-bills/",
      `${CANON}extra`,
    ]) {
      const res = await get(path);
      assert.equal(res.status, 404, path);
      assert.equal(res.headers.get("x-robots-tag"), "noindex", path);
      assert.ok(!/data-sct-root/.test(res.body), `${path}: no page rendered`);
    }
    assert.equal((await get("/embed/matchup/ne-vs-ne")).status, 404);
  });

  test("the head names the pair at its own address, once", async () => {
    const { doc } = await dom(CANON);
    const one = (selector) => {
      const found = doc.querySelectorAll(selector);
      assert.equal(found.length, 1, `exactly one ${selector}`);
      return found[0];
    };
    const canonical = one('link[rel="canonical"]').getAttribute("href");
    assert.ok(canonical.endsWith(CANON), "canonical is the pretty pair path");
    assert.equal(one('meta[property="og:url"]').getAttribute("content"), canonical);
    assert.match(one("title").textContent, /^New England Patriots vs Philadelphia Eagles/);
    one('meta[name="description"]');
    one('meta[name="robots"]');
  });
});

describe("the page follows its state", () => {
  test("declares one of the three states and leads with the matching block", async () => {
    const { doc } = await dom(CANON);
    const state = doc.querySelector("[data-sct-root]").getAttribute("data-matchup-state");
    assert.ok(["upcoming", "recently_completed", "historical"].includes(state), state);

    const featured = doc.querySelector(".sct-mu-featured");
    const title = featured?.querySelector("h2")?.textContent.trim();
    const expected = { upcoming: "Up Next", recently_completed: "Final", historical: "Last Meeting" }[state];
    if (featured) assert.equal(title, expected, `${state} leads with ${expected}`);

    // Where to Watch exists only for an upcoming game, and only from real
    // schedule fields — never a "check local listings" line.
    const watch = doc.querySelector(".sct-mu-watch");
    if (state !== "upcoming") assert.equal(watch, null, "no watch block unless upcoming");
    if (watch) {
      assert.ok(watch.querySelectorAll("dt").length >= 1);
      assert.ok(!/local listings/i.test(watch.textContent));
    }
  });

  test("the title carries the state's phrase", async () => {
    const { doc } = await dom(CANON);
    const state = doc.querySelector("[data-sct-root]").getAttribute("data-matchup-state");
    const title = doc.querySelector("title").textContent;
    const phrase = {
      upcoming: /Where to Watch, Stats, Injuries & History/,
      recently_completed: /Score, Stats & Head-to-Head/,
      historical: /Head-to-Head Record, Stats & History/,
    }[state];
    assert.match(title, phrase);
  });

  test("the snapshot compares the two teams on the Stats tab's own rows", async () => {
    const { doc } = await dom(CANON);
    const tables = doc.querySelectorAll(".sct-mu-table");
    if (tables.length === 0) return; // ESPN down for both: the block is absent, not faked.
    for (const table of tables) {
      const heads = [...table.querySelectorAll("thead th")].map((th) => th.textContent.trim());
      assert.equal(heads.length, 3);
      for (const row of table.querySelectorAll("tbody tr")) {
        assert.equal(row.querySelectorAll("td").length, 2, "one value cell per side");
      }
    }
  });

  test("the head-to-head record agrees with the meetings listed", async () => {
    const { doc } = await dom(CANON);
    const line = doc.querySelector(".sct-mu-h2h-line")?.textContent.trim();
    const rows = [...doc.querySelectorAll(".sct-mu-meetings .sct-mu-result:not(.is-pending)")];
    if (!line) {
      assert.equal(rows.length, 0, "no record line means no completed meetings");
      return;
    }
    const m = /(\d+)–(\d+)(?:–(\d+))?/.exec(line);
    assert.ok(m, line);
    const total = Number(m[1]) + Number(m[2]) + Number(m[3] ?? 0);
    assert.equal(total, rows.length, "record counts exactly the finals shown");
  });
});

describe("links between the family", () => {
  test("the pair page links both hubs and both matchup hubs", async () => {
    const { doc } = await dom(CANON);
    const hrefs = [...doc.querySelectorAll(".sct-pages a")].map((a) => a.getAttribute("href"));
    assert.deepEqual(hrefs, [
      "/team/new-england-patriots",
      "/team/new-england-patriots/matchups/",
      "/team/philadelphia-eagles",
      "/team/philadelphia-eagles/matchups/",
    ]);
  });

  test("a team's matchups hub links every opponent to the canonical pair", async () => {
    const { doc } = await dom("/team/new-england-patriots/matchups/");
    assert.equal(doc.querySelector("h1").textContent.trim(), "New England Patriots Matchups 2026");
    const hrefs = [...doc.querySelectorAll('a[href^="/nfl/"]')].map((a) => a.getAttribute("href"));
    assert.ok(hrefs.length >= 10, "one link per scheduled game");
    for (const href of hrefs) {
      const m = /^\/nfl\/([a-z0-9-]+)-vs-([a-z0-9-]+)\/$/.exec(href);
      assert.ok(m, `${href} is a pair path`);
      assert.ok(m[1] < m[2], `${href} is in canonical order`);
      assert.ok(m[1] === "new-england-patriots" || m[2] === "new-england-patriots");
      // Every one resolves without a redirect — the hub never links a spelling
      // the route would have to correct.
      assert.equal((await get(href)).status, 200, href);
    }
    // A divisional opponent is two rows, one page.
    const counts = hrefs.reduce((m, h) => m.set(h, (m.get(h) ?? 0) + 1), new Map());
    assert.ok([...counts.values()].some((n) => n === 2), "a repeated opponent shares its page");
  });

  test("both hubs link the same page for the pair", async () => {
    const ne = await dom("/team/new-england-patriots/matchups/");
    const phi = await dom("/team/philadelphia-eagles/matchups/");
    const from = (doc) => new Set([...doc.querySelectorAll('a[href^="/nfl/"]')].map((a) => a.getAttribute("href")));
    const shared = [...from(ne.doc)].filter((h) => from(phi.doc).has(h));
    // They only meet if scheduled; when they do, it is the one canonical URL.
    for (const h of shared) assert.equal(h, CANON);
  });

  test("matchup links are plain anchors, not top-frame navigations", async () => {
    // `target="_top"` is for siteLink(), which leaves the tool for the main
    // site. These go to the tool's own pages, and carrying the target means a
    // sandboxed preview frame blocks the navigation and the link does nothing
    // — which is exactly how this was found.
    for (const path of [CANON, "/team/new-england-patriots/matchups/"]) {
      const { doc } = await dom(path);
      const links = [
        ...doc.querySelectorAll('.sct-pages a[href], a[href^="/nfl/"]'),
      ];
      assert.ok(links.length > 0, `${path}: has links`);
      for (const link of links) {
        assert.equal(
          link.getAttribute("target"),
          null,
          `${path}: ${link.getAttribute("href")} must not break out of the frame`,
        );
      }
    }
  });

  test("the matchups hub is a section like the others", async () => {
    const res = await get("/team/new-england-patriots?section=matchups");
    assert.equal(res.status, 301);
    assert.equal(res.headers.get("location"), "/team/new-england-patriots/matchups/");
    const frag = await get("/embed/team/ne?section=matchups");
    assert.match(frag.body, /data-section="matchups"/);
    assert.ok(!/<h1\b/i.test(frag.body));
  });
});

describe("the WordPress fragment", () => {
  test("is bare, scoped, and says which state it is in", async () => {
    const res = await get("/embed/matchup/new-england-patriots-vs-philadelphia-eagles");
    assert.equal(res.status, 200);
    assert.ok(["upcoming", "recently_completed", "historical"].includes(res.headers.get("x-matchup-state")));
    assert.match(res.headers.get("x-matchup-season"), /^2\d{3}$/);
    assert.ok(!/<h1\b/i.test(res.body), "the host page owns the H1");
    assert.ok(!/<link\b/i.test(res.body) && !/<script\b/i.test(res.body), "no assets of its own");
    assert.match(res.body, /data-matchup=/);
  });
});
