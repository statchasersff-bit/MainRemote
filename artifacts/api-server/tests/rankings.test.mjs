/**
 * Rest-of-season rankings regression tests.
 *
 * The page lives at /rest-of-season-rankings, one address per board beneath
 * it; /rankings is the old address and only redirects.
 *
 * Same posture as fpa.test.mjs: assert on the served HTML without executing any
 * JavaScript, because the whole point of this rewrite is that the boards arrive
 * complete. The standalone app this replaced shipped a container and filled it
 * from React state, so the assertion that actually matters here is the boring
 * one — that a response nobody ran a bundle against contains 230 player names.
 *
 * Two suites need no server. The tier rules and the CSV parser are pure
 * functions, and both make a claim worth checking rather than trusting: that
 * the tier boundaries the data module applies are the ones the standalone app
 * published, and that the parser drops a malformed row instead of inventing a
 * player from it.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { JSDOM } from "jsdom";
import { startServer } from "./helpers/server.mjs";
import { importModule, cleanupBundles } from "./helpers/bundle.mjs";

let server;
/** Whether a rankings file is present to render. */
let hasData;

before(async () => {
  server = await startServer();
  const probe = await fetch(`${server.origin}/embed/rankings`);
  hasData = probe.status === 200;
});

after(async () => {
  await server?.stop();
  await cleanupBundles();
});

function rawGet(pathname, headers = {}) {
  const url = new URL(pathname, server.origin);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: "GET",
        headers,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, body }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function page(pathname) {
  const res = await fetch(`${server.origin}${pathname}`);
  const html = await res.text();
  return { res, doc: new JSDOM(html).window.document, html };
}

/* ------------------------------------------------------------ pure modules */

describe("tier rules", () => {
  let mod;

  before(async () => {
    mod = await importModule("lib/rankings/rankings-data");
  });

  test("the tier boundaries are the published ones", () => {
    // The exact cliffs the standalone app drew. Restated here rather than read
    // from TIER_RULES, because a test that reads the table it is checking only
    // asserts that the table equals itself.
    const cases = [
      ["QB", 1, 1], ["QB", 5, 1], ["QB", 6, 2], ["QB", 13, 2], ["QB", 14, 3],
      ["RB", 4, 1], ["RB", 5, 2], ["RB", 11, 2], ["RB", 12, 3], ["RB", 50, 7],
      ["WR", 4, 1], ["WR", 5, 2], ["WR", 12, 2], ["WR", 13, 3], ["WR", 63, 7],
      ["TE", 3, 1], ["TE", 4, 2], ["TE", 9, 2], ["TE", 10, 3], ["TE", 39, 6],
    ];
    for (const [position, rank, tier] of cases) {
      assert.equal(
        mod.getTier(position, rank),
        tier,
        `${position}${rank} should be tier ${tier}`,
      );
    }
  });

  test("a rank past the last rule keeps the last tier", () => {
    // The boards are sliced to POSITION_LIMITS, so this is defensive — but the
    // alternative to a defined answer here is `undefined` reaching the markup.
    assert.equal(mod.getTier("QB", 999), 6);
    assert.equal(mod.getTier("WR", 999), 7);
  });

  test("tiers never go backwards as rank increases", () => {
    for (const position of mod.STAT_POSITIONS) {
      let previous = 0;
      for (let rank = 1; rank <= mod.POSITION_LIMITS[position]; rank += 1) {
        const tier = mod.getTier(position, rank);
        assert.ok(
          tier >= previous,
          `${position}${rank} dropped from tier ${previous} to ${tier}`,
        );
        previous = tier;
      }
    }
  });

  test("names normalise across suffix and punctuation spellings", () => {
    assert.equal(mod.normalizeName("Michael Pittman Jr."), "michael pittman");
    assert.equal(mod.normalizeName("Ja'Marr Chase"), "jamarr chase");
    assert.equal(mod.normalizeName("Marvin Harrison Jr"), "marvin harrison");
    assert.equal(mod.normalizeName("  A.J.  Brown "), "aj brown");
  });
});

