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

import { shortName } from "./contracts-render";
import { headshotImg } from "../headshot-html";
import { escapeHtml } from "../render";
import { slotChip } from "../team-render";
import { premiumPassMap, premiumRunDirection } from "./usage-premium";
import { premiumSituational } from "./usage-situational-premium";
import { getPlayerPageUrl } from "./links";
import {
  DYNASTY_LEAGUE_ANALYZER_URL,
  LEAGUE_ANALYZER_URL,
  ROS_RANKINGS_URL,
  START_SIT_URL,
  TRADE_CALCULATOR_URL,
  WAIVER_WIRE_URL,
} from "../matchup/recap";
import type { NflTeam } from "./teams";
import { usageFaq, type UsageFaq } from "./usage-faq";
import { faqHeading } from "./faq-block";
import { renderUsagePremium } from "./usage-premium-dashboard";
import {
  baseLabel,
  surname,
  type Trend,
  type UsagePlayer,
  type UsageRow,
  type UsageView,
  type UsageWeek,
} from "./usage";
import {
  TIER_LABEL,
  handcuffProjection,
  handcuffFantasyLine,
  profileNote,
  rankLine,
  roleLine,
  signalCopy,
  signed,
  usageTrends,
} from "./usage-copy";

const e = escapeHtml;

/** Escaped prose with **double asterisks** set in bold - the copy module's one bit of markup. */
const md = (text: string) => e(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

/* ------------------------------------------------------------------- atoms */

function num(value: string, extra = ""): string {
  return `<span class="sct-us-num${extra ? ` ${extra}` : ""}">${e(value)}</span>`;
}

export function playerLink(p: UsagePlayer, className: string, withShort = false): string {
  const href = getPlayerPageUrl(p.slug);
  // `data-short` ("R. Stevenson"): on phones team.ts's fitDraftNames() paints
  // it in place of a name that would wrap (2026-11-15, the fantasy table).
  const short = withShort ? shortName(p.name) : p.name;
  const attr = short !== p.name ? ` data-short="${e(short)}"` : "";
  return href
    ? `<a class="${className} sct-player-link" href="${e(href)}" target="_top"${attr}>${e(p.name)}</a>`
    : `<span class="${className}"${attr}>${e(p.name)}</span>`;
}

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

/** A row of tool links, "Trade Analyzer · ROS Rankings · League Analyzer"; dropped links leave no separator. */
function linkRow(items: string[], cls: string): string {
  const shown = items.filter(Boolean);
  return shown.length ? `<p class="${cls}">${shown.join(`<span aria-hidden="true"> · </span>`)}</p>` : "";
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
      ? `Change = snap % over ${weeksWords(w.last3)} minus snap % over ${weeksWords(w.prior3)}; a game a player sat out counts as zero snaps.`
      : `Change needs more than three games.`) +
    ` In a week view, the change is against the player's previous game.`
  );
}

/** A view packed for the row's data attribute: "snaps|share|change". */
export const packSnapView = (v: SnapView) => `${v.snaps}|${v.share ?? ""}|${v.change ?? ""}`;

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

/** The move badge: last three minus season, in points, shown from 3 up. */
export const BADGE_FROM = 3;

/** Rows shown by name; the rest fold into one "others" line. */
export const BOARD_ROWS = 8;

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

/* --------------------------------------------------------------- trends */

/**
 * Notable Usage Changes: the factual list that replaced the Buy Low card
 * (mak's brief, 2026-11-05). Each line is a player whose snap share or
 * target share has moved past the steady band over his last three games
 * against the three before them, with the actual weeks and game counts of
 * both windows stated, so unequal samples are never implied equal.
 */
/* ------------------------------------------------ the premium frame */

/*
 * The last three sections wear the premium frame the rest of the page does
 * (mak, 2026-11-06: "redesign to match the rest of the page and other
 * tabs"): the Situational Usage title bar (icon tile, gold rule, title over
 * its explainer, stripes, gold accents) on a .sct-us-prm card, with the
 * section's own content restyled under .sct-us-xp in team.css.
 */
