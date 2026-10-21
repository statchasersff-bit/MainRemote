/**
 * The pure half of scripts/injury-impact/refresh.mjs: parse the nflverse files,
 * merge one season's weekly reports and in-game events into the history
 * shards, and keep the search index and the Sleeper id map in step. No file or
 * network access here, so the tests can drive it with small inputs.
 *
 * The rules are the research repo's (scripts/src/build_injury_history_assets.ts,
 * build_ingame_injuries.ts at c6a49ce), so a row this script writes looks like a
 * row the pack wrote: the same fields, the same team codes, the same newest-first
 * order, the same play-description trim and the same roster cascade for
 * resolving "PHI-11-A.Brown" to a GSIS id.
 */

/** The packed row layouts the shards use (buildData.mjs writes the same keys). */
export const HISTORY_KEYS = ["season", "week", "team", "reportPrimaryInjury", "reportSecondaryInjury", "practicePrimaryInjury", "practiceSecondaryInjury", "reportStatus", "practiceStatus", "dateModified"];
export const INGAME_KEYS = ["season", "week", "seasonType", "gameId", "date", "team", "opponent", "qtr", "clock", "status", "desc"];

/* ---------------------------------------------------------------------- csv */

/** One CSV line, honoring double-quoted fields that hold commas or quotes. */
export function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** A whole CSV text as { header: name -> column, rows }. */
export function parseCsv(text) {
  const lines = text.split(/\r?\n/);
  const header = {};
  parseCsvLine(lines[0] ?? "").forEach((h, i) => (header[h] = i));
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    if (!lines[i]) continue;
    rows.push(parseCsvLine(lines[i]));
  }
  return { header, rows };
}

/** nflverse blanks: "", "NA" and "null" are no value. */
export function cleanString(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (s === "" || /^(na|null)$/i.test(s)) return null;
  return s;
}

