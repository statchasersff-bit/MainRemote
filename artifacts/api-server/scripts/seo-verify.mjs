#!/usr/bin/env node
/**
 * SEO verification for the public StatChasers pages.
 *
 *   node scripts/seo-verify.mjs [base]        # default https://statchasers.com
 *   node scripts/seo-verify.mjs https://staging.example.com --json
 *
 * Checks what Googlebot receives from the WordPress pages these tools mount on:
 * the raw HTML, before any JavaScript runs. For each route it follows redirects
 * by hand (so a chain is visible, not collapsed), then reads the final page.
 *
 *   indexable  200 on GET and HEAD, no X-Robots-Tag noindex, meta robots index,
 *              exactly one self-referencing canonical, a title and a
 *              description (unique across the run), exactly one non-empty H1,
 *              real body text, and internal links that are real <a href>s
 *              pointing at final URLs (trailing slash, not a known redirect).
 *   legacy     one 301, straight to the expected final URL, which is a 200.
 *   invalid    404 on GET and HEAD, never a 200 shell.
 *
 * It does not run from Replit: Cloudflare 403s that host. Run it from a
 * machine the site answers, and read a 403 in the report as "blocked", not as
 * a finding about the page. Exit status is 1 when anything fails.
 */

import { JSDOM } from "jsdom";

const args = process.argv.slice(2);
const BASE = (args.find((a) => !a.startsWith("--")) ?? "https://statchasers.com").replace(/\/+$/, "");
const JSON_OUT = args.includes("--json");
const UA =
  "Mozilla/5.0 (compatible; StatChasersSEOVerify/1.0; +https://statchasers.com/)";

const P = "/nfl/players";
const T = "/nfl/teams";

/** Representative routes. Edit freely; each is one page Google should see. */
const ROUTES = [
  // A star player, every tab.
  { kind: "indexable", path: `${P}/josh-allen/`, h1: /Josh Allen Fantasy Football Stats & Analysis/ },
  { kind: "indexable", path: `${P}/josh-allen/stats/`, h1: /^Josh Allen Stats \d{4}$/ },
  { kind: "indexable", path: `${P}/josh-allen/game-log/`, h1: /^Josh Allen Game Log \d{4}$/ },
  { kind: "indexable", path: `${P}/josh-allen/outlook/`, h1: /^Josh Allen Fantasy Outlook \d{4}$/ },
  { kind: "indexable", path: `${P}/josh-allen/injury/`, h1: /^Josh Allen Injury Update & History$/ },
  { kind: "indexable", path: `${P}/josh-allen/news/`, h1: /^Josh Allen News & Analysis$/ },
  { kind: "indexable", path: `${P}/josh-allen/bio/`, h1: /^Josh Allen Bio$/ },
  // A lower-profile player.
  { kind: "indexable", path: `${P}/tyler-higbee/` },
  { kind: "indexable", path: `${P}/tyler-higbee/stats/` },
  // A team, a team section, a team schedule.
  { kind: "indexable", path: `${T}/buffalo-bills/` },
  { kind: "indexable", path: `${T}/buffalo-bills/stats/` },
  { kind: "indexable", path: `${T}/buffalo-bills/schedule/` },
  // League schedule, a matchup, rankings.
  { kind: "indexable", path: "/nfl/nfl-schedule/" },
  { kind: "indexable", path: "/nfl/buffalo-bills-vs-miami-dolphins/" },
  { kind: "indexable", path: "/fantasy-football/rest-of-season-rankings/" },
  { kind: "indexable", path: "/fantasy-football/rest-of-season-rankings/rb/" },
  // Invalid entities.
  { kind: "invalid", path: `${P}/josh-allen-fake-player-12345/` },
  { kind: "invalid", path: `${P}/josh-allen/not-a-section/` },
  { kind: "invalid", path: `${T}/not-a-team/stats/` },
  // Legacy addresses: one hop, straight to the final URL.
  { kind: "legacy", path: `${P}/josh-allen/overview/`, to: `${P}/josh-allen/` },
  { kind: "legacy", path: `${P}/outlook/josh-allen/`, to: `${P}/josh-allen/outlook/` },
  { kind: "legacy", path: `${P}/stats/josh-allen/`, to: `${P}/josh-allen/stats/`, optional: true },
  { kind: "legacy", path: "/fantasy-football/players/josh-allen/", to: `${P}/josh-allen/` },
  { kind: "legacy", path: `${T}/buffalo-bills/outlook/`, to: `${T}/buffalo-bills/` },
  { kind: "legacy", path: `${P}/josh-allen`, to: `${P}/josh-allen/` },
];

