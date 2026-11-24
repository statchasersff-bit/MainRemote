#!/usr/bin/env node
/**
 * WEB-040: sample one real game's three public surfaces through a game
 * window, to measure how long StatChasers adds to what the feed knows.
 *
 *   node scripts/schedule/web040-game-sampler.mjs \
 *     --pair dallas-cowboys-vs-philadelphia-eagles --season 2026 --week 12 \
 *     --game-id 2026_12_PHI_DAL --kickoff 2026-11-26T21:30:00Z \
 *     [--every 300] [--out web040-sample.jsonl] [--site https://statchasers.com]
 *
 * Every `--every` seconds (default 300) from 30 minutes before kickoff until
 * two hours after the API first reports the game final (hard stop: kickoff +
 * 7 hours), it requests, one at a time and two seconds apart (the site
 * rate-limits above about one request every 1.5 s):
 *   - /api/game-state/<id> on the API origin: the feed's view (phase, score,
 *     clock, when the score was read, the slate's update stamp);
 *   - the week page   /nfl/<pair>/<season>-week-<N>/
 *   - the H2H page    /nfl/<pair>/
 *   - the schedule    /nfl/nfl-schedule/week-<N>/
 * each as a normal visitor would (browser User-Agent, no cache-busting), and
 * records the status, cf-cache-status, age, cache-control, the plugin's
 * X-SC-*-Cache verdict, and what the page displays: the strip's phase and
 * words, preview / recap layout, the schedule row's status words. At the end
 * it prints, per surface, when it FIRST displayed the final, next to when the
 * API first did: the gap is time added by caching, not by the feed.
 *
 * Read-only. Run after the WEB-040 release (before it, the strip and the
 * policy headers do not exist, but the cache and layout columns still
 * measure today's behavior). Do not run two at once.
 */

import fs from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, all) => (cur.startsWith("--") ? [...acc, [cur.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "1"]] : acc), []),
);
for (const k of ["pair", "season", "week", "game-id", "kickoff"]) {
  if (!args[k]) {
    console.error(`missing --${k}`);
    process.exit(2);
  }
}
const SITE = (args.site ?? "https://statchasers.com").replace(/\/$/, "");
const API = (args.api ?? "https://news.statchasers.com").replace(/\/$/, "");
const EVERY_MS = Number(args.every ?? 300) * 1000;
const OUT = args.out ?? `web040-sample-${args["game-id"]}.jsonl`;
const KICK = Date.parse(args.kickoff);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const urls = {
  week: `${SITE}/nfl/${args.pair}/${args.season}-week-${args.week}/`,
  h2h: `${SITE}/nfl/${args.pair}/`,
  schedule: `${SITE}/nfl/nfl-schedule/week-${args.week}/`,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function displayed(kind, html) {
  const strip = html.match(/<section class="sct-gs"([^>]*)>([\s\S]*?)<\/section>/);
  const out = {
    strip: strip
      ? { phase: strip[1].match(/data-phase="([^"]*)"/)?.[1] ?? null, hidden: /\shidden/.test(strip[1]), text: strip[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() }
      : null,
    layout: /data-postgame="1"/.test(html) ? "recap" : /data-matchup-state="upcoming"/.test(html) ? "preview" : null,
    canonical: html.match(/<link rel="canonical" href="([^"]*)"/)?.[1] ?? null,
  };
  if (kind === "schedule") {
    const at = html.indexOf(`id="scs-game-${args["game-id"]}"`);
    if (at > 0) {
      const row = html.slice(html.lastIndexOf("<article", at), html.indexOf("</article>", at));
      out.row = {
        status: row.match(/data-status="([a-z]+)"/)?.[1] ?? null,
        words: (row.match(/<span class="scs-game-status"[^>]*>(.*?)<\/span><\/div>/)?.[1] ?? "").replace(/<[^>]+>/g, "").trim(),
        score: [...row.matchAll(/scs-game-score">(\d+)</g)].map((m) => Number(m[1])),
      };
    }
  }
  return out;
}

function isFinal(kind, d) {
  if (kind === "schedule") return d.row?.status === "final";
  return d.layout === "recap" || d.strip?.phase === "final";
}

async function get(url) {
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/json" }, redirect: "manual" });
    const body = await res.text();
    const h = (n) => res.headers.get(n);
    return {
      status: res.status,
      ms: Date.now() - started,
      cf: h("cf-cache-status"),
      age: h("age") ? Number(h("age")) : null,
      cacheControl: h("cache-control"),
      cdnCacheControl: h("cdn-cache-control"),
      verdict: h("x-sc-matchup-cache") ?? h("x-sc-schedule-cache"),
      body,
    };
  } catch (err) {
    return { status: 0, ms: Date.now() - started, error: String(err) };
  }
}

const firstFinal = { api: null, week: null, h2h: null, schedule: null };
let stopAt = KICK + 7 * 3600_000;
while (Date.now() < KICK - 30 * 60_000) await sleep(Math.min(60_000, KICK - 30 * 60_000 - Date.now()));

for (;;) {
  const at = Date.now();
  const sample = { at: new Date(at).toISOString(), minutesFromKickoff: Math.round((at - KICK) / 60_000) };
  const api = await get(`${API}/api/game-state/${args["game-id"]}`);
  try {
    const g = JSON.parse(api.body).game;
    sample.api = { phase: g.phase, score: [g.away.score, g.home.score], clock: g.clock, period: g.period, label: g.label, scoreReadAt: g.scoreReadAtMs ? new Date(g.scoreReadAtMs).toISOString() : null, sourceUpdatedAt: g.sourceUpdatedAtMs ? new Date(g.sourceUpdatedAtMs).toISOString() : null, detailsReady: g.detailsReady };
    if (g.phase === "final" && !firstFinal.api) {
      firstFinal.api = sample.at;
      stopAt = Math.min(stopAt, at + 2 * 3600_000);
    }
  } catch {
    sample.api = { status: api.status, error: api.error ?? "unreadable" };
  }
  for (const kind of ["week", "h2h", "schedule"]) {
    await sleep(2000);
    const r = await get(urls[kind]);
    const d = r.body ? displayed(kind, r.body) : null;
    delete r.body;
    sample[kind] = { ...r, displayed: d };
    if (d && isFinal(kind, d) && !firstFinal[kind]) firstFinal[kind] = sample.at;
  }
  fs.appendFileSync(OUT, JSON.stringify(sample) + "\n");
  console.error(`${sample.at} T${sample.minutesFromKickoff >= 0 ? "+" : ""}${sample.minutesFromKickoff}m api=${sample.api.phase ?? "?"} ${sample.api.score?.join("-") ?? ""} | week ${sample.week.cf}/${sample.week.age}s ${sample.week.displayed?.strip?.phase ?? sample.week.displayed?.layout} | h2h ${sample.h2h.cf}/${sample.h2h.age}s ${sample.h2h.displayed?.strip?.phase ?? sample.h2h.displayed?.layout} | sched ${sample.schedule.cf}/${sample.schedule.age}s ${sample.schedule.displayed?.row?.words ?? ""}`);
  if (Date.now() >= stopAt) break;
  await sleep(Math.max(0, at + EVERY_MS - Date.now()));
}

const lag = (k) => (firstFinal[k] && firstFinal.api ? Math.round((Date.parse(firstFinal[k]) - Date.parse(firstFinal.api)) / 60_000) : null);
const summary = { firstFinal, minutesAfterApi: { week: lag("week"), h2h: lag("h2h"), schedule: lag("schedule") } };
fs.appendFileSync(OUT, JSON.stringify({ summary }) + "\n");
console.log(JSON.stringify(summary, null, 2));
