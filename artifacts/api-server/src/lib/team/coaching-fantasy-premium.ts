/**
 * The Coaching tab's Fantasy Implications section (mak's brief "Exact
 * Premium NFL Coaching Fantasy Impact Redesign", 2026-11-05, merged on
 * 2026-11-15 after a page review): a small navy-and-gold section heading,
 * one short Fantasy Implications analysis, then the "Fantasy Finishes by
 * Season" panel (navy head, team crests, tiered rank pills, the in-season
 * row in cream with dashed pills, the methodology note and the "How
 * finishes are calculated" accordion), with no summary under it. The trend
 * cards and the Fantasy Bottom Line panel went in the merge.
 *
 * coaching-render.ts mounts it. Every number is the original's own model
 * (rowViews, finishRows / readFinish / finishStop / finishTier in
 * coaching-render.ts). Markup `sct-cf-` prefixed inside the premium wrapper
 * (`.sct-cp.sct-cpt`); styles at the end of team.css.
 */

import { escapeHtml } from "../render";
import type { TeamCoaching } from "./coaching";
import type { UsageView } from "./usage";
import { TEAMS, type NflTeam } from "./teams";
import { finishRows, finishStop, finishTier, readFinish, rowViews, seasonOf, surnameOf, type FinishRow } from "./coaching-render";
import { reliabilityRating } from "./coaching";
import { ICON, usageStyleHead } from "./coaching-premium-tendencies";

const e = escapeHtml;

const svg = (body: string, size = 24): string =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const PLAYBOOK = svg(`<circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M7.5 7.5L11 15.5M16.5 7.5L13 15.5"/><path d="M4 12l4-1M20 12l-4-1"/>`);
const CHEVRON = svg(`<path d="M6 9l6 6 6-6"/>`, 18);
const CALC = svg(`<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h2M12 11h2M16 11h2M8 15h2M12 15h2M16 15h2"/>`, 18);

/** The club a finishes row names ("Ravens", "Oakland Raiders"), as a crest. */
function clubCrest(club: string): string {
  const team = TEAMS.find((t) => t.nickname === club || club.endsWith(` ${t.nickname}`)) ?? null;
  return team?.logo
    ? `<img class="sct-cf-crest" src="${e(team.logo)}" alt="" width="30" height="30" loading="lazy" decoding="async">`
    : `<span class="sct-cf-crest is-blank" aria-hidden="true"></span>`;
}

/* ---------------------------------------------------------------- finishes */

/** "Patriots" / "Oakland Raiders" as the club's code ("NE", "LV"), for the phone stop label. */
function clubCode(club: string): string {
  const team = TEAMS.find((t) => t.nickname === club || club.endsWith(` ${t.nickname}`)) ?? null;
  return team ? team.abbreviation.toUpperCase() : club;
}

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

/**
 * Phones' finishes (mak, 2026-11-15): one row per season that fits the
 * screen, the stop short ("2016 NE" over the role) then the four rank pills
 * (same tiers and colors as the table) and a chevron; the row opens to the
 * player behind each finish, by full name where the data carries it (the
 * cell's `name`, 2026-11-15) and the stored surname otherwise. Newest first,
 * five seasons and then Show all, like Season by Season. team.css shows
 * this list at 560px and under in place of the table.
 */
function phoneFinishRow(row: FinishRow): string {
  const { club, year } = finishStop(row);
  const pace = row.context.match(/^pace through (Week \d+)$/i);
  const role = row.current ? (pace ? `Thru ${pace[1]!.replace("Week", "Wk")}` : "In-season") : row.context;
  const POSN = ["QB", "RB1", "WR1", "TE1"];
  const finishes = row.cells.map((cell) => readFinish(cell.text));
  const pills = finishes
    .map((f, i) => `<span class="sct-cfp-cell">${f ? rankPill(f.pos, f.rank, !!row.current) : `<span class="sct-cf-none" aria-label="${e(`${POSN[i]}: none`)}">–</span>`}</span>`)
    .join("");
  const people = finishes
    .map((f, i) => `<div class="sct-cfp-kv"><dt>${e(POSN[i]!)}</dt><dd>${f ? `<span class="sct-cfp-rk">${e(`${f.pos}${f.rank}`)}</span> ${e(row.cells[i]?.name || f.player)}` : "–"}</dd></div>`)
    .join("");
  return (
    `<details class="sct-cfp-row${row.current ? " is-current" : ""}">` +
    `<summary class="sct-cfp-sum">` +
    `<span class="sct-cfp-stop"><span class="sct-cfp-yr"><b>${e(year)}</b> ${e(clubCode(club))}</span><span class="sct-cfp-role">${e(role)}</span></span>` +
    pills +
    `<span class="sct-cfp-chev" aria-hidden="true"></span>` +
    `</summary>` +
    `<dl class="sct-cfp-detail" aria-label="${e(`Players, ${year} ${club}`)}">${people}</dl>` +
    `</details>`
  );
}

