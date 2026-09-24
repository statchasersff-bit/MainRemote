/**
 * RB handcuff rankings regression tests.
 *
 * Three halves, like the other tools' suites plus one. The engine is asserted
 * against the last board the standalone app published
 * (tests/fixtures/rb-handcuffs-snapshot-2026-08-17.json): run on that board's
 * own pairings, with no current statuses, it must give back its Backfield
 * Opportunity scores and ranks. It gave back every score, rank and badge until
 * Player Quality moved to the advanced stats table's grades (2026-09-24); the
 * other pillars, and path through the starter's Player Quality, moved with it. The served
 * HTML is asserted with no JavaScript run, because the point of the port is
 * that the board arrives complete. Then the real bundle is run against that
 * HTML in jsdom, because the weights, sorting, the open rows, compare and the
 * card are the app's behaviour and have to survive the move out of React.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";
import { startServer } from "./helpers/server.mjs";
import { importModule, cleanupBundles } from "./helpers/bundle.mjs";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (...parts) => JSON.parse(await readFile(path.join(APP_DIR, ...parts), "utf8"));
const SNAPSHOT = await readJson("tests", "fixtures", "rb-handcuffs-snapshot-2026-08-17.json");

let server;
/** This week's board, as the server builds it; its first backup. */
let BOARD;
let TOP;

before(async () => {
  server = await startServer();
  const data = await importModule("lib/rb-handcuffs/handcuffs-data");
  BOARD = data.getHandcuffBoard();
  TOP = BOARD.players[0];
});

after(async () => {
  await server?.stop();
  await cleanupBundles();
});

function rawGet(pathname, headers = {}) {
  const url = new URL(pathname, server.origin);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: "GET", headers },
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

async function page(pathname) {
  const res = await rawGet(pathname);
  return { ...res, doc: new JSDOM(res.body).window.document };
}

/* ------------------------------------------------------------ pure modules */

