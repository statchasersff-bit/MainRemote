/**
 * The completed game's Fantasy tab (mak, 2026-11-08), exactly five sections:
 *
 *   01 Fantasy Standouts      three player stories, not just the top three totals
 *   02 Fantasy Box Score      every QB/RB/WR/TE line: points, weekly finish, a
 *                             short production summary (the Box Score tab has the
 *                             full stat lines)
 *   03 Usage & Opportunity    one snap / target / carry table per team
 *   04 Actual vs Expected     actual and expected points on one scale, a short
 *                             reason per player, the full xFP table behind
 *                             "Show all players"
 *   05 Redraft Command        one current-research call to action
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
const BOX_SHOWN = 12;
/** Usage rows per team before "View full usage". */
const USAGE_SHOWN = 6;
/** Players on the Actual vs Expected chart. */
const CHART_ROWS = 6;

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

function lastName(name: string): string {
  const parts = name.replace(/\s+(Jr\.?|Sr\.?|II|III|IV|V)$/i, "").trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : name;
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

/** "Eight catches"-style line, in digits: what the player did. */
function gameLine(line: FantasyLine): string {
  const st = line.stats;
  if (n(st, "passAtt") > 0) {
    let text = `${n(st, "passCmp")} of ${n(st, "passAtt")} for ${plural(n(st, "passYds"), "yard")}`;
    if (n(st, "passTd")) text += `, ${plural(n(st, "passTd"), "touchdown")}`;
    if (n(st, "passInt")) text += `, ${plural(n(st, "passInt"), "interception")}`;
    if (n(st, "rushAtt") && (Math.abs(n(st, "rushYds")) >= 10 || n(st, "rushTd"))) {
      text += `; ${plural(n(st, "rushYds"), "rushing yard")}`;
      if (n(st, "rushTd")) text += ` and ${plural(n(st, "rushTd"), "rushing touchdown")}`;
    }
    return `${text}.`;
  }
  const parts: string[] = [];
  if (n(st, "rushAtt") > 0) {
    parts.push(
      `${plural(n(st, "rushAtt"), "carry", "carries")} for ${plural(n(st, "rushYds"), "yard")}` +
        (n(st, "rushTd") ? ` and ${plural(n(st, "rushTd"), "touchdown")}` : ""),
    );
  }
  if (n(st, "recTgt") > 0 || n(st, "rec") > 0) {
    parts.push(
      `${plural(n(st, "rec"), "catch", "catches")} for ${plural(n(st, "recYds"), "yard")}` +
        (n(st, "recTd") ? ` and ${plural(n(st, "recTd"), "touchdown")}` : "") +
        ` on ${plural(n(st, "recTgt"), "target")}`,
    );
  }
  const text = parts.join("; ");
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}.` : "";
}

/* ----------------------------------------------------------- shared atoms */

interface Ctx {
  input: FantasyTabInput;
  finish: (line: FantasyLine, f: Format) => string | null;
}

function nameLink(ctx: Ctx, line: FantasyLine, className = "sct-player-link"): string {
  const href = ctx.input.section.playerUrl(line.name);
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
    teamPosition(line.team, line.pos, "sct-mu-ps-meta") +
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

/* ------------------------------------------------------- 01 standouts */

type StoryKind = "top" | "under" | "td" | "over" | "role-up" | "role-down" | "above" | "below" | "even";

const STORY_LABEL: Record<StoryKind, string> = {
  top: "Top Performer",
  under: "Underperformed Opportunity",
  td: "Touchdown-Driven Result",
  over: "Beat Expected",
  "role-up": "Expanded Role",
  "role-down": "Reduced Role",
  above: "Above Expected",
  below: "Below Expected",
  even: "In Line With Opportunity",
};

interface Story {
  line: FantasyLine;
  kind: StoryKind;
  /** The role change, when that is the story. */
  role?: { metric: "snaps" | "targets"; now: number; before: number };
}

/** The season's average snap and target share before this game, from two or more logged games. */
function priorShares(line: FantasyLine): { snaps: number | null; targets: number | null } {
  const before = line.ctx?.before ?? [];
  const avg = (values: Array<number | null>): number | null => {
    const v = values.filter((x): x is number => x !== null);
    return v.length >= 2 ? v.reduce((s, x) => s + x, 0) / v.length : null;
  };
  return { snaps: avg(before.map((g) => g.snapShare)), targets: avg(before.map((g) => g.targetShare)) };
}

function roleChange(line: FantasyLine): Story["role"] | null {
  if (line.qb) return null;
  const prior = priorShares(line);
  const snap = line.snapShare !== null && prior.snaps !== null ? { metric: "snaps" as const, now: line.snapShare, before: prior.snaps } : null;
  const tgt = line.tgtShare !== null && prior.targets !== null ? { metric: "targets" as const, now: line.tgtShare, before: prior.targets } : null;
  const best = [snap, tgt]
    .filter((c): c is NonNullable<typeof c> => c !== null && Math.abs(c.now - c.before) >= 0.2)
    .sort((a, b) => Math.abs(b.now - b.before) - Math.abs(a.now - a.before))[0];
  return best ?? null;
}

/**
 * The three most interesting performances, in PPR (the page's default): the
 * top scorer, the biggest shortfall on a real workload, the biggest result
 * above expectation (touchdown-driven or not), then a role change, then the
 * largest remaining gaps. A high total alone earns one slot, not three.
 */
export function pickStandouts(lines: FantasyLine[]): Story[] {
  const picked: Story[] = [];
  const has = (line: FantasyLine): boolean => picked.some((s) => s.line === line);
  const add = (story: Story | null): void => {
    if (story && picked.length < 3 && !has(story.line)) picked.push(story);
  };
  const judged = lines.filter((l) => l.over !== null && l.x !== null);

  const top = lines[0];
  if (top && top.pts.ppr >= 10) add({ line: top, kind: "top" });

  const under = judged
    .filter((l) => l.over!.ppr <= -4 && l.x!.ppr >= 8 && !has(l))
    .sort((a, b) => a.over!.ppr - b.over!.ppr)[0];
  if (under) add({ line: under, kind: "under" });

  const over = judged.filter((l) => l.over!.ppr >= 4 && !has(l)).sort((a, b) => b.over!.ppr - a.over!.ppr)[0];
  if (over) add({ line: over, kind: touchdownPoints(over) >= over.over!.ppr ? "td" : "over" });

  const role = lines
    .filter((l) => !has(l) && (l.x?.ppr ?? 0) >= 5)
    .map((l) => ({ l, r: roleChange(l) }))
    .filter((c): c is { l: FantasyLine; r: NonNullable<Story["role"]> } => c.r !== null)
    .sort((a, b) => Math.abs(b.r.now - b.r.before) - Math.abs(a.r.now - a.r.before))[0];
  if (role) add({ line: role.l, kind: role.r.now > role.r.before ? "role-up" : "role-down", role: role.r });

  for (const l of [...judged].sort((a, b) => Math.abs(b.over!.ppr) - Math.abs(a.over!.ppr))) {
    if (has(l) || Math.abs(l.over!.ppr) < 2) continue;
    add({ line: l, kind: l.over!.ppr > 0 ? "above" : "below" });
  }
  for (const l of lines) if (!has(l) && l.pts.ppr >= 5) add({ line: l, kind: "top" });
  return picked;
}

function storyText(ctx: Ctx, story: Story, f: Format): string {
  const { line } = story;
  const name = lastName(line.name);
  const over = line.over?.[f] ?? 0;
  const abs = Math.abs(Math.round(over * 10) / 10).toFixed(1);
  const team = ctx.input.section.game[sideOf(ctx.input, line.team)].short;
  switch (story.kind) {
    case "top": {
      let text = gameLine(line);
      if (!line.qb && (line.tgtShare ?? 0) >= 0.25) text += ` Commanded ${pct(line.tgtShare)} of the ${team}' targets.`;
      else if (!line.qb && (line.carShare ?? 0) >= 0.5) text += ` Handled ${pct(line.carShare)} of the ${team}' carries.`;
      else if (line.over && Math.abs(over) >= 2) text += ` ${abs} points ${over > 0 ? "above" : "below"} expected.`;
      return text;
    }
    case "under":
      return `Despite ${opportunities(line)}, ${name} finished ${abs} points below expected fantasy production.`;
    case "td": {
      const tds = touchdowns(line) + n(line.stats, "passTd");
      return `${plural(tds, "touchdown")} on ${opportunities(line)} produced ${abs} more fantasy points than expected from the opportunity.`;
    }
    case "over":
      return `${gameLine(line)} ${name} beat the opportunity by ${abs} points without leaning on touchdowns.`;
    case "role-up":
    case "role-down": {
      const r = story.role!;
      const what = r.metric === "snaps" ? "of the snaps" : "of the targets";
      return `Played to ${Math.round(r.now * 100)}% ${what} after averaging ${Math.round(r.before * 100)}% before this game. ${gameLine(line)}`;
    }
    case "above":
    case "below":
      return `${gameLine(line)} ${abs} points ${story.kind === "above" ? "above" : "below"} expected from ${opportunities(line)}.`;
    default:
      return gameLine(line);
  }
}

