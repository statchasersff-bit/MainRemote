/**
 * Every NFL game since 1920, from data/rivalry/all-time.json.
 *
 * Built once a year by scripts/build-rivalry-history.mjs and shipped with the
 * app; it covers complete seasons only (`throughSeason`), and the page adds
 * the season in progress from its own schedule. Read lazily, once, and indexed
 * by pair, because a page asks for one pair out of ~500.
 */

import fs from "node:fs";
import { dataPath } from "../data-dir";
import { logger } from "../logger";
import type { RivalryGame } from "./rivalry";

type Row = [number, string, string, string, number, number, 0 | 1];

interface History {
  throughSeason: number;
  byPair: Map<string, RivalryGame[]>;
}

let history: History | null = null;

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

function load(): History {
  if (history) return history;
  const byPair = new Map<string, RivalryGame[]>();
  let throughSeason = 0;
  try {
    const raw = JSON.parse(fs.readFileSync(dataPath("rivalry", "all-time.json"), "utf8")) as {
      throughSeason: number;
      games: Row[];
    };
    throughSeason = raw.throughSeason;
    // A season's Super Bowl is its last game: a playoff game on the latest
    // date the season has, from the 1966 season (the first) on.
    const lastDate = new Map<number, string>();
    for (const [season, date] of raw.games) {
      if ((lastDate.get(season) ?? "") < date) lastDate.set(season, date);
    }
    for (const [season, date, away, home, awayScore, homeScore, playoff] of raw.games) {
      const key = pairKey(away, home);
      const list = byPair.get(key) ?? [];
      const superBowl = playoff === 1 && season >= 1966 && lastDate.get(season) === date;
      list.push({ season, date, away, home, awayScore, homeScore, playoff: playoff === 1, superBowl, url: null });
      byPair.set(key, list);
    }
  } catch (err) {
    // Absent, the head-to-head section simply has no all-time tiles.
    logger.warn({ err }, "No all-time rivalry history; the all-time tiles are off");
  }
  history = { throughSeason, byPair };
  return history;
}

/** The pair's complete-season meetings (copies), and the last season covered. */
export function historyForPair(a: string, b: string): { throughSeason: number; games: RivalryGame[] } | null {
  const h = load();
  const games = h.byPair.get(pairKey(a.toUpperCase(), b.toUpperCase()));
  if (!h.throughSeason) return null;
  return { throughSeason: h.throughSeason, games: (games ?? []).map((g) => ({ ...g })) };
}
