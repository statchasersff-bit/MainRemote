/**
 * The NFL Injury Database: every drafted-player injury season in the study,
 * with the season in progress on top, searchable and filterable, paged, with
 * a CSV export and an inline player detail. Ported from the app's
 * pages/InjuryDatabase.tsx; the table and the player panel are the same
 * components the dashboard's search dialog draws.
 */

import { escapeHtml } from "../render";
import { formatInjury, type SortDir } from "./model";
import { avatar, EMPTY_ASSETS, injuryPageCopy, labeled, n0, posSpan, renderMetaIsland, select, sortIcon, teamCrest, type InjuryRenderOptions } from "./render-shared";
import type { CurrentInjuryFile, InjuryAssets, PlayerInjuryImpact } from "./types";

export const POSITION_ORDER = ["QB", "RB", "WR", "TE"];
export const IN_PROGRESS = "In progress";
export const PAGE_SIZES = [25, 50, 100];

/** A table row: a completed-season impact, or an in-progress episode (no fantasy value yet, maybe still out). */
export type DbRow = PlayerInjuryImpact & { ongoing?: boolean };

export interface DbFilters {
  search: string;
  season: string;
  position: string;
  team: string;
  injury: string;
  impact: string;
  seasonEndingOnly: boolean;
}

export interface DbState {
  filters: DbFilters;
  sort: { id: keyof DbRow; desc: boolean };
  pageSize: number;
  pageIndex: number;
  /** The player open inline, or null for the table. */
  player: { gsisId: string | null; name: string } | null;
}

export const ALL = "all";

export function defaultDbState(): DbState {
  return {
    filters: { search: "", season: ALL, position: ALL, team: ALL, injury: ALL, impact: ALL, seasonEndingOnly: false },
    sort: { id: "season", desc: true },
    pageSize: 25,
    pageIndex: 0,
    player: null,
  };
}

/** The season in progress on top, then the completed seasons. */
export function dbRecords(impacts: PlayerInjuryImpact[], current: CurrentInjuryFile | null): DbRow[] {
  const live: DbRow[] = (current?.rows ?? []).map((c) => ({
    season: c.season,
    player: c.player,
    gsis_id: c.gsis_id,
    team: c.team,
    position: c.position,
    overall_adp: c.overall_adp as number,
    positional_adp: c.positional_adp as number,
    draft_round: c.draft_round as number,
    adp_tier: c.adp_tier as string,
    injury: c.injury,
    status: c.status,
    week_of_injury: c.week_of_injury,
    games_missed: c.games_missed,
    reg_games_missed: c.games_missed,
    playoff_games_missed: 0,
    season_ending: false,
    expected_fantasy_points: 0,
    actual_fantasy_points: 0,
    estimated_points_lost: 0,
    replacement_level_points: 0,
    net_value_lost: 0,
    impact_label: IN_PROGRESS,
    ...(c.ongoing ? { ongoing: true } : {}),
  }));
  return [...live, ...impacts];
}

export interface DbOptions {
  seasons: number[];
  positions: string[];
  teams: string[];
  injuries: string[];
  impacts: string[];
}

export function dbOptions(records: DbRow[]): DbOptions {
  const positions = POSITION_ORDER.filter((p) => records.some((r) => r.position === p)).concat(
    Array.from(new Set(records.map((r) => r.position)))
      .filter((p) => !POSITION_ORDER.includes(p))
      .sort(),
  );
  return {
    seasons: Array.from(new Set(records.map((r) => r.season))).sort((a, b) => b - a),
    positions,
    teams: Array.from(new Set(records.map((r) => r.team)))
      .filter(Boolean)
      .sort(),
    injuries: Array.from(new Set(records.map((r) => r.injury))).sort(),
    impacts: Array.from(new Set(records.map((r) => r.impact_label))).sort(),
  };
}

