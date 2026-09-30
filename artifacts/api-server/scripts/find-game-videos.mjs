// Find the NFL's official YouTube highlights upload for every game that has a
// recap page, and write them to src/lib/matchup/game-videos.ts.
//
//   node scripts/find-game-videos.mjs [--from 2021] [--through 2026] [--retry]
//
// Recap pages exist for the current season and the five before it (see
// HISTORY_SEASONS in matchup-data.ts), so that is the default range. The
// schedule comes from ESPN's scoreboard; each finished game is searched on
// YouTube, and a result is kept only when ALL of these hold:
//
//   - it was uploaded by the NFL's own channel (UCDVYQ4Zhbm3S2dlz7P1GBDg);
//   - the title names both teams and says "highlights";
//   - the title names no other week or playoff round than this game's;
//   - a year in the title, if there is one, is the season;
//   - the watch page says it is public and embeddable, and was uploaded
//     within three days of kickoff — which is what ties a title with no week
//     in it to this game.
//
// A game with no match is left out, and its page simply has no video. Games
// already in the file are skipped, so a weekly rerun only searches new games;
// --retry also searches again for the games that missed last time.
//
// Hand-written entries in game-notes.ts win over this file.
//
// --live is the production mode (src/lib/player/live-refresh.ts runs it after
// each game window). The server cannot rewrite its own source, so new finds go
// to data/matchup/game-videos-live.json, which the server reads beside
// game-videos.ts, and misses to game-videos-live-misses.json; both files are
// gitignored. A miss is retried while its game is under four days old — the
// upload window below closes at three — and is final after that.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "../src/lib/matchup/game-videos.ts");
const LIVE = process.argv.includes("--live");
const MISSES = path.join(here, "../data/game-videos-misses.json");
const LIVE_OUT = path.join(here, "../data/matchup/game-videos-live.json");
const LIVE_MISSES = path.join(here, "../data/matchup/game-videos-live-misses.json");
const LIVE_RETRY_MS = 4 * 24 * 60 * 60 * 1000;
const TEAMS_TS = path.join(here, "../src/lib/team/teams.ts");
const NFL_CHANNEL = "UCDVYQ4Zhbm3S2dlz7P1GBDg";
const DAY = 24 * 60 * 60 * 1000;
const PAUSE_MS = 1200;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}
const FROM = Number(arg("from", "2021"));
const THROUGH = Number(arg("through", String(new Date().getUTCFullYear())));
const RETRY = process.argv.includes("--retry");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ teams */

// espnId -> { slug, nickname, city }, read from the site's one team table.
const TEAMS = new Map();
for (const line of fs.readFileSync(TEAMS_TS, "utf8").split("\n")) {
  const m = /slug: "([^"]+)", city: "([^"]+)", nickname: "([^"]+)".*espnId: "(\d+)"/.exec(line);
  if (m) TEAMS.set(m[4], { slug: m[1], city: m[2], nickname: m[3] });
}
if (TEAMS.size !== 32) throw new Error(`read ${TEAMS.size} teams from teams.ts, expected 32`);

/** Every name a title might use for a team. */
function aliases(team, espnName) {
  const names = new Set([team.nickname, espnName]);
  if (team.slug === "washington-commanders") names.add("Football Team").add("Washington");
  return [...names].filter(Boolean);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const names = (list) => new RegExp(`\\b(${list.map(escapeRe).join("|")})\\b`, "i");

/* -------------------------------------------------------------- schedule */

const ROUNDS = {
  1: { segment: "wild-card", query: "Wild Card", re: /wild\s*card/i },
  2: { segment: "divisional", query: "Divisional Round", re: /divisional/i },
  3: { segment: "conference-championship", query: "Conference Championship", re: /championship/i },
  5: { segment: "super-bowl", query: "Super Bowl", re: /super\s*bowl/i },
};

async function espn(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
      throw new Error(`HTTP ${r.status}`);
    } catch (err) {
      if (attempt >= 4) throw new Error(`${url}: ${err.message}`);
      await sleep(2000 * attempt);
    }
  }
}

