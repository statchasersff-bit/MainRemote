/**
 * Markup for the durability tabs: Overview, Injury database (one row per
 * injury event), Current players (by durability), Draft simulator and
 * Methodology, plus the durability profile a player's page in the Injury
 * history tab carries. The Gridiron Medical + page's renderers
 * (RESEARCH-Injury-Impact-Analysis at c6a49ce, public/gridiron-medical.html:
 * buildOverview, buildDatabase, buildRankings, profileHTML, availGrid,
 * collegeGrid, dial, buildSimulator, runSim, buildMethodology), in the house
 * dress. Shared by the server (the default view) and the bundle (every
 * redraw after a filter, a sort, a page or a run).
 */

import { escapeHtml, teamLogoAssetUrl } from "../render";
import { headshotPath } from "../image-urls";
import { initials } from "./player";
import {
  ADP_TOP,
  EVENT_PAGE_SIZES,
  FULL_SEASON_ODDS,
  IN_PROGRESS_WEIGHT,
  PRIOR_GAMES,
  ROSTER_CAP,
  SEASON_WEIGHTS,
  SEV_LABEL,
  SEV_SHORT,
  SIM_SEASONS,
  STARTER_SNAP_SHARE,
  TYPE_LABEL,
  eventOptions,
  eventRows,
  fmtScore,
  overviewView,
  rankPool,
  rankRows,
  rankTeams,
  seasonSpanOf,
  type Durability,
  type EventSortKey,
  type EventState,
  type GmInjury,
  type GmPlayer,
  type InjuryEventRow,
  type InjuryTiming,
  type RankSortKey,
  type RankState,
  type SimResult,
  type Tier,
} from "./durability";
import { h2, h3, houseText, labeled, n0, n1, note, posColorOf, select, sortIcon } from "./render-shared";
import { impactTone } from "./render-database";
import type { InjuryAssets } from "./types";

/* ----------------------------------------------------------------- pieces */

/** The durability score, colored by its risk tier; the tier name is the tooltip. */
export function scoreText(score: number, t: Tier): string {
  return `<span class="scin-score is-${t.key}" title="${escapeHtml(t.name)}">${fmtScore(score)}</span>`;
}

export function sevChip(s: number): string {
  return `<span class="scin-gm-chip is-sev${s}" title="${escapeHtml(SEV_LABEL[s] ?? "")}">${SEV_SHORT[s] ?? ""}</span>`;
}

export function typeChip(t: GmInjury["type"]): string {
  return `<span class="scin-gm-chip is-type-${t}">${TYPE_LABEL[t]}</span>`;
}

export function reinjChip(): string {
  return `<span class="scin-gm-chip is-reinj" title="Same body part caused an earlier event">re-injury</span>`;
}

/** "Right knee" when the data names a side, else the plain body part. */
export const sidedPart = (e: { side: string; bodyPart: string }): string => (e.side ? `${e.side} ${e.bodyPart.toLowerCase()}` : e.bodyPart);

/**
 * The house player cell (the player pages' search rows): the portrait with
 * the club's crest on its bottom-right corner, the name over the position
 * and team. A button that opens the player's page over the current tab.
 * `team` is the club for the row: the season's for an event, the current one
 * for a ranking.
 */
export function playerCell(p: { n: string; id?: string | null; key: string; pos: string }, team: string | null | undefined, assets: InjuryAssets): string {
  const sleeper = p.id ? assets.sleeper[p.id] : undefined;
  const version = sleeper ? assets.headshots[sleeper] : undefined;
  const shot = sleeper && version !== null ? `<img class="scin-face-shot" src="${escapeHtml(`${assets.origin}${headshotPath(sleeper, version, "160")}`)}" alt="" width="38" height="38" loading="lazy" decoding="async" data-fallback="${escapeHtml(initials(p.n) || "-")}" />` : `<span class="scin-face-text" aria-hidden="true">${escapeHtml(initials(p.n) || "-")}</span>`;
  const code = team ? (team === "LA" ? "lar" : team.toLowerCase()) : "";
  const crest = code ? teamLogoAssetUrl(code, assets.origin) : null;
  const badge = crest ? `<img class="scin-face-badge" src="${escapeHtml(crest)}" alt="" width="17" height="17" loading="lazy" decoding="async" />` : "";
  return (
    `<button type="button" class="scin-player-btn is-cell" data-player="${escapeHtml(p.id ?? "")}" data-player-name="${escapeHtml(p.n)}" data-gm-key="${escapeHtml(p.key)}" title="Open the full injury history and durability profile">` +
    `<span class="scin-face">${shot}${badge}</span>` +
    `<span class="scin-who"><span class="scin-who-name">${escapeHtml(p.n)}</span><span class="scin-who-meta"><span class="scin-who-pos" style="color:${posColorOf(p.pos)}">${escapeHtml(p.pos)}</span>${team ? `<span class="scin-who-team">${escapeHtml(team)}</span>` : ""}</span></span>` +
    `</button>`
  );
}

function statCard(k: string, v: string, sub: string): string {
  return `<div class="scin-tile"><p class="scin-tile-k">${escapeHtml(k)}</p><p class="scin-tile-big is-ink">${v}</p><p class="scin-tile-s">${sub}</p></div>`;
}

function barRow(label: string, val: number, max: number, disp: string): string {
  const pct = Math.max(0, Math.min(100, (100 * val) / max));
  return `<div class="scin-bar-row"><div class="scin-bar-label">${escapeHtml(label)}</div><div class="scin-bar-track"><div class="scin-bar-fill" style="width:${pct.toFixed(1)}%"></div></div><div class="scin-bar-val">${disp}</div></div>`;
}

