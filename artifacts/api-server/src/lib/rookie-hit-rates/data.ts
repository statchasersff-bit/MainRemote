/**
 * The rookie hit rate dataset, read: data/rookie-hit-rates/hit-rates.json,
 * packed by scripts/rookie-hit-rates/buildData.mjs from the standalone app's
 * committed CSVs. Static history - the newest class is judged only on seasons
 * already played - so it is re-read when the file changes and never fetched.
 */

import fs from "node:fs";
import { dataPath } from "../data-dir";
import { getPlayerProfileUrl } from "../team/links";
import type { PackedDataset } from "./model";

export * from "./model";

interface Memo {
  mtimeMs: number;
  data: PackedDataset | null;
  version: string;
}

let memo: Memo | null = null;
let profilesMemo: { version: string; at: number; profiles: Record<string, string> } | null = null;

/** The player dictionary is rebuilt daily; a few hours stale costs a link, not a wrong one. */
const PROFILES_TTL_MS = 6 * 60 * 60 * 1000;

export function rhrDataPath(): string {
  return dataPath("rookie-hit-rates", "hit-rates.json");
}

/** Short, stable, non-cryptographic - this only has to differ, not resist. */
function hash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i += 1) {
    h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function read(): Memo {
  const file = rhrDataPath();
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return (memo = { mtimeMs: 0, data: null, version: "empty" });
  }
  if (memo && memo.mtimeMs === stat.mtimeMs) return memo;
  let data: PackedDataset | null = null;
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(text) as PackedDataset;
    data = Array.isArray(parsed.players) && parsed.boards && Array.isArray(parsed.seasons) ? parsed : null;
  } catch {
    data = null;
  }
  return (memo = { mtimeMs: stat.mtimeMs, data, version: data ? hash(text) : "empty" });
}

/** The dataset, or null when the file is missing or unreadable. */
export function getRhrData(): PackedDataset | null {
  return read().data;
}

/** Moves whenever the file's bytes do: the ETag of every rendering. */
export function rhrDataVersion(): string {
  return read().version;
}

/**
 * Each player's statchasers.com profile, for the drawer's link - only for a
 * name the site's player dictionary resolves, so a link never 404s
 * (getPlayerProfileUrl). Computed, not stored: the dictionary moves daily
 * and the dataset does not.
 */
export function rhrProfiles(): Record<string, string> {
  const { data, version } = read();
  if (!data) return {};
  if (profilesMemo && profilesMemo.version === version && Date.now() - profilesMemo.at < PROFILES_TTL_MS) {
    return profilesMemo.profiles;
  }
  const profiles: Record<string, string> = {};
  for (const p of data.players) {
    const url = getPlayerProfileUrl(p[1]);
    if (url) profiles[p[0]] = url;
  }
  profilesMemo = { version, at: Date.now(), profiles };
  return profiles;
}
