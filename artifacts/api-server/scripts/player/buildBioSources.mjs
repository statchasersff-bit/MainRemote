/**
 * The Bio tab's fact store: Stages 0, 1 and 3 of the Bio spec's pipeline.
 *
 *   Stage 0  ID crosswalk. Each StatChasers slug carries its Sleeper id; the
 *            DynastyProcess crosswalk (the file nflreadr's load_ff_playerids
 *            reads) maps that to GSIS, PFR and ESPN ids, and Wikidata is
 *            matched on the PFR id. Never on a name: a Sleeper id with no
 *            crosswalk row, or a crosswalk row whose birth date contradicts
 *            Sleeper's, goes to `manualMatch` and gets no facts.
 *
 *   Stage 1  Structured sources only, no language model:
 *              nflverse players.csv    birth date, height, weight, colleges, draft
 *              nflverse draft_picks    draft slot; Pro Bowl / All-Pro counts
 *              nflverse rosters        the team each season, games or not
 *              nflverse games.csv      starting quarterbacks, by game
 *              nflverse trades.csv     dated trades and what came back
 *              nflverse snap_counts    offensive snap share per game (2012 on),
 *                                      for the role wording off quarterback
 *              nflverse weekly rosters the Super Bowl week's rosters, with
 *                                      games.csv's winner: Super Bowl teams
 *              Sleeper (bio_facts.json, players.json, already on disk)
 *              Wikidata (weekly)       birthplace, high school, Wikipedia title
 *              Wikipedia infoboxes     high school, colleges, draft, career
 *                                      history, Super Bowls, Pro Bowls, All-Pro
 *                                      (bio_wikipedia.json, buildBioWikipedia.mjs,
 *                                      run by hand; ranked last, so it confirms
 *                                      or fills gaps, never overrides)
 *              approved transactions   read from Wikipedia in session, checked
 *                                      in code, approved by mak
 *                                      (bio_candidates.json)
 *            Bulk files are downloaded once per run, conditionally (a 304
 *            costs nothing), never per player.
 *
 *   Stage 3  Reconcile (bio/reconcile.mjs) into one record per field, each
 *            naming its source; the source table carries the URL and the
 *            retrieval time.
 *
 * Written to data/player/bio_sources.json, which is committed: verified data
 * is stored, not re-fetched at render. Stage 4 (page facts) is computed at
 * render time by src/lib/player/bio-tab-data.ts, from this file and the game
 * logs, so the numbers on the Bio tab are the Stats tab's numbers.
 *
 *   node scripts/player/buildBioSources.mjs              # Wikidata only if a week old
 *   node scripts/player/buildBioSources.mjs --wikidata   # force the Wikidata pass
 *   node scripts/player/buildBioSources.mjs --no-wikidata
 */

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./paths.mjs";
import { currentSeason } from "./season.mjs";
import { CACHE_DIR, politeClient, SourcePaused } from "./bio/polite.mjs";
import { candidate, reconcilePlayer, sameCollege, sameSchool } from "./bio/reconcile.mjs";

const OUT_FILE = path.join(DATA_DIR, "bio_sources.json");
const PLAYERS_FILE = path.join(DATA_DIR, "players.json");
const BIO_FACTS_FILE = path.join(DATA_DIR, "bio_facts.json");
const WIKIPEDIA_FILE = path.join(DATA_DIR, "bio_wikipedia.json");
const CANDIDATES_FILE = path.join(DATA_DIR, "bio_candidates.json");
const TRADE_DATES_FILE = path.join(DATA_DIR, "trade_date_overrides.json");
const WIKIDATA_CHECKPOINT = path.join(CACHE_DIR, "wikidata-checkpoint.json");

