/**
 * Fantasy Football Impact (mak's brief, 2026-11-06), added UNDER the Matchup
 * Leverage card on the upcoming page ("dont redesign, just add this under the
 * current version"): up to three takeaways, an expandable table of every
 * starter, and the Start/Sit link.
 *
 * No new data. Everything is read from the Preview buildPreview() already
 * built, per scoring format (PPR, half PPR, standard, all three computed by
 * preview.ts):
 *
 *   side.ppr[sleeperId].formats[f]  season points per game and positional rank
 *   opp.fpaFormats[f].byPos[pos]    what the opponent allows (rank 1 = most)
 *   side.usage.players              snap, touch and target shares (percent)
 *   side.roster                     the current roster and its depth order
 *   p.injuries                      designations (Out / Doubtful / Questionable)
 *
 * The rules (deterministic, thresholds below):
 *   role      from usage only, never from fantasy rank (a 16% snap share is
 *             never a "strong" role): QB = the depth chart's starter; RB by
 *             snap or touch share; WR / TE by target share. A player needs
 *             MIN_GAMES games before he can anchor a takeaway.
 *   matchup   the opponent's rank in points allowed at his position, in the
 *             chosen format: 1st-10th favorable, 23rd-32nd tough (the same
 *             cut the Matchup Leverage card uses).
 *   upgrade   a strong or solid role AND a favorable matchup.
 *   tough     a strong role AND a tough matchup; the copy says a tough spot is
 *             not a benching for a player who ranks as a starter.
 *   monitor   a teammate in his position group with a real role is listed
 *             Questionable or Doubtful (opportunity COULD grow; no share is
 *             said to transfer), or the player himself is Questionable.
 *   role change  (mak's 2026-11-18 brief, "injury-driven workload changes")
 *             a starter whose LAST game's workload far exceeds his season
 *             share because the player ahead of him on the depth chart is not
 *             expected to play (Out, reserve list, or pending after missing
 *             that game). The last game's line is in the copy; whether the
 *             role holds is stated as conditional on that teammate.
 * The three best by score are shown, any mix of kinds, fewer when fewer clear
 * the bar. Players listed Out never anchor a takeaway. Statuses are the
 * game's own (availability.ts), not a designation left over from last week.
 */

import type { ScoringFormat } from "./preview";
import type { RosterPlayer } from "../team/roster";
import type { UsagePlayer } from "../team/usage";
import { allowPhrase, type Pos, type Preview, type PreviewSide } from "./preview";
import { starters } from "./preview-starters";
import { loadGameLogs } from "../player/data";
import { notExpected, PENDING, type Availability } from "./availability";

export const FORMATS: Array<{ id: ScoringFormat; label: string; short: string }> = [
  { id: "ppr", label: "PPR", short: "PPR" },
  { id: "half", label: "Half", short: "Half PPR" },
  { id: "std", label: "Standard", short: "Std" },
];

/** Games a player needs before he can anchor a takeaway. */
export const MIN_GAMES = 3;
/** Opponent rank cuts: 1st-10th allows the most (favorable), 23rd-32nd the fewest (tough). */
const FAVORABLE = 10;
const TOUGH = 23;
/** Where a season rank still reads as a weekly starter in 12-team leagues. */
const STARTER_LINE: Record<Pos, number> = { QB: 12, RB: 24, WR: 30, TE: 12 };

export type Role = "strong" | "solid" | "light";
export type Matchup = "favorable" | "neutral" | "tough";
export type TakeawayKind = "upgrade" | "tough" | "monitor" | "role";

/**
 * Each kind says what it is (mak's 2026-11-18 brief: "clearly separate a
 * favorable matchup from a projection and from an injury-conditional
 * opportunity"). None of them is a projection; the page makes none.
 */
export const TAKEAWAY_WORD: Record<TakeawayKind, string> = {
  upgrade: "Favorable Matchup",
  tough: "Tough Matchup",
  monitor: "Injury-Conditional",
  role: "Role Change",
};

