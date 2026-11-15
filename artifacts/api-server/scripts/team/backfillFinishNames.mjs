/**
 * Add each fantasy finish's full player name to data/team/coaching_<season>.json
 * without rebuilding anything else (mak, 2026-11-15: the phones' expanded
 * Fantasy Finishes rows show full names; the stored text keeps the surname).
 *
 *   node scripts/team/backfillFinishNames.mjs 2026 [--cache <dir>]
 *
 * For every finishes cell ("QB15 · Brady") it loads that season's nflverse
 * player layer with the builder's own seasonPlayers() (plus the week-window
 * layers of partial stops) and takes the club top scorer at that position
 * whose surname matches; the rank breaks a tie. Only `name` is added: no
 * rank, tone, text or other field changes. A cell with no unique match is
 * left without a name and listed at the end. buildCoaching.mjs writes
 * `name` itself from now on.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seasonPlayers, lastName, setCacheDir } from "./buildCoaching.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(here, "../../data");
const season = Number(process.argv[2]);
if (!season) throw new Error("usage: backfillFinishNames.mjs <season> [--cache <dir>]");
const at = process.argv.indexOf("--cache");
if (at > 0) setCacheDir(path.resolve(process.argv[at + 1]));

const file = path.join(DATA, "team", `coaching_${season}.json`);
const doc = JSON.parse(fs.readFileSync(file, "utf8"));
const staff = JSON.parse(fs.readFileSync(path.join(DATA, "team", `coaching_staff_${season}.json`), "utf8"));

const cellsByYear = new Map(); // year -> [{abbr, cell}]
for (const [abbr, t] of Object.entries(doc.teams)) {
  const rows = [...(t.finishes?.history ?? []), ...(t.finishes?.rows ?? [])];
  for (const row of rows) {
    const yr = row.current ? season : Number(row.stop.match(/(\d{4})$/)?.[1]);
    if (!yr) continue;
    for (const cell of row.cells) {
      if (!/^[A-Z]{2}\d+ · /.test(cell.text)) continue;
      if (!cellsByYear.has(yr)) cellsByYear.set(yr, []);
      // The club he called for that season: the tie-break when two clubs' top
      // scorers share a surname.
      const stop = row.current ? null : (staff.teams[abbr]?.callingStops ?? []).find((st) => !st.college && (st.seasons ?? []).includes(yr));
      const club = row.current ? abbr : stop ? String(stop.team).toLowerCase() : null;
      cellsByYear.get(yr).push({ abbr, cell, club });
    }
  }
}

// Week windows of partial stops, by season.
const windows = new Map();
for (const s of Object.values(staff.teams)) {
  for (const stop of s.callingStops ?? []) {
    if (stop.college || (stop.fromWeek == null && stop.toWeek == null) || (stop.seasons ?? []).length !== 1) continue;
    const yr = stop.seasons[0];
    if (!windows.has(yr)) windows.set(yr, []);
    windows.get(yr).push({ from: stop.fromWeek ?? 1, to: stop.toWeek ?? 30 });
  }
}

const misses = [];
let filled = 0;
for (const yr of [...cellsByYear.keys()].sort()) {
  console.log(`  player stats ${yr}…`);
  const layers = [await seasonPlayers(yr)];
  for (const w of windows.get(yr) ?? []) {
    console.log(`  player stats ${yr} (Wks ${w.from}-${w.to})…`);
    layers.push(await seasonPlayers(yr, w));
  }
  for (const { abbr, cell, club: own } of cellsByYear.get(yr)) {
    const m = cell.text.match(/^([A-Z]{2})(\d+) · (.+)$/);
    const [, pos, rank, surname] = m;
    const cands = new Map(); // name -> {rank matched?, his club?}
    for (const layer of layers) {
      for (const [code, club] of Object.entries(layer.teams)) {
        const top = club.top?.[pos];
        if (!top || lastName(top.name) !== surname) continue;
        const was = cands.get(top.name) ?? { rank: false, own: false };
        cands.set(top.name, { rank: was.rank || top.rank === Number(rank), own: was.own || code === own });
      }
    }
    const by = (f) => [...cands].filter(([, v]) => f(v)).map(([n]) => n);
    const pick = [by((v) => v.rank && v.own), by((v) => v.own), by((v) => v.rank), [...cands.keys()]].find((xs) => xs.length === 1)?.[0] ?? null;
    if (pick) {
      if (cell.name !== pick) filled++;
      cell.name = pick;
    } else misses.push(`${abbr} ${yr} ${cell.text} (${cands.size} candidates)`);
  }
}

fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(doc, null, 2)}\n`);
fs.renameSync(`${file}.tmp`, file);
console.log(`filled ${filled} names; ${misses.length} unmatched`);
for (const m of misses) console.log(`  unmatched: ${m}`);
