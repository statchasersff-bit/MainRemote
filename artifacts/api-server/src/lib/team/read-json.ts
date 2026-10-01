/**
 * A data JSON file, re-read when it changes on disk.
 *
 * The daily chain rewrites these files in place, and a stat is cheap next to
 * a render, so no tab needs a reload hook of its own. Shared by the usage and
 * coaching readers.
 */

import fs from "node:fs";

const loaded = new Map<string, { mtimeMs: number; doc: unknown }>();

export function readDataJson<T>(file: string): T | null {
  try {
    const { mtimeMs } = fs.statSync(file);
    const hit = loaded.get(file);
    if (hit && hit.mtimeMs === mtimeMs) return hit.doc as T;
    const doc = JSON.parse(fs.readFileSync(file, "utf8")) as T;
    loaded.set(file, { mtimeMs, doc });
    return doc;
  } catch {
    return null;
  }
}
