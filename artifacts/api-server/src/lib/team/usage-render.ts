/**
 * Markup for the team hub's Snap Counts & Player Usage page.
 *
 * Server-rendered in full, like the rest of the hub: the week in the context
 * line, every table and every number is in the HTML the server sends, because
 * the weekly change IS the recrawl signal. The client bundle only wires the
 * snap table's Season / Last 3 / Week switch (client/team.ts) and the + / −
 * profile toggles in the fantasy section; with scripting off the snap table
 * shows its season view and every advanced profile simply shows, expanded.
 *
 * Rebuilt 2026-11-05 on mak's NFL-first brief: the page is an NFL player
 * usage report first and a fantasy tool second. In order: header + context
 * line + intro, the four KPI cards, Snap Counts & Playing Time, Target
 * Distribution, Rushing Distribution, Situational Usage (the backfield grid,
 * with sample counts), Rushing Direction, Passing Distribution, Notable Usage
 * Changes (factual trends, in place of the Buy Low card), how the numbers are
 * counted, and then one Advanced & Fantasy Analysis section carrying the
 * tiered player table, the signal cards, the handcuff bridges and the tool
 * cards. A component whose data is missing is left out; the section as a
 * whole is left out when the club has no usage file entry, so the page is
 * never a set of empty cards.
 */

import { headshotImg } from "../headshot-html";
import { escapeHtml } from "../render";
import { slotChip } from "../team-render";
import { premiumPassMap, premiumRunDirection, USAGE_PREMIUM_COMPARE } from "./usage-premium";
import { getPlayerPageUrl } from "./links";
import {
  DYNASTY_LEAGUE_ANALYZER_URL,
  DYNASTY_RANKINGS_URL,
  DYNASTY_TRADE_CALCULATOR_URL,
  LEAGUE_ANALYZER_URL,
  RB_HANDCUFF_RANKINGS_URL,
  ROS_RANKINGS_URL,
  START_SIT_URL,
  TRADE_CALCULATOR_URL,
  WAIVER_WIRE_URL,
} from "../matchup/recap";
import type { NflTeam } from "./teams";
import { usageFaq, type UsageFaq } from "./usage-faq";
import { renderUsagePremium } from "./usage-premium-dashboard";
import {
  baseLabel,
  surname,
  trend,
  type RunGap,
  type Trend,
  type UsagePlayer,
  type UsageRow,
  type UsageView,
  type UsageWeek,
  type Zone,
} from "./usage";
import {
  GAP_LABEL,
  TIER_LABEL,
  ZONE_LABEL,
  backfieldTakeaways,
  bestGap,
  bestZone,
  handcuffProjection,
  handcuffFantasyLine,
  passNote,
  profileNote,
  rankLine,
  roleLine,
  runNote,
  signalCopy,
  signed,
  situationShare,
  usageTrends,
  zoneOwner,
} from "./usage-copy";

const e = escapeHtml;