describe("the CSV parser", () => {
  let parse;

  before(async () => {
    ({ parseRankingsCsv: parse } = await importModule(
      "lib/rankings/rankings-data",
    ));
  });

  test("reads the published three-column shape", () => {
    const rows = parse("Position,Final Rank,Player\nQB,1,Josh Allen\nRB,2,Bijan Robinson\n");
    assert.deepEqual(rows, [
      { position: "QB", rank: 1, name: "Josh Allen" },
      { position: "RB", rank: 2, name: "Bijan Robinson" },
    ]);
  });

  test("drops the header, blanks and malformed rows rather than guessing", () => {
    const rows = parse(
      [
        "Position,Final Rank,Player",
        "",
        "QB,1,Josh Allen",
        "K,1,Justin Tucker", // not a fantasy position this board covers
        "QB,notanumber,Somebody",
        "QB,2,", // no name
        "QB", // no commas at all
        "   ",
      ].join("\n"),
    );
    assert.deepEqual(rows, [{ position: "QB", rank: 1, name: "Josh Allen" }]);
  });

  test("a comma in a name survives", () => {
    const rows = parse("WR,1,Smith, Jr.\n");
    assert.equal(rows[0].name, "Smith, Jr.");
  });
});

/* -------------------------------------------------------------- the routes */

