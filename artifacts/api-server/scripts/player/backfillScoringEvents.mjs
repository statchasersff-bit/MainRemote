/**
 * Add the scoring events the game logs used to drop, in place.
 *
 *   node scripts/player/backfillScoringEvents.mjs [season ...] [--dry]
 *
 * Audit WEB-036 (2026-11-18): career totals did not reconcile with the stat
 * columns printed beside them. The stored per-game total (Sleeper's pts_ppr)
 * was right; the log had dropped the events behind the difference - two-point
 * conversions, a non-QB's trick-play pass, return and fumble-recovery TDs.
 *
 * This fetches each week from Sleeper and adds ONLY those fields (and Sleeper's
 * Standard total, pts_std) to entries that already exist. It never changes a
 * stored total, a team, a week or any other field. Where Sleeper's current
 * pts_ppr differs from the stored one (a later stat correction) it reports the
 * entry and leaves it alone.
 *
 * After it runs, scripts/player/checkScoringReconciliation.mjs lists every
 * entry whose stored total still differs from its stat line.
 */

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./paths.mjs";

const LOGS = path.join(DATA_DIR, "game_logs");
const BASE = process.env.SC_SLEEPER_STATS_BASE?.trim() || "https://api.sleeper.com/stats/nfl";
const EVENT_KEYS = ["pass_2pt", "rush_2pt", "rec_2pt", "st_td", "fum_rec_td"];
// Not house-rule scoring, but Sleeper's stored totals count them (+1 each):
// kept so the reconciliation check can name the residual instead of guessing.
const INFO_KEYS = ["st_fum_rec", "idp_ff"];
const REC_KEYS = ["rec_tgt", "rec", "rec_yd", "rec_td"];
const PASS_KEYS = ["pass_att", "pass_cmp", "pass_yd", "pass_td", "pass_int"];
const dry = process.argv.includes("--dry");
const seasons = process.argv.slice(2).filter((a) => /^\d{4}$/.test(a)).map(Number);
const all = fs.readdirSync(LOGS).map((f) => Number(f.replace(".json", ""))).filter(Boolean).sort();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function week(season, wk) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${BASE}/${season}/${wk}?season_type=regular`, {
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) return await res.json();
      console.warn(`  ${season} wk ${wk}: HTTP ${res.status}`);
    } catch (err) {
      console.warn(`  ${season} wk ${wk}: ${err.message}`);
    }
    await sleep(2000 * (attempt + 1));
  }
  return null;
}

for (const season of seasons.length ? seasons : all) {
  const file = path.join(LOGS, `${season}.json`);
  if (!fs.existsSync(file)) continue;
  const logs = JSON.parse(fs.readFileSync(file, "utf8"));
  const weeks = new Set();
  for (const games of Object.values(logs)) for (const g of games) weeks.add(g.week);
  let added = 0;
  let changed = 0;
  const corrections = [];
  const failed = [];
  for (const wk of [...weeks].sort((a, b) => a - b)) {
    const rows = await week(season, wk);
    await sleep(400);
    if (!Array.isArray(rows)) {
      failed.push(wk);
      continue;
    }
    const byId = new Map(rows.map((r) => [String(r.player_id), r.stats ?? {}]));
    for (const [pid, games] of Object.entries(logs)) {
      const g = games.find((x) => x.week === wk);
      if (!g) continue;
      const s = byId.get(pid);
      if (!s) continue;
      const st = g.stats;
      let touched = false;
      for (const key of EVENT_KEYS) {
        if (s[key] && st[key] !== s[key]) {
          st[key] = s[key];
          added++;
          touched = true;
        }
      }
      for (const key of INFO_KEYS) {
        if (s[key] && st[key] !== s[key]) {
          st[key] = s[key];
          touched = true;
        }
      }
      // A quarterback who caught a pass keeps his receiving line.
      if (st.rec == null && (s.rec || s.rec_yd || s.rec_td)) {
        for (const key of REC_KEYS) st[key] = s[key] || 0;
        added++;
        touched = true;
      }
      if (s.pts_std != null && st.pts_std !== s.pts_std) {
        st.pts_std = s.pts_std;
        touched = true;
      }
      if (st.pass_att == null && (s.pass_att || s.pass_yd || s.pass_td || s.pass_int)) {
        for (const key of PASS_KEYS) st[key] = s[key] || 0;
        added++;
        touched = true;
      }
      if (touched) changed++;
      if (s.pts_ppr != null && Math.abs(s.pts_ppr - st.pts_ppr) > 0.005) {
        corrections.push(`${pid} wk ${wk}: stored ${st.pts_ppr}, Sleeper now ${s.pts_ppr}`);
      }
    }
  }
  console.log(
    `${season}: ${changed} entries updated, ${added} scoring events added` +
      (failed.length ? `, weeks NOT fetched: ${failed.join(",")}` : "") +
      (corrections.length ? `, ${corrections.length} later Sleeper corrections left alone` : ""),
  );
  for (const c of corrections.slice(0, 10)) console.log(`   ${c}`);
  if (!dry && changed > 0) fs.writeFileSync(file, JSON.stringify(logs));
}