/** Escaped prose with **double asterisks** set in bold - the copy module's one bit of markup. */
const md = (text: string) => e(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

/* ------------------------------------------------------------------ color */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

/** Relative luminance, 0 (black) to 1 (white). */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** `hex` mixed toward white by `amount` (0–1). */
function tint(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex([r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount]);
}

function distance(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

/** Ink that reads on `bg`. The coaching tab's coach card borrows it. */
export function inkOn(bg: string): string {
  return luminance(bg) > 0.4 ? "#0b1220" : "#ffffff";
}

const GOLD = "#d4af37";
const GRAYS = ["#94a3b8", "#cbd5e1", "#e2e8f0"];

/**
 * The segment palette: primary, a tint of it, secondary, a tint of that, the
 * StatChasers gold, then grays for depth.
 *
 * A secondary that cannot carry a segment - white (Colts, Jets), black
 * (Bengals), or near the primary - is swapped for a darkened tint of the
 * primary's complement in the house palette, so every club still gets four
 * distinguishable data colors.
 */
export function segmentPalette(team: NflTeam): string[] {
  const primary = team.primaryColor;
  let secondary = team.secondaryColor;
  const l = luminance(secondary);
  if (l > 0.8 || l < 0.02 || distance(primary, secondary) < 90) secondary = "#475569";
  return [primary, tint(primary, 0.45), secondary, tint(secondary, 0.45), GOLD, ...GRAYS];
}

/* ------------------------------------------------------------------- atoms */

function num(value: string, extra = ""): string {
  return `<span class="sct-us-num${extra ? ` ${extra}` : ""}">${e(value)}</span>`;
}

function h3(text: string, id = ""): string {
  return `<h3 class="sct-us-h3"${id ? ` id="${e(id)}"` : ""}>${e(text)}</h3>`;
}

export function playerLink(p: UsagePlayer, className: string): string {
  const href = getPlayerPageUrl(p.slug);
  return href
    ? `<a class="${className} sct-player-link" href="${e(href)}" target="_top">${e(p.name)}</a>`
    : `<span class="${className}">${e(p.name)}</span>`;
}

const f1 = (v: number) => v.toFixed(1);

/** "Weeks 6-8" / "Week 3" */
export function weeksWords(weeks: number[]): string {
  if (weeks.length === 0) return "";
  return weeks.length === 1 ? `Week ${weeks[0]}` : `Weeks ${weeks[0]}-${weeks[weeks.length - 1]}`;
}

/* --------------------------------------------------------- product bridges */

/*
 * Where the report hands off to a tool. Since the NFL-first rebuild
 * (2026-11-05) every handoff lives in the Advanced & Fantasy Analysis
 * section at the foot of the page: the handcuff line (RB Handcuff Rankings,
 * the Waiver Wire Scanner, then the dynasty tools) and the close cards that
 * group the tools by the decision the reader is making. Nothing above that
 * section links a fantasy tool. "Redraft Command" and "Dynasty Command" are
 * never a CTA. A tool whose address is not confirmed (null in
 * matchup/recap.ts) drops its link, and a line left with no link drops too.
 */

/** Where the report can send a reader next, decided by the page around it. */
export interface UsageLinks {
  /** This club's next matchup page, when the schedule has one. */
  matchup: { href: string; opponent: string } | null;
}

/**
 * `target="_top"` only for the site's absolute tool URLs: the hub's own
 * root-relative pages (the matchup preview) stay plain anchors like the tab
 * nav, since a sandboxed preview frame blocks a top-frame navigation outright.
 */
const topTarget = (href: string) => (/^https?:/.test(href) ? ` target="_top"` : "");

function tool(href: string | null, text: string, cta: string): string {
  return href
    ? `<a class="sct-textlink" href="${e(href)}"${topTarget(href)} data-cta="${e(cta)}">${e(text)}</a>`
    : "";
}

/** A one-line handoff under a section: the question in bold, then the link. */
function bridge(lead: string, html: string, quiet = false): string {
  return html ? `<p class="sct-us-bridge${quiet ? " is-quiet" : ""}">${lead ? `<strong>${e(lead)}</strong> ` : ""}${html}</p>` : "";
}

/** A row of tool links, "Trade Analyzer · ROS Rankings · League Analyzer"; dropped links leave no separator. */
function linkRow(items: string[], cls: string): string {
  const shown = items.filter(Boolean);
  return shown.length ? `<p class="${cls}">${shown.join(`<span aria-hidden="true"> · </span>`)}</p>` : "";
}

/* -------------------------------------------------------------- components */

/**
 * The heading (promoted to the page's H1 at /usage/ with the address's
 * phrase, "{Team} Snap Counts & Player Usage ({season})"). No freshness chip
 * (mak, 2026-11-04) and no "{season} Regular Season · Through Week N" context
 * line (mak, 2026-11-05): the week is on the KPI cards and the snaps caption.
 */
function header(_view: UsageView): string {
  return `<div class="sct-us-head"><h2 class="sct-h2">Snap Counts &amp; Player Usage</h2></div>`;
}

/** The intro, in the brief's words (2026-11-05), with the club's nickname. */
function intro(team: NflTeam): string {
  return (
    `<div class="sct-us-intro">` +
    `<p>${e(
      `Explore how the ${team.nickname} distribute offensive snaps, targets, rushing attempts, and red-zone opportunities. ` +
        `Track which players are seeing the field, where the ball is going, and how their roles change throughout the season.`,
    )}</p>` +
    `</div>`
  );
}

/**
 * The four KPI cards under the intro: target leader, rushing leader, second
 * in targets, team pass attempts. Counts first, the player under them, the
 * share as the caption; a card with nothing to count is left out.
 */
function kpis(view: UsageView): string {
  const byTargets = view.all.filter((p) => p.targets > 0).sort((a, b) => b.targets - a.targets);
  const byCarries = view.all.filter((p) => p.carries > 0).sort((a, b) => b.carries - a.carries);
  const tgt = view.team.targets;
  const share = (p: UsagePlayer) => (tgt ? `${f1((100 * p.targets) / tgt)}% team share` : "");
  const card = (label: string, value: string, who: string, sub: string) =>
    `<li class="sct-us-kpi">` +
    `<span class="sct-us-kpi-label">${e(label)}</span>` +
    `<span class="sct-us-kpi-value sct-us-num">${e(value)}</span>` +
    `<span class="sct-us-kpi-name">${who}</span>` +
    (sub ? `<span class="sct-us-kpi-sub">${e(sub)}</span>` : "") +
    `</li>`;
  const cards = [
    byTargets[0] ? card("Target leader", String(byTargets[0].targets), playerLink(byTargets[0], "sct-us-kpi-link"), share(byTargets[0])) : "",
    byCarries[0] ? card("Rushing leader", String(byCarries[0].carries), playerLink(byCarries[0], "sct-us-kpi-link"), "Rushing attempts") : "",
    byTargets[1] ? card("Second in targets", String(byTargets[1].targets), playerLink(byTargets[1], "sct-us-kpi-link"), share(byTargets[1])) : "",
    view.team.passAttempts
      ? card("Team passing", String(view.team.passAttempts), e("Pass attempts"), `Through Week ${view.throughWeek}`)
      : "",
  ].filter(Boolean);
  return cards.length ? `<ul class="sct-us-kpis">${cards.join("")}</ul>` : "";
}

/* ----------------------------------------------------------- snap counts */

/**
 * Snap Counts & Playing Time: every skill player who has taken an offensive
 * snap, with his snaps, snap share and change. Three views share one set of
 * rows - Season, Last 3 and any single week - each carried on the row as a
 * `data-v-*` attribute ("snaps|share|change"), so the client switches views
 * by rewriting three cells and re-sorting, and nothing is fetched. Without
 * scripting the season view is what prints.
 *
 * Windows are the TEAM's games, the same for every row: Last 3 is the club's
 * last three games and the change is that window against the club's three
 * games before it, in percentage points (a game the player sat out is zero
 * snaps, which is what a snap count means). The caption prints the actual
 * weeks. In a week view the change is against the player's previous game.
 * Needs a file that stores raw snap counts (snapsByWeek, 2026-11-05); an
 * older file leaves the section out rather than inferring counts.
 */
export interface SnapView {
  snaps: number;
  share: number | null;
  change: number | null;
}

/** Every skill player the snaps table lists: a snap this season, from a file that stores snaps. */
export function snapPlayers(view: UsageView): UsagePlayer[] {
  return view.all.filter((p) => (p.snaps ?? 0) > 0 && p.weekly.some((w) => w.snapN != null));
}

/**
 * The windows the snap table (and its premium comparison) draw: the club's
 * games, the last three, the three before, and each view per player as
 * "snaps | share | change". Shared so both renders read one arithmetic.
 */
export interface SnapWindows {
  games: number[];
  last3: number[];
  prior3: number[];
  players: UsagePlayer[];
  viewsOf: (p: UsagePlayer) => Record<string, SnapView>;
}

export function snapWindows(view: UsageView): SnapWindows | null {
  const byWeek = view.team.snapsByWeek;
  if (!byWeek) return null;
  const games = view.team.games;
  const teamSnaps = (w: number) => byWeek[String(w)] ?? 0;
  const last3 = games.slice(-3);
  const prior3 = games.slice(Math.max(0, games.length - 6), Math.max(0, games.length - 3));
  const players = snapPlayers(view);
  if (players.length === 0) return null;

  const over = (p: UsagePlayer, weeks: number[]): { snaps: number; share: number | null } => {
    const mine = weeks.reduce((s, w) => s + (p.weekly.find((x) => x.week === w)?.snapN ?? 0), 0);
    const all = weeks.reduce((s, w) => s + teamSnaps(w), 0);
    return { snaps: mine, share: all ? Math.round((100 * mine) / all) : null };
  };
  const viewsOf = (p: UsagePlayer): Record<string, SnapView> => {
    const season = over(p, games);
    const recent = over(p, last3);
    const base = prior3.length ? over(p, prior3) : null;
    const change = base && recent.share != null && base.share != null ? recent.share - base.share : null;
    const out: Record<string, SnapView> = {
      season: { snaps: season.snaps, share: season.share, change },
      last3: { snaps: recent.snaps, share: recent.share, change },
    };
    let prev: number | null = null;
    for (const w of games) {
      const wk = p.weekly.find((x) => x.week === w);
      const snaps = wk?.snapN ?? 0;
      const share = snaps ? (wk?.snap ?? Math.round((100 * snaps) / Math.max(1, teamSnaps(w)))) : 0;
      out[`w${w}`] = { snaps, share: snaps ? share : null, change: snaps && prev != null ? share - prev : null };
      if (snaps) prev = share;
    }
    return out;
  };
  return { games, last3, prior3, players, viewsOf };
}

/** "Season = Weeks 1-8 (8 Patriots games). Last 3 = ..." - the snap table's method line. */
export function snapCaption(w: SnapWindows, team: NflTeam): string {
  return (
    `Season = ${weeksWords(w.games)} (${w.games.length} ${team.nickname} games). Last 3 = ${weeksWords(w.last3)}. ` +
    (w.prior3.length
      ? `Change = snap share over ${weeksWords(w.last3)} against ${weeksWords(w.prior3)}, in percentage points; a game a player sat out counts as zero snaps.`
      : `Change needs more than three games.`) +
    ` In a week view, the change is against the player's previous game.`
  );
}

/** A view packed for the row's data attribute: "snaps|share|change". */
export const packSnapView = (v: SnapView) => `${v.snaps}|${v.share ?? ""}|${v.change ?? ""}`;

function snapTable(view: UsageView, team: NflTeam): string {
  const win = snapWindows(view);
  if (!win) return "";
  const { games, last3, prior3, players, viewsOf: views } = win;

  const rowsData = players
    .map((p) => ({ p, v: views(p) }))
    .sort((a, b) => (b.v["season"]!.share ?? 0) - (a.v["season"]!.share ?? 0) || b.v["season"]!.snaps - a.v["season"]!.snaps);

  const pack = packSnapView;
  const changeHtml = (c: number | null) =>
    c == null
      ? `<span class="sct-us-delta is-none">–</span>`
      : c === 0
        ? `<span class="sct-us-delta is-flat">0 pp</span>`
        : `<span class="sct-us-delta is-${c > 0 ? "up" : "down"}">${e(`${signed(c, 0)} pp`)}</span>`;
  const rows = rowsData
    .map(({ p, v }) => {
      const s = v["season"]!;
      const attrs = Object.entries(v)
        .map(([k, val]) => ` data-v-${k}="${pack(val)}"`)
        .join("");
      return (
        `<tr class="sct-us-snap-row" data-pos="${e(p.pos)}"${attrs}>` +
        `<th scope="row" class="is-player"><span class="sct-us-who">${faceWell(p)}` +
        `<span class="sct-us-who-text">${playerLink(p, "sct-us-board-name")}${slotChip(p.pos, true)}</span></span></th>` +
        `<td class="is-count sct-us-snap-n">${e(String(s.snaps))}</td>` +
        `<td class="sct-us-snap-pct">${shareTrack(s.share ?? 0, null)}</td>` +
        `<td class="is-recent sct-us-snap-chg">${changeHtml(s.change)}</td>` +
        `</tr>`
      );
    })
    .join("");

  const weekOptions = games.map((w) => `<option value="w${w}">Week ${w}</option>`).join("");
  const caption = snapCaption(win, team);
  void last3;
  void prior3;
  return (
    `<div class="sct-us-card sct-us-snaps" data-sct-snaps>` +
    // No sub line (mak, 2026-11-05); the method lives in the caption and the definitions.
    h3("Snap Counts & Playing Time", "snap-counts") +
    `<div class="sct-us-snap-controls" hidden>` +
    `<div class="sct-us-switch" role="group" aria-label="Window">` +
    `<button type="button" class="sct-us-switch-btn is-on" data-snap-view="season" aria-pressed="true">Season</button>` +
    `<button type="button" class="sct-us-switch-btn" data-snap-view="last3" aria-pressed="false">Last 3</button>` +
    `<label class="sct-us-switch-select"><span class="sct-us-sr">Week</span><select data-snap-week><option value="">Week…</option>${weekOptions}</select></label>` +
    `</div>` +
    `<label class="sct-us-switch-select"><span class="sct-us-sr">Position</span><select data-snap-pos>` +
    `<option value="">All positions</option><option value="QB">QB</option><option value="RB">RB</option><option value="WR">WR</option><option value="TE">TE</option>` +
    `</select></label>` +
    `</div>` +
    `<div class="sct-us-board-scroll"><table class="sct-us-board-table sct-us-snap-table">` +
    `<thead><tr><th scope="col">Player</th><th scope="col" class="is-count">Snaps</th>` +
    `<th scope="col"><abbr title="Offensive snaps over the team's offensive snaps in the window">Snap %</abbr></th>` +
    `<th scope="col" class="is-recent"><abbr title="${e(caption)}">Change</abbr></th></tr></thead>` +
    `<tbody>${rows}</tbody></table></div>` +
    `<p class="sct-us-fine sct-us-snap-caption" data-snap-caption>${e(caption)}</p>` +
    `</div>`
  );
}

/* ------------------------------------------------------- share boards */

/**
 * The Target Distribution and Rushing Distribution boards (mak, 2026-11-02,
 * after attached_assets/ref1.png; widened 2026-11-05 with the conventional
 * counts - receptions and yards, rushing yards and YPC). Each row carries
 * the season share beside the share over the player's last three games,
 * with the move against the season share where it clears the badge band,
 * and the receivers' air-yards share. The season share of carries is the
 * player's carries over the team's (scrambles included, kneel-downs not).
 */
/**
 * The player's share over his last three played games: his targets (or
 * carries) over the team's in those games, the same arithmetic as the
 * season share, so the two numbers are comparable. A file built before the
 * raw counts were stored falls back to the mean of the per-game shares.
 */
export function recentShare(weekly: UsageWeek[], kind: "targets" | "carries"): number | null {
  const isT = kind === "targets";
  const played = weekly.filter((w) => (isT ? w.ts : w.cs) != null).slice(-3);
  if (played.length === 0) return null;
  const counted = played.every((w) => (isT ? w.teamTgt : w.teamCar) != null);
  if (counted) {
    const num = played.reduce((s, w) => s + ((isT ? w.tgt : w.car) ?? 0), 0);
    const den = played.reduce((s, w) => s + ((isT ? w.teamTgt : w.teamCar) ?? 0), 0);
    return den > 0 ? (100 * num) / den : null;
  }
  return played.reduce((s, w) => s + ((isT ? w.ts : w.cs) as number), 0) / played.length;
}

/** The headshot well: the face through the image route, or an empty well. */
export function faceWell(p: UsagePlayer): string {
  const img = p.sleeperId
    ? headshotImg({
        src: null,
        id: p.sleeperId,
        className: "sct-us-face-img",
        alt: "",
        variants: ["160"],
        width: 30,
        height: 30,
        loading: "lazy",
        extra: ` aria-hidden="true"`,
      })
    : null;
  return `<span class="sct-us-face" aria-hidden="true">${img ?? ""}</span>`;
}

/**
 * One track per row (mak's audit, 2026-11-02): the fill is the season share
 * and a tick marks the last-three share on the same scale, so a tick past
 * the fill reads "rising" and a tick inside it "fading". Both figures are
 * the rounded whole numbers the row prints.
 */
function shareTrack(season: number, recent: number | null): string {
  const fill = Math.max(0, Math.min(100, season));
  const tick = recent == null ? null : Math.max(0, Math.min(100, recent));
  return (
    `<span class="sct-us-share">` +
    `<span class="sct-us-track" aria-hidden="true">` +
    `<span class="sct-us-gbar"><span style="width:${fill}%"></span></span>` +
    (tick == null ? "" : `<i class="sct-us-tick" style="left:${tick}%"></i>`) +
    `</span>` +
    `<span class="sct-us-share-val">${season}%</span>` +
    `</span>`
  );
}

/** The move badge: last three minus season, in points, shown from 3 up. */
export const BADGE_FROM = 3;

function moveBadge(delta: number): string {
  if (Math.abs(delta) < BADGE_FROM) return "";
  const up = delta > 0;
  return (
    `<span class="sct-us-arrow is-${up ? "up" : "down"}" title="${e(`Last 3 weeks ${up ? "+" : "−"}${Math.abs(delta)} pts vs season share`)}">` +
    `<span aria-hidden="true">${up ? "▲" : "▼"}</span><span class="sct-us-sr">${up ? "up" : "down"}</span>${Math.abs(delta)}</span>`
  );
}

/** Rows shown by name; the rest fold into one "others" line. */
export const BOARD_ROWS = 8;
/** The fewest rows a board stacked beside the snaps table shows. */
const BOARD_ROWS_MIN = 5;

export interface BoardLine {
  p: UsagePlayer;
  season: number;
  recent: number | null;
  delta: number | null;
}

/**
 * Every figure on a row comes from one place: the season share and the
 * last-three share are rounded once, and the badge is the difference of
 * those two printed numbers (mak, 2026-11-02: the display must agree with
 * its own arithmetic). A row that rounds to 0% is not named.
 */
export function boardLines(kind: "targets" | "carries", view: UsageView): { lines: BoardLine[]; nameable: number; nonzero: number } {
  const isT = kind === "targets";
  const teamTotal = isT
    ? view.team.targets
    : (view.team.carries ?? view.all.reduce((s, p) => s + p.carries, 0));
  const count = (p: UsagePlayer) => (isT ? p.targets : p.carries);
  const everyone = view.all.filter((p) => count(p) > 0).sort((a, b) => count(b) - count(a));
  if (everyone.length === 0 || !teamTotal) return { lines: [], nameable: 0, nonzero: 0 };
  const lines = everyone.map((p) => {
    const season = Math.round((100 * count(p)) / teamTotal);
    const recentRaw = recentShare(p.weekly, kind);
    const recent = recentRaw == null ? null : Math.round(recentRaw);
    return { p, season, recent, delta: recent == null ? null : recent - season };
  });
  const nonzero = lines.filter((l) => l.season > 0).length;
  return { lines, nameable: Math.min(BOARD_ROWS, nonzero), nonzero };
}

/** Rushing yards without the kneel-downs, so YPC is over the carries the row counts. */
export function rushYardsOnCarries(p: UsagePlayer): number | null {
  if (p.rushYards == null) return null;
  return p.rushYards - (p.kneelYards ?? 0);
}

function board(kind: "targets" | "carries", view: UsageView, lines: BoardLine[], limit: number): string {
  const isT = kind === "targets";
  const count = (p: UsagePlayer) => (isT ? p.targets : p.carries);
  if (lines.length === 0) return "";
  // The conventional columns need a file that stores them (2026-11-05).
  const conventional = isT ? view.all.some((p) => p.recYards != null) : view.all.some((p) => p.rushYards != null);
  const named = lines.filter((l) => l.season > 0).slice(0, limit);
  const others = lines.filter((l) => !named.includes(l));
  const unit = isT ? "target" : "carry";
  const cols = 4 + (conventional ? 2 : 0) + (isT ? 1 : 0);
  const rows = named
    .map(({ p, season, recent, delta }) => {
      const air = p.airYardsShare == null ? "–" : `${Math.round(Math.max(0, p.airYardsShare))}%`;
      const yds = isT ? p.recYards : rushYardsOnCarries(p);
      const extra = !conventional
        ? ""
        : isT
          ? `<td class="is-count">${e(String(p.receptions))}</td><td class="is-count">${e(yds == null ? "–" : String(yds))}</td>`
          : `<td class="is-count">${e(yds == null ? "–" : String(yds))}</td><td class="is-count">${e(yds == null || !p.carries ? "–" : f1(yds / p.carries))}</td>`;
      return (
        `<tr>` +
        `<th scope="row" class="is-player"><span class="sct-us-who">${faceWell(p)}` +
        `<span class="sct-us-who-text">${playerLink(p, "sct-us-board-name")}${slotChip(p.pos, true)}</span></span></th>` +
        `<td class="is-count">${e(String(count(p)))}</td>` +
        extra +
        `<td>${shareTrack(season, recent)}</td>` +
        `<td class="is-recent">${recent == null ? "–" : `<span class="sct-us-recent-val">${recent}%</span>${delta == null ? "" : moveBadge(delta)}`}</td>` +
        (isT ? `<td class="is-air">${e(air)}</td>` : "") +
        `</tr>`
      );
    })
    .join("");
  const othersCount = others.reduce((s, l) => s + count(l.p), 0);
  const othersRow = others.length
    ? `<tr class="sct-us-board-more"><td colspan="${cols}">${e(
        `+${others.length} ${others.length === 1 ? "other" : "others"} · ${othersCount} ${othersCount === 1 ? unit : `${unit === "carry" ? "carries" : "targets"}`}`,
      )}</td></tr>`
    : "";
  const seasonTitle = isT
    ? `Share of the team's targets through Week ${view.throughWeek}; the tick marks the last-3 share`
    : `Share of the team's carries (scrambles included, kneel-downs not) through Week ${view.throughWeek}; the tick marks the last-3 share`;
  const recentTitle = `Share over the player's last three games; the badge is its gap to the season share, from ${BADGE_FROM} points`;
  // No sub line under either board (mak, 2026-11-05): the targets-under-
  // attempts and kneel-down notes live in the definitions block.
  return (
    `<div class="sct-us-board sct-us-card" id="${isT ? "targets" : "rushing"}">` +
    h3(isT ? "Target Distribution" : "Rushing Distribution") +
    `<div class="sct-us-board-scroll"><table class="sct-us-board-table">` +
    `<thead><tr><th scope="col">Player</th><th scope="col" class="is-count">${isT ? "Tgt" : "Car"}</th>` +
    (conventional
      ? isT
        ? `<th scope="col" class="is-count">Rec</th><th scope="col" class="is-count"><abbr title="Receiving yards">Yds</abbr></th>`
        : `<th scope="col" class="is-count"><abbr title="Rushing yards on these carries">Yds</abbr></th><th scope="col" class="is-count"><abbr title="Yards per carry">YPC</abbr></th>`
      : "") +
    `<th scope="col"><abbr title="${e(seasonTitle)}">Season share</abbr></th><th scope="col" class="is-recent"><abbr title="${e(recentTitle)}">Last 3 wk</abbr></th>` +
    (isT ? `<th scope="col" class="is-air"><abbr title="Share of the team's air yards">Air yds</abbr></th>` : "") +
    `</tr></thead><tbody>${rows}${othersRow}</tbody></table></div>` +
    `</div>`
  );
}

function shareBoards(view: UsageView): string {
  const t = boardLines("targets", view);
  const c = boardLines("carries", view);
  // The boards stack beside the snaps table (2026-11-05), so their rows add
  // up to its height: the rushing board names its own players (up to
  // BOARD_ROWS), and the targets board takes the rows the snaps table has
  // left - never fewer than BOARD_ROWS_MIN, never a player who rounds to 0%.
  // The 11-02 "same count on both boards" rule was for the side-by-side
  // layout; with no snaps on file it still decides.
  const snapRows = snapPlayers(view).length;
  const both = t.nameable > 0 && c.nameable > 0;
  const shared = both ? Math.min(t.nameable, c.nameable) : Math.max(t.nameable, c.nameable);
  const cLimit = snapRows > 0 ? c.nameable : shared;
  const tLimit = snapRows > 0 ? Math.min(t.nonzero, Math.max(BOARD_ROWS_MIN, snapRows - cLimit)) : shared;
  const html = board("targets", view, t.lines, tLimit) + board("carries", view, c.lines, cLimit);
  return html ? `<div class="sct-us-boards">${html}</div>` : "";
}

/* ----------------------------------------------------------- situational */

const SITUATIONS: Array<[keyof UsagePlayer["situation"], string]> = [
  ["early", "Early downs"],
  ["third", "Third down"],
  ["rz", "Red zone"],
  ["in10", "Inside the 10"],
  ["twoMin", "Two-minute drill"],
  ["trailing", "Trailing by 7+"],
];

/**
 * Situational Usage: how the backs split the room's carries + targets by
 * situation, each row carrying its sample (mak's brief, 2026-11-05: a 70%
 * share of ten opportunities must not look like 70% of a hundred), and the
 * takeaways in NFL terms beside it. The fantasy handoffs that used to close
 * this card live in the fantasy section now.
 */
function backfield(view: UsageView, team: NflTeam): string {
  const rbs = view.rbs.filter((p) => p.wopp > 0);
  if (rbs.length === 0) return "";
  const shown = rbs.slice(0, 3);
  const totals = view.team.rbSituationTotals;
  const grid =
    `<div class="sct-us-grid" role="table" aria-label="Share of the running backs' carries plus targets, by situation" style="--us-cols:${shown.length}">` +
    `<div class="sct-us-grow is-head" role="row"><span role="columnheader">Situation</span>` +
    shown.map((p) => `<span role="columnheader">${e(surname(p.name))}</span>`).join("") +
    `</div>` +
    SITUATIONS.map(([key, label]) => {
      const values = shown.map((p) => situationShare(view, p, key));
      const max = Math.max(...values.map((v) => v ?? -1));
      const n = totals[key];
      return (
        `<div class="sct-us-grow" role="row"><span class="sct-us-gsit" role="rowheader">${e(label)}` +
        `<span class="sct-us-gn">${e(`${n} ${n === 1 ? "opportunity" : "opportunities"}`)}</span></span>` +
        values
          .map((v, i) => {
            if (v == null) return `<span class="sct-us-gcell" role="cell">–</span>`;
            const owner = v === max && v > 0;
            return (
              `<span class="sct-us-gcell${owner ? " is-owner" : ""}" role="cell" title="${e(`${shown[i]!.name}: ${shown[i]!.situation[key]} of ${n}`)}">` +
              `<span class="sct-us-gbar"><span style="width:${v}%"></span></span>` +
              `<span class="sct-us-gval">${v}%</span></span>`
            );
          })
          .join("") +
        `</div>`
      );
    }).join("") +
    `</div>`;

  const takeaways = backfieldTakeaways(view, team.nickname);
  const takeawayHtml = takeaways.length
    ? `<div class="sct-us-takeaways">` +
      takeaways
        .map((t) => `<p class="sct-us-takeaway">${t.lead ? `<strong>${e(t.lead)}</strong> ` : ""}${md(t.body)}</p>`)
        .join("") +
      `</div>`
    : "";

  return (
    `<div class="sct-us-card" id="situational">` +
    h3("Situational Usage") +
    `<p class="sct-us-sub">${e(
      "Each running back's share of the backs' carries + targets in the situation, with the number of opportunities it is measured on. Opportunities, not snaps: who was on the field comes from participation data, which is published after the season.",
    )}</p>` +
    `<div class="sct-us-bfrow">${grid}${takeawayHtml}</div>` +
    `</div>`
  );
}

const GAPS: RunGap[] = ["LE", "LT", "MID", "RT", "RE"];

/** Rushing Direction: YPC and attempts per gap, with a bar for the attempt share. */
function runDirection(view: UsageView): string {
  const runs = view.team.runs;
  const total = GAPS.reduce((s, g) => s + runs[g].att, 0);
  if (total < 10) return "";
  const best = bestGap(view);
  const most = Math.max(1, ...GAPS.map((g) => runs[g].att));
  const cells = GAPS.map((g) => {
    const r = runs[g];
    const share = Math.round((100 * r.att) / total);
    return (
      `<li class="sct-us-gap${g === best ? " is-best" : ""}">` +
      num(r.ypc != null ? r.ypc.toFixed(1) : "–", "is-big") +
      `<span class="sct-us-gap-att">${e(`${r.att} att · ${share}%`)}</span>` +
      `<span class="sct-us-gap-bar" role="img" aria-label="${e(`${share}% of designed runs`)}"><span style="width:${Math.round((100 * r.att) / most)}%"></span></span>` +
      `<span class="sct-us-label">${e(GAP_LABEL[g])}</span>` +
      `</li>`
    );
  }).join("");
  const note = runNote(view);
  return (
    `<div class="sct-us-card sct-us-run" id="run-direction">` +
    h3("Rushing Direction") +
    `<p class="sct-us-sub">${e(`Yards per carry and attempts by gap, designed runs only, through Week ${view.throughWeek}. "Middle" includes runs behind either guard. The bar is each gap's share of the ${total} attempts; the gold cell is the most efficient gap with at least 8% of them.`)}</p>` +
    `<ul class="sct-us-gaps">${cells}</ul>` +
    (note ? `<p class="sct-us-note">${md(note)}</p>` : "") +
    `</div>`
  );
}

const ZONES: Zone[][] = [
  ["DL", "DM", "DR"],
  ["SL", "SM", "SR"],
];

/** Passing Distribution: the primary passer's attempts by field zone, with coverage stated. */
function passMap(view: UsageView): string {
  const zones = view.team.zones;
  const all = Object.values(zones).reduce((s, z) => s + (z?.att ?? 0), 0);
  if (all < 20) return "";
  const qb = view.qb;
  const qbName = qb ? surname(qb.name) : "The offense";
  const best = bestZone(view);
  const maxShare = Math.max(...Object.values(zones).map((z) => z?.share ?? 0), 1);
  const cell = (k: Zone) => {
    const z = zones[k];
    const share = z?.share ?? 0;
    const owner = zoneOwner(view, k);
    // Heat: a team-color tint weighted by volume. The gold zone overrides it.
    const alpha = (0.05 + 0.3 * (share / maxShare)).toFixed(2);
    return (
      `<li class="sct-us-zone${k === best ? " is-best" : ""}"` +
      (k === best ? "" : ` style="background:color-mix(in srgb, var(--team-primary) ${Math.round(Number(alpha) * 100)}%, var(--sc-surface))"`) +
      `>` +
      num(`${share}%`, "is-big") +
      `<span class="sct-us-zone-ypa">${e(z?.ypa != null ? `${z.ypa.toFixed(1)} YPA · ${z?.att ?? 0} att` : "no attempts")}</span>` +
      `<span class="sct-us-label">${e(ZONE_LABEL[k])}${owner ? ` · ${e(owner)}` : ""}</span>` +
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
    `<div class="sct-us-card" id="passing">` +
    h3("Passing Distribution") +
    `<p class="sct-us-sub">${e(`Share of ${qbName}'s ${mapped} pass attempts and yards per attempt by field zone through Week ${view.throughWeek}.`)}</p>` +
    `<div class="sct-us-field">` +
    `<ul class="sct-us-zones">${ZONES[0]!.map(cell).join("")}</ul>` +
    `<p class="sct-us-los"><span>Deep = 20+ air yards</span></p>` +
    `<ul class="sct-us-zones">${ZONES[1]!.map(cell).join("")}</ul>` +
    `</div>` +
    notes.map((n) => `<p class="sct-us-note">${md(n)}</p>`).join("") +
    `<p class="sct-us-fine">${e(coverage)}</p>` +
    `</div>`
  );
}

/* --------------------------------------------------------------- trends */

/**
 * Notable Usage Changes: the factual list that replaced the Buy Low card
 * (mak's brief, 2026-11-05). Each line is a player whose snap share or
 * target share has moved past the steady band over his last three games
 * against the three before them, with the actual weeks and game counts of
 * both windows stated, so unequal samples are never implied equal.
 */
function trendsBlock(view: UsageView, team: NflTeam): string {
  const items = usageTrends(view);
  const lines = items.length
    ? `<ul class="sct-us-trends">` +
      items
        .map(
          (t) =>
            `<li class="sct-us-trend is-${t.direction}">` +
            `<span class="sct-us-trend-num sct-us-num" aria-hidden="true">${e(t.headline)}</span>` +
            `<p class="sct-us-trend-body"><strong>${playerLink(t.player, "sct-us-trend-name")}</strong> ${e(t.body)}</p>` +
            `</li>`,
        )
        .join("") +
      `</ul>`
    : `<p class="sct-us-note">${e(
        `No ${team.nickname} player's snap share or target share has moved past the steady band (5 and 2 points) over his last three games against the three before them.`,
      )}</p>`;
  return (
    `<div class="sct-us-card" id="usage-trends">` +
    h3("Notable Usage Changes") +
    `<p class="sct-us-sub">${e(
      "Role changes that clear the steady band: snap share by 5 points or target share by 2, the last three games a player played against the three before them, with the weeks each window covers.",
    )}</p>` +
    lines +
    `</div>`
  );
}

/* ---------------------------------------------------------- definitions */

/**
 * How the numbers are counted: every definition a reader needs to reconcile
 * this page with an official box score (mak's brief, 2026-11-05: the
 * discrepancies are intentional exclusions, and they have to be documented).
 */
function definitions(view: UsageView, team: NflTeam): string {
  const kneels = view.team.kneels;
  const qb = view.qb;
  const qbKneels = qb?.kneels ?? 0;
  const items: string[] = [
    `Snaps: offensive snaps from the official gamebooks (via nflverse). Snap % is the player's snaps over the ${team.nickname}' offensive snaps in the window shown.`,
    `Targets: pass attempts with an intended receiver. Throwaways, spikes and plays wiped out by penalty carry no target, which is why ${view.team.targets} team targets sit under ${view.team.passAttempts} pass attempts. Target share is the player's targets over the team's.`,
    `Carries: rushing attempts including quarterback scrambles and excluding kneel-downs${kneels != null ? ` (${kneels} this season)` : ""}. The official box score counts a kneel as a rushing attempt${
      qb && qbKneels ? `, so ${surname(qb.name)}'s official attempts are his ${qb.carries} carries here plus ${qbKneels} kneels` : ""
    }. Rushing yards and yards per carry are over these carries.`,
    `Situational shares: each back's share of the running backs' carries + targets in that situation, not of snaps; the number of opportunities is printed on every row.`,
    `Passing distribution: the primary passer's attempts with a charted location and depth; the coverage line under the map says how many that is.`,
    `Changes: the snap table compares the club's last three games with its three before them; the trends list and the fantasy table compare the player's own last three games with the three he played before them, and name the weeks.`,
  ];
  return (
    `<details class="sct-us-key-help sct-us-defs">` +
    `<summary class="sct-us-key-sum">How these numbers are counted</summary>` +
    `<ul class="sct-us-legend is-defs">${items.map((t) => `<li>${e(t)}</li>`).join("")}</ul>` +
    `</details>`
  );
}