describe("the rankings page", () => {
  test("serves the boards with the embedding posture", async (t) => {
    if (!hasData) return t.skip("no rankings file");
    const { res, doc } = await page("/rest-of-season-rankings");

    assert.equal(res.status, 200);
    assert.equal(
      res.headers.get("x-robots-tag"),
      "noindex, indexifembedded",
      "this origin must not compete with statchasers.com",
    );
    assert.match(
      doc.querySelector("meta[name=robots]").getAttribute("content"),
      /noindex, indexifembedded/,
    );
    assert.match(doc.title, /Rest of Season Fantasy Football Rankings/);
    assert.doesNotMatch(doc.title, /redraft/i, "the page says what its URL says");
    assert.ok(doc.querySelector("link[rel=canonical]"), "needs a canonical");
  });

  test("each position is its own canonical, and nothing else mints one", async (t) => {
    if (!hasData) return t.skip("no rankings file");
    const canonical = (doc) => doc.querySelector("link[rel=canonical]").href;

    const bare = await page("/rest-of-season-rankings");
    const rb = await page("/rest-of-season-rankings/rb");
    assert.match(canonical(bare.doc), /\/rest-of-season-rankings$/);
    assert.match(canonical(rb.doc), /\/rest-of-season-rankings\/rb$/);

    const stated = await page("/rest-of-season-rankings/rb?season=2026&embed=1");
    assert.equal(
      canonical(stated.doc),
      canonical(rb.doc),
      "season and embed are page state, not addresses",
    );
  });

  test("a position page has its own title", async (t) => {
    if (!hasData) return t.skip("no rankings file");
    const bare = await page("/rest-of-season-rankings");
    const te = await page("/rest-of-season-rankings/te");

    assert.match(te.doc.title, /Rest of Season Fantasy Football TE Rankings: Tight Ends/);
    assert.notEqual(te.doc.title, bare.doc.title);
  });

  test("all five panels are in the HTML, unexecuted", async (t) => {
    if (!hasData) return t.skip("no rankings file");
    const { doc } = await page("/rest-of-season-rankings");

    const panels = [...doc.querySelectorAll("[data-scr-panel]")].map((p) => p.id);
    assert.deepEqual(panels, [
      "scr-panel-all",
      "scr-panel-qb",
      "scr-panel-rb",
      "scr-panel-wr",
      "scr-panel-te",
    ]);

    // The point of the rewrite: the board nobody clicked is still on the page.
    for (const [id, expected] of [
      ["scr-panel-qb", 40],
      ["scr-panel-rb", 50],
      ["scr-panel-wr", 100],
      ["scr-panel-te", 40],
    ]) {
      const rows = doc.querySelectorAll(`#${id} .scr-row`);
      assert.equal(rows.length, expected, `${id} should hold ${expected} rows`);
    }
  });

  test("the tail of the All board is disclosed, not withheld", async (t) => {
    if (!hasData) return t.skip("no rankings file");
    const { doc } = await page("/rest-of-season-rankings");
    const all = doc.querySelector("#scr-panel-all");

    const rows = all.querySelectorAll(".scr-all-row");
    assert.ok(rows.length > 50, "every row belongs in the response");
    assert.ok(
      all.querySelector("details.scr-more"),
      "the rows past the first screen sit in a <details>, not in JS state",
    );
  });

  test("exactly one panel opens by default, and the path chooses it", async (t) => {
    if (!hasData) return t.skip("no rankings file");

    const bare = await page("/rest-of-season-rankings");
    const defaults = bare.doc.querySelectorAll("[data-scr-panel].is-default");
    assert.equal(defaults.length, 1);
    assert.equal(defaults[0].id, "scr-panel-all");

    const te = await page("/rest-of-season-rankings/te");
    assert.equal(te.res.status, 200);
    const open = te.doc.querySelectorAll("[data-scr-panel].is-default");
    assert.equal(open.length, 1);
    assert.equal(open[0].id, "scr-panel-te");
    assert.equal(
      te.doc.querySelectorAll("[data-scr-panel]").length,
      5,
      "a position page still carries every board, so the tabs switch in place",
    );
  });

  test("each board has exactly one address", async () => {
    for (const [from, to] of [
      ["/rest-of-season-rankings/RB", "/rest-of-season-rankings/rb"],
      ["/rest-of-season-rankings/all", "/rest-of-season-rankings"],
      ["/rest-of-season-rankings?pos=wr", "/rest-of-season-rankings/wr"],
      ["/rest-of-season-rankings?pos=kicker", "/rest-of-season-rankings"],
      ["/rest-of-season-rankings/qb?pos=te", "/rest-of-season-rankings/qb"],
    ]) {
      const res = await rawGet(from);
      assert.equal(res.status, 301, from);
      assert.equal(res.headers.location, to, from);
    }

    const kicker = await rawGet("/rest-of-season-rankings/k");
    assert.equal(kicker.status, 404, "a position the board lacks is not a page");
  });

  /*
   * /rankings is the redraft board — its own file, its own page — and reads
   * exactly as it did before the rest-of-season board was split off: one
   * address, in-page tabs, the redraft title.
   */
  test("/rankings is the redraft board, one address with in-page tabs", async (t) => {
    if (!hasData) return t.skip("no rankings file");
    const { res, doc } = await page("/rankings?pos=te");
    assert.equal(res.status, 200);
    assert.match(doc.title, /^\d{4} Fantasy Football Redraft Rankings \| StatChasers$/);
    assert.equal(doc.querySelector("[data-scr-root]").dataset.scrBoard, "redraft");
    assert.deepEqual(
      [...doc.querySelectorAll(".scr-nav-link")].map((a) => a.getAttribute("href")),
      ["#scr-panel-all", "#scr-panel-qb", "#scr-panel-rb", "#scr-panel-wr", "#scr-panel-te"],
    );
    assert.equal(doc.querySelector("[data-scr-panel].is-default").id, "scr-panel-te", "?pos= still opens a panel");
    assert.equal(
      doc.querySelector('link[rel="canonical"]').getAttribute("href").replace(/^https?:\/\/[^/]+/, ""),
      "/rankings",
      "one canonical for every panel",
    );

    const csv = await fetch(`${server.origin}/rankings/download.csv`);
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get("content-disposition"), /statchasers-redraft-\d{4}\.csv/);
  });

  test("/rest-of-season-rankings is the rest-of-season board", async (t) => {
    if (!hasData) return t.skip("no rankings file");
    const { doc } = await page("/rest-of-season-rankings");
    assert.equal(doc.querySelector("[data-scr-root]").dataset.scrBoard, "ros");
    assert.match(doc.title, /Rest of Season Fantasy Football Rankings/);
  });

  test("the tab strip is links to each board's address, with no ARIA roles", async (t) => {
    if (!hasData) return t.skip("no rankings file");
    const { doc } = await page("/rest-of-season-rankings/wr");

    const links = [...doc.querySelectorAll(".scr-nav-link")];
    assert.deepEqual(
      links.map((link) => [link.getAttribute("href"), link.dataset.scrPanelId]),
      [
        ["/rest-of-season-rankings", "scr-panel-all"],
        ["/rest-of-season-rankings/qb", "scr-panel-qb"],
        ["/rest-of-season-rankings/rb", "scr-panel-rb"],
        ["/rest-of-season-rankings/wr", "scr-panel-wr"],
        ["/rest-of-season-rankings/te", "scr-panel-te"],
      ],
    );
    assert.equal(
      doc.querySelector(".scr-nav-link.is-active").dataset.scrPanelId,
      "scr-panel-wr",
    );
    for (const link of links) {
      // role="tab" promises arrow keys. The server cannot keep that promise,
      // so it does not make it — client/rankings.ts adds the roles when it
      // adds the behaviour.
      assert.equal(link.getAttribute("role"), null);
    }
  });

  test("embed mode stays embed mode across the tabs", async (t) => {
    if (!hasData) return t.skip("no rankings file");
    const { doc } = await page("/rest-of-season-rankings?embed=1");
    const rb = [...doc.querySelectorAll(".scr-nav-link")].find(
      (link) => link.dataset.scrPanelId === "scr-panel-rb",
    );
    assert.equal(rb.getAttribute("href"), "/rest-of-season-rankings/rb?embed=1");
  });

  test("a player with no page is named, not linked", async (t) => {
    if (!hasData) return t.skip("no rankings file");
    const { doc } = await page("/rest-of-season-rankings");

    const rows = [...doc.querySelectorAll("#scr-panel-wr .scr-row")];
    const unlinked = rows.filter((row) =>
      row.querySelector("span.scr-player-link"),
    );
    assert.ok(
      unlinked.length > 0,
      "the current board has free agents the dictionary cannot place",
    );
    for (const row of unlinked) {
      assert.equal(row.querySelector("a.scr-player-link"), null);
      assert.ok(
        row.querySelector(".scr-player").textContent.trim().length > 0,
        "the row keeps the name it cannot link",
      );
    }
  });

  test("the View profile button is a pointer target, not a second link", async (t) => {
    if (!hasData) return t.skip("no rankings file");
    const { doc } = await page("/rest-of-season-rankings");

    const rows = [...doc.querySelectorAll("#scr-panel-rb .scr-row")];
    assert.ok(rows.length > 0);

    for (const row of rows) {
      const name = row.querySelector("a.scr-player-link");
      const cta = row.querySelector("a.scr-cta");

      if (!name) {
        // Rule 1: no page, no button — and the cell is still there, so the
        // column does not close up under the rows it has nothing for.
        assert.equal(cta, null, "an unlinked player gets no button");
        assert.ok(row.querySelector(".scr-cta-cell.is-empty"));
        continue;
      }

      assert.equal(
        cta.getAttribute("href"),
        name.getAttribute("href"),
        "the button and the name must not go to different places",
      );
      // The reason this row is allowed two anchors at all: only one of them is
      // in the tab order and only one of them is in the accessibility tree.
      assert.equal(cta.getAttribute("tabindex"), "-1");
      assert.equal(cta.getAttribute("aria-hidden"), "true");
      assert.equal(name.getAttribute("aria-hidden"), null);
    }
  });

  test("the tier tables carry a fourth column for the button", async (t) => {
    if (!hasData) return t.skip("no rankings file");
    const { doc } = await page("/rest-of-season-rankings");

    const table = doc.querySelector("#scr-panel-te .scr-table");
    assert.equal(table.querySelectorAll("colgroup col").length, 4);
    assert.equal(table.querySelectorAll("thead th").length, 4);
    // A rowgroup header that spans three of four columns would leave a stray
    // empty cell beside every tier heading.
    for (const head of table.querySelectorAll(".scr-tier-head th")) {
      assert.equal(head.getAttribute("colspan"), "4");
    }
    for (const row of table.querySelectorAll(".scr-row")) {
      assert.equal(row.children.length, 4);
    }
  });

  test("tiers are announced as rowgroups, not as styled rows", async (t) => {
    if (!hasData) return t.skip("no rankings file");
    const { doc } = await page("/rest-of-season-rankings");

    const heads = [...doc.querySelectorAll("#scr-panel-qb .scr-tier-head th")];
    assert.ok(heads.length >= 5);
    for (const head of heads) {
      assert.equal(head.getAttribute("scope"), "rowgroup");
      assert.match(head.textContent, /^Tier \d+$/);
    }
  });

  test("the side-by-side caption says the ranks are positional", async (t) => {
    if (!hasData) return t.skip("no rankings file");
    const { doc } = await page("/rest-of-season-rankings");

    const caption = doc.querySelector(
      "#scr-panel-all .scr-all-table caption",
    ).textContent;
    // The shape of the table invites "QB7 and RB7 go at the same pick". The
    // caption is the only thing standing between a reader and that reading —
    // it is screen-reader-only now, but it is still there to be read.
    assert.match(caption, /positional rank/i);
    assert.match(caption, /not a claim/i);
  });

  test("the questions are in the markup, answers and all", async (t) => {
    if (!hasData) return t.skip("no rankings file");
    const { doc } = await page("/rest-of-season-rankings");

    const items = [...doc.querySelectorAll(".scr-faq-item")];
    assert.ok(items.length >= 9, "the FAQ renders its questions");

    for (const item of items) {
      const question = item.querySelector(".scr-faq-q");
      const answer = item.querySelector(".scr-faq-a");
      // Shut by default — the questions are the index — but never withheld.
      // The answer is in the DOM whether or not the fold is open, which is the
      // same claim the panels make about the four boards nobody clicked.
      assert.equal(item.hasAttribute("open"), false);
      assert.equal(question.tagName, "H3");
      assert.ok(question.textContent.trim().length > 10);
      assert.ok(answer.textContent.trim().length > 40);
    }
  });

  test("the FAQ sits outside the panels, so no tab hides it", async (t) => {
    if (!hasData) return t.skip("no rankings file");
    const { doc } = await page("/rest-of-season-rankings");

    const faq = doc.querySelector(".scr-faq-block");
    assert.ok(faq, "the block is on the page");
    // Inside a panel it would be switched off with four of the five boards.
    assert.equal(faq.closest("[data-scr-panel]"), null);
    assert.ok(faq.closest("[data-scr-root]"), "still inside the mount");
  });

  test("the scoring answer does not promise a switch the board lacks", async (t) => {
    if (!hasData) return t.skip("no rankings file");
    const { doc } = await page("/rest-of-season-rankings");

    const answer = [...doc.querySelectorAll(".scr-faq-item")]
      .map((item) => item.querySelector(".scr-faq-a").textContent)
      .find((text) => /Half PPR/i.test(text));

    assert.ok(answer, "a question covers the scoring formats");
    // The format row marks Half PPR and Standard unavailable because there is
    // no file behind either. An answer telling a reader to switch between them
    // is the page contradicting its own controls.
    assert.match(answer, /published in PPR only/i);
    assert.match(answer, /unavailable/i);
    assert.doesNotMatch(answer, /switch between/i);
  });

  test("one FAQPage, describing the questions actually rendered", async (t) => {
    if (!hasData) return t.skip("no rankings file");
    const { doc } = await page("/rest-of-season-rankings");

    const blocks = [...doc.querySelectorAll('script[type="application/ld+json"]')];
    // A document gets one FAQPage. Two is the failure mode that gets structured
    // data ignored outright rather than merged.
    assert.equal(blocks.length, 1);

    const node = JSON.parse(blocks[0].textContent);
    assert.equal(node["@type"], "FAQPage");

    const rendered = [...doc.querySelectorAll(".scr-faq-q")].map((q) =>
      q.textContent.trim(),
    );
    assert.deepEqual(
      node.mainEntity.map((entry) => entry.name),
      rendered,
      "the node describes the page, not a second list",
    );
    for (const entry of node.mainEntity) {
      assert.equal(entry["@type"], "Question");
      assert.equal(entry.acceptedAnswer["@type"], "Answer");
      assert.ok(entry.acceptedAnswer.text.length > 40);
    }
  });
});

