/**
 * The depth-charts plugin's last push, kept where a publish cannot reach it.
 *
 * WordPress refreshes the depth charts (FantasyPros, Footballguys, ESPN) and
 * POSTs the result to /api/depth-charts/ingest, which writes
 * data/depth-charts/statchasers/depth-charts.json for the team hub's Depth
 * Chart tab. That file is on the VM's own disk and every publish ships the
 * committed snapshot over it, so the push is also kept here: one row per
 * season holds the whole document, and the server puts it back when it is
 * newer than the file (lib/team/depth-charts.ts).
 */

import { pgTable, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

export const depthCharts = pgTable("depth_charts", {
  season: integer("season").primaryKey(),
  doc: jsonb("doc").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DepthChartsRow = typeof depthCharts.$inferSelect;