/* ------------------------------------------------------------------- table */

/**
 * "+8 last 3", "steady": the last three games' average against the three
 * games before them. The window is the same for every row and the table
 * header says so once; the week numbers it covers for this player are in
 * his expanded profile (mak's critique, 2026-11-03: a "+6 vs W3-5" beside a
 * "−7 vs W1" read as cherry-picked windows, when both were the one rule).
 */
function delta(t: Trend, places: number): string {
  if (t.delta == null || t.baseWeek == null) return "";
  if (t.direction === "flat") return `<span class="sct-us-delta is-flat">steady</span>`;
  return `<span class="sct-us-delta is-${t.direction}">${e(`${signed(t.delta, places)} last 3`)}</span>`;
}

/** "Last three games W6-8, against W3-5": the player's own window, for his expanded profile. */
function windowLine(row: UsageRow): string {
  const t = row.snap.baseWeeks.length ? row.snap : row.ts.baseWeeks.length ? row.ts : row.rz;
  if (!t.baseWeeks.length || !t.trailWeeks.length) return "";
  const trail = t.trailWeeks.length === 1 ? `W${t.trailWeeks[0]}` : `W${t.trailWeeks[0]}-${t.trailWeeks[t.trailWeeks.length - 1]}`;
  return `Moves in the row: his last three games (${trail}) against the three before them (${baseLabel(t)}).`;
}

