/**
 * The wire, read from RotoWire directly: the 32 team news pages, swept.
 *
 * Replaces pulling the Dynasty Command relay as the timer's source (2026-11-05,
 * mak). The relay read RotoWire's five-item RSS every four hours and handed on
 * the 25 rows it had, so most of what RotoWire posted never reached the
 * archive - a starting QB's page showed one note a month. Each team page here
 * carries that club's 25 newest notes, so a ten-minute sweep sees everything.
 *
 * Same lane, same rows. Items are stored as "wire" with the ids and titles the
 * relay used, so a story archived through it is updated in place rather than
 * duplicated, and the News tab needs no new case.
 *
 * Times. The team page prints a date; the archive sorts on a time. A note the
 * archive already knows keeps the time it has (lib/news-known.ts, primed from
 * the table at boot). A new note's time is read from its own headline page,
 * one fetch per new note, capped per sweep so a cold archive backfills over a
 * few sweeps instead of hitting RotoWire eight hundred times in one. A note
 * whose page cannot be read gets noon on its date rather than being dropped.
 *
 * Headshots. The page has no Sleeper id. The player is matched to the shipped
 * roster (data/player/players.json) by normalized name, then team, then
 * position; an unmatched player simply has no picture, as a club row does.
 */

import { logger } from "./logger";
import { knownNews } from "./news-known";
import { newsDedupeKey, type RawNewsItem } from "./news-item";
import { loadPlayers } from "./player/data";
import { searchKey } from "./render";
import { TEAMS, type NflTeam } from "./team/teams";
import {
  noonEasternOf,
  parseHeadlineTime,
  parseRotowirePage,
  rotowireItem,
  rotowireItemId,
  rotowireItemTitle,
  rotowireTeamUrl,
  type RotowireNote,
} from "./rotowire-parse";

export { rotowireTeamUrl };

const USER_AGENT = "StatChasersNews/1.0 (+https://news.statchasers.com)";

/** Team pages in flight at once. Thirty-two pages, a few seconds, no burst. */
const PAGE_CONCURRENCY = 4;
/** Headline pages in flight at once. */
const HEADLINE_CONCURRENCY = 3;
/**
 * Most headline pages read per sweep. A cold archive has ~800 unknown notes;
 * at this cap it is caught up in under two hours of sweeps, and a normal day
 * (a hundred or so new notes) never reaches the cap at all.
 */
export const HEADLINE_FETCH_CAP = 60;
/** Per-request ceiling. A page is ~400 KB; RotoWire answers in well under this. */
const TIMEOUT_MS = 20_000;
/** Older than this is backfill, not news - same cutoff the club lane uses. */
const MAX_ITEM_AGE_DAYS = 45;

