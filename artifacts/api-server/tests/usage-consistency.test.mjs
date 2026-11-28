/**
 * Target-share fix B (mak, 2026-11-20): one target-share and snap-share
 * definition on the player pages, a labeled club season share on the team
 * /usage/ boards, and FAQ sentences whose counts, denominators and
 * percentages refer to the same games.
 *
 *   player pages  his targets (snaps) over his clubs' targets (snaps) in the
 *                 games he played, every club summed (team/usage-share.ts):
 *                 Overview meter = Stats card = Outlook tile = Outlook drivers
 *   Outlook PPG   the player header's figure
 *   /usage/       the fantasy table's share for the club = his games for that
 *                 club; the Target and Rushing Distribution boards keep the
 *                 club season share and say so
 *
 * The players: Brock Bowers (missed Weeks 1-2), Josh Downs (IND -> KC),
 * Kirk Cousins (LV -> MIN, a quarterback: points per game only), Keenan Allen
 * (IND -> SF), Marvin Harrison Jr. (ARI -> HOU) and Audric Estime (CLE -> NO,
 * a back: the advanced row's snap share). Numbers are read from the committed
 * data/team/usage_<season>.json, never hard-coded.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { startServer, APP_DIR } from "./helpers/server.mjs";
import { startUpstreamReplay } from "./helpers/upstream-replay.mjs";
import { cleanupBundles, importModule } from "./helpers/bundle.mjs";

const usageFile = fs
  .readdirSync(path.join(APP_DIR, "data", "team"))
  .filter((f) => /^usage_\d{4}\.json$/.test(f))
  .sort()
  .pop();
const usage = JSON.parse(fs.readFileSync(path.join(APP_DIR, "data", "team", usageFile), "utf8"));
const teamsMod = await importModule("lib/team/teams");

let server;
let replay;

before(async () => {
  replay = await startUpstreamReplay();
  server = await startServer(replay.env);
});

after(async () => {
  await server?.stop();
  await replay?.stop();
  await cleanupBundles();
});

async function doc(pathname) {
  const res = await fetch(`${server.origin}${pathname}`);
  assert.equal(res.status, 200, pathname);
  return new JSDOM(await res.text()).window.document;
}

const pctNum = (s) => (s == null ? null : parseFloat(String(s).replace("−", "-").replace(/[^0-9.\-]/g, "")));
const text = (el) => (el ? el.textContent.trim() : null);

/** His rows in the usage report (one per club), and his games-played counts at every club or one. */
function rowsOf(slug) {
  return Object.entries(usage.teams).flatMap(([club, t]) => t.players.filter((p) => p.slug === slug).map((row) => ({ club, row })));
}
function played(rows) {
  let tgt = 0, teamTgt = 0, snaps = 0, teamSnaps = 0, games = 0;
  for (const { club, row } of rows) {
    const byWeek = usage.teams[club].snapsByWeek ?? {};
    for (const w of row.weekly) {
      if (w.tgt === null && w.snapN === null) continue;
      games += 1;
      tgt += w.tgt ?? 0;
      teamTgt += w.teamTgt ?? 0;
      if (w.snapN !== null && typeof byWeek[String(w.week)] === "number") {
        snaps += w.snapN;
        teamSnaps += byWeek[String(w.week)];
      }
    }
  }
  return { tgt, teamTgt, snaps, teamSnaps, games };
}

/** Each tab's figures, read off the served pages. */
async function figures(slug) {
  const ov = await doc(`/player/${slug}/`);
  const st = await doc(`/player/${slug}/stats/`);
  const ol = await doc(`/player/${slug}/outlook/`);
  const meter = [...ov.querySelectorAll(".scp-ox-eff")].find((li) => text(li.querySelector(".scp-ox-eff-l")) === "Target share");
  const statRow = (label) =>
    [...st.querySelectorAll(".scp-stp-row")].find((li) => text(li.querySelector(".scp-stp-row-label")) === label);
  // Since 2026-11-27 (mak) the first three figures are Opportunity vs.
  // Production's primary tiles and the rest one volume row, labels in lower
  // case; both carry the value in a dd and the rank in a sub line.
  const kpi = (label) =>
    [...ol.querySelectorAll(".scp-olr-kpi, .scp-olr-vol-item")].find((k) => text(k.querySelector("dt")).toLowerCase() === label.toLowerCase());
  const driver = [...ol.querySelectorAll(".scp-olp-drv")].find((d) => text(d.querySelector(".scp-olp-h3")) === "Target share");
  // The advanced strip, or (nothing ranked yet, 2026-11-27) the drivers grid.
  const adv = [...ol.querySelectorAll(".scp-olp-adv-cell, .scp-olp-cell")].find((c) => text(c.querySelector("dt")) === "Snap share");
  return {
    header: pctNum(text(ov.querySelector(".scp-pboard .scp-pstat.is-lead b"))),
    overviewTs: pctNum(text(meter?.querySelector(".scp-ox-eff-v"))),
    statsTs: pctNum(text(statRow("Target share")?.querySelector(".scp-stp-row-value"))),
    statsSnap: pctNum(text(statRow("Snap share")?.querySelector(".scp-stp-row-value"))),
    tileTs: pctNum(text(kpi("Target share")?.querySelector("dd"))),
    tileTsRank: text(kpi("Target share")?.querySelector(".scp-olr-kpi-sub, .scp-olr-vol-sub")),
    tileSnap: pctNum(text(kpi("Snap share")?.querySelector("dd"))),
    tilePpg: pctNum(text(kpi("PPR points per game")?.querySelector("dd"))),
    driverTs: pctNum(text(driver?.querySelector(".scp-olp-drv-value strong"))),
    driverRail: driver?.querySelector(".scp-olp-rail")?.getAttribute("aria-label") ?? null,
    advSnap: pctNum(text(adv?.querySelector("dd"))),
    outlookText: ol.body.textContent,
  };
}

