/**
 * The hub's default tab across the season's transitions (Team Pages Phase 1
 * finalization, 2026-11-19), rendered from synthetic page data so every
 * phase can be checked on any calendar day:
 *
 *   - preseason: the preseason outlook is the default, labeled "Outlook";
 *   - first final: the Season Overview takes over, the preseason outlook leaves the page (2026-11-20), season FAQ;
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
let availability;
let dir;

// The renderer reaches the database package through the news imports; no
// path under test queries it, so it is bundled as an inert CommonJS stub
// (the workspace package is TypeScript Node cannot load directly).
before(async () => {
  dir = fs.mkdtempSync(path.join(APP_DIR, ".test-bundle-"));
  const entry = path.join(dir, "entry.ts");
  fs.writeFileSync(entry, `export * as render from "../src/lib/team-render";\nexport * as teams from "../src/lib/team/teams";\nexport * as availability from "../src/lib/matchup/availability";\n`);
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
  availability = mod.availability;
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

function data({ season = 2026, seasonType = "regular", week = 11, underway = true, sched = null, roster = null, division = null, club = "det" } = {}) {
  return {
    team: team(club),
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

  test("first final: the overview opens the tab, the preseason outlook leaves the page, the FAQ is the season's", () => {
    const { doc, panel, tab } = page(data({ sched: schedule(season(1)), week: 2 }));
    assert.equal(tab.textContent, "Overview");
    assert.equal(panel.firstElementChild.id, "team-overview");
    // Not printed once the season has a final (2026-11-20): no archive, no
    // block, no preseason heading anywhere in the document.
    assert.equal(doc.querySelector("details#preseason-outlook"), null, "no archive");
    assert.equal(doc.querySelector("#outlook-premium, .sct-tfo"), null, "no preseason outlook block");
    assert.doesNotMatch(doc.body.textContent, /Preseason Fantasy Outlook|Preseason Questions|Written before Week 1/);
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

/*
 * Regression (release gate 2026-11-19, carried into the team-hubs
 * integration): Sleeper's injuryStatus is not tied to a week. Sione Vaki (DET)
 * was Questionable for Week 10, played, and still read Questionable on the
 * team overview while his own page said "No injury designation for Week 11".
 * The shared rule (matchup/availability.ts) is checked here on injected game
 * logs and practice reports, so it holds on any calendar day.
 */
describe("a designation the player then played through has expired", () => {
  const roster = [
    { id: "vaki", name: "Sione Vaki", position: "RB", injuryStatus: "Questionable", injuryBodyPart: "Ankle" },
    { id: "missed", name: "Missed Back", position: "RB", injuryStatus: "Questionable", injuryBodyPart: "Knee" },
    { id: "ir", name: "Reserve Back", position: "RB", injuryStatus: "IR", injuryBodyPart: "Back" },
    { id: "healthy", name: "Healthy Back", position: "RB", injuryStatus: null },
  ];
  // Detroit played Week 10 (Vaki and the healthy back took snaps); the missed back did not.
  const logs = {
    vaki: [{ week: 10, team: "DET", stats: { off_snp: 14, gp: 1 } }],
    healthy: [{ week: 10, team: "DET", stats: { off_snp: 50, gp: 1 } }],
    missed: [{ week: 9, team: "DET", stats: { off_snp: 30, gp: 1 } }],
  };
  const status = (practice) =>
    Object.fromEntries(availability.gameRoster(team("det"), 2026, 11, roster, { logs, practice }).map((r) => [r.id, r.injuryStatus]));

  test("no Week 11 report yet: Vaki has no designation, the back who missed is Pending, IR stands", () => {
    const s = status({ weeks: {} });
    assert.equal(s.vaki, null, "Questionable for Week 10 and played: expired");
    assert.equal(s.missed, "Pending");
    assert.equal(s.ir, "IR");
    assert.equal(s.healthy, null);
    const note = availability.gameAvailability(team("det"), 2026, 11, roster, { logs, practice: { weeks: {} } }).get("vaki").note;
    assert.match(note, /Listed Questionable for Week 10 and played; no Week 11 designation/);
  });

  test("a Week 11 report that lists him Questionable again is current", () => {
    const practice = { weeks: { 11: { teams: { Lions: { [availability.availabilityKey("Sione Vaki")]: { name: "Sione Vaki", injury: "Ankle", gameStatus: "Questionable", final: null, days: {} } } } } } };
    assert.equal(status(practice).vaki, "Questionable");
  });
});