/** The player's line in his club's last game. */
export interface LastGame {
  week: number;
  snaps: number;
  teamSnaps: number;
  carries: number;
  rushYds: number;
  rec: number;
  recYds: number;
  targets: number;
  tds: number;
  pts: number | null;
}

export interface FantasyPlayer {
  side: PreviewSide["key"];
  team: string;
  name: string;
  slug: string | null;
  sleeperId: string;
  pos: Pos;
  ppg: number;
  posRank: number | null;
  games: number;
  role: Role;
  /** The usage figure behind the role, e.g. "27.2% target share". */
  roleText: string;
  matchup: Matchup;
  oppRank: number | null;
  oppFpa: number | null;
  /** "Out", "Doubtful", "Questionable", "Pending" or null. */
  status: string | null;
  /** His club's last game, when he has a log for it. */
  last: LastGame | null;
}

export interface Takeaway {
  kind: TakeawayKind;
  player: FantasyPlayer;
  text: string;
  /** A second wording, used when an earlier takeaway of the same kind is shown, so two never read alike. */
  alt?: string;
  score: number;
}

export interface FantasyImpact {
  format: ScoringFormat;
  takeaways: Takeaway[];
  /** Every starter, QBs first, then RB, WR, TE, each by points per game. */
  players: FantasyPlayer[];
}

const one = (n: number): string => n.toFixed(1);
const pct = (n: number | null | undefined): string => (n == null ? "-" : `${Math.round(n)}%`);

function roleOf(u: UsagePlayer, isQb1: boolean): { role: Role; text: string } {
  switch (u.pos) {
    case "QB":
      return { role: isQb1 ? "strong" : "light", text: isQb1 ? `starter, ${u.dropbacks} dropbacks` : "backup" };
    case "RB": {
      const snap = u.snapShare ?? 0;
      const touch = u.touchShare ?? 0;
      const role: Role = snap >= 55 || touch >= 55 ? "strong" : snap >= 35 || touch >= 35 ? "solid" : "light";
      return { role, text: `${pct(u.snapShare)} snap share${u.touchShare != null ? `, ${pct(u.touchShare)} of RB touches` : ""}` };
    }
    default: {
      const ts = u.targetShare ?? 0;
      const [strong, solid] = u.pos === "TE" ? [18, 12] : [22, 15];
      return { role: ts >= strong ? "strong" : ts >= solid ? "solid" : "light", text: `${one(ts)}% target share` };
    }
  }
}

function matchupOf(rank: number | null): Matchup {
  if (rank === null) return "neutral";
  return rank <= FAVORABLE ? "favorable" : rank >= TOUGH ? "tough" : "neutral";
}

type GameRosterPlayer = RosterPlayer & { availability?: Availability };

const FORMAT_PTS: Record<ScoringFormat, string> = { ppr: "pts_ppr", half: "pts_half_ppr", std: "pts_std" };

function lastGameOf(season: number, r: GameRosterPlayer, f: ScoringFormat): LastGame | null {
  const week = r.availability?.lastGame?.week ?? null;
  if (week === null) return null;
  const g = (loadGameLogs(season)[r.id] ?? []).find((x) => x.week === week);
  if (!g || !g.stats) return null;
  const s = g.stats as unknown as Record<string, number | null | undefined>;
  const n = (k: string) => Number(s[k] ?? 0) || 0;
  const pts = s[FORMAT_PTS[f]];
  return {
    week,
    snaps: n("off_snp"),
    teamSnaps: n("tm_off_snp"),
    carries: n("rush_att"),
    rushYds: n("rush_yd"),
    rec: n("rec"),
    recYds: n("rec_yd"),
    targets: n("rec_tgt"),
    tds: n("rush_td") + n("rec_td"),
    pts: typeof pts === "number" ? pts : null,
  };
}

