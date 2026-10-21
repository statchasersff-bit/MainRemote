/**
 * Small parts the injury pages share: headings, the answer card, the fantasy
 * note, position and status chips, avatars, team crests, selects, and the
 * page words. House dress (injury-impact.css), the app's structure.
 */

import { escapeHtml, escapeJsonLd, teamLogoAssetUrl } from "../render";
import { headshotPath } from "../image-urls";
import { initials } from "./player";
import { posColor } from "./model";
import type { InjuryAssets } from "./types";

export interface InjuryRenderOptions {
  /** Inside a statchasers.com page: no H1 (the page prints it) and a page-data island. */
  embed?: boolean;
  /** Where the bundle loads data slices from. */
  dataUrl?: string;
  /** Where the browser finds this server's images. */
  assets?: InjuryAssets;
  /** The sibling page's address, for the cross-links between the two tools. */
  siblingUrl?: string;
}

export interface Widths {
  full: number;
  half: number;
}

export const DEFAULT_WIDTHS: Widths = { full: 900, half: 440 };

export const EMPTY_ASSETS: InjuryAssets = { origin: "", headshots: {}, sleeper: {} };

export type InjuryPage = "analysis" | "database";

/**
 * The pages' words. No statchasers.com page mounts these tools yet, so these
 * are the app's own: its H1s and the lead sentences under them. New wording
 * for search needs mak's approval before it changes.
 */
export function injuryPageCopy(page: InjuryPage): { title: string; h1: string; description: string } {
  if (page === "database") {
    return {
      title: "NFL Injury Database - StatChasers",
      h1: "NFL Injury Database",
      description: "Every drafted-player injury season in the study, searchable and filterable. Click any player to open their full weekly injury-report and in-game injury history.",
    };
  }
  return {
    title: "Fantasy Football Injury Risk Analysis - StatChasers",
    h1: "Fantasy Football Injury Risk Analysis",
    description: "Which players are most likely to get hurt, which injuries matter most, and how should fantasy managers price that risk into draft decisions?",
  };
}

export function renderMetaIsland(page: InjuryPage, options: InjuryRenderOptions): string {
  if (!options.embed) return "";
  return `<script type="application/json" class="scin-page-data">${escapeJsonLd(JSON.stringify(injuryPageCopy(page)))}</script>`;
}

/* --------------------------------------------------------------- headings */

export function h2(title: string, cls = ""): string {
  return `<h2 class="scin-h2${cls ? ` ${cls}` : ""}">${escapeHtml(title)}</h2>`;
}

export function h3(title: string): string {
  return `<h3 class="scin-h3">${escapeHtml(title)}</h3>`;
}

export function eyebrow(text: string, gold = true): string {
  return `<p class="scin-eyebrow${gold ? " is-gold" : ""}">${escapeHtml(text)}</p>`;
}

export function note(html: string, cls = ""): string {
  return `<p class="scin-note${cls ? ` ${cls}` : ""}">${html}</p>`;
}

/** The direct-answer card that opens every research question. */
export function verdict(answer: string, detail = ""): string {
  return `<div class="scin-verdict"><p class="scin-verdict-eyebrow">Answer</p><p class="scin-verdict-answer">${answer}</p>${detail ? `<p class="scin-verdict-detail">${detail}</p>` : ""}</div>`;
}

/** The one-line fantasy takeaway that closes a question. */
export function fantasyNote(html: string): string {
  return `<div class="scin-fantasy"><p class="scin-fantasy-eyebrow">Fantasy implication</p><p class="scin-fantasy-body">${html}</p></div>`;
}

/** A callout list item: numbered, with a gold rule. */
export function calloutList(items: string[], numbered = true): string {
  const tag = numbered ? "ol" : "ul";
  return `<${tag} class="scin-callouts">${items.map((c, i) => `<li>${numbered ? `<span class="scin-callout-n">${i + 1}.</span>` : ""}<span>${c}</span></li>`).join("")}</${tag}>`;
}

/**
 * Text from the datasets, in the house's typography: the app wrote " — " in
 * its sentences and "—" as a placeholder; here a spaced dash is a comma and a
 * bare one a hyphen, and an en dash in a range is a hyphen.
 */
export function houseText(text: string): string {
  return text
    .replace(/\s+—\s+/g, ", ")
    .replace(/—/g, "-")
    .replace(/–/g, "-")
    // No source names in the page source (house rule): the feeds mirror the league's own records.
    .replace(/\bnflverse\b/gi, "official league");
}

/** A position's ink. */
export const posColorOf = (pos: string): string => posColor(pos);

/** A position's color on any text: "RBs" in the RB green. */
export function posText(pos: string, text: string): string {
  return `<span class="scin-pos" style="color:${posColor(pos)}">${escapeHtml(text)}</span>`;
}

