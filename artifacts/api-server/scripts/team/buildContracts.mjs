/**
 * Build the team hubs' Contracts tab from the nflverse contract register.
 *
 *   node scripts/team/buildContracts.mjs <season> [--from <saved.parquet>]
 *
 * Writes data/team/contracts_<season>.json: for every club, every active
 * contract with a cap row for <season>, largest cap number first, with the
 * deal's headline terms (total, average per year, guarantees, year signed,
 * length) and that season's cap row (base salary, prorated and option
 * bonuses, guaranteed salary, cash). Figures are in millions, as the register
 * carries them.
 *
 * A deal the register lists without a cap row for the season (this year's
 * draft class, for months) goes under `pending` with its terms only, for
 * contracts.ts to pair with the cap page's cap number.
 *
 * A player's club for the season is the club on the season's cap row, not
 * the contract's `team` field, which lists every club a deal has been with
 * ("NYG/MIN") once a player is traded mid-contract.
 *
 * Cut savings and dead money are ESTIMATES, computed here so the page and
 * this file cannot disagree:
 *
 *   dead if cut   = every remaining year's prorated signing bonus
 *                 + every remaining year's guaranteed salary
 *                 + every remaining year's option-bonus proration, counted
 *                   only when this season's amount repeats last season's
 *                   (an option exercised earlier is already prorating; a
 *                   lump that first appears this season is an option not
 *                   yet picked up, and would not accelerate).
 *   cut savings   = this season's cap number - dead if cut, floored at zero.
 *
 * That is the standard pre-June-1 release and ignores offsets and void-year
 * mechanics, which is why the page calls it an estimate. Checked on
 * 2026-10-23 against a published cap page for 48 49ers: cut savings matched
 * on all 48, dead money on 44. The four misses undercount dead money for
 * players whose option was picked up THIS season (the register cannot show
 * that), and every one of them has $0 savings either way.
 *
 * Reads the register's parquet release with hyparquet (a dev dependency),
 * because the CSV release stopped updating in 2022. `--from` reads a saved
 * copy. Refuses to write when fewer than 32 clubs come back with a roster.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parquetReadObjects } from "hyparquet";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(here, "..", "..", "data");
const SOURCE =
  "https://github.com/nflverse/nflverse-data/releases/download/contracts/historical_contracts.parquet";

/** The register's club nicknames to the site's abbreviations. */
const NICKNAMES = {
  Cardinals: "ari", Falcons: "atl", Ravens: "bal", Bills: "buf", Panthers: "car", Bears: "chi",
  Bengals: "cin", Browns: "cle", Cowboys: "dal", Broncos: "den", Lions: "det", Packers: "gb",
  Texans: "hou", Colts: "ind", Jaguars: "jax", Chiefs: "kc", Chargers: "lac", Rams: "lar",
  Raiders: "lv", Dolphins: "mia", Vikings: "min", Patriots: "ne", Saints: "no", Giants: "nyg",
  Jets: "nyj", Eagles: "phi", Steelers: "pit", Seahawks: "sea", "49ers": "sf", Buccaneers: "tb",
  Titans: "ten", Commanders: "was", Redskins: "was", "Football Team": "was",
};

const N = (v) => {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const m3 = (v) => Math.round(N(v) * 1000) / 1000;

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, text);
  fs.renameSync(`${file}.tmp`, file);
}

