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
    const panels = [...doc.querySelectorAll("[data-sct-panel]")].map((s) => s.id);
    assert.deepEqual(panels.slice(0, 2), ["outlook", "usage"]);
    assert.ok(panels.indexOf("stats") > panels.indexOf("usage"));
    const tabs = [...doc.querySelectorAll(".sct-nav-link")].map((a) => a.textContent);
    assert.deepEqual(tabs.slice(0, 2), ["Outlook", "Usage"]);
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
    assert.equal(doc.title, "Buffalo Bills Target Share & Snap Counts 2026: Usage Report | StatChasers");
    assert.match(
      doc.querySelector('meta[name="description"]').getAttribute("content"),
      /^Buffalo Bills target share, snap share and red-zone touches for 2026, updated every Tuesday/,
    );
    assert.equal(doc.querySelector('link[rel="canonical"]')?.getAttribute("href")?.endsWith("/usage/"), true);
    // The page's FAQPage describes this page's question alone.
    const faq = [...doc.querySelectorAll('script[type="application/ld+json"]')]
      .map((s) => JSON.parse(s.textContent))
      .find((j) => j["@type"] === "FAQPage");
    assert.deepEqual(faq.mainEntity.map((q) => q.name), ["Who leads the Buffalo Bills in target share?"]);
  });

  test("with the host's heading off, the section's H1 is the address's phrase", async () => {
    const { doc } = await page("/embed/team/buffalo-bills?section=usage&h1=1");
    assert.equal(doc.querySelector("h1").textContent, "Buffalo Bills Usage & Opportunity Report 2026");
  });
});

describe("the ten components, in order", () => {
  test("header, intro, environment, tree, backfield, pass map, table, legend, signals, closing", async () => {
    const { doc } = await page("/team/buffalo-bills/");
    const root = doc.querySelector("#usage .sct-us");
    const order = [
      ".sct-us-head",
      ".sct-us-intro",
      ".sct-us-env",
      ".sct-us-card",
      ".sct-us-scroll",
      ".sct-us-legend",
      ".sct-us-close",
    ].map((sel) => root.querySelector(sel));
    order.forEach((el, i) => assert.ok(el, `component ${i} present`));
    const all = [...root.querySelectorAll("*")];
    const idx = order.map((el) => all.indexOf(el));
    assert.deepEqual([...idx].sort((a, b) => a - b), idx);
    const h3s = [...root.querySelectorAll(".sct-us-card > .sct-us-h3")].map((h) => h.textContent);
    assert.equal(h3s[0], "The Target Tree");
    assert.equal(h3s[1], "The Backfield Split");
    assert.match(h3s[2], /^Where \S+ Attacks$/);
  });

  test("freshness chip is driven by the data file", async () => {
    const { doc } = await page("/team/buffalo-bills/");
    assert.equal(
      doc.querySelector(".sct-us-fresh").textContent,
      `Updated through Week ${Math.max(...usage.teams.buf.games)} · refreshed daily`,
    );
  });

  test("each hub is labelled with its own last game, not the league's latest week", async () => {
    // A Thursday game puts one matchup's week into the feed days before the
    // rest: only the teams that played it may say that week.
    for (const [abbr, slug] of [["ne", "new-england-patriots"], ["cle", "cleveland-browns"]]) {
      const { doc } = await page(`/team/${slug}/`);
      const last = Math.max(...usage.teams[abbr].games);
      assert.equal(doc.querySelector(".sct-us-fresh").textContent, `Updated through Week ${last} · refreshed daily`, slug);
    }
  });

  test("the verbatim definitions stay in plain prose", async () => {
    const { doc } = await page("/team/buffalo-bills/");
    const intro = doc.querySelector(".sct-us-intro").textContent;
    assert.match(intro, /^Fantasy production follows opportunity, not the other way around/);
    assert.match(intro, /The essentials are target share, snap share, and red-zone touches\./);
    assert.match(intro, /Follow the opportunity before the fantasy points follow it\.$/);
    // The weighted-opportunities caption came off the backfield legend (2026-10-01).
    assert.equal(doc.querySelector(".sct-us-keys .is-def"), null);
  });

  test("Redraft Command is linked in the closing paragraph", async () => {
    const { doc } = await page("/team/buffalo-bills/");
    assert.equal(doc.querySelector(".sct-us-close a").getAttribute("href"), "https://statchasers.com/redraft-command/");
  });
});

