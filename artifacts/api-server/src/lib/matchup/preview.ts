/**
 * The upcoming matchup page's decision layer: the betting strip, The Call, the
 * Start/Sit board, Matchup Leverage, and the analyst lines under each block.
 *
 * Built from data the site already publishes, so nothing here can disagree
 * with the page it links to:
 *
 * - roles from the team hub's Usage Report (usage_<season>.json), the same
 *   figures the hub prints;
 * - score-state pass rates from the Coaching Profile (coaching_<season>.json);
 * - positional points allowed from the FPA table, PPR, which is the format
 *   the board is called for (mak, 2026-10-05);
 * - lines and forecasts from game-lines.ts.
 *
 * Every sentence is a template filled from those numbers (mak, 2026-10-03: no
 * hand-written per-game copy, no model calls). A template states a mechanism
 * and only says what its inputs show: a block whose inputs are missing is left
 * out rather than written around. There is no coverage or alignment data, so
 * the leverage table's defense column is points allowed only, as the spec's
 * fallback asks.
 */

import type { NflTeam } from "../team/teams";
import type { TeamStats, StatRow } from "../team/stats";
import type { RosterPlayer } from "../team/roster";
import type { FpaRow } from "../fpa/fpa-data";
import { getUsageDoc, type UsageDoc, type UsagePlayer, type UsageTeam } from "../team/usage";
import { getTeamCoaching, type TeamCoaching } from "../team/coaching";
import { loadRosterPct } from "../player/data";
import type { MatchupData, Meeting } from "./matchup-data";
import { impliedTotals, type Forecast, type GameLine, type WeekLines } from "./game-lines";

export type Pos = "QB" | "RB" | "WR" | "TE";
export type Verdict = "MUST START" | "START" | "FLEX" | "SIT";
export type Leverage = "up" | "neutral" | "down" | "proof";
export type SideKey = "away" | "home";

export interface PreviewSide {
  key: SideKey;
  team: NflTeam;
  opponent: NflTeam;
  /** This team's implied points, and where it ranks among the week's. */
  implied: number | null;
  impliedRank: number | null;
  usage: UsageTeam | null;
  coaching: TeamCoaching | null;
  /** What THIS team's defense allows by position. */
  fpa: FpaRow | null;
  stats: TeamStats | null;
  record: string | null;
  roster: RosterPlayer[];
}

export interface BoardRow {
  side: SideKey;
  name: string;
  pos: Pos | "DST";
  slug: string | null;
  verdict: Verdict;
  /** The full sentence: the FAQ and the no-usage / D/ST cards still read it. */
  reason: string;
  rostered: number;
  leverage: Leverage | null;
  /*
   * The card's structured lines (mak, 2026-10-05: "stop writing the card as a
   * paragraph"). Null where the row has no usage to read them from.
   */
  /** "NYJ": the player's team, for the "NYJ · WR" micro-context. */
  team: string;
  /** Unavailable this week (Out, IR, Doubtful...): shown as OUT, not SIT. */
  out: boolean;
  injury: { status: string; part: string | null } | null;
  ppg: number | null;
  /** The board's matchup- and script-adjusted figure, printed as PROJ. */
  proj: number | null;
  /** The one usage number that matters at the position. */
  metric: string | null;
  /** The defense's code, for "NE MATCHUP". */
  matchupTeam: string | null;
  /** "15th-most WR fantasy points allowed". */
  matchupLine: string | null;
  /** The "Why this call" bullets. */
  why: string[];
}

export interface LeverageRow {
  side: SideKey;
  name: string;
  pos: Pos;
  slug: string | null;
  role: string;
  defense: string;
  chip: Leverage;
  /** The board's call, to spot a role/matchup conflict. */
  verdict: Verdict;
  ppg: number;
  /** The role column as number + label pairs ("28.4%" / "targets"). */
  roleStats: Array<{ v: string; k: string }>;
  /** What the defense allows at his position, and where that ranks. */
  defFpa: number | null;
  defRank: number | null;
}

/** The two or three conclusions above the leverage table. */
export interface LeverageRead {
  up: number;
  neutral: number;
  down: number;
  edge: LeverageRow | null;
  fade: LeverageRow | null;
  conflict: { row: LeverageRow; text: string } | null;
}

/** One defense-vs-position headline above the points-allowed table. */
export interface FpaHeadline {
  def: string;
  pos: Pos;
  fpa: number;
  rank: number;
  /** The offense player it sets up (softest only). */
  who: string | null;
}

export interface InjuryRow {
  status: string;
  /** "IR", "O", "D", "Q", ... for the chip. */
  chip: string;
  name: string;
  pos: string;
  fallout: string;
  /** Sleeper roster %, for picking the game's top injury question. */
  rostered: number;
  /*
   * For the Injury Impact strip: an absence that hands work to someone
   * ("out", with who gets it), a designation to watch, or nothing for lineups.
   */
  impact: "out" | "watch" | "none";
  beneficiary: { name: string; pos: string } | null;
  ppg: number | null;
}

/** The strip above the injury cards (mak, 2026-10-05). */
export interface InjuryImpact {
  beneficiary: { name: string; team: string; pos: string; because: string } | null;
  watch: Array<{ name: string; team: string }>;
  none: Array<{ name: string; team: string }>;
}

export interface Preview {
  away: PreviewSide;
  home: PreviewSide;
  meeting: Meeting;
  line: GameLine | null;
  /** Implied totals across the week, for the rank labels. */
  slateCount: number;
  forecast: Forecast | null;
  call: { thesis: string; paragraph: string; lean: number; leanText: string } | null;
  board: Record<SideKey, BoardRow[]>;
  leverage: LeverageRow[];
  leverageRead: LeverageRead | null;
  snapshotNote: string | null;
  fpaNote: string | null;
  fpaHeadlines: { soft: FpaHeadline; tough: FpaHeadline } | null;
  injuries: Record<SideKey, InjuryRow[]>;
  h2h: H2hStrip | null;
  injuryImpact: InjuryImpact | null;
  usageThrough: number | null;
  /** When the freshest input was read: the byline's "Updated". */
  updatedMs: number;
}

export interface H2hStrip {
  since: number;
  games: Meeting[];
  record: string;
  avgPoints: number | null;
  avgVsTotal: string | null;
  third: { value: string; label: string } | null;
  /** "the Patriots have won 8 of the last 10" and the average margin. */
  trend: { text: string; margin: string } | null;
  lede: string;
  returnMeeting: Meeting | null;
}

/* ---------------------------------------------------------------- helpers */

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