/**
 * Every collapsed cell is one number and one caption line. The week-by-week
 * bars that used to sit beside the share went in the 10-20 simplification: a
 * number, a delta and a trail were three ways of saying the same thing.
 */
function shareCell(value: number | null, t: Trend, places: number): string {
  if (value == null) return `<td class="sct-us-td">–</td>`;
  const d = delta(t, places);
  return `<td class="sct-us-td">${num(`${value.toFixed(places)}%`, "is-mid")}${d ? `<span class="sct-us-cap">${d}</span>` : ""}</td>`;
}

/**
 * "RB2 · handcuff", with the slot as the hub's position chip - the one Depth
 * Chart, News and the Outlook cards print, so a position wears the same color
 * on every tab. A role that is not a plain slot stays text. The back's touch
 * share, which the role line carries elsewhere, is the Opportunity cell's
 * headline here, so it is not repeated under the name.
 */
function roleCell(row: UsageRow): string {
  const line = roleLine(row).replace(/,\s*\d+% of RB touches$/, "");
  const slot = /^[A-Z]{1,3}\d+$/.test(row.role) && line.startsWith(row.role) ? row.role : "";
  if (!slot) return `<span class="sct-us-role">${e(line)}</span>`;
  const rest = line.slice(slot.length).replace(/^\s*[,·]\s*/, "");
  return (
    `<span class="sct-us-role">${slotChip(slot, true)}` +
    (rest ? ` <span>${e(rest)}</span>` : "") +
    `</span>`
  );
}

