/**
 * Matchup page regression tests.
 *
 * Same posture as team.test.mjs: fetch the served HTML and assert on it with
 * no JavaScript run. What these lock is the URL contract - one address per
 * pair, every other spelling a 301, everything else a 404 - and that the page
 * lays itself out for the state the data declares rather than for a date.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";
import { startServer, APP_DIR } from "./helpers/server.mjs";

let server;
let teamBundle;
/** Every jsdom window opened here, so the file's timers do not outlive it. */
const windows = [];

before(async () => {
  server = await startServer();
  teamBundle = fs.readFileSync(
    path.join(APP_DIR, "public", "dist", "statchasers-team.js"),
    "utf8",
  );
});
after(async () => {
  for (const window of windows) {
    try {
      window.close();
    } catch {
      /* already closed */
    }
  }
  await server?.stop();
});

/**
 * A page with the real compiled bundle run against it.
 *
 * The same posture as tests/rendered.test.mjs: the point of sorting is what
 * happens after a click, and asserting on the markup alone would pass just as
 * well against a table whose headers are inert.
 */
async function hydrated(pathname) {
  const res = await fetch(`${server.origin}${pathname}`);
  assert.equal(res.status, 200, pathname);
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => errors.push(String(e)));

  const dom = new JSDOM(await res.text(), {
    runScripts: "outside-only",
    url: `${server.origin}${pathname}`,
    pretendToBeVisual: true,
    virtualConsole,
  });
  windows.push(dom.window);
  dom.window.eval(teamBundle);
  await new Promise((r) => setTimeout(r, 50));
  return { window: dom.window, doc: dom.window.document, errors };
}

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
    // Reversed, abbreviated, nicknamed - the reader's route in cannot mint a
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
    // The head's <title>: the usage charts carry SVG <title>s of their own.
    assert.match(one("head > title").textContent, /^New England Patriots vs Philadelphia Eagles/);
    one('meta[name="description"]');
    one('meta[name="robots"]');
  });
});

describe("one address per meeting", () => {
  test("a week the two never played is a 404", async () => {
    // 1999 is outside the seasons the history looks at at all, so this is a
    // week that cannot exist however the schedules load.
    const res = await get(`${CANON}1999-week-1`);
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("x-robots-tag"), "noindex");
    assert.ok(!/data-sct-root/.test(res.body), "no page rendered");
  });

  test("a near-miss spelling is a 404, not a redirect", async () => {
    // The pair slug redirects every spelling a reader might type because
    // readers really do type "eagles vs patriots". Nobody types a week number
    // three ways, so these are addresses that never existed rather than
    // addresses that moved.
    for (const segment of ["2026-week-01", "2026-wk-1", "2026-WEEK-1", "week-1-2026", "2026-week-0"]) {
      assert.equal((await get(`${CANON}${segment}`)).status, 404, segment);
    }
  });

  test("a non-canonical pair keeps its game segment through the 301", async () => {
    const res = await get("/nfl/philadelphia-eagles-vs-new-england-patriots/2024-week-2");
    assert.equal(res.status, 301);
    assert.equal(res.headers.get("location"), `${CANON}2024-week-2/`);
  });

  test("every finished meeting the pair page has let go of links to its own page", async () => {
    const { doc } = await dom(CANON);
    const links = [...doc.querySelectorAll("a.sct-mu-recap")];

    // The pair page carries a link per archived meeting and none for the game
    // it is still leading with - that game has one address until the window
    // closes, and a link into a redirect would say otherwise.
    const state = doc.querySelector("[data-sct-root]").getAttribute("data-matchup-state");
    const featuredRow = doc.querySelector(".sct-mu-row.is-featured");
    if (state === "recently_completed" && featuredRow) {
      assert.equal(
        featuredRow.querySelector("a.sct-mu-recap"),
        null,
        "the game the page is leading with does not link away to itself",
      );
    }

    for (const link of links) {
      assert.match(
        link.getAttribute("href"),
        /^\/nfl\/new-england-patriots-vs-philadelphia-eagles\/\d{4}-week-\d{1,2}\/$/,
        "a recap link is the pretty dated path",
      );
    }
  });

  test("a dated page is a recap of that week, headed by it", async () => {
    const { doc } = await dom(CANON);
    const href = doc.querySelector("a.sct-mu-recap")?.getAttribute("href");
    if (!href) return; // No archived meeting in the window the history reads.

    const page = await dom(href);
    const root = page.doc.querySelector("[data-sct-root]");
    assert.equal(root.getAttribute("data-postgame"), "1", "a game address is always a recap");

    const [, season, week] = /(\d{4})-week-(\d{1,2})\/$/.exec(href);
    const h1 = page.doc.querySelectorAll("h1");
    assert.equal(h1.length, 1);
    // Away then home, whichever way round that was - see scoreboardHeading().
    assert.match(
      h1[0].textContent.trim(),
      new RegExp(
        `^(New England Patriots vs Philadelphia Eagles|Philadelphia Eagles vs New England Patriots), Week ${week} ${season}$`,
      ),
      "the H1 names the game, so it cannot compete with the pair's own page",
    );
    assert.ok(h1[0].closest("header.sct-sbh"), "and it is inside the hero");

    const canonical = page.doc.querySelector('link[rel="canonical"]').getAttribute("href");
    assert.ok(canonical.endsWith(href), "a dated page is its own canonical");
    assert.match(
      page.doc.querySelector("title").textContent,
      new RegExp(`Week ${week} ${season}`),
      "the title names the game too",
    );
  });

  test("a recap from an earlier season carries nothing that describes now", async () => {
    const { doc } = await dom(CANON);
    const pageSeason = Number(
      doc.querySelector("[data-sct-root]").getAttribute("data-season"),
    );
    const href = [...doc.querySelectorAll("a.sct-mu-recap")]
      .map((a) => a.getAttribute("href"))
      .find((h) => Number(/(\d{4})-week-/.exec(h)[1]) !== pageSeason);
    if (!href) return; // Every archived meeting is from the season in progress.

    const page = await dom(href);
    const headings = [...page.doc.querySelectorAll("h2")].map((h) => h.textContent.trim());
    // Season Form, the injury report and the FPA ranks are all read from
    // today. Under a heading that says 2024 they are the wrong answer, not a
    // bonus.
    for (const banned of ["Season Form", "Injuries & Fallout", "Injury Watch", "Fantasy Matchups"]) {
      assert.ok(!headings.includes(banned), `${banned} is absent from an old recap`);
    }
    // What it does keep is the game itself.
    assert.ok(headings.includes("Player Stats"), "the box score is still there");
  });
});