/*
 * Team Pages Phase 4 (2026-11-19): the expiry must not clear a designation
 * filed AFTER the last game. Sleeper carries no date, so the previous week's
 * official report dates it: the same status as that report is stale (Vaki),
 * a different status - or a player that report did not list - was designated
 * since (Woody Marks Out, A.J. Brown Questionable -> Out, Geno Smith
 * Questionable, all after Week 10, 2026).
 */
describe("a designation filed after the last game stands until the official report", () => {
  const row = (name, gameStatus) => ({ name, pos: "RB", injury: null, gameStatus, final: null, days: {} });
  const roster = [
    { id: "stale", name: "Sione Vaki", position: "RB", injuryStatus: "Questionable", injuryBodyPart: "Ankle" },
    { id: "upgraded", name: "Out Now", position: "WR", injuryStatus: "Out", injuryBodyPart: "Knee" },
    { id: "unlisted", name: "Newly Hurt", position: "QB", injuryStatus: "Questionable", injuryBodyPart: "Shoulder" },
    { id: "missed", name: "Missed Back", position: "RB", injuryStatus: "Questionable", injuryBodyPart: "Knee" },
    { id: "ir", name: "Reserve Back", position: "RB", injuryStatus: "IR", injuryBodyPart: "Back" },
  ];
  const played = (id) => [{ week: 10, team: "DET", stats: { off_snp: 30, gp: 1 } }];
  const logs = { stale: played(), upgraded: played(), unlisted: played(), missed: [{ week: 9, team: "DET", stats: { off_snp: 30, gp: 1 } }], anchor: played() };
  const week10 = () => {
    const k = availability.availabilityKey;
    return { 10: { teams: { Lions: { [k("Sione Vaki")]: row("Sione Vaki", "Questionable"), [k("Out Now")]: row("Out Now", "Questionable"), [k("Missed Back")]: row("Missed Back", "Questionable") } } } };
  };
  const statuses = (practice) =>
    Object.fromEntries(availability.gameRoster(team("det"), 2026, 11, roster, { logs, practice }).map((r) => [r.id, r]));

  test("no Week 11 report: stale expires, new designations stand and say they are not official", () => {
    const s = statuses({ weeks: week10() });
    assert.equal(s.stale.injuryStatus, null, "Questionable for Week 10 and played: expired");
    assert.equal(s.upgraded.injuryStatus, "Out", "Questionable on the Week 10 report, Out since: stands");
    assert.equal(s.unlisted.injuryStatus, "Questionable", "not on the Week 10 report, designated since: stands");
    assert.equal(s.upgraded.availability.source, "sleeper");
    assert.match(s.upgraded.availability.note, /Listed Out after Week 10; no official Week 11 injury report yet/);
    assert.equal(s.missed.injuryStatus, "Pending");
    assert.equal(s.ir.injuryStatus, "IR");
  });

  test("Week 11 report on file without game statuses yet: the same split, with practice", () => {
    const weeks = week10();
    weeks[11] = { teams: { Lions: { [availability.availabilityKey("Out Now")]: { ...row("Out Now", null), final: "DNP", days: { "2026-11-18": "DNP" } } } } };
    const s = statuses({ weeks });
    assert.equal(s.stale.injuryStatus, null);
    assert.equal(s.upgraded.injuryStatus, "Out");
    assert.match(s.upgraded.availability.note, /no official Week 11 game status yet/);
    assert.equal(s.unlisted.injuryStatus, "Questionable");
  });

  test("the official game status wins over Sleeper", () => {
    const weeks = week10();
    weeks[11] = { teams: { Lions: { [availability.availabilityKey("Out Now")]: row("Out Now", "Doubtful") } } };
    const s = statuses({ weeks });
    assert.equal(s.upgraded.injuryStatus, "Doubtful");
    assert.equal(s.upgraded.availability.source, "nfl-report");
  });

  test("no previous report to date it against: expires, as before", () => {
    const s = statuses({ weeks: {} });
    assert.equal(s.upgraded.injuryStatus, null);
    assert.equal(s.unlisted.injuryStatus, null);
  });
});

