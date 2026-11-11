/**
 * The rebuilt Game Flow tab (mak, 2026-11-10, from a reviewer's brief): not
 * the box score again but how the game unfolded strategically. Five
 * sections, each one something no other tab shows:
 *
 *   Drive Timeline            every possession on a 60-minute track, one
 *                             lane per team, its width the time it took
 *   Field Position and Points where each drive started and what it was worth
 *   Offense by Half           each offense's first half against its second
 *   Drive Efficiency          points per drive, scoring rate, three-and-outs,
 *                             drive length, red zone
 *   Play Calling by Score     pass rate leading, tied and trailing
 *
 * Printed UNDER the current Game Flow content as a comparison until mak
 * decides. Everything is counted from the stored nflverse play-by-play
 * (data/matchup/pbp/<season>/<game id>.json): drives are its fixed drives,
 * each drive's score is the score when it ended, each play's score the score
 * after it. Pure: input in, HTML out.
 */

import { escapeHtml } from "../render";
import type { GamePbp, PbpDrive, PbpPlay } from "./play-by-play";
import type { ScoreboardGame } from "./scoreboard-hero";

const e = escapeHtml;

type Side = "away" | "home";
const SIDES: readonly Side[] = ["away", "home"];

export interface GameFlowPremiumInput {
  game: ScoreboardGame;
  pbp: GamePbp | null;
}

/* ------------------------------------------------------------ the model */

interface FlowDrive {
  n: number;
  side: Side;
  result: PbpDrive["result"];
  /** Game seconds elapsed when it began and how long it ran. */
  at: number;
  secs: number;
  /** Yards from the offense's own goal line, 1-99. */
  start: number | null;
  plays: number;
  yards: number;
  points: number;
  half: 1 | 2;
  redZone: boolean;
  defScore: boolean;
  label: string;
}

interface FlowPlay {
  side: Side;
  half: 1 | 2;
  pass: boolean;
  down: number | null;
  togo: number | null;
  yards: number;
  firstDown: boolean;
  td: boolean;
  /** The offense's lead at the snap (negative when trailing). */
  margin: number;
}

const RESULT_TEXT: Record<PbpDrive["result"], string> = {
  td: "Touchdown",
  fg: "Field goal",
  punt: "Punt",
  int: "Interception",
  fumble: "Fumble",
  turnover: "Turnover",
  downs: "Turnover on downs",
  missed_fg: "Missed field goal",
  safety: "Safety",
  end_half: "End of half",
  end_game: "End of game",
  other: "Other",
};

function tone(r: PbpDrive["result"]): "score" | "turnover" | "plain" {
  if (r === "td" || r === "fg") return "score";
  if (r === "int" || r === "fumble" || r === "turnover" || r === "downs" || r === "safety") return "turnover";
  return "plain";
}

