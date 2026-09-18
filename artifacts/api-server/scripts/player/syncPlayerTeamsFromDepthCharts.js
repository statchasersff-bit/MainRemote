/**
 * Refresh player team assignments in data/players.json from the depth-chart data
 * (data/depth_charts.json) that powers the statchasers.com fantasy depth-chart page.
 *
 * Only players appearing on a team's depth chart are updated; kickers are skipped.
 * Run with `--apply` to write changes; otherwise it's a dry run that only reports.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DATA_DIR as SC_DATA_DIR } from "./paths.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APPLY = process.argv.includes('--apply');

const dataDir = SC_DATA_DIR;
const playersPath = path.join(dataDir, 'players.json');
const depthPath = path.join(dataDir, 'depth_charts.json');

const players = JSON.parse(fs.readFileSync(playersPath, 'utf8'));
const depth = JSON.parse(fs.readFileSync(depthPath, 'utf8'));

const byId = new Map(players.map((p) => [String(p.id), p]));

// Build id -> team from depth charts, skipping kickers.
const assignment = new Map(); // sleeper_id -> team
let skippedKickers = 0;
for (const [team, roles] of Object.entries(depth.teams)) {
  for (const role of roles) {
    const isKicker = role.fantasy_position === 'K' || role.role === 'K' || role.role === 'PK';
    if (isKicker) {
      skippedKickers += role.players.filter((p) => p.sleeper_id).length;
      continue;
    }
    for (const p of role.players) {
      if (!p.sleeper_id) continue;
      // A player can be listed in multiple roles for one team; team is the same, so last-wins is fine.
      assignment.set(String(p.sleeper_id), team);
    }
  }
}

const teamChanges = [];
const statusChanges = [];
const missingFromPlayers = [];
let teamUnchanged = 0;

for (const [id, team] of assignment) {
  const player = byId.get(id);
  if (!player) {
    missingFromPlayers.push(id);
    continue;
  }
  if (player.team === team) {
    teamUnchanged++;
  } else {
    teamChanges.push({ id, name: player.name, position: player.position, from: player.team, to: team });
  }
  // On a current depth chart => on an active roster.
  if (player.status !== 'Active') {
    statusChanges.push({ id, name: player.name, position: player.position, from: player.status });
  }
}

console.log(`Depth-chart players considered (excl. kickers): ${assignment.size}`);
console.log(`Kicker depth-chart entries skipped: ${skippedKickers}`);
console.log(`Team already correct: ${teamUnchanged}`);
console.log(`Team changes: ${teamChanges.length}`);
console.log(`Status -> Active changes: ${statusChanges.length}`);
console.log(`On depth chart but not found in players.json (by id): ${missingFromPlayers.length}`);

if (teamChanges.length) {
  console.log('\n--- Team changes ---');
  for (const c of teamChanges.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`  ${c.name} (${c.position}): ${c.from} -> ${c.to}`);
  }
}

if (statusChanges.length) {
  console.log('\n--- Status -> Active ---');
  for (const c of statusChanges.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`  ${c.name} (${c.position}): ${c.from || 'null'} -> Active`);
  }
}

if (APPLY && (teamChanges.length || statusChanges.length)) {
  for (const c of teamChanges) byId.get(c.id).team = c.to;
  for (const c of statusChanges) byId.get(c.id).status = 'Active';
  fs.writeFileSync(playersPath, JSON.stringify(players, null, 2) + '\n');
  console.log(`\nApplied ${teamChanges.length} team + ${statusChanges.length} status updates to ${playersPath}`);
} else if (!APPLY) {
  console.log('\nDry run only. Re-run with --apply to write changes.');
}
