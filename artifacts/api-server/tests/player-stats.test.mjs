/**
 * Advanced player stats regression tests.
 *
 * Two halves, like the other tools' suites. The served HTML is asserted with
 * no JavaScript run, because the point of the port is that the table arrives
 * complete — the standalone app it replaced was an empty iframe to anything
 * that did not execute a React bundle. Then the real bundle is run against
 * that HTML in jsdom, because sorting, the filter bar, the section pills and
 * the season switch are the standalone app's behaviour and have to survive
 * the move from React state to enhancement.
 *
 * The data is the committed `data/player-stats/` tables, not a fixture: they
 * are finished seasons and do not move under the tests.
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

let server;

before(async () => {
  server = await startServer();
});

after(async () => {
  await server?.stop();
  await cleanupBundles();
});

function rawGet(pathname, headers = {}) {
  const url = new URL(pathname, server.origin);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: "GET",
        headers,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, body }),
        );
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

describe("the data module", () => {
  let mod;

  before(async () => {
    mod = await importModule("lib/player-stats/stats-data");
  });

  test("discovers the seasons and the multi-season table", () => {
    assert.deepEqual(mod.getStatsSeasons(), [2023, 2024, 2025, 2026, "all"]);
    assert.equal(mod.defaultSeason(), 2026);
    // The span the multi-season table holds, read off its rows: 2026 is not
    // in it, whether or not 2026 has finished.
    assert.equal(mod.seasonLabel("all"), "2023-2025");
  });

  test("a season in progress shrinks its floors to the weeks played", (t) => {
    const qb = mod.getStatsTable("QB", 2026);
    // Past week 17 2026 is a finished season, and there is no season in
    // progress left to test this on until the next one starts.
    if (qb.week >= 17) {
      t.skip("2026 is finished");
      return;
    }
    const scale = Math.min(1, qb.week / 17);
    assert.ok(qb.week >= 1, `2026 runs through week ${qb.week}`);
    assert.deepEqual(qb.defaults, mod.defaultThresholds("QB", false, scale));
    assert.equal(qb.defaults.minPassAtt, Math.ceil(50 * scale));
    assert.match(qb.lsFooter, new RegExp(`under ${Math.ceil(5 * scale)} G / ${Math.ceil(100 * scale)} Att`));
    // A finished season keeps the standalone app's.
    assert.deepEqual(mod.getStatsTable("QB", 2025).defaults, mod.defaultThresholds("QB", false));
    for (const pos of mod.STATS_POSITIONS) {
      const table = mod.getStatsTable(pos, 2026);
      const shown = table.rows.filter((r) => r.shownByDefault);
      assert.ok(shown.length >= 10, `${pos}: ${shown.length} shown by default`);
      assert.ok(table.rows.filter((r) => r.qualified).length >= 10, `${pos} has a qualified pool`);
    }
  });

  test("WR/TE grade Opportunity, on in-season weights while a season is in progress", () => {
    for (const pos of ["WR", "TE"]) {
      for (const season of [2025, 2026]) {
        const table = mod.getStatsTable(pos, season);
        const grades = table.groups.at(-1).columns;
        const opp = grades.find((c) => c.key === "opportunityScore");
        assert.equal(opp?.label, "Opportunity", `${pos} ${season}`);
        assert.ok(!grades.some((c) => c.key === "volumeScore"), `${pos} ${season} has no Volume`);
        assert.match(opp.tooltip, season === 2026 ? /Snap% 20%/ : /Routes 15%/);
        const prod = grades.find((c) => c.key === "productionScore");
        assert.equal(prod?.label, "Production", `${pos} ${season}`);
        assert.ok(!grades.some((c) => c.key === "efficiencyScore"), `${pos} ${season} has no Efficiency`);
        assert.match(prod.tooltip, season === 2026 ? /left out until routes/ : /Rec Yds\/G 25%/);
      }
    }
    // Targets per game leads it: the WR target leader per game is near the top.
    const wr = mod.getStatsTable("WR", 2026).rows.filter((r) => r.qualified);
    const perGame = (r) => r.values.targets / r.values.games;
    const leader = wr.reduce((a, b) => (perGame(b) > perGame(a) ? b : a));
    assert.ok(leader.values.opportunityScore >= 80, `${leader.name}: ${leader.values.opportunityScore}`);
  });

  test("columns with no 2026 source are blank and out of the grades", () => {
    const wr = mod.getStatsTable("WR", 2026);
    for (const key of ["targetsPerRouteRun", "yardsPerRouteRun"]) {
      assert.ok(wr.groups.some((g) => g.columns.some((c) => c.key === key)), `${key} is still a column`);
    }
    // Until nflverse publishes participation, every route figure is blank.
    const routes = wr.rows.every((r) => r.values.routes == null);
    if (routes) assert.ok(wr.rows.every((r) => r.values.yardsPerRouteRun == null && r.values.targetsPerRouteRun == null));
    // A blank stat scores nobody zero: the best production grade can still be
    // near the top, as it could not if YPRR's 10% were a zero for everyone.
    const best = Math.max(...wr.rows.map((r) => r.values.productionScore));
    assert.ok(best >= 92, `best WR production ${best}`);
  });

  test("opens on the standalone app's default thresholds", () => {
    // getDefaultFilters() in the standalone FilterBar.tsx, value for value.
    assert.deepEqual(mod.defaultThresholds("QB", false), {
      minGP: 6, minSnapPct: 25, minRushAtt: 0, minTgt: 0, minPassAtt: 50,
    });
    assert.deepEqual(mod.defaultThresholds("RB", false), {
      minGP: 6, minSnapPct: 10, minRushAtt: 20, minTgt: 0, minPassAtt: 0,
    });
    assert.deepEqual(mod.defaultThresholds("TE", false), {
      minGP: 6, minSnapPct: 25, minRushAtt: 0, minTgt: 25, minPassAtt: 0,
    });
    assert.deepEqual(mod.defaultThresholds("RB", true), {
      minGP: 18, minSnapPct: 10, minRushAtt: 60, minTgt: 0, minPassAtt: 0,
    });
    assert.deepEqual(mod.defaultThresholds("WR", true), {
      minGP: 15, minSnapPct: 25, minRushAtt: 0, minTgt: 75, minPassAtt: 0,
    });
  });

  test("grades every row of every table from 0 to 100", () => {
    for (const pos of mod.STATS_POSITIONS) {
      for (const season of mod.getStatsSeasons()) {
        const table = mod.getStatsTable(pos, season);
        assert.ok(table, `${pos} ${season} loads`);
        for (const row of table.rows) {
          const grade = row.values[table.overallKey];
          assert.ok(
            Number.isInteger(grade) && grade >= 0 && grade <= 100,
            `${pos} ${season} ${row.name}: ${grade}`,
          );
        }
        // Sorted by the overall grade, best first — the opening sort.
        const grades = table.rows.map((r) => r.values[table.overallKey]);
        assert.deepEqual(grades, [...grades].sort((a, b) => b - a));
      }
    }
  });

  test("the grades group is last and the Player Info group first", () => {
    const table = mod.getStatsTable("QB", 2025);
    assert.equal(table.groups[0].label, "Player Info");
    assert.equal(table.groups.at(-1).label, "StatChasers QB Grades");
    assert.equal(table.groups.at(-1).columns[0].key, "overallQBGrade");
    // The file the tool shipped with carries AY/Att; the player pages' copy
    // does not, and the accuracy grade weights it.
    assert.ok(
      table.groups.some((g) => g.columns.some((c) => c.key === "airYardsPerAttempt")),
    );
  });

  test("RB Volume and Production are per-game blends, and Production replaced Efficiency", async () => {
    const rb = await importModule("lib/player-stats/scores/rbCompositeScores");
    assert.deepEqual(
      rb.RB_SCORE_CATEGORIES.map((c) => c.label),
      ["Overall", "Volume", "Production", "Explosiveness", "Receiving", "Elusiveness"],
    );

    // Two backs identical but for games played: the one who did it in fewer
    // games is ahead on every per-game input, so on both grades.
    const base = {
      rushAttempts: 200, targets: 40, snapPct: 60, goalLineCarries: 8, redZoneOpportunities: 30,
      rushYards: 900, receivingYards: 300, yardsPerCarry: 4.5, receptions: 30, fantasyPoints: 180,
    };
    const pool = Array.from({ length: 20 }, (_, i) => ({ ...base, games: 17, rushAttempts: 100 + i * 10 }));
    const [fewer, more] = rb.computeRbCompositeScores([...pool, { ...base, games: 12 }, { ...base, games: 17 }]).slice(-2);
    assert.ok(fewer.volumeScore > more.volumeScore);
    assert.ok(fewer.productionScore > more.productionScore);

    // The Volume weights, exactly: a back top of the pool on rush att/game
    // alone scores its 35%.
    const flat = { ...base, games: 17 };
    const rows = [...Array.from({ length: 10 }, () => flat), { ...flat, rushAttempts: 400 }];
    assert.equal(rb.computeRbCompositeScores(rows).at(-1).volumeScore, Math.round(100 * (10 / 11) * 0.35));
    // The Overall weights, exactly.
    for (const g of rb.computeRbCompositeScores(rows)) {
      const blend =
        g.volumeScore * 0.35 + g.productionScore * 0.35 + g.explosivenessScore * 0.15 +
        g.receivingScore * 0.05 + g.elusivenessScore * 0.10;
      assert.ok(Math.abs(g.overallRBGrade - blend) <= 0.5);
    }
  });

  test("leader cards are stat leaders from qualified players under the default filters", () => {
    for (const pos of mod.STATS_POSITIONS) {
      const table = mod.getStatsTable(pos, 2025);
      assert.equal(table.cards.length, 5);
      for (const card of table.cards) {
        const player = card.total.player;
        assert.ok(player, `${pos} ${card.title} has a leader`);
        assert.match(card.title, / Leader$/);
        assert.ok(player.qualified, `${pos} ${card.title} leader is qualified`);
        assert.ok(player.shownByDefault, `${pos} ${card.title} leader passes the defaults`);
      }
    }
    // The figure is the leader's own, and nobody in the pool beats it; the
    // note under it is the same leader's other reading.
    const wr = mod.getStatsTable("WR", 2025);
    const yards = wr.cards.find((c) => c.title === "Receiving Yards Leader");
    const pool = wr.rows.filter((r) => r.shownByDefault && r.qualified);
    const most = Math.max(...pool.map((r) => r.values.receivingYards));
    const leader = yards.total.player;
    assert.equal(leader.values.receivingYards, most);
    assert.equal(yards.total.figure, most.toLocaleString("en-US"));
    assert.equal(yards.total.note, `${(most / leader.values.games).toFixed(1)} per game`);
    assert.match(yards.perGame.note, /^[\d,]+ total$/);
    const share = wr.cards.find((c) => c.title === "Target Share Leader");
    assert.match(share.total.figure, /^\d+\.\d%$/);
    assert.equal(share.total.note, `on ${share.total.player.values.targets} targets`);
    assert.equal(share.perGame, null);
    // Receivers' air yards are AY/TGT × targets: the feed has no total.
    const air = wr.cards.find((c) => c.title === "Air Yards Leader");
    const ay = Math.round(air.total.player.values.airYardsPerTarget * air.total.player.values.targets);
    assert.equal(air.total.figure, ay.toLocaleString("en-US"));
  });

  test("the sections are named for what people search for", () => {
    const labels = (pos) => mod.getStatsTable(pos, 2025).groups.map((g) => g.label);
    assert.deepEqual(labels("WR"), [
      "Player Info", "Usage & Opportunity", "Receiving Stats", "Efficiency & Hands",
      "YAC & Elusiveness", "Explosive Plays", "StatChasers WR Grades",
    ]);
    assert.ok(labels("QB").includes("Passing Stats"));
    assert.ok(labels("RB").includes("Rushing Stats") && labels("RB").includes("Receiving Stats"));
  });

  test("the tables are cut to weeks 1-17, with the uncuttable columns flagged", () => {
    for (const pos of mod.STATS_POSITIONS) {
      for (const season of [2023, 2024, 2025]) {
        const table = mod.getStatsTable(pos, season);
        assert.equal(table.weeks, "1-17", `${pos} ${season}`);
        // Week 18 is the only way to an 18th game.
        assert.ok(table.rows.every((r) => r.values.games <= 17), `${pos} ${season} games`);
      }
    }
    // Puka Nacua, 2025: 129 catches for 1,715 yards in 16 games over weeks
    // 1-18; Sleeper's box scores for weeks 1-17 say 119 for 1,639 in 15.
    const puka = mod.getStatsTable("WR", 2025).rows.find((r) => r.name === "Puka Nacua");
    assert.deepEqual(
      [puka.values.games, puka.values.receptions, puka.values.receivingYards],
      [15, 119, 1639],
    );
    const qb = mod.getStatsTable("QB", 2025);
    const onTarget = qb.groups.flatMap((g) => g.columns).find((c) => c.key === "onTargetPct");
    assert.equal(onTarget.fullSeason, true, "no weekly source, so still weeks 1-18");
    const throwaways = qb.groups.flatMap((g) => g.columns).find((c) => c.key === "throwaways");
    assert.equal(throwaways.perGame, false, "a weeks 1-18 count is not divided by weeks 1-17 games");
  });

  test("a season or position the files do not have is refused", () => {
    assert.equal(mod.parseSeason("2019"), null);
    assert.equal(mod.parseSeason("25"), null);
    assert.equal(mod.parseSeason("ALL"), "all");
    assert.equal(mod.parsePosition("k"), null);
    assert.equal(mod.parsePosition("wr"), "WR");
  });
});

/* ------------------------------------------------------------- the server */

