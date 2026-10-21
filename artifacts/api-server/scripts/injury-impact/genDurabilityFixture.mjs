/**
 * Generate tests/fixtures/injury-durability-source-<date>.json from the
 * Gridiron Medical + page's own code: its `hydrate` (and the constants and
 * helpers it closes over) cut verbatim out of public/gridiron-medical.html
 * and run over gridiron_dataset.json.
 *
 *   node scripts/injury-impact/genDurabilityFixture.mjs <app>/artifacts/injury-impact/public/gridiron-medical.html data/injury-impact/gridiron.json tests/fixtures/injury-durability-source-<date>.json
 *
 * The page is a single file with no build step, so the cut is the first
 * <script> block from its helpers up to the renderers; the DOM helpers in
 * it ($, $$) are never called by hydrate. Committed so a re-port after the
 * page changes starts from a working cutter (see genFixture.mjs for the
 * dashboard's).
 */
import fs from "node:fs";
import vm from "node:vm";

const [htmlFile, dataFile, outFile] = process.argv.slice(2);
if (!htmlFile || !dataFile || !outFile) {
  console.error("usage: genDurabilityFixture.mjs <gridiron-medical.html> <gridiron.json> <out.json>");
  process.exit(1);
}
const html = fs.readFileSync(htmlFile, "utf8");
const start = html.indexOf("/* ---------------------------------------------------------------- helpers */");
const end = html.indexOf("/* ========================================================================== *\n *  RENDER");
if (start < 0 || end < 0) throw new Error("could not find the helpers..RENDER span in the page");
const code = html.slice(start, end);

const sandbox = { document: { querySelector: () => null, querySelectorAll: () => [] }, console };
vm.createContext(sandbox);
vm.runInContext(`${code}\nthis.__hydrate = hydrate; this.__tierOf = tierOf;`, sandbox);

const data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
const app = sandbox.__hydrate(data);

const r = (v) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v);
const players = app.players.map((p) => ({
  n: p.n,
  id: p.id ?? null,
  pos: p.pos,
  score: p.score,
  tier: p.tier.key,
  availPct: r(p.availPct),
  availRatio: r(p.availRatio),
  gpTot: p.gpTot,
  gmTot: p.gmTot,
  perYearRate: r(p.perYearRate),
  major: p.major,
  soft: p.soft,
  reinj: p.reinj,
  nEff: r(p.nEff),
  penalty: r(p.penalty),
  shrunk: r(p.shrunk),
  pointsLostCareer: r(p.pointsLostCareer),
  missHistory: p.missHistory,
  missWeights: p.missWeights.map(r),
  injuries: p.inj.length,
  seasons: p.seasonYears,
}));

// The overview's two lists and the Current players pool, as the page computed them.
const proven = app.players.filter((p) => p.seasonYears.length >= 3);
const topDurable = [...(proven.length >= 6 ? proven : app.players)].sort((x, y) => y.score - x.score || y.seasonYears.length - x.seasonYears.length || y.ppg - x.ppg).slice(0, 6).map((p) => p.n);
const topLost = [...app.players].sort((x, y) => y.pointsLostCareer - x.pointsLostCareer).slice(0, 8).map((p) => p.n);
const cur = app.players.filter((p) => p.cur);
const pool = cur.some((p) => p.adpRank != null) ? cur.filter((p) => p.adpRank != null && p.adpRank <= 200) : cur;
const ranking = [...pool].sort((x, y) => y.score - x.score || y.ppg - x.ppg).map((p) => p.n);

const fixture = {
  source: "public/gridiron-medical.html hydrate() at c6a49ce, over gridiron_dataset.json",
  generated: new Date().toISOString().slice(0, 10),
  years: app.years,
  totals: { players: app.players.length, rows: app.rows.length, totalGamesMissed: app.totalGamesMissed, totalPointsLost: r(app.totalPointsLost), riskyCount: app.riskyCount },
  tiers: [0, 54.9, 55, 69.9, 70, 84.9, 85, 100].map((s) => [s, sandbox.__tierOf(s).key]),
  topDurable,
  topLost,
  rankingTop25: ranking.slice(0, 25),
  rankingCount: ranking.length,
  players,
};
fs.writeFileSync(outFile, JSON.stringify(fixture));
console.log(`wrote ${outFile}: ${players.length} players, ${app.rows.length} rows, ${Math.round(fs.statSync(outFile).size / 1024)} KB`);
