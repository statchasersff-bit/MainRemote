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
 * - positional points allowed from the FPA table, half-PPR, which is the
 *   format the board is called for;
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
  reason: string;
  rostered: number;
  leverage: Leverage | null;
}

export interface LeverageRow {
  side: SideKey;
  name: string;
  pos: Pos;
  slug: string | null;
  role: string;
  defense: string;
  chip: Leverage;
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
  snapshotNote: string | null;
  fpaNote: string | null;
  injuries: Record<SideKey, InjuryRow[]>;
  h2h: H2hStrip | null;
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

/** Half-PPR points a game, from the usage file's PPR figure. */
function halfPpg(p: UsagePlayer): number | null {
  if (p.fpPerGame === null || !p.games) return null;
  return p.fpPerGame - (0.5 * p.receptions) / p.games;
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

/** Verdict cut-offs: league position rank (by adjusted half-PPR ppg). */
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
  /** Raw half-PPR ppg per position, best first - the cut-off ladder. */
  ladder: Record<Pos, number[]>;
  rankOf(p: UsagePlayer): number | null;
}

function buildLeague(doc: UsageDoc): League {
  const pools: Record<Pos, Array<{ id: string; ppg: number }>> = { QB: [], RB: [], WR: [], TE: [] };
  const minGames = Math.min(2, Math.max(1, doc.throughWeek - 1));
  for (const team of Object.values(doc.teams)) {
    for (const p of team.players) {
      const ppg = halfPpg(p);
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
  }
  const facts: Fact[] = [];
  for (const side of [away, home]) {
    const opp = otherOf(side.key);
    for (const p of side.usage?.players ?? []) {
      const ppg = halfPpg(p);
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
      });
    }
  }

