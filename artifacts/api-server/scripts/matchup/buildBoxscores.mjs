// Store every finished game's ESPN box score in data/matchup/boxscores/<season>.json.
//
//   node scripts/matchup/buildBoxscores.mjs [season ...]
//
// The recap pages read these files first (getGameBoxscore in
// src/lib/matchup/boxscore.ts) and ask ESPN only for a game not stored yet. A
// final game's box score does not change, and ESPN refuses this host at times,
// so a recap that has been checked should not depend on ESPN answering again.
//
// Each game is ESPN's summary trimmed to what the parser reads (see
// espn-summary-trim.mjs), about 18 KB. The regular season and the playoffs are
// both stored; only games ESPN marks STATUS_FINAL.
//
// A game is fetched again while it is recent - within SETTLE_DAYS of kickoff at
// the time it was saved - because the league's stat corrections land in the
// days after a game. After that it is settled and left alone. A fetch that
// fails keeps the stored copy; nothing on disk is ever dropped.
//
// Runs after each game window in production with the other game builders
// (src/lib/player/live-refresh.ts). Seasons default to the current one.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { trimEspnSummary } from "./espn-summary-trim.mjs";
import { currentSeason } from "../player/season.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OUT_DIR =
  process.env.SC_BOXSCORE_DIR?.trim() || path.resolve(HERE, "..", "..", "data", "matchup", "boxscores");

const SETTLE_DAYS = 7;
const DELAY_MS = 300;
const DAY_MS = 24 * 60 * 60 * 1000;
// The same named agent the server and the scores builder send. ESPN has
// refused anonymous requests from this host that it answers with this header.
const HEADERS = {
  Accept: "application/json",
  "Accept-Encoding": "identity",
  "User-Agent": "StatChasersTeamPages/1.0 (+statchasers.com)",
};
const BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";

/** Regular season weeks 1–18, then the playoffs. Postseason week 4 is the Pro Bowl. */
const WEEKS = [
  ...Array.from({ length: 18 }, (_, i) => ({ seasonType: "regular", type: 2, week: i + 1 })),
  ...[1, 2, 3, 5].map((week) => ({ seasonType: "post", type: 3, week })),
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function readSeason(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function settled(game) {
  return Date.parse(game.fetchedAt) - Date.parse(game.date) > SETTLE_DAYS * DAY_MS;
}

async function buildSeason(season) {
  const file = path.join(OUT_DIR, `${season}.json`);
  const stored = readSeason(file)?.games ?? {};
  const games = { ...stored };
  let fetched = 0;
  let failed = 0;

  for (const slot of WEEKS) {
    let events;
    try {
      const board = await getJson(
        `${BASE}/scoreboard?dates=${season}&seasontype=${slot.type}&week=${slot.week}&limit=50`,
      );
      events = board.events ?? [];
    } catch (err) {
      console.warn(`  ${slot.seasonType} week ${slot.week}: scoreboard failed (${err.message})`);
      failed++;
      continue;
    }

    for (const event of events) {
      const comp = event.competitions?.[0];
      if (comp?.status?.type?.name !== "STATUS_FINAL") continue;
      const id = String(event.id);
      if (games[id] && settled(games[id])) continue;

      await sleep(DELAY_MS);
      try {
        const summary = trimEspnSummary(await getJson(`${BASE}/summary?event=${id}`));
        if (summary.header?.competitions?.[0]?.status?.type?.completed !== true) continue;
        games[id] = {
          season,
          seasonType: slot.seasonType,
          week: slot.week,
          name: event.shortName ?? event.name ?? "",
          date: event.date,
          fetchedAt: new Date().toISOString(),
          summary,
        };
        fetched++;
      } catch (err) {
        console.warn(`  ${id} ${event.shortName ?? ""}: ${err.message}${stored[id] ? " (kept stored copy)" : ""}`);
        failed++;
      }
    }
    await sleep(DELAY_MS);
  }

  const count = Object.keys(games).length;
  if (count === 0) {
    console.log(`${season}: no finished games, nothing written`);
    return { season, count, fetched, failed };
  }
  if (fetched > 0 || !fs.existsSync(file)) {
    // Ordered by kickoff so a diff of a weekly run reads as that week's games.
    const ordered = Object.fromEntries(
      Object.entries(games).sort(([, a], [, b]) => Date.parse(a.date) - Date.parse(b.date)),
    );
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify({ season, games: ordered }) + "\n");
    fs.renameSync(`${file}.tmp`, file);
  }
  console.log(`${season}: ${count} games stored, ${fetched} fetched, ${failed} failed`);
  return { season, count, fetched, failed };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  // Not seasonsFromArgs(): its default is every season since 2009, and recaps
  // reach back only HISTORY_SEASONS (five) before the current one.
  const named = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 2000);
  for (const season of named.length ? named : [currentSeason()]) await buildSeason(season);
}
