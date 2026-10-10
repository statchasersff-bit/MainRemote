/**
 * Pack the redraft strategy analyzer's data for this app.
 *
 *   node scripts/redraft-strategy/buildData.mjs <path to the app's data dir>
 *
 * The source is the standalone app's output
 * (statchasersff-bit/RESEARCH-Redraft-Draft-Analysis, either `data/output/` or
 * the `artifacts/stat-chasers/public/data/` copy its `prepare:public` step
 * writes - this script reads the four files both hold). It is 19 MB of JSON,
 * most of it sections the dashboard never shows (per-slot breakdowns,
 * recommendations, miss risk, the "standard" scoring and "all" size combos).
 * What the dashboard reads is cut out and written under
 * data/redraft-strategy/, one file per filter combination, so a reader's
 * browser fetches the 20 KB its view needs and not the lot:
 *
 *   summary.json          the headline counts, and the overall table the
 *                         dashboard falls back to when a combo is missing
 *   combos/<key>.json     one league format + season: the strategy table, the
 *                         round value table, the first-two-pick and
 *                         first-five-round builds
 *   trends/<key>.json     one league format across every season: the
 *                         "2021-2025" comparison
 *   boards.json           the real draft examples, with each pick's overall
 *                         number worked out from its round and slot and its
 *                         Sleeper player id from pick-ids.json (written by
 *                         fetchPickIds.mjs), which is what the headshots key on
 *
 * Re-run it when the app's pipeline is re-run; the output is committed.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "..", "..", "data", "redraft-strategy");

const src = process.argv[2];
if (!src) {
  console.error("usage: node scripts/redraft-strategy/buildData.mjs <source data dir>");
  process.exit(1);
}

const read = (name) => JSON.parse(fs.readFileSync(path.join(src, name), "utf8"));

/** The filter bar's choices: everything else in the source is unreachable. */
const QB = ["one_qb", "superflex"];
const SCORING = ["ppr", "half_ppr"];
const TEP = ["no_tep", "tep"];
const SIZE = ["10", "12"];
const SEASONS = ["2021", "2022", "2023", "2024", "2025"];

const STRATEGY_FIELDS = [
  "strategy",
  "sample_size",
  "playoff_rate",
  "championship_rate",
  "top_3_pf_rate",
  "average_points_for",
  "playoff_rate_lift",
  "confidence_level",
];
const ROUND_FIELDS = ["strategy", "sample_size", "playoff_rate", "championship_rate", "top_3_pf_rate", "average_points_for"];

const pick = (row, fields) => Object.fromEntries(fields.filter((f) => row[f] !== undefined).map((f) => [f, row[f]]));
const rows = (list, fields) => (Array.isArray(list) ? list.map((r) => pick(r, fields)) : []);

function trimCombo(c) {
  return {
    label: c.label,
    sample_size: c.sample_size,
    league_count: c.league_count,
    baseline: {
      playoff_rate: c.baseline?.playoff_rate ?? null,
      championship_rate: c.baseline?.championship_rate ?? null,
      top_3_pf_rate: c.baseline?.top_3_pf_rate ?? null,
      average_points_for: c.baseline?.average_points_for ?? null,
    },
    best_strategies: rows(c.best_strategies, STRATEGY_FIELDS),
    worst_strategies: rows(c.worst_strategies, STRATEGY_FIELDS),
    best_first_two_pick_combos: rows(c.best_first_two_pick_combos, STRATEGY_FIELDS),
    best_first_five_builds: rows(c.best_first_five_builds, STRATEGY_FIELDS),
    round_value: {
      rounds: (c.round_value?.rounds ?? []).map((r) => ({ round: r.round, positions: rows(r.positions, ROUND_FIELDS) })),
    },
  };
}

