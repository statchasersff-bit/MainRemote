/**
 * Coordinated refresh of the Usage, Coaching and Stats (efficiency) files
 * (Team Pages Phase 2B, 2026-11-19; Stats joined in Phase 3).
 *
 *   node scripts/team/refreshTeamMetrics.mjs <season> [--cache <dir>]
 *
 * Both files report the shared team rates (team-rate-metrics.mjs) and a
 * "through Week N" label, and the hub prints them side by side, so they must
 * describe the same completed games. Run separately they need not: nflverse
 * posts a week's play-by-play while a builder is running, or one builder
 * fails and the other's new file goes out next to the old one.
 *
 * So this script:
 *   1. downloads the season's play-by-play, last season's (the coaching
 *      comparison) and the schedule ONCE into one cache directory;
 *   2. runs both builders against that cache, writing into a staging
 *      directory (`--out`), never into data/team;
 *   3. publishes only if both succeeded AND both files carry the same
 *      snapshot (season, completed-through week, data fingerprint);
 *   4. otherwise exits 1 and leaves the live files exactly as they were.
 *
 * A builder that refuses (fewer weeks than the file on disk, a short feed)
 * fails this script too, which is the point: neither file moves alone.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { NFLDATA_GAMES, NFLVERSE_PBP } from "./team-rate-metrics.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(here, "..", "..", "data", "team");

async function download(url, dir) {
  const file = path.join(dir, path.basename(url));
  if (fs.existsSync(file)) return file;
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(5 * 60_000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  fs.writeFileSync(`${file}.part`, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(`${file}.part`, file);
  return file;
}

function run(script, args) {
  const r = spawnSync(process.execPath, [path.join(here, script), ...args], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${script} exited ${r.status}`);
}

/** Null when the two snapshots describe the same games; otherwise the field that differs. */
export function snapshotMismatch(u, c) {
  if (!u || !c) return "missing snapshot";
  for (const k of ["season", "throughWeek", "fingerprint", "definitions"]) if (u[k] !== c[k]) return k;
  return null;
}

export async function refreshTeamMetrics(season, cacheArg = null) {
  const cache = cacheArg ?? fs.mkdtempSync(path.join(os.tmpdir(), "team-metrics-cache-"));
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "team-metrics-stage-"));
  try {
    for (const url of [NFLVERSE_PBP(season), NFLVERSE_PBP(season - 1), NFLDATA_GAMES]) await download(url, cache);
    run("buildUsage.mjs", [String(season), "--cache", cache, "--out", stage]);
    run("buildCoaching.mjs", [String(season), "--cache", cache, "--out", stage, "--force", "all"]);
    // The Stats tab's file joins them (Team Pages Phase 3, 2026-11-19): same
    // cutoff, same games, published together or not at all.
    run("buildEfficiency.mjs", [String(season), "--cache", cache, "--out", stage]);

    const usageFile = path.join(stage, `usage_${season}.json`);
    const coachingFile = path.join(stage, `coaching_${season}.json`);
    const u = JSON.parse(fs.readFileSync(usageFile, "utf8")).snapshot;
    const c = JSON.parse(fs.readFileSync(coachingFile, "utf8")).snapshot;
    const efficiencyFile = path.join(stage, `efficiency_${season}.json`);
    const ef = JSON.parse(fs.readFileSync(efficiencyFile, "utf8")).snapshot;
    const why = snapshotMismatch(u, c) ?? snapshotMismatch(u, ef);
    if (why) throw new Error(`snapshots disagree (${why}): usage ${JSON.stringify(u)} vs coaching ${JSON.stringify(c)}`);

    // Both staged and in agreement: move them in, each by rename within
    // data/team so a reader never sees a half-written file.
    for (const f of [usageFile, coachingFile, efficiencyFile]) {
      const dest = path.join(DATA, path.basename(f));
      fs.copyFileSync(f, `${dest}.tmp`);
      fs.renameSync(`${dest}.tmp`, dest);
    }
    console.log(`  team metrics ${season}: published usage + coaching + efficiency, through Week ${u.throughWeek} (${u.fingerprint})`);
    return u;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
    if (!cacheArg) fs.rmSync(cache, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const season = Number(process.argv[2]);
  if (!Number.isInteger(season)) {
    console.error("usage: node scripts/team/refreshTeamMetrics.mjs <season> [--cache <dir>]");
    process.exit(2);
  }
  const at = process.argv.indexOf("--cache");
  try {
    await refreshTeamMetrics(season, at > 0 ? path.resolve(process.argv[at + 1]) : null);
  } catch (err) {
    console.error(`  team metrics ${season}: NOT published - ${err.message}`);
    process.exit(1);
  }
}