describe("the page follows its state", () => {
  test("declares one of the three states and leads with the matching block", async () => {
    const { doc } = await dom(CANON);
    const state = doc.querySelector("[data-sct-root]").getAttribute("data-matchup-state");
    assert.ok(["upcoming", "recently_completed", "historical"].includes(state), state);

    const featured = doc.querySelector(".sct-mu-featured");
    if (state === "recently_completed") {
      // The result IS the hero now. A separate "Final" card under it would be
      // the page printing the same fixture twice, which is what merging them
      // was for.
      assert.equal(featured, null, "no separate Final card postgame");
      assert.ok(doc.querySelector(".sct-sbh-score"), "the hero carries the score");
    } else if (state === "upcoming") {
      // Same reasoning one step earlier: with no score to print, an "Up Next"
      // card is the hero's season, round, stadium and kickoff a second time,
      // with Where to Watch printing the last two a third.
      assert.equal(featured, null, "no Up Next card on a fixture page");
    } else {
      // The last meeting's scoreboard is the hero now, so the card that used
      // to carry it would be the same game twice.
      assert.equal(featured, null, "no Last Meeting card under the hero");
    }

    // Where to Watch exists only for an upcoming game, and only from real
    // schedule fields - never a "check local listings" line.
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
      upcoming: /Where to Watch/,
      recently_completed: /Score/,
      historical: /Head-to-Head (Record|History)/,
    }[state];
    assert.match(title, phrase);
    // Site audits flag anything longer, and Google truncates it anyway.
    assert.ok(title.length <= 70, `${title.length} characters: ${title}`);
  });

  test("the snapshot is one table: a team down each side, the metric between", async () => {
    const { doc } = await dom(CANON);
    const block = doc.querySelector(".sct-mu-snapshot");
    if (!block) return; // ESPN down for both: the block is absent, not faked.

    // One table, not the three unit-vs-unit comparisons it replaced. Three
    // printed the same figures twice and made the reader parse a caption
    // before any number meant anything.
    const tables = block.querySelectorAll(".sct-mu-table");
    assert.equal(tables.length, 1, `snapshot drew ${tables.length} tables`);

    // Each column is a TEAM, named by nickname alone - no "offense"/"defense"
    // qualifier, because both halves of the ladder are in the same column.
    const sides = [...tables[0].querySelectorAll(".sct-mu-cmp-side")].map((n) =>
      n.textContent.trim(),
    );
    assert.equal(sides.length, 2);
    for (const side of sides) assert.doesNotMatch(side, /offense|defense/i);

    const labels = [...tables[0].querySelectorAll(".sct-mu-td-label")].map((n) =>
      n.firstChild.textContent.trim(),
    );
    assert.deepEqual(labels, [
      "Record",
      "Pts/G",
      "Yds/G",
      "Yds/Play",
      "Pts/G Allowed",
      "Yds/G Allowed",
    ]);

    for (const row of tables[0].querySelectorAll("tbody tr")) {
      assert.equal(row.querySelectorAll("td").length, 2, "one value cell per side");
    }
    const heads = [...tables[0].querySelectorAll("thead th")].map((th) => th.textContent.trim());
    assert.equal(heads.length, 3);

    // The record is a figure, not a ranked metric: no rank chip on that row.
    const first = tables[0].querySelector("tbody tr");
    assert.equal(first.querySelectorAll(".sct-stat-rank").length, 0, "record is not ranked");
  });

  test("the head-to-head record agrees with the meetings listed", async () => {
    const { doc } = await dom(CANON);
    // The record is a figure now, not a sentence: the tally carries the
    // numbers and ".sct-mu-h2h-who" names who holds them.
    const line = doc.querySelector(".sct-mu-h2h-tally")?.textContent.trim();
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
    // The older layout lists them in .sct-pages; the recap layout in Keep
    // exploring's team pills, away side first.
    const hrefs = [...doc.querySelectorAll(".sct-pages a, .sct-ex-hubs a")]
      .map((a) => a.getAttribute("href"))
      .sort();
    assert.deepEqual(hrefs, [
      "/team/new-england-patriots/",
      "/team/new-england-patriots/matchups/",
      "/team/philadelphia-eagles/",
      "/team/philadelphia-eagles/matchups/",
    ]);
  });

  test("a team's matchups hub links every opponent to the canonical pair", async () => {
    const { doc } = await dom("/team/new-england-patriots/matchups/");
    // The club, not the section: the hero says the same thing on every tab of
    // the hub. The panel's own H2 is what names this page.
    assert.equal(doc.querySelector("h1").textContent.trim(), "New England Patriots");
    assert.equal(
      doc.querySelector("#matchups .sct-h2").textContent.trim(),
      "Patriots Matchups",
    );
    const hrefs = [...doc.querySelectorAll('a[href^="/nfl/"]')].map((a) => a.getAttribute("href"));
    assert.ok(hrefs.length >= 10, "one link per scheduled game");
    for (const href of hrefs) {
      const m = /^\/nfl\/([a-z0-9-]+)-vs-([a-z0-9-]+)\/$/.exec(href);
      assert.ok(m, `${href} is a pair path`);
      assert.ok(m[1] < m[2], `${href} is in canonical order`);
      assert.ok(m[1] === "new-england-patriots" || m[2] === "new-england-patriots");
      // Every one resolves without a redirect - the hub never links a spelling
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
    // - which is exactly how this was found.
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
    assert.match(res.body, /<h2 class="sct-sbh-title"[^>]*data-sct-hero-heading>/, "the hero's H2 is marked for promotion");
    // The islands allowed are the SportsEvent and, on a recap layout, the FAQ -
    // inert JSON the plugin lifts into the head and strips, not assets.
    const scripts = [...res.body.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
    assert.ok(
      scripts.every((tag) =>
        [
          '<script type="application/json" class="sct-matchup-event-data">',
          '<script type="application/json" class="sct-matchup-faq-data">',
          '<script type="application/json" class="sct-matchup-video-data">',
        ].includes(tag),
      ),
      scripts.join(" "),
    );
    assert.ok(!/<link\b/i.test(res.body), "no assets of its own");
    assert.match(res.body, /data-matchup=/);
  });
});

/**
 * Game Leaders.
 *
 * Built from the per-week game logs, so what these assert is the three things
 * the derivation cannot guarantee on its own: that a completed game finds its
 * leaders, that a category nobody produced in is absent rather than zeroed, and
 * that a game with no result carries no leaders block at all.
 */
/**
 * The Fantasy tab's links into Redraft Command: Projections after Fantasy
 * Points vs Expected, Trade Calculator after the verdicts, player start/sit
 * pages at their final address, and comparison pages only for real decisions.
 */
describe("fantasy tab tool links", () => {
  const GAME = "/nfl/new-england-patriots-vs-seattle-seahawks/2026-week-1/";
  const RC = "https://statchasers.com/redraft-command/";

  test("projections and trade calculator banners, at their final addresses", async () => {
    const { doc } = await dom(GAME);
    assert.equal(
      doc.querySelector('[data-cta="fantasy-projections-banner"]')?.getAttribute("href"),
      `${RC}fantasy-football-projections`,
    );
    assert.equal(
      doc.querySelector('[data-cta="fantasy-trade-banner"]')?.getAttribute("href"),
      `${RC}fantasy-football-trade-calculator`,
    );
    assert.equal(doc.querySelectorAll('a[href*="/launch/"]').length, 0, "nothing goes through the /launch/ redirect");
    for (const a of doc.querySelectorAll('[data-cta="verdict-startsit"]')) {
      assert.match(a.getAttribute("href"), /^https:\/\/statchasers\.com\/redraft-command\/who-should-i-start\/[a-z0-9-]+$/);
    }
  });

  test("comparisons: at most three, slugs in order, nobody twice", async () => {
    const { doc } = await dom(GAME);
    const links = [...doc.querySelectorAll('a[data-cta="fantasy-compare"]')];
    assert.ok(links.length <= 3, `got ${links.length}`);
    const names = [];
    for (const a of links) {
      const m = a.getAttribute("href").match(/who-should-i-start\/([a-z0-9-]+)-or-([a-z0-9-]+)$/);
      assert.ok(m, a.getAttribute("href"));
      assert.ok(m[1] < m[2], "the same pair always gets the same address");
      const q = a.querySelector(".sct-fp-decision-q").textContent.replace(/\?$/, "").split(" or ");
      names.push(...q);
    }
    assert.equal(new Set(names).size, names.length);
  });
});

describe("game leaders", () => {
  const PLAYED = "/nfl/new-england-patriots-vs-seattle-seahawks/";

  test("a completed game names who led it", async () => {
    const { doc } = await dom(PLAYED);
    // The pair has no meeting coming, so its page is the recap layout and the
    // leaders are the strip under the hero - see leaders-strip.ts.
    // The fantasy table has players, so the decision module closes it: three
    // Redraft Command tools, then the hub.
    const banner = doc.querySelector(".sct-mu-playerstats > aside.sct-mu-decide:last-child");
    if (doc.querySelector(".sct-mu-playerstats table")) {
      assert.ok(banner, "the decision module is the section's last element");
      assert.deepEqual(
        [...banner.querySelectorAll("a")].map((a) => [a.getAttribute("data-cta"), a.getAttribute("href")]),
        [
          ["decide-startsit", "https://statchasers.com/redraft-command/who-should-i-start"],
          ["decide-trade", "https://statchasers.com/redraft-command/fantasy-football-trade-calculator"],
          ["decide-league", "https://statchasers.com/redraft-command/fantasy-football-league-analyzer"],
          ["decide-redraft", "https://statchasers.com/redraft-command/"],
        ],
      );
    }
    const block = doc.querySelector('section.sct-ls[aria-label="Game leaders"]');
    assert.ok(block, "a played matchup carries the leaders strip");

    const cards = [...block.querySelectorAll(".sct-ls-card")];
    assert.ok(cards.length > 0 && cards.length <= 4, `got ${cards.length} cards`);

    const labels = cards.map((c) => c.querySelector(".sct-ls-label").textContent.trim());
    assert.equal(new Set(labels).size, labels.length, "each rule picks once");
    assert.equal(labels[0], "Passing leader");

    const names = cards.map((c) => c.querySelector(".sct-ls-name").textContent.trim());
    assert.equal(new Set(names).size, names.length, "nobody is picked twice");
    for (const card of cards) {
      const link = card.querySelector(".sct-ls-name a");
      // The same profile link every other player name on the site gets.
      if (link) assert.match(link.getAttribute("href"), /\/nfl\/players\//);
      assert.ok(card.querySelector(".sct-ls-line").textContent.trim(), "a stat line");
      const points = card.querySelector(".sct-ls-num");
      if (points) assert.ok(Number(points.textContent) > 0, `${points.textContent} is not a leading figure`);
    }
  });

  test("a game with no result carries no leaders", async () => {
    // Whichever pair the fixture list has as upcoming; if every pair this
    // season is played, the assertion below is vacuous and says so.
    const { doc } = await dom(CANON);
    const state = doc
      .querySelector("[data-matchup-state]")
      ?.getAttribute("data-matchup-state");
    if (state !== "upcoming") return;
    assert.equal(
      doc.querySelector(".sct-mu-leaders, .sct-ls"),
      null,
      "an unplayed game has no leaders to name",
    );
  });
});

describe("fantasy matchups", () => {
  // CANON rather than the played pair: this block is the PREGAME question, and
  // the postgame page no longer carries it at all - pointing this at a finished
  // game would leave the test passing on an element that is never there.
  test("each defense is rated by position, once, with its scale stated", async () => {
    const { doc } = await dom(CANON);
    const block = doc.querySelector(".sct-mu-fantasy");
    if (!block) return; // No FPA ingest in this environment; nothing to check.

    if (block.querySelector(".sct-rb-table")) {
      // A recap draws it in the "Why won" design: one row per position, the
      // two teams named once, in the header.
      const labels = [...block.querySelectorAll(".sct-rb-stat-name")].map((n) => n.textContent.trim());
      assert.deepEqual(labels, ["QB", "RB", "WR", "TE"].map((p) => `Points allowed to ${p}s`));
      const heads = [...block.querySelectorAll("thead th")].map((n) => n.textContent.trim());
      assert.equal(heads.length, 3);
      assert.match(block.querySelector("caption")?.textContent ?? "", /defense vs .* defense$/);
      assert.match(block.querySelector(".sct-rb-sub")?.textContent ?? "", /scoring\.$/, "the scale is stated");
      return;
    }

    const labels = [...block.querySelectorAll(".sct-mu-td-label")].map((n) =>
      n.textContent.trim(),
    );
    assert.deepEqual(labels, ["QB", "RB", "WR", "TE"]);

    // The two sides are named once, in the caption, not on every row.
    const sides = [...block.querySelectorAll(".sct-mu-cmp-side")].map((n) =>
      n.textContent.trim(),
    );
    assert.equal(sides.length, 2, `named ${sides.length} times`);
    for (const side of sides) assert.match(side, /defense$/);

    // The bar means the opposite of the Snapshot's, so the block has to say so.
    const note = block.querySelector(".sct-note")?.textContent ?? "";
    assert.match(note, /allows the most/i, "the rank direction is stated");
    assert.match(note, /softer defense/i, "the bar direction is stated");
  });

  test("the softest defense is the green one, as the FPA legend has it", async () => {
    // This block, the bar beside it and the FPA tool all have to agree on which
    // end of the scale is the good news. They did not: the chip was tiered off
    // an inverted rank, so 1st - the most points allowed, the best matchup for
    // the offense facing it - came out red while 32nd came out green.
    for (const path of [CANON, "/nfl/new-england-patriots-vs-seattle-seahawks/"]) {
      const { doc } = await dom(path);
      const block = doc.querySelector(".sct-mu-fantasy");
      if (!block) continue;
      for (const chip of block.querySelectorAll(".sct-stat-rank")) {
        const rank = Number(chip.textContent.trim().replace(/\D.*$/, ""));
        if (!Number.isFinite(rank)) continue;
        const tier = chip.getAttribute("data-tier");
        // rankTier(): 1-8 good, 25-32 poor. Anything between is "mid".
        const expected = rank <= 8 ? "good" : rank >= 25 ? "poor" : "mid";
        assert.equal(tier, expected, `${rank} should be ${expected}, not ${tier}`);
      }
    }
  });

  test("a team's color is the same everywhere on the page", async () => {
    // Several pairings share a primary - Patriots and Seahawks are both
    // #002244 - and a team that changes color between two tables is worse
    // than no color at all.
    const { doc } = await dom("/nfl/new-england-patriots-vs-seattle-seahawks/");
    // The Snapshot is one table now, so the comparison that matters is across
    // BLOCKS - Snapshot against Fantasy Matchups - rather than within one.
    // On a recap every comparison is a "Why won" table, colored by
    // --rb-away / --rb-home and named in its header.
    const recapTables = [...doc.querySelectorAll(".sct-rb-table[style*='--rb-away']")];
    if (recapTables.length) {
      const seen = new Map();
      for (const table of recapTables) {
        const style = table.getAttribute("style");
        const colors = [/--rb-away:\s*([^;"]+)/.exec(style)?.[1]?.trim(), /--rb-home:\s*([^;"]+)/.exec(style)?.[1]?.trim()];
        assert.notEqual(colors[0], colors[1], "the two sides must be told apart");
        const names = [...table.querySelectorAll("thead th")].map((n) => n.textContent.trim().split(" ")[0]);
        for (const [i, name] of [[0, names[0]], [1, names[2]]]) {
          if (seen.has(name)) assert.equal(seen.get(name), colors[i], `${name} changed color`);
          else seen.set(name, colors[i]);
        }
      }
      assert.ok(seen.size >= 2, "both teams appeared");
      return;
    }
    const tables = [...doc.querySelectorAll(".sct-mu-table[style]")];
    assert.ok(tables.length >= 1, "at least one comparison on the page");

    const seen = new Map();
    for (const table of tables) {
      const style = table.getAttribute("style");
      const left = /--mu-cmp-left:\s*([^;"]+)/.exec(style)?.[1]?.trim();
      const right = /--mu-cmp-right:\s*([^;"]+)/.exec(style)?.[1]?.trim();
      assert.ok(left && right, style);
      assert.notEqual(left, right, "the two sides must be told apart");
      for (const [side, color] of [["a", left], ["b", right]]) {
        const name = table
          .querySelector(`.sct-mu-cmp-side[data-side="${side}"]`)
          ?.textContent.trim()
          .split(" ")[0];
        if (!name) continue;
        if (seen.has(name)) {
          assert.equal(seen.get(name), color, `${name} changed color`);
        } else {
          seen.set(name, color);
        }
      }
    }
    assert.ok(seen.size >= 2, "both teams appeared");
  });
});

/*
 * The postgame page.
 *
 * Addressed by a pair whose meeting has actually been played, so these run
 * against whichever of the two fixtures below is in that state - and skip
 * cleanly rather than failing when neither is, because a suite that depends on
 * the calendar is a suite that goes red every February.
 */
const POSTGAME_CANDIDATES = [
  "/nfl/new-england-patriots-vs-seattle-seahawks/",
  CANON,
];

async function postgamePage() {
  for (const path of POSTGAME_CANDIDATES) {
    const page = await dom(path);
    if (page.doc.querySelector("[data-sct-root]").getAttribute("data-postgame") === "1") {
      return page;
    }
  }
  return null;
}

/*
 * The fixture page.
 *
 * Same posture as the postgame candidates above: addressed by a pair with a
 * game still to come, and skipping cleanly when neither is in that state.
 */
const FIXTURE_CANDIDATES = [CANON, "/nfl/atlanta-falcons-vs-carolina-panthers/"];

async function fixturePage() {
  for (const path of FIXTURE_CANDIDATES) {
    const page = await dom(path);
    const root = page.doc.querySelector("[data-sct-root]");
    if (root.getAttribute("data-matchup-state") === "upcoming") return page;
  }
  return null;
}

describe("the fixture page", () => {
  // mak's 2026-10-03 spec: the upcoming page leads with the decision-layer
  // hero (split team gradient, match line, chips, betting strip) instead of
  // the scoreboard. It falls back to the scoreboard only without a preview.
  test("the hero is the preview hero with the kickoff in its chips", async () => {
    const page = await fixturePage();
    if (!page) return;
    const { doc } = page;

    assert.equal(doc.querySelectorAll("h1").length, 1, "still exactly one H1");
    const hero = doc.querySelector("header.sct-pv-hero") ?? doc.querySelector("header.sct-sbh");
    assert.ok(hero, "there is a hero");
    assert.ok(hero.querySelector("h1"), "and the H1 is inside it");
    if (!hero.matches(".sct-pv-hero")) return;

    assert.equal(hero.querySelectorAll(".sct-pv-side").length, 2, "two sides");
    assert.equal(hero.querySelectorAll(".sct-sbh-score, table").length, 0, "no score, no table");
    const chips = [...hero.querySelectorAll(".sct-pv-chip")].map((n) => n.textContent);
    assert.match(chips[0] ?? "", /^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}( · (\d{1,2}:\d{2} [AP]M ET|Time TBD))?$/, `kickoff chip: ${chips[0]}`);

    // The strip's implied totals are (total -/+ spread) / 2 of what it prints.
    const cells = [...hero.querySelectorAll(".sct-pv-bet")].map((c) => ({
      k: c.querySelector(".sct-pv-bet-k").textContent,
      v: c.querySelector(".sct-pv-bet-v").textContent,
    }));
    if (cells.length) {
      const total = Number(cells.find((c) => c.k === "Total").v);
      const implied = cells.filter((c) => / implied$/.test(c.k)).map((c) => Number(c.v));
      assert.equal(implied.length, 2, "both implied totals");
      assert.ok(Math.abs(implied[0] + implied[1] - total) < 0.02, "implied totals add up to the total");
    }
  });
});

describe("the postgame page", () => {
  test("the hero is the scoreboard", async () => {
    const page = await postgamePage();
    if (!page) return;
    const { doc } = page;

    const hero = doc.querySelector("header.sct-sbh[data-status=final]");
    assert.ok(hero, "the hero is laid out as a final");
    assert.equal(doc.querySelectorAll("h1").length, 1, "still exactly one H1");

    const scores = [...hero.querySelectorAll(".sct-sbh-score")].map((n) =>
      Number(n.textContent.trim()),
    );
    assert.equal(scores.length, 2, "two scores");
    for (const score of scores) assert.ok(Number.isFinite(score), "a real number");

    // Exactly one winner, and it is the bigger number.
    const sides = [...hero.querySelectorAll(".sct-sbh-team")];
    const winners = sides.filter((s) => s.classList.contains("is-winner"));
    if (scores[0] !== scores[1]) {
      assert.equal(winners.length, 1, "one winner");
      const won = Number(winners[0].querySelector(".sct-sbh-score").textContent);
      assert.equal(won, Math.max(...scores), "the winner has the bigger score");
    } else {
      assert.equal(winners.length, 0, "a tie has no winner");
    }

    // Away first, home second.
    assert.ok(sides[0].classList.contains("is-away") && sides[1].classList.contains("is-home"));
    assert.match(hero.querySelector(".sct-sbh-badge").textContent, /^Final(\/OT)?(, tie)?$/);
  });

  test("the quarter line adds up to the score beside it", async () => {
    const page = await postgamePage();
    if (!page) return;
    const table = page.doc.querySelector(".sct-mu-linescore");
    // Absent is allowed - ESPN's box score is a separate upstream and the page
    // renders without it. What is not allowed is a line that disagrees.
    if (!table) return;

    const rows = [...table.querySelectorAll("tbody tr")];
    assert.equal(rows.length, 2, "one row per team");
    for (const row of rows) {
      const quarters = [...row.querySelectorAll("td:not(.sct-mu-ls-total)")].map((n) =>
        Number(n.textContent.trim()),
      );
      const total = Number(row.querySelector(".sct-mu-ls-total").textContent.trim());
      assert.ok(quarters.length >= 4, "at least four periods");
      assert.equal(
        quarters.reduce((sum, n) => sum + n, 0),
        total,
        "the quarters sum to the total",
      );
    }

    // And the totals are the same two numbers the hero printed.
    const heroScores = [...page.doc.querySelectorAll(".sct-sbh-score")]
      .map((n) => Number(n.textContent.trim()))
      .sort((x, y) => x - y);
    const lineTotals = rows
      .map((row) => Number(row.querySelector(".sct-mu-ls-total").textContent.trim()))
      .sort((x, y) => x - y);
    assert.deepEqual(lineTotals, heroScores, "the line score and the hero agree");
  });

  test("the sections run score, how, who, what it meant, then history", async () => {
    const page = await postgamePage();
    if (!page) return;
    const headings = [...page.doc.querySelectorAll(".sct-section .sct-h2")].map((n) =>
      n.textContent.trim(),
    );
    assert.ok(headings.length >= 4, headings.join(" / "));

    // Head-to-Head is evergreen context, not the answer to "what was the
    // score", so it closes the page rather than opening it.
    assert.equal(headings[headings.length - 1], "Head-to-Head", headings.join(" / "));

    // The game itself comes before the season-long comparison.
    const glance = headings.findIndex((h) => /^(Why the |How the Game)/.test(h));
    const form = headings.indexOf("Season Form");
    if (glance >= 0 && form >= 0) assert.ok(glance < form, headings.join(" / "));

    // Pregame wording must not survive into a page about a played game.
    assert.ok(!headings.includes("Matchup Snapshot"), "Snapshot is renamed postgame");
    assert.ok(!headings.includes("Injury Watch"), "Injury Watch is renamed postgame");
  });

  test("the player tables carry real lines, and a passer rating that is possible", async () => {
    const page = await postgamePage();
    if (!page) return;
    const block = page.doc.querySelector(".sct-mu-playerstats");
    if (!block) return;

    const headings = [...block.querySelectorAll("h3")].map((n) => n.textContent.trim());
    assert.ok(headings.includes("Fantasy"), headings.join(" / "));

    for (const table of block.querySelectorAll(".sct-mu-ps-table")) {
      const rows = [...table.querySelectorAll("tbody tr")];
      assert.ok(rows.length >= 1, "no empty table is rendered");
      for (const row of rows) {
        assert.ok(
          row.querySelector(".sct-mu-ps-link, .sct-mu-ps-who")?.textContent.trim(),
          "every row names a player",
        );
      }
    }

    // 158.3 is the maximum the formula can produce. A rating above it means the
    // components were not clamped.
    const passing = [...block.querySelectorAll("h3")].find(
      (h) => h.textContent.trim() === "Quarterbacks",
    )?.parentElement;
    for (const row of passing?.querySelectorAll("tbody tr") ?? []) {
      // Rate is the last stat, before the Start/Sit action.
      const rating = Number([...row.querySelectorAll("td")].at(-2).textContent.trim());
      if (Number.isFinite(rating)) {
        assert.ok(rating >= 0 && rating <= 158.3, `passer rating ${rating}`);
      }
    }
  });

  test("usage is a share of something, and never claims routes", async () => {
    const page = await postgamePage();
    if (!page) return;
    const block = page.doc.querySelector(".sct-mu-usage");
    if (!block) return;

    const columns = [...block.querySelectorAll("thead th")].map((n) =>
      n.textContent.trim().toUpperCase(),
    );
    // The one column no free source can fill. If it ever appears here, it was
    // invented - see the note in game-stats.ts.
    assert.ok(!columns.some((c) => c.includes("ROUTE")), columns.join(" / "));

    for (const row of block.querySelectorAll("tbody tr")) {
      const cells = [...row.querySelectorAll("td")].map((n) => n.textContent.trim());
      for (const cell of cells.filter((c) => c.endsWith("%"))) {
        const share = Number(cell.slice(0, -1));
        assert.ok(share >= 0 && share <= 100, `${cell} is a share`);
      }
    }
  });

  test("usage leads with the charts and keeps the table behind one toggle", async () => {
    const page = await postgamePage();
    if (!page) return;
    const block = page.doc.querySelector(".sct-mu-usage");
    if (!block) return;

    const panels = [...block.querySelectorAll(".sct-mu-usage-team")];
    if (panels.length === 0) return;
    // One panel per side, never a third, and never the two mixed into one.
    assert.ok(panels.length <= 2, `${panels.length} team panels`);
    for (const panel of panels) {
      assert.ok(panel.querySelector(".sct-mu-usage-team-name"), "the panel names its team");
    }

    // The hero's order: away on the left, home on the right. The panels came
    // back in the order the game log met the two teams, and before that were
    // sorted alphabetically by pair - either way, not the scoreboard's order.
    const names = panels.map((p) =>
      p.querySelector(".sct-mu-usage-team-name").textContent.trim(),
    );
    const hero = ["is-away", "is-home"].map((side) =>
      page.doc.querySelector(`.sct-sbh-team.${side} .sct-sbh-name`)?.textContent.trim(),
    );
    if (hero.every(Boolean)) {
      assert.deepEqual(names, hero.filter((name) => names.includes(name)), `panels ${names.join(", ")} vs hero ${hero.join(", ")}`);
    }

    // The table is still in the HTML - one copy of it, collapsed, not a second
    // rendering of the same rows beside the charts.
    const tables = [...block.querySelectorAll(".sct-mu-ps-table")];
    assert.equal(tables.length, 1, "exactly one usage table in the DOM");
    const details = block.querySelector("details.sct-mu-usage-full");
    assert.ok(details, "the table is inside a <details>");
    assert.ok(details.contains(tables[0]), "…and that <details> is the one holding it");
    assert.equal(details.hasAttribute("open"), false, "collapsed by default");
    assert.match(
      details.querySelector("summary")?.textContent ?? "",
      /view full usage table/i,
      "the control says what it opens",
    );
  });

  // The before/after rank table was removed from this page: it answered a
  // pregame question with postgame arithmetic, and the page already spends four
  // tables on the same eight ranks' worth of attention. Asserted rather than
  // merely deleted so it cannot drift back into the postgame order unnoticed.
  test("the postgame page does not carry the fantasy rank block", async () => {
    const page = await postgamePage();
    if (!page) return;
    assert.equal(page.doc.querySelector(".sct-mu-fantasy"), null);
  });

  test("every ring slice is named and measured in text, not only in color", async () => {
    const page = await postgamePage();
    if (!page) return;
    const block = page.doc.querySelector(".sct-mu-usage");
    if (!block) return;

    const rows = [...block.querySelectorAll(".sct-mu-usage-ring-row")];
    if (rows.length === 0) return;

    for (const row of rows) {
      const arcs = [...row.querySelectorAll(".sct-mu-usage-arc")];
      const keys = [...row.querySelectorAll(".sct-mu-usage-key")];
      // A slice with no legend entry is a slice whose meaning is its color.
      assert.equal(keys.length, arcs.length, "one legend row per slice");

      // The ring itself is decoration: everything in it is written beside it.
      const svg = row.querySelector("svg");
      assert.equal(svg.getAttribute("aria-hidden"), "true", "the ring is aria-hidden");

      let sum = 0;
      let previous = Infinity;
      for (const key of keys) {
        const name = key.querySelector(".sct-mu-usage-key-name")?.textContent.trim();
        assert.ok(name, "the slice is named");
        const printed = key.querySelector(".sct-mu-usage-key-pct")?.textContent.trim();
        assert.match(printed ?? "", /^\d+%$/, `${name} has a percentage`);
        const share = Number(printed.slice(0, -1));
        sum += share;

        // Highest first, with the pooled tail last however big it is.
        if (!key.querySelector(".is-other")) {
          assert.ok(share <= previous, `${name} at ${share}% is out of order`);
          previous = share;
        } else {
          assert.equal(key, keys.at(-1), "Other is last");
        }

        // The raw count a screen reader gets, since the ring cannot give it one.
        assert.match(
          key.textContent,
          /\d+\s+(targets|carries)/,
          `${name} carries its raw count`,
        );
      }
      // These are shares of one denominator, so they are a whole - give or take
      // the rounding of six numbers.
      assert.ok(Math.abs(sum - 100) <= 3, `slices sum to ${sum}%`);
    }
  });

  test("snap bars are ranked, drawn to the percentage they print", async () => {
    const page = await postgamePage();
    if (!page) return;
    const block = page.doc.querySelector(".sct-mu-usage");
    if (!block) return;

    for (const list of block.querySelectorAll(".sct-mu-usage-bars")) {
      const bars = [...list.querySelectorAll(".sct-mu-usage-bar")];
      assert.ok(bars.length > 0 && bars.length <= 5, `${bars.length} bars`);
      let previous = Infinity;
      for (const bar of bars) {
        const printed = bar.querySelector(".sct-mu-usage-bar-pct").textContent.trim();
        assert.match(printed, /^(\d+%| - )$/, `${printed} is a share`);
        if (printed === "-") continue;
        const share = Number(printed.slice(0, -1));
        assert.ok(share >= 0 && share <= 100, `${printed} is a share`);
        assert.ok(share <= previous, `${share}% is out of order`);
        previous = share;

        // The bar is the number, not a decoration next to it.
        const width = bar.querySelector(".sct-mu-usage-fill").getAttribute("style");
        assert.match(width, new RegExp(`width:${share}%`), `bar drawn to ${printed}`);
        assert.match(bar.textContent, /\d+ snaps/, "the raw count is text");
      }
    }
  });

  test("there is no Fantasy Takeaways section", async () => {
    const page = await postgamePage();
    if (!page) return;
    assert.equal(page.doc.querySelector(".sct-mu-takeaways, .sct-mu-take"), null);
    assert.ok(![...page.doc.querySelectorAll("h2")].some((h) => /Fantasy Takeaways/.test(h.textContent)));
  });

  test("a position is named in its own color, and only the position", async () => {
    const page = await postgamePage();
    if (!page) return;
    const { doc } = page;

    const tags = [...doc.querySelectorAll(".sct-pos")];
    assert.ok(tags.length >= 4, "positions are marked up, not baked into a string");

    // The four skill positions carry an ink; anything else - a kicker in the
    // fantasy table - is left to inherit rather than given a fifth color.
    const colored = new Set(["QB", "RB", "WR", "TE"]);
    let seen = 0;
    for (const tag of tags) {
      const pos = tag.getAttribute("data-pos");
      assert.equal(tag.textContent.trim().toUpperCase(), pos, "the element holds the position alone");
      if (colored.has(pos)) seen += 1;
    }
    assert.ok(seen >= 3, "at least three of the four appeared");

    // The team code is a sibling, not inside the colored element: coloring
    // "QB · SEA" wholesale is a row of two-tone text with no hierarchy.
    for (const tag of tags) {
      assert.equal(tag.querySelector(".sct-pos-team"), null);
    }
  });

  // Passing and the combined rushing & receiving table share one row; Fantasy keeps the full width
  // under them. Asserted on the grouping rather than on the rendered geometry,
  // which is a CSS question this suite cannot see.
  test("the box-score tables are one row, and Fantasy is not in it", async () => {
    const page = await postgamePage();
    if (!page) return;
    const section = page.doc.querySelector(".sct-mu-playerstats");
    if (!section) return;

    const row = section.querySelector(".sct-mu-ps-row");
    assert.ok(row, "the box-score tables are grouped");
    const heading = (block) => block.querySelector(".sct-mu-h3")?.textContent.trim();
    const inRow = [...row.querySelectorAll(".sct-mu-ps-block")].map(heading);
    assert.deepEqual(
      inRow,
      ["Quarterbacks", "WRs, RBs, & TEs"].filter((h) => inRow.includes(h)),
      `the row holds ${inRow.join(", ")}`,
    );

    const outside = [...section.querySelectorAll(".sct-mu-ps-block")]
      .filter((block) => !row.contains(block))
      .map(heading);
    assert.deepEqual(outside, ["Fantasy"], `outside the row: ${outside.join(", ")}`);
  });

  test("a stat table has a header row and a caption that spans its columns", async () => {
    const page = await postgamePage();
    if (!page) return;
    const { doc } = page;

    for (const table of doc.querySelectorAll(".sct-mu-ps-table")) {
      const head = table.querySelector("thead tr:last-child");
      assert.ok(head, "every stat table has a header row");
      assert.ok(head.querySelectorAll("th").length >= 4, "and real columns in it");
    }

    // A <caption> with display:flex or display:grid stops being a caption and
    // is wrapped in an anonymous cell, which laid all three words out at the
    // width of the first column. The layout lives on the row INSIDE it.
    for (const caption of doc.querySelectorAll(".sct-mu-cmp-title")) {
      const row = caption.querySelector(".sct-mu-cmp-row");
      assert.ok(row, "the caption wraps its three columns in a row element");
      assert.equal(
        row.querySelectorAll(".sct-mu-cmp-side").length,
        2,
        "one name per side",
      );
      assert.ok(row.querySelector(".sct-mu-cmp-vs"), "and the join between them");
    }
  });
});

describe("sortable stat tables", () => {
  /** The rows' first-column names, in the order they currently appear. */
  const names = (table) =>
    [...table.querySelectorAll("tbody tr")].map((row) =>
      (row.cells[0].getAttribute("data-sort") ?? "").trim(),
    );

  /** One column's sort values, as numbers, skipping the rows with none. */
  const column = (table, index) =>
    [...table.querySelectorAll("tbody tr")]
      .map((row) => row.cells[index].getAttribute("data-sort"))
      .filter((raw) => raw !== null && raw.trim() !== "")
      .map(Number);

  test("every column declares how it sorts, and the cells carry the value", async () => {
    const page = await postgamePage();
    if (!page) return;

    for (const table of page.doc.querySelectorAll("table[data-sct-sortable]")) {
      const headers = [...table.querySelectorAll("thead th")];
      for (const header of headers) {
        assert.ok(
          ["number", "text"].includes(header.getAttribute("data-sort-type")),
          `${header.textContent.trim()} declares a sort type`,
        );
      }
      // Exactly one column may claim to be the one the server ordered by.
      const marked = headers.filter((h) => h.hasAttribute("data-sort-default"));
      assert.ok(marked.length <= 1, "at most one default-sorted column");

      for (const row of table.querySelectorAll("tbody tr")) {
        assert.equal(
          row.cells.length,
          headers.length,
          "every row has a cell per column",
        );
        for (const cell of row.cells) {
          assert.ok(cell.hasAttribute("data-sort"), "every cell carries a sort value");
        }
      }
    }
  });

  test("the server's own order matches the column it says it sorted by", async () => {
    const page = await postgamePage();
    if (!page) return;

    for (const table of page.doc.querySelectorAll("table[data-sct-sortable]")) {
      const headers = [...table.querySelectorAll("thead th")];
      const index = headers.findIndex((h) => h.hasAttribute("data-sort-default"));
      if (index < 0) continue;
      const values = column(table, index);
      for (let i = 1; i < values.length; i += 1) {
        assert.ok(
          values[i - 1] >= values[i],
          `${headers[index].textContent.trim()} is descending as declared`,
        );
      }
    }
  });

  test("no sort control ships in the HTML the server sends", async () => {
    // A control that cannot work must not be in the markup: with the bundle
    // blocked, these are plain headers, not dead buttons.
    const page = await postgamePage();
    if (!page) return;
    assert.equal(page.doc.querySelector(".sct-sort"), null);
    for (const table of page.doc.querySelectorAll("table[data-sct-sortable]")) {
      assert.equal(table.getAttribute("data-sct-sort"), null);
    }
  });

  test("Quarterbacks carries the quarterbacks' runs; WRs, RBs, & TEs has no quarterbacks", async () => {
    const { doc } = await dom("/nfl/new-england-patriots-vs-seattle-seahawks/2026-week-1/");
    const block = (title) =>
      [...doc.querySelectorAll(".sct-mu-playerstats .sct-mu-ps-block")].find(
        (b) => b.querySelector(".sct-mu-h3")?.textContent.trim() === title,
      );
    const passing = block("Quarterbacks");
    if (!passing) return;
    const heads = [...passing.querySelectorAll("thead th")].map((h) => h.textContent);
    // Points and finish straight after the name; Start/Sit last, as an action.
    assert.deepEqual(heads, [
      "Player", "FPTS", "FIN", "CMP/ATT", "Pass YDS", "TD", "INT", "Rush ATT", "Rush YDS", "Rush TD", "Rate", "Start/Sit",
    ]);
    for (const row of passing.querySelectorAll("tbody tr")) assert.equal(row.cells.length, heads.length);
    const skill = block("WRs, RBs, & TEs");
    const positions = [...(skill?.querySelectorAll("tbody .sct-mu-ps-pos") ?? [])].map((c) => c.textContent);
    assert.ok(!positions.includes("QB"), `positions ${positions.join(", ")}`);
  });

  test("the highlights video is part of the game story on the Recap tab", async () => {
    const { doc } = await dom("/nfl/new-england-patriots-vs-seattle-seahawks/2026-week-1/");
    const video = doc.querySelector("[data-mu-tab='recap'] .sct-hl");
    if (!video) return;
    // One game-summary module: the story's last child, after its text.
    assert.ok(video.parentElement.matches(".sct-mu-story"));
    assert.ok(video.previousElementSibling.matches(".sct-mu-story-body, .sct-mu-keys"));
    // Click to load: a button, no iframe in the served HTML.
    assert.ok(video.querySelector("button.sct-hl-play[data-hl-embed^='https://www.youtube-nocookie.com/embed/']"));
    assert.equal(video.querySelector("iframe"), null);
  });

  test("each stat table leads with fantasy points and finish, all three formats on the cell", async () => {
    const { doc } = await dom("/nfl/buffalo-bills-vs-new-england-patriots/2021-week-16/");
    const tables = [...doc.querySelectorAll(".sct-mu-playerstats table")];
    if (tables.length === 0) return;
    assert.ok(![...doc.querySelectorAll(".sct-mu-playerstats caption")].some((c) => /Fantasy/.test(c.textContent)), "no separate fantasy table");
    for (const table of tables) {
      const heads = [...table.querySelectorAll("thead th")].map((h) => h.textContent);
      assert.ok(["PPR", "FPTS"].includes(heads[1]), `points header ${heads[1]}`);
      assert.equal(heads[2], "FIN");
      for (const row of table.querySelectorAll("tbody tr")) {
        const [fp, fin] = [...row.cells].slice(1, 3);
        for (const cell of [fp, fin]) {
          for (const f of ["ppr", "half", "std"]) assert.ok(cell.hasAttribute(`data-fmt-${f}`), `${f} on the cell`);
          assert.equal(cell.textContent, cell.getAttribute("data-fmt-ppr"), "the server prints PPR");
        }
      }
    }
    // Josh Allen is on one row, runs and all: quarterbacks stay off the
    // Rushing & Receiving table.
    const allen = tables
      .flatMap((t) => [...t.querySelectorAll("tbody tr")])
      .filter((r) => r.cells[0].getAttribute("data-sort") === "Josh Allen");
    assert.equal(allen.length, 1, "one row for Josh Allen");
    assert.notEqual(allen[0].cells[7].textContent, "-", "his carries are on the Passing row");
    // The fantasy leaders open the section, the "Player Stats" title sits
    // straight over the tables, and the banner closes it.
    assert.ok(doc.querySelector(".sct-mu-playerstats > h2:first-child + .sct-mu-fl + .sct-mu-ps-head + .sct-mu-ps-row"));
    assert.match(doc.querySelector(".sct-mu-playerstats > h2:first-child").textContent, /^Fantasy Points: Bills vs Patriots, /);
    assert.equal(doc.querySelector(".sct-mu-playerstats > :last-child").className, "sct-mu-ps-cta sct-mu-decide");
    assert.equal(doc.querySelector(".sct-mu-scoring"), null, "the switch is built by the bundle, not sent");
  });

  test("the scoring switch swaps points, finishes, headers and the strip", async () => {
    const path = "/nfl/buffalo-bills-vs-new-england-patriots/2021-week-16/";
    const { doc, errors } = await hydrated(path);
    assert.deepEqual(errors, [], "the bundle threw while wiring the switch");
    const group = doc.querySelector("fieldset.sct-mu-scoring");
    if (!doc.querySelector(".sct-mu-playerstats table")) return;
    assert.ok(group, "the bundle built the switch");
    assert.deepEqual([...group.querySelectorAll("label")].map((l) => l.textContent), ["PPR", "Half PPR", "Standard"]);

    // Passing: both tables read FPTS in every format; the switch swaps the
    // values under the header, not the header.
    const table = doc.querySelectorAll(".sct-mu-playerstats table")[0];
    const headers = [...table.querySelectorAll("thead th")];
    const at = 1;
    // Sort by the points column first, so the switch has to re-sort.
    headers[at].querySelector(".sct-sort").click();
    const std = group.querySelector('input[value="std"]');
    std.checked = true;
    std.dispatchEvent(new doc.defaultView.Event("change", { bubbles: true }));

    assert.equal(headers[at].textContent, "FPTS");
    const cells = [...table.querySelectorAll("tbody tr")].map((r) => r.cells[at]);
    for (const cell of cells) assert.equal(cell.textContent, cell.getAttribute("data-fmt-std"));
    const values = cells.map((c) => c.getAttribute("data-sort")).filter((v) => v !== "").map(Number);
    for (let i = 1; i < values.length; i += 1) assert.ok(values[i - 1] >= values[i], `re-sorted descending: ${values}`);
    assert.equal(headers[at].getAttribute("aria-sort"), "descending");

    for (const n of doc.querySelectorAll(".sct-ls-num")) {
      assert.equal(n.textContent, n.getAttribute("data-std"));
      assert.equal(n.parentElement.querySelector(".sct-ls-unit").textContent, "Std pts");
    }
    // The fantasy leaders' points and finishes follow the switch too.
    for (const n of doc.querySelectorAll("[data-ps-swap]")) assert.equal(n.textContent, n.getAttribute("data-std"));
  });

  test("clicking a header actually reorders the rows", async () => {
    const res = await fetch(`${server.origin}/nfl/new-england-patriots-vs-seattle-seahawks/`);
    const html = await res.text();
    if (!/data-postgame="1"/.test(html)) return;

    const { doc, errors } = await hydrated("/nfl/new-england-patriots-vs-seattle-seahawks/");
    assert.deepEqual(errors, [], "the bundle threw while wiring the tables");

    const table = doc.querySelector("table[data-sct-sortable]");
    assert.ok(table, "a sortable table is on the page");
    assert.equal(table.getAttribute("data-sct-sort"), "js", "the bundle claimed it");

    const headers = [...table.querySelectorAll("thead th")];
    const buttons = headers.map((h) => h.querySelector(".sct-sort"));
    for (const button of buttons) assert.ok(button, "each header became a button");

    // The declared default is announced, not "none".
    const defaultAt = headers.findIndex((h) => h.hasAttribute("data-sort-default"));
    if (defaultAt >= 0) {
      assert.equal(headers[defaultAt].getAttribute("aria-sort"), "descending");
    }

    // A numeric column opens descending.
    const numericAt = headers.findIndex(
      (h, i) => h.getAttribute("data-sort-type") === "number" && i !== defaultAt,
    );
    buttons[numericAt].click();
    assert.equal(headers[numericAt].getAttribute("aria-sort"), "descending");
    let values = column(table, numericAt);
    for (let i = 1; i < values.length; i += 1) {
      assert.ok(values[i - 1] >= values[i], `descending at ${i}: ${values}`);
    }

    // And the second click reverses it.
    buttons[numericAt].click();
    assert.equal(headers[numericAt].getAttribute("aria-sort"), "ascending");
    values = column(table, numericAt);
    for (let i = 1; i < values.length; i += 1) {
      assert.ok(values[i - 1] <= values[i], `ascending at ${i}: ${values}`);
    }

    // Only one column ever claims to be the sorted one.
    const claiming = headers.filter(
      (h) => h.getAttribute("aria-sort") && h.getAttribute("aria-sort") !== "none",
    );
    assert.equal(claiming.length, 1, "one column is marked sorted at a time");

    // The name column opens A to Z, and sorts on the name rather than on the
    // cell's text, which also carries the position and the team code.
    buttons[0].click();
    assert.equal(headers[0].getAttribute("aria-sort"), "ascending");
    const sorted = names(table);
    assert.deepEqual(
      sorted,
      [...sorted].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
      "names are alphabetical",
    );
  });

  test("the usage table is still wired while it is collapsed", async () => {
    const { doc } = await hydrated("/nfl/new-england-patriots-vs-seattle-seahawks/");
    if (doc.querySelector("[data-sct-root]").getAttribute("data-postgame") !== "1") return;

    // The section defaults to its charts and the table lives in a closed
    // <details> under them. Closed is not absent: the bundle has to find it on
    // load, because nothing tells it to look again when the reader opens it.
    const table = doc.querySelector(".sct-mu-usage-full table[data-sct-sortable]");
    if (!table) return;
    assert.equal(table.getAttribute("data-sct-sort"), "js", "the bundle claimed it");
    assert.ok(
      table.querySelector("thead .sct-sort"),
      "its headers became controls like every other table's",
    );
  });

  test("a row with no value in the column stays at the bottom, either way", async () => {
    const { doc } = await hydrated("/nfl/new-england-patriots-vs-seattle-seahawks/");
    if (doc.querySelector("[data-sct-root]").getAttribute("data-postgame") !== "1") return;

    // The Fantasy table's FINISH column is the one that can be empty: a player
    // who did not score has no positional finish, and a missing finish must
    // never be treated as a zero and sorted above a real one.
    const tables = [...doc.querySelectorAll("table[data-sct-sortable]")];
    for (const table of tables) {
      const headers = [...table.querySelectorAll("thead th")];
      const index = headers.findIndex((h) => {
        const at = headers.indexOf(h);
        return [...table.querySelectorAll("tbody tr")].some(
          (row) => (row.cells[at].getAttribute("data-sort") ?? "") === "",
        );
      });
      if (index < 0) continue;

      const button = headers[index].querySelector(".sct-sort");
      for (const pass of ["first", "second"]) {
        button.click();
        const rows = [...table.querySelectorAll("tbody tr")];
        const empties = rows.map((row) =>
          (row.cells[index].getAttribute("data-sort") ?? "") === "",
        );
        const firstEmpty = empties.indexOf(true);
        if (firstEmpty < 0) continue;
        assert.ok(
          empties.slice(firstEmpty).every(Boolean),
          `${pass} click: rows with no value are all at the bottom`,
        );
      }
    }
  });
});

/*
 * The hero is ONE block, not two columns.
 *
 * `.sct-hero-text` is the team hub hero's named grid area - `grid-area: text`,
 * which is only meaningful inside `.sct-hero-inner`'s `grid-template-areas`.
 * The matchup hero borrowed the class for the `min-width: 0` on it and brought
 * the placement along: a grid-area name that matches no line resolves against
 * the IMPLICIT grid rather than being ignored, so the title was pushed into a
 * column of its own while the board and the venue line auto-placed into the
 * first. The hero came apart into two columns with the title stranded at the
 * bottom of the right-hand one.
 *
 * Asserted against the STYLESHEET rather than against a list of class names
 * here: the rule is "nothing outside `.sct-hero-inner` may carry a class that
 * team.css gives a named grid-area", and the set of such classes is something
 * only team.css knows.
 */
describe("the matchup hero is one block", () => {
  async function placementClasses() {
    const res = await get("/team.css");
    assert.equal(res.status, 200, "team.css should be served");
    const named = new Set();
    for (const [, cls, body] of res.body.matchAll(
      /^\.([a-zA-Z0-9_-]+)\s*\{([^}]*)\}/gm,
    )) {
      // A named area, not `grid-area: 1 / 2` and not `auto`.
      if (/grid-area:\s*[a-zA-Z][a-zA-Z0-9_-]*\s*;/.test(body)) named.add(cls);
    }
    assert.ok(named.size > 0, "team.css defines named grid areas");
    return named;
  }

  // Both states, through the same helpers the rest of this file uses to find a
  // pair that is actually in each one - the hero is built by one function and
  // `.is-final` only changes what goes in it, so a borrowed class would be in
  // both, but a test that invents a game segment 404s instead of asserting.
  for (const [label, page] of [
    ["a fixture", fixturePage],
    ["a final", postgamePage],
  ]) {
    test(`${label} hero borrows no grid placement`, async () => {
      const named = await placementClasses();
      const found = await page();
      if (!found) return;
      const { doc } = found;

      const hero = doc.querySelector(".sct-sbh, .sct-pv-hero");
      assert.ok(hero, "the hero renders");

      const offenders = [...hero.querySelectorAll("*")]
        .filter((el) => !el.closest(".sct-hero-inner"))
        .flatMap((el) =>
          [...el.classList].filter((c) => named.has(c)).map((c) => `${c}`),
        );

      assert.deepEqual(
        [...new Set(offenders)],
        [],
        "these classes place themselves in a grid that has no such area",
      );
    });
  }
});

/*
 * Real games, pinned by address.
 *
 * The Wild Card is the reference the scoreboard hero was specified against.
 * The two regular-season games are the ones an old recap page listed as Rams
 * wins at Arizona: both were played at SoFi and both were won by Arizona. Home
 * and away come from ESPN's own `homeAway` field, and these hold it to that.
 * Each skips if ESPN will not serve the game (it 403s this host at times).
 */
const ARI_LAR = "/nfl/arizona-cardinals-vs-los-angeles-rams/";

async function pinnedGame(segment) {
  const res = await get(`${ARI_LAR}${segment}/`);
  if (res.status !== 200) return null;
  const doc = new JSDOM(res.body).window.document;
  return doc.querySelector("header.sct-sbh[data-status=final]") ? { ...res, doc } : null;
}

describe("completed game tabs", () => {
  const WILD_CARD = "/nfl/arizona-cardinals-vs-los-angeles-rams/2021-wild-card/";

  test("five tabs in the HTML, Recap open, nothing hidden until the bundle runs", async () => {
    const page = await pinnedGame("2021-wild-card");
    if (!page) return;
    const { doc } = page;
    const root = doc.querySelector("[data-sct-root]");

    // The standard tablist: buttons that name their panels.
    const list = doc.querySelector("[data-mu-tabbar] [role=tablist]");
    assert.equal(list.getAttribute("aria-label"), "Cardinals vs Rams sections");
    const tabs = [...list.querySelectorAll("button[role=tab]")];
    assert.deepEqual(
      tabs.map((t) => [t.textContent, t.getAttribute("aria-controls")]),
      [
        ["Recap", "recap-tab"],
        ["Fantasy", "fantasy-tab"],
        ["Game flow", "game-flow-tab"],
        ["Head-to-head", "h2h-tab"],
        ["Betting", "betting-tab"],
      ].filter(([, id]) => doc.getElementById(id)),
    );
    assert.deepEqual(tabs.map((t) => t.getAttribute("tabindex")), tabs.map((_, i) => (i === 0 ? "0" : "-1")));
    for (const tab of tabs) {
      const panel = doc.getElementById(tab.getAttribute("aria-controls"));
      assert.equal(panel.getAttribute("role"), "tabpanel");
      assert.equal(panel.getAttribute("aria-labelledby"), tab.id);
    }

    // The score line, for readers on another tab.
    assert.equal(doc.querySelector("[data-mu-score]").textContent.replace(/\s+/g, " ").trim(), "ARI 11 · LAR 34 Final");

    // The H1 is the scoreboard's, which sits outside the panels, full width
    // above the tab bar and both columns, so every tab shows it.
    const h1 = doc.querySelectorAll("h1");
    assert.equal(h1.length, 1);
    assert.equal(h1[0].closest("[data-mu-tab]"), null);
    const hero = h1[0].closest("header.sct-sbh");
    assert.ok(hero.nextElementSibling.matches("[data-mu-tabbar]"));
    assert.ok(hero.nextElementSibling.nextElementSibling.matches(".sct-rb"));

    // Not yet tabbed: every panel is in the markup and none hidden.
    assert.equal(root.hasAttribute("data-mu-tabs"), false);
    for (const panel of doc.querySelectorAll("[data-mu-tab]")) {
      assert.equal(panel.hasAttribute("hidden"), false);
      assert.ok(panel.textContent.trim(), `${panel.getAttribute("data-mu-tab")} has content`);
    }

    // Sections keep their ids inside their tab; outlook, FAQ and exploring sit
    // below them. The recap story is in the Recap tab's full-width lead, the
    // rest of that tab in its panel.
    const inTab = { recap: "recap", why: "recap", verdicts: "fantasy", wp: "game-flow", h2h: "head-to-head", betting: "betting" };
    for (const [id, tab] of Object.entries(inTab)) {
      const el = doc.getElementById(id);
      if (el) assert.equal(el.closest("[data-mu-tab]").getAttribute("data-mu-tab"), tab, `#${id} is in ${tab}`);
    }
    assert.ok(doc.getElementById("recap").closest(".sct-mu-lead"), "the story is in the full-width lead");
    assert.equal(doc.getElementById("why").closest("[data-mu-tab]").id, "recap-tab");
    for (const id of ["fantasy-outlook", "faq", "explore"]) {
      const el = doc.getElementById(id);
      if (el) assert.equal(el.closest("[data-mu-tab]"), null, `${id} is below the tabs`);
    }
  });

  test("the bundle opens the tab a hash names, including an anchor inside it", async () => {
    const res = await fetch(`${server.origin}${WILD_CARD}`);
    if (!res.ok || !/data-mu-tabbar/.test(await res.text())) return;

    const plain = await hydrated(WILD_CARD);
    assert.deepEqual(plain.errors, []);
    const active = (doc) =>
      [...new Set([...doc.querySelectorAll("[data-mu-tab].is-active")].map((p) => p.getAttribute("data-mu-tab")))];
    assert.equal(plain.doc.querySelector("[data-sct-root]").getAttribute("data-mu-tabs"), "js");
    assert.deepEqual(active(plain.doc), ["recap"]);
    assert.equal(plain.doc.querySelector('[data-mu-tab-link="recap"]').getAttribute("aria-selected"), "true");
    assert.equal(plain.doc.getElementById("fantasy-tab").hidden, true);

    for (const [hash, tab] of [["#fantasy", "fantasy"], ["#game-flow", "game-flow"], ["#head-to-head", "head-to-head"], ["#betting", "betting"]]) {
      const page = await hydrated(`${WILD_CARD}${hash}`);
      if (page.doc.querySelector(`[data-mu-tab="${tab}"]`)) assert.deepEqual(active(page.doc), [tab], hash);
    }
    const inside = await hydrated(`${WILD_CARD}#verdicts`);
    if (inside.doc.getElementById("verdicts")) assert.deepEqual(active(inside.doc), ["fantasy"]);

    // A click switches in place and writes the tab's address.
    const tab = plain.doc.querySelector('[data-mu-tab-link="head-to-head"]');
    tab.dispatchEvent(new plain.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    assert.deepEqual(active(plain.doc), ["head-to-head"]);
    assert.equal(plain.window.location.hash, "#head-to-head");
    assert.equal(plain.doc.querySelector('[data-mu-tab-link="head-to-head"]').getAttribute("tabindex"), "0");

    // Arrow keys move between tabs; End jumps to the last.
    const list = plain.doc.querySelector("[role=tablist]");
    tab.focus();
    list.dispatchEvent(new plain.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    assert.equal(plain.doc.activeElement.getAttribute("data-mu-tab-link"), active(plain.doc)[0]);
    list.dispatchEvent(new plain.window.KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    assert.deepEqual(active(plain.doc), ["recap"]);
    assert.equal(plain.window.location.hash, "#recap");
  });
});

describe("the recap's share card", () => {
  const IMAGE = "/og/arizona-cardinals-vs-los-angeles-rams-2021-wild-card.png";

  test("the head carries the description, og:type article and the 1200x630 image", async () => {
    const page = await pinnedGame("2021-wild-card");
    if (!page) return;
    const meta = (sel) => page.doc.head.querySelector(sel)?.getAttribute("content");
    assert.equal(
      meta('meta[name="description"]'),
      "Rams beat the Cardinals 34\u201311 at SoFi Stadium: scoring summary, fantasy points for every player, team stats and the head-to-head.",
    );
    assert.ok(meta('meta[name="description"]').length <= 160);
    assert.equal(meta('meta[property="og:type"]'), "article");
    assert.match(meta('meta[property="og:image"]'), new RegExp(`${IMAGE.replace(/\./g, "\\.")}$`));
    assert.equal(meta('meta[property="og:image:width"]'), "1200");
    assert.equal(meta('meta[property="og:image:height"]'), "630");
    assert.equal(meta('meta[name="twitter:card"]'), "summary_large_image");
    assert.match(meta('meta[property="og:image:alt"]'), /^Final score: Los Angeles Rams 34, Arizona Cardinals 11, 2021 Wild Card\. Top fantasy scorer /);
    // A recap's VideoObject, now for every video the page shows.
    const graph = [...page.doc.head.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent));
    assert.ok(graph.some((n) => (n["@graph"] ?? []).some((g) => g["@type"] === "VideoObject")));
  });

  test("the image is a PNG, away team first in its name, and 404s the other way round", async () => {
    const page = await pinnedGame("2021-wild-card");
    if (!page) return;
    const res = await fetch(`${server.origin}${IMAGE}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    const png = Buffer.from(await res.arrayBuffer());
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 630);
    const reversed = await fetch(`${server.origin}/og/los-angeles-rams-vs-arizona-cardinals-2021-wild-card.png`);
    assert.equal(reversed.status, 404);
  });

  test("the embed fragment sends the plugin its description and image", async () => {
    const res = await fetch(`${server.origin}/embed/matchup/arizona-cardinals-vs-los-angeles-rams?game=2021-wild-card`);
    if (!res.ok) return;
    assert.equal(res.headers.get("x-matchup-image"), IMAGE);
    assert.match(decodeURIComponent(res.headers.get("x-matchup-description")), /^Rams beat the Cardinals 34–11/);
    assert.match(await res.text(), /class="sct-matchup-video-data"/);
  });
});

describe("the Cardinals–Rams games", () => {
  test("the Wild Card: one H1 in the hero, scores, table and JSON-LD in the source", async () => {
    const page = await pinnedGame("2021-wild-card");
    if (!page) return;
    const { doc, body } = page;

    const h1 = doc.querySelectorAll("h1");
    assert.equal(h1.length, 1);
    assert.equal(h1[0].textContent, "Arizona Cardinals vs Los Angeles Rams, Wild Card 2021");
    const hero = h1[0].closest("header.sct-sbh");
    assert.equal(hero.getAttribute("aria-labelledby"), h1[0].id);

    assert.equal(hero.querySelector(".sct-sbh-round").textContent, "2021 NFC Wild Card");
    assert.deepEqual(
      [...hero.querySelectorAll(".sct-sbh-score")].map((n) => n.getAttribute("aria-label")),
      ["Cardinals 11", "Rams 34"],
    );
    assert.equal(hero.querySelector(".is-winner .sct-sbh-tag").textContent, "Won, advanced");
    assert.equal(hero.querySelector("time").textContent, "Mon, Jan 17, 2022, 8:15 PM ET");

    assert.equal(
      doc.querySelector("title").textContent,
      "Cardinals vs Rams Wild Card 2021: Final Score 34–11, Stats & Recap",
    );

    // In the served HTML, no script run: the head carries the SportsEvent.
    const ld = [...doc.head.querySelectorAll('script[type="application/ld+json"]')]
      .map((s) => JSON.parse(s.textContent))
      .find((n) => n["@type"] === "SportsEvent");
    assert.ok(ld, "a SportsEvent in the head");
    assert.equal(ld.homeTeam.name, "Los Angeles Rams");
    assert.equal(ld.awayTeam.name, "Arizona Cardinals");
    assert.equal(ld.location.name, "SoFi Stadium");
    assert.equal(ld.description, "Final: Los Angeles Rams 34, Arizona Cardinals 11.");
    assert.match(body, /<h1 class="sct-sbh-title"/, "the H1 is in the source, not written by script");

    // The recap leads the Recap tab, full width above its two columns, headed
    // by an H2 with the score in it.
    const recap = doc.querySelector('[data-sct-panel] > .sct-mu-lead[data-mu-tab="recap"] > .sct-mu-tabpanel > .sct-mu-story#recap');
    assert.ok(recap, "the recap is in the Recap panel");
    assert.match(recap.querySelector(".sct-mu-story-dek").textContent, /^Los Angeles led 21–0 at halftime .* to win 34–11\. The Rams finished with a 375–183 edge/);
    assert.match(recap.querySelector("h2").textContent, /^Rams 34, Cardinals 11: /);
    assert.match(recap.textContent, /Super Bowl LVI/);

    // The body: its sections in order, the series counted from its scores,
    // and the FAQ's JSON-LD in the head saying what the page says.
    const headings = (selector) =>
      [...doc.querySelectorAll(selector)].map((h) => h.textContent);
    assert.deepEqual(
      // Section titles in Title Case, as on the player pages (mak, 2026-09-30).
      headings('[data-mu-tab="recap"] > .sct-rb-section > h2, [data-mu-tab="recap"] > section > h2').filter((h) => /Won$|^Scoring/.test(h)),
      ["Why the Rams Won", "Scoring Summary"].filter(
        (h) => h !== "Scoring Summary" || doc.querySelector("#sct-rb-scoring"),
      ),
    );
    assert.deepEqual(headings('[data-mu-tab="head-to-head"] > .sct-rb-section > h2').slice(0, 1), [
      "Cardinals vs Rams Head-to-Head",
    ]);
    // Below the tabs, on every one of them, under both columns at the full width.
    assert.deepEqual(
      headings(".sct-mu-foot > .sct-rb-section > h2, .sct-mu-foot > nav > h2"),
      [
        "Cardinals vs Rams Fantasy Outlook for 2026",
        "Keep Exploring",
        "Cardinals vs Rams Game FAQ",
      ].filter((h) => !/Fantasy Outlook/.test(h) || doc.querySelector("#fantasy-outlook")),
    );

    // From ESPN's own feed, when it answered: the strip's four and the summary's end.
    const leaders = [...doc.querySelectorAll(".sct-ls-card .sct-ls-name")].map((n) => n.textContent);
    if (leaders.length) {
      assert.deepEqual(leaders, ["Matthew Stafford", "Cooper Kupp", "Christian Kirk", "David Long Jr."]);
      assert.deepEqual(
        [...doc.querySelectorAll(".sct-ls-num")].map((n) => n.textContent),
        ["24.3", "17.1", "11.1"],
      );
    }
    const scored = [...doc.querySelectorAll("tr.sct-ss-play")];
    if (scored.length) {
      assert.equal(scored.length, 8);
      assert.deepEqual([...scored[7].querySelectorAll(".sct-ss-score")].map((c) => c.textContent), ["11", "34"]);
      // The Rams led from the first score: one "Takes lead", then only
      // "Extends lead", and no "Game winner" for a lead taken in the first quarter.
      assert.deepEqual(
        [...new Set([...doc.querySelectorAll(".sct-ss-pill")].map((p) => p.textContent))],
        ["Takes lead", "Extends lead"],
      );
      assert.equal(doc.querySelectorAll(".sct-ss-pill.is-takes").length, 1);
      assert.doesNotMatch(doc.querySelector(".sct-ss").textContent, /Jr\.\./);
    }
    const tiles = [...doc.querySelectorAll("ol.sct-rb-tiles li")];
    const rams = tiles.filter((t) => t.textContent === "R").length;
    const cards = tiles.filter((t) => t.textContent === "C").length;
    assert.equal(
      doc.querySelector(".sct-rb-h2h-figure").textContent,
      `${Math.max(rams, cards)}\u2013${Math.min(rams, cards)}`,
      "the record is the tiles counted",
    );
    const faq = [...doc.head.querySelectorAll('script[type="application/ld+json"]')]
      .map((s) => JSON.parse(s.textContent))
      .find((n) => n["@type"] === "FAQPage");
    assert.deepEqual(
      faq.mainEntity.map((q) => [q.name, q.acceptedAnswer.text]),
      [...doc.querySelectorAll("details.sct-rb-qa")].map((d) => [
        d.querySelector("summary").textContent,
        d.querySelector("p").textContent,
      ]),
      "the FAQ JSON-LD matches the visible questions exactly",
    );

    // The all-time series, from the shipped history plus this season.
    const h2h = doc.getElementById("h2h");
    assert.equal(h2h.tagName, "H2");
    assert.equal(h2h.textContent, "Cardinals vs Rams Head-to-Head");
    const top = h2h.closest("section");
    assert.match(top.querySelector(".sct-rb-sub").textContent, /^One of the NFL's oldest matchups/);
    assert.deepEqual(
      [...top.querySelectorAll("dl.sct-rb-alltime .sct-rb-at")].map((t) => [
        t.querySelector(".sct-rb-at-num").textContent,
        t.querySelector(".sct-rb-at-cap").textContent,
      ]),
      [
        ["53\u201341\u20132", "Rams lead, 96 meetings since 1937"],
        ["2\u20130", "Rams won in 1975 and 2021"],
        ["44\u20136", "2016"],
        ["34\u20130", "2018"],
      ],
    );
    assert.equal(top.querySelector("h3.sct-rb-since").textContent, "Since 2021");
    const questions = faq.mainEntity.map((q) => q.name);
    const at = questions.indexOf("What is the all-time Cardinals vs Rams record?");
    assert.ok(at > 0, "the all-time question is asked");
    // History questions sit together, all-time first.
    assert.ok(questions.indexOf("What is the Cardinals vs Rams record since 2021?") > at);
    assert.equal(
      faq.mainEntity[at].acceptedAnswer.text,
      "The Rams lead the all-time series 53\u201341\u20132 across 96 meetings since 1937, including a 2\u20130 record in the postseason.",
    );
    // A playoff game has no fantasy table (the logs are regular season), so no note.
    assert.equal(doc.querySelector(".sct-mu-rc-note"), null);
    assert.equal(doc.querySelectorAll("h1").length, 1, "and the body adds no H1");
  });

  for (const [segment, arizona, rams] of [
    ["2021-week-4", 37, 20],
    ["2022-week-10", 27, 17],
  ]) {
    test(`${segment}: Cardinals away at SoFi, and the Cardinals won`, async () => {
      const page = await pinnedGame(segment);
      if (!page) return;
      const hero = page.doc.querySelector("header.sct-sbh");
      const away = hero.querySelector(".sct-sbh-team.is-away");
      const home = hero.querySelector(".sct-sbh-team.is-home");
      assert.equal(away.querySelector(".sct-sbh-name").textContent, "Arizona Cardinals");
      assert.equal(home.querySelector(".sct-sbh-name").textContent, "Los Angeles Rams");
      assert.equal(hero.querySelector(".sct-sbh-venue").textContent, "SoFi Stadium");
      assert.ok(away.classList.contains("is-winner"), "Arizona won");
      assert.equal(away.querySelector(".sct-sbh-score").textContent, String(arizona));
      assert.equal(home.querySelector(".sct-sbh-score").textContent, String(rams));
      assert.match(page.doc.querySelector("h1").textContent, /^Arizona Cardinals vs Los Angeles Rams, Week \d+ 202\d$/);
    });
  }
});
