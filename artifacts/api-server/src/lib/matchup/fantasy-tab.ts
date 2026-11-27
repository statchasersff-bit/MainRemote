/**
 * The completed game's Fantasy tab (mak, 2026-11-08; reordered 2026-11-11):
 *
 *   01 Fantasy Box Score      every QB/RB/WR/TE line: points, weekly finish, a
 *                             short production summary (the Box Score tab has the
 *                             full stat lines). The top scorer and the biggest
 *                             over- and underperformer are tagged in their rows
 *                             (WEB-041, 2026-11-24: they were three cards above
 *                             the table repeating its first rows).
 *   03 Usage & Opportunity    one snap / target / carry table per team
 *   04 Actual vs Expected     actual and expected points on one scale, a short
 *                             reason per player, the full xFP table behind
 *                             "Show all players"
 *   05 Fantasy Takeaways & Stock Changes, 06 Next-Week Decisions: appended
 *      by renderFantasyTakeaways (fantasy-section.ts). No Redraft Command
 *      banner since 2026-11-11: the tools sit in one line in 06.
 *
 * One source for every figure: fantasyLines() (fantasy-section.ts) scores each
 * line with fantasy-points.ts and judges it with the same xFP pass the Stats &
 * Fantasy tab uses. Every format-dependent figure, sentence, bar width and
 * sign carries all three scorings (data-ppr / data-half / data-std,
 * data-w-<fmt>, data-adv-<fmt>) inside a data-pv-fmt region, so the page's
 * PPR / Half PPR / Standard switch (client wireScoring) swaps them together.
 *
 * Weekly finishes rank the printed score against that week's logged scores at
 * the position (weekFinish), never the season to date. A playoff game has no
 * finish. No defensive FPA table, no verdict cards, no start/sit links here.
 *
 * Pure apart from the log reads behind weekFinish.
 */

import { escapeHtml } from "../render";
import { dictionaryPositionOf, weekFinish } from "./appearances";
import type { FantasyLine, FantasySectionInput, Format, Triple } from "./fantasy-section";
import { playerPhoto, teamPosition } from "./player-cell";

export interface FantasyTabInput {
  section: FantasySectionInput;
  season: number;
  /** The game's regular-season week; null for a playoff game (no finishes). */
  week: number | null;
  inks: { away: string; home: string };
  redraftUrl: string;
}

const FORMATS: Format[] = ["ppr", "half", "std"];
const MINUS = "−";
/** Box score rows shown before "Show all players". */
const BOX_SHOWN = 8; // 12 until 2026-11-27 (mak: "show top 8 by default")
/** Usage rows per team before "View full usage". */
const USAGE_SHOWN = 6;
/** Actual vs Expected rows shown before "Show all players". */
const XFP_SHOWN = 8; // 10 until 2026-11-27 (mak: as the box score, top 8)

const e = escapeHtml;

