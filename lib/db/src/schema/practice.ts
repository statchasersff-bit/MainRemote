/**
 * The Injury tab's practice grid, kept where a publish cannot reach it.
 *
 * NFL.com only ever shows the latest injury report of the week, so a day's
 * practice participation exists only if it was read that evening. The reads
 * land in data/player/practice_reports/<season>.json on the deployment's own
 * disk, and every publish replaces that disk with the committed copy: in Week
 * 4 of 2026 the Wednesday and Thursday reads were wiped that way. One row per
 * season holds the whole document; the server merges it back into the file at
 * boot and saves the file here after every read (lib/player/practice-store.ts).
 */

import { pgTable, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

export const practiceReports = pgTable("practice_reports", {
  season: integer("season").primaryKey(),
  doc: jsonb("doc").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PracticeReportRow = typeof practiceReports.$inferSelect;