  const board: Record<SideKey, BoardRow[]> = { away: [], home: [] };
  for (const f of facts) {
    board[f.side].push({
      side: f.side,
      name: f.p.name,
      pos: f.p.pos,
      slug: f.p.slug,
      verdict: verdictFor(f),
      reason: reasonFor(f, sideOf(f.side), otherOf(f.side)),
      rostered: f.rostered,
      leverage: f.chip,
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
      });
    }
  }
  const order: Record<Verdict, number> = { "MUST START": 0, START: 1, FLEX: 2, SIT: 3 };
  for (const k of ["away", "home"] as SideKey[]) {
    board[k].sort((x, y) => order[x.verdict] - order[y.verdict] || y.rostered - x.rostered);
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
    snapshotNote: snapshotNote(away, home),
    fpaNote: fpaNote(away, home, facts),
    injuries,
    h2h: buildH2h(data, meeting, line),
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

  function reasonFor(f: Fact, side: PreviewSide, opp: PreviewSide): string {
    const p = f.p;
    const status = f.injury?.injuryStatus ?? null;
    const verdict = verdictFor(f);
    if (isOut(status)) {
      return `Listed ${status}${f.injury?.injuryBodyPart ? ` (${f.injury.injuryBodyPart.toLowerCase()})` : ""}, so his ${one(f.ppg)} half-PPR points a game come off your lineup this week. See the Injury Watch below for who absorbs the work.`;
    }
    const role = (() => {
      if (p.pos === "QB") {
        const rush = p.rushYards && p.games ? p.rushYards / p.games : 0;
        return `${one(f.ppg)} half-PPR points a game${rush >= 20 ? `, with ${Math.round(rush)} rushing yards a game` : ""}`;
      }
      if (p.pos === "RB") return `${one(f.ppg)} half-PPR points a game on a ${pct(p.snapShare)} snap share`;
      return `${one(f.ppg)} half-PPR points a game on a ${p.targetShare === null ? "-" : `${one(p.targetShare)}%`} target share`;
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

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* --------------------------------------------------------------- leverage */

/** 1-2 usage facts, worded and rounded the way the Usage Report prints them. */
function roleFact(p: UsagePlayer, team: UsageTeam | null): string {
  if (p.pos === "QB") {
    const rush = p.rushYards && p.games ? Math.round(p.rushYards / p.games) : null;
    const parts = [
      rush !== null ? `${rush} rush yds/g` : null,
      p.rzTouches ? `${p.rzTouches} red-zone carries + targets` : null,
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

function snapshotNote(away: PreviewSide, home: PreviewSide): string | null {
  const r = (s: PreviewSide, key: string) => findRow(s.stats, key);
  const ao = r(away, "off-points");
  const ho = r(home, "off-points");
  const ad = r(away, "def-points");
  const hd = r(home, "def-points");
  if (!ao?.rank || !ho?.rank || !ad?.rank || !hd?.rank) return null;
  // The mismatch that matters most: the bigger gap between an offense's rank
  // and the defense it faces.
  const gapA = hd.rank - ao.rank; // > 0: away offense better than home defense
  const gapH = ad.rank - ho.rank;
  const [off, offRow, def, defRow, other, otherRow] =
    Math.abs(gapA) >= Math.abs(gapH)
      ? [away, ao, home, hd, home, ho]
      : [home, ho, away, ad, away, ao];
  const edge =
    offRow.rank! >= 17 && defRow.rank! >= 17
      ? `two below-average units, so something gives`
      : offRow.rank! <= 16 && defRow.rank! <= 16
        ? `strength against strength`
        : offRow.rank! < defRow.rank!
          ? `the offense has the edge on paper`
          : `the defense has the edge on paper`;
  const tail =
    otherRow.rank! >= 23
      ? ` The ${other.team.nickname}' own offense (${ordinal(otherRow.rank!)} in scoring, ${otherRow.value} a game) keeps handing the ball back, so they cannot win a trade of possessions.`
      : otherRow.rank! <= 10
        ? ` The ${other.team.nickname} can answer: their offense is ${ordinal(otherRow.rank!)} in scoring at ${otherRow.value} a game.`
        : ` The ${other.team.nickname}' offense sits ${ordinal(otherRow.rank!)} in scoring (${otherRow.value} a game).`;
  return (
    `The shape of the game in one line: the ${off.team.nickname} offense (${ordinal(offRow.rank!)} in scoring, ${offRow.value} a game) against a ${def.team.nickname} defense ${ordinal(defRow.rank!)} in points allowed (${defRow.value}), and ${edge}.` +
    tail
  );
}

function fpaNote(
  away: PreviewSide,
  home: PreviewSide,
  facts: Array<{ side: SideKey; p: UsagePlayer; ppg: number; oppRank: number | null }>,
): string | null {
  if (!away.fpa || !home.fpa) return null;
  const leaks: string[] = [];
  for (const def of [away, home]) {
    const offense = def === away ? home : away;
    const soft = (["QB", "RB", "WR", "TE"] as Pos[])
      .map((pos) => ({ pos, ...def.fpa!.byPos[pos] }))
      .filter((x) => x.rank <= 10)
      .sort((x, y) => x.rank - y.rank)[0];
    if (!soft) continue;
    const who = facts
      .filter((f) => f.side === offense.key && f.p.pos === soft.pos)
      .sort((x, y) => y.ppg - x.ppg)[0];
    leaks.push(
      `the ${def.team.nickname} allow the ${allowPhrase(soft.rank)} ${soft.pos} points (${one(soft.fpa)} a game)${who ? `, which sets up ${who.p.name}` : ""}`,
    );
  }
  const head = leaks.length
    ? `Headline leaks: ${leaks.join("; ")}.`
    : `Neither defense ranks in the 10 softest at any position, so no spot here is a points-allowed upgrade.`;
  return `How to read it: 1st = most fantasy points allowed, so a lower rank (and a bigger number) means a softer defense. ${head}`;
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
    const mates = (pos: Pos[]) =>
      players
        .filter((p) => p.id !== u?.id && pos.includes(p.pos) && healthy(p) && p.targetShare !== null)
        .sort((x, y) => (y.targetShare ?? 0) - (x.targetShare ?? 0));
    const minor =
      !!u && owned(r.id) < 5 && (u.targetShare ?? 0) < 8 && (u.snapShare ?? 0) < 25 && (u.pos !== "RB" || (u.snapShare ?? 0) < 15);
    if (minor && u) {
      fallout = `Depth piece (${pct(u.snapShare)} of snaps, ${u.targetShare === null ? "no" : `${one(u.targetShare)}%`} target share); no lineup impact either way.`;
    } else if (!u || !u.games) {
      fallout = `Has not played in 2026, so today's ${side.team.nickname} roles already account for his absence.`;
    } else if (u.pos === "WR" || u.pos === "TE") {
      const next = mates(["WR", "TE"]).slice(0, 2);
      const share = u.targetShare !== null ? `${one(u.targetShare)}% target share` : "targets";
      const flow = next.length
        ? `${next.map((p) => `${p.name} (${one(p.targetShare!)}%)`).join(" and ")} ${next.length > 1 ? "are" : "is"} next in line`
        : "nobody on the roster has a clear claim to it";
      fallout = out
        ? `His ${share} is open; ${flow}.`
        : `If he sits, his ${share} flows first to ${next[0] ? `${next[0].name} (${one(next[0].targetShare!)}%)` : "the depth chart"}.`;
    } else if (u.pos === "RB") {
      const rbs = players.filter((p) => p.pos === "RB" && p.games > 0).sort((x, y) => (y.snapShare ?? 0) - (x.snapShare ?? 0));
      const lead = rbs[0];
      if (lead && lead.id !== u.id) {
        fallout = `Handcuff alert for ${lead.name} managers: ${u.name} is a backup (${pct(u.snapShare)} of snaps), so the ${lead.name} handcuff chain is thinner until he is back.`;
      } else {
        const next = rbs.find((p) => p.id !== u.id && healthy(p));
        fallout = next
          ? `${out ? "With him out" : "If he sits"}, ${next.name} (${pct(next.snapShare)} of snaps so far) leads the backfield; his ${one(halfPpg(u) ?? 0)} half-PPR points a game need replacing.`
          : `${out ? "With him out" : "If he sits"}, the ${side.team.nickname} have no back with a real 2026 role behind him.`;
      }
    } else {
      const qbs = players.filter((p) => p.pos === "QB" && p.games > 0).sort((x, y) => y.dropbacks - x.dropbacks);
      const starter = qbs[0];
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
    });
  }
  void now;
  return rows;
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
    ? { value: `${homeWins}-${atHome.length - homeWins}`, label: `${home.nickname} at home since ${since}` }
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

  return { since, games: played, record, avgPoints: avg, avgVsTotal, third, lede, returnMeeting };
}
