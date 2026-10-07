/**
 * Build the locally hosted team logo set.
 *
 *   node scripts/images/team-logos.mjs [--sheet out.png]
 *
 * For each of the 32 clubs this downloads the logo SVG from Wikipedia (the
 * one source with a vector of every current mark), runs it through svgo,
 * squares its viewBox so the file has the same 1:1 intrinsic shape the
 * Sleeper PNGs had (every <img width=22 height=22> and every CSS box in the
 * app was sized for a square), and writes it to public/team-logos/ under a
 * content-hashed name. src/lib/team-logo-files.ts is regenerated to map each
 * club to its file, and data/team-logos/sources.json records where every
 * file came from and under what licence Wikipedia lists it.
 *
 * Re-run when a club changes its mark. A changed file gets a new hash and
 * therefore a new URL, which is what lets the server cache the files for a
 * year.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { optimize } from "svgo";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..", "..");
const OUT_DIR = path.join(APP, "public", "team-logos");
const DATA_DIR = path.join(APP, "data", "team-logos");
const MAP_FILE = path.join(APP, "src", "lib", "team-logo-files.ts");
const UA = "StatChasers tooling (mak@statchasers.com)";

const TEAM_NAMES = {
  ari: "Arizona Cardinals", atl: "Atlanta Falcons", bal: "Baltimore Ravens",
  buf: "Buffalo Bills", car: "Carolina Panthers", chi: "Chicago Bears",
  cin: "Cincinnati Bengals", cle: "Cleveland Browns", dal: "Dallas Cowboys",
  den: "Denver Broncos", det: "Detroit Lions", gb: "Green Bay Packers",
  hou: "Houston Texans", ind: "Indianapolis Colts", jax: "Jacksonville Jaguars",
  kc: "Kansas City Chiefs", lac: "Los Angeles Chargers", lar: "Los Angeles Rams",
  lv: "Las Vegas Raiders", mia: "Miami Dolphins", min: "Minnesota Vikings",
  ne: "New England Patriots", no: "New Orleans Saints", nyg: "New York Giants",
  nyj: "New York Jets", phi: "Philadelphia Eagles", pit: "Pittsburgh Steelers",
  sea: "Seattle Seahawks", sf: "San Francisco 49ers", tb: "Tampa Bay Buccaneers",
  ten: "Tennessee Titans", was: "Washington Commanders",
};

/** Wikipedia file titles that do not follow "<Full name> logo.svg". */
const TITLE_OVERRIDES = {
  dal: "File:Dallas Cowboys.svg",
  lar: "File:LA Rams logo.svg",
  ten: "File:Tennessee Titans Logo 2026.svg",
};

/** Breathing room around the mark, so it sits in a box like the old PNGs did. */
const PADDING = 1.08;

function titleFor(abbr) {
  return TITLE_OVERRIDES[abbr] ?? `File:${TEAM_NAMES[abbr]} logo.svg`;
}

