/**
 * Fantasy Points Allowed regression tests.
 *
 * Same posture as team.test.mjs and player.test.mjs: assert on the served HTML
 * without executing any JavaScript, because the whole point of the page is that
 * the table arrives complete.
 *
 * Two of these suites need no server at all. The scoring formula and the
 * data-mode wording are pure functions, and both make a claim in their own
 * comments that is worth checking rather than trusting - that `scoreRow`
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
    "no FPA data ingested - run `pnpm --filter @workspace/api-server run ingest-fpa`",
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
  // lets both halves of this decision - the weight and the sentence - be
  // checked against each other without a Postgres connection.
  let blend;

  before(async () => {
    blend = await importModule("lib/fpa/blend");
  });

  test("the sentence matches the weights actually applied", async () => {
    // describeDataMode() prints percentages as prose; currentSeasonWeight()
    // decides the real blend. They are written separately on purpose - one is
    // copy, one is arithmetic - so this is what stops them drifting apart.
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
      doc.querySelectorAll(".scf h2:not(.scf-faq-title):not(.scf-related-title)").length,
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

  test("the week range leads, the blend note follows the table (mak, 2026-10-10)", async () => {
    requireData();
    const res = await get("/fpa");
    const at = (needle) => res.body.indexOf(needle);
    for (const needle of ["scf-updated", "scf-answer", "scf-controls", "scf-table", "scf-mode", "scf-legend-wrap", "scf-related", "scf-faq-title"]) {
      assert.ok(at(needle) > 0, needle);
    }
    assert.ok(at("scf-updated") < at("scf-answer"), "the Updated line opens the page");
    assert.ok(at("scf-answer") < at("scf-controls"), "the answer sentence sits above the controls");
    assert.ok(at("scf-table") < at("scf-mode"), "the blend note sits directly under the table");
    assert.ok(at("scf-mode") < at("scf-legend-wrap"), "and before the legend");
    assert.ok(at("scf-related") < at("scf-faq-title"), "Related comes before the FAQ");

    const doc = new JSDOM(res.body).window.document;
    assert.match(doc.title, /^Fantasy Points Allowed by Position \d{4} \((Weeks 1\u2013\d{1,2}|Preseason)\)$/);
    assert.ok(doc.title.length <= 60, `title within 60 characters: ${doc.title}`);
    const description = doc.querySelector('meta[name="description"]').getAttribute("content");
    assert.ok(description.length <= 155, `description within 155 characters: ${description}`);
    assert.match(description, /by all 32 NFL defenses/);
    assert.match(doc.querySelector(".scf-answer").textContent, /^Softest matchups (through Week \d{1,2}|on the \d{4} baseline): .+ allows the most fantasy points to (QB|RB|WR|TE)s \(\d+\.\d per game\)/);
    assert.match(doc.querySelector(".scf-updated").textContent, /^(Updated [A-Z][a-z]{2} \d{1,2}, (through Week \d{1,2}|before Week 1)|Through Week \d{1,2}, \d{4}|Before Week 1 of \d{4})$/);

    // Every team links to its schedule page, not its hub (mak, 2026-10-10).
    const teamLinks = Array.from(doc.querySelectorAll(".scf-team-link[href]")).map((a) => a.getAttribute("href"));
    assert.equal(teamLinks.length, 32);
    for (const href of teamLinks) assert.match(href, /^\/team\/[a-z0-9-]+\/schedule\/$/);

    // Related: the four position SOS pages, the projections and the start/sit tool.
    const related = Array.from(doc.querySelectorAll(".scf-related-list a")).map((a) => a.getAttribute("href"));
    assert.deepEqual(related, [
      "https://statchasers.com/nfl/fantasy-football-strength-of-schedule/qb/",
      "https://statchasers.com/nfl/fantasy-football-strength-of-schedule/rb/",
      "https://statchasers.com/nfl/fantasy-football-strength-of-schedule/wr/",
      "https://statchasers.com/nfl/fantasy-football-strength-of-schedule/te/",
      "https://statchasers.com/redraft-command/fantasy-football-projections",
      "https://statchasers.com/redraft-command/who-should-i-start",
    ]);
  });

  test("a finished season is a full-season archive of its own", async () => {
    requireData();
    const live = await get("/fpa");
    const liveDoc = new JSDOM(live.body).window.document;
    const archiveLinks = Array.from(liveDoc.querySelectorAll(".scf-season-link")).map((a) => a.getAttribute("href"));
    assert.ok(archiveLinks.length >= 1, "the current table links to at least one finished season");
    assert.match(archiveLinks[0], /^\/fpa\?season=\d{4}$/);
    const season = Number(archiveLinks[0].match(/\d{4}/)[0]);

    const res = await get(`/fpa?season=${season}`);
    assert.equal(res.status, 200);
    const doc = new JSDOM(res.body).window.document;
    assert.equal(doc.title, `Fantasy Points Allowed by Position ${season} (Full Season)`);
    assert.equal(doc.querySelectorAll(".scf-row").length, 32, "the whole season's table");
    assert.equal(doc.querySelector("[data-scf-root]").getAttribute("data-kind"), "archive");
    assert.match(doc.querySelector(".scf-answer").textContent, new RegExp(`^Softest matchups of the ${season} season: `));
    assert.match(doc.querySelector(".scf-mode-body").textContent, new RegExp(`^The complete ${season} regular season, weeks 1-17: `));
    assert.equal(doc.querySelector(".scf-season-link").textContent, `Current ${liveDoc.querySelector("[data-scf-root]").getAttribute("data-season")} data`);
    assert.equal(doc.querySelector(".scf-faq"), null, "the FAQ belongs to the current page only");
    assert.equal(doc.querySelector('script[type="application/ld+json"]'), null, "and so does its schema");
    assert.ok(doc.querySelector(".scf-related"), "Related still closes the page");
    assert.equal(doc.querySelectorAll(".scf-season-link").length, 1, "an archive links to the current table, not to itself");

    // The current season under its own name is the default table, and a season
    // with no rows is a 404.
    const current = Number(liveDoc.querySelector("[data-scf-root]").getAttribute("data-season"));
    const byName = await get(`/fpa?season=${current}`);
    assert.equal(new JSDOM(byName.body).window.document.querySelector("[data-scf-root]").getAttribute("data-kind"), "live");
    assert.equal((await get("/fpa?season=2001")).status, 404);
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
    // row - the file and the screen are built from one query. Read off the name
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
      `rank 1 allowed ${softest.fpa}, rank ${offCells.length} allowed ${toughest.fpa} - rank 1 must be higher`,
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

  test("the controls stay links, and say what they select", async () => {
    requireData();
    const res = await get("/fpa");
    const doc = new JSDOM(res.body).window.document;

    // Real links to real URLs, still. The bundle swaps the table in place so
    // the address does not move, but a reader with scripting off - and a
    // crawler - has to be able to reach every combination, and a middle-click
    // has to open the one that was asked for.
    const opts = [...doc.querySelectorAll(".scf-opt")];
    assert.equal(opts.length, 5, "three formats and two views");
    for (const opt of opts) {
      assert.equal(opt.tagName, "A", "each control is a link");
      assert.ok(opt.getAttribute("href"), "with a URL behind it");
    }

    // What each one selects is stated, not parsed back out of the href: once
    // SC_FPA_PATH is set that href points at WordPress, and reading state out
    // of somebody else's URL is guessing.
    assert.deepEqual(
      opts
        .map((o) => o.getAttribute("data-scf-format"))
        .filter((v) => v !== null),
      ["standard", "half", "ppr"],
    );
    assert.deepEqual(
      opts.map((o) => o.getAttribute("data-scf-view")).filter((v) => v !== null),
      ["raw", "adjusted"],
    );

    // And the address the bundle re-fetches from. Relative here: the page and
    // the fragment are the same origin.
    const root = doc.querySelector("[data-scf-root]");
    assert.equal(root.getAttribute("data-scf-endpoint"), "/embed/fpa");
  });

  test("one FAQPage, describing the questions actually rendered", async () => {
    requireData();
    const res = await get("/fpa");
    const doc = new JSDOM(res.body).window.document;

    // A document gets one FAQPage. Two is the failure mode that gets structured
    // data ignored outright rather than merged.
    const blocks = [...doc.querySelectorAll('script[type="application/ld+json"]')];
    assert.equal(blocks.length, 1);

    const node = JSON.parse(blocks[0].textContent);
    assert.equal(node["@type"], "FAQPage");

    assert.deepEqual(
      node.mainEntity.map((entry) => entry.name),
      [...doc.querySelectorAll(".scf-faq-q")].map((q) => q.textContent.trim()),
      "the node describes the page, not a second list",
    );

    for (const entry of node.mainEntity) {
      assert.equal(entry["@type"], "Question");
      assert.equal(entry.acceptedAnswer["@type"], "Answer");
      // An answer that folds to two paragraphs arrives as one string: the node
      // is prose for a crawler, not markup.
      assert.ok(entry.acceptedAnswer.text.length > 40);
      assert.ok(!/<p>/.test(entry.acceptedAnswer.text));
    }
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
  // The two inert islands the plugin reads and strips: the FAQ's questions
  // and the page's own words (title, H1, description, Updated line).
  const INERT_FAQ =
    /<script type="application\/json" class="scf-(?:faq|page)-data">.*?<\/script>/gs;

  test("serves markup with no document around it", async () => {
    requireData();
    const res = await get("/embed/fpa");
    assert.equal(res.status, 200);
    assert.ok(!/<html/i.test(res.body), "must not be a full document");
    assert.ok(!/<link\b/i.test(res.body), "must not carry a stylesheet");
    // The FAQ's inert payload is the one <script> allowed through, on the terms
    // rankings.test.mjs sets out for its own: it carries no code, and the plugin
    // lifts it into Rank Math's graph and strips it before printing. Matched
    // exactly, so a real script beside it still fails.
    assert.ok(
      !/<script\b/i.test(res.body.replace(INERT_FAQ, "")),
      "must not carry a bundle",
    );
    assert.ok(res.body.includes("data-scf-root"));
  });

  test("the CSV points at this server, not at the page it is mounted in", async () => {
    requireData();
    const res = await get("/embed/fpa");
    const doc = new JSDOM(`<body>${res.body}</body>`).window.document;
    const href = doc.querySelector(".scf-csv").getAttribute("href");

    // The CSV is a route on THIS server. Built from the page path it is
    // mounted at - which SC_FPA_PATH makes a WordPress page path - it came out
    // as "/nfl/fantasy-points-allowed-by-position//download.csv", and a
    // leading "//" is not a path: a browser reads it as protocol-relative and
    // goes looking for a host called download.csv.
    assert.ok(!href.includes("//download.csv"), href);
    assert.match(href, /^https?:\/\/[^/]+\/fpa\/download\.csv\?/, href);
  });

  test("the fragment's endpoint is absolute, because WordPress owns the page", async () => {
    requireData();
    const res = await get("/embed/fpa");
    const doc = new JSDOM(`<body>${res.body}</body>`).window.document;

    // Printed inside a statchasers.com page, a relative /embed/fpa resolves
    // against WordPress and 404s. Built from the request, so it is whatever
    // origin the plugin actually reached this app on.
    const endpoint = doc
      .querySelector("[data-scf-root]")
      .getAttribute("data-scf-endpoint");
    assert.match(endpoint, /^https?:\/\/[^/]+\/embed\/fpa$/, endpoint);
  });

  test("carries the questions as data, not as a second schema graph", async () => {
    requireData();
    const res = await get("/embed/fpa");

    // WordPress owns the document and Rank Math owns its graph. A second
    // ld+json arriving from inside a mounted fragment competes with that graph
    // rather than joining it - the same reasoning as no canonical and no H1.
    assert.ok(
      !/application\/ld\+json/i.test(res.body),
      "the embed leaves the graph to the host page",
    );

    const island = res.body.match(
      /<script type="application\/json" class="scf-faq-data">(.*?)<\/script>/s,
    );
    assert.ok(island, "the plugin needs the answers to build the node from");

    const items = JSON.parse(island[1]);
    const doc = new JSDOM(`<body>${res.body}</body>`).window.document;
    assert.deepEqual(
      items.map((entry) => entry.q),
      [...doc.querySelectorAll(".scf-faq-q")].map((q) => q.textContent.trim()),
      "the island and the markup are the same questions",
    );
  });

  test("carries its title, H1, description and Updated line as data for the plugin", async () => {
    requireData();
    const res = await get("/embed/fpa");
    const islands = res.body.match(/<script type="application\/json" class="scf-page-data">(.*?)<\/script>/s);
    assert.ok(islands, "the page-data island is in the fragment");
    const copy = JSON.parse(islands[1].replace(/<\\\//g, "</"));
    assert.match(copy.title, /^Fantasy Points Allowed by Position \d{4} \((Weeks 1\u2013\d{1,2}|Preseason)\)$/);
    assert.match(copy.h1, /^Fantasy Points Allowed by Position: (Weeks 1\u2013\d{1,2}, \d{4}|\d{4} Preseason)$/);
    assert.ok(copy.description.length <= 155);
    assert.equal(copy.kind, "live");
    assert.ok(Number.isInteger(copy.season));
    assert.ok(Array.isArray(copy.archiveSeasons));
    assert.match(copy.updatedIso, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(copy.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(copy.updatedLine, /^Updated [A-Z][a-z]{2} \d{1,2}, /);
    // The fragment does not print the Updated line itself: the plugin puts it
    // under the page's own H1 from the island.
    assert.doesNotMatch(res.body, /class="scf-updated"/);
    // An archive fragment says so, and carries no FAQ island.
    if (copy.archiveSeasons.length) {
      const archive = await get(`/embed/fpa?season=${copy.archiveSeasons[0]}`);
      assert.equal(archive.status, 200);
      const island = JSON.parse(archive.body.match(/class="scf-page-data">(.*?)<\/script>/s)[1].replace(/<\\\//g, "</"));
      assert.equal(island.kind, "archive");
      assert.equal(island.title, `Fantasy Points Allowed by Position ${copy.archiveSeasons[0]} (Full Season)`);
      assert.equal(island.h1, `${copy.archiveSeasons[0]} Fantasy Points Allowed by Position`);
      assert.doesNotMatch(archive.body, /scf-faq-data/);
    }
  });

  test("no H1 inside a host page that already has one", async () => {
    requireData();
    const res = await get("/embed/fpa");
    const doc = new JSDOM(`<body>${res.body}</body>`).window.document;

    // No H1: that one belongs to the WordPress page this mounts into.
    assert.equal(doc.querySelectorAll("h1").length, 0, "the host page owns the H1");

    // Below it, only the FAQ and the Related block have headings, and every
    // question is an H3 under the FAQ's one H2. The tool's own chrome -
    // controls, answer, note, table, legend - still ships none, so nothing
    // above the table enters the outline.
    const headings = [...doc.querySelectorAll("h2, h3")];
    assert.ok(headings.length > 0, "the FAQ is in the fragment");
    for (const heading of headings) {
      assert.ok(
        heading.closest(".scf-faq") || heading.closest(".scf-related"),
        `${heading.tagName} "${heading.textContent}" is outside the FAQ and Related`,
      );
    }
    assert.equal(doc.querySelectorAll(".scf-related h2").length, 1, "Related has one H2 and no H3s");
    assert.equal(doc.querySelectorAll(".scf-related h3").length, 0);
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

    // The block itself does not fold - the questions are the index, and
    // somebody scanning for the one they arrived with has to see them without
    // opening anything. Each ANSWER folds instead, which is what keeps nineteen
    // answers from stacking up under the table. The question sits in the
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

/*
 * The two rules that decide whether the table fits a phone.
 *
 * Asserted on the stylesheet's TEXT, which this suite does nowhere else, and
 * only because both of these are specificity facts - the thing a browser test
 * would have to re-derive and a reading of the file cannot be trusted to keep.
 *
 * What went wrong on the live site: Divi styles `.entry-content tr th`, one
 * class and two elements, which is the same weight as `.scf-table thead th`.
 * A tie goes to whichever stylesheet WordPress enqueued last, that stopped
 * being ours, the header cells took Divi's 24px a side, and the table came out
 * 53px wider than the column - far enough that the games column scrolled off
 * the right of the phone. And separately: the narrow tiers tighten the gutters
 * to 7px, but the theme armour at the foot of the file restates cell padding
 * and lands after them, so a literal there was put straight back to 10px.
 *
 * Both are one edit away from returning and neither shows up in served HTML.
 */
describe("the fpa stylesheet outranks the host theme", () => {
  let css;

  before(async () => {
    css = await (await fetch(`${server.origin}/fpa.css`)).text();
  });

  test("the header band is armed above Divi's tie, not level with it", () => {
    assert.ok(
      css.includes(".scf .scf-table thead th {"),
      "the armed header rule must carry the second class",
    );
    assert.ok(
      !/\n\.scf-table thead th \{/.test(css.slice(css.indexOf("Theme armour"))),
      "no rule below the armour heading may sit at one class and two elements",
    );
  });

  test("the narrow tiers retune the padding token rather than the padding", () => {
    const tiers = css.match(/--scf-cell-pad-x: 7px;/g) ?? [];
    assert.equal(tiers.length, 2, "both the container tier and the viewport tier");
    assert.ok(
      !css.includes("padding-left: 7px;"),
      "a literal here is overwritten by the armour and the last column falls off",
    );
  });
});
