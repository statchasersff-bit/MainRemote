/**
 * The team hub's Usage & Opportunity Report (src/lib/team/usage*.ts).
 *
 * Asserts the spec's acceptance checklist on the served HTML (what a crawler
 * reads) and, for the + / − profiles and the #usage tab, on the page with its
 * own bundle run. Numbers come from the committed data/team/usage_<season>.json,
 * so the checks read that file rather than hard-coding a week.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";
import { startServer, APP_DIR } from "./helpers/server.mjs";
import { startUpstreamReplay } from "./helpers/upstream-replay.mjs";

let server;
let replay;
const windows = [];

const usageFiles = fs
  .readdirSync(path.join(APP_DIR, "data", "team"))
  .filter((f) => /^usage_\d{4}\.json$/.test(f))
  .sort();
const usage = JSON.parse(
  fs.readFileSync(path.join(APP_DIR, "data", "team", usageFiles[usageFiles.length - 1]), "utf8"),
);

before(async () => {
  replay = await startUpstreamReplay();
  server = await startServer(replay.env);
});

after(async () => {
  for (const w of windows) {
    try {
      w.close();
    } catch {
      /* closed */
    }
  }
  await server?.stop();
  await replay?.stop();
});

async function page(pathname) {
  const res = await fetch(`${server.origin}${pathname}`);
  assert.equal(res.status, 200, pathname);
  const body = await res.text();
  return { body, doc: new JSDOM(body).window.document };
}

async function hydrated(pathname) {
  const res = await fetch(`${server.origin}${pathname}`);
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on("jsdomError", (e) => errors.push(String(e)));
  const jsdom = new JSDOM(await res.text(), {
    runScripts: "outside-only",
    url: `${server.origin}${pathname}`,
    pretendToBeVisual: true,
    virtualConsole,
  });
  windows.push(jsdom.window);
  jsdom.window.eval(fs.readFileSync(path.join(APP_DIR, "public", "dist", "statchasers-team.js"), "utf8"));
  await new Promise((r) => setTimeout(r, 50));
  return { window: jsdom.window, doc: jsdom.window.document, errors };
}

describe("placement", () => {
  test("the panel sits between Outlook and Stats, with id usage", async () => {
    const { doc } = await page("/team/buffalo-bills/");
    // Coaching sits between Usage and Stats since 2026-10-01, per its spec.
    // The strip carries the order; the Usage panel itself prints only at
    // /usage/ (ownsAddress in team-render.ts), so the hub has no #usage.
    const tabs = [...doc.querySelectorAll(".sct-nav-link")].map((a) => a.getAttribute("data-sct-panel-id"));
    assert.deepEqual(tabs.slice(0, 2), ["outlook", "usage"]);
    assert.ok(tabs.indexOf("stats") > tabs.indexOf("usage"));
    assert.equal(doc.getElementById("usage"), null, "the Usage panel is not printed on the hub");
    const labels = [...doc.querySelectorAll(".sct-nav-link")].map((a) => a.textContent);
    assert.deepEqual(labels.slice(0, 2), ["Outlook", "Usage"]);
  });

  test("the tab links to the section's own address", async () => {
    const { doc } = await page("/team/buffalo-bills/");
    assert.equal(doc.querySelector("#usage-tab").getAttribute("href"), "/team/buffalo-bills/usage/");
  });

  test("/usage/ is a section page: that panel alone, its own H1-phrase, title and description", async () => {
    const res = await fetch(`${server.origin}/team/buffalo-bills/usage/`);
    assert.equal(res.status, 200);
    const body = await res.text();
    const doc = new JSDOM(body).window.document;
    const panels = [...doc.querySelectorAll("[data-sct-panel]")].map((s) => s.id);
    assert.deepEqual(panels, ["usage"]);
    // mak's NFL-first usage brief (2026-11-05): the title and description
    // name the snap-count search; Rank Math adds the brand on the live site.
    assert.equal(doc.title, "Buffalo Bills Snap Counts & Player Usage 2026");
    assert.equal(
      doc.querySelector('meta[name="description"]').getAttribute("content"),
      "Explore 2026 Buffalo Bills snap counts, target share, rushing usage, red-zone opportunities, and weekly player trends.",
    );
    assert.equal(doc.querySelector('link[rel="canonical"]')?.getAttribute("href")?.endsWith("/usage/"), true);
    // The page's FAQPage describes this page's questions alone: the
    // NFL-first list (2026-11-05), the fantasy questions last, every one
    // answerable for the Bills.
    const faq = [...doc.querySelectorAll('script[type="application/ld+json"]')]
      .map((s) => JSON.parse(s.textContent))
      .find((j) => j["@type"] === "FAQPage");
    const names = faq.mainEntity.map((q) => q.name);
    assert.equal(names.length, 14);
    assert.equal(names[0], "Who leads the Bills in targets?");
    assert.equal(names[1], "Who plays the most offensive snaps for the Bills?");
    assert.equal(names[13], "How should I use Bills usage data for fantasy trades, waivers and start/sit decisions?");
    // The NFL questions come first; the four fantasy questions close the list.
    const fantasyAt = names.findIndex((n) => /fantasy/i.test(n));
    assert.equal(fantasyAt, 10, names.join(" | "));
  });

  test("with the host's heading off, the section's H1 is the address's phrase", async () => {
    const { doc } = await page("/embed/team/buffalo-bills?section=usage&h1=1");
    assert.equal(doc.querySelector("h1").textContent, "Buffalo Bills Snap Counts & Player Usage (2026)");
  });
});

