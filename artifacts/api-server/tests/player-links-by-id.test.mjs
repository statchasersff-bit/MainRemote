/**
 * Player links on team and matchup pages are resolved by id (mak, 2026-11-20).
 *
 * The Browns drafted a linebacker named Justin Jefferson in 2026 and the
 * Panthers carry a practice-squad corner named DeVonta Smith. Linked by name,
 * both went to the receivers' pages. The rules this pins:
 *
 *  - a row with an id links only when that id is a published player, and
 *    never falls back to its name;
 *  - a bare name links only to a player of the row's club and position group;
 *  - the real players still link on their own clubs' pages and games, a
 *    suffix the source drops ("Kenneth Walker") still finds the player, and a
 *    player who changed clubs links from both clubs' games.
 */
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { startServer } from "./helpers/server.mjs";
import { importModule, cleanupBundles } from "./helpers/bundle.mjs";

let server;
let links;
before(async () => {
  server = await startServer();
  links = await importModule("lib/team/links");
});
after(async () => {
  if (server) await server.stop();
  await cleanupBundles();
});

const page = async (p) => {
  const r = await fetch(server.origin + p, { headers: { connection: "close" } });
  assert.equal(r.status, 200, p);
  return new JSDOM(await r.text()).window.document;
};
const anchorsTo = (doc, slug) => [...doc.querySelectorAll("a[href]")].filter((a) => new RegExp(`/nfl/players/${slug}/`).test(a.getAttribute("href")));
const mentions = (doc, name) => doc.body.textContent.includes(name);

describe("resolvePlayerSlug", () => {
  test("an id decides, and an unknown id never falls back to the name", () => {
    // The Browns linebacker: GSIS from the contracts and draft, ESPN from the depth chart.
    assert.equal(links.resolvePlayerSlug("Justin Jefferson", { gsisId: "00-0041075" }), null);
    assert.equal(links.resolvePlayerSlug("Justin Jefferson", { espnId: "5150249", team: "MIN", pos: "WR" }), null);
    // The Panthers corner.
    assert.equal(links.resolvePlayerSlug("DeVonta Smith", { gsisId: "00-0041153" }), null);
    // The receivers, by their own ids.
    assert.equal(links.resolvePlayerSlug("Justin Jefferson", { gsisId: "00-0036322" }), "justin-jefferson");
    assert.equal(links.resolvePlayerSlug("Justin Jefferson", { espnId: "4262921" }), "justin-jefferson");
    assert.equal(links.resolvePlayerSlug("Justin Jefferson", { sleeperId: "6794" }), "justin-jefferson");
    assert.equal(links.resolvePlayerSlug("Justin Jefferson", { gameKey: "espn:4262921" }), "justin-jefferson");
    // Two ids naming two different players: neither.
    assert.equal(links.resolvePlayerSlug("Justin Jefferson", { sleeperId: "6794", gsisId: "00-0036912" }), null);
  });

  test("a bare name links only inside its club and position group", () => {
    assert.equal(links.resolvePlayerSlug("Justin Jefferson", { team: "CLE", pos: "LB" }), null);
    assert.equal(links.resolvePlayerSlug("Justin Jefferson", { team: "CLE" }), null);
    assert.equal(links.resolvePlayerSlug("Justin Jefferson", {}), null);
    assert.equal(links.resolvePlayerSlug("Justin Jefferson", { team: "MIN", pos: "LB" }), null);
    assert.equal(links.resolvePlayerSlug("Justin Jefferson", { team: "MIN", pos: "WR" }), "justin-jefferson");
    assert.equal(links.resolvePlayerSlug("Justin Jefferson", { team: "min" }), "justin-jefferson");
    assert.equal(links.resolvePlayerSlug("DeVonta Smith", { team: "CAR", pos: "CB" }), null);
    assert.equal(links.resolvePlayerSlug("DeVonta Smith", { team: ["PHI", "WAS"] }), "devonta-smith");
  });

  test("a dropped or added suffix still finds the player on his club", () => {
    assert.equal(links.resolvePlayerSlug("Kenneth Walker", { team: "KC", pos: "RB" }), "kenneth-walker-iii");
    assert.equal(links.resolvePlayerSlug("Kenneth Walker III", { team: "KC" }), "kenneth-walker-iii");
    // Not on another club, and not the free-agent receiver of the same name.
    assert.equal(links.resolvePlayerSlug("Kenneth Walker", { team: "NYJ" }), null);
  });

  test("a past game matches the club he played for that week", () => {
    // Seattle in 2025, Kansas City now.
    assert.equal(links.resolvePlayerSlug("Kenneth Walker III", { team: "SEA" }), null);
    assert.equal(links.resolvePlayerSlug("Kenneth Walker III", { team: "SEA", game: { season: 2025, week: 16 } }), "kenneth-walker-iii");
  });

  test("the recovered crosswalk covers indexed players the Bio build has not reached", () => {
    // Matt Hibner (BAL TE): ESPN id from the depth chart's headshot.
    assert.equal(links.resolvePlayerSlug("Matthew Hibner", { espnId: "4432260" }), "matt-hibner");
  });
});

