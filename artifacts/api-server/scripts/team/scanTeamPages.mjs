#!/usr/bin/env node
/**
 * Team-page audit scan: inventory, descriptions, share images, schema graph,
 * server-rendered navigation and previous-season game links, for the NFL team
 * directory, all 32 hubs and every team tab address.
 *
 *   node scripts/team/scanTeamPages.mjs                          # live site
 *   node scripts/team/scanTeamPages.mjs https://statchasers.com --games
 *   node scripts/team/scanTeamPages.mjs --only=buffalo-bills,miami-dolphins --games
 *   node scripts/team/scanTeamPages.mjs --json=/tmp/team-scan.json
 *   node scripts/team/scanTeamPages.mjs http://localhost:8099 --prefix=/team/ --no-sitemap --no-head
 *
 * What it does, in order:
 *
 *  1. Inventory. Reads the Rank Math sitemap index and keeps every
 *     `<prefix>` URL (the registered team addresses: the directory, 32 hubs,
 *     seven tabs each). Then fetches the directory and every hub/tab in that
 *     list, one request at a time (--delay, default 1600 ms: the live site
 *     answers 429 above about one request per 1.5 s).
 *  2. Per page: status, canonical (must equal the URL), robots, description
 *     (length, truncation, duplicates across the run), og:image +
 *     twitter:image (absolute https, then the image itself is fetched once:
 *     200 and an image/* content type), the JSON-LD graph (one parseable
 *     graph; Organization, WebSite, exactly one page node whose @id/url is the
 *     canonical, isPartOf the WebSite, publisher the Organization; no
 *     duplicate @id; no second page-typed node such as an id-less FAQPage; a
 *     BreadcrumbList ending at the canonical; the Schedule tab's ItemList),
 *     and the team identity (the slug's team name in og:title).
 *  3. Navigation. Every server-rendered <a href> under the prefix is
 *     collected. The directory must link all 32 hubs; each hub must link its
 *     tabs; a breadth-first walk from the directory over those links reports
 *     every sitemap address it cannot reach. Internal team links that are not
 *     in the inventory are fetched once and reported when they are not 200.
 *  4. --games: on each Schedule tab, every link to a dated game page of an
 *     earlier season (`/nfl/<pair>/<season>-week-N/` and named rounds) is
 *     fetched once; anything but a 200 is an unresolved destination. Rows the
 *     page prints without a link (`data-shp-unlinked`) are counted too.
 *
 * --no-sitemap builds the inventory from the directory's links instead (for a
 * local API origin, which has no sitemap). --no-head skips the head checks
 * (the API origin's head is not the WordPress head). Exit status 1 when any
 * failure is found. Read a 403/429 as "blocked", not a page finding.
 */

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const flagValue = (name, fallback) => {
  const hit = flag(name);
  if (!hit) return fallback;
  const at = hit.indexOf("=");
  return at === -1 ? true : hit.slice(at + 1);
};

const BASE = (args.find((a) => !a.startsWith("--")) ?? "https://statchasers.com").replace(/\/+$/, "");
const PREFIX = String(flagValue("prefix", "/nfl/teams/"));
const DELAY = Number(flagValue("delay", 1600));
const ONLY = flagValue("only", "") ? String(flagValue("only", "")).split(",") : null;
const GAMES = !!flag("games");
const SITEMAP = !flag("no-sitemap");
const HEAD = !flag("no-head");
const JSON_OUT = flagValue("json", "");
const QUERY = String(flagValue("query", ""));
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const TABS = ["usage", "coaching", "stats", "schedule", "depth-chart", "matchups", "news"];
const DESC_MAX = 160;
const PAGE_TYPES = new Set(["WebPage", "CollectionPage", "FAQPage", "ProfilePage", "AboutPage", "ItemPage", "SearchResultsPage"]);

let last = 0;
async function get(url, { method = "GET", redirect = "manual" } = {}) {
  const wait = last + DELAY - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { method, redirect, headers: { "user-agent": UA, accept: "text/html,*/*" } });
      const body = method === "GET" && /text|xml|json|html/.test(res.headers.get("content-type") ?? "") ? await res.text() : "";
      if (method === "GET" && !body) await res.arrayBuffer().catch(() => null);
      if (res.status === 429 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 10_000));
        continue;
      }
      return { status: res.status, type: res.headers.get("content-type") ?? "", location: res.headers.get("location") ?? "", body };
    } catch (err) {
      if (attempt === 2) return { status: 0, type: "", location: "", body: "", error: String(err) };
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  return { status: 0, type: "", location: "", body: "" };
}