async function seasonGames(season) {
  const weeks = [
    ...Array.from({ length: 18 }, (_, i) => ({ type: 2, week: i + 1 })),
    ...[1, 2, 3, 5].map((week) => ({ type: 3, week })),
  ];
  const games = [];
  for (const { type, week } of weeks) {
    const url =
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard` +
      `?dates=${season}&seasontype=${type}&week=${week}`;
    const data = await espn(url);
    for (const event of data.events ?? []) {
      const comp = event.competitions?.[0];
      if (!comp?.status?.type?.completed) continue;
      const home = comp.competitors.find((c) => c.homeAway === "home");
      const away = comp.competitors.find((c) => c.homeAway === "away");
      const h = TEAMS.get(String(home?.team?.id));
      const a = TEAMS.get(String(away?.team?.id));
      if (!h || !a) continue; // The Pro Bowl, and anything else that is not two clubs.
      const [x, y] = a.slug < h.slug ? [a, h] : [h, a];
      const segment = type === 3 ? `${season}-${ROUNDS[week].segment}` : `${season}-week-${week}`;
      games.push({
        key: `${x.slug}-vs-${y.slug}/${segment}`,
        season,
        type,
        week,
        kickoff: Date.parse(event.date),
        // The name as it was that season ("Football Team" in 2021), for the query.
        away: { ...a, nickname: away.team.name || a.nickname, aliases: aliases(a, away.team.name) },
        home: { ...h, nickname: home.team.name || h.nickname, aliases: aliases(h, home.team.name) },
      });
    }
  }
  return games;
}

/* ---------------------------------------------------------------- youtube */

const HEADERS = {
  "accept-language": "en-US,en;q=0.9",
  "user-agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  cookie: "CONSENT=YES+1",
};

async function youtube(url) {
  for (let attempt = 1; ; attempt++) {
    await sleep(PAUSE_MS);
    try {
      const r = await fetch(url, { headers: HEADERS });
      const html = await r.text();
      if (r.ok && !/consent\.youtube\.com|g-recaptcha/.test(html)) return html;
      throw new Error(`HTTP ${r.status}${r.ok ? " (consent or captcha page)" : ""}`);
    } catch (err) {
      if (attempt >= 4) throw new Error(`${url}: ${err.message}`);
      await sleep(15000 * attempt);
    }
  }
}

async function search(query) {
  const html = await youtube(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=en&gl=US`,
  );
  const m = /var ytInitialData = (\{.*?\});<\/script>/s.exec(html);
  if (!m) throw new Error(`no results data for "${query}"`);
  const out = [];
  const walk = (o) => {
    if (!o || typeof o !== "object") return;
    if (o.videoRenderer) {
      const v = o.videoRenderer;
      out.push({
        id: v.videoId,
        title: (v.title?.runs ?? []).map((r) => r.text).join(""),
        channelId: v.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId ?? "",
      });
      return;
    }
    for (const k in o) walk(o[k]);
  };
  walk(JSON.parse(m[1]));
  return out;
}

async function watchFacts(id) {
  const html = await youtube(`https://www.youtube.com/watch?v=${id}&hl=en`);
  const pick = (re) => re.exec(html)?.[1] ?? null;
  return {
    channelId: pick(/"channelId":"([^"]+)"/),
    uploadDate: pick(/"uploadDate":"([^"]+)"/),
    embeddable: pick(/"playableInEmbed":(true|false)/) === "true",
    unlisted: pick(/"isUnlisted":(true|false)/) === "true",
  };
}

/** Does this title describe this game, and no other? */
function titleFits(title, game) {
  if (!/highlights/i.test(title)) return false;
  if (!names(game.away.aliases).test(title) || !names(game.home.aliases).test(title)) return false;
  const years = title.match(/\b20\d\d\b/g) ?? [];
  if (years.some((y) => Number(y) !== game.season)) return false;
  const weeks = [...title.matchAll(/\bweek\s*(\d{1,2})\b/gi)].map((m) => Number(m[1]));
  const rounds = Object.entries(ROUNDS).filter(([, r]) => r.re.test(title)).map(([w]) => Number(w));
  // A title with no week or round at all is allowed: the upload window in
  // findVideo() is what pins it to this game, since the same two teams never
  // meet twice in four days.
  if (game.type === 2) return rounds.length === 0 && weeks.every((w) => w === game.week);
  return weeks.length === 0 && rounds.every((w) => w === game.week);
}