describe("team pages", () => {
  test("Browns: the linebacker Justin Jefferson is plain text on the depth chart, contracts and draft", async () => {
    const depth = await page("/team/cleveland-browns/depth-chart/");
    assert.ok(mentions(depth, "Justin Jefferson"), "listed on the depth chart");
    assert.equal(anchorsTo(depth, "justin-jefferson").length, 0, "depth chart");
    const hub = await page("/team/cleveland-browns/");
    const contract = [...hub.querySelectorAll(".sct-ct-name")].filter((n) => n.textContent === "Justin Jefferson");
    const draft = [...hub.querySelectorAll(".sct-dr-name")].filter((n) => n.textContent === "Justin Jefferson");
    assert.ok(contract.length >= 1, "on the contracts sheet");
    assert.ok(draft.length >= 1, "in the draft class");
    for (const n of [...contract, ...draft]) assert.equal(n.tagName, "SPAN", `${n.className} is not a link`);
    assert.equal(anchorsTo(hub, "justin-jefferson").length, 0, "hub");
  });

  test("Panthers: the corner DeVonta Smith and the 2022 linebacker Brandon Smith are plain text", async () => {
    const hub = await page("/team/carolina-panthers/");
    const smith = [...hub.querySelectorAll(".sct-ct-name")].filter((n) => n.textContent === "DeVonta Smith");
    assert.ok(smith.length >= 1, "on the contracts sheet");
    for (const n of smith) assert.equal(n.tagName, "SPAN");
    assert.equal(anchorsTo(hub, "devonta-smith").length, 0);
    assert.equal(anchorsTo(hub, "brandon-smith").length, 0);
  });

  test("Vikings and Eagles: the receivers still link from their own clubs", async () => {
    for (const [club, slug] of [["minnesota-vikings", "justin-jefferson"], ["philadelphia-eagles", "devonta-smith"]]) {
      for (const p of [`/team/${club}/`, `/team/${club}/depth-chart/`]) {
        const doc = await page(p);
        assert.ok(anchorsTo(doc, slug).length >= 1, `${p} links ${slug}`);
      }
    }
  });

  test("a suffix the chart prints and the dictionary does not still links, by id", async () => {
    const doc = await page("/team/kansas-city-chiefs/depth-chart/");
    const a = anchorsTo(doc, "patrick-mahomes");
    assert.ok(a.length >= 1, "Patrick Mahomes II links");
  });
});

describe("matchup pages", () => {
  test("Browns-Jets: the linebacker Justin Jefferson is plain text", async () => {
    const doc = await page("/nfl/cleveland-browns-vs-new-york-jets/2026-week-5/");
    assert.ok(mentions(doc, "Justin Jefferson"), "he is in the box score");
    assert.equal(anchorsTo(doc, "justin-jefferson").length, 0);
  });

  test("the Vikings receiver still links on a Vikings game", async () => {
    const doc = await page("/nfl/green-bay-packers-vs-minnesota-vikings/2026-week-1/");
    const a = anchorsTo(doc, "justin-jefferson");
    assert.ok(a.length >= 1, "linked");
    for (const x of a) assert.match(x.textContent, /Jefferson/);
  });

  test("a player who changed clubs links from both clubs' games", async () => {
    for (const p of ["/nfl/los-angeles-rams-vs-seattle-seahawks/2025-week-16/", "/nfl/denver-broncos-vs-kansas-city-chiefs/2026-week-1/"]) {
      const doc = await page(p);
      assert.ok(anchorsTo(doc, "kenneth-walker-iii").length >= 1, `${p} links Kenneth Walker III`);
    }
  });
});