const one = (n: number): string => n.toFixed(1);
const code = (t: NflTeam): string => t.code.toUpperCase();
const pct = (n: number | null | undefined): string => (n == null ? "-" : `${Math.round(n)}%`);
const trimZero = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));
/** 28.25 stays 28.25: the strip, the call and the FAQ print the same figure. */
export const exact = (n: number): string => String(Math.round(n * 100) / 100);

/** "+7", "-3", "PK". Half points as ".5". */
export function signedLine(n: number): string {
  if (n === 0) return "PK";
  return `${n > 0 ? "+" : "-"}${trimZero(Math.abs(n))}`;
}

/** 1 -> "highest", 3 -> "3rd-highest"; the same for "lowest". */
export function rankWord(rank: number, word: "highest" | "lowest"): string {
  return rank === 1 ? word : `${ordinal(rank)}-${word}`;
}

/** Rank as a softness phrase: "4th-most" for 1-16, "3rd-fewest" for 17-32. */
export function allowPhrase(rank: number): string {
  return rank <= 16 ? `${ordinal(rank)}-most` : `${ordinal(33 - rank)}-fewest`;
}

/** UPGRADE at the 10 softest, DOWNGRADE at the 10 stingiest. */
function chipFor(rank: number | null): Leverage {
  if (rank === null) return "neutral";
  if (rank <= 10) return "up";
  if (rank >= 23) return "down";
  return "neutral";
}

/** PPR points a game, the usage file's own figure. */
function pprPpg(p: UsagePlayer): number | null {
  if (p.fpPerGame === null || !p.games) return null;
  return p.fpPerGame;
}

const OUT = new Set(["Out", "IR", "PUP", "Doubtful", "Sus", "Suspended", "NFI", "COV"]);

function isOut(status: string | null | undefined): boolean {
  return !!status && OUT.has(status);
}

function chipCode(status: string): string {
  if (status === "Questionable") return "Q";
  if (status === "Doubtful") return "D";
  if (status === "Out") return "O";
  if (status === "Sus" || status === "Suspended") return "SUS";
  return status.toUpperCase();
}

/** Verdict cut-offs: league position rank (by adjusted PPR ppg). */
const CUTS: Record<Pos, [number, number, number]> = {
  // [MUST START <=, START <=, FLEX <=]; QB FLEX is the Superflex band.
  QB: [4, 12, 18],
  RB: [8, 20, 36],
  WR: [8, 24, 40],
  TE: [3, 8, 14],
};

function findRow(stats: TeamStats | null, key: string): StatRow | null {
  if (!stats) return null;
  for (const group of [stats.offense, stats.defense, stats.situational, stats.volume]) {
    const row = group.find((cell) => cell.key === key);
    if (row) return row;
  }
  return null;
}

/* ----------------------------------------------------------------- league */

interface League {
  /** Raw PPR ppg per position, best first - the cut-off ladder. */
  ladder: Record<Pos, number[]>;
  rankOf(p: UsagePlayer): number | null;
}

function buildLeague(doc: UsageDoc): League {
  const pools: Record<Pos, Array<{ id: string; ppg: number }>> = { QB: [], RB: [], WR: [], TE: [] };
  const minGames = Math.min(2, Math.max(1, doc.throughWeek - 1));
  for (const team of Object.values(doc.teams)) {
    for (const p of team.players) {
      const ppg = pprPpg(p);
      if (ppg === null || p.games < minGames) continue;
      pools[p.pos].push({ id: p.id, ppg });
    }
  }
  for (const pos of Object.keys(pools) as Pos[]) pools[pos].sort((x, y) => y.ppg - x.ppg);
  return {
    ladder: {
      QB: pools.QB.map((x) => x.ppg),
      RB: pools.RB.map((x) => x.ppg),
      WR: pools.WR.map((x) => x.ppg),
      TE: pools.TE.map((x) => x.ppg),
    },
    rankOf(p) {
      const i = pools[p.pos].findIndex((x) => x.id === p.id);
      return i < 0 ? null : i + 1;
    },
  };
}

/** Where an adjusted figure would slot into the raw ladder (1-based). */
function slot(ladder: number[], value: number, own: number): number {
  let rank = 1;
  for (const v of ladder) if (v > value && v !== own) rank += 1;
  return rank;
}

/* ------------------------------------------------------------------ build */

export interface PreviewInputs {
  lines: WeekLines | null;
  forecast: Forecast | null;
  now: number;
}

