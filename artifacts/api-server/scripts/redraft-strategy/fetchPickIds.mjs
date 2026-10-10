/**
 * Resolve each draft example pick to its Sleeper player id.
 *
 *   node scripts/redraft-strategy/fetchPickIds.mjs
 *
 * The app's packed boards (data/redraft-strategy/boards.json) name each pick
 * but carry no player id - its WordPress build dropped the field - so the
 * board could show no headshot. The draft ids are known, and Sleeper's
 * /v1/draft/<id>/picks lists every pick with its player_id, so this asks once
 * per board and writes data/redraft-strategy/pick-ids.json, keyed by draft id
 * and then "round-slot". buildData.mjs merges it into boards.json; the file
 * is committed and only needs re-running when the boards change.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(HERE, "..", "..", "data", "redraft-strategy");
const boards = JSON.parse(fs.readFileSync(path.join(DIR, "boards.json"), "utf8"));
const out = {};
for (const b of boards) {
  const res = await fetch(`https://api.sleeper.app/v1/draft/${b.draft_id}/picks`);
  if (!res.ok) throw new Error(`draft ${b.draft_id}: HTTP ${res.status}`);
  const picks = await res.json();
  const ids = {};
  for (const p of picks) if (p.player_id) ids[`${p.round}-${p.draft_slot}`] = String(p.player_id);
  out[b.draft_id] = ids;
  const missing = b.picks.filter((p) => !ids[`${p.round}-${p.slot}`]).length;
  console.log(`${b.draft_id} ${b.label}: ${Object.keys(ids).length} ids, ${missing} picks unresolved`);
}
fs.writeFileSync(path.join(DIR, "pick-ids.json"), `${JSON.stringify(out)}\n`);
console.log("wrote pick-ids.json");
