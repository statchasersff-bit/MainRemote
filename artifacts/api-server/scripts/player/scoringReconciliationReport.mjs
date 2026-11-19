/**
 * Every stored per-game PPR total (Sleeper's provider record) against the house
 * rule, 2009 onward, grouped by season, position, cause and size.
 *
 *   node scripts/player/scoringReconciliationReport.mjs [--json out.json] [--md out.md]
 *
 * Causes, in the order they are tested (a week can carry two):
 *   provider-fumble-penalty  pre-2022 Sleeper totals charge -1 for EVERY fumble
 *                            on top of -2 for a lost one; not a house rule
 *   provider-extra-event     +1 per special-teams fumble recovery or defensive
 *                            forced fumble; Sleeper scores these, the house
 *                            rule does not
 *   missing-input            the log cannot score the line (kicker with no
 *                            distance bands)
 *   unexplained              none of the above
 * Nothing is rewritten. The provider totals stay as stored.
 */
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./paths.mjs";
import { kickerBands, scoreGameLogStats } from "../scoring/house-rules.mjs";

const LOGS = path.join(DATA_DIR, "game_logs");
const args = process.argv.slice(2);
const arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const players = new Map(JSON.parse(fs.readFileSync(path.join(DATA_DIR, "players.json"), "utf8")).map((p) => [String(p.id), p]));
const seasons = fs.readdirSync(LOGS).filter((f) => /^\d{4}\.json$/.test(f)).map((f) => Number(f.slice(0, 4))).sort();

const r2 = (x) => Math.round(x * 100) / 100;
function classify(s) {
  if (s.pts_ppr == null) return { cause: "no-provider-total", resid: 0, house: null };
  const isK = s.fga != null || s.xpa != null;
  if (isK && (s.fgm ?? 0) > 0 && !kickerBands(s)) return { cause: "missing-input", resid: null, house: null };
  const house = scoreGameLogStats(s, "ppr");
  let resid = r2(s.pts_ppr - house);
  if (Math.abs(resid) < 0.05) return { cause: "match", resid: 0, house };
  const causes = [];
  let rest = resid;
  const fum = s.fum ?? 0;
  if (fum > 0 && Math.abs(rest + fum) < 0.05) { causes.push("provider-fumble-penalty"); rest = 0; }
  const plays = (s.st_fum_rec ?? 0) + (s.idp_ff ?? 0) + Object.keys(s.px ?? {}).length;
  if (Math.abs(rest) >= 0.05 && plays > 0) {
    // A defensive / special-teams play by an offensive player (or kicking by a
    // non-kicker): Sleeper scores it, the house rule does not. Its points vary
    // by play (a blocked kick 2, a forced fumble 1, ...), so the residual is
    // attributed to the play, net of a pre-2022 fumble penalty when present.
    if (fum > 0 && rest + fum > 0) causes.push("provider-fumble-penalty");
    causes.push("provider-extra-event");
    rest = 0;
  }
  // A fumble-recovery TD the house rule scores (6) and the provider did not.
  if (Math.abs(rest) >= 0.05 && (s.fum_rec_td ?? 0) > 0 && Math.abs(rest + 6 * s.fum_rec_td) < 0.05) {
    causes.push("house-only-event");
    rest = 0;
  }
  if (Math.abs(rest) >= 0.05) causes.push(isK ? "kicker-unexplained" : "unexplained");
  return { cause: causes.join("+"), resid, house };
}

const rows = [];
const seasonTotals = new Map();
for (const season of seasons) {
  const logs = JSON.parse(fs.readFileSync(path.join(LOGS, `${season}.json`), "utf8"));
  for (const [pid, games] of Object.entries(logs)) {
    const pos = players.get(pid)?.position ?? ((games[0]?.stats?.fga != null) ? "K" : "?");
    for (const g of games) {
      const c = classify(g.stats);
      rows.push({ season, pid, pos, week: g.week, ...c, stored: g.stats.pts_ppr });
      const key = `${season}|${pid}`;
      const t = seasonTotals.get(key) ?? { season, pid, pos, name: players.get(pid)?.name ?? pid, stored: 0, house: 0, unscorable: false };
      t.stored += g.stats.pts_ppr ?? 0;
      if (c.house == null && c.cause !== "no-provider-total") t.unscorable = true;
      t.house += c.house ?? g.stats.pts_ppr ?? 0;
      seasonTotals.set(key, t);
    }
  }
}

const mag = (r) => (r == null ? "n/a" : Math.abs(r) <= 1 ? "<=1" : Math.abs(r) <= 2 ? "1-2" : Math.abs(r) <= 5 ? "2-5" : ">5");
const group = new Map();
for (const r of rows) {
  if (r.cause === "match") continue;
  const k = [r.season, r.pos, r.cause, mag(r.resid)].join("|");
  group.set(k, (group.get(k) ?? 0) + 1);
}
const bySeason = new Map();
for (const r of rows) {
  const b = bySeason.get(r.season) ?? { season: r.season, entries: 0, match: 0, causes: {} };
  b.entries++;
  if (r.cause === "match") b.match++;
  else b.causes[r.cause] = (b.causes[r.cause] ?? 0) + 1;
  bySeason.set(r.season, b);
}
const totals = [...seasonTotals.values()].map((t) => ({ ...t, stored: r2(t.stored), house: r2(t.house), diff: r2(t.stored - t.house) }));
const changed = totals.filter((t) => Math.abs(t.diff) >= 0.05);
const summary = {
  entries: rows.length,
  matched: rows.filter((r) => r.cause === "match").length,
  byCause: rows.reduce((m, r) => ((m[r.cause] = (m[r.cause] ?? 0) + 1), m), {}),
  playerSeasons: totals.length,
  playerSeasonsThatWouldChange: changed.length,
  playersAffected: new Set(changed.map((t) => t.pid)).size,
  seasonsAffected: [...new Set(changed.map((t) => t.season))].sort(),
  largestChanges: changed.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 15),
  unexplained: rows.filter((r) => r.cause.includes("unexplained")),
  kickerSeasons: (() => {
    const k = rows.filter((r) => r.pos === "K");
    const m = new Map();
    for (const r of k) { const b = m.get(r.season) ?? { season: r.season, entries: 0, match: 0 }; b.entries++; if (r.cause === "match") b.match++; m.set(r.season, b); }
    return [...m.values()];
  })(),
};
const out = { summary, bySeason: [...bySeason.values()], groups: [...group].map(([k, n]) => { const [season, pos, cause, magnitude] = k.split("|"); return { season: Number(season), pos, cause, magnitude, entries: n }; }) };
if (arg("--json")) fs.writeFileSync(arg("--json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify(summary, null, 1).slice(0, 6000));