describe("the model", () => {
  let data;
  let recompute;
  let build;
  let stats;

  before(async () => {
    data = await importModule("lib/rb-handcuffs/handcuffs-data");
    recompute = await importModule("lib/rb-handcuffs/recompute");
    build = await importModule("lib/rb-handcuffs/engine/build");
    stats = await importModule("lib/rb-handcuffs/engine/stats");
  });

  async function engineOn(pairings, extra = {}) {
    return build.buildBoard({
      stats: stats.mergeStats((await readJson("data", "rb-handcuffs", "rb_advanced_stats_2025.json")).rows),
      injuries: stats.parseInjuries(await readJson("data", "rb-handcuffs", "rb_injuries.json")),
      pairings,
      current: null,
      statusFresh: false,
      curation: await readJson("data", "rb-handcuffs", "curation.json"),
      ...extra,
    });
  }

  test("on the published board's pairings, the engine gives back its Backfield Opportunity", async () => {
    const curation = await readJson("data", "rb-handcuffs", "curation.json");
    const out = await engineOn(
      SNAPSHOT.items.map((p) => ({ team: p.team, starter: p.starterName, backup: p.playerName })),
      // Scored at the app's weights, which that board was published at.
      { curation, weights: recompute.APP_WEIGHTS },
    );
    assert.equal(out.length, SNAPSHOT.items.length);
    for (const p of out) {
      const was = SNAPSHOT.items.find((x) => x.playerName === p.playerName);
      // Player Quality is the advanced stats table's grades now, and Path to
      // Opportunity reads the starter's; Backfield Opportunity reads neither.
      for (const key of ["contingentUpsideScore", "contingentUpsideRank"]) {
        assert.equal(p[key], was[key], `${p.playerName} ${key}`);
      }
    }
  });

  test("a fresh injury status on the starter moves the backup's path", async () => {
    const pair = [{ team: "LAR", starter: "Kyren Williams", backup: "Blake Corum" }];
    const [healthy] = await engineOn(pair);
    const current = new Map([["kyren williams", { age: null, injuryStatus: "Out" }]]);
    const [stale] = await engineOn(pair, { current, statusFresh: false });
    const [out] = await engineOn(pair, { current, statusFresh: true });
    assert.equal(stale.pathToOpportunityDetail.components.starterDurabilityHistoryRisk.score,
      healthy.pathToOpportunityDetail.components.starterDurabilityHistoryRisk.score, "a stale status counts for nothing");
    assert.ok(
      out.pathToOpportunityDetail.components.starterDurabilityHistoryRisk.score >
        healthy.pathToOpportunityDetail.components.starterDurabilityHistoryRisk.score,
      "a fresh Out raises the starter's risk",
    );
    assert.equal(out.starterInjuryStatus, "Out");
  });

  test("a curated note only applies while it describes the pairing", async () => {
    const [same] = await engineOn([{ team: "LAR", starter: "Kyren Williams", backup: "Blake Corum" }]);
    assert.match(same.notes, /Kyren Williams/);
    const [moved] = await engineOn([{ team: "LAR", starter: "Somebody Else", backup: "Blake Corum" }]);
    assert.equal(moved.notes, null, "a different starter means the note is out of date");
  });

  test("this week's board: one handcuff per team, straight from the depth charts", async () => {
    const depth = await readJson("data", "rb-handcuffs", "depth.json");
    const expected = Object.values(depth.teams).filter((t) => t.rb2).length;
    assert.equal(BOARD.players.length, expected);
    for (const p of BOARD.players) {
      const chart = Object.entries(depth.teams).find(([, t]) => t.rb2 === p.playerName);
      assert.ok(chart, `${p.playerName} is an RB2 this week`);
      assert.equal(p.starterName, chart[1].rb1, `${p.playerName} is behind his RB1`);
    }
    assert.equal(BOARD.updatedAt, new Date(depth.generated_at).toISOString());
  });

  test("the board is ranked the way the bundle re-ranks it", () => {
    const scores = recompute.recomputeScores(BOARD.players.map(data.recomputeInput), recompute.DEFAULT_WEIGHTS);
    assert.deepEqual(scores, BOARD.players.map((p) => p.handcuffScore));
    assert.deepEqual(BOARD.players.map((p) => p.rank), BOARD.players.map((_, i) => i + 1));
  });

  test("statuses a week and more old stop counting", () => {
    const later = new Date(new Date(BOARD.updatedAt).getTime() + 9 * 24 * 60 * 60 * 1000);
    assert.equal(data.getHandcuffBoard(later).statusFresh, false);
    assert.equal(data.getHandcuffBoard(new Date(BOARD.updatedAt)).statusFresh, true);
  });

  test("Player Quality reads the last six games played, never week 18", () => {
    const line = (week, extra = {}) => ({
      week, team: "NE", carries: 10, rushYards: 40, targets: 2, receptions: 2, recYards: 16, recYac: 8, fumbles: 0,
      pfrCarries: 10, ybc: 20, yac: 20, broken: 1, pbpRushes: 10, r10: 1, r15: 0, r20: 0, r30: 0,
      longest: 12, longestTd: null, ...extra,
    });
    const back = (team, games) => ({ gsisId: "00-1", playerId: "1", playerName: "A Back", team, games });
    const [row] = stats.lastGames([
      [back("NE", [
        line(10), line(11, { rushYards: 999 }), // the seventh and eighth most recent: out
        line(12), line(14), line(15),
        line(16, { carries: 0, targets: 0, rushYards: 0, receptions: 0, recYards: 0 }), // special teams only
        line(17),
        line(18, { rushYards: 131, longest: 56 }), // week 18: never read
      ])],
      [back("KC", [line(1, { team: "KC", longest: 30, longestTd: 30 }), line(2, { team: "KC", receptions: 0, recYards: 0 })])],
    ]);
    // 2025 weeks 12, 14, 15, 17 and 2026 weeks 1, 2.
    assert.equal(row.team, "KC", "the latest team");
    assert.equal(row.games, 6);
    assert.equal(row.rushAttempts, 60);
    assert.equal(row.rushYards, 240, "neither week 11 nor week 18");
    assert.equal(row.longestRush, 30, "week 18's 56 is not his longest");
    assert.equal(row.longestRushTouchdown, 30);
    assert.equal(row.receptions, 10);
    assert.equal(row.yardsPerReception, 8);
    assert.equal(row.explosiveRunPct, 10);
    assert.equal(row.tackleEludedRate, (6 / 70) * 100);
  });

  test("Player Quality is YPC 30, Y/R 30, YAC/att 10, elude 5, fumbles 5, explosiveness 20", async () => {
    const pq = await importModule("lib/rb-handcuffs/engine/player-quality");
    const table = await importModule("lib/player-stats/scores/rbCompositeScores");
    const pct = await importModule("lib/player-stats/scores/percentiles");
    const rbRows = (await readJson("data", "rb-handcuffs", "rb_advanced_stats_2025.json")).rows.filter((r) => r.position === "RB");
    const scored = pq.scorePlayerQuality(rbRows);
    const baseline = rbRows.filter((r) => table.isQualifiedRb(r));
    const col = (get, dir) => pct.percentileColumnAgainst(rbRows, get, baseline, dir);
    const n = (v) => (typeof v === "number" ? v : 0);
    const ypc = col((r) => n(r.yardsPerCarry));
    const ypr = col((r) => n(r.yardsPerReception));
    const yac = col((r) => n(r.yardsAfterContactPerAttempt));
    const elude = col((r) => n(r.tackleEludedRate));
    const fum = col((r) => (n(r.rushAttempts) > 0 ? n(r.fumbles) / r.rushAttempts : 0), "lowerIsBetter");
    const exp = table.computeRbCompositeScores(rbRows);
    const i = rbRows.findIndex((r) => r.rushAttempts >= 200 && r.receptions >= 30);
    const r = scored.get(rbRows[i]);
    assert.equal(r.categories.rushing.rawScore, ypc[i]);
    assert.equal(r.categories.receiving.rawScore, ypr[i]);
    assert.equal(r.categories.explosiveness.rawScore, exp[i].explosivenessScore, "the table's own grade");
    const blend =
      0.3 * ypc[i] + 0.3 * ypr[i] + 0.1 * yac[i] + 0.05 * elude[i] + 0.05 * fum[i] + 0.2 * exp[i].explosivenessScore;
    assert.ok(Math.abs(r.score - blend) <= 1.5, `${r.score} vs ${blend}`);
  });

  test("a back with little opportunity is scored toward below average, not off one catch", async () => {
    const pq = await importModule("lib/rb-handcuffs/engine/player-quality");
    const rows = (await readJson("data", "rb-handcuffs", "rb_advanced_stats_2025.json")).rows;
    const tiny = { playerName: "Tiny Sample", position: "RB", games: 1, rushAttempts: 3, rushYards: 30, yardsPerCarry: 10,
      targets: 1, receptions: 1, receivingYards: 30, yardsPerReception: 30 };
    const r = pq.scorePlayerQuality([...rows, tiny], 6 / 17).get(tiny);
    assert.equal(r.categories.receiving.rawScore, 100, "one 30-yard catch is the best Y/R in the pool");
    assert.ok(r.categories.receiving.score < 35, `but one catch is a tenth of the trust: ${r.categories.receiving.score}`);
    assert.ok(r.categories.rushing.score < 35, `and three carries under a tenth: ${r.categories.rushing.score}`);
    assert.ok(r.score < 40, `so he is no one's best player: ${r.score}`);
    const none = { playerName: "No Catches", position: "RB", games: 6, rushAttempts: 60, rushYards: 240, yardsPerCarry: 4, targets: 0, receptions: 0 };
    assert.equal(pq.scorePlayerQuality([...rows, none], 6 / 17).get(none).categories.receiving.score, 25, "no catches is the prior, not last");
  });

  test("the board scores on 2026, with talent read off each back's last six games", () => {
    assert.equal(BOARD.statsSeason, 2026);
    assert.ok(BOARD.statsWeek >= 1);
    // With two weeks of 2026 alone, most backups' Player Quality shrinks to
    // the same neutral value; reaching back into 2025 it spreads out.
    const distinct = new Set(BOARD.players.map((p) => p.playerQualityScore));
    assert.ok(distinct.size >= 12, `Player Quality has ${distinct.size} distinct values`);
  });

  test("path: workload and share rank against the board; missed games weigh 20 / 60 / 20", async () => {
    const path = await importModule("lib/rb-handcuffs/engine/path");
    assert.equal(path.poolPercentile(25, [10, 15, 20, 25]), 100, "the heaviest-worked starter");
    assert.equal(path.poolPercentile(10, [10, 15, 20, 25]), 0);
    assert.equal(path.poolPercentile(15, [10, 15, 15, 25]), 50, "ties share the middle");
    const base = { starterTouchesPerGame: 18, starterWorkloadPool: [12, 14, 18, 30] };
    const workload = path.computePathToOpportunity(base).components.starterWorkloadStress.score;
    assert.equal(Math.round(workload), 67, "18 a game is second of four, not (18-10)/15 of a fixed scale");
    // Missed half this season, none last season, no career: 0.2 × 100 over 0.8 of weight.
    const d = path.computePathToOpportunity({
      starterGamesPlayed: 1, starterGamesPossible: 2, starterGamesPlayedPrev: 17, starterGamesPossiblePrev: 17,
    }).components.starterDurabilityHistoryRisk.score;
    assert.equal(Math.round(d), 25, "this season is 20%, last season 60%");
  });

  test("the defaults are 35 / 45 / 20, cost off", () => {
    assert.deepEqual(recompute.DEFAULT_WEIGHTS, {
      contingentUpsideWeight: 0.35,
      pathToWorkloadWeight: 0.45,
      playerQualityWeight: 0.2,
      costWeight: 0,
    });
  });

  test("the blend is the app's blendHandcuffScore()", () => {
    const w = recompute.APP_WEIGHTS;
    assert.equal(recompute.blendHandcuffScore(55, 47, 67, null, w), Math.round(0.15 * 55 + 0.25 * 47 + 0.6 * 67));
    assert.equal(recompute.blendHandcuffScore(1, 1, 1, null, { ...w, contingentUpsideWeight: 0, pathToWorkloadWeight: 0, playerQualityWeight: 0 }), 0);
    assert.equal(recompute.blendHandcuffScore(50, 50, 50, 100, { ...w, costWeight: 0.5 }), 67);
    assert.equal(recompute.blendHandcuffScore(50, 50, 50, 100, w), 50);
  });

  test("the tiers are the app's cut-offs", () => {
    assert.equal(data.tierFor(72).label, "Elite");
    assert.equal(data.tierFor(71).label, "Great");
    assert.equal(data.tierFor(55).label, "Great");
    assert.equal(data.tierFor(38).label, "Good");
    assert.equal(data.tierFor(37).label, "Deep");
  });

  test("names resolve to player pages through their suffixes", () => {
    const withSuffix = BOARD.players.filter((p) => /\b(Jr\.?|Sr\.?|SR\.|II|III|IV)$/.test(p.starterName ?? ""));
    assert.ok(withSuffix.length > 0);
    for (const p of withSuffix) assert.ok(p.starterSlug, `${p.starterName} has a page`);
    assert.ok(BOARD.players.filter((p) => p.slug).length >= BOARD.players.length - 2, "nearly every backup links");
  });

  test("the season is the board's, with January and February counting back", () => {
    assert.equal(data.seasonOf("2026-08-17T14:10:35.443Z"), 2026);
    assert.equal(data.seasonOf("2027-02-10T00:00:00Z"), 2026);
    assert.equal(data.seasonOf("2027-03-01T00:00:00Z"), 2027);
  });
});

