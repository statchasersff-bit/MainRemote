/**
 * Headshots for stories that arrive without one (mak's review of the news
 * rail, 2026-11-17: "use a relevant player headshot where one is available,
 * with the logo only as a fallback").
 *
 * The wire attaches a photo only for players in our fantasy dictionary, so
 * defenders and most special-teamers come through bare. Every player who has
 * recorded a stat this season or last is in our stored ESPN box scores, with
 * ESPN's athlete id and the club he played for. The story's player name and
 * team are matched against that index (name + team first; name alone only
 * when exactly one player carries it) and the match becomes ESPN's headshot
 * URL, which the image route serves as /news-image/espn/<id>/... like the
 * depth charts' photos. No match keeps the StatChasers mark.
 *
 * Used by the rail only (its fragment, and /api/news?photos=1 for its
 * refreshes). It always returns COPIES: the item arrays are shared with the
 * full feed's caches, which must not change under it.
 */

import fs from "node:fs";
import { dataPath } from "./data-dir";
import { searchKey, type NewsItem } from "./render";

interface Index {
  stamp: string;
  byTeam: Map<string, string>;
  byName: Map<string, string | null>;
}

let cache: Index | null = null;

const key = (name: string): string => searchKey(name).replace(/\s+(jr|sr|ii|iii|iv|v)$/, "");

/** The box-score seasons to read: this one, then last (the newer wins). */
function seasonFiles(): string[] {
  const year = new Date().getUTCFullYear();
  const seasons = new Date().getUTCMonth() < 2 ? [year - 1, year - 2] : [year, year - 1];
  return seasons.map((s) => dataPath("matchup", "boxscores", `${s}.json`)).filter((f) => fs.existsSync(f));
}

interface BoxDoc {
  games: Record<string, { summary?: { boxscore?: { players?: Array<{ team?: { abbreviation?: string }; statistics?: Array<{ athletes?: Array<{ athlete?: { id?: string; displayName?: string } }> }> }> } } }>;
}

function index(): Index {
  const files = seasonFiles();
  const stamp = files.map((f) => `${f}:${fs.statSync(f).mtimeMs}`).join("|");
  if (cache && cache.stamp === stamp) return cache;
  const byTeam = new Map<string, string>();
  const byName = new Map<string, string | null>();
  // Oldest first, so the current season's club wins a traded player.
  for (const file of [...files].reverse()) {
    let doc: BoxDoc;
    try {
      doc = JSON.parse(fs.readFileSync(file, "utf8")) as BoxDoc;
    } catch {
      continue;
    }
    for (const game of Object.values(doc.games ?? {})) {
      for (const side of game.summary?.boxscore?.players ?? []) {
        const team = (side.team?.abbreviation ?? "").toUpperCase();
        for (const block of side.statistics ?? []) {
          for (const a of block.athletes ?? []) {
            const id = a.athlete?.id;
            const name = a.athlete?.displayName;
            if (!id || !name || !/^\d{1,12}$/.test(id)) continue;
            const k = key(name);
            if (team) byTeam.set(`${k}|${team}`, id);
            const seen = byName.get(k);
            byName.set(k, seen === undefined || seen === id ? id : null);
          }
        }
      }
    }
  }
  cache = { stamp, byTeam, byName };
  return cache;
}

/** ESPN's athlete id for a story's player, or null. */
export function espnIdFor(playerName: string | null | undefined, team: string | null | undefined): string | null {
  const name = (playerName ?? "").trim();
  if (!name) return null;
  const idx = index();
  const k = key(name);
  const t = (team ?? "").toUpperCase();
  return (t ? idx.byTeam.get(`${k}|${t}`) : undefined) ?? idx.byName.get(k) ?? null;
}

/** Copies of the items, each one without a photo given ESPN's headshot where the player is known. */
export function fillRailPhotos(items: NewsItem[]): NewsItem[] {
  return items.map((item) => {
    if (item.image) return { ...item };
    const id = espnIdFor(item.playerName, item.team);
    return id ? { ...item, image: `https://a.espncdn.com/i/headshots/nfl/players/full/${id}.png` } : { ...item };
  });
}