function renderStandouts(ctx: Ctx, lines: FantasyLine[]): string {
  const stories = pickStandouts(lines);
  if (stories.length === 0) return "";
  const cards = stories
    .map((story) => {
      const { line } = story;
      const finish = per((f) => ctx.finish(line, f));
      const meta = per((f) => [line.team, line.pos ?? "", finish[f] ? `${finish[f]} weekly finish` : ""].filter(Boolean).join(" · "));
      return (
        `<article class="sct-fz-card is-${story.kind}" style="--fz-team:${ink(ctx.input, line.team)}">` +
        `<div class="sct-fz-card-head">` +
        face(line, "sct-fz-card-face", 56) +
        `<div class="sct-fz-card-who">` +
        `<p class="sct-fz-card-tag">${e(STORY_LABEL[story.kind])}</p>` +
        `<h3 class="sct-fz-card-name">${nameLink(ctx, line)}</h3>` +
        `<p class="sct-fz-card-meta">${swap(meta)}</p>` +
        `</div></div>` +
        `<p class="sct-fz-card-pts">${swap(per((f) => line.pts[f].toFixed(1)), "sct-fz-card-num")}<span class="sct-fz-card-unit">fantasy points</span></p>` +
        `<p class="sct-fz-card-text">${swap(per((f) => storyText(ctx, story, f)))}</p>` +
        `</article>`
      );
    })
    .join("");
  return section("fantasy-standouts", "Fantasy Standouts", `<div class="sct-fz-cards">${cards}</div>`, { slot: true });
}

