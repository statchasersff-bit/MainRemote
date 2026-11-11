/**
 * Fantasy points by player: every fantasy-relevant line from the game, scored
 * for the reader's league format, then what the lines mean.
 *
 *   - the format switch (PPR, Half PPR, Standard): real radios the server
 *     renders; every points figure on the page carries all three values as
 *     data-ppr / data-half / data-std and the client swaps them in place;
 *   - the group tables: quarterbacks, flex, kickers, defense/special teams and
 *     individual defenders, away then home;
 *   - usage and expected points: what each player's opportunities were worth at
 *     the league's average rates, and what he made of them;
 *   - verdicts, stock up / stock down, and the in-game injuries.
 *
 * Scoring is fantasy-points.ts, the one engine these pages use. Nothing here
 * is stored: every figure is computed from the box score and the logs.
 *
 * Pure: FantasySectionInput in, HTML out.
 */

import { escapeHtml } from "../render";
import {
  fantasyPoints,
  idpPoints,
  kickerPoints,
  type DefenseLine,
  type KickerLine,
} from "./fantasy-points";
import type { LoggedGame, PlayerContext } from "./fantasy-data";
import { isKicker, nameKey, type GamePlayer, type GamePlayers } from "./game-players";
import { playerPhoto } from "./player-cell";
import { pairColors, type ScoreboardGame } from "./scoreboard-hero";
import { type AllowedPosition } from "./season-data";

/* ------------------------------------------------------------------ input */

/** The league's average fantasy value of one opportunity, in PPR. */
export interface XfpRates {
  season: number;
  catchRate: number;
  perTargetPpr: number;
  perCarry: number;
  perPassAttempt: number;
}

/** What a person has written down about the game's injuries; see game-notes.ts. */
export interface GameInjuryNotes {
  injuries: Array<{ player: string; team: string; pos: string; text: string }>;
  playedThrough: string[];
  returned: string[];
}

export interface FantasySectionInput {
  game: ScoreboardGame;
  players: GamePlayers;
  /** Log-derived context per box-score id; a player missing here has none. */
  contexts: Record<string, PlayerContext>;
  /** Made field goals by distance, keyed `TEAM:namekey` of the kicker. */
  fieldGoals: Record<string, number[]>;
  /** Each defense's game, keyed by abbr. */
  defense: Record<string, DefenseLine>;
  rates: XfpRates | null;
  playerUrl: (name: string) => string | null;
  /** The start/sit launcher for one player, or null when he has no slug. */
  startSitUrl: (name: string) => string | null;
  /** The start/sit comparison of two players, or null when either has no slug. */
  startSitCompareUrl: (a: string, b: string) => string | null;
  /** Sleeper's rostered and started rates for a player, 0–100; null when unknown. */
  rosterRate: (sleeperId: string) => { owned: number; started: number } | null;
  /** False for a playoff game, whose points most season-long leagues never score. */
  countsInSeasonLong: boolean;
  /** Each side's next game after this one, when the season is still being played. */
  next: Record<string, { label: string; opponent: string } | null> | null;
  injuries: GameInjuryNotes | null;
  links: { redraftCommand: string; projections: string; tradeCalculator: string };
  /**
   * What each of this game's two defenses allows per game by position, with
   * its league rank (1 = the most), from the Fantasy Points Allowed table when
   * that table describes this season; null otherwise. `url` is the FPA page.
   * Feeds the start/sit block's one line per team (mak, 2026-10-10).
   */
  allowed: {
    url: string | null;
    byTeam: Record<string, Record<AllowedPosition, { rank: number; fpa: number }>>;
  } | null;
}

export type Format = "ppr" | "half" | "std";
export type Triple = Record<Format, number>;

/* ------------------------------------------------------------------ atoms */

function triple(stats: GamePlayer["stats"]): Triple {
  return {
    ppr: fantasyPoints(stats, "ppr"),
    half: fantasyPoints(stats, "half"),
    std: fantasyPoints(stats, "standard"),
  };
}

function same(points: number): Triple {
  return { ppr: points, half: points, std: points };
}

function pct(share: number | null): string {
  return share === null ? "-" : `${Math.round(share * 100)}%`;
}

function sum(values: number[]): number {
  return values.reduce((s, v) => s + v, 0);
}