/**
 * The position bands the table is grouped into, and the one opportunity
 * metric each reads (mak's critique, 2026-11-03: the column spoke three
 * languages - "53% backfield share", "0.30 WOPR", "every dropback" - so no
 * two rows compared). The big number is now the same scale for everyone: the
 * player's percentile among NFL players at his position on the band's
 * metric, the one his league rank is counted on. The native stat sits under
 * it, with WOPR demoted to the caption it used to headline.
 */
type Band = "rb" | "rec" | "qb";

const BAND: Record<Band, { name: string; metric: string; key: string; unit: string }> = {
  rb: {
    name: "Running backs",
    metric: "Opportunity = weighted opportunities per active game (carries + 2 × targets), as a percentile of NFL RBs",
    key: "woppPerGame",
    unit: "pctile RB",
  },
  rec: {
    name: "Receivers",
    metric: "Opportunity = target share, as a percentile of NFL WRs or TEs · WOPR = 1.5 × target share + 0.7 × air-yards share",
    key: "targetShare",
    unit: "pctile",
  },
  qb: {
    name: "Quarterback",
    metric: "Opportunity = expected fantasy points per game, as a percentile of NFL QBs",
    key: "xfpPerGame",
    unit: "pctile QB",
  },
};

const bandOf = (p: UsagePlayer): Band => (p.pos === "RB" ? "rb" : p.pos === "QB" ? "qb" : "rec");