describe("the refresh script", () => {
  test("reads Ourlads' RB rows into each team's top three", async () => {
    const { parseOurlads, normalizeName } = await import(path.join(APP_DIR, "scripts", "rb-handcuffs", "refresh.mjs"));
    const row = (logo, names) =>
      `<tr class='row-dc-wht'><td><img src='/x/logo_thumb_${logo}.gif'></td><td>RB</td>` +
      names.map((n, i) => `<td><a href='https://www.ourlads.com/nfldepthcharts/player/${i + 1}/'>${n}</a></td>`).join("") +
      `</tr>`;
    const teams = parseOurlads(
      row("BUF", ["Cook III, James 22/2", "Johnson, Ty U/NYJ", "Davis, Ray 24/4", "Extra, Man 25/7"]) +
        row("WSH", ["CROSKEY-MERRITT, JACORY 25/7", "White, Rachaad 22/3"]) +
        row("BUF", ["Somebody, Else 20/1"]),
    );
    assert.deepEqual(teams.BUF, { rb1: "James Cook III", rb2: "Ty Johnson", rb3: "Ray Davis" }, "first row per team wins");
    assert.deepEqual(teams.WAS, { rb1: "Jacory Croskey-Merritt", rb2: "Rachaad White", rb3: null });
    assert.equal(normalizeName("Bam Knight"), "zonovan knight");
  });
});

