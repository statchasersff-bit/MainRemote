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
  defensePoints,
  fantasyPoints,
  idpPoints,
  kickerPoints,
  type DefenseLine,
  type KickerLine,
} from "./fantasy-points";
import type { LoggedGame, PlayerContext } from "./fantasy-data";
import { isKicker, nameKey, type GamePlayer, type GamePlayers } from "./game-players";
import { pairColors, type ScoreboardGame } from "./scoreboard-hero";

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
  /** False for a playoff game, whose points most season-long leagues never score. */
  countsInSeasonLong: boolean;
  /** Each side's next game after this one, when the season is still being played. */
  next: Record<string, { label: string; opponent: string } | null> | null;
  injuries: GameInjuryNotes | null;
  links: { redraftCommand: string };
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
  return share === null ? "—" : `${Math.round(share * 100)}%`;
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

interface Column {
  label: string;
  title?: string;
  value: (row: Row) => string;
}

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

function playerCell(input: FantasySectionInput, row: Row): string {
  const href = input.playerUrl(row.p.name);
  const name = href
    ? `<a class="sct-player-link" href="${escapeHtml(href)}" target="_top">${escapeHtml(row.p.name)}</a>`
    : escapeHtml(row.p.name);
  const ss = row.ctx?.active ? input.startSitUrl(row.p.name) : null;
  return (
    `<th scope="row" class="sct-fp-player">${name}` +
    (ss
      ? `<a class="sct-fp-ss" href="${escapeHtml(ss)}" data-cta="fantasy-table-startsit" ` +
        `aria-label="${escapeHtml(`Start or sit ${row.p.name}`)}">Start/Sit →</a>`
      : "") +
    `</th>`
  );
}

function sortAttrs(t: Triple): string {
  return FORMATS.map((f) => ` data-sort-${f}="${t[f]}"`).join("");
}

function ptsCell(t: Triple, top: boolean): string {
  return `<td class="sct-fp-pts${top ? " is-top" : ""}"${dataAttrs(t)}>${t.ppr.toFixed(1)}</td>`;
}

function teamTable(
  input: FantasySectionInput,
  team: ScoreboardGame["away"],
  ink: string,
  rows: Row[],
  columns: Column[],
  caption: string,
): string {
  if (rows.length === 0) return "";
  // A position column nobody has a position for is a column of dashes: ESPN
  // leaves defenders unplaced more often than not.
  columns = columns.filter((c) => c.label !== "POS" || rows.some((r) => r.p.pos));
  const sorted = [...rows].sort((a, b) => b.pts.ppr - a.pts.ppr || a.p.name.localeCompare(b.p.name));
  const top = sorted[0]!.pts.ppr;
  return (
    `<h4 class="sct-fp-team" style="color:${ink}">${escapeHtml(team.name)}</h4>` +
    `<div class="sct-fp-wrap"><table class="sct-fp-table" data-fp-table>` +
    `<caption class="sct-rb-sr">${escapeHtml(`${caption}, ${team.name}`)}</caption>` +
    `<thead><tr><th scope="col">Player</th>${head("PTS")}${columns.map((c) => head(c.label)).join("")}</tr></thead>` +
    `<tbody>` +
    sorted
      .map(
        (row) =>
          `<tr${sortAttrs(row.pts)}>` +
          playerCell(input, row) +
          ptsCell(row.pts, row.pts.ppr === top && top > 0) +
          columns.map((c) => `<td>${escapeHtml(c.value(row))}</td>`).join("") +
          `</tr>`,
      )
      .join("") +
    `</tbody></table></div>`
  );
}

const QB_COLUMNS: Column[] = [
  { label: "CMP/ATT", value: (r) => `${s(r.p.stats, "passCmp")}/${s(r.p.stats, "passAtt")}` },
  { label: "Pass YDS", value: (r) => String(s(r.p.stats, "passYds")) },
  { label: "TD", value: (r) => String(s(r.p.stats, "passTd")) },
  { label: "INT", value: (r) => String(s(r.p.stats, "passInt")) },
  { label: "Rush ATT", value: (r) => String(s(r.p.stats, "rushAtt")) },
  { label: "Rush YDS", value: (r) => String(s(r.p.stats, "rushYds")) },
  { label: "Rush TD", value: (r) => String(s(r.p.stats, "rushTd")) },
];