/** `**bold**` segments into <strong>; everything else escaped. */
export function boldText(text: string): string {
  return text
    .split("**")
    .map((part, i) => (i % 2 ? `<strong>${escapeHtml(part)}</strong>` : escapeHtml(part)))
    .join("");
}

export function smallSample(title = "Based on 1-2 injuries. Interpret with caution"): string {
  return `<span class="scin-badge is-amber" title="${escapeHtml(title)}">small sample</span>`;
}

export function posSpan(pos: string): string {
  return `<span class="scin-pos" style="color:${posColor(pos)}">${escapeHtml(pos)}</span>`;
}

/** A segmented group of buttons, navy when on. */
export function segmented(name: string, options: { value: string; label: string }[], current: string, extra = ""): string {
  return (
    `<div class="scin-seg${extra ? ` ${extra}` : ""}" role="group">` +
    options
      .map((o) => `<button type="button" class="scin-seg-btn${o.value === current ? " is-active" : ""}" data-${name}="${escapeHtml(o.value)}" aria-pressed="${o.value === current}">${escapeHtml(o.label)}</button>`)
      .join("") +
    `</div>`
  );
}

export function select(name: string, options: { value: string; label: string }[], current: string, label: string, extra = ""): string {
  return (
    `<select class="scin-select${extra ? ` ${extra}` : ""}" data-${name} aria-label="${escapeHtml(label)}">` +
    options.map((o) => `<option value="${escapeHtml(o.value)}"${o.value === current ? " selected" : ""}>${escapeHtml(o.label)}</option>`).join("") +
    `</select>`
  );
}

export function labeled(label: string, control: string, extra = ""): string {
  return `<label class="scin-field${extra ? ` ${extra}` : ""}"><span class="scin-field-label">${escapeHtml(label)}</span>${control}</label>`;
}

export function sortIcon(active: boolean, dir: "asc" | "desc"): string {
  if (!active) return `<svg class="scin-sort-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M5 6.5L8 3.5l3 3M5 9.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const d = dir === "asc" ? "M4 10l4-4 4 4" : "M4 6l4 4 4-4";
  return `<svg class="scin-sort-icon is-on" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export function chevron(): string {
  return `<svg class="scin-chev" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/** A collapsed fold; `open` names are kept across redraws by the bundle. */
export function fold(id: string, summary: string, body: string, open: boolean, sub = ""): string {
  return (
    `<details class="scin-fold" data-fold="${escapeHtml(id)}"${open ? " open" : ""}><summary class="scin-fold-summary">${chevron()}<span class="scin-fold-text"><strong>${escapeHtml(summary)}</strong>${sub ? `<span>${escapeHtml(sub)}</span>` : ""}</span></summary>` +
    `<div class="scin-fold-body">${body}</div></details>`
  );
}

/* ---------------------------------------------------------------- images */

/** The house crest for a team code of the injury data ("LA" is the Rams, "WAS" the Commanders). */
export function teamCrest(team: string | null | undefined, origin: string): string {
  if (!team) return "";
  const code = team === "LA" ? "lar" : team.toLowerCase();
  const url = teamLogoAssetUrl(code, origin);
  return url ? `<img class="scin-crest" src="${escapeHtml(url)}" alt="" width="20" height="20" loading="lazy" decoding="async" />` : "";
}

/** A player's headshot from this server's pipeline, or their initials. */
export function avatar(gsisId: string | null, name: string, assets: InjuryAssets, size = 28): string {
  const sleeper = gsisId ? assets.sleeper[gsisId] : undefined;
  const text = initials(name) || "-";
  if (!sleeper || assets.headshots[sleeper] === null) {
    return `<span class="scin-avatar is-text" style="--scin-av:${size}px" aria-hidden="true">${escapeHtml(text)}</span>`;
  }
  const version = assets.headshots[sleeper];
  const url = `${assets.origin}${headshotPath(sleeper, version, "160")}`;
  return `<span class="scin-avatar" style="--scin-av:${size}px"><img src="${escapeHtml(url)}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async" data-fallback="${escapeHtml(text)}" /></span>`;
}

/* -------------------------------------------------------------- numbers */

export const n0 = (v: number | null | undefined): string => (v == null ? "-" : Math.round(v).toLocaleString("en-US"));
export const n1 = (v: number | null | undefined): string => (v == null ? "-" : v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
export const n2 = (v: number | null | undefined): string => (v == null ? "-" : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const pctF = (v: number | null | undefined, digits = 0): string => (v == null ? "-" : `${(v * 100).toFixed(digits)}%`);
export const pctRaw = (v: number | null | undefined, digits = 0): string => (v == null ? "-" : `${v.toFixed(digits)}%`);
export const signed1 = (v: number): string => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;
