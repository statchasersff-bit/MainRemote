/**
 * The premium comparison version of the season-by-season table (mak's
 * brief, 2026-11-05, built to attached_assets/coachref.png): the navy
 * header with the calendar, the two career stats as chips, and the seasons
 * as one dense analytical table: stints grouped under a role cell with a
 * club-colored rail, team crests, points per game in bold, the NFL rank as
 * a graded pill (windowed ranks kept in words), WR / RB / TE target shares
 * with their league delta and a 0-100 bar, the lead back's share, a band
 * for the years he was not calling, and the live season marked.
 *
 * Since 2026-11-05 ("remove the old version") this IS the season table:
 * the original (career() in coaching-render.ts) is unmounted. Every
 * number is the table's own model (historyModel in coaching-render.ts) and
 * the same stop colors; nothing is computed twice. Styles `.sct-cs-*` in
 * team.css on the premium tokens.
 */

import { escapeHtml } from "../render";
import type { TeamCoaching } from "./coaching";
import { historyModel, leanOf, POS, readStops, stepLogo, stopColors, type HistoryRow, type Pos, type Print } from "./coaching-render";
import { ICON } from "./coaching-premium-tendencies";

const e = escapeHtml;

const CALENDAR = `<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18"/><path d="M8 3v4M16 3v4"/><path d="M8 14h2M12 14h2M16 14h2M8 17.5h2M12 17.5h2"/></g></svg>`;
const BALL = `<svg class="sct-cs-ball" viewBox="0 0 120 80" width="120" height="80" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 62C26 24 70 6 108 18 94 56 50 74 12 62z"/><path d="M38 52l44-26"/><path d="M48 44l3 5M54 40l3 5M60 36l3 5M66 33l3 5M72 29l3 5"/></g></svg>`;

const POS_LABEL: Record<Pos, string> = { WR: "WR share", RB: "RB share", TE: "TE share" };

/** The rank pill's grade: a top-ten offense green, the middle of the league neutral, the bottom third red; a windowed rank stays in words, ungraded. */
function rankPill(text: string): string {
  if (!text) return `<span class="sct-cs-none">–</span>`;
  const m = text.match(/^(\d+)(st|nd|rd|th)$/);
  if (!m) return `<span class="sct-cs-rank is-window">${e(text)}</span>`;
  const n = Number(m[1]);
  const grade = n <= 10 ? "is-good" : n <= 18 ? "is-mid" : "is-poor";
  return `<span class="sct-cs-rank ${grade}">${e(text)}</span>`;
}

function shareCell(p: Print | null, pos: Pos, lean: Pos | null, year: number): string {
  const v = p?.shares[pos] ?? null;
  const lg = p?.league[pos] ?? null;
  if (v == null) return `<td class="sct-cs-td is-share"><span class="sct-cs-none">–</span></td>`;
  const d = lg != null ? Math.round(v - lg) : null;
  const delta =
    d == null
      ? ""
      : d === 0
        ? `<span class="sct-cs-delta is-flat" title="Level with the league average">0</span>`
        : `<span class="sct-cs-delta ${d > 0 ? "is-up" : "is-down"}" title="${e(`${Math.abs(d)} points ${d > 0 ? "above" : "below"} the league average of ${lg}%`)}"><span aria-hidden="true">${d > 0 ? "↑" : "↓"}</span><span class="sct-visually-hidden">${d > 0 ? "up" : "down"}</span> ${Math.abs(d)}</span>`;
  return (
    `<td class="sct-cs-td is-share">` +
    `<span class="sct-cs-share"><span class="sct-cs-pct${lean === pos ? " is-lean" : ""}">${v}%</span>${delta}</span>` +
    `<span class="sct-cs-track" role="img" aria-label="${e(`${year} ${POS_LABEL[pos]} ${v} percent of targets`)}"><span class="sct-cs-fill" style="width:${Math.max(0, Math.min(100, v))}%"></span></span>` +
    `</td>`
  );
}

