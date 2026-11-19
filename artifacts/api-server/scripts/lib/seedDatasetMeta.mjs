/**
 * One-off: seed data/dataset-meta.json for files built before it existed.
 *
 *   node scripts/lib/seedDatasetMeta.mjs <commit-before-backfill>
 *
 * lastIngestedAt for each game-log season is the time of the last commit that
 * changed its file at or before <commit> (Replit commits the worktree after
 * each data refresh), marked with that provenance. It never claims a fetch
 * happened later than the evidence shows.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { updateMeta } from "./dataset-meta.mjs";
import { coverage } from "../player-stats/coverage.mjs";

const ref = process.argv[2];
if (!ref) throw new Error("usage: seedDatasetMeta.mjs <commit>");
const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const LOGS = path.join(APP, "data", "player", "game_logs");
for (const f of fs.readdirSync(LOGS).filter((f) => /^\d{4}\.json$/.test(f))) {
  const season = Number(f.slice(0, 4));
  const rel = path.relative(execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: APP }).toString().trim(), path.join(LOGS, f));
  const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: APP }).toString().trim();
  const out = execFileSync("git", ["log", "-1", "--format=%cI %h", ref, "--", rel], { cwd: top }).toString().trim();
  if (!out) continue;
  const [when, sha] = out.split(" ");
  const logs = JSON.parse(fs.readFileSync(path.join(LOGS, f), "utf8"));
  const present = new Set();
  for (const rows of Object.values(logs)) for (const r of rows) if (r.team) present.add(`${r.week}:${r.team}`);
  let cov = null;
  try { cov = coverage(season, present); } catch { cov = null; }
  updateMeta("game_logs", season, {
    source: "Sleeper weekly stats (api.sleeper.com/stats/nfl)",
    lastIngestedAt: new Date(when).toISOString().replace(/\.\d+Z$/, "Z"),
    lastAggregatedAt: new Date(when).toISOString().replace(/\.\d+Z$/, "Z"),
    latestCompletedGame: cov?.latestIncludedGame ?? null,
    throughWeek: cov?.throughWeek ?? null,
    complete: cov ? cov.complete : null,
    missingGames: cov ? cov.missing : null,
    provenance: `seeded from git history: last commit changing the file at or before ${ref} (${sha})`,
  });
  console.log(season, when, sha, cov ? `${cov.gamesIncluded}/${cov.gamesFinal}` : "no slate");
}