const XP_ICON = {
  trend: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><path d="M3 17l6-6 4 4 8-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 7h6v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  star: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>`,
  info: `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 7.2v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="4.9" r="0.95" fill="currentColor"/></svg>`,
  bolt: `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M13 2L4 14h7l-1 8 9-12h-7z" fill="currentColor"/></svg>`,
  tools: `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M4 7h10M4 17h6M18 7h2M14 17h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="16" cy="7" r="2.2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="17" r="2.2" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
  arrow: `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M3 8h9M8.5 4.5L12 8l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

/**
 * The section's title bar: the Rushing Direction header (mak, 2026-11-07),
 * icon, title beside its explainer, stripes; its own icon, title and explainer.
 */
function xpHead(id: string, icon: string, title: string, sub: string, subTip = ""): string {
  return (
    `<header class="sct-us-prm-head">` +
    `<span class="sct-us-prm-icon" aria-hidden="true">${icon}</span>` +
    `<div class="sct-us-prm-titles">` +
    `<h3 class="sct-us-prm-title" id="${e(id)}">${e(title)}</h3>` +
    `<p class="sct-us-prm-sub"><span class="sct-us-prm-sub-text">${e(sub)}</span>${subTip ? ` ${tip(subTip)}` : ""}</p>` +
    `</div>` +
    `<span class="sct-us-prm-stripes" aria-hidden="true"></span>` +
    `</header>`
  );
}

/**
 * A small info mark whose text is the method behind a label (reviewer's
 * critique, 2026-11-10: definitions moved out of the headers into tips). The
 * same text is in "How to read this table" for touch screens.
 */
function tip(text: string): string {
  return `<span class="sct-us-tip" tabindex="0" role="img" aria-label="${e(text)}" title="${e(text)}">${XP_ICON.info}</span>`;
}

/** A collapsed key ("How these numbers are counted", "How to read this table") as a soft note panel. */
function xpKey(cls: string, summary: string, list: string): string {
  return (
    `<details class="sct-us-key-help${cls ? ` ${cls}` : ""}">` +
    `<summary class="sct-us-key-sum"><span class="sct-us-xp-key-icon">${XP_ICON.info}</span>${e(summary)}</summary>` +
    list +
    `</details>`
  );
}

function trendsBlock(view: UsageView, team: NflTeam): string {
  const items = usageTrends(view);
  const lines = items.length
    ? `<ul class="sct-us-trends">` +
      items
        .map((t) => {
          // "+7 pp" is a snap-share move, "−8.5 pts" a target-share one (usageTrends()).
          const metric = /pp$/.test(t.headline) ? "Snap share" : "Target share";
          return (
            `<li class="sct-us-trend is-${t.direction}">` +
            `<div class="sct-us-trend-top">${faceWell(t.player)}` +
            `<span class="sct-us-trend-meta"><span class="sct-us-trend-metric">${e(metric)}</span>` +
            // Printed with "%", never "pp" (mak, 2026-11-06: team pages use "%"
            // everywhere): "+22%", "−8.5%". The figure is usageTrends()'s.
            `<span class="sct-us-trend-num sct-us-num" aria-hidden="true">${e(t.headline.replace(/\s*(pp|pts)$/, "%"))}</span></span>` +
            `<span class="sct-us-trend-arrow" aria-hidden="true">${t.direction === "up" ? "▲" : "▼"}</span>` +
            `</div>` +
            `<p class="sct-us-trend-body"><strong>${playerLink(t.player, "sct-us-trend-name")}</strong> ${e(t.body)}</p>` +
            `</li>`
          );
        })
        .join("") +
      `</ul>`
    : `<p class="sct-us-note">${e(
        `No ${team.nickname} player's snap share or target share has moved past the steady band (5% and 2%) over his last three games against the three before them.`,
      )}</p>`;
  return (
    `<section class="sct-us-prm sct-us-xp sct-us-chg" id="usage-trends" aria-labelledby="usage-trends-title">` +
    xpHead(
      "usage-trends-title",
      XP_ICON.trend,
      "Notable Usage Changes",
      "Role changes that clear the steady band: snap share by 5% or target share by 2%, the last three games a player played against the three before them, with the weeks each window covers.",
    ) +
    `<div class="sct-us-xp-body">` +
    lines +
    definitions(view, team) +
    `</div>` +
    `</section>`
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
    `G: games with an offensive snap for the ${team.nickname}. A player page counts every game played, special teams included, so a returner or core special-teamer shows more games there.`,
    `Targets come from the play-by-play; the player pages use the stats provider's count, which can differ by one or two (a target on a play the play-by-play wipes out by penalty, for example). Targets are not an official NFL statistic.`,
    `Shares: in the fantasy table, a player's target and snap share are over the games he played for the ${team.nickname} (his targets over the club's targets in those games). His player page uses the same definition across every club he has played for this season, so a traded player's page can differ. The Target and Rushing Distribution boards and the Snap Counts table's Season view show the club season share instead: each player's share of the club's whole season, games he missed included, so a board adds up to 100%.`,
    `Every number here is with the ${team.nickname}: a player traded during the season shows only his games for this club; his player page shows the whole season.`,
  ];
  return xpKey("sct-us-defs", "How these numbers are counted", `<ul class="sct-us-legend is-defs">${items.map((t) => `<li>${e(t)}</li>`).join("")}</ul>`);
}