const FLEX_COLUMNS: Column[] = [
  { label: "POS", value: (r) => r.p.pos ?? "—" },
  { label: "Rush ATT", value: (r) => String(s(r.p.stats, "rushAtt")) },
  { label: "Rush YDS", value: (r) => String(s(r.p.stats, "rushYds")) },
  { label: "Rush TD", value: (r) => String(s(r.p.stats, "rushTd")) },
  { label: "TGT", value: (r) => String(s(r.p.stats, "recTgt")) },
  { label: "REC", value: (r) => String(s(r.p.stats, "rec")) },
  { label: "Rec YDS", value: (r) => String(s(r.p.stats, "recYds")) },
  { label: "Rec TD", value: (r) => String(s(r.p.stats, "recTd")) },
];

function kColumns(input: FantasySectionInput): Column[] {
  return [
    {
      label: "FG",
      value: (r) => {
        const k = kickerLine(input, r.p);
        return `${k.fgMade.length}/${k.fgAtt}`;
      },
    },
    {
      label: "Long",
      value: (r) => {
        const long = Math.max(s(r.p.stats, "fgLong"), ...kickerLine(input, r.p).fgMade);
        return long > 0 ? String(long) : "—";
      },
    },
    {
      label: "XP",
      value: (r) => {
        const k = kickerLine(input, r.p);
        return `${k.xpMade}/${k.xpAtt}`;
      },
    },
  ];
}

const IDP_COLUMNS: Column[] = [
  { label: "POS", value: (r) => r.p.pos ?? "—" },
  { label: "Solo", value: (r) => String(s(r.p.stats, "soloTkl")) },
  { label: "Ast", value: (r) => String(s(r.p.stats, "astTkl")) },
  { label: "TFL", value: (r) => String(s(r.p.stats, "tfl")) },
  { label: "Sacks", value: (r) => String(s(r.p.stats, "sacks")) },
  { label: "QB hits", value: (r) => String(s(r.p.stats, "qbHits")) },
  { label: "PD", value: (r) => String(s(r.p.stats, "passDef")) },
  { label: "INT", value: (r) => String(s(r.p.stats, "defInt")) },
  { label: "FR", value: (r) => String(s(r.p.stats, "fumRec")) },
  { label: "TD", value: (r) => String(s(r.p.stats, "defTd")) },
];

function idpTables(input: FantasySectionInput, rows: Row[], colors: ReturnType<typeof pairColors>): string {
  const { game } = input;
  return (["away", "home"] as const)
    .map((side) => {
      const team = game[side];
      const mine = rows
        .filter((r) => r.p.team === team.abbr)
        .sort((a, b) => b.pts.ppr - a.pts.ppr || a.p.name.localeCompare(b.p.name));
      if (mine.length === 0) return "";
      const topFive = teamTable(input, team, colors[side].ink, mine.slice(0, 5), IDP_COLUMNS, "Individual defensive players");
      if (mine.length <= 5) return topFive;
      // The rest in a disclosure; its table carries no top marker, since the
      // top scorer is always in the five above it.
      const rest = mine.slice(5);
      const restTable = teamTable(input, team, colors[side].ink, rest, IDP_COLUMNS, "More defensive players")
        .replace(/<h4[^>]*>.*?<\/h4>/, "")
        .replace(/ is-top/g, "")
        .replace("data-fp-table", "data-fp-table data-fp-notop");
      return (
        topFive +
        `<details class="sct-fp-more"><summary>${escapeHtml(`Show all ${mine.length} ${team.short} defenders`)}</summary>` +
        restTable +
        `</details>`
      );
    })
    .join("");
}

