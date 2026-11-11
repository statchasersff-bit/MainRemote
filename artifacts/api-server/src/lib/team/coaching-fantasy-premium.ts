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
import { fantasyReadsModel, finishRows, finishStop, finishTier, readFinish, rowViews, seasonOf, surnameOf, type FinishRow } from "./coaching-render";
import { reliabilityRating } from "./coaching";
import { ICON, usageStyleHead } from "./coaching-premium-tendencies";

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
    // What the move means for fantasy, not its figures again (mak's review,
    // 2026-11-08): the tables above already print every rate and change.
    return (
      `<li class="sct-cf-trend ${tone}">` +
      `<span class="sct-cf-trend-icon" aria-hidden="true">${icon}</span>` +
      `<div class="sct-cf-trend-text">` +
      `<span class="sct-cf-trend-h">${e(r.heading)}</span>` +
      `<span class="sct-cf-trend-b">${e(r.body)}</span>` +
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
    // The intro rides in the title bar as its subtitle, like Coaching Career's (mak, 2026-11-08).
    usageStyleHead("Fantasy Finishes by Season", ICON["bars"]!, `Where ${possessive} QB1, RB1, WR1 and TE1 finished in PPR fantasy scoring`, "sct-cf-fin-h") +
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

/**
 * The Fantasy Bottom Line as one short synthesis (mak's review, 2026-11-08:
 * the old panel repeated continuity, the historical leans, red-zone passing
 * and motion). Written by rule from the same signals, with no figure in it:
 * what the offense points toward for fantasy, then how far last season's
 * usage can be trusted.
 */
export function bottomLineSynthesis(c: TeamCoaching, view: UsageView | null): string {
  const season = seasonOf(c);
  const views = rowViews(c, view);
  const delta = (key: string, min: number): number | null => {
    const d = views.find((x) => x.row.key === key)?.v.delta ?? null;
    return d != null && Math.abs(d) >= min ? d : null;
  };
  const favors: string[] = [];
  const rz = delta("rzPassRate", 3);
  if (rz != null) favors.push(rz > 0 ? "pass-catchers near the goal line" : "the goal-line back");
  const pass = delta("passRate", 3) ?? delta("proe", 3);
  if (pass != null) favors.push(pass > 0 ? "pass-catcher volume" : "backfield volume");
  const lean = c.distribution.rows
    .filter((r) => r.pct != null && r.nfl != null && (r.pct as number) - (r.nfl as number) >= 3)
    .sort((a, b) => ((b.pct as number) - (b.nfl as number)) - ((a.pct as number) - (a.nfl as number)))[0];
  if (lean) favors.push(lean.label === "Running backs" ? "backs who catch passes" : lean.label === "Tight ends" ? "the tight end" : "the lead receivers");
  const pace = delta("pace", 1);
  if (pace != null) favors.push(pace > 0 ? "a few extra snaps for every starter" : "fewer total snaps to go around");
  const and = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  const first = favors.length
    ? `This offense points toward ${and(favors)}.`
    : "No tendency here moves a fantasy ranking on its own; rank these players on their roles.";
  const rating = reliabilityRating(c);
  const games = c.reliability.ledgerStats?.games ?? null;
  const second =
    rating === "HIGH"
      ? `With the same play-caller as ${season - 1}, last season's usage is a sound guide`
      : rating === "MEDIUM"
        ? `Last season's usage is a partial guide`
        : `With a new play-caller, weight this season's usage over last season's`;
  return `${first} ${second}${games != null && games < 6 ? ", and the sample is still small." : "."}`;
}

function bottomLine(c: TeamCoaching, view: UsageView | null): string {
  return (
    `<section class="sct-cf-bl" aria-labelledby="sct-cf-bl-h">` +
    `<div class="sct-cf-bl-grid is-synth">` +
    `<div class="sct-cf-bl-id"><span class="sct-cf-bl-mark" aria-hidden="true">SC</span><h3 class="sct-cf-bl-title" id="sct-cf-bl-h">Fantasy Bottom Line</h3></div>` +
    `<p class="sct-cf-bl-synth">${e(bottomLineSynthesis(c, view))}</p>` +
    `</div>` +
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
