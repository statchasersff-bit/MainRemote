#!/usr/bin/env node
/**
 * The id crosswalk for the indexed players bio_sources.json does not carry.
 *
 * Team and matchup pages link a player by id (src/lib/team/links.ts,
 * playerProfileUrl): an ESPN, GSIS or PFR id is translated to the Sleeper id
 * the site's slugs are keyed by, and a name is never used once an id is in
 * hand. The translation comes from bio_sources.json's `ids`, which covers the
 * players the Bio build ran over - so an indexed player added after the last
 * Bio build has no ESPN or GSIS id there, and every id-keyed row naming him
 * would print as plain text.
 *
 * This fills that gap from the stored files, and only with what they agree on:
 *
 *  - a candidate id is taken from a source row whose name (suffix folded),
 *    club and position group all match the indexed player's;
 *  - each source must hold exactly one such row (a name two people share on
 *    one club is left alone);
 *  - every source that names an id of one kind must name the same one;
 *  - the id must not already belong to someone else in bio_sources.json or
 *    sleeper-ids.json.
 *
 * Anything short of that is written as unresolved with the reason, never as a
 * guess. Team defenses (Sleeper id = the club code) have no person ids and are
 * listed as such.
 *
 * Writes data/player/id_crosswalk_recovered.json. Hand-run after an index
 * rebuild that adds players; the server reads the file at boot.
 *
 *   node scripts/player/buildIdCrosswalk.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { APP_DIR, DATA_DIR } from "./paths.mjs";

const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const data = (...p) => path.join(APP_DIR, "data", ...p);

const key = (name) =>
  String(name ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/ (jr|sr|ii|iii|iv|v)$/, "");

const OFFENSE = new Set(["QB", "RB", "FB", "WR", "TE"]);
const KICK = new Set(["K", "PK", "P"]);
const group = (pos) => {
  const p = String(pos ?? "").toUpperCase();
  if (!p) return null;
  if (OFFENSE.has(p)) return "off";
  if (KICK.has(p)) return "kick";
  return "other";
};
const teamCode = (t) => {
  const c = String(t ?? "").toUpperCase();
  return { JAC: "JAX", WSH: "WAS", LA: "LAR", OAK: "LV", SD: "LAC", STL: "LAR" }[c] ?? c;
};

const players = read(path.join(DATA_DIR, "players.json"));
const indexed = read(path.join(DATA_DIR, "indexed_players.json")).slugs;
const bio = read(path.join(DATA_DIR, "bio_sources.json")).players;
const gsisToSleeper = read(data("injury-impact", "sleeper-ids.json"));

// Who already owns which id.
const owner = { espn: new Map(), gsis: new Map(), pfr: new Map() };
for (const entry of Object.values(bio)) {
  const ids = entry?.ids ?? {};
  if (!ids.sleeper) continue;
  for (const kind of Object.keys(owner)) if (ids[kind]) owner[kind].set(String(ids[kind]), String(ids.sleeper));
}
for (const [g, s] of Object.entries(gsisToSleeper)) if (!owner.gsis.has(g)) owner.gsis.set(g, String(s));

/* ------------------------------------------------------------- the sources */

// Each source: rows of { name, team, pos, kind, id }.
const sources = {};

// Contracts (OverTheCap), GSIS id per row, by club: every list the club's
// record holds (the signed players and the pending ones).
sources.contracts = [];
for (const [club, t] of Object.entries(read(data("team", "contracts_2026.json")).teams ?? {})) {
  for (const list of Object.values(t ?? {})) {
    if (!Array.isArray(list)) continue;
    for (const p of list) if (p?.gsisId) sources.contracts.push({ name: p.name, team: teamCode(club), pos: p.position, kind: "gsis", id: p.gsisId });
  }
}

// The team usage report (nflverse), GSIS id per row, by club.
sources.usage = [];
for (const [club, t] of Object.entries(read(data("team", "usage_2026.json")).teams ?? {})) {
  for (const p of t.players ?? []) if (p.id) sources.usage.push({ name: p.name, team: teamCode(club), pos: p.pos, kind: "gsis", id: p.id });
}

// The injury-impact search index: [gsis, name, pos, team, ...] - the club is
// the player's last one in that store.
sources.injuryIndex = [];
for (const row of read(data("injury-impact", "search-index.json"))) {
  if (row?.[0]) sources.injuryIndex.push({ name: row[1], team: teamCode(row[3]), pos: row[2], kind: "gsis", id: row[0] });
}