describe("the sections, in the brief's order (mak, 2026-11-05)", () => {
  test("header, intro, snaps, boards, situational, run direction, passing, trends, definitions, fantasy", async () => {
    const { doc } = await page("/team/buffalo-bills/usage/");
    const root = doc.querySelector("#usage .sct-us");
    const order = [
      ".sct-us-head",
      ".sct-us-intro",
      ".sct-us-snaps",
      ".sct-us-boards",
      "#situational",
      "#run-direction",
      "#passing",
      "#usage-trends",
      ".sct-us-defs",
      ".sct-us-fantasy",
    ].map((sel) => root.querySelector(sel));
    order.forEach((el, i) => assert.ok(el, `component ${i} present`));
    const all = [...root.querySelectorAll("*")];
    const idx = order.map((el) => all.indexOf(el));
    assert.deepEqual([...idx].sort((a, b) => a - b), idx);
    const h3s = [...root.querySelectorAll(".sct-us-h3")].map((h) => h.textContent);
    assert.deepEqual(h3s, [
      "Snap Counts & Playing Time",
      "Target Distribution",
      "Rushing Distribution",
      "Situational Usage",
      "Rushing Direction",
      "Passing Distribution",
      "Notable Usage Changes",
      "Advanced & Fantasy Analysis",
    ]);
    assert.equal(root.querySelector(".sct-us-head h2").textContent, "Snap Counts & Player Usage");
    // The "{season} Regular Season · Through Week N" line is gone (mak, 2026-11-05).
    assert.equal(root.querySelector(".sct-us-context"), null);
    // The old fantasy framing is gone from the top of the page.
    assert.ok(!root.textContent.includes("Fantasy production follows opportunity"));
    assert.ok(!root.textContent.includes("Usage & Opportunity Report"));
    assert.ok(!root.textContent.includes("Where Allen Attacks"));
  });

  test("the intro is the brief's football summary; the KPI cards and the three sub lines are gone (mak, 2026-11-05)", async () => {
    const { doc } = await page("/team/buffalo-bills/usage/");
    const intro = doc.querySelector(".sct-us-intro").textContent;
    assert.match(intro, /^Explore how the Bills distribute offensive snaps, targets, rushing attempts, and red-zone opportunities\./);
    assert.match(intro, /how their roles change throughout the season\.$/);
    assert.equal(doc.querySelector(".sct-us-kpis"), null, "no KPI cards");
    assert.equal(doc.querySelector(".sct-us-snaps > .sct-us-sub"), null, "no snaps sub line");
    for (const board of doc.querySelectorAll(".sct-us-board")) assert.equal(board.querySelector(".sct-us-sub"), null, "no board sub line");
    assert.ok(!doc.querySelector("#usage").textContent.includes("official gamebooks. Skill positions only"));
    assert.ok(!doc.querySelector("#usage").textContent.includes("intended receiver, so the"));
    assert.ok(!doc.querySelector("#usage").textContent.includes("exclude kneel-downs"));
  });

  test("nothing above the fantasy section links a fantasy tool; the fantasy section carries them all", async () => {
    const { doc } = await page("/team/new-england-patriots/usage/");
    const root = doc.querySelector("#usage .sct-us");
    const fantasy = root.querySelector(".sct-us-fantasy");
    const ctas = [...root.querySelectorAll("[data-cta]")];
    assert.ok(ctas.length >= 10);
    for (const a of ctas) assert.ok(fantasy.contains(a), `${a.getAttribute("data-cta")} sits above the fantasy section`);
    // The tiered table, its legend, the signal cards, the handcuff line and the close cards are all inside it.
    for (const sel of [".sct-us-table", ".sct-us-key-help", ".sct-us-signals", ".sct-us-handcuff", ".sct-us-convert"]) {
      assert.ok(fantasy.querySelector(sel), sel);
    }
    // The read tiers (fantasy labels) appear nowhere above it.
    const tiers = [...root.querySelectorAll(".sct-us-tier")];
    for (const t of tiers) assert.ok(fantasy.contains(t));
  });

  test("no freshness chip beside the heading (mak, 2026-11-04)", async () => {
    const { doc } = await page("/team/buffalo-bills/usage/");
    assert.equal(doc.querySelector(".sct-us-fresh"), null);
    assert.ok(!doc.body.textContent.includes("refreshed daily"));
  });

  test("the snap table lists every skill player with a snap, carries every view on the row, and states its windows", async () => {
    const { doc } = await page("/team/new-england-patriots/usage/");
    const block = doc.querySelector(".sct-us-snaps");
    const rows = [...block.querySelectorAll("tbody tr")];
    const ne = usage.teams.ne;
    const expected = ne.players.filter((p) => (p.snaps ?? 0) > 0).length;
    assert.equal(rows.length, expected);
    // Sorted by season share, the quarterback first; skill positions only.
    assert.equal(rows[0].dataset.pos, "QB");
    for (const r of rows) assert.ok(["QB", "RB", "WR", "TE"].includes(r.dataset.pos));
    // Every view rides on the row: season, last3, and one per team game.
    for (const r of rows) {
      assert.match(r.getAttribute("data-v-season"), /^\d+\|\d*\|-?\d*$/);
      assert.match(r.getAttribute("data-v-last3"), /^\d+\|\d*\|-?\d*$/);
      for (const w of ne.games) assert.ok(r.hasAttribute(`data-v-w${w}`), `week ${w}`);
    }
    // The season cell is the player's own count and share from the file.
    const maye = rows.find((r) => r.textContent.includes("Drake Maye"));
    const m = ne.players.find((p) => p.name === "Drake Maye");
    assert.equal(maye.querySelector(".sct-us-snap-n").textContent, String(m.snaps));
    assert.equal(maye.querySelector(".sct-us-share-val").textContent, `${m.snapShare}%`);
    assert.match(maye.querySelector(".sct-us-snap-chg").textContent, /^([+−]\d+ pp|0 pp|–)$/);
    // Controls ship hidden; the caption names the actual weeks of both windows.
    assert.ok(block.querySelector(".sct-us-snap-controls").hasAttribute("hidden"));
    const last3 = ne.games.slice(-3);
    assert.match(block.querySelector(".sct-us-snap-caption").textContent, new RegExp(`Last 3 = Weeks ${last3[0]}-${last3[2]}\\.`));
    assert.match(block.querySelector(".sct-us-snap-caption").textContent, /a game a player sat out counts as zero snaps/);
    assert.equal(block.querySelectorAll("[data-snap-week] option").length, ne.games.length + 1);
  });

  test("with the bundle, Last 3 and a week rewrite the snap cells, re-sort and filter by position", async () => {
    const { doc, window, errors } = await hydrated("/team/new-england-patriots/usage/");
    const block = doc.querySelector(".sct-us-snaps");
    assert.equal(block.dataset.sctSnaps, "js");
    assert.equal(block.querySelector(".sct-us-snap-controls").hidden, false);
    const rowFor = (name) => [...block.querySelectorAll("tbody tr")].find((r) => r.textContent.includes(name));
    const henry = rowFor("Hunter Henry");
    const [l3snaps, l3share, l3chg] = henry.getAttribute("data-v-last3").split("|");
    block.querySelector('[data-snap-view="last3"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.equal(henry.querySelector(".sct-us-snap-n").textContent, l3snaps);
    assert.equal(henry.querySelector(".sct-us-share-val").textContent, `${l3share}%`);
    assert.equal(block.querySelector('[data-snap-view="last3"]').getAttribute("aria-pressed"), "true");
    if (l3chg) assert.ok(henry.querySelector(".sct-us-snap-chg").textContent.endsWith(" pp"));
    // A week: the row shows that game's count; rows with no snaps that week hide.
    const ne = usage.teams.ne;
    const w = ne.games[ne.games.length - 1];
    const select = block.querySelector("[data-snap-week]");
    select.value = `w${w}`;
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
    const wk = ne.players.find((p) => p.name === "Hunter Henry").weekly.find((x) => x.week === w);
    assert.equal(henry.querySelector(".sct-us-snap-n").textContent, String(wk.snapN ?? 0));
    const shown = [...block.querySelectorAll("tbody tr")].filter((r) => !r.hidden);
    for (const r of shown) assert.ok(Number(r.getAttribute(`data-v-w${w}`).split("|")[0]) > 0);
    // Sorted by that week's share, descending.
    const shares = shown.map((r) => Number(r.getAttribute(`data-v-w${w}`).split("|")[1]));
    assert.deepEqual(shares, [...shares].sort((a, b) => b - a));
    // Position filter.
    const pos = block.querySelector("[data-snap-pos]");
    pos.value = "RB";
    pos.dispatchEvent(new window.Event("change", { bubbles: true }));
    for (const r of [...block.querySelectorAll("tbody tr")].filter((r) => !r.hidden)) assert.equal(r.dataset.pos, "RB");
    assert.deepEqual(errors, []);
  });

  test("the distribution boards carry the conventional counts and say how carries are counted", async () => {
    const { doc } = await page("/team/new-england-patriots/usage/");
    const boards = [...doc.querySelectorAll(".sct-us-board")];
    assert.deepEqual(boards.map((b) => b.querySelector("h3").textContent), ["Target Distribution", "Rushing Distribution"]);
    assert.deepEqual(
      [...boards[0].querySelectorAll("thead th")].map((th) => th.textContent),
      ["Player", "Tgt", "Rec", "Yds", "Season share", "Last 3 wk", "Air yds"],
    );
    assert.deepEqual(
      [...boards[1].querySelectorAll("thead th")].map((th) => th.textContent),
      ["Player", "Car", "Yds", "YPC", "Season share", "Last 3 wk"],
    );
    const ne = usage.teams.ne;
    // Stevenson's row: carries, yards on those carries, YPC.
    const row = [...boards[1].querySelectorAll("tbody tr")].find((r) => r.textContent.includes("Rhamondre Stevenson"));
    const p = ne.players.find((x) => x.name === "Rhamondre Stevenson");
    const cells = [...row.querySelectorAll("td")].map((td) => td.textContent);
    assert.equal(cells[0], String(p.carries));
    assert.equal(cells[1], String(p.rushYards - p.kneelYards));
    assert.equal(cells[2], ((p.rushYards - p.kneelYards) / p.carries).toFixed(1));
  });

  test("every situational row carries its sample, and the takeaways are in NFL terms", async () => {
    const { doc } = await page("/team/new-england-patriots/usage/");
    const ne = usage.teams.ne;
    const rows = [...doc.querySelectorAll("#situational .sct-us-grow:not(.is-head)")];
    assert.equal(rows.length, 6);
    const keys = ["early", "third", "rz", "in10", "twoMin", "trailing"];
    rows.forEach((r, i) => {
      assert.equal(r.querySelector(".sct-us-gn").textContent, `${ne.rbSituationTotals[keys[i]]} opportunities`);
    });
    assert.match(doc.querySelector("#situational .sct-us-sub").textContent, /Opportunities, not snaps/);
    const takeaways = [...doc.querySelectorAll("#situational .sct-us-takeaway")].map((t) => t.textContent);
    assert.equal(takeaways.length, 3);
    assert.match(takeaways[0], /^Stevenson: \d+ carries and \d+ targets in \d+ games, \d+% of the backs' touches and \d+% of the offensive snaps\./);
    assert.match(takeaways[1], /^Passing downs: Rhamondre Stevenson accounts for \d+% of the backs' third-down carries and targets \(\d+ opportunities\), compared with/);
    assert.match(takeaways[2], /^If Stevenson misses time: Henderson is next in line\./);
    // No fantasy words in the NFL section.
    for (const t of takeaways) assert.ok(!/stash|cut|RB2-level|bench/.test(t), t);
  });

  test("passing distribution states its coverage; rushing direction carries attempt shares", async () => {
    const { doc } = await page("/team/new-england-patriots/usage/");
    const ne = usage.teams.ne;
    const maye = ne.players.find((p) => p.name === "Drake Maye");
    assert.match(doc.querySelector("#passing .sct-us-sub").textContent, new RegExp(`^Share of Maye's ${ne.passerZoneAttempts} pass attempts`));
    const coverage = [...doc.querySelectorAll("#passing .sct-us-fine")].map((p) => p.textContent).join(" ");
    if (maye.passAttempts > ne.passerZoneAttempts) assert.match(coverage, new RegExp(`${ne.passerZoneAttempts} of Maye's ${maye.passAttempts} pass attempts`));
    else assert.match(coverage, new RegExp(`^All ${ne.passerZoneAttempts} of Maye's pass attempts carry a charted location`));
    for (const z of doc.querySelectorAll("#passing .sct-us-zone-ypa")) assert.match(z.textContent, /^(\d+\.\d YPA · \d+ att|no attempts)$/);
    const gaps = [...doc.querySelectorAll("#run-direction .sct-us-gap")];
    assert.equal(gaps.length, 5);
    for (const g of gaps) {
      assert.match(g.querySelector(".sct-us-gap-att").textContent, /^\d+ att · \d+%$/);
      assert.ok(g.querySelector(".sct-us-gap-bar > span").getAttribute("style").startsWith("width:"));
    }
  });

  test("Notable Usage Changes replaces the Buy Low card at the top level and states both windows", async () => {
    const { doc } = await page("/team/new-england-patriots/usage/");
    const block = doc.querySelector("#usage-trends");
    const items = [...block.querySelectorAll(".sct-us-trend")];
    assert.ok(items.length >= 1);
    for (const li of items) {
      assert.match(li.querySelector(".sct-us-trend-num").textContent, /^[+−]\d+(\.\d)? (pp|pts)$/);
      const body = li.querySelector(".sct-us-trend-body").textContent;
      assert.match(body, /over his last (one game|two games|three games) \(Weeks? [\d, -]+(and \d+)?\) against the (three before them|one game before|two games before) \(Weeks? [\d, -]+(and \d+)?\)/, body);
      assert.ok(!/[Tt]rade|buy|sell|stash/.test(body), body);
      // "within the steady band" only when the number really is inside it.
      const m = body.match(/target share within the steady band \(([+−]\d+\.\d) points\)/);
      if (m) assert.ok(Math.abs(Number(m[1].replace("−", "-"))) < 2, body);
      const sm = body.match(/snap share within the steady band \(([+−]\d+) points\)/);
      if (sm) assert.ok(Math.abs(Number(sm[1].replace("−", "-"))) < 5, body);
    }
    // The Buy Low card still exists, inside the fantasy section only.
    const buy = doc.querySelector(".sct-us-signal.is-buy");
    if (buy) assert.ok(doc.querySelector(".sct-us-fantasy").contains(buy));
  });

  test("the definitions block reconciles carries with the official box score", async () => {
    const { doc } = await page("/team/new-england-patriots/usage/");
    const ne = usage.teams.ne;
    const maye = ne.players.find((p) => p.name === "Drake Maye");
    const defs = [...doc.querySelectorAll(".sct-us-defs li")].map((li) => li.textContent);
    assert.equal(defs.length, 6);
    assert.match(defs[2], new RegExp(`excluding kneel-downs \\(${ne.kneels} this season\\)`));
    assert.match(defs[2], new RegExp(`Maye's official attempts are his ${maye.carries} carries here plus ${maye.kneels} kneels`));
    assert.match(defs[1], new RegExp(`${ne.targets} team targets sit under ${ne.passAttempts} pass attempts`));
    assert.match(defs[3], /not of snaps/);
  });

  test("no umbrella line and no Command links: the close cards end the block (mak, 2026-10-22)", async () => {
    const { doc } = await page("/team/buffalo-bills/usage/");
    const us = doc.querySelector(".sct-us");
    assert.equal(us.querySelector(".sct-us-close"), null);
    assert.ok(!us.textContent.includes("core inputs behind our player pricing"));
    const commands = [...us.querySelectorAll("a")].filter((a) => /^(Redraft|Dynasty) Command$/.test(a.textContent.trim()));
    assert.equal(commands.length, 0);
    // The six decision cards are the last thing in the block
    // (the tool row went 2026-10-20, the umbrella line 2026-10-22).
    assert.equal(us.querySelector(".sct-us-convert").lastElementChild.className, "sct-us-products");
  });
});

describe("the highlights", () => {
  test("exactly one gold gap and one gold zone; one owner per situation row", async () => {
    const { doc } = await page("/team/buffalo-bills/usage/");
    assert.equal(doc.querySelectorAll(".sct-us-gap.is-best").length, 1);
    assert.equal(doc.querySelectorAll(".sct-us-zone.is-best").length, 1);
    const rows = [...doc.querySelectorAll(".sct-us-grow:not(.is-head)")];
    assert.equal(rows.length, 6);
    for (const row of rows) assert.ok(row.querySelectorAll(".is-owner").length >= 1);
  });

  test("trend colors follow the sign of the delta", async () => {
    const { doc } = await page("/team/buffalo-bills/usage/");
    for (const d of doc.querySelectorAll(".sct-us-delta.is-up")) assert.match(d.textContent, /^\+/);
    for (const d of doc.querySelectorAll(".sct-us-delta.is-down")) assert.match(d.textContent, /^−/);
  });

  test("every sparkline and bar carries its numbers in text", async () => {
    const { doc } = await page("/team/buffalo-bills/usage/");
    for (const el of doc.querySelectorAll(".sct-us-spark, .sct-us-pbar, .sct-us-bar, .sct-us-gauge")) {
      assert.ok(el.getAttribute("aria-label"), el.className);
    }
  });
});

describe("the table (mak's critique, 2026-11-03)", () => {
  test("rows sit in position bands, each naming its opportunity metric once", async () => {
    const { doc } = await page("/team/new-england-patriots/usage/");
    const bands = [...doc.querySelectorAll(".sct-us-table tbody.sct-us-band")];
    assert.deepEqual(
      bands.map((b) => b.querySelector(".sct-us-band-name").textContent),
      ["Running backs", "Receivers", "Quarterback"],
    );
    for (const band of bands) {
      assert.match(band.querySelector(".sct-us-band-metric").textContent, /^Opportunity = .* percentile of NFL/);
      const positions = new Set([...band.querySelectorAll(".sct-us-row .sct-us-role")].map((r) => r.textContent.slice(0, 2)));
      const allowed = { "Running backs": ["RB"], Receivers: ["WR", "TE"], Quarterback: ["QB"] }[band.querySelector(".sct-us-band-name").textContent];
      for (const pos of positions) assert.ok(allowed.includes(pos), `${pos} in ${allowed}`);
    }
  });

  test("the read comes right after the player; opportunity is a percentile with the native stat under it", async () => {
    const { doc } = await page("/team/new-england-patriots/usage/");
    const heads = [...doc.querySelectorAll(".sct-us-table thead tr:first-child th")].map((th) => th.textContent);
    assert.deepEqual(heads, ["Profile", "Player", "Read", "Opportunity", "Snaps", "Red zone"]);
    for (const row of doc.querySelectorAll(".sct-us-row")) {
      const cells = [...row.children];
      assert.ok(cells[2].classList.contains("is-read") && cells[2].querySelector(".sct-us-tier"));
      assert.ok(cells[2].querySelector(".sct-us-tier").getAttribute("title").length > 20, "the read carries its rule");
      const opp = cells[3];
      assert.ok(opp.classList.contains("is-opp"));
      assert.match(opp.querySelector(".sct-us-num").textContent, /^(\d+(st|nd|rd|th)|–)$/);
      assert.ok(opp.querySelector(".sct-us-pbar") || opp.querySelector(".sct-us-num").textContent === "–");
    }
    // The QB is no longer a blank cell under a header meant for everyone.
    const qb = doc.querySelector(".sct-us-band.is-qb .sct-us-row td.is-opp");
    assert.match(qb.textContent, /pctile QB/);
    assert.match(qb.querySelector(".sct-us-cap").textContent, /^every dropback/);
  });

  test("one move window, said once in the header; the player's own weeks only in his profile", async () => {
    const { doc } = await page("/team/new-england-patriots/usage/");
    const sub = doc.querySelector(".sct-us-table thead tr.sct-us-th-sub");
    assert.match(sub.textContent, /a move is the last three games against the three before them/);
    for (const d of doc.querySelectorAll(".sct-us-row .sct-us-delta")) {
      assert.match(d.textContent, /^(steady|[+−-]\d+(\.\d+)? last 3)$/);
    }
    const win = [...doc.querySelectorAll(".sct-us-detail .sct-us-win")];
    assert.ok(win.length > 0);
    assert.match(win[0].textContent, /^Moves in the row: his last three games \(W\d+(-\d+)?\) against the three before them \(W\d+(-\d+)?\)\.$/);
  });

  test("the red-zone leader's caption is the badge, not three descriptors", async () => {
    const { doc } = await page("/team/new-england-patriots/usage/");
    const leader = [...doc.querySelectorAll(".sct-us-row")].find((r) => r.querySelector(".sct-us-leads"));
    assert.ok(leader);
    const cap = leader.querySelector(".sct-us-leads").closest(".sct-us-cap").textContent;
    assert.ok(!/steady/.test(cap), cap);
  });
});

describe("profiles", () => {
  test("every toggle controls a detail row that exists", async () => {
    const { doc } = await page("/team/buffalo-bills/usage/");
    const buttons = [...doc.querySelectorAll(".sct-us-toggle")];
    assert.ok(buttons.length >= 4);
    for (const b of buttons) {
      assert.equal(b.getAttribute("aria-expanded"), "false");
      const row = doc.getElementById(b.getAttribute("aria-controls"));
      assert.ok(row?.classList.contains("sct-us-detail"));
      assert.ok(row.hasAttribute("hidden"));
      assert.match(row.querySelector(".sct-us-pnote").textContent, /Bars show percentile vs\. all NFL (WRs|TEs|RBs|QBs)\.$/);
    }
  });

  test("with the bundle, + opens and − closes", async () => {
    const { doc, window, errors } = await hydrated("/team/buffalo-bills/usage/");
    const button = doc.querySelector(".sct-us-toggle");
    const row = doc.getElementById(button.getAttribute("aria-controls"));
    button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.equal(button.getAttribute("aria-expanded"), "true");
    assert.equal(row.hidden, false);
    assert.equal(button.textContent, "−");
    button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.equal(row.hidden, true);
    assert.equal(button.textContent, "+");
    assert.equal(doc.querySelector("[data-sct-root]").dataset.sctUsage, "js");
    assert.deepEqual(errors, []);
  });

  test("on the hub the Usage tab is a link to /usage/, and the report is not printed there", async () => {
    // The report belongs to its own address (ownsAddress in team-render.ts):
    // the hub's HTML carries the tab, not the panel, so clicking it loads
    // the Usage page rather than switching a hidden copy into view. The
    // bundle leaves the link alone and prefetches the page on intent.
    const { doc, window } = await hydrated("/team/buffalo-bills/");
    const tab = doc.querySelector("#usage-tab");
    assert.equal(tab.getAttribute("href"), "/team/buffalo-bills/usage/");
    assert.equal(doc.querySelector("#usage"), null, "no #usage panel on the hub");
    assert.equal(doc.querySelector(".sct-us"), null, "no report markup on the hub");
    assert.equal(tab.getAttribute("role"), null, "a link, not a tab");
    const event = new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    // jsdom does not navigate; what matters is that the bundle did not
    // intercept the click, so the browser would.
    tab.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false, "the click is the browser's");
    assert.equal(window.location.pathname, "/team/buffalo-bills/", "nothing was pushed in place");
  });

  test("a deep link to #usage on the hub has nothing to open; /usage/ is the address", async () => {
    const { doc } = await hydrated("/team/buffalo-bills/#usage");
    assert.equal(doc.querySelector("#usage"), null);
    assert.ok(doc.querySelector("#outlook").classList.contains("is-active"), "the hub opens on the Outlook");
    const page = await hydrated("/team/buffalo-bills/usage/");
    assert.ok(page.doc.querySelector("#usage"), "the Usage page carries the panel");
    assert.equal(page.doc.querySelectorAll("[data-sct-panel]").length, 1);
  });
});

describe("FAQ", () => {
  test("the questions are visible, with no report link under them", async () => {
    const { doc } = await page("/team/buffalo-bills/usage/");
    const tail = doc.querySelector('[data-sct-faq-for="usage"]');
    assert.equal(tail.querySelector(".sct-faq-q").textContent, "Who leads the Bills in targets?");
    assert.equal(tail.querySelectorAll(".sct-faq-item").length, 14);
    assert.equal(tail.querySelector(".sct-faq-more"), null);
  });

  test("…and is in the FAQPage with the answer the page shows", async () => {
    const { doc } = await page("/team/buffalo-bills/usage/");
    const node = [...doc.querySelectorAll('script[type="application/ld+json"]')]
      .map((s) => JSON.parse(s.textContent))
      .find((j) => j["@type"] === "FAQPage");
    const visible = [...doc.querySelectorAll('[data-sct-faq-for="usage"] .sct-faq-item')];
    assert.equal(visible.length, 14);
    for (const item of visible) {
      const q = node.mainEntity.find((m) => m.name === item.querySelector(".sct-faq-q").textContent);
      assert.ok(q);
      assert.equal(q.acceptedAnswer.text, item.querySelector(".sct-faq-a").textContent);
    }
  });

  test("answers link their tools inline (mak, 2026-10-05)", async () => {
    const { doc } = await page("/team/buffalo-bills/usage/");
    const ctas = [...doc.querySelectorAll('[data-sct-faq-for="usage"] .sct-faq-a a[data-cta]')].map((a) =>
      a.getAttribute("data-cta"),
    );
    for (const want of ["rb-handcuffs-usage-faq", "start-sit-usage-faq", "trade-analyzer-usage-faq", "redraft-command-usage-faq"]) {
      assert.ok(ctas.includes(want), want);
    }
  });

  test("embedded, it rides in the data island for Rank Math", async () => {
    const res = await fetch(`${server.origin}/embed/team/buf?section=usage`);
    const body = await res.text();
    const island = body.match(/<script type="application\/json" class="sct-faq-data">(.*?)<\/script>/s);
    assert.ok(JSON.parse(island[1]).some((e) => e.q === "Who leads the Bills in targets?"));
  });
});

describe("all 32 clubs", () => {
  test("every hub renders the report with no holes in the text", async () => {
    const teams = Object.keys(usage.teams);
    assert.equal(teams.length, 32);
    const index = await (await fetch(`${server.origin}/team`)).text();
    const slugs = [...new Set([...index.matchAll(/href="\/team\/([a-z0-9-]+)\/"/g)].map((m) => m[1]))];
    assert.equal(slugs.length, 32);
    for (const slug of slugs) {
      const { doc } = await page(`/team/${slug}/usage/`);
      const section = doc.querySelector("#usage");
      assert.ok(section, slug);
      // The FAQ renders below the tools block, outside the panel.
      const text = section.textContent + (doc.querySelector('[data-sct-faq-for="usage"]')?.textContent ?? "");
      for (const bad of ["undefined", "NaN", "null", "Infinity"]) {
        assert.ok(!text.includes(bad), `${slug}: ${bad}`);
      }
    }
  });

  // The copy rules' three invariants (docs/USAGE-COPY-RULES.md): scope stays
  // put, averages stay averages, description stays description. Each pattern
  // here is a phrasing an audit caught saying more than its number measures.
  // The intro is mak's own wording and is not generated, so it is skipped.
  const OVERCLAIMS = [
    [/\bengine\b/i, "run/zone 'engine' (describe the split instead)"],
    [/\bthe plan\b/i, "play-caller intent"],
    [/buy signal/i, "FPOE as a forecast"],
    [/\bregresses\b/i, "FPOE as a forecast"],
    [/floor holds/i, "xFP as a guarantee"],
    [/talent question/i, "ruling out talent from a role share"],
    [/hurry-up/i, "trailing split as on-field snaps"],
    [/when he's out there/i, "target share as per-snap volume"],
    [/sweet spot/i, "aDOT as a distribution"],
    [/travel nowhere/i, "aDOT overstated"],
    [/deep slice of this chart/i, "aDOT as a distribution"],
    [/designed (for|through) him/i, "first-read share as play design"],
    [/predicts the box score|tracks fantasy points best|the best receiver/i, "unqualified 'best stat' claim"],
    [/as often as his arm/i, "team in-10 rate as the QB's own carries"],
    [/(eat|cap) the receivers/i, "team red-zone rate as cause and effect"],
    [/alpha-receiver threshold/i, "30% as a hard cut-off"],
  ];

  test("no generated sentence claims more than its number measures", async () => {
    const index = await (await fetch(`${server.origin}/team`)).text();
    const slugs = [...new Set([...index.matchAll(/href="\/team\/([a-z0-9-]+)\/"/g)].map((m) => m[1]))];
    for (const slug of slugs) {
      const { doc } = await page(`/team/${slug}/usage/`);
      const section = doc.querySelector("#usage");
      section.querySelector(".sct-us-intro")?.remove();
      const text = section.textContent + (doc.querySelector('[data-sct-faq-for="usage"]')?.textContent ?? "");
      for (const [re, why] of OVERCLAIMS) {
        const hit = text.match(re);
        assert.equal(hit, null, `${slug}: "${hit?.[0]}" - ${why}`);
      }
    }
  });
});

describe("premium comparison version (mak, 2026-11-05)", () => {
  test("renders under the whole original section, labeled, with the same numbers", async () => {
    for (const slug of ["new-england-patriots", "buffalo-bills"]) {
      const { doc } = await page(`/team/${slug}/usage/`);
      const us = doc.querySelector("#usage .sct-us");
      const up = doc.querySelector("#usage-premium.sct-up");
      assert.ok(us && up, `${slug}: both versions render`);
      assert.equal(us.nextElementSibling, up, `${slug}: the premium block follows the original`);
      assert.equal(up.querySelector(".sct-up-flag").textContent, "New design · Comparison");
      assert.equal(us.querySelector("[class*='sct-up']"), null, "nothing of the premium markup inside the original");
      // The snap rows carry the same views, player for player, in the same order.
      const attrs = (root, sel) => [...root.querySelectorAll(sel)].map((r) => `${r.dataset.pos}|${r.getAttribute("data-v-season")}|${r.getAttribute("data-v-last3")}`);
      assert.deepEqual(attrs(up, ".sct-up-snaps tbody tr"), attrs(us, ".sct-us-snaps tbody tr"), `${slug}: snap rows`);
      // The boards: the same count, season share and last-3 share for every player both name.
      const lines = (root, sel) =>
        Object.fromEntries([...root.querySelectorAll(`${sel} tbody tr`)].filter((tr) => tr.querySelector("th")).map((tr) => [tr.querySelector("th").textContent, [...tr.querySelectorAll("td")].slice(0, 2).map((td) => td.textContent.replace(/[^0-9%.–-]/g, "")).join(",")]));
      const ot = lines(us, "#targets"), pt = lines(up, ".sct-up-board:nth-of-type(1)");
      for (const name of Object.keys(ot)) if (pt[name]) assert.equal(pt[name], ot[name], `${slug}: ${name} targets`);
      // Header, three navy panel heads, the methodology strip, the premium controls shipped hidden.
      assert.match(up.querySelector(".sct-up-dek").textContent, /^Explore how the \S+ distribute offensive snaps/);
      assert.deepEqual([...up.querySelectorAll(".sct-up-ph-title")].map((h) => h.textContent), ["Snap Counts & Playing Time", "Target Distribution", "Rushing Distribution"]);
      assert.match(up.querySelector(".sct-up-note").textContent, /^Season = Weeks/);
      assert.ok(up.querySelector(".sct-up-controls").hasAttribute("hidden"));
      // Player links and headshots as on the original.
      assert.ok(up.querySelectorAll(".sct-up-name.sct-player-link").length >= 5);
      assert.ok(up.querySelectorAll(".sct-up-snaps .sct-us-face").length === up.querySelectorAll(".sct-up-snaps tbody tr").length);
    }
  });

  test("the premium snap switch works and is independent of the original's", async () => {
    const { doc, window, errors } = await hydrated("/team/new-england-patriots/usage/");
    const orig = doc.querySelector(".sct-us-snaps");
    const prem = doc.querySelector(".sct-up-snaps");
    assert.equal(prem.dataset.sctSnaps, "js");
    assert.equal(prem.querySelector(".sct-up-controls").hidden, false);
    const rowFor = (block, name) => [...block.querySelectorAll("tbody tr")].find((r) => r.textContent.includes(name));
    const henryP = rowFor(prem, "Hunter Henry");
    const henryO = rowFor(orig, "Hunter Henry");
    const seasonN = henryO.querySelector(".sct-us-snap-n").textContent;
    const [l3snaps, l3share] = henryP.getAttribute("data-v-last3").split("|");
    prem.querySelector('[data-snap-view="last3"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.equal(henryP.querySelector(".sct-us-snap-n").textContent, l3snaps);
    assert.equal(henryP.querySelector(".sct-us-share-val").textContent, `${l3share}%`);
    assert.equal(prem.querySelector('[data-snap-view="last3"]').classList.contains("is-on"), true);
    // The original did not move.
    assert.equal(henryO.querySelector(".sct-us-snap-n").textContent, seasonN);
    assert.equal(orig.querySelector('[data-snap-view="season"]').classList.contains("is-on"), true);
    // Position filter on the premium block only.
    const pos = prem.querySelector("[data-snap-pos]");
    pos.value = "RB";
    pos.dispatchEvent(new window.Event("change", { bubbles: true }));
    for (const r of [...prem.querySelectorAll("tbody tr")].filter((r) => !r.hidden)) assert.equal(r.dataset.pos, "RB");
    assert.ok([...orig.querySelectorAll("tbody tr")].some((r) => !r.hidden && r.dataset.pos !== "RB"));
    // No duplicate ids between the two blocks.
    const ids = [...doc.querySelectorAll("#usage [id]")].map((el) => el.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate ids");
    assert.deepEqual(errors, []);
  });
});

describe("product bridges (mak, 2026-10-05; specific tools 2026-10-08)", () => {
  test("each section hands off to the specific tool that answers its next question", async () => {
    const res = await fetch(`${server.origin}/team/new-england-patriots/usage/`);
    const doc = new JSDOM(await res.text()).window.document;
    const us = doc.querySelector(".sct-us");
    const ctas = [...us.querySelectorAll("[data-cta]")].map((a) => a.getAttribute("data-cta"));
    // Intro, handcuff, the close cards and the umbrella line (the projections
    // line under the table went 2026-10-22).
    // (The "Turn the usage signal into a trade" block, the target-tree and
    // pass-map bridges and the footer tool row went 2026-10-20 at mak's request;
    // the intro's "Turn usage into a roster decision" box went 2026-11-02.)
    for (const want of [
      "rb-handcuffs-usage-handcuff",
      "waiver-wire-usage-handcuff",
      "dynasty-trade-calc-usage-handcuff",
      "dynasty-league-analyzer-usage-handcuff",
      "dynasty-rankings-usage-handcuff",
      "trade-analyzer-usage-close",
      "startsit-usage-close",
      "ros-rankings-usage-close",
      "waiver-wire-usage-close",
      "league-analyzer-usage-close",
      "dynasty-league-analyzer-usage-close",
    ]) assert.ok(ctas.includes(want), `missing ${want}`);
    // Unconfirmed tools stay off the page.
    assert.ok(!ctas.some((c) => /trade-finder|blsh|lineup-optimizer/.test(c)));
    // The Commands are not linked from the block at all since 2026-10-22.
    assert.deepEqual(ctas.filter((c) => /^(redraft|dynasty)-command/.test(c)), []);
    // Dynasty stays a minority of the product links (7 of 19 since the
    // projections line's three redraft links went 2026-10-22).
    const dynasty = ctas.filter((c) => c.startsWith("dynasty")).length;
    assert.ok(dynasty < ctas.length / 2, `${dynasty} of ${ctas.length} links are dynasty`);
    // The close: six decision cards (the tool row under them is gone).
    assert.equal(us.querySelector(".sct-us-convert h4").textContent, "Put This Usage Data to Work");
    assert.deepEqual(
      [...us.querySelectorAll(".sct-us-product.is-ask .sct-us-product-title")].map((p) => p.textContent),
      ["Making a trade?", "Setting your lineup?", "Looking ahead?", "Working the waiver wire?", "Evaluating your whole league?", "Playing dynasty?"],
    );
    assert.equal(us.querySelector(".sct-us-toolrow"), null);
    // The anchors carry the tool's name, which is the search signal.
    const trade = us.querySelector("[data-cta='trade-analyzer-usage-close']");
    assert.equal(trade.textContent, "Open Trade Analyzer");
    assert.equal(trade.getAttribute("href"), "https://statchasers.com/redraft-command/fantasy-football-trade-calculator");
    // The handcuff line still links the Dynasty Trade Calculator; the close card no longer does (2026-10-22).
    assert.equal(
      us.querySelector("[data-cta='dynasty-trade-calc-usage-handcuff']").getAttribute("href"),
      "https://statchasers.com/dynasty-command/dynasty-trade-calculator",
    );
    assert.equal(us.querySelector("[data-cta='dynasty-trade-calc-usage-close']"), null);
    assert.equal(us.querySelector("[data-cta='projections-usage-close']"), null);
    assert.equal(us.querySelector("[data-cta='dynasty-rankings-usage-close']"), null);
    // The trade box between the signals and the close is gone (2026-10-20).
    assert.equal(us.querySelector(".sct-us-cta.is-trade"), null);
  });
});

describe("the premium comparison blocks (mak's brief, 2026-11-05)", () => {
  test("each renders directly under its current block, with the same numbers and copy", async () => {
    const { doc } = await page("/team/new-england-patriots/usage/");
    const root = doc.querySelector("#usage .sct-us");
    const text = (el) => el.textContent.replace(/\s+/g, " ").trim();

    const run = root.querySelector("#run-direction");
    const prmRun = root.querySelector('[data-sct-premium="run-direction"]');
    assert.ok(run && prmRun, "both rushing blocks");
    assert.equal(run.nextElementSibling, prmRun, "the premium rushing block follows the current one");
    const oldYpc = [...run.querySelectorAll(".sct-us-gap .sct-us-num")].map(text);
    const newYpc = [...prmRun.querySelectorAll(".sct-us-prm-gap .sct-us-num")].map(text);
    assert.deepEqual(newYpc, oldYpc, "the same YPC per gap, in the same order");
    assert.equal(prmRun.querySelectorAll(".sct-us-prm-gap.is-best").length, run.querySelectorAll(".sct-us-gap.is-best").length);
    assert.equal(prmRun.querySelector(".sct-us-prm-gap.is-best")?.dataset.gap, [...run.querySelectorAll(".sct-us-gap")].findIndex((g) => g.classList.contains("is-best")) === -1 ? undefined : ["LE", "LT", "MID", "RT", "RE"][[...run.querySelectorAll(".sct-us-gap")].findIndex((g) => g.classList.contains("is-best"))]);
    assert.equal(text(prmRun.querySelector(".sct-us-prm-insight p")), text(run.querySelector(".sct-us-note")), "the insight strip is the current note");
    assert.equal(text(prmRun.querySelector(".sct-us-prm-title")), "Rushing Direction");

    const pass = root.querySelector("#passing");
    const prmPass = root.querySelector('[data-sct-premium="passing"]');
    assert.ok(pass && prmPass, "both passing blocks");
    assert.equal(pass.nextElementSibling, prmPass, "the premium passing block follows the current one");
    const oldShares = [...pass.querySelectorAll(".sct-us-zone .sct-us-num")].map(text);
    const newShares = [...prmPass.querySelectorAll(".sct-us-prm-zone .sct-us-num")].map(text);
    assert.deepEqual(newShares, oldShares, "the same share per zone, deep row then short row");
    assert.deepEqual([...prmPass.querySelectorAll(".sct-us-prm-zone")].map((z) => z.dataset.zone), ["DL", "DM", "DR", "SL", "SM", "SR"]);
    assert.equal(prmPass.querySelectorAll(".sct-us-prm-zone.is-deep .sct-us-prm-arc").length, 3, "a route arc on every deep card");
    assert.equal(prmPass.querySelectorAll(".sct-us-prm-zone.is-short .sct-us-prm-bars").length, 3, "bars on every short card");
    assert.deepEqual(
      [...prmPass.querySelectorAll(".sct-us-prm-insight p")].map(text),
      [...pass.querySelectorAll(".sct-us-note")].map(text),
      "the insight strips are the current notes",
    );
    assert.equal(text(prmPass.querySelector(".sct-us-prm-fine")), text(pass.querySelector(".sct-us-fine")), "the footnote is the current one");
    assert.equal(text(prmPass.querySelector(".sct-us-prm-divider")), "Deep = 20+ air yards");

    // The premium headings are not section headings: the tab's h3 list is unchanged.
    assert.equal(root.querySelectorAll(".sct-us-prm .sct-us-h3").length, 0);
  });
});