/** Paths an internal link must never point at: each one redirects. */
const REDIRECTING = [
  /^\/nfl\/players\/[^/]+\/overview\/?$/,
  /^\/nfl\/teams\/[^/]+\/outlook\/?$/,
  /^\/nfl\/players\/(?:stats|game-log|outlook|injury|news|bio|overview)\/[^/]+\/?$/,
  /^\/fantasy-football\/players\//,
];

const host = new URL(BASE).host;

async function request(url, method = "GET") {
  const res = await fetch(url, { method, redirect: "manual", headers: { "User-Agent": UA } });
  const body = method === "GET" ? await res.text() : "";
  return { status: res.status, headers: res.headers, body };
}

/** Follow redirects by hand, recording every hop. */
async function follow(url, limit = 5) {
  const hops = [];
  let current = url;
  for (let i = 0; i <= limit; i += 1) {
    const res = await request(current);
    hops.push({ url: current, status: res.status });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).toString();
      continue;
    }
    return { hops, final: res, finalUrl: current };
  }
  return { hops, final: null, finalUrl: current };
}

function inspect(html, url) {
  const doc = new JSDOM(html, { url }).window.document;
  const meta = (name) =>
    doc.querySelector(`meta[name="${name}"]`)?.getAttribute("content")?.trim() ?? null;
  const canonicals = [...doc.querySelectorAll('link[rel="canonical"]')].map((l) => l.href);
  const h1s = [...doc.querySelectorAll("h1")].map((h) => h.textContent.replace(/\s+/g, " ").trim());

  // Body text with scripts, styles and JSON islands removed.
  const body = doc.body?.cloneNode(true);
  body?.querySelectorAll("script, style, noscript, template").forEach((n) => n.remove());
  const text = (body?.textContent ?? "").replace(/\s+/g, " ").trim();

  const anchors = [...doc.querySelectorAll("a[href]")];
  const internal = anchors
    .map((a) => a.href)
    .filter((href) => {
      try {
        return new URL(href).host === host;
      } catch {
        return false;
      }
    });
  const badLinks = [];
  for (const href of new Set(internal)) {
    const u = new URL(href);
    const path = u.pathname;
    if (REDIRECTING.some((re) => re.test(path))) badLinks.push(`${path} (redirects)`);
    else if (!path.endsWith("/") && !/\.[a-z0-9]+$/i.test(path)) badLinks.push(`${path} (no trailing slash)`);
  }
  const nofollow = anchors.filter((a) => {
    try {
      const target = new URL(a.href);
      // State controls (a season, a format, the CSV) and links back to this
      // same page are allowed their nofollow; navigation to another page is not.
      return (
        target.host === host &&
        /\bnofollow\b/.test(a.rel) &&
        !/[?&](format|season|adv|log|view)=|\.csv/.test(a.href) &&
        target.pathname !== new URL(url).pathname
      );
    } catch {
      return false;
    }
  }).length;
  // Navigation that exists only in JavaScript.
  const jsNav = doc.querySelectorAll(
    "[onclick*='location'], [onclick*='href'], [data-href], [data-url]",
  ).length;

  return {
    title: doc.querySelector("title")?.textContent.trim() ?? null,
    description: meta("description"),
    robots: meta("robots"),
    canonicals,
    h1s,
    textLength: text.length,
    shellOnly: /<div id="root"><\/div>/.test(html) && text.length < 200,
    internalLinks: internal.length,
    badLinks,
    nofollow,
    jsNav,
  };
}

const results = [];
const seenTitles = new Map();
const seenDescriptions = new Map();