function s(stats: GamePlayer["stats"], key: keyof GamePlayer["stats"]): number {
  const v = stats[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

const DEFENSIVE = new Set(["CB", "S", "FS", "SS", "DB", "LB", "ILB", "OLB", "MLB", "DE", "DT", "NT", "DL", "EDGE"]);
const FLEX = new Set(["RB", "FB", "WR", "TE"]);

type Group = "qb" | "flex" | "k" | "idp" | null;

function groupOf(p: GamePlayer): Group {
  if (isKicker(p)) return p.pos === "P" ? null : "k";
  const st = p.stats;
  if (p.pos === "QB") return "qb";
  if (p.pos && FLEX.has(p.pos)) return "flex";
  if (p.pos && DEFENSIVE.has(p.pos)) return "idp";
  if (s(st, "passAtt") >= 5) return "qb";
  const offense = s(st, "rushAtt") + s(st, "recTgt") + s(st, "rec");
  if (offense > 0) return "flex";
  const defense = s(st, "soloTkl") + s(st, "astTkl") + s(st, "sacks") + s(st, "defInt") + s(st, "passDef");
  return defense > 0 ? "idp" : null;
}

function idpLine(p: GamePlayer): Parameters<typeof idpPoints>[0] {
  const st = p.stats;
  return {
    solo: s(st, "soloTkl"),
    ast: s(st, "astTkl"),
    tfl: s(st, "tfl"),
    sacks: s(st, "sacks"),
    qbHits: s(st, "qbHits"),
    pd: s(st, "passDef"),
    int: s(st, "defInt"),
    fr: s(st, "fumRec"),
    td: s(st, "defTd"),
  };
}

/* --------------------------------------------------------- derived players */

interface Row {
  id: string;
  p: GamePlayer;
  group: Group;
  pts: Triple;
  ctx: PlayerContext | null;
}

function rowsOf(input: FantasySectionInput): Row[] {
  const rows: Row[] = [];
  for (const [id, p] of Object.entries(input.players)) {
    const group = groupOf(p);
    if (!group) continue;
    let pts: Triple;
    if (group === "k") pts = same(kickerPoints(kickerLine(input, p)));
    else if (group === "idp") pts = same(idpPoints(idpLine(p)));
    else pts = triple(p.stats);
    rows.push({ id, p, group, pts, ctx: input.contexts[id] ?? null });
  }
  return rows;
}

function kickerLine(input: FantasySectionInput, p: GamePlayer): KickerLine {
  const made = input.fieldGoals[`${p.team}:${nameKey(p.name)}`] ?? [];
  const fgm = s(p.stats, "fgm");
  // The box score's made count wins over the plays found for him; a made kick
  // the plays did not name is scored at the lowest tier rather than dropped.
  const fgMade = made.length >= fgm ? made.slice(0, fgm || made.length) : [...made, ...Array(fgm - made.length).fill(0)];
  return {
    fgMade,
    fgAtt: Math.max(s(p.stats, "fga"), fgMade.length),
    xpMade: s(p.stats, "xpm"),
    xpAtt: Math.max(s(p.stats, "xpa"), s(p.stats, "xpm")),
  };
}

function isZero(row: Row): boolean {
  if (row.group === "k") return s(row.p.stats, "fga") + s(row.p.stats, "xpa") + s(row.p.stats, "xpm") === 0;
  if (row.group === "idp") return row.pts.ppr === 0 && s(row.p.stats, "astTkl") === 0;
  const st = row.p.stats;
  return (
    s(st, "passAtt") + s(st, "rushAtt") + s(st, "recTgt") + s(st, "rec") + s(st, "fumblesLost") +
      s(st, "twoPtScored") + s(st, "twoPtPassed") ===
    0
  );
}

/* ------------------------------------------------------------ expected pts */

export function perTarget(rates: XfpRates, format: Format): number {
  const weight = format === "ppr" ? 1 : format === "half" ? 0.5 : 0;
  return rates.perTargetPpr - rates.catchRate * (1 - weight);
}

/** Expected fantasy points for one line, at the league's average rates. */
export function expectedPoints(stats: GamePlayer["stats"], rates: XfpRates, format: Format): number {
  const x =
    s(stats, "recTgt") * perTarget(rates, format) +
    s(stats, "rushAtt") * rates.perCarry +
    s(stats, "passAtt") * rates.perPassAttempt;
  return Math.round(x * 10) / 10;
}

function xfp(stats: GamePlayer["stats"], rates: XfpRates): Triple {
  return {
    ppr: expectedPoints(stats, rates, "ppr"),
    half: expectedPoints(stats, rates, "half"),
    std: expectedPoints(stats, rates, "std"),
  };
}

function diff(a: Triple, b: Triple): Triple {
  return { ppr: a.ppr - b.ppr, half: a.half - b.half, std: a.std - b.std };
}

/* ----------------------------------------------------------------- tables */

/* ------------------------------------------------------------------ usage */

interface Usage {
  row: Row;
  x: Triple;
  over: Triple;
  snapShare: number | null;
  carShare: number | null;
  tgtShare: number | null;
}

function teamTotals(rows: Row[], team: string): { carries: number; targets: number } {
  const mine = rows.filter((r) => r.p.team === team && (r.group === "qb" || r.group === "flex"));
  return {
    carries: sum(mine.map((r) => s(r.p.stats, "rushAtt"))),
    targets: sum(mine.map((r) => s(r.p.stats, "recTgt"))),
  };
}

function usageRows(input: FantasySectionInput, rows: Row[]): Usage[] {
  if (!input.rates) return [];
  const rates = input.rates;
  const totals: Record<string, { carries: number; targets: number }> = {
    [input.game.away.abbr]: teamTotals(rows, input.game.away.abbr),
    [input.game.home.abbr]: teamTotals(rows, input.game.home.abbr),
  };
  return rows
    .filter((r) => r.group === "qb" || r.group === "flex")
    .filter((r) => s(r.p.stats, "passAtt") + s(r.p.stats, "rushAtt") + s(r.p.stats, "recTgt") > 0)
    .map((row) => {
      const x = xfp(row.p.stats, rates);
      const t = totals[row.p.team] ?? { carries: 0, targets: 0 };
      const snaps = row.ctx?.snaps ?? null;
      const teamSnaps = row.ctx?.teamSnaps ?? null;
      return {
        row,
        x,
        over: diff(row.pts, x),
        snapShare: snaps !== null && teamSnaps ? snaps / teamSnaps : null,
        carShare: t.carries ? s(row.p.stats, "rushAtt") / t.carries : null,
        tgtShare: t.targets ? s(row.p.stats, "recTgt") / t.targets : null,
      };
    })
    .sort((a, b) => b.x.ppr - a.x.ppr || a.row.p.name.localeCompare(b.row.p.name));
}

/* --------------------------------------------------------------- verdicts */

type Tag = { text: string; kind: "hot" | "unlucky" | "strong" | "warning" };

function tagOf(u: Usage): Tag | null {
  const high = (u.tgtShare ?? 0) >= 0.3 || (u.carShare ?? 0) >= 0.6;
  const over = u.over.ppr;
  const opps = s(u.row.p.stats, "passAtt") + s(u.row.p.stats, "rushAtt") + s(u.row.p.stats, "recTgt");
  const tds = s(u.row.p.stats, "rushTd") + s(u.row.p.stats, "recTd");
  if (over >= 5) return { text: "Ran hot", kind: "hot" };
  if (high && over < 0) return { text: "Volume, no payoff", kind: "warning" };
  if (over <= -5) return { text: "Unlucky", kind: "unlucky" };
  if (high) return { text: "Strong role", kind: "strong" };
  if (tds > 0 && opps <= 6 && u.row.group !== "qb") return { text: "Short-yardage role", kind: "warning" };
  return null;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * What a verdict says (mak, 2026-11-10, from a reviewer's brief): never the
 * box score or the xFP again (the Fantasy Box Score and Actual vs Expected
 * carry those), only what is particular to this player: a workload change,
 * target competition, touchdown reliance, a season high, a quarterback's legs
 * or turnovers, volume that didn't pay. Each signal has a weight; the card
 * prints the two strongest and one takeaway keyed to the strongest, and the
 * weights rank the cards (the first four show, the rest wait behind a button).
 */
/** Verdict cards shown before "Show more verdicts". */
const VERDICTS_SHOWN = 4;

type Lean = "up" | "down" | "sell" | "buy" | "hold" | "flex" | "risk";

interface Signal {
  weight: number;
  text: string;
  lean: Lean;
}

interface Insight {
  score: number;
  signals: Signal[];
  takeaway: string;
}

function lastNameOf(name: string): string {
  const parts = name.replace(/\s+(Jr\.?|Sr\.?|II|III|IV|V)$/i, "").split(/\s+/);
  return parts[parts.length - 1] ?? name;
}

function priorAverage(values: Array<number | null>): number | null {
  const known = values.filter((v): v is number => v !== null && Number.isFinite(v));
  return known.length >= 2 ? sum(known) / known.length : null;
}

function insightOf(input: FantasySectionInput, u: Usage, usage: Usage[]): Insight {
  const p = u.row.p;
  const st = p.stats;
  const last = lastNameOf(p.name);
  const team = p.team === input.game.home.abbr ? input.game.home.short : input.game.away.short;
  const before = u.row.ctx?.before ?? [];
  const qb = u.row.group === "qb";
  const signals: Signal[] = [];
  const add = (weight: number, lean: Lean, text: string): void => {
    signals.push({ weight, lean, text });
  };
  const tds = s(st, "rushTd") + s(st, "recTd");
  const touches = s(st, "rushAtt") + s(st, "recTgt");

  // Workload against the season so far.
  const snapBefore = priorAverage(before.map((g) => g.snapShare));
  if (!qb && u.snapShare !== null && snapBefore !== null) {
    const d = u.snapShare - snapBefore;
    if (d >= 0.12) add(3 + d * 10, "up", `Played ${pct(u.snapShare)} of the snaps against a ${pct(snapBefore)} average before this game.`);
    else if (d <= -0.12) add(3 + -d * 10, "down", `Played ${pct(u.snapShare)} of the snaps, down from a ${pct(snapBefore)} average before this game.`);
  }
  const tgtBefore = priorAverage(before.map((g) => g.targetShare));
  const maxTargets = before.length >= 3 ? Math.max(...before.map((g) => g.targets)) : null;
  if (!qb && u.tgtShare !== null && tgtBefore !== null && Math.abs(u.tgtShare - tgtBefore) >= 0.08) {
    const up = u.tgtShare > tgtBefore;
    const high = up && maxTargets !== null && s(st, "recTgt") > maxTargets ? ", a season high in targets" : "";
    add(2.5 + Math.abs(u.tgtShare - tgtBefore) * 12, up ? "up" : "down", `Took ${pct(u.tgtShare)} of the targets against a ${pct(tgtBefore)} average before this game${high}.`);
  } else if (!qb && maxTargets !== null && s(st, "recTgt") >= 6 && s(st, "recTgt") > maxTargets) {
    add(2.5, "up", `${plural(s(st, "recTgt"), "target")} is a season high.`);
  }
  const carriesBefore = priorAverage(before.map((g) => g.carries));
  if (!qb && p.pos === "RB" && carriesBefore !== null && Math.abs(s(st, "rushAtt") - carriesBefore) >= 5) {
    const up = s(st, "rushAtt") > carriesBefore;
    add(2.5 + Math.abs(s(st, "rushAtt") - carriesBefore) / 4, up ? "up" : "down",
      `${plural(s(st, "rushAtt"), "carry", "carries")} against a ${carriesBefore.toFixed(1)} average before this game.`);
  }

  // Target competition: where the player sits in the team's pecking order.
  if (!qb && s(st, "recTgt") >= 3 && u.tgtShare !== null) {
    const mates = usage
      .filter((o) => o.row.p.team === p.team && o.row.group !== "qb" && o.tgtShare !== null && s(o.row.p.stats, "recTgt") > 0)
      .sort((a, b) => b.tgtShare! - a.tgtShare!);
    const at = mates.indexOf(u);
    if (at === 0 && mates[1] && u.tgtShare - mates[1].tgtShare! >= 0.1) {
      add(2.2, "hold", `The clear first read: the next ${team} target was ${mates[1].row.p.name} at ${pct(mates[1].tgtShare)}.`);
    } else if (at > 0 && mates[0]) {
      const lead = mates[0];
      const place = ["Second", "Third", "Fourth", "Fifth", "Sixth"][at - 1] ?? `No. ${at + 1}`;
      add(1.6 + (at === 1 ? 0.4 : 0), "flex",
        `${place} in the ${team} target order, behind ${lastNameOf(lead.row.p.name)} (${pct(lead.tgtShare)} to ${pct(u.tgtShare)}).`);
    }
  }

  // Touchdown reliance.
  if (!qb && tds > 0) {
    const tdPts = tds * 6;
    const share = u.row.pts.ppr > 0 ? tdPts / u.row.pts.ppr : 0;
    if (touches <= 6) {
      add(3.2, "sell", `Scored on a ${touches}-touch role: a touchdown-or-bust profile.`);
    } else if (share >= 0.5 && u.row.pts.ppr >= 10) {
      add(2.8 + share, "sell", `Touchdowns were ${pct(share)} of the day; without them it was a ${(u.row.pts.ppr - tdPts).toFixed(1)}-point game.`);
    }
    const window = before.slice(-6);
    const tdGames = window.filter((g) => g.touchdowns > 0).length + 1;
    if (window.length >= 5 && tdGames >= Math.ceil((window.length + 1) * 0.6)) {
      add(1.8, "hold", `A touchdown in ${tdGames} of the last ${window.length + 1} games: the scoring role is steady.`);
    }
  }

  // Volume without payoff.
  if (!qb && u.over.ppr <= -4 && ((u.tgtShare ?? 0) >= 0.22 || (u.carShare ?? 0) >= 0.5)) {
    const share = (u.tgtShare ?? 0) >= 0.22 ? `${pct(u.tgtShare)} target share` : `${pct(u.carShare)} carry share`;
    add(3.4, "buy", `The ${share} is the part that carries forward; the production should catch up to it.`);
  }

  // Quarterbacks: legs, touchdown rate, turnovers.
  if (qb) {
    // Real rushing production, not volume alone: 5 carries for 2 yards is no floor.
    if (s(st, "rushYds") >= 25 || s(st, "rushTd") > 0) {
      add(2.4, "hold", `${plural(s(st, "rushAtt"), "carry", "carries")} for ${plural(s(st, "rushYds"), "yard")}${s(st, "rushTd") ? ` and ${plural(s(st, "rushTd"), "rushing touchdown")}` : ""}: the legs add a weekly floor.`);
    }
    const att = s(st, "passAtt");
    if (s(st, "passTd") >= 3 && att > 0 && s(st, "passTd") / att >= 0.1) {
      add(3, "sell", `${plural(s(st, "passTd"), "touchdown pass", "touchdown passes")} on ${att} attempts is a rate no quarterback holds for long.`);
    }
    const lastFour = before.slice(-4);
    const priorInts = sum(lastFour.map((g) => g.passInt));
    if (att > 0 && s(st, "passInt") === 0 && priorInts >= 4 && lastFour.length === 4) {
      add(2, "up", `No interceptions after ${priorInts} in the previous four games.`);
    } else if (s(st, "passInt") >= 2) {
      // Weighted by count, so a 4-interception day outranks the rushing line.
      add(1.6 + 0.6 * s(st, "passInt"), "risk", `${plural(s(st, "passInt"), "interception")} took points off the board.`);
    }
    if (att >= 40) add(1.8, "hold", `${att} pass attempts: a game script that kept the ball in the air.`);
  }

  signals.sort((a, b) => b.weight - a.weight);
  // The takeaway follows the strongest signal, so the second one printed must
  // not argue the other way ("12 carries, down from 17.9" then "the carry
  // share carries forward" then "Bench him").
  const POLARITY: Record<Lean, number> = { up: 1, buy: 1, hold: 1, down: -1, sell: 0, flex: 0, risk: 0 };
  const first = signals[0];
  const second = first ? signals.slice(1).find((x) => POLARITY[x.lean] * POLARITY[first.lean] >= 0) : undefined;
  const top = [first, second].filter((x): x is Signal => Boolean(x));
  const lead = top[0]?.lean ?? null;
  const ints = qb ? s(st, "passInt") : 0;
  const next = input.next?.[p.team] ?? null;
  const when = next ? `in ${next.label} against the ${next.opponent}` : "for the rest of the season";
  const TAKEAWAY: Record<Lean, string> = {
    up: `If the role holds, ${last} is a start ${when}.`,
    down: `Bench ${last} ${when} until the role comes back.`,
    sell: `Sell-high window: don't count on the same touchdowns ${when}.`,
    buy: `Buy-low: keep starting ${last} ${when}.`,
    hold: `Keep starting ${last} ${when}.`,
    flex: `A flex play ${when}, not a locked-in starter.`,
    risk:
      ints >= 3
        ? `Still a starter ${when}, but ${ints} interceptions in one game is a floor to watch.`
        : `Still a starter ${when}; treat the turnovers as noise unless they repeat.`,
  };
  const takeaway = lead && input.countsInSeasonLong ? TAKEAWAY[lead] : "";
  return { score: sum(top.map((x) => x.weight)), signals: top, takeaway };
}

function verdict(insight: Insight): string {
  const text = [...insight.signals.map((x) => x.text), insight.takeaway].filter(Boolean).join(" ");
  return `<p class="sct-fp-verdict"><b>Verdict:</b> ${escapeHtml(text)}</p>`;
}

/* ------------------------------------------------------------------ trend */

/** The most notable one or two things the log says about this game. */
export function trendNotes(u: Usage): string[] {
  const before = u.row.ctx?.before ?? [];
  if (before.length === 0) return [];
  const st = u.row.p.stats;
  const now = u.row.pts.ppr;
  const notes: string[] = [];

  const lastFour = before.slice(-4);
  const priorInts = sum(lastFour.map((g) => g.passInt));
  if (u.row.group === "qb" && s(st, "passAtt") > 0 && s(st, "passInt") === 0 && priorInts >= 4 && lastFour.length === 4) {
    notes.push(`No interceptions after ${priorInts} in the previous four games.`);
  }
  const maxTargets = Math.max(0, ...before.map((g) => g.targets));
  if (s(st, "recTgt") >= 6 && s(st, "recTgt") > maxTargets) notes.push(`Season high in targets (${s(st, "recTgt")}).`);
  const maxCarries = Math.max(0, ...before.map((g) => g.carries));
  if (s(st, "rushAtt") >= 10 && s(st, "rushAtt") > maxCarries && u.row.group !== "qb") {
    notes.push(`Season high in carries (${s(st, "rushAtt")}).`);
  }
  const higher = [...before].reverse().find((g) => g.ppr >= now);
  if (!higher && before.length >= 3) notes.push("Best fantasy game of the season.");
  else if (higher && before.slice(-3).every((g) => g.ppr < now)) notes.push(`Best score since ${higher.label.replace("W", "Week ")}.`);
  const lower = [...before].reverse().find((g) => g.ppr <= now);
  if (!lower && before.length >= 3) notes.push("Lowest-scoring game of the season.");
  else if (lower && before.slice(-3).every((g) => g.ppr > now)) {
    notes.push(`Fewest points since ${lower.label.replace("W", "Week ")}.`);
  }
  const window = [...before.slice(-7), null];
  const tdGames = window.filter((g) => (g ? g.touchdowns > 0 : s(st, "rushTd") + s(st, "recTd") > 0)).length;
  if (u.row.group !== "qb" && window.length >= 6 && tdGames >= Math.ceil(window.length * 0.6)) {
    notes.push(`A touchdown in ${tdGames} of the last ${window.length} games.`);
  }
  return notes.slice(0, 2);
}

function sparkline(games: LoggedGame[], now: number): string {
  const values = [...games.map((g) => g.ppr), now];
  const max = Math.max(1, ...values) * 1.1;
  const w = 168;
  const h = 44;
  const pad = 5;
  const x = (i: number): number => pad + (i * (w - pad * 2)) / Math.max(1, values.length - 1);
  const y = (v: number): number => h - pad - (Math.max(0, v) / max) * (h - pad * 2);
  const path = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return (
    `<svg class="sct-fp-spark" viewBox="0 0 ${w} ${h}" aria-hidden="true" focusable="false">` +
    `<path d="${path}" fill="none" stroke="#9aa6b6" stroke-width="1.5"/>` +
    values
      .map((v, i) =>
        i === values.length - 1
          ? `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" fill="#ffa300" stroke="#13233a" stroke-width="1.5"/>`
          : `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.5" fill="#5b6778"/>`,
      )
      .join("") +
    `</svg>`
  );
}

function trendBlock(u: Usage, gameLabel: string): string {
  const before = (u.row.ctx?.before ?? []).slice(-5);
  // The verdict above already says these (insightOf); the chart keeps the
  // season-best and season-worst notes only.
  const notes = trendNotes(u).filter((n) => !/^(Season high|No interceptions|A touchdown in)/.test(n));
  if (before.length < 3) {
    return notes.length ? `<div class="sct-fp-trend"><p class="sct-fp-trend-note">Trend: ${escapeHtml(notes.join(" "))}</p></div>` : "";
  }
  const now = u.row.pts.ppr;
  const aria =
    `PPR points, last ${before.length} games then this one: ` +
    before.map((g) => `${g.label} ${g.ppr.toFixed(1)}`).join(", ") +
    `, ${gameLabel} ${now.toFixed(1)}`;
  return (
    `<div class="sct-fp-trend" role="img" aria-label="${escapeHtml(aria)}">` +
    `<p class="sct-fp-trend-head" aria-hidden="true">Last ${before.length} games + this one (PPR): ` +
    before.map((g) => g.ppr.toFixed(1)).join(", ") +
    `, <b>${now.toFixed(1)}</b></p>` +
    sparkline(before, now) +
    `<p class="sct-fp-trend-weeks" aria-hidden="true">${[...before.map((g) => g.label), gameLabel]
      .map((l) => `<span>${escapeHtml(l)}</span>`)
      .join("")}</p>` +
    (notes.length ? `<p class="sct-fp-trend-note">${escapeHtml(notes.join(" "))}</p>` : "") +
    `</div>`
  );
}

/* ------------------------------------------------------------------ stock */

interface StockItem {
  up: boolean;
  name: string;
  text: string;
}

function average(values: Array<number | null>): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? sum(known) / known.length : null;
}

export function stockItems(usage: Usage[], team: string): StockItem[] {
  const mine = usage.filter((u) => u.row.p.team === team && u.row.group === "flex");
  const items: StockItem[] = [];
  const add = (u: Usage, up: boolean, text: string): void => {
    if (items.some((i) => i.name === u.row.p.name)) return;
    items.push({ up, name: u.row.p.name, text });
  };
  const priorSnap = (u: Usage): number | null => average((u.row.ctx?.before ?? []).map((g) => g.snapShare));
  const priorTgt = (u: Usage): number | null => average((u.row.ctx?.before ?? []).map((g) => g.targetShare));

  // Backfield leadership: who had the most snaps here, against who had them before.
  const backs = mine.filter((u) => u.row.p.pos === "RB" && u.snapShare !== null);
  if (backs.length >= 2) {
    const nowLead = [...backs].sort((a, b) => b.snapShare! - a.snapShare!)[0]!;
    const priorLead = [...backs].sort((a, b) => (priorSnap(b) ?? 0) - (priorSnap(a) ?? 0))[0]!;
    if (nowLead !== priorLead && priorSnap(priorLead) !== null) {
      add(nowLead, true, `led the backfield with ${pct(nowLead.snapShare)} of the snaps after trailing ${priorLead.row.p.name} before this game.`);
      add(priorLead, false, `lost the backfield lead: ${pct(priorLead.snapShare)} of the snaps to ${nowLead.row.p.name}'s ${pct(nowLead.snapShare)}.`);
    }
  }
  for (const u of mine) {
    const before = priorSnap(u);
    if (u.snapShare !== null && before !== null) {
      const change = u.snapShare - before;
      if (change >= 0.15) add(u, true, `played ${pct(u.snapShare)} of the snaps, up from a ${pct(before)} season average.`);
      else if (change <= -0.15) add(u, false, `played ${pct(u.snapShare)} of the snaps, down from a ${pct(before)} season average.`);
    }
    const tBefore = priorTgt(u);
    if (u.tgtShare !== null && tBefore !== null && u.tgtShare >= 0.25 && tBefore < 0.15) {
      add(u, true, `took ${pct(u.tgtShare)} of the targets after averaging ${pct(tBefore)} before this game.`);
    }
  }
  const ups = items.filter((i) => i.up);
  const downs = items.filter((i) => !i.up);
  return [...ups, ...downs].slice(0, 3);
}

/* ---------------------------------------------------------------- section */

/**
 * The verdict cards' players: both quarterbacks, each side's top two by
 * expected points, then anyone far from expectation or with a role change.
 * Eight at most.
 */
function verdictPicks(
  input: FantasySectionInput,
  usage: Usage[],
): { picked: Usage[]; stock: Record<string, StockItem[]> } {
  const { game } = input;
  const picked: Usage[] = [];
  const pick = (u: Usage | undefined): void => {
    if (u && !picked.includes(u) && picked.length < 8) picked.push(u);
  };
  for (const side of ["away", "home"] as const) {
    pick(
      usage
        .filter((u) => u.row.p.team === game[side].abbr && u.row.group === "qb")
        .sort((a, b) => s(b.row.p.stats, "passAtt") - s(a.row.p.stats, "passAtt"))[0],
    );
  }
  for (const side of ["away", "home"] as const) {
    usage.filter((u) => u.row.p.team === game[side].abbr && u.row.group !== "qb").slice(0, 2).forEach(pick);
  }
  usage.filter((u) => Math.abs(u.over.ppr) >= 5).forEach(pick);
  const stock: Record<string, StockItem[]> = {
    [game.away.abbr]: stockItems(usage, game.away.abbr),
    [game.home.abbr]: stockItems(usage, game.home.abbr),
  };
  for (const items of Object.values(stock)) for (const item of items) pick(usage.find((u) => u.row.p.name === item.name));
  return { picked, stock };
}

/**
 * Fantasy verdicts, stock up / stock down and in-game injuries: the parts of
 * the fantasy section that are about players rather than a table of points.
 * `heading` is the tag each block's title takes - h3 under the section's own
 * h2, or h2 where the blocks stand on their own in the matchup page's Fantasy
 * tab.
 */
function fantasyNotes(
  input: FantasySectionInput,
  rows: Row[],
  heading: "h2" | "h3",
): { usage: Usage[]; verdicts: string; stockBlock: string; injuries: string } {
  const { game } = input;
  const colors = pairColors(game.away.abbr, game.home.abbr);
  const round = game.gameType === "playoff" ? game.roundLabel.replace(/^(AFC|NFC)\s+/, "") : game.roundLabel;
  const cls = heading === "h2" ? "sct-rb-h2" : "sct-rb-h3";
  const usage = usageRows(input, rows);
  const gameLabel = game.gameType === "playoff" ? shortRound(round) : game.roundLabel.replace(/^Week\s+/, "W");

  const { picked, stock } = verdictPicks(input, usage);

  const nameLink = (name: string): string => {
    const href = input.playerUrl(name);
    return href
      ? `<a class="sct-player-link" href="${escapeHtml(href)}" target="_top">${escapeHtml(name)}</a>`
      : escapeHtml(name);
  };

  // Ranked by how much there is to say; a player with nothing particular to
  // say gets no card. The first VERDICTS_SHOWN show, the rest wait behind a
  // button (wireFantasyTabMore in client/team.ts).
  const ranked = picked
    .map((u) => ({ u, insight: insightOf(input, u, usage) }))
    .filter((c) => c.insight.signals.length > 0)
    .sort((a, b) => b.insight.score - a.insight.score);
  const verdicts = ranked.length
    ? `<${heading} class="${cls}" id="verdicts">Fantasy verdicts</${heading}>` +
      `<div class="sct-fz-list sct-fp-vlist" data-fz-list data-fz-shown="${VERDICTS_SHOWN}">` +
      `<div class="sct-fp-cards">` +
      ranked
        .map(({ u, insight }, at) => {
          const p = u.row.p;
          const side = p.team === game.home.abbr ? "home" : "away";
          const tag = tagOf(u);
          const ss = u.row.ctx?.active ? input.startSitUrl(p.name) : null;
          // The face beside the name and meta line (mak, 2026-11-02).
          const face = u.row.ctx ? playerPhoto(u.row.ctx.sleeperId, "sct-fp-card-face", 44) : "";
          return (
            `<article class="sct-fp-card${face ? " has-face" : ""}${at >= VERDICTS_SHOWN ? " is-extra" : ""}" data-fz-row style="--rb-team:${colors[side].ink}">` +
            `<div class="sct-fp-card-head">` +
            face +
            `<div class="sct-fp-card-text">` +
            `<h4 class="sct-fp-card-name">${nameLink(p.name)}` +
            (tag ? ` <span class="sct-fp-tag is-${tag.kind}">${escapeHtml(tag.text)}</span>` : "") +
            `</h4>` +
            // Team and position only: the points and xFP live in the box
            // score and Actual vs Expected (mak, 2026-11-10).
            `<p class="sct-fp-meta">${escapeHtml(`${p.team} · ${p.pos ?? "-"}`)}</p>` +
            `</div></div>` +
            verdict(insight) +
            trendBlock(u, gameLabel) +
            (ss
              ? `<a class="sct-fp-ss" href="${escapeHtml(ss)}" data-cta="verdict-startsit">${escapeHtml(`Start/Sit: ${p.name} →`)}</a>`
              : "") +
            `</article>`
          );
        })
        .join("") +
      `</div>` +
      (ranked.length > VERDICTS_SHOWN
        ? `<button type="button" class="sct-mu-ps-toggle sct-fz-more" data-fz-more hidden aria-expanded="false" ` +
          `data-more="Show ${ranked.length - VERDICTS_SHOWN} more verdicts" data-less="Show fewer verdicts">Show ${ranked.length - VERDICTS_SHOWN} more verdicts</button>`
        : "") +
      `</div>`
    : "";

  const stockBlock = Object.values(stock).some((i) => i.length)
    ? `<${heading} class="${cls}" id="stock">Stock up, stock down</${heading}>` +
      `<div class="sct-fp-stock">` +
      (["away", "home"] as const)
        .map((side) => {
          const items = stock[game[side].abbr] ?? [];
          if (items.length === 0) return "";
          return (
            `<div class="sct-fp-stock-card" style="--rb-team:${colors[side].ink}">` +
            `<h4 class="sct-fp-team" style="color:${colors[side].ink}">${escapeHtml(game[side].name)}</h4><ul>` +
            items
              .map(
                (i) =>
                  `<li class="${i.up ? "is-up" : "is-down"}"><span aria-hidden="true">${i.up ? "▲" : "▼"}</span>` +
                  `<span class="sct-rb-sr">${i.up ? "Stock up:" : "Stock down:"}</span> ` +
                  `${nameLink(i.name)} ${escapeHtml(i.text)}</li>`,
              )
              .join("") +
            `</ul></div>`
          );
        })
        .join("") +
      `</div>`
    : "";

  // Only for a game somebody has written notes for (game-notes.ts): mak had
  // the "No in-game injuries reported." block taken off every other game.
  const inj = input.injuries;
  const injuries = inj
    ? `<${heading} class="${cls}" id="injuries">In-game injuries</${heading}>` +
      (inj.injuries.length
        ? `<ul class="sct-fp-injuries">` +
          inj.injuries
            .map((i) => {
              const side = i.team === game.home.abbr ? "home" : "away";
              return (
                `<li><span class="sct-ss-chip" style="--ss-fill:${colors[side].fill}">${escapeHtml(i.team)}</span> ` +
                `${nameLink(i.player)}, ${escapeHtml(i.pos)}, ${escapeHtml(i.text)}.</li>`
              );
            })
            .join("") +
          `</ul>`
        : `<p>No in-game injuries reported.</p>`) +
      (inj.playedThrough.length || inj.returned.length
        ? `<p class="sct-rb-note">` +
          [
            inj.playedThrough.length ? `Played through injuries: ${inj.playedThrough.join("; ")}.` : "",
            inj.returned.length ? `Returned this game: ${inj.returned.join("; ")}.` : "",
          ]
            .filter(Boolean)
            .map(escapeHtml)
            .join(" ") +
          `</p>`
        : "")
    : "";

  return { usage, verdicts, stockBlock, injuries };
}

/**
 * The verdicts, start/sit decisions, the trade-calculator banner, stock up /
 * stock down and in-game injuries, as H2 sections for the recap's Fantasy
 * tab (fantasy-tab.ts). They moved there from the Stats & Fantasy tab when
 * mak deleted that tab (2026-11-09); the ids (#verdicts, #decisions, #stock,
 * #injuries) are unchanged.
 */
export function renderFantasyTakeaways(input: FantasySectionInput): string {
  const rows = rowsOf(input).filter((r) => !isZero(r));
  if (rows.length === 0) return "";
  const { usage, verdicts, stockBlock, injuries } = fantasyNotes(input, rows, "h2");
  const wrap = (html: string, id: string): string =>
    html ? `<section class="sct-rb-section sct-fp sct-fp-moved" aria-labelledby="${id}" data-fp-notes>${html}</section>` : "";
  const decisions = renderDecisions(input, usage, "h2");
  const trade = verdicts
    ? banner(
        "Did this game change a player's trade value?",
        "Compare players and evaluate a deal using current fantasy values and your league settings.",
        input.links.tradeCalculator,
        "Fantasy Football Trade Calculator",
        "fantasy-trade-banner",
      )
    : "";
  // The verdict cards stand bare, no section box (mak, 2026-11-09); the
  // "Fantasy verdicts" title bar stays above them (mak, 2026-11-10). The h2
  // carries the #verdicts anchor; data-fp-notes drives the scoring swap.
  const bare = verdicts
    ? `<div class="sct-fp sct-fp-moved sct-fp-bare" data-fp-notes>${verdicts}</div>`
    : "";
  return bare + wrap(decisions + trade, "decisions") + wrap(stockBlock, "stock") + wrap(injuries, "injuries");
}

/** The navy call-to-action banner these sections close a block with. */
function banner(title: string, sub: string, href: string, action: string, cta: string): string {
  return (
    `<aside class="sct-mu-ps-cta sct-fp-cta" aria-label="${escapeHtml(action)}">` +
    `<div class="sct-mu-ps-cta-text">` +
    `<p class="sct-mu-ps-cta-title">${escapeHtml(title)}</p>` +
    `<p class="sct-mu-ps-cta-sub">${escapeHtml(sub)}</p>` +
    `</div>` +
    `<a class="sct-mu-ps-cta-button" href="${escapeHtml(href)}" data-cta="${cta}">${escapeHtml(action)} →</a>` +
    `</aside>`
  );
}

/** The positions a start/sit comparison is offered for. */
const DECISION_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);
/** Below this many expected PPR points in the game, a player had no role to judge. */
const DECISION_MIN_XFP = 6;
/** Rostered in fewer leagues than this, few readers have the decision. */
const DECISION_MIN_OWNED = 50;
/** Started in this many leagues or more, he is a must-start: nothing to decide. */
const DECISION_MUST_START = 97;
/** Start rates further apart than this are not a coin flip. */
const DECISION_MAX_GAP = 30;

/**
 * Start/sit decisions: at most three pairs of same-position players from this
 * game that fantasy managers really do choose between, each linked to its
 * comparison page. A pair is a decision when both are widely rostered, neither
 * is a must-start, and leagues start them at similar rates (Sleeper's rates,
 * the same reading the player pages print) - this game's workload alone put
 * Ja'Marr Chase against Tee Higgins. Never every combination, and no player
 * in two pairs. Nothing for a playoff game or once the season is over: there
 * is no next week to decide.
 */
function renderDecisions(input: FantasySectionInput, usage: Usage[], heading: "h2" | "h3" = "h3"): string {
  if (!input.countsInSeasonLong || !input.next) return "";
  const pool = usage
    .map((u) => ({ u, rate: u.row.ctx ? input.rosterRate(u.row.ctx.sleeperId) : null }))
    .filter(
      (c): c is { u: Usage; rate: { owned: number; started: number } } =>
        !!c.u.row.ctx?.active &&
        !!c.u.row.p.pos &&
        DECISION_POSITIONS.has(c.u.row.p.pos) &&
        c.u.x.ppr >= DECISION_MIN_XFP &&
        c.rate !== null &&
        c.rate.owned >= DECISION_MIN_OWNED &&
        c.rate.started < DECISION_MUST_START,
    );
  const pairs: Array<{ a: Usage; b: Usage; weight: number; href: string }> = [];
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      const a = pool[i]!;
      const b = pool[j]!;
      if (a.u.row.p.pos !== b.u.row.p.pos) continue;
      if (Math.abs(a.rate.started - b.rate.started) > DECISION_MAX_GAP) continue;
      const href = input.startSitCompareUrl(a.u.row.p.name, b.u.row.p.name);
      if (href) pairs.push({ a: a.u, b: b.u, weight: a.rate.started + b.rate.started, href });
    }
  }
  // The pairs the most lineups hold first.
  pairs.sort((x, y) => y.weight - x.weight);
  const used = new Set<Usage>();
  const chosen = pairs.filter((p) => {
    if (used.size >= 6 || used.has(p.a) || used.has(p.b)) return false;
    used.add(p.a);
    used.add(p.b);
    return true;
  });
  if (chosen.length === 0) return "";
  const nextLabel = (u: Usage): string | null => input.next?.[u.row.p.team]?.label ?? null;
  return (
    `<${heading} class="sct-rb-${heading}" id="decisions">Start/Sit decisions</${heading}>` +
    `<ul class="sct-fp-decisions">` +
    chosen
      .map(({ a, b, href }) => {
        // Name the week only when both players' next game is the same one.
        const week = nextLabel(a) && nextLabel(a) === nextLabel(b) ? `${nextLabel(a)} ` : "";
        return (
          `<li><a class="sct-fp-decision" href="${escapeHtml(href)}" data-cta="fantasy-compare">` +
          `<span class="sct-fp-decision-q">${escapeHtml(`${a.row.p.name} or ${b.row.p.name}?`)}</span>` +
          `<span class="sct-fp-decision-go">${escapeHtml(`Compare their ${week}outlook →`)}</span></a></li>`
        );
      })
      .join("") +
    `</ul>`
  );
}

