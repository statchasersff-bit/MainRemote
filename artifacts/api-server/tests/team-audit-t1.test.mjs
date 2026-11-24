/**
 * Team audit, task 1 (2026-11-24): finishing WEB-044 on Coaching.
 *
 * 1. Fantasy Finishes paints surnames on phones. Where two players in one
 *    table would read alike ("St. Brown" / "Brown" on Detroit's: Amon-Ra
 *    St. Brown and Marquise Brown under Drew Petzing), the markup marks them
 *    so phones keep the initial, or the full name when the initial clashes
 *    too. Every row counts, the ones behind Show all included.
 * 2. A finish links only when that season's game logs put the player with
 *    that club: a namesake who plays for the club today is no match.
 *
 * Assertions are about structure and identity across all 32 clubs, not this
 * week's numbers.
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

const css = fs.readFileSync(path.join(APP_DIR, "public", "team.css"), "utf8");
const slugToId = new Map(
  Object.entries(JSON.parse(fs.readFileSync(path.join(APP_DIR, "data", "player", "player_slugs.json"), "utf8")).players).map(
    ([id, v]) => [v.slug, id],
  ),
);

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
  return new JSDOM(await res.text()).window.document;
}

async function clubSlugs() {
  const doc = await page("/team/");
  const slugs = new Set();
  for (const a of doc.querySelectorAll("a[href]")) {
    const m = a.getAttribute("href").match(/\/team\/([a-z0-9-]+)\/$/);
    if (m) slugs.add(m[1]);
  }
  return [...slugs];
}

const surnameKey = (last) =>
  (last.replace(/\s+(jr\.?|sr\.?|ii|iii|iv|v)$/i, "").split(" ").pop() ?? "").toLowerCase().replace(/[^a-z]/g, "");

/** What a phone paints for a finish name (team.css, 560px and under). */
function painted(who) {
  const initial = who.querySelector(".sct-nm-i")?.textContent ?? "";
  const last = who.querySelector(".sct-nm-last")?.textContent ?? who.textContent;
  if (who.classList.contains("is-nm-full")) return who.getAttribute("title");
  if (who.classList.contains("is-nm-initial")) return `${initial}. ${last}`;
  return last;
}

describe("Fantasy Finishes names on phones", () => {
  test("Detroit: Amon-Ra St. Brown and Marquise Brown keep their initials; unclashed names keep the surname", async () => {
    const doc = await page("/team/detroit-lions/coaching/");
    const who = [...doc.querySelectorAll("#coaching-fantasy-premium .sct-cf-who")];
    const byName = (n) => who.filter((w) => w.getAttribute("title") === n);
    const stBrown = byName("Amon-Ra St. Brown");
    assert.ok(stBrown.length > 0, "Amon-Ra St. Brown is in Detroit's finishes");
    for (const w of stBrown) assert.equal(painted(w), "A. St. Brown");
    // Petzing's 2023 Cardinals: Marquise Brown, when the history still carries him.
    for (const w of byName("Marquise Brown")) assert.equal(painted(w), "M. Brown");
    for (const w of byName("Jared Goff")) assert.equal(painted(w), "Goff");
  });

  test("all 32 clubs: no two players in one finishes table paint alike on phones", async () => {
    const slugs = await clubSlugs();
    assert.equal(slugs.length, 32);
    for (const slug of slugs) {
      const doc = await page(`/team/${slug}/coaching/`);
      for (const table of doc.querySelectorAll(".sct-cf-table")) {
        const groups = new Map();
        for (const w of table.querySelectorAll(".sct-cf-who")) {
          const last = w.querySelector(".sct-nm-last")?.textContent;
          if (!last) continue;
          const key = surnameKey(last);
          const g = groups.get(key) ?? new Map();
          g.set(w.getAttribute("title"), { label: painted(w), marked: w.matches(".is-nm-initial, .is-nm-full") });
          groups.set(key, g);
        }
        for (const g of groups.values()) {
          if (g.size < 2) continue;
          const labels = [...g.values()].map((v) => v.label);
          assert.equal(new Set(labels).size, labels.length, `${slug}: ${[...g.keys()].join(" / ")} paint as ${labels.join(" / ")}`);
          for (const [name, v] of g) assert.ok(v.marked, `${slug}: ${name} keeps more than the surname on phones`);
        }
      }
    }
  });

  test("CSS: phones show the initial or the full name for marked names", () => {
    assert.match(css, /\.sct-cf-who:is\(\.is-nm-initial, \.is-nm-full\) \.sct-nm-first \{\s*display: inline;/);
    assert.match(css, /\.sct-cf-who\.is-nm-initial \.sct-nm-i::after \{\s*content: "\.";/);
  });
});

describe("Fantasy Finishes links by the season's game logs", () => {
  test("every linked finish has a game-log row for that club and season", async () => {
    const CLUB = {
      Cardinals: "ARI", Falcons: "ATL", Ravens: "BAL", Bills: "BUF", Panthers: "CAR", Bears: "CHI", Bengals: "CIN",
      Browns: "CLE", Cowboys: "DAL", Broncos: "DEN", Lions: "DET", Packers: "GB", Texans: "HOU", Colts: "IND",
      Jaguars: "JAX", Chiefs: "KC", Raiders: "LV", Chargers: "LAC", Rams: "LAR", Dolphins: "MIA", Vikings: "MIN",
      Patriots: "NE", Saints: "NO", Giants: "NYG", Jets: "NYJ", Eagles: "PHI", Steelers: "PIT", "49ers": "SF",
      Seahawks: "SEA", Buccaneers: "TB", Titans: "TEN", Commanders: "WAS",
    };
    const ALIAS = { OAK: "LV", SD: "LAC", STL: "LAR", LA: "LAR", WSH: "WAS" };
    const logs = new Map();
    const logFor = (season) => {
      if (!logs.has(season)) {
        const file = path.join(APP_DIR, "data", "player", "game_logs", `${season}.json`);
        logs.set(season, fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {});
      }
      return logs.get(season);
    };
    let checked = 0;
    for (const slug of ["detroit-lions", "arizona-cardinals", "chicago-bears", "new-england-patriots"]) {
      const doc = await page(`/team/${slug}/coaching/`);
      for (const row of doc.querySelectorAll(".sct-cf-table tbody tr")) {
        const club = row.querySelector(".sct-cf-stop-club")?.firstChild?.textContent?.trim();
        const year = row.querySelector(".sct-cf-stop-year")?.textContent;
        for (const a of row.querySelectorAll("a.sct-cf-who")) {
          const player = a.getAttribute("href").match(/\/nfl\/players\/([^/]+)\/$/)?.[1];
          const id = slugToId.get(player);
          const clubs = new Set((logFor(year)[id] ?? []).map((r) => ALIAS[r.team] ?? r.team));
          assert.ok(clubs.has(CLUB[club]), `${slug}: ${a.getAttribute("title")} (${player}) with ${club} in ${year}`);
          checked++;
        }
      }
    }
    assert.ok(checked > 20, `checked ${checked} links`);
  });
});
