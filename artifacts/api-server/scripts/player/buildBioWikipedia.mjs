/**
 * Wikipedia for the Bio tab, read with code, no API key (mak, 2026-09-30).
 * A one-off job, run by hand: it is not in the daily refresh.
 *
 *   1. Infoboxes, every player with a Wikipedia title in bio_sources.json
 *      (Wikidata supplies the title). The MediaWiki API returns up to 50
 *      articles' wikitext per request; bio/wikitext.mjs reads the infobox.
 *      -> data/player/bio_wikipedia.json (committed), each player's facts
 *      with the page URL and the revision ID they were read from.
 *
 *   2. --text: the plain text of the fantasy-relevant players' articles: every
 *      player StatChasers has written a 2026 outlook for, ranks in dynasty, or
 *      is rostered in Sleeper leagues (mak: "we have over 400 player pages made
 *      in the tool"), one request each, for the in-session
 *      transaction reading (see scripts/player/bio/candidates.mjs). Saved as
 *      data/player/bio_wikipedia_text/{slug}.json with its revision ID, so a
 *      candidate's quote can be checked against the exact text it came from.
 *
 * Etiquette (spec Part 7.1): one request at a time, one per second, the
 * StatChasersBot User-Agent, Retry-After honored, the source paused after
 * repeated 429/403s; the conditional cache in bio/polite.mjs means a rerun
 * re-downloads nothing that has not changed.
 *
 * Wikipedia's text is CC BY-SA. The page never shows it: facts are stored and
 * the page's own sentences are templates. The saved article text exists only
 * so quotes can be verified.
 *
 *   node scripts/player/buildBioWikipedia.mjs              # infoboxes
 *   node scripts/player/buildBioWikipedia.mjs --text 400   # + article text
 */

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./paths.mjs";
import { politeClient, SourcePaused } from "./bio/polite.mjs";
import { parseInfobox } from "./bio/wikitext.mjs";

const SOURCES_FILE = path.join(DATA_DIR, "bio_sources.json");
const OUT_FILE = path.join(DATA_DIR, "bio_wikipedia.json");
export const TEXT_DIR = path.join(DATA_DIR, "bio_wikipedia_text");
const ROSTER_PCT_FILE = path.join(DATA_DIR, "roster_pct.json");
const OUTLOOK_FILE = path.join(DATA_DIR, "fantasy_outlook_2026.json");
const DYNASTY_FILE = path.join(DATA_DIR, "dynasty_rankings.json");
const API = "https://en.wikipedia.org/w/api.php";
const BATCH = 50;

const log = (msg) => console.log(`[bio-wikipedia] ${msg}`);
const wiki = politeClient("wikipedia", { minGapMs: 1000, log });

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};

const pageUrl = (title, revid) =>
  `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(title.replace(/ /g, "_"))}&oldid=${revid}`;

/** A query's pages, keyed by the title that was asked for (through normalization and redirects). */
function byAskedTitle(json) {
  const q = json.query ?? {};
  const to = new Map();
  for (const n of q.normalized ?? []) to.set(n.from, n.to);
  for (const r of q.redirects ?? []) to.set(r.from, r.to);
  const pages = new Map((q.pages ?? []).map((p) => [p.title, p]));
  return (asked) => {
    let t = asked;
    for (let i = 0; i < 3 && to.has(t); i += 1) t = to.get(t);
    return pages.get(t) ?? null;
  };
}

/**
 * The fantasy-relevant players with an article: a 2026 outlook, a dynasty
 * rank or a Sleeper roster percentage. Most rostered first.
 */
export function relevantSlugs(sources, n = Infinity) {
  const pct = readJson(ROSTER_PCT_FILE, { players: {} }).players ?? {};
  const outlooks = new Set(Object.values(readJson(OUTLOOK_FILE, {})).map((o) => o.slug));
  const dynasty = new Set(Object.keys(readJson(DYNASTY_FILE, {})));
  const owned = (e) => pct[e.ids.sleeper]?.owned ?? 0;
  return Object.entries(sources.players)
    .filter(([slug, e]) => e.ids.wikipedia && (pct[e.ids.sleeper] || outlooks.has(slug) || dynasty.has(slug)))
    .sort((a, b) => owned(b[1]) - owned(a[1]) || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([slug]) => slug);
}
export const topSlugs = relevantSlugs;

async function infoboxes(entries, previous) {
  const out = {};
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const url =
      `${API}?action=query&format=json&formatversion=2&redirects=1&prop=revisions&rvprop=ids|content&rvslots=main` +
      `&titles=${encodeURIComponent(batch.map(([, e]) => e.ids.wikipedia).join("|"))}`;
    let res;
    try {
      res = await wiki.fetch(url);
    } catch (err) {
      if (err instanceof SourcePaused) throw err;
      log(`batch ${i / BATCH + 1}: ${err.message}; kept the previous facts`);
      for (const [slug] of batch) if (previous[slug]) out[slug] = previous[slug];
      continue;
    }
    const find = byAskedTitle(JSON.parse(res.body));
    for (const [slug, e] of batch) {
      const page = find(e.ids.wikipedia);
      const rev = page?.revisions?.[0];
      if (!rev) continue;
      const infobox = parseInfobox(rev.slots?.main?.content ?? "");
      if (!infobox) continue;
      out[slug] = { title: page.title, revid: rev.revid, url: pageUrl(page.title, rev.revid), retrievedAt: res.retrievedAt, infobox };
    }
    log(`infoboxes ${Math.min(i + BATCH, entries.length)}/${entries.length}`);
  }
  return out;
}

async function texts(slugs, sources) {
  fs.mkdirSync(TEXT_DIR, { recursive: true });
  let fetched = 0;
  for (const slug of slugs) {
    const title = sources.players[slug].ids.wikipedia;
    const url = `${API}?action=query&format=json&formatversion=2&redirects=1&prop=extracts|revisions&rvprop=ids&explaintext=1&exsectionformat=wiki&titles=${encodeURIComponent(title)}`;
    const res = await wiki.fetch(url);
    const page = byAskedTitle(JSON.parse(res.body))(title);
    if (!page?.extract) continue;
    const file = path.join(TEXT_DIR, `${slug}.json`);
    const revid = page.revisions?.[0]?.revid ?? null;
    if (readJson(file, null)?.revid === revid) continue;
    fs.writeFileSync(file, JSON.stringify({ slug, title: page.title, revid, url: pageUrl(page.title, revid), retrievedAt: res.retrievedAt, text: page.extract }));
    fetched += 1;
  }
  log(`article text: ${fetched} new or changed of ${slugs.length}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const sources = readJson(SOURCES_FILE, null);
  if (!sources) throw new Error("run buildBioSources.mjs first");
  const previous = readJson(OUT_FILE, { players: {} }).players;
  const entries = Object.entries(sources.players).filter(([, e]) => e.ids.wikipedia);

  const players = await infoboxes(entries, previous);
  const same = JSON.stringify(previous) === JSON.stringify(players);
  const doc = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: { name: "Wikipedia", url: "https://en.wikipedia.org/", license: "CC BY-SA 4.0" },
    players,
  };
  if (!same) {
    fs.writeFileSync(`${OUT_FILE}.tmp`, JSON.stringify(doc));
    fs.renameSync(`${OUT_FILE}.tmp`, OUT_FILE);
  }
  log(`infoboxes: ${Object.keys(players).length} of ${entries.length} articles${same ? " (unchanged)" : ""}`);

  const t = argv.indexOf("--text");
  if (t >= 0) await texts(relevantSlugs(sources, Number(argv[t + 1]) || Infinity), sources);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
