/**
 * The premium comparison versions of Rushing Direction and Passing
 * Distribution (mak's brief, 2026-11-05, and the fidelity revision the same
 * day): the SAME data and the same copy as the current blocks in
 * usage-render.ts, presented as a dashboard - a navy gradient title bar with
 * a dimensional gold icon tile and stripes at its right, elevated cards with
 * a pill label, a large lead number and a share bar, the best cell in cream
 * and gold, an insight strip with the existing note bolded the way it
 * already is, and a quieter footnote.
 *
 * Rendered directly UNDER each current block while USAGE_PREMIUM_COMPARE is
 * on, so old and new sit on one page for comparison. Nothing here is a new
 * number: every figure is read from the view exactly as the current block
 * reads it. The deep card's field grid and route are a directional
 * illustration (the side is the zone's, the rise follows its share), not a
 * plot of where the throws went; the short card's bars are a motif whose
 * lead bar is the share, not a histogram.
 *
 * Headings use .sct-us-prm-title, not .sct-us-h3, so the tab's section list
 * (and the test that pins it) is unchanged.
 *
 * (Restored 2026-11-05 after a parallel session overwrote the file; that
 * session's module lives in usage-premium-dashboard.ts.)
 */

import { escapeHtml as e } from "../render";
import type { RunGap, UsageView, Zone } from "./usage";
import { surname } from "./usage";
import { bestGap, bestZone, GAP_LABEL, passNote, runNote, ZONE_LABEL, zoneOwner } from "./usage-copy";

/** Flip off to drop the comparison blocks without touching the current ones. */
export const USAGE_PREMIUM_COMPARE = true;