const NFLVERSE = "https://github.com/nflverse/nflverse-data/releases/download";
const URLS = {
  crosswalk: "https://github.com/dynastyprocess/data/raw/master/files/db_playerids.csv",
  players: `${NFLVERSE}/players/players.csv`,
  draft: `${NFLVERSE}/draft_picks/draft_picks.csv`,
  roster: (season) => `${NFLVERSE}/rosters/roster_${season}.csv`,
  weeklyRoster: (season) => `${NFLVERSE}/weekly_rosters/roster_weekly_${season}.csv`,
  snaps: (season) => `${NFLVERSE}/snap_counts/snap_counts_${season}.csv`,
  games: "https://github.com/nflverse/nfldata/raw/master/data/games.csv",
  trades: "https://github.com/nflverse/nfldata/raw/master/data/trades.csv",
  wikidata: "https://query.wikidata.org/sparql",
};

const SOURCE_NAMES = {
  crosswalk: "DynastyProcess player ID crosswalk",
  "nflverse-players": "nflverse players",
  "nflverse-draft": "nflverse draft picks (Pro Football Reference)",
  "nflverse-rosters": "nflverse season rosters",
  "nflverse-games": "nflverse games (starting quarterbacks)",
  "nflverse-trades": "nflverse trades",
  "nflverse-snaps": "nflverse snap counts (Pro Football Reference)",
  "nflverse-super-bowls": "nflverse games and weekly rosters (Super Bowl week)",
  sleeper: "Sleeper players API",
  wikidata: "Wikidata",
  wikipedia: "Wikipedia (infobox)",
  "wikipedia-transactions": "dated transactions from the clubs' official logs, press reports and Wikipedia, fact-checked and reviewed",
};

/** The game logs start in 2009; the career stops read no further back. */
const FIRST_SEASON = 2009;
/** Pro Football Reference's snap counts, which nflverse republishes, start in 2012. */
const FIRST_SNAP_SEASON = 2012;
/** nflverse's weekly rosters start in 2002; Super Bowl teams read no further back. */
const FIRST_WEEKLY_ROSTER_SEASON = 2002;
/**
 * A Super Bowl roster member: on the winner's active list or one of its
 * reserve lists (injured reserve, PUP) in the Super Bowl week. The practice
 * squad (DEV) and players cut that week are not. The page says "member of",
 * never "played in": the roster does not say who took the field.
 */
const SUPER_BOWL_STATUSES = new Set(["ACT", "RES", "PUP", "INA"]);
const WIKIDATA_BATCH = 150;
const WIKIDATA_EVERY_MS = 7 * 24 * 3600_000;

const TEAM = {
  JAC: "JAX", WSH: "WAS", OAK: "LV", STL: "LAR", SD: "LAC", LA: "LAR",
  // Pro Football Reference's codes, which draft_picks.csv uses.
  NWE: "NE", GNB: "GB", KAN: "KC", NOR: "NO", SFO: "SF", TAM: "TB", SDG: "LAC",
  RAM: "LAR", RAI: "LV", LVR: "LV", CRD: "ARI", PHO: "ARI", CLT: "IND", RAV: "BAL",
  HTX: "HOU", OTI: "TEN",
};
const team = (code) => {
  const c = String(code ?? "").trim().toUpperCase();
  return c ? TEAM[c] ?? c : null;
};

const US_STATES = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "),
);

const log = (msg) => console.log(`[bio-sources] ${msg}`);

/* ------------------------------------------------------------------ csv */

// A generator, one row object at a time: the weekly roster and snap count
// files run to 16MB each, and materializing every row of every season as an
// object took this script to 1.5GB RSS - enough to OOM the production VM,
// which runs it from the daily chain beside the server (outage 2026-10-03).
// The few callers that need the rows twice spread it into an array.
function* parseCsv(text) {
  let header = null;
  let row = [];
  let field = "";
  let quoted = false;
  const emit = () => {
    row.push(field);
    const done = row;
    row = [];
    field = "";
    if (!header) header = done;
    else if (done.length > 1) return Object.fromEntries(header.map((h, i) => [h, done[i] === "NA" ? "" : (done[i] ?? "")]));
    return null;
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      const r = emit();
      if (r) yield r;
    } else field += c;
  }
  if (field !== "" || row.length) {
    const r = emit();
    if (r) yield r;
  }
}