function shortRound(round: string): string {
  const map: Record<string, string> = {
    "Wild Card": "WC",
    "Divisional Round": "DIV",
    "Conference Championship": "CONF",
    "Super Bowl": "SB",
  };
  return map[round] ?? round;
}

/** The scored lines the rest of the page reads: who scored most in PPR, for the FAQ and the share text. */
/**
 * The expected-points facts the page's FAQ quotes: the biggest over- and
 * underperformer and the heaviest expected workload (PPR, the same picks the
 * Fantasy Points vs Expected cards make), and each player's target and carry
 * share.
 */
export function usageFacts(input: FantasySectionInput): {
  over: { name: string; team: string; ppr: number; xfp: number } | null;
  under: { name: string; team: string; ppr: number; xfp: number } | null;
  volume: { name: string; team: string; ppr: number; xfp: number } | null;
  shares: Map<string, { target: number | null; carry: number | null }>;
} {
  const rows = rowsOf(input).filter((r) => !isZero(r));
  const usage = usageRows(input, rows);
  const shares = new Map(usage.map((u) => [u.row.p.name, { target: u.tgtShare, carry: u.carShare }]));
  if (usage.length === 0) return { over: null, under: null, volume: null, shares };
  const r1 = (n: number): number => Math.round(n * 10) / 10;
  const pick = (u: Usage) => ({ name: u.row.p.name, team: u.row.p.team, ppr: u.row.pts.ppr, xfp: u.x.ppr });
  const top = [...usage].sort((a, b) => r1(b.over.ppr) - r1(a.over.ppr) || b.x.ppr - a.x.ppr)[0]!;
  const bottom = [...usage].sort((a, b) => r1(a.over.ppr) - r1(b.over.ppr) || b.x.ppr - a.x.ppr)[0]!;
  const volume = [...usage].sort((a, b) => b.x.ppr - a.x.ppr)[0]!;
  return {
    over: top.over.ppr > 0.05 ? pick(top) : null,
    under: bottom.over.ppr < -0.05 && bottom !== top ? pick(bottom) : null,
    volume: pick(volume),
    shares,
  };
}