/** The house pager under a table. */
function pager(prefix: string, n: number, pageIndex: number, pageCount: number, pageSize: number): string {
  const start = n === 0 ? 0 : pageIndex * pageSize + 1;
  const end = Math.min((pageIndex + 1) * pageSize, n);
  return (
    `<div class="scin-db-pager"><div class="scin-db-pager-left"><span class="scin-body is-muted">${n === 0 ? "0 results" : `Showing ${start}-${end} of ${n0(n)}`}</span>` +
    select(`${prefix}-page-size`, EVENT_PAGE_SIZES.map((s) => ({ value: String(s), label: `${s} / page` })), String(pageSize), "Rows per page") +
    `</div><div class="scin-db-pager-right"><span class="scin-body is-muted">Page ${pageIndex + 1} of ${pageCount}</span>` +
    `<button type="button" class="scin-btn" data-${prefix}-prev${pageIndex === 0 ? " disabled" : ""}>Previous</button><button type="button" class="scin-btn" data-${prefix}-next${pageIndex >= pageCount - 1 ? " disabled" : ""}>Next</button></div></div>`
  );
}

function sortTh<K extends string>(prefix: string, key: K, label: string, active: boolean, dir: 1 | -1, cls = "", title = ""): string {
  return `<th scope="col"${cls ? ` class="${cls}"` : ""}${active ? ` aria-sort="${dir === -1 ? "descending" : "ascending"}"` : ""}${title ? ` title="${escapeHtml(title)}"` : ""}><button type="button" class="scin-sort${active ? " is-active" : ""}" data-${prefix}-sort="${key}">${escapeHtml(label)}${sortIcon(active, dir === -1 ? "desc" : "asc")}</button></th>`;
}

/* ---------------------------------------------------------------- overview */

export function renderOverview(d: Durability, assets: InjuryAssets): string {
  const v = overviewView(d);
  return (
    `<p class="scin-lede">Across the loaded dataset (${v.yearSpan}), tracked players missed <strong>${n0(d.totalGamesMissed)} games</strong> to injury, an estimated <strong>${n0(d.totalPointsLost)} PPR points</strong> left on fantasy benches. Risk tiers below describe <em>missed-time risk only</em>, never talent or draft value.</p>` +
    `<div class="scin-tiles">` +
    statCard("Injury events", n0(d.rows.length), "time-loss events tracked") +
    statCard("Games missed", n0(d.totalGamesMissed), "attributed to injury") +
    statCard("Points lost", n0(d.totalPointsLost), "PPR, no replacement value") +
    statCard("Elevated / high risk", n0(d.riskyCount), `of ${n0(d.players.length)} players`) +
    `</div>` +
    `<div class="scin-grid2">` +
    `<div class="scin-block is-rule">${h3("Avg games missed per player-season, by position")}<div class="scin-bars">${v.posRows.map((r) => barRow(r.pos, r.avg, v.posMax, n1(r.avg))).join("")}</div>` +
    note(`League-wide odds of a full healthy season (research base rates): QB ${FULL_SEASON_ODDS["QB"]}, WR ${FULL_SEASON_ODDS["WR"]}, RB ${FULL_SEASON_ODDS["RB"]}, TE ${FULL_SEASON_ODDS["TE"]}.`) +
    `</div>` +
    `<div class="scin-block is-rule">${h3("Games missed by body part (top 8)")}<div class="scin-bars">${v.bpRows.map((r) => barRow(r.bp, r.gm, v.bpMax, n0(r.gm))).join("")}</div>` +
    note("Soft-tissue areas (hamstring, calf, groin, Achilles) recur at the highest rates.") +
    `</div>` +
    `</div>` +
    `<div class="scin-grid2">` +
    `<div class="scin-block is-rule">${h3("Most fantasy points lost")}<div class="scin-framed"><div class="scin-scroll"><table class="scin-table is-compact"><thead class="is-navy"><tr><th scope="col">Player</th><th scope="col" class="is-num">Games</th><th scope="col" class="is-num">Points lost</th></tr></thead><tbody>` +
    v.topLost.map((p) => `<tr><td>${playerCell(p, p.cur?.tm ?? p.tm, assets)}</td><td class="is-num">${n0(p.gmTot)}</td><td class="is-num">${n0(p.pointsLostCareer)}</td></tr>`).join("") +
    `</tbody></table></div></div></div>` +
    `<div class="scin-block is-rule">${h3("Most durable players")}<div class="scin-framed"><div class="scin-scroll"><table class="scin-table is-compact"><thead class="is-navy"><tr><th scope="col">Player</th><th scope="col" class="is-num">Durability</th></tr></thead><tbody>` +
    v.topDurable.map((p) => `<tr><td>${playerCell(p, p.cur?.tm ?? p.tm, assets)}</td><td class="is-num">${scoreText(p.score, p.tier)}</td></tr>`).join("") +
    `</tbody></table></div></div>` +
    note("Durability needs a track record: three or more loaded seasons, so one healthy year cannot top the list.") +
    `</div>` +
    `</div>`
  );
}

/* ---------------------------------------------------------- event database */

