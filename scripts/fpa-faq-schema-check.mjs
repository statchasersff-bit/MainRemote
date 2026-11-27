#!/usr/bin/env node
/**
 * WEB-030 / WEB-021 check: every FAQ question and answer in an FPA page's
 * structured data matches the FAQ the page shows, and the other way round.
 *
 *   node scripts/fpa-faq-schema-check.mjs <url-or-file> [<url-or-file> ...]
 *
 * Reads rendered HTML (a file, or a URL fetched once), takes the visible FAQ
 * from the .scf-faq-item folds (question = the h3, answer = the paragraphs of
 * .scf-faq-a joined with a space, tags stripped, entities decoded) and the
 * structured FAQ from whichever carrier the page has:
 *
 *   - application/ld+json: a FAQPage node, top-level or inside @graph, or a
 *     page node Rank Math retyped FAQPage (WordPress);
 *   - the scf-faq-data island (the API's embed fragment, before the plugin
 *     strips it).
 *
 * Exits 1 when a page has questions in one place and not the other, a
 * different order, a different answer, or more than one FAQ carrier. No
 * dependencies: regex over our own markup, which is regular by construction.
 */

import { readFile } from "node:fs/promises";

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === "#") {
      const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return String.fromCodePoint(code);
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

function clean(html) {
  return decode(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

function visibleFaq(html) {
  const items = [];
  for (const m of html.matchAll(/<details class="scf-faq-item">(.*?)<\/details>/gs)) {
    const q = m[1].match(/<h3 class="scf-faq-q">(.*?)<\/h3>/s);
    const a = m[1].match(/<div class="scf-faq-a">(.*?)<\/div>/s);
    const paragraphs = a ? [...a[1].matchAll(/<p>(.*?)<\/p>/gs)].map((p) => clean(p[1])) : [];
    items.push({ q: q ? clean(q[1]) : "", a: paragraphs.join(" ") });
  }
  return items;
}

function isFaqPage(node) {
  const types = [].concat(node?.["@type"] ?? []);
  return types.includes("FAQPage");
}

function structuredFaqs(html) {
  const carriers = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs)) {
    let json;
    try {
      json = JSON.parse(m[1]);
    } catch {
      carriers.push({ kind: "ld+json (unparseable)", items: [] });
      continue;
    }
    const nodes = Array.isArray(json["@graph"]) ? json["@graph"] : [json];
    for (const node of nodes) {
      if (!isFaqPage(node)) continue;
      carriers.push({
        kind: `ld+json ${node["@id"] ?? "(no @id)"}`,
        items: (node.mainEntity ?? []).map((e) => ({
          q: String(e.name ?? "").replace(/\s+/g, " ").trim(),
          a: String(e.acceptedAnswer?.text ?? "").replace(/\s+/g, " ").trim(),
        })),
      });
    }
  }
  for (const m of html.matchAll(/<script type="application\/json" class="scf-faq-data">(.*?)<\/script>/gs)) {
    const entries = JSON.parse(m[1].replace(/<\\\//g, "</"));
    carriers.push({
      kind: "scf-faq-data island",
      items: entries.map((e) => ({ q: String(e.q).replace(/\s+/g, " ").trim(), a: String(e.a).replace(/\s+/g, " ").trim() })),
    });
  }
  return carriers;
}

async function load(target) {
  if (/^https?:\/\//.test(target)) {
    const res = await fetch(target, { headers: { "User-Agent": "Mozilla/5.0 (compatible; faq-schema-check)" } });
    return res.text();
  }
  return readFile(target, "utf8");
}

let failed = 0;
for (const target of process.argv.slice(2)) {
  const html = await load(target);
  const shown = visibleFaq(html);
  const carriers = structuredFaqs(html);
  const problems = [];

  if (carriers.length > 1) problems.push(`${carriers.length} FAQ carriers: ${carriers.map((c) => c.kind).join(", ")}`);
  const data = carriers[0]?.items ?? [];
  if (shown.length === 0 && data.length === 0) {
    console.log(`${target}: no FAQ shown and none in structured data (consistent)`);
    continue;
  }
  if (!carriers.length) problems.push("FAQ shown but no structured FAQ");
  if (shown.length !== data.length) problems.push(`${shown.length} shown vs ${data.length} in structured data`);
  const n = Math.max(shown.length, data.length);
  for (let i = 0; i < n; i++) {
    const s = shown[i];
    const d = data[i];
    if (!s || !d) continue;
    if (s.q !== d.q) problems.push(`Q${i + 1} differs:\n    shown: ${s.q}\n    data:  ${d.q}`);
    if (s.a !== d.a) problems.push(`A${i + 1} differs for "${s.q}":\n    shown: ${s.a}\n    data:  ${d.a}`);
  }
  if (/\u2014/.test(shown.map((s) => s.q + s.a).join(""))) problems.push("an em dash in the FAQ");

  if (problems.length) {
    failed++;
    console.log(`${target}: FAIL (${carriers[0]?.kind ?? "no carrier"})`);
    for (const p of problems) console.log(`  - ${p}`);
  } else {
    console.log(`${target}: OK - ${shown.length} questions, every Q and A identical in ${carriers[0].kind}`);
  }
}
process.exit(failed ? 1 : 0);