function dstTable(input: FantasySectionInput, colors: ReturnType<typeof pairColors>): string {
  const { game } = input;
  const rows = (["away", "home"] as const)
    .map((side) => ({ side, team: game[side], line: input.defense[game[side].abbr] }))
    .filter((r): r is { side: "away" | "home"; team: ScoreboardGame["away"]; line: DefenseLine } => Boolean(r.line));
  if (rows.length === 0) return "";
  const pts = rows.map((r) => defensePoints(r.line));
  const top = Math.max(...pts);
  return (
    `<div class="sct-fp-wrap"><table class="sct-fp-table" data-fp-table>` +
    `<caption class="sct-rb-sr">Defense and special teams</caption>` +
    `<thead><tr><th scope="col">Team</th>${["PTS", "Sacks", "INT", "FR", "Safety", "Def TD", "Ret TD", "Pts allowed"]
      .map(head)
      .join("")}</tr></thead><tbody>` +
    rows
      .map((r, i) => {
        const t = same(pts[i]!);
        return (
          `<tr${sortAttrs(t)}>` +
          `<th scope="row" class="sct-fp-player" style="color:${colors[r.side].ink}">${escapeHtml(`${r.team.short} D/ST`)}</th>` +
          ptsCell(t, t.ppr === top) +
          [r.line.sacks, r.line.ints, r.line.fumRec, r.line.safeties, r.line.defTd, r.line.retTd, r.line.pointsAllowed]
            .map((v) => `<td>${v}</td>`)
            .join("") +
          `</tr>`
        );
      })
      .join("") +
    `</tbody></table></div>`
  );
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

function renderUsage(input: FantasySectionInput, usage: Usage[], rows: Row[]): string {
  if (usage.length === 0 || !input.rates) return "";
  const hasSnaps = usage.some((u) => u.snapShare !== null);
  const body = usage
    .map((u) => {
      const p = u.row.p;
      const href = input.playerUrl(p.name);
      const name = href
        ? `<a class="sct-player-link" href="${escapeHtml(href)}" target="_top">${escapeHtml(p.name)}</a>`
        : escapeHtml(p.name);
      return (
        `<tr>` +
        `<th scope="row" class="sct-fp-player">${name}<span class="sct-fp-sub">${escapeHtml(`${p.team} · ${p.pos ?? "—"}`)}</span></th>` +
        `<td class="sct-fp-pts"${dataAttrs(u.row.pts)}>${u.row.pts.ppr.toFixed(1)}</td>` +
        `<td${dataAttrs(u.x)}>${u.x.ppr.toFixed(1)}</td>` +
        diffCell(u.over) +
        (hasSnaps ? `<td>${pct(u.snapShare)}</td>` : "") +
        `<td>${s(p.stats, "passAtt")}</td>` +
        `<td>${s(p.stats, "rushAtt")}</td><td>${pct(u.carShare)}</td>` +
        `<td>${s(p.stats, "recTgt")}</td><td>${pct(u.tgtShare)}</td>` +
        `</tr>`
      );
    })
    .join("");
  const { game } = input;
  const ta = teamTotals(rows, game.away.abbr);
  const th = teamTotals(rows, game.home.abbr);
  const rates = input.rates;
  return (
    `<h3 class="sct-rb-h3" id="usage">Usage and expected points</h3>` +
    `<p class="sct-rb-sub">Expected points (xFP) are what a player's pass attempts, carries and targets are worth ` +
    `at the league's average rates; the difference is what the player made of them.</p>` +
    `<div class="sct-fp-wrap"><table class="sct-fp-table is-usage">` +
    `<caption class="sct-rb-sr">Usage and expected fantasy points</caption>` +
    `<thead><tr><th scope="col">Player</th>${head("PTS")}` +
    `<th scope="col"><abbr title="Expected fantasy points">xFP</abbr></th>` +
    `<th scope="col"><abbr title="Points over expected">+/−</abbr></th>` +
    (hasSnaps ? `<th scope="col"><abbr title="Share of the team's offensive snaps">Snap%</abbr></th>` : "") +
    `<th scope="col"><abbr title="Pass attempts">Pass att</abbr></th>` +
    `<th scope="col"><abbr title="Carries">Car</abbr></th>` +
    `<th scope="col"><abbr title="Share of the team's carries">Car%</abbr></th>` +
    `<th scope="col"><abbr title="Targets">Tgt</abbr></th>` +
    `<th scope="col"><abbr title="Share of the team's targets">Tgt%</abbr></th>` +
    `</tr></thead><tbody>${body}</tbody></table></div>` +
    `<p class="sct-rb-note">${escapeHtml(
      `Team totals: ${game.away.short} ${ta.targets} targets and ${ta.carries} carries; ` +
        `${game.home.short} ${th.targets} targets and ${th.carries} carries. ` +
        `Shares are from the box score. ` +
        (hasSnaps ? "Snap counts are from the weekly player logs. " : "Snap counts aren't available for this game. ") +
        `Route counts aren't available. ` +
        `League-average rates from the ${rates.season} season: ${perTarget(rates, "ppr").toFixed(2)} PPR points per target ` +
        `(${Math.round(rates.catchRate * 100)}% catch rate), ${rates.perCarry.toFixed(2)} per carry and ` +
        `${rates.perPassAttempt.toFixed(2)} per pass attempt. They don't adjust for field position or target depth.`,
    )}</p>`
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

export function renderFantasySection(input: FantasySectionInput): string {
  const { game } = input;
  const colors = pairColors(game.away.abbr, game.home.abbr);
  const rows = rowsOf(input).filter((r) => !isZero(r));
  if (rows.length === 0) return "";
  const round = game.gameType === "playoff" ? game.roundLabel.replace(/^(AFC|NFC)\s+/, "") : game.roundLabel;

  const group = (key: Group, title: string, columns: Column[]): string => {
    const mine = rows.filter((r) => r.group === key);
    if (mine.length === 0) return "";
    const tables = (["away", "home"] as const)
      .map((side) =>
        teamTable(
          input,
          game[side],
          colors[side].ink,
          mine.filter((r) => r.p.team === game[side].abbr),
          columns,
          title,
        ),
      )
      .join("");
    return tables ? `<h3 class="sct-rb-h3">${escapeHtml(title)}</h3>${tables}` : "";
  };

  const idp = rows.filter((r) => r.group === "idp");
  const dst = dstTable(input, colors);
  const tables =
    group("qb", "Quarterbacks", QB_COLUMNS) +
    group("flex", "Flex (RB, WR, TE)", FLEX_COLUMNS) +
    group("k", "Kickers", kColumns(input)) +
    (dst ? `<h3 class="sct-rb-h3">Defense/special teams</h3>${dst}` : "") +
    (idp.length ? `<h3 class="sct-rb-h3">Individual defensive players</h3>${idpTables(input, idp, colors)}` : "");

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
    ? `<h3 class="sct-rb-h3" id="verdicts">Fantasy verdicts</h3>` +
      `<div class="sct-fp-cards">` +
      picked
        .map((u) => {
          const p = u.row.p;
          const side = p.team === game.home.abbr ? "home" : "away";
          const tag = tagOf(u);
          const ss = u.row.ctx?.active ? input.startSitUrl(p.name) : null;
          const meta = (f: Format): string =>
            `${p.team} · ${p.pos ?? "—"} · ${u.row.pts[f].toFixed(1)} pts on ${u.x[f].toFixed(1)} expected`;
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
    ? `<h3 class="sct-rb-h3" id="stock">Stock up, stock down</h3>` +
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

  const inj = input.injuries;
  const injuries = inj
    ? `<h3 class="sct-rb-h3" id="injuries">In-game injuries</h3>` +
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

  return (
    `<section class="sct-rb-section sct-fp" aria-labelledby="fpts" data-fp-root>` +
    `<h2 class="sct-rb-h2" id="fpts">${escapeHtml(`Fantasy points: ${game.away.short} vs ${game.home.short}, ${round} ${game.seasonLabel}`)}</h2>` +
    `<p class="sct-rb-sub">Every fantasy-relevant stat line from this game, scored for your league format.</p>` +
    (input.countsInSeasonLong
      ? ""
      : `<p class="sct-fp-playoff">Playoff game: these points don't count in most season-long fantasy leagues.</p>`) +
    toggle +
    tables +
    renderUsage(input, usage, rows) +
    verdicts +
    stockBlock +
    injuries +
    `<p class="sct-fp-callout">Have one of these players? ` +
    `<a href="${escapeHtml(input.links.redraftCommand)}" data-cta="fantasy-table-footer">Redraft Command</a> ` +
    `tells you whether to start, sit, trade or hold them based on your roster and league settings.</p>` +
    `</section>`
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
export function topScorers(input: Pick<FantasySectionInput, "players">): Array<{ name: string; ppr: number; player: GamePlayer }> {
  return Object.values(input.players)
    .filter((p) => {
      const g = groupOf(p);
      return g === "qb" || g === "flex";
    })
    .map((p) => ({ name: p.name, ppr: fantasyPoints(p.stats, "ppr"), player: p }))
    .sort((a, b) => b.ppr - a.ppr || a.name.localeCompare(b.name));
}