/** "78th" */
const nth = (n: number): string => {
  const rem = n % 100;
  const suffix = rem >= 11 && rem <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
};

function opportunityCell(row: UsageRow): string {
  const p = row.player;
  const band = BAND[bandOf(p)];
  const pct = p.pct[band.key] ?? null;
  const unit = band.unit === "pctile" ? `pctile ${p.pos}` : band.unit;
  let native: string;
  if (p.pos === "WR" || p.pos === "TE") {
    const d = p.targetShare == null ? "" : delta(row.ts, 1);
    native =
      (p.targetShare == null ? "" : e(`${p.targetShare.toFixed(1)}% targets`)) +
      (p.wopr == null ? "" : `${p.targetShare == null ? "" : " · "}${e(`${p.wopr.toFixed(2)} WOPR`)}`) +
      (d ? ` · ${d}` : "");
  } else if (p.pos === "RB") {
    native =
      (p.touchShare == null ? "" : e(`${p.touchShare}% of RB touches`)) +
      (p.woppPerGame == null ? "" : `${p.touchShare == null ? "" : " · "}${e(`${p.woppPerGame.toFixed(1)} weighted opps/game`)}`);
  } else {
    native = `every dropback${p.xfpPerGame == null ? "" : e(` · ${p.xfpPerGame.toFixed(1)} xFP/game`)}`;
  }
  const t = tone(pct);
  const label = pct == null ? "" : `${nth(pct)} percentile vs. NFL ${p.pos}s`;
  return (
    `<td class="sct-us-td is-opp">` +
    (pct == null
      ? num("–", "is-lead")
      : `${num(nth(pct), "is-lead")}<span class="sct-us-unit">${e(unit)}</span>` +
        `<span class="sct-us-pbar is-${t}" role="img" aria-label="${e(label)}" title="${e(label)}"><span style="width:${Math.max(3, pct)}%"></span></span>`) +
    (native ? `<span class="sct-us-cap">${native}</span>` : "") +
    `</td>`
  );
}

/**
 * The read's rule, as its tooltip (mak's critique, 2026-11-03: the verdict
 * words had no key on the row - a red Volatile on a receiver whose targets
 * are trending up needs the rule stated). Mirrors tierFor() in usage.ts.
 */
function tierHelp(row: UsageRow): string {
  const pos = row.player.pos;
  if (pos === "QB") {
    return {
      set: "Set & forget: a top-eight QB by expected fantasy points per game.",
      starter: "Starter: a top-16 QB by expected fantasy points per game.",
      flex: "Flex: matchup-dependent.",
      volatile: "Volatile: outside the top 16 QBs by expected fantasy points per game. Week to week, the scoring depends on the matchup.",
      stash: "Stash: the role behind the role.",
    }[row.tier];
  }
  if (pos === "RB") {
    return {
      set: "Set & forget: a lead back with 65%+ of the backfield's weighted opportunities. Start everywhere.",
      starter: "Starter: a lead back with 50%+ of the backfield's weighted opportunities, or 15+ per game. Weekly lineup play.",
      flex: "Flex: a committee lead with 40%+ of the backfield's weighted opportunities, or 12+ per game. Matchup-dependent.",
      volatile: "Volatile: a split role, under 40% of the backfield's weighted opportunities for a lead back or 35%+ for a secondary back. Usage swings week to week, so the scoring is touchdown-dependent.",
      stash: "Stash: the role behind the role, under 35% of the backfield's weighted opportunities. Bench him for the week the lead back misses.",
    }[row.tier];
  }
  return {
    set: "Set & forget: 20%+ target share. Start everywhere.",
    starter: "Starter: 17-19% target share. Weekly lineup play.",
    flex: "Flex: 15-16% target share. Matchup-dependent.",
    volatile: "Volatile: under 15% target share. Usage swings week to week, so the scoring is touchdown-dependent - a rising move in the Opportunity caption is the thing to watch.",
    stash: "Stash: the role behind the role.",
  }[row.tier];
}

function readCell(row: UsageRow): string {
  return (
    `<td class="sct-us-td is-read">` +
    `<span class="sct-us-tier is-${row.tier}" title="${e(tierHelp(row))}">${e(TIER_LABEL[row.tier])}</span>` +
    `</td>`
  );
}

/**
 * Red-zone opportunities: the count, its move, and who leads the team. The
 * lead is the badge-worthy part, so on the leader's row a flat move yields
 * to it rather than making a three-descriptor caption (mak, 2026-11-03).
 */
function rzCell(row: UsageRow): string {
  const lead = row.rzCoLead ? "co-leads team" : row.leadsRz ? "leads team" : "";
  const move = lead && row.rz.direction === "flat" ? "" : delta(row.rz, 0);
  const parts = [move, lead ? `<span class="sct-us-leads">${lead}</span>` : ""].filter(Boolean);
  return (
    `<td class="sct-us-td">${num(String(row.player.rzTouches), "is-mid")}` +
    (parts.length ? `<span class="sct-us-cap">${parts.join(" · ")}</span>` : "") +
    `</td>`
  );
}

interface Metric {
  label: string;
  value: string | null;
  pct: number | null;
  tone?: "hot" | "cold" | "neutral";
}

function tone(pct: number | null): "hot" | "cold" | "neutral" {
  if (pct == null) return "neutral";
  if (pct >= 67) return "hot";
  if (pct <= 33) return "cold";
  return "neutral";
}

const fmt = (v: number | null | undefined, suffix = "", places = 1) =>
  v == null ? null : `${v.toFixed(places)}${suffix}`;

function metricsFor(row: UsageRow, view: UsageView): Metric[] {
  const p = row.player;
  const q = p.pct;
  if (p.pos === "WR" || p.pos === "TE") {
    const adotTone = (p.adot ?? 0) >= 13.5 ? "cold" : "neutral";
    return [
      { label: "First-read share", value: fmt(p.firstReadShare, "%"), pct: q.firstReadShare ?? null },
      { label: "Air-yards share", value: fmt(p.airYardsShare, "%"), pct: q.airYardsShare ?? null },
      { label: "aDOT", value: fmt(p.adot), pct: q.adot ?? null, tone: adotTone },
      { label: "End-zone targets", value: String(p.ezTargets), pct: q.ezTargets ?? null },
      { label: "xFP / game", value: fmt(p.xfpPerGame), pct: q.xfpPerGame ?? null },
      { label: "FPOE / game", value: p.fpoePerGame == null ? null : signed(p.fpoePerGame), pct: q.fpoePerGame ?? null },
    ];
  }
  if (p.pos === "RB") {
    return [
      { label: "Touch share (RB room)", value: fmt(p.touchShare, "%", 0), pct: q.touchShare ?? null },
      { label: "Red-zone share (RB room)", value: fmt(p.rzOppShare, "%", 0), pct: q.rzOppShare ?? null },
      { label: "Inside 10 carries", value: String(p.gzCarries), pct: q.gzCarries ?? null },
      { label: "Target share", value: fmt(p.targetShare, "%"), pct: q.targetShare ?? null },
      { label: "Weighted opps / active game", value: fmt(p.woppPerGame), pct: q.woppPerGame ?? null },
      { label: "xFP / game", value: fmt(p.xfpPerGame), pct: q.xfpPerGame ?? null },
      { label: "FPOE / game", value: p.fpoePerGame == null ? null : signed(p.fpoePerGame), pct: q.fpoePerGame ?? null },
      { label: "Yards after contact / att", value: fmt(p.yacPerAtt), pct: q.yacPerAtt ?? null },
    ];
  }
  const in10 = view.team.env.in10PassRate;
  return [
    { label: "Inside 10 carries", value: String(p.gzCarries), pct: q.gzCarries ?? null },
    { label: "Designed-run rate", value: fmt(p.designedRunRate, "%"), pct: q.designedRunRate ?? null },
    { label: "Scramble rate", value: fmt(p.scrambleRate, "%"), pct: q.scrambleRate ?? null },
    { label: "aDOT", value: fmt(p.passAdot), pct: q.passAdot ?? null, tone: "neutral" },
    { label: "xFP / game", value: fmt(p.xfpPerGame), pct: q.xfpPerGame ?? null },
    { label: "FPOE / game", value: p.fpoePerGame == null ? null : signed(p.fpoePerGame), pct: q.fpoePerGame ?? null },
    { label: "Sack rate", value: fmt(p.sackRate, "%"), pct: q.sackRate ?? null },
    {
      label: "Team pass rate inside the 10",
      value: fmt(in10.value, "%", 0),
      pct: in10.rank != null ? Math.round((100 * (32 - in10.rank)) / 31) : null,
    },
  ];
}