function mmss(t: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Seconds elapsed at a quarter and clock; overtime periods are ten minutes. */
function elapsed(q: number | null, clock: string | null): number | null {
  const c = mmss(clock);
  if (!q || c === null) return null;
  return q <= 4 ? (q - 1) * 900 + (900 - c) : 3600 + (q - 5) * 600 + (600 - c);
}

/** "NE 25" for an NE offense is 25; "GB 25" is 75; "50" is 50. */
function fromOwnGoal(spot: string | null | undefined, offense: string): number | null {
  const m = /^(?:([A-Z]{2,3}) )?(\d{1,2})$/.exec((spot ?? "").trim());
  if (!m) return null;
  const n = Number(m[2]);
  if (!m[1] || n === 50) return 50;
  return m[1] === offense ? n : 100 - n;
}

interface Model {
  drives: FlowDrive[];
  plays: FlowPlay[];
  length: number;
  overtime: boolean;
}

function buildModel(pbp: GamePbp): Model | null {
  const sideOf = (abbr: string | undefined): Side | null =>
    abbr === pbp.away ? "away" : abbr === pbp.home ? "home" : null;

  // Red zone: any snap from the opponent's 20 or closer.
  const redZone = new Set<number>();
  for (const p of pbp.plays) {
    // A snap with no down is a conversion try, not a red-zone trip.
    if (p.d === null || !p.t || !p.dn || (p.k !== "pass" && p.k !== "run" && p.k !== "field_goal")) continue;
    const y = fromOwnGoal(p.at, p.t);
    if (y !== null && y >= 80) redZone.add(p.d);
  }

  let before = { away: 0, home: 0 };
  let overtime = false;
  const drives: FlowDrive[] = [];
  for (const d of pbp.drives) {
    const side = sideOf(d.team);
    const at = elapsed(d.qtr, d.clock);
    const after = { away: d.away ?? before.away, home: d.home ?? before.home };
    if (side && at !== null) {
      if ((d.qtr ?? 0) > 4) overtime = true;
      drives.push({
        n: d.n,
        side,
        result: d.result,
        at,
        secs: mmss(d.top) ?? 0,
        start: fromOwnGoal(d.start, d.team),
        plays: d.plays ?? 0,
        yards: d.yards ?? 0,
        points: d.defScore ? 0 : Math.max(0, after[side] - before[side]),
        half: (d.qtr ?? 1) <= 2 ? 1 : 2,
        redZone: redZone.has(d.n),
        defScore: Boolean(d.defScore),
        label: RESULT_TEXT[d.result],
      });
    }
    before = after;
  }
  if (!drives.length) return null;

  const plays: FlowPlay[] = [];
  let score = { away: 0, home: 0 };
  for (const p of pbp.plays as PbpPlay[]) {
    const side = sideOf(p.t);
    // Scrimmage snaps only: a conversion try has no down.
    if (side && (p.k === "pass" || p.k === "run") && p.q && p.dn) {
      const other: Side = side === "away" ? "home" : "away";
      plays.push({
        side,
        half: p.q <= 2 ? 1 : 2,
        pass: p.k === "pass",
        down: p.dn ?? null,
        togo: p.togo ?? null,
        yards: p.y ?? 0,
        firstDown: Boolean(p.fd),
        td: Boolean(p.td),
        margin: score[side] - score[other],
      });
    }
    if (p.away !== null && p.home !== null) score = { away: p.away, home: p.home };
  }

  const last = drives[drives.length - 1]!;
  const length = Math.max(3600, last.at + last.secs, ...drives.map((d) => d.at + d.secs));
  return { drives, plays, length: overtime ? Math.max(length, 4200) : length, overtime };
}

/* -------------------------------------------------------------- helpers */

const one = (n: number): string => n.toFixed(1);
const pct = (n: number): string => `${Math.round(n * 100)}%`;
const clockText = (s: number): string => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;

/** A success: 40% of the distance on first down, 60% on second, all of it after. */
function success(p: FlowPlay): boolean {
  if (p.td) return true;
  if (p.down === null || p.togo === null || p.togo <= 0) return p.firstDown;
  const need = p.down === 1 ? 0.4 : p.down === 2 ? 0.6 : 1;
  return p.yards >= need * p.togo;
}

function chip(game: ScoreboardGame, side: Side): string {
  return `<span class="sct-gfp-chip is-${side}">${e(game[side].abbr)}</span>`;
}

function section(id: string, title: string, read: string, body: string): string {
  return (
    `<section class="sct-rb-section sct-gfp-sec" aria-labelledby="${id}">` +
    `<h2 class="sct-rb-h2" id="${id}">${e(title)}</h2>` +
    (read ? `<p class="sct-gfp-read">${e(read)}</p>` : "") +
    body +
    `</section>`
  );
}

/* ------------------------------------------------------ 1. drive timeline */

function timeline(game: ScoreboardGame, m: Model): string {
  const lane = (side: Side): string => {
    const own = m.drives.filter((d) => d.side === side);
    const marks = own
      .map((d) => {
        const left = (d.at / m.length) * 100;
        const width = Math.max(0.8, (Math.max(d.secs, 20) / m.length) * 100);
        const tip =
          `${game[side].short}: ${d.label}` +
          (d.points ? `, ${d.points} pts` : "") +
          ` · ${plural(d.plays, "play")}, ${d.yards} yds, ${clockText(d.secs)}` +
          (d.start !== null ? ` · started ${spotText(d.start)}` : "");
        return (
          `<li class="sct-gfp-drive is-${tone(d.result)}" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%" title="${e(tip)}">` +
          (d.points && width > 2.4 ? `<span class="sct-gfp-pts" aria-hidden="true">${d.points}</span>` : "") +
          `<span class="sct-rb-sr">${e(tip)}</span></li>`
        );
      })
      .join("");
    return (
      `<div class="sct-gfp-lane is-${side}">` +
      `<p class="sct-gfp-lane-name">${chip(game, side)}</p>` +
      `<ol class="sct-gfp-track">${marks}</ol>` +
      `</div>`
    );
  };
  const quarters = m.overtime ? ["Q1", "Q2", "Q3", "Q4", "OT"] : ["Q1", "Q2", "Q3", "Q4"];
  const ticks = quarters
    .map((q, i) => `<span style="left:${((i * 900) / m.length) * 100}%">${q}</span>`)
    .join("");
  const lines = [1, 2, 3, ...(m.overtime ? [4] : [])]
    .map((i) => `<span class="${i === 2 ? "is-half" : ""}" style="left:${((i * 900) / m.length) * 100}%"></span>`)
    .join("");

  const scored = (s: Side) => {
    const own = m.drives.filter((d) => d.side === s);
    return { n: own.length, scores: own.filter((d) => d.points > 0).length };
  };
  const a = scored("away");
  const h = scored("home");
  const read =
    `${game.away.short} scored on ${a.scores} of ${a.n} possessions, ${game.home.short} on ${h.scores} of ${h.n}. ` +
    `Each block is one possession, as wide as the time it took.`;
  return section(
    "gf-timeline",
    "Drive Timeline",
    read,
    `<div class="sct-gfp-timeline">` +
      `<div class="sct-gfp-ticks" aria-hidden="true">${ticks}</div>` +
      `<div class="sct-gfp-lanes"><div class="sct-gfp-grid" aria-hidden="true">${lines}</div>${lane("away")}${lane("home")}</div>` +
      `</div>` +
      `<ul class="sct-gfp-legend">` +
      `<li><span class="sct-gfp-key is-score" aria-hidden="true"></span>Scoring drive (points shown)</li>` +
      `<li><span class="sct-gfp-key is-turnover" aria-hidden="true"></span>Turnover</li>` +
      `<li><span class="sct-gfp-key is-plain" aria-hidden="true"></span>Punt or end of half</li>` +
      `</ul>`,
  );
}

function spotText(y: number): string {
  if (y === 50) return "at midfield";
  return y < 50 ? `at own ${y}` : `at opp ${100 - y}`;
}

/* ------------------------------------------ 2. field position and points */

const ZONES: ReadonlyArray<{ label: string; lo: number; hi: number }> = [
  { label: "Own 1-20", lo: 1, hi: 20 },
  { label: "Own 21-40", lo: 21, hi: 40 },
  { label: "Own 41 to Opp 41", lo: 41, hi: 59 },
  { label: "Opp 40-21", lo: 60, hi: 79 },
  { label: "Opp 20 and in", lo: 80, hi: 99 },
];

function fieldPosition(game: ScoreboardGame, m: Model): string {
  const cell = (side: Side, lo: number, hi: number) => {
    const own = m.drives.filter((d) => d.side === side && d.start !== null && d.start >= lo && d.start <= hi);
    const pts = own.reduce((t, d) => t + d.points, 0);
    return { n: own.length, pts, ppd: own.length ? pts / own.length : 0 };
  };
  const rows = ZONES.map((z) => ({ z, cells: SIDES.map((s) => [s, cell(s, z.lo, z.hi)] as const) }));
  const max = Math.max(3, ...rows.flatMap((r) => r.cells.map(([, c]) => c.ppd)));
  const body = rows
    .map(
      ({ z, cells }) =>
        `<li class="sct-gfp-zone"><p class="sct-gfp-zone-name">${e(z.label)}</p>` +
        cells
          .map(([s, c]) => {
            const text = c.n ? `${one(c.ppd)} pts/drive · ${plural(c.n, "drive")}` : "No drives";
            return (
              `<div class="sct-gfp-bar-row" title="${e(`${game[s].short}, ${z.label}: ${text}`)}">` +
              `<span class="sct-gfp-bar-team">${chip(game, s)}</span>` +
              `<span class="sct-gfp-bar"><span class="is-${s}" style="width:${c.n ? Math.max(2, (c.ppd / max) * 100).toFixed(1) : 0}%"></span></span>` +
              `<span class="sct-gfp-bar-val">${e(text)}</span>` +
              `</div>`
            );
          })
          .join("") +
        `</li>`,
    )
    .join("");

  const avg = (s: Side) => {
    const own = m.drives.filter((d) => d.side === s && d.start !== null);
    return own.length ? own.reduce((t, d) => t + d.start!, 0) / own.length : null;
  };
  const avgs = SIDES.map((s) => [s, avg(s)] as const).filter(([, v]) => v !== null) as Array<readonly [Side, number]>;
  const read = avgs.length
    ? `Average start: ` +
      avgs.map(([s, v]) => `${game[s].short} ${spotText(Math.round(v)).replace(/^at /, "")}`).join(", ") +
      `. Bars show points per drive from each starting zone.`
    : "";
  return section("gf-field", "Field Position and Points", read, `<ol class="sct-gfp-zones">${body}</ol>`);
}

/* --------------------------------------------------------- 3. by half */

function byHalf(game: ScoreboardGame, m: Model): string {
  const stat = (side: Side, half: 1 | 2) => {
    const drives = m.drives.filter((d) => d.side === side && d.half === half);
    const plays = m.plays.filter((p) => p.side === side && p.half === half);
    const third = plays.filter((p) => p.down === 3);
    const pts = drives.reduce((t, d) => t + d.points, 0);
    return {
      pts,
      ppd: drives.length ? pts / drives.length : null,
      ypp: plays.length ? plays.reduce((t, p) => t + p.yards, 0) / plays.length : null,
      sr: plays.length ? plays.filter(success).length / plays.length : null,
      pass: plays.length ? plays.filter((p) => p.pass).length / plays.length : null,
      third: third.length ? `${third.filter((p) => p.firstDown || p.td).length}/${third.length}` : "-",
    };
  };
  const second = m.overtime ? "2nd half + OT" : "2nd half";
  const metrics: ReadonlyArray<[string, (s: ReturnType<typeof stat>) => string, (s: ReturnType<typeof stat>) => number | null]> = [
    ["Points", (s) => String(s.pts), (s) => s.pts],
    ["Points per drive", (s) => (s.ppd === null ? "-" : one(s.ppd)), (s) => s.ppd],
    ["Yards per play", (s) => (s.ypp === null ? "-" : one(s.ypp)), (s) => s.ypp],
    ["Success rate", (s) => (s.sr === null ? "-" : pct(s.sr)), (s) => s.sr],
    ["Pass rate", (s) => (s.pass === null ? "-" : pct(s.pass)), () => null],
    ["Third downs", (s) => s.third, () => null],
  ];
  const card = (side: Side): string => {
    const h1 = stat(side, 1);
    const h2 = stat(side, 2);
    const rows = metrics
      .map(([label, show, num]) => {
        const a = num(h1);
        const b = num(h2);
        const dir = a === null || b === null || Math.abs(b - a) < 1e-9 ? "" : b > a ? "is-up" : "is-down";
        const arrow = dir === "is-up" ? "▲" : dir === "is-down" ? "▼" : "";
        return (
          `<tr><th scope="row">${e(label)}</th><td>${e(show(h1))}</td>` +
          `<td>${e(show(h2))}${arrow ? ` <span class="sct-gfp-dir ${dir}" aria-label="${dir === "is-up" ? "up" : "down"}">${arrow}</span>` : ""}</td></tr>`
        );
      })
      .join("");
    return (
      `<div class="sct-gfp-half is-${side}">` +
      `<p class="sct-gfp-half-name">${chip(game, side)} ${e(game[side].short)}</p>` +
      `<table class="sct-gfp-half-table"><thead><tr><th scope="col"><span class="sct-rb-sr">Stat</span></th>` +
      `<th scope="col">1st half</th><th scope="col">${e(second)}</th></tr></thead><tbody>${rows}</tbody></table>` +
      `</div>`
    );
  };
  const change = (side: Side) => stat(side, 2).pts - stat(side, 1).pts;
  const swing = SIDES.map((s) => [s, change(s)] as const).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))[0]!;
  const read =
    swing[1] === 0
      ? "Both offenses scored the same in each half as the other. Success: 40% of the distance on 1st down, 60% on 2nd, all of it on 3rd and 4th."
      : `The biggest shift: ${game[swing[0]].short} scored ${Math.abs(swing[1])} ${swing[1] > 0 ? "more" : "fewer"} points after halftime. ` +
        `Success: 40% of the distance on 1st down, 60% on 2nd, all of it on 3rd and 4th.`;
  return section("gf-halves", "Offense by Half", read, `<div class="sct-gfp-halves">${card("away")}${card("home")}</div>`);
}

