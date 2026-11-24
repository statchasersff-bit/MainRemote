/**
 * WEB-044 (2026-11-24): the team tabs' tables, player links and the roster.
 *
 * 1. Each dataset on Coaching, Stats and Usage renders ONCE in the server
 *    HTML. The phones' copies (the Season by Season and Fantasy Finishes
 *    <details> lists, the Usage names printed full + short + visually hidden)
 *    are gone; CSS adapts the one table.
 * 2. Players link to their published profile, resolved by identity: Usage by
 *    the row's ids (the hub's resolver), the finishes by club + season, the
 *    copy by the club's own resolved rows. Unpublished players stay text.
 * 3. The roster (the Depth Chart tab) is one tap from the header on the hub
 *    and the three tabs, including where the strip hides that tab.
 *
 * Detroit is the audit's club; Buffalo and New England add a long coaching
 * history. Assertions are about structure and identity, not this week's
 * numbers, so the weekly data refresh does not break them.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { startServer, APP_DIR } from "./helpers/server.mjs";
import { startUpstreamReplay } from "./helpers/upstream-replay.mjs";

let server;
let replay;

const published = new Set(
  JSON.parse(fs.readFileSync(path.join(APP_DIR, "data", "player", "indexed_players.json"), "utf8")).slugs,
);
const css = fs.readFileSync(path.join(APP_DIR, "public", "team.css"), "utf8");

before(async () => {
  replay = await startUpstreamReplay();
  server = await startServer(replay.env);
});

after(async () => {
  await server?.stop();
  await replay?.stop();
});

async function page(pathname) {
  const res = await fetch(`${server.origin}${pathname}`);
  assert.equal(res.status, 200, pathname);
  const body = await res.text();
  return { body, doc: new JSDOM(body).window.document };
}

const slugOf = (href) => (href ?? "").match(/\/nfl\/players\/([^/]+)\/$/)?.[1] ?? null;

describe("one rendering per dataset", () => {
  test("Coaching: Season by Season and Fantasy Finishes are one table each, no phone copies", async () => {
    const { doc, body } = await page("/team/detroit-lions/coaching/");
    assert.equal(doc.querySelectorAll(".sct-csp, .sct-cfp").length, 0, "no phone list copies");
    assert.equal(doc.querySelectorAll("#coaching-seasons-premium table").length, 1);
    assert.equal(doc.querySelectorAll("#coaching-fantasy-premium table").length, 1);
    // Every finish cell names its player once: the full name, no surname copy.
    for (const td of doc.querySelectorAll("#coaching-fantasy-premium td.is-fin")) {
      const who = td.querySelector(".sct-cf-who");
      if (!who) continue;
      const full = who.getAttribute("title");
      assert.equal(who.textContent, full);
    }
    // The headings the audit saw twice print once.
    assert.equal((body.match(/Season by Season, /g) ?? []).length, 1);
    assert.equal((body.match(/Fantasy Finishes by Season/g) ?? []).length, 1);
  });

  test("Usage: each table's player name is in the HTML once, the short form painted by CSS", async () => {
    const { doc } = await page("/team/detroit-lions/usage/");
    assert.equal(doc.querySelectorAll(".sct-up-nm.is-full, .sct-up-nm.is-short, .sct-up-name .sct-visually-hidden").length, 0);
    const names = [...doc.querySelectorAll(".sct-up-snaps .sct-up-name")];
    assert.ok(names.length > 5);
    for (const n of names) {
      const full = n.getAttribute("title");
      assert.equal(n.textContent, full, "the cell's text is the full name, once");
      if (n.tagName === "A") assert.equal(n.getAttribute("aria-label"), full);
    }
    // "J. Goff" is painted from "Jared Goff": the rest of the first name hidden, a "." after the initial.
    const goff = names.find((n) => n.getAttribute("title") === "Jared Goff");
    assert.equal(goff.querySelector(".sct-nm-i").textContent, "J");
    assert.equal(goff.querySelector(".sct-nm-r").textContent, "ared");
    assert.match(css, /\.sct-up-name \.sct-nm-r \{\s*display: none;/);
    assert.match(css, /\.sct-up-name \.sct-nm-i::after \{\s*content: "\.";/);
  });

  test("CSS: phones keep the tables, nothing hides them for a copy", () => {
    assert.doesNotMatch(css, /\.sct-csp\b/, "no season-list rules left");
    assert.doesNotMatch(css, /\.sct-cfp-(row|sum|kv|head|cell)\b/, "no finishes-list rules left");
    assert.doesNotMatch(css, /\.sct-cc-body \.sct-cs-scroll,[^{]*\{\s*display: none/, "the season table is not hidden on phones");
    assert.doesNotMatch(css, /\.sct-cf-panel \.sct-cf-scroll \{\s*display: none/, "the finishes table is not hidden on phones");
    // The finishes fit a phone: first names step aside, the table drops its minimum width.
    assert.match(css, /\.sct-cf-panel \.sct-cf-who \.sct-nm-first \{\s*display: none;/);
    assert.match(css, /\.sct-cf-panel \.sct-cf-table \{\s*min-width: 0;/);
    // A scrolling table keeps its absolutely positioned bits (the 1px
    // screen-reader words) inside its region, so the page never widens.
    assert.match(css, /:is\(\.sct-cp-scroll, \.sct-cs-scroll, \.sct-cf-scroll\) \{\s*position: relative;/);
  });
});

describe("player links by identity", () => {
  test("Coaching finishes link only published players, each to the player named", async () => {
    for (const club of ["detroit-lions", "new-england-patriots", "buffalo-bills"]) {
      const { doc } = await page(`/team/${club}/coaching/`);
      const links = [...doc.querySelectorAll("#coaching-fantasy-premium a.sct-cf-who")];
      assert.ok(links.length > 0, club);
      for (const a of links) {
        const slug = slugOf(a.getAttribute("href"));
        assert.ok(published.has(slug), `${club}: ${slug} is published`);
      }
      // Anyone not linked has no published page by that name (or is ambiguous): never a guess.
      for (const s of doc.querySelectorAll("#coaching-fantasy-premium span.sct-cf-who")) assert.equal(s.closest("a"), null);
    }
    // Detroit's audit names, linked from the current season's row.
    const { doc } = await page("/team/detroit-lions/coaching/");
    const current = doc.querySelector("#coaching-fantasy-premium tr.is-current");
    const hrefs = [...current.querySelectorAll("a.sct-cf-who")].map((a) => slugOf(a.getAttribute("href")));
    assert.deepEqual(hrefs, ["jared-goff", "jahmyr-gibbs", "amon-ra-st-brown", "sam-laporta"]);
  });

  test("Usage links resolve by id: never an unpublished page", async () => {
    for (const club of ["detroit-lions", "indianapolis-colts", "philadelphia-eagles"]) {
      const { doc } = await page(`/team/${club}/usage/`);
      for (const a of doc.querySelectorAll("a.sct-player-link")) {
        const slug = slugOf(a.getAttribute("href"));
        assert.ok(published.has(slug), `${club}: ${a.textContent} -> ${slug} must be a published profile`);
      }
    }
  });

  test("Usage copy links each player's first mention, never inside a question or another link", async () => {
    const { doc } = await page("/team/detroit-lions/usage/");
    const answers = [...doc.querySelectorAll(".sct-faq-a")];
    const prose = doc.querySelectorAll(".sct-faq-a a.sct-prose-player, .sct-us-sit-card-body a.sct-prose-player");
    assert.ok(prose.length > 0, "the copy links players");
    for (const a of prose) assert.ok(published.has(slugOf(a.getAttribute("href"))));
    assert.equal(doc.querySelectorAll(".sct-faq-q a, a a").length, 0);
    for (const p of answers) {
      const seen = [...p.querySelectorAll("a.sct-prose-player")].map((a) => a.getAttribute("href"));
      assert.equal(new Set(seen).size, seen.length, "one link per player per answer");
    }
    // The FAQPage schema keeps the plain answers.
    const ld = [...doc.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent).join("");
    assert.doesNotMatch(ld, /sct-prose-player/);
  });

  test("Stats leaders were already linked by id (kept)", async () => {
    const { doc } = await page("/team/detroit-lions/stats/");
    const leaders = [...doc.querySelectorAll(".sct-sp-leaders a")].map((a) => slugOf(a.getAttribute("href")));
    assert.ok(leaders.length >= 1);
    for (const s of leaders) assert.ok(published.has(s));
  });
});

describe("the roster in one tap", () => {
  test("hub and the three tabs carry the Depth Chart tab's address in the header; the Depth Chart tab does not link itself", async () => {
    for (const club of ["detroit-lions", "kansas-city-chiefs"]) {
      for (const section of ["", "usage/", "coaching/", "stats/"]) {
        const { doc } = await page(`/team/${club}/${section}`);
        const tab = doc.querySelector("#depth-chart-tab");
        const link = doc.querySelector(".sct-tpb-roster-link");
        assert.ok(tab && link, `${club}/${section}`);
        assert.equal(link.getAttribute("href"), tab.getAttribute("href"));
        assert.equal(link.getAttribute("href"), `/team/${club}/depth-chart/`);
      }
      const { doc } = await page(`/team/${club}/depth-chart/`);
      assert.equal(doc.querySelector(".sct-tpb-roster-link"), null);
    }
    // Shown only where the header is narrower than the strip.
    assert.match(css, /\.sct \.sct-tpb-roster \{\s*display: none;/);
    assert.match(css, /@container tpb \(max-width: 679px\) \{\s*\.sct \.sct-tpb-roster \{\s*display: block;/);
  });
});