/** The miss-rate columns are the only part of a trend the dashboard never reads. */
function trimTrend(t) {
  const strip = (row) => Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith("miss_rate")));
  const out = {};
  for (const [k, v] of Object.entries(t)) {
    if (k === "miss_risk" || k.startsWith("baseline_miss_rate")) continue;
    if (k === "overall_strategies" || k === "first_two_pick_combos") out[k] = v.map(strip);
    else out[k] = v;
  }
  return out;
}

const summary = read("redraft_strategy_summary.json");
const combosFile = read("redraft_by_filter_combo.json");
const trendsFile = read("redraft_by_filter_trends.json");
const boards = read("redraft_draft_boards.json");

for (const rel of ["combos", "trends", "summary.json", "boards.json"]) fs.rmSync(path.join(OUT, rel), { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "combos"), { recursive: true });
fs.mkdirSync(path.join(OUT, "trends"), { recursive: true });

const write = (rel, value) => fs.writeFileSync(path.join(OUT, rel), `${JSON.stringify(value)}\n`);

write("summary.json", {
  generated_at: summary.generated_at,
  seasons: summary.seasons_included,
  total_leagues: summary.total_leagues_analyzed,
  total_teams: summary.total_teams_analyzed,
  baseline: summary.baseline,
  best_overall_strategies: rows(summary.best_overall_strategies, STRATEGY_FIELDS),
  worst_overall_strategies: rows(summary.worst_overall_strategies, STRATEGY_FIELDS),
});

let nCombos = 0;
let missing = [];
for (const qb of QB)
  for (const scoring of SCORING)
    for (const tep of TEP)
      for (const size of SIZE)
        for (const season of SEASONS) {
          const key = `${qb}__${scoring}__${tep}__${size}__${season}`;
          const combo = combosFile.combos[key];
          if (!combo) {
            missing.push(key);
            continue;
          }
          write(`combos/${key}.json`, trimCombo(combo));
          nCombos += 1;
        }

let nTrends = 0;
for (const qb of QB)
  for (const scoring of SCORING)
    for (const tep of TEP)
      for (const size of SIZE) {
        const key = `${qb}__${scoring}__${tep}__${size}`;
        const trend = trendsFile.trends[key];
        if (!trend) {
          missing.push(key);
          continue;
        }
        write(`trends/${key}.json`, trimTrend(trend));
        nTrends += 1;
      }

// The app's API numbered each pick (pick_no) from the raw draft; its WordPress
// build dropped that field, and its board then printed "NaN" pick labels and
// no positional ranks. A snake draft's overall number follows from the round
// and slot, so it is restored here. The player ids it dropped too come from
// pick-ids.json when fetchPickIds.mjs has been run.
let pickIds = {};
try {
  pickIds = JSON.parse(fs.readFileSync(path.join(OUT, "pick-ids.json"), "utf8"));
} catch {
  console.warn("no pick-ids.json: the boards will carry no player ids (run fetchPickIds.mjs)");
}
const packedBoards = boards.map((b) => ({
  draft_id: b.draft_id,
  label: b.label,
  index: b.index,
  total: boards.length,
  num_teams: b.num_teams,
  num_rounds: b.num_rounds,
  strategies: b.strategies,
  picks: b.picks.map((p) => ({
    ...p,
    pick_no: (p.round - 1) * b.num_teams + (p.round % 2 === 1 ? p.slot : b.num_teams - p.slot + 1),
    ...(pickIds[b.draft_id]?.[`${p.round}-${p.slot}`] ? { player_id: pickIds[b.draft_id][`${p.round}-${p.slot}`] } : {}),
  })),
}));
write("boards.json", packedBoards);

const size = (rel) => fs.statSync(path.join(OUT, rel)).size;
let total = size("summary.json") + size("boards.json");
for (const d of ["combos", "trends"]) for (const f of fs.readdirSync(path.join(OUT, d))) total += size(`${d}/${f}`);
console.log(`wrote ${nCombos} combos, ${nTrends} trends, ${packedBoards.length} boards (${Math.round(total / 1024)} KB)`);
if (missing.length) console.warn(`missing in the source: ${missing.join(", ")}`);
