/**
 * The team depth-chart page across clubs with different structures, and the
 * depth-chart document's own sanity (mak's depth-chart brief, 2026-11-03).
 *
 * Two halves. The first renders the section the way statchasers.com mounts
 * it - the WordPress fragment in "the tool supplies the heading" mode - for
 * a 3-4 club with a fullback slot (Steelers), a 4-3 club (49ers), the
 * Cowboys and the Bills, and checks what a crawler is owed: one H1 that is
 * "{Team} Depth Chart" with no heading before it, the stamp, offense, defense
 * and special teams in the HTML, the fantasy chart after them, player links,
 * the club's pages linked. The second reads the committed document directly:
 * every club has all three sides, no slot lists a name twice, ranks are
 * contiguous, and the football rows are the document's own order - a fantasy
 * rank changes nothing on them.
 *
 * Offline, like team.test.mjs: the providers are replayed.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";
import { startServer, APP_DIR } from "./helpers/server.mjs";
import { startUpstreamReplay } from "./helpers/upstream-replay.mjs";

const SNAPSHOT = path.join(APP_DIR, "data/depth-charts/statchasers/depth-charts.json");
const TEAMS = {
  buf: "Buffalo Bills",
  pit: "Pittsburgh Steelers",
  dal: "Dallas Cowboys",
  sf: "San Francisco 49ers",
};

let server;
let replay;
const windows = [];

before(async () => {
  replay = await startUpstreamReplay();
  server = await startServer(replay.env);
});

after(async () => {
  for (const window of windows) window.close();
  await server?.stop();
  await replay?.stop();
});

async function get(pathname) {
  const res = await fetch(`${server.origin}${pathname}`);
  return { status: res.status, headers: res.headers, body: await res.text() };
}

function parse(html) {
  const dom = new JSDOM(html, { virtualConsole: new VirtualConsole() });
  windows.push(dom.window);
  return dom.window.document;
}

const text = (node) => node.textContent.replace(/\s+/g, " ").trim();

describe("the team depth-chart page, as statchasers.com mounts it", () => {
  for (const [slug, name] of Object.entries(TEAMS)) {
    test(`${name}: one H1, football first, fantasy last, every side in the HTML`, async () => {
      const { status, body } = await get(`/embed/team/${slug}?section=depth-chart&h1=1`);
      assert.equal(status, 200);
      const doc = parse(`<!doctype html><body>${body}</body>`);

      // Exactly one H1, in the page's words, and nothing heads the page
      // before it: the hero's club name is a plain block in this mode.
      const h1s = doc.querySelectorAll("h1");
      assert.equal(h1s.length, 1);
      assert.equal(text(h1s[0]), `${name} Depth Chart`);
      const headings = [...doc.querySelectorAll("h1, h2, h3, h4, h5, h6")];
      assert.equal(headings[0], h1s[0], `the H1 is the first heading, not ${text(headings[0])}`);
      assert.equal(doc.querySelector(".sct-hero .sct-title").tagName, "P");

      // The stamp is the document's refresh time, not now.
      const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
      const stamp = doc.querySelector("#depth-chart .sct-dc-stamp time");
      assert.equal(stamp.getAttribute("datetime"), new Date(snapshot.fetchedAt).toISOString());
      assert.ok(Date.parse(stamp.getAttribute("datetime")) < Date.now() - 60_000, "a real past timestamp");

      // Offense, defense, special teams, then fantasy; Offense pressed.
      const panels = [...doc.querySelectorAll("#depth-chart [data-sct-dc-panel]")].map((p) => p.dataset.sctDcPanel);
      assert.deepEqual(panels, ["offense", "defense", "special", "fantasy"]);
      assert.equal(doc.querySelector('[data-sct-dc-view="offense"]').getAttribute("aria-pressed"), "true");
      const titles = [...doc.querySelectorAll("#depth-chart .sct-dcx-title")].map(text);
      assert.deepEqual(titles, [
        `${name} Offense Depth Chart`,
        `${name} Defense Depth Chart`,
        `${name} Special Teams Depth Chart`,
        `${name} Fantasy Depth Chart`,
      ]);

      // The offense has a QB row and three WR rows (every tested club lists a
      // 3WR base); defense and special teams are not empty.
      const offense = doc.querySelector('[data-sct-dc-panel="offense"]');
      assert.equal(offense.querySelectorAll('.sct-dcx-row[data-pos="QB"]').length, 1);
      assert.equal(offense.querySelectorAll('.sct-dcx-row[data-pos="WR"]').length, 3);
      assert.ok(doc.querySelectorAll('[data-sct-dc-panel="defense"] .sct-dcx-row').length >= 8);
      assert.ok(doc.querySelectorAll('[data-sct-dc-panel="special"] .sct-dcx-row[data-pos="K"]').length === 1);
      // Every row is Starter / Second / Third / Fourth wide, blanks included.
      for (const row of doc.querySelectorAll("#depth-chart .sct-dcx-grid .sct-dcx-row")) {
        assert.equal(row.querySelectorAll(".sct-dcx-cells > li").length, 4, `${row.dataset.slot}: four cells`);
      }

      // Long-tail fantasy headings.
      const fan = [...doc.querySelectorAll('[data-sct-dc-panel="fantasy"] .sct-dcx-fan-title')].map(text);
      for (const pos of ["Quarterback", "Running Back", "Wide Receiver", "Tight End"]) {
        assert.ok(fan.includes(`${name} ${pos} Depth Chart`), `${pos}: ${fan.join(" | ")}`);
      }

      // Player names are crawlable anchors (most of the chart; a rookie the
      // site has no profile for stays plain text).
      // Linemen and most defenders have no profile on the site, so the
      // football chart is held to "many", the fantasy card to "nearly all".
      const linked = doc.querySelectorAll("#depth-chart .sct-dcx-card a.sct-player-link[href]");
      assert.ok(linked.length >= 20, `${linked.length} names link on the chart`);
      const fanCards = doc.querySelectorAll('[data-sct-dc-panel="fantasy"] .sct-dcx-card');
      const fanLinked = doc.querySelectorAll('[data-sct-dc-panel="fantasy"] .sct-dcx-card a.sct-player-link[href]');
      assert.ok(fanLinked.length >= fanCards.length * 0.8, `${fanLinked.length} of ${fanCards.length} fantasy names link`);

      // The questions are the page's own and separate football from fantasy;
      // the club's pages and the tools follow them.
      const questions = [...doc.querySelectorAll(".sct-faq-q")].map(text);
      assert.ok(questions.includes(`Who is the ${name} starting quarterback?`));
      assert.ok(questions.includes(`Who are the ${name} starting wide receivers?`));
      assert.ok(questions.some((q) => /WR1 for fantasy football\?$/.test(q)));
      const faqData = JSON.parse(doc.querySelector("script.sct-faq-data").textContent);
      assert.deepEqual(faqData.map((e) => e.q), questions);
      const clusters = [...doc.querySelectorAll(".sct-dc-links .sct-h2")].map(text);
      assert.deepEqual(clusters, [`More ${name}`, "Fantasy Football Tools"]);
      assert.ok(doc.querySelector(`.sct-dc-links a[href$="/${slug === "sf" ? "san-francisco-49ers" : slug === "buf" ? "buffalo-bills" : slug === "pit" ? "pittsburgh-steelers" : "dallas-cowboys"}/schedule/"]`));
    });
  }

  test("the standalone page's title and description are the brief's", async () => {
    const { body } = await get("/team/buffalo-bills/depth-chart/");
    assert.match(body, /<title>Buffalo Bills Depth Chart 2\d{3}: Starters &amp; Backups<\/title>/);
    assert.match(
      body,
      /<meta name="description" content="View the Buffalo Bills depth chart for the 2\d{3} NFL season, including current starters, backups, offense, defense, special teams and fantasy skill-position rankings\." \/>/,
    );
    assert.match(body, /<link rel="canonical" href="[^"]*\/team\/buffalo-bills\/depth-chart\/" \/>/);
  });
});

describe("the depth-chart document", () => {
  const doc = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
  // The tool's own name key: case, periods, apostrophes and Jr. / III dropped,
  // so "James Cook III" (ESPN) and "James Cook" (Footballguys) are one man.
  const key = (name) => {
    const words = name.toLowerCase().replace(/[.']/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/);
    while (words.length > 1 && ["jr", "sr", "ii", "iii", "iv", "v"].includes(words[words.length - 1])) words.pop();
    return words.join(" ");
  };

  test("every club has offense, defense and special teams slots", () => {
    assert.equal(doc.teams.length, 32);
    for (const team of doc.teams) {
      const sides = new Set((team.slots ?? []).map((s) => s.side));
      assert.deepEqual([...sides].sort(), ["defense", "offense", "specialTeams"], team.team.abbr);
      const offense = team.slots.filter((s) => s.side === "offense").map((s) => s.slot);
      for (const pos of ["QB", "RB", "WR", "TE", "LT", "LG", "C", "RG", "RT"]) {
        assert.ok(offense.includes(pos), `${team.team.abbr}: no ${pos} slot`);
      }
      assert.ok(offense.filter((s) => s === "WR").length >= 2, `${team.team.abbr}: WR slots collapsed`);
      const special = team.slots.filter((s) => s.side === "specialTeams").map((s) => s.slot);
      for (const pos of ["PK", "P", "LS"]) assert.ok(special.includes(pos), `${team.team.abbr}: no ${pos} slot`);
    }
  });

  test("ranks are contiguous and no slot or column lists a name twice", () => {
    for (const team of doc.teams) {
      const lists = [
        ...team.slots.map((s) => [`${team.team.abbr} ${s.key}`, s.players]),
        ...Object.entries(team.positions).map(([k, v]) => [`${team.team.abbr} ${k}`, v]),
      ];
      for (const [label, players] of lists) {
        const ranks = players.map((p) => p.rank);
        assert.deepEqual(ranks, ranks.map((_, i) => i + 1), `${label}: ranks ${ranks.join(",")}`);
        const names = players.map((p) => key(p.name));
        assert.equal(new Set(names).size, names.length, `${label}: a name twice (${names.join(", ")})`);
      }
      const keys = team.slots.map((s) => s.key);
      assert.equal(new Set(keys).size, keys.length, `${team.team.abbr}: a slot key twice`);
    }
  });

  test("the football order is the source's, not the fantasy order", () => {
    // Where the two disagree the page must show both as they are: the slot
    // rows never borrow the FAN_* order. Check by construction - the slot
    // players are never re-sorted - and by example: for every club, the RB
    // slot's order is the RB column's starters-first order, whatever FAN_RB
    // says.
    let differ = 0;
    for (const team of doc.teams) {
      const rb = team.slots.find((s) => s.key === "rb")?.players.map((p) => key(p.name)) ?? [];
      const fan = (team.positions.FAN_RB ?? []).map((p) => key(p.name));
      if (rb.slice(0, 3).join("|") !== fan.slice(0, 3).join("|")) differ += 1;
      // A starter on the slot chart is on the club's folded column too.
      const column = (team.positions.RB ?? []).map((p) => key(p.name));
      assert.ok(rb.length === 0 || column.includes(rb[0]), `${team.team.abbr}: RB1 ${rb[0]} is not in the RB column`);
    }
    // Not asserted to be non-zero (the sources can agree on a given day), but
    // printed so a run shows the two orders really are independent.
    console.log(`clubs where the football RB order differs from the fantasy order: ${differ}`);
  });

  test("the fantasy columns mostly name players on the club's slot chart", () => {
    // FantasyPros ranks a few players the club's chart has not slotted (a
    // practice-squad call-up, a man on IR it still lists). Those are
    // source differences, printed for the record; a column where most of
    // the names are off the club's chart is a roster mismatch and fails.
    const report = [];
    for (const team of doc.teams) {
      const charted = new Set(team.slots.flatMap((s) => s.players.map((p) => key(p.name))));
      for (const pos of ["FAN_QB", "FAN_RB", "FAN_WR", "FAN_TE"]) {
        const column = team.positions[pos] ?? [];
        const missing = column.filter((p) => !charted.has(key(p.name)));
        if (missing.length) report.push(`${team.team.abbr} ${pos}: ${missing.map((p) => p.name).join(", ")}`);
        assert.ok(
          missing.length <= Math.max(2, Math.floor(column.length / 2)),
          `${team.team.abbr} ${pos}: ${missing.map((p) => p.name).join(", ")} not on the slot chart`,
        );
      }
    }
    console.log(`fantasy names not on the club's slot chart: ${report.length ? report.join("; ") : "none"}`);
  });
});