const round1 = (v) => Math.round(v * 10) / 10;

describe("player pages: one target share and snap share", () => {
  for (const slug of ["brock-bowers", "josh-downs", "keenan-allen", "marvin-harrison-jr"]) {
    test(`${slug}: Overview, Stats and Outlook print the same games-played shares`, async () => {
      const rows = rowsOf(slug);
      assert.ok(rows.length >= 1, `${slug} is in the usage report`);
      const want = played(rows);
      const ts = round1((100 * want.tgt) / want.teamTgt);
      const snap = (100 * want.snaps) / want.teamSnaps;
      const f = await figures(slug);
      // The Overview meter prints only for a player over its volume line.
      if (f.overviewTs !== null) assert.equal(f.overviewTs, ts, "Overview meter");
      assert.equal(f.statsTs, ts, "Stats card");
      assert.equal(f.tileTs, ts, "Outlook tile");
      assert.equal(f.driverTs, ts, "Outlook drivers row");
      assert.equal(f.statsSnap, round1(snap), "Stats card snap share");
      assert.equal(f.tileSnap, Math.round(snap), "Outlook tile snap share");
      // The tile's rank and the drivers' rank are one rank in one field.
      const m = f.tileTsRank?.match(/^(\d+)\D+ of (\d+)/);
      if (m) assert.match(f.driverRail ?? "", new RegExp(`ranks ${m[1]}\\D+ of ${m[2]} `), "tile and drivers share a rank");
      assert.doesNotMatch(f.outlookText, /leads his role/);
    });
  }

  test("a traded player is read over every club, not his new club's games", async () => {
    const rows = rowsOf("josh-downs");
    assert.ok(rows.length >= 2, "Downs has a row for each club");
    const now = rows.find((r) => r.row.games === Math.min(...rows.map((x) => x.row.games)));
    const f = await figures("josh-downs");
    assert.notEqual(f.tileTs, now.row.targetShare, "not the one-club row");
  });

  test("a back's advanced snap share is the games-played share", async () => {
    const rows = rowsOf("audric-estime");
    assert.ok(rows.length >= 1);
    const want = played(rows);
    const f = await figures("audric-estime");
    assert.equal(f.advSnap, round1((100 * want.snaps) / want.teamSnaps));
    assert.equal(f.statsSnap, f.advSnap);
  });

  for (const slug of ["brock-bowers", "josh-downs", "kirk-cousins", "keenan-allen"]) {
    test(`${slug}: Outlook PPR points per game is the header's figure`, async () => {
      const f = await figures(slug);
      assert.ok(f.header !== null && f.tilePpg !== null, `${slug} prints both`);
      assert.equal(f.tilePpg, f.header);
    });
  }
});

