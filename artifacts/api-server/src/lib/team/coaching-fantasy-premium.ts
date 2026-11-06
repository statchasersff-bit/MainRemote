/**
 * The premium Coaching tab Fantasy Impact section
 * (mak's brief "Exact Premium NFL Coaching Fantasy Impact Redesign",
 * 2026-11-05; no mockup image came with it, so the block is built from the
 * brief's words in the language of attached_assets/coachingdesign.png): a
 * small navy-and-gold section heading, the headline tendency cards, the
 * "Fantasy Finishes by Season" panel (navy head, team crests, tiered rank
 * pills, the in-season row in cream with dashed pills, the methodology
 * note and the "How finishes are calculated" accordion), and the gold
 * Fantasy Bottom Line panel with its "Full summary" fold.
 *
 * The Coaching tab's Fantasy Impact section since mak removed the original
 * (2026-11-06); coaching-render.ts mounts it. Presentation only:
 * every word and number is the original's own model (fantasyReadsModel,
 * finishRows / readFinish / finishStop / finishTier, bottomLineModel in
 * coaching-render.ts), so the two cannot disagree. Markup `sct-cf-`
 * prefixed inside the premium wrapper (`.sct-cp.sct-cpt`), so it shares
 * the tokens and the head style of the other coaching premium blocks;
 * styles at the end of team.css.
 */

import { escapeHtml } from "../render";
import type { TeamCoaching } from "./coaching";
import type { UsageView } from "./usage";
import { TEAMS, type NflTeam } from "./teams";
import { bottomLineModel, fantasyReadsModel, finishRows, finishStop, finishTier, readFinish, seasonOf, signedPts, surnameOf, type FinishRow } from "./coaching-render";
import { ICON } from "./coaching-premium-tendencies";

const e = escapeHtml;

const svg = (body: string, size = 24): string =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const PLAYBOOK = svg(`<circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M7.5 7.5L11 15.5M16.5 7.5L13 15.5"/><path d="M4 12l4-1M20 12l-4-1"/>`);
const UP = svg(`<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>`, 20);
const DOWN = svg(`<path d="M12 5v14"/><path d="M6 13l6 6 6-6"/>`, 20);
const FLAT = svg(`<path d="M5 12h14"/>`, 20);
const CHEVRON = svg(`<path d="M6 9l6 6 6-6"/>`, 18);
const CALC = svg(`<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h2M12 11h2M16 11h2M8 15h2M12 15h2M16 15h2"/>`, 18);

/** The club a finishes row names ("Ravens", "Oakland Raiders"), as a crest. */
function clubCrest(club: string): string {
  const team = TEAMS.find((t) => t.nickname === club || club.endsWith(` ${t.nickname}`)) ?? null;
  return team?.logo
    ? `<img class="sct-cf-crest" src="${e(team.logo)}" alt="" width="30" height="30" loading="lazy" decoding="async">`
    : `<span class="sct-cf-crest is-blank" aria-hidden="true"></span>`;
}

/* ------------------------------------------------------------------ trends */

function trends(c: TeamCoaching, view: UsageView | null): string {
  const m = fantasyReadsModel(c, view);
  if (m.reads.length === 0) return "";
  const cards = m.reads.map((r) => {
    const icon = r.dir === "↑" ? UP : r.dir === "↓" ? DOWN : FLAT;
    const tone = r.dir === "↑" ? "is-up" : r.dir === "↓" ? "is-down" : "is-flat";
    const move = r.prior && r.current ? `<span class="sct-cf-trend-move"><span class="sct-cf-trend-yr">${e(m.priorYear)}</span> ${e(r.prior)} <span class="sct-cf-trend-arrow" aria-hidden="true">→</span> <span class="sct-cf-trend-yr">${e(String(m.season))}</span> ${e(r.current)}</span>` : "";
    // The change in the row's own unit: percentage points for a rate, as
    // the brief insists (67.6% to 78% is +10.4 pp, not +10.4%).
    const change =
      r.delta != null && r.delta !== 0 && r.pct
        ? `<span class="sct-cf-trend-pp ${tone}">${e(`${signedPts(Math.round(r.delta * 10) / 10)} pp`)}</span>`
        : "";
    return (
      `<li class="sct-cf-trend ${tone}">` +
      `<span class="sct-cf-trend-icon" aria-hidden="true">${icon}</span>` +
      `<div class="sct-cf-trend-text">` +
      `<span class="sct-cf-trend-h">${e(r.heading)}</span>` +
      (move ? `<span class="sct-cf-trend-vals">${move}${change}</span>` : "") +
      `<span class="sct-visually-hidden">${e(r.body)}</span>` +
      `</div>` +
      `</li>`
    );
  });
  return `<ul class="sct-cf-trends${cards.length === 1 ? " is-one" : ""}" aria-label="What the signals mean">${cards.join("")}</ul>`;
}

