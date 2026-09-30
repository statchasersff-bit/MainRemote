/**
 * Practice participation, from the league's official injury report.
 *
 * NFL.com publishes the report at /injuries/league/<season>/reg<week>: one
 * table per club, one row per listed player, with the injury, the practice
 * participation of the most recent report and, from Friday, the game status.
 * The page only ever shows the LATEST report of the week, so a day-by-day grid
 * has to be assembled by reading it every day and filing what it says under the
 * day it was published. That is what this builder does, and why it must run in
 * the evening (after the ~4 PM ET release) as well as the morning.
 *
 * What it can and cannot know:
 *   - A day read live is filed under that day ("days"). Report days are not
 *     known here; the server maps its own schedule's practice days onto these
 *     dates and ignores the rest.
 *   - A week read after the fact (the first run, or a missed day) yields only
 *     the final report: "final" is the last practice day's participation.
 *     Earlier days of that week stay unknown and the page shows "—" for them.
 *   - A week whose page is not out yet serves the previous week's report under
 *     the new URL. The page's own week selector says which week it is, and a
 *     mismatch is skipped rather than filed under the wrong week.
 *
 * Written to data/player/practice_reports/<season>.json:
 *   { season, source, updatedAt, weeks: { "<week>": { fetchedAt, url,
 *     teams: { "<club nickname>": { "<nfl.com slug>": { name, pos, injury,
 *     gameStatus, final, days: { "YYYY-MM-DD": "FULL|LIMITED|DNP|NONE" } } } } } } }
 *
 *   node scripts/player/buildPracticeReports.mjs          # this season, the weeks still moving
 *   node scripts/player/buildPracticeReports.mjs 2026 --all
 */

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./paths.mjs";
import { currentSeason } from "./season.mjs";

const OUT_DIR = path.join(DATA_DIR, "practice_reports");
const BASE = "https://www.nfl.com/injuries/league";
const UA = { "User-Agent": "StatChasers/1.0 (+https://statchasers.com)" };
const LAST_REG_WEEK = 18;
/** Reports come out mid-afternoon Eastern; a read before this hour is yesterday's. */
const RELEASE_HOUR_ET = 16;

const PRACTICE = [
  [/did not participate|^dnp/i, "DNP"],
  [/limited/i, "LIMITED"],
  [/full/i, "FULL"],
];

export function practiceValue(text) {
  const t = (text ?? "").trim();
  if (!t) return "NONE";
  for (const [re, value] of PRACTICE) if (re.test(t)) return value;
  return "NONE";
}

const clean = (s) => (s ?? "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

/**
 * One report page → { week, teams }. `week` is what the page says it is,
 * which is not always the week in the URL.
 */
export function parseReport(html) {
  const sel = [...html.matchAll(/<option[^>]*selected[^>]*>([^<]*)</gi)].map((m) => clean(m[1]));
  const weekLabel = sel.find((s) => /^WEEK \d+$/i.test(s));
  const week = weekLabel ? Number(weekLabel.replace(/\D/g, "")) : null;

  const teams = {};
  // Each club's table follows its sub-title; split on the sub-titles so every
  // row lands under the club whose heading precedes it.
  const parts = html.split(/<div class="d3-o-section-sub-title"><span>/);
  for (const part of parts.slice(1)) {
    const club = clean(part.slice(0, part.indexOf("<")));
    if (!club) continue;
    const table = part.slice(0, part.indexOf("</table>") + 8);
    const rows = [
      ...table.matchAll(
        /<tr>\s*<td[^>]*>\s*<a href="\/players\/([^/"]+)\/"[^>]*>([\s\S]*?)<\/a>\s*<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>/g,
      ),
    ];
    const players = (teams[club] ??= {});
    for (const m of rows) {
      const practice = clean(m[5]);
      players[m[1]] = {
        name: clean(m[2]),
        pos: clean(m[3]),
        injury: clean(m[4]) || null,
        practice: practiceValue(practice),
        estimated: /estimat/i.test(practice),
        gameStatus: clean(m[6]) || null,
      };
    }
  }
  return { week, teams };
}