/* ------------------------------------------------------------------- table */

/**
 * "+8 last 3", "steady": the last three games' average against the three
 * games before them. The window is the same for every row and the table
 * header says so once; the week numbers it covers for this player are in
 * his expanded profile (mak's critique, 2026-11-03: a "+6 vs W3-5" beside a
 * "−7 vs W1" read as cherry-picked windows, when both were the one rule).
 */
function delta(t: Trend, places: number, unit: "pp" | "/g"): string {
  if (t.delta == null || t.baseWeek == null) return "";
  if (t.direction === "flat") return `<span class="sct-us-delta is-flat">Steady</span>`;
  const label = unit === "pp" ? `${signed(t.delta, places)} pp` : `${signed(t.delta, places)}/g`;
  const spoken = unit === "pp" ? "percentage points" : "per game";
  return `<span class="sct-us-delta is-${t.direction}" title="${e(`${signed(t.delta, places)} ${spoken}, last 3 games vs. the 3 before`)}">${e(label)}</span>`;
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
  if (value == null) return `<td class="sct-us-td is-snap">–</td>`;
  const d = delta(t, places, "pp");
  return `<td class="sct-us-td is-snap">${num(`${value.toFixed(places)}%`, "is-mid")}${d ? `<span class="sct-us-cap">${d}</span>` : ""}</td>`;
}

/**
 * The three column tips, shared by the desktop thead and the phone rows'
 * per-band head (mak, 2026-11-15, second phone pass: the labels once per
 * position group instead of in every row).
 */
const COL_TIP = {
  opp: "A percentile against every NFL player at the same position, not a rank inside the team. Backs: weighted opportunities per active game. Receivers: target share. Quarterbacks: expected fantasy points per game.",
  snap: "Share of the offense's snaps, season to date. The change under it is in percentage points: the last 3 games' average against the 3 games before them.",
  rz: "Red-zone opportunities: carries + targets inside the opponent's 20, season to date. The change under it is per game: the last 3 games against the 3 before them.",
};

/** The phone column head under each band row; hidden wherever the thead shows. */
function phoneHead(): string {
  return (
    `<tr class="sct-us-mhead">` +
    `<td class="sct-us-td is-opp">Opportunity${tip(`${COL_TIP.opp} Shown as a percentile (63rd = ahead of 63% of the position).`)}</td>` +
    `<td class="sct-us-td is-snap">Snap Share${tip(COL_TIP.snap)}</td>` +
    `<td class="sct-us-td is-rz">RZ Opps${tip(COL_TIP.rz)}</td>` +
    `</tr>`
  );
}

/**
 * "RB2 · handcuff", with the slot as the hub's position chip - the one Depth
 * Chart, News and the Outlook cards print, so a position wears the same color
 * on every tab. A role that is not a plain slot stays text. The back's touch
 * share, which the role line carries elsewhere, is the Opportunity cell's
 * headline here, so it is not repeated under the name.
 */
