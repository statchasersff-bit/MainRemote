/**
 * Coach photos for the Coaching tab (mak, 2026-11-10): every coach on each
 * club's official coaches page, with the path of the club's own square
 * headshot. Stored, not fetched at render time (the "store verified data"
 * rule); the page prints them through /news-image/club/... like the rest of
 * the club art, so no outside host appears in the page source.
 *
 *   node scripts/team/buildCoachPhotos.mjs 2026 [--only ne,buf]
 *
 * Writes data/team/coach_photos_<season>.json. Re-run when a staff changes.
 * One request per club, 1.6 s apart. A club whose page cannot be read keeps
 * its previous entry.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const season = Number(process.argv[2]) || new Date().getFullYear();
const onlyArg = process.argv.indexOf("--only");
const only = onlyArg > 0 ? new Set(process.argv[onlyArg + 1].split(",")) : null;
const OUT = path.join(ROOT, `data/team/coach_photos_${season}.json`);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

// abbreviation -> siteDomain, read from teams.ts so the list lives in one place.
const teamsSrc = readFileSync(path.join(ROOT, "src/lib/team/teams.ts"), "utf8");
const CLUBS = [...teamsSrc.matchAll(/abbreviation: "([a-z]+)".*?siteDomain: "([^"]+)"/g)].map((m) => ({ abbr: m[1], domain: m[2] }));
if (CLUBS.length !== 32) throw new Error(`expected 32 clubs in teams.ts, found ${CLUBS.length}`);

const decode = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/\s+/g, " ")
    .trim();

/**
 * Each coach is one person card: a <figure> with the photo (a lazy
 * data-src, or a plain src on the featured head-coach card), then a body
 * with the name (h3) and the role (h5 roofline, before or after the name).
 * The stored image keeps the delivery type (upload or private), the club
 * folder and the image id, and asks for the club's own square person crop
 * (768 px) whatever crop the card used. Some clubs' cards fill the <img>
 * from a <source> only, so the first static.clubs URL in the figure counts.
 */
export function parseCoaches(html) {
  const out = [];
  const seen = new Set();
  const chunks = html.split(/<figure class="d3-o-media-object__figure"/).slice(1);
  for (const chunk of chunks) {
    const end = chunk.search(/<figure class="d3-o-media-object__figure"|<\/section>/);
    const card = end > 0 ? chunk.slice(0, end) : chunk;
    const name = /d3-o-media-object__title">([^<]+)</.exec(card);
    if (!name) continue;
    const role = /d3-o-media-object__roofline">([^<]*)</.exec(card);
    const img = /https:\/\/static\.clubs\.nfl\.com\/image\/(upload|private)\/(?:[^"\s]*\/)?([a-z0-9_-]+)\/([a-z0-9_-]+)(?:\.(?:png|jpe?g|webp))?(?=[\s",])/i.exec(card);
    const n = decode(name[1]);
    if (seen.has(n)) continue;
    seen.add(n);
    out.push({
      name: n,
      role: role ? decode(role[1]) : "",
      image: img ? `https://static.clubs.nfl.com/image/${img[1].toLowerCase()}/t_person_squared_mobile/f_png/${img[2]}/${img[3]}.png` : null,
    });
  }
  return out;
}

const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { teams: {} };
const teams = { ...prev.teams };
const failed = [];
for (const { abbr, domain } of CLUBS) {
  if (only && !only.has(abbr)) continue;
  // Most clubs use /team/coaches-roster/; the Bears use /team/coaches/.
  let url = `https://www.${domain}/team/coaches-roster/`;
  try {
    let res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" } });
    if (res.status === 404) {
      url = `https://www.${domain}/team/coaches/`;
      res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" } });
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const coaches = parseCoaches(await res.text());
    if (coaches.length < 5) throw new Error(`only ${coaches.length} coaches parsed`);
    teams[abbr] = { source: url, fetched: new Date().toISOString().slice(0, 10), coaches };
    console.log(`${abbr}: ${coaches.length} coaches, ${coaches.filter((c) => c.image).length} with photos`);
  } catch (err) {
    failed.push(abbr);
    console.error(`${abbr}: ${err.message} (kept previous entry: ${teams[abbr] ? "yes" : "none"})`);
  }
  await new Promise((r) => setTimeout(r, 1600));
}

writeFileSync(
  OUT,
  JSON.stringify(
    {
      season,
      updated: new Date().toISOString().slice(0, 10),
      note: "Coach headshots from each club's official coaches page (scripts/team/buildCoachPhotos.mjs). Printed through /news-image/club/.",
      teams: Object.fromEntries(Object.entries(teams).sort(([a], [b]) => a.localeCompare(b))),
    },
    null,
    2,
  ) + "\n",
);
console.log(`wrote ${path.relative(ROOT, OUT)}${failed.length ? `; failed: ${failed.join(", ")}` : ""}`);
