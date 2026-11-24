/**
 * The team hub's FAQ against the FAQPage WordPress builds from it, on all 32
 * hubs (team-page audit, Task 4, 2026-11-24).
 *
 * For each hub this fetches the embedded fragment WordPress mounts
 * (/embed/team/<abbr>), then runs the plugin's OWN code on it in PHP
 * (tests/helpers/team-faq-plugin.php lifts statchasers_team_faq_parse,
 * _faq_node, _rank_math_schema, _strip_faq_data and
 * statchasers_news_schema_page_id out of the plugin source and evaluates
 * them as written) and checks:
 *
 *   - the visible questions and answers in the HTML WordPress prints (island
 *     stripped) and the FAQPage's questions and answers are the same set,
 *     with normalized text - so every schema entry is on the page and a
 *     question removed from the page is gone from the schema too;
 *   - Rank Math's graph ends with exactly one FAQPage, attached to the
 *     page's WebPage @id when there is one;
 *   - the hub stays inside the editorial target (no more than 10 questions,
 *     none repeated), carries no question from its section pages
 *     (/coaching/, /usage/, /stats/, /schedule/, /depth-chart/), and no
 *     draft-season advice while the season is on.
 *
 * Needs PHP: $PHP, `php` on PATH, or the Nix store's php-with-extensions
 * build (memory: php-is-off-path). Without one the comparison is skipped,
 * and says so.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { startServer, APP_DIR } from "./helpers/server.mjs";

const ABBRS = "ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LV LAC LAR MIA MIN NE NO NYG NYJ PHI PIT SF SEA TB TEN WAS".split(" ");
const SECTIONS = ["coaching", "usage", "stats", "schedule", "depth-chart"];

function findPhp() {
  if (process.env.PHP) return process.env.PHP;
  try {
    return execFileSync("sh", ["-c", "command -v php"], { encoding: "utf8" }).trim() || null;
  } catch {
    /* not on PATH */
  }
  const store = "/nix/store";
  try {
    const hit = fs
      .readdirSync(store)
      .filter((d) => /-php-with-extensions-/.test(d))
      .sort()
      .reverse()
      .map((d) => path.join(store, d, "bin", "php"))
      .find((p) => fs.existsSync(p));
    return hit ?? null;
  } catch {
    return null;
  }
}