/* ------------------------------------------------- 4. drive efficiency */

function efficiency(game: ScoreboardGame, m: Model): string {
  const stat = (side: Side) => {
    const own = m.drives.filter((d) => d.side === side && d.result !== "end_half" && d.result !== "end_game");
    const all = m.drives.filter((d) => d.side === side);
    const n = own.length || 1;
    const rz = all.filter((d) => d.redZone);
    return {
      ppd: all.reduce((t, d) => t + d.points, 0) / (all.length || 1),
      scoring: own.filter((d) => d.points > 0).length / n,
      threeOut: own.filter((d) => d.result === "punt" && d.plays <= 3).length,
      plays: own.reduce((t, d) => t + d.plays, 0) / n,
      yards: own.reduce((t, d) => t + d.yards, 0) / n,
      secs: own.reduce((t, d) => t + d.secs, 0) / n,
      rz: rz.length,
      rzTd: rz.filter((d) => d.result === "td").length,
    };
  };
  const a = stat("away");
  const h = stat("home");
  type Row = [string, number, number, (v: number) => string, boolean];
  const rows: Row[] = [
    ["Points per drive", a.ppd, h.ppd, one, true],
    ["Scoring drives", a.scoring, h.scoring, pct, true],
    ["Three-and-outs", a.threeOut, h.threeOut, String, false],
    ["Plays per drive", a.plays, h.plays, one, true],
    ["Yards per drive", a.yards, h.yards, one, true],
    ["Time per drive", a.secs, h.secs, clockText, true],
  ];
  const bar = ([label, av, hv, fmt, higherBetter]: Row): string => {
    const total = av + hv || 1;
    const lead = av === hv ? null : (av > hv) === higherBetter ? "away" : "home";
    return (
      `<li class="sct-gfp-vs" title="${e(`${label}: ${game.away.short} ${fmt(av)}, ${game.home.short} ${fmt(hv)}`)}">` +
      `<div class="sct-gfp-vs-line"><b class="${lead === "away" ? "is-lead" : ""}">${e(fmt(av))}</b>` +
      `<span>${e(label)}</span><b class="${lead === "home" ? "is-lead" : ""}">${e(fmt(hv))}</b></div>` +
      `<div class="sct-gfp-vs-bar" aria-hidden="true"><span class="is-away" style="flex-grow:${Math.max(av / total, 0.02).toFixed(3)}"></span>` +
      `<span class="is-home" style="flex-grow:${Math.max(hv / total, 0.02).toFixed(3)}"></span></div>` +
      `</li>`
    );
  };
  const rzText = (s: Side, x: ReturnType<typeof stat>) =>
    x.rz ? `${game[s].short} ${x.rzTd} TD${x.rzTd === 1 ? "" : "s"} on ${plural(x.rz, "trip")}` : `${game[s].short} never reached it`;
  const read = `Red zone: ${rzText("away", a)}; ${rzText("home", h)}. End-of-half possessions are left out of the per-drive averages except points.`;
  return section(
    "gf-efficiency",
    "Drive Efficiency",
    read,
    `<div class="sct-gfp-vs-head"><span>${chip(game, "away")} ${e(game.away.short)}</span><span>${e(game.home.short)} ${chip(game, "home")}</span></div>` +
      `<ol class="sct-gfp-vs-list">${rows.map(bar).join("")}</ol>`,
  );
}