export function renderEventFilters(d: Durability, state: EventState): string {
  const f = state.filters;
  const o = eventOptions(d);
  const opt = (all: string, values: string[], labelOf: (v: string) => string = (v) => v) => [{ value: "", label: all }, ...values.map((v) => ({ value: v, label: labelOf(v) }))];
  const active = !!(f.search || f.pos || f.season || f.bodyPart || f.sev || f.team || f.impact || f.seasonEndingOnly);
  return (
    `<div class="scin-bar is-db" data-ev-bar>` +
    `<label class="scin-field is-search-db"><span class="scin-field-label">Search</span><input type="search" class="scin-input" placeholder="Player, injury, team, body part…" value="${escapeHtml(f.search)}" data-ev-search aria-label="Search injuries" /></label>` +
    labeled("Position", select("ev-pos", opt("All positions", o.positions), f.pos, "Position")) +
    labeled("Season", select("ev-season", opt("All seasons", o.seasons.map(String)), f.season, "Season")) +
    labeled("Body part", select("ev-body", opt("All body parts", o.bodyParts), f.bodyPart, "Body part")) +
    labeled("Severity", select("ev-sev", [{ value: "", label: "All severities" }, { value: "3", label: "Major (6+ / season-ending)" }, { value: "2", label: "Moderate (2-5)" }, { value: "1", label: "Minor (<2)" }], f.sev, "Severity")) +
    labeled("Team", select("ev-team", opt("All teams", o.teams), f.team, "Team")) +
    labeled("Impact", select("ev-impact", opt("All impacts", o.impacts), f.impact, "Impact")) +
    `<label class="scin-field is-switch"><span class="scin-field-label">Season-Ending</span><span class="scin-switch"><input type="checkbox" data-ev-ending${f.seasonEndingOnly ? " checked" : ""} aria-label="Season-ending injuries only" /><span class="scin-switch-track"></span><span class="scin-muted is-small">Only</span></span></label>` +
    (active ? `<button type="button" class="scin-clear" data-ev-reset>Clear</button>` : "") +
    `</div>`
  );
}

export function renderEventTable(d: Durability, state: EventState, assets: InjuryAssets): string {
  const rows = eventRows(d, state);
  const n = rows.length;
  const pageCount = Math.max(1, Math.ceil(n / state.pageSize));
  const pageIndex = Math.min(state.pageIndex, pageCount - 1);
  const page = rows.slice(pageIndex * state.pageSize, (pageIndex + 1) * state.pageSize);
  const th = (key: EventSortKey, label: string, cls = "") => sortTh("ev", key, label, state.sort.key === key, state.sort.dir, cls);
  const tr = (r: InjuryEventRow) => {
    const t = r.timing;
    return (
      `<tr class="scin-ev-row"><td>${playerCell({ n: r.player, id: r.gsisId, key: r.key, pos: r.pos }, r.tm, assets)}</td>` +
      `<td class="is-num scin-strong">${r.year}</td>` +
      `<td class="is-num">${adpText(r.adp)}</td>` +
      `<td class="is-num">${injuryWeekText(t)}</td>` +
      `<td title="${escapeHtml(houseText(r.label))}">${escapeHtml(sidedPart(r))}${r.rec ? ` ${reinjChip()}` : ""}</td>` +
      `<td>${typeChip(r.type)}</td><td>${sevChip(r.sev)}</td>` +
      `<td class="is-num">${gamesMissedText(r.gm, t)}</td>` +
      `<td class="is-num">${weeksOutText(t)}</td>` +
      `<td class="is-num">${returnText(t)}</td>` +
      `<td>${seasonEndingText(t)}</td>` +
      `<td>${impactText(r.impact)}</td></tr>`
    );
  };
  const projected = page.some((r) => r.timing.ongoing);
  return (
    `<div data-ev-table>` +
    `<div class="scin-db-meta"><p class="scin-body is-muted"><strong class="scin-strong">${n0(n)}</strong> of ${n0(d.rows.length)} injury events shown.</p><button type="button" class="scin-btn" data-ev-csv${n === 0 ? " disabled" : ""} title="Every event matching the filters, in the current order">Download CSV</button></div>` +
    `<div class="scin-framed"><div class="scin-scroll"><table class="scin-table is-db is-events"><thead class="is-navy"><tr>${th("player", "Player")}${th("year", "Season", "is-w20 is-num")}${th("adp", "ADP", "is-w20 is-num")}${th("week", "Week of injury", "is-num")}${th("bodyPart", "Body part")}${th("type", "Type")}${th("sev", "Severity", "is-w20")}${th("gm", "Games missed", "is-num")}${th("weeksOut", "Weeks out", "is-num")}${th("returnWeek", "Return week", "is-num")}${th("seasonEnding", "Season ending", "is-w20")}${th("impact", "Impact")}</tr></thead><tbody>` +
    (page.length ? page.map(tr).join("") : `<tr><td colspan="12" class="scin-empty-cell">No injury events match these filters. Clear one filter to widen the search.</td></tr>`) +
    `</tbody></table></div></div>` +
    pager("ev", n, pageIndex, pageCount, state.pageSize) +
    note(
      `ADP and Impact are the impact study's: the player's redraft draft cost that season and its label (Severe, Major, Moderate, Minor, No ADP Impact, or In progress this season); a season the study did not price shows neither. ` +
        `Weeks out count bye weeks; a plus sign means the player is still out and the count runs to the latest week with stats. ` +
        `<strong>Proj.</strong> return weeks are a base rate, not a report: the typical absence for that body part across this database, never shorter than the games already missed plus one, at least four games for a player on injured reserve, and skipping the team's bye.`,
      projected ? "" : "is-quiet"
    ) +
    `</div>`
  );
}

/** The study's redraft ADP, one decimal; a dash when the study did not price that season. */
export function adpText(adp: number | null): string {
  return adp == null ? `<span class="scin-muted">-</span>` : `<span class="scin-adp">${adp.toFixed(1)}</span>`;
}

/** Games missed to the injury; a plus sign while he is still out. */
export function gamesMissedText(gm: number, t: InjuryTiming): string {
  return t.ongoing ? `<span title="Still out: games through the latest week with stats">${gm}+</span>` : String(gm);
}

/** Yes, Still out, or No: the Injury history table's Season Ending cell. */
export function seasonEndingText(t: InjuryTiming): string {
  if (t.seasonEnding) return `<span class="scin-badge is-red">Yes</span>`;
  if (t.ongoing) return `<span class="scin-badge is-amber" title="Still out at the latest week with stats">Still out</span>`;
  return `<span class="scin-muted is-small">No</span>`;
}

