/**
 * Markup for the team hub's Usage & Opportunity Report.
 *
 * Server-rendered in full, like the rest of the hub: the week in the freshness
 * chip, every trail and every number is in the HTML the server sends, because
 * the weekly change IS the recrawl signal the spec asks for. The client bundle
 * only wires the + / − toggles (client/team.ts), and with scripting off every
 * advanced profile simply shows, expanded (see .sct-us-detail in team.css).
 *
 * Components, in the spec's order: header + freshness chip, intro, offensive
 * environment strip, the target tree, the backfield split (with run direction),
 * the pass-location map, the player table with expandable profiles, the
 * legend, the signal cards, and the closing paragraph. A component whose data
 * is missing is left out; the section as a whole is left out when the club has
 * no usage file entry, so the tab is never a set of empty cards.
 */

import { headshotImg } from "../headshot-html";
import { escapeHtml } from "../render";
import { slotChip } from "../team-render";
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
import {
  baseLabel,
  baseWords,
  getTargetShareCliff,
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
  passNote,
  profileNote,
  rankLine,
  roleLine,
  runNote,
  signalCopy,
  signed,
  situationShare,
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

function h3(text: string): string {
  return `<h3 class="sct-us-h3">${e(text)}</h3>`;
}

function playerLink(p: UsagePlayer, className: string): string {
  const href = getPlayerPageUrl(p.slug);
  return href
    ? `<a class="${className} sct-player-link" href="${e(href)}" target="_top">${e(p.name)}</a>`
    : `<span class="${className}">${e(p.name)}</span>`;
}

/* --------------------------------------------------------- product bridges */

/*
 * Where the report hands off to a tool (mak, 2026-10-05, rewritten
 * 2026-10-08): data, then the interpretation, then the specific next action,
 * then the specific tool. Each section links the tool that answers its own
 * next question - rankings and the trade analyzer after the Target Tree, the
 * handcuff rankings and waivers (then, quietly, the dynasty tools) after the
 * handcuff math, the matchup preview, start/sit and projections after the
 * pass map, projections, rankings and start/sit after the table, the trade
 * analyzer after Buy Low / Sell High, and a close that groups the tools by
 * the decision the reader is making. "Redraft Command" and "Dynasty Command"
 * appear once each, as umbrella branding in the closing line, never as a
 * CTA: a reader looking at a team's usage wants the tool that solves the
 * next problem, not the product it lives in, and the specific anchors are
 * the clearer signal for search. Roughly 3:1 redraft to dynasty: dynasty
 * only where the question is succession or long-term role. A tool whose
 * address is not confirmed (null in matchup/recap.ts) drops its link, and a
 * line left with no link drops too.
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

/** The tool links under a call to action, one per line. */
function linkStack(items: string[], cls: string): string {
  const shown = items.filter(Boolean);
  return shown.length ? `<ul class="${cls}">${shown.map((a) => `<li>${a}</li>`).join("")}</ul>` : "";
}

/** A row of tool links, "Trade Analyzer · ROS Rankings · League Analyzer"; dropped links leave no separator. */
function linkRow(items: string[], cls: string): string {
  const shown = items.filter(Boolean);
  return shown.length ? `<p class="${cls}">${shown.join(`<span aria-hidden="true"> · </span>`)}</p>` : "";
}

interface Segment {
  label: string;
  short: string;
  share: number;
  color: string;
  title: string;
}

/**
 * A 100% stacked bar and its legend. The Target Tree and the backfield share
 * it. `legendNarrowOnly` keeps the legend for the widths where the bar drops
 * its segment names (mak, 2026-10-20: no name list under the tree on desktop;
 * 2026-10-22: the backfield's bar too).
 */
function stackedBar(segments: Segment[], ariaLabel: string, legendTail = "", legendNarrowOnly = false): string {
  const shown = segments.filter((s) => s.share > 0);
  const bar = shown
    .map((s) => {
      const ink = inkOn(s.color);
      return (
        `<span class="sct-us-seg" style="flex:${s.share.toFixed(2)} 1 0;background:${s.color};color:${ink}" title="${e(s.title)}">` +
        (s.share >= 5 ? `<span class="sct-us-seg-pct">${e(`${s.share.toFixed(1)}%`)}</span>` : "") +
        (s.share >= 9 ? `<span class="sct-us-seg-name">${e(s.short)}</span>` : "") +
        `</span>`
      );
    })
    .join("");
  const legend = shown
    .map(
      (s) =>
        `<li class="sct-us-key"><span class="sct-us-swatch" style="background:${s.color}" aria-hidden="true"></span>` +
        `${e(s.label)} <span class="sct-us-key-val">${e(`${s.share.toFixed(1)}%`)}</span></li>`,
    )
    .join("");
  return (
    `<div class="sct-us-bar" role="img" aria-label="${e(ariaLabel)}">${bar}</div>` +
    `<ul class="sct-us-keys${legendNarrowOnly ? " is-narrow-only" : ""}">${legend}${legendTail ? `<li class="sct-us-key is-def">${e(legendTail)}</li>` : ""}</ul>`
  );
}

/* -------------------------------------------------------------- components */

function header(view: UsageView): string {
  return (
    `<div class="sct-us-head">` +
    `<h2 class="sct-h2">Usage &amp; Opportunity Report</h2>` +
    `<p class="sct-us-fresh"><span class="sct-us-live" aria-hidden="true"></span>` +
    `Updated through Week ${view.throughWeek} · refreshed daily</p>` +
    `</div>`
  );
}

/**
 * The intro, in mak's wording (2026-10-03, tightened 2026-10-20). The cliff
 * paragraph keeps its numbers live from our own 2017-2025 measurement
 * (data/team/target_share_cliff.json), and is left out if that file is.
 */
function intro(): string {
  const cliff = getTargetShareCliff();
  const p = (t: string) => `<p>${md(t)}</p>`;
  return (
    `<div class="sct-us-intro">` +
    // mak's four-paragraph version (2026-11-02); the xFP/FPOE bullets are gone.
    // No bold in the three body paragraphs (mak, 2026-11-02); the closing line keeps it.
    p("Fantasy production follows opportunity. Track target share, snap share, and red-zone touches before the box score catches up.") +
    p("Expand players for deeper metrics like first-read share, air-yards share, xFP, and FPOE. When available, route share, TPRR, and YPRR show who is actually earning opportunities.") +
    (cliff
      ? p(`Since ${cliff.seasons.slice(0, 4)}, receivers with a 20%+ target share averaged ${cliff.above20.ppg} fantasy PPG, compared with ${cliff.from10to20.ppg} PPG at 10–20%.`)
      : "") +
    p("**Follow the opportunity before the fantasy points follow it.**") +
    `</div>`
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

/* ------------------------------------------------------- share boards */

/**
 * The Targets and Carries boards above the environment cards (mak,
 * 2026-11-02, laid out after attached_assets/ref1.png): who the team's
 * targets and carries go to. Each row carries the season share beside the
 * share over the player's last three games, with the move against the three
 * games before those where it clears the table's own steady band, and the
 * receivers' air-yards share. The season share of carries is the player's
 * carries over the team's (scrambles included, as the box score counts them).
 */
/**
 * The player's share over his last three played games: his targets (or
 * carries) over the team's in those games, the same arithmetic as the
 * season share, so the two numbers are comparable. A file built before the
 * raw counts were stored falls back to the mean of the per-game shares.
 */
function recentShare(weekly: UsageWeek[], kind: "targets" | "carries"): number | null {
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
function faceWell(p: UsagePlayer): string {
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
const BADGE_FROM = 3;

function moveBadge(delta: number): string {
  if (Math.abs(delta) < BADGE_FROM) return "";
  const up = delta > 0;
  return (
    `<span class="sct-us-arrow is-${up ? "up" : "down"}" title="${e(`Last 3 weeks ${up ? "+" : "−"}${Math.abs(delta)} pts vs season share`)}">` +
    `<span aria-hidden="true">${up ? "▲" : "▼"}</span><span class="sct-us-sr">${up ? "up" : "down"}</span>${Math.abs(delta)}</span>`
  );
}

/** Rows shown by name; the rest fold into one "others" line. */
const BOARD_ROWS = 8;

interface BoardLine {
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
function boardLines(kind: "targets" | "carries", view: UsageView): { lines: BoardLine[]; nameable: number } {
  const isT = kind === "targets";
  const teamTotal = isT
    ? view.team.targets
    : (view.team.carries ?? view.all.reduce((s, p) => s + p.carries, 0));
  const count = (p: UsagePlayer) => (isT ? p.targets : p.carries);
  const everyone = view.all.filter((p) => count(p) > 0).sort((a, b) => count(b) - count(a));
  if (everyone.length === 0 || !teamTotal) return { lines: [], nameable: 0 };
  const lines = everyone.map((p) => {
    const season = Math.round((100 * count(p)) / teamTotal);
    const recentRaw = recentShare(p.weekly, kind);
    const recent = recentRaw == null ? null : Math.round(recentRaw);
    return { p, season, recent, delta: recent == null ? null : recent - season };
  });
  return { lines, nameable: Math.min(BOARD_ROWS, lines.filter((l) => l.season > 0).length) };
}

function board(kind: "targets" | "carries", view: UsageView, lines: BoardLine[], limit: number): string {
  const isT = kind === "targets";
  const count = (p: UsagePlayer) => (isT ? p.targets : p.carries);
  if (lines.length === 0) return "";
  // Both boards name the same number of players (mak, 2026-11-02), so they
  // stand the same height side by side; the rest fold into the others line.
  const named = lines.filter((l) => l.season > 0).slice(0, limit);
  const others = lines.filter((l) => !named.includes(l));
  const unit = isT ? "target" : "carry";
  const rows = named
    .map(({ p, season, recent, delta }) => {
      const air = p.airYardsShare == null ? "–" : `${Math.round(Math.max(0, p.airYardsShare))}%`;
      return (
        `<tr>` +
        `<th scope="row" class="is-player"><span class="sct-us-who">${faceWell(p)}` +
        `<span class="sct-us-who-text">${playerLink(p, "sct-us-board-name")}${slotChip(p.pos, true)}</span></span></th>` +
        `<td class="is-count">${e(String(count(p)))}</td>` +
        `<td>${shareTrack(season, recent)}</td>` +
        `<td class="is-recent">${recent == null ? "–" : `<span class="sct-us-recent-val">${recent}%</span>${delta == null ? "" : moveBadge(delta)}`}</td>` +
        (isT ? `<td class="is-air">${e(air)}</td>` : "") +
        `</tr>`
      );
    })
    .join("");
  const othersCount = others.reduce((s, l) => s + count(l.p), 0);
  const othersRow = others.length
    ? `<tr class="sct-us-board-more"><td colspan="${isT ? 5 : 4}">${e(
        `+${others.length} ${others.length === 1 ? "other" : "others"} · ${othersCount} ${othersCount === 1 ? unit : `${unit === "carry" ? "carries" : "targets"}`}`,
      )}</td></tr>`
    : "";
  // No sub line (mak, 2026-11-02); the method rides on the head cells' hover.
  const seasonTitle = isT
    ? `Share of the team's targets through Week ${view.throughWeek}; the tick marks the last-3 share`
    : `Share of the team's carries, scrambles included, through Week ${view.throughWeek}; the tick marks the last-3 share`;
  const recentTitle = `Share over the player's last three games; the badge is its gap to the season share, from ${BADGE_FROM} points`;
  return (
    `<div class="sct-us-board">` +
    h3(isT ? "Targets" : "Carries") +
    `<div class="sct-us-board-scroll"><table class="sct-us-board-table">` +
    `<thead><tr><th scope="col">Player</th><th scope="col" class="is-count">${isT ? "Tgt" : "Car"}</th>` +
    `<th scope="col"><abbr title="${e(seasonTitle)}">Season share</abbr></th><th scope="col" class="is-recent"><abbr title="${e(recentTitle)}">Last 3 wk</abbr></th>` +
    (isT ? `<th scope="col" class="is-air"><abbr title="Share of the team's air yards">Air yds</abbr></th>` : "") +
    `</tr></thead><tbody>${rows}${othersRow}</tbody></table></div>` +
    `</div>`
  );
}

function shareBoards(view: UsageView): string {
  const t = boardLines("targets", view);
  const c = boardLines("carries", view);
  // The same count on both boards, the smaller side setting it.
  const both = t.nameable > 0 && c.nameable > 0;
  const limit = both ? Math.min(t.nameable, c.nameable) : Math.max(t.nameable, c.nameable);
  const html = board("targets", view, t.lines, limit) + board("carries", view, c.lines, limit);
  return html ? `<div class="sct-us-boards">${html}</div>` : "";
}

const SITUATIONS: Array<[keyof UsagePlayer["situation"], string]> = [
  ["early", "Early downs"],
  ["third", "Third down"],
  ["rz", "Red zone"],
  ["in10", "Inside the 10"],
  ["twoMin", "Two-minute drill"],
  ["trailing", "Trailing by 7+"],
];

function backfield(view: UsageView, team: NflTeam): string {
  const rbs = view.rbs.filter((p) => p.wopp > 0);
  if (rbs.length === 0) return "";
  const shown = rbs.slice(0, 3);
  const palette = segmentPalette(team);
  const total = rbs.reduce((s, p) => s + p.wopp, 0);
  const others = rbs.slice(3);
  const segs: Segment[] = shown.map((p, i) => ({
    label: p.name,
    short: surname(p.name),
    share: (100 * p.wopp) / total,
    color: palette[[0, 2, 4][i]!]!,
    title: `${p.name} - ${((100 * p.wopp) / total).toFixed(1)}% of weighted opportunities`,
  }));
  if (others.length) {
    const w = others.reduce((s, p) => s + p.wopp, 0);
    segs.push({ label: "Other backs", short: "Others", share: (100 * w) / total, color: palette[5]!, title: `Other backs - ${((100 * w) / total).toFixed(1)}%` });
  }
  // Like the Target Tree, no name list under the bar on desktop (mak, 2026-10-22).
  const totals = view.team.rbSituationTotals;
  const grid =
    `<div class="sct-us-grid" role="table" aria-label="Share of the running backs' carries plus targets, by situation" style="--us-cols:${shown.length}">` +
    `<div class="sct-us-grow is-head" role="row"><span role="columnheader">Situation</span>` +
    shown.map((p) => `<span role="columnheader">${e(surname(p.name))}</span>`).join("") +
    `</div>` +
    SITUATIONS.map(([key, label]) => {
      const values = shown.map((p) => situationShare(view, p, key));
      const max = Math.max(...values.map((v) => v ?? -1));
      return (
        `<div class="sct-us-grow" role="row"><span class="sct-us-gsit" role="rowheader">${e(label)}</span>` +
        values
          .map((v, i) => {
            if (v == null) return `<span class="sct-us-gcell" role="cell">–</span>`;
            const owner = v === max && v > 0;
            return (
              `<span class="sct-us-gcell${owner ? " is-owner" : ""}" role="cell" title="${e(`${shown[i]!.name}: ${shown[i]!.situation[key]} of ${totals[key]}`)}">` +
              `<span class="sct-us-gbar"><span style="width:${v}%"></span></span>` +
              `<span class="sct-us-gval">${v}%</span></span>`
            );
          })
          .join("") +
        `</div>`
      );
    }).join("") +
    `</div>`;

  const takeaways = backfieldTakeaways(view);
  const takeawayHtml = takeaways.length
    ? `<div class="sct-us-takeaways">` +
      takeaways
        .map((t) => `<p class="sct-us-takeaway">${t.lead ? `<strong>${e(t.lead)}</strong> ` : ""}${md(t.body)}</p>`)
        .join("") +
      `</div>`
    : "";

  // The handoff follows the handcuff paragraph: no projection, no handoff.
  const cuff = handcuffProjection(view);
  const rb1 = cuff?.rb1;
  const rb2 = cuff?.rb2;
  const handoff =
    rb1 && rb2
      ? bridge(
          "Need the handcuff?",
          `See where ${e(rb2.name)} ranks among the NFL's backup running backs in our ${tool(RB_HANDCUFF_RANKINGS_URL, "RB Handcuff Rankings", "rb-handcuffs-usage-handcuff")}` +
            (WAIVER_WIRE_URL
              ? `, then check the ${tool(WAIVER_WIRE_URL, "Waiver Wire Scanner", "waiver-wire-usage-handcuff")} to see whether he is available in your league.`
              : "."),
        ) +
        // Succession is a dynasty question, so this is where the dynasty
        // tools earn their links - quieter ones, under the redraft action.
        (DYNASTY_TRADE_CALCULATOR_URL && DYNASTY_LEAGUE_ANALYZER_URL && DYNASTY_RANKINGS_URL
          ? bridge(
              "Thinking longer term?",
              `Compare ${e(rb1.name)} and ${e(rb2.name)} in the ${tool(DYNASTY_TRADE_CALCULATOR_URL, "Dynasty Trade Calculator", "dynasty-trade-calc-usage-handcuff")}, see how each player fits your roster in the ${tool(DYNASTY_LEAGUE_ANALYZER_URL, "Dynasty League Analyzer", "dynasty-league-analyzer-usage-handcuff")}, or check their current place in the ${tool(DYNASTY_RANKINGS_URL, "Dynasty Rankings", "dynasty-rankings-usage-handcuff")}.`,
              true,
            )
          : "")
      : "";

  return (
    `<div class="sct-us-card">` +
    h3("The Backfield Split") +
    // The sub line and the stacked share bar went 2026-11-02 (mak); the
    // situation grid opens the card.
    // Grid and takeaways share one row at equal height (mak, 2026-11-02).
    `<div class="sct-us-bfrow">${grid}${takeawayHtml}</div>` +
    // The run-direction block sits above the handcuff bridges (mak, 2026-11-02).
    runDirection(view) +
    handoff +
    `</div>`
  );
}

const GAPS: RunGap[] = ["LE", "LT", "MID", "RT", "RE"];

function runDirection(view: UsageView): string {
  const runs = view.team.runs;
  const total = GAPS.reduce((s, g) => s + runs[g].att, 0);
  if (total < 10) return "";
  const best = bestGap(view);
  const cells = GAPS.map((g) => {
    const r = runs[g];
    return (
      `<li class="sct-us-gap${g === best ? " is-best" : ""}">` +
      num(r.ypc != null ? r.ypc.toFixed(1) : "–", "is-big") +
      `<span class="sct-us-gap-att">${e(`${r.att} att`)}</span>` +
      `<span class="sct-us-label">${e(GAP_LABEL[g])}</span>` +
      `</li>`
    );
  }).join("");
  const note = runNote(view);
  return (
    `<div class="sct-us-run">` +
    // The subline became the heading (mak, 2026-10-22): "Run Direction" is gone.
    `<h4 class="sct-us-h4">Carries and YPC by gap.</h4>` +
    `<ul class="sct-us-gaps">${cells}</ul>` +
    `<p class="sct-us-fine">Designed runs only; "Middle" includes runs behind either guard.</p>` +
    (note ? `<p class="sct-us-note">${md(note)}</p>` : "") +
    `</div>`
  );
}

const ZONES: Zone[][] = [
  ["DL", "DM", "DR"],
  ["SL", "SM", "SR"],
];

function passMap(view: UsageView, team: NflTeam, links: UsageLinks): string {
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
      `<span class="sct-us-zone-ypa">${e(z?.ypa != null ? `${z.ypa.toFixed(1)} YPA` : "no attempts")}</span>` +
      `<span class="sct-us-label">${e(ZONE_LABEL[k])}${owner ? ` · ${e(owner)}` : ""}</span>` +
      `</li>`
    );
  };
  const notes = passNote(view, qbName);
  return (
    `<div class="sct-us-card">` +
    h3(`Where ${qbName} Attacks`) +
    `<p class="sct-us-sub">${e(`Share of ${qbName}'s ${view.team.passerZoneAttempts ? `${view.team.passerZoneAttempts} mapped ` : ""}attempts and YPA by field zone through Week ${view.throughWeek}.`)}</p>` +
    `<div class="sct-us-field">` +
    `<ul class="sct-us-zones">${ZONES[0]!.map(cell).join("")}</ul>` +
    `<p class="sct-us-los"><span>Deep = 20+ air yards</span></p>` +
    `<ul class="sct-us-zones">${ZONES[1]!.map(cell).join("")}</ul>` +
    `</div>` +
    notes.map((n) => `<p class="sct-us-note">${md(n)}</p>`).join("") +
    `</div>`
  );
}

/* ------------------------------------------------------------------- table */

/**
 * "+8 vs W1-3", "steady": the last three games' average against the three
 * games before them.
 */
function delta(t: Trend, places: number): string {
  if (t.delta == null || t.baseWeek == null) return "";
  if (t.direction === "flat") return `<span class="sct-us-delta is-flat">steady</span>`;
  return `<span class="sct-us-delta is-${t.direction}">${e(`${signed(t.delta, places)} vs ${baseLabel(t)}`)}</span>`;
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
 * Opportunity is position-aware. A receiver reads WOPR with the target share
 * and its move under it; a back reads his share of the backfield's touches
 * with weighted opportunities per game under it. A passer has no opportunity
 * score - every dropback is his - so the cell stays quiet and the Snaps column
 * carries his involvement.
 */
function opportunityCell(row: UsageRow): string {
  const p = row.player;
  if (p.pos === "WR" || p.pos === "TE") {
    const w = p.wopr;
    const d = p.targetShare == null ? "" : delta(row.ts, 1);
    const targets = p.targetShare == null ? "" : `${e(`${p.targetShare.toFixed(1)}% targets`)}${d ? ` · ${d}` : ""}`;
    return (
      `<td class="sct-us-td">` +
      (w == null ? num("–", "is-lead") : `${num(w.toFixed(2), "is-lead")}<span class="sct-us-unit">WOPR</span>`) +
      (targets ? `<span class="sct-us-cap">${targets}</span>` : "") +
      `</td>`
    );
  }
  if (p.pos === "RB") {
    const wopp = p.woppPerGame == null ? "" : `${p.woppPerGame.toFixed(1)} weighted opps/game`;
    return (
      `<td class="sct-us-td">` +
      (p.touchShare == null
        ? num("–", "is-lead")
        : `${num(`${p.touchShare}%`, "is-lead")}<span class="sct-us-unit">backfield share</span>`) +
      (wopp ? `<span class="sct-us-cap">${e(wopp)}</span>` : "") +
      `</td>`
    );
  }
  return `<td class="sct-us-td"><span class="sct-us-cap">every dropback</span></td>`;
}

/** Red-zone opportunities: the count, its move, and who leads the team. */
function rzCell(row: UsageRow): string {
  const lead = row.rzCoLead ? "co-leads team" : row.leadsRz ? "leads team" : "";
  const parts = [delta(row.rz, 0), lead ? `<span class="sct-us-leads">${lead}</span>` : ""].filter(Boolean);
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
    `<ul class="sct-us-metrics">${blocks}</ul>` +
    `<p class="sct-us-pnote"><strong>${e(note.thesis)}</strong>${e(note.body)}</p>` +
    `</td></tr>`
  );
}

function table(view: UsageView, team: NflTeam): string {
  if (view.rows.length === 0) return "";
  const rows = view.rows
    .map((row) => {
      const p = row.player;
      const id = `usage-${team.abbreviation}-${p.id.replace(/[^a-z0-9]/gi, "")}`;
      return (
        `<tr class="sct-us-row">` +
        `<td class="sct-us-td is-toggle"><button type="button" class="sct-us-toggle" aria-expanded="false" aria-controls="${e(id)}"` +
        ` aria-label="${e(`Show ${p.name}'s advanced profile`)}"><span aria-hidden="true">+</span></button></td>` +
        `<th scope="row" class="sct-us-td is-player">${playerLink(p, "sct-us-name")}` +
        roleCell(row) +
        `</th>` +
        opportunityCell(row) +
        shareCell(p.snapShare, row.snap, 0) +
        rzCell(row) +
        `<td class="sct-us-td"><span class="sct-us-tier is-${row.tier}">${e(TIER_LABEL[row.tier])}</span></td>` +
        `</tr>` +
        detailRow(row, view, id)
      );
    })
    .join("");
  return (
    `<div class="sct-us-scroll" tabindex="0" role="region" aria-label="${e(`${team.nickname} player usage`)}">` +
    `<table class="sct-us-table">` +
    `<thead><tr>` +
    `<th scope="col" class="sct-us-th"><span class="sct-us-sr">Profile</span></th>` +
    `<th scope="col" class="sct-us-th">Player</th>` +
    `<th scope="col" class="sct-us-th">Opportunity</th>` +
    `<th scope="col" class="sct-us-th">Snaps</th>` +
    `<th scope="col" class="sct-us-th">Red zone</th>` +
    `<th scope="col" class="sct-us-th">Read</th>` +
    `</tr></thead>` +
    `<tbody>${rows}</tbody>` +
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
    ["", "Opportunity", "WOPR (1.5 × target share + 0.7 × air-yards share) with the target share under it for receivers; share of the backfield's touches with weighted opportunities per game for backs"],
    ["", "Snaps and Red zone", "season to date; the line under it is the last three games' average against the three games before them"],
    ["", "Target share move", "the same three-game comparison, under the receiver's WOPR"],
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
          `<h3 class="sct-us-h3">${playerLink(s.row.player, "sct-us-signal-name")}</h3>` +
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
 * The close: one card per decision the reader might be making, each naming
 * the tool that makes it, then a row of the most relevant tools, then the
 * line on how usage feeds our pricing (the one place the two Commands are
 * named). It stands in for the hub's shared "Use this research" block, which
 * the Usage tab hides.
 */
function conversion(view: UsageView): string {
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
    `<h3 class="sct-us-h3">Put this usage data to work</h3>` +
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
    // Projections left this card 2026-10-22 (mak).
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
      // The Dynasty Trade Calculator and Dynasty Rankings left this card 2026-10-22 (mak).
      "Use current role changes alongside age, long-term value and future outlook in the Dynasty League Analyzer.",
      [tool(DYNASTY_LEAGUE_ANALYZER_URL, "Dynasty League Analyzer", "dynasty-league-analyzer-usage-close")],
    ) +
    `</div>` +
    // The umbrella line naming the two Commands ("Usage trends are one of
    // the core inputs behind our player pricing...") went 2026-10-22 (mak).
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
  /** The tab's visible FAQ, rendered below the tools block like the others. */
  faqHtml: string;
  /** The same questions for the page's FAQPage node (approved by mak 2026-09-30). */
  faq: Array<{ question: string; answer: string }>;
}

export function renderUsageSection(
  view: UsageView | null,
  team: NflTeam,
  links: UsageLinks = { matchup: null },
): UsageSection {
  if (!view) return { html: "", faqHtml: "", faq: [] };
  const html =
    `<div class="sct-block sct-us">` +
    header(view) +
    intro() +
    // The "Turn usage into a roster decision" box left 2026-11-02 (mak).
    // The Targets / Carries boards (mak, 2026-11-02) sit above the environment cards.
    shareBoards(view) +
    // The five environment cards went 2026-11-02 (mak).
    // The Target Tree went 2026-11-02 (mak).
    backfield(view, team) +
    passMap(view, team, links) +
    table(view, team) +
    legend() +
    // The "Compare opportunity with what comes next" projections line went
    // 2026-10-22 at mak's request.
    signals(view) +
    conversion(view) +
    `</div>`;

  // mak's question list (2026-10-05), in the FAQPage too (usage FAQ schema
  // approved 2026-09-30). No "See the full usage report" link under the
  // questions (removed 2026-10-09 at mak's request).
  const faq = usageFaq(view, team);
  const faqHtml = faq.length
    ? `<div class="sct-block">` +
      `<h2 class="sct-h2">Common questions</h2>` +
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
