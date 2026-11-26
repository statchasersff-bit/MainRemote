#!/usr/bin/env node
// Player-page audit release check (2026-11-26): the same read before and after
// the player SEO release (docs/RELEASE-WINDOW.md, reserved slot 2026-12-15).
//
//   node scripts/player-audit-release-check.mjs live [out.json]
//       Read-only pass over production: browser user agent, one request at a
//       time, at least 1.6 s apart. Records, per URL: status and redirect
//       chain, <title>, canonical, robots meta, visible FAQ count per FAQ
//       section, FAQPage question count (JSON-LD); the page sitemaps' row
//       counts (total, unique, the Bagent/Swift/alias rows); the FPA page's
//       caption and softest-RB figure for bare, ?format=ppr, half, standard.
//
//   node scripts/player-audit-release-check.mjs candidate [out.json]
//       The same pages from this checkout's API (built dist, started locally
//       with tests/helpers/server.mjs): the title the page-data island sets,
//       the FAQ the fragment prints and the FAQ data the plugin turns into
//       FAQPage, the FPA fragments. Canonical, robots, redirects and sitemap
//       rows are the plugin's; their expected values are written out below
//       (EXPECTED) from the plugin rules and its smoke tests.
//
//   node scripts/player-audit-release-check.mjs compare before.json after.json
//       Prints the two side by side (a live baseline against the candidate,
//       or the post-release live run against the baseline).
//
// No writes anywhere, no purges. Re-run "live" after the release and compare
// it with docs/PLAYER-AUDIT-BASELINE-2026-11-26.json.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const SITE = "https://statchasers.com";
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const GAP_MS = 1600;

// The representative set: hub + two tabs each where the player has them.
const PAGES = [
  ["jahmyr-gibbs", ["", "stats", "game-log"]],
  ["john-michael-gyllenborg", ["", "stats", "bio"]], // longest name on the roster
  ["bo-nix", ["", "stats", "outlook"]], // shortest name
  ["hayden-large", ["", "outlook", "news"]], // IR, no games, no Stats tab
  ["isiah-pacheco", ["", "outlook", "injury"]], // IR after playing
  ["amon-ra-st-brown", ["", "stats", "game-log"]],
  ["tyson-bagent", ["", "stats"]], // WP duplicate pair 4926/4927
  ["dandre-swift", ["", "stats"]], // WP duplicate pair 4928/4929
  ["mitch-tinsley", ["", "game-log"]], // roster slug
  ["mitchell-tinsley", ["", "game-log"]], // verified alias of mitch-tinsley
  ["chris-brazzell", [""]], // verified alias of chris-brazzell-ii
  ["kenneth-walker", [""]], // ambiguous (a different stable id): must not redirect
];

// URL variants whose redirect is checked (live: the chain; candidate: expected).
const VARIANTS = [
  "/nfl/players/jahmyr-gibbs/?log=2025",
  "/nfl/players/Jahmyr-Gibbs/",
  "/nfl/players//jahmyr-gibbs/stats/",
  "/nfl/players/jahmyr-gibbs/overview/",
  "/nfl/players/dandre-swift-2/",
  "/nfl/players/mitchell-tinsley/",
  "/nfl/players/mitchell-tinsley/game-log/",
  "/nfl/players/Mitchell-Tinsley//Stats/",
  "/nfl/players/mitchell-tinsley/badtab/",
  "/nfl/players/chris-brazzell/",
  "/nfl/players/kenneth-walker/",
];

const FPA = ["", "?format=ppr", "?format=half", "?format=standard"];
const FPA_PATH = "/nfl/fantasy-points-allowed-by-position/";

// What the candidate should show once released (plugin rules + smoke tests).
const EXPECTED = {
  redirects: {
    "/nfl/players/jahmyr-gibbs/?log=2025": "301 -> /nfl/players/jahmyr-gibbs/game-log/#log=2025",
    "/nfl/players/Jahmyr-Gibbs/": "301 -> /nfl/players/jahmyr-gibbs/",
    "/nfl/players//jahmyr-gibbs/stats/": "301 -> /nfl/players/jahmyr-gibbs/stats/",
    "/nfl/players/jahmyr-gibbs/overview/": "301 -> /nfl/players/jahmyr-gibbs/",
    "/nfl/players/dandre-swift-2/": "301 -> /nfl/players/dandre-swift/",
    "/nfl/players/mitchell-tinsley/": "301 -> /nfl/players/mitch-tinsley/",
    "/nfl/players/mitchell-tinsley/game-log/": "301 -> /nfl/players/mitch-tinsley/game-log/",
    "/nfl/players/Mitchell-Tinsley//Stats/": "301 -> /nfl/players/mitch-tinsley/stats/ (one hop)",
    "/nfl/players/mitchell-tinsley/badtab/": "404 (no redirect)",
    "/nfl/players/chris-brazzell/": "301 -> /nfl/players/chris-brazzell-ii/",
    "/nfl/players/kenneth-walker/": "200, noindex (ambiguous alias: unchanged)",
  },
  canonical: "self, https://statchasers.com/nfl/players/<slug>/<tab>/, unchanged",
  robots: "index on roster profiles; the alias pages are never reached (301); kenneth-walker stays noindex",
  sitemap: "page-sitemap*.xml: 0 duplicate rows (the 12 tyson-bagent/dandre-swift tab rows listed once), no mitchell-tinsley/chris-brazzell rows",
  fpa: "bare = PPR (same caption and figure as ?format=ppr); half/standard unchanged",
  faq: "hub FAQ = the Overview's only (<= 10), FAQPage count == visible count on every page",
};