async function imageInfo(titles) {
  const url =
    "https://en.wikipedia.org/w/api.php?action=query&prop=imageinfo" +
    "&iiprop=url|size|mime|extmetadata&iiextmetadatafilter=LicenseShortName|Artist" +
    "&format=json&titles=" + encodeURIComponent(titles.join("|"));
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Wikipedia API ${res.status}`);
  const json = await res.json();
  const byTitle = new Map();
  for (const page of Object.values(json.query.pages)) {
    const info = page.imageinfo?.[0];
    if (info) byTitle.set(page.title, info);
  }
  return byTitle;
}

/** The root <svg> tag's attributes, as a map. */
function rootAttributes(svg) {
  const open = /<svg\b([^>]*)>/i.exec(svg);
  if (!open) throw new Error("no <svg> root");
  const attrs = {};
  for (const m of open[1].matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) attrs[m[1]] = m[2];
  return { open, attrs };
}

/** Rewrite the root so the drawing sits centred in a square viewBox. */
function squareViewBox(svg) {
  const { open, attrs } = rootAttributes(svg);
  let [minX, minY, w, h] = (attrs.viewBox ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (!(w > 0 && h > 0)) {
    w = parseFloat(attrs.width);
    h = parseFloat(attrs.height);
    minX = 0;
    minY = 0;
    if (!(w > 0 && h > 0)) throw new Error("no usable viewBox or width/height");
  }
  const side = Math.max(w, h) * PADDING;
  const box = [minX - (side - w) / 2, minY - (side - h) / 2, side, side]
    .map((n) => Number(n.toFixed(3)))
    .join(" ");
  const kept = Object.entries(attrs)
    .filter(([k]) => !["viewBox", "width", "height"].includes(k))
    .map(([k, v]) => `${k}="${v}"`)
    .join(" ");
  return svg.replace(open[0], `<svg ${kept} viewBox="${box}">`);
}

function optimizeSvg(svg) {
  const result = optimize(svg, {
    multipass: true,
    plugins: [
      // preset-default keeps the viewBox; removeDimensions drops width/height so
      // the squared viewBox below is the only statement of the file's shape.
      "preset-default",
      "removeDimensions",
    ],
  });
  return result.data;
}

/** Wikimedia rate-limits bursts (429): one file at a time, a pause between, one retry. */
async function download(url) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await new Promise((r) => setTimeout(r, attempt === 0 ? 900 : 8000));
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.ok) return res.text();
    if (res.status !== 429) throw new Error(`${url} -> ${res.status}`);
  }
  throw new Error(`${url} -> 429 after retries`);
}

async function main() {
  const sheet = process.argv.includes("--sheet")
    ? process.argv[process.argv.indexOf("--sheet") + 1]
    : null;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const abbrs = Object.keys(TEAM_NAMES);
  const titles = abbrs.map(titleFor);
  const info = new Map();
  for (let i = 0; i < titles.length; i += 16) {
    for (const [k, v] of await imageInfo(titles.slice(i, i + 16))) info.set(k, v);
  }

  const files = {};
  const sources = [];
  const previews = [];
  for (const abbr of abbrs) {
    const title = titleFor(abbr).replace(/_/g, " ");
    const meta = info.get(title);
    if (!meta) throw new Error(`${abbr}: ${title} not found on Wikipedia`);
    if (meta.mime !== "image/svg+xml") throw new Error(`${abbr}: ${title} is ${meta.mime}`);
    const sourceUrl = meta.url.replace(/\?.*$/, "");
    const raw = await download(sourceUrl);
    const svg = squareViewBox(optimizeSvg(raw));
    const hash = createHash("sha1").update(svg).digest("hex").slice(0, 8);
    const name = `${abbr}-${hash}.svg`;
    for (const old of fs.readdirSync(OUT_DIR)) {
      if (old.startsWith(`${abbr}-`) && old !== name) fs.unlinkSync(path.join(OUT_DIR, old));
    }
    fs.writeFileSync(path.join(OUT_DIR, name), svg);
    files[abbr] = `/team-logos/${name}`;
    sources.push({
      abbr,
      team: TEAM_NAMES[abbr],
      file: name,
      title,
      page: meta.descriptionurl,
      source: sourceUrl,
      license: meta.extmetadata?.LicenseShortName?.value ?? null,
      sourceBytes: meta.size,
      bytes: Buffer.byteLength(svg),
    });
    previews.push({ abbr, svg });
    process.stdout.write(`${abbr.padEnd(4)} ${name.padEnd(18)} ${String(meta.size).padStart(6)}B -> ${String(Buffer.byteLength(svg)).padStart(6)}B  ${meta.extmetadata?.LicenseShortName?.value ?? "?"}\n`);
  }

  fs.writeFileSync(
    path.join(DATA_DIR, "sources.json"),
    `${JSON.stringify({ builtAt: new Date().toISOString(), logos: sources }, null, 2)}\n`,
  );

  const lines = abbrs.map((abbr) => `  ${abbr}: "${files[abbr]}",`).join("\n");
  fs.writeFileSync(
    MAP_FILE,
    `/**\n * GENERATED by scripts/images/team-logos.mjs - do not edit by hand.\n *\n` +
      ` * The locally hosted team logo SVG for each club, keyed by Sleeper's\n` +
      ` * lowercase abbreviation. Paths are root-relative to this server and carry\n` +
      ` * a content hash, so they are cached for a year and change when the art\n` +
      ` * does. Pure data: imported by the browser bundles as well as the server.\n */\n\n` +
      `export const TEAM_LOGO_FILES: Readonly<Record<string, string>> = {\n${lines}\n};\n`,
  );

  if (sheet) {
    const { default: sharp } = await import("sharp");
    const cell = 96;
    const cols = 8;
    const rows = Math.ceil(previews.length / cols);
    const tiles = [];
    for (const [i, { abbr, svg }] of previews.entries()) {
      const png = await sharp(Buffer.from(svg), { density: 300 })
        .resize(cell - 8, cell - 8, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
        .png()
        .toBuffer();
      tiles.push({ input: png, left: (i % cols) * cell + 4, top: Math.floor(i / cols) * cell + 4 });
      void abbr;
    }
    await sharp({ create: { width: cols * cell, height: rows * cell, channels: 4, background: "#e9edf3" } })
      .composite(tiles)
      .png()
      .toFile(sheet);
    console.log(`contact sheet: ${sheet}`);
  }
  console.log(`${abbrs.length} logos -> ${path.relative(APP, OUT_DIR)}, map -> ${path.relative(APP, MAP_FILE)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