async function load(from) {
  let buf;
  if (from) buf = fs.readFileSync(from);
  else {
    const res = await fetch(SOURCE, { redirect: "follow", signal: AbortSignal.timeout(5 * 60_000) });
    if (!res.ok) throw new Error(`${SOURCE} answered ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  }
  const file = {
    byteLength: buf.byteLength,
    slice: (a, b) => buf.buffer.slice(buf.byteOffset + a, buf.byteOffset + b),
  };
  return parquetReadObjects({
    file,
    columns: [
      "player", "position", "team", "is_active", "year_signed", "years", "value", "apy",
      "guaranteed", "gsis_id", "otc_id", "season_history", "contract_history",
    ],
  });
}

/** The estimate described in the header; every figure in millions. */
function cutMath(seasonRows, season) {
  const remaining = seasonRows.filter((s) => Number(s.year) >= season);
  const prorated = remaining.reduce((n, s) => n + N(s.prorated_bonus), 0);
  const guaranteed = remaining.reduce((n, s) => n + N(s.guaranteed_salary), 0);
  const current = remaining.find((s) => Number(s.year) === season);
  // Option bonuses. The register's per-year amount is the proration of every
  // option exercised so far, and it cannot say whether this season's option
  // has been picked up yet, so only the proration already running before
  // this season (last season's amount) is counted as dead money, carried
  // over the remaining years it continues in - at most four, since a bonus
  // prorates over five years and one has been used.
  const prior = seasonRows.find((s) => Number(s.year) === season - 1);
  const running = Math.min(N(current?.option_bonus), N(prior?.option_bonus));
  const carried = running > 0
    ? remaining.filter((s) => N(s.option_bonus) + 0.001 >= running).slice(0, 4).length
    : 0;
  const option = running * carried;
  const dead = prorated + guaranteed + option;
  const cap = N(current?.cap_number);
  return { deadIfCut: m3(dead), cutSavings: m3(Math.max(0, cap - dead)) };
}

function build(rows, season) {
  const teams = {};
  for (const key of Object.values(NICKNAMES)) teams[key] ??= { players: [], pending: [] };
  let kept = 0;
  const unknown = new Set();

  for (const r of rows) {
    if (!r.is_active) continue;
    const history = (r.season_history ?? []).filter((s) => /^\d{4}$/.test(String(s.year)));
    const row = history.find((s) => Number(s.year) === season);
    const last = (r.contract_history ?? []).at(-1);
    // A deal with no cap row for the season is kept aside with its terms
    // only: the register lists this year's draft class and other new deals
    // months before it fills in their year-by-year rows, and the cap page
    // has their cap numbers. contracts.ts pairs the two (2026-10-23).
    if (!row || N(row.cap_number) <= 0) {
      const club = NICKNAMES[String(r.team ?? "").split("/").pop()];
      if (club && r.otc_id != null) {
        teams[club].pending.push({
          name: r.player,
          position: r.position ?? "",
          gsisId: r.gsis_id || null,
          otcId: Number(r.otc_id),
          apy: m3(r.apy),
          value: m3(r.value),
          guaranteed: m3(r.guaranteed),
          yearSigned: N(r.year_signed) || null,
          years: N(r.years) || null,
          finalYear: N(r.year_signed) && N(r.years) ? N(r.year_signed) + N(r.years) - 1 : null,
          contractType: last?.contract_type ?? null,
        });
      }
      continue;
    }
    const nick = String(row.team ?? "").split("/").pop();
    const abbr = NICKNAMES[nick];
    if (!abbr) {
      unknown.add(nick);
      continue;
    }
    const years = history.map((s) => Number(s.year));
    const { deadIfCut, cutSavings } = cutMath(history, season);
    teams[abbr].players.push({
      name: r.player,
      position: r.position ?? "",
      gsisId: r.gsis_id || null,
      otcId: r.otc_id == null ? null : Number(r.otc_id),
      capNumber: m3(row.cap_number),
      capPct: Math.round(N(row.cap_percent) * 1000) / 10,
      baseSalary: m3(row.base_salary),
      proratedBonus: m3(row.prorated_bonus),
      optionBonus: m3(row.option_bonus),
      guaranteedSalary: m3(row.guaranteed_salary),
      cashPaid: m3(row.cash_paid),
      apy: m3(r.apy),
      value: m3(r.value),
      guaranteed: m3(r.guaranteed),
      yearSigned: N(r.year_signed) || null,
      years: N(r.years) || null,
      // The deal's last season, not the last cap row: void years run past it.
      finalYear:
        N(r.year_signed) && N(r.years)
          ? N(r.year_signed) + N(r.years) - 1
          : years.length
            ? Math.max(...years)
            : null,
      contractType: last?.contract_type ?? null,
      deadIfCut,
      cutSavings,
      future: history
        .filter((s) => Number(s.year) > season)
        .map((s) => ({ year: Number(s.year), capNumber: m3(s.cap_number), cashPaid: m3(s.cash_paid) })),
    });
    kept += 1;
  }
  if (unknown.size) console.warn(`  unmapped clubs skipped: ${[...unknown].join(", ")}`);

  for (const team of Object.values(teams)) {
    // The register can flag two deals for one player as active (a futures
    // deal and the one that replaced it): keep the newest, then the richer.
    const byId = new Map();
    for (const p of team.players) {
      const k = p.otcId ?? `${p.name}|${p.position}`;
      const prior = byId.get(k);
      if (
        !prior ||
        (p.yearSigned ?? 0) > (prior.yearSigned ?? 0) ||
        ((p.yearSigned ?? 0) === (prior.yearSigned ?? 0) && p.apy > prior.apy)
      ) {
        byId.set(k, p);
      }
    }
    team.players = [...byId.values()];
    team.players.sort((a, b) => b.capNumber - a.capNumber || a.name.localeCompare(b.name));
    // The terms-only deals: one per player (newest), and none for a player
    // the sheet already carries.
    const onSheet = new Set(team.players.map((p) => p.otcId));
    const pendingById = new Map();
    for (const p of team.pending) {
      if (onSheet.has(p.otcId)) continue;
      const prior = pendingById.get(p.otcId);
      if (!prior || (p.yearSigned ?? 0) > (prior.yearSigned ?? 0)) pendingById.set(p.otcId, p);
    }
    team.pending = [...pendingById.values()].sort((a, b) => a.name.localeCompare(b.name));
    team.committed = m3(team.players.reduce((n, p) => n + p.capNumber, 0));
    team.top51 = m3(team.players.slice(0, 51).reduce((n, p) => n + p.capNumber, 0));
    team.contracts = team.players.length;
  }
  const rank = (key) => {
    const order = Object.entries(teams).sort((a, b) => b[1][key] - a[1][key]);
    return Object.fromEntries(order.map(([abbr], i) => [abbr, i + 1]));
  };
  return {
    season,
    builtAt: new Date().toISOString(),
    contracts: kept,
    ranks: { committed: rank("committed"), top51: rank("top51") },
    teams: Object.fromEntries(Object.keys(teams).sort().map((k) => [k, teams[k]])),
  };
}

async function main() {
  const season = Number(process.argv[2]);
  if (!Number.isInteger(season) || season < 2015) {
    console.error("usage: node scripts/team/buildContracts.mjs <season> [--from <saved.parquet>]");
    process.exit(2);
  }
  const at = process.argv.indexOf("--from");
  const from = at > 0 ? path.resolve(process.argv[at + 1]) : null;

  const rows = await load(from);
  const doc = build(rows, season);
  const rostered = Object.values(doc.teams).filter((t) => t.players.length >= 40).length;
  if (rostered < 32) {
    console.error(`  refusing to write: only ${rostered} clubs have 40+ contracts for ${season}`);
    process.exit(1);
  }
  const file = path.join(DATA, "team", `contracts_${season}.json`);
  writeAtomic(file, `${JSON.stringify(doc)}\n`);
  const pending = Object.values(doc.teams).reduce((n, t) => n + t.pending.length, 0);
  console.log(`  contracts ${season}: ${doc.contracts} across 32 clubs, ${pending} deals held with terms only -> ${path.relative(process.cwd(), file)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