/* ---------------------------------------------------------------- finishes */

function rankPill(pos: string, rank: number, current: boolean): string {
  const [, key, label] = finishTier(rank);
  const title = current ? "In-season pace, not a final finish" : `${label} ${pos} finish`;
  return `<span class="sct-cf-pill ${current ? "is-current" : `is-${key}`}" title="${e(title)}">${e(`${pos}${rank}`)}</span>`;
}

function finishRow(row: FinishRow): string {
  const { club, year } = finishStop(row);
  const pace = row.context.match(/^pace through (Week \d+)$/i);
  const context = row.current ? `${pace ? `Through ${pace[1]}` : row.context} · In-season` : row.context;
  return (
    `<tr class="sct-cf-row${row.current ? " is-current" : ""}">` +
    `<th scope="row" class="sct-cf-td is-stop">` +
    `<span class="sct-cf-stop">${clubCrest(club)}<span class="sct-cf-stop-text">` +
    `<span class="sct-cf-stop-club">${e(club)}${year ? `<span class="sct-cf-stop-dot" aria-hidden="true"> · </span><span class="sct-cf-stop-year">${e(year)}</span>` : ""}</span>` +
    `<span class="sct-cf-stop-role">${e(context)}</span>` +
    `</span></span>` +
    `</th>` +
    row.cells
      .map((cell) => {
        const f = readFinish(cell.text);
        return f
          ? `<td class="sct-cf-td is-fin">${rankPill(f.pos, f.rank, !!row.current)}<span class="sct-cf-who">${e(f.player)}</span></td>`
          : `<td class="sct-cf-td is-fin"><span class="sct-cf-none">${e(cell.text || "–")}</span></td>`;
      })
      .join("") +
    `</tr>`
  );
}

function finishes(c: TeamCoaching, team: NflTeam): string {
  const rows = finishRows(c);
  if (rows.length === 0) return "";
  const last = surnameOf(c);
  const possessive = /s$/.test(last) ? `${last}'` : `${last}'s`;
  return (
    `<section class="sct-cf-panel" aria-labelledby="sct-cf-fin-h">` +
    `<header class="sct-cpt-head is-fin">` +
    `<span class="sct-cpt-head-icon">${ICON["bars"]}</span>` +
    `<span class="sct-cpt-head-rule"></span>` +
    `<div class="sct-cpt-head-text"><h3 class="sct-cpt-h3" id="sct-cf-fin-h">Fantasy Finishes by Season</h3></div>` +
    `</header>` +
    `<p class="sct-cf-intro">${e(`Where ${possessive} QB1, RB1, WR1 and TE1 finished in PPR fantasy scoring`)}</p>` +
    `<div class="sct-cf-scroll" tabindex="0" role="region" aria-label="${e(`Positional fantasy finishes under the ${team.nickname} play-caller`)}">` +
    `<table class="sct-cf-table">` +
    `<thead><tr>` +
    `<th scope="col" class="sct-cf-th is-stop">Stop</th>` +
    `<th scope="col" class="sct-cf-th is-fin">QB</th>` +
    `<th scope="col" class="sct-cf-th is-fin">RB1</th>` +
    `<th scope="col" class="sct-cf-th is-fin">WR1</th>` +
    `<th scope="col" class="sct-cf-th is-fin">TE1</th>` +
    `</tr></thead><tbody>${rows.map(finishRow).join("")}</tbody></table></div>` +
    `<p class="sct-cf-note"><span class="sct-cf-note-icon" aria-hidden="true">${ICON["info"]}</span><span>${e(`PPR positional finishes. Partial-season rows rank only the games ${last} called. Historical outcomes, not projections.`)}</span></p>` +
    `<details class="sct-cf-how"><summary class="sct-cf-how-q"><span class="sct-cf-how-icon" aria-hidden="true">${CALC}</span>How finishes are calculated<span class="sct-cf-chev" aria-hidden="true">${CHEVRON}</span></summary>` +
    `<p class="sct-cf-how-a">${e(c.finishes.note)}</p></details>` +
    `</section>`
  );
}