for (const route of ROUTES) {
  const url = BASE + route.path;
  const problems = [];
  const notes = {};
  let blocked = false;

  try {
    const { hops, final, finalUrl } = await follow(url);
    notes.chain = hops.map((h) => `${h.status} ${new URL(h.url).pathname}`).join(" → ");
    if (hops.some((h) => h.status === 403 || h.status === 429)) blocked = true;

    if (route.kind === "legacy") {
      const redirects = hops.filter((h) => h.status >= 300 && h.status < 400);
      if (hops[0].status === 404 && route.optional) {
        notes.skipped = "never existed (404)";
      } else if (redirects.length !== 1) problems.push(`expected 1 redirect, got ${redirects.length}`);
      else if (hops[0].status !== 301) problems.push(`first hop is ${hops[0].status}, not 301`);
      else if (new URL(finalUrl).pathname !== route.to) problems.push(`lands on ${new URL(finalUrl).pathname}, not ${route.to}`);
      else if (final?.status !== 200) problems.push(`final URL answers ${final?.status}`);
    } else if (route.kind === "invalid") {
      if (hops[0].status !== 404) problems.push(`expected 404, got ${notes.chain}`);
      const head = await request(url, "HEAD");
      if (head.status !== 404) problems.push(`HEAD answers ${head.status}`);
    } else {
      if (hops.length !== 1) problems.push(`redirects: ${notes.chain}`);
      if (final?.status !== 200) problems.push(`status ${final?.status}`);
      const head = await request(finalUrl, "HEAD");
      if (head.status !== 200) problems.push(`HEAD answers ${head.status}`);

      const xrt = final?.headers.get("x-robots-tag") ?? "";
      notes.xRobots = xrt || null;
      if (/noindex/i.test(xrt)) problems.push(`X-Robots-Tag: ${xrt}`);

      if (final?.status === 200) {
        const page = inspect(final.body, finalUrl);
        Object.assign(notes, {
          title: page.title,
          description: page.description,
          robots: page.robots,
          canonical: page.canonicals.join(", "),
          h1: page.h1s,
          textLength: page.textLength,
          internalLinks: page.internalLinks,
        });

        if (page.robots && /noindex/i.test(page.robots)) problems.push(`meta robots: ${page.robots}`);
        if (page.canonicals.length !== 1) problems.push(`${page.canonicals.length} canonicals`);
        else if (page.canonicals[0] !== finalUrl) problems.push(`canonical is ${page.canonicals[0]}`);
        if (!page.title) problems.push("no <title>");
        if (!page.description) problems.push("no meta description");
        if (page.h1s.length !== 1) problems.push(`${page.h1s.length} H1s: ${JSON.stringify(page.h1s)}`);
        else if (!page.h1s[0]) problems.push("empty H1");
        else if (route.h1 && !route.h1.test(page.h1s[0])) problems.push(`H1 "${page.h1s[0]}" does not match ${route.h1}`);
        if (page.shellOnly || page.textLength < 500) problems.push(`thin raw HTML (${page.textLength} chars)`);
        if (page.internalLinks < 5) problems.push(`only ${page.internalLinks} internal links`);
        if (page.badLinks.length) problems.push(`links through redirects: ${page.badLinks.slice(0, 5).join("; ")}${page.badLinks.length > 5 ? ` (+${page.badLinks.length - 5})` : ""}`);
        if (page.nofollow) problems.push(`${page.nofollow} nofollow internal links`);
        if (page.jsNav) problems.push(`${page.jsNav} JS-only navigation elements`);

        for (const [value, seen, label] of [
          [page.title, seenTitles, "title"],
          [page.description, seenDescriptions, "description"],
        ]) {
          if (!value) continue;
          if (seen.has(value)) problems.push(`duplicate ${label} with ${seen.get(value)}`);
          else seen.set(value, route.path);
        }
      }
    }
  } catch (err) {
    problems.push(`request failed: ${err.message}`);
  }

  results.push({ ...route, h1: undefined, ok: problems.length === 0 && !blocked, blocked, problems, ...notes });
}

if (JSON_OUT) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const r of results) {
    const mark = r.blocked ? "BLOCKED" : r.skipped ? "SKIP" : r.ok ? "PASS" : "FAIL";
    console.log(`${mark.padEnd(7)} ${r.kind.padEnd(9)} ${r.path}`);
    console.log(`          ${r.chain ?? ""}`);
    if (r.kind === "indexable" && r.title) {
      console.log(`          title: ${r.title}`);
      console.log(`          h1: ${JSON.stringify(r.h1)}  canonical: ${r.canonical}  robots: ${r.robots ?? "(none)"}  text: ${r.textLength}  links: ${r.internalLinks}`);
    }
    for (const p of r.problems) console.log(`          ✗ ${p}`);
  }
  const failed = results.filter((r) => !r.ok && !r.skipped);
  const blocked = results.filter((r) => r.blocked).length;
  console.log(`\n${results.length - failed.length}/${results.length} passed${blocked ? `, ${blocked} blocked (403/429: run from a host the site answers)` : ""}`);
}

process.exit(results.some((r) => !r.ok && !r.skipped) ? 1 : 0);
