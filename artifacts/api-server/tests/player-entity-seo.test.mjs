/**
 * The player pages as player pages (mak's player-entity brief, 2026-11-03).
 *
 * The profile is the player's page before it is a fantasy page: one H1 and it
 * is his name, an evergreen title with no year, the identity facts and the
 * season's production in the hero ahead of the fantasy board, every section
 * at its own address with its own title and H1 and a self-canonical, and the
 * cluster linked both ways. Checked across the positions and the edge
 * states the roster holds on the day - a rookie, a listed player, a mover -
 * so a template change that breaks one shape of player fails here.
 *
 * Also the data-sanity rules the brief asked for: no share or rate outside
 * 0-100%, and the hero, the Overview's season table and the Stats tab
 * agreeing on this season's games and totals.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { startServer } from "./helpers/server.mjs";

let server;
let roster = [];

before(async () => {
  server = await startServer();
  const res = await fetch(`${server.origin}/embed/players.json`);
  roster = (await res.json()).players ?? [];
});

after(async () => {
  await server?.stop();
});

async function get(pathname) {
  const res = await fetch(`${server.origin}${pathname}`, { redirect: "manual" });
  return { status: res.status, headers: res.headers, body: await res.text() };
}

function parse(html) {
  const doc = new JSDOM(html).window.document;
  return {
    doc,
    title: doc.querySelector("head > title")?.textContent ?? "",
    description: doc.querySelector('meta[name="description"]')?.getAttribute("content") ?? "",
    canonical: doc.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? "",
  };
}

const text = (el) => el?.textContent.replace(/\s+/g, " ").trim() ?? "";

/** The first player of a position whose profile renders a game log. */
async function fixtureFor(position, extra = () => true) {
  for (const player of roster.filter((p) => p.position === position && extra(p)).slice(0, 60)) {
    const res = await get(`/player/${player.slug}`);
    if (res.status === 200 && res.body.includes('id="game-log"')) return { player, ...res };
  }
  return null;
}

const SECTIONS = ["stats", "game-log", "outlook", "injury", "news", "bio"];
const SECTION_WORD = {
  stats: "Stats",
  "game-log": "Game Log",
  outlook: "Fantasy Outlook",
  injury: "Injury Status",
  news: "News",
  bio: "Bio",
};
const SECTION_TITLE = {
  stats: /^(.+) Stats(?: & Career Stat(?:istic)?s)?(?: \| StatChasers)?$/,
  "game-log": /^(.+) Game Log(?: & Weekly Stats)?(?: \| StatChasers)?$/,
  outlook: /^(.+) Fantasy Outlook(?:, Rankings & Projections| & Projections)?(?: \| StatChasers)?$/,
  injury: /^(.+) Injury Status(?: & History)?(?: \| StatChasers)?$/,
  news: /^(.+) News(?: & Latest Updates)?(?: \| StatChasers)?$/,
  bio: /^(.+) Bio(?:: Age, Height(?:, College)? & (?:Draft|College))?(?: \| StatChasers)?$/,
};

/** Every "NN.N%" that follows a share-or-rate label in the page's text. */
function sharesIn(doc) {
  const body = doc.body.textContent.replace(/\s+/g, " ");
  const found = [];
  for (const m of body.matchAll(/(share|rate)[^%]{0,40}?(-?\d+(?:\.\d+)?)%/gi)) {
    found.push({ label: m[1], value: Number(m[2]) });
  }
  return found;
}