/* ------------------------------------------------------------- bottom line */

/** "↑ Shotgun" -> a green or red glyph with its label. */
function signal(text: string): string {
  const m = text.match(/^([↑↓])\s+(.+)$/);
  if (!m) return `<span class="sct-cf-sig">${e(text)}</span>`;
  const up = m[1] === "↑";
  return `<span class="sct-cf-sig"><span class="sct-cf-sig-dir ${up ? "is-up" : "is-down"}" aria-hidden="true">${m[1]}</span><span class="sct-visually-hidden">${up ? "up" : "down"}</span> ${e(m[2])}</span>`;
}

function bottomLine(c: TeamCoaching, view: UsageView | null): string {
  const m = bottomLineModel(c, view);
  const join = (items: string[]): string => items.map(signal).join(`<span class="sct-cf-sig-sep" aria-hidden="true">·</span>`);
  const row = (k: string, v: string): string => `<div class="sct-cf-bl-row"><dt class="sct-cf-bl-k">${e(k)}</dt><dd class="sct-cf-bl-v">${v}</dd></div>`;
  return (
    `<section class="sct-cf-bl" aria-labelledby="sct-cf-bl-h">` +
    `<div class="sct-cf-bl-grid">` +
    `<div class="sct-cf-bl-id"><span class="sct-cf-bl-mark" aria-hidden="true">SC</span><h3 class="sct-cf-bl-title" id="sct-cf-bl-h">Fantasy Bottom Line</h3></div>` +
    `<dl class="sct-cf-bl-ctx">` +
    row(`${m.season - 1} carryover`, e(m.carry)) +
    row("Historical leans", m.leans.length ? join(m.leans) : e("Target split near league")) +
    `</dl>` +
    `<dl class="sct-cf-bl-now">` +
    (m.signals.length ? row(`${m.season} signals`, join(m.signals)) : "") +
    (m.games ? row("Sample", `<b>${e(`${m.games} game${m.games === 1 ? "" : "s"}`)}</b> · current personnel usage still matters most`) : "") +
    `</dl>` +
    `</div>` +
    `<details class="sct-cf-bl-more"><summary class="sct-cf-bl-more-q">Full summary<span class="sct-cf-bl-plus" aria-hidden="true">+</span></summary>` +
    `<p class="sct-cf-bl-more-a">${e(m.summary)}</p></details>` +
    `</section>`
  );
}

/* ------------------------------------------------------------------ public */

export function renderCoachingFantasyPremium(c: TeamCoaching, team: NflTeam, view: UsageView | null): string {
  const season = seasonOf(c);
  return (
    `<div class="sct-block sct-cp sct-cpt sct-cf" id="coaching-fantasy-premium" data-sct-premium="coaching-fantasy">` +
    `<header class="sct-cf-head">` +
    `<span class="sct-cf-head-icon" aria-hidden="true">${PLAYBOOK}</span>` +
    `<span class="sct-cf-head-rule" aria-hidden="true"></span>` +
    `<div class="sct-cf-head-text">` +
    `<h3 class="sct-cf-h3" id="sct-cf-title">Fantasy Impact</h3>` +
    `<p class="sct-cf-sub">${e(`What the ${season} tendencies and ${surnameOf(c)}'s history mean for fantasy lineups`)}</p>` +
    `</div>` +
    `</header>` +
    trends(c, view) +
    finishes(c, team) +
    bottomLine(c, view) +
    `</div>`
  );
}