function statusOf(p: Preview, side: PreviewSide, r: RosterPlayer): string | null {
  const row = p.injuries[side.key].find((x) => x.name === r.name && x.chip !== "OK");
  if (row) return row.status;
  return r.injuryStatus ?? null;
}

/** The game's starters (QB1, RB1-2, WR1-3, TE1 by depth order, Out excluded) with their numbers in one format. */
function startersFor(p: Preview, side: PreviewSide, opp: PreviewSide, f: ScoringFormat): FantasyPlayer[] {
  const out: FantasyPlayer[] = [];
  const usage = side.usage?.players ?? [];
  const qb1 = starters(side.roster, "QB", 1)[0]?.id ?? null;
  for (const [pos, n] of [["QB", 1], ["RB", 2], ["WR", 3], ["TE", 1]] as Array<[Pos, number]>) {
    for (const r of starters(side.roster, pos, n)) {
      const u = usage.find((x) => x.sleeperId === r.id);
      const fig = side.ppr[r.id]?.formats[f];
      if (!u || !fig || !u.games) continue;
      const opRow = opp.fpaFormats[f]?.byPos[pos] ?? opp.fpa?.byPos[pos] ?? null;
      const { role, text } = roleOf(u, r.id === qb1);
      const last = lastGameOf(p.meeting.season, r as GameRosterPlayer, f);
      out.push({
        side: side.key,
        team: side.team.code.toUpperCase(),
        name: r.name,
        slug: u.slug,
        sleeperId: r.id,
        pos,
        ppg: fig.ppg,
        posRank: fig.posRank,
        games: u.games,
        role,
        roleText: text,
        matchup: matchupOf(opRow?.rank ?? null),
        oppRank: opRow?.rank ?? null,
        oppFpa: opRow?.fpa ?? null,
        status: statusOf(p, side, r),
        last,
      });
    }
  }
  return out;
}

/** The surname, without a generational suffix: "Kenneth Walker III" -> "Walker". */
const last = (name: string): string => {
  const words = name.split(/\s+/).slice(1);
  while (words.length > 1 && /^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(words[words.length - 1]!)) words.pop();
  return words.join(" ") || name;
};
const poss = (s: string): string => (s.endsWith("s") ? `${s}'` : `${s}'s`);