const norm = (s) => String(s ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
const key = (q, a) => `${norm(q)}\u0000${norm(a)}`;

/** Every FAQ item on the page as the FAQPage must carry it (faq-block.ts's join). */
function visibleFaq(html) {
  const doc = new JSDOM(html).window.document;
  const part = (el) =>
    el.tagName === "UL"
      ? [...el.querySelectorAll("li")].map((li) => `- ${li.textContent.trim()}`).join("\n")
      : el.textContent.trim();
  return [...doc.querySelectorAll(".sct-faq-item")].map((item) => ({
    q: item.querySelector(".sct-faq-q")?.textContent?.trim() ?? "",
    a: [...item.querySelectorAll(".sct-faq-a")].map(part).join("\n\n"),
  }));
}

const islandQuestions = (html) =>
  [...html.matchAll(/<script type="application\/json" class="sct-faq-data">(.*?)<\/script>/gs)].flatMap((m) =>
    JSON.parse(m[1]).map((e) => norm(e.q)),
  );

let server;
let php;
const hubs = {};
const sectionQuestions = {};
let plugin = {};

before(async () => {
  php = findPhp();
  server = await startServer();
  for (const abbr of ABBRS) {
    const slug = abbr.toLowerCase();
    const res = await fetch(`${server.origin}/embed/team/${slug}`);
    assert.equal(res.status, 200, `${abbr} hub`);
    hubs[abbr] = await res.text();
    sectionQuestions[abbr] = new Set();
    for (const section of SECTIONS) {
      const r = await fetch(`${server.origin}/embed/team/${slug}?section=${section}`);
      if (r.status !== 200) continue;
      for (const q of islandQuestions(await r.text())) sectionQuestions[abbr].add(q);
    }
  }
  if (php) {
    const out = execFileSync(php, [path.join(APP_DIR, "tests", "helpers", "team-faq-plugin.php")], {
      input: JSON.stringify(hubs),
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    plugin = JSON.parse(out);
  }
});

after(async () => {
  await server?.stop();
});

describe("team hub FAQ vs the FAQPage the plugin builds, all 32 hubs", () => {
  test("PHP is available to run the plugin's code", (t) => {
    if (!php) t.skip("no PHP binary found; set $PHP");
    assert.equal(Object.keys(plugin).length, ABBRS.length);
  });

  test("visible questions and answers equal the FAQPage's, as sets", (t) => {
    if (!php) return t.skip("no PHP");
    for (const abbr of ABBRS) {
      const { items, node, printed } = plugin[abbr];
      assert.ok(!/sct-faq-data/.test(printed), `${abbr}: the island is stripped from what WordPress prints`);
      const shown = visibleFaq(printed);
      assert.ok(shown.length > 0, `${abbr}: the hub has questions`);
      assert.ok(node && node["@type"] === "FAQPage", `${abbr}: a FAQPage node`);
      const schema = node.mainEntity.map((q) => ({ q: q.name, a: q.acceptedAnswer.text }));
      assert.equal(schema.length, items.length);
      const seen = new Set(shown.map((e) => key(e.q, e.a)));
      const marked = new Set(schema.map((e) => key(e.q, e.a)));
      for (const e of schema) assert.ok(seen.has(key(e.q, e.a)), `${abbr}: schema-only question "${e.q}"`);
      for (const e of shown) assert.ok(marked.has(key(e.q, e.a)), `${abbr}: visible question missing from schema "${e.q}"`);
      assert.equal(seen.size, shown.length, `${abbr}: no question printed twice`);
      assert.equal(marked.size, schema.length, `${abbr}: no question marked up twice`);
    }
  });

  test("Rank Math's graph ends with one FAQPage, on the page's WebPage @id when there is one", (t) => {
    if (!php) return t.skip("no PHP");
    for (const abbr of ABBRS) {
      const { node, graphs } = plugin[abbr];
      const n = node.mainEntity.length;
      for (const [name, graph] of Object.entries(graphs)) {
        const faqs = Object.values(graph).filter((x) => x && x["@type"] === "FAQPage");
        assert.equal(faqs.length, 1, `${abbr} ${name}: exactly one FAQPage`);
        assert.equal(faqs[0].mainEntity.length, n, `${abbr} ${name}: every question carried`);
      }
      assert.equal(graphs.with_webpage.WebPage["@id"], "https://statchasers.com/team/x/#webpage", `${abbr}: the page entity keeps its @id`);
    }
  });

  test("an editorial set: at most 10 questions, none from the section pages or the draft season", () => {
    const counts = {};
    for (const abbr of ABBRS) {
      const qs = islandQuestions(hubs[abbr]);
      counts[abbr] = qs.length;
      assert.ok(qs.length >= 1 && qs.length <= 10, `${abbr}: ${qs.length} questions`);
      assert.ok(sectionQuestions[abbr].size > 0, `${abbr}: the section pages' questions were read`);
      for (const q of qs) assert.ok(!sectionQuestions[abbr].has(q), `${abbr}: "${q}" is a section page's question`);
      // The preseason outlook's questions are draft advice; the in-season
      // hub carries none of them (the 2027 NFL Draft pick question is not
      // fantasy draft advice and stays).
      assert.ok(
        !qs.some((q) => /worth drafting|to draft in fantasy|sleeper for|fantasy outlook with|WR2 behind/.test(q)),
        `${abbr}: no draft-season advice`,
      );
    }
    const det = counts.DET;
    assert.ok(det <= 10, `DET ${det}`);
  });
});
