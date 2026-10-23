/**
 * Build the team hubs' draft capital: which picks each club holds in the next
 * NFL Draft, round by round, with traded picks named by the club they came
 * from.
 *
 *   node scripts/team/buildDraftPicks.mjs <draftYear> [--from <saved.html>]
 *
 * Writes data/team/draft_picks_<year>.json. Ownership is read from the
 * published full draft order, which lists every slot with its current owner
 * and, for a traded pick, the club it belonged to. The slot numbers are a
 * projection off the current standings and change every week, so they are
 * NOT stored: the page shows what a club holds by round, which only changes
 * when a trade happens.
 *
 * Compensatory picks are awarded in March and appear in the order from then
 * on; until then every club shows seven slots or the trades that moved them.
 *
 * Run after a trade that moves a pick, after the compensatory awards, and
 * once the draft is over, when the next year's order goes up. `--from`
 * reads a saved copy of the page instead of fetching it, so a run can be
 * reproduced from the snapshot it was built on.
 *
 * Refuses to write when any round does not come back with 32 slots: a page
 * that failed to render or changed shape must not blank 32 hubs.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(here, "..", "..", "data");
const SOURCE = "https://www.tankathon.com/nfl/full_draft";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

/** The order's logo codes to the site's abbreviations; only the odd ones differ. */
const TEAM_CODES = { wsh: "was", jac: "jax", la: "lar", oak: "lv", sd: "lac" };
const code = (c) => TEAM_CODES[c] ?? c;

const TEAMS = [
  "ari", "atl", "bal", "buf", "car", "chi", "cin", "cle", "dal", "den", "det", "gb", "hou",
  "ind", "jax", "kc", "lac", "lar", "lv", "mia", "min", "ne", "no", "nyg", "nyj", "phi",
  "pit", "sea", "sf", "tb", "ten", "was",
];

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, text);
  fs.renameSync(`${file}.tmp`, file);
}

/** Every slot on the page: { round, slot, owner, from }, in order. */
function parse(html) {
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
  const year = Number(title.match(/\b(20\d\d)\b/)?.[1]);
  const parts = html.split(/class="round-title"[^>]*>(\d)(?:st|nd|rd|th) Round</);
  const slots = [];
  for (let i = 1; i < parts.length; i += 2) {
    const round = Number(parts[i]);
    const body = parts[i + 1];
    const re = /<td class="pick-number">(\d+)<\/td>\s*<td>([\s\S]*?)<\/td>/g;
    let m;
    while ((m = re.exec(body))) {
      const cell = m[2];
      const owner = cell.match(/\/nfl\/([a-z]+)\.svg/)?.[1];
      const trade = cell.match(/class="trade">[\s\S]*?\/nfl\/([a-z]+)\.svg/)?.[1];
      if (!owner) continue;
      slots.push({ round, slot: Number(m[1]), owner: code(owner), from: code(trade ?? owner) });
    }
  }
  return { year, slots };
}

async function load(from) {
  if (from) return fs.readFileSync(from, "utf8");
  const res = await fetch(SOURCE, {
    headers: { "user-agent": UA, accept: "text/html" },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`${SOURCE} answered ${res.status}`);
  return res.text();
}

async function main() {
  const draftYear = Number(process.argv[2]);
  if (!Number.isInteger(draftYear) || draftYear < 2020) {
    console.error("usage: node scripts/team/buildDraftPicks.mjs <draftYear> [--from <saved.html>]");
    process.exit(2);
  }
  const at = process.argv.indexOf("--from");
  const from = at > 0 ? path.resolve(process.argv[at + 1]) : null;

  const html = await load(from);
  const { year, slots } = parse(html);
  if (year !== draftYear) {
    console.error(`  refusing to write: the order is for ${year || "an unknown year"}, asked for ${draftYear}`);
    process.exit(1);
  }
  const rounds = new Map();
  for (const s of slots) rounds.set(s.round, (rounds.get(s.round) ?? 0) + 1);
  const short = [...rounds.entries()].filter(([, n]) => n < 32);
  if (rounds.size !== 7 || short.length) {
    console.error(`  refusing to write: ${rounds.size} rounds, short rounds: ${JSON.stringify(short)}`);
    process.exit(1);
  }
  const unknown = slots.flatMap((s) => [s.owner, s.from]).filter((c) => !TEAMS.includes(c));
  if (unknown.length) {
    console.error(`  refusing to write: unknown club codes ${[...new Set(unknown)].join(", ")}`);
    process.exit(1);
  }

  // Per club: the picks it holds (by round, own picks first), and the picks of
  // its own it has sent away. Compensatory picks carry no original club in
  // the order, so an extra own-round slot is simply a second entry.
  const teams = {};
  for (const t of TEAMS) teams[t] = { holds: [], sent: [] };
  for (const s of slots) {
    teams[s.owner].holds.push({ round: s.round, from: s.from === s.owner ? null : s.from });
    if (s.from !== s.owner) teams[s.from].sent.push({ round: s.round, to: s.owner });
  }
  for (const t of Object.values(teams)) {
    t.holds.sort((a, b) => a.round - b.round || (a.from === null ? -1 : 1) - (b.from === null ? -1 : 1));
    t.sent.sort((a, b) => a.round - b.round);
  }

  const doc = {
    draftYear,
    builtAt: new Date().toISOString(),
    slots: slots.length,
    teams,
  };
  const file = path.join(DATA, "team", `draft_picks_${draftYear}.json`);
  writeAtomic(file, `${JSON.stringify(doc, null, 2)}\n`);
  const traded = slots.filter((s) => s.owner !== s.from).length;
  console.log(
    `  draft picks ${draftYear}: ${slots.length} slots, ${traded} traded -> ${path.relative(process.cwd(), file)}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
