import fs from "node:fs";
const players = JSON.parse(fs.readFileSync("data/player/players.json", "utf8"));
const prod = JSON.parse(fs.readFileSync("data/player/player_production.json", "utf8"));
const outlooks = JSON.parse(fs.readFileSync("data/player/fantasy_outlook_2026.json", "utf8"));
const draft = JSON.parse(fs.readFileSync("data/player/draft.json", "utf8"));

const names = process.argv.slice(2);
for (const q of names) {
  const hits = players.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
  for (const p of hits) {
    if (p.status === "Inactive" && hits.length > 1) continue;
    console.log(`\n##### ${p.name} (${p.position}, ${p.team}, id ${p.id}, exp ${p.years_exp}, depth ${p.depth_chart_order}, ${p.status})`);
    const d = draft[p.slug];
    if (d) console.log(`draft: ${d.year} r${d.round} p${d.pick} ${d.draft_team} — ${d.college}`);
    for (const row of (prod[p.id] ?? []).slice(0, 2)) {
      const t = row.totals;
      console.log(`${row.season}: ${row.gamesPlayed}g  ${JSON.stringify(t)}  ppr ${row.ppr.total} (${row.ppr.ppg}/g, finish ${row.ppr.posFinishPpg} ppg / ${row.ppr.posFinishTotal} total)`);
    }
    const o = outlooks[p.id];
    if (o) console.log(`OUTLOOK: ${o.headline}\n${o.body.slice(0, 900)}`);
  }
}