function takeawaysFor(p: Preview, players: FantasyPlayer[], f: ScoringFormat): Takeaway[] {
  const word = FORMATS.find((x) => x.id === f)!.short;
  const teamOf = (pl: FantasyPlayer) => (pl.side === "away" ? p.away : p.home);
  const oppOf = (pl: FantasyPlayer) => (pl.side === "away" ? p.home : p.away);
  const eligible = (pl: FantasyPlayer) => pl.games >= MIN_GAMES && !notExpected(pl.status);
  const roleScore: Record<Role, number> = { strong: 20, solid: 12, light: 0 };
  const out: Takeaway[] = [];

  for (const pl of players.filter(eligible)) {
    const opp = oppOf(pl).team.nickname;
    const allowed = pl.oppRank !== null && pl.oppFpa !== null ? `${allowPhrase(pl.oppRank)} ${pl.pos} fantasy points (${one(pl.oppFpa)} a game, ${word})` : null;
    // Not for a Doubtful player: a favorable matchup is not an upgrade for
    // someone unlikely to play (mak's 2026-11-18 brief).
    if (pl.matchup === "favorable" && pl.role !== "light" && allowed && pl.status !== "Doubtful") {
      out.push({
        kind: "upgrade",
        player: pl,
        text: `${poss(last(pl.name))} ${pl.role} role (${pl.roleText}) meets a ${opp} defense that has allowed the ${allowed}.`,
        alt: `The ${opp} have given up the ${allowed}, and ${poss(last(pl.name))} ${pl.roleText} gives him the volume to use it.`,
        score: roleScore[pl.role] + (FAVORABLE + 1 - pl.oppRank!) * 1.5,
      });
    }
    if (pl.matchup === "tough" && pl.role === "strong" && allowed) {
      const starter = pl.posRank !== null && pl.posRank <= STARTER_LINE[pl.pos];
      out.push({
        kind: "tough",
        player: pl,
        text:
          `The ${opp} have allowed the ${allowed}. ` +
          (starter
            ? `A tougher spot, not a benching: ${last(pl.name)} ranks ${pl.pos}${pl.posRank} on the season.`
            : `${poss(last(pl.name))} volume (${pl.roleText}) has to carry him here.`),
        alt:
          `${last(pl.name)} draws a ${opp} defense holding ${pl.pos}s to ${one(pl.oppFpa!)} ${word} points a game, the ${allowPhrase(pl.oppRank!)}` +
          (starter ? `; at ${pl.pos}${pl.posRank} on the season he stays in lineups, with a lower ceiling.` : `; his ${pl.roleText} is what keeps him playable.`),
        score: roleScore[pl.role] + (pl.oppRank! - TOUGH + 1) * 1.5,
      });
    }
  }

  // Role change: the last game's workload, earned because the player ahead
  // of him is not expected to play (Out, reserve, or pending after missing
  // that game). Ranked above matchup reads: volume is what moves a lineup.
  for (const pl of p.nextGame ? players.filter(eligible) : []) {
    const L = pl.last;
    if (!L || L.teamSnaps <= 0) continue;
    const side = teamOf(pl);
    const season = (side.usage?.players ?? []).find((x) => x.sleeperId === pl.sleeperId) ?? null;
    const lastShare = (L.snaps / L.teamSnaps) * 100;
    const seasonShare = season?.snapShare ?? null;
    const touches = L.carries + L.rec;
    const jump =
      pl.pos === "RB"
        ? lastShare >= 50 && seasonShare !== null && seasonShare < 40 && touches >= 12
        : (pl.pos === "WR" || pl.pos === "TE") && L.targets >= 8 && (season?.targetShare ?? 0) < 15;
    if (!jump) continue;
    // Who he replaced: a teammate at the position listed ahead of him who is
    // not expected to play this week.
    const me = side.roster.find((x) => x.id === pl.sleeperId) ?? null;
    const ahead = side.roster
      .filter((x) => x.position === pl.pos && x.id !== pl.sleeperId && notExpected(x.injuryStatus) && (x.depthOrder ?? 99) <= (me?.depthOrder ?? 99) + 1)
      .sort((a, b) => (a.depthOrder ?? 99) - (b.depthOrder ?? 99))[0];
    // The jump is credited to his absence only when he really missed that game.
    if (!ahead || (ahead as GameRosterPlayer).availability?.lastGame?.played !== false) continue;
    const pending = ahead.injuryStatus === PENDING;
    const scrim = L.rushYds + L.recYds;
    const line =
      pl.pos === "RB"
        ? `${L.carries} carries for ${L.rushYds} yards and ${L.rec} ${L.rec === 1 ? "catch" : "catches"} for ${L.recYds} yards` +
          (L.tds ? ` with ${L.tds === 1 ? "a touchdown" : `${L.tds} touchdowns`}` : "")
        : `${L.rec} catches on ${L.targets} targets for ${L.recYds} yards` + (L.tds ? `, ${L.tds === 1 ? "a touchdown" : `${L.tds} touchdowns`}` : "");
    const opp = oppOf(pl).team.nickname;
    const matchup =
      pl.oppRank !== null && pl.oppFpa !== null ? ` The ${opp} have allowed the ${allowPhrase(pl.oppRank)} ${pl.pos} fantasy points (${one(pl.oppFpa)} a game, ${word}).` : "";
    out.push({
      kind: "role",
      player: pl,
      text:
        `With ${ahead.name} out in Week ${L.week}, ${last(pl.name)} played ${L.snaps} of ${L.teamSnaps} snaps: ${line}` +
        (pl.pos === "RB" ? ` (${scrim} scrimmage yards)` : "") +
        `${L.pts !== null ? `, ${one(L.pts)} ${word} points` : ""}. ` +
        (pending
          ? `${poss(last(ahead.name))} Week ${p.meeting.week} status is not set yet; if he sits again, ${last(pl.name)} is the lead option.`
          : `${ahead.name} is ${ahead.injuryStatus === "Out" ? "out" : `on ${ahead.injuryStatus}`} again, so the role is ${poss(last(pl.name))}.`) +
        matchup,
      score: 40 + (pending ? 0 : 6) + Math.min(10, (L.pts ?? 0) / 4),
    });
  }

  // Opportunity to monitor: a teammate with a real role is Questionable or
  // Doubtful. Conditional only; no share is said to move to anyone.
  const group = (pos: Pos) => (pos === "WR" || pos === "TE" ? ["WR", "TE"] : [pos]);
  for (const side of [p.away, p.home]) {
    for (const inj of p.injuries[side.key].filter((x) => x.status === "Questionable" || x.status === "Doubtful" || x.status === PENDING)) {
      const u = (side.usage?.players ?? []).find((x) => x.name === inj.name);
      if (!u || u.games < MIN_GAMES) continue;
      const share = u.pos === "RB" ? (u.snapShare ?? 0) : (u.targetShare ?? 0);
      if (share < (u.pos === "RB" ? 35 : 12)) continue;
      const mates = players
        .filter((pl) => pl.side === side.key && pl.name !== inj.name && eligible(pl) && group(u.pos as Pos).includes(pl.pos))
        .sort((a, b) => b.ppg - a.ppg);
      const pick = mates[0];
      if (!pick) continue;
      const theirShare = u.pos === "RB" ? `${pct(u.snapShare)} snap share` : `${one(u.targetShare ?? 0)}% target share`;
      out.push({
        kind: "monitor",
        player: pick,
        text:
          `${inj.name} ${inj.status === PENDING ? `has no Week ${p.meeting.week} status yet` : `is listed ${inj.status}`} (${theirShare}). ${last(pick.name)} (${pick.roleText}) is the ${teamOf(pick).team.nickname} ` +
          `${pick.pos} most likely to see more work if he sits; nothing is settled until inactives post.`,
        score: 10 + share / 4,
      });
    }
  }
  for (const pl of players.filter((x) => eligible(x) && x.status === "Questionable" && x.role !== "light")) {
    out.push({
      kind: "monitor",
      player: pl,
      text: `${last(pl.name)} is listed Questionable with a ${pl.role} role (${pl.roleText}); confirm he is active before lineups lock.`,
      score: 8 + roleScore[pl.role] / 2,
    });
  }

  out.sort((a, b) => b.score - a.score);
  const picked: Takeaway[] = [];
  for (const t of out) {
    if (picked.length >= 3) break;
    // One takeaway per player, and the same kind only twice.
    if (picked.some((x) => x.player.name === t.player.name)) continue;
    if (picked.filter((x) => x.kind === t.kind).length >= 2) continue;
    picked.push(picked.some((x) => x.kind === t.kind) && t.alt ? { ...t, text: t.alt } : t);
  }
  return picked;
}

const POS_ORDER: Record<Pos, number> = { QB: 0, RB: 1, WR: 2, TE: 3 };

export function fantasyImpact(p: Preview, f: ScoringFormat): FantasyImpact | null {
  const players = [...startersFor(p, p.away, p.home, f), ...startersFor(p, p.home, p.away, f)].sort(
    (a, b) => POS_ORDER[a.pos] - POS_ORDER[b.pos] || b.ppg - a.ppg,
  );
  if (!players.length) return null;
  return { format: f, takeaways: takeawaysFor(p, players, f), players };
}