export function dbFiltered(records: DbRow[], f: DbFilters): DbRow[] {
  const q = f.search.trim().toLowerCase();
  return records.filter((r) => {
    if (q && !r.player.toLowerCase().includes(q)) return false;
    if (f.season !== ALL && String(r.season) !== f.season) return false;
    if (f.position !== ALL && r.position !== f.position) return false;
    if (f.team !== ALL && r.team !== f.team) return false;
    if (f.injury !== ALL && r.injury !== f.injury) return false;
    if (f.impact !== ALL && r.impact_label !== f.impact) return false;
    if (f.seasonEndingOnly && !r.season_ending) return false;
    return true;
  });
}

/** react-table's default sort: numbers numerically, strings by locale, nulls last. */
export function dbSorted(rows: DbRow[], sort: { id: keyof DbRow; desc: boolean }): DbRow[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    const av = a[sort.id] as unknown;
    const bv = b[sort.id] as unknown;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    let cmp: number;
    if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
    else if (typeof av === "boolean" && typeof bv === "boolean") cmp = Number(av) - Number(bv);
    else cmp = String(av).localeCompare(String(bv));
    return sort.desc ? -cmp : cmp;
  });
  return copy;
}

export function anyFilterActive(f: DbFilters): boolean {
  return f.search !== "" || f.season !== ALL || f.position !== ALL || f.team !== ALL || f.injury !== ALL || f.impact !== ALL || f.seasonEndingOnly;
}

/* -------------------------------------------------------------------- csv */

const CSV_FIELDS: (keyof PlayerInjuryImpact)[] = [
  "season", "player", "team", "position", "overall_adp", "positional_adp",
  "injury", "status", "week_of_injury", "games_missed", "reg_games_missed", "playoff_games_missed", "season_ending",
  "expected_fantasy_points", "actual_fantasy_points", "estimated_points_lost",
  "net_value_lost", "impact_label",
];

export function toCsv(rows: DbRow[]): string {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = CSV_FIELDS.join(",");
  const body = rows.map((r) => CSV_FIELDS.map((f) => esc(r[f])).join(",")).join("\n");
  return `${header}\n${body}`;
}

/* ----------------------------------------------------------------- markup */

export function impactTone(impact: string): string {
  if (impact === "Severe") return "is-red";
  if (impact === "Major") return "is-orange";
  if (impact === "Moderate") return "is-yellow";
  if (impact === "Minor") return "is-blue";
  if (impact === IN_PROGRESS) return "is-amber";
  return "";
}

export interface DbColumn {
  id: keyof DbRow;
  label: string;
  cls?: string;
}

export const DB_COLUMNS: DbColumn[] = [
  { id: "season", label: "Season", cls: "is-w20" },
  { id: "player", label: "Player" },
  { id: "team", label: "Team", cls: "is-w20" },
  { id: "position", label: "Pos", cls: "is-w16" },
  { id: "overall_adp", label: "ADP", cls: "is-w20" },
  { id: "injury", label: "Injury" },
  { id: "week_of_injury", label: "Wk", cls: "is-w14" },
  { id: "games_missed", label: "Games Missed", cls: "is-w16" },
  { id: "season_ending", label: "Season Ending", cls: "is-w20" },
  { id: "impact_label", label: "Impact" },
];