function detailRow(row: UsageRow, view: UsageView, id: string): string {
  const metrics = metricsFor(row, view).filter((m) => m.value != null);
  const note = profileNote(row, view);
  const pos = row.player.pos;
  const rank = rankLine(row.player);
  const blocks = metrics
    .map((m) => {
      const t = m.tone ?? tone(m.pct);
      const label = m.pct == null ? "" : `${m.pct}th percentile vs. NFL ${pos}s`;
      return (
        `<li class="sct-us-metric">` +
        `<span class="sct-us-metric-top"><span class="sct-us-metric-label">${e(m.label)}</span>${num(m.value!)}</span>` +
        (m.pct != null
          ? `<span class="sct-us-pbar is-${t}" role="img" aria-label="${e(label)}" title="${e(label)}"><span style="width:${Math.max(3, m.pct)}%"></span></span>`
          : "") +
        `</li>`
      );
    })
    .join("");
  return (
    `<tr class="sct-us-detail" id="${e(id)}" hidden>` +
    `<td colspan="6" class="sct-us-td">` +
    (rank ? `<span class="sct-us-lrank">${e(rank)}</span>` : "") +
    (windowLine(row) ? `<span class="sct-us-win">${e(windowLine(row))}</span>` : "") +
    `<ul class="sct-us-metrics">${blocks}</ul>` +
    `<p class="sct-us-pnote"><strong>${e(note.thesis)}</strong>${e(note.body)}</p>` +
    `</td></tr>`
  );
}

/**
 * The table, after mak's critique (2026-11-03): rows grouped into position
 * bands whose header names the band's opportunity metric once, so the metric
 * only changes at a visible seam; the Read right after the player, so the
 * row reads verdict-then-evidence; one move window, stated once under the
 * three stat headers. The row order inside a band is the report's own.
 */
function table(view: UsageView, team: NflTeam): string {
  if (view.rows.length === 0) return "";
  const rowHtml = (row: UsageRow): string => {
    const p = row.player;
    const id = `usage-${team.abbreviation}-${p.id.replace(/[^a-z0-9]/gi, "")}`;
    return (
      `<tr class="sct-us-row">` +
      `<td class="sct-us-td is-toggle"><button type="button" class="sct-us-toggle" aria-expanded="false" aria-controls="${e(id)}"` +
      ` aria-label="${e(`Show ${p.name}'s advanced profile`)}"><span aria-hidden="true">+</span></button></td>` +
      // The headshot well the Targets/Carries boards use (mak, 2026-11-03).
      `<th scope="row" class="sct-us-td is-player"><span class="sct-us-who">${faceWell(p)}` +
      `<span class="sct-us-who-text">${playerLink(p, "sct-us-name")}` +
      roleCell(row) +
      `</span></span></th>` +
      readCell(row) +
      opportunityCell(row) +
      shareCell(p.snapShare, row.snap, 0) +
      rzCell(row) +
      `</tr>` +
      detailRow(row, view, id)
    );
  };
  const bands = (["rb", "rec", "qb"] as Band[])
    .map((band) => ({ band, rows: view.rows.filter((r) => bandOf(r.player) === band) }))
    .filter(({ rows }) => rows.length > 0)
    .map(
      ({ band, rows }) =>
        `<tbody class="sct-us-band is-${band}">` +
        `<tr class="sct-us-band-row"><th scope="colgroup" colspan="6" class="sct-us-td">` +
        `<span class="sct-us-band-name">${e(BAND[band].name)}</span>` +
        `<span class="sct-us-band-metric">${e(BAND[band].metric)}</span>` +
        `</th></tr>` +
        rows.map(rowHtml).join("") +
        `</tbody>`,
    )
    .join("");
  return (
    `<div class="sct-us-scroll" tabindex="0" role="region" aria-label="${e(`${team.nickname} fantasy usage profiles`)}">` +
    `<table class="sct-us-table">` +
    `<thead><tr>` +
    `<th scope="col" class="sct-us-th"><span class="sct-us-sr">Profile</span></th>` +
    `<th scope="col" class="sct-us-th">Player</th>` +
    `<th scope="col" class="sct-us-th">Read</th>` +
    `<th scope="col" class="sct-us-th">Opportunity</th>` +
    `<th scope="col" class="sct-us-th">Snaps</th>` +
    `<th scope="col" class="sct-us-th">Red zone</th>` +
    `</tr>` +
    `<tr class="sct-us-th-sub"><th class="sct-us-th" colspan="3"><span class="sct-us-sr">Window</span></th>` +
    `<th class="sct-us-th" colspan="3">Season to date · a move is the last three games against the three before them</th>` +
    `</tr></thead>` +
    bands +
    `</table></div>`
  );
}

function legend(): string {
  const items: Array<[string, string, string]> = [
    ["set", "Set & forget", "20%+ target share or locked bell-cow role - start everywhere"],
    ["starter", "Starter", "17–19% target share or a lead back's full workload - weekly lineup play"],
    ["flex", "Flex", "15–16% share or a committee lead - matchup-dependent"],
    ["volatile", "Volatile", "under 15% - deep leagues only"],
    ["stash", "Stash", "the role behind the role"],
    ["", "Opportunity", "the player's percentile among NFL players at his position on the band's metric: weighted opportunities per active game for backs, target share for receivers, expected fantasy points per game for the passer. The native stat sits under it - target share and WOPR (1.5 × target share + 0.7 × air-yards share) for receivers, share of the backfield's touches and weighted opportunities per game for backs"],
    ["", "Moves", "every \"last 3\" is the last three games' average against the three games before them; the weeks that covers for a player are in his expanded profile"],
    ["", "+ button", "opens the full advanced profile - league rank, first-read share, air-yards share, inside-10 carries, xFP/FPOE - with percentile bars vs. the league"],
  ];
  return (
    `<details class="sct-us-key-help">` +
    `<summary class="sct-us-key-sum">How to read this table</summary>` +
    `<ul class="sct-us-legend">` +
    items
      .map(
        ([tier, label, text]) =>
          `<li>${tier ? `<span class="sct-us-tier is-${tier}">${e(label)}</span>` : `<strong>${e(label)}:</strong>`} ${e(text)}</li>`,
      )
      .join("") +
    `</ul></details>`
  );
}

function signals(view: UsageView): string {
  if (view.signals.length === 0) return "";
  return (
    `<div class="sct-us-signals">` +
    view.signals
      .map((s) => {
        const c = signalCopy(s);
        return (
          `<article class="sct-us-signal is-${s.kind}">` +
          `<p class="sct-us-kind">${e(c.label)}</p>` +
          `<h4 class="sct-us-signal-name-h">${playerLink(s.row.player, "sct-us-signal-name")}</h4>` +
          `<p class="sct-us-signal-body">${e(c.body)}</p>` +
          `<ul class="sct-us-proof">` +
          c.proof.map((pr) => `<li>${num(pr.value, "is-mid")}<span>${e(pr.caption)}</span></li>`).join("") +
          `</ul></article>`
        );
      })
      .join("") +
    `</div>`
  );
}

/**
 * The handcuff paragraph and its handoffs, in the fantasy section (moved
 * from the backfield card 2026-11-05): the projection in fantasy terms, then
 * the RB Handcuff Rankings and Waiver Wire Scanner, then the dynasty tools.
 */