/* -------------------------------------------------------------- sources */

const github = politeClient("github", { minGapMs: 500, log });
const wikidata = politeClient("wikidata", { minGapMs: 1000, log });
const sources = {};

async function fetchCsv(key, url) {
  const res = await github.fetch(url);
  sources[key] ??= {
    name: SOURCE_NAMES[key],
    url,
    retrievedAt: res.retrievedAt,
    revision: res.etag ?? res.lastModified ?? null,
  };
  log(`${key}: ${url.split("/").pop()} ${res.fromCache ? "unchanged (304)" : "downloaded"}`);
  return parseCsv(res.body);
}

/* ------------------------------------------------------------- wikidata */

function wikidataQuery(pfrIds) {
  const values = pfrIds.map((id) => `"${id[0]}/${id}"`).join(" ");
  return `SELECT ?pfr ?item ?dob ?bpLabel ?stateCode ?countryLabel ?school ?schoolLabel ?typeLabel ?article WHERE {
  VALUES ?pfr { ${values} }
  ?item wdt:P3561 ?pfr .
  OPTIONAL { ?item p:P569/psv:P569 [ wikibase:timeValue ?dob ; wikibase:timePrecision 11 ] . }
  OPTIONAL { ?item wdt:P19 ?bp .
    OPTIONAL { ?bp wdt:P131* ?st . ?st wdt:P31 wd:Q35657 ; wdt:P300 ?stateCode . }
    OPTIONAL { ?bp wdt:P17 ?country . } }
  OPTIONAL { ?item wdt:P69 ?school . OPTIONAL { ?school wdt:P31 ?type . } }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
}

const HS_TYPE = /high school|secondary school|preparatory school|boarding school|private school|public school|charter school/i;
const NOT_HS = /university|college|community college/i;

/** One Wikidata batch's rows, folded into one record per PFR id. */
export function foldWikidata(bindings) {
  const out = {};
  for (const b of bindings) {
    const pfr = b.pfr.value.split("/")[1];
    const rec = (out[pfr] ??= { qid: b.item.value.split("/").pop(), dob: null, birthPlace: null, highSchools: {}, wikipedia: null });
    if (b.dob) rec.dob = b.dob.value.slice(0, 10);
    if (b.bpLabel) {
      const state = b.stateCode?.value?.replace(/^US-/, "");
      const place = state && US_STATES.has(state) ? `${b.bpLabel.value}, ${state}` : b.countryLabel ? `${b.bpLabel.value}, ${b.countryLabel.value}` : b.bpLabel.value;
      // A P131* walk can land on more than one state-level entity; keep the first with a state.
      if (!rec.birthPlace || (!rec.birthPlace.includes(", ") && place.includes(", "))) rec.birthPlace = place;
    }
    if (b.school && b.schoolLabel) {
      const label = b.schoolLabel.value;
      const type = b.typeLabel?.value ?? "";
      if (!NOT_HS.test(label) && (HS_TYPE.test(type) || /high school/i.test(label))) rec.highSchools[label] = true;
    }
    if (b.article) rec.wikipedia = decodeURIComponent(b.article.value.split("/wiki/")[1] ?? "").replace(/_/g, " ") || null;
  }
  for (const rec of Object.values(out)) rec.highSchools = Object.keys(rec.highSchools);
  return out;
}

async function runWikidata(pfrIds, fresh) {
  let checkpoint = {};
  try {
    checkpoint = JSON.parse(fs.readFileSync(WIKIDATA_CHECKPOINT, "utf8"));
  } catch {}
  // A checkpoint older than the cadence is a finished run, not a crashed one.
  // A forced run starts over; so does one after a finished run (every batch done).
  if (fresh || checkpoint.complete || !checkpoint.startedAt || Date.now() - Date.parse(checkpoint.startedAt) > WIKIDATA_EVERY_MS) {
    checkpoint = { startedAt: new Date().toISOString(), done: 0, results: {} };
  }
  const batches = [];
  for (let i = 0; i < pfrIds.length; i += WIKIDATA_BATCH) batches.push(pfrIds.slice(i, i + WIKIDATA_BATCH));
  if (checkpoint.done > 0) log(`wikidata: resuming at batch ${checkpoint.done + 1} of ${batches.length}`);

  for (let i = checkpoint.done; i < batches.length; i += 1) {
    const body = new URLSearchParams({ query: wikidataQuery(batches[i]), format: "json" }).toString();
    let res;
    try {
      res = await wikidata.fetch(URLS.wikidata, {
        method: "POST",
        body,
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/sparql-results+json" },
      });
    } catch (err) {
      if (err instanceof SourcePaused) {
        log(`wikidata: ${err.message}; keeping checkpoint at batch ${i}`);
        return null;
      }
      log(`wikidata: batch ${i + 1} failed (${err.message}); skipped`);
      continue;
    }
    Object.assign(checkpoint.results, foldWikidata(JSON.parse(res.body).results.bindings));
    checkpoint.done = i + 1;
    fs.mkdirSync(path.dirname(WIKIDATA_CHECKPOINT), { recursive: true });
    fs.writeFileSync(WIKIDATA_CHECKPOINT, JSON.stringify(checkpoint));
    log(`wikidata: batch ${i + 1}/${batches.length}`);
  }
  checkpoint.complete = true;
  fs.writeFileSync(WIKIDATA_CHECKPOINT, JSON.stringify(checkpoint));
  sources.wikidata = { name: SOURCE_NAMES.wikidata, url: URLS.wikidata, retrievedAt: checkpoint.startedAt, revision: null };
  return checkpoint.results;
}

/* ---------------------------------------------------------------- build */

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

const int = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

/** Sleeper's height: "76" or "6'4\"". Null for the feet-only "6" some old records carry. */
function inches(v) {
  const s = String(v ?? "").trim();
  const ft = /^(\d)'\s*(\d{1,2})/.exec(s);
  const n = ft ? Number(ft[1]) * 12 + Number(ft[2]) : int(s);
  return n && n >= 60 && n <= 90 ? n : null;
}

async function main() {
  const argv = process.argv.slice(2);
  const season = currentSeason();
  const previous = readJson(OUT_FILE, null);
  const players = readJson(PLAYERS_FILE, []);
  const bioFacts = readJson(BIO_FACTS_FILE, {});

  /* ---- stage 0: crosswalk, by Sleeper id only ---- */
  const crosswalk = new Map();
  for (const row of await fetchCsv("crosswalk", URLS.crosswalk)) {
    if (row.sleeper_id) crosswalk.set(row.sleeper_id, row);
  }

  /* ---- stage 1: bulk structured files ---- */
  const nflPlayers = new Map([...(await fetchCsv("nflverse-players", URLS.players))].map((r) => [r.gsis_id, r]));
  const draftByGsis = new Map();
  const draftByPfr = new Map();
  for (const r of await fetchCsv("nflverse-draft", URLS.draft)) {
    if (r.gsis_id) draftByGsis.set(r.gsis_id, r);
    if (r.pfr_player_id) draftByPfr.set(r.pfr_player_id, r);
  }

  const rosterTeams = new Map(); // gsis -> {season: team}
  const rosterBody = new Map(); // gsis -> {season, height, weight}, the newest season's roster listing
  const rosterSleeper = new Map(); // sleeper id -> gsis, the crosswalk's fallback
  for (let y = FIRST_SEASON; y <= season; y += 1) {
    let rows;
    try {
      rows = await fetchCsv("nflverse-rosters", URLS.roster(y));
    } catch (err) {
      log(`rosters ${y}: ${err.message}`);
      continue;
    }
    for (const r of rows) {
      if (!r.gsis_id || !r.team) continue;
      const m = rosterTeams.get(r.gsis_id) ?? {};
      m[y] = team(r.team);
      rosterTeams.set(r.gsis_id, m);
      if (int(r.height) && int(r.weight)) rosterBody.set(r.gsis_id, { season: y, height: int(r.height), weight: int(r.weight) });
      if (r.sleeper_id) rosterSleeper.set(r.sleeper_id, r.gsis_id);
    }
  }

  const qbStarts = new Map(); // gsis -> {"2019:IND": n}
  const superBowlWinners = new Map(); // season -> winning team
  for (const g of await fetchCsv("nflverse-games", URLS.games)) {
    if (g.game_type === "SB" && g.home_score !== "" && g.away_score !== "" && Number(g.home_score) !== Number(g.away_score)) {
      superBowlWinners.set(int(g.season), team(Number(g.home_score) > Number(g.away_score) ? g.home_team : g.away_team));
    }
    if (g.game_type !== "REG" || !g.away_score) continue;
    for (const [id, tm] of [[g.away_qb_id, g.away_team], [g.home_qb_id, g.home_team]]) {
      if (!id) continue;
      const m = qbStarts.get(id) ?? {};
      const key = `${g.season}:${team(tm)}`;
      m[key] = (m[key] ?? 0) + 1;
      qbStarts.set(id, m);
    }
  }

  // Super Bowl teams: the winner's roster in the Super Bowl week.
  const superBowls = new Map(); // gsis -> [{season, team}]
  for (const [y, winner] of [...superBowlWinners].filter(([y]) => y >= FIRST_WEEKLY_ROSTER_SEASON).sort((a, b) => a[0] - b[0])) {
    let rows;
    try {
      rows = await fetchCsv("nflverse-super-bowls", URLS.weeklyRoster(y));
    } catch (err) {
      log(`weekly rosters ${y}: ${err.message}`);
      continue;
    }
    for (const r of rows) {
      if (r.game_type !== "SB" || !r.gsis_id || team(r.team) !== winner || !SUPER_BOWL_STATUSES.has(r.status)) continue;
      const list = superBowls.get(r.gsis_id) ?? [];
      if (!list.some((x) => x.season === y)) list.push({ season: y, team: winner });
      superBowls.set(r.gsis_id, list);
    }
  }

  // Offensive snap share by game, summed per season and club: games with a
  // snap, games at 50% or more, games at 25% or more. Regular season only.
  const snapGames = new Map(); // pfr -> {"2019:IND": {g, s50, s25}}
  for (let y = FIRST_SNAP_SEASON; y <= season; y += 1) {
    let rows;
    try {
      rows = await fetchCsv("nflverse-snaps", URLS.snaps(y));
    } catch (err) {
      log(`snap counts ${y}: ${err.message}`);
      continue;
    }
    for (const r of rows) {
      if (r.game_type !== "REG" || !r.pfr_player_id || !r.team) continue;
      const pct = Number(r.offense_pct) || 0;
      const m = snapGames.get(r.pfr_player_id) ?? {};
      const key = `${y}:${team(r.team)}`;
      const c = (m[key] ??= { g: 0, s50: 0, s25: 0 });
      c.g += 1;
      if (pct >= 0.5) c.s50 += 1;
      if (pct >= 0.25) c.s25 += 1;
      snapGames.set(r.pfr_player_id, m);
    }
  }

  const tradeRows = [...(await fetchCsv("nflverse-trades", URLS.trades))];
  const tradesById = new Map();
  for (const r of tradeRows) {
    const list = tradesById.get(r.trade_id) ?? [];
    list.push(r);
    tradesById.set(r.trade_id, list);
  }
  const pfrPosition = new Map([...nflPlayers.values()].filter((r) => r.pfr_id).map((r) => [r.pfr_id, r.position]));
  // Where the club's official transaction log disagrees with nflverse, the log
  // date is stored (trade_date_overrides.json; fact-check 2026-09-30, mak).
  const tradeDateOverrides = readJson(TRADE_DATES_FILE, { trades: {} }).trades;
  const tradesByPfr = new Map();
  for (const r of tradeRows) {
    if (!r.pfr_id || !/^\d{4}-\d{2}-\d{2}$/.test(r.trade_date)) continue;
    // What came back: every other asset moving the opposite way in the same trade.
    const back = (tradesById.get(r.trade_id) ?? []).filter((o) => o.gave === r.received && o.received === r.gave);
    const list = tradesByPfr.get(r.pfr_id) ?? [];
    list.push({
      date: tradeDateOverrides[r.trade_id]?.officialDate ?? r.trade_date,
      from: team(r.gave),
      to: team(r.received),
      return: back.map((o) =>
        o.pfr_id
          ? { player: o.pfr_name, pos: pfrPosition.get(o.pfr_id) ?? null }
          : { pick: { season: int(o.pick_season), round: int(o.pick_round), number: int(o.pick_number), conditional: o.conditional === "1" || o.conditional === "TRUE" } },
      ),
      tradeId: r.trade_id,
    });
    tradesByPfr.set(r.pfr_id, list);
  }

  /* ---- the crosswalk, applied ---- */
  const matched = [];
  const manualMatch = [];
  for (const p of players) {
    let xw = crosswalk.get(String(p.id));
    // The season rosters carry Sleeper ids too, for players the crosswalk has not reached.
    if (!xw && rosterSleeper.has(String(p.id))) {
      const gsis = rosterSleeper.get(String(p.id));
      const nfl = nflPlayers.get(gsis);
      xw = { gsis_id: gsis, pfr_id: nfl?.pfr_id ?? "", espn_id: nfl?.espn_id ?? "", birthdate: nfl?.birth_date ?? "" };
    }
    const sleeperDob = bioFacts[p.slug]?.birthDate ?? null;
    if (!xw || (!xw.gsis_id && !xw.pfr_id)) continue; // not in the crosswalk: no facts, not an error
    // A birth date the crosswalk and Sleeper disagree on is a reason to doubt
    // the match, unless a second, independent id source (the season rosters'
    // own Sleeper ids) links the same Sleeper id to the same GSIS id.
    const confirmed = xw.gsis_id && rosterSleeper.get(String(p.id)) === xw.gsis_id;
    if (!confirmed && sleeperDob && xw.birthdate && sleeperDob !== xw.birthdate) {
      manualMatch.push({ slug: p.slug, reason: `crosswalk birth date ${xw.birthdate} != Sleeper ${sleeperDob}` });
      continue;
    }
    matched.push({ p, xw });
  }

  /* ---- wikidata, weekly ---- */
  let wd = null;
  const lastWd = Date.parse(previous?.runs?.wikidataAt ?? "") || 0;
  const wantWd = argv.includes("--wikidata") || (!argv.includes("--no-wikidata") && Date.now() - lastWd > WIKIDATA_EVERY_MS);
  if (wantWd) {
    const pfrIds = [...new Set(matched.map(({ xw }) => xw.pfr_id || nflPlayers.get(xw.gsis_id)?.pfr_id).filter(Boolean))];
    wd = await runWikidata(pfrIds, argv.includes("--wikidata"));
  }
  if (!wd && previous?.sources?.wikidata) sources.wikidata = previous.sources.wikidata;

  // Sleeper's facts come from files on disk (buildBioFacts.mjs, buildPlayersIndex.js).
  sources.sleeper = {
    name: SOURCE_NAMES.sleeper,
    url: "https://api.sleeper.app/v1/players/nfl",
    retrievedAt: fs.statSync(BIO_FACTS_FILE, { throwIfNoEntry: false })?.mtime.toISOString() ?? null,
    revision: null,
  };

  // Wikipedia: infoboxes read by code, and the transactions mak approved.
  const wikipedia = readJson(WIKIPEDIA_FILE, { players: {} });
  const candidates = readJson(CANDIDATES_FILE, { players: {} });
  if (Object.keys(wikipedia.players).length) {
    sources.wikipedia = { name: SOURCE_NAMES.wikipedia, url: "https://en.wikipedia.org/", retrievedAt: wikipedia.generatedAt, revision: null };
  }
  if (Object.values(candidates.players).some((p) => p.facts.some((f) => f.status === "approved"))) {
    sources["wikipedia-transactions"] = { name: SOURCE_NAMES["wikipedia-transactions"], url: "https://en.wikipedia.org/", retrievedAt: candidates.verifiedAt ?? null, revision: null };
  }

  /* ---- stage 3: reconcile each player ---- */
  const out = {};
  const conflictLog = [];
  for (const { p, xw } of matched) {
    const gsis = xw.gsis_id || null;
    const nfl = gsis ? nflPlayers.get(gsis) : null;
    const pfr = xw.pfr_id || nfl?.pfr_id || null;
    const sleeper = bioFacts[p.slug] ?? {};
    const wdRec = wd ? wd[pfr] ?? null : null;
    const prevWd = previous?.players?.[p.slug]?.facts?.filter((f) => f.source === "wikidata") ?? [];
    const prevWdValue = (field) => prevWd.find((f) => f.field === field)?.value ?? null;
    const wdUrl = wdRec?.qid ? `https://www.wikidata.org/wiki/${wdRec.qid}` : prevWd[0]?.url;
    const fromWd = (field, value) => candidate("wikidata", wd ? value : prevWdValue(field), { url: wdUrl });

    const wp = wikipedia.players[p.slug] ?? null;
    const box = wp?.infobox ?? null;
    const fromWp = (value) => candidate("wikipedia", value ?? null, { url: wp?.url });
    const approvedTx = (candidates.players[p.slug]?.facts ?? [])
      // The fact-checked version when there is one (mak approves `proposed`).
      .filter((f) => f.status === "approved" && f.proposed !== null)
      .map((f) => ({ ...(f.proposed ?? f.value), quote: f.quote, url: f.verification?.official?.url ?? candidates.players[p.slug].url, method: f.method }));

    const body = gsis ? rosterBody.get(gsis) ?? null : null;
    const draftRow = (gsis && draftByGsis.get(gsis)) || (pfr && draftByPfr.get(pfr)) || null;
    const draftFromPicks = draftRow
      ? { year: int(draftRow.season), round: int(draftRow.round), pick: int(draftRow.pick), team: team(draftRow.team) }
      : null;
    const draftFromPlayers =
      nfl && int(nfl.draft_year)
        ? { year: int(nfl.draft_year), round: int(nfl.draft_round), pick: int(nfl.draft_pick), team: team(nfl.draft_team) }
        : null;
    const rookie = int(nfl?.rookie_season);
    // Undrafted only when both nflverse files say so and the draft table covers his year.
    const undrafted = !draftRow && nfl && !nfl.draft_year && rookie && rookie >= 1990 ? { year: rookie } : null;

    // nflverse lists colleges most recent first ("Oklahoma; Alabama").
    const colleges = nfl?.college_name ? nfl.college_name.split(/\s*;\s*/).filter(Boolean).reverse() : null;

    const fields = {
      birth_date: { majority: true, candidates: [candidate("nflverse-players", nfl?.birth_date || null), candidate("sleeper", sleeper.birthDate ?? null), fromWd("birth_date", wdRec?.dob ?? null)] },
      // Sleeper first (mak, 2026-09-30): the header shows Sleeper's listing and
      // the Quick Facts must not contradict it. nflverse only confirms.
      height_in: { candidates: [candidate("sleeper", inches(p.height)), candidate("nflverse-rosters", body?.height ?? null), candidate("nflverse-players", int(nfl?.height))] },
      weight_lb: { candidates: [candidate("sleeper", int(p.weight)), candidate("nflverse-rosters", body?.weight ?? null), candidate("nflverse-players", int(nfl?.weight))] },
      colleges: {
        candidates: [candidate("nflverse-players", colleges), candidate("sleeper", sleeper.college ? [sleeper.college] : null), fromWp(box?.college)],
        // Agreement is on the school he finished at.
        same: (a, b) => sameCollege(a[a.length - 1], b[b.length - 1]),
      },
      high_school: {
        candidates: [candidate("sleeper", sleeper.highSchool ?? null), fromWd("high_school", wdRec?.highSchools?.length === 1 ? wdRec.highSchools[0] : null), fromWp(box?.high_school?.name)],
        same: sameSchool,
      },
      birth_place: { candidates: [fromWd("birth_place", wdRec?.birthPlace ?? null)] },
      draft: {
        candidates: [candidate("nflverse-draft", draftFromPicks), candidate("nflverse-players", draftFromPlayers), fromWp(box?.draft ? { ...box.draft, team: null } : null)],
        same: (a, b) => a.year === b.year && a.round === b.round && a.pick === b.pick,
      },
      undrafted: { candidates: [candidate("nflverse-draft", undrafted)] },
      pro_bowls: { candidates: [candidate("nflverse-draft", draftRow && int(draftRow.probowls) ? int(draftRow.probowls) : null), fromWp(box?.highlights?.proBowls)] },
      all_pro: { candidates: [candidate("nflverse-draft", draftRow && int(draftRow.allpro) ? int(draftRow.allpro) : null), fromWp(box?.highlights?.allProFirst)] },
      // The whole career by club and years, including before the game logs (2009).
      career_teams: { candidates: [fromWp(box?.teams?.length ? box.teams : null)] },
      super_bowl_titles: { candidates: [fromWp(box?.highlights?.superBowls?.length ? box.highlights.superBowls : null)] },
      wiki_transactions: { candidates: [candidate("wikipedia-transactions", approvedTx.length ? approvedTx : null, { url: candidates.players[p.slug]?.url })] },
      team_by_season: { candidates: [candidate("nflverse-rosters", gsis && rosterTeams.get(gsis) ? rosterTeams.get(gsis) : null)] },
      qb_starts: { candidates: [candidate("nflverse-games", gsis && qbStarts.get(gsis) ? qbStarts.get(gsis) : null)] },
      trades: { candidates: [candidate("nflverse-trades", pfr && tradesByPfr.get(pfr) ? tradesByPfr.get(pfr) : null)] },
      snap_games: { candidates: [candidate("nflverse-snaps", pfr && snapGames.get(pfr) ? snapGames.get(pfr) : null)] },
      super_bowls: { candidates: [candidate("nflverse-super-bowls", gsis && superBowls.get(gsis) ? superBowls.get(gsis) : null)] },
    };

    const { facts, conflicts } = reconcilePlayer(fields);
    if (facts.length === 0) continue;
    const qid = wdRec?.qid ?? previous?.players?.[p.slug]?.ids?.wikidata ?? null;
    const wiki = wd ? wdRec?.wikipedia ?? null : previous?.players?.[p.slug]?.ids?.wikipedia ?? null;
    out[p.slug] = {
      ids: {
        sleeper: String(p.id),
        ...(gsis ? { gsis } : {}),
        ...(pfr ? { pfr } : {}),
        ...(xw.espn_id ? { espn: xw.espn_id } : {}),
        ...(qid ? { wikidata: qid } : {}),
        ...(wiki ? { wikipedia: wiki } : {}),
      },
      facts,
      ...(conflicts.length ? { conflicts } : {}),
    };
    for (const c of conflicts) conflictLog.push({ slug: p.slug, ...c });
  }

  // "Updated" on the page moves only when a published fact does (spec, Stage 8).
  const same = previous && JSON.stringify(previous.players) === JSON.stringify(out);
  const doc = {
    version: 1,
    generatedAt: new Date().toISOString(),
    changedAt: same ? previous.changedAt ?? previous.generatedAt : new Date().toISOString(),
    runs: { wikidataAt: wd ? new Date().toISOString() : previous?.runs?.wikidataAt ?? null },
    sources,
    manualMatch,
    players: out,
  };
  fs.writeFileSync(`${OUT_FILE}.tmp`, JSON.stringify(doc));
  fs.renameSync(`${OUT_FILE}.tmp`, OUT_FILE);

  const byField = {};
  for (const c of conflictLog) byField[c.field] = (byField[c.field] ?? 0) + 1;
  log(`wrote ${Object.keys(out).length} players (${manualMatch.length} to manual match); conflicts by field ${JSON.stringify(byField)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