function pick(html, re) {
  const m = re.exec(html);
  return m ? m[1].replace(/&amp;/g, "&").replace(/&#039;|&#8217;/g, "'").trim() : null;
}

function faqSections(html) {
  // Visible FAQ: the <details> inside each FAQ section, in page order. On a
  // hub the first section is the Overview's (the one a reader sees).
  const out = [];
  const re = /<section class="scp-ox-sec scp-tab-faq"/g;
  let m;
  const starts = [];
  while ((m = re.exec(html))) starts.push(m.index);
  for (let i = 0; i < starts.length; i++) {
    const end = html.indexOf("</section>", starts[i]);
    out.push((html.slice(starts[i], end === -1 ? undefined : end).match(/<details\b/g) ?? []).length);
  }
  return out;
}

function faqSchemaCount(html) {
  // Questions in JSON-LD FAQPage nodes (Rank Math's graph on production).
  let n = 0;
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    n += (m[1].match(/"@type"\s*:\s*"Question"/g) ?? []).length;
  }
  return n;
}

function fpaRead(raw) {
  const text = raw
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ");
  // One ranked cell per team: the RB column (figure, rank) of the table row.
  const rb = (code, name) => {
    const m = new RegExp(`${code} ${name} [\\d.]+ \\d+ ([\\d.]+) (\\d+)`).exec(text);
    return m ? `${m[1]} (${m[2]})` : null;
  };
  return {
    format: pick(raw, /data-format="([^"]+)"/),
    caption: pick(text, /All 32 NFL defenses, ([^.<]+?) scoring/),
    dalRb: rb("DAL", "Dallas Cowboys Cowboys"),
    carRb: rb("CAR", "Carolina Panthers Panthers"),
  };
}