export interface RotowireSweepSummary {
  /** Team pages that answered with at least one parseable note. */
  ok: number;
  /** Team pages that could not be read or parsed, with the reason. */
  failed: Array<{ team: string; error: string }>;
  /** Items ready to store. */
  items: RawNewsItem[];
  /** Notes whose time was read from the archive's memory. */
  fromMemory: number;
  /** Notes whose time was read from their headline page this sweep. */
  fromPage: number;
  /** Notes stored with noon on their date because the page could not be read. */
  dated: number;
  /** Items dropped for being older than MAX_ITEM_AGE_DAYS. */
  tooOld: number;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html, */*;q=0.8",
      // Node's fetch otherwise sends `user-agent: node`, which bot management
      // scores as anonymous automation. This names the service and a URL.
      "User-Agent": USER_AGENT,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

/** Run `task` over `list`, at most `limit` at a time, in order. */
async function pooled<T, R>(
  list: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(list.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) {
      const index = next++;
      results[index] = await task(list[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/* ------------------------------------------------------------- headshots */

interface RosterEntry {
  id: string;
  team: string | null;
  position: string | null;
}

/** The shipped roster by normalized name. Built once per sweep. */
function rosterIndex(): Map<string, RosterEntry[]> {
  const byName = new Map<string, RosterEntry[]>();
  for (const p of loadPlayers()) {
    const key = searchKey(p.name);
    if (!key) continue;
    const list = byName.get(key) ?? [];
    list.push({ id: p.id, team: p.team?.toUpperCase() ?? null, position: p.position });
    byName.set(key, list);
  }
  return byName;
}

/**
 * The Sleeper headshot for a note's player, or null.
 *
 * Name first; a shared name is settled by the note's team, then position.
 * Still ambiguous means no picture rather than the wrong one.
 */
export function headshotFor(
  note: Pick<RotowireNote, "playerName" | "teamCode" | "position">,
  roster: Map<string, RosterEntry[]>,
): string | null {
  const candidates = roster.get(searchKey(note.playerName)) ?? [];
  if (candidates.length === 0) return null;
  let pick: RosterEntry[] = candidates;
  if (pick.length > 1 && note.teamCode) {
    const onTeam = pick.filter((c) => c.team === note.teamCode);
    if (onTeam.length > 0) pick = onTeam;
  }
  if (pick.length > 1 && note.position) {
    const atPos = pick.filter((c) => c.position === note.position);
    if (atPos.length > 0) pick = atPos;
  }
  if (pick.length !== 1) return null;
  return `https://sleepercdn.com/content/nfl/players/thumb/${pick[0]!.id}.jpg`;
}

/* ----------------------------------------------------------------- sweep */

/**
 * Every team page, fetched and reduced to storable items.
 *
 * Never throws for a single team. One page failing to parse - a template
 * change, a slow answer - costs that club's notes this sweep and nothing else;
 * the caller decides how many failures make the sweep itself a failure.
 */
export async function fetchRotowireNews(
  nowMs: number = Date.now(),
  fetchPage: (url: string) => Promise<string> = fetchText,
): Promise<RotowireSweepSummary> {
  const summary: RotowireSweepSummary = {
    ok: 0,
    failed: [],
    items: [],
    fromMemory: 0,
    fromPage: 0,
    dated: 0,
    tooOld: 0,
  };
  const cutoff = nowMs - MAX_ITEM_AGE_DAYS * 86_400_000;

  const perTeam = await pooled(TEAMS, PAGE_CONCURRENCY, async (team: NflTeam) => {
    try {
      const notes = parseRotowirePage(await fetchPage(rotowireTeamUrl(team)));
      if (notes.length === 0) throw new Error("page answered but carried no notes");
      return { team, notes, error: null as string | null };
    } catch (err) {
      return { team, notes: [] as RotowireNote[], error: err instanceof Error ? err.message : String(err) };
    }
  });

  // One note per id. A player traded mid-week can sit on two team pages.
  const byId = new Map<string, RotowireNote>();
  for (const { team, notes, error } of perTeam) {
    if (error !== null) {
      summary.failed.push({ team: team.abbreviation, error });
      continue;
    }
    summary.ok++;
    for (const note of notes) if (!byId.has(note.noteId)) byId.set(note.noteId, note);
  }

  // Times: memory first, then the headline page for what is new, capped.
  const resolved = new Map<string, string>();
  const needPage: RotowireNote[] = [];
  for (const note of byId.values()) {
    const known = knownNews(newsDedupeKey({ title: rotowireItemTitle(note), id: rotowireItemId(note.noteId) }));
    if (known?.pubDateMs != null) {
      resolved.set(note.noteId, new Date(known.pubDateMs).toISOString());
      summary.fromMemory++;
    } else {
      needPage.push(note);
    }
  }

  const toFetch = needPage.slice(0, HEADLINE_FETCH_CAP);
  await pooled(toFetch, HEADLINE_CONCURRENCY, async (note) => {
    try {
      const time = parseHeadlineTime(await fetchPage(note.headlineUrl));
      if (time) {
        resolved.set(note.noteId, time);
        summary.fromPage++;
        return;
      }
    } catch (err) {
      logger.warn({ err, url: note.headlineUrl }, "RotoWire headline page could not be read");
    }
    const noon = noonEasternOf(note.dateText);
    if (noon) {
      resolved.set(note.noteId, noon);
      summary.dated++;
    }
  });
  // Beyond the cap: left for the next sweep, which will find them still on
  // the team page. Nothing is stored with a guessed time while a real one is
  // ten minutes away.

  const roster = rosterIndex();
  for (const note of byId.values()) {
    const pubDate = resolved.get(note.noteId);
    if (!pubDate) continue;
    if (Date.parse(pubDate) < cutoff) {
      summary.tooOld++;
      continue;
    }
    summary.items.push(rotowireItem(note, pubDate, headshotFor(note, roster)));
  }

  if (summary.failed.length > 0) {
    logger.warn({ failed: summary.failed }, "Some RotoWire team pages could not be read");
  }
  const deferred = needPage.length - toFetch.length;
  if (deferred > 0) {
    logger.info({ deferred, cap: HEADLINE_FETCH_CAP }, "RotoWire notes left for the next sweep");
  }

  return summary;
}
