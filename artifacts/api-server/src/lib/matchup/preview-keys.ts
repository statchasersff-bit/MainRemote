/**
 * Keys to the Game (mak, 2026-11-06): three NFL matchups that could decide
 * the game, chosen per game from the teams' own season numbers, under The
 * Call on the upcoming page (preview-premium.ts prints the card).
 *
 * Every key is a unit-versus-unit comparison read from the stored team stats
 * (lib/team/stats.ts: every row carries a league rank, 1st = best on that
 * metric's own direction) or a starter's injury designation:
 *
 *   passing    one offense's passing yards a game vs the other's pass defense
 *   rushing    the same for the run
 *   pressure   one line's sacks allowed vs the other front's sacks
 *   turnovers  the two turnover margins (one per game, not per side)
 *   thirdDown  third-down conversion vs third-down defense
 *   injury     a starting QB / RB1 / WR1 / WR2 / TE listed Out or Doubtful
 *
 * Each candidate is scored by how lopsided the ranks are, plus a bonus for a
 * league extreme (top or bottom three), and the three best of different
 * kinds are shown, strongest first. Nothing is invented: a key whose rows are
 * missing is not a candidate, and every figure in the copy is the row's own
 * value and rank.
 */

import type { StatRow, TeamStats } from "../team/stats";
import type { Preview, PreviewSide } from "./preview";
import { depthTop, starters } from "./preview-starters";
import { PENDING } from "./availability";

export type KeyKind = "passing" | "rushing" | "pressure" | "turnovers" | "thirdDown" | "injury";

export interface GameKey {
  kind: KeyKind;
  /** The team the key is about, for its accent; null for the game-wide turnover key. */
  side: "away" | "home" | null;
  question: string;
  /** Plain text, every figure from the stats rows. */
  copy: string;
  /**
   * Why it could decide the game (mak's 2026-11-18 brief: "explain why each
   * matchup matters"), read against the projected script: who is favored and
   * what a win in this phase does for each side. No new figures.
   */
  why: string;
  /** The side the numbers favor in this phase, or null when they are even. */
  edge: "away" | "home" | null;
  score: number;
}

export const KEY_WORD: Record<KeyKind, string> = {
  passing: "Passing game",
  rushing: "Rushing game",
  pressure: "Pass rush",
  turnovers: "Turnovers",
  thirdDown: "Third down",
  injury: "Injuries",
};

function row(stats: TeamStats | null, key: string): StatRow | null {
  if (!stats) return null;
  for (const group of [stats.offense, stats.defense, stats.situational, stats.volume]) {
    const r = group.find((x) => x.key === key);
    if (r) return r.rank === null ? null : r;
  }
  return null;
}

/** "2nd", "tied for 23rd". */
function place(r: StatRow): string {
  const label = r.rankLabel ?? String(r.rank);
  return label.startsWith("T-") ? `tied for ${label.slice(2)}` : label;
}

/**
 * The rank in words, always out of 32 (mak's 2026-11-18 brief: "28th-fewest"
 * is hard to read): "8th of 32" for an offense, "28th of 32 defenses" for a
 * defense. 1st is the best in both, which the card's note says once.
 */
function rankIn(r: StatRow, mode: "nfl" | "fewest" | "most" | "lowest"): string {
  return mode === "fewest" || mode === "lowest" ? `${place(r)} of 32 defenses` : `${place(r)} of 32`;
}

/** A true minus sign on a negative figure (the house rule for numbers). */
function num(v: string): string {
  return v.replace(/^-/, "−");
}

/** League extremes earn a bonus: a 32nd or a 1st is a story on its own. */
function extreme(rank: number): number {
  return rank <= 3 || rank >= 30 ? 6 : rank <= 5 || rank >= 28 ? 3 : 0;
}

function gap(a: StatRow, b: StatRow): number {
  return Math.abs(a.rank! - b.rank!) + extreme(a.rank!) + extreme(b.rank!);
}

