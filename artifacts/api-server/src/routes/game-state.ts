/**
 * GET /api/game-state/:gameId - one game's live state, for an open matchup
 * tab (WEB-040, 2026-11-24).
 *
 * The page a reader has open was rendered with a GameStateRecord in its strip
 * (lib/matchup/game-state-render.ts). While the game can change, the browser
 * asks here for the same record and redraws the strip from it, so a preview
 * opened before kickoff turns live and then final without a reload and
 * without WordPress re-rendering the page for every score. The record comes
 * from the same slate row the schedule prints, already held in memory: no
 * upstream request is made for it, whatever the polling rate.
 *
 * Public on purpose (not /embed/, which the embed key locks to WordPress):
 * the reader's browser calls it cross-origin from statchasers.com. It holds
 * nothing the page does not already print.
 */

import { Router, type IRouter } from "express";
import { getPostseason, getSeasonSlate, type PostseasonGame } from "../lib/schedule/schedule-data";
import { getGameBoxscore } from "../lib/matchup/boxscore";
import { gameStateRecord, pollPlan, type GameStateRecord } from "../lib/matchup/game-state";
import { logger } from "../lib/logger";
import { requireIngestSecret } from "../lib/ingest-auth";
import { recentGameEvents } from "../lib/schedule/game-events";

const router: IRouter = Router();

/** nflverse's id shape: 2026_11_IND_HOU. Anything else is not a game. */
const GAME_ID = /^(\d{4})_(\d{2})_([A-Z]{2,3})_([A-Z]{2,3})$/;

export async function loadGameStateById(gameId: string, nowMs = Date.now()): Promise<GameStateRecord | null> {
  const m = GAME_ID.exec(gameId);
  if (!m) return null;
  const season = Number(m[1]);
  const slate = await getSeasonSlate(season, nowMs);
  const row = slate?.games.find((g) => g.id === gameId);
  if (row) {
    const final = row.status === "final";
    const box = final ? await getGameBoxscore(row.espnId).catch(() => null) : null;
    return gameStateRecord(row, {
      season,
      seasonType: "regular",
      sourceUpdatedAtMs: slate?.updatedAtMs ?? null,
      detailsReady: final ? box !== null : null,
    });
  }
  const rounds: PostseasonGame[] = await getPostseason(season).catch(() => []);
  const post = rounds.find((g) => g.id === gameId);
  if (!post) return null;
  const final = post.status === "final";
  const box = final ? await getGameBoxscore(post.espnId).catch(() => null) : null;
  return gameStateRecord(post, { season, seasonType: "post", detailsReady: final ? box !== null : null });
}

router.get("/game-state/:gameId", (req, res) => {
  void (async () => {
    const gameId = String(req.params.gameId ?? "").toUpperCase();
    try {
      const now = Date.now();
      const record = await loadGameStateById(gameId, now);
      if (!record) {
        res.status(404).set("Cache-Control", "public, max-age=300").json({ ok: false, error: "unknown game" });
        return;
      }
      const poll = pollPlan(record, now);
      // Short while the game can change; the client's own interval is the
      // other half. A shared cache in front of this may hold it as long.
      const maxAge = poll.active && poll.everyMs <= 30_000 ? 15 : poll.active ? 60 : 300;
      res
        .set("Cache-Control", `public, max-age=${maxAge}`)
        .json({ ok: true, game: record, poll, serverTimeMs: now });
    } catch (err) {
      logger.warn({ err, gameId }, "game state lookup failed");
      res.status(503).set("Cache-Control", "no-store").json({ ok: false, error: "unavailable" });
    }
  })();
});

/**
 * GET /api/game-events - the status changes this process has seen and the
 * pages each one named for purging (lib/schedule/game-events.ts). Internal:
 * behind the ingest secret like every other diagnostic write-side view.
 */
router.get("/game-events", (req, res) => {
  if (!requireIngestSecret(req, res)) return;
  res.set("Cache-Control", "no-store").json({ ok: true, events: recentGameEvents() });
});

export default router;
