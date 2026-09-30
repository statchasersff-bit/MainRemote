import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { dataDirStatus } from "../lib/data-dir";
import { fpaSnapshotState } from "../lib/fpa/fpa-data";
import { playerRefreshStatus } from "../lib/player/live-refresh";

const router: IRouter = Router();

/**
 * The platform's liveness probe. Deliberately says nothing about data: failing
 * it has Replit restart a healthy process, which fixes no stale table. The
 * data checks are GET /api/data/health below.
 */
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

const DAY_MS = 24 * 60 * 60 * 1000;
/** FPA is a weekly ingest; a week and a day without one is a missed run. */
const FPA_MAX_AGE_MS = 8 * DAY_MS;
/** The daily chain runs at 14:00 UTC; this allows one late start. */
const DAILY_MAX_AGE_MS = 30 * 60 * 60 * 1000;
const PROCESS_STARTED_MS = Date.now();

/** September through January: the weeks FPA is expected to move. */
function fpaInSeason(nowMs: number): boolean {
  const month = new Date(nowMs).getUTCMonth();
  return month >= 8 || month === 0;
}

/**
 * GET /api/data/health — point an uptime monitor here.
 *
 * 503 with `reasons` when the data behind the tools has stopped moving, the
 * way /api/ingest/health already does for the news wire alone. Checks what
 * nothing else alerts on: the database answers, the shipped data directory is
 * there, the FPA table has been refreshed this week in season, and, where the
 * after-game refresh runs (production), the daily rebuild finished recently
 * with every step ok. /api/status is the human-readable detail behind it.
 */
router.get("/data/health", (_req, res) => {
  void (async () => {
    const nowMs = Date.now();
    const reasons: string[] = [];

    const data = dataDirStatus();
    if (!data.players) reasons.push("player index missing from the data directory");
    if (!data.rankings) reasons.push("rankings missing from the data directory");

    let fpaSnapshotAt: string | null = null;
    try {
      const fpa = await fpaSnapshotState();
      fpaSnapshotAt = fpa.writtenAtMs === null ? null : new Date(fpa.writtenAtMs).toISOString();
      if (fpaInSeason(nowMs)) {
        if (fpa.writtenAtMs === null) {
          reasons.push(`no FPA snapshot for ${fpa.season}`);
        } else if (nowMs - fpa.writtenAtMs > FPA_MAX_AGE_MS) {
          reasons.push(`FPA snapshot is ${Math.floor((nowMs - fpa.writtenAtMs) / DAY_MS)} days old`);
        }
      }
    } catch {
      reasons.push("database unreachable");
    }

    const player = playerRefreshStatus();
    if (player.enabled) {
      const finished = player.daily.lastFinished ? Date.parse(player.daily.lastFinished) : null;
      // Before a first run, measured from process start, so an instance that
      // never completes one alerts instead of looking healthy forever.
      if (nowMs - (finished ?? PROCESS_STARTED_MS) > DAILY_MAX_AGE_MS) {
        reasons.push("daily data rebuild has not finished in 30 hours");
      }
      const failed = player.daily.steps.filter((step) => !step.ok).map((step) => step.name);
      if (failed.length) reasons.push(`daily rebuild steps failed: ${failed.join(", ")}`);
      if (player.lastError) reasons.push(`game-log refresh failing: ${player.lastError.slice(0, 200)}`);
    }

    res
      .status(reasons.length ? 503 : 200)
      .set("Cache-Control", "no-store")
      .json({
        ok: reasons.length === 0,
        reasons,
        fpaSnapshotAt,
        dailyRebuild: player.enabled ? player.daily : null,
      });
  })();
});

export default router;
