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
import { pairColors, type ScoreboardGame } from "./scoreboard-hero";
import { ALLOWED_POSITIONS, type AllowedPosition, type PointsAllowed } from "./season-data";

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

type Format = "ppr" | "half" | "std";
const FORMATS: Format[] = ["ppr", "half", "std"];
type Triple = Record<Format, number>;

const MINUS = "−";

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

function dataAttrs(t: Triple, format: (n: number) => string = (n) => n.toFixed(1)): string {
  return FORMATS.map((f) => ` data-${f}="${escapeHtml(format(t[f]))}"`).join("");
}

function signed(n: number): string {
  const r = Math.round(n * 10) / 10;
  if (r === 0) return "0.0";
  return `${r > 0 ? "+" : MINUS}${Math.abs(r).toFixed(1)}`;
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

const HEADS: Record<string, string> = {
  PTS: "Fantasy points",
  "CMP/ATT": "Completions / attempts",
  TD: "Touchdowns",
  INT: "Interceptions",
  ATT: "Attempts",
  YDS: "Yards",
  POS: "Position",
  TGT: "Targets",
  REC: "Receptions",
  FG: "Field goals made / attempted",
  XP: "Extra points made / attempted",
  FR: "Fumble recoveries",
  TFL: "Tackles for loss",
  PD: "Passes defended",
  FF: "Forced fumbles",
  Ast: "Assisted tackles",
};

function head(label: string): string {
  const last = label.split(" ").pop()!;
  const title = HEADS[label] ?? HEADS[last];
  const text = escapeHtml(label);
  return `<th scope="col">${title ? `<abbr title="${escapeHtml(title)}">${text}</abbr>` : text}</th>`;
}

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

function diffCell(t: Triple): string {
  const cls = t.ppr > 0.05 ? " is-pos" : t.ppr < -0.05 ? " is-neg" : "";
  return `<td class="sct-fp-diff${cls}"${dataAttrs(t, signed)}>${signed(t.ppr)}</td>`;
}

/** The usage a row is read by: pass attempts for a quarterback, otherwise the bigger share. */
function usageLabel(u: Usage): string {
  const p = u.row.p;
  if (u.row.group === "qb" || (p.pos ?? "").toUpperCase() === "QB") return `${s(p.stats, "passAtt")} att`;
  const car = u.carShare ?? -1;
  const tgt = u.tgtShare ?? -1;
  if (car < 0 && tgt < 0) return "-";
  return car > tgt ? `${pct(u.carShare)} car` : `${pct(u.tgtShare)} tgt`;
}

/**
 * Fantasy points against expected (mak, 2026-09-30): what mattered first -
 * the biggest over- and underperformer and the heaviest expected workload -
 * then a table led by PTS, xFP and the gap between them, with the full usage
 * columns one click down. Every figure carries all three scorings for the
 * section's switch.
 */
function renderUsage(input: FantasySectionInput, usage: Usage[], rows: Row[], toggle = ""): string {
  if (usage.length === 0 || !input.rates) return "";
  const hasSnaps = usage.some((u) => u.snapShare !== null);
  const nameOf = (u: Usage): string => {
    const href = input.playerUrl(u.row.p.name);
    return href
      ? `<a class="sct-player-link" href="${escapeHtml(href)}" target="_top">${escapeHtml(u.row.p.name)}</a>`
      : escapeHtml(u.row.p.name);
  };

  // What mattered: named by PPR, figures in every scoring.
  // Ties at one decimal go to the bigger workload: the more expected, the more
  // it matters that it was beaten or missed.
  const r1 = (n: number): number => Math.round(n * 10) / 10;
  const top = [...usage].sort((a, b) => r1(b.over.ppr) - r1(a.over.ppr) || b.x.ppr - a.x.ppr)[0]!;
  const bottom = [...usage].sort((a, b) => r1(a.over.ppr) - r1(b.over.ppr) || b.x.ppr - a.x.ppr)[0]!;
  const volume = [...usage].sort((a, b) => b.x.ppr - a.x.ppr)[0]!;
  const num = (t: Triple): string => `<span${dataAttrs(t)}>${t.ppr.toFixed(1)}</span>`;
  const gap = (t: Triple): string => {
    const cls = t.ppr > 0.05 ? " is-pos" : t.ppr < -0.05 ? " is-neg" : "";
    return `<span class="sct-fp-diff${cls}"${dataAttrs(t, signed)}>${signed(t.ppr)}</span>`;
  };
  const card = (label: string, value: string, u: Usage, detail: string): string =>
    `<li class="sct-fp-take">` +
    `<span class="sct-fp-take-label">${escapeHtml(label)}</span>` +
    `<span class="sct-fp-take-value">${value}</span>` +
    `<span class="sct-fp-take-name">${nameOf(u)}</span>` +
    `<span class="sct-fp-take-detail">${detail}</span>` +
    `</li>`;
  const cards = [
    top.over.ppr > 0.05
      ? card("Biggest overperformer", gap(top.over), top, `${num(top.row.pts)} PTS vs ${num(top.x)} xFP`)
      : "",
    bottom.over.ppr < -0.05 && bottom !== top
      ? card("Biggest underperformer", gap(bottom.over), bottom, `${num(bottom.row.pts)} PTS vs ${num(bottom.x)} xFP`)
      : "",
    card("Highest expected volume", `${num(volume.x)} <small>xFP</small>`, volume, `${num(volume.row.pts)} PTS scored`),
  ].join("");

  // The detail columns: in the HTML, hidden once the bundle has wired the button.
  const d = (html: string): string => html.replace(/^<(td|th)/, '<$1 data-fp-detail-col');
  const body = usage
    .map((u) => {
      const p = u.row.p;
      return (
        `<tr>` +
        `<th scope="row" class="sct-fp-player">${nameOf(u)}<span class="sct-fp-sub">${escapeHtml(`${p.team} · ${p.pos ?? "-"}`)}</span></th>` +
        `<td class="sct-fp-pts"${dataAttrs(u.row.pts)}>${u.row.pts.ppr.toFixed(1)}</td>` +
        `<td class="sct-fp-x"${dataAttrs(u.x)}>${u.x.ppr.toFixed(1)}</td>` +
        diffCell(u.over) +
        `<td>${pct(u.snapShare)}</td>` +
        `<td class="sct-fp-use">${escapeHtml(usageLabel(u))}</td>` +
        // Routes: no feed this site reads carries them.
        d(`<td>-</td>`) +
        d(`<td>${s(p.stats, "passAtt")}</td>`) +
        d(`<td>${s(p.stats, "rushAtt")}</td>`) +
        d(`<td>${pct(u.carShare)}</td>`) +
        d(`<td>${s(p.stats, "recTgt")}</td>`) +
        d(`<td>${pct(u.tgtShare)}</td>`) +
        `</tr>`
      );
    })
    .join("");
  const { game } = input;
  const ta = teamTotals(rows, game.away.abbr);
  const th = teamTotals(rows, game.home.abbr);
  const rates = input.rates;
  const col = (label: string, title: string, detail = false): string =>
    `<th scope="col"${detail ? " data-fp-detail-col" : ""}><abbr title="${escapeHtml(title)}">${escapeHtml(label)}</abbr></th>`;
  return (
    `<div class="sct-fp-usage">` +
    // The section's title, with the scoring switch on its row (mak, 2026-09-30).
    `<div class="sct-fp-head"><h2 class="sct-rb-h2" id="usage">Fantasy Points vs Expected</h2>${toggle}</div>` +
    `<p class="sct-rb-sub">Expected points (xFP) are what a player's pass attempts, carries and targets are worth ` +
    `at the league's average rates; the difference is what the player made of them.</p>` +
    `<ul class="sct-fp-takes">${cards}</ul>` +
    `<div class="sct-fp-wrap"><table class="sct-fp-table is-usage">` +
    `<caption class="sct-rb-sr">Usage and expected fantasy points</caption>` +
    `<thead><tr><th scope="col">Player</th>${head("PTS")}` +
    col("xFP", "Expected fantasy points") +
    col("vs xFP", "Points over or under expected") +
    col("Snap%", "Share of the team's offensive snaps") +
    col("Usage", "The player's main workload: pass attempts, carry share or target share") +
    col("Rte%", "Routes run per team dropback", true) +
    col("Pass att", "Pass attempts", true) +
    col("Car", "Carries", true) +
    col("Car%", "Share of the team's carries", true) +
    col("Tgt", "Targets", true) +
    col("Tgt%", "Share of the team's targets", true) +
    `</tr></thead><tbody>${body}</tbody></table></div>` +
    `<button type="button" class="sct-fp-more" data-fp-detail hidden aria-expanded="false" ` +
    `data-more="Show detailed usage ▾" data-less="Hide detailed usage ▴">Show detailed usage ▾</button>` +
    `<p class="sct-rb-note">${escapeHtml(
      `Team totals: ${game.away.short} ${ta.targets} targets and ${ta.carries} carries; ` +
        `${game.home.short} ${th.targets} targets and ${th.carries} carries. ` +
        `Shares are from the box score. ` +
        (hasSnaps
          ? "Snap counts are from the weekly player logs, and include plays wiped out by penalties. "
          : "Snap counts aren't available for this game. ") +
        `Route counts, air yards and red-zone touches appear when the tracking feed is connected. ` +
        `League-average rates from the ${rates.season} season: ${perTarget(rates, "ppr").toFixed(2)} PPR points per target ` +
        `(${Math.round(rates.catchRate * 100)}% catch rate), ${rates.perCarry.toFixed(2)} per carry and ` +
        `${rates.perPassAttempt.toFixed(2)} per pass attempt. They don't adjust for field position or target depth.`,
    )}</p>` +
    `</div>`
  );
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

function happened(u: Usage): string {
  const st = u.row.p.stats;
  const parts: string[] = [];
  if (s(st, "passAtt") > 0) {
    parts.push(
      `${s(st, "passCmp")} of ${s(st, "passAtt")} passing for ${plural(s(st, "passYds"), "yard")}` +
        (s(st, "passTd") ? `, ${plural(s(st, "passTd"), "touchdown")}` : "") +
        (s(st, "passInt") ? `, ${plural(s(st, "passInt"), "interception")}` : ""),
    );
  }
  if (s(st, "recTgt") > 0) {
    parts.push(
      `${plural(s(st, "recTgt"), "target")}${u.tgtShare !== null ? ` (${pct(u.tgtShare)} of the team's)` : ""}, ` +
        `${plural(s(st, "rec"), "catch", "catches")} for ${plural(s(st, "recYds"), "yard")}` +
        (s(st, "recTd") ? ` and ${plural(s(st, "recTd"), "touchdown")}` : ""),
    );
  }
  if (s(st, "rushAtt") > 0) {
    parts.push(
      `${plural(s(st, "rushAtt"), "carry", "carries")}${
        u.carShare !== null && u.row.group !== "qb" ? ` (${pct(u.carShare)} of the team's)` : ""
      } for ${plural(s(st, "rushYds"), "yard")}` + (s(st, "rushTd") ? ` and ${plural(s(st, "rushTd"), "touchdown")}` : ""),
    );
  }
  const first = parts.length ? `${parts.join("; ")}.` : "";
  return `${first.charAt(0).toUpperCase()}${first.slice(1)}`;
}

function verdict(input: FantasySectionInput, u: Usage): string {
  const over = u.over.ppr;
  const x = u.x.ppr.toFixed(1);
  const next = input.next?.[u.row.p.team] ?? null;
  const tds = s(u.row.p.stats, "rushTd") + s(u.row.p.stats, "recTd") + s(u.row.p.stats, "passTd");
  let text: string;
  if (over >= 5) {
    text =
      tds > 0
        ? `the opportunities were worth ${x} points; the touchdowns supplied the rest, and they are the part least likely to repeat.`
        : `the opportunities were worth ${x} points; efficiency supplied the rest.`;
  } else if (over <= -5) {
    text = `the role was there, worth ${x} points at league-average rates; the production wasn't.`;
  } else {
    text = `the points matched the role, ${x} expected.`;
  }
  if (next && input.countsInSeasonLong) {
    text += ` Next up: ${next.label} against the ${next.opponent}. Bet on the role more than the result.`;
  }
  return `<p class="sct-fp-verdict"><b>Verdict:</b> ${escapeHtml(text.charAt(0).toUpperCase() + text.slice(1))}</p>`;
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
  const notes = trendNotes(u);
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