/** The study's impact badge, or a dash for a season it did not price. */
export function impactText(impact: string | null): string {
  return impact == null ? `<span class="scin-muted">-</span>` : `<span class="scin-badge is-impact ${impactTone(impact)}">${escapeHtml(impact)}</span>`;
}

/** The week number, or "Playoffs" for an event the label dates to the postseason. */
export function injuryWeekText(t: InjuryTiming): string {
  return t.week == null ? `<span class="scin-muted">Playoffs</span>` : String(t.week);
}

/** The weeks from the first missed game; "4+" while he is still out. */
export function weeksOutText(t: InjuryTiming): string {
  if (t.weeksOut == null) return `<span class="scin-muted">-</span>`;
  return t.ongoing ? `<span title="Still out: weeks through the latest week with stats">${t.weeksOut}+</span>` : String(t.weeksOut);
}

/** The return week; a projection while he is still out; "Out for season" when he never came back. */
export function returnText(t: InjuryTiming): string {
  if (t.week == null) return `<span class="scin-muted">-</span>`;
  if (t.ongoing) {
    return t.projectedReturn == null
      ? `<span class="scin-gm-proj" title="Projected from the typical absence for this body part: past the end of the regular season">Proj. season</span>`
      : `<span class="scin-gm-proj" title="Projected from the typical absence for this body part, not a report">Proj. ${t.projectedReturn}</span>`;
  }
  if (t.returnWeek != null) return String(t.returnWeek);
  if (t.returnedInPlayoffs) return `<span title="Came back for the postseason">Playoffs</span>`;
  return `<span class="scin-muted">${t.seasonEnding ? "Out for season" : "Did not return"}</span>`;
}

export function renderEventDatabase(d: Durability, state: EventState, assets: InjuryAssets): string {
  return (
    h2("Injury database") +
    `<p class="scin-lead is-sub">One row per injury event. Every absence here has an injury-report trail: suspensions, benchings and illness lists are excluded upstream.</p>` +
    renderEventFilters(d, state) +
    renderEventTable(d, state, assets)
  );
}

/* --------------------------------------------------------- current players */

export function renderRankFilters(d: Durability, state: RankState): string {
  const f = state.filters;
  const opt = (all: string, values: string[]) => [{ value: "", label: all }, ...values.map((v) => ({ value: v, label: v }))];
  const active = !!(f.search || f.pos || f.team || f.status || f.minSeasons > 1);
  return (
    `<div class="scin-bar is-db" data-rk-bar>` +
    `<label class="scin-field is-search-db"><span class="scin-field-label">Search</span><input type="search" class="scin-input" placeholder="Player or team…" value="${escapeHtml(f.search)}" data-rk-search aria-label="Search players" /></label>` +
    labeled("Position", select("rk-pos", opt("All positions", ["QB", "RB", "WR", "TE"]), f.pos, "Position")) +
    labeled("Team", select("rk-team", opt("All teams", rankTeams(d)), f.team, "Team")) +
    labeled("Roster status", select("rk-status", [{ value: "", label: "Any status" }, { value: "ACT", label: "Active roster" }, { value: "IR", label: "On injured reserve" }], f.status, "Roster status")) +
    labeled("Record", select("rk-min", [{ value: "1", label: "Any record" }, { value: "2", label: "2+ seasons" }, { value: "3", label: "3+ seasons" }, { value: "5", label: "5+ seasons" }], String(f.minSeasons), "Minimum seasons")) +
    (active ? `<button type="button" class="scin-clear" data-rk-reset>Clear</button>` : "") +
    `</div>`
  );
}

export function renderRankTable(d: Durability, state: RankState, assets: InjuryAssets): string {
  const rows = rankRows(d, state);
  const all = rankPool(d);
  const hasAdp = all.some((p) => p.adpRank != null);
  const n = rows.length;
  const pageCount = Math.max(1, Math.ceil(n / state.pageSize));
  const pageIndex = Math.min(state.pageIndex, pageCount - 1);
  const page = rows.slice(pageIndex * state.pageSize, (pageIndex + 1) * state.pageSize);
  const th = (key: RankSortKey, label: string, cls = "", title = "") => sortTh("rk", key, label, state.sort.key === key, state.sort.dir, cls, title);
  const thin = (p: GmPlayer) => p.nEff < PRIOR_GAMES;
  const tr = (r: (typeof rows)[number]) =>
    `<tr class="scin-rk-row${thin(r.p) ? " is-thin" : ""}"${thin(r.p) ? ` title="Thin recent record: under one full-workload season of games, so the score leans on the position average"` : ""}>` +
    `<td class="is-num scin-muted">${r.rank}</td>` +
    `<td><span class="scin-cell-row">${playerCell(r.p, r.tm, assets)}${r.p.cur!.st === "IR" ? `<span class="scin-gm-chip is-ir" title="On injured reserve / PUP / NFI now">IR</span>` : r.p.cur!.st === "RES" ? `<span class="scin-gm-chip" title="On a non-injury reserve list now">reserve</span>` : ""}</span></td>` +
    `<td>${scoreText(r.score, r.p.tier)}</td>` +
    `<td class="is-num">${r.adp != null ? n1(r.adp) : `<span class="scin-muted">-</span>`}</td>` +
    `<td class="is-num" title="${escapeHtml(seasonSpanOf(r.p))}">${r.seasons}</td>` +
    `<td class="is-num">${n1(r.avail)}%</td><td class="is-num">${n0(r.gm)}</td><td class="is-num">${r.major || "-"}</td></tr>`;
  return (
    `<div data-rk-table>` +
    `<div class="scin-db-meta"><p class="scin-body is-muted"><strong class="scin-strong">${n0(n)}</strong> of ${n0(all.length)} ${hasAdp ? `top-${ADP_TOP} ADP ` : ""}current players with a score. Click a name for the full profile and availability grid.</p><button type="button" class="scin-btn" data-rk-csv${n === 0 ? " disabled" : ""} title="Every current player matching the filters, in the current order">Download CSV</button></div>` +
    `<div class="scin-framed"><div class="scin-scroll"><table class="scin-table is-db"><thead class="is-navy"><tr>` +
    `<th scope="col" class="is-w14" title="Durability rank among the players shown">#</th>${th("n", "Player")}` +
    th("score", "Durability", "", "0-100; higher = more durable") +
    th("adp", "ADP", "is-w20", "Average draft position, redraft PPR (this season); - = not on the board") +
    th("seasons", "Seasons", "is-w20", "Seasons in the data") +
    th("avail", "Available", "is-w20", "Share of team games played, playoffs included") +
    th("gm", "Games missed", "is-w20", "Games missed to injury, playoffs included") +
    th("major", "Major", "is-w16", "Major injuries: 6+ games or season-ending") +
    `</tr></thead><tbody>` +
    (page.length ? page.map(tr).join("") : `<tr><td colspan="8" class="scin-empty-cell">No current players match these filters.</td></tr>`) +
    `</tbody></table></div></div>` +
    `<div class="scin-score-key" aria-label="Durability score colors"><span><b class="scin-score is-iron">85+</b> Iron tier</span><span><b class="scin-score is-moderate">70-84</b> Moderate risk</span><span><b class="scin-score is-elevated">55-69</b> Elevated risk</span><span><b class="scin-score is-high">&lt;55</b> High risk</span></div>` +
    pager("rk", n, pageIndex, pageCount, state.pageSize) +
    `</div>`
  );
}

