/**
 * The team pages' share image: one 1200x630 PNG per club, its crest on its
 * own colors (mak, 2026-11-25: "agreed", each team its own share image).
 *
 * Why: every hub's featured image is the club's crest as an AVIF, which the
 * social networks cannot show, so Rank Math printed no og:image of its own and
 * the page-identity fallback put the StatChasers brand card on all 32 hubs and
 * their tabs, while the schema's primaryImageOfPage still named the AVIF. This
 * card is what og:image, twitter:image and primaryImageOfPage all name now
 * (statchasers-team-pages.php, statchasers_page_identity_image filter).
 *
 * Served at /og/team/<slug>.png, public like the recap images (the crawlers
 * that read og:image are not WordPress). Drawn on first request and kept in
 * data/og/team/; TEAM_SHARE_VERSION is part of the saved file name and of the
 * URL the plugin prints (?v=), so a design change is a version bump.
 * No season on the card, so it never goes stale.
 *
 * teamShareImageSvg() is pure; renderTeamShareImage() touches resvg and disk.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { escapeHtml } from "../render";
import { dataPath } from "../data-dir";
import { TEAM_LOGO_FILES } from "../team-logo-files";
import { teamHeaderColors } from "./palette";
import type { NflTeam } from "./teams";

export const TEAM_SHARE_WIDTH = 1200;
export const TEAM_SHARE_HEIGHT = 630;
/** Bump on any design change; the plugin prints it as ?v=. */
export const TEAM_SHARE_VERSION = "1";

const DISPLAY = "Barlow Condensed";
const BODY = "Barlow";
const NAVY = "#13233A";
const MUTED = "#5B6778";

/** og:image:alt / twitter:image:alt, and the schema caption. */
export function teamShareImageAlt(team: NflTeam): string {
  return `${team.fullName} logo on the StatChasers ${team.nickname} team hub`;
}

function publicDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const dir of [path.resolve(here, "..", "public"), path.resolve(here, "..", "..", "..", "public"), path.resolve(process.cwd(), "public")]) {
    if (fs.existsSync(path.join(dir, "team-logos"))) return dir;
  }
  return path.resolve(process.cwd(), "public");
}

/** The crest as a nested <svg> placed in a box, or "" when the file is missing. */
export function crestSvg(team: NflTeam, x: number, y: number, size: number, read = (p: string) => fs.readFileSync(p, "utf8")): string {
  const file = TEAM_LOGO_FILES[team.abbreviation];
  if (!file) return "";
  let raw: string;
  try {
    raw = read(path.join(publicDir(), file));
  } catch {
    return "";
  }
  const open = raw.match(/<svg\b[^>]*>/i);
  const close = raw.lastIndexOf("</svg>");
  if (!open || close < 0) return "";
  const viewBox = open[0].match(/viewBox="([^"]+)"/i)?.[1];
  if (!viewBox) return "";
  const inner = raw.slice((open.index ?? 0) + open[0].length, close);
  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
}

/** Shrinks a line's font until a rough width estimate fits. Condensed caps run about 0.5em a character. */
function fit(text: string, size: number, max: number, perChar = 0.5): number {
  const width = text.length * size * perChar;
  return width <= max ? size : Math.max(28, Math.floor((size * max) / width));
}

export function teamShareImageSvg(team: NflTeam, crest = crestSvg(team, 806, 112, 300)): string {
  const W = TEAM_SHARE_WIDTH;
  const H = TEAM_SHARE_HEIGHT;
  const { head, deep, accent } = teamHeaderColors(team);
  const strip = 510;
  const lines = Array.from({ length: Math.ceil(W / 48) }, (_, i) => `<rect x="${i * 48}" y="0" width="1" height="${strip}"/>`).join("");
  const nick = team.nickname.toUpperCase();
  const nickSize = fit(nick, 150, 600, 0.5);
  const citySize = fit(team.city.toUpperCase(), 56, 600, 0.5);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${head}"/><stop offset="1" stop-color="${deep}"/></linearGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#g)"/>` +
    `<g fill="#FFFFFF" fill-opacity="0.05">${lines}</g>` +
    // The slanted panel the team header draws, with the white crest well on it.
    `<polygon points="740,0 ${W},0 ${W},${strip} 660,${strip}" fill="#FFFFFF" fill-opacity="0.10"/>` +
    `<circle cx="956" cy="262" r="182" fill="#FFFFFF"/>` +
    crest +
    // The label, the club, its division.
    `<rect x="60" y="64" width="8" height="40" fill="${accent}"/>` +
    `<text x="84" y="96" font-family="${BODY}" font-weight="600" font-size="28" fill="#FFFFFF" letter-spacing="3">NFL TEAM HUB</text>` +
    `<text x="60" y="${210}" font-family="${DISPLAY}" font-weight="700" font-size="${citySize}" fill="#FFFFFF" fill-opacity="0.85">${escapeHtml(team.city.toUpperCase())}</text>` +
    `<text x="56" y="${210 + nickSize * 0.95}" font-family="${DISPLAY}" font-weight="800" font-size="${nickSize}" fill="#FFFFFF">${escapeHtml(nick)}</text>` +
    `<text x="60" y="${452}" font-family="${BODY}" font-weight="600" font-size="30" fill="#FFFFFF" fill-opacity="0.9">${escapeHtml(team.division)}</text>` +
    // The white strip: what the hub holds, and the site.
    `<rect x="0" y="${strip}" width="${W}" height="${H - strip}" fill="#FFFFFF"/>` +
    `<rect x="0" y="${strip}" width="${W}" height="6" fill="${accent}"/>` +
    `<text x="60" y="${strip + 74}" font-family="${BODY}" font-weight="600" font-size="26" fill="${MUTED}">Stats · Schedule · Depth Chart · Coaching · Fantasy Outlook</text>` +
    `<text x="${W - 60}" y="${strip + 78}" text-anchor="end" font-family="${DISPLAY}" font-weight="800" font-size="44" fill="${NAVY}">StatChasers</text>` +
    `</svg>`
  );
}

/* --------------------------------------------------------------- raster */

function fontDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const dir of [path.resolve(here, "..", "assets", "fonts"), path.resolve(here, "..", "..", "..", "assets", "fonts"), path.resolve(process.cwd(), "assets", "fonts")]) {
    if (fs.existsSync(path.join(dir, "BarlowCondensed-Bold.ttf"))) return dir;
  }
  return null;
}

const OG_DIR = dataPath("og", "team");

/** The PNG for one club: read from data/og/team/ when drawn before, drawn and saved when not. */
export async function renderTeamShareImage(team: NflTeam): Promise<Buffer> {
  const saved = path.join(OG_DIR, `${team.slug}-v${TEAM_SHARE_VERSION}.png`);
  try {
    return fs.readFileSync(saved);
  } catch {
    // Not drawn yet.
  }
  const { Resvg } = await import("@resvg/resvg-js");
  const dir = fontDir();
  const fonts = dir ? fs.readdirSync(dir).filter((f) => f.endsWith(".ttf")).map((f) => path.join(dir, f)) : [];
  const png = new Resvg(teamShareImageSvg(team), {
    fitTo: { mode: "width", value: TEAM_SHARE_WIDTH },
    font: {
      fontFiles: fonts,
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
