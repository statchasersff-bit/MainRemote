/**
 * What the archive already holds, as far as this process knows.
 *
 * Every wire run re-sends the same ~25 stories and every club sweep the same
 * ~1,800, and the ingest used to open a transaction and look all of them up
 * to learn that nothing had changed. On a database that bills while awake
 * that lookup WAS the bill. This is the memory that lets storeItems() answer
 * "nothing changed" without a query.
 *
 * One record per dedupe key: the fingerprint of every column an update would
 * write, the stored source (attribution only ever upgrades, so a batch that
 * names an outlet has to be compared against it), the normalized publish
 * time (a future-dated item is held at the time it was first seen, and the
 * held value is needed to recognize the same item next time), and the row id.
 *
 * Filled once at startup from the most recently seen rows (loadKnownNews),
 * then kept current by storeItems() after every batch it writes or verifies.
 * Bounded: insertion-ordered, oldest evicted past MAX, which comfortably
 * holds everything the feeds re-send. A key this does not hold simply takes
 * the database path, so a miss costs a query and never a wrong answer. A row
 * changed behind this process's back is the one case it cannot see; the
 * explicit reload (POST /api/cache/reload) rebuilds it from the table.
 */

import { desc } from "drizzle-orm";
import { db, newsItems } from "./db";
import { dbAccess } from "./db-access";
import { logger } from "./logger";

/** The columns an ingest compares, in a fixed order, so two fingerprints are comparable. */
export interface NewsFields {
  title: string;
  link: string | null;
  pubDate: string | null;
  pubDateMs: number | null;
  playerName: string | null;
  image: string | null;
  teamAbbr: string | null;
  sourceType: string | null;
  authorHandle: string | null;
}

export interface KnownNews {
  id: string;
  fingerprint: string;
  pubDateMs: number | null;
  source: string | null;
}

const MAX = 8000;

const byKey = new Map<string, KnownNews>();
const keyById = new Map<string, string>();
let loadedAtMs = 0;

export function fingerprintNews(fields: NewsFields): string {
  return JSON.stringify([
    fields.title,
    fields.link,
    fields.pubDate,
    fields.pubDateMs,
    fields.playerName,
    fields.image,
    fields.teamAbbr,
    fields.sourceType,
    fields.authorHandle,
  ]);
}

export function knownNews(dedupeKey: string): KnownNews | undefined {
  return byKey.get(dedupeKey);
}

/** Remember a row as the database now holds it. */
export function rememberNews(dedupeKey: string, record: KnownNews): void {
  // The same id under an older key (a retitled story moved its fingerprint)
  // must not stay behind, or the old title would read as "unchanged".
  const previousKey = keyById.get(record.id);
  if (previousKey && previousKey !== dedupeKey) byKey.delete(previousKey);
  byKey.delete(dedupeKey);
  if (byKey.size >= MAX) {
    const oldest = byKey.keys().next();
    if (!oldest.done) {
      const evicted = byKey.get(oldest.value);
      byKey.delete(oldest.value);
      if (evicted) keyById.delete(evicted.id);
    }
  }
  byKey.set(dedupeKey, record);
  keyById.set(record.id, dedupeKey);
}

export function forgetAllKnownNews(): void {
  byKey.clear();
  keyById.clear();
  loadedAtMs = 0;
}

/**
 * Fill from the table: the rows seen most recently, which are the ones the
 * feeds are about to re-send. One query, at startup and on an explicit
 * reload. Never throws; a failed load leaves the memory empty, and every
 * item then takes the database path until a batch fills it back in.
 */
export async function loadKnownNews(): Promise<number> {
  try {
    dbAccess("startup_restore", { what: "known_news" });
    const rows = await db
      .select({
        id: newsItems.id,
        dedupeKey: newsItems.dedupeKey,
        title: newsItems.title,
        link: newsItems.link,
        pubDate: newsItems.pubDate,
        pubDateMs: newsItems.pubDateMs,
        playerName: newsItems.playerName,
        image: newsItems.image,
        teamAbbr: newsItems.teamAbbr,
        sourceType: newsItems.sourceType,
        authorHandle: newsItems.authorHandle,
        source: newsItems.source,
      })
      .from(newsItems)
      .orderBy(desc(newsItems.lastSeenAt))
      .limit(MAX);
    forgetAllKnownNews();
    // Oldest first, so the most recently seen rows are the last to be evicted.
    for (const row of [...rows].reverse()) {
      rememberNews(row.dedupeKey, {
        id: row.id,
        fingerprint: fingerprintNews(row),
        pubDateMs: row.pubDateMs,
        source: row.source,
      });
    }
    loadedAtMs = Date.now();
    return rows.length;
  } catch (err) {
    logger.warn({ err }, "known news could not be loaded; the next ingest verifies against the database");
    return 0;
  }
}

/** For /api/status. */
export function knownNewsStatus(): { keys: number; loadedAt: string | null } {
  return { keys: byKey.size, loadedAt: loadedAtMs ? new Date(loadedAtMs).toISOString() : null };
}