export function renderRankings(d: Durability, state: RankState, assets: InjuryAssets): string {
  const c = d.current;
  const cur = rankPool(d);
  if (!c || !cur.length) {
    return h2("Current players") + `<p class="scin-empty">This dataset has no current-roster information.</p>`;
  }
  const hasAdp = cur.some((p) => p.adpRank != null);
  const older = SEASON_WEIGHTS.slice(2, -1)
    .map((w, i) => `${c.season - 3 - i} ${w}`)
    .join(", ");
  return (
    h2("Current players by durability") +
    `<p class="scin-lead is-sub">${hasAdp ? `The top ${ADP_TOP} QBs, RBs, WRs and TEs on the ${c.season} ADP board (redraft PPR) who are on an NFL roster now (week ${c.week}) and have a durability score` : `Every QB, RB, WR and TE on an NFL roster now (${c.season} week ${c.week}) who has a durability score`}, highest first. ` +
    `The score is a read on <strong>this season's</strong> risk: seasons (and their injuries) are weighted ${c.season - 1} ${SEASON_WEIGHTS[0]}, ${c.season - 2} ${SEASON_WEIGHTS[1]}, ${c.season} so far ${IN_PROGRESS_WEIGHT}, ${older} and anything earlier ${SEASON_WEIGHTS[SEASON_WEIGHTS.length - 1]}, ` +
    `and a thin or part-time recent record is pulled toward the position average (see Methodology). Faded rows have less than one full-workload season of recent evidence. ` +
    (hasAdp ? `Draftees who haven't played or missed a game yet don't have a score. <strong>ADP</strong> is ${c.season} redraft PPR average draft position: sort by it to see where durability risk is being drafted. ` : `${n0(c.skill - c.scored)} of the ${n0(c.skill)} rostered QB/RB/WR/TE have no score yet, mostly players who were never drafted in fantasy leagues. `) +
    `Other positions aren't in the injury data.</p>` +
    renderRankFilters(d, state) +
    renderRankTable(d, state, assets)
  );
}

/* ------------------------------------------------------------- profile */

function dial(score: number, tier: Tier): string {
  const r = 46;
  const c = 2 * Math.PI * r;
  const off = c * (1 - score / 100);
  return (
    `<svg class="scin-dial" width="118" height="118" viewBox="0 0 118 118" role="img" aria-label="Durability ${fmtScore(score)} of 100, ${escapeHtml(tier.name)}">` +
    `<circle cx="59" cy="59" r="${r}" fill="none" class="scin-dial-track" stroke-width="11"/>` +
    `<circle cx="59" cy="59" r="${r}" fill="none" class="scin-dial-arc is-${tier.key}" stroke-width="11" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 59 59)"/>` +
    `<text x="59" y="56" text-anchor="middle" class="scin-dial-num is-${tier.key}">${fmtScore(score)}</text>` +
    `<text x="59" y="74" text-anchor="middle" class="scin-dial-sub">/ 100</text>` +
    `</svg>`
  );
}

const BOX: Record<string, [string, string]> = { P: ["g", "played"], X: ["r", "missed to injury"], D: ["d", "dressed, didn't play"], "-": ["d", "didn't play (not injury)"] };