export function buildPreview(data: MatchupData, inputs: PreviewInputs): Preview | null {
  const meeting = data.featured;
  if (data.matchupState !== "upcoming" || !meeting || data.pinned) return null;

  const season = data.state.season;
  const usage = getUsageDoc(season);
  const pctDoc = loadRosterPct();
  const owned = (sleeperId: string | null | undefined): number =>
    (sleeperId && pctDoc.players[sleeperId]?.owned) || 0;

  const pageFor = (team: NflTeam) => (team.abbreviation === data.pair.a.abbreviation ? data.a : data.b);
  const fpaFor = (team: NflTeam) =>
    data.fpa ? (team.abbreviation === data.pair.a.abbreviation ? data.fpa.a : data.fpa.b) : null;

  const line =
    inputs.lines?.games.find(
      (g) =>
        (meeting.espnEventId && g.eventId === meeting.espnEventId) ||
        (g.home === meeting.home.abbreviation && g.away === meeting.away.abbreviation),
    ) ?? null;
  const implied = line ? impliedTotals(line) : null;
  const slate = (inputs.lines?.games ?? [])
    .flatMap((g) => {
      const t = impliedTotals(g);
      return t ? [t.away, t.home] : [];
    })
    .sort((x, y) => y - x);
  const rankIn = (v: number | null): number | null => (v === null ? null : slate.findIndex((x) => x === v) + 1 || null);

  const makeSide = (key: SideKey, team: NflTeam, opponent: NflTeam): PreviewSide => {
    const page = pageFor(team);
    const value = implied ? implied[key] : null;
    return {
      key,
      team,
      opponent,
      implied: value,
      impliedRank: rankIn(value),
      usage: usage?.teams[team.abbreviation] ?? null,
      coaching: getTeamCoaching(team.abbreviation, season),
      fpa: fpaFor(team),
      stats: page.stats,
      record: page.profile?.record ?? null,
      roster: page.roster?.players ?? [],
    };
  };
  const away = makeSide("away", meeting.away, meeting.home);
  const home = makeSide("home", meeting.home, meeting.away);
  const sideOf = (k: SideKey) => (k === "away" ? away : home);
  const otherOf = (k: SideKey) => (k === "away" ? home : away);

  const league = usage ? buildLeague(usage) : null;
  const slateMean = slate.length ? slate.reduce((s, x) => s + x, 0) / slate.length : null;

  /* ---- per-player facts, shared by the board, the leverage table and the call */

  interface Fact {
    side: SideKey;
    p: UsagePlayer;
    ppg: number;
    posRank: number | null;
    adjRank: number;
    oppRank: number | null;
    oppFpa: number | null;
    chip: Leverage;
    injury: RosterPlayer | null;
    rostered: number;
    matchup: number;
    script: number;
    adjusted: number;
  }
  const facts: Fact[] = [];
  for (const side of [away, home]) {
    const opp = otherOf(side.key);
    for (const p of side.usage?.players ?? []) {
      const ppg = pprPpg(p);
      if (ppg === null || !league) continue;
      const rostered = owned(p.sleeperId);
      if (rostered < 5) continue;
      const oppRank = opp.fpa?.byPos[p.pos]?.rank ?? null;
      const oppFpa = opp.fpa?.byPos[p.pos]?.fpa ?? null;
      // Matchup: +/-15% from the softest to the stingiest defense at the spot.
      const matchup = oppRank === null ? 1 : 1 + (16.5 - oppRank) * 0.0095;
      // Script: the team's implied total against the slate's average, half weight.
      const script =
        side.implied !== null && slateMean
          ? Math.min(1.15, Math.max(0.85, 1 + ((side.implied - slateMean) / slateMean) * 0.5))
          : 1;
      const adjusted = ppg * matchup * script;
      const posRank = league.rankOf(p);
      const injury = side.roster.find((r) => r.id === p.sleeperId && r.injuryStatus) ?? null;
      let chip = chipFor(oppRank);
      if (posRank !== null && posRank <= 3 && chip !== "up") chip = "proof";
      facts.push({
        side: side.key,
        p,
        ppg,
        posRank,
        adjRank: slot(league.ladder[p.pos], adjusted, ppg),
        oppRank,
        oppFpa,
        chip,
        injury,
        rostered,
        matchup,
        script,
        adjusted,
      });
    }
  }

  const board: Record<SideKey, BoardRow[]> = { away: [], home: [] };
  for (const f of facts) {
    const side = sideOf(f.side);
    const opp = otherOf(f.side);
    const status = f.injury?.injuryStatus ?? null;
    board[f.side].push({
      side: f.side,
      name: f.p.name,
      pos: f.p.pos,
      slug: f.p.slug,
      verdict: verdictFor(f),
      reason: reasonFor(f, side, opp),
      rostered: f.rostered,
      leverage: f.chip,
      team: code(side.team),
      out: isOut(status),
      injury: status ? { status, part: f.injury?.injuryBodyPart ?? null } : null,
      ppg: f.ppg,
      proj: isOut(status) ? null : f.adjusted,
      metric: metricFor(f.p),
      matchupTeam: code(opp.team),
      matchupLine: f.oppRank === null ? null : `${allowPhrase(f.oppRank)} ${f.p.pos} fantasy points allowed`,
      why: isOut(status) ? [] : whyFor(f, side, opp),
    });
  }
  // Rostered players with no 2026 usage yet: the board still has to cover them.
  for (const side of [away, home]) {
    for (const r of side.roster) {
      if (owned(r.id) < 5) continue;
      if (facts.some((f) => f.p.sleeperId === r.id)) continue;
      const status = r.injuryStatus;
      board[side.key].push({
        side: side.key,
        name: r.name,
        pos: r.position,
        slug: null,
        verdict: "SIT",
        team: code(side.team),
        out: isOut(status),
        injury: status ? { status, part: r.injuryBodyPart ?? null } : null,
        ppg: null,
        proj: null,
        metric: null,
        matchupTeam: null,
        matchupLine: null,
        why: [],
        reason: isOut(status)
          ? `Listed ${status}${r.injuryBodyPart ? ` (${r.injuryBodyPart.toLowerCase()})` : ""} and yet to log a 2026 snap; ${Math.round(owned(r.id))}% rostered is a stash, not a start.`
          : `No 2026 usage on record yet, so there is no role to start him on; ${Math.round(owned(r.id))}% rostered.`,
        rostered: owned(r.id),
        leverage: null,
      });
    }
    // The defense, when enough leagues roster it for the call to matter.
    const dst = owned(side.team.code.toUpperCase());
    const oppImplied = otherOf(side.key).implied;
    if (dst >= 5 && oppImplied !== null) {
      const verdict: Verdict = oppImplied <= 19 ? "START" : oppImplied >= 24 ? "SIT" : "FLEX";
      const reason =
        verdict === "SIT"
          ? `Never start a defense at a ${exact(oppImplied)}-point implied total against it. The ${otherOf(side.key).team.nickname} carry the ${rankWord(otherOf(side.key).impliedRank ?? 0, "highest")} implied total of the week.`
          : verdict === "START"
            ? `The ${otherOf(side.key).team.nickname} are implied for just ${exact(oppImplied)} points, the ${rankWord(slate.length - (otherOf(side.key).impliedRank ?? slate.length) + 1, "lowest")} of the week: fewer points against and more sack and turnover chances.`
            : `A ${exact(oppImplied)}-point implied total against sits mid-slate: playable as a streamer, not a lock.`;
      board[side.key].push({
        side: side.key,
        name: `${side.team.nickname} D/ST`,
        pos: "DST",
        slug: null,
        verdict,
        reason,
        rostered: dst,
        leverage: null,
        team: code(side.team),
        out: false,
        injury: null,
        ppg: null,
        proj: null,
        metric: `${exact(oppImplied)}-point implied total against`,
        matchupTeam: code(otherOf(side.key).team),
        matchupLine: null,
        why: [reason],
      });
    }
  }
  // Unavailable players close each column, after the role/matchup sits.
  const order: Record<Verdict, number> = { "MUST START": 0, START: 1, FLEX: 2, SIT: 3 };
  const rank = (r: BoardRow) => (r.out ? 4 : order[r.verdict]);
  for (const k of ["away", "home"] as SideKey[]) {
    board[k].sort((x, y) => rank(x) - rank(y) || (y.proj ?? -1) - (x.proj ?? -1) || y.rostered - x.rostered);
  }

  /* ---- Matchup Leverage: the 6-8 most relevant players, both teams mixed */

  const leverage: LeverageRow[] = facts
    .filter((f) => !isOut(f.injury?.injuryStatus))
    .sort((x, y) => y.rostered - x.rostered || y.ppg - x.ppg)
    .slice(0, 8)
    .map((f) => ({
      side: f.side,
      name: f.p.name,
      pos: f.p.pos,
      slug: f.p.slug,
      role: roleFact(f.p, sideOf(f.side).usage),
      defense: defenseFact(f, otherOf(f.side).team),
      chip: f.chip,
      verdict: verdictFor(f),
      ppg: f.ppg,
      roleStats: roleStats(f.p),
      defFpa: f.oppFpa,
      defRank: f.oppRank,
    }));

  const injuries = {
    away: injuryRows(away, owned, inputs.now, meeting),
    home: injuryRows(home, owned, inputs.now, meeting),
  };

  return {
    away,
    home,
    meeting,
    line,
    slateCount: slate.length,
    forecast: inputs.forecast,
    call: buildCall(away, home, line, facts, inputs.forecast, slate.length, meeting),
    board,
    leverage: leverage.length >= 3 ? leverage : [],
    leverageRead: leverage.length >= 3 ? leverageRead(leverage) : null,
    snapshotNote: snapshotNote(away, home),
    fpaNote: fpaNote(away, home),
    fpaHeadlines: fpaHeadlines(away, home, facts),
    injuries,
    h2h: buildH2h(data, meeting, line),
    injuryImpact: injuryImpact(away, home, injuries),
    usageThrough: usage?.throughWeek ?? null,
    updatedMs: Math.max(inputs.lines?.fetchedAt ?? 0, usage ? Date.parse(usage.builtAt) || 0 : 0),
  };

  /* ---- verdicts and reasons */

  function verdictFor(f: Fact): Verdict {
    if (isOut(f.injury?.injuryStatus)) return "SIT";
    const [must, start, flex] = CUTS[f.p.pos];
    if (f.adjRank <= must) return "MUST START";
    if (f.adjRank <= start) return "START";
    if (f.adjRank <= flex) return "FLEX";
    return "SIT";
  }

  /** The "Why this call" bullets: verdict logic, then usage, production, matchup, adjustment, injury. */
  function whyFor(f: Fact, side: PreviewSide, opp: PreviewSide): string[] {
    const p = f.p;
    const verdict = verdictFor(f);
    const status = f.injury?.injuryStatus ?? null;
    const note =
      f.chip === "proof"
        ? `A top-3 ${p.pos} pace makes him matchup-proof.`
        : f.chip === "down" && verdict !== "SIT"
          ? `Role beats matchup at ${p.pos} at this volume: keep him in, with a lower ceiling.`
          : f.chip === "up" && verdict === "SIT"
            ? `The matchup is soft, but there is too little volume to chase. Bench him unless you are desperate at ${p.pos}.`
            : f.chip === "up"
              ? `This is a soft matchup${side.implied !== null ? `, with a ${exact(side.implied)} implied total behind him` : ""}.`
              : null;
    const role = roleFact(p, side.usage);
    return [
      note,
      role ? `Usage: ${role}.` : null,
      `Production: ${one(f.ppg)} PPR points a game over ${p.games} ${p.games === 1 ? "game" : "games"}` +
        (f.posRank !== null ? `, ${p.pos}${f.posRank} in the league.` : "."),
      `Matchup: ${defenseFact(f, opp.team)}.`,
      `Adjustment: defense ${nudge(f.matchup)}, team total ${nudge(f.script)}` +
        (side.implied !== null ? ` (${exact(side.implied)} implied)` : " (no line yet)") +
        `, for ${one(f.adjusted)} projected.`,
      status ? `Injury: listed ${status}${f.injury?.injuryBodyPart ? ` (${f.injury.injuryBodyPart.toLowerCase()})` : ""}.` : null,
    ].filter((x): x is string => !!x);
  }

  function reasonFor(f: Fact, side: PreviewSide, opp: PreviewSide): string {
    const p = f.p;
    const status = f.injury?.injuryStatus ?? null;
    const verdict = verdictFor(f);
    if (isOut(status)) {
      return `Listed ${status}${f.injury?.injuryBodyPart ? ` (${f.injury.injuryBodyPart.toLowerCase()})` : ""}, so his ${one(f.ppg)} PPR points a game come off your lineup this week. See the Injury Watch below for who absorbs the work.`;
    }
    const role = (() => {
      if (p.pos === "QB") {
        const rush = p.rushYards && p.games ? p.rushYards / p.games : 0;
        return `${one(f.ppg)} PPR points a game${rush >= 20 ? `, with ${Math.round(rush)} rushing yards a game` : ""}`;
      }
      if (p.pos === "RB") return `${one(f.ppg)} PPR points a game on a ${pct(p.snapShare)} snap share`;
      return `${one(f.ppg)} PPR points a game on a ${p.targetShare === null ? "-" : `${one(p.targetShare)}%`} target share`;
    })();
    const defense =
      f.oppRank === null
        ? null
        : `the ${opp.team.nickname} allow the ${allowPhrase(f.oppRank)} ${p.pos} fantasy points`;
    const q = status === "Questionable" ? " Questionable: confirm he is active 90 minutes before kickoff." : "";

    if (!defense) return `${capital(role)}.${q}`;
    if (f.chip === "proof") return `${capital(role)}, a top-3 ${p.pos} pace, which makes him matchup-proof even though ${defense}.${q}`;
    if (f.chip === "down" && verdict !== "SIT") {
      return `${capital(role)}, but ${defense}. Role beats matchup at ${p.pos} at this volume; keep him in, with a lower ceiling.${q}`;
    }
    if (f.chip === "up" && verdict === "SIT") {
      return `${capital(defense)}, but ${role} is too little volume to chase. Bench him unless you are desperate at ${p.pos}.${q}`;
    }
    if (f.chip === "up") {
      const script = side.implied !== null ? `, with a ${exact(side.implied)} implied total behind him` : "";
      return `${capital(role)}. ${capital(defense)}${script}.${q}`;
    }
    return `${capital(role)}; ${defense}.${q}`;
  }
}

