/**
 * Does every stored per-game total reconcile with its stat line?
 *
 *   node scripts/player/checkScoringReconciliation.mjs [season ...] [--player <id>] [--json]
 *
 * Scores each game-log entry under the house rules (scripts/scoring/
 * house-rules.mjs, the mirror of src/lib/scoring/house-rules.ts) and compares
 * it with the stored PPR total. A difference is reported with its likely
 * cause, never patched: the stored total is what the pages print, and a
 * residual is a scoring event the log cannot see. Exit code 1 when the newest
 * season has an unexplained difference, so the weekly chain can stop on it.
 */

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./paths.mjs";
import { scoreGameLogStats } from "../scoring/house-rules.mjs";

const LOGS = path.join(DATA_DIR, "game_logs");
const args = process.argv.slice(2);
const only = args.includes("--player") ? args[args.indexOf("--player") + 1] : null;
const asJson = args.includes("--json");
const seasons = args.filter((a, i) => /^\d{4}$/.test(a) && args[i - 1] !== "--player").map(Number);
const all = fs.readdirSync(LOGS).map((f) => Number(f.replace(".json", ""))).filter(Boolean).sort();
const list = seasons.length ? seasons : all;
const newest = Math.max(...all);

/** The most likely reading of a residual, for the report. */
function explain(stats, resid) {
  // Sleeper's pre-2022 totals charge -1 for EVERY fumble on top of -2 for a
  // lost one. Not a house rule; left as stored (see the report).
  const info = (stats.st_fum_rec ?? 0) + (stats.idp_ff ?? 0);
  if (info > 0 && Math.abs(resid - info) < 0.01) return "upstream +1 per special-teams fumble recovery / forced fumble (not a house rule)";
  const fum = stats.fum ?? 0;
  if (fum > 0 && Math.abs(resid + fum) < 0.01) return "upstream charged an extra -1 per fumble (pre-2022 Sleeper setting)";
  if (Math.abs(resid - Math.round(resid / 2) * 2) < 0.01) return "2-pt conversion(s) or other event not in the log";
  return "unexplained";
}

const out = [];
for (const season of list) {
  const logs = JSON.parse(fs.readFileSync(path.join(LOGS, `${season}.json`), "utf8"));
  for (const [pid, games] of Object.entries(logs)) {
    if (only && pid !== only) continue;
    for (const g of games) {
      const s = g.stats;
      if (s.pts_ppr == null) continue;
      // Kickers are scored by distance upstream; the flat 3/1 rule is a
      // display approximation (see the report), so they are not checked here.
      if (s.fga != null || s.xpa != null) continue;
      const resid = Math.round((s.pts_ppr - scoreGameLogStats(s, "ppr")) * 100) / 100;
      if (Math.abs(resid) < 0.05) continue;
      out.push({ season, playerId: pid, week: g.week, stored: s.pts_ppr, residual: resid, cause: explain(s, resid) });
    }
  }
}

if (asJson) console.log(JSON.stringify(out, null, 1));
else {
  const bySeason = new Map();
  for (const r of out) {
    const k = `${r.season} ${r.cause}`;
    bySeason.set(k, (bySeason.get(k) ?? 0) + 1);
  }
  for (const [k, v] of [...bySeason].sort()) console.log(`${k}: ${v} entries`);
  if (only) for (const r of out) console.log(`  ${r.season} wk ${r.week}: stored ${r.stored}, residual ${r.residual} (${r.cause})`);
}
const bad = out.filter((r) => r.season === newest && r.cause === "unexplained");
if (bad.length && !only) {
  console.error(`${newest}: ${bad.length} entries do not reconcile and have no known cause`);
  process.exitCode = 1;
}