/** One box per team game, a row per season of the player's career; playoffs after a gap. */
export function renderAvailGrid(d: Durability, p: GmPlayer): string {
  const all = [...d.years].sort((x, y) => x - y);
  const active = all.filter((y) => p.seasons[y]);
  const years = active.length ? all.filter((y) => y >= active[0]! && y <= active[active.length - 1]!) : all;
  const hasPO = years.some((y) => p.post[y]);
  const box = (k: string, t: string) => `<span class="scin-ab is-${k}" title="${escapeHtml(t)}"></span>`;
  const rows = years
    .map((y) => {
      let boxes = "";
      const po = p.post[y];
      const ws = p.w && p.w[String(y)];
      if (ws && p.seasons[y]) {
        const [reg = "", post = ""] = ws.split("|");
        let g = 0;
        [...reg].forEach((ch, i) => {
          if (ch === "B") {
            const inj = reg[i - 1] === "X" || reg.slice(i + 1).replace(/^B+/, "")[0] === "X";
            boxes += `<span class="scin-ab is-bye is-${inj ? "r" : "g"}" title="${y}: bye week (${inj ? "injured" : "healthy"} around it)"></span>`;
            return;
          }
          const [k, t] = BOX[ch] ?? BOX["-"]!;
          g += 1;
          boxes += box(k, `${y}, game ${g}: ${t}`);
        });
        for (let i = reg.length; i < 18; i += 1) boxes += box("d", `${y}: beyond this season's game count`);
        if (post) {
          boxes += `<span></span>`;
          [...post].forEach((ch, i) => {
            const [k, t] = BOX[ch] ?? BOX["-"]!;
            boxes += box(k, `${y} playoffs, game ${i + 1}: ${t}`);
          });
        }
        return `<div class="scin-av-row"><span class="scin-av-year">${y}</span><span class="scin-av-boxes${hasPO ? " with-po" : ""}">${boxes}</span></div>`;
      }
      if (p.seasons[y]) {
        const gp = p.seasons[y]![0] - (po ? po[0] : 0);
        const gm = p.seasons[y]![1] - (po ? po[1] : 0);
        for (let i = 0; i < gp; i += 1) boxes += box("g", `${y}: played`);
        for (let i = 0; i < gm; i += 1) boxes += box("r", `${y}: missed to injury`);
        for (let i = gp + gm; i < 18; i += 1) boxes += box("d", `${y}: beyond this season's game count`);
      } else {
        for (let i = 0; i < 18; i += 1) boxes += box("d", `${y}: not rostered / pre-career`);
      }
      if (po) {
        const [pp, pm, pt] = po;
        boxes += `<span></span>`;
        for (let i = 0; i < pp; i += 1) boxes += box("g", `${y} playoffs: played`);
        for (let i = 0; i < pm; i += 1) boxes += box("r", `${y} playoffs: missed to injury`);
        for (let i = pp + pm; i < pt; i += 1) boxes += box("d", `${y} playoffs: did not play (not injury)`);
      }
      return `<div class="scin-av-row"><span class="scin-av-year">${y}</span><span class="scin-av-boxes${hasPO ? " with-po" : ""}">${boxes}</span></div>`;
    })
    .join("");
  const head = hasPO ? `<div class="scin-av-row"><span></span><span class="scin-av-boxes with-po"><span class="scin-av-po">Playoffs</span></span></div>` : "";
  return (
    `<div class="scin-avail">${head}${rows}` +
    `<div class="scin-av-legend"><span><i class="is-g"></i>played</span><span><i class="is-r"></i>missed to injury</span><span><i class="is-g is-bye"></i><i class="is-r is-bye"></i>bye (healthy / injured)</span><span><i class="is-d"></i>not rostered / short season / inactive</span></div></div>`
  );
}

function collegeGrid(p: GmPlayer): string {
  if (!p.college) return "";
  const years = Object.keys(p.college.s)
    .map(Number)
    .sort((a, b) => a - b);
  const rows = years
    .map((y) => {
      const [gp, ab] = p.college!.s[y]!;
      let boxes = "";
      for (let i = 0; i < gp; i += 1) boxes += `<span class="scin-ab is-g" title="${y}: appeared"></span>`;
      for (let i = 0; i < ab; i += 1) boxes += `<span class="scin-ab is-a" title="${y}: absent (cause unknown)"></span>`;
      return `<div class="scin-av-row"><span class="scin-av-year">${y}</span><span class="scin-av-boxes">${boxes}</span></div>`;
    })
    .join("");
  return (
    `<div class="scin-block is-rule">${h3(`College availability: ${p.college.school}`)}<div class="scin-avail">${rows}<div class="scin-av-legend"><span><i class="is-g"></i>appeared</span><span><i class="is-a"></i>absent</span></div></div>` +
    note("Amber = a game the player had no stat line. The NCAA mandates no injury reports, so the <strong>cause of college absences is publicly unknowable</strong>. These are research flags only and never enter any score or points-lost figure.") +
    `</div>`
  );
}

/** One player's durability profile: dial, availability grid, injury timeline. */
export function renderDurabilityProfile(d: Durability, p: GmPlayer): string {
  const left =
    `<div class="scin-block is-rule">` +
    `<p class="scin-body"><strong class="scin-score is-${p.tier.key}">${escapeHtml(p.tier.name)}</strong> <span class="scin-muted">missed-time risk, not talent</span> <span class="scin-muted">· <span class="scin-pos" style="color:${posColorOf(p.pos)}">${escapeHtml(p.pos)}</span> · ${escapeHtml(p.tm)} · ${n1(p.ppg)} healthy PPR/game${p.adp != null ? ` · ADP ${n1(p.adp)}` : ""}</span></p>` +
    `<div class="scin-dial-wrap">${dial(p.score, p.tier)}<div class="scin-dial-stats"><div><b>${n1(p.availPct)}%</b> availability</div><div><b>${n0(p.gmTot)}</b> games missed (${p.seasonYears.length} season${p.seasonYears.length === 1 ? "" : "s"})</div><div><b>${n1(p.perYearRate)}</b> games/season rate</div></div></div>` +
    `<div class="scin-tiles is-2"><div class="scin-tile"><p class="scin-tile-k">Major injuries</p><p class="scin-tile-big is-ink">${p.major}</p></div><div class="scin-tile"><p class="scin-tile-k">Soft-tissue events</p><p class="scin-tile-big is-ink">${p.soft}</p></div></div>` +
    `<p class="scin-body${p.reinj ? "" : " is-muted"}">${p.reinj ? "Re-injury flag: a body part here caused more than one event, the strongest repeat-risk signal." : "No re-injury pattern in this window."}</p>` +
    h3("Availability: one box per team game") +
    // The player page moves its Affected Regions section in after this grid.
    `<div data-gm-avail>${renderAvailGrid(d, p)}</div>` +
    `</div>` +
    collegeGrid(p);
  const right =
    `<div class="scin-block is-rule">${h3("Injury timeline, newest first")}` +
    (p.inj.length
      ? p.inj.map((e) => `<div class="scin-tl-item"><div class="scin-tl-year">${e.year}</div><div class="scin-tl-label">${escapeHtml(houseText(e.label))}</div><div class="scin-tl-chips">${sevChip(e.sev)} ${typeChip(e.type)} ${e.rec ? reinjChip() : ""}</div></div>`).join("")
      : `<p class="scin-empty">No time-loss injuries tracked in this window. That's the whole scouting report.</p>`) +
    `</div>`;
  return `<div class="scin-profile-grid">${left}<div>${right}</div></div>`;
}

