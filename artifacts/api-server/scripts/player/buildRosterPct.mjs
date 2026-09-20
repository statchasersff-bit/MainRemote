/**
 * How widely a player is rostered, from Sleeper's own leagues.
 *
 * Sleeper publishes an aggregate of what its leagues have done with each
 * player in a given week:
 *
 *   /players/nfl/research/regular/<season>/<week>
 *     → { "<sleeperId>": { "owned": 88.7, "started": 45.1 }, ... }
 *
 * `owned` is the share of leagues where somebody holds him; `started` the
 * share that started him that week. Both are percentages already, to a tenth.
 *
 * WHICH LEAGUES. The endpoint takes `league_type`, and it publishes exactly two
 * cuts: the default, which is 673 players deep, and `league_type=2`, which is
 * 1662 deep and is the dynasty one. There is no parameter for how many
 * quarterbacks a league starts — `qb_count`, `superflex` and every league_type
 * but 2 come back byte-identical to the default. So the default is what this
 * builder reads, and it is the closest thing Sleeper publishes to a 1QB
 * number: in week 2 of 2026 it had Jacoby Brissett at 11.8% where the dynasty
 * cut had him at 71.8%, and a backup quarterback is exactly the player whose
 * ownership a superflex league inflates. The page says "Sleeper redraft" over
 * the figure rather than "1QB", because that is the claim this source supports.
 *
 * ONE WEEK, the current one. This is a reading of now, not a season total —
 * rerun it as often as the number should move, which in season is weekly and
 * in practice is whenever the rest of the data is rebuilt.
 *
 * Written to data/player/roster_pct.json, keyed by Sleeper id, which is what
 * players.json calls `id` and what every other id-keyed file here uses.
 *
 *   node scripts/player/buildRosterPct.mjs          # the week Sleeper is on
 *   node scripts/player/buildRosterPct.mjs 2026 2   # one named season and week
 */

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./paths.mjs";

const OUT_FILE = path.join(DATA_DIR, "roster_pct.json");

const STATE_URL = "https://api.sleeper.app/v1/state/nfl";
const RESEARCH_BASE = "https://api.sleeper.com/players/nfl/research/regular";

const REQ_TIMEOUT = 25_000;

async function getJson(url) {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(REQ_TIMEOUT),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} ${url}`);
  return res.json();
}

/**
 * The season and week to read.
 *
 * Sleeper's own state, so this never disagrees with the source it is about to
 * query. `display_week` rather than `week`: between the last game of a week and
 * Sleeper's rollover the two differ, and the research document is keyed to the
 * week the app is showing.
 */
async function currentWeek() {
  const state = await getJson(STATE_URL);
  const season = Number(state?.season);
  const week = Number(state?.display_week ?? state?.week);
  if (!Number.isFinite(season) || !Number.isFinite(week)) {
    throw new Error(`Sleeper state gave no season/week: ${JSON.stringify(state)}`);
  }
  return { season, week };
}

/** The research document for one week, or null if that week has none yet. */
async function readWeek(season, week) {
  if (week < 1) return null;
  const doc = await getJson(`${RESEARCH_BASE}/${season}/${week}`);
  if (!doc || typeof doc !== "object" || Object.keys(doc).length === 0) return null;
  return doc;
}

function clean(doc) {
  const players = {};
  let skipped = 0;
  for (const [id, row] of Object.entries(doc)) {
    const owned = Number(row?.owned);
    const started = Number(row?.started);
    // A row without an ownership figure is not a zero — it is a row that says
    // nothing, and writing 0 for it would put "0% rostered" on a page about a
    // player Sleeper simply has no reading for.
    if (!Number.isFinite(owned)) {
      skipped += 1;
      continue;
    }
    players[id] = {
      owned: Math.round(owned * 10) / 10,
      ...(Number.isFinite(started) ? { started: Math.round(started * 10) / 10 } : {}),
    };
  }
  return { players, skipped };
}

async function main() {
  const [seasonArg, weekArg] = process.argv.slice(2).map(Number);
  const asked =
    Number.isFinite(seasonArg) && Number.isFinite(weekArg)
      ? { season: seasonArg, week: weekArg }
      : await currentWeek();

  console.log(`Sleeper is on ${asked.season} week ${asked.week}`);

  // The week Sleeper names, and the one before it if that week is empty. A
  // week turns over before anyone has been added or dropped in it, and an
  // empty document then means "too early", not "nobody is rostered".
  let { season, week } = asked;
  let doc = await readWeek(season, week);
  if (!doc && week > 1) {
    console.log(`  week ${week} is empty; falling back to week ${week - 1}`);
    week -= 1;
    doc = await readWeek(season, week);
  }
  if (!doc) {
    throw new Error(`No research document for ${season} week ${asked.week}`);
  }

  const { players, skipped } = clean(doc);
  if (Object.keys(players).length === 0) {
    throw new Error("Research document had no usable rows; refusing to write");
  }

  const out = {
    season,
    week,
    readAt: new Date().toISOString(),
    players,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 0));
  console.log(
    `Wrote ${Object.keys(players).length} players (${skipped} without a figure) ` +
      `for ${season} week ${week} to ${OUT_FILE}`,
  );
}

main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
