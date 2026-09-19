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
    if (state === "recently_completed") {
      // The result IS the hero now. A separate "Final" card under it would be
      // the page printing the same fixture twice, which is what merging them
      // was for.
      assert.equal(featured, null, "no separate Final card postgame");
      assert.ok(doc.querySelector(".sct-mu-final-score"), "the hero carries the score");
    } else {
      const title = featured?.querySelector("h2")?.textContent.trim();
      const expected = { upcoming: "Up Next", historical: "Last Meeting" }[state];
      if (featured) assert.equal(title, expected, `${state} leads with ${expected}`);
    }

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
      recently_completed: /Score, Player Stats & Fantasy Recap/,
      historical: /Head-to-Head Record, Stats & History/,
    }[state];
    assert.match(title, phrase);
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

    // Each column is a TEAM, named by nickname alone — no "offense"/"defense"
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

/**
 * Game Leaders.
 *
 * Built from the per-week game logs, so what these assert is the three things
 * the derivation cannot guarantee on its own: that a completed game finds its
 * leaders, that a category nobody produced in is absent rather than zeroed, and
 * that a game with no result carries no leaders block at all.
 */
describe("game leaders", () => {
  const PLAYED = "/nfl/new-england-patriots-vs-seattle-seahawks/";

  test("a completed game names who led it", async () => {
    const { doc } = await dom(PLAYED);
    const block = doc.querySelector(".sct-mu-leaders");
    assert.ok(block, "a played matchup carries a leaders block");

    const cards = [...block.querySelectorAll(".sct-mu-leader")];
    assert.ok(cards.length > 0 && cards.length <= 4, `got ${cards.length} cards`);

    const labels = cards.map((c) =>
      c.querySelector(".sct-mu-leader-label").textContent.trim(),
    );
    // Only the four, only once each, and in the order the markup sets.
    assert.deepEqual(
      labels,
      ["Passing", "Rushing", "Receiving", "Fantasy"].filter((l) =>
        labels.includes(l),
      ),
    );

    for (const card of cards) {
      const name = card.querySelector(".sct-mu-leader-name");
      assert.ok(name?.textContent.trim(), "a leader is a name");
      // The same profile link every other player name on the site gets.
      if (name.tagName === "A") {
        assert.match(name.getAttribute("href"), /\/nfl\/players\//);
      }
      const value = card.querySelector(".sct-mu-leader-value").textContent.trim();
      // A leader who led with nothing is not a leader — see best() in
      // leaders.ts, which gates every category above zero.
      assert.ok(Number(value) > 0, `${value} is not a leading figure`);
      assert.ok(card.querySelector(".sct-mu-leader-unit").textContent.trim());
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
      doc.querySelector(".sct-mu-leaders"),
      null,
      "an unplayed game has no leaders to name",
    );
  });
});

describe("fantasy matchups", () => {
  test("each defense is rated by position, once, with its scale stated", async () => {
    const { doc } = await dom("/nfl/new-england-patriots-vs-seattle-seahawks/");
    const block = doc.querySelector(".sct-mu-fantasy");
    if (!block) return; // No FPA ingest in this environment; nothing to check.

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
    // an inverted rank, so 1st — the most points allowed, the best matchup for
    // the offense facing it — came out red while 32nd came out green.
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

  test("a team's colour is the same everywhere on the page", async () => {
    // Several pairings share a primary — Patriots and Seahawks are both
    // #002244 — and a team that changes colour between two tables is worse
    // than no colour at all.
    const { doc } = await dom("/nfl/new-england-patriots-vs-seattle-seahawks/");
    // The Snapshot is one table now, so the comparison that matters is across
    // BLOCKS — Snapshot against Fantasy Matchups — rather than within one.
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
          assert.equal(seen.get(name), color, `${name} changed colour`);
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
 * against whichever of the two fixtures below is in that state — and skip
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

describe("the postgame page", () => {
  test("the hero is the scoreboard, and says so once", async () => {
    const page = await postgamePage();
    if (!page) return;
    const { doc } = page;

    const hero = doc.querySelector(".sct-mu-hero.is-final");
    assert.ok(hero, "the hero is laid out as a final");
    assert.equal(doc.querySelectorAll("h1").length, 1, "still exactly one H1");

    const scores = [...hero.querySelectorAll(".sct-mu-final-score")].map((n) =>
      Number(n.textContent.trim()),
    );
    assert.equal(scores.length, 2, "two scores");
    for (const score of scores) assert.ok(Number.isFinite(score), "a real number");

    // Exactly one winner, and it is the bigger number — not a class applied to
    // whichever side the pair ordering put first.
    const sides = [...hero.querySelectorAll(".sct-mu-final-side")];
    const winners = sides.filter((s) => s.classList.contains("is-winner"));
    if (scores[0] !== scores[1]) {
      assert.equal(winners.length, 1, "one winner");
      const won = Number(winners[0].querySelector(".sct-mu-final-score").textContent);
      assert.equal(won, Math.max(...scores), "the winner has the bigger score");
    } else {
      assert.equal(winners.length, 0, "a tie has no winner");
    }

    // The board is aria-hidden, so the result has to be a sentence somewhere.
    const spoken = [...hero.querySelectorAll(".sct-visually-hidden")]
      .map((n) => n.textContent)
      .join(" ");
    assert.match(spoken, /\b(beat|tied)\b/, "the result is spoken as a sentence");
  });

  test("the quarter line adds up to the score beside it", async () => {
    const page = await postgamePage();
    if (!page) return;
    const table = page.doc.querySelector(".sct-mu-linescore");
    // Absent is allowed — ESPN's box score is a separate upstream and the page
    // renders without it. What is not allowed is a line that disagrees.
    if (!table) return;

    const rows = [...table.querySelectorAll("tbody tr")];
    assert.equal(rows.length, 2, "one row per team");
    for (const row of rows) {
      const quarters = [...row.querySelectorAll(".sct-mu-ls-q")].map((n) =>
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
    const heroScores = [...page.doc.querySelectorAll(".sct-mu-final-score")]
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
      (h) => h.textContent.trim() === "Passing",
    )?.parentElement;
    for (const row of passing?.querySelectorAll("tbody tr") ?? []) {
      const rating = Number([...row.querySelectorAll("td")].at(-1).textContent.trim());
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
    // invented — see the note in game-stats.ts.
    assert.ok(!columns.some((c) => c.includes("ROUTE")), columns.join(" / "));

    for (const row of block.querySelectorAll("tbody tr")) {
      const cells = [...row.querySelectorAll("td")].map((n) => n.textContent.trim());
      for (const cell of cells.filter((c) => c.endsWith("%"))) {
        const share = Number(cell.slice(0, -1));
        assert.ok(share >= 0 && share <= 100, `${cell} is a share`);
      }
    }
  });

  test("every takeaway is a player, a claim and the figures under it", async () => {
    const page = await postgamePage();
    if (!page) return;
    const cards = [...page.doc.querySelectorAll(".sct-mu-take")];
    if (cards.length === 0) return;
    assert.ok(cards.length <= 6, `${cards.length} cards is a list, not highlights`);

    for (const card of cards) {
      const direction = card.getAttribute("data-direction");
      assert.ok(["up", "down", "watch"].includes(direction), direction);
      for (const selector of [".sct-mu-take-name", ".sct-mu-take-line", ".sct-mu-take-body"]) {
        assert.ok(card.querySelector(selector)?.textContent.trim(), selector);
      }
      const body = card.querySelector(".sct-mu-take-body").textContent;
      // Every card restates a measured figure; none of them is a sentence of
      // opinion with no number in it.
      assert.match(body, /\d/, body);
      // The glyph is decorative, so the direction has to be spoken too.
      assert.match(
        card.querySelector(".sct-visually-hidden")?.textContent ?? "",
        /Role up|Role down|Watch/,
      );
    }
  });

  test("a position is named in its own colour, and only the position", async () => {
    const page = await postgamePage();
    if (!page) return;
    const { doc } = page;

    const tags = [...doc.querySelectorAll(".sct-pos")];
    assert.ok(tags.length >= 4, "positions are marked up, not baked into a string");

    // The four skill positions carry an ink; anything else — a kicker in the
    // fantasy table — is left to inherit rather than given a fifth colour.
    const coloured = new Set(["QB", "RB", "WR", "TE"]);
    let seen = 0;
    for (const tag of tags) {
      const pos = tag.getAttribute("data-pos");
      assert.equal(tag.textContent.trim().toUpperCase(), pos, "the element holds the position alone");
      if (coloured.has(pos)) seen += 1;
    }
    assert.ok(seen >= 3, "at least three of the four appeared");

    // The team code is a sibling, not inside the coloured element: colouring
    // "QB · SEA" wholesale is a row of two-tone text with no hierarchy.
    for (const tag of tags) {
      assert.equal(tag.querySelector(".sct-pos-team"), null);
    }
  });

  test("a stat table has a header row and a caption that spans its columns", async () => {
    const page = await postgamePage();
    if (!page) return;
    const { doc } = page;

    for (const table of doc.querySelectorAll(".sct-mu-ps-table")) {
      const head = table.querySelector("thead tr");
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

  test("a rank that moved says where it moved from, and which way", async () => {
    const page = await postgamePage();
    if (!page) return;
    const block = page.doc.querySelector(".sct-mu-fpa-change");
    if (!block) return;

    const heading = block.querySelector("h2").textContent.trim();
    const moves = [...block.querySelectorAll(".sct-mu-move")];
    assert.ok(moves.length >= 1, "at least one rank");

    const withBefore = moves.filter((m) => m.querySelector(".sct-mu-move-from"));
    // Week 1 has no "before", and the heading must not promise one.
    if (withBefore.length === 0) {
      assert.match(heading, /^Fantasy Matchups After Week/, heading);
      return;
    }
    assert.equal(heading, "What This Changed");

    for (const move of withBefore) {
      const before = Number(move.querySelector(".sct-mu-move-from").textContent.replace(/\D/g, ""));
      const after = Number(
        move.querySelector(".sct-stat-rank").textContent.trim().replace(/\D.*$/, ""),
      );
      const direction = move.querySelector(".sct-mu-move-arrow").getAttribute("data-direction");
      // 1st allows the most, so a rank that FELL is a defense that got softer.
      const expected = before > after ? "softer" : before < after ? "tougher" : "flat";
      assert.equal(direction, expected, `${before} -> ${after}`);
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