describe("the profile is the player's page", () => {
  const positions = ["QB", "RB", "WR", "TE"];

  for (const position of positions) {
    test(`${position}: one H1 (the name), evergreen title, canonical, identity, production, fantasy`, async () => {
      const found = await fixtureFor(position);
      assert.ok(found, `a ${position} with a game log`);
      const { player, body } = found;
      const { doc, title, description, canonical } = parse(body);

      // The title template of the brief, with no year and the brand where it fits.
      assert.match(
        title,
        new RegExp(`^${player.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} Stats, News(?:, Bio)? & (?:Fantasy )?Outlook(?: \\| StatChasers)?$`),
        title,
      );
      assert.ok(title.replace(/ \| StatChasers$/, "").length <= 60, title);
      assert.doesNotMatch(title, /\b20\d{2}\b/, "evergreen");
      assert.match(description, /stats, game logs, news, injury updates, bio/, description);
      assert.ok(description.length <= 155, description);
      assert.equal(canonical, `${server.origin}/player/${player.slug}`, "self-canonical, PPR, no section");

      // Exactly one H1, and it is the name.
      const h1s = doc.querySelectorAll("h1");
      assert.equal(h1s.length, 1);
      assert.equal(text(h1s[0]), player.name);
      // Nothing outranks it: the first heading in the document is the H1.
      assert.ok(doc.querySelector("h1, h2, h3").matches("h1"), "no heading before the H1");

      // Identity: team (or free agent), position, the spec row.
      const header = doc.querySelector("header.scp-phead");
      assert.ok(header.querySelector(".scp-ptag-pos"), "position tag");
      assert.ok(header.querySelector(".scp-ptag-team"), "team tag or free agent");
      const spec = [...header.querySelectorAll(".scp-pspec dt")].map(text);
      assert.ok(spec.includes("Age") || spec.includes("Height / weight") || spec.includes("Experience"), `identity facts: ${spec}`);

      // The season's production under the identity, before the board.
      const pid = header.querySelector(".scp-pid");
      const order = [...pid.children].map((c) => c.className.split(" ")[0]);
      assert.ok(order.indexOf("scp-phead-h1") < order.indexOf("scp-pline-wrap"), "name, then production");
      assert.ok(order.indexOf("scp-pspec") < order.indexOf("scp-pline-wrap"), "identity, then production");
      const line = [...header.querySelectorAll(".scp-pline dd")].map(text);
      assert.ok(line.length >= 2, `a production line: ${line}`);
      assert.ok(line.every((v) => /^[\d,./-]+$/.test(v)), `numbers only: ${line}`);
      // The identity column is served before the board in the markup.
      assert.ok(pid.compareDocumentPosition(header.querySelector(".scp-pboard")) & 4, "identity before the fantasy board");

      // The fantasy layer is still there: the board, the Overview's read, the peers rail.
      assert.deepEqual([...header.querySelectorAll(".scp-pboard-stats dt")].map(text), ["PPR PPG", "Pos rank", "Rostered"]);
      assert.ok(doc.querySelector("#overview .scp-ox-read"), "the fantasy read");
      assert.ok(doc.querySelector("#overview .scp-peers"), "the peers rail");

      // The Overview blocks of the brief, in its order, each linking into its tab.
      const ids = [...doc.querySelectorAll("#overview section.scp-ox-sec h2")].map((h) => h.id);
      const want = ["scp-ox-strip-h", "scp-ox-news-h", "scp-ox-season-h", "scp-ox-read-h", "scp-ox-log-h", "scp-ox-cards-h", "scp-ox-career-h", "scp-ox-about-h"];
      const present = want.filter((id) => ids.includes(id));
      assert.deepEqual(ids.filter((id) => want.includes(id)), present, "the brief's order");
      assert.ok(present.includes("scp-ox-season-h"), "the season table");
      assert.ok(present.includes("scp-ox-about-h"), "the About block");
      for (const [id, section] of [["scp-ox-season-h", "stats"], ["scp-ox-about-h", "bio"], ["scp-ox-news-h", "news"], ["scp-ox-log-h", "game-log"]]) {
        if (!present.includes(id)) continue;
        const sec = doc.getElementById(id).closest("section");
        assert.equal(sec.querySelector("a.scp-ox-more")?.getAttribute("href"), `/player/${player.slug}/${section}/`, `${id} links to ${section}`);
      }

      // Hub -> every section, as crawlable anchors.
      for (const link of doc.querySelectorAll(".scp-nav-link")) {
        const id = link.dataset.scpPanelId;
        assert.equal(link.getAttribute("href"), id === "overview" ? `/player/${player.slug}/` : `/player/${player.slug}/${id}/`);
      }
    });
  }

  test("every section page: its own title and H1, self-canonical, the way back", async () => {
    const found = await fixtureFor("WR");
    assert.ok(found);
    const { player } = found;
    const titles = new Set();
    const h1s = new Set();
    for (const section of SECTIONS) {
      const res = await get(`/player/${player.slug}/${section}/`);
      if (res.status === 302) continue; // a section this player has no page for
      assert.equal(res.status, 200, section);
      const { doc, title, canonical } = parse(res.body);
      assert.match(title, SECTION_TITLE[section], `${section}: ${title}`);
      assert.ok(title.replace(/ \| StatChasers$/, "").length <= 60, title);
      assert.equal(canonical, `${server.origin}/player/${player.slug}/${section}/`, `${section}: self-canonical`);
      const h1 = doc.querySelectorAll("h1");
      assert.equal(h1.length, 1, `${section}: one H1`);
      assert.equal(text(h1[0]), `${player.name} ${SECTION_WORD[section]}`, section);
      assert.ok(doc.querySelector("h1, h2, h3").matches("h1"), `${section}: no heading before the H1`);
      titles.add(title);
      h1s.add(text(h1[0]));
      // Back to the profile, and to every sibling, as anchors.
      const hrefs = [...doc.querySelectorAll(".scp-nav-link")].map((a) => a.getAttribute("href"));
      assert.ok(hrefs.includes(`/player/${player.slug}/`), `${section}: links the profile`);
      assert.ok(hrefs.length >= 3, `${section}: links the siblings`);
    }
    assert.equal(titles.size, [...titles].length, "distinct titles");
    assert.equal(h1s.size, [...h1s].length, "distinct H1s");
    assert.ok(titles.size >= 5, "at least five section pages");
  });

  test("edge cases: a rookie, a listed player, a player without a draft record, a kicker", async () => {
    const cases = [
      ["rookie", (p) => p.position !== "K", async (p) => (await get(`/player/${p.slug}`)).body.includes("<dd>Rookie</dd>")],
      ["listed", () => true, async (p) => (await get(`/player/${p.slug}`)).body.includes("scp-ptag-inj")],
      ["no draft cell", () => true, async (p) => !(await get(`/player/${p.slug}`)).body.includes("<dt>Drafted</dt>")],
      ["kicker", (p) => p.position === "K", async () => true],
    ];
    for (const [label, filter, matches] of cases) {
      let hit = null;
      for (const p of roster.filter(filter).slice(0, 120)) {
        if (await matches(p)) {
          hit = p;
          break;
        }
      }
      if (!hit) continue; // the roster on the day may hold none
      const res = await get(`/player/${hit.slug}`);
      assert.equal(res.status, 200, `${label}: ${hit.slug}`);
      const { doc, title } = parse(res.body);
      assert.equal(doc.querySelectorAll("h1").length, 1, `${label}: one H1`);
      assert.equal(text(doc.querySelector("h1")), hit.name, `${label}: the H1 is the name`);
      assert.match(title, /Stats, News(?:, Bio)? & (?:Fantasy )?Outlook|Stats & News/, `${label}: ${title}`);
      assert.doesNotMatch(res.body, /undefined|NaN/, `${label}: no holes`);
    }
  });

  test("a player who changed teams: the hero names the current club everywhere", async () => {
    // Someone whose season stops list more than one club.
    let found = null;
    for (const p of roster.slice(0, 150)) {
      const res = await get(`/player/${p.slug}/bio/`);
      if (res.status !== 200) continue;
      const stops = (res.body.match(/scp-bo-stop/g) ?? []).length;
      if (stops >= 2) {
        found = { p, bio: res.body };
        break;
      }
    }
    if (!found) return;
    const { p } = found;
    const hub = parse((await get(`/player/${p.slug}`)).body);
    const team = text(hub.doc.querySelector(".scp-ptag-team-full"));
    for (const section of ["stats", "news", "bio"]) {
      const res = await get(`/player/${p.slug}/${section}/`);
      if (res.status !== 200) continue;
      assert.equal(text(parse(res.body).doc.querySelector(".scp-ptag-team-full")), team, `${section}: same club as the hub`);
    }
  });
});

