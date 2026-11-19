import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { dataDirStatus } from "../lib/data-dir";
import { fpaSnapshotState } from "../lib/fpa/fpa-data";
import { playerRefreshStatus } from "../lib/player/live-refresh";
import { dataHealth } from "../lib/data-coverage";
import { getAvailableSeasons, getPlayerBySlug, loadGameLogs } from "../lib/player/data";
import { explainResidual, getFantasyPoints, providerPoints, unattributedScoring } from "../lib/player/scoring";
import { scoringTotalsSource } from "../lib/scoring/house-rules";

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
/** The daily chain runs at 11:00 UTC; this allows one late start. */
const DAILY_MAX_AGE_MS = 30 * 60 * 60 * 1000;
const PROCESS_STARTED_MS = Date.now();

/**
 * September through January: the weeks FPA and the nflverse steps are
 * expected to move. From March to August the advanced stats, handcuff stats
 * and ownership steps fail every day by design (docs/SEASON-ROLLOVER.md), and
 * a monitor paging on that all offseason would be ignored by September.
 */
function inSeason(nowMs: number): boolean {
  const month = new Date(nowMs).getUTCMonth();
  return month >= 8 || month === 0;
}

/**
 * GET /api/data/health - point an uptime monitor here.
 *
 * 503 with `reasons` when the data behind the tools has stopped moving, the
 * way /api/ingest/health already does for the news wire alone. Checks what
 * nothing else alerts on: the database answers, the shipped data directory is
 * there, the FPA table has been refreshed this week in season, and, where the
 * after-game refresh runs (production), the daily rebuild finished recently
 * with every step ok, and (Phase 1.1) the player data checks in
 * data-coverage.ts dataHealth(). /api/status is the human-readable detail.
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
      if (inSeason(nowMs)) {
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
    if (player.enabled && player.daily.enabled) {
      const finished = player.daily.lastFinished ? Date.parse(player.daily.lastFinished) : null;
      // Before a first run, measured from process start, so an instance that
      // never completes one alerts instead of looking healthy forever.
      if (nowMs - (finished ?? PROCESS_STARTED_MS) > DAILY_MAX_AGE_MS) {
        reasons.push("daily data rebuild has not finished in 30 hours");
      }
      const failed = player.daily.steps.filter((step) => !step.ok).map((step) => step.name);
      if (failed.length && inSeason(nowMs)) {
        reasons.push(`daily rebuild steps failed: ${failed.join(", ")}`);
      }
    }
    if (player.enabled && player.lastError) {
      reasons.push(`game-log refresh failing: ${player.lastError.slice(0, 200)}`);
    }

    // Player-data completeness and consistency (Phase 1.1, data-coverage.ts):
    // overdue missing final games, page vs stats-table mismatches, stale or
    // failed ingestion per data/dataset-meta.json, and current-season scores
    // the rules cannot account for. Its own try: a failure here is a reason,
    // not a 500.
    let players: { season: number; reasons: string[] } | null = null;
    try {
      const season = getAvailableSeasons()[0];
      if (season) {
        const verdict = dataHealth(season, nowMs, { unattributedScoring: unattributedScoring(season) });
        players = { season, reasons: verdict.reasons };
        reasons.push(...verdict.reasons);
      }
    } catch {
      reasons.push("player data checks failed to run");
    }

    res
      .status(reasons.length ? 503 : 200)
      .set("Cache-Control", "no-store")
      .json({
        ok: reasons.length === 0,
        reasons,
        fpaSnapshotAt,
        playerData: players,
        dailyRebuild: player.enabled && player.daily.enabled ? player.daily : null,
      });
  })();
});

/**
 * GET /api/scoring/audit?player=<slug>&season=<year> - every game's stored
 * provider (Sleeper) totals beside the house-rule totals, with the reason for
 * any difference (Phase 1 decision 1: the original provider totals stay
 * viewable). Diagnostic JSON: noindex, not linked from any page.
 */
router.get("/scoring/audit", (req, res) => {
  // Access (release gate, 2026-11-19): everything this returns is already on
  // the public player pages (per-game stats and totals), but it is a
  // diagnostic, not a product surface. In production it answers only with
  // SC_AUDIT_KEY (header x-sc-audit-key or ?key=), and 404s when no key is
  // configured. Only an explicit NODE_ENV=development (the preview) is open:
  // the deployment's start script sets no NODE_ENV, and this app treats
  // anything but "development" as production (app.ts, the SSR caches).
  const key = process.env["SC_AUDIT_KEY"]?.trim();
  const given = String(req.get("x-sc-audit-key") ?? req.query["key"] ?? "");
  if (key ? given !== key : process.env["NODE_ENV"] !== "development") {
    res.status(404).set("Cache-Control", "no-store").set("X-Robots-Tag", "noindex").json({ error: "not found" });
    return;
  }
  const slug = String(req.query["player"] ?? "").trim();
  const season = Number(req.query["season"]);
  const player = slug ? getPlayerBySlug(slug) : null;
  if (!player || !Number.isInteger(season)) {
    res.status(400).set("X-Robots-Tag", "noindex").json({ error: "player=<slug>&season=<year> required" });
    return;
  }
  const formats = ["ppr", "half", "standard"] as const;
  const games = (loadGameLogs(season)[player.id] ?? []).map((g) => {
    const s = g.stats;
    const byFormat = Object.fromEntries(
      formats.map((f) => {
        const provider = providerPoints(s, f);
        const house = getFantasyPoints(s, f);
        const diff = provider === null ? null : Math.round((provider - house) * 100) / 100;
        return [f, { provider, house, diff, reason: diff === null ? null : explainResidual(s, diff) }];
      }),
    );
    return { week: g.week, team: g.team, opp: g.opp, ...byFormat } as Record<string, unknown>;
  });
  const sum = (f: (typeof formats)[number], k: "provider" | "house") =>
    Math.round(games.reduce((n: number, g) => n + ((g[f] as { provider: number | null; house: number })[k] ?? 0), 0) * 100) / 100;
  res
    .set("Cache-Control", "no-store")
    .set("X-Robots-Tag", "noindex")
    .json({
      player: { slug: player.slug, name: player.name, position: player.position },
      season,
      displayed: scoringTotalsSource(),
      totals: Object.fromEntries(formats.map((f) => [f, { provider: sum(f, "provider"), house: sum(f, "house") }])),
      games,
    });
});

export default router;