function finishes(c: TeamCoaching, team: NflTeam): string {
  const rows = finishRows(c);
  if (rows.length === 0) return "";
  const last = surnameOf(c);
  const possessive = /s$/.test(last) ? `${last}'` : `${last}'s`;
  const newest = [...rows].reverse();
  const phoneRecent = newest.slice(0, 5);
  const phoneOlder = newest.slice(5);
  const allId = `sct-cfp-all-${c.playCaller.name.toLowerCase().replace(/[^a-z]+/g, "-")}`;
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
    // Phones: the season list in place of the table (team.css), newest
    // first, five seasons then a CSS-only Show all.
    (phoneOlder.length ? `<input type="checkbox" class="sct-cfp-all" id="${allId}">` : "") +
    `<div class="sct-cfp">` +
    `<div class="sct-cfp-head" aria-hidden="true"><span>Season</span><span>QB</span><span>RB1</span><span>WR1</span><span>TE1</span><span></span></div>` +
    `<div class="sct-cfp-recent">${phoneRecent.map(phoneFinishRow).join("")}</div>` +
    (phoneOlder.length ? `<div class="sct-cfp-older">${phoneOlder.map(phoneFinishRow).join("")}</div>` : "") +
    `</div>` +
    (phoneOlder.length
      ? `<label class="sct-cfp-more" for="${allId}"><span class="sct-cfp-more-show">${e(`Show all ${rows.length} seasons`)}</span><span class="sct-cfp-more-hide">Show recent seasons only</span></label>`
      : "") +
    `<p class="sct-cf-note"><span class="sct-cf-note-icon" aria-hidden="true">${ICON["info"]}</span><span>${e(`PPR positional finishes. Partial-season rows rank only the games ${last} called. Historical outcomes, not projections.`)}</span></p>` +
    `<details class="sct-cf-how"><summary class="sct-cf-how-q"><span class="sct-cf-how-icon" aria-hidden="true">${CALC}</span>How finishes are calculated<span class="sct-cf-chev" aria-hidden="true">${CHEVRON}</span></summary>` +
    `<p class="sct-cf-how-a">${e(c.finishes.note)}</p></details>` +
    `</section>`
  );
}

/* ---------------------------------------------------- fantasy implications */

/**
 * Fantasy Implications (the review of 2026-11-15): one short analysis in
 * place of the trend cards and the Fantasy Bottom Line, which both re-told
 * red-zone passing and motion. Written by rule, by position, with no figure
 * (the tables above carry them), and only claims the data supports: no
 * "extra snaps" from pace and no "backfield volume" from a lower pass rate.
 * Closes on how far last season's usage can be trusted.
 */
export function fantasyImplications(c: TeamCoaching, view: UsageView | null): string {
  const season = seasonOf(c);
  const views = rowViews(c, view);
  const delta = (key: string, min: number): number | null => {
    const d = views.find((x) => x.row.key === key)?.v.delta ?? null;
    return d != null && Math.abs(d) >= min ? d : null;
  };
  const parts: string[] = [];
  const rz = delta("rzPassRate", 3);
  if (rz != null)
    parts.push(
      rz > 0
        ? "More red-zone passing favors receiving touchdown chances over goal-line rushing."
        : "Less red-zone passing keeps more touchdown chances with the goal-line back.",
    );
  const motion = delta("motionRate", 3);
  if (motion != null)
    parts.push(
      motion > 0
        ? "Added pre-snap motion may help passing efficiency by getting receivers open."
        : "Less pre-snap motion takes away one of the easier ways to scheme receivers open.",
    );
  // The target lean is career-wide (the card's window), so it reads as history.
  const lean = c.distribution.rows
    .filter((r) => r.pct != null && r.nfl != null && (r.pct as number) - (r.nfl as number) >= 3)
    .sort((a, b) => ((b.pct as number) - (b.nfl as number)) - ((a.pct as number) - (a.nfl as number)))[0];
  if (lean) {
    const who = lean.label === "Running backs" ? "backs involved in the receiving game" : lean.label === "Tight ends" ? "the starting tight end" : "the lead receivers";
    parts.push(`His offenses have historically sent an above-average share of targets to ${lean.label.toLowerCase()}, which favors ${who}.`);
  }
  const first = parts.length ? parts.join(" ") : "No tendency here moves a fantasy ranking on its own; rank these players on their roles.";
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

/* ------------------------------------------------------------------ public */

export function renderCoachingFantasyPremium(c: TeamCoaching, team: NflTeam, view: UsageView | null): string {
  const season = seasonOf(c);
  return (
    `<div class="sct-block sct-cp sct-cpt sct-cf" id="coaching-fantasy-premium" data-sct-premium="coaching-fantasy">` +
    `<header class="sct-cf-head">` +
    `<span class="sct-cf-head-icon" aria-hidden="true">${PLAYBOOK}</span>` +
    `<span class="sct-cf-head-rule" aria-hidden="true"></span>` +
    `<div class="sct-cf-head-text">` +
    `<h3 class="sct-cf-h3" id="sct-cf-title">Fantasy Implications</h3>` +
    `<p class="sct-cf-sub">${e(`What the ${season} tendencies and ${surnameOf(c)}'s history mean for fantasy lineups`)}</p>` +
    `</div>` +
    `</header>` +
    // One analysis, then the finishes with nothing summarized under them
    // (the review of 2026-11-15).
    `<p class="sct-cf-impl">${e(fantasyImplications(c, view))}</p>` +
    finishes(c, team) +
    `</div>`
  );
}