/* --------------------------------------------- 5. play calling by score */

const STATES: ReadonlyArray<{ label: string; test: (m: number) => boolean }> = [
  { label: "Leading by 9+", test: (m) => m >= 9 },
  { label: "Leading by 1-8", test: (m) => m >= 1 && m <= 8 },
  { label: "Tied", test: (m) => m === 0 },
  { label: "Trailing by 1-8", test: (m) => m <= -1 && m >= -8 },
  { label: "Trailing by 9+", test: (m) => m <= -9 },
];

function calling(game: ScoreboardGame, m: Model): string {
  const card = (side: Side): string => {
    const own = m.plays.filter((p) => p.side === side);
    const rows = STATES.map((st) => {
      const plays = own.filter((p) => st.test(p.margin));
      const rate = plays.length ? plays.filter((p) => p.pass).length / plays.length : null;
      const text = rate === null ? "No snaps" : `${pct(rate)} pass · ${plural(plays.length, "play")}`;
      return (
        `<li class="sct-gfp-bar-row${rate === null ? " is-empty" : ""}" title="${e(`${game[side].short}, ${st.label}: ${text}`)}">` +
        `<span class="sct-gfp-state">${e(st.label)}</span>` +
        `<span class="sct-gfp-bar is-scale"><span class="is-${side}" style="width:${rate === null ? 0 : Math.max(2, rate * 100).toFixed(1)}%"></span></span>` +
        `<span class="sct-gfp-bar-val">${e(text)}</span>` +
        `</li>`
      );
    }).join("");
    return (
      `<div class="sct-gfp-call">` +
      `<p class="sct-gfp-half-name">${chip(game, side)} ${e(game[side].short)}</p>` +
      `<ol class="sct-gfp-call-list">${rows}</ol>` +
      `</div>`
    );
  };
  // The read: each team's pass rate in the state it played most snaps in,
  // and the swing between ahead and behind when it had enough of both.
  const COARSE: ReadonlyArray<[string, (m: number) => boolean]> = [
    ["ahead", (x) => x > 0],
    ["tied", (x) => x === 0],
    ["behind", (x) => x < 0],
  ];
  const sentence = (side: Side): string | null => {
    const own = m.plays.filter((p) => p.side === side);
    if (!own.length) return null;
    const groups = COARSE.map(([word, test]) => {
      const plays = own.filter((p) => test(p.margin));
      return { word, n: plays.length, rate: plays.length ? plays.filter((p) => p.pass).length / plays.length : 0 };
    });
    const main = [...groups].sort((x, y) => y.n - x.n)[0]!;
    const ahead = groups[0]!;
    const behind = groups[2]!;
    const lead =
      main.word === "tied"
        ? `${game[side].short} passed on ${pct(main.rate)} of ${main.n} snaps with the score tied`
        : `${game[side].short} ran ${main.n} of ${own.length} snaps while ${main.word} and passed on ${pct(main.rate)} of them`;
    const swing =
      ahead.n >= 6 && behind.n >= 6 ? ` (${pct(ahead.rate)} ahead, ${pct(behind.rate)} behind)` : "";
    return lead + swing;
  };
  const parts = SIDES.map(sentence).filter((x): x is string => x !== null);
  const read =
    (parts.length ? `${parts.join("; ")}. ` : "") +
    "Pass plays include sacks; scrambles count as runs; kneels and spikes are left out.";
  return section(
    "gf-calling",
    "Play Calling by Score",
    read,
    `<div class="sct-gfp-calls">${card("away")}${card("home")}</div>`,
  );
}

/* ------------------------------------------------------------------ page */

export function renderGameFlowPremium(input: GameFlowPremiumInput): string {
  if (!input.pbp) return "";
  const m = buildModel(input.pbp);
  if (!m) return "";
  const g = input.game;
  return (
    `<div class="sct-gfp" data-gfp>` +
    `<p class="sct-gfp-flag">New Game Flow design, for comparison with the version above</p>` +
    timeline(g, m) +
    fieldPosition(g, m) +
    byHalf(g, m) +
    efficiency(g, m) +
    calling(g, m) +
    `</div>`
  );
}
