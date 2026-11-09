// Store each finished game's opening and closing lines from ONE sportsbook in
// data/matchup/odds/<season>.json, for the recap Betting tab's frozen market
// (src/lib/matchup/game-odds.ts).
//
//   node scripts/matchup/buildGameOdds.mjs [season ...] [--refetch]
//
// Source: ESPN's competition odds document, the first provider listed (the one
// whose closing spread and total the stored box score already carries). Per
// game: provider, and for open and close the home-signed spread (negative =
// home favored), the total and both moneylines. A market the book did not
// price is null, never filled in.
//
// The games are the season's stored box scores (data/matchup/boxscores), so
// only finished games are read. A stored game is not fetched again unless
// --refetch is given: once a game is over its opening and closing lines do not
// change. HAND-RUN; nothing schedules it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, "..", "..", "data", "matchup");
const OUT_DIR = path.join(DATA, "odds");
const HEADERS = {
  Accept: "application/json",
  "Accept-Encoding": "identity",
  "User-Agent": "StatChasersTeamPages/1.0 (+statchasers.com)",
};
const DELAY_MS = 400;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** "+3.5" / "-3" / "44.5" / "EVEN" -> number, else null. */
function num(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toUpperCase();
  if (text === "EVEN" || text === "EV") return 100;
  if (text === "PK" || text === "PICK") return 0;
  const n = Number(text.replace(/^\+/, ""));
  return Number.isFinite(n) ? n : null;
}

function side(item, key, when) {
  const s = item?.[key]?.[when];
  return {
    spread: num(s?.pointSpread?.american),
    moneyline: num(s?.moneyLine?.american),
  };
}

function market(item, when) {
  const home = side(item, "homeTeamOdds", when);
  const away = side(item, "awayTeamOdds", when);
  return {
    spread: home.spread,
    total: num(item?.[when]?.total?.american),
    moneyline: { away: away.moneyline, home: home.moneyline },
  };
}

async function fetchOdds(eventId) {
  const url = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/${eventId}/competitions/${eventId}/odds`;
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${res.status} ${eventId}`);
  const body = await res.json();
  const item = (body.items ?? [])[0];
  if (!item) return null;
  return {
    provider: item.provider?.name ?? null,
    open: market(item, "open"),
    close: market(item, "close"),
    fetchedAt: new Date().toISOString(),
  };
}

async function buildSeason(season, refetch) {
  const boxFile = path.join(DATA, "boxscores", `${season}.json`);
  if (!fs.existsSync(boxFile)) {
    console.log(`${season}: no stored box scores`);
    return;
  }
  const games = JSON.parse(fs.readFileSync(boxFile, "utf8")).games ?? {};
  const outFile = path.join(OUT_DIR, `${season}.json`);
  const stored = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, "utf8")) : { season, games: {} };
  let added = 0;
  let failed = 0;
  for (const eventId of Object.keys(games)) {
    if (stored.games[eventId] && !refetch) continue;
    try {
      const odds = await fetchOdds(eventId);
      if (odds) {
        stored.games[eventId] = odds;
        added += 1;
      }
    } catch (error) {
      failed += 1;
      console.warn(`${season} ${eventId}: ${error.message}`);
    }
    await sleep(DELAY_MS);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const sorted = Object.fromEntries(Object.entries(stored.games).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(outFile, `${JSON.stringify({ season, games: sorted })}\n`);
  console.log(`${season}: ${added} stored, ${failed} failed, ${Object.keys(sorted).length} total`);
}

const args = process.argv.slice(2);
const refetch = args.includes("--refetch");
const seasons = args.filter((a) => /^\d{4}$/.test(a)).map(Number);
for (const season of seasons.length ? seasons : [new Date().getUTCFullYear()]) {
  await buildSeason(season, refetch);
}