const md = (text: string) => e(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

const GAPS: RunGap[] = ["LE", "LT", "MID", "RT", "RE"];
const DEEP: Zone[] = ["DL", "DM", "DR"];
const SHORT: Zone[] = ["SL", "SM", "SR"];

/* ------------------------------------------------------------------ atoms */

const ICON_RUN =
  `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">` +
  `<path d="M4 12h12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>` +
  `<path d="M13 7l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<path d="M4 6v12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".55"/>` +
  `</svg>`;

const ICON_PASS =
  `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">` +
  `<path d="M4 18c3-9 9-13 16-13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>` +
  `<circle cx="20" cy="5" r="2.2" fill="currentColor"/>` +
  `<path d="M4 18h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".45"/>` +
  `</svg>`;

const ICON_INSIGHT =
  `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">` +
  `<path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2V17h5v-1.2c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>` +
  `<path d="M10 20h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>` +
  `</svg>`;

const ICON_STAR =
  `<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" focusable="false">` +
  `<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" fill="currentColor"/>` +
  `</svg>`;

/** The laurel on the best gap: two leaf arcs around the "#1 YPC" mark. */
const ICON_LAUREL =
  `<svg viewBox="0 0 48 40" width="48" height="40" aria-hidden="true" focusable="false">` +
  `<path d="M12 6c-6 4-9 12-6 20 2 5 6 8 10 10M36 6c6 4 9 12 6 20-2 5-6 8-10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>` +
  `<path d="M8 12l-4 1M7 18l-4 2M8 24l-4 3M11 30l-3 4M40 12l4 1M41 18l4 2M40 24l4 3M37 30l3 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>` +
  `</svg>`;

const ICON_FOOT_YPC =
  `<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" focusable="false">` +
  `<path d="M2 12L7 7l3 3 4-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>` +
  `</svg>`;
const ICON_FOOT_ATT =
  `<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" focusable="false">` +
  `<rect x="2" y="7" width="3" height="7" rx="1" fill="currentColor"/><rect x="6.5" y="4" width="3" height="10" rx="1" fill="currentColor"/><rect x="11" y="9" width="3" height="5" rx="1" fill="currentColor"/>` +
  `</svg>`;

function head(id: string, icon: string, title: string, sub: string, yards = false): string {
  // No "Preview" tag and, on the passing bar, faint yard numbers in the
  // stripes (attached_assets/usagedesign.png, 2026-11-05).
  return (
    `<header class="sct-us-prm-head">` +
    `<span class="sct-us-prm-icon" aria-hidden="true">${icon}</span>` +
    `<div class="sct-us-prm-titles">` +
    `<h3 class="sct-us-prm-title" id="${e(id)}">${e(title)}</h3>` +
    `<p class="sct-us-prm-sub">${e(sub)}</p>` +
    `</div>` +
    `<span class="sct-us-prm-stripes${yards ? " is-yards" : ""}" aria-hidden="true">${yards ? `<i>10</i><i>20</i><i>30</i>` : ""}</span>` +
    `</header>`
  );
}

const ICON_BARS =
  `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">` +
  `<rect x="2" y="11" width="4" height="7" rx="1" fill="currentColor"/><rect x="8" y="7" width="4" height="11" rx="1" fill="currentColor"/><rect x="14" y="3" width="4" height="15" rx="1" fill="currentColor"/>` +
  `</svg>`;
const ICON_TARGET =
  `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">` +
  `<circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="10" cy="10" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="10" cy="10" r="1.4" fill="currentColor"/>` +
  `</svg>`;

/** The insight strip: a gold glyph, a thin gold slash, the sentence (the mockup's strip). */
function insight(html: string, icon: string = ICON_INSIGHT): string {
  return (
    `<div class="sct-us-prm-insight">` +
    `<span class="sct-us-prm-insight-icon" aria-hidden="true">${icon}</span>` +
    `<span class="sct-us-prm-insight-slash" aria-hidden="true"></span>` +
    `<p>${html}</p>` +
    `</div>`
  );
}

/** "#2": the 1-based place of a value among the others, descending. */
function rankOf(values: Array<number | null>, mine: number | null): number | null {
  if (mine == null) return null;
  const sorted = values.filter((v): v is number => v != null).sort((a, b) => b - a);
  const i = sorted.findIndex((v) => v <= mine);
  return i === -1 ? sorted.length : i + 1;
}

/* ------------------------------------------------- A. rushing direction */

export function premiumRunDirection(view: UsageView): string {
  const runs = view.team.runs;
  const total = GAPS.reduce((s, g) => s + runs[g].att, 0);
  if (total < 10) return "";
  const best = bestGap(view);
  const most = Math.max(1, ...GAPS.map((g) => runs[g].att));
  const ypcs = GAPS.map((g) => runs[g].ypc);

  const cards = GAPS.map((g) => {
    const r = runs[g];
    const share = Math.round((100 * r.att) / total);
    const rank = rankOf(ypcs, r.ypc);
    const isBest = g === best;
    return (
      `<li class="sct-us-prm-card sct-us-prm-gap${isBest ? " is-best" : ""}" data-gap="${g}">` +
      `<div class="sct-us-prm-card-top">` +
      `<span class="sct-us-prm-pill">${e(GAP_LABEL[g])}</span>` +
      `</div>` +
      // The mockup's card: the big YPC, "24 att · 12%" under it, the best
      // gap's laurel "#1 YPC" at the number's right; no "#N" on the others.
      `<div class="sct-us-prm-big"><span class="sct-us-num">${e(r.ypc != null ? r.ypc.toFixed(1) : "–")}</span>` +
      (isBest && rank ? `<span class="sct-us-prm-laurel" title="Most efficient gap with at least 8% of the attempts">${ICON_LAUREL}<b>${e(`#${rank}`)}</b><i>YPC</i></span>` : "") +
      `</div>` +
      `<p class="sct-us-prm-line">${e(`${r.att} att · ${share}%`)}</p>` +
      `<span class="sct-us-prm-bar" role="img" aria-label="${e(`${share}% of designed runs`)}"><span class="sct-us-prm-bar-track"><span style="width:${Math.round((100 * r.att) / most)}%"></span></span><b>${e(`${share}%`)}</b></span>` +
      `<div class="sct-us-prm-meta">` +
      `<span>${ICON_FOOT_YPC}${e(`${r.ypc != null ? r.ypc.toFixed(1) : "–"} YPC`)}</span>` +
      `<span>${ICON_FOOT_ATT}${e(`${r.att} ATT`)}</span>` +
      `</div>` +
      `</li>`
    );
  }).join("");

  const note = runNote(view);
  return (
    // id="run-direction": the section's anchor, carried over from the retired card (2026-11-05).
    `<section class="sct-us-prm sct-us-prm-run" id="run-direction" aria-labelledby="prm-run-h" data-sct-premium="run-direction">` +
    head(
      "prm-run-h",
      ICON_RUN,
      "Rushing Direction",
      `Yards per carry and attempts by gap, designed runs only, through Week ${view.throughWeek}. "Middle" includes runs behind either guard. The bar is each gap's share of the ${total} attempts; the gold card is the most efficient gap with at least 8% of them.`,
    ) +
    `<div class="sct-us-prm-body">` +
    `<ul class="sct-us-prm-gaps">${cards}</ul>` +
    (note ? insight(md(note), ICON_BARS) : "") +
    `</div>` +
    `</section>`
  );
}

/* ---------------------------------------------- B. passing distribution */

/**
 * The deep card's illustration: a perspective field grid and a route that
 * bends left, rises straight up the middle, or bends right, ending in a
 * marker. Directional, not a plot of where the throws went - the shape is
 * the zone's side, the only number in it is the rise, which follows the
 * zone's share so the busiest deep zone reaches furthest.
 */
function arc(k: Zone, share: number, maxShare: number): string {
  const rise = 22 + Math.round(26 * (maxShare ? share / maxShare : 0));
  const endY = 66 - rise;
  const endX = k === "DL" ? 22 : k === "DM" ? 60 : 98;
  const route = k === "DM" ? `M60 64 L60 ${endY}` : `M60 64 C 60 ${endY + 10}, ${(60 + endX) / 2} ${endY + 2}, ${endX} ${endY}`;
  return (
    `<svg class="sct-us-prm-arc" viewBox="0 0 120 70" preserveAspectRatio="none" aria-hidden="true" focusable="false">` +
    `<g class="sct-us-prm-grid">` +
    `<path d="M4 66 L30 4 M116 66 L90 4 M22 66 L45 4 M98 66 L75 4 M60 66 V4"/>` +
    `<path d="M4 66h112 M9 52h102 M14 38h92 M19 24h82 M24 10h72"/>` +
    `</g>` +
    `<path class="sct-us-prm-route" d="${route}"/>` +
    `<circle class="sct-us-prm-dot-ring" cx="${endX}" cy="${endY}" r="6"/>` +
    `<circle class="sct-us-prm-dot" cx="${endX}" cy="${endY}" r="3"/>` +
    `</svg>`
  );
}

/**
 * The short card's motif: a row of vertical bars, decorative by design (the
 * brief: no invented histograms). The one measured bar is the tallest, the
 * zone's share against the short zones' top; the rest step down from it in
 * a fixed pattern so the motif reads as texture, not as data.
 */
function bars(z: { share: number }, top: { share: number }): string {
  const lead = Math.max(28, Math.round((100 * z.share) / Math.max(1, top.share)));
  const steps = [1, 0.72, 0.86, 0.5, 0.64, 0.38];
  return (
    `<span class="sct-us-prm-bars" aria-hidden="true">` +
    steps.map((f, i) => `<i${i === 0 ? ` class="is-lead"` : ""} style="height:${Math.max(14, Math.round(lead * f))}%"></i>`).join("") +
    `</span>`
  );
}

export function premiumPassMap(view: UsageView): string {
  const zones = view.team.zones;
  const all = Object.values(zones).reduce((s, z) => s + (z?.att ?? 0), 0);
  if (all < 20) return "";
  const qb = view.qb;
  const qbName = qb ? surname(qb.name) : "The offense";
  const best = bestZone(view);
  const maxShare = Math.max(...Object.values(zones).map((z) => z?.share ?? 0), 1);
  const shortTop = { share: Math.max(1, ...SHORT.map((k) => zones[k]?.share ?? 0)) };

  const card = (k: Zone): string => {
    const z = zones[k];
    const share = z?.share ?? 0;
    const att = z?.att ?? 0;
    const ypa = z?.ypa ?? null;
    const owner = zoneOwner(view, k);
    const isBest = k === best;
    const deep = DEEP.includes(k);
    return (
      // The mockup's zone card: the owner rides in the pill ("Deep left -
      // Wilson"), the share stands alone, "6.8 YPA · 12 att" under it, the
      // art at the right; no footer row, the gold card needs no badge.
      `<li class="sct-us-prm-card sct-us-prm-zone${isBest ? " is-best" : ""}${deep ? " is-deep" : " is-short"}" data-zone="${k}">` +
      `<div class="sct-us-prm-card-top">` +
      `<span class="sct-us-prm-pill">${e(owner ? `${ZONE_LABEL[k]} - ${owner}` : ZONE_LABEL[k])}</span>` +
      `</div>` +
      `<div class="sct-us-prm-zone-row">` +
      `<div class="sct-us-prm-zone-text">` +
      `<div class="sct-us-prm-big"><span class="sct-us-num">${e(`${share}%`)}</span></div>` +
      `<p class="sct-us-prm-line">${e(`${ypa != null ? `${ypa.toFixed(1)} YPA` : "no YPA"} · ${att} att`)}</p>` +
      `</div>` +
      `<span class="sct-us-prm-art">${deep ? arc(k, share, maxShare) : bars({ share }, shortTop)}</span>` +
      `</div>` +
      `</li>`
    );
  };

  const notes = passNote(view, qbName);
  const mapped = view.team.passerZoneAttempts ?? all;
  const attempts = qb?.passAttempts ?? null;
  const coverage =
    attempts != null && attempts > mapped
      ? `${mapped} of ${qbName}'s ${attempts} pass attempts carry a charted location and depth; ${attempts - mapped} ${attempts - mapped === 1 ? "does" : "do"} not and ${attempts - mapped === 1 ? "is" : "are"} not mapped.`
      : `All ${mapped} of ${qbName}'s pass attempts carry a charted location and depth. Attempts are as charted in the play-by-play; spikes and plays wiped out by penalty are not counted.`;

  return (
    // id="passing": the section's anchor, carried over from the retired card (2026-11-05).
    `<section class="sct-us-prm sct-us-prm-pass" id="passing" aria-labelledby="prm-pass-h" data-sct-premium="passing">` +
    head("prm-pass-h", ICON_PASS, "Passing Distribution", `Share of ${qbName}'s ${mapped} pass attempts and yards per attempt by field zone through Week ${view.throughWeek}.`, true) +
    `<div class="sct-us-prm-body">` +
    `<div class="sct-us-prm-board">` +
    `<div class="sct-us-prm-rail" aria-hidden="true">` +
    `<span class="sct-us-prm-rail-tag"><b>Deep</b><i>(20+ yds)</i></span>` +
    `<span class="sct-us-prm-rail-tag"><b>Short</b><i>(0-19 yds)</i></span>` +
    `</div>` +
    `<div class="sct-us-prm-rows">` +
    `<ul class="sct-us-prm-zones is-deep">${DEEP.map(card).join("")}</ul>` +
    `<p class="sct-us-prm-divider"><span>Deep = 20+ air yards</span></p>` +
    `<ul class="sct-us-prm-zones is-short">${SHORT.map(card).join("")}</ul>` +
    `</div>` +
    `</div>` +
    notes.map((n) => insight(md(n), ICON_TARGET)).join("") +
    `<p class="sct-us-prm-fine">${e(coverage)}</p>` +
    `</div>` +
    `</section>`
  );
}