function roleCell(row: UsageRow): string {
  // The read sits in the role line now (reviewer's critique, 2026-11-10: a
  // column of its own fragmented the row). "Stash" says what "handcuff" did.
  const line = roleLine(row).replace(/,\s*\d+% of RB touches$/, "").replace(/\s*·\s*handcuff$/, "");
  const read = `<span class="sct-us-tier is-${row.tier}" title="${e(tierHelp(row))}">${e(TIER_LABEL[row.tier])}</span>`;
  const slot = /^[A-Z]{1,3}\d+$/.test(row.role) && line.startsWith(row.role) ? row.role : "";
  if (!slot) return `<span class="sct-us-role">${e(line)} ${read}</span>`;
  const rest = line.slice(slot.length).replace(/^\s*[,·]\s*/, "");
  return (
    `<span class="sct-us-role">${slotChip(slot, true)}` +
    (rest ? ` <span>${e(rest)}</span>` : "") +
    ` ${read}</span>`
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
    metric: "Opportunity = weighted opportunities per active game (carries + 2 × targets), as a percentile of all NFL RBs",
    key: "woppPerGame",
    unit: "pctile RB",
  },
  rec: {
    name: "Receivers",
    metric: "Opportunity = target share, as a percentile of all NFL WRs or TEs. The change beside it is in percentage points, last 3 games vs. the 3 before",
    key: "targetShare",
    unit: "pctile",
  },
  qb: {
    name: "Quarterback",
    metric: "Opportunity = expected fantasy points (xFP) per game, as a percentile of all NFL QBs",
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
  // "pctile" and the position apart, so a phone row can drop the position
  // its band heading already names.
  const unitHtml = e(unit).replace(/^pctile (\w+)$/, `pctile<span class="sct-us-unit-pos"> $1</span>`);
  // One compact line under the percentile (reviewer's critique, 2026-11-10):
  // the band's own stat, plus the target-share move for receivers. Touch
  // share and WOPR live in the expanded profile.
  let native: string;
  if (p.pos === "WR" || p.pos === "TE") {
    const d = p.targetShare == null ? "" : delta(row.ts, 1, "pp");
    native =
      p.targetShare == null
        ? ""
        : `<span class="sct-us-cap-stat">${e(`${p.targetShare.toFixed(1)}% target share`)}</span>` +
          (d ? `<span class="sct-us-cap-sep"> · </span>${d}` : "");
  } else if (p.pos === "RB") {
    native = p.woppPerGame == null ? "" : `<span class="sct-us-cap-stat">${e(`${p.woppPerGame.toFixed(1)} weighted opp/g`)}</span>`;
  } else {
    native = p.xfpPerGame == null ? "" : `<span class="sct-us-cap-stat">${e(`${p.xfpPerGame.toFixed(1)} xFP/game`)}</span>`;
  }
  const t = tone(pct);
  const label = pct == null ? "" : `${nth(pct)} percentile vs. NFL ${p.pos}s`;
  return (
    `<td class="sct-us-td is-opp">` +
    (pct == null
      ? num("–", "is-lead")
      : `${num(nth(pct), "is-lead")}<span class="sct-us-unit">${unitHtml}</span>` +
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

/**
 * Red-zone opportunities: the count, its move, and who leads the team. The
 * lead is the badge-worthy part, so on the leader's row a flat move yields
 * to it rather than making a three-descriptor caption (mak, 2026-11-03).
 */
function rzCell(row: UsageRow): string {
  const lead = row.rzCoLead ? "co-leads team" : row.leadsRz ? "leads team" : "";
  const move = lead && row.rz.direction === "flat" ? "" : delta(row.rz, 0, "/g");
  const parts = [move, lead ? `<span class="sct-us-leads">${lead}</span>` : ""].filter(Boolean);
  return (
    `<td class="sct-us-td is-rz">${num(String(row.player.rzTouches), "is-mid")}` +
    (parts.length ? `<span class="sct-us-cap">${parts.join(`<span class="sct-us-cap-sep"> · </span>`)}</span>` : "") +
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
      { label: "WOPR", value: fmt(p.wopr, "", 2), pct: q.wopr ?? null },
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
      // One decimal, the shared team-rate precision (team-rate-metrics.mjs).
      value: fmt(in10.value, "%", 1),
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
      const label = m.pct == null ? "" : `${nth(m.pct)} percentile vs. NFL ${pos}s`;
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
    `<td colspan="5" class="sct-us-td">` +
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
      `<span class="sct-us-who-text">${playerLink(p, "sct-us-name", true)}` +
      roleCell(row) +
      `</span></span></th>` +
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
        `<tr class="sct-us-band-row"><th scope="colgroup" colspan="5" class="sct-us-td">` +
        `<span class="sct-us-band-name">${e(BAND[band].name)}</span>` +
        `<span class="sct-us-band-count">${rows.length} ${rows.length === 1 ? "player" : "players"}</span>` +
        tip(BAND[band].metric) +
        `</th></tr>` +
        phoneHead() +
        rows.map(rowHtml).join("") +
        `</tbody>`,
    )
    .join("");
  return (
    `<div class="sct-us-scroll" tabindex="0" role="region" aria-label="${e(`${team.nickname} fantasy usage profiles`)}">` +
    `<table class="sct-us-table">` +
    `<thead><tr>` +
    `<th scope="col" class="sct-us-th"><span class="sct-us-sr">Profile</span></th>` +
    `<th scope="col" class="sct-us-th">Player / Role</th>` +
    `<th scope="col" class="sct-us-th">Opportunity${tip(COL_TIP.opp)}</th>` +
    `<th scope="col" class="sct-us-th">Snap %${tip(COL_TIP.snap)}</th>` +
    `<th scope="col" class="sct-us-th">RZ Opps${tip(COL_TIP.rz)}</th>` +
    `</tr>` +
    `<tr class="sct-us-th-sub"><th class="sct-us-th" colspan="2"><span class="sct-us-sr">Units</span></th>` +
    `<th class="sct-us-th">vs. NFL at position</th>` +
    `<th class="sct-us-th">pp change, last 3 vs. prior 3</th>` +
    `<th class="sct-us-th">carries + targets inside the 20</th>` +
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
    ["", "Opportunity", "the player's percentile among every NFL player at his position, not a rank inside the team: weighted opportunities per active game (carries + 2 × targets) for backs, target share for receivers, expected fantasy points per game for the passer. The stat itself sits under it"],
    ["", "Snap %", "share of the offense's snaps, season to date"],
    ["", "RZ Opps", "red-zone opportunities: carries + targets inside the opponent's 20, season to date"],
    ["", "Changes", "the last three games' average against the three games before them - in percentage points (pp) for snap % and target share, per game (/g) for RZ opps; \"Steady\" is a move too small to count. The weeks it covers for a player are in his expanded profile"],
    ["", "+ button", "opens the full advanced profile with percentile bars vs. the league: league rank, xFP (expected fantasy points) and FPOE (points over expected) per game, WOPR (1.5 × target share + 0.7 × air-yards share), first-read share, air-yards share, touch share, inside-10 carries"],
  ];
  return xpKey(
    "",
    "How to read this table",
    `<ul class="sct-us-legend">` +
      items
        .map(
          ([tier, label, text]) =>
            `<li>${tier ? `<span class="sct-us-tier is-${tier}">${e(label)}</span>` : `<strong>${e(label)}:</strong>`} ${e(text)}</li>`,
        )
        .join("") +
      `</ul>`,
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
 * The handcuff paragraph in the fantasy section (moved from the backfield
 * card 2026-11-05): the projection in fantasy terms.
 */
function handcuff(view: UsageView): string {
  if (!handcuffProjection(view)) return "";
  const line = handcuffFantasyLine(view);
  return (
    (line
      ? `<div class="sct-us-prm-insight sct-us-handcuff">` +
        `<span class="sct-us-prm-insight-icon" aria-hidden="true">${XP_ICON.bolt}</span>` +
        `<span class="sct-us-prm-insight-slash" aria-hidden="true"></span>` +
        `<p class="sct-us-takeaway"><strong>${e(line.lead)}</strong> ${md(line.body)}</p>` +
        `</div>`
      : "")
    // The "Need the handcuff?" and "Thinking longer term?" bridges under
    // this line (RB Handcuff Rankings, Waiver Wire Scanner, the three dynasty
    // tools) came off 2026-11-06 at mak's request.
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
    `<div class="sct-us-xp-ph"><span class="sct-us-xp-ph-icon" aria-hidden="true">${XP_ICON.tools}</span>` +
    `<h4 class="sct-us-h4">Put This Usage Data to Work</h4></div>` +
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
    `<section class="sct-us-prm sct-us-xp sct-us-fantasy" id="fantasy" aria-labelledby="usage-fantasy-title">` +
    xpHead(
      "usage-fantasy-title",
      XP_ICON.star,
      "Advanced & Fantasy Analysis",
      "Player opportunities, usage trends and fantasy roles.",
      `Opportunity is a percentile against every NFL player at the same position. The + button opens each player's advanced profile: xFP (expected fantasy points), FPOE (points over expected), WOPR, first-read share and air-yards share, each as a percentile against the league.`,
    ) +
    `<div class="sct-us-xp-body">` +
    tableHtml +
    legend() +
    signals(view) +
    handcuff(view) +
    conversion() +
    `</div>` +
    `</section>`
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
    // The premium dashboard IS the top of the page since mak kept it
    // (2026-11-05, "remove the older version ... put our new version there"):
    // the heading, the intro, Snap Counts & Playing Time and the Target /
    // Rushing Distribution boards, in one navy-and-gold module.
    renderUsagePremium(view, team) +
    // Situational Usage IS the premium dashboard since mak kept it
    // (2026-11-05, "remove the older version").
    premiumSituational(view, team) +
    // Rushing Direction and Passing Distribution ARE the premium versions
    // since mak kept them (2026-11-05, "remove older version").
    premiumRunDirection(view) +
    premiumPassMap(view) +
    // Notable Usage Changes carries "How these numbers are counted" at its
    // foot since the premium frame (2026-11-06).
    trendsBlock(view, team) +
    fantasy(view, team) +
    `</div>`;

  const faq = usageFaq(view, team);
  const faqHtml = faq.length
    ? `<div class="sct-block">` +
      faqHeading("Common Questions") +
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