let last = 0;
async function politeFetch(url) {
  const wait = last + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  return fetch(url, { redirect: "manual", headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" } });
}

async function chain(url, max = 4) {
  const hops = [];
  let cur = url;
  for (let i = 0; i < max; i++) {
    const r = await politeFetch(cur);
    const loc = r.headers.get("location");
    hops.push({ status: r.status, url: cur.replace(SITE, "") });
    if (r.status >= 300 && r.status < 400 && loc) {
      cur = new URL(loc, cur).toString();
      if (cur.includes("#")) {
        hops.push({ status: "fragment", url: cur.replace(SITE, "") });
        cur = cur.split("#")[0];
      }
      continue;
    }
    return { hops, final: r, finalUrl: cur };
  }
  return { hops, final: null, finalUrl: cur };
}

async function live() {
  const out = { mode: "live", at: new Date().toISOString(), pages: [], redirects: {}, sitemap: {}, fpa: {} };
  for (const [slug, tabs] of PAGES) {
    for (const tab of tabs) {
      const url = `${SITE}/nfl/players/${slug}/${tab ? `${tab}/` : ""}`;
      const { hops, final, finalUrl } = await chain(url);
      const html = final && final.status === 200 ? await final.text() : "";
      out.pages.push({
        slug,
        tab: tab || "hub",
        chain: hops.map((h) => `${h.status} ${h.url}`).join(" -> "),
        final: finalUrl.replace(SITE, ""),
        title: pick(html, /<title>([^<]*)<\/title>/),
        canonical: pick(html, /<link rel="canonical" href="([^"]+)"/),
        robots: pick(html, /<meta name="robots" content="([^"]+)"/),
        faqVisible: faqSections(html),
        faqSchema: faqSchemaCount(html),
      });
      process.stderr.write(`page ${slug} ${tab || "hub"}\n`);
    }
  }
  for (const v of VARIANTS) {
    const { hops } = await chain(`${SITE}${v}`);
    out.redirects[v] = hops.map((h) => `${h.status} ${h.url}`).join(" -> ");
  }
  const locs = [];
  for (let i = 1; i <= 8; i++) {
    const r = await politeFetch(`${SITE}/page-sitemap${i}.xml?cb=${Date.now()}`);
    if (r.status !== 200) break;
    const xml = await r.text();
    for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) locs.push(m[1]);
    out.sitemap[`page-sitemap${i}.xml`] = (xml.match(/<loc>/g) ?? []).length;
  }
  const players = locs.filter((l) => l.includes("/nfl/players/"));
  const count = (re) => locs.filter((l) => re.test(l)).length;
  out.sitemap.total = locs.length;
  out.sitemap.unique = new Set(locs).size;
  out.sitemap.players = players.length;
  out.sitemap.duplicates = locs.length - new Set(locs).size;
  out.sitemap.tysonBagentRows = count(/\/nfl\/players\/tyson-bagent\//);
  out.sitemap.dandreSwiftRows = count(/\/nfl\/players\/dandre-swift\//);
  out.sitemap.mitchellTinsleyRows = count(/\/nfl\/players\/mitchell-tinsley\//);
  out.sitemap.chrisBrazzellRows = count(/\/nfl\/players\/chris-brazzell\//);
  for (const q of FPA) {
    const r = await politeFetch(`${SITE}${FPA_PATH}${q}`);
    out.fpa[q || "(bare)"] = { status: r.status, ...fpaRead(r.status === 200 ? await r.text() : "") };
  }
  return out;
}

async function candidate() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const { startServer } = await import(path.join(here, "..", "artifacts", "api-server", "tests", "helpers", "server.mjs"));
  const srv = await startServer({ SC_LIVE_WARM: "0", SC_EDGE_PREFETCH: "0", SC_WATCHDOG: "0", SC_SCORING_TOTALS: "house" });
  const out = { mode: "candidate", at: new Date().toISOString(), pages: [], redirects: EXPECTED.redirects, sitemap: EXPECTED.sitemap, fpa: {}, expected: EXPECTED };
  try {
    for (const [slug, tabs] of PAGES) {
      for (const tab of tabs) {
        const r = await fetch(`${srv.origin}/embed/player/${slug}${tab ? `?section=${tab}&h1=1` : "?h1=1"}`);
        const html = r.status === 200 ? await r.text() : "";
        let title = null;
        let faqData = null;
        const pd = pick(html, /<script type="application\/json" class="scp-page-data">([\s\S]*?)<\/script>/);
        if (pd) title = JSON.parse(pd).title ?? null;
        const fd = /<script type="application\/json" class="scp-faq-data">([\s\S]*?)<\/script>/.exec(html);
        if (fd) {
          const j = JSON.parse(fd[1]);
          const items = Array.isArray(j) ? j : j.items ?? j.questions ?? j.mainEntity ?? [];
          faqData = Array.isArray(items) ? items.length : null;
        }
        out.pages.push({
          slug,
          tab: tab || "hub",
          status: r.status,
          title,
          canonical: r.status === 200 ? `${SITE}/nfl/players/${slug}/${tab ? `${tab}/` : ""}` : null,
          faqVisible: faqSections(html),
          faqSchema: faqData,
        });
      }
    }
    for (const q of FPA) {
      const r = await fetch(`${srv.origin}/embed/fpa${q}`);
      out.fpa[q || "(bare)"] = { status: r.status, ...fpaRead(await r.text()) };
    }
  } finally {
    await srv.stop();
  }
  return out;
}

function compare(a, b) {
  const key = (p) => `${p.slug} ${p.tab}`;
  const bm = new Map(b.pages.map((p) => [key(p), p]));
  const rows = [];
  for (const p of a.pages) {
    const q = bm.get(key(p)) ?? {};
    rows.push(
      `${key(p)}\n  title     ${p.title} | ${q.title}\n  canonical ${p.canonical} | ${q.canonical}\n  robots    ${p.robots ?? "-"} | ${q.robots ?? "-"}\n  faq       visible ${JSON.stringify(p.faqVisible)} schema ${p.faqSchema} | visible ${JSON.stringify(q.faqVisible)} schema ${q.faqSchema}\n  chain     ${p.chain ?? "-"} | ${q.chain ?? q.status ?? "-"}`,
    );
  }
  rows.push("redirects");
  for (const v of Object.keys({ ...a.redirects, ...b.redirects })) rows.push(`  ${v}\n    ${a.redirects?.[v] ?? "-"} | ${b.redirects?.[v] ?? "-"}`);
  rows.push(`sitemap\n  ${JSON.stringify(a.sitemap)}\n  ${JSON.stringify(b.sitemap)}`);
  rows.push("fpa");
  for (const k of Object.keys(a.fpa ?? {})) rows.push(`  ${k}: ${JSON.stringify(a.fpa[k])} | ${JSON.stringify(b.fpa?.[k])}`);
  return rows.join("\n");
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === "live" || mode === "candidate") {
  const res = mode === "live" ? await live() : await candidate();
  const json = JSON.stringify(res, null, 1);
  if (rest[0]) writeFileSync(rest[0], json + "\n");
  else process.stdout.write(json + "\n");
} else if (mode === "compare" && rest.length === 2) {
  console.log(compare(JSON.parse(readFileSync(rest[0], "utf8")), JSON.parse(readFileSync(rest[1], "utf8"))));
} else {
  console.error("usage: player-audit-release-check.mjs live|candidate [out.json] | compare a.json b.json");
  process.exit(2);
}
