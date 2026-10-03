/**
 * The recap's share image: a 1200×630 PNG per completed game, drawn as SVG and
 * rasterised with resvg in the site's own display face (Barlow Condensed,
 * shipped in assets/fonts under the OFL).
 *
 * Served at /og/<away-slug>-vs-<home-slug>-<season>-<round-slug>.png. The
 * first request draws it and writes it to data/og/; every later one reads the
 * file, so each game is drawn once - "at publish time", in effect - and a
 * redraw is a matter of deleting the file.
 *
 * shareImageSvg() is pure; renderShareImage() is the only part that touches
 * resvg or the disk.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { escapeHtml } from "../render";
import { dataPath } from "../data-dir";
import { heroSideColor, scoreboardResult, type ScoreboardGame } from "./scoreboard-hero";

export const SHARE_WIDTH = 1200;
export const SHARE_HEIGHT = 630;

export interface ShareImageInput {
  game: ScoreboardGame;
  /** The game's best PPR line, or null when the game has no player lines. */
  topScorer: { name: string; ppr: number } | null;
}

const NAVY = "#0F1E33";
const GOLD = "#FFA300";
const RAMS_BLUE = "#003594";
const DISPLAY = "Barlow Condensed";
const BODY = "Barlow";

function mix(hex: string, to: string, amount: number): string {
  const rgb = (h: string): number[] => {
    const n = Number.parseInt(h.replace("#", "").slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const a = rgb(hex);
  const b = rgb(to);
  return `#${a.map((v, i) => Math.round(v + (b[i]! - v) * amount).toString(16).padStart(2, "0")).join("")}`;
}

/** "Wild Card" from "NFC Wild Card"; "Week 7" stays. */
function roundOf(game: ScoreboardGame): string {
  return game.roundLabel.replace(/^(AFC|NFC)\s+/, "");
}

/** The alt text for the image, and og:image:alt / twitter:image:alt. */
export function shareImageAlt(input: ShareImageInput): string {
  const { game, topScorer } = input;
  const r = scoreboardResult(game);
  if (!r) return `${game.away.name} vs ${game.home.name}, ${game.seasonLabel} ${roundOf(game)}.`;
  const [w, l] = r.winner === "home" ? (["home", "away"] as const) : (["away", "home"] as const);
  const score =
    r.winner === null
      ? `Final score: ${game.away.name} ${r.away}, ${game.home.name} ${r.home}, ${game.seasonLabel} ${roundOf(game)}.`
      : `Final score: ${game[w].name} ${r[w]}, ${game[l].name} ${r[l]}, ${game.seasonLabel} ${roundOf(game)}.`;
  return topScorer ? `${score} Top fantasy scorer ${topScorer.name}, ${topScorer.ppr.toFixed(1)} PPR.` : score;
}

/** Shrinks a line's font until a rough width estimate fits. Condensed caps run about 0.5em a character. */
function fit(text: string, size: number, max: number, perChar = 0.5): number {
  const width = text.length * size * perChar;
  return width <= max ? size : Math.max(22, Math.floor((size * max) / width));
}

export function shareImageSvg(input: ShareImageInput): string {
  const { game, topScorer } = input;
  const r = scoreboardResult(game);
  const W = SHARE_WIDTH;
  const H = SHARE_HEIGHT;
  const away = heroSideColor(game.away.abbr);
  const home = heroSideColor(game.home.abbr);
  const venue = game.venue?.name ? ` · ${game.venue.name}` : "";
  const meta = `${game.seasonLabel} ${roundOf(game)}${venue}`;
  const scoreFill = (side: "away" | "home"): string =>
    !r || r.winner === side || r.winner === null ? "#FFFFFF" : mix(side === "away" ? away : home, "#FFFFFF", 0.45);
  const scoreOpacity = (side: "away" | "home"): string => (!r || r.winner === side || r.winner === null ? "1" : "0.8");
  const lines = Array.from({ length: Math.ceil(W / 48) }, (_, i) => `<rect x="${i * 48}" y="0" width="1" height="${H}"/>`).join("");
  const nameSize = Math.min(fit(game.away.name, 50, 470), fit(game.home.name, 50, 470));
  const strip = 510;
  const scorer = topScorer ? `${topScorer.name} · ${topScorer.ppr.toFixed(1)} PPR` : "Every player, scored";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="${NAVY}"/>` +
    // Each side's colour on its outer third, the inner edges slanted like the hero's.
    `<polygon points="0,0 470,0 390,${strip} 0,${strip}" fill="${away}"/>` +
    `<polygon points="810,0 ${W},0 ${W},${strip} 730,${strip}" fill="${home}"/>` +
    `<g fill="#FFFFFF" fill-opacity="0.06">${lines}</g>` +
    // The badge and the game line.
    `<rect x="60" y="52" width="104" height="42" rx="6" fill="${GOLD}"/>` +
    `<text x="112" y="83" text-anchor="middle" font-family="${DISPLAY}" font-weight="800" font-size="28" fill="#13233A" letter-spacing="1">FINAL</text>` +
    `<text x="184" y="83" font-family="${BODY}" font-weight="600" font-size="${fit(meta, 28, 950, 0.52)}" fill="#FFFFFF">${escapeHtml(meta)}</text>` +
    // The two clubs, then the scores under them.
    `<text x="60" y="190" font-family="${DISPLAY}" font-weight="700" font-size="${nameSize}" fill="#FFFFFF">${escapeHtml(game.away.name)}</text>` +
    `<text x="${W - 60}" y="190" text-anchor="end" font-family="${DISPLAY}" font-weight="700" font-size="${nameSize}" fill="#FFFFFF">${escapeHtml(game.home.name)}</text>` +
    (r
      ? `<text x="52" y="440" font-family="${DISPLAY}" font-weight="800" font-size="230" fill="${scoreFill("away")}" fill-opacity="${scoreOpacity("away")}">${r.away}</text>` +
        `<text x="${W - 52}" y="440" text-anchor="end" font-family="${DISPLAY}" font-weight="800" font-size="230" fill="${scoreFill("home")}" fill-opacity="${scoreOpacity("home")}">${r.home}</text>`
      : "") +
    // The white strip: the game's top fantasy scorer, and the product.
    `<rect x="0" y="${strip}" width="${W}" height="${H - strip}" fill="#FFFFFF"/>` +
    `<text x="60" y="${strip + 44}" font-family="${BODY}" font-weight="600" font-size="20" fill="#5B6778" letter-spacing="2">TOP FANTASY SCORER</text>` +
    `<text x="60" y="${strip + 90}" font-family="${DISPLAY}" font-weight="800" font-size="${fit(scorer, 40, 640)}" fill="#13233A">${escapeHtml(scorer)}</text>` +
    `<text x="${W - 60}" y="${strip + 44}" text-anchor="end" font-family="${BODY}" font-weight="600" font-size="20" fill="#5B6778" letter-spacing="2">FANTASY RECAP</text>` +
    `<text x="${W - 60}" y="${strip + 90}" text-anchor="end" font-family="${DISPLAY}" font-weight="800" font-size="40" fill="${RAMS_BLUE}">Redraft Command</text>` +
    `</svg>`
  );
}

/* --------------------------------------------------------------- raster */

function fontDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const dir of [path.resolve(here, "..", "assets", "fonts"), path.resolve(process.cwd(), "assets", "fonts")]) {
    if (fs.existsSync(path.join(dir, "BarlowCondensed-Bold.ttf"))) return dir;
  }
  return null;
}

const OG_DIR = dataPath("og");

/** The file name a game's image is saved and served under. */
export function shareImageFile(awaySlug: string, homeSlug: string, segment: string): string {
  return `${awaySlug}-vs-${homeSlug}-${segment}.png`;
}

/**
 * The PNG for one game: read from data/og/ when it has been drawn before,
 * drawn and written there when it has not.
 */
export async function renderShareImage(file: string, input: ShareImageInput): Promise<Buffer> {
  const saved = path.join(OG_DIR, file);
  try {
    return fs.readFileSync(saved);
  } catch {
    // Not drawn yet.
  }
  const { Resvg } = await import("@resvg/resvg-js");
  const dir = fontDir();
  const fonts = dir
    ? fs.readdirSync(dir).filter((f) => f.endsWith(".ttf")).map((f) => path.join(dir, f))
    : [];
  const png = new Resvg(shareImageSvg(input), {
    fitTo: { mode: "width", value: SHARE_WIDTH },
    font: {
      fontFiles: fonts,
      // Without the shipped faces, a condensed bold system face stands in.
      loadSystemFonts: fonts.length === 0,
      defaultFontFamily: fonts.length ? DISPLAY : "Arial Narrow",
    },
  })
    .render()
    .asPng();
  try {
    fs.mkdirSync(OG_DIR, { recursive: true });
    fs.writeFileSync(saved, png);
  } catch {
    // A read-only disk still serves the image; it is just drawn again next time.
  }
  return png;
}
