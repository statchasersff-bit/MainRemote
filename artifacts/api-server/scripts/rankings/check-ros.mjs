#!/usr/bin/env node
/**
 * Check a new rest-of-season board before it replaces data/rankings/ros-<season>.csv
 * (2026-11-20). The board is mak's: this checks the FILE, never the rankings.
 *
 *   node scripts/rankings/check-ros.mjs <candidate.csv> --date 2026-11-24 [--season 2026] [--install]
 *
 * Reads the candidate with the server's own parser and name resolver
 * (lib/rankings/rankings-data.ts), so what passes here is what the page prints.
 *
 * Errors (exit 1, nothing written):
 *   - header is not "Position,Final Rank,Player"
 *   - a line that the parser would silently drop (bad position, rank, empty name)
 *   - per position QB/RB/WR/TE: a rank repeated, a gap, not starting at 1,
 *     fewer rows than the page shows (QB 40, RB 50, WR 100, TE 40)
 *   - the same player twice at one position
 *   - --date missing, unparseable, or in the future
 * Warnings (printed, not fatal):
 *   - a shown player whose name + position matches no player page: it renders
 *     with no team and no profile link (fix the spelling, or accept it)
 *   - a player at two positions; K/DST rows (stored, not shown)
 *   - --date not later than the board being replaced
 * Also printed for the spot check: the top 12 per position and the biggest
 * moves against the current board.
 *
 * --install writes the CSV and its meta (updatedAt "Month D, YYYY" and
 * updatedAtIso = midnight US Eastern of --date, offset included) only when
 * there are no errors. The date shown on the page and the one the player
 * hubs' seven-day stale guard reads are then one value, never typed twice.
 * Nothing is published: commit, Publish and purge are separate steps.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importModule, cleanupBundles } from "../../tests/helpers/bundle.mjs";
import { metaFor } from "./ros-meta.mjs";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const VALUED = new Set(["--date", "--season"]);
const candidate = args.find((a, i) => !a.startsWith("--") && !VALUED.has(args[i - 1]));
const season = Number(opt("season") ?? 2026);
const dateArg = opt("date");

const errors = [];
const warnings = [];

async function main() {
  if (!candidate || !fs.existsSync(candidate)) {
    console.error("Usage: node scripts/rankings/check-ros.mjs <candidate.csv> --date YYYY-MM-DD [--season 2026] [--install]");
    return 2;
  }
  const rd = await importModule("lib/rankings/rankings-data");
  const csv = fs.readFileSync(candidate, "utf8").replace(/^﻿/, "");
  const lines = csv.split(/\r?\n/);

  if ((lines[0] ?? "").trim() !== "Position,Final Rank,Player") {
    errors.push(`header is "${(lines[0] ?? "").trim()}", expected "Position,Final Rank,Player"`);
  }

  // Lines the parser keeps vs lines it would drop without a word.
  const rows = rd.parseRankingsCsv(csv);
  const kept = rows.length;
  let other = 0;
  lines.slice(1).forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    const pos = t.split(",")[0].trim().toUpperCase();
    if (pos === "K" || pos === "DST") { other++; return; }
    if (rd.parseRankingsCsv(`x\n${t}`).length === 0) errors.push(`line ${i + 2} would be dropped: "${t}"`);
  });
  if (other) warnings.push(`${other} K/DST rows: stored, not shown (the board renders QB/RB/WR/TE)`);

  const seen = new Map();
  for (const pos of ["QB", "RB", "WR", "TE"]) {
    const list = rows.filter((r) => r.position === pos).sort((a, b) => a.rank - b.rank);
    const need = rd.POSITION_LIMITS[pos];
    if (list.length < need) errors.push(`${pos}: ${list.length} rows, the page shows ${need}`);
    // The first break only: one gap would otherwise report every rank after it.
    const breakAt = list.findIndex((r, i) => r.rank !== i + 1);
    if (breakAt !== -1) {
      const r = list[breakAt];
      errors.push(`${pos}: expected rank ${breakAt + 1}, found ${r.rank} (${r.name}) - ranks must run 1, 2, 3... with no repeats or gaps`);
    }
    const names = new Map();
    for (const r of list) {
      const key = rd.normalizeName(r.name);
      if (names.has(key)) errors.push(`${pos}: ${r.name} listed twice (ranks ${names.get(key)} and ${r.rank})`);
      names.set(key, r.rank);
      if (seen.has(key) && seen.get(key) !== pos) warnings.push(`${r.name} appears at ${seen.get(key)} and ${pos}`);
      seen.set(key, pos);
    }
    // What the page will print, resolved exactly as the server resolves it.
    const board = rd.buildPositionBoard(rows, pos, "ros");
    const unlinked = board.filter((p) => !p.slug);
    for (const p of unlinked) warnings.push(`${pos}${p.rank} ${p.name}: no player page matches this name and position - shown with no team and no link`);
    console.log(`${pos}: ${list.length} rows, ${board.length} shown, ${board.length - unlinked.length} linked. Top 12: ${board.slice(0, 12).map((p) => `${p.rank} ${p.name}${p.team ? ` (${p.team})` : ""}`).join(", ")}`);
  }

  // Date: one input, both meta fields derived from it.
  let meta = null;
  if (!dateArg || !/^\d{4}-\d{2}-\d{2}$/.test(dateArg) || Number.isNaN(Date.parse(`${dateArg}T12:00:00Z`))) {
    errors.push("--date YYYY-MM-DD is required: the day the board was finalized (Eastern)");
  } else {
    meta = metaFor(dateArg, season);
    if (Date.parse(meta.updatedAtIso) > Date.now()) errors.push(`--date ${dateArg} is in the future`);
  }

  // Against the board being replaced.
  const currentFile = path.join(APP, "data", "rankings", `ros-${season}.csv`);
  const currentMeta = path.join(APP, "data", "rankings", `ros-${season}.meta.json`);
  if (fs.existsSync(currentFile)) {
    const old = rd.parseRankingsCsv(fs.readFileSync(currentFile, "utf8"));
    const oldRank = new Map(old.map((r) => [`${r.position}|${rd.normalizeName(r.name)}`, r.rank]));
    const moves = rows
      .filter((r) => ["QB", "RB", "WR", "TE"].includes(r.position) && r.rank <= rd.POSITION_LIMITS[r.position])
      .map((r) => ({ r, was: oldRank.get(`${r.position}|${rd.normalizeName(r.name)}`) }))
      .map((m) => ({ ...m, delta: m.was === undefined ? null : m.was - m.r.rank }));
    const fresh = moves.filter((m) => m.delta === null).map((m) => `${m.r.position}${m.r.rank} ${m.r.name}`);
    const big = moves.filter((m) => m.delta !== null && Math.abs(m.delta) >= 5).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 15);
    console.log(`New to the shown board (${fresh.length}): ${fresh.slice(0, 20).join(", ")}${fresh.length > 20 ? ", ..." : ""}`);
    console.log(`Biggest moves: ${big.map((m) => `${m.r.position} ${m.r.name} ${m.was}->${m.r.rank}`).join(", ") || "none of 5+ places"}`);
    try {
      const prev = JSON.parse(fs.readFileSync(currentMeta, "utf8"));
      if (meta && prev.updatedAtIso && Date.parse(meta.updatedAtIso) <= Date.parse(prev.updatedAtIso)) {
        warnings.push(`--date ${dateArg} is not later than the current board's ${prev.updatedAt}`);
      }
      console.log(`Replacing the board of ${prev.updatedAt} (${old.length} rows).`);
    } catch {
      // No meta: nothing to compare.
    }
  }

  for (const w of warnings) console.log(`WARN  ${w}`);
  for (const e of errors) console.log(`ERROR ${e}`);
  if (meta) console.log(`Meta: ${JSON.stringify(meta)}`);
  console.log(`${kept} rows parsed; ${errors.length} errors, ${warnings.length} warnings.`);
  if (errors.length) return 1;

  if (flag("install")) {
    // Temp files then rename: a half-written CSV is never what the server reads,
    // and the meta lands with it. The previous pair stays in git history.
    const tmpCsv = `${currentFile}.tmp`;
    const tmpMeta = `${currentMeta}.tmp`;
    fs.writeFileSync(tmpCsv, csv.endsWith("\n") ? csv : `${csv}\n`);
    fs.writeFileSync(tmpMeta, `${JSON.stringify({ ...meta, source: `Rest-of-season board supplied by mak, finalized ${dateArg}; checked with scripts/rankings/check-ros.mjs.` }, null, 2)}\n`);
    fs.renameSync(tmpMeta, currentMeta);
    fs.renameSync(tmpCsv, currentFile);
    console.log(`Installed ${path.relative(APP, currentFile)} and ${path.relative(APP, currentMeta)}. Not published.`);
  }
  return 0;
}

let code = 1;
try {
  code = await main();
} catch (err) {
  console.error(err);
} finally {
  await cleanupBundles();
}
process.exit(code);
