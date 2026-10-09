/**
 * Fantasy Points Allowed - how many fantasy points each defense gives up to
 * each position, per game.
 *
 * Two tables, and the split is the point of the design:
 *
 *   - `fantasy_points_allowed_games` is the granular record: one row per
 *     (season, week, defense, position, scoring format). It is what the
 *     numbers are DERIVED from, and it is kept so a served figure can be
 *     traced back to the weeks that produced it rather than taken on trust.
 *   - `fantasy_points_allowed_snapshots` is one row per (defense, format) -
 *     the blended figure the page actually serves. Precomputed because the
 *     blend is a weighted mix of last season and a rolling window of this one,
 *     and recomputing that per request would put a 7MB CSV parse in front of
 *     TTFB.
 *
 * Money-typed columns are `numeric`, not `double precision`: these are figures
 * the page prints to one decimal and a reader may reconcile against another
 * site, so they round once at write time and never drift afterwards.
 */

import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  timestamp,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/** One (season, week, defense, position, format) grouping. */
export const fpaGames = pgTable(
  "fantasy_points_allowed_games",
  {
    id: serial("id").primaryKey(),
    season: integer("season").notNull(),
    week: integer("week").notNull(),
    defenseTeamAbbr: text("defense_team_abbr").notNull(),
    offenseTeamAbbr: text("offense_team_abbr").notNull(),
    /** QB, RB, WR or TE. */
    position: text("position").notNull(),
    /** standard, half or ppr. */
    scoringFormat: text("scoring_format").notNull(),
    fantasyPoints: numeric("fantasy_points", { precision: 8, scale: 2 }).notNull(),
    gamesCount: integer("games_count").notNull().default(1),
    /** True for the prior season's rows, which seed the preseason baseline. */
    isBaseline: boolean("is_baseline").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("fpa_games_defense_season_idx").on(t.defenseTeamAbbr, t.season),
    index("fpa_games_season_week_idx").on(t.season, t.week),
  ],
);

/** The served figure: one row per defense per scoring format. */
export const fpaSnapshots = pgTable(
  "fantasy_points_allowed_snapshots",
  {
    id: serial("id").primaryKey(),
    season: integer("season").notNull(),
    /** Weeks of the current season played. Null means preseason. */
    weekNumber: integer("week_number"),
    defenseTeamAbbr: text("defense_team_abbr").notNull(),
    defenseTeamName: text("defense_team_name").notNull(),
    scoringFormat: text("scoring_format").notNull(),

    /** Points allowed per game, as measured. */
    qbFpaRaw: numeric("qb_fpa_raw", { precision: 8, scale: 2 }).notNull(),
    rbFpaRaw: numeric("rb_fpa_raw", { precision: 8, scale: 2 }).notNull(),
    wrFpaRaw: numeric("wr_fpa_raw", { precision: 8, scale: 2 }).notNull(),
    teFpaRaw: numeric("te_fpa_raw", { precision: 8, scale: 2 }).notNull(),
    offFpaRaw: numeric("off_fpa_raw", { precision: 8, scale: 2 }).notNull(),

    /** The same, corrected for the strength of the offenses faced. */
    qbFpaAdj: numeric("qb_fpa_adj", { precision: 8, scale: 2 }).notNull(),
    rbFpaAdj: numeric("rb_fpa_adj", { precision: 8, scale: 2 }).notNull(),
    wrFpaAdj: numeric("wr_fpa_adj", { precision: 8, scale: 2 }).notNull(),
    teFpaAdj: numeric("te_fpa_adj", { precision: 8, scale: 2 }).notNull(),
    offFpaAdj: numeric("off_fpa_adj", { precision: 8, scale: 2 }).notNull(),

    gamesPlayed: integer("games_played").notNull(),
    /** e.g. "preseason_baseline", "week_3" - what the blend was. */
    dataMode: text("data_mode").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("fpa_snapshots_season_format_idx").on(t.season, t.scoringFormat)],
);

export const insertFpaGameSchema = createInsertSchema(fpaGames).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertFpaSnapshotSchema = createInsertSchema(fpaSnapshots).omit({
  id: true,
  createdAt: true,
});

export type InsertFpaGame = z.infer<typeof insertFpaGameSchema>;
export type FpaGame = typeof fpaGames.$inferSelect;
export type InsertFpaSnapshot = z.infer<typeof insertFpaSnapshotSchema>;
export type FpaSnapshot = typeof fpaSnapshots.$inferSelect;