async function findVideo(game) {
  const label = game.type === 2 ? `Week ${game.week}` : ROUNDS[game.week].query;
  const queries = [
    `${game.away.nickname} vs ${game.home.nickname} highlights NFL ${game.season} ${label}`,
    `${game.away.city} ${game.away.nickname} vs ${game.home.city} ${game.home.nickname} ${game.season} ${label} game highlights`,
  ];
  const tried = new Set();
  for (const query of queries) {
    for (const hit of await search(query)) {
      if (hit.channelId !== NFL_CHANNEL || tried.has(hit.id) || !titleFits(hit.title, game)) continue;
      tried.add(hit.id);
      const facts = await watchFacts(hit.id);
      if (facts.channelId !== NFL_CHANNEL || !facts.embeddable || facts.unlisted || !facts.uploadDate) continue;
      const uploaded = Date.parse(facts.uploadDate);
      if (!(uploaded >= game.kickoff - DAY && uploaded <= game.kickoff + 3 * DAY)) continue;
      return {
        youtubeId: hit.id,
        title: hit.title,
        uploadDate: facts.uploadDate.slice(0, 10),
        publisher: "NFL",
      };
    }
  }
  return null;
}

/* ----------------------------------------------------------------- output */

const START = "// BEGIN GENERATED\n";
const END = "// END GENERATED\n";

function readExisting() {
  if (!fs.existsSync(OUT)) return {};
  const text = fs.readFileSync(OUT, "utf8");
  const body = text.slice(text.indexOf(START) + START.length, text.indexOf(END));
  return JSON.parse(body.replace(/^export const GAME_VIDEOS[^=]*=\s*/, "").replace(/;\s*$/, ""));
}

function write(videos) {
  const sorted = Object.fromEntries(Object.entries(videos).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(
    OUT,
    `/**\n` +
      ` * The NFL's official YouTube highlights upload for each game, keyed like\n` +
      ` * game-notes.ts: \`<pair slug>/<game segment>\`. Generated by\n` +
      ` * scripts/find-game-videos.mjs, which says how each one was checked; do not\n` +
      ` * edit by hand. A hand-written video in game-notes.ts wins over this file.\n` +
      ` */\n\n` +
      `import type { GameVideo } from "./game-notes";\n\n` +
      START +
      `export const GAME_VIDEOS: Record<string, GameVideo> = ${JSON.stringify(sorted, null, 2)};\n` +
      END,
  );
}

const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {});
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(tmp, file);
};

// Live: the committed finds and misses are read, never written; what this run
// learns goes to the two live files.
const committed = readExisting();
const liveVideos = LIVE ? readJson(LIVE_OUT) : {};
const videos = LIVE ? { ...committed, ...liveVideos } : committed;
const committedMisses = readJson(MISSES);
const misses = LIVE ? { ...committedMisses, ...readJson(LIVE_MISSES) } : committedMisses;
const liveMisses = LIVE ? readJson(LIVE_MISSES) : null;
let found = 0;
let missed = 0;

function save() {
  if (LIVE) {
    writeJson(LIVE_OUT, liveVideos);
    writeJson(LIVE_MISSES, liveMisses);
  } else {
    write(videos);
    fs.writeFileSync(MISSES, JSON.stringify(misses, null, 2) + "\n");
  }
}

for (let season = FROM; season <= THROUGH; season++) {
  const games = await seasonGames(season);
  console.log(`${season}: ${games.length} finished games`);
  for (const game of games) {
    if (videos[game.key]) continue;
    const retry = RETRY || (LIVE && Date.now() - game.kickoff < LIVE_RETRY_MS);
    if (misses[game.key] && !retry) continue;
    let video = null;
    try {
      video = await findVideo(game);
    } catch (err) {
      console.log(`  error ${game.key}: ${err.message}`);
      continue; // Not a miss: try again next run.
    }
    if (video) {
      videos[game.key] = video;
      delete misses[game.key];
      if (LIVE) {
        liveVideos[game.key] = video;
        delete liveMisses[game.key];
      }
      found++;
      console.log(`  ok   ${game.key}  ${video.youtubeId}  ${video.title}`);
    } else {
      misses[game.key] = new Date().toISOString().slice(0, 10);
      if (LIVE) liveMisses[game.key] = misses[game.key];
      missed++;
      console.log(`  miss ${game.key}`);
    }
    if ((found + missed) % 10 === 0) save();
  }
  save();
}

console.log(`done: ${found} found, ${missed} missed, ${Object.keys(videos).length} in the file`);