export function renderDbFilters(state: DbState, options: DbOptions): string {
  const f = state.filters;
  const opt = (values: string[], labelOf: (v: string) => string = (v) => v) => [{ value: ALL, label: "All" }, ...values.map((v) => ({ value: v, label: labelOf(v) }))];
  return (
    `<div class="scin-bar is-db" data-scin-bar>` +
    `<label class="scin-field is-search-db"><span class="scin-field-label">Search Player</span><input type="search" class="scin-input" placeholder="Player name…" value="${escapeHtml(f.search)}" data-db-search aria-label="Search player" /></label>` +
    labeled("Season", select("db-season", opt(options.seasons.map(String)), f.season, "Season")) +
    labeled("Position", select("db-position", opt(options.positions), f.position, "Position")) +
    labeled("Team", select("db-team", opt(options.teams), f.team, "Team")) +
    labeled("Injury", select("db-injury", opt(options.injuries, formatInjury), f.injury, "Injury")) +
    labeled("Impact", select("db-impact", opt(options.impacts), f.impact, "Impact")) +
    `<label class="scin-field is-switch"><span class="scin-field-label">Season-Ending</span><span class="scin-switch"><input type="checkbox" data-db-ending${f.seasonEndingOnly ? " checked" : ""} aria-label="Season-ending injuries only" /><span class="scin-switch-track"></span><span class="scin-muted is-small">Only</span></span></label>` +
    (anyFilterActive(f) ? `<button type="button" class="scin-clear" data-db-reset>Clear</button>` : "") +
    `</div>`
  );
}

export function renderDbRows(rows: DbRow[], assets: InjuryAssets): string {
  if (!rows.length) return `<tr><td colspan="${DB_COLUMNS.length}" class="scin-empty-cell">No injury records match the current filters.</td></tr>`;
  return rows
    .map(
      (r) =>
        `<tr class="scin-db-row">` +
        `<td class="scin-strong">${r.season}</td>` +
        `<td><button type="button" class="scin-player-btn" data-player="${escapeHtml(r.gsis_id ?? "")}" data-player-name="${escapeHtml(r.player)}" title="View full injury-report history">${avatar(r.gsis_id, r.player, assets, 28)}<span>${escapeHtml(r.player)}</span></button></td>` +
        `<td><span class="scin-team">${teamCrest(r.team, assets.origin)}<span>${escapeHtml(r.team)}</span></span></td>` +
        `<td>${posSpan(`${r.position}${r.positional_adp ?? ""}`).replace(`style="color:`, `data-pos="${escapeHtml(r.position)}" style="color:`)}</td>` +
        `<td>${r.overall_adp != null ? `<span class="scin-adp">${r.overall_adp.toFixed(1)}</span>` : `<span class="scin-muted">-</span>`}</td>` +
        `<td class="is-cap">${escapeHtml(formatInjury(r.injury))}</td>` +
        `<td class="scin-muted">${r.week_of_injury || "-"}</td>` +
        `<td${r.ongoing ? ' title="Still out: running count through the last completed week"' : ""}>${r.games_missed}${r.ongoing ? "+" : ""}</td>` +
        `<td>${r.season_ending ? `<span class="scin-badge is-red">Yes</span>` : r.ongoing ? `<span class="scin-badge is-amber" title="Still out at the last completed week">Still out</span>` : `<span class="scin-muted is-small">No</span>`}</td>` +
        `<td><span class="scin-badge is-impact ${impactTone(r.impact_label)}">${escapeHtml(r.impact_label)}</span></td>` +
        `</tr>`,
    )
    .join("");
}

export interface DbView {
  filtered: DbRow[];
  page: DbRow[];
  pageCount: number;
  pageIndex: number;
}

export function dbView(records: DbRow[], state: DbState): DbView {
  const filtered = dbSorted(dbFiltered(records, state.filters), state.sort);
  const pageCount = Math.max(1, Math.ceil(filtered.length / state.pageSize));
  const pageIndex = Math.min(state.pageIndex, pageCount - 1);
  return { filtered, page: filtered.slice(pageIndex * state.pageSize, (pageIndex + 1) * state.pageSize), pageCount, pageIndex };
}

