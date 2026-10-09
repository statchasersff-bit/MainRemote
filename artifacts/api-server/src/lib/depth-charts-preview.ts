/**
 * [statchasers_depth_charts] in the Replit preview. Development only.
 *
 * Every other tool on the dev bar is rendered by this server. The depth charts
 * are not: they are a self-contained PHP plugin
 * (wordpress-plugin/statchasers-depth-charts/) that renders on the WordPress
 * host, from a cache file the plugin's own refresh writes. There is no
 * TypeScript copy to call, and writing one would be a second renderer to keep
 * in step with the real one.
 *
 * So the preview runs the plugin itself. wordpress-plugin/tests/depth-charts/
 * preview-render.php boots the plugin against the same WordPress shims the
 * route tests use and prints the response for one URL as JSON; this module
 * calls it and maps the plugin's statchasers.com URLs onto the preview's own:
 *
 *   https://statchasers.com/nfl/nfl-depth-charts/...        -> /preview/depth-charts/...
 *   https://statchasers.com/nfl/teams/<slug>/depth-chart/   -> /team/<slug>/depth-chart/
 *   .../wp-content/plugins/statchasers-depth-charts/assets  -> /preview/depth-charts-assets/
 *   .../wp-content/uploads/statchasers/depth-charts.json    -> /preview/depth-charts-data.json
 *
 * The data is the snapshot in data/depth-charts/, written by
 * tests/depth-charts/snapshot.php - the plugin's own refresh run from here.
 * Re-run it to update the preview; the live site refreshes on its own.
 */

import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { DATA_ROOT } from "./data-dir";

const ORIGIN = "https://statchasers.com";
const LIVE_BASE = "/nfl/nfl-depth-charts/";
/** Where the plugin 301s its pre-1.7.0 team routes; this server's own hub route. */
const LIVE_TEAM_BASE = "/nfl/teams/";
const PREVIEW_TEAM_BASE = "/team/";
export const PREVIEW_BASE = "/preview/depth-charts/";
export const PREVIEW_ASSETS = "/preview/depth-charts-assets/";
export const PREVIEW_DATA = "/preview/depth-charts-data.json";

function firstExisting(candidates: string[]): string | null {
  return candidates.find((dir) => existsSync(dir)) ?? null;
}

const WP_PLUGIN_DIR = firstExisting([
  path.resolve(process.cwd(), "..", "..", "wordpress-plugin"),
  path.resolve(DATA_ROOT, "..", "..", "..", "wordpress-plugin"),
]);

/** The plugin's own directory, for serving its assets/ untouched. */
export const PLUGIN_DIR = WP_PLUGIN_DIR
  ? path.join(WP_PLUGIN_DIR, "statchasers-depth-charts")
  : null;

/** Where snapshot.php writes; the plugin's "uploads" base directory. */
export const SNAPSHOT_BASEDIR = path.join(DATA_ROOT, "depth-charts");
export const SNAPSHOT_FILE = path.join(SNAPSHOT_BASEDIR, "statchasers", "depth-charts.json");

/** PHP is not on PATH on this box; build-zip.sh looks in the Nix store too. */
function phpBinary(): string | null {
  if (process.env["PHP"]) return process.env["PHP"];
  for (const dir of (process.env["PATH"] ?? "").split(":")) {
    if (dir && existsSync(path.join(dir, "php"))) return path.join(dir, "php");
  }
  try {
    const hit = readdirSync("/nix/store")
      .filter((name) => name.includes("-php-with-extensions-"))
      .sort()
      .reverse()
      .map((name) => path.join("/nix/store", name, "bin", "php"))
      .find((bin) => existsSync(bin));
    return hit ?? null;
  } catch {
    return null;
  }
}

export interface DepthChartsRender {
  status: number;
  /** A preview path, already mapped, when the plugin redirects. */
  redirect: string | null;
  title: string;
  description: string;
  /** The host page's H1, as markup. */
  heading: string;
  /** The shortcode output, URLs mapped onto the preview. */
  fragment: string;
}

/** The plugin's statchasers.com URLs, pointed at the preview's routes. */
function mapUrls(html: string): string {
  return html
    .split(`${ORIGIN}/wp-content/plugins/statchasers-depth-charts/assets/`)
    .join(PREVIEW_ASSETS)
    .replace(
      /https:\/\/statchasers\.com\/wp-content\/uploads\/statchasers\/depth-charts\.json/g,
      PREVIEW_DATA,
    )
    .split(`${ORIGIN}${LIVE_BASE}`)
    .join(PREVIEW_BASE)
    .split(`${ORIGIN}${LIVE_TEAM_BASE}`)
    .join(PREVIEW_TEAM_BASE);
}

/**
 * Render the URL the plugin would see for `rest` - whatever follows
 * /preview/depth-charts/ - plus the query string.
 */
export function renderDepthCharts(rest: string, query: string): Promise<DepthChartsRender> {
  return new Promise((resolve, reject) => {
    const php = phpBinary();
    if (!php || !WP_PLUGIN_DIR) {
      reject(new Error(php ? "wordpress-plugin/ not found" : "no php binary found"));
      return;
    }
    const livePath = LIVE_BASE + rest + (query ? `?${query}` : "");
    execFile(
      php,
      [path.join(WP_PLUGIN_DIR, "tests", "depth-charts", "preview-render.php"), livePath, SNAPSHOT_BASEDIR],
      { timeout: 15_000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`preview-render.php: ${err.message}${stderr ? ` - ${stderr.slice(-500)}` : ""}`));
          return;
        }
        try {
          const raw = JSON.parse(stdout) as DepthChartsRender;
          resolve({
            ...raw,
            redirect: raw.redirect ? mapUrls(raw.redirect) : null,
            heading: mapUrls(raw.heading),
            fragment: mapUrls(raw.fragment),
          });
        } catch (parseErr) {
          reject(new Error(`preview-render.php printed something other than JSON: ${String(parseErr)} - ${stdout.slice(0, 300)}`));
        }
      },
    );
  });
}
