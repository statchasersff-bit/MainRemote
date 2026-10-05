/**
 * POST /api/depth-charts/ingest - the depth-charts plugin's push.
 *
 * WordPress runs the depth-chart refresh (this host cannot reach
 * statchasers.com) and sends the document it cached here afterwards, for the
 * team hub's Depth Chart tab. See lib/team/depth-charts.ts for where it lands.
 *
 * Mounted ahead of the app-wide express.json(), whose 100kb default is a
 * quarter of one refresh: the parser here is the only one that reads this
 * body. Guarded by INGEST_SECRET like every other write.
 */

import express, { Router, type IRouter } from "express";
import { requireIngestSecret } from "../lib/ingest-auth";
import { ingestDepthCharts, parseDepthChartsDoc } from "../lib/team/depth-charts";

const router: IRouter = Router();

router.post("/api/depth-charts/ingest", express.json({ limit: "5mb" }), (req, res) => {
  if (!requireIngestSecret(req, res)) return;
  const parsed = parseDepthChartsDoc(req.body);
  if ("error" in parsed) {
    res.status(400).json({ ok: false, error: parsed.error });
    return;
  }
  void (async () => {
    try {
      const result = await ingestDepthCharts(parsed.doc);
      req.log.info(result, "Depth charts push");
      res.json({ ok: true, ...result });
    } catch (err) {
      req.log.error({ err }, "Depth charts push failed");
      res.status(500).json({ ok: false, error: "could not store the push" });
    }
  })();
});

export default router;
