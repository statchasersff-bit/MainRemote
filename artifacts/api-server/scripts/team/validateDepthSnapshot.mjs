#!/usr/bin/env node
/**
 * Validate a depth-chart snapshot BEFORE it replaces the committed one
 * (Team Pages release 2026-11-20). Manual only: nothing schedules this.
 *
 *   node scripts/team/validateDepthSnapshot.mjs <candidate.json> [--sleeper <players_nfl.json>]
 *
 * Fails (exit 1) when the candidate is not a complete 32-club document, is
 * older than the committed snapshot, or has a club with an empty QB/RB/WR/TE
 * column. Prints, for the reviewer: every QB/RB/WR/TE top-3 change against
 * the committed snapshot, and (with --sleeper, a saved copy of Sleeper's
 * /v1/players/nfl) every listed skill player Sleeper puts on another club.
 * It writes nothing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const COMMITTED = path.join(here, "..", "..", "data", "depth-charts", "statchasers", "depth-charts.json");
const args = process.argv.slice(2);
const candidatePath = args[0];
const sleeperPath = args.includes("--sleeper") ? args[args.indexOf("--sleeper") + 1] : null;
if (!candidatePath) {
  console.error("usage: node scripts/team/validateDepthSnapshot.mjs <candidate.json> [--sleeper <players_nfl.json>]");
  process.exit(2);
}
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const cand = read(candidatePath);
const cur = fs.existsSync(COMMITTED) ? read(COMMITTED) : null;
const fail = [];
const SKILL = ["QB", "RB", "WR", "TE"];

if (!Array.isArray(cand.teams) || cand.teams.length !== 32) fail.push(`expected 32 teams, found ${cand.teams?.length ?? 0}`);
const when = Date.parse(cand.fetchedAt ?? "");
if (!Number.isFinite(when)) fail.push("no fetchedAt");
if (cur && Number.isFinite(when) && when <= Date.parse(cur.fetchedAt ?? "")) fail.push(`not newer than the committed snapshot (${cand.fetchedAt} vs ${cur.fetchedAt})`);
const abbrs = new Set();
for (const t of cand.teams ?? []) {
  const ab = t?.team?.abbr;
  if (!ab) { fail.push("a team without team.abbr"); continue; }
  if (abbrs.has(ab)) fail.push(`${ab} twice`);
  abbrs.add(ab);
  for (const pos of SKILL) if (!(t.positions?.[pos] ?? []).length) fail.push(`${ab}: empty ${pos} column`);
}

const key = (n) => n.replace(/\s*\([^)]*\)\s*$/, "").toLowerCase().replace(/[.']/g, "").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/[^a-z]/g, "");
console.log(`candidate ${cand.fetchedAt}, committed ${cur?.fetchedAt ?? "(none)"}`);
if (cur) {
  const before = new Map(cur.teams.map((t) => [t.team.abbr, t]));
  let changes = 0;
  for (const t of cand.teams ?? []) {
    const b = before.get(t.team?.abbr);
    if (!b) continue;
    for (const pos of SKILL) {
      const x = (b.positions?.[pos] ?? []).slice(0, 3).map((p) => p.name);
      const y = (t.positions?.[pos] ?? []).slice(0, 3).map((p) => p.name);
      if (x.join("|") !== y.join("|")) {
        changes++;
        console.log(`  change ${t.team.abbr} ${pos}: ${x.join(", ")} -> ${y.join(", ")}`);
      }
    }
  }
  console.log(`${changes} QB/RB/WR/TE top-3 changes`);
}
if (sleeperPath) {
  const sl = read(sleeperPath);
  const by = new Map();
  for (const p of Object.values(sl)) if (p?.full_name) by.set(key(p.full_name), [...(by.get(key(p.full_name)) ?? []), p]);
  let off = 0;
  for (const t of cand.teams ?? []) {
    for (const pos of SKILL) {
      for (const pl of t.positions?.[pos] ?? []) {
        const c = by.get(key(pl.name));
        if (!c) continue;
        const teams = new Set(c.map((p) => (p.team === "LA" ? "LAR" : p.team) ?? "FA"));
        if (!teams.has(t.team.abbr)) {
          off++;
          console.log(`  team? ${t.team.abbr} ${pos} ${pl.name}: Sleeper ${[...teams].join("/")}`);
        }
      }
    }
  }
  console.log(`${off} listed skill players on another club (or none) at Sleeper`);
}
if (fail.length) {
  console.error(`INVALID:\n  ${fail.join("\n  ")}`);
  process.exit(1);
}
console.log("valid: 32 clubs, newer than the committed snapshot, every skill column filled");