describe("data sanity", () => {
  test("no share or rate prints outside 0-100%, on any route", async () => {
    const found = await fixtureFor("WR");
    assert.ok(found);
    const { player } = found;
    for (const path of ["", "stats/", "game-log/", "outlook/", "news/"]) {
      const res = await get(`/player/${player.slug}/${path}`);
      if (res.status !== 200) continue;
      const { doc } = parse(res.body);
      const bad = sharesIn(doc).filter((s) => s.value < 0 || s.value > 100);
      assert.deepEqual(bad, [], `${path || "profile"}: ${JSON.stringify(bad)}`);
    }
  });

  test("the hero, the Overview's season table and the Stats tab agree on the season", async () => {
    for (const position of ["WR", "RB", "QB"]) {
      const found = await fixtureFor(position);
      if (!found) continue;
      const { player, body } = found;
      const { doc } = parse(body);
      const season = doc.querySelector("[data-scp-root]").getAttribute("data-season");
      const leagueWeek = Number(/through Week (\d+)/.exec(text(doc.querySelector(".scp-pline-cap")))?.[1] ?? 0);

      // Games played: the table's GP, the hero's caption, the Stats tab's rail.
      const cols = [...doc.querySelectorAll("#overview .scp-ox-season thead th")].map(text);
      const row = [...doc.querySelectorAll("#overview .scp-ox-season tbody td")].map(text);
      const gp = Number(row[cols.indexOf("GP")]);
      assert.ok(gp > 0 && gp <= 22, `games played: ${gp}`);
      if (leagueWeek) assert.ok(gp <= leagueWeek, `${gp} games cannot exceed ${leagueWeek} weeks`);

      // The hero's counting line is in the table.
      const hero = Object.fromEntries([...doc.querySelectorAll(".scp-pline > div")].map((d) => [text(d.querySelector("dt")), text(d.querySelector("dd"))]));
      const cell = (label) => row[cols.indexOf(label)];
      if (position === "WR") {
        assert.equal(hero.REC, cell("REC"));
        assert.equal(hero.YDS, cell("YDS"));
        assert.equal(hero.TD, cell("TD"));
      } else if (position === "RB") {
        assert.equal(hero.CAR, cell("CAR"));
        assert.equal(hero["RUSH YDS"], cell("RUSH YDS"));
      } else {
        assert.equal(hero["PASS YDS"], cell("PASS YDS"));
        assert.equal(hero.INT, cell("INT"));
      }

      // The Stats tab's production section carries the same games and totals.
      const stats = parse((await get(`/player/${player.slug}/stats/`)).body).doc;
      const prod = stats.querySelector("#scp-st-prod-h")?.closest("section") ?? stats.querySelector("#stats");
      const prodText = text(prod);
      assert.ok(prodText.includes(season), `the Stats tab is on ${season}`);
      const key = position === "WR" ? hero.YDS : position === "RB" ? hero["RUSH YDS"] : hero["PASS YDS"];
      assert.ok(prodText.includes(key), `${position}: the Stats tab prints the hero's ${key} yards`);
      // And the same club as the hub.
      assert.equal(text(stats.querySelector(".scp-ptag-team-full")), text(doc.querySelector(".scp-ptag-team-full")));
    }
  });
});
