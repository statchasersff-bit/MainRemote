/**
 * Fantasy Points Allowed regression tests.
 *
 * Same posture as team.test.mjs and player.test.mjs: assert on the served HTML
 * without executing any JavaScript, because the whole point of the page is that
 * the table arrives complete.
 *
 * Two of these suites need no server at all. The scoring formula and the
 * data-mode wording are pure functions, and both make a claim in their own
 * comments that is worth checking rather than trusting — that `scoreRow`
 * reproduces nflverse's own fantasy-point columns, and that the sentence the
 * page prints about the blend matches the weights the ingest actually applies.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { JSDOM } from "jsdom";
import { startServer } from "./helpers/server.mjs";
import { importModule } from "./helpers/bundle.mjs";

let server;
/** Whether the database has ingested FPA data to render. */
let hasData;

before(async () => {
  server = await startServer();
  const probe = await fetch(`${server.origin}/embed/fpa`);
  hasData = probe.status === 200;
});

after(async () => {
  await server?.stop();
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
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function get(pathname) {
  const res = await fetch(`${server.origin}${pathname}`, { redirect: "manual" });
  return { status: res.status, headers: res.headers, body: await res.text() };
}

/**
 * Fail loudly rather than skip.
 *
 * A suite that silently passes when there is nothing to test is worse than one
 * that does not run: it reports green for a page nobody checked.
 */
function requireData() {
  assert.ok(
    hasData,
    "no FPA data ingested — run `pnpm --filter @workspace/api-server run ingest-fpa`",
  );
}

describe("the scoring formula", () => {
  let nflverse;

  before(async () => {
    nflverse = await importModule("lib/fpa/nflverse");
  });

  test("reproduces nflverse's own standard and PPR columns", async () => {
    // The formula is written out in our code rather than read off the CSV, so
    // this is the check that the two agree. Upstream ships `fantasy_points`
    // (standard) and `fantasy_points_ppr`; Half-PPR has no counterpart and is
    // asserted to sit exactly between them, which is what half a point a
    // reception means.
    const row = {
      passing_yards: "312",
      passing_tds: "3",
      passing_interceptions: "1",
      rushing_yards: "24",
      rushing_tds: "1",
      receiving_yards: "0",
      receiving_tds: "0",
      receptions: "0",
      sack_fumbles_lost: "1",
    };
    const { points } = nflverse.scoreRow((c) => row[c]);

    // 312*0.04 + 3*4 + -1 + 24*0.1 + 6 + -2 = 29.88
    assert.ok(Math.abs(points.standard - 29.88) < 1e-9, `got ${points.standard}`);
    assert.equal(points.ppr, points.standard, "no receptions, so PPR matches");

    const receiver = {
      receiving_yards: "104",
      receiving_tds: "1",
      receptions: "8",
    };
    const caught = nflverse.scoreRow((c) => receiver[c]);
    assert.ok(Math.abs(caught.points.standard - 16.4) < 1e-9);
    assert.ok(Math.abs(caught.points.ppr - 24.4) < 1e-9);
    assert.ok(
      Math.abs(caught.points.half - (caught.points.standard + caught.points.ppr) / 2) < 1e-9,
      "half-PPR sits exactly between standard and PPR",
    );
  });

  test("treats missing and NA cells as zero, not NaN", async () => {
    const { points } = nflverse.scoreRow((c) =>
      c === "rushing_yards" ? "NA" : undefined,
    );
    for (const format of ["standard", "half", "ppr"]) {
      assert.equal(points[format], 0, `${format} must be 0, not NaN`);
    }
  });

  test("parses quoted CSV fields, escaped quotes and CRLF", async () => {
    const matrix = nflverse.parseCsv(
      'a,b,c\r\n1,"x, y",3\r\n2,"he said ""hi""",4\r\n',
    );
    assert.deepEqual(matrix[0], ["a", "b", "c"]);
    assert.deepEqual(matrix[1], ["1", "x, y", "3"]);
    assert.deepEqual(matrix[2], ["2", 'he said "hi"', "4"]);
  });
});

describe("the data-mode wording", () => {
  // lib/fpa/blend.ts is deliberately free of any database import, which is what
  // lets both halves of this decision — the weight and the sentence — be
  // checked against each other without a Postgres connection.
  let blend;

  before(async () => {
    blend = await importModule("lib/fpa/blend");
  });

  test("the sentence matches the weights actually applied", async () => {
    // describeDataMode() prints percentages as prose; currentSeasonWeight()
    // decides the real blend. They are written separately on purpose — one is
    // copy, one is arithmetic — so this is what stops them drifting apart.
    for (const week of [1, 2, 3, 4]) {
      const { methodology } = blend.describeDataMode(week, 2025, 2026);
      const live = Math.round(blend.currentSeasonWeight(week) * 100);
      assert.match(
        methodology,
        new RegExp(`${live}% 2026 data`),
        `week ${week} prose must state the ${live}% the ingest applies`,
      );
      assert.match(methodology, new RegExp(`${100 - live}% 2025 baseline`));
    }
  });

  test("preseason says so, and names no current-season data", async () => {
    const { dataMode, methodology, isPreseason } = blend.describeDataMode(
      null,
      2025,
      2026,
    );
    assert.equal(isPreseason, true);
    assert.match(dataMode, /Preseason/i);
    assert.match(methodology, /2025 season in full/);
  });

  test("week 12 onward drops the prior season entirely", async () => {
    assert.equal(blend.currentSeasonWeight(12), 1);
    const { methodology } = blend.describeDataMode(12, 2025, 2026);
    assert.match(methodology, /no longer contributes/);
  });

});

describe("fpa routes", () => {
  test("the page ships the whole table, not a shell", async () => {
    requireData();
    const res = await get("/fpa");
    assert.equal(res.status, 200);
    const doc = new JSDOM(res.body).window.document;

    // No title of its own. The WordPress page this mounts into supplies it, and
    // a second one underneath it was the bug. The FAQ's own headings are the one
    // exception and are checked in the embed suite below.
    assert.equal(doc.querySelectorAll("h1").length, 0, "no H1 of its own");
    assert.equal(
      doc.querySelectorAll(".scf h2:not(.scf-faq-title)").length,
      0,
      "no heading above the table",
    );
    assert.equal(doc.querySelectorAll(".scf-row").length, 32, "all 32 defenses");

    // Every cell carries its figure AND its rank: the tint is a second reading,
    // never the only one.
    for (const cell of doc.querySelectorAll(".scf-cell")) {
      assert.ok(cell.querySelector(".scf-fpa").textContent.trim());
      assert.ok(cell.querySelector(".scf-rank").textContent.trim());
      assert.match(cell.getAttribute("data-tier"), /^(soft-[12]|mid|tough-[12])$/);
    }
  });

  test("the caveat sits above the table it qualifies", async () => {
    requireData();
    const res = await get("/fpa");
    const mode = res.body.indexOf("scf-mode");
    const table = res.body.indexOf("scf-table");
    assert.ok(mode > 0 && table > 0);
    assert.ok(mode < table, "the data-mode note must precede the table");
  });

  test("format and view change the numbers and the URL, not the canonical", async () => {
    requireData();
    const raw = await get("/fpa");
    const adjusted = await get("/fpa?view=adjusted&format=ppr");

    assert.notEqual(raw.headers.get("etag"), adjusted.headers.get("etag"));

    const canonical = (body) =>
      new JSDOM(body).window.document
        .querySelector('link[rel="canonical"]')
        .getAttribute("href");
    assert.equal(
      canonical(raw.body),
      canonical(adjusted.body),
      "six views of one table are one page",
    );
  });

  test("the adjusted view says it is a model", async () => {
    requireData();
    const res = await get("/fpa?view=adjusted");
    assert.match(res.body, /It is a model/);
  });

  test("the CSV matches what is on screen", async () => {
    requireData();
    const page = await get("/fpa?format=half&view=raw");
    const csv = await get("/fpa/download.csv?format=half&view=raw");

    assert.equal(csv.status, 200);
    assert.match(csv.headers.get("content-type"), /text\/csv/);
    assert.match(csv.headers.get("content-disposition"), /attachment; filename=/);

    const lines = csv.body.trim().split("\n");
    assert.equal(lines.length, 33, "a header and 32 defenses");

    // The first data row is the softest defense, which is also the page's first
    // row — the file and the screen are built from one query. Read off the name
    // line specifically: the team cell also carries the abbreviation above it,
    // and the CSV's first field is the name.
    const doc = new JSDOM(page.body).window.document;
    const firstOnPage = doc
      .querySelector(".scf-row .scf-team .scf-team-name")
      .textContent.trim();
    assert.ok(
      lines[1].startsWith(firstOnPage) || lines[1].startsWith(`"${firstOnPage}`),
      `CSV opens with "${lines[1].slice(0, 40)}", page opens with "${firstOnPage}"`,
    );
  });

  test("rank 1 is the softest defense, not the toughest", async () => {
    // The whole table is read through this convention, and getting it backwards
    // would invert every recommendation a reader takes from it. Asserted off
    // the served HTML rather than the query, because the page is what claims it.
    requireData();
    const res = await get("/fpa?format=half&view=raw");
    const doc = new JSDOM(res.body).window.document;

    const offCells = [...doc.querySelectorAll(".scf-row")].map((row) => {
      const cells = row.querySelectorAll(".scf-cell");
      const off = cells[cells.length - 1];
      return {
        fpa: Number(off.querySelector(".scf-fpa").textContent),
        rank: Number(off.querySelector(".scf-rank").textContent),
      };
    });

    const softest = offCells.find((c) => c.rank === 1);
    const toughest = offCells.find((c) => c.rank === offCells.length);
    assert.ok(softest && toughest);
    assert.ok(
      softest.fpa > toughest.fpa,
      `rank 1 allowed ${softest.fpa}, rank ${offCells.length} allowed ${toughest.fpa} — rank 1 must be higher`,
    );

    // And the page must say which way round it is, in words.
    assert.match(
      doc.body.textContent,
      /Rank 1 is the most points allowed, i\.e\. the softest matchup/i,
    );
  });

  test("no placeholder values anywhere", async () => {
    requireData();
    const res = await get("/fpa");
    const text = new JSDOM(res.body).window.document.body.textContent;
    assert.ok(!/undefined|NaN|\[object Object\]/.test(text));
    assert.ok(!/\bN\/A\b/.test(text));
  });

  test("the other three tools are untouched", async () => {
    for (const [path, marker] of [
      ["/", "statchasers-news.js"],
      ["/team/new-england-patriots", "data-sct-root"],
      ["/player", "scp-index"],
    ]) {
      const res = await get(path);
      assert.equal(res.status, 200, `${path} should be 200`);
      assert.ok(res.body.includes(marker), `${path} still renders`);
    }
  });
});

describe("the embedded fpa fragment", () => {
  test("serves markup with no document around it", async () => {
    requireData();
    const res = await get("/embed/fpa");
    assert.equal(res.status, 200);
    assert.ok(!/<html/i.test(res.body), "must not be a full document");
    assert.ok(!/<link\b/i.test(res.body), "must not carry a stylesheet");
    assert.ok(!/<script\b/i.test(res.body), "must not carry a bundle");
    assert.ok(res.body.includes("data-scf-root"));
  });

  test("no H1 inside a host page that already has one", async () => {
    requireData();
    const res = await get("/embed/fpa");
    const doc = new JSDOM(`<body>${res.body}</body>`).window.document;

    // No H1: that one belongs to the WordPress page this mounts into.
    assert.equal(doc.querySelectorAll("h1").length, 0, "the host page owns the H1");

    // Below it, only the FAQ has headings, and every question is an H3 under
    // the section's one H2. The tool's own chrome — controls, note, table,
    // legend — still ships none, so nothing but the FAQ enters the outline.
    const headings = [...doc.querySelectorAll("h2, h3")];
    assert.ok(headings.length > 0, "the FAQ is in the fragment");
    for (const heading of headings) {
      assert.ok(
        heading.closest(".scf-faq"),
        `${heading.tagName} "${heading.textContent}" is outside the FAQ`,
      );
    }
    assert.equal(doc.querySelectorAll(".scf-faq h2").length, 1);
    assert.equal(
      doc.querySelectorAll(".scf-faq h3").length,
      doc.querySelectorAll(".scf-faq-a").length,
      "every question has exactly one answer",
    );
  });

  test("the answers fold, one per question, and the questions all show", async () => {
    requireData();
    const res = await get("/embed/fpa");
    const doc = new JSDOM(`<body>${res.body}</body>`).window.document;

    // The block itself does not fold — the questions are the index, and
    // somebody scanning for the one they arrived with has to see them without
    // opening anything. Each ANSWER folds instead, which is what kept thirteen
    // paragraphs from stacking up under the table. The question sits in the
    // <summary>, so the outline is the same open or shut, and the answers stay
    // in the DOM either way: a crawler reads the DOM, not the open state.
    assert.equal(
      doc.querySelector("details.scf-faq"),
      null,
      "the FAQ block itself is not a fold",
    );

    const title = doc.querySelector(".scf-faq-title");
    assert.ok(title, "the FAQ keeps its title");
    assert.equal(title.closest("summary"), null, "the title is not a summary");

    const items = [...doc.querySelectorAll(".scf-faq .scf-faq-item")];
    assert.ok(items.length > 0, "the FAQ has questions");
    for (const item of items) {
      assert.equal(item.tagName, "DETAILS", "each question is a fold");
      assert.equal(item.hasAttribute("open"), false, "shut by default");

      const summary = item.querySelector(":scope > summary.scf-faq-q-row");
      assert.ok(summary, "the question is the summary");
      const question = summary.querySelector(":scope > h3.scf-faq-q");
      assert.ok(question?.textContent.trim(), "the question has text");

      assert.ok(
        item.querySelector(":scope > .scf-faq-a"),
        "the answer is inside the fold",
      );
    }
  });

  test("emits no canonical, title or robots directive", async () => {
    requireData();
    const res = await get("/embed/fpa");
    assert.ok(!/rel="canonical"/i.test(res.body));
    assert.ok(!/<title/i.test(res.body));
    assert.ok(!/name="robots"/i.test(res.body));
  });

  test("an un-ingested table is a 404, never an empty shell", async () => {
    // The shortcode turns a 404 into "print nothing and leave the page alone".
    // A 200 carrying an empty table would instead print a hole in the host page.
    const res = await get("/embed/fpa?season=1999");
    assert.equal(res.status, 404);
    assert.ok(!/scf-row/.test(res.body));
  });
});

describe("fpa caching", () => {
  test("repeat requests revalidate to 304", async () => {
    requireData();
    const first = await get("/fpa");
    const etag = first.headers.get("etag");
    assert.ok(etag);

    const second = await rawGet("/fpa", { "If-None-Match": etag });
    assert.equal(second.status, 304);
    assert.equal(second.body, "");
  });

  test("every route keeps this origin out of the index on its own", async () => {
    requireData();
    for (const path of ["/fpa", "/embed/fpa"]) {
      const res = await get(path);
      assert.match(res.headers.get("x-robots-tag"), /noindex, indexifembedded/);
    }
    // The CSV is a download, not a page: plain noindex is right for it.
    const csv = await get("/fpa/download.csv");
    assert.match(csv.headers.get("x-robots-tag"), /noindex/);
  });
});

describe("the fpa development switcher", () => {
  let dev;

  before(async () => {
    dev = await startServer({ NODE_ENV: "development" });
  });

  after(async () => {
    await dev?.stop();
  });

  async function devGet(pathname) {
    const res = await fetch(`${dev.origin}${pathname}`, { redirect: "manual" });
    return { status: res.status, body: await res.text() };
  }

  test("the tool is reachable from every other tool", async () => {
    for (const path of ["/", "/team/new-england-patriots", "/fpa"]) {
      const res = await devGet(path);
      assert.equal(res.status, 200);
      assert.ok(
        res.body.includes("[statchasers_fpa]"),
        `${path} must offer the FPA shortcode`,
      );
    }
  });

  test("every mount in the bar resolves", async () => {
    const res = await devGet("/fpa");
    const bar = new JSDOM(res.body).window.document.querySelector("[data-scdev]");
    const hrefs = [...bar.querySelectorAll("a")]
      .map((a) => a.getAttribute("href"))
      .filter((href) => href.startsWith("/") && href.includes("fpa"));
    assert.ok(hrefs.length >= 4, "page, embed, shortcode and raw at least");
    for (const href of new Set(hrefs)) {
      assert.equal((await devGet(href)).status, 200, `${href} must resolve`);
    }
  });

  test("the harness enqueues this tool's assets and no other's", async () => {
    const res = await devGet("/preview/fpa");
    assert.equal(res.status, 200);
    assert.ok(res.body.includes("/fpa.css"));
    assert.ok(res.body.includes("/dist/statchasers-fpa.js"));
    assert.ok(
      !res.body.includes("/team.css") &&
        !res.body.includes("/player.css") &&
        !res.body.includes("/styles.css"),
      "one tool's preview must not pull another tool's assets",
    );
  });

  test("the raw view shows the fragment as escaped source", async () => {
    const res = await devGet("/preview/raw/fpa");
    assert.equal(res.status, 200);
    assert.ok(res.body.includes("/embed/fpa"), "it names the endpoint");
    assert.ok(res.body.includes("&lt;div"), "the fragment is escaped source");
  });
});
