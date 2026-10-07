/**
 * Which picture Sleeper currently has for each player, as a content version.
 *
 * The news cards and the team and player pages load headshots from this
 * server at /news-image/player/<id>/<version>/<size>.webp, cached by browsers
 * and Cloudflare for a year. That is only safe because the version is in the
 * URL: when Sleeper replaces a photo the version changes and so does the URL.
 * The version is derived from the image bytes when a photo is first fetched,
 * so the renderer needs it BEFORE any request for the image - and it needs it
 * after a redeploy, when the deployment's own disk (and the resized copies on
 * it) have been replaced. Hence a table: one row per player id, kept where a
 * publish cannot reach it (lib/image-versions.ts).
 *
 * `version` is null for a player Sleeper has no photo for, so the renderer
 * draws its fallback mark instead of an <img> that will 404.
 */

import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const playerImageVersions = pgTable("player_image_versions", {
  playerId: text("player_id").primaryKey(),
  version: text("version"),
  sourceEtag: text("source_etag"),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlayerImageVersionRow = typeof playerImageVersions.$inferSelect;