// The depth-chart tool's document: ESPN athlete id in every headshot URL.
sources.depthCharts = [];
for (const t of read(data("depth-charts", "statchasers", "depth-charts.json")).teams ?? []) {
  const club = teamCode(t.team?.abbr);
  const seen = new Set();
  const add = (p, pos) => {
    const m = /\/full\/(\d+)\.png/.exec(p?.headshot ?? "");
    if (!m) return;
    const k = `${key(p.name)}|${m[1]}`;
    if (seen.has(k)) return;
    seen.add(k);
    sources.depthCharts.push({ name: p.name, team: club, pos, kind: "espn", id: m[1] });
  };
  for (const [pos, rows] of Object.entries(t.positions ?? {})) for (const p of rows ?? []) add(p, pos.replace(/^FAN_/, ""));
  for (const slot of t.slots ?? []) for (const p of slot.players ?? []) add(p, null);
}

// ESPN box scores, this season and last: athlete id and the side he played for.
sources.boxscores = [];
for (const season of [2025, 2026]) {
  let doc;
  try {
    doc = read(data("matchup", "boxscores", `${season}.json`));
  } catch {
    continue;
  }
  const seen = new Set();
  for (const g of Object.values(doc.games ?? {})) {
    for (const side of g.summary?.boxscore?.players ?? []) {
      const club = teamCode(side.team?.abbreviation);
      for (const cat of side.statistics ?? []) {
        for (const a of cat.athletes ?? []) {
          const id = a.athlete?.id;
          if (!id) continue;
          const k = `${club}|${id}`;
          if (seen.has(k)) continue;
          seen.add(k);
          sources.boxscores.push({ name: a.athlete.displayName, team: club, pos: null, kind: "espn", id: String(id) });
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ match */

const bySlug = new Map(players.map((p) => [p.slug, p]));
const out = { generatedAt: new Date().toISOString(), note: "Built by scripts/player/buildIdCrosswalk.mjs; see the script for the rules.", players: {}, unresolved: {} };

for (const slug of indexed) {
  if (bio[slug]?.ids?.sleeper) continue;
  const p = bySlug.get(slug);
  if (!p) {
    out.unresolved[slug] = { reason: "not in players.json" };
    continue;
  }
  if (p.position === "DEF") {
    out.unresolved[slug] = { sleeper: p.id, reason: "team defense; no person ids" };
    continue;
  }
  const k = key(p.name);
  const club = teamCode(p.team);
  const g = group(p.position);
  const found = { espn: new Map(), gsis: new Map() };
  const notes = [];
  for (const [source, rows] of Object.entries(sources)) {
    const hits = rows.filter(
      (r) => key(r.name) === k && r.team === club && (group(r.pos) === null || group(r.pos) === g),
    );
    const ids = [...new Set(hits.map((h) => h.id))];
    if (ids.length === 0) continue;
    if (ids.length > 1) {
      notes.push(`${source}: ${ids.length} rows with this name on ${club}, skipped`);
      continue;
    }
    const kind = hits[0].kind;
    if (!found[kind].has(ids[0])) found[kind].set(ids[0], []);
    found[kind].get(ids[0]).push(source);
  }
  const ids = {};
  const evidence = {};
  for (const kind of ["espn", "gsis"]) {
    if (found[kind].size === 0) continue;
    if (found[kind].size > 1) {
      notes.push(`${kind}: sources disagree (${[...found[kind].keys()].join(", ")}), skipped`);
      continue;
    }
    const [id, from] = [...found[kind].entries()][0];
    const held = owner[kind].get(id);
    if (held && held !== p.id) {
      notes.push(`${kind} ${id} already belongs to Sleeper ${held}, skipped`);
      continue;
    }
    ids[kind] = id;
    evidence[kind] = from;
  }
  if (Object.keys(ids).length) {
    out.players[slug] = { sleeper: p.id, name: p.name, team: club, pos: p.position, ids, evidence, ...(notes.length ? { notes } : {}) };
  } else {
    out.unresolved[slug] = { sleeper: p.id, name: p.name, team: club, pos: p.position, reason: notes.join("; ") || "no source row with this name, club and position" };
  }
}

const file = path.join(DATA_DIR, "id_crosswalk_recovered.json");
fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
console.log(
  `wrote ${path.relative(APP_DIR, file)}: ${Object.keys(out.players).length} recovered, ${Object.keys(out.unresolved).length} unresolved`,
);
