/**
 * The completed game's Play-by-Play tab (mak, 2026-11-08): exactly what
 * happened on every possession and play. Two sections, no more (Drive
 * Overview, a strip of outcome chips per team, removed 2026-11-10 at mak's
 * request: it repeated the drives the full log already lists):
 *
 *   Scoring Summary     every score in order: quarter and clock, the team,
 *                       the play, the score after it (away-home)
 *   Full Play-by-Play   quarter -> drive -> play: each drive a <details>
 *                       row (team, result, plays, yards, time), its plays
 *                       inside with down and distance, field position,
 *                       clock and the score on a scoring play
 *
 * Not here, on purpose: the win-probability chart and the turning points
 * (Overview), team and player totals (Box Score).
 *
 * The plays and drives are nflverse's own (data/matchup/pbp/<season>/<game
 * id>.json, written by scripts/matchup/buildGameStory.mjs): drives are its
 * fixed_drive ids, so a drive that crosses a quarter stays one drive, and
 * nothing is rebuilt from changes of possession. The scoring summary is the
 * box score's scoring plays (the touchdown and its try as one line), the
 * same record the hero's line score is checked against.
 *
 * The Show all / Collapse all buttons and the event filter are built hidden
 * and switched on by client/team.ts; without the script every drive is a
 * plain <details> the reader opens.
 */

import fs from "node:fs";
import { escapeHtml } from "../render";
import { dataPath } from "../data-dir";
import type { ScoringPlay } from "./scoring-plays";
import { refineDrives } from "./play-facts";
import { playLineHtml, runningScore } from "./scoring-summary";
import type { ScoreboardGame } from "./scoreboard-hero";
import type { PlayerUrlFn } from "../team/links";

type Side = "away" | "home";
const e = escapeHtml;

/* ---------------------------------------------------------------- data */

export type PbpDriveResult =
  | "td"
  | "fg"
  | "punt"
  | "int"
  | "fumble"
  | "turnover"
  | "downs"
  | "missed_fg"
  /** A missed field goal the play text says was blocked (play-facts.ts refineDrives). */
  | "blocked_fg"
  | "safety"
  | "end_half"
  | "end_game"
  | "other";

export interface PbpDrive {
  n: number;
  team: string;
  result: PbpDriveResult;
  qtr: number | null;
  clock: string | null;
  /** "NE 25". */
  start: string | null;
  plays: number | null;
  yards: number | null;
  /** "3:12". */
  top: string | null;
  /** The score when it ended. */
  away: number | null;
  home: number | null;
  /** The other team scored on the play that ended it. */
  defScore?: 1;
}

export interface PbpPlay {
  d: number | null;
  q: number | null;
  c: string | null;
  t?: string;
  dn?: number;
  togo?: number;
  at?: string;
  y?: number;
  x: string;
  k: string;
  away: number | null;
  home: number | null;
  td?: 1;
  int?: 1;
  fum?: 1;
  sack?: 1;
  pen?: 1;
  fd?: 1;
  big?: 1;
  score?: 1;
}

export interface GamePbp {
  season: number;
  week: number | null;
  seasonType: "regular" | "post";
  home: string;
  away: string;
  drives: PbpDrive[];
  plays: PbpPlay[];
  /**
   * How the game ended per ESPN's drive chart (play-facts withGameEnding),
   * attached by the page; null when the chart does not show a score ending
   * it, absent when never checked. Never stored in the file.
   */
  ending?: import("./play-facts").GameEnding | null;
}

/**
 * One game's play-by-play, or null. Read straight from disk with a small
 * cache: a season is a few hundred files and the shared readDataJson cache
 * never lets go of what it reads.
 */