describe("the pages", () => {
  test("the bare path is the quarterback table, complete without JavaScript", async () => {
    const { status, headers, body, doc } = await page("/player-stats");
    assert.equal(status, 200);
    assert.equal(headers["x-robots-tag"], "noindex, indexifembedded");
    // The newest season, the one in progress.
    assert.equal(doc.title, "2026 NFL Player Stats & Fantasy Football Stats | StatChasers");
    assert.equal(doc.querySelector("h1").textContent, "2026 NFL Player Stats & Fantasy Football Stats");
    assert.equal(doc.querySelectorAll("h1").length, 1);
    assert.equal(doc.querySelector(".sca-hero"), null, "no heading block over the table");
    assert.match(doc.querySelector(".sca-intro").textContent, /^Compare 2026 NFL player stats for quarterbacks/);
    const finished = await page("/player-stats?season=2025");
    assert.equal(
      doc.querySelector('link[rel="canonical"]').getAttribute("href"),
      `${server.origin}/player-stats`,
    );

    const rows = finished.doc.querySelectorAll(".sca-table tbody tr");
    // 73: the snapshot's 76, less three whose only game was week 18.
    assert.equal(rows.length, 73, "every quarterback in the file is in the HTML");
    const shown = [...rows].filter((r) => !r.hasAttribute("hidden"));
    assert.ok(shown.length > 20 && shown.length < rows.length, "the defaults hide the backups");
    assert.equal(shown[0].querySelector(".sca-rank").textContent, "1");
    assert.doesNotMatch(body, /NaN|undefined|\[object Object\]/);
  });

  test("the rows a default filter hides are the ones it should", async () => {
    const { doc } = await page("/player-stats?season=2025");
    for (const row of doc.querySelectorAll(".sca-table tbody tr")) {
      const games = Number(row.dataset.games || 0);
      const att = Number(row.dataset.att || 0);
      const snap = row.dataset.snap;
      const passes = games >= 6 && att >= 50 && (snap === "" || Number(snap) >= 25);
      assert.equal(!row.hasAttribute("hidden"), passes, row.dataset.name);
    }
  });

  test("each other position is its own page with its own canonical", async () => {
    for (const pos of ["rb", "wr", "te"]) {
      const { status, doc } = await page(`/player-stats/${pos}`);
      assert.equal(status, 200);
      assert.equal(
        doc.querySelector('link[rel="canonical"]').getAttribute("href"),
        `${server.origin}/player-stats/${pos}`,
      );
      assert.equal(doc.querySelector("[data-sca-root]").dataset.position, pos.toUpperCase());
    }
  });

  test("the season changes the table and never the canonical", async () => {
    const { doc } = await page("/player-stats/wr?season=all");
    assert.equal(doc.querySelector("[data-sca-root]").dataset.season, "all");
    assert.equal(
      doc.querySelector('link[rel="canonical"]').getAttribute("href"),
      `${server.origin}/player-stats/wr`,
    );
    assert.equal(doc.querySelector(".sca-meta-season").textContent, "2023-2025");
    // A season the files do not have falls back to the newest, not an error.
    const old = await page("/player-stats?season=1999");
    assert.equal(old.status, 200);
    assert.equal(old.doc.querySelector("[data-sca-root]").dataset.season, "2026");
  });

  test("/qb is the bare path, and a second spelling is not a page", async () => {
    const qb = await rawGet("/player-stats/qb?season=2024");
    assert.equal(qb.status, 301);
    assert.equal(qb.headers.location, "/player-stats?season=2024");
    assert.equal((await rawGet("/player-stats/RB")).status, 404);
    assert.equal((await rawGet("/player-stats/k")).status, 404);
  });

  test("controls that need the bundle ship hidden", async () => {
    const { doc } = await page("/player-stats/rb");
    assert.ok(doc.querySelector("[data-sca-filters]").hasAttribute("hidden"));
    assert.ok(doc.querySelector("[data-sca-sections]").hasAttribute("hidden"));
    assert.equal(doc.querySelectorAll(".sca-sort").length, 0, "sort buttons are built, not shipped");
    // The season and position controls are links, and work without it.
    assert.equal(doc.querySelectorAll("[data-sca-seasons] a[href]").length, 5);
    assert.equal(doc.querySelectorAll("[data-sca-positions] a[href]").length, 4);
  });

  test("player names link to player pages by Sleeper id", async () => {
    const { doc } = await page("/player-stats");
    const maye = [...doc.querySelectorAll(".sca-player-link")].find(
      (a) => a.querySelector(".sca-name-full").textContent === "Drake Maye",
    );
    assert.ok(maye, "Drake Maye is linked");
    assert.equal(maye.getAttribute("href"), "/player/drake-maye/");
    assert.equal(maye.getAttribute("target"), "_top");
  });

  test("five stat leaders with nothing over them, each naming a player and leading with the figure", async () => {
    const { doc } = await page("/player-stats/te");
    assert.equal(doc.querySelector(".sca-leaders .sca-eyebrow"), null, "no label over the leaders");
    assert.equal(doc.querySelector(".sca-leaders h2"), null, "no heading over the leaders");
    assert.equal(doc.querySelector(".sca-leaders .sca-lede"), null, "and no copy");
    const leaders = doc.querySelectorAll(".sca-leaders .sca-leader");
    assert.equal(leaders.length, 5);
    for (const leader of leaders) {
      assert.notEqual(leader.querySelector(".sca-leader-name").textContent.trim(), "-");
      assert.match(leader.querySelector(".sca-leader-cat").textContent, / Leader$/);
      assert.match(leader.querySelector(".sca-leader-num").textContent, /^[\d.,]+%?$/);
    }
    // Only the sections after the table carry a label; none of them is a card.
    assert.deepEqual(
      [...doc.querySelectorAll(".sca-section .sca-eyebrow")].map((e) => e.textContent),
      ["Advanced Analysis", "Questions"],
    );
    assert.equal(doc.querySelector(".sca-stats h2"), null, "no heading over the table");
  });

  test("each counting leader has a per-game leader beside it, and a share does not", async () => {
    for (const season of ["2025", "2026"]) {
      const { doc } = await page(`/player-stats/wr?season=${season}`);
      const leaders = [...doc.querySelectorAll(".sca-leader")];
      const byCat = (cat) => leaders.find((l) => l.querySelector(".sca-leader-cat").textContent === cat);

      const share = byCat("Target Share Leader");
      assert.equal(share.querySelector(".sca-leader-pg"), null);
      assert.match(share.querySelector(".sca-leader-note").textContent, /^on \d+ targets$/);

      const yards = byCat("Receiving Yards Leader");
      const pg = yards.querySelector(".sca-leader-pg");
      assert.match(yards.querySelector(".sca-leader-total .sca-leader-note").textContent, /^\d+\.\d per game$/);
      assert.match(pg.querySelector(".sca-leader-note").textContent, /^[\d,]+ total$/);
      assert.match(pg.querySelector(".sca-leader-num").textContent, /^\d+\.\d$/);

      // It is the best yards-per-game figure among the rows shown by default
      // that played three quarters of the most games any of them did.
      const idx = [...doc.querySelectorAll(".sca-head th")].findIndex((th) => th.dataset.key === "receivingYards");
      const pool = [...doc.querySelectorAll(".sca-table tbody tr:not([hidden])")].filter((r) => !r.querySelector(".sca-ls"));
      const floor = Math.ceil(Math.max(...pool.map((r) => Number(r.dataset.games))) * 0.75);
      const best = Math.max(
        ...pool
          .filter((r) => Number(r.dataset.games) >= floor)
          .map((r) => Number(r.cells[idx].textContent.replace(/,/g, "")) / Number(r.dataset.games)),
      );
      assert.equal(pg.querySelector(".sca-leader-num").textContent, best.toFixed(1), season);
    }
  });

  test("each position page is titled for its own stats", async () => {
    const expect = { rb: "Running Back", wr: "Wide Receiver", te: "Tight End" };
    for (const [pos, name] of Object.entries(expect)) {
      const { doc } = await page(`/player-stats/${pos}`);
      assert.equal(doc.title, `2026 NFL ${name} Stats & Fantasy Football Stats | StatChasers`);
      assert.equal(doc.querySelector(".sca-hero"), null, `${pos} has no heading block over the table`);
      assert.match(doc.querySelector('meta[name="description"]').content, new RegExp(`^2026 NFL ${name.toLowerCase()} stats`));
    }
    // A past season does not change the page's title.
    const past = await page("/player-stats/wr?season=2024");
    assert.match(past.doc.title, /^2026 NFL Wide Receiver Stats/);
  });

  test("the FAQ is on the page and in a FAQPage node, and the copy block follows the table", async () => {
    const { doc } = await page("/player-stats/wr");
    assert.equal(doc.querySelector(".sca-faq-block h2").textContent, "NFL Player Stats FAQ");
    const questions = [...doc.querySelectorAll(".sca-faq-q")].map((q) => q.textContent);
    assert.equal(questions.length, 12);
    assert.ok(questions.includes("Who are the NFL stat leaders in 2026?"));
    const node = JSON.parse(doc.querySelector('script[type="application/ld+json"]').textContent);
    assert.equal(node["@type"], "FAQPage");
    assert.deepEqual(node.mainEntity.map((q) => q.name), questions);
    assert.equal(doc.querySelector(".sca-copy h2").textContent, "Advanced NFL Stats for Fantasy Football");
  });

  test("the embed hands WordPress its title, H1, description and FAQ as data, with no H1 of its own", async () => {
    const html = await (await fetch(`${server.origin}/embed/player-stats?pos=wr`)).text();
    assert.doesNotMatch(html, /<h1|application\/ld\+json/);
    const meta = JSON.parse(html.match(/<script type="application\/json" class="sca-page-data">(.*?)<\/script>/)[1]);
    assert.deepEqual(Object.keys(meta), ["title", "h1", "description"]);
    assert.equal(meta.h1, "2026 NFL Wide Receiver Stats & Fantasy Football Stats");
    const faq = JSON.parse(html.match(/<script type="application\/json" class="sca-faq-data">(.*?)<\/script>/)[1]);
    assert.equal(faq.length, 12);
    // The bare page is the master page, whatever season a reader opens.
    const bare = await (await fetch(`${server.origin}/embed/player-stats?pos=qb&season=2024`)).text();
    assert.match(bare, /"title":"2026 NFL Player Stats & Fantasy Football Stats"/);
  });

  test("an unchanged page answers 304", async () => {
    const first = await rawGet("/player-stats/wr");
    assert.ok(first.headers.etag);
    const again = await rawGet("/player-stats/wr", { "If-None-Match": first.headers.etag });
    assert.equal(again.status, 304);
  });
});

