/**
 * The hub's default tab across the season's transitions (Team Pages Phase 1
 * finalization, 2026-11-19), rendered from synthetic page data so every
 * phase can be checked on any calendar day:
 *
 *   - preseason: the preseason outlook is the default, labeled "Outlook";
 *   - first final: the Season Overview takes over, outlook archived, season FAQ;
 *   - bye week: the next-game card says so;
 *   - season over: no next game, a "complete" line, no next-game question;
 *   - next year's preseason with only last year's outlook: the overview with
 *     no season-to-date numbers, nothing from the old season presented as current;
 *   - missing injury feed / missing schedule: those blocks drop out, and a
 *     missing schedule mid-season does not bring the preseason take back.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { APP_DIR } from "./helpers/server.mjs";

let render;
let teams;
let dir;

// The renderer reaches the database package through the news imports; no
// path under test queries it, so it is bundled as an inert CommonJS stub
// (the workspace package is TypeScript Node cannot load directly).
before(async () => {
  dir = fs.mkdtempSync(path.join(APP_DIR, ".test-bundle-"));
  const entry = path.join(dir, "entry.ts");
  fs.writeFileSync(entry, `export * as render from "../src/lib/team-render";\nexport * as teams from "../src/lib/team/teams";\n`);
  const outfile = path.join(dir, "module.mjs");
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    packages: "external",
    logLevel: "silent",
    plugins: [
      {
        name: "stub-db",
        setup(b) {
          b.onResolve({ filter: /^@workspace\/db/ }, (args) => ({ path: args.path, namespace: "stub" }));
          b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
            // Any property, at any depth, is an inert callable; reached through
            // the prototype too, because esbuild's ESM interop copies a CJS
            // module onto an object created from its prototype.
            contents:
              "const fn = new Proxy(function () {}, { get: (t, k) => (k === 'then' || typeof k === 'symbol' ? undefined : fn), apply: () => fn });" +
              "const any = new Proxy({}, { get: (t, k) => (typeof k === 'symbol' ? undefined : fn) });" +
              "module.exports = new Proxy({}, { get: (t, k) => (typeof k === 'symbol' ? undefined : fn), getPrototypeOf: () => any });",
            loader: "js",
          }));
        },
      },
    ],
  });
  const mod = await import(pathToFileURL(outfile).href);
  render = mod.render;
  teams = mod.teams;
});
after(() => process.env.KEEP_BUNDLE || fs.rmSync(dir, { recursive: true, force: true }));

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 19, 15);

function team(abbr) {
  return teams.TEAMS.find((t) => t.abbreviation === abbr);
}

function game(week, opponent, { final = null, kickoffMs = null } = {}) {
  return {
    week,
    seasonType: "regular",
    weekLabel: `Week ${week}`,
    espnEventId: null,
    gameId: `2026_${String(week).padStart(2, "0")}_X`,
    kickoffMs: kickoffMs ?? NOW + (week - 11) * 7 * DAY,
    timeConfirmed: true,
    dateConfirmed: true,
    kickoffSource: "slate",
    homeAway: week % 2 ? "home" : "away",
    site: week % 2 ? "home" : "away",
    neutralSite: false,
    opponent: team(opponent),
    opponentName: team(opponent).fullName,
    venue: "Somewhere Field",
    venueCity: null,
    international: false,
    divisional: false,
    network: "FOX",
    status: final ? "final" : "scheduled",
    statusDetail: final ? "Final" : null,
    result: final ? { outcome: final[0] > final[1] ? "W" : final[0] < final[1] ? "L" : "T", teamScore: final[0], opponentScore: final[1] } : null,
  };
}

function schedule(games, byeWeek = 6) {
  return { season: 2026, games, byeWeek, fetchedAt: NOW, updatedAtMs: NOW, version: "t" };
}

function data({ season = 2026, seasonType = "regular", week = 11, underway = true, sched = null, roster = null, division = null } = {}) {
  return {
    team: team("det"),
    state: { season, seasonType, week, displayWeek: week, regularSeasonUnderway: underway, statsSeason: underway ? season : season - 1, statsSeasonIsPrior: !underway },
    news: [],
    newsUpdatedAtMs: null,
    roster,
    injuries: roster ? roster.injuries : [],
    rosterFetchedAt: NOW,
    depthCharts: null,
    schedule: sched,
    postseason: null,
    profile: null,
    snapshot: null,
    stats: null,
    nextOpponentDefense: null,
    division,
    version: "t",
  };
}

const opp = ["gb", "chi", "min", "tb", "ne", "lv", "kc", "dal", "nyj", "buf", "sea", "ari", "lar", "atl", "phi", "was", "mia"];
function season(finals) {
  // 17 games over weeks 1-18 with a Week 6 bye; the first `finals` played.
  const weeks = [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
  return weeks.map((w, i) =>
    game(w, opp[i], i < finals ? { final: [24, 17], kickoffMs: NOW - (finals - i) * 7 * DAY } : { kickoffMs: NOW + (i - finals + 1) * 7 * DAY }),
  );
}

function page(d) {
  const html = render.renderTeamPage(d, { now: NOW });
  const doc = new JSDOM(html).window.document;
  return { html, doc, panel: doc.getElementById("outlook"), tab: doc.querySelector("#outlook-tab") };
}

describe("season phases", () => {
  test("preseason: the outlook is the default, labeled Outlook, with its own questions", () => {
    const { doc, panel, tab } = page(data({ seasonType: "pre", week: 1, underway: false, sched: schedule(season(0)) }));
    assert.ok(panel, "the default panel");
    assert.equal(tab.textContent, "Outlook");
    assert.equal(panel.querySelector("#team-overview"), null, "no overview before a final");
    assert.ok(panel.querySelector("#outlook-premium"), "the outlook");
    assert.equal(panel.querySelector("details#preseason-outlook"), null, "not archived");
    assert.match(doc.querySelector('[data-sct-faq-for="outlook"]').textContent, /draft|fantasy/i);
  });

  test("first final: the overview opens the tab, the outlook is archived, the FAQ is the season's", () => {
    const { doc, panel, tab } = page(data({ sched: schedule(season(1)), week: 2 }));
    assert.equal(tab.textContent, "Overview");
    assert.equal(panel.firstElementChild.id, "team-overview");
    const archive = panel.querySelector("details#preseason-outlook");
    assert.ok(archive && !archive.open, "archived and closed");
    assert.ok(archive.querySelector("#outlook-premium"));
    assert.match(archive.querySelector(".sct-tfo-title").textContent, /2026 Preseason Fantasy Outlook$/);
    const qs = [...doc.querySelectorAll('[data-sct-faq-for="outlook"] .sct-faq-q')].map((q) => q.textContent);
    assert.ok(qs.some((q) => /play next/.test(q)), "a next-game question");
    assert.ok(!qs.some((q) => /draft|worth drafting|sleeper/i.test(q)), "no draft-season question in the active FAQ");
  });

  test("bye week: the next-game card says so", () => {
    const sched = schedule(season(5), 6);
    const { panel } = page(data({ sched, week: 6 }));
    assert.match(panel.querySelector(".sct-ovw-next").textContent, /Bye in Week 6/);
  });

  test("season over: no next game, the season is complete, and no next-game question", () => {
    const { doc, panel } = page(data({ seasonType: "off", week: 18, sched: schedule(season(17)) }));
    assert.match(panel.querySelector(".sct-ovw-next").textContent, /season is complete \(17-0/);
    const qs = [...doc.querySelectorAll('[data-sct-faq-for="outlook"] .sct-faq-q')].map((q) => q.textContent);
    assert.ok(!qs.some((q) => /play next/.test(q)));
  });

  test("next year's preseason: last year's outlook is gone and nothing from 2026 reads as current", () => {
    const next = schedule(season(0).map((g) => ({ ...g, gameId: g.gameId.replace("2026", "2027") })));
    next.season = 2027;
    const d = data({ season: 2027, seasonType: "pre", week: 1, underway: false, sched: next });
    // Last season's table, which is what statsSeason points at in a preseason.
    d.stats = {
      season: 2026,
      gamesPlayed: 17,
      offense: [{ key: "off-points", label: "Points/G", description: "", value: "28.6", rank: 6, rankLabel: "6th", previousRank: null, direction: "higher", cumulative: false }],
      defense: [],
      situational: [],
      volume: [],
      balance: null,
      balanceFaced: null,
      history: [],
      fetchedAt: NOW,
      source: "file",
    };
    const { html, panel, tab } = page(d);
    assert.ok(panel, "the hub still opens on its default tab");
    assert.equal(tab.textContent, "Overview");
    assert.equal(panel.querySelector("#outlook-premium"), null, "the 2026 outlook is dropped");
    assert.match(panel.querySelector(".sct-up-dek").textContent, /2027 NFL Season · Before Week 1/);
    assert.equal(panel.querySelector(".sct-ovw-perf, .sct-ovw-last, .sct-ovw-players"), null, "no season-to-date block");
    assert.ok(!/2026 Season Overview|28\.6/.test(panel.outerHTML), "no 2026 figure in the default panel");
    assert.ok(html.length > 0);
  });

  test("ties in the division are labeled, not ranked", () => {
    const division = ["det", "chi", "min", "gb"].map((a, i) => ({ team: team(a), wins: i < 3 ? 7 : 6, losses: i < 3 ? 2 : 4, ties: 0 }));
    const { panel } = page(data({ sched: schedule(season(9)), division }));
    const rows = [...panel.querySelectorAll(".sct-ovw-div tbody tr")];
    assert.equal(rows.filter((r) => r.querySelector(".sct-ovw-tie")).length, 3);
    assert.match(panel.querySelector(".sct-ovw-division").textContent, /not the official standing/);
  });

  test("no injury feed: no injury panel and no injury question", () => {
    const { doc, panel } = page(data({ sched: schedule(season(9)), roster: null }));
    assert.equal(panel.querySelector(".sct-ovw-injuries"), null);
    assert.ok(![...doc.querySelectorAll(".sct-faq-q")].some((q) => /injured/.test(q.textContent)));
  });

  test("schedule unreadable mid-season: still the overview, never the preseason take on top", () => {
    const { panel, tab } = page(data({ sched: null }));
    assert.equal(tab.textContent, "Overview");
    assert.equal(panel.firstElementChild.id, "team-overview");
    assert.equal(panel.querySelector(".sct-ovw-last, .sct-ovw-next"), null, "no game cards without a schedule");
  });
});