function n(stats: FantasyLine["stats"], key: keyof FantasyLine["stats"]): number {
  const v = stats[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function signed(v: number): string {
  const r = Math.round(v * 10) / 10;
  if (r === 0) return "0.0";
  return `${r > 0 ? "+" : MINUS}${Math.abs(r).toFixed(1)}`;
}

function pct(share: number | null): string {
  return share === null ? "-" : `${Math.round(share * 100)}%`;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** data-ppr="..." data-half="..." data-std="..." for one figure or sentence per format. */
function fmtAttrs(values: Record<Format, string>): string {
  return FORMATS.map((f) => ` data-${f}="${e(values[f])}"`).join("");
}

/** A span whose text follows the scoring switch. */
function swap(values: Record<Format, string>, className = ""): string {
  return `<span${className ? ` class="${className}"` : ""}${fmtAttrs(values)}>${e(values.ppr)}</span>`;
}

function per<T>(fn: (f: Format) => T): Record<Format, T> {
  return { ppr: fn("ppr"), half: fn("half"), std: fn("std") };
}

function touchdowns(line: FantasyLine): number {
  return n(line.stats, "rushTd") + n(line.stats, "recTd");
}

/** Points that came from touchdowns: 6 per rushing/receiving score, 4 per passing score. */
function touchdownPoints(line: FantasyLine): number {
  return touchdowns(line) * 6 + n(line.stats, "passTd") * 4;
}

/** "18 carries and 6 targets", "34 pass attempts and 5 carries". */
function opportunities(line: FantasyLine): string {
  const parts: string[] = [];
  if (n(line.stats, "passAtt") > 0) parts.push(plural(n(line.stats, "passAtt"), "pass attempt"));
  if (n(line.stats, "rushAtt") > 0) parts.push(plural(n(line.stats, "rushAtt"), "carry", "carries"));
  if (n(line.stats, "recTgt") > 0) parts.push(plural(n(line.stats, "recTgt"), "target"));
  if (parts.length === 0) return "no logged opportunities";
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** "8 REC, 122 YDS, 1 TD" - the short line the Box Score tab spells out in full. */
function production(line: FantasyLine): string {
  const st = line.stats;
  const parts: string[] = [];
  const passing = n(st, "passAtt") > 0;
  const rushing = n(st, "rushAtt") > 0 || n(st, "rushYds") !== 0;
  const receiving = n(st, "rec") > 0 || n(st, "recYds") !== 0;
  if (passing) {
    parts.push(`${n(st, "passYds")} PASS YDS`);
    if (n(st, "passTd")) parts.push(`${n(st, "passTd")} TD`);
    if (n(st, "passInt")) parts.push(`${n(st, "passInt")} INT`);
    if (rushing && (Math.abs(n(st, "rushYds")) >= 10 || n(st, "rushTd"))) {
      parts.push(`${n(st, "rushYds")} RUSH YDS`);
      if (n(st, "rushTd")) parts.push(`${n(st, "rushTd")} RUSH TD`);
    }
  } else if (rushing && receiving) {
    parts.push(`${n(st, "rushAtt")} CAR`, `${n(st, "rushYds")} RUSH YDS`, `${n(st, "rec")} REC`, `${n(st, "recYds")} REC YDS`);
    if (touchdowns(line)) parts.push(`${touchdowns(line)} TD`);
  } else if (rushing) {
    parts.push(`${n(st, "rushAtt")} CAR`, `${n(st, "rushYds")} YDS`);
    if (n(st, "rushTd")) parts.push(`${n(st, "rushTd")} TD`);
  } else {
    parts.push(`${n(st, "rec")} REC`, `${n(st, "recYds")} YDS`);
    if (n(st, "recTd")) parts.push(`${n(st, "recTd")} TD`);
    if (n(st, "recTgt")) parts.push(`${n(st, "recTgt")} TGT`);
  }
  if (n(st, "fumblesLost")) parts.push(`${n(st, "fumblesLost")} FUM LOST`);
  if (n(st, "twoPtScored") + n(st, "twoPtPassed")) parts.push(`${n(st, "twoPtScored") + n(st, "twoPtPassed")} 2PT`);
  return parts.join(", ");
}

/* ----------------------------------------------------------- shared atoms */

interface Ctx {
  input: FantasyTabInput;
  finish: (line: FantasyLine, f: Format) => string | null;
}

function nameLink(ctx: Ctx, line: FantasyLine, className = "sct-player-link"): string {
  const href = ctx.input.section.playerUrl(line.name, line.id ? { gameKey: line.id } : { team: line.team, pos: line.pos });
  return href
    ? `<a class="${className}" href="${e(href)}" target="_top">${e(line.name)}</a>`
    : e(line.name);
}

function face(line: FantasyLine, className: string, size: number): string {
  return line.ctx ? playerPhoto(line.ctx.sleeperId, className, size) : `<span class="${className}" aria-hidden="true"></span>`;
}

/** The Player Stats tables' name cell: face, name, "SEA · WR". */
function who(ctx: Ctx, line: FantasyLine): string {
  return (
    `<span class="sct-mu-ps-cell">${face(line, "sct-mu-ps-photo", 32)}<span class="sct-mu-ps-who">` +
    nameLink(ctx, line, "sct-player-link sct-mu-ps-link") +
    // Position first, "RB · NE" (mak, 2026-11-11), across the Fantasy tab.
    teamPosition(line.team, line.pos, "sct-mu-ps-meta", "position-first") +
    `</span></span>`
  );
}

/**
 * The Fantasy Box Score's and the xFP board's name cell, one line (mak, 2026-11-27): a 20px
 * face, the name, "QB · NE", then the row's badge. Position and team wrap
 * under the name only when the column is too narrow.
 */
function whoInline(ctx: Ctx, line: FantasyLine, badge: string): string {
  return (
    `<span class="sct-mu-ps-cell sct-fz-who1">${face(line, "sct-mu-ps-photo", 20)}<span class="sct-fz-who1-text">` +
    nameLink(ctx, line, "sct-player-link sct-mu-ps-link") +
    teamPosition(line.team, line.pos, "sct-mu-ps-meta", "position-first") +
    badge +
    `</span></span>`
  );
}

function sideOf(input: FantasyTabInput, team: string): "away" | "home" {
  return team === input.section.game.home.abbr ? "home" : "away";
}

function ink(input: FantasyTabInput, team: string): string {
  return input.inks[sideOf(input, team)];
}

/** A section with the heading row the Player Stats block uses, scoring switch slot optional. */
function section(id: string, title: string, body: string, opts: { slot?: boolean; sub?: string } = {}): string {
  return (
    `<section class="sct-rb-section sct-fz" aria-labelledby="${e(id)}" data-pv-fmt>` +
    `<div class="sct-mu-ps-head sct-fz-head">` +
    `<h2 class="sct-rb-h2" id="${e(id)}">${e(title)}</h2>` +
    (opts.slot ? `<div class="sct-mu-scoring-slot" data-sct-scoring-slot></div>` : "") +
    `</div>` +
    (opts.sub ? `<p class="sct-rb-sub sct-fz-sub">${e(opts.sub)}</p>` : "") +
    body +
    `</section>`
  );
}

/* ------------------------------------------- highlights (box score tags) */

type StoryKind = "top" | "over" | "under";

interface Story {
  line: FantasyLine;
  kind: StoryKind;
}

/**
 * The three highlights (mak, 2026-11-11; row tags in the Fantasy Box Score
 * since WEB-041), in one scoring: the top scorer, then the biggest result
 * above expectation and the biggest below it on a real workload (5+ expected
 * points), each a different player. One with no candidate is left out.
 */
export function pickStandouts(lines: FantasyLine[], f: Format = "ppr"): Story[] {
  const picked: Story[] = [];
  const has = (line: FantasyLine): boolean => picked.some((s) => s.line === line);
  const judged = lines.filter((l) => l.over !== null && l.x !== null);

  const top = [...lines].sort((a, b) => b.pts[f] - a.pts[f])[0];
  if (top && top.pts[f] > 0) picked.push({ line: top, kind: "top" });

  const over = judged.filter((l) => l.over![f] > 0.5 && !has(l)).sort((a, b) => b.over![f] - a.over![f])[0];
  if (over) picked.push({ line: over, kind: "over" });

  const under = judged
    .filter((l) => l.over![f] < -0.5 && l.x![f] >= 5 && !has(l))
    .sort((a, b) => a.over![f] - b.over![f])[0];
  if (under) picked.push({ line: under, kind: "under" });
  return picked;
}

/** The short row tags in the Fantasy Box Score (WEB-041). */
const TAG_LABEL: Record<StoryKind, string> = {
  top: "Top scorer",
  over: "Overperformer",
  under: "Underperformer",
};

/* ------------------------------------------------------ 02 box score */

function moreButton(total: number, more: string, less: string): string {
  return (
    `<button type="button" class="sct-mu-ps-toggle sct-fz-more" data-fz-more hidden aria-expanded="false" ` +
    `data-more="${e(more)}" data-less="${e(less)}">${e(more)}</button>`
  );
}

function renderBoxScore(ctx: Ctx, lines: FantasyLine[]): string {
  if (lines.length === 0) return "";
  // The highlights, per scoring, as a tag in the player's row: the text and
  // the row tint (data-tier) follow the page's scoring switch.
  const kinds = per((f) => new Map(pickStandouts(lines, f).map((s) => [s.line, s.kind] as const)));
  const tag = (line: FantasyLine): string => {
    const kind = per((f) => kinds[f].get(line) ?? "");
    if (!kind.ppr && !kind.half && !kind.std) return "";
    const label = per((f) => (kind[f] ? TAG_LABEL[kind[f] as StoryKind] : ""));
    return (
      `<span class="sct-fz-tag" data-tier="${kind.ppr}"` +
      FORMATS.map((f) => ` data-tier-${f}="${kind[f]}"`).join("") +
      `${fmtAttrs(label)}>${e(label.ppr)}</span>`
    );
  };
  const rows = lines
    .map((line, at) => {
      const finish = per((f) => ctx.finish(line, f) ?? "-");
      return (
        `<tr${at >= BOX_SHOWN ? ` class="is-extra"` : ""}>` +
        `<th scope="row" class="sct-fz-player">${whoInline(ctx, line, tag(line))}</th>` +
        `<td class="sct-fz-pts"${fmtAttrs(per((f) => line.pts[f].toFixed(1)))}>${line.pts.ppr.toFixed(1)}</td>` +
        `<td class="sct-fz-fin"${fmtAttrs(finish)}>${e(finish.ppr)}</td>` +
        `<td class="sct-fz-prod">${e(production(line))}</td>` +
        `</tr>`
      );
    })
    .join("");
  const hidden = lines.length - BOX_SHOWN;
  const body =
    `<div class="sct-fz-list" data-fz-list data-fz-shown="${BOX_SHOWN}">` +
    `<div class="sct-fz-wrap"><table class="sct-fz-table is-box">` +
    `<caption class="sct-rb-sr">Fantasy points, weekly positional finish and game production for every offensive player</caption>` +
    `<thead><tr><th scope="col">Player</th><th scope="col"><abbr title="Fantasy points">FPTS</abbr></th>` +
    `<th scope="col"><abbr title="Finish at the position among every player that week"><span class="sct-fz-long">Weekly </span>Finish</abbr></th>` +
    `<th scope="col" class="sct-fz-prod">Game Production</th></tr></thead>` +
    `<tbody data-pv-sort=".sct-fz-pts">${rows}</tbody></table></div>` +
    (hidden > 0 ? moreButton(lines.length, `Show all ${lines.length} players`, "Show fewer players") : "") +
    `</div>`;
  return section("fantasy-box-score", "Fantasy Box Score", body, { slot: true });
}

/* ------------------------------------------------------- 03 usage */

function shareCell(share: number | null, count: number): string {
  if (share === null || count === 0) return `<td class="sct-fz-u is-none">-</td>`;
  const w = Math.max(0, Math.min(100, Math.round(share * 100)));
  return `<td class="sct-fz-u" style="--w:${w}%"><span class="sct-fz-u-num">${w}%</span><span class="sct-fz-u-bar" aria-hidden="true"></span></td>`;
}

function renderUsage(ctx: Ctx, lines: FantasyLine[]): string {
  const game = ctx.input.section.game;
  const anySnaps = lines.some((l) => l.snapShare !== null);
  const tables = (["away", "home"] as const)
    .map((side) => {
      const team = game[side];
      const mine = lines
        .filter((l) => l.team === team.abbr)
        .sort(
          (a, b) =>
            (b.snapShare ?? -1) - (a.snapShare ?? -1) ||
            n(b.stats, "recTgt") + n(b.stats, "rushAtt") - (n(a.stats, "recTgt") + n(a.stats, "rushAtt")),
        );
      if (mine.length === 0) return "";
      const rows = mine
        .map(
          (l, at) =>
            `<tr${at >= USAGE_SHOWN ? ` class="is-extra"` : ""}>` +
            `<th scope="row" class="sct-fz-player">${who(ctx, l)}</th>` +
            (anySnaps ? shareCell(l.snapShare, l.snapShare === null ? 0 : 1) : "") +
            shareCell(l.tgtShare, n(l.stats, "recTgt")) +
            shareCell(l.carShare, n(l.stats, "rushAtt")) +
            `</tr>`,
        )
        .join("");
      return (
        `<div class="sct-fz-list sct-fz-team is-${side}" data-fz-list data-fz-shown="${USAGE_SHOWN}" style="--fz-team:${ctx.input.inks[side]}">` +
        `<h3 class="sct-fz-team-name">${team.logoUrl ? `<img class="sct-fz-crest" src="${e(team.logoUrl)}" alt="" width="22" height="22" loading="lazy">` : ""}${e(team.name)}</h3>` +
        `<div class="sct-fz-wrap"><table class="sct-fz-table is-usage">` +
        `<caption class="sct-rb-sr">${e(`${team.name} snap, target and carry shares`)}</caption>` +
        `<thead><tr><th scope="col">Player</th>` +
        (anySnaps ? `<th scope="col"><abbr title="Share of the team's offensive snaps">Snap%</abbr></th>` : "") +
        `<th scope="col"><abbr title="Share of the team's targets">Target%</abbr></th>` +
        `<th scope="col"><abbr title="Share of the team's carries, quarterbacks included">Carry%</abbr></th>` +
        `</tr></thead><tbody>${rows}</tbody></table></div>` +
        (mine.length > USAGE_SHOWN ? moreButton(mine.length, "View full usage", "Show less") : "") +
        `</div>`
      );
    })
    .join("");
  if (!tables) return "";
  return section(
    "fantasy-usage",
    "Usage & Opportunity",
    `<div class="sct-fz-pair">${tables}</div>` +
      `<p class="sct-rb-note sct-fz-note">Shares of each team's own snaps, targets and carries in this game. A dash means none recorded or not available.</p>`,
  );
}

/* ------------------------------------------------- 04 actual vs expected */

type Verdict = "above" | "below" | "even";

function verdictOf(over: number): Verdict {
  return over >= 2 ? "above" : over <= -2 ? "below" : "even";
}

const VERDICT_LABEL: Record<Verdict, string> = { above: "Above Expected", below: "Below Expected", even: "In Line" };

/** Why the gap: touchdown variance, efficiency, or a role the production did not match. */
function reason(line: FantasyLine, f: Format): string {
  const over = line.over![f];
  const x = line.x![f];
  const td = touchdownPoints(line);
  const v = verdictOf(over);
  if (v === "above") {
    return td >= over
      ? `Touchdowns supplied ${td.toFixed(1)} of the ${line.pts[f].toFixed(1)} points, the part least likely to repeat.`
      : `${opportunities(line).replace(/^./, (c) => c.toUpperCase())} were worth ${x.toFixed(1)} points at league-average rates; ` +
          `${td > 0 ? "the touchdown and above-average yardage" : "above-average yardage"} added the other ${Math.abs(over).toFixed(1)}.`;
  }
  if (v === "below") {
    const ints = n(line.stats, "passInt");
    const fum = n(line.stats, "fumblesLost");
    const cost = ints || fum ? ` Turnovers cost ${(ints * 1 + fum * 2).toFixed(1)} of it.` : "";
    return `${opportunities(line).replace(/^./, (c) => c.toUpperCase())} were worth ${x.toFixed(1)} points at league-average rates.${cost}`;
  }
  return `The points matched the role: ${opportunities(line)} worth ${x.toFixed(1)} expected.`;
}

function renderExpected(ctx: Ctx, lines: FantasyLine[]): string {
  const judged = lines.filter((l) => l.x && l.over && (l.x.ppr >= 3 || l.pts.ppr >= 5));
  const rates = ctx.input.section.rates;
  if (judged.length === 0 || !rates) return "";
  // Compact leaderboard (mak, 2026-11-09): one actual-points bar per player
  // with an xFP marker on the same scale, shared column heads, the reason
  // behind each row's own toggle. Biggest gaps first; past XFP_SHOWN the rows
  // wait behind "Show all players" (wireFantasyTabMore).
  const rows = [...judged].sort(
    (a, b) => Math.abs(b.over!.ppr) - Math.abs(a.over!.ppr) || b.pts.ppr - a.pts.ppr || a.name.localeCompare(b.name),
  );
  // One scale for every bar and marker in a format, from the biggest figure.
  const scale = per((f) => Math.max(1, ...rows.flatMap((l) => [l.pts[f], l.x![f]])));
  const width = (v: number, f: Format): string => String(Math.max(0, Math.min(100, Math.round((v / scale[f]) * 1000) / 10)));
  const widths = (values: Triple): string =>
    ` style="width:${width(values.ppr, "ppr")}%"` + FORMATS.map((f) => ` data-w-${f}="${width(values[f], f)}"`).join("");
  const items = rows
    .map((l, at) => {
      const adv = per((f) => (verdictOf(l.over![f]) === "above" ? "pos" : verdictOf(l.over![f]) === "below" ? "neg" : "even"));
      const advAttrs = ` data-adv="${adv.ppr}"` + FORMATS.map((f) => ` data-adv-${f}="${adv[f]}"`).join("");
      return (
        `<li class="sct-fz-x${at >= XFP_SHOWN ? " is-extra" : ""}" data-fz-row>` +
        `<details class="sct-fz-x-row"><summary class="sct-fz-x-sum">` +
        // One line per player, as the box score (mak, 2026-11-27).
        `<span class="sct-fz-x-who">${whoInline(ctx, l, "")}</span>` +
        `<span class="sct-fz-x-track" aria-hidden="true">` +
        `<span class="sct-fz-x-fill"${widths(l.pts)}></span>` +
        `<span class="sct-fz-x-mark"${widths(l.x!)}></span>` +
        `</span>` +
        `<span class="sct-fz-x-num is-pts">${swap(per((f) => l.pts[f].toFixed(1)))}</span>` +
        `<span class="sct-fz-x-num is-xfp">${swap(per((f) => l.x![f].toFixed(1)))}</span>` +
        `<span class="sct-fz-x-num is-diff"${advAttrs}>${swap(per((f) => signed(l.over![f])))}` +
        `<span class="sct-rb-sr"> ${swap(per((f) => VERDICT_LABEL[verdictOf(l.over![f])].toLowerCase()))}</span></span>` +
        `<span class="sct-fz-x-chev" aria-hidden="true"></span>` +
        `</summary>` +
        `<div class="sct-fz-x-detail">` +
        `<p class="sct-fz-x-why">${swap(per((f) => reason(l, f)))}</p>` +
        `<p class="sct-fz-x-opp">Opportunity: ${e(opportunities(l))}</p>` +
        `</div></details></li>`
      );
    })
    .join("");
  const hidden = rows.length - XFP_SHOWN;
  const body =
    `<div class="sct-fz-list sct-fz-xboard" data-fz-list data-fz-shown="${XFP_SHOWN}">` +
    `<div class="sct-fz-x-heads" aria-hidden="true">` +
    `<span class="sct-fz-x-h is-who">Player</span>` +
    `<span class="sct-fz-x-h is-bar"><span class="sct-fz-key is-actual"></span>Actual <span class="sct-fz-key is-expected"></span>xFP</span>` +
    `<span class="sct-fz-x-h is-num">FPTS</span><span class="sct-fz-x-h is-num">xFP</span><span class="sct-fz-x-h is-num">vs xFP</span>` +
    `<span class="sct-fz-x-h"></span>` +
    `</div>` +
    `<ol class="sct-fz-xlist" aria-label="Actual and expected fantasy points, biggest gap first">${items}</ol>` +
    (hidden > 0 ? moreButton(rows.length, `Show all ${rows.length} players`, "Show fewer players") : "") +
    `</div>` +
    `<p class="sct-fz-note">xFP is what a player's opportunities were worth at league-average rates. A gap measures scoring above or below that workload, not necessarily the quality of the performance.</p>`;
  return section("fantasy-xfp", "Actual vs Expected (xFP)", body, { slot: true });
}

/* ------------------------------------------------------------------ tab */

const FORMAT_KEY: Record<Format, "ppr" | "half" | "standard"> = { ppr: "ppr", half: "half", std: "standard" };

/**
 * The tab's five sections, or "" when the game has no scored offensive line
 * (the tab and its button are then left out).
 */
export function renderFantasyTab(input: FantasyTabInput, lines: FantasyLine[]): string {
  if (lines.length === 0) return "";
  const finishCache = new Map<string, string | null>();
  const ctx: Ctx = {
    input,
    finish: (line, f) => {
      if (input.week === null) return null;
      const key = `${line.team}:${line.name}:${f}`;
      if (finishCache.has(key)) return finishCache.get(key)!;
      const sleeperId = line.ctx?.sleeperId ?? null;
      const pos = (sleeperId ? dictionaryPositionOf(sleeperId) : null) ?? line.pos;
      const rank = pos ? weekFinish(input.season, input.week, pos, line.pts[f], FORMAT_KEY[f], sleeperId) : null;
      const out = rank === null || !pos ? null : `${pos}${rank}`;
      finishCache.set(key, out);
      return out;
    },
  };
  return (
    `<div class="sct-fz-tab" data-fz-root>` +
    (input.section.countsInSeasonLong
      ? ""
      : `<p class="sct-fp-playoff">Playoff game: these points don't count in most season-long fantasy leagues.</p>`) +
    renderBoxScore(ctx, lines) +
    renderUsage(ctx, lines) +
    renderExpected(ctx, lines) +
    `</div>`
  );
}