export function renderCoachingSeasonsPremium(c: TeamCoaching): string {
  const stops = readStops(c);
  const m = historyModel(c, stops);
  if (!m) return "";
  const colors = stopColors(stops);
  const peakLb = Math.max(-1, ...m.rows.map((r) => r.p?.leadBack ?? -1));
  const peakPpg = Math.max(...m.rows.filter((r) => r.s.caller).map((r) => r.pt.ppg));

  const chips = m.stats
    .map((st) => `<li class="sct-cs-chip"><span class="sct-cs-chip-v">${e(st.value)}</span><span class="sct-cs-chip-l">${e(st.label)}</span></li>`)
    .join("");

  const row = (r: HistoryRow): string => {
    const { s, pt, p } = r;
    let html = "";
    if (r.gapBefore) html += `<tr class="sct-cs-gap"><td colspan="9"><span class="sct-cs-gap-icon" aria-hidden="true">${CALENDAR}</span>${e(`${r.gapBefore} · Not calling plays`)}</td></tr>`;
    const logo = stepLogo(s.code);
    const roleCell = r.groupStart
      ? `<th scope="rowgroup" rowspan="${r.groupLen}" class="sct-cs-td is-role"><span class="sct-cs-role">${e(s.role)}</span><span class="sct-cs-role-years">${e(`(${r.groupYears})`)}</span>${s.caller ? "" : `<span class="sct-cs-role-note">not the caller</span>`}</th>`
      : "";
    const lb = p?.leadBack ?? null;
    html +=
      `<tr class="sct-cs-row${r.live ? " is-current" : ""}${r.groupStart ? " is-stint-start" : ""}${s.caller ? "" : " is-notcaller"}${r.win ? " is-window" : ""}" style="--seg:${colors.get(s.code) ?? "#0b1634"}">` +
      `<th scope="row" class="sct-cs-td is-season"><span class="sct-cs-year">${pt.year}</span>` +
      (r.win ? `<span class="sct-cs-win">${e(r.win)}</span>` : "") +
      (r.live ? `<span class="sct-cs-live">In-season</span>` : "") +
      `</th>` +
      `<td class="sct-cs-td is-team"><span class="sct-cs-club">` +
      (logo ? `<img class="sct-cs-crest" src="${e(logo)}" alt="" width="22" height="22" loading="lazy" decoding="async">` : "") +
      `<span class="sct-cs-code">${e(s.code)}</span></span></td>` +
      roleCell +
      `<td class="sct-cs-td is-ppg"><span class="sct-cs-ppg${s.caller && pt.ppg === peakPpg ? " is-peak" : ""}">${e(pt.ppg.toFixed(1))}</span></td>` +
      `<td class="sct-cs-td is-rank">${rankPill(r.rankText)}</td>` +
      POS.map((pos) => shareCell(p, pos, r.lean, pt.year)).join("") +
      `<td class="sct-cs-td is-lb">` +
      (lb != null ? `<span class="sct-cs-lb${lb >= 65 ? " is-workhorse" : ""}${lb === peakLb && lb >= 0 ? " is-peak" : ""}">${lb}%</span>` : `<span class="sct-cs-none">–</span>`) +
      `</td>` +
      `</tr>`;
    return html;
  };

  return (
    `<div class="sct-block sct-cp sct-cpt sct-cs" id="coaching-seasons-premium" data-sct-premium="coaching-seasons">` +
    `<section class="sct-cpt-section is-seasons" aria-labelledby="sct-cs-title">` +
    `<header class="sct-cpt-head is-main is-seasons">` +
    `<span class="sct-cpt-head-icon">${CALENDAR}</span>` +
    `<span class="sct-cpt-head-rule"></span>` +
    `<div class="sct-cpt-head-text"><h3 class="sct-cpt-h3" id="sct-cs-title">${e(`Season by Season Under ${m.last}, ${m.span}`)}</h3></div>` +
    BALL +
    `</header>` +
    `<div class="sct-cs-body">` +
    (chips ? `<ul class="sct-cs-chips">${chips}</ul>` : "") +
    `<div class="sct-cs-scroll" tabindex="0" role="region" aria-label="${e(`Season by season under ${m.last}, ${m.span}`)}">` +
    `<table class="sct-cs-table">` +
    `<thead><tr>` +
    `<th scope="col" class="sct-cs-th is-season">Season</th>` +
    `<th scope="col" class="sct-cs-th is-team">Team</th>` +
    `<th scope="col" class="sct-cs-th is-role">Role / Tenure</th>` +
    `<th scope="col" class="sct-cs-th is-ppg"><abbr title="Team offensive points per game over the weeks he called">Points/G</abbr></th>` +
    `<th scope="col" class="sct-cs-th is-rank"><abbr title="The offense's scoring rank among the 32 clubs; a windowed rank covers the weeks he called only">NFL rank</abbr></th>` +
    `<th scope="col" class="sct-cs-th is-share">WR share<span class="sct-cs-th-sub">of targets (vs league)</span></th>` +
    `<th scope="col" class="sct-cs-th is-share">RB share</th>` +
    `<th scope="col" class="sct-cs-th is-share">TE share</th>` +
    `<th scope="col" class="sct-cs-th is-lb">Lead back<span class="sct-cs-th-sub">% of carries + 2 × targets</span></th>` +
    `</tr></thead><tbody>${m.rows.map(row).join("")}</tbody></table></div>` +
    `<p class="sct-cs-hint" aria-hidden="true">Scroll sideways to see every column.</p>` +
    `<p class="sct-cs-note"><span class="sct-cs-note-icon">${ICON["info"]}</span><span>${e(m.note)}</span></p>` +
    `</div>` +
    `</section>` +
    `</div>`
  );
}