function handcuff(view: UsageView): string {
  const cuff = handcuffProjection(view);
  if (!cuff) return "";
  const { rb1, rb2 } = cuff;
  const line = handcuffFantasyLine(view);
  return (
    (line ? `<p class="sct-us-takeaway sct-us-handcuff"><strong>${e(line.lead)}</strong> ${md(line.body)}</p>` : "") +
    bridge(
      "Need the handcuff?",
      `See where ${e(rb2.name)} ranks among the NFL's backup running backs in our ${tool(RB_HANDCUFF_RANKINGS_URL, "RB Handcuff Rankings", "rb-handcuffs-usage-handcuff")}` +
        (WAIVER_WIRE_URL
          ? `, then check the ${tool(WAIVER_WIRE_URL, "Waiver Wire Scanner", "waiver-wire-usage-handcuff")} to see whether he is available in your league.`
          : "."),
    ) +
    // Succession is a dynasty question, so this is where the dynasty tools
    // earn their links - quieter ones, under the redraft action.
    (DYNASTY_TRADE_CALCULATOR_URL && DYNASTY_LEAGUE_ANALYZER_URL && DYNASTY_RANKINGS_URL
      ? bridge(
          "Thinking longer term?",
          `Compare ${e(rb1.name)} and ${e(rb2.name)} in the ${tool(DYNASTY_TRADE_CALCULATOR_URL, "Dynasty Trade Calculator", "dynasty-trade-calc-usage-handcuff")}, see how each player fits your roster in the ${tool(DYNASTY_LEAGUE_ANALYZER_URL, "Dynasty League Analyzer", "dynasty-league-analyzer-usage-handcuff")}, or check their current place in the ${tool(DYNASTY_RANKINGS_URL, "Dynasty Rankings", "dynasty-rankings-usage-handcuff")}.`,
          true,
        )
      : "")
  );
}

/**
 * The close: one card per decision the reader might be making, each naming
 * the tool that makes it. It stands in for the hub's shared "Use this
 * research" block, which the Usage page hides.
 */
function conversion(): string {
  const ask = (title: string, body: string, actions: string[]) => {
    const links = linkRow(actions, "sct-us-product-links");
    return links
      ? `<article class="sct-us-product is-ask">` +
        `<p class="sct-us-product-title">${e(title)}</p>` +
        `<p class="sct-us-product-lead">${e(body)}</p>` +
        links +
        `</article>`
      : "";
  };
  return (
    `<div class="sct-us-convert">` +
    `<h4 class="sct-us-h4">Put This Usage Data to Work</h4>` +
    `<p class="sct-us-convert-lead">Usage data becomes much more useful when you connect it to the decision you are actually trying to make.</p>` +
    `<div class="sct-us-products">` +
    ask(
      "Making a trade?",
      "Check current player values, compare both sides of a deal, and measure the impact on your roster with the Fantasy Football Trade Analyzer.",
      [tool(TRADE_CALCULATOR_URL, "Open Trade Analyzer", "trade-analyzer-usage-close")],
    ) +
    ask(
      "Setting your lineup?",
      "Compare players using weekly projections, matchup strength, opportunity and expected fantasy production in the Start/Sit Tool.",
      [tool(START_SIT_URL, "Open Start/Sit Tool", "startsit-usage-close")],
    ) +
    ask("Looking ahead?", "See updated player expectations in our Rest-of-Season Rankings.", [
      tool(ROS_RANKINGS_URL, "View ROS Rankings", "ros-rankings-usage-close"),
    ]) +
    ask(
      "Working the waiver wire?",
      "Find players whose roles are growing before the box score fully catches up with the Waiver Wire Scanner.",
      [tool(WAIVER_WIRE_URL, "Open Waiver Wire Scanner", "waiver-wire-usage-close")],
    ) +
    ask(
      "Evaluating your whole league?",
      "Connect your league to the League Analyzer to identify roster strengths, weaknesses, trade opportunities and areas to improve.",
      [tool(LEAGUE_ANALYZER_URL, "Open League Analyzer", "league-analyzer-usage-close")],
    ) +
    ask(
      "Playing dynasty?",
      "Use current role changes alongside age, long-term value and future outlook in the Dynasty League Analyzer.",
      [tool(DYNASTY_LEAGUE_ANALYZER_URL, "Dynasty League Analyzer", "dynasty-league-analyzer-usage-close")],
    ) +
    `</div>` +
    `</div>`
  );
}

/**
 * Advanced & Fantasy Analysis: the one section of the page in fantasy
 * terms (mak's brief, 2026-11-05). The tiered player table with its
 * expandable profiles (xFP, FPOE, WOPR, first-read share, percentiles), the
 * week's signals, the handcuff projection and its handoffs, and the tool
 * cards. Everything above it is the NFL report.
 */
function fantasy(view: UsageView, team: NflTeam): string {
  const tableHtml = table(view, team);
  if (!tableHtml) return "";
  return (
    `<div class="sct-us-fantasy" id="fantasy">` +
    h3("Advanced & Fantasy Analysis") +
    `<p class="sct-us-sub">${e(
      `The same ${team.nickname} usage read for fantasy football: each player's opportunity as a percentile at his position, a lineup read, and the advanced profile behind the + button - expected fantasy points (xFP), points over expected (FPOE), WOPR, first-read share and air-yards share, each as a percentile against the league.`,
    )}</p>` +
    tableHtml +
    legend() +
    signals(view) +
    handcuff(view) +
    conversion() +
    `</div>`
  );
}

/**
 * An answer with its links: each link's phrase is wrapped where it already
 * sits in the text, so the visible words are the schema's words.
 */
function faqAnswer(q: UsageFaq): string {
  // Links in text order, each searched for after the last one, so a phrase
  // can never match inside an anchor already written.
  let html = e(q.answer);
  let from = 0;
  for (const l of q.links ?? []) {
    const phrase = e(l.text);
    const at = html.indexOf(phrase, from);
    if (at < 0) continue;
    const a = tool(l.href, l.text, l.cta);
    html = html.slice(0, at) + a + html.slice(at + phrase.length);
    from = at + a.length;
  }
  return html;
}

/* ------------------------------------------------------------------ public */

export interface UsageSection {
  html: string;
  /** The page's visible FAQ, rendered below the tools block like the others. */
  faqHtml: string;
  /** The same questions for the page's FAQPage node (usage FAQ schema approved by mak 2026-09-30; NFL-first list 2026-11-05). */
  faq: Array<{ question: string; answer: string }>;
}

export function renderUsageSection(
  view: UsageView | null,
  team: NflTeam,
  _links: UsageLinks = { matchup: null },
): UsageSection {
  if (!view) return { html: "", faqHtml: "", faq: [] };
  const html =
    `<div class="sct-block sct-us">` +
    header(view) +
    intro(team) +
    // The four KPI cards are gone (mak, 2026-11-05); kpis() stays unmounted.
    // Snap Counts and the distribution boards share one row (mak, 2026-11-05):
    // snaps on the left where they were, the Target / Rushing boards beside
    // them, stacked. One column again under the usage container's 1040px.
    `<div class="sct-us-toprow">` +
    snapTable(view, team) +
    shareBoards(view) +
    `</div>` +
    backfield(view, team) +
    // The premium comparison versions (mak's brief, 2026-11-05) render
    // directly under each current block while the flag is on.
    runDirection(view) +
    (USAGE_PREMIUM_COMPARE ? premiumRunDirection(view) : "") +
    passMap(view) +
    (USAGE_PREMIUM_COMPARE ? premiumPassMap(view) : "") +
    trendsBlock(view, team) +
    definitions(view, team) +
    fantasy(view, team) +
    `</div>` +
    // The premium comparison version (mak, 2026-11-05): rendered under the
    // whole section, the original untouched, so the two can be compared.
    renderUsagePremium(view, team);

  const faq = usageFaq(view, team);
  const faqHtml = faq.length
    ? `<div class="sct-block">` +
      `<h2 class="sct-h2">Common Questions</h2>` +
      `<div class="sct-faq">` +
      faq
        .map(
          (q) =>
            `<details class="sct-faq-item">` +
            `<summary class="sct-faq-q-row"><h3 class="sct-faq-q">${e(q.question)}</h3></summary>` +
            `<p class="sct-faq-a">${faqAnswer(q)}</p>` +
            `</details>`,
        )
        .join("") +
      `</div>` +
      `</div>`
    : "";
  return { html, faqHtml, faq };
}