/** The section a player's page carries under the weekly reports. */
export function renderProfileSection(d: Durability | null, name: string, key: string | null): string {
  const p = d && key ? (d.byKey[key] ?? null) : null;
  return (
    `<section class="scin-gm-prof" data-gm-profile aria-label="Durability profile">${h3("Durability profile")}` +
    `<p class="scin-body is-muted">Durability score, availability by game and injury timeline, from the same audited data as the Current players tab.</p>` +
    (p ? renderDurabilityProfile(d!, p) : `<p class="scin-empty">No durability profile for ${escapeHtml(name)}. Profiles cover drafted QBs, RBs, WRs and TEs from 2009 on.</p>`) +
    `</section>`
  );
}

/* ---------------------------------------------------------------- simulator */

export function renderRoster(d: Durability, roster: string[]): string {
  if (!roster.length) return `<span class="scin-muted">Roster empty. Add players or load a preset.</span>`;
  return roster
    .map((k) => {
      const p = d.byKey[k];
      if (!p) return "";
      return `<span class="scin-rchip">${escapeHtml(p.n)} <span class="scin-muted is-small">${p.pos} · ${fmtScore(p.score)}</span><button type="button" data-sim-rm="${escapeHtml(k)}" aria-label="Remove ${escapeHtml(p.n)}">×</button></span>`;
    })
    .join("");
}

export function renderSimResult(r: SimResult | null): string {
  if (!r) return `<p class="scin-empty">Add at least two players to simulate.</p>`;
  const cmax = Math.max(...r.bins.map((b) => b.count), 1);
  const bars = r.bins.map((b) => `<div class="scin-hbar${b.low ? " is-low" : ""}" style="height:${((b.count / cmax) * 100).toFixed(1)}%" title="About ${n0(b.mid)} pts: ${b.count} seasons"></div>`).join("");
  return (
    `<div class="scin-tiles">` +
    statCard("Expected points", n0(r.mean), `full-health ceiling ${n0(r.ceiling)}`) +
    statCard("Expected points lost", n0(r.ceiling - r.mean), "to injury, per season") +
    statCard("Avg games missed", n1(r.avgMissed), "across the roster / season") +
    statCard("Seasons with a 6+ miss", `${n0(100 * r.bigShare)}%`, "at least one player") +
    `</div>` +
    `<div class="scin-block is-rule">${h3(`Distribution of roster points across ${n0(r.n)} simulated seasons`)}<div class="scin-histo">${bars}</div><div class="scin-histo-axis"><span>min ${n0(r.min)}</span><span>median ${n0(r.p50)}</span><span>max ${n0(r.max)}</span></div>` +
    note(`10th-percentile season about <strong>${n0(r.p10)}</strong> pts, 90th about <strong>${n0(r.p90)}</strong> pts. The <span class="scin-red">red</span> bars are the injury-wrecked seasons (below the 10th percentile) you're insuring against: a safer build narrows that left tail.`) +
    `</div>`
  );
}

export function renderSimulator(d: Durability, roster: string[], result: SimResult | null = null): string {
  return (
    h2("Draft simulator") +
    `<p class="scin-lead is-sub">Stress-test a roster against injury luck over ${n0(SIM_SEASONS)} simulated seasons. Totals assume full-season starts with no replacement scoring, so the signal is the <strong>gap between rosters</strong>, not the absolute totals. Up to ${ROSTER_CAP} players.</p>` +
    `<div class="scin-bar is-sim">` +
    `<div class="scin-search is-sim" data-sim-search><label class="scin-field is-search-db"><span class="scin-field-label">Add a player</span><input type="search" class="scin-input" placeholder="Type a name…" autocomplete="off" data-sim-input aria-label="Add a player" /></label><ul class="scin-search-list" data-sim-list hidden></ul></div>` +
    `<button type="button" class="scin-btn" data-sim-safe>Safe build</button><button type="button" class="scin-btn" data-sim-upside>Upside build</button><button type="button" class="scin-btn is-primary" data-sim-run>Run ${n0(SIM_SEASONS)} seasons</button>` +
    `</div>` +
    `<div class="scin-roster" data-sim-roster>${renderRoster(d, roster)}</div>` +
    `<div data-sim-out>${result ? renderSimResult(result) : ""}</div>`
  );
}

/* -------------------------------------------------------------- methodology */

