#!/usr/bin/env node
/**
 * Warm the live site after a publish.
 *
 * A publish replaces the origin, so the first visit to every page afterwards
 * is a cold render behind WordPress: 8-16 s for a Usage tab or a player Stats
 * page in the first minutes of 2026-11-02's publish, 2-3 s once the boot chain
 * was done, 0.1 s once something had asked for the page. This script is that
 * something. It walks the public site's page sitemaps at one request every
 * RATE_MS (the live site rate-limits above ~1 request per 1.5 s), teams first
 * (every tab), then the player hub pages, so WordPress's page cache and the
 * origin's fragment caches hold a render for every visitor, on every edge
 * location, before a person asks.
 *
 * It fetches statchasers.com, not the API: a request through WordPress is
 * what fills WordPress's cache, and the fragment cache is keyed on the
 * requesting origin. Nothing here needs the embed key.
 *
 * Run by hand (`pnpm warm-live`, or node scripts/warm-live.mjs) from
 * anywhere, or by the server at boot in production (lib/live-warm.ts), once
 * the public origin reports the server's own build - a crawl before the
 * proxy has switched would cache the previous build's markup.
 *
 *   --site <origin>   the WordPress site (default https://statchasers.com)
 *   --rate <ms>       delay between requests (default 1600)
 *   --limit <n>       stop after n pages
 *   --teams-only      the 225 team URLs, no player pages
 *   --all-tabs        every player tab too (4,000+ pages, over an hour)
 *   --list <file>     crawl these URLs (one per line) instead of the sitemaps
 *   --verbose         one line per page on stdout
 *
 * Prints `warm-live complete: ...` on stdout at the end; the slowest pages
 * and anything that failed go to stderr.
 */

import fs from "node:fs";
import { pathToFileURL } from "node:url";

const DEFAULT_SITE = "https://statchasers.com";
const DEFAULT_RATE_MS = 1600;
const REQUEST_TIMEOUT_MS = 90 * 1000;
/** A 429 means back off, not stop: wait this long, then try that page once more. */
const RATE_LIMIT_PAUSE_MS = 20 * 1000;
const SLOW_MS = 5000;
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) Chrome/120 StatChasers-WarmLive/1 (+https://statchasers.com)";

export function parseArgs(argv) {
  const opts = {
    site: DEFAULT_SITE,
    rateMs: DEFAULT_RATE_MS,
    limit: Infinity,
    teamsOnly: false,
    allTabs: false,
    list: null,
    verbose: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[(i += 1)];
    if (a === "--site") opts.site = String(next() ?? DEFAULT_SITE).replace(/\/+$/, "");
    else if (a === "--rate") opts.rateMs = Math.max(0, Number(next()) || DEFAULT_RATE_MS);
    else if (a === "--limit") opts.limit = Math.max(1, Number(next()) || Infinity);
    else if (a === "--teams-only") opts.teamsOnly = true;
    else if (a === "--all-tabs") opts.allTabs = true;
    else if (a === "--list") opts.list = next() ?? null;
    else if (a === "--verbose") opts.verbose = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

/** Every <loc> in a sitemap or sitemap index. */
export function sitemapLocs(xml) {
  return [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
}

/**
 * The crawl order from the page sitemaps' URLs: the team index and every
 * team page (each tab), then player hub pages, then (allTabs) the other
 * player tabs. Teams first because 32 clubs x 7 tabs is where a visitor is
 * likeliest to land in the first minutes, and the hubs before the tabs
 * because the hub is what a search result opens.
 */
export function selectUrls(locs, { teamsOnly = false, allTabs = false } = {}) {
  const seen = new Set();
  const teams = [];
  const hubs = [];
  const tabs = [];
  for (const raw of locs) {
    const url = raw.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const m = /\/nfl\/(teams|players)\/(?:([^/]+)\/)?([^/]+\/)?$/.exec(url);
    if (!m) continue;
    const [, kind, slug, tab] = m;
    if (kind === "teams") teams.push(url);
    else if (!slug) hubs.unshift(url);
    else if (!tab) hubs.push(url);
    else tabs.push(url);
  }
  if (teamsOnly) return teams;
  return allTabs ? [...teams, ...hubs, ...tabs] : [...teams, ...hubs];
}

export function summaryLine(s) {
  return `warm-live complete: ${s.pages} pages, ${s.ok} ok, ${s.slow} slow (>${SLOW_MS / 1000}s), ${s.failed} failed, ${s.seconds}s`;
}

async function fetchPage(url) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html,*/*;q=0.1" },
      redirect: "follow",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    await res.arrayBuffer();
    return { status: res.status, ms: Date.now() - started, cache: res.headers.get("cf-cache-status") ?? "-" };
  } catch (err) {
    return { status: 0, ms: Date.now() - started, cache: "-", error: err instanceof Error ? err.message : String(err) };
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadSitemapUrls(site) {
  const index = await fetch(`${site}/sitemap_index.xml`, {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (index.status !== 200) throw new Error(`sitemap index: HTTP ${index.status}`);
  const maps = sitemapLocs(await index.text()).filter((u) => /\/page-sitemap\d*\.xml$/.test(u));
  const locs = [];
  for (const map of maps) {
    const res = await fetch(map, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (res.status !== 200) {
      process.stderr.write(`warm-live: ${map} HTTP ${res.status}, skipped\n`);
      continue;
    }
    locs.push(...sitemapLocs(await res.text()));
    await sleep(DEFAULT_RATE_MS);
  }
  return locs;
}

export async function crawl(urls, { rateMs = DEFAULT_RATE_MS, verbose = false, fetchPage: doFetch = fetchPage, wait = sleep } = {}) {
  const started = Date.now();
  const slowest = [];
  const failures = [];
  let ok = 0;
  let slow = 0;
  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i];
    let r = await doFetch(url);
    if (r.status === 429) {
      await wait(RATE_LIMIT_PAUSE_MS);
      r = await doFetch(url);
    }
    if (r.status === 200) ok += 1;
    else failures.push(`${r.status || r.error || "failed"} ${url}`);
    if (r.ms > SLOW_MS) slow += 1;
    slowest.push({ url, ms: r.ms });
    if (slowest.length > 5) slowest.sort((a, b) => b.ms - a.ms).pop();
    if (verbose) process.stdout.write(`${r.status} ${(r.ms / 1000).toFixed(2)}s ${r.cache} ${url}\n`);
    if (i < urls.length - 1) await wait(rateMs);
  }
  return {
    pages: urls.length,
    ok,
    slow,
    failed: failures.length,
    seconds: Math.round((Date.now() - started) / 1000),
    slowest: slowest.sort((a, b) => b.ms - a.ms),
    failures,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const locs = opts.list
    ? fs.readFileSync(opts.list, "utf8").split(/\r?\n/)
    : await loadSitemapUrls(opts.site);
  const urls = selectUrls(locs, opts).slice(0, opts.limit === Infinity ? undefined : opts.limit);
  process.stderr.write(`warm-live: ${urls.length} pages at one per ${opts.rateMs} ms\n`);
  const summary = await crawl(urls, opts);
  for (const s of summary.slowest) process.stderr.write(`warm-live slowest: ${(s.ms / 1000).toFixed(1)}s ${s.url}\n`);
  for (const f of summary.failures.slice(0, 20)) process.stderr.write(`warm-live failed: ${f}\n`);
  process.stdout.write(`${summaryLine(summary)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`warm-live: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