const decode = (s) =>
  String(s ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#8217;/g, "’");

/** The <head>-level tags we read, from raw HTML. */
function readHead(html) {
  const head = html.split(/<\/head>/i)[0] ?? html;
  const meta = (attr, name) => {
    const re = new RegExp(`<meta[^>]*${attr}=["']${name}["'][^>]*>`, "gi");
    return [...head.matchAll(re)].map((m) => decode((m[0].match(/content=["']([^"']*)["']/i) ?? [])[1] ?? ""));
  };
  const canonicals = [...head.matchAll(/<link[^>]*rel=["']canonical["'][^>]*>/gi)].map((m) => (m[0].match(/href=["']([^"']*)["']/i) ?? [])[1] ?? "");
  const graphs = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  return {
    title: decode((head.match(/<title>([^<]*)<\/title>/i) ?? [])[1] ?? ""),
    description: meta("name", "description"),
    robots: meta("name", "robots"),
    canonicals,
    ogUrl: meta("property", "og:url"),
    ogTitle: meta("property", "og:title"),
    ogImage: meta("property", "og:image"),
    twitterCard: meta("name", "twitter:card"),
    twitterImage: meta("name", "twitter:image"),
    graphs,
  };
}

/** Every <a href> in the body, absolute, without hash or query. */
function readLinks(html, pageUrl) {
  const out = [];
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"'#][^"']*|#[^"']*)["']/gi)) {
    const raw = decode(m[1]);
    if (raw.startsWith("#")) continue;
    try {
      const u = new URL(raw, pageUrl);
      u.hash = "";
      u.search = "";
      out.push(u.toString());
    } catch {
      /* not a URL */
    }
  }
  return out;
}

function descriptionIssues(text) {
  const issues = [];
  if (!text) return ["missing"];
  if (text.length > DESC_MAX) issues.push(`long:${text.length}`);
  if (/(\.\.\.|…)\s*$/.test(text) || !/[.!?)]$/.test(text.trim())) issues.push("truncated");
  return issues;
}

function schemaIssues(page, kind) {
  const issues = [];
  if (page.head.graphs.length === 0) return ["no JSON-LD"];
  const nodes = [];
  for (const raw of page.head.graphs) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      issues.push("unparseable JSON-LD");
      continue;
    }
    const graph = Array.isArray(data) ? data : data["@graph"] ?? [data];
    nodes.push(...graph);
  }
  const typesOf = (n) => (Array.isArray(n["@type"]) ? n["@type"] : [n["@type"]]);
  const byType = (t) => nodes.filter((n) => typesOf(n).includes(t));
  const ids = nodes.map((n) => n["@id"]).filter(Boolean);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) issues.push(`duplicate @id ${[...new Set(dupes)].join(" ")}`);
  const org = byType("Organization")[0];
  const site = byType("WebSite")[0];
  if (!org?.["@id"]) issues.push("no Organization");
  if (!site?.["@id"]) issues.push("no WebSite");
  else if (org && site.publisher?.["@id"] !== org["@id"]) issues.push("WebSite.publisher is not the Organization");
  const pages = nodes.filter((n) => typesOf(n).some((t) => PAGE_TYPES.has(t)));
  const canonical = page.url;
  if (pages.length === 0) issues.push("no WebPage");
  if (pages.length > 1) issues.push(`competing page nodes: ${pages.map((p) => `${typesOf(p).join("+")}@${p["@id"] ?? "no-id"}`).join(", ")}`);
  const main = pages.find((p) => p["@id"]) ?? pages[0];
  if (main) {
    const id = String(main["@id"] ?? "");
    if (!id) issues.push("WebPage has no @id");
    else if (id !== canonical && id.replace(/#.*$/, "") !== canonical) issues.push(`WebPage @id ${id} != canonical`);
    if (main.url && main.url !== canonical) issues.push(`WebPage url ${main.url} != canonical`);
    if (site && main.isPartOf?.["@id"] !== site["@id"]) issues.push("WebPage not isPartOf WebSite");
  }
  const crumbs = byType("BreadcrumbList")[0];
  if (!crumbs) issues.push("no BreadcrumbList");
  else {
    const items = crumbs.itemListElement ?? [];
    const lastItem = items[items.length - 1]?.item;
    const lastId = typeof lastItem === "string" ? lastItem : lastItem?.["@id"];
    if (lastId !== canonical) issues.push(`last breadcrumb ${lastId} != canonical`);
  }
  if (kind === "schedule" && !byType("ItemList").length) issues.push("schedule ItemList missing");
  return issues;
}

async function sitemapTeamUrls() {
  const index = await get(`${BASE}/sitemap_index.xml`, { redirect: "follow" });
  const maps = [...index.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => /page-sitemap/.test(u));
  const urls = [];
  for (const map of maps) {
    const res = await get(map, { redirect: "follow" });
    for (const m of res.body.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const u = decode(m[1]);
      if (new URL(u).pathname.startsWith(PREFIX)) urls.push(u);
    }
  }
  return [...new Set(urls)];
}

function classify(url) {
  const path = new URL(url).pathname;
  if (path === PREFIX) return { kind: "directory", slug: "" };
  const rest = path.slice(PREFIX.length).replace(/\/$/, "").split("/");
  return { kind: rest.length === 1 ? "hub" : rest[1], slug: rest[0] };
}

function main() {
  return run().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}

async function run() {
  const dirUrl = `${BASE}${PREFIX}`;
  const report = { base: BASE, scanned: 0, pages: [], images: {}, failures: [] };

  // 1. Inventory.
  const fromSitemap = SITEMAP ? await sitemapTeamUrls() : [];
  const dir = await get(`${dirUrl}${QUERY}`);
  const dirLinks = readLinks(dir.body, dirUrl);
  const hubsFromDir = [...new Set(dirLinks.filter((u) => /^[^/]+\/$/.test(new URL(u).pathname.slice(PREFIX.length)) && new URL(u).pathname.startsWith(PREFIX)))];
  const registered = [dirUrl];
  for (const hub of hubsFromDir) {
    registered.push(hub, ...TABS.map((t) => `${hub}${t}/`));
  }
  let inventory = SITEMAP ? fromSitemap : registered;
  if (SITEMAP && !inventory.includes(dirUrl)) inventory.unshift(dirUrl);
  if (ONLY) inventory = inventory.filter((u) => u === dirUrl || ONLY.includes(classify(u).slug));
  report.inventory = {
    sitemap: fromSitemap.length,
    registeredFromDirectory: registered.length,
    directoryHubLinks: hubsFromDir.length,
    sitemapNotRegistered: fromSitemap.filter((u) => !registered.includes(u)),
    registeredNotInSitemap: SITEMAP ? registered.filter((u) => !fromSitemap.includes(u)) : [],
  };

  // 2. Pages.
  const pages = new Map();
  pages.set(dirUrl, { url: dirUrl, ...classify(dirUrl), res: dir });
  for (const url of inventory) {
    if (pages.has(url)) continue;
    const res = await get(`${url}${QUERY}`);
    pages.set(url, { url, ...classify(url), res });
    process.stderr.write(`${res.status} ${url}\n`);
  }

  const descSeen = new Map();
  const imageUrls = new Set();
  for (const page of pages.values()) {
    page.head = readHead(page.res.body);
    page.links = readLinks(page.res.body, page.url);
    page.issues = [];
    if (page.res.status !== 200) page.issues.push(`status ${page.res.status}${page.res.location ? ` -> ${page.res.location}` : ""}`);
    if (page.res.status === 200 && HEAD) {
      const h = page.head;
      if (h.canonicals.length !== 1) page.issues.push(`${h.canonicals.length} canonicals`);
      else if (h.canonicals[0] !== page.url) page.issues.push(`canonical ${h.canonicals[0]}`);
      if (h.ogUrl[0] && h.ogUrl[0] !== page.url) page.issues.push(`og:url ${h.ogUrl[0]}`);
      if (h.robots.some((r) => /noindex/.test(r))) page.issues.push("noindex");
      const desc = h.description[0] ?? "";
      page.description = desc;
      page.descIssues = descriptionIssues(desc);
      descSeen.set(desc, [...(descSeen.get(desc) ?? []), page.url]);
      page.imageIssues = [];
      if (!h.ogImage.length) page.imageIssues.push("no og:image");
      if (h.ogImage.length > 1) page.imageIssues.push(`${h.ogImage.length} og:image`);
      if (!h.twitterImage.length && h.twitterCard[0] === "summary_large_image") page.imageIssues.push("large card without twitter:image");
      for (const img of [...h.ogImage, ...h.twitterImage]) {
        if (!/^https:\/\//.test(img)) page.imageIssues.push(`not absolute https: ${img}`);
        else imageUrls.add(img);
      }
      page.schemaIssues = schemaIssues(page, page.kind);
      if (page.slug) {
        const want = page.slug.replace(/-/g, " ");
        const title = (h.ogTitle[0] ?? h.title).toLowerCase().replace(/[^a-z0-9 ]/g, "");
        if (!title.includes(want.replace(/[^a-z0-9 ]/g, "")) && !title.includes(want.split(" ").pop())) page.issues.push(`team identity: og:title "${h.ogTitle[0]}"`);
      }
    }
  }
  for (const [desc, urls] of descSeen) {
    if (desc && urls.length > 1) for (const u of urls) pages.get(u).descIssues.push(`identical x${urls.length}`);
  }

  // Share images, once each.
  for (const img of imageUrls) {
    const res = await get(img, { redirect: "follow" });
    report.images[img] = { status: res.status, type: res.type };
    process.stderr.write(`${res.status} ${res.type} ${img}\n`);
  }
  for (const page of pages.values()) {
    for (const img of [...(page.head.ogImage ?? []), ...(page.head.twitterImage ?? [])]) {
      const r = report.images[img];
      if (r && (r.status !== 200 || !/^image\//.test(r.type))) page.imageIssues.push(`image ${r.status} ${r.type} ${img}`);
    }
  }

  // 3. Navigation.
  const inPrefix = (u) => u.startsWith(BASE) && new URL(u).pathname.startsWith(PREFIX);
  const directoryMissing = hubsFromDir.length === 32 ? [] : [`directory links ${hubsFromDir.length} hubs`];
  const reached = new Set([dirUrl]);
  const queue = [dirUrl];
  while (queue.length) {
    const at = pages.get(queue.shift());
    for (const link of at?.links ?? []) {
      if (!inPrefix(link) || reached.has(link)) continue;
      reached.add(link);
      if (pages.has(link)) queue.push(link);
    }
  }
  const unreachable = [...pages.keys()].filter((u) => !reached.has(u));
  const hubTabGaps = [];
  for (const page of pages.values()) {
    if (page.kind !== "hub" || page.res.status !== 200) continue;
    const missing = TABS.filter((t) => !page.links.includes(`${page.url}${t}/`));
    if (missing.length) hubTabGaps.push(`${page.url} lacks ${missing.join(", ")}`);
  }
  const outside = new Set();
  for (const page of pages.values()) for (const l of page.links) if (inPrefix(l) && !pages.has(l)) outside.add(l);
  const broken = [];
  for (const u of outside) {
    const res = await get(`${u}${QUERY}`);
    if (res.status !== 200) broken.push(`${res.status} ${u}${res.location ? ` -> ${res.location}` : ""}`);
  }

  // 4. Previous-season game links on the Schedule tabs.
  const games = { linked: 0, unique: 0, unlinkedRows: 0, unresolved: [], examples: {} };
  const gameRe = /\/nfl\/[a-z0-9-]+-vs-[a-z0-9-]+\/(\d{4})-[a-z0-9-]+\/$/;
  const thisSeason = Math.max(...[...pages.values()].map((p) => Number((p.head.title.match(/(20\d\d)/) ?? [])[1] ?? 0)));
  const gameLinks = new Set();
  for (const page of pages.values()) {
    if (page.kind !== "schedule") continue;
    const prev = page.links.filter((l) => {
      const m = l.match(gameRe);
      return m && Number(m[1]) < (thisSeason || 9999);
    });
    games.linked += prev.length;
    games.unlinkedRows += (page.res.body.match(/data-shp-unlinked/g) ?? []).length;
    games.examples[page.slug] = [...new Set(prev)];
    for (const l of prev) gameLinks.add(l);
  }
  games.unique = gameLinks.size;
  if (GAMES) {
    for (const u of gameLinks) {
      const res = await get(`${u}${QUERY}`);
      if (res.status !== 200) games.unresolved.push(`${res.status} ${u}${res.location ? ` -> ${res.location}` : ""}`);
    }
  }

  // Report.
  const all = [...pages.values()];
  const count = (fn) => all.filter(fn).length;
  const summary = {
    urlsScanned: all.length,
    byKind: all.reduce((acc, p) => ({ ...acc, [p.kind]: (acc[p.kind] ?? 0) + 1 }), {}),
    statusNot200: count((p) => p.res.status !== 200),
    ogImageMissing: count((p) => p.imageIssues?.some((i) => i === "no og:image")),
    ogImageInvalid: count((p) => p.imageIssues?.some((i) => i !== "no og:image")),
    schemaFailures: count((p) => p.schemaIssues?.length),
    descriptionLong: count((p) => p.descIssues?.some((i) => i.startsWith("long"))),
    descriptionIdentical: count((p) => p.descIssues?.some((i) => i.startsWith("identical"))),
    descriptionTruncated: count((p) => p.descIssues?.some((i) => i === "truncated")),
    descriptionMissing: count((p) => p.descIssues?.includes("missing")),
    otherIssues: count((p) => p.issues.length),
    directoryHubLinks: hubsFromDir.length,
    hubTabGaps: hubTabGaps.length,
    unreachable: unreachable.length,
    brokenInternalLinks: broken.length,
    previousSeasonGameLinks: games.linked,
    previousSeasonGamesUnique: games.unique,
    previousSeasonGamesChecked: GAMES,
    previousSeasonGamesUnresolved: games.unresolved.length,
    previousSeasonRowsUnlinked: games.unlinkedRows,
  };
  report.summary = summary;
  report.inventory.unreachable = unreachable;
  report.hubTabGaps = hubTabGaps;
  report.directory = directoryMissing;
  report.broken = broken;
  report.games = games;
  report.pages = all.map((p) => ({
    url: p.url,
    kind: p.kind,
    status: p.res.status,
    description: p.description,
    descLength: p.description?.length,
    descIssues: p.descIssues,
    ogImage: p.head.ogImage,
    imageIssues: p.imageIssues,
    schemaIssues: p.schemaIssues,
    issues: p.issues,
  }));

  console.log(JSON.stringify(summary, null, 2));
  console.log("\nInventory:", JSON.stringify({ ...report.inventory, unreachable: unreachable.length }, null, 2));
  const show = (label, list) => {
    if (!list.length) return;
    console.log(`\n${label} (${list.length}):`);
    for (const line of list.slice(0, 40)) console.log(`  ${line}`);
    if (list.length > 40) console.log(`  ... ${list.length - 40} more`);
  };
  show("Unreachable from the directory", unreachable);
  show("Hub tab gaps", hubTabGaps);
  show("Broken internal links", broken);
  show("Unresolved previous-season games", games.unresolved);
  show("Status/canonical/identity", all.filter((p) => p.issues.length).map((p) => `${p.url}: ${p.issues.join("; ")}`));
  show("Image issues", all.filter((p) => p.imageIssues?.length).map((p) => `${p.url}: ${p.imageIssues.join("; ")}`));
  show("Schema issues", all.filter((p) => p.schemaIssues?.length).map((p) => `${p.url}: ${p.schemaIssues.join("; ")}`));
  show("Description issues", all.filter((p) => p.descIssues?.length).map((p) => `${p.url}: ${p.descIssues.join("; ")}`));

  if (JSON_OUT) {
    const fs = await import("node:fs");
    fs.writeFileSync(String(JSON_OUT), JSON.stringify(report, null, 2));
  }
  const failed =
    summary.statusNot200 + summary.ogImageMissing + summary.ogImageInvalid + summary.schemaFailures +
    summary.descriptionLong + summary.descriptionIdentical + summary.descriptionTruncated + summary.otherIssues +
    summary.hubTabGaps + summary.unreachable + summary.brokenInternalLinks + summary.previousSeasonGamesUnresolved +
    directoryMissing.length;
  process.exit(failed ? 1 : 0);
}

main();