/** The favored side by the line, or null for a pick'em or no line. */
function favoriteOf(p: Preview): PreviewSide | null {
  const spread = p.line?.spread ?? null;
  if (spread === null || Math.abs(spread) < 2.5) return null;
  return spread < 0 ? p.home : p.away;
}

const nick = (s: PreviewSide): string => `the ${s.team.nickname}`;
const Nick = (s: PreviewSide): string => `The ${s.team.nickname}`;

function passing(p: Preview, o: PreviewSide, d: PreviewSide): GameKey | null {
  const yds = row(o.stats, "off-pass-yards");
  const allowed = row(d.stats, "def-pass-yards");
  if (!yds || !allowed) return null;
  const ypa = row(o.stats, "off-yards-per-attempt");
  const ypaAllowed = row(d.stats, "def-yards-per-attempt");
  const qb = starters(o.roster, "QB", 1)[0]?.name ?? null;
  const offenseEdge = yds.rank! < allowed.rank!;
  const question = offenseEdge
    ? qb
      ? `Can ${nick(d)} contain ${qb}?`
      : `Can ${nick(d)} slow the ${o.team.nickname} passing game?`
    : qb
      ? `Can ${qb} find room against ${nick(d)} pass defense?`
      : `Can ${nick(o)} throw on ${nick(d)}?`;
  const copy =
    `${Nick(o)} throw for ${num(yds.value)} yards a game (${rankIn(yds, "nfl")})` +
    (ypa ? ` at ${num(ypa.value)} yards per attempt (${rankIn(ypa, "nfl")})` : "") +
    `. ${Nick(d)} allow ${num(allowed.value)} passing yards a game (${rankIn(allowed, "fewest")})` +
    (ypaAllowed ? ` and ${num(ypaAllowed.value)} per attempt (${rankIn(ypaAllowed, "fewest")})` : "") +
    `.`;
  const fav = favoriteOf(p);
  const passer = qb ?? `the ${o.team.nickname} quarterback`;
  const why = offenseEdge
    ? fav === o
      ? `If ${passer} moves the ball early, the ${d.team.nickname} have to chase points through the air, the script that suits a favorite.`
      : fav === d
        ? `Chunk plays through the air are the most realistic way for the ${o.team.nickname} to keep pace as underdogs.`
        : `The passing game is where the ${o.team.nickname} hold the clearest edge, so ${passer}'s efficiency could swing a close game.`
    : fav === d
      ? `If the ${d.team.nickname} coverage holds, the ${o.team.nickname} have little else to lean on when they fall behind.`
      : `Holding ${passer} under his usual output is the ${d.team.nickname} defense's best way to control the game.`;
  return { kind: "passing", side: o.key, question, copy, why, edge: offenseEdge ? o.key : d.key, score: gap(yds, allowed) };
}

function rushing(p: Preview, o: PreviewSide, d: PreviewSide): GameKey | null {
  const yds = row(o.stats, "off-rush-yards");
  const allowed = row(d.stats, "def-rush-yards");
  if (!yds || !allowed) return null;
  const ypc = row(o.stats, "off-yards-per-carry");
  const ypcAllowed = row(d.stats, "def-yards-per-carry");
  const offenseEdge = yds.rank! < allowed.rank!;
  const question = offenseEdge ? `Can ${nick(d)} stop the ${o.team.nickname} run game?` : `Can ${nick(o)} establish the run?`;
  const copy =
    `${Nick(o)} run for ${num(yds.value)} yards a game (${rankIn(yds, "nfl")})` +
    (ypc ? ` at ${num(ypc.value)} yards a carry (${rankIn(ypc, "nfl")})` : "") +
    `. ${Nick(d)} allow ${num(allowed.value)} rushing yards a game (${rankIn(allowed, "fewest")})` +
    (ypcAllowed ? ` and ${num(ypcAllowed.value)} a carry (${rankIn(ypcAllowed, "fewest")})` : "") +
    `.`;
  const fav = favoriteOf(p);
  const qb = starters(o.roster, "QB", 1)[0]?.name ?? `the ${o.team.nickname} quarterback`;
  const why = offenseEdge
    ? fav === o
      ? `A productive ${o.team.nickname} run game protects a lead and shortens the game, forcing the ${d.team.nickname} into a pass-heavy script.`
      : fav === d
        ? `Running the ball keeps the ${d.team.nickname} offense on the sideline, the underdog's best way to keep this close.`
        : `Winning on the ground lets the ${o.team.nickname} stay on schedule and control the clock.`
    : `If the ${d.team.nickname} take the run away, the ${o.team.nickname} lean on ${qb} in obvious passing downs.`;
  return { kind: "rushing", side: o.key, question, copy, why, edge: offenseEdge ? o.key : d.key, score: gap(yds, allowed) };
}

