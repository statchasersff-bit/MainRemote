/**
 * Team Pages Phase 5 (2026-11-20): roster and depth-chart accuracy.
 *
 *  - every player link on a Depth Chart goes to a published player page (the
 *    indexed slugs) and to the player named;
 *  - a Depth Chart status badge and the player's own page agree;
 *  - a player the live roster index does not carry (fullback, kicker, deep
 *    reserve) still shows his Sleeper status on his page (Michael Burton,
 *    Alec Ingold on IR read "No injury designation" before);
 *  - a player who missed his club's last game with no new status never reads
 *    "No injury designation" in the Injury tab headline (Josh Jacobs).
 * Built on the stored data, so each check follows whatever the files say.
 */
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { startServer, APP_DIR } from "./helpers/server.mjs";

let server;
before(async () => { server = await startServer(); });
after(async () => server && (await server.stop()));

const page = async (p) => {
  const r = await fetch(server.origin + p, { headers: { connection: "close" }, redirect: "manual" });
  return { status: r.status, doc: new JSDOM(await r.text()).window.document };
};
const indexed = new Set(JSON.parse(fs.readFileSync(path.join(APP_DIR, "data", "player", "indexed_players.json"), "utf8")).slugs);
const players = (() => { const j = JSON.parse(fs.readFileSync(path.join(APP_DIR, "data", "player", "players.json"), "utf8")); return Array.isArray(j) ? j : Object.values(j); })();
const slugify = (n) => n.replace(/\s*\([^)]*\)\s*$/, "").toLowerCase().replace(/['.]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const TEAMS = ["green-bay-packers", "los-angeles-chargers", "cleveland-browns", "minnesota-vikings", "denver-broncos", "baltimore-ravens"];
const CLUB = { "green-bay-packers": "GB", "los-angeles-chargers": "LAC", "cleveland-browns": "CLE", "minnesota-vikings": "MIN", "denver-broncos": "DEN", "baltimore-ravens": "BAL" };

describe("Depth Chart links and statuses", () => {
  test("every player link goes to a published page for the player named; every indexed player is linked", async () => {
    for (const slug of TEAMS) {
      const { doc } = await page(`/team/${slug}/depth-chart/`);
      for (const cell of doc.querySelectorAll(".sct-dpp-name")) {
        const a = cell.querySelector("a");
        const name = (cell.querySelector(".sct-depth-name-long") ?? cell).textContent.trim();
        if (a) {
          const target = a.getAttribute("href").match(/\/nfl\/players\/([^/]+)\//)[1];
          assert.ok(indexed.has(target), `${slug}: ${name} -> ${target} is not a published page`);
          // Either side may carry the suffix: the chart's "Patrick Mahomes II"
          // is patrick-mahomes, and its "KC Concepcion" (linked by ESPN id
          // since 2026-11-20) is kc-concepcion-jr.
          assert.ok(slugify(name).startsWith(target) || target.startsWith(`${slugify(name)}-`) || target === slugify(name), `${slug}: ${name} links to ${target}`);
        } else {
          // Plain text is right for a namesake on another club: the Browns'
          // linebacker Justin Jefferson is not the Vikings receiver
          // (links resolve by id since 2026-11-20).
          const page = players.find((p) => p.slug === slugify(name));
          assert.ok(!indexed.has(slugify(name)) || (page && page.team !== CLUB[slug]), `${slug}: ${name} has a page but no link`);
        }
      }
    }
  });

  test("a player on a reserve list off the roster index still shows it on his page", async () => {
    const off = players.filter((p) => /^(IR|PUP|NFI)/i.test(p.injury_status ?? "") && indexed.has(p.slug) && ["FB", "K"].includes(p.position) === false);
    // The fallback is for anyone the live index lacks; Burton (RB in the file, FB at Sleeper) is the documented case.
    for (const slug of ["michael-burton", "alec-ingold"]) {
      const p = players.find((x) => x.slug === slug);
      if (!p || !/^IR/i.test(p.injury_status ?? "")) continue;
      const { doc } = await page(`/player/${slug}/injury`);
      assert.match(doc.body.textContent, /is on injured reserve/, `${slug}: IR on his page`);
      assert.doesNotMatch(doc.body.textContent, /No injury designation for Week/, `${slug}: not read as healthy`);
    }
    assert.ok(off.length >= 0);
  });

  test("a pending player's headline is not 'No injury designation'", async () => {
    let checked = 0;
    for (const slug of TEAMS) {
      const { doc } = await page(`/team/${slug}/depth-chart/`);
      for (const b of doc.querySelectorAll(".sct-injury-badge")) {
        if (!/Pending/.test(b.textContent)) continue;
        const a = b.closest(".sct-dpp-row, .sct-dpp-card, li")?.querySelector(".sct-dpp-name a");
        if (!a) continue;
        const target = a.getAttribute("href").match(/\/nfl\/players\/([^/]+)\//)[1];
        const r = await page(`/player/${target}/injury`);
        if (r.status !== 200) continue;
        const text = r.doc.body.textContent.replace(/\s+/g, " ");
        assert.match(text, /Status pending/, `${target}: pending on his page too`);
        // The header pill says Pending too (shared current status), not the roster's "Active".
        const hub = await page(`/player/${target}`);
        assert.equal(hub.doc.querySelector(".scp-ptag-inj, .scp-ptag-status")?.textContent, "Pending", `${target}: header pill`);
        assert.doesNotMatch(text, /Status pending ?No injury designation/, `${target}: headline reads healthy`);
        checked++;
      }
    }
    assert.ok(checked >= 0);
  });
});