describe("the WordPress fragment", () => {
  test("is bare markup whose own links are the WordPress addresses", async () => {
    const { status, body, doc } = await page("/embed/player-stats?pos=rb&season=2024");
    assert.equal(status, 200);
    assert.doesNotMatch(body, /<html|<head[\s>]|<title/);

    const root = doc.querySelector("[data-sca-root]");
    assert.ok(root.classList.contains("is-embed"));
    assert.equal(root.dataset.scaEndpoint, `${server.origin}/embed/player-stats`);

    const positions = [...doc.querySelectorAll("[data-sca-positions] a")].map((a) =>
      a.getAttribute("href"),
    );
    assert.deepEqual(positions, [
      "/nfl/nfl-player-stats/?season=2024",
      "/nfl/nfl-player-stats/rb/?season=2024",
      "/nfl/nfl-player-stats/wr/?season=2024",
      "/nfl/nfl-player-stats/te/?season=2024",
    ]);
    // `embed` is a reserved WordPress query var: it must never ride along on
    // a statchasers.com address.
    assert.doesNotMatch(
      [...doc.querySelectorAll("[data-sca-seasons] a, [data-sca-positions] a")]
        .map((a) => a.getAttribute("href"))
        .join(" "),
      /embed=/,
    );
  });

  test("an unknown position falls back to quarterbacks", async () => {
    const { doc } = await page("/embed/player-stats?pos=k");
    assert.equal(doc.querySelector("[data-sca-root]").dataset.position, "QB");
  });
});