/* ------------------------------------------------------------- the server */

describe("the pages", () => {
  test("the board is complete without JavaScript", async () => {
    const { status, headers, doc } = await page("/rb-handcuff-rankings");
    assert.equal(status, 200);
    assert.equal(headers["x-robots-tag"], "noindex, indexifembedded");
    assert.equal(
      doc.querySelector('link[rel="canonical"]').getAttribute("href"),
      `${server.origin}/rb-handcuff-rankings`,
    );
    assert.match(doc.title, /^\d{4} Fantasy Football RB Handcuff Rankings \| StatChasers$/);

    const rows = doc.querySelectorAll("tr.rbh-row");
    assert.equal(rows.length, BOARD.players.length);
    const first = rows[0];
    assert.equal(first.querySelector(".rbh-rank").textContent, "1");
    assert.equal(first.querySelector(".rbh-name-full").textContent, TOP.playerName);
    assert.equal(first.querySelector(".rbh-starter .rbh-name-full").textContent, TOP.starterName);
    assert.equal(first.querySelector("[data-rbh-score]").textContent, String(TOP.handcuffScore));
    assert.ok(first.querySelector(".rbh-for").textContent.includes(TOP.starterName), "the starter under the name, for the narrow table");
  });

  test("the reasons are in the page, under each row", async () => {
    const { doc } = await page("/rb-handcuff-rankings");
    const detail = doc.querySelector(`tr[data-rbh-detail="${TOP.id}"]`);
    assert.ok(detail.hidden, "closed until opened");
    const reasons = [...detail.querySelectorAll(".rbh-reasons li")].map((li) => li.textContent);
    assert.deepEqual(reasons, TOP.topReasons.slice(0, 3));
  });

  test("controls that need the bundle ship hidden; the reference does not", async () => {
    const { doc } = await page("/rb-handcuff-rankings");
    assert.ok(doc.querySelector("[data-rbh-weights]").hidden);
    assert.ok(doc.querySelector(".rbh-th-comp").hidden);
    assert.equal(doc.querySelectorAll(".rbh-sort").length, 0, "sort buttons are built by the bundle");
    assert.equal(doc.querySelectorAll("details.rbh-accordion").length, 2);
    assert.equal(doc.querySelectorAll(".rbh-badge-card").length, 7);
  });

  test("player names link to this app's player pages", async () => {
    const { doc } = await page("/rb-handcuff-rankings");
    const link = doc.querySelector("tr.rbh-row a.rbh-name");
    assert.match(link.getAttribute("href"), /^\/player\/[a-z0-9-]+\/$/);
    const embed = await page("/rb-handcuff-rankings?embed=1");
    assert.match(embed.doc.querySelector("tr.rbh-row a.rbh-name").getAttribute("href"), /\?embed=1$/);
  });

  test("a second request is answered by its ETag", async () => {
    const first = await rawGet("/rb-handcuff-rankings");
    const again = await rawGet("/rb-handcuff-rankings", { "If-None-Match": first.headers.etag });
    assert.equal(again.status, 304);
  });

  test("the fragment is embedded, with an absolute card endpoint", async () => {
    const { status, headers, doc } = await page("/embed/rb-handcuffs");
    assert.equal(status, 200);
    assert.equal(headers["x-robots-tag"], "noindex, indexifembedded");
    const root = doc.querySelector("[data-rbh-root]");
    assert.ok(root.classList.contains("is-embed"));
    assert.equal(root.dataset.rbhEndpoint, `${server.origin}/embed/rb-handcuffs`);
    assert.equal(doc.querySelectorAll("tr.rbh-row").length, BOARD.players.length);
    assert.equal(doc.querySelector("h1"), null, "the host page owns the H1");
  });

  test("the best handcuffs are listed by name, in the board's order", async () => {
    const { doc } = await page("/rb-handcuff-rankings");
    assert.match(doc.querySelector(".rbh-dek").textContent, /best RB handcuffs in fantasy football/);
    assert.equal(doc.querySelector(".rbh-best-title").textContent, `Best RB Handcuffs for ${BOARD.season}`);
    const names = [...doc.querySelectorAll(".rbh-best-name")].map((n) => n.textContent);
    assert.deepEqual(names, BOARD.players.slice(0, 10).map((p) => p.playerName));
    assert.match(doc.querySelector(".rbh-best-item").textContent, new RegExp(`handcuff for ${TOP.starterName}`));
  });

  test("the FAQ is in the page, and its answers come from the board", async () => {
    const { doc } = await page("/rb-handcuff-rankings");
    const questions = [...doc.querySelectorAll(".rbh-faq-q")].map((q) => q.textContent);
    assert.equal(questions.length, 15);
    assert.equal(questions[0], "Who are the best RB handcuffs in fantasy football?");
    assert.equal(questions[1], `What are the best fantasy RB handcuffs for ${BOARD.season}?`);
    const answers = [...doc.querySelectorAll(".rbh-faq-a")].map((a) => a.textContent);
    assert.ok(answers[0].includes(`${TOP.playerName} (${TOP.team}, behind ${TOP.starterName})`), "the best answer names the board's first");
    assert.match(answers[2], /Backfield Opportunity .* weighted 35%, 45% and 20% by default/);
    assert.equal(doc.querySelectorAll(".rbh-faq-item[open]").length, 0, "every answer starts shut");

    // Standalone, the page describes itself.
    const ld = [...doc.querySelectorAll('script[type="application/ld+json"]')]
      .map((s) => JSON.parse(s.textContent))
      .find((n) => n["@type"] === "FAQPage");
    assert.equal(ld.mainEntity.length, 15);
    assert.equal(ld.mainEntity[0].acceptedAnswer.text, answers[0]);
    assert.equal(doc.querySelector(".rbh-faq-data"), null);
  });

  test("embedded, the FAQ ships as an island for the plugin, not as JSON-LD", async () => {
    const { doc } = await page("/embed/rb-handcuffs");
    assert.equal(doc.querySelectorAll(".rbh-faq-q").length, 15);
    assert.equal(doc.querySelector('script[type="application/ld+json"]'), null);
    const island = JSON.parse(doc.querySelector("script.rbh-faq-data").textContent);
    assert.equal(island.length, 15);
    assert.deepEqual(Object.keys(island[0]), ["q", "a"]);
  });

  test("a player card is its own fragment, and an unknown one is a 404", async () => {
    const { status, doc } = await page(`/embed/rb-handcuffs/player/${TOP.id}`);
    assert.equal(status, 200);
    assert.equal(doc.querySelector(".rbh-hero-name").textContent, TOP.playerName);
    assert.equal(doc.querySelectorAll(".rbh-section").length, 3);
    assert.ok(doc.querySelector(".rbh-section").open, "Path to Opportunity opens first");
    assert.ok(doc.querySelector(".rbh-summary").textContent.includes(TOP.playerName.split(" ").at(-1)));

    assert.equal((await rawGet("/embed/rb-handcuffs/player/nobody-at-all")).status, 404);
    assert.equal((await rawGet("/embed/rb-handcuffs/player/..%2f..%2fetc")).status, 404);
  });
});

