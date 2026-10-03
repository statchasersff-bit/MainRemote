/**
 * Where the shipped data files are, resolved from this module rather than from
 * the working directory.
 *
 * THE BUG THIS FIXES. Three modules resolved their data as
 * `path.resolve(process.cwd(), "data", …)`, which is correct in development and
 * in the test harness - both start the process from the package directory - and
 * wrong on the deployment, where the process starts somewhere else. The
 * symptom was not an error: `readJson()` falls back to `{}` for a file it
 * cannot read, so the player index came back as an empty list, `/player/<slug>`
 * 404'd for everybody, `/embed/players.json` answered `{"count":0}` and the
 * rankings board rendered zero rows. Everything looked healthy and served
 * nothing.
 *
 * It was invisible for a second reason. The other two files reached this way -
 * `data/team-roster.json` and `data/player-teams.json` - are caches the app
 * refetches and rewrites when they are missing, so on the deployment they were
 * silently being rebuilt from Sleeper on every boot and the team pages looked
 * fine. Only the two directories of static, build-time data had no such
 * fallback, and those are exactly the two things that were empty.
 *
 * WHY __dirname AND NOT cwd. `public/` has always been resolved from
 * `__dirname` - see the routers - and `public/` has always worked on the
 * deployment. That is the whole diagnosis: two directories that sit side by
 * side in the package, one found and one not, differing only in how the path
 * was built. This resolves `data/` the same way `public/` is resolved.
 *
 * The cwd candidate stays last rather than being deleted. A future entry point
 * that runs the modules unbundled from some other layout would otherwise break
 * quietly, which is the failure this file exists to end.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * The first candidate that is a directory, or the first candidate outright.
 *
 * Falling back to the first rather than throwing is deliberate: a missing data
 * directory is already handled downstream - every reader has a default - and a
 * module that throws while being imported takes the whole server down instead
 * of degrading one tool. `dataDirStatus()` is how the absence is reported.
 */
function firstDirectory(candidates: string[]): string {
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {
      // Not there. Try the next one.
    }
  }
  return candidates[0] ?? path.resolve(process.cwd(), "data");
}

/**
 * The package's `data/` directory.
 *
 * Bundled, every module below src/ is inlined into `dist/index.mjs`, so `HERE`
 * is `<package>/dist` and the first candidate is the answer. Unbundled - a test
 * importing a single module, a script run with a loader - `HERE` is
 * `<package>/src/lib` and the second is.
 */
export const DATA_ROOT = firstDirectory([
  path.resolve(HERE, "..", "data"),
  path.resolve(HERE, "..", "..", "data"),
  path.resolve(process.cwd(), "data"),
]);

/** A path inside the data directory. */
export function dataPath(...parts: string[]): string {
  return path.join(DATA_ROOT, ...parts);
}

/**
 * What resolved, and whether the files that have no runtime fallback are there.
 *
 * Reported by `/api/status` so the question "is the deployment actually
 * carrying its data" can be answered from outside the box. It is the check
 * that would have turned this bug from an afternoon into a minute.
 */
export function dataDirStatus(): {
  root: string;
  exists: boolean;
  players: boolean;
  rankings: boolean;
  /** Seasons with stored recap box scores (data/matchup/boxscores). */
  boxscoreSeasons: number[];
} {
  const has = (...parts: string[]): boolean => {
    try {
      return fs.existsSync(dataPath(...parts));
    } catch {
      return false;
    }
  };

  return {
    root: DATA_ROOT,
    exists: has(),
    players: has("player", "indexed_players.json"),
    rankings: has("rankings"),
    boxscoreSeasons: (() => {
      try {
        return fs
          .readdirSync(dataPath("matchup", "boxscores"))
          .map((name) => /^(\d{4})\.json$/.exec(name)?.[1])
          .filter((year): year is string => Boolean(year))
          .map(Number)
          .sort();
      } catch {
        return [];
      }
    })(),
  };
}