describe("the embed fragment", () => {
  // The FAQ and the page copy (title/H1/description): the two inert islands.
  const INERT_FAQ =
    /<script type="application\/json" class="scr-(?:faq|page)-data">.*?<\/script>/gs;

  test("is a bare fragment with no document chrome", async (t) => {
    if (!hasData) return t.skip("no rankings file");
    const res = await fetch(`${server.origin}/embed/rankings`);
    const html = await res.text();

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-robots-tag"), "noindex, indexifembedded");
    assert.doesNotMatch(html, /<html/i, "the host page owns the document");
    // The FAQ's inert payload is the one <script> allowed through, on the same
    // terms team.test.mjs sets out for the team and player mounts: it carries
    // no code, and the plugin lifts it into Rank Math's graph and strips it
    // before printing. Matched exactly, so a real script beside it still fails.
    assert.doesNotMatch(
      html.replace(INERT_FAQ, ""),
      /<script/i,
      "the plugin enqueues the bundle",
    );
    // No <h1>: the WordPress page supplies it.
    assert.doesNotMatch(html, /<h1/i);
    assert.match(html, /class="scr is-embed"/);
  });

  test("hands the page its heading, which follows the board", async (t) => {
    if (!hasData) return t.skip("no rankings file");
    const html = await (await fetch(`${server.origin}/embed/rankings?board=ros&pos=rb`)).text();
    const copy = JSON.parse(
      html.match(/<script type="application\/json" class="scr-page-data">(.*?)<\/script>/s)[1],
    );
    assert.match(copy.h1, /^\d{4} Rest of Season Fantasy Football RB Rankings$/);
    assert.equal(copy.title, `${copy.h1}: Running Backs`, "the title is the heading's phrase");
    assert.ok(copy.description.length > 50);
    // Each tab carries its board's heading, for the bundle to swap into the
    // host's H1 when the tab switches boards in place.
    assert.match(html, /data-scr-heading="\d{4} Rest of Season Fantasy Football Rankings"/);
    assert.match(html, new RegExp(`data-scr-heading="${copy.h1}"`));
  });

  test("revalidates with an ETag", async (t) => {
    if (!hasData) return t.skip("no rankings file");
    const first = await rawGet("/embed/rankings");
    assert.equal(first.status, 200);
    assert.ok(first.headers.etag, "needs an ETag to revalidate against");

    const second = await rawGet("/embed/rankings", {
      "If-None-Match": first.headers.etag,
    });
    assert.equal(second.status, 304);
    assert.equal(second.body, "");
  });

  test("carries the questions as data, not as a second schema graph", async (t) => {
    if (!hasData) return t.skip("no rankings file");
    const res = await fetch(`${server.origin}/embed/rankings`);
    const html = await res.text();

    // WordPress owns the document and Rank Math owns its graph. A second
    // ld+json arriving from inside a mounted fragment competes with that graph
    // rather than joining it — the same reasoning as no canonical and no H1.
    assert.doesNotMatch(html, /application\/ld\+json/i);

    const island = html.match(
      /<script type="application\/json" class="scr-faq-data">(.*?)<\/script>/s,
    );
    assert.ok(island, "the plugin needs the answers to build the node from");

    const items = JSON.parse(island[1]);
    const doc = new JSDOM(html).window.document;
    assert.deepEqual(
      items.map((entry) => entry.q),
      [...doc.querySelectorAll(".scr-faq-q")].map((q) => q.textContent.trim()),
      "the island and the markup are the same questions",
    );
  });

  test("404s rather than printing a hole in the host page", async () => {
    // A season with no file is the state a fresh deployment is in. The
    // shortcode turns this 404 into "render nothing", which leaves the page's
    // own H1 and copy intact — an empty shell would not.
    const res = await fetch(`${server.origin}/embed/rankings?season=1999`);
    assert.equal(res.status, 404);
  });

  /*
   * The redraft board is the default, because it is what the live page has
   * always mounted: an API deploy must not change that page before the plugin
   * that knows about two boards is uploaded.
   */
  test("with no board named, the fragment is the redraft board as it was", async (t) => {
    if (!hasData) return t.skip("no rankings file");
    const html = await (await fetch(`${server.origin}/embed/rankings`)).text();
    assert.match(html, /data-scr-board="redraft"/);
    assert.match(html, /href="#scr-panel-rb"/);
    assert.doesNotMatch(html, /scr-page-data/, "the redraft page keeps its own title and heading");
    assert.doesNotMatch(html, /rest-of-season-rankings\/rb/);
  });

  /*
   * No environment needed: the rest-of-season tabs default to the WordPress
   * page's own addresses, so a deployment that sets nothing still links them.
   */
  test("the rest-of-season tabs link the WordPress page's own addresses", async (t) => {
    if (!hasData) return t.skip("no rankings file");
    const srv = server;
    {
      const res = await fetch(`${srv.origin}/embed/rankings?board=ros&pos=rb`);
      assert.equal(res.status, 200);
      const doc = new JSDOM(`<body>${await res.text()}</body>`).window.document;

      // Trailing slash and all, which is WordPress's spelling and what the
      // plugin's rewrite rule answers.
      assert.deepEqual(
        [...doc.querySelectorAll(".scr-nav-link")].map((a) => a.getAttribute("href")),
        [
          "/fantasy-football/rest-of-season-rankings/",
          "/fantasy-football/rest-of-season-rankings/qb/",
          "/fantasy-football/rest-of-season-rankings/rb/",
          "/fantasy-football/rest-of-season-rankings/wr/",
          "/fantasy-football/rest-of-season-rankings/te/",
        ],
      );
      assert.equal(
        doc.querySelector("[data-scr-panel].is-default").id,
        "scr-panel-rb",
        "the plugin passes the URL's position as ?pos=",
      );

      // WordPress has never heard of /download.csv under its page.
      assert.equal(
        doc.querySelector(".scr-csv").getAttribute("href"),
        `${srv.origin}/rest-of-season-rankings/download.csv`,
      );
    }
  });
});

