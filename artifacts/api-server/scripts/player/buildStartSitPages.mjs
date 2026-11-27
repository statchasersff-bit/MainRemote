#!/usr/bin/env node
/**
 * Which players have a populated Start/Sit page in Redraft Command.
 *
 * The player pages link "Should I start {Last}?" to
 * statchasers.com/redraft-command/who-should-i-start/<slug>. That page is real
 * for some players only (2026-11-27 audit, item 5): Redraft Command writes a
 * page for every player Sleeper has on a roster, and of those it marks
 * `noindex` the ones it has nothing to say about (no projection this week, no
 * bye, no ruled-out status, no search evidence - its own words: a deep reserve
 * whose page can only say "updating"). A player Sleeper lists as a free agent
 * has no page at all: Aaron Rodgers answered 404 on 2026-11-27 while our hub
 * printed six links to it.
 *
 * Redraft Command's own sitemap is exactly the set it calls worth reading
 * (shared/startSitIndexPolicy.ts in statchasersff-bit/redraft-command: "the
 * sitemap lists exactly the indexable set"), so the list is read off it, once,
 * here. Nothing in the render fetches: the result is stored (mak: store
 * verified data), and a player who is not on it gets no start/sit link.
 *
 *   node scripts/player/buildStartSitPages.mjs
 *   node scripts/player/buildStartSitPages.mjs --file sitemap.xml   (offline)
 *
 * Writes data/player/startsit_pages.json: { generated_at, source, count,
 * slugs: ["<our slug>", ...] }. The two apps spell a player the same way
 * (shared/playerSlug.ts there, every one of 676 slugs matched ours on
 * 2026-11-27), so a sitemap slug that is not one of our players is skipped
 * rather than guessed at. Re-run weekly with the data refresh: the set moves
 * as projections, byes and rosters do.
 */

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./paths.mjs";

const SITEMAP_URL = "https://statchasers.com/sitemaps/start-sit.xml";
const OUT = path.join(DATA_DIR, "startsit_pages.json");
// statchasers.com answers a bare client with a challenge page.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const fileArg = process.argv.indexOf("--file");
let xml;
if (fileArg !== -1) {
  xml = fs.readFileSync(process.argv[fileArg + 1], "utf8");
} else {
  const res = await fetch(SITEMAP_URL, { headers: { "User-Agent": UA, Accept: "application/xml,text/xml" } });
  if (!res.ok) throw new Error(`${SITEMAP_URL} answered ${res.status}`);
  xml = await res.text();
}

// One player per `<loc>`; a pair page is `<a>-or-<b>` and is not a player's.
const found = new Set();
for (const m of xml.matchAll(/<loc>\s*https:\/\/statchasers\.com\/redraft-command\/who-should-i-start\/([a-z0-9-]+)\s*<\/loc>/g)) {
  if (!m[1].includes("-or-")) found.add(m[1]);
}
if (found.size < 100) throw new Error(`only ${found.size} player pages in the start/sit sitemap; refusing to write a short list`);

const players = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "players.json"), "utf8"));
const ours = new Set(Object.values(players).map((p) => p?.slug).filter(Boolean));

const slugs = [...found].filter((s) => ours.has(s)).sort();
const skipped = [...found].filter((s) => !ours.has(s)).sort();

fs.writeFileSync(
  OUT,
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      source: SITEMAP_URL,
      count: slugs.length,
      slugs,
    },
    null,
    2,
  ) + "\n",
);
console.log(`startsit_pages.json: ${slugs.length} players (${found.size} in the sitemap, ${skipped.length} not ours${skipped.length ? `: ${skipped.slice(0, 10).join(", ")}` : ""})`);