const recent = new Map<string, { mtimeMs: number; doc: GamePbp }>();
export function loadGamePbp(season: number, gameId: string): GamePbp | null {
  if (!/^[\w-]+$/.test(gameId)) return null;
  const file = dataPath("matchup", "pbp", String(season), `${gameId}.json`);
  try {
    const { mtimeMs } = fs.statSync(file);
    const hit = recent.get(file);
    if (hit && hit.mtimeMs === mtimeMs) return hit.doc;
    // A blocked kick is told as blocked everywhere a drive result is printed.
    const doc = refineDrives(JSON.parse(fs.readFileSync(file, "utf8")) as GamePbp);
    recent.set(file, { mtimeMs, doc });
    while (recent.size > 12) recent.delete(recent.keys().next().value!);
    return doc;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- helpers */

const RESULT: Record<PbpDriveResult, { label: string }> = {
  td: { label: "Touchdown" },
  fg: { label: "Field goal" },
  punt: { label: "Punt" },
  int: { label: "Interception" },
  fumble: { label: "Fumble" },
  turnover: { label: "Turnover" },
  downs: { label: "Turnover on downs" },
  missed_fg: { label: "Missed field goal" },
  blocked_fg: { label: "Blocked field goal" },
  safety: { label: "Safety" },
  end_half: { label: "End of half" },
  end_game: { label: "End of game" },
  other: { label: "Other" },
};

/** Which color a drive result wears: a score, a giveaway, or neither. */
function tone(r: PbpDriveResult): "score" | "turnover" | "plain" {
  if (r === "td" || r === "fg") return "score";
  if (r === "int" || r === "fumble" || r === "turnover" || r === "downs" || r === "safety") return "turnover";
  return "plain";
}

const clockText = (c: string | null): string => (c ?? "").replace(/^0(?=\d)/, "");
const quarterShort = (q: number | null): string => (q === null ? "" : q >= 5 ? (q === 5 ? "OT" : `${q - 4}OT`) : `Q${q}`);
function quarterName(q: number): string {
  if (q <= 4) return `${["1st", "2nd", "3rd", "4th"][q - 1]} Quarter`;
  return q === 5 ? "Overtime" : `${q - 4}th Overtime`;
}

const ORD = ["", "1st", "2nd", "3rd", "4th"];

/** "1st & 10 at SEA 24", "3rd & Goal at NE 4", "at NE 35" for a kickoff. */
function situation(p: PbpPlay): string {
  const at = p.at ? (p.at === "MID 50" ? "50" : p.at) : null;
  if (p.dn && p.togo !== undefined && ORD[p.dn]) {
    const [side, yd] = (p.at ?? "").split(" ");
    const goal = side && p.t && side !== p.t && Number(yd) === p.togo;
    return `${ORD[p.dn]} & ${goal ? "Goal" : p.togo}${at ? ` at ${at}` : ""}`;
  }
  return "";
}

/** A play's markers: what the filter keys on, and the small badges it shows. */
function tags(p: PbpPlay): string[] {
  const t: string[] = [];
  if (p.score || p.td) t.push("score");
  if (p.int || p.fum) t.push("turnover");
  if (p.sack) t.push("sack");
  if (p.big) t.push("big");
  if (p.pen) t.push("penalty");
  return t;
}

function badges(p: PbpPlay): string {
  const b: Array<[string, string]> = [];
  if (p.td) b.push(["score", "TD"]);
  else if (p.score) {
    const label = p.k === "field_goal" ? "FG" : p.k === "extra_point" ? "XP" : /TWO-POINT/i.test(p.x) ? "2-PT" : p.k === "safety" || /SAFETY/.test(p.x) ? "Safety" : "Score";
    b.push(["score", label]);
  }
  if (p.int) b.push(["turnover", "INT"]);
  if (p.fum) b.push(["turnover", "Fumble lost"]);
  if (p.sack) b.push(["sack", "Sack"]);
  if (p.big && p.y !== undefined) b.push(["big", `+${p.y}`]);
  if (p.pen) b.push(["penalty", "Penalty"]);
  return b.map(([cls, text]) => `<span class="sct-pbp-badge is-${cls}">${e(text)}</span>`).join("");
}

/* ------------------------------------------------------------ sections */

function section(id: string, title: string, body: string, extra = ""): string {
  return (
    `<section class="sct-rb-section sct-pbp-sec${extra ? ` ${extra}` : ""}" aria-labelledby="${e(id)}">` +
    `<h2 class="sct-rb-h2" id="${e(id)}">${e(title)}</h2>` +
    body +
    `</section>`
  );
}

function chip(game: ScoreboardGame, team: string): string {
  const side: Side | null = team === game.away.abbr ? "away" : team === game.home.abbr ? "home" : null;
  return `<span class="sct-pbp-team${side ? ` is-${side}` : ""}">${e(team)}</span>`;
}

function scoringSection(game: ScoreboardGame, plays: ScoringPlay[], url: (name: string) => string | null): string {
  if (!plays.length) return "";
  const rows = runningScore(game, plays)
    .map(({ play, away, home }) => {
      const short = play.team === game.away.abbr ? game.away.short : game.home.short;
      return (
        `<li class="sct-pbp-score">` +
        `<span class="sct-pbp-when">${e(`${quarterShort(play.quarter)} · ${clockText(play.clock)}`)}</span>` +
        `<span class="sct-pbp-what">${chip(game, play.team)} ${playLineHtml(play, short, url)}</span>` +
        `<span class="sct-pbp-tally" aria-label="${e(`${game.away.abbr} ${away}, ${game.home.abbr} ${home}`)}">${away}–${home}</span>` +
        `</li>`
      );
    })
    .join("");
  return section(
    "pbp-scoring",
    "Scoring summary",
    `<ol class="sct-pbp-scores">${rows}</ol>`,
  );
}

/** "−4" with a real minus; null as an en dash placeholder. */
const signed = (n: number | null): string => (n === null ? "-" : n < 0 ? `−${Math.abs(n)}` : String(n));

/**
 * One drive, one line (mak, 2026-11-09): team, result, start clock, field
 * position, plays, yards, time of possession, score. The cells are aligned
 * columns under a single header row; screen readers get the sentence in
 * the sr-only span instead of the bare cells. The plays sit behind the
 * <details> toggle.
 */
function driveRow(game: ScoreboardGame, d: PbpDrive, plays: PbpPlay[]): string {
  const r = RESULT[d.result];
  const driveTags = [...new Set(plays.flatMap(tags))];
  const from = d.start ? (d.start === "MID 50" ? "the 50" : d.start) : "";
  const clock = clockText(d.clock);
  const scored = d.result === "td" || d.result === "fg" || d.result === "safety" || d.defScore;
  const tally = scored && d.away !== null && d.home !== null ? `${d.away}–${d.home}` : "";
  // A drive that runs into the next quarter says where it ended (mak,
  // 2026-11-11: a Q3 drive whose fumble was returned for a score in Q4).
  const endQ = plays.reduce((q, p) => (p.q && d.qtr && p.q > q ? p.q : q), d.qtr ?? 0);
  const spans = Boolean(d.qtr) && endQ > (d.qtr ?? 0);
  const spoken = [
    `${quarterShort(d.qtr)} ${clock}${from ? ` from ${from}` : ""}`.trim(),
    spans ? `ended in ${quarterShort(endQ)}` : null,
    d.plays !== null ? `${d.plays} play${d.plays === 1 ? "" : "s"}` : null,
    d.yards !== null ? `${d.yards} yard${Math.abs(d.yards) === 1 ? "" : "s"}` : null,
    d.top ? clockText(d.top) : null,
  ].filter(Boolean);
  const items = plays
    .map((p) => {
      const sit = situation(p);
      const when = `${p.q !== d.qtr ? `${quarterShort(p.q)} ` : ""}${clockText(p.c)}`;
      const t = tags(p);
      const shown = p.score && p.away !== null && p.home !== null ? `<span class="sct-pbp-tally">${p.away}–${p.home}</span>` : "";
      return (
        `<li class="sct-pbp-play${t.length ? " is-marked" : ""}${p.k === "timeout" ? " is-quiet" : ""}" data-tags="${e(t.join(" "))}">` +
        `<span class="sct-pbp-sit">${e(sit)}${sit && when ? " · " : ""}${e(when)}</span>` +
        `<span class="sct-pbp-text">${e(p.x)}${badges(p)}</span>` +
        shown +
        `</li>`
      );
    })
    .join("");
  // Quarter cards (mak, 2026-11-09): the line keeps team, result, the
  // drive's size and the score; when, where from and how long move into the
  // open drive, above its plays.
  const size = [
    d.plays !== null ? `${d.plays} play${d.plays === 1 ? "" : "s"}` : null,
    d.yards !== null ? `${signed(d.yards)} yds` : null,
  ].filter(Boolean);
  const info = [
    clock ? `Started ${clock}` : null,
    from ? `from ${from}` : null,
    d.top ? `${clockText(d.top)} possession` : null,
  ].filter(Boolean);
  return (
    `<details class="sct-pbp-drive is-${tone(d.result)}" id="pbp-drive-${d.n}" data-tags="${e(driveTags.join(" "))}">` +
    `<summary>` +
    `<span class="sct-rb-sr">${e(`${d.team} drive: ${r.label}${tally ? `, ${game.away.abbr} ${d.away}, ${game.home.abbr} ${d.home}` : ""}. ${spoken.join(" · ")}`)}</span>` +
    `<span class="sct-pbp-drow" aria-hidden="true">` +
    `<span class="sct-pbp-drive-team">${chip(game, d.team)}</span>` +
    `<b class="sct-pbp-dres">${e(r.label)}${spans ? ` <span class="sct-pbp-dspan">Ends in ${e(quarterShort(endQ))}</span>` : ""}</b>` +
    `<span class="sct-pbp-dsize">${e(size.join(" · "))}</span>` +
    `<span class="sct-pbp-tally${tally ? "" : " is-empty"}">${e(tally)}</span>` +
    `</span>` +
    `</summary>` +
    (info.length ? `<p class="sct-pbp-dinfo">${e(info.join(" · "))}</p>` : "") +
    `<ol class="sct-pbp-plays">${items}</ol>` +
    `</details>`
  );
}

function fullSection(game: ScoreboardGame, pbp: GamePbp): string {
  if (!pbp.drives.length) return "";
  const byDrive = new Map<number, PbpPlay[]>();
  for (const p of pbp.plays) {
    if (p.d === null) continue;
    const list = byDrive.get(p.d) ?? [];
    list.push(p);
    byDrive.set(p.d, list);
  }
  const quarters = [...new Set(pbp.drives.map((d) => d.qtr ?? 1))].sort((a, b) => a - b);
  const groups = quarters
    .map((q) => {
      const drives = pbp.drives.filter((d) => (d.qtr ?? 1) === q);
      // The score at the end of the quarter: its last play's.
      const last = [...pbp.plays].reverse().find((p) => p.q === q && p.away !== null && p.home !== null);
      const score = last ? `${game.away.abbr} ${last.away} · ${game.home.abbr} ${last.home}` : "";
      return (
        `<div class="sct-pbp-q">` +
        `<h3 class="sct-pbp-qh">${e(quarterName(q))}${score ? ` <span>${e(score)}</span>` : ""}</h3>` +
        drives.map((d) => driveRow(game, d, byDrive.get(d.n) ?? [])).join("") +
        `</div>`
      );
    })
    .join("");
  const filter = (value: string, label: string, on = false) =>
    `<button type="button" class="sct-pbp-filter${on ? " is-on" : ""}" data-pbp-filter="${e(value)}" aria-pressed="${on}">${e(label)}</button>`;
  // The filter sits in the section's title bar (mak, 2026-11-09); the one
  // Expand all / Collapse all toggle sits centered under the log. Both are
  // printed hidden and shown by the client.
  const controls =
    `<div class="sct-pbp-filters" role="group" aria-label="Show drives" data-pbp-controls hidden>` +
    filter("all", "All drives", true) +
    filter("score", "Scoring") +
    filter("turnover", "Turnovers") +
    filter("major", "Major plays") +
    `</div>`;
  const more =
    `<div class="sct-pbp-more" data-pbp-more hidden>` +
    `<button type="button" class="sct-pbp-btn" data-pbp-expand aria-expanded="false">Expand all</button>` +
    `</div>`;
  return (
    `<section class="sct-rb-section sct-pbp-sec sct-pbp-full" aria-labelledby="pbp-full">` +
    `<div class="sct-fp-head sct-pbp-head"><h2 class="sct-rb-h2" id="pbp-full">${e("Full play-by-play")}</h2>${controls}</div>` +
    `<div class="sct-pbp-list" data-pbp-list><div class="sct-pbp-qgrid">${groups}</div></div>` +
    more +
    `<p class="sct-rb-note">Major plays are scores, turnovers, sacks and gains of 20+ yards. A drive is listed under the quarter it started in.</p>` +
    `</section>`
  );
}

export interface PlayByPlayInput {
  game: ScoreboardGame;
  pbp: GamePbp | null;
  scoringPlays: ScoringPlay[];
  playerUrl: PlayerUrlFn;
  inks: Record<Side, string>;
}

/**
 * The same, in two parts: the Scoring Summary (`lead`), which the recap's
 * Play-by-Play tab puts inside its header's container (mak, 2026-11-10),
 * and the drive strip and full play-by-play after it (`rest`, the
 * [data-pbp] box client/team.ts wires). Each part carries the team inks.
 */
export function renderPlayByPlayParts(input: PlayByPlayInput): { lead: string; rest: string } | null {
  const { game, pbp } = input;
  if (!pbp || !pbp.plays.length) return null;
  const style = e(`--pbp-away:${input.inks.away};--pbp-home:${input.inks.home}`);
  const scoring = scoringSection(game, input.scoringPlays, input.playerUrl);
  const rest = fullSection(game, pbp);
  if (!scoring && !rest) return null;
  return {
    lead: scoring ? `<div class="sct-pbp" style="${style}">${scoring}</div>` : "",
    rest: rest ? `<div class="sct-pbp" data-pbp style="${style}">${rest}</div>` : "",
  };
}
