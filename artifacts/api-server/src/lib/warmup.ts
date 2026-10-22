/**
 * The boot warm-up, wired to this app: what is hot, and how to ask for it.
 *
 * OFF unless SC_WARMUP=1 says otherwise, in production too. It shipped
 * production-default on 2026-10-21 and the VM died within hours of both
 * publishes that carried it (the walk leaves the process at ~1.2 GB resident
 * on a 2 GB VM, beside the builders); the boot without it had run for weeks.
 * It stays as an opt-in for a VM with more room. The list is the
 * 32 team hubs, this week's and last week's matchup pages, the most-rostered
 * players (SC_WARMUP_PLAYERS, 150 by default) and the three team sections
 * with URLs of their own. Requests go to the server's own port with the embed
 * key, exactly as WordPress asks (`?h1=1` unless SC_WARMUP_H1=0, because the
 * live site runs the tools in "let the tool supply the heading" mode and the
 * flag is part of the render-cache key).
 *
 * It runs twice per boot at most: once after the startup restore, and again
 * after the game-window refresh reloads the game logs - that reload drops the
 * loaded data as well as the rendered fragments, so without the second pass
 * the first reader after a Sunday refresh pays the cold start again. See
 * lib/warmup-core.ts for the walk itself and the stall it answers.
 */

import { KEY_HEADER } from "./embed-key";
import { canonicalizeMatchupPair } from "./matchup/pair";
import { loadRosterPct } from "./player/data";
import { indexedPlayers } from "./player/player-data";
import { currentWeek, getSchedule, scheduleSeason, weekGames } from "./schedule/schedule-data";
import { TEAMS } from "./team/teams";
import { availableMemMb } from "./mem";
import { parsePlayerCap, planWarmup, runWarmup, type WarmupSummary } from "./warmup-core";

/** The team sections WordPress serves at their own addresses (statchasers-team-pages.php). */
const SECTIONS = ["usage", "schedule", "depth-chart"] as const;
const DEFAULT_PLAYERS = 150;
/** The whole walk, at most. Past this the traffic is warming the rest anyway. */
const BUDGET_MS = 8 * 60 * 1000;
/** Between pages. A render is 50-300 ms warm; this is a reader's turn. */
const YIELD_MS = 40;
/** Per page. A cold player page is ~6 s locally; the VM is slower and may be busy. */
const REQUEST_TIMEOUT_MS = 45 * 1000;
/**
 * Stop walking when the VM has less than this left (SC_WARMUP_MIN_FREE_MB).
 * The builders a refresh spawns get a 768MB heap each (live-refresh.ts), and
 * the process itself keeps growing with what it renders; the 2GB VM needs the
 * headroom more than a reader needs a warm page.
 */
const DEFAULT_MIN_FREE_MB = 800;

function flag(name: string, fallback: boolean): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return fallback;
}

export function warmupEnabled(): boolean {
  return flag("SC_WARMUP", false);
}

function maxPlayers(): number {
  return parsePlayerCap(process.env["SC_WARMUP_PLAYERS"], DEFAULT_PLAYERS);
}

function minFreeMb(): number {
  return parsePlayerCap(process.env["SC_WARMUP_MIN_FREE_MB"], DEFAULT_MIN_FREE_MB);
}

function note(line: string): void {
  process.stderr.write(`[warmup] ${new Date().toISOString()} ${line}\n`);
}

/** Indexed players, most-rostered first; a player with no ownership row sorts last. */
function hotPlayerSlugs(): string[] {
  const owned = loadRosterPct().players;
  return indexedPlayers()
    .map((p) => ({ slug: p.slug, owned: owned[p.id]?.owned ?? -1 }))
    .sort((a, b) => b.owned - a.owned || a.slug.localeCompare(b.slug))
    .map((p) => p.slug);
}

/** This week's and last week's games as pair slugs. Best effort: no schedule, no pairs. */
async function hotPairSlugs(now: number): Promise<string[]> {
  try {
    const schedule = await getSchedule(scheduleSeason(), now);
    if (!schedule) return [];
    const week = currentWeek(schedule, now);
    const weeks = week > 1 ? [week, week - 1] : [week];
    const out: string[] = [];
    for (const w of weeks) {
      for (const game of weekGames(schedule, w)) {
        const pair = canonicalizeMatchupPair(game.away ?? game.awayCode, game.home ?? game.homeCode);
        if (pair) out.push(pair.slug);
      }
    }
    return out;
  } catch (err) {
    note(`schedule not read, no matchups warmed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

export async function buildWarmupPaths(now: number = Date.now()): Promise<string[]> {
  return planWarmup({
    teams: TEAMS.map((t) => t.slug),
    sections: SECTIONS,
    players: hotPlayerSlugs(),
    maxPlayers: maxPlayers(),
    pairs: await hotPairSlugs(now),
    ownHeading: flag("SC_WARMUP_H1", true),
  });
}

let inFlight: Promise<WarmupSummary | null> | null = null;

/**
 * Walk the hot pages through the server's own port. Joins a walk already in
 * flight rather than starting a second one beside it.
 */
export function warmRenders(port: number): Promise<WarmupSummary | null> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const paths = await buildWarmupPaths();
      const key = (process.env["SC_EMBED_KEY"] ?? "").trim();
      const headers: Record<string, string> = { accept: "text/html" };
      if (key) headers[KEY_HEADER] = key;
      return await runWarmup(
        paths,
        {
          fetch: async (path) => {
            const res = await fetch(`http://127.0.0.1:${port}${path}`, {
              headers,
              signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
            await res.arrayBuffer();
            return res.status;
          },
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          now: () => Date.now(),
          note,
          availableMb: availableMemMb,
        },
        { budgetMs: BUDGET_MS, yieldMs: YIELD_MS, minFreeMb: minFreeMb() },
      );
    } catch (err) {
      note(`not run: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