/* --------------------------------------------------------------- the bundle */

describe("the bundle", () => {
  let bundle;

  before(async () => {
    bundle = await readFile(path.join(APP_DIR, "public", "dist", "statchasers-rb-handcuffs.js"), "utf8");
  });

  async function mount() {
    const fragment = await (await fetch(`${server.origin}/embed/rb-handcuffs`)).text();
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on("jsdomError", (e) => errors.push(String(e)));
    const dom = new JSDOM(
      `<!doctype html><html><body><h1>RB Handcuffs</h1>${fragment}</body></html>`,
      {
        runScripts: "outside-only",
        url: "https://statchasers.com/rb-handcuff-rankings/",
        pretendToBeVisual: true,
        virtualConsole,
      },
    );
    const { window } = dom;
    const fetched = [];
    window.fetch = async (input) => {
      fetched.push(String(input));
      const res = await fetch(String(input));
      const text = await res.text();
      return { ok: res.ok, status: res.status, text: async () => text };
    };
    window.eval(bundle);
    await new Promise((r) => setTimeout(r, 30));
    const doc = window.document;
    const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0 }));
    const names = () => [...doc.querySelectorAll("tr.rbh-row")].map((r) => r.dataset.name);
    const slide = (key, value) => {
      const input = doc.querySelector(`[data-rbh-weight="${key}"]`);
      input.value = String(value);
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    };
    return { window, doc, errors, fetched, click, names, slide };
  }

  test("wires up without errors and shows the controls", async () => {
    const { doc, errors } = await mount();
    assert.deepEqual(errors, []);
    assert.ok(!doc.querySelector("[data-rbh-weights]").hidden);
    assert.ok(!doc.querySelector(".rbh-th-comp").hidden);
    assert.equal(doc.querySelectorAll(".rbh-sort").length, 6);
    assert.equal(doc.querySelectorAll("[data-rbh-compare]").length, BOARD.players.length);
    assert.equal(doc.querySelector('th[data-sort="rank"]').getAttribute("aria-sort"), "ascending");
  });

  test("the weights must total 100 before they can be applied", async () => {
    const { doc, slide } = await mount();
    const apply = doc.querySelector("[data-rbh-apply]");
    assert.ok(apply.disabled, "nothing to apply at the defaults");
    slide("playerQualityWeight", 10);
    assert.ok(apply.disabled, "90% cannot be applied");
    assert.match(doc.querySelector("[data-rbh-status]").textContent, /Allocation 90%.*Add 10%/);
    slide("pathToWorkloadWeight", 55);
    assert.ok(!apply.disabled);
    assert.match(doc.querySelector("[data-rbh-status]").textContent, /Unsaved model changes/);
  });

  test("re-ranking rescores the board, and Reset brings the defaults back", async () => {
    const { doc, click, names, slide } = await mount();
    const before = names();

    slide("playerQualityWeight", 40);
    slide("pathToWorkloadWeight", 25);
    click(doc.querySelector("[data-rbh-apply]"));
    const after = names();
    assert.notDeepEqual(after, before, "the order moved");
    const ranks = [...doc.querySelectorAll("tr.rbh-row .rbh-rank")].map((c) => Number(c.textContent));
    assert.deepEqual(ranks, ranks.map((_, i) => i + 1), "numbered in the new order");
    const scores = [...doc.querySelectorAll("tr.rbh-row")].map((r) => Number(r.dataset.score));
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
    // Each detail row travelled with its player.
    for (const row of doc.querySelectorAll("tr.rbh-row")) {
      assert.equal(row.nextElementSibling.dataset.rbhDetail, row.dataset.id);
    }

    click(doc.querySelector("[data-rbh-reset]"));
    click(doc.querySelector("[data-rbh-apply]"));
    assert.deepEqual(names(), before, "the defaults give back the table that was sent");
  });

  test("sorting: text A–Z first, numbers highest first, and back", async () => {
    const { doc, click, names } = await mount();
    click(doc.querySelector('th[data-sort="name"] .rbh-sort'));
    const az = names();
    assert.deepEqual(az, [...az].sort((a, b) => a.localeCompare(b)));
    click(doc.querySelector('th[data-sort="name"] .rbh-sort'));
    assert.deepEqual(names(), [...az].reverse());

    click(doc.querySelector('th[data-sort="score"] .rbh-sort'));
    const scores = [...doc.querySelectorAll("tr.rbh-row")].map((r) => Number(r.dataset.score));
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
    assert.equal(doc.querySelector('th[data-sort="score"]').getAttribute("aria-sort"), "descending");
  });

  test("a row opens its breakdown, one at a time", async () => {
    const { doc, click } = await mount();
    const [a, b] = doc.querySelectorAll("tr.rbh-row");
    click(a.querySelector(".rbh-rank"));
    assert.equal(a.getAttribute("aria-expanded"), "true");
    assert.ok(!a.nextElementSibling.hidden);
    click(b.querySelector(".rbh-rank"));
    assert.ok(a.nextElementSibling.hidden, "the first closes");
    assert.ok(!b.nextElementSibling.hidden);
    click(b.querySelector(".rbh-rank"));
    assert.ok(b.nextElementSibling.hidden, "and a second click closes it");
  });

  test("compare takes three, and the tray opens the side-by-side", async () => {
    const { doc, click } = await mount();
    const buttons = () => doc.querySelectorAll("[data-rbh-compare]");
    for (let i = 0; i < 3; i += 1) click(buttons()[i]);
    assert.ok(buttons()[3].disabled, "a fourth cannot be added");
    const tray = doc.querySelector(".rbh-tray");
    assert.equal(tray.querySelectorAll(".rbh-chip-player").length, 3);

    click(tray.querySelector("[data-rbh-open-compare]"));
    const dialog = doc.querySelector(".rbh-modal.is-compare [role=dialog]");
    assert.ok(dialog);
    assert.equal(dialog.querySelectorAll(".rbh-ccol").length, 3);
    assert.equal(dialog.querySelector(".rbh-ccol-name").textContent, TOP.playerName);

    click(doc.querySelector(".rbh-modal [data-rbh-close]"));
    assert.equal(doc.querySelector(".rbh-modal"), null);
    click(doc.querySelector("[data-rbh-clear]"));
    assert.equal(doc.querySelector(".rbh-tray"), null);
  });

  test("the card is fetched from the endpoint once, and closes on Escape", async () => {
    const { doc, window, click, fetched } = await mount();
    click(doc.querySelector(`[data-rbh-card="${TOP.id}"]`));
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(fetched.length, 1);
    assert.equal(fetched[0], `${server.origin}/embed/rb-handcuffs/player/${TOP.id}?from=embed`);
    assert.equal(doc.querySelector(".rbh-modal .rbh-hero-name").textContent, TOP.playerName);
    assert.ok(doc.documentElement.classList.contains("rbh-locked"));

    doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(doc.querySelector(".rbh-modal"), null);
    assert.ok(!doc.documentElement.classList.contains("rbh-locked"));

    click(doc.querySelector(`[data-rbh-card="${TOP.id}"]`));
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(fetched.length, 1, "the second open is from memory");
  });

  test("nothing is written to the address", async () => {
    const { doc, window, click, slide } = await mount();
    const before = window.location.href;
    slide("playerQualityWeight", 40);
    slide("pathToWorkloadWeight", 45);
    click(doc.querySelector("[data-rbh-apply]"));
    click(doc.querySelector('th[data-sort="team"] .rbh-sort'));
    click(doc.querySelector("tr.rbh-row .rbh-rank"));
    assert.equal(window.location.href, before);
  });
});
