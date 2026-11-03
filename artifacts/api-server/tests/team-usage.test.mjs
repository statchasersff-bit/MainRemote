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
    assert.equal(doc.title, "Buffalo Bills Target Share & Snap Counts 2026: Usage Report");
    assert.match(
      doc.querySelector('meta[name="description"]').getAttribute("content"),
      /^Buffalo Bills target share, snap share and red-zone touches for 2026, updated every Tuesday/,
    );
    assert.equal(doc.querySelector('link[rel="canonical"]')?.getAttribute("href")?.endsWith("/usage/"), true);
    // The page's FAQPage describes this page's questions alone: mak's list
    // (2026-10-05), in his order, every one answerable for the Bills.
    const faq = [...doc.querySelectorAll('script[type="application/ld+json"]')]
      .map((s) => JSON.parse(s.textContent))
      .find((j) => j["@type"] === "FAQPage");
    const names = faq.mainEntity.map((q) => q.name);
    assert.equal(names.length, 15);
    assert.equal(names[0], "Who leads the Bills in target share?");
    assert.equal(names[14], "How should I use Bills usage data for trades, waivers and start/sit decisions?");
  });

  test("with the host's heading off, the section's H1 is the address's phrase", async () => {
    const { doc } = await page("/embed/team/buffalo-bills?section=usage&h1=1");
    assert.equal(doc.querySelector("h1").textContent, "Buffalo Bills Usage & Opportunity Report 2026");
  });
});

describe("the ten components, in order", () => {
  test("header, intro, environment, tree, backfield, pass map, table, legend, signals, closing", async () => {
    const { doc } = await page("/team/buffalo-bills/usage/");
    const root = doc.querySelector("#usage .sct-us");
    const order = [
      ".sct-us-head",
      ".sct-us-intro",
      ".sct-us-card",
      ".sct-us-scroll",
      ".sct-us-legend",
      ".sct-us-convert",
    ].map((sel) => root.querySelector(sel));
    order.forEach((el, i) => assert.ok(el, `component ${i} present`));
    const all = [...root.querySelectorAll("*")];
    const idx = order.map((el) => all.indexOf(el));
    assert.deepEqual([...idx].sort((a, b) => a - b), idx);
    const h3s = [...root.querySelectorAll(".sct-us-card > .sct-us-h3")].map((h) => h.textContent);
    // The Target Tree went 2026-11-02 (mak): the backfield split leads the cards.
    assert.ok(!h3s.includes("The Target Tree"));
    assert.equal(h3s[0], "The Backfield Split");
    assert.match(h3s[1], /^Where \S+ Attacks$/);
  });

  test("freshness chip is driven by the data file", async () => {
    const { doc } = await page("/team/buffalo-bills/usage/");
    assert.equal(
      doc.querySelector(".sct-us-fresh").textContent,
      `Updated through Week ${Math.max(...usage.teams.buf.games)} · refreshed daily`,
    );
  });

  test("each hub is labeled with its own last game, not the league's latest week", async () => {
    // A Thursday game puts one matchup's week into the feed days before the
    // rest: only the teams that played it may say that week.
    for (const [abbr, slug] of [["ne", "new-england-patriots"], ["cle", "cleveland-browns"]]) {
      const { doc } = await page(`/team/${slug}/usage/`);
      const last = Math.max(...usage.teams[abbr].games);
      assert.equal(doc.querySelector(".sct-us-fresh").textContent, `Updated through Week ${last} · refreshed daily`, slug);
    }
  });

  test("the verbatim definitions stay in plain prose", async () => {
    const { doc } = await page("/team/buffalo-bills/usage/");
    const intro = doc.querySelector(".sct-us-intro").textContent;
    assert.match(intro, /^Fantasy production follows opportunity\./);
    // mak's 2026-11-02 copy: the metrics are bolded in the first sentence.
    assert.match(intro, /Track target share, snap share, and red-zone touches before the box score catches up\./);
    assert.ok(!/xFP measures/.test(intro), "the xFP/FPOE bullets are gone");
    // No bold in the three body paragraphs (mak, 2026-11-02); only the closing line is bold.
    const ps = [...doc.querySelectorAll(".sct-us-intro p")];
    assert.ok(ps.slice(0, -1).every((p) => !p.querySelector("strong")), "body paragraphs carry no bold");
    assert.ok(ps.at(-1).querySelector("strong"), "the closing line keeps its bold");
    assert.match(intro, /Follow the opportunity before the fantasy points follow it\.$/);
    // The weighted-opportunities caption came off the backfield legend (2026-10-01).
    assert.equal(doc.querySelector(".sct-us-keys .is-def"), null);
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
    assert.equal(tail.querySelector(".sct-faq-q").textContent, "Who leads the Bills in target share?");
    assert.equal(tail.querySelectorAll(".sct-faq-item").length, 15);
    assert.equal(tail.querySelector(".sct-faq-more"), null);
  });

  test("…and is in the FAQPage with the answer the page shows", async () => {
    const { doc } = await page("/team/buffalo-bills/usage/");
    const node = [...doc.querySelectorAll('script[type="application/ld+json"]')]
      .map((s) => JSON.parse(s.textContent))
      .find((j) => j["@type"] === "FAQPage");
    const visible = [...doc.querySelectorAll('[data-sct-faq-for="usage"] .sct-faq-item')];
    assert.equal(visible.length, 15);
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
    assert.ok(JSON.parse(island[1]).some((e) => e.q === "Who leads the Bills in target share?"));
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
    assert.equal(us.querySelector(".sct-us-convert h3").textContent, "Put this usage data to work");
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
