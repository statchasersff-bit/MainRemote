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
import { reliabilityRating, type FinishCell } from "./coaching";
import { ICON, usageStyleHead } from "./coaching-premium-tendencies";
import { playerProfileUrl } from "./links";
import { nameForms, surnameClashes, type NameForm } from "./name-forms";

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

/** "Patriots" / "Oakland Raiders" as the club's code ("NE", "LV"): the club a finish is matched on. */
function clubCode(club: string): string {
  const team = TEAMS.find((t) => t.nickname === club || club.endsWith(` ${t.nickname}`)) ?? null;
  return team ? team.abbreviation.toUpperCase() : club;
}

function rankPill(pos: string, rank: number, current: boolean): string {
  const [, key, label] = finishTier(rank);
  const title = current ? "In-season pace, not a final finish" : `${label} ${pos} finish`;
  return `<span class="sct-cf-pill ${current ? "is-current" : `is-${key}`}" title="${e(title)}">${e(`${pos}${rank}`)}</span>`;
}

/** The four finish columns, for naming a cell with no finish. */
const POSN = ["QB", "RB1", "WR1", "TE1"];

/**
 * The player behind a finish, printed once (WEB-044, 2026-11-24): the full
 * name where the data carries it (the cell's `name`, 2026-11-15), else the
 * stored surname. The table used to print the stored surname ("Brown" for
 * Amon-Ra St. Brown) and a phone copy the full name. Phones now paint the
 * surname from the same text (team.css "Name forms"); the aria-label and
 * title carry the full name.
 *
 * Linked to the player's StatChasers page only when exactly one player of
 * that name played for that club, in that position group, that season
 * (playerProfileUrl, by name inside club and position, with the season's
 * game logs for the club): the finishes store no player ids, so the club
 * and the season are the identity, and only a game-log row for that club and
 * season counts (logsOnly, team audit T1: his club today does not). Anything
 * less certain stays plain text.
 */
function finishName(cell: FinishCell, f: { player: string }): string {
  return (cell.name || f.player).trim().replace(/\s+/g, " ");
}

/**
 * The phone form of each name, when its surname alone would read like
 * another player's in the same table (surnameClashes): "A. St. Brown" and
 * "M. Brown" on Detroit's (team audit T1, 2026-11-24). Every row counts,
 * the ones behind Show all too.
 */
function finishClashes(rows: FinishRow[]): Map<string, NameForm> {
  const names: string[] = [];
  for (const row of rows) {
    for (const cell of row.cells) {
      const f = readFinish(cell.text);
      if (f) names.push(finishName(cell, f));
    }
  }
  return surnameClashes(names);
}

function finishWho(cell: FinishCell, f: { pos: string; player: string }, club: string, year: string, clashes: Map<string, NameForm>): string {
  const full = finishName(cell, f);
  const form = clashes.get(full);
  const cls = `sct-cf-who${form === "initial" ? " is-nm-initial" : form === "full" ? " is-nm-full" : ""}`;
  const season = Number(year);
  const href = playerProfileUrl(full, {
    team: clubCode(club),
    pos: f.pos,
    // The season's game logs alone: a namesake on the club today is no match.
    game: Number.isInteger(season) && season > 0 ? { season, logsOnly: true } : null,
  });
  return href
    ? `<a class="${cls} sct-player-link" href="${e(href)}" target="_top" title="${e(full)}" aria-label="${e(full)}">${nameForms(full)}</a>`
    : `<span class="${cls}" title="${e(full)}">${nameForms(full)}</span>`;
}

/**
 * One season's row. The only rendering of the finishes since WEB-044
 * (2026-11-24): the phones' <details> list that repeated every row (mak,
 * 2026-11-15) is gone, and team.css fits this table to a phone instead,
 * every position still in view with no sideways scroll: the crest and the
 * first names step aside there, the pills and surnames stay.
 */
function finishRow(row: FinishRow, clashes: Map<string, NameForm>): string {
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
      .map((cell, i) => {
        const f = readFinish(cell.text);
        return f
          ? `<td class="sct-cf-td is-fin">${rankPill(f.pos, f.rank, !!row.current)}${finishWho(cell, f, club, year, clashes)}</td>`
          : `<td class="sct-cf-td is-fin"><span class="sct-cf-none" aria-label="${e(`${POSN[i] ?? "Finish"}: none`)}">${e(cell.text || "–")}</span></td>`;
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
  const newest = [...rows].reverse();
  const recent = newest.slice(0, 5);
  const older = newest.slice(5);
  const clashes = finishClashes(rows);
  const row = (r: FinishRow): string => finishRow(r, clashes);
  const allId = `sct-cfp-all-${c.playCaller.name.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    `<section class="sct-cf-panel" aria-labelledby="sct-cf-fin-h">` +
    // The intro rides in the title bar as its subtitle, like Coaching Career's (mak, 2026-11-08).
    usageStyleHead("Fantasy Finishes by Season", ICON["bars"]!, `Where ${possessive} QB1, RB1, WR1 and TE1 finished in PPR fantasy scoring`, "sct-cf-fin-h") +
    // Newest first and five seasons then Show all at every width (Team Pages
    // Phase 2, 2026-11-19), the Season by Season rule; the checkbox precedes
    // the table so it can open the older rows (team.css).
    (older.length ? `<input type="checkbox" class="sct-cfp-all" id="${allId}">` : "") +
    `<div class="sct-cf-scroll" tabindex="0" role="region" aria-label="${e(`Positional fantasy finishes under the ${team.nickname} play-caller`)}">` +
    `<table class="sct-cf-table">` +
    `<thead><tr>` +
    `<th scope="col" class="sct-cf-th is-stop">Stop</th>` +
    `<th scope="col" class="sct-cf-th is-fin">QB</th>` +
    `<th scope="col" class="sct-cf-th is-fin">RB1</th>` +
    `<th scope="col" class="sct-cf-th is-fin">WR1</th>` +
    `<th scope="col" class="sct-cf-th is-fin">TE1</th>` +
    `</tr></thead><tbody>${recent.map(row).join("")}</tbody>` +
    (older.length ? `<tbody class="sct-cf-older">${older.map(row).join("")}</tbody>` : "") +
    `</table></div>` +
    (older.length
      ? `<label class="sct-cfp-more" for="${allId}"><span class="sct-cfp-more-show">${e(`Show all ${rows.length} seasons`)}</span><span class="sct-cfp-more-hide">Show recent seasons only</span></label>`
      : "") +
    // The note and the method were the same sentence twice; one disclosure.
    `<details class="sct-cf-how"><summary class="sct-cf-how-q"><span class="sct-cf-how-icon" aria-hidden="true">${CALC}</span>${e("PPR positional finishes: how they are calculated")}<span class="sct-cf-chev" aria-hidden="true">${CHEVRON}</span></summary>` +
    `<p class="sct-cf-how-a">${e(`Historical outcomes, not projections. ${c.finishes.note}`)}</p></details>` +
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
    // No subtitle since 2026-11-21 (mak: the phone version everywhere).
    `</div>` +
    `</header>` +
    // One analysis, then the finishes with nothing summarized under them
    // (the review of 2026-11-15).
    `<p class="sct-cf-impl">${e(fantasyImplications(c, view))}</p>` +
    finishes(c, team) +
    `</div>`
  );
}
