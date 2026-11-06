/**
 * Team colors for the team hub and the player pages (mak, 2026-11-05).
 *
 * The house navy and gold in team.css and player.css are wrapped as
 * var(--tp-..., <house color>) by scripts/team-palette.mjs, and a generated
 * block at the end of each stylesheet defines the --tp-* names on a root that
 * carries `data-team-palette`, from the --team-base / --team-accent /
 * --team-bright set here. A root without the attribute renders the house
 * colors exactly.
 */

import type { NflTeam } from "./teams";

/**
 * The hub wears the team's own colors instead of the house navy and gold
 * (mak, 2026-11-05: "use the TEAM'S colors"; New England first, then "do the
 * rest of the teams"). The root gets `data-team-palette` plus `--team-base`
 * and `--team-accent`, and the generated block at the end of team.css
 * (scripts/team-palette.mjs) maps every navy shade to the base and every gold
 * shade to the accent. A team listed here keeps the house colors.
 */
export const TEAM_PALETTE_OPT_OUT: ReadonlySet<string> = new Set<string>();

export function usesTeamPalette(abbreviation: string): boolean {
  return !TEAM_PALETTE_OPT_OUT.has(abbreviation.toLowerCase());
}

type Rgb = [number, number, number];
const hexRgb = (hex: string): Rgb => [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16)) as Rgb;
const rgbHex = (c: Rgb): string => "#" + c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("");
const mixRgb = (c: Rgb, to: Rgb, w: number): Rgb => c.map((x, i) => x + (to[i]! - x) * w) as Rgb;