/** The players the verdict cards are about, for the game-log links. */
export function verdictPlayers(input: FantasySectionInput): GamePlayer[] {
  const rows = rowsOf(input).filter((r) => !isZero(r));
  return verdictPicks(input, usageRows(input, rows)).picked.map((u) => u.row.p);
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

  const verdicts = picked.length
    ? `<${heading} class="${cls}" id="verdicts">Fantasy verdicts</${heading}>` +
      `<div class="sct-fp-cards">` +
      picked
        .map((u) => {
          const p = u.row.p;
          const side = p.team === game.home.abbr ? "home" : "away";
          const tag = tagOf(u);
          const ss = u.row.ctx?.active ? input.startSitUrl(p.name) : null;
          const meta = (f: Format): string =>
            `${p.team} · ${p.pos ?? "-"} · ${u.row.pts[f].toFixed(1)} pts on ${u.x[f].toFixed(1)} expected`;
          return (
            `<article class="sct-fp-card" style="--rb-team:${colors[side].ink}">` +
            `<h4 class="sct-fp-card-name">${nameLink(p.name)}` +
            (tag ? ` <span class="sct-fp-tag is-${tag.kind}">${escapeHtml(tag.text)}</span>` : "") +
            `</h4>` +
            `<p class="sct-fp-meta" data-ppr="${escapeHtml(meta("ppr"))}" data-half="${escapeHtml(meta("half"))}" data-std="${escapeHtml(
              meta("std"),
            )}">${escapeHtml(meta("ppr"))}</p>` +
            `<p>${escapeHtml(happened(u))}</p>` +
            verdict(input, u) +
            trendBlock(u, gameLabel) +
            (ss
              ? `<a class="sct-fp-ss" href="${escapeHtml(ss)}" data-cta="verdict-startsit">${escapeHtml(`Start/Sit: ${p.name} →`)}</a>`
              : "") +
            `</article>`
          );
        })
        .join("") +
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
 * The matchup page's Fantasy tab takes the verdicts, stock and injuries
 * without the points tables above them: the Player Stats section already
 * carries every line and what it scored. Each block is its own section so the
 * tab reads as a run of h2s like the rest of the page, and the ids the old
 * section's links used (#verdicts, #stock, #injuries) still land on them.
 */
export function renderFantasyNotes(input: FantasySectionInput): string {
  const rows = rowsOf(input).filter((r) => !isZero(r));
  if (rows.length === 0) return "";
  const { verdicts, stockBlock, injuries } = fantasyNotes(input, rows, "h2");
  const wrap = (html: string, id: string, extra = ""): string =>
    html
      ? `<section class="sct-rb-section sct-fp${extra}" aria-labelledby="${id}" data-fp-notes>${html}</section>`
      : "";
  return wrap(verdicts, "verdicts") + wrap(stockBlock, "stock") + wrap(injuries, "injuries");
}

/**
 * The Fantasy tab, in the build spec's order: jump links; fantasy points by
 * player (the format switch and the group tables) with the Redraft Command
 * callout under them; usage and expected points; verdicts; stock up, stock
 * down; in-game injuries; and `matchups`, the points each defense allows by
 * position. One H2, the rest H3s under it.
 */
export function renderFantasySection(input: FantasySectionInput, matchups = ""): string {
  const rows = rowsOf(input).filter((r) => !isZero(r));
  if (rows.length === 0) return matchups ? `<section class="sct-rb-section sct-fp" data-fp-root>${matchups}</section>` : "";
  const { usage, verdicts, stockBlock, injuries } = fantasyNotes(input, rows, "h3");

  const toggle =
    `<div class="sct-fp-toggle" role="radiogroup" aria-label="Scoring format">` +
    ([["ppr", "PPR"], ["half", "Half PPR"], ["std", "Standard"]] as const)
      .map(
        ([value, label]) =>
          `<label class="sct-fp-seg"><input type="radio" name="sct-fp-format" value="${value}"${value === "ppr" ? " checked" : ""}>` +
          `<span>${label}</span></label>`,
      )
      .join("") +
    `</div>`;
  // The switch rides on the "Fantasy Points vs Expected" title; without that
  // block it heads the section on its own.
  const usageBlock = renderUsage(input, usage, rows, toggle);

  const wrap = (id: string, html: string): string => (html ? `<div class="sct-fp-block" data-fp-block="${id}">${html}</div>` : "");
  return (
    `<section class="sct-rb-section sct-fp"${usageBlock ? ` aria-labelledby="usage"` : ""} data-fp-root>` +
    (usageBlock ? "" : toggle) +
    (input.countsInSeasonLong
      ? ""
      : `<p class="sct-fp-playoff">Playoff game: these points don't count in most season-long fantasy leagues.</p>`) +
    wrap("usage", usageBlock) +
    // The call to action after the analysis, not before it (mak, 2026-09-30):
    // what happened, then where to look for what happens next.
    (usageBlock
      ? banner(
          "Looking ahead to next week?",
          "Past production tells you what happened. See the latest weekly and rest-of-season projections for every fantasy player.",
          input.links.projections,
          "View Fantasy Football Projections",
          "fantasy-projections-banner",
        )
      : "") +
    wrap("verdicts", verdicts) +
    wrap("decisions", renderDecisions(input, usage)) +
    (verdicts
      ? banner(
          "Did this game change a player's trade value?",
          "Compare players and evaluate a deal using current fantasy values and your league settings.",
          input.links.tradeCalculator,
          "Fantasy Football Trade Calculator",
          "fantasy-trade-banner",
        )
      : "") +
    wrap("stock", stockBlock) +
    wrap("injuries", injuries) +
    wrap("start-sit", renderStartSit(input, rows)) +
    wrap("matchups", matchups) +
    `</section>`
  );
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
function renderDecisions(input: FantasySectionInput, usage: Usage[]): string {
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
    `<h3 class="sct-rb-h3" id="decisions">Start/Sit decisions</h3>` +
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

/* ----------------------------------------------------------- start / sit */

/** How many of each position the start/sit block names per team (mak, 2026-10-10). */
const START_SIT_QUOTA: Record<string, number> = { QB: 1, RB: 2, WR: 3, TE: 1 };
const START_SIT_ORDER = ["QB", "RB", "WR", "TE"] as const;

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/**
 * "Saints allow the 3rd-most fantasy points to RBs", linked to the FPA page:
 * the position where this defense ranks softest, so the line names the
 * matchup worth attacking. Rank 1 reads "the most". "" without the table.
 */
function allowedLine(input: FantasySectionInput, defense: ScoreboardGame["away"]): string {
  const ranks = input.allowed?.byTeam[defense.abbr];
  if (!ranks) return "";
  let best: AllowedPosition | null = null;
  for (const pos of ALLOWED_POSITIONS) {
    if (!best || ranks[pos].rank < ranks[best].rank) best = pos;
  }
  if (!best) return "";
  const rank = ranks[best].rank;
  const text = `${defense.short} ${defense.short.endsWith("s") ? "allow" : "allows"} the ${
    rank === 1 ? "most" : `${ordinal(rank)}-most`
  } fantasy points to ${best}s`;
  const url = input.allowed?.url;
  return (
    `<p class="sct-fp-ss-fpa">` +
    (url ? `<a href="${escapeHtml(url)}" target="_top" data-cta="startsit-fpa">${escapeHtml(text)}</a>` : escapeHtml(text)) +
    `</p>`
  );
}

/**
 * Start/sit checks (mak, 2026-10-10): each team's top fantasy players from
 * this game - the QB, two RBs, three WRs and the TE by PPR points - each
 * linked to Redraft Command's Start/Sit tool for that player, and under them
 * one line on what the opposing defense allows, linked to the Fantasy Points
 * Allowed page. A player with no page of his own, or not on an active roster,
 * is left out rather than linked nowhere; a team with nobody left prints no
 * card. Nothing for a playoff game: there is no next week to decide.
 */
function renderStartSit(input: FantasySectionInput, rows: Row[]): string {
  if (!input.countsInSeasonLong) return "";
  const { game } = input;
  const colors = pairColors(game.away.abbr, game.home.abbr);

  const cards = (["away", "home"] as const)
    .map((side) => {
      const team = game[side];
      const other = game[side === "away" ? "home" : "away"];
      const taken: Record<string, number> = {};
      const picks = rows
        .filter((r) => r.p.team === team.abbr && (r.group === "qb" || r.group === "flex"))
        .filter((r) => r.p.pos && START_SIT_QUOTA[r.p.pos] !== undefined)
        .filter((r) => !r.ctx || r.ctx.active)
        .sort((a, b) => b.pts.ppr - a.pts.ppr || a.p.name.localeCompare(b.p.name))
        .map((r) => ({ r, href: input.startSitUrl(r.p.name) }))
        .filter((x): x is { r: Row; href: string } => x.href !== null)
        .filter(({ r }) => {
          const pos = r.p.pos!;
          taken[pos] = (taken[pos] ?? 0) + 1;
          return taken[pos] <= START_SIT_QUOTA[pos]!;
        })
        .sort(
          (a, b) =>
            START_SIT_ORDER.indexOf(a.r.p.pos as (typeof START_SIT_ORDER)[number]) -
              START_SIT_ORDER.indexOf(b.r.p.pos as (typeof START_SIT_ORDER)[number]) || b.r.pts.ppr - a.r.pts.ppr,
        );
      if (picks.length === 0) return "";
      return (
        `<div class="sct-fp-ss-card" style="--rb-team:${colors[side].ink}">` +
        `<h4 class="sct-fp-team" style="color:${colors[side].ink}">${escapeHtml(team.name)}</h4>` +
        `<ul class="sct-fp-ss-list">` +
        picks
          .map(
            ({ r, href }) =>
              `<li><span class="sct-fp-ss-pos">${escapeHtml(r.p.pos ?? "")}</span> ` +
              `<a class="sct-fp-ss-link" href="${escapeHtml(href)}" target="_top" data-cta="startsit-player">${escapeHtml(r.p.name)}</a></li>`,
          )
          .join("") +
        `</ul>` +
        allowedLine(input, other) +
        `</div>`
      );
    })
    .join("");
  if (!cards) return "";
  return (
    `<h3 class="sct-rb-h3" id="start-sit">Start/sit checks</h3>` +
    `<p class="sct-rb-sub">Each name opens the Start/Sit tool for that player. The line under each team is what the defense it faced here allows by position this season.</p>` +
    `<div class="sct-fp-ss-grid">${cards}</div>`
  );
}

/* -------------------------------------------------------- fantasy matchups */

/**
 * "Fantasy matchups": what each of the two defenses has allowed per game to
 * QBs, RBs, WRs and TEs this season, one column per defense. Every figure
 * carries all three formats, so it follows the page's switch.
 */
export function renderFantasyMatchups(game: ScoreboardGame, allowed: PointsAllowed | null): string {
  if (!allowed) return "";
  const away = allowed.teams[game.away.abbr];
  const home = allowed.teams[game.home.abbr];
  if (!away && !home) return "";
  const colors = pairColors(game.away.abbr, game.home.abbr);
  const cell = (side: typeof away, pos: AllowedPosition): string => {
    const t = side?.perGame[pos];
    return t ? `<td class="sct-fp-pts"${dataAttrs(t)}>${t.ppr.toFixed(1)}</td>` : `<td>-</td>`;
  };
  return (
    `<h3 class="sct-rb-h3" id="matchups">Fantasy matchups</h3>` +
    `<p class="sct-rb-sub">${escapeHtml(
      `Fantasy points allowed per game by position, ${game.seasonLabel} through Week ${allowed.throughWeek}.`,
    )}</p>` +
    `<div class="sct-fp-wrap"><table class="sct-fp-table is-allowed">` +
    `<caption class="sct-rb-sr">${escapeHtml(
      `Fantasy points allowed per game by position, ${game.away.short} defense and ${game.home.short} defense`,
    )}</caption>` +
    `<thead><tr><th scope="col">Points allowed to</th>` +
    `<th scope="col" style="color:${colors.away.ink}">${escapeHtml(`${game.away.short} D`)}</th>` +
    `<th scope="col" style="color:${colors.home.ink}">${escapeHtml(`${game.home.short} D`)}</th>` +
    `</tr></thead><tbody>` +
    ALLOWED_POSITIONS.map(
      (pos) => `<tr><th scope="row" class="sct-fp-player">${pos}s</th>${cell(away, pos)}${cell(home, pos)}</tr>`,
    ).join("") +
    `</tbody></table></div>` +
    `<p class="sct-rb-note">Regular season, summed from each game's box score and scored with this page's rules.</p>`
  );
}