export function renderDbTable(view: DbView, state: DbState, total: number, assets: InjuryAssets): string {
  const f = state.filters;
  const th = (c: DbColumn) => {
    const active = state.sort.id === c.id;
    const dir: SortDir = state.sort.desc ? "desc" : "asc";
    return `<th scope="col" class="${c.cls ?? ""}"${active ? ` aria-sort="${state.sort.desc ? "descending" : "ascending"}"` : ""}><button type="button" class="scin-sort${active ? " is-active" : ""}" data-db-sort="${c.id}">${escapeHtml(c.label)}${sortIcon(active, dir)}</button></th>`;
  };
  const n = view.filtered.length;
  const start = n === 0 ? 0 : view.pageIndex * state.pageSize + 1;
  const end = Math.min((view.pageIndex + 1) * state.pageSize, n);
  return (
    `<div data-db-table>` +
    `<div class="scin-db-meta"><p class="scin-body is-muted"><strong class="scin-strong">${n0(n)}</strong> injury record${n === 1 ? "" : "s"}${anyFilterActive(f) ? ` matching filters (of ${n0(total)})` : ""}</p><button type="button" class="scin-btn" data-db-export${n === 0 ? " disabled" : ""}>Export CSV</button></div>` +
    `<div class="scin-framed"><div class="scin-scroll"><table class="scin-table is-db"><thead class="is-navy"><tr>${DB_COLUMNS.map(th).join("")}</tr></thead><tbody>${renderDbRows(view.page, assets)}</tbody></table></div></div>` +
    `<div class="scin-db-pager"><div class="scin-db-pager-left"><span class="scin-body is-muted">${n === 0 ? "0 results" : `Showing ${start}-${end} of ${n0(n)}`}</span>${select("db-page-size", PAGE_SIZES.map((s) => ({ value: String(s), label: `${s} / page` })), String(state.pageSize), "Rows per page")}</div>` +
    `<div class="scin-db-pager-right"><span class="scin-body is-muted">Page ${view.pageIndex + 1} of ${view.pageCount}</span><button type="button" class="scin-btn" data-db-prev${view.pageIndex === 0 ? " disabled" : ""}>Previous</button><button type="button" class="scin-btn" data-db-next${view.pageIndex >= view.pageCount - 1 ? " disabled" : ""}>Next</button></div></div>` +
    `</div>`
  );
}

export function renderDbHeader(options: InjuryRenderOptions): string {
  const copy = injuryPageCopy("database");
  return `<header class="scin-head"><p class="scin-eyebrow is-gold">Fantasy Football</p>${options.embed ? "" : `<h1 class="scin-h1">${escapeHtml(copy.h1)}</h1>`}<p class="scin-lead">${escapeHtml(copy.description)}</p></header>`;
}

/**
 * The database as its own page. The server composes the seven-tab tool
 * instead (render-tool.ts, which takes the pieces above); this is the
 * standalone arrangement, kept for the database on its own.
 */
export function renderDatabasePage(records: DbRow[], state: DbState, options: InjuryRenderOptions = {}): string {
  const assets = options.assets ?? EMPTY_ASSETS;
  const view = dbView(records, state);
  return (
    `<div class="scin${options.embed ? " is-embed" : ""}" data-scin-root="1" data-scin-page="database"` +
    (options.dataUrl ? ` data-scin-data="${escapeHtml(options.dataUrl)}"` : "") +
    ` data-scin-assets="${escapeHtml(assets.origin)}"` +
    (options.siblingUrl ? ` data-scin-sibling="${escapeHtml(options.siblingUrl)}"` : "") +
    `>` +
    renderDbHeader(options) +
    renderDbFilters(state, dbOptions(records)) +
    `<div class="scin-main" data-scin-main>${renderDbTable(view, state, records.length, assets)}</div>` +
    `<div class="scin-player-host" data-scin-player hidden></div>` +
    (options.siblingUrl ? `<p class="scin-cross">For the study behind these records, open the <a href="${escapeHtml(options.siblingUrl)}">Fantasy Football Injury Risk Analysis</a>.</p>` : "") +
    `<div class="scin-tip" data-scin-tip hidden role="tooltip"></div>` +
    renderMetaIsland("database", options) +
    `</div>`
  );
}