describe("the CSV export", () => {
  test("matches what is on screen, with the derived columns", async (t) => {
    if (!hasData) return t.skip("no rankings file");
    const res = await fetch(`${server.origin}/rest-of-season-rankings/download.csv`);
    const body = await res.text();

    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/csv/);
    assert.match(
      res.headers.get("content-disposition"),
      /attachment; filename="statchasers-rest-of-season-\d{4}\.csv"/,
    );

    const lines = body.trim().split("\n");
    assert.equal(lines[0], "Position,Rank,Tier,Player,Team");
    // The same 230 players the boards print, and no more: the source file runs
    // to 713, and a CSV deeper than the page would be a second set of rankings.
    assert.equal(lines.length - 1, 40 + 50 + 100 + 40);

    const { doc } = await page("/rest-of-season-rankings");
    const firstQb = doc
      .querySelector("#scr-panel-qb .scr-row .scr-player")
      .textContent.trim();
    assert.ok(
      firstQb.startsWith(lines[1].split(",")[3]),
      "the file and the screen must not disagree",
    );
  });

  test("404s for a season with no file", async () => {
    const res = await fetch(`${server.origin}/rest-of-season-rankings/download.csv?season=1999`);
    assert.equal(res.status, 404);
  });
});


/*
 * The rules that hold the boards' shape inside a host theme.
 *
 * Asserted on the stylesheet's TEXT, which this suite does nowhere else, and
 * only because these are specificity facts — the thing a browser test would
 * have to re-derive and a reading of the file cannot be trusted to keep.
 *
 * Measured against a simulated Divi page before the armour existed: the All
 * board's rank column went from 28px to 62px, every cell grew, the board lost
 * five rows off a phone screen, and every name turned Divi's link blue.
 *
 * `.scr-all-table thead th` is one class and two elements and so is Divi's
 * `.entry-content tr th` — a TIE, settled by whichever stylesheet WordPress
 * enqueued last. fpa.css bet a layout on that coin toss and lost it in
 * production, so the `.scr` in front of these is load-bearing.
 */
describe("the rankings stylesheet outranks the host theme", () => {
  let css;

  before(async () => {
    css = await (await fetch(`${server.origin}/rankings.css`)).text();
  });

  test("the header bands are armed above Divi's tie, not level with it", () => {
    for (const rule of [
      ".scr .scr-all-table thead th",
      ".scr .scr-table thead th",
    ]) {
      assert.ok(css.includes(rule), `${rule} must carry the second class`);
    }
  });

  test("the cells, the frames and the links are all restated", () => {
    for (const rule of [
      ".scr .scr-all-rank",
      ".scr .scr-all-cell",
      ".scr .scr-row td",
      ".scr .scr-tier-head th",
      ".scr .scr-all-table,",
      ".scr .scr-all-name,",
      ".scr .scr-csv,",
    ]) {
      assert.ok(css.includes(rule), `${rule} is unarmed`);
    }
  });

  test("the narrow tier retunes the padding token rather than the padding", () => {
    assert.ok(
      css.includes("--scr-all-pad-y: 5px;") && css.includes("--scr-all-pad-x: 4px;"),
      "the tier must set the token",
    );
    assert.ok(
      !/\n    padding: 5px 4px;/.test(css),
      "a literal here is overwritten by the armour and the board loses five rows",
    );
  });
});