/*
 * Team Pages Phase 6 (2026-11-20): Sleeper's reserve codes are spelled out in
 * the injury lists ("NA" read as no data, "DNR" as nothing); everything else
 * passes through. Display only - the codes still drive availability.
 */
describe("injury list labels", () => {
  test("NA and DNR are spelled out; designations pass through", () => {
    assert.equal(render.injuryStatusLabel("NA"), "Not active");
    assert.equal(render.injuryStatusLabel("DNR"), "Did not report");
    for (const s of ["IR", "PUP", "Questionable", "Out", "Pending", "Doubtful"]) assert.equal(render.injuryStatusLabel(s), s);
    assert.equal(render.injuryStatusLabel(null), "");
  });
});

/*
 * The preseason outlook block's design (mak's brief, 2026-11-05; phone pass
 * 2026-11-14). Moved here from team.test.mjs on 2026-11-20: the block prints
 * only before the first regular-season final now, and that suite reads the
 * live, in-season hub, so it is checked on a preseason render of the
 * Patriots' outlook instead.
 */
describe("the preseason outlook block", () => {
  const pre = () => page(data({ club: "ne", seasonType: "pre", week: 1, underway: false, sched: schedule(season(0)) }));

  test("the block is the tab: its header carries the panel's H2, the outlook's words, groups and cards", () => {
    const { doc, panel } = pre();
    const neu = panel.querySelector("#outlook-premium.sct-tfo");
    assert.ok(neu, "the block renders");
    assert.equal(panel.querySelector(".sct-outlook-stamp, .sct-outlook-player, .sct-outlook-facts"), null, "the old block is gone");
    assert.equal(neu.querySelector(".sct-cp-flag"), null, "no comparison flag");
    const h2s = [...neu.querySelectorAll("h2")];
    assert.equal(h2s.length, 1, "one block heading");
    assert.ok(h2s[0].classList.contains("sct-h2") && h2s[0].classList.contains("sct-tfo-title"));
    assert.match(h2s[0].textContent, /^New England Patriots Fantasy Football Outlook & Stats \d{4}$/);
    const head = neu.querySelector("header.sct-up-head.sct-tfo-head");
    assert.ok(head, "the shared premium header");
    assert.ok(head.querySelector(".sct-up-head-icon svg"), "the gold-ringed glyph");
    assert.ok(head.contains(h2s[0]) && h2s[0].classList.contains("sct-up-h2"), "the title is the header's");
    assert.ok(head.querySelector("p.sct-up-dek.sct-tfo-stamp"), "the stamp is the dek");
    assert.equal(neu.querySelector(".sct-tfo-crest, .sct-tfo-logo"), null, "the light logo header is gone");
    assert.match(neu.querySelector(".sct-tfo-stamp").textContent, /NFL Season/);
    assert.match(neu.querySelector(".sct-tfo-stamp").textContent, /Written before Week 1|Preseason outlook/);
    assert.ok(neu.querySelector(".sct-tfo-lede").textContent.length > 40, "the summary");
    const frame = neu.querySelector(".sct-tfo-overview");
    assert.ok(frame && frame.querySelector(".sct-tfo-lede") && frame.querySelector(".sct-tfo-strip"), "summary and strip share one frame under the header");
    assert.ok(neu.querySelector(".sct-tfo-bl-text").textContent.length > 20, "the bottom line");
    const cells = [...neu.querySelectorAll(".sct-tfo-fact")];
    assert.ok(cells.length >= 3, "the context strip");
    for (const c of cells) {
      assert.ok(c.querySelector(".sct-tfo-fact-label").textContent.length > 0);
      assert.ok(c.querySelector(".sct-tfo-fact-value").textContent.length > 0);
      assert.ok(c.querySelector(".sct-tfo-fact-icon svg"));
    }
    for (const b of neu.querySelectorAll(".sct-tfo-card .sct-injury-badge")) {
      assert.ok(b.classList.contains("is-pinned") && b.parentElement.classList.contains("sct-tfo-face"), "the tag is pinned on the face");
    }
    assert.equal(neu.querySelector(".sct-tfo-badges .sct-injury-badge"), null, "not in the badge row");
    const groups = [...neu.querySelectorAll(".sct-tfo-group")];
    assert.ok(groups.length >= 1);
    for (const g of groups) {
      assert.ok(g.querySelector("h3.sct-tfo-h3").textContent.length > 0);
      const cards = [...g.querySelectorAll(".sct-tfo-card")];
      assert.ok(cards.length >= 1);
      for (const n of cards) {
        assert.match(n.dataset.pos, /^(QB|RB|WR|TE|K|DST)$/);
        assert.ok(n.querySelector("h4.sct-tfo-name").textContent.length > 0);
        assert.ok(n.querySelector(".sct-slot"));
        assert.ok(n.querySelector(".sct-tfo-note").textContent.length > 0);
        assert.ok(n.querySelector("img.sct-tfo-wm[aria-hidden='true']"), "a crest watermark, hidden from readers");
        const photo = n.querySelector(".sct-tfo-photo");
        if (photo) assert.match(photo.getAttribute("src"), /\/news-image\//);
      }
    }
    assert.equal(neu.querySelectorAll("h3").length, groups.length, "H3s are the groups");
    assert.ok(doc.querySelectorAll('[data-sct-faq-for="outlook"] .sct-faq-q').length > 0, "the Outlook FAQ renders");
    assert.doesNotMatch(neu.innerHTML, /—/);
    const ids = [...doc.querySelectorAll("[id]")].map((el) => el.id);
    assert.equal(new Set(ids).size, ids.length, "ids are unique");
  });

  test("the heading keeps its words and adds the short phone title; the stamp marks its season part", () => {
    const { doc } = pre();
    const head = doc.querySelector("#outlook-premium .sct-up-head");
    assert.match(head.querySelector("h2.sct-tfo-title").textContent, /^New England Patriots Fantasy Football Outlook & Stats \d{4}$/);
    assert.ok(head.querySelector(".sct-up-head-text.has-phone-title"), "the phone title is wired");
    assert.match(head.querySelector("p.sct-up-m-title[aria-hidden=true]").textContent, /^\d{4} Fantasy Outlook$/);
    const stamp = head.querySelector(".sct-tfo-stamp");
    assert.match(stamp.querySelector(".sct-tfo-stamp-season").textContent, /NFL Season/);
    assert.equal(stamp.querySelectorAll(".sct-tfo-stamp-season").length, 2, "the season and its separator");
    assert.match(stamp.querySelector(".sct-tfo-stamp-when").textContent, /Written before Week 1|Preseason outlook/);
  });

  test("long prose is cut between sentences, never reworded", () => {
    const { doc } = pre();
    const outlook = JSON.parse(fs.readFileSync(path.join(APP_DIR, "data", "team", "outlooks_2026.json"), "utf8")).teams.ne;
    const ledes = [...doc.querySelectorAll("#outlook-premium .sct-tfo-lede")].map((p) => p.textContent);
    assert.ok(ledes.length >= 1);
    assert.equal(ledes.join(" "), outlook.summary.replace(/\s+/g, " "), "the summary's words, in order");
    for (const p of ledes.slice(0, -1)) assert.match(p, /[.!?]["”’)]?$/, "each cut ends a sentence");
    const card = doc.querySelector("#outlook-premium .sct-tfo-card");
    const notes = [...card.querySelectorAll(".sct-tfo-note")].map((p) => p.textContent);
    const name = card.querySelector(".sct-tfo-name").textContent;
    const src = outlook.groups.flatMap((g) => g.players).find((pl) => pl.name === name);
    assert.equal(notes.join(" "), src.note.replace(/\s+/g, " "));
    assert.doesNotMatch(notes.join("|"), /\b(?:A\.J|St|Jr|No)\.\|/, "no cut after an abbreviation");
  });
});