export function topScorers(input: Pick<FantasySectionInput, "players">): Array<{ name: string; ppr: number; player: GamePlayer }> {
  return Object.values(input.players)
    .filter((p) => {
      const g = groupOf(p);
      return g === "qb" || g === "flex";
    })
    .map((p) => ({ name: p.name, ppr: fantasyPoints(p.stats, "ppr"), player: p }))
    .sort((a, b) => b.ppr - a.ppr || a.name.localeCompare(b.name));
}

/* -------------------------------------------------------- fantasy matchups */

/* ------------------------------------------------- the Fantasy tab's lines */

/** One QB/RB/WR/TE line, scored and judged against expectation, for the Fantasy tab (fantasy-tab.ts). */
export interface FantasyLine {
  name: string;
  team: string;
  pos: string | null;
  qb: boolean;
  stats: GamePlayer["stats"];
  pts: Triple;
  /** Expected points at the league's rates; null when the season is too thin to have rates. */
  x: Triple | null;
  over: Triple | null;
  snapShare: number | null;
  tgtShare: number | null;
  carShare: number | null;
  ctx: PlayerContext | null;
}

/**
 * Every offensive line the Fantasy tab prints, from the same rows, scoring and
 * xFP pass the section above uses (usageRows): one model, so the standouts,
 * the box score, the usage tables and the xFP chart can never disagree.
 */