describe("the highlights", () => {
  test("exactly one gold gap and one gold zone; one owner per situation row", async () => {
    const { doc } = await page("/team/buffalo-bills/");
    assert.equal(doc.querySelectorAll(".sct-us-gap.is-best").length, 1);
    assert.equal(doc.querySelectorAll(".sct-us-zone.is-best").length, 1);
    const rows = [...doc.querySelectorAll(".sct-us-grow:not(.is-head)")];
    assert.equal(rows.length, 6);
    for (const row of rows) assert.ok(row.querySelectorAll(".is-owner").length >= 1);
  });

  test("trend colours follow the sign of the delta", async () => {
    const { doc } = await page("/team/buffalo-bills/");
    for (const d of doc.querySelectorAll(".sct-us-delta.is-up")) assert.match(d.textContent, /^\+/);
    for (const d of doc.querySelectorAll(".sct-us-delta.is-down")) assert.match(d.textContent, /^−/);
  });

  test("every sparkline and bar carries its numbers in text", async () => {
    const { doc } = await page("/team/buffalo-bills/");
    for (const el of doc.querySelectorAll(".sct-us-spark, .sct-us-pbar, .sct-us-bar, .sct-us-gauge")) {
      assert.ok(el.getAttribute("aria-label"), el.className);
    }
  });
});

describe("profiles", () => {
  test("every toggle controls a detail row that exists", async () => {
    const { doc } = await page("/team/buffalo-bills/");
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
    const { doc, window, errors } = await hydrated("/team/buffalo-bills/");
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

  test("the Usage tab switches in place and puts /usage/ in the address", async () => {
    const { doc, window } = await hydrated("/team/buffalo-bills/");
    doc.querySelector("#usage-tab").dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0 }));
    assert.ok(doc.querySelector("#usage").classList.contains("is-active"));
    assert.equal(window.location.pathname, "/team/buffalo-bills/usage/");
    doc.querySelector("#outlook-tab").dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0 }));
    assert.ok(doc.querySelector("#outlook").classList.contains("is-active"));
    assert.equal(window.location.pathname, "/team/buffalo-bills/");
  });

  test("a deep link to #usage opens the panel", async () => {
    const { doc } = await hydrated("/team/buffalo-bills/#usage");
    assert.ok(doc.querySelector("#usage").classList.contains("is-active"));
  });
});

describe("FAQ", () => {
  test("the target-share question is visible and links to #usage", async () => {
    const { doc } = await page("/team/buffalo-bills/");
    const tail = doc.querySelector('[data-sct-faq-for="usage"]');
    assert.equal(tail.querySelector(".sct-faq-q").textContent, "Who leads the Buffalo Bills in target share?");
    assert.equal(tail.querySelector(".sct-faq-more a").getAttribute("href"), "#usage");
  });

  test("…and is in the FAQPage with the answer the page shows", async () => {
    const { doc } = await page("/team/buffalo-bills/");
    const node = [...doc.querySelectorAll('script[type="application/ld+json"]')]
      .map((s) => JSON.parse(s.textContent))
      .find((j) => j["@type"] === "FAQPage");
    const q = node.mainEntity.find((m) => m.name === "Who leads the Buffalo Bills in target share?");
    assert.ok(q);
    const visible = doc.querySelector('[data-sct-faq-for="usage"] .sct-faq-a').textContent;
    assert.equal(q.acceptedAnswer.text, visible);
  });

  test("embedded, it rides in the data island for Rank Math", async () => {
    const res = await fetch(`${server.origin}/embed/team/buf`);
    const body = await res.text();
    const island = body.match(/<script type="application\/json" class="sct-faq-data">(.*?)<\/script>/s);
    assert.ok(JSON.parse(island[1]).some((e) => e.q === "Who leads the Buffalo Bills in target share?"));
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
      const { doc } = await page(`/team/${slug}/`);
      const section = doc.querySelector("#usage");
      assert.ok(section, slug);
      const text = section.textContent;
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
      const { doc } = await page(`/team/${slug}/`);
      const section = doc.querySelector("#usage");
      section.querySelector(".sct-us-intro")?.remove();
      const text = section.textContent;
      for (const [re, why] of OVERCLAIMS) {
        const hit = text.match(re);
        assert.equal(hit, null, `${slug}: "${hit?.[0]}" - ${why}`);
      }
    }
  });
});