function pressure(p: Preview, o: PreviewSide, d: PreviewSide): GameKey | null {
  const allowed = row(o.stats, "sacks-allowed");
  const sacks = row(d.stats, "sacks-made");
  if (!allowed || !sacks) return null;
  const lineEdge = allowed.rank! < sacks.rank!;
  const question = lineEdge
    ? `Can the ${d.team.nickname} pass rush get home?`
    : `Can the ${o.team.nickname} line hold up against the ${d.team.nickname} pass rush?`;
  const copy =
    `${Nick(d)} have ${num(sacks.value)} sacks (${rankIn(sacks, "most")}). ` +
    `${Nick(o)} have allowed ${num(allowed.value)} (${rankIn(allowed, "nfl")}).`;
  void p;
  const qb = starters(o.roster, "QB", 1)[0]?.name ?? `the ${o.team.nickname} quarterback`;
  const why = lineEdge
    ? `If ${qb} has a clean pocket, the ${d.team.nickname} have to send extra rushers to get pressure, which opens room behind them.`
    : `Sacks end drives: pressure on ${qb} turns third downs into punts and keeps the ${o.team.nickname} out of scoring range.`;
  return { kind: "pressure", side: o.key, question, copy, why, edge: lineEdge ? o.key : d.key, score: gap(allowed, sacks) };
}

function turnovers(p: Preview, a: PreviewSide, h: PreviewSide): GameKey | null {
  const ma = row(a.stats, "turnover-margin");
  const mh = row(h.stats, "turnover-margin");
  if (!ma || !mh) return null;
  const [better, worse, mb, mw] = ma.rank! <= mh.rank! ? [a, h, ma, mh] : [h, a, mh, ma];
  const takeaways = row(better.stats, "takeaways");
  const giveaways = row(worse.stats, "giveaways");
  const copy =
    `${Nick(better)} are ${num(mb.value)} in turnover margin (${rankIn(mb, "nfl")})` +
    (takeaways ? ` with ${num(takeaways.value)} takeaways (${rankIn(takeaways, "most")})` : "") +
    `. ${Nick(worse)} are ${num(mw.value)} (${rankIn(mw, "nfl")})` +
    (giveaways ? ` with ${num(giveaways.value)} giveaways (${rankIn(giveaways, "nfl")})` : "") +
    `.`;
  const fav = favoriteOf(p);
  const why =
    fav === worse
      ? `Giveaways are the quickest way for the ${worse.team.nickname} to let an underdog stay in the game.`
      : fav === better
        ? `Short fields from takeaways would let the ${better.team.nickname} turn a favorable spot into a comfortable one.`
        : `In an evenly priced game, one extra possession can be the difference.`;
  return {
    kind: "turnovers",
    side: null,
    question: `Can ${nick(worse)} protect the football?`,
    copy,
    why,
    edge: mb.rank! === mw.rank! ? null : better.key,
    score: gap(ma, mh),
  };
}