function luminance(hex: string): number {
  const [r, g, b] = hexRgb(hex).map((x) => {
    const c = x / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

/** `hex` stepped toward `to` until `ok` holds (or all the way). */
function shift(hex: string, to: Rgb, ok: (h: string) => boolean): string {
  for (let w = 0; w <= 1.0001; w += 0.04) {
    const h = rgbHex(mixRgb(hexRgb(hex), to, w));
    if (ok(h)) return h;
  }
  return rgbHex(to);
}

/**
 * The two palette colors from the team's primary and secondary.
 *
 * base: the dark color under the heroes' and panel heads' white text, where
 * the house navy sat. The darker of the two team colors, darkened only until
 * white reads on it at 7:1 (the navy is ~15:1). So the Bengals and Broncos
 * draw black and navy with orange accents, and a bright-red Chiefs primary
 * deepens.
 *
 * If the accent falls short of 4.5:1 on the base, the base deepens first
 * (to the navy's depth at most), then the accent lifts for the rest.
 *
 * accent: the other color, where the gold sat. Gold did two jobs: kicker text
 * on the dark base and rules/icons on white. So the accent is lifted toward
 * white until it reads at 4.5:1 on the base (the Patriots' red), and darkened
 * until it shows at 1.8:1 on white (the Colts' white, the Rams' yellow).
 */
export function teamPalette(primary: string, secondary: string): { base: string; accent: string; bright: string } {
  const valid = (h: string) => /^#[0-9a-f]{6}$/i.test(h);
  if (!valid(primary)) return { base: "#0b2345", accent: "#d4af37", bright: "#176ab5" };
  const [dark, light] =
    valid(secondary) && luminance(secondary) < luminance(primary) && contrast(secondary, "#ffffff") >= 7
      ? [secondary, primary]
      : [primary, valid(secondary) ? secondary : "#d4af37"];
  let base = shift(dark, [0, 0, 0], (h) => contrast(h, "#ffffff") >= 7);
  let accent = light;
  if (contrast(accent, "#ffffff") < 1.8) accent = shift(accent, [0, 0, 0], (h) => contrast(h, "#ffffff") >= 1.8);
  // Short of 4.5 on the base: deepen the base first, no further than the house
  // navy's depth (~14:1 with white), so the accent keeps its true color (the
  // Dolphins' orange, the Buccaneers' pewter-orange); lift the accent only for
  // what is still missing.
  if (contrast(accent, base) < 4.5) {
    const deeper = shift(base, [0, 0, 0], (h) => contrast(accent, h) >= 4.5 || contrast(h, "#ffffff") >= 14);
    if (contrast(deeper, "#ffffff") <= 14.5) base = deeper;
  }
  if (contrast(accent, base) < 4.5) accent = shift(accent, [255, 255, 255], (h) => contrast(h, base) >= 4.5);
  // bright: the hero's lit middle, where the house had its bright blue. The
  // base's own team color as vivid as white text allows: a bright one (the
  // Chiefs' red) as it is when it reads at 4.5:1, a dark one (the Patriots'
  // navy) lifted toward white until it is no darker than 6:1.
  const bright =
    contrast(dark, "#ffffff") < 4.5
      ? shift(dark, [0, 0, 0], (h) => contrast(h, "#ffffff") >= 4.5)
      : contrast(dark, "#ffffff") > 6
        ? shift(dark, [255, 255, 255], (h) => contrast(h, "#ffffff") <= 6)
        : dark;
  return { base, accent, bright };
}

/** The root's ` data-team-palette` attribute, or "" for no team / an opted-out team. */
export function teamPaletteAttr(team: NflTeam | null | undefined): string {
  return team && usesTeamPalette(team.abbreviation) ? " data-team-palette" : "";
}

/** The root's palette custom properties (without the attribute they are inert). */
export function teamPaletteVars(team: NflTeam | null | undefined): string[] {
  if (!team || !usesTeamPalette(team.abbreviation)) return [];
  const p = teamPalette(team.primaryColor, team.secondaryColor);
  return [`--team-base:${p.base}`, `--team-accent:${p.accent}`, `--team-bright:${p.bright}`];
}

/** `hex` with its HSL lightness raised until `ok` holds; hue and saturation kept. */
function lighten(hex: string, ok: (h: string) => boolean): string {
  const [r, g, b] = hexRgb(hex).map((x) => x / 255) as Rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l0 = (max + min) / 2;
  const d = max - min;
  const raw = d === 0 ? 0 : d / (1 - Math.abs(2 * l0 - 1));
  // A near-neutral (the Raiders' and Steelers' black) stays near-neutral:
  // lifting its faint tint at full strength turns black into slate blue.
  const sat = raw < 0.4 ? raw * 0.3 : raw;
  let hue = 0;
  if (d !== 0) {
    if (max === r) hue = ((g - b) / d + 6) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
  }
  const fromHsl = (l: number): string => {
    const c = (1 - Math.abs(2 * l - 1)) * sat;
    const x = c * (1 - Math.abs((hue % 2) - 1));
    const m = l - c / 2;
    const seg: Rgb = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(hue) % 6] as Rgb;
    return rgbHex(seg.map((v) => (v + m) * 255) as Rgb);
  };
  for (let l = l0; l <= 1; l += 0.01) {
    const h = fromHsl(l);
    if (ok(h)) return h;
  }
  return hex;
}

/**
 * The player index's club header (mak's rankings-grid brief, 2026-11-06): a
 * gradient from the club's own primary to its dark base, with the accent as
 * a rule under it.
 *
 * head: the primary itself, darkened only until white text reads on it at
 * 4.5:1 - so the Panthers' header is Carolina blue and the Falcons' red,
 * where teamPalette()'s `bright` follows the darker color and would draw
 * both of them gray-black. deep: teamPalette()'s base (7:1 with white),
 * darkened a step.
 * accent: teamPalette()'s accent, which already reads on the base.
 */
export function teamHeaderColors(team: NflTeam | null | undefined): { head: string; deep: string; accent: string } {
  if (!team || !/^#[0-9a-f]{6}$/i.test(team.primaryColor)) {
    return { head: "#0b3a7a", deep: "#081e42", accent: "#d4af37" };
  }
  const p = teamPalette(team.primaryColor, team.secondaryColor);
  // A near-black primary (the Bears' navy, the Raiders' black) is lifted until
  // it is no darker than 10:1, by lightness so the hue survives (mixing
  // toward white grays the Bears' navy out), or the band is one flat color end to end.
  const head =
    contrast(team.primaryColor, "#ffffff") > 9
      ? lighten(team.primaryColor, (h) => contrast(h, "#ffffff") <= 10)
      : shift(team.primaryColor, [0, 0, 0], (h) => contrast(h, "#ffffff") >= 4.5);
  // A quarter of the way further toward black, so a club whose base IS its
  // primary (the Cardinals) still draws a gradient rather than a flat band.
  const deep = rgbHex(mixRgb(hexRgb(p.base), [0, 0, 0], 0.25));
  return { head, deep, accent: p.accent };
}