/* --------------------------------------------------------------- the bundle */

/** Waits for the bundle's swap rather than guessing how long it takes. */
async function until(done, ms = 5000) {
  const start = Date.now();
  while (!done() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 25));
}

describe("the bundle", () => {
  let bundle;

  before(async () => {
    bundle = await readFile(path.join(APP_DIR, "public", "dist", "statchasers-player-stats.js"), "utf8");
  });

  /** A host page with the fragment in it, and the real bundle run against it. */
  async function mount(query = "") {
    const fragment = await (await fetch(`${server.origin}/embed/player-stats${query}`)).text();
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on("jsdomError", (e) => errors.push(String(e)));
    const dom = new JSDOM(
      `<!doctype html><html><body><h1>NFL Player Stats</h1>${fragment}</body></html>`,
      {
        runScripts: "outside-only",
        url: "https://statchasers.com/nfl/nfl-player-stats/",
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
    await new Promise((r) => setTimeout(r, 50));
    const doc = window.document;
    const root = doc.querySelector("[data-sca-root]");
    const visible = () => [...doc.querySelectorAll(".sca-table tbody tr")].filter((r) => !r.hidden);
    const header = (key) => doc.querySelector(`.sca-head th[data-key="${key}"]`);
    const input = (name) => doc.querySelector(`[data-sca-filters] input[name="${name}"]`);
    const type = (el, value) => {
      el.value = value;
      el.dispatchEvent(new window.Event("input", { bubbles: true }));
    };
    return { window, doc, root, errors, fetched, visible, header, input, type };
  }

  test("wires up without errors and shows the controls", async () => {
    const { doc, errors } = await mount();
    assert.deepEqual(errors, []);
    assert.ok(!doc.querySelector("[data-sca-filters]").hidden);
    assert.ok(!doc.querySelector("[data-sca-sections]").hidden);
    assert.ok(doc.querySelectorAll(".sca-sort").length > 40);
    assert.equal(doc.querySelector("[data-sca-positions] summary").textContent, "QB Stats");
    assert.equal(
      doc.querySelector('th[data-key="overallQBGrade"]').getAttribute("aria-sort"),
      "descending",
      "the header says which sort the server already applied",
    );
  });

  test("sorting reads the figure off the text and sinks missing values", async () => {
    const { doc, window, header, visible } = await mount();
    const yards = header("passingYards").querySelector(".sca-sort");
    yards.dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0 }));

    const idx = header("passingYards").cellIndex;
    const values = visible().map((r) => Number(r.cells[idx].textContent.replace(/,/g, "")));
    assert.deepEqual(values, [...values].sort((a, b) => b - a), "descending first");
    assert.equal(visible()[0].querySelector(".sca-rank").textContent, "1");

    yards.dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0 }));
    const up = visible().map((r) => Number(r.cells[idx].textContent.replace(/,/g, "")));
    assert.deepEqual(up, [...up].sort((a, b) => a - b), "then ascending");
    assert.equal(header("passingYards").getAttribute("aria-sort"), "ascending");

    // A column with dashes in it: they stay at the bottom both ways.
    const cpoe = header("cpoe");
    const ci = cpoe.cellIndex;
    for (let i = 0; i < 2; i += 1) {
      cpoe.querySelector(".sca-sort").dispatchEvent(
        new window.MouseEvent("click", { bubbles: true, button: 0 }),
      );
      const cells = [...doc.querySelectorAll(".sca-table tbody tr")].map((r) => r.cells[ci].textContent);
      const firstDash = cells.indexOf("-");
      if (firstDash >= 0) {
        assert.ok(cells.slice(firstDash).every((c) => c === "-"), "missing values sink");
      }
    }
  });

  test("the filter bar narrows and widens the rows already on the page", async () => {
    const { input, type, visible, doc } = await mount("?season=2025");
    const start = visible().length;

    type(input("minGP"), "0");
    type(input("minSnapPct"), "0");
    type(input("minPassAtt"), "0");
    assert.equal(visible().length, 73, "every quarterback once the floors are gone");
    assert.equal(doc.querySelector("[data-sca-count]").textContent, "73");

    type(input("search"), "allen");
    assert.ok(visible().length >= 1 && visible().length < start);
    assert.ok(visible().every((r) => r.dataset.name.includes("allen")));
  });

  test("a view shows its groups and hides the rest, and Overview brings them all back", async () => {
    const { doc, window, root, header } = await mount("?pos=rb");
    const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0 }));
    const views = [...doc.querySelectorAll("[data-sca-sections] [data-view]")];
    assert.deepEqual(
      views.map((v) => v.textContent),
      ["Overview", "Usage & Opportunity", "Rushing", "Receiving", "Efficiency", "Advanced"],
    );
    assert.equal(views[0].getAttribute("aria-pressed"), "true", "opens on Overview");
    const firstRow = doc.querySelector(".sca-table tbody tr");
    const hiddenAt = (key) => firstRow.cells[header(key).cellIndex].hidden;

    click(views.find((v) => v.textContent === "Receiving"));
    assert.equal(root.dataset.view, "receiving");
    assert.ok(!header("receivingYards").hidden);
    assert.ok(!header("age").hidden, "Player Info rides along");
    assert.ok(header("rushYards").hidden);
    assert.ok(hiddenAt("rushYards"));
    assert.ok(header("overallRBGrade").hidden);

    click(views.find((v) => v.textContent === "Advanced"));
    assert.ok(!header("overallRBGrade").hidden);
    assert.ok(header("receivingYards").hidden);

    click(views[0]);
    assert.ok(!header("rushYards").hidden);
    assert.ok(!hiddenAt("rushYards"));
    assert.ok([...doc.querySelectorAll(".sca-band")].every((b) => !b.hidden));
  });

  test("the menus open one at a time, and More Filters holds and counts every floor", async () => {
    const { doc, window, input, type } = await mount("?pos=wr");
    const menus = [...doc.querySelectorAll("details.sca-menu")];
    const filterMenus = [...doc.querySelectorAll("[data-sca-filters] details")];
    assert.equal(filterMenus.length, 1, "one filter menu");
    const [more] = filterMenus;
    assert.deepEqual(
      [...more.querySelectorAll("input")].map((i) => i.name),
      ["minSnapPct", "minGP", "minTgt"],
    );

    const season = doc.querySelector("[data-sca-seasons]");
    season.open = true;
    season.dispatchEvent(new window.Event("toggle"));
    more.open = true;
    more.dispatchEvent(new window.Event("toggle"));
    assert.ok(!season.open && more.open, "opening one closes the other");
    doc.body.dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0 }));
    assert.ok(menus.every((m) => !m.open), "a click elsewhere closes it");

    const count = doc.querySelector('[data-sca-val="more"]');
    assert.ok(count.hidden, "no badge while More Filters is on its defaults");
    type(input("minSnapPct"), "40");
    assert.equal(count.textContent, "1");
    type(input("minTgt"), "0");
    assert.equal(count.textContent, "2");
    assert.ok(!count.hidden);
  });

  test("Per Game divides the counting columns by games and Totals puts them back", async () => {
    const { doc, window, root, header, visible, input, type } = await mount("?pos=wr");
    const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0 }));
    const perGame = doc.querySelector('[data-sca-mode] [data-mode="game"]');
    const totals = doc.querySelector('[data-sca-mode] [data-mode="total"]');
    assert.ok(!doc.querySelector("[data-sca-mode]").hidden);

    // Counts and FPTS are marked; rates, age, games and the longest play are not.
    for (const key of ["targets", "receivingYards", "receivingTouchdowns", "fantasyPoints", "drops"]) {
      assert.ok(header(key).hasAttribute("data-pg"), key);
    }
    for (const key of ["age", "games", "snapPct", "yardsPerRouteRun", "catchPct", "longestReception", "overallWRGrade"]) {
      assert.ok(!header(key).hasAttribute("data-pg"), key);
    }

    const row = visible()[0];
    const cell = (key) => row.cells[header(key).cellIndex].textContent;
    const games = Number(row.dataset.games);
    const yards = cell("receivingYards");
    const pct = cell("catchPct");

    click(perGame);
    assert.equal(root.dataset.mode, "game");
    assert.equal(perGame.getAttribute("aria-pressed"), "true");
    assert.ok(root.classList.contains("is-per-game"), "the meta line's Per Game flag shows");
    assert.equal(cell("receivingYards"), (Number(yards.replace(/,/g, "")) / games).toFixed(1));
    assert.equal(cell("catchPct"), pct, "a rate does not change");

    // A filter still reads season totals, not the per-game text.
    type(input("minTgt"), "100");
    assert.ok(visible().every((r) => Number(r.dataset.tgt) >= 100));

    // Sorting by a counting column orders by the per-game figure.
    const btn = header("receivingYards").querySelector(".sca-sort");
    click(btn);
    const ypg = visible().map((r) => Number(r.cells[header("receivingYards").cellIndex].textContent));
    assert.deepEqual(ypg, [...ypg].sort((a, b) => b - a));

    click(totals);
    assert.equal(root.dataset.mode, "total");
    assert.ok(!root.classList.contains("is-per-game"));
    assert.equal(cell("receivingYards"), yards, "the server's own text comes back");

    // The choice carries over a season switch; the new table arrives as totals.
    click(doc.querySelector('[data-sca-mode] [data-mode="game"]'));
    const link = doc.querySelector('[data-sca-seasons] a[data-sca-season="all"]');
    link.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    await until(() => root.dataset.season === "all");
    assert.equal(root.dataset.season, "all");
    const next = doc.querySelector(".sca-table tbody tr");
    const tgt = next.cells[header("targets").cellIndex];
    const perGameTgt = Number(next.dataset.tgt) / Number(next.dataset.games);
    assert.equal(tgt.textContent, perGameTgt.toFixed(perGameTgt >= 10 ? 1 : 2));
  });

  test("a season link swaps the table in place and moves nothing else", async () => {
    const { doc, window, root, fetched, errors } = await mount("?pos=wr");
    const before = window.location.href;
    const link = doc.querySelector('[data-sca-seasons] a[data-sca-season="all"]');
    link.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    await until(() => root.dataset.season === "all");

    assert.deepEqual(errors, []);
    assert.equal(fetched.length, 1);
    assert.match(fetched[0], /\/embed\/player-stats\?pos=wr&season=all$/);
    assert.equal(root.dataset.season, "all");
    assert.equal(window.location.href, before, "the address does not move");
    assert.equal(doc.querySelector(".sca-meta-season").textContent, "2023-2025");
    // The multi-season table opens on its own, tighter, defaults.
    assert.equal(doc.querySelector('[data-sca-filters] input[name="minTgt"]').value, "75");
    // The position strip is the page's own and stays, re-pointed at the season.
    assert.equal(
      doc.querySelector("[data-sca-positions] a").getAttribute("href"),
      "/nfl/nfl-player-stats/?season=all",
    );
    // The season menu names the new season and is closed again.
    assert.match(doc.querySelector("[data-sca-seasons] summary").textContent, /2023-2025$/);
    assert.ok(!doc.querySelector("[data-sca-seasons]").open);
    // The fresh table is wired: its headers are sort buttons again.
    assert.ok(doc.querySelectorAll(".sca-sort").length > 40);
  });
});