function thirdDown(p: Preview, o: PreviewSide, d: PreviewSide): GameKey | null {
  const conv = row(o.stats, "off-third-down");
  const allowed = row(d.stats, "def-third-down");
  if (!conv || !allowed) return null;
  const offenseEdge = conv.rank! < allowed.rank!;
  const question = offenseEdge
    ? `Can ${nick(d)} get off the field on third down?`
    : `Can ${nick(o)} stay on schedule on third down?`;
  const copy =
    `${Nick(o)} convert ${num(conv.value)} of third downs (${rankIn(conv, "nfl")}). ` +
    `${Nick(d)} allow ${num(allowed.value)} (${rankIn(allowed, "lowest")}).`;
  void p;
  const why = offenseEdge
    ? `Third-down conversions extend ${o.team.nickname} drives and keep the ${d.team.nickname} offense on the sideline, so getting off the field is the ${d.team.nickname} defense's first job.`
    : `Stalled third downs mean punts and short drives, which leaves the ${o.team.nickname} defense on the field.`;
  return { kind: "thirdDown", side: o.key, question, copy, why, edge: offenseEdge ? o.key : d.key, score: gap(conv, allowed) };
}

/** A starting QB, RB1, WR1, WR2 or TE listed Out or Doubtful. */
function injury(p: Preview, s: PreviewSide): GameKey | null {
  // The full-health starters (depthTop), so an absence is visible: starters()
  // has already handed an Out or pending player's slot to his replacement.
  const core = new Set(
    [
      ...depthTop(s.roster, "QB", 1),
      ...depthTop(s.roster, "RB", 1),
      ...depthTop(s.roster, "WR", 2),
      ...depthTop(s.roster, "TE", 1),
    ].map((r) => r.name),
  );
  const hit = p.injuries[s.key]
    .filter((r) => (r.chip === "O" || r.chip === "D" || r.status === PENDING) && core.has(r.name))
    .sort((x, y) => (x.pos === "QB" ? -1 : 0) - (y.pos === "QB" ? -1 : 0) || (y.ppg ?? 0) - (x.ppg ?? 0))[0];
  if (!hit) return null;
  const pending = hit.status === PENDING;
  return {
    kind: "injury",
    side: s.key,
    // Out is settled; Doubtful and pending are not, so the question stays conditional.
    question: hit.chip === "O" ? `How do ${nick(s)} cover for ${hit.name}?` : pending ? `Will ${hit.name} be back for ${nick(s)}?` : `Can ${nick(s)} cover if ${hit.name} sits?`,
    // The fallout already opens with the pending note when there is one.
    copy: (pending ? hit.fallout : `${hit.name} (${hit.pos}) is listed ${hit.status} for ${p.meeting.weekLabel}. ${hit.fallout}`).trim(),
    why:
      hit.pos === "QB"
        ? `A quarterback change reshapes the whole ${s.team.nickname} game plan, not one position.`
        : `Who fills the role decides where the ${s.team.nickname}' touches go, for the game plan and for fantasy lineups.`,
    edge: null,
    score: hit.pos === "QB" ? 28 : pending ? 18 : 14,
  };
}

/** The game's three keys, strongest first, no two of the same kind. */
export function gameKeys(p: Preview, max = 3): GameKey[] {
  const { away, home } = p;
  const all = [
    passing(p, away, home),
    passing(p, home, away),
    rushing(p, away, home),
    rushing(p, home, away),
    pressure(p, away, home),
    pressure(p, home, away),
    turnovers(p, away, home),
    thirdDown(p, away, home),
    thirdDown(p, home, away),
    injury(p, away),
    injury(p, home),
  ].filter((k): k is GameKey => k !== null);
  all.sort((a, b) => b.score - a.score);
  const picked: GameKey[] = [];
  for (const k of all) {
    if (picked.length >= max) break;
    if (!picked.some((x) => x.kind === k.kind)) picked.push(k);
  }
  return picked;
}
