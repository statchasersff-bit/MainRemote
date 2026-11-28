/**
 * The player hub's FAQ against the FAQPage WordPress builds from it
 * (WEB-044 / WEB-030, 2026-11-26). Mirrors tests/team-faq-schema.test.mjs.
 *
 * The Gibbs hub shipped 64 FAQ questions on 2026-11-25: every tab's FAQ sat
 * in the profile's hidden panels and in its FAQPage node. Now the profile
 * prints every tab's FAQ (mak, 2026-11-28) and each tab's own address prints
 * its own, at most 10 per tab. For a sample of players (a high-volume starter, a
 * limited-stats back, an IR rookie and others) this fetches the hub and every
 * tab WordPress mounts, runs the plugin's OWN code on them in PHP
 * (tests/helpers/player-faq-plugin.php) and checks that the visible questions
 * and answers equal the FAQPage's, that Rank Math's graph carries one FAQPage,
 * and the editorial limits.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { startServer, APP_DIR } from "./helpers/server.mjs";

const SLUGS = ["jahmyr-gibbs", "luther-burden-iii", "amon-ra-st-brown", "nate-carter", "hayden-large", "jacoby-brissett"];
const SECTIONS = ["stats", "game-log", "outlook", "injury", "news", "bio"];

function findPhp() {
  if (process.env.PHP) return process.env.PHP;
  try {
    return execFileSync("sh", ["-c", "command -v php"], { encoding: "utf8" }).trim() || null;
  } catch {
    /* not on PATH */
  }
  try {
    return (
      fs
        .readdirSync("/nix/store")
        .filter((d) => /-php-with-extensions-/.test(d))
        .sort()
        .reverse()
        .map((d) => path.join("/nix/store", d, "bin", "php"))
        .find((p) => fs.existsSync(p)) ?? null
    );
  } catch {
    return null;
  }
}

const norm = (s) => String(s ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
const key = (q, a) => `${norm(q)}\u0000${norm(a)}`;

function visibleFaq(html) {
  const doc = new JSDOM(html).window.document;
  return [...doc.querySelectorAll(".scp-tab-faq details")].map((d) => ({
    q: d.querySelector("summary")?.textContent ?? "",
    a: d.querySelector("p")?.textContent ?? "",
    tab: d.closest(".scp-tab-faq")?.getAttribute("data-faq-tab"),
  }));
}

let server;
let php;
const pages = {};
let plugin = {};

before(async () => {
  php = findPhp();
  server = await startServer({ SC_LIVE_WARM: "0", SC_EDGE_PREFETCH: "0", SC_WATCHDOG: "0" });
  for (const slug of SLUGS) {
    const hub = await fetch(`${server.origin}/embed/player/${slug}`);
    if (hub.status !== 200) continue;
    pages[slug] = await hub.text();
    for (const section of SECTIONS) {
      const r = await fetch(`${server.origin}/embed/player/${slug}?section=${section}`);
      if (r.status !== 200) continue;
      const html = await r.text();
      // A tab the player does not have falls back to the profile; skip it.
      if (!html.includes(`data-section="${section}"`)) continue;
      pages[`${slug}/${section}`] = html;
    }
  }
  if (php) {
    plugin = JSON.parse(
      execFileSync(php, [path.join(APP_DIR, "tests", "helpers", "player-faq-plugin.php")], {
        input: JSON.stringify(pages),
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
      }),
    );
  }
});

after(async () => {
  await server?.stop();
});

describe("player FAQ vs the FAQPage the plugin builds", () => {
  test("the sample rendered", () => {
    for (const slug of SLUGS) assert.ok(pages[slug], `${slug} hub`);
    assert.ok(Object.keys(pages).length > SLUGS.length + 10);
  });

  test("visible questions and answers equal the FAQPage's, as sets", (t) => {
    if (!php) return t.skip("no PHP binary found; set $PHP");
    for (const [name, { items, node, printed }] of Object.entries(plugin)) {
      assert.ok(!/scp-faq-data/.test(printed), `${name}: the island is stripped from what WordPress prints`);
      const shown = visibleFaq(printed);
      if (!shown.length) {
        assert.equal(node, null, `${name}: no questions, no node`);
        continue;
      }
      assert.equal(node["@type"], "FAQPage", name);
      const schema = node.mainEntity.map((q) => ({ q: q.name, a: q.acceptedAnswer.text }));
      assert.equal(schema.length, items.length);
      const seen = new Set(shown.map((e) => key(e.q, e.a)));
      const marked = new Set(schema.map((e) => key(e.q, e.a)));
      for (const e of schema) assert.ok(seen.has(key(e.q, e.a)), `${name}: schema-only question "${e.q}"`);
      for (const e of shown) assert.ok(marked.has(key(e.q, e.a)), `${name}: visible question missing from schema "${e.q}"`);
      assert.equal(seen.size, shown.length, `${name}: no question printed twice`);
    }
  });

  test("Rank Math's graph carries one FAQPage on the page entity", (t) => {
    if (!php) return t.skip("no PHP");
    for (const [name, { graph, node }] of Object.entries(plugin)) {
      if (!node) continue;
      const faqs = Object.values(graph).filter((x) => x && x["@type"] === "FAQPage");
      assert.equal(faqs.length, 1, `${name}: one FAQPage`);
      assert.equal(faqs[0]["@id"], "https://statchasers.com/nfl/players/x/#webpage", name);
    }
  });

  // The hub prints every tab's FAQ again (mak, 2026-11-28); each tab's own
  // FAQ stays at most 10 (FAQ_MAX).
  test("the hub prints every tab's FAQ, each tab at most 10", () => {
    for (const [name, html] of Object.entries(pages)) {
      const shown = visibleFaq(html);
      const perTab = new Map();
      for (const e of shown) perTab.set(e.tab, (perTab.get(e.tab) ?? 0) + 1);
      for (const [tab, n] of perTab) assert.ok(n <= 10, `${name} ${tab}: ${n} questions`);
      if (!name.includes("/") && shown.length > 10) {
        assert.ok(perTab.size > 1, `${name}: more than the Overview's FAQ`);
      }
    }
  });
});