export function toNumber(value) {
  const s = cleanString(value);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/* -------------------------------------------------------------------- teams */

/**
 * Era and source codes to the modern franchise codes play-by-play uses
 * (the repo's TEAM_NORM, in both of its builders).
 */
export const TEAM_NORM = {
  ARZ: "ARI", BLT: "BAL", CLV: "CLE", HST: "HOU",
  SL: "LA", STL: "LA", LAR: "LA",
  SD: "LAC", SDG: "LAC",
  OAK: "LV", LVR: "LV",
  JAC: "JAX", WSH: "WAS", GNB: "GB", KAN: "KC", NWE: "NE", NOR: "NO", SFO: "SF", TAM: "TB",
};
export const normTeam = (t) => (t ? (TEAM_NORM[t] ?? t) : t);

/* ------------------------------------------------------------ weekly reports */

/**
 * The nflverse injuries CSV as packed history rows, with the player facts the
 * search index wants beside each. The weekly reports keep nflverse's own team
 * codes (the shards do too; the renderer normalizes).
 */
export function reportRowsFromCsv(text) {
  const { header, rows } = parseCsv(text);
  const col = (name) => header[name];
  const need = ["season", "week", "team", "gsis_id", "report_status", "practice_status"];
  for (const n of need) if (col(n) == null) throw new Error(`injuries CSV: missing column ${n}`);
  const out = [];
  for (const r of rows) {
    const gsisId = cleanString(r[col("gsis_id")]);
    if (!gsisId) continue;
    const fullName = cleanString(r[col("full_name")]) ?? [cleanString(r[col("first_name")]), cleanString(r[col("last_name")])].filter(Boolean).join(" ");
    if (!fullName) continue;
    const season = toNumber(r[col("season")]);
    const week = toNumber(r[col("week")]);
    out.push({
      gsisId,
      fullName,
      position: cleanString(r[col("position")]),
      team: cleanString(r[col("team")]),
      season,
      week,
      row: [
        season,
        week,
        cleanString(r[col("team")]),
        cleanString(r[col("report_primary_injury")]),
        cleanString(r[col("report_secondary_injury")]),
        cleanString(r[col("practice_primary_injury")]),
        cleanString(r[col("practice_secondary_injury")]),
        cleanString(r[col("report_status")]),
        cleanString(r[col("practice_status")]),
        col("date_modified") != null ? cleanString(r[col("date_modified")]) : null,
      ],
    });
  }
  return out;
}

/** Newest season, then newest week, first: the order the pack stores. */
export function sortHistory(rows) {
  return rows.sort((a, b) => (b[0] ?? 0) - (a[0] ?? 0) || (b[1] ?? 0) - (a[1] ?? 0));
}

/** The latest week any shard holds for a season, or 0 when the season is absent. */
export function maxStoredWeek(shards, season) {
  let max = 0;
  for (const shard of shards.values()) {
    for (const entry of Object.values(shard.players)) {
      for (const r of entry.h) if (r[0] === season && (r[1] ?? 0) > max) max = r[1];
    }
  }
  return max;
}

const shardKey = (gsisId) => gsisId.slice(-2);

function entryFor(shards, gsisId) {
  const key = shardKey(gsisId);
  let shard = shards.get(key);
  if (!shard) {
    shard = { keys: { h: HISTORY_KEYS, g: INGAME_KEYS }, players: {} };
    shards.set(key, shard);
  }
  return (shard.players[gsisId] ??= { h: [], g: [] });
}

/**
 * Replace the weeks this refresh owns. Rows of `season` from `ownedFrom` on are
 * dropped from every player and the fresh ones put in their place; earlier
 * weeks are the pack's (the repo's curated database replaced nflverse's rows
 * there for the fantasy positions) and are left alone.
 */
export function mergeReports(shards, season, ownedFrom, reports) {
  const touched = new Set();
  let dropped = 0;
  for (const shard of shards.values()) {
    for (const [gsisId, entry] of Object.entries(shard.players)) {
      const before = entry.h.length;
      entry.h = entry.h.filter((r) => !(r[0] === season && (r[1] ?? 0) >= ownedFrom));
      if (entry.h.length !== before) {
        dropped += before - entry.h.length;
        touched.add(gsisId);
      }
    }
  }
  let added = 0;
  const weeks = {};
  for (const rep of reports) {
    if (rep.season !== season || rep.week == null || rep.week < ownedFrom) continue;
    entryFor(shards, rep.gsisId).h.push(rep.row);
    touched.add(rep.gsisId);
    weeks[rep.week] = (weeks[rep.week] ?? 0) + 1;
    added += 1;
  }
  for (const gsisId of touched) sortHistory(entryFor(shards, gsisId).h);
  return { touched, added, dropped, weeks };
}

/* ------------------------------------------------------------ in-game events */

/** Surname from "P.Mahomes", "M.Ingram III" or "D.R-Cromartie". */
export function tokenLast(token) {
  const afterDot = token.includes(".") ? token.slice(token.indexOf(".") + 1) : token;
  return afterDot.replace(/\s+(Jr|Sr|II|III|IV|V)\.?$/i, "").toLowerCase().replace(/[^a-z'\-]/g, "").trim();
}

/** First-name prefix before the dot: "Ju.Jones" is "ju". */
export function tokenFirstPrefix(token) {
  const beforeDot = token.includes(".") ? token.slice(0, token.indexOf(".")) : token.slice(0, 1);
  return beforeDot.toLowerCase();
}

const cleanLast = (s) => s.toLowerCase().replace(/[^a-z'\-]/g, "");

function addTo(map, key, val) {
  (map.get(key) ?? map.set(key, new Set()).get(key)).add(val);
}

/**
 * The roster lookups the resolver walks: the weekly roster for the player's
 * team in that week (trades), then the seasonal roster for the looser
 * name and number fallbacks. Both texts are nflverse CSVs.
 */
export function buildRosterMaps(weeklyCsv, seasonalCsv) {
  const maps = {
    weeklyTeamJersey: new Map(),
    weeklyTeamLast: new Map(),
    byTeamJersey: new Map(),
    byTeamLast: new Map(),
    byInitialLast: new Map(),
    byLast: new Map(),
  };
  const wk = parseCsv(weeklyCsv);
  const wci = (n) => wk.header[n];
  const hasStatus = wci("status") != null;
  for (const r of wk.rows) {
    const gsisId = r[wci("gsis_id")];
    const team = normTeam(r[wci("team")]);
    const jersey = r[wci("jersey_number")];
    const week = r[wci("week")];
    const last = cleanLast(r[wci("last_name")] || "");
    // A player hurt in a game was active that week: only ACT rows, so two
    // same-name same-number players (one cut) do not collide.
    if (hasStatus && r[wci("status")] && r[wci("status")] !== "ACT") continue;
    if (!gsisId || !team || !week) continue;
    if (jersey) addTo(maps.weeklyTeamJersey, `${week}|${team}|${jersey}`, gsisId);
    if (last) addTo(maps.weeklyTeamLast, `${week}|${team}|${last}`, gsisId);
  }
  const { header, rows } = parseCsv(seasonalCsv);
  const ci = (n) => header[n];
  for (const r of rows) {
    const gsisId = r[ci("gsis_id")];
    const team = normTeam(r[ci("team")]);
    const jersey = r[ci("jersey_number")];
    const first = (r[ci("first_name")] || "").toLowerCase();
    const last = cleanLast(r[ci("last_name")] || "");
    if (!gsisId || !team) continue;
    if (jersey) {
      const key = `${team}|${jersey}`;
      const arr = maps.byTeamJersey.get(key) ?? maps.byTeamJersey.set(key, []).get(key);
      if (!arr.some((e) => e.gsisId === gsisId)) arr.push({ gsisId, first, last });
    }
    if (last) {
      addTo(maps.byTeamLast, `${team}|${last}`, gsisId);
      addTo(maps.byLast, last, gsisId);
      if (first) addTo(maps.byInitialLast, `${first[0]}|${last}`, gsisId);
    }
  }
  return maps;
}

const solo = (s) => (s && s.size === 1 ? [...s][0] : null);

/**
 * A play-by-play token to a GSIS id, best to loosest. Every step wants a
 * unique answer; two candidates mean no answer rather than a guess.
 */
export function resolveGsis(maps, team, jersey, token, week) {
  const last = tokenLast(token);
  const prefix = tokenFirstPrefix(token);
  if (week != null) {
    const byWeekJersey = solo(maps.weeklyTeamJersey.get(`${week}|${team}|${jersey}`));
    if (byWeekJersey) return byWeekJersey;
    const byWeekLast = solo(maps.weeklyTeamLast.get(`${week}|${team}|${last}`));
    if (byWeekLast) return byWeekLast;
  }
  const arr = maps.byTeamJersey.get(`${team}|${jersey}`) ?? [];
  const byLastOnJersey = arr.filter((e) => e.last === last || e.last.startsWith(last) || last.startsWith(e.last));
  if (byLastOnJersey.length === 1) return byLastOnJersey[0].gsisId;
  const byPrefixOnJersey = arr.filter((e) => e.first.startsWith(prefix));
  if (byPrefixOnJersey.length === 1) return byPrefixOnJersey[0].gsisId;
  if (arr.length === 1) return arr[0].gsisId;
  const byTeamLast = solo(maps.byTeamLast.get(`${team}|${last}`));
  if (byTeamLast) return byTeamLast;
  const byInitialLast = solo(maps.byInitialLast.get(`${prefix[0]}|${last}`));
  if (byInitialLast) return byInitialLast;
  return solo(maps.byLast.get(last));
}

export const INJURY_RE = /\b([A-Z]{2,3})-(\d{1,2})-([A-Z][A-Za-z'’.\-]*(?:\s(?:Jr|Sr|II|III|IV|V))?) was injured/g;

/** The designation the gamebook states right after the injury clause. */
export function extractStatus(after) {
  const m = after.match(/\b(?:He is|His return is|Is)\s+(Out|Questionable|Doubtful|Probable)\b/i);
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : null;
}

/**
 * The in-game events in one play row (a parsed play-by-play line), keyed by
 * the resolved GSIS id. A play can hurt two players.
 */
export function eventsFromPlay(cells, col, season, maps, unmapped) {
  const desc = cells[col("desc")] || "";
  if (!/was injured/.test(desc)) return [];
  const gameId = cells[col("game_id")];
  const home = cells[col("home_team")];
  const away = cells[col("away_team")];
  const week = cells[col("week")] ? Number(cells[col("week")]) : null;
  const seasonType = cells[col("season_type")] || "REG";
  const qtr = cells[col("qtr")] ? Number(cells[col("qtr")]) : null;
  const clock = cells[col("time")] || null;
  const date = cells[col("game_date")] || null;
  const out = [];
  INJURY_RE.lastIndex = 0;
  let m;
  while ((m = INJURY_RE.exec(desc)) !== null) {
    const [, rawTeam, jersey, playerToken] = m;
    const team = normTeam(rawTeam);
    const gsisId = resolveGsis(maps, team, jersey, playerToken, week);
    if (!gsisId) {
      unmapped?.push(`${season} wk ${week ?? "?"} ${team}-${jersey}-${playerToken}`);
      continue;
    }
    const tail = desc.slice(m.index + m[0].length, m.index + m[0].length + 60);
    out.push({
      gsisId,
      event: {
        season,
        week,
        seasonType,
        gameId,
        date,
        team,
        opponent: team === home ? away : home,
        qtr,
        clock,
        status: extractStatus(tail),
        desc: desc.length > 220 ? desc.slice(0, 217) + "…" : desc,
      },
    });
  }
  return out;
}

/** Newest first, identical plays collapsed: the repo's ordering for a player's events. */
export function sortEvents(events) {
  const seen = new Set();
  return events
    .filter((e) => {
      const k = `${e[3]}|${e[7]}|${e[8]}|${e[10]}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => b[0] - a[0] || (b[1] ?? 0) - (a[1] ?? 0) || (b[7] ?? 0) - (a[7] ?? 0));
}

export const packEvent = (e) => INGAME_KEYS.map((k) => e[k] ?? null);

/**
 * Replace one season's in-game events for every player. The season is
 * recomputed whole from play-by-play each run, so nothing of it is kept.
 */
export function mergeEvents(shards, season, eventsByGsis) {
  const touched = new Set();
  let dropped = 0;
  for (const shard of shards.values()) {
    for (const [gsisId, entry] of Object.entries(shard.players)) {
      const before = entry.g.length;
      entry.g = entry.g.filter((e) => e[0] !== season);
      if (entry.g.length !== before) {
        dropped += before - entry.g.length;
        touched.add(gsisId);
      }
    }
  }
  let added = 0;
  for (const [gsisId, events] of eventsByGsis) {
    const entry = entryFor(shards, gsisId);
    for (const e of events) entry.g.push(packEvent(e));
    touched.add(gsisId);
    added += events.length;
  }
  for (const gsisId of touched) {
    const entry = entryFor(shards, gsisId);
    entry.g = sortEvents(entry.g);
  }
  return { touched, added, dropped };
}

/* ------------------------------------------------------------- search index */

/**
 * Re-derive the touched players' index rows from their report rows: seasons,
 * count, and the name, position and team of the latest report (the repo's
 * rule). `facts` names a player the rows cannot (a first-ever report); an
 * index row already there keeps its name when no fact arrives.
 */
export function updateSearchIndex(index, shards, touched, facts) {
  const byId = new Map(index.map((r) => [r[0], r]));
  let added = 0;
  for (const gsisId of touched) {
    const entry = shards.get(shardKey(gsisId))?.players[gsisId];
    const rows = entry?.h ?? [];
    const existing = byId.get(gsisId);
    const fact = facts.get(gsisId);
    const name = fact?.fullName ?? existing?.[1];
    if (!name) continue;
    const seasons = rows.map((r) => r[0]).filter((s) => s != null);
    const first = seasons.length ? Math.min(...seasons) : existing?.[4] ?? null;
    const last = seasons.length ? Math.max(...seasons) : existing?.[5] ?? null;
    // The latest report carries the position and team; a 0-report player keeps the roster's.
    const latest = rows[0];
    const position = latest && fact && fact.season === latest[0] && fact.week === latest[1] ? fact.position ?? existing?.[2] ?? null : existing?.[2] ?? fact?.position ?? null;
    const team = latest && fact && fact.season === latest[0] && fact.week === latest[1] ? fact.team ?? existing?.[3] ?? null : existing?.[3] ?? fact?.team ?? null;
    const row = [gsisId, name, position, team, first, last, rows.length];
    if (existing) Object.assign(existing, row);
    else {
      index.push(row);
      byId.set(gsisId, row);
      added += 1;
    }
  }
  index.sort((a, b) => a[1].localeCompare(b[1]));
  return { added };
}

/**
 * The facts the index wants per player, from the reports: the latest report's
 * name, position and team (newest season, then newest week).
 */
export function latestFacts(reports) {
  const facts = new Map();
  for (const rep of reports) {
    const cur = facts.get(rep.gsisId);
    if (!cur || (rep.season ?? 0) > (cur.season ?? 0) || ((rep.season ?? 0) === (cur.season ?? 0) && (rep.week ?? 0) >= (cur.week ?? 0))) {
      facts.set(rep.gsisId, { fullName: rep.fullName, position: rep.position, team: rep.team, season: rep.season, week: rep.week });
    }
  }
  return facts;
}

/* ------------------------------------------------------------------- roster */

/**
 * Every player on the seasonal roster, for the two things the roster gives
 * that reports cannot: a Sleeper id for the headshot, and an index row for a
 * player who has never been on a report, so searching him finds him and the
 * panel says so instead of answering nothing.
 */
export function rosterPlayers(seasonalCsv) {
  const { header, rows } = parseCsv(seasonalCsv);
  const ci = (n) => header[n];
  const out = [];
  const seen = new Set();
  for (const r of rows) {
    const gsisId = cleanString(r[ci("gsis_id")]);
    if (!gsisId || seen.has(gsisId)) continue;
    seen.add(gsisId);
    out.push({
      gsisId,
      fullName: cleanString(r[ci("full_name")]) ?? [cleanString(r[ci("first_name")]), cleanString(r[ci("last_name")])].filter(Boolean).join(" "),
      position: cleanString(r[ci("position")]),
      team: cleanString(r[ci("team")]),
      sleeperId: ci("sleeper_id") != null ? cleanString(r[ci("sleeper_id")]) : null,
    });
  }
  return out;
}

/** Index rows for roster players the index has never seen: no seasons, zero reports. */
export function addRosterToIndex(index, roster) {
  const have = new Set(index.map((r) => r[0]));
  let added = 0;
  for (const p of roster) {
    if (have.has(p.gsisId) || !p.fullName) continue;
    index.push([p.gsisId, p.fullName, p.position, p.team, null, null, 0]);
    have.add(p.gsisId);
    added += 1;
  }
  if (added) index.sort((a, b) => a[1].localeCompare(b[1]));
  return { added };
}

/** Sleeper ids for index players who lack one, from the roster's crosswalk column. */
export function fillSleeperIds(ids, index, roster) {
  const bySleeper = new Map(roster.filter((p) => p.sleeperId && /^\d+$/.test(p.sleeperId)).map((p) => [p.gsisId, p.sleeperId]));
  let added = 0;
  for (const r of index) {
    if (ids[r[0]]) continue;
    const s = bySleeper.get(r[0]);
    if (s) {
      ids[r[0]] = s;
      added += 1;
    }
  }
  return { added };
}