/* ------------------------------------------------------ 02 box score */

function moreButton(total: number, more: string, less: string): string {
  return (
    `<button type="button" class="sct-mu-ps-toggle sct-fz-more" data-fz-more hidden aria-expanded="false" ` +
    `data-more="${e(more)}" data-less="${e(less)}">${e(more)}</button>`
  );
}

function renderBoxScore(ctx: Ctx, lines: FantasyLine[]): string {
  if (lines.length === 0) return "";
  const rows = lines
    .map((line, at) => {
      const finish = per((f) => ctx.finish(line, f) ?? "-");
      return (
        `<tr${at >= BOX_SHOWN ? ` class="is-extra"` : ""}>` +
        `<th scope="row" class="sct-fz-player">${who(ctx, line)}</th>` +
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
  const chart = [...judged].sort((a, b) => Math.abs(b.over!.ppr) - Math.abs(a.over!.ppr)).slice(0, CHART_ROWS);
  // One scale for every bar in a format, from the biggest figure on the chart.
  const scale = per((f) => Math.max(1, ...chart.flatMap((l) => [l.pts[f], l.x![f]])));
  const width = (v: number, f: Format): string => String(Math.max(0, Math.round((v / scale[f]) * 1000) / 10));
  const bar = (kind: "actual" | "expected", values: Triple): string =>
    `<span class="sct-fz-bar is-${kind}">` +
    `<span class="sct-fz-bar-label">${kind === "actual" ? "Actual" : "Expected"}</span>` +
    `<span class="sct-fz-bar-track"><span class="sct-fz-bar-fill" style="width:${width(values.ppr, "ppr")}%"` +
    FORMATS.map((f) => ` data-w-${f}="${width(values[f], f)}"`).join("") +
    `></span></span>` +
    swap(per((f) => values[f].toFixed(1)), "sct-fz-bar-num") +
    `</span>`;
  const items = chart
    .map((l) => {
      const adv = per((f) => verdictOf(l.over![f]) === "above" ? "pos" : verdictOf(l.over![f]) === "below" ? "neg" : "even");
      return (
        `<li class="sct-fz-x" style="--fz-team:${ink(ctx.input, l.team)}">` +
        `<div class="sct-fz-x-head">${who(ctx, l)}` +
        `<span class="sct-fz-x-diff" data-adv="${adv.ppr}"${FORMATS.map((f) => ` data-adv-${f}="${adv[f]}"`).join("")}>` +
        swap(per((f) => `${signed(l.over![f])} vs xFP`)) +
        `<span class="sct-fz-x-verdict">${swap(per((f) => VERDICT_LABEL[verdictOf(l.over![f])]))}</span>` +
        `</span></div>` +
        `<div class="sct-fz-x-bars">${bar("actual", l.pts)}${bar("expected", l.x!)}</div>` +
        `<p class="sct-fz-x-why">${swap(per((f) => reason(l, f)))}</p>` +
        `</li>`
      );
    })
    .join("");

  const full = [...judged]
    .sort((a, b) => b.x!.ppr - a.x!.ppr || a.name.localeCompare(b.name))
    .map(
      (l) =>
        `<tr><th scope="row" class="sct-fz-player">${who(ctx, l)}</th>` +
        `<td class="sct-fz-pts"${fmtAttrs(per((f) => l.pts[f].toFixed(1)))}>${l.pts.ppr.toFixed(1)}</td>` +
        `<td${fmtAttrs(per((f) => l.x![f].toFixed(1)))}>${l.x!.ppr.toFixed(1)}</td>` +
        (() => {
          const adv = per((f) => (l.over![f] > 0.05 ? "pos" : l.over![f] < -0.05 ? "neg" : "even"));
          return (
            `<td class="sct-fz-diff" data-adv="${adv.ppr}"${FORMATS.map((f) => ` data-adv-${f}="${adv[f]}"`).join("")}` +
            `${fmtAttrs(per((f) => signed(l.over![f])))}>${signed(l.over!.ppr)}</td>`
          );
        })() +
        `<td class="sct-fz-prod">${e(opportunities(l))}</td></tr>`,
    )
    .join("");

  const body =
    `<p class="sct-fz-legend" aria-hidden="true"><span class="sct-fz-key is-actual"></span>Actual <span class="sct-fz-key is-expected"></span>Expected (xFP)</p>` +
    `<ol class="sct-fz-xlist">${items}</ol>` +
    `<details class="sct-fz-all"><summary>Show all ${judged.length} players</summary>` +
    `<div class="sct-fz-wrap"><table class="sct-fz-table is-xfp">` +
    `<caption class="sct-rb-sr">Actual and expected fantasy points for every player with an opportunity</caption>` +
    `<thead><tr><th scope="col">Player</th><th scope="col"><abbr title="Fantasy points">PTS</abbr></th>` +
    `<th scope="col"><abbr title="Expected fantasy points">xFP</abbr></th>` +
    `<th scope="col"><abbr title="Points over or under expected">vs xFP</abbr></th>` +
    `<th scope="col" class="sct-fz-prod">Opportunity</th></tr></thead>` +
    `<tbody>${full}</tbody></table></div></details>`;
  return section("fantasy-xfp", "Actual vs Expected (xFP)", body, { slot: true });
}

/* ---------------------------------------------------- 05 redraft command */

function renderResearch(ctx: Ctx): string {
  return (
    `<aside class="sct-mu-ps-cta sct-fz-cta" aria-label="Redraft Command">` +
    `<div class="sct-mu-ps-cta-text">` +
    `<p class="sct-fz-cta-eyebrow">Current tools</p>` +
    `<p class="sct-mu-ps-cta-title">Research These Players for Your Next Matchup</p>` +
    `<p class="sct-mu-ps-cta-sub">Explore current projections, player values, and lineup recommendations using your league settings.</p>` +
    `</div>` +
    `<a class="sct-mu-ps-cta-button" href="${e(ctx.input.redraftUrl)}" data-cta="fantasy-tab-redraft">Open Redraft Command →</a>` +
    `</aside>`
  );
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
    renderStandouts(ctx, lines) +
    renderBoxScore(ctx, lines) +
    renderUsage(ctx, lines) +
    renderExpected(ctx, lines) +
    renderResearch(ctx) +
    `</div>`
  );
}