export function fantasyLines(input: FantasySectionInput): FantasyLine[] {
  const rows = rowsOf(input).filter((r) => !isZero(r) && (r.group === "qb" || r.group === "flex"));
  const usage = new Map(usageRows(input, rows).map((u) => [u.row.id, u]));
  const totals: Record<string, { carries: number; targets: number }> = {
    [input.game.away.abbr]: teamTotals(rows, input.game.away.abbr),
    [input.game.home.abbr]: teamTotals(rows, input.game.home.abbr),
  };
  return rows
    .map((row) => {
      const u = usage.get(row.id) ?? null;
      const t = totals[row.p.team] ?? { carries: 0, targets: 0 };
      const snaps = row.ctx?.snaps ?? null;
      const teamSnaps = row.ctx?.teamSnaps ?? null;
      return {
        name: row.p.name,
        team: row.p.team,
        pos: row.p.pos,
        qb: row.group === "qb",
        stats: row.p.stats,
        pts: row.pts,
        x: u?.x ?? null,
        over: u?.over ?? null,
        snapShare: snaps !== null && teamSnaps ? snaps / teamSnaps : null,
        tgtShare: t.targets ? s(row.p.stats, "recTgt") / t.targets : null,
        carShare: t.carries ? s(row.p.stats, "rushAtt") / t.carries : null,
        ctx: row.ctx,
      };
    })
    .sort((a, b) => b.pts.ppr - a.pts.ppr || a.name.localeCompare(b.name));
}