export function renderGmMethodology(d: Durability): string {
  const yr = `${d.years[0]}-${d.years[d.years.length - 1]}`;
  const w = SEASON_WEIGHTS;
  const p = (html: string) => `<p class="scin-body">${html}</p>`;
  return (
    h2("Methodology") +
    `<div class="scin-prose">` +
    `<div class="scin-gm-callout"><strong>Currently loaded:</strong> ${n0(d.players.length)} players · ${n0(d.rows.length)} injury events · seasons ${yr}. Source: ${escapeHtml(houseText(d.source))}</div>` +
    h3("Durability score (0-100)") +
    p(
      `The score is a read on <strong>this season's</strong> risk, not a career award. Start from <strong>recency-weighted availability</strong>: each season gets a weight <code>d</code> by how far it is from the last complete season, last season ${w[0]}, then ${w.slice(1, -1).join(", ")}, and ${w[w.length - 1]} for every season further back (for a player no longer on a roster, counting back from his last season), and availability is <code>A = sum of d x gamesPlayed / sum of d x (played + missed)</code>. Seasons are full seasons (playoffs included). The season in progress gets <code>d = ${IN_PROGRESS_WEIGHT}</code>, less than the two seasons before it, so a hot or cold first month can't swamp a full season. Old seasons keep a small weight, so a long career adds some evidence, but little.`,
    ) +
    p(
      `<strong>Shrink toward the position average by the evidence behind it.</strong> A perfect record over a few games, or over seasons of part-time snaps, says less than a full season as a starter. Each season's games count toward the evidence <code>n = sum of d x u x (played + missed)</code> in proportion to the player's snap share against a typical starter (QB ${STARTER_SNAP_SHARE["QB"]! * 100}%, RB ${STARTER_SNAP_SHARE["RB"]! * 100}%, WR ${STARTER_SNAP_SHARE["WR"]! * 100}%, TE ${STARTER_SNAP_SHARE["TE"]! * 100}% of offensive snaps; at least 15%; full weight before 2012, when snap counts begin). The availability used is <code>(A x n + mu x ${PRIOR_GAMES}) / (n + ${PRIOR_GAMES})</code>, where <code>mu</code> is the position's average availability: every player starts with ${PRIOR_GAMES} full-workload games' worth of average.`,
    ) +
    p(
      `Then subtract capped penalties, each injury weighted by the same <code>d</code> for its season: <code>0.6 x min(sevPen, 24)</code> where <code>sevPen</code> = 6 per major (severity 3) + 2 per moderate (severity 2; an ongoing injured-reserve stint counts at least moderate); and <code>0.6 x min(recPen, 16)</code> where <code>recPen</code> = 4 per re-injury event. The score is <code>100 x</code> that, kept to one decimal on a 0-100 scale with no cap. College data never enters the score.`,
    ) +
    h3("Risk tiers") +
    p(`85-100 <strong>Iron</strong> · 70-84.9 <strong>Moderate risk</strong> · 55-69.9 <strong>Elevated risk</strong> · 0-54.9 <strong>High risk</strong>. Tiers describe <strong>missed-time risk only</strong>, not talent, not draft value.`) +
    h3("Fantasy points lost") +
    p(
      `<code>points lost = games missed x healthy PPG</code>, where healthy PPG is the player's scoring in games played while off the injury report. Computed per event, per season and per career. It <strong>deliberately ignores replacement value</strong> so players stay directly comparable: it is not a projection of what a manager actually lost.`,
    ) +
    h3("Simulator design") +
    p(
      `For each of ${n0(SIM_SEASONS)} simulated seasons, every rostered player draws games missed from their own per-season history, scaled to 17 games, with recent seasons drawn more often: each season's chance is the durability score's recency weight (last complete season ${w[0]}, the one before ${w[1]}, and so on; the season in progress ${IN_PROGRESS_WEIGHT}), further scaled down by how much of it has been played. Then: +1-3 games with p=0.18 (fresh bad luck), -2 with p=0.12 (good luck), and a forced major (max of current, 6 + 0-7) with p=0.05 (the tail risk every model concedes). Missed games clamp to [0,17] and points = (17 - missed) x PPG. Absolute totals assume full-season starts with no replacement scoring: read the <strong>gap between rosters</strong>.`,
    ) +
    h3("Hard limits on history") +
    p(
      `Structured official injury reports begin in <strong>2009</strong>: that's the attribution floor. For 1999-2008, absences are visible from stats against schedules but their cause is unrecoverable; pre-1999 nothing usable is public. Games possible are computed per season from <code>played + missed</code>, <strong>never a hardcoded 17</strong>, so 16-game (pre-2021) and 17-game eras compare correctly. Seasons are <strong>full seasons</strong>: a team's playoff games count as games played or missed just like regular-season ones (the availability grid shows them after a gap). The draft simulator scales each season's miss rate to a 17-game fantasy season and draws recent seasons more often.`,
    ) +
    h3("The college caveat") +
    p(`The NCAA mandates no injury reports and no public dataset attributes college absences to injury. College availability is shown only as amber <strong>research flags</strong> and is <strong>excluded from every score and points-lost figure</strong>.`) +
    h3("Impact study and injury history tabs") +
    p(
      `Those two tabs are a separate, real-data study: the StatChasers Injury Impact Analysis (official injury reports, weekly stats and ADP, 2016-2025, top-180 drafted players). They have their own methodology, shown inside the Impact study tab, and don't use the durability score. A player's page (click any name) shows those reports next to the durability profile. Where the durability data disagrees with the reports, trust the reports.`,
    ) +
    h3("What this isn't") +
    p(
      `Not a live feed, not a prediction of when or how anyone gets hurt, and <strong>not medical advice</strong>: always verify a player's current status before drafting. Research shows many "injury-prone" labels are just bad-luck streaks; this tool exists to let you <strong>challenge a durability narrative with the underlying games</strong>, not merely confirm it.`,
    ) +
    `</div>`
  );
}