/** The Eastern date a read at `now` reports on. */
export function reportDate(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const day = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  if (Number(parts.hour) < RELEASE_HOUR_ET) day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

/** Fold one read of a week into what the file already holds for it. */
export function mergeWeek(stored, parsed, { date, fetchedAt, url, live = true }) {
  const out = { fetchedAt, url, teams: {} };
  const clubs = new Set([...Object.keys(stored?.teams ?? {}), ...Object.keys(parsed.teams)]);
  for (const club of clubs) {
    const before = stored?.teams?.[club] ?? {};
    const now = parsed.teams[club] ?? {};
    const players = {};
    for (const slug of new Set([...Object.keys(before), ...Object.keys(now)])) {
      const old = before[slug];
      const row = now[slug];
      if (!row) {
        // Dropped off a later report: keep what was filed.
        players[slug] = old;
        continue;
      }
      const days = { ...(old?.days ?? {}) };
      // Only the week being practised for gets a day filed: an earlier week's
      // page is its final report, whatever day it is read.
      if (live) days[date] = row.estimated ? `${row.practice}*` : row.practice;
      players[slug] = {
        name: row.name,
        pos: row.pos,
        injury: row.injury ?? old?.injury ?? null,
        gameStatus: row.gameStatus,
        final: row.estimated ? `${row.practice}*` : row.practice,
        days,
      };
    }
    out.teams[club] = players;
  }
  return out;
}

async function fetchWeek(season, week) {
  const url = `${BASE}/${season}/reg${week}`;
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return { url, html: await res.text() };
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const season = Number(args.find((a) => /^\d{4}$/.test(a))) || currentSeason();
  const file = path.join(OUT_DIR, `${season}.json`);

  let doc = { season, source: "NFL.com official injury report", updatedAt: null, weeks: {} };
  try {
    doc = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // First run for this season.
  }

  // The weeks still moving: the last one on file and everything after it.
  // --all re-reads the season, which is how a missed week is filled in.
  const stored = Object.keys(doc.weeks).map(Number).sort((a, b) => a - b);
  const from = all || stored.length === 0 ? 1 : Math.max(1, stored[stored.length - 1] - 1);

  const now = new Date();
  const date = reportDate(now);
  const pages = [];
  for (let week = from; week <= LAST_REG_WEEK; week += 1) {
    let page;
    try {
      page = await fetchWeek(season, week);
    } catch (err) {
      console.warn(`[practice] week ${week}: ${err.message}; keeping what is on file`);
      continue;
    }
    const parsed = parseReport(page.html);
    if (parsed.week !== week) {
      // Not published yet: the page is serving an earlier week.
      console.log(`[practice] week ${week}: page shows week ${parsed.week ?? "?"}; stopping`);
      break;
    }
    const rows = Object.values(parsed.teams).reduce((n, t) => n + Object.keys(t).length, 0);
    if (rows === 0) {
      console.warn(`[practice] week ${week}: no rows parsed; keeping what is on file`);
      continue;
    }
    pages.push({ week, parsed, url: page.url, rows });
  }

  // The newest published week is the one being practised for.
  pages.forEach(({ week, parsed, url, rows }, i) => {
    const live = i === pages.length - 1;
    doc.weeks[String(week)] = mergeWeek(doc.weeks[String(week)], parsed, {
      date,
      fetchedAt: now.toISOString(),
      url,
      live,
    });
    console.log(`[practice] week ${week}: ${rows} rows${live ? ` filed under ${date}` : " (final report)"}`);
  });

  if (pages.length === 0) {
    console.warn("[practice] nothing read; file unchanged");
    return;
  }
  doc.updatedAt = now.toISOString();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(doc));
  fs.renameSync(tmp, file);
  console.log(`[practice] wrote ${path.relative(process.cwd(), file)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