describe("/usage/: club season share, labeled; FAQ arithmetic", () => {
  const clubs = Object.keys(usage.teams)
    .map((k) => ({ key: k, team: teamsMod.getTeamByAbbreviation(k) }))
    .filter((c) => c.team);

  test("every club is reachable", () => {
    assert.equal(clubs.length, 32);
  });

  test("the distribution boards say Club season share, and the definitions no longer claim the player page's figures", async () => {
    const d = await doc(`/team/las-vegas-raiders/usage/`);
    const heads = [...d.querySelectorAll(".sct-up-board thead th.is-bar")].map((th) => th.textContent.trim());
    assert.ok(heads.length >= 1);
    for (const h of heads) assert.equal(h, "Club season share");
    for (const abbr of d.querySelectorAll(".sct-up-board thead th.is-bar abbr")) {
      assert.match(abbr.getAttribute("title"), /^Club season share: /);
    }
    assert.match(d.querySelector(".sct-up-snap-table thead th.is-bar abbr").getAttribute("title"), /club season share/);
    const defs = text(d.querySelector(".sct-us-defs"));
    assert.doesNotMatch(defs, /the same figures as his player page/);
    assert.match(defs, /club season share/);
  });

  test("the fantasy table's target share for a club is his games-played share at that club", async () => {
    const d = await doc(`/team/las-vegas-raiders/usage/`);
    const lv = played(rowsOf("brock-bowers").filter((r) => r.club === "lv"));
    const cap = [...d.querySelectorAll(".sct-us-cap-stat")].map((s) => s.textContent);
    assert.ok(cap.includes(`${round1((100 * lv.tgt) / lv.teamTgt).toFixed(1)}% target share`), cap.join(" | "));
  });

  test("every club's FAQ: counts, denominators and percentages agree", async () => {
    for (const { key, team } of clubs) {
      const d = await doc(`/team/${team.slug}/usage/`);
      const faq = [...d.querySelectorAll('script[type="application/ld+json"]')]
        .map((s) => JSON.parse(s.textContent))
        .find((j) => j["@type"] === "FAQPage");
      if (!faq) continue;
      const answers = Object.fromEntries(faq.mainEntity.map((q) => [q.name, q.acceptedAnswer.text]));
      const where = `${team.slug}`;
      const club = usage.teams[key];

      // 1. "with N targets ..., a P% share of the team's T"
      const q1 = Object.entries(answers).find(([q]) => /^Who leads the .* in targets\?$/.test(q))?.[1];
      if (q1) {
        const m = q1.match(/with (\d+) targets? .*?, an? ([\d.]+)% share of the team's (\d+)/);
        assert.ok(m, `${where} Q1: ${q1}`);
        assert.equal(((100 * +m[1]) / +m[3]).toFixed(1), m[2], `${where} Q1`);
        const second = q1.match(/is second with (\d+) \(([\d.]+)%\)/);
        if (second) assert.equal(((100 * +second[1]) / +m[3]).toFixed(1), second[2], `${where} Q1 second`);
      }

      // 2. "has played S of the ... D offensive snaps [in the N games he played] (P%)", then "Name (S snaps, P%)"
      const q2 = Object.entries(answers).find(([q]) => /^Who plays the most offensive snaps/.test(q))?.[1];
      if (q2) {
        const m = q2.match(/has played (\d+) of the .*? (\d+) offensive snaps(?: in the (\d+) games? he played)? \((\d+)%\)/);
        if (/has played/.test(q2)) {
          assert.ok(m, `${where} Q2: ${q2}`);
          assert.equal(Math.round((100 * +m[1]) / +m[2]), +m[4], `${where} Q2 passer: ${q2}`);
          if (!m[3]) {
            const total = Object.values(club.snapsByWeek ?? {}).reduce((s, n) => s + n, 0);
            assert.equal(+m[2], total, `${where} Q2: a whole-season denominator only when he played every game`);
          }
        }
        assert.match(q2, /in the games he played\.$/);
        for (const [, name, snaps, share] of q2.matchAll(/([A-Z][^,()]+?) \((\d+) snaps, (\d+)%\)/g)) {
          const row = club.players.find((p) => p.name === name.replace(/^(?:and |the team\. )/, "").trim());
          if (!row) continue;
          const own = played([{ club: key, row }]);
          assert.equal(own.snaps, +snaps, `${where} Q2 ${name} snaps`);
          assert.equal(Math.round((100 * own.snaps) / own.teamSnaps), +share, `${where} Q2 ${name} share`);
        }
      }

      // 6. "Name (P%)" shares of the club's T targets
      const q6 = Object.entries(answers).find(([q]) => /distribute his passes\?$/.test(q))?.[1];
      if (q6) {
        const total = +q6.match(/lead the (\d+) /)[1];
        for (const [, name, share] of q6.matchAll(/([A-Z][^,()]+?) \(([\d.]+)%\)/g)) {
          const row = club.players.find((p) => p.name === name.replace(/^and /, "").trim());
          if (!row) continue;
          assert.equal(((100 * row.targets) / total).toFixed(1), share, `${where} Q6 ${name}`);
        }
      }

      // 11. the target share beside WOPR is the club season share WOPR is built from
      const q11 = Object.entries(answers).find(([q]) => /best fantasy football usage profile\?$/.test(q))?.[1];
      const w = q11?.match(/^(.+?) has the .*? ([\d.]+)% share of the team's season targets and a ([\d.]+) WOPR/);
      if (w) {
        const row = club.players.find((p) => p.name === w[1]);
        assert.ok(row, `${where} Q11 player`);
        assert.equal(((100 * row.targets) / club.targets).toFixed(1), w[2], `${where} Q11 share`);
      }
      assert.doesNotMatch(q11 ?? "", /% target share and a [\d.]+ WOPR/, `${where} Q11 old wording`);
    }
  });
});

describe("/usage/: the fantasy table's percentile ranks the share printed under it (items 1 and 3)", () => {
  test("league-wide, a higher games-played target share never carries a lower percentile", async () => {
    const pairs = { WR: [], TE: [] };
    for (const k of Object.keys(usage.teams)) {
      const team = teamsMod.getTeamByAbbreviation(k);
      if (!team) continue;
      const d = await doc(`/team/${team.slug}/usage/`);
      for (const cell of d.querySelectorAll("td.is-opp")) {
        // The position from the bar's label ("63rd percentile vs. NFL WRs"):
        // the "pctile WR" unit under the figure came off 2026-11-21.
        const pos = /vs\. NFL ([A-Z]+)s$/.exec(cell.querySelector(".sct-us-pbar")?.getAttribute("aria-label") ?? "")?.[1] ?? "";
        const pct = Number.parseInt(cell.querySelector(".is-lead")?.textContent ?? "", 10);
        const m = /([\d.]+)% target share/.exec(cell.querySelector(".sct-us-cap-stat")?.textContent ?? "");
        if (!pairs[pos] || !m || !Number.isFinite(pct)) continue;
        pairs[pos].push({ share: Number(m[1]), pct, club: k });
      }
    }
    for (const [pos, list] of Object.entries(pairs)) {
      assert.ok(list.length > 20, `${pos}: enough rows`);
      list.sort((a, b) => a.share - b.share);
      for (let i = 1; i < list.length; i++) {
        const [a, b] = [list[i - 1], list[i]];
        if (b.share > a.share) assert.ok(b.pct >= a.pct, `${pos}: ${b.share}% (${b.club}) at ${b.pct} below ${a.share}% (${a.club}) at ${a.pct}`);
      }
    }
  });

  test("the Snap % help says games played, not the season", async () => {
    const d = await doc(`/team/las-vegas-raiders/usage/`);
    const html = d.body.innerHTML;
    assert.match(html, /share of the offense's snaps in the games he played for this club/);
    assert.doesNotMatch(html, /share of the offense's snaps, season to date/i);
  });
});

describe("depth chart PPR rank chip: the player's own season rank (2026-11-20)", () => {
  // Expected rank from the committed usage file: one entry per player, club
  // rows merged and points per game weighted by games, ranked by position.
  function expectedRank(slug) {
    const minGames = Math.min(2, Math.max(1, usage.throughWeek - 1));
    const merged = new Map();
    let loose = 0;
    for (const team of Object.values(usage.teams)) {
      for (const p of team.players) {
        if (p.fpPerGame === null || !p.games) continue;
        if (!p.sleeperId) { merged.set(`loose${loose++}`, { pos: p.pos, slug: null, games: p.games, points: p.fpPerGame * p.games }); continue; }
        const m = merged.get(p.sleeperId) ?? { pos: p.pos, slug: p.slug, games: 0, points: 0 };
        m.games += p.games; m.points += p.fpPerGame * p.games; merged.set(p.sleeperId, m);
      }
    }
    const me = [...merged.values()].find((m) => m.slug === slug);
    const pool = [...merged.values()].filter((m) => m.pos === me.pos && m.games >= minGames).map((m) => m.points / m.games);
    const mine = me.points / me.games;
    // Players level on points a game share a band; any place inside it.
    const near = (v) => Math.abs(v - mine) < 1e-9;
    return { pos: me.pos, best: pool.filter((v) => v > mine && !near(v)).length + 1, worst: pool.filter((v) => v > mine || near(v)).length };
  }
  function assertRank(chip, exp, who) {
    const m = /^([A-Z]+)(\d+)$/.exec(chip ?? "");
    assert.ok(m, `${who}: a chip (${chip})`);
    assert.equal(m[1], exp.pos);
    assert.ok(+m[2] >= exp.best && +m[2] <= exp.worst, `${who}: ${chip} not within ${exp.pos}${exp.best}-${exp.worst}`);
  }
  async function chipFor(teamSlug, name) {
    const d = await doc(`/team/${teamSlug}/depth-chart/`);
    for (const chip of d.querySelectorAll(".sct-dpp-ppr")) {
      const card = chip.closest("li, article, div");
      if ((card?.textContent ?? "").includes(name)) return chip.textContent.replace("PPR", "").trim();
    }
    return null;
  }
  test("a traded player is ranked on his whole season, not one club's slice", async () => {
    assertRank(await chipFor("san-francisco-49ers", "Keenan Allen"), expectedRank("keenan-allen"), "Keenan Allen");
    assertRank(await chipFor("kansas-city-chiefs", "Josh Downs"), expectedRank("josh-downs"), "Josh Downs");
  });
});
