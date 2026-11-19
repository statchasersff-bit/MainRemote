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
 * the original (career() in coaching-render.ts) was deleted. Every
 * number is the table's own model (historyModel in coaching-render.ts) and
 * the same stop colors; nothing is computed twice. Styles `.sct-cs-*` in
 * team.css on the premium tokens.
 */

import { escapeHtml } from "../render";
import type { TeamCoaching } from "./coaching";
import { historyModel, POS, readStops, stepLogo, stopColors, type HistoryRow, type Pos, type Print } from "./coaching-render";

const e = escapeHtml;

const CALENDAR = `<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18"/><path d="M8 3v4M16 3v4"/><path d="M8 14h2M12 14h2M16 14h2M8 17.5h2M12 17.5h2"/></g></svg>`;

const POS_LABEL: Record<Pos, string> = { WR: "WR share", RB: "RB share", TE: "TE share" };

/** The rank pill's grade: a top-ten offense green, the middle of the league neutral, the bottom third red; a windowed rank stays in words, ungraded. */
function rankPill(text: string): string {
  if (!text) return `<span class="sct-cs-none">–</span>`;
  const m = text.match(/^(\d+)(st|nd|rd|th)$/);
  // Phones drop " in window" (the season cell says "Wks 1-8 only"; mak, 2026-11-15).
  const w = text.match(/^(\d+(?:st|nd|rd|th))( in window)$/);
  if (!m) return `<span class="sct-cs-rank is-window">${w ? `${e(w[1]!)}<span class="sct-cs-rank-w">${e(w[2]!)}</span>` : e(text)}</span>`;
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

/**
 * Phones' season list (mak, 2026-11-15): one tappable row per season
 * (season and team, PPG, NFL rank, a chevron) whose details hold the WR /
 * RB / TE target shares with their league gap and the lead back's share;
 * a season he did not call before the next is one muted line. Same model
 * and same rank pill as the table, which phones hide (team.css). No pass
 * rate: the history stores none, and the shares are not one.
 */
function phoneRow(r: HistoryRow, liveNote: string): string {
  const { s, pt, p } = r;
  const note = r.live ? liveNote : r.win ? `${r.win} only` : s.caller ? "" : `${s.role} · not calling`;
  const head =
    `<span class="sct-csp-season"><span class="sct-csp-yr"><b>${pt.year}</b> ${e(s.code)}</span>${note ? `<span class="sct-csp-note">${e(note)}</span>` : ""}</span>` +
    `<span class="sct-csp-ppg">${e(pt.ppg.toFixed(1))}</span>` +
    `<span class="sct-csp-rank">${rankPill(r.rankText)}</span>`;
  const cls = `sct-csp-row${r.live ? " is-current" : ""}${s.caller ? "" : " is-notcaller"}${r.win ? " is-window" : ""}`;
  if (!p) return `<div class="${cls} is-flat"><div class="sct-csp-sum">${head}<span class="sct-csp-chev is-none" aria-hidden="true"></span></div></div>`;
  const share = (pos: Pos): string => {
    const v = p.shares[pos];
    const lg = p.league[pos];
    if (v == null) return `<div class="sct-csp-kv"><dt>${pos} targets</dt><dd>–</dd></div>`;
    const d = lg != null ? Math.round(v - lg) : null;
    const gap = d == null ? "" : `<span class="sct-csp-gap${d > 0 ? " is-up" : d < 0 ? " is-down" : ""}">${d === 0 ? "level with lg" : `${d > 0 ? "+" : "−"}${Math.abs(d)} ${Math.abs(d) === 1 ? "pt" : "pts"} vs lg`}</span>`;
    return `<div class="sct-csp-kv${r.lean === pos ? " is-lean" : ""}"><dt>${pos} targets</dt><dd><b>${v}%</b>${gap}</dd></div>`;
  };
  const lb = p.leadBack;
  return (
    `<details class="${cls}"><summary class="sct-csp-sum">${head}<span class="sct-csp-chev" aria-hidden="true"></span></summary>` +
    `<dl class="sct-csp-detail">${POS.map(share).join("")}` +
    `<div class="sct-csp-kv${lb != null && lb >= 65 ? " is-lean" : ""}"><dt title="The lead back's share of the backfield's carries + 2 × targets">Lead RB share</dt><dd><b>${lb != null ? `${lb}%` : "–"}</b><span class="sct-csp-gap">carries + 2×tgt</span></dd></div>` +
    `</dl></details>`
  );
}

/** Seasons shown before "Show all": the recent history; the rest folds below it. */
const RECENT = 5;

/**
 * The one historical table (mak's review, 2026-11-08): the career chart's
 * hidden "Career scoring by stop" table and the separate "Season by Season"
 * section repeated season, team, role, points per game and rank, so they
 * are one table now, printed inside Coaching Career & Historical
 * Performance under the chart. Newest season first; the latest RECENT
 * seasons show and the rest sit behind a CSS-only "Show all" toggle (every
 * row stays in the page). No Role column (the timeline above carries the
 * roles); a season he did not call and a partial window stay labeled.
 */
export function renderSeasonHistoryTable(c: TeamCoaching): string {
  const stops = readStops(c);
  const m = historyModel(c, stops);
  if (!m) return "";
  const colors = stopColors(stops);
  const peakLb = Math.max(-1, ...m.rows.map((r) => r.p?.leadBack ?? -1));
  const peakPpg = Math.max(...m.rows.filter((r) => r.s.caller).map((r) => r.pt.ppg));

  const row = (r: HistoryRow): string => {
    const { s, pt, p } = r;
    const logo = stepLogo(s.code);
    const lb = p?.leadBack ?? null;
    return (
      `<tr class="sct-cs-row${r.live ? " is-current" : ""}${s.caller ? "" : " is-notcaller"}${r.win ? " is-window" : ""}" style="--seg:${colors.get(s.code) ?? "#0b1634"}">` +
      `<th scope="row" class="sct-cs-td is-season"><span class="sct-cs-year">${pt.year}</span>` +
      (r.win ? `<span class="sct-cs-win" title="Partial season: only the weeks he called">${e(`${r.win} only`)}</span>` : "") +
      (s.caller ? "" : `<span class="sct-cs-win">${e(`${s.role} · not calling`)}</span>`) +
      (r.live ? `<span class="sct-cs-live">In-season</span>` : "") +
      `</th>` +
      `<td class="sct-cs-td is-team"><span class="sct-cs-club">` +
      (logo ? `<img class="sct-cs-crest" src="${e(logo)}" alt="" width="22" height="22" loading="lazy" decoding="async">` : "") +
      `<span class="sct-cs-code">${e(s.code)}</span></span></td>` +
      `<td class="sct-cs-td is-ppg"><span class="sct-cs-ppg${s.caller && pt.ppg === peakPpg ? " is-peak" : ""}">${e(pt.ppg.toFixed(1))}</span></td>` +
      `<td class="sct-cs-td is-rank">${rankPill(r.rankText)}</td>` +
      POS.map((pos) => shareCell(p, pos, r.lean, pt.year)).join("") +
      `<td class="sct-cs-td is-lb">` +
      (lb != null ? `<span class="sct-cs-lb${lb >= 65 ? " is-workhorse" : ""}${lb === peakLb && lb >= 0 ? " is-peak" : ""}">${lb}%</span>` : `<span class="sct-cs-none">–</span>`) +
      `</td>` +
      `</tr>`
    );
  };
  // Newest first: a gap band ("2024 · Not calling plays") sat before the row
  // after it, so in reverse it follows that row.
  const gap = (r: HistoryRow): string =>
    r.gapBefore ? `<tr class="sct-cs-gap"><td colspan="8"><span class="sct-cs-gap-icon" aria-hidden="true">${CALENDAR}</span>${e(`${r.gapBefore} · Not calling plays`)}</td></tr>` : "";
  const newest = [...m.rows].reverse();
  const recent = newest.slice(0, RECENT);
  const older = newest.slice(RECENT);
  const body = (rows: HistoryRow[]): string => rows.map((r) => row(r) + gap(r)).join("");
  const wk = c.tendencies.samples?.throughWeek;
  const liveNote = wk ? `Through Week ${wk}` : "In-season";
  const phoneGap = (r: HistoryRow): string =>
    r.gapBefore ? `<div class="sct-csp-gaprow"><span class="sct-csp-gap-yr">${e(r.gapBefore)}</span>Not calling plays</div>` : "";
  const phoneBody = (rows: HistoryRow[]): string => rows.map((r) => phoneRow(r, liveNote) + phoneGap(r)).join("");
  const id = `sct-cs-all-${e(c.playCaller.name.toLowerCase().replace(/[^a-z]+/g, "-"))}`;
  return (
    `<div class="sct-cs" id="coaching-seasons-premium" data-sct-premium="coaching-seasons">` +
    `<h4 class="sct-cs-title" id="sct-cs-title">${e(`Season by Season, ${m.span}`)}</h4>` +
    (older.length ? `<input type="checkbox" class="sct-cs-all" id="${id}">` : "") +
    `<div class="sct-cs-scroll" tabindex="0" role="region" aria-labelledby="sct-cs-title">` +
    `<table class="sct-cs-table">` +
    `<thead><tr>` +
    `<th scope="col" class="sct-cs-th is-season">Season</th>` +
    `<th scope="col" class="sct-cs-th is-team">Team</th>` +
    `<th scope="col" class="sct-cs-th is-ppg"><abbr title="Team offensive points per game over the weeks he called">PPG</abbr></th>` +
    `<th scope="col" class="sct-cs-th is-rank"><abbr title="The offense's scoring rank among the 32 clubs; a windowed rank covers the weeks he called only">NFL rank</abbr></th>` +
    `<th scope="col" class="sct-cs-th is-share">WR target %<span class="sct-cs-th-sub" title="Percentage points above or below the league average that season">pts vs lg</span></th>` +
    `<th scope="col" class="sct-cs-th is-share">RB target %</th>` +
    `<th scope="col" class="sct-cs-th is-share">TE target %</th>` +
    `<th scope="col" class="sct-cs-th is-lb">Lead RB %<span class="sct-cs-th-sub" title="The lead back's share of the backfield's carries + 2 × targets">carries + 2×tgt</span></th>` +
    `</tr></thead>` +
    `<tbody class="sct-cs-recent">${body(recent)}</tbody>` +
    (older.length ? `<tbody class="sct-cs-older">${body(older)}</tbody>` : "") +
    `</table></div>` +
    // Phones (team.css): the season list in place of the table.
    `<div class="sct-csp">` +
    `<div class="sct-csp-head" aria-hidden="true"><span>Season</span><span>PPG</span><span>NFL rank</span><span></span></div>` +
    `<div class="sct-csp-recent">${phoneBody(recent)}</div>` +
    (older.length ? `<div class="sct-csp-older">${phoneBody(older)}</div>` : "") +
    `</div>` +
    (older.length
      ? `<label class="sct-cs-more" for="${id}"><span class="sct-cs-more-show">${e(`Show all ${m.rows.length} seasons`)}</span><span class="sct-cs-more-hide">Show recent seasons only</span></label>`
      : "") +
    `<p class="sct-cs-hint" aria-hidden="true">Scroll sideways to see every column.</p>` +
    `<p class="sct-cs-note">${e(m.note)}</p>` +
    `</div>`
  );
}