/** The one usage number the card leads with, after PPG. */
function metricFor(p: UsagePlayer): string | null {
  if (p.pos === "QB") {
    const rush = p.rushYards && p.games ? p.rushYards / p.games : 0;
    return rush >= 20 ? `${Math.round(rush)} rush yds/g` : null;
  }
  if (p.pos === "RB") return p.snapShare === null ? null : `${pct(p.snapShare)} snap share`;
  return p.targetShare === null ? null : `${one(p.targetShare)}% target share`;
}

/** "+4%" / "-2%" / "even" for a multiplier. */
function nudge(m: number): string {
  const d = Math.round((m - 1) * 100);
  return d === 0 ? "even" : d > 0 ? `+${d}%` : `${d}%`;
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* --------------------------------------------------------------- leverage */

/** The role column as number + label pairs, numbers first (mak, 2026-10-05). */
function roleStats(p: UsagePlayer): Array<{ v: string; k: string }> {
  const out: Array<{ v: string; k: string } | null> = [];
  if (p.pos === "QB") {
    const rush = p.rushYards && p.games ? Math.round(p.rushYards / p.games) : null;
    out.push(rush !== null ? { v: String(rush), k: "rush yds/g" } : null);
    out.push(p.rzTouches ? { v: String(p.rzTouches), k: p.rzTouches === 1 ? "RZ opp" : "RZ opps" } : null);
  } else if (p.pos === "RB") {
    out.push(p.snapShare !== null ? { v: pct(p.snapShare), k: "snaps" } : null);
    out.push(p.touchShare != null ? { v: `${Math.round(p.touchShare)}%`, k: "RB touches" } : { v: String(p.carries), k: "carries" });
    out.push({ v: String(p.rzTouches), k: p.rzTouches === 1 ? "RZ touch" : "RZ touches" });
  } else {
    out.push(p.targetShare !== null ? { v: `${one(p.targetShare)}%`, k: "targets" } : null);
    if (p.pos === "WR") out.push(p.adot !== null ? { v: one(p.adot), k: "aDOT" } : null);
    if (p.pos === "TE") out.push(p.snapShare !== null ? { v: pct(p.snapShare), k: "snaps" } : null);
  }
  return out.filter((x): x is { v: string; k: string } => !!x);
}

/**
 * The read above the table: the counts, the best edge (softest spot), the
 * biggest fade (stingiest spot) and one place role and matchup disagree.
 */
function leverageRead(rows: LeverageRow[]): LeverageRead {
  const up = rows.filter((r) => r.chip === "up");
  const down = rows.filter((r) => r.chip === "down");
  const conflictRow =
    [...down.filter((r) => r.verdict !== "SIT")].sort((x, y) => y.ppg - x.ppg)[0] ??
    [...up.filter((r) => r.verdict === "SIT")].sort((x, y) => y.ppg - x.ppg)[0] ??
    null;
  const conflict = conflictRow
    ? {
        row: conflictRow,
        text: conflictRow.chip === "down" ? "Role beats a tough matchup" : "Soft matchup, thin role",
      }
    : null;
  const edge = [...up].sort((x, y) => (x.defRank ?? 99) - (y.defRank ?? 99) || y.ppg - x.ppg)[0] ?? null;
  const fades = [...down].sort((x, y) => (y.defRank ?? 0) - (x.defRank ?? 0) || y.ppg - x.ppg);
  const fade = fades.find((r) => r !== conflictRow) ?? fades[0] ?? null;
  return {
    up: up.length,
    neutral: rows.length - up.length - down.length,
    down: down.length,
    edge,
    fade,
    conflict,
  };
}

/** 1-2 usage facts, worded and rounded the way the Usage Report prints them. */
function roleFact(p: UsagePlayer, team: UsageTeam | null): string {
  if (p.pos === "QB") {
    const rush = p.rushYards && p.games ? Math.round(p.rushYards / p.games) : null;
    const parts = [
      rush !== null ? `${rush} rush yds/g` : null,
      p.rzTouches ? `${p.rzTouches} red-zone ${p.rzTouches === 1 ? "carry or target" : "carries + targets"}` : null,
      team?.env.passRate?.value != null ? `team pass rate ${team.env.passRate.value}%` : null,
    ].filter(Boolean);
    return parts.slice(0, 2).join(" · ");
  }
  if (p.pos === "RB") {
    return [
      `${pct(p.snapShare)} snap share`,
      p.touchShare != null ? `${Math.round(p.touchShare)}% of RB touches` : `${p.carries} carries`,
      `${p.rzTouches} red-zone ${p.rzTouches === 1 ? "touch" : "touches"}`,
    ].join(" · ");
  }
  return [
    p.targetShare !== null ? `${one(p.targetShare)}% target share` : null,
    p.pos === "WR" && p.adot !== null ? `${one(p.adot)} aDOT` : null,
    p.pos === "TE" && p.snapShare !== null ? `${pct(p.snapShare)} snap share` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function defenseFact(
  f: { p: UsagePlayer; oppRank: number | null; oppFpa: number | null },
  opp: NflTeam,
): string {
  if (f.oppRank === null || f.oppFpa === null) return `No points-allowed data for the ${opp.nickname} yet`;
  return `${opp.nickname} allow ${one(f.oppFpa)} ${f.p.pos} pts/g, the ${allowPhrase(f.oppRank)}`;
}

/* --------------------------------------------------------------- the call */

function scoreShare(c: TeamCoaching | null, label: RegExp): { share: number; plays: number } | null {
  const row = c?.scoreState?.rows.find((r) => label.test(r.label));
  if (!row || typeof row.share !== "number") return null;
  const plays = Number(/(\d+) plays/.exec(String(row.result ?? ""))?.[1] ?? 0);
  return { share: row.share, plays };
}

function buildCall(
  away: PreviewSide,
  home: PreviewSide,
  line: GameLine | null,
  facts: Array<{ side: SideKey; p: UsagePlayer; ppg: number; oppRank: number | null; oppFpa: number | null }>,
  forecast: Forecast | null,
  slateCount: number,
  meeting: Meeting,
): Preview["call"] {
  if (!line || line.spread === null || line.total === null || away.implied === null || home.implied === null) return null;
  const spread = line.spread;
  const size = Math.abs(spread);
  const fav = spread < 0 ? home : spread > 0 ? away : null;
  const dog = fav ? (fav === home ? away : home) : null;
  const sentences: string[] = [];

  const topBy = (side: PreviewSide, pos: Pos[]) =>
    facts
      .filter((f) => f.side === side.key && pos.includes(f.p.pos))
      .sort((x, y) => y.ppg - x.ppg)[0]?.p ?? null;

  // 1. The market.
  if (fav && dog) {
    sentences.push(
      `The ${fav.team.nickname} are ${trimZero(size)}-point ${fav === home ? "home" : "road"} favorites with a ${exact(fav.implied!)} implied total` +
        `${fav.impliedRank ? ` (the ${rankWord(fav.impliedRank, "highest")} of ${slateCount} this week)` : ""}, against ${exact(dog.implied!)} for the ${dog.team.nickname}.`,
    );
  } else {
    sentences.push(
      `A pick'em with a ${trimZero(line.total)} total: ${exact(away.implied)} implied points for the ${away.team.nickname}, ${exact(home.implied)} for the ${home.team.nickname}.`,
    );
  }

  // 2-3. Score-state tendencies from the Coaching Profile.
  if (fav && dog) {
    const lead = scoreShare(fav.coaching, /^Leading/i);
    const close = scoreShare(fav.coaching, /^Within/i);
    const rb = topBy(fav, ["RB"]);
    if (lead && close) {
      const runs = lead.share <= close.share - 3;
      sentences.push(
        `When leading by 7+, the ${fav.team.nickname} pass on ${lead.share}% of plays against ${close.share}% in one-score games` +
          (runs && rb
            ? `, so a lead hands the late volume to ${rb.name}.`
            : `, so a lead does not slow their passing game much.`),
      );
    }
    const trail = scoreShare(dog.coaching, /^Trailing/i);
    const dogClose = scoreShare(dog.coaching, /^Within/i);
    const qb = topBy(dog, ["QB"]);
    const target = topBy(dog, ["WR", "TE"]);
    if (trail && size >= 3) {
      sentences.push(
        `Trailing by 7+, the ${dog.team.nickname} pass ${trail.share}% of the time${dogClose ? ` (${dogClose.share}% in one-score games)` : ""}` +
          (qb || target
            ? `, which is where ${[qb?.name, target?.name].filter(Boolean).join(" and ")} earn their volume.`
            : "."),
      );
    }
  }

  // 4. The biggest points-allowed leak in the game.
  const leaks = facts
    .filter((f) => f.oppRank !== null && f.oppRank <= 10)
    .sort((x, y) => (x.oppRank ?? 99) - (y.oppRank ?? 99) || y.ppg - x.ppg);
  const leak = leaks[0];
  if (leak) {
    const def = leak.side === "away" ? home : away;
    sentences.push(
      `The ${def.team.nickname} allow the ${allowPhrase(leak.oppRank!)} ${leak.p.pos} fantasy points (${one(leak.oppFpa!)} a game), the best leverage spot here for ${leak.p.name}.`,
    );
  }

  // 5. Pace.
  const plays = (s: PreviewSide) => s.usage?.env.playsPerGame ?? null;
  const pa = plays(away);
  const ph = plays(home);
  if (pa?.value != null && ph?.value != null && pa.rank != null && ph.rank != null) {
    const fast = pa.rank <= 12 && ph.rank <= 12;
    const slow = pa.rank >= 21 && ph.rank >= 21;
    if (fast || slow) {
      sentences.push(
        `Both offenses run ${fast ? "plenty of" : "few"} plays (${away.team.nickname} ${one(pa.value)} a game, ${ordinal(pa.rank)}; ${home.team.nickname} ${one(ph.value)}, ${ordinal(ph.rank)}), ${fast ? "which props up volume on both sides" : "which caps the number of possessions both ways"}.`,
      );
    }
  }

  // 6. Weather.
  if (line.indoor) {
    sentences.push(`It is indoors, so there is no weather discount.`);
  } else if (forecast && forecast.windMph !== null) {
    if (forecast.windMph >= 15) {
      sentences.push(
        `Kickoff wind is forecast at ${forecast.windMph} mph, enough to trim deep passing and long kicks; ceilings lean run game.`,
      );
    } else if ((forecast.precipPct ?? 0) >= 50) {
      sentences.push(`Rain is likely at kickoff (${forecast.precipPct}% chance), which favors short passes and the run game.`);
    } else {
      sentences.push(`The kickoff forecast (${forecast.tempF ?? "-"}°F, wind ${forecast.windMph} mph) carries no weather discount.`);
    }
  }

  if (sentences.length < 3) return null;

  const thesis = !fav || !dog
    ? "A coin-flip script: neither side gets to dictate"
    : size >= 7
      ? `The ${fav.team.nickname} should control this one; the ${dog.team.nickname} chase it`
      : size >= 3
        ? `${fav.team.nickname} lean, but this is a one-score script`
        : "A coin-flip script: neither side gets to dictate";

  // -1 = away controls, +1 = home controls.
  const lean = Math.max(-1, Math.min(1, -spread / 14));
  const leanText = !fav
    ? "Projected script: competitive"
    : size < 3
      ? "Projected script: competitive"
      : `Projected script: ${fav.team.code.toUpperCase()} controls (${trimZero(size)}-point favorite${size >= 7 ? "" : ", one-score game"})`;

  void meeting;
  return { thesis, paragraph: sentences.join(" "), lean, leanText };
}

/* ---------------------------------------------------------------- notes */

const POS_GROUP: Record<Pos, string> = { QB: "quarterback", RB: "backfield", WR: "receivers", TE: "tight ends" };

/**
 * The StatChasers matchup read under the team profile (mak, 2026-10-05: shorter
 * and directional). Which offense is weaker, then where the fantasy leverage
 * tilts: the softest defense-vs-position spot on the page.
 */
function snapshotNote(away: PreviewSide, home: PreviewSide): string | null {
  const ao = findRow(away.stats, "off-points");
  const ho = findRow(home.stats, "off-points");
  const parts: string[] = [];
  if (ao?.rank && ho?.rank && ao.rank !== ho.rank) {
    const [weak, row] = ao.rank > ho.rank ? [away, ao] : [home, ho];
    parts.push(`The ${weak.team.nickname} bring the weaker offense (${ordinal(row.rank!)} in scoring, ${row.value} a game).`);
  }
  if (away.fpa && home.fpa) {
    const spots = [away, home].flatMap((def) =>
      (["QB", "RB", "WR", "TE"] as Pos[]).map((pos) => ({ def, off: def === away ? home : away, pos, ...def.fpa!.byPos[pos] })),
    );
    const soft = spots.sort((x, y) => x.rank - y.rank)[0]!;
    const other = (soft.def === away ? home : away).fpa!.byPos[soft.pos];
    if (soft.rank <= 10) {
      parts.push(
        `The ${soft.def.team.nickname}' defense gives up the ${allowPhrase(soft.rank)} ${soft.pos} points` +
          (other.rank > soft.rank ? `, against the ${(soft.def === away ? home : away).team.nickname}' ${allowPhrase(other.rank)}` : "") +
          `, which tilts the best fantasy leverage toward the ${soft.off.team.nickname}' ${POS_GROUP[soft.pos]}.`,
      );
    } else {
      parts.push(`Neither defense is soft at any position, so lineups here lean on role more than matchup.`);
    }
  }
  return parts.length ? parts.join(" ") : null;
}

function fpaNote(away: PreviewSide, home: PreviewSide): string | null {
  if (!away.fpa || !home.fpa) return null;
  return `1st = most fantasy points allowed, so a lower rank (and a bigger number) means a softer defense.`;
}

/** The softest and the toughest defense-vs-position spot, for the headline cells. */
function fpaHeadlines(
  away: PreviewSide,
  home: PreviewSide,
  facts: Array<{ side: SideKey; p: UsagePlayer; ppg: number }>,
): { soft: FpaHeadline; tough: FpaHeadline } | null {
  if (!away.fpa || !home.fpa) return null;
  const spots = [away, home].flatMap((def) =>
    (["QB", "RB", "WR", "TE"] as Pos[]).map((pos) => ({ def, off: def === away ? home : away, pos, ...def.fpa!.byPos[pos] })),
  );
  const soft = [...spots].sort((x, y) => x.rank - y.rank)[0]!;
  const tough = [...spots].sort((x, y) => y.rank - x.rank)[0]!;
  const who =
    facts.filter((f) => f.side === soft.off.key && f.p.pos === soft.pos).sort((x, y) => y.ppg - x.ppg)[0]?.p.name ?? null;
  return {
    soft: { def: code(soft.def.team), pos: soft.pos, fpa: soft.fpa, rank: soft.rank, who },
    tough: { def: code(tough.def.team), pos: tough.pos, fpa: tough.fpa, rank: tough.rank, who: null },
  };
}

/* ---------------------------------------------------------------- injuries */

function injuryRows(
  side: PreviewSide,
  owned: (id: string) => number,
  now: number,
  meeting: Meeting,
): InjuryRow[] {
  const players = side.usage?.players ?? [];
  const usageOf = (r: RosterPlayer) => players.find((p) => p.sleeperId === r.id) ?? null;
  const healthy = (p: UsagePlayer) => {
    const r = side.roster.find((x) => x.id === p.sleeperId);
    return !r || !isOut(r.injuryStatus);
  };
  const listed = side.roster
    .filter((r) => r.injuryStatus && (owned(r.id) >= 1 || (usageOf(r)?.games ?? 0) > 0))
    .sort((x, y) => owned(y.id) - owned(x.id));

  const kickoff =
    meeting.kickoffMs !== null
      ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(meeting.kickoffMs) + " ET"
      : null;

  const rows: InjuryRow[] = listed.slice(0, 6).map((r) => {
    const status = r.injuryStatus!;
    const u = usageOf(r);
    const out = isOut(status);
    const practice = r.practice ? ` Practice: ${r.practice.replace(/ in Practice$/i, "").toLowerCase()}.` : "";
    const timing =
      status === "Questionable"
        ? ` Game-time decision: inactives post 90 minutes before the ${kickoff ?? "kickoff"}${kickoff ? " kickoff" : ""}.`
        : "";
    let fallout: string;
    let impact: InjuryRow["impact"] = status === "Questionable" ? "watch" : out ? "out" : "watch";
    let beneficiary: InjuryRow["beneficiary"] = null;
    const mates = (pos: Pos[]) =>
      players
        .filter((p) => p.id !== u?.id && pos.includes(p.pos) && healthy(p) && p.targetShare !== null)
        .sort((x, y) => (y.targetShare ?? 0) - (x.targetShare ?? 0));
    const minor =
      !!u && owned(r.id) < 5 && (u.targetShare ?? 0) < 8 && (u.snapShare ?? 0) < 25 && (u.pos !== "RB" || (u.snapShare ?? 0) < 15);
    if (minor && u) {
      impact = "none";
      fallout = `Depth piece (${pct(u.snapShare)} of snaps, ${u.targetShare === null ? "no" : `${one(u.targetShare)}%`} target share); no lineup impact either way.`;
    } else if (!u || !u.games) {
      impact = "none";
      fallout = `Has not played in 2026, so today's ${side.team.nickname} roles already account for his absence.`;
    } else if (u.pos === "WR" || u.pos === "TE") {
      const next = mates(["WR", "TE"]).slice(0, 2);
      const share = u.targetShare !== null ? `${one(u.targetShare)}% target share` : "targets";
      const flow = next.length
        ? `${next.map((p) => `${p.name} (${one(p.targetShare!)}%)`).join(" and ")} ${next.length > 1 ? "are" : "is"} next in line`
        : "nobody on the roster has a clear claim to it";
      if (out && next[0]) beneficiary = { name: next[0].name, pos: next[0].pos };
      fallout = out
        ? `His ${share} is open; ${flow}.`
        : `If he sits, his ${share} flows first to ${next[0] ? `${next[0].name} (${one(next[0].targetShare!)}%)` : "the depth chart"}.`;
    } else if (u.pos === "RB") {
      const rbs = players.filter((p) => p.pos === "RB" && p.games > 0).sort((x, y) => (y.snapShare ?? 0) - (x.snapShare ?? 0));
      const lead = rbs[0];
      if (lead && lead.id !== u.id) {
        // A backup: out costs nothing this week; questionable is still worth a look.
        if (out) impact = "none";
        fallout = `Handcuff alert for ${lead.name} managers: ${u.name} is a backup (${pct(u.snapShare)} of snaps), so the ${lead.name} handcuff chain is thinner until he is back.`;
      } else {
        const next = rbs.find((p) => p.id !== u.id && healthy(p));
        if (out && next) beneficiary = { name: next.name, pos: next.pos };
        fallout = next
          ? `${out ? "With him out" : "If he sits"}, ${next.name} (${pct(next.snapShare)} of snaps so far) leads the backfield; his ${one(pprPpg(u) ?? 0)} PPR points a game need replacing.`
          : `${out ? "With him out" : "If he sits"}, the ${side.team.nickname} have no back with a real 2026 role behind him.`;
      }
    } else {
      const qbs = players.filter((p) => p.pos === "QB" && p.games > 0).sort((x, y) => y.dropbacks - x.dropbacks);
      const starter = qbs[0];
      if (starter && starter.id !== u.id) impact = "none";
      fallout =
        starter && starter.id !== u.id
          ? `No fantasy fallout while ${starter.name} starts.`
          : `${out ? "With him out" : "If he sits"}, downgrade every ${side.team.nickname} pass catcher until the backup proves otherwise.`;
    }
    return {
      status,
      chip: chipCode(status),
      name: r.name,
      pos: r.position,
      fallout: (fallout + practice + timing).trim(),
      rostered: owned(r.id),
      impact,
      beneficiary,
      ppg: u ? pprPpg(u) : null,
    };
  });

  const relevant = rows.filter((row) => {
    const r = listed.find((x) => x.name === row.name);
    return r && owned(r.id) >= 5 && r.injuryStatus !== "IR";
  });
  if (relevant.length === 0) {
    rows.push({
      status: "Healthy",
      chip: "OK",
      name: "Clean sheet",
      pos: "",
      fallout:
        `${rows.length ? "Apart from the depth and long-term absences above, no" : "No"} ${side.team.nickname} player rostered in 5%+ of leagues ` +
        `carries a designation this week, so every role in the Usage Report is available.`,
      rostered: 0,
      impact: "none",
      beneficiary: null,
      ppg: null,
    });
  }
  void now;
  return rows;
}

/**
 * The Injury Impact strip: who gains most from an absence (the absence worth
 * the most points a game), who to watch (designations that still decide a
 * lineup), and the listings that change nothing.
 */
function injuryImpact(
  away: PreviewSide,
  home: PreviewSide,
  injuries: Record<SideKey, InjuryRow[]>,
): InjuryImpact | null {
  const rows = (["away", "home"] as SideKey[]).flatMap((k) =>
    injuries[k].filter((r) => r.chip !== "OK").map((r) => ({ r, team: code((k === "away" ? away : home).team) })),
  );
  if (!rows.length) return null;
  const gain = rows
    .filter((x) => x.r.impact === "out" && x.r.beneficiary)
    .sort((x, y) => (y.r.ppg ?? 0) - (x.r.ppg ?? 0))[0];
  return {
    beneficiary: gain
      ? { name: gain.r.beneficiary!.name, team: gain.team, pos: gain.r.beneficiary!.pos, because: `${gain.r.name} ${gain.r.status === "IR" ? "on IR" : "out"}` }
      : null,
    watch: rows.filter((x) => x.r.impact === "watch").map((x) => ({ name: x.r.name, team: x.team })),
    none: rows.filter((x) => x.r.impact === "none").map((x) => ({ name: x.r.name, team: x.team })),
  };
}

/* --------------------------------------------------------------- head to head */

function buildH2h(data: MatchupData, meeting: Meeting, line: GameLine | null): H2hStrip | null {
  const since = data.state.season - 5;
  const played = [...data.thisSeason, ...data.history]
    .filter((m) => m.status === "final" && m.score && m.season >= since)
    .sort((x, y) => (y.kickoffMs ?? 0) - (x.kickoffMs ?? 0));
  if (!played.length) return null;

  const home = meeting.home;
  const awayT = meeting.away;
  let hw = 0;
  let aw = 0;
  let ties = 0;
  for (const m of played) {
    if (!m.winner) ties += 1;
    else if (m.winner.abbreviation === home.abbreviation) hw += 1;
    else aw += 1;
  }
  const leader = hw === aw ? null : hw > aw ? home : awayT;
  const record =
    leader === null
      ? `Even ${hw}-${aw}${ties ? `-${ties}` : ""}`
      : `${leader.code.toUpperCase()} ${Math.max(hw, aw)}-${Math.min(hw, aw)}${ties ? `-${ties}` : ""}`;

  const totals = played.map((m) => m.score!.home + m.score!.away);
  const avg = totals.reduce((s, x) => s + x, 0) / totals.length;
  const total = line?.total ?? null;
  const avgVsTotal =
    total === null
      ? null
      : Math.abs(avg - total) <= 1.5
        ? `The total (${trimZero(total)}) sits right on the series number`
        : avg > total
          ? `${one(avg - total)} above this game's ${trimZero(total)} total`
          : `${one(total - avg)} below this game's ${trimZero(total)} total`;

  // Third fact: the home team's record at home in the series.
  const atHome = played.filter((m) => m.home.abbreviation === home.abbreviation && !m.neutralSite);
  const homeWins = atHome.filter((m) => m.winner?.abbreviation === home.abbreviation).length;
  const third = atHome.length
    ? { value: `${homeWins}-${atHome.length - homeWins}`, label: `${home.nickname} at home · since ${since}` }
    : null;

  const returnMeeting =
    data.thisSeason.find(
      (m) => m !== meeting && m.status !== "final" && (m.kickoffMs ?? 0) > (meeting.kickoffMs ?? 0),
    ) ?? null;

  const overs = total === null ? null : totals.filter((t) => t > total).length;
  const lede =
    `These two have met ${played.length} time${played.length === 1 ? "" : "s"} since ${since}, averaging ${one(avg)} combined points` +
    (total !== null
      ? `; ${overs} of those ${played.length} game${played.length === 1 ? "" : "s"} would have gone over this week's ${trimZero(total)}, so ` +
        (Math.abs(avg - total) <= 1.5
          ? `the market has priced this one right at the series norm.`
          : avg > total
            ? `the market expects a lower-scoring game than this series usually produces - a nudge toward the run game and the defenses.`
            : `the market expects more points than this series usually produces, which favors the pass catchers on both sides.`)
      : ".") +
    (returnMeeting
      ? ` The return meeting is ${returnMeeting.weekLabel}${returnMeeting.venue ? ` at ${returnMeeting.venue}` : ` in ${returnMeeting.home.city}`}.`
      : "");

  // Series trend: the leader's share and the average margin, from the
  // leader's side (or either way when the series is level).
  const margins = played.map((m) => {
    const diff = m.score!.home - m.score!.away;
    return leader ? (m.home.abbreviation === leader.abbreviation ? diff : -diff) : Math.abs(diff);
  });
  const avgMargin = margins.reduce((s, x) => s + x, 0) / margins.length;
  const trend = leader
    ? {
        text: `The ${leader.nickname} have won ${Math.max(hw, aw)} of the last ${played.length} meetings.`,
        margin: avgMargin >= 0 ? `Average margin: ${leader.nickname} by ${one(avgMargin)}.` : `Average margin: ${one(-avgMargin)} the other way.`,
      }
    : { text: `The series is level at ${hw}-${aw}${ties ? `-${ties}` : ""} over the last ${played.length} meetings.`, margin: `Average margin: ${one(avgMargin)} points.` };

  return { since, games: played, record, avgPoints: avg, avgVsTotal, third, lede, returnMeeting, trend };
}
