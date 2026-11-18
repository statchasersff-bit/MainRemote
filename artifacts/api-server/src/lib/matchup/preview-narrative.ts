/**
 * The upcoming page's written Game Preview (mak's 2026-11-18 brief: "a
 * genuine editorial preview ... 180-250 words when sufficient reliable data
 * is available"). The preview counterpart of recap-narrative.ts: candidate
 * storylines are found in the stored data, scored, and the strongest two to
 * four are told in a four-part shape (opening, context, key matchups,
 * outlook) whose emphasis changes with the game. No model call
 * ([[no-paid-model-calls]]); every name and figure comes from the Preview
 * buildPreview() made or from the stored game logs, and nothing is said that
 * those cannot support: no quotes, no news, no history beyond the stored
 * meetings.
 *
 * Storylines (each scored per game, so the order differs game to game):
 *   newQb        a starting quarterback with one or two starts for this club
 *                this season, a rookie scoring higher; his last start's line
 *   bigGame      a player's exceptional last game (30+ PPR points, four or
 *                more TD passes, 150+ scrimmage or receiving yards)
 *   standIn      a starter who is not expected to play (or whose status is
 *                not set after missing the last game) and the player who
 *                took his workload in that game
 *   absence      a confirmed absence of a starting QB, RB1, WR1-2 or TE1
 *   mismatch     the most lopsided unit-against-unit phase (Keys to the Game)
 *   gap          a big difference in scoring offense or defense
 *   momentum     a three-game streak, or scoring well off the season pace
 *   market       a double-digit spread, a near pick'em or a moved line
 *   target       a featured receiver or tight end against a defense that
 *                gives up the most fantasy points to his position
 * Division games say so in the opening; the brief's other context factors
 * (postseason implications) have no verified source here and are left out.
 */

import { loadGameLogs } from "../player/data";
import { TEAMS, type NflTeam } from "../team/teams";
import type { StatRow, TeamStats } from "../team/stats";
import type { RosterPlayer } from "../team/roster";
import type { Availability } from "./availability";
import { notExpected, PENDING } from "./availability";
import { allowPhrase, type Preview, type PreviewSide } from "./preview";
import { gameKeys, type GameKey } from "./preview-keys";
import { depthTop, starters } from "./preview-starters";

type GameRosterPlayer = RosterPlayer & { availability?: Availability };

export interface PreviewNarrative {
  headline: string;
  paragraphs: string[];
  /** Which storylines were told, strongest first (for tests and the report). */
  storylines: string[];
  words: number;
}

/* ------------------------------------------------------------- helpers */

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n: number): string => WORDS[n] ?? String(n);
const ORD = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const ordWord = (n: number): string => ORD[n] ?? `${n}th`;
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
const one = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const trim = (n: number): string => String(Math.round(n * 10) / 10);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
/** The surname, without a generational suffix: "Kenneth Walker III" -> "Walker". */
const last = (name: string): string => {
  const words = name.split(/\s+/).slice(1);
  while (words.length > 1 && /^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(words[words.length - 1]!)) words.pop();
  return words.join(" ") || name;
};
const possessive = (s: string): string => (s.endsWith("s") ? `${s}'` : `${s}'s`);

function row(stats: TeamStats | null, key: string): StatRow | null {
  if (!stats) return null;
  for (const group of [stats.offense, stats.defense, stats.situational, stats.volume]) {
    const r = group.find((x) => x.key === key);
    if (r && r.rank !== null) return r;
  }
  return null;
}
const rankOf = (r: StatRow): string => {
  const label = r.rankLabel ?? String(r.rank);
  return label.startsWith("T-") ? `tied for ${label.slice(2)}` : label;
};
const num = (v: string): string => v.replace(/^-/, "−");

/** "a Chiefs defense", "an Eagles defense". */
const an = (next: string): string => (/^[aeiou]/i.test(next) ? `an ${next}` : `a ${next}`);
/** "the most", "the 8th-most". */
const most = (rank: number): string => (rank === 1 ? "the most" : `the ${ordinal(rank)}-most`);

function teamByCode(code: string): NflTeam | null {
  return TEAMS.find((t) => t.code.toUpperCase() === code.toUpperCase()) ?? null;
}

interface Line {
  week: number;
  team: string;
  opp: string;
  gs: boolean;
  passAtt: number;
  passCmp: number;
  passYds: number;
  passTd: number;
  passInt: number;
  carries: number;
  rushYds: number;
  rec: number;
  recYds: number;
  targets: number;
  tds: number;
  ppr: number;
  snaps: number;
  teamSnaps: number;
}

function linesOf(season: number, id: string): Line[] {
  return (loadGameLogs(season)[id] ?? [])
    .filter((g) => g.stats)
    .map((g) => {
      const s = g.stats as unknown as Record<string, number | null | undefined>;
      const n = (k: string) => Number(s[k] ?? 0) || 0;
      return {
        week: g.week,
        team: (g.team ?? "").toUpperCase(),
        opp: (g.opp ?? "").toUpperCase(),
        gs: n("gs") > 0,
        passAtt: n("pass_att"),
        passCmp: n("pass_cmp"),
        passYds: n("pass_yd"),
        passTd: n("pass_td"),
        passInt: n("pass_int"),
        carries: n("rush_att"),
        rushYds: n("rush_yd"),
        rec: n("rec"),
        recYds: n("rec_yd"),
        targets: n("rec_tgt"),
        tds: n("rush_td") + n("rec_td"),
        ppr: n("pts_ppr"),
        snaps: n("off_snp"),
        teamSnaps: n("tm_off_snp"),
      };
    })
    .sort((a, b) => a.week - b.week);
}

/** The side's last game result from its form strip (most recent last). */
function lastResult(s: PreviewSide, p: Preview): { week: number; win: boolean; tie: boolean; pf: number; pa: number; opp: string; home: boolean } | null {
  const g = p.form[s.key]?.games.at(-1);
  if (!g) return null;
  const opp = teamByCode(g.opp)?.nickname ?? g.opp;
  return { week: g.week, win: g.outcome === "W", tie: g.outcome === "T", pf: g.pf, pa: g.pa, opp, home: g.homeAway === "home" };
}

/** "a 35-13 win over the Falcons", "a 34-6 loss to the Rams". */
function resultPhrase(r: { win: boolean; tie: boolean; pf: number; pa: number; opp: string }): string {
  const hi = Math.max(r.pf, r.pa);
  const lo = Math.min(r.pf, r.pa);
  if (r.tie) return `a ${hi}-${lo} tie with the ${r.opp}`;
  return r.win ? `a ${hi}-${lo} win over the ${r.opp}` : `a ${hi}-${lo} loss to the ${r.opp}`;
}

/* ---------------------------------------------------------- storylines */

interface Story {
  id: string;
  side: "away" | "home" | null;
  score: number;
  /** One or two sentences for the body. */
  text: string;
  /** The player or unit at its center, for the headline. */
  subject?: string;
  meta?: Record<string, unknown>;
}

function newQb(p: Preview, s: PreviewSide, opp: PreviewSide): Story | null {
  const qb = starters(s.roster, "QB", 1)[0];
  if (!qb) return null;
  const season = p.meeting.season;
  const lines = linesOf(season, qb.id).filter((l) => l.week < p.meeting.week);
  const code = s.team.code.toUpperCase();
  const starts = lines.filter((l) => l.gs && l.passAtt > 0 && l.team === code);
  if (starts.length > 2) return null;
  const rookie = qb.yearsExp === 0;
  const nth = starts.length + 1;
  const lastStart = starts.at(-1) ?? null;
  const res = lastResult(s, p);
  const allowed = row(opp.stats, "def-points");
  const sentence: string[] = [];
  const who = `${rookie ? "rookie " : ""}${qb.name}`;
  if (nth === 1) {
    sentence.push(`${cap(who)} is in line for his first ${rookie ? "NFL " : ""}start${rookie ? "" : ` for the ${s.team.nickname}`}.`);
  } else if (lastStart && res && res.week === lastStart.week) {
    sentence.push(
      `${cap(who)} prepares for his ${ordWord(nth)} ${rookie ? "NFL " : ""}start after ${resultPhrase(res)}` +
        ` in which he went ${lastStart.passCmp} of ${lastStart.passAtt} for ${lastStart.passYds} yards` +
        (lastStart.passTd ? ` and ${word(lastStart.passTd)} touchdown${lastStart.passTd === 1 ? "" : "s"}` : "") +
        `.`,
    );
  } else {
    sentence.push(`${cap(who)} makes his ${ordWord(nth)} start of the season for the ${s.team.nickname}.`);
  }
  if (allowed) {
    sentence.push(
      `Next is ${an(opp.team.nickname)} defense allowing ${num(allowed.value)} points a game, ${rankOf(allowed)} of 32` +
        (allowed.rank! <= 10 ? `, so the ${s.team.nickname} need to protect him and stay out of obvious passing downs.` : `.`),
    );
  }
  return {
    id: "newQb",
    side: s.key,
    score: (rookie ? 34 : 26) - starts.length * 2 + (allowed && allowed.rank! <= 10 ? 4 : 0),
    text: sentence.join(" "),
    subject: qb.name,
    meta: { rookie, nth, name: qb.name },
  };
}

function bigGame(p: Preview, s: PreviewSide): Story | null {
  const res = lastResult(s, p);
  if (!res) return null;
  const season = p.meeting.season;
  const code = s.team.code.toUpperCase();
  let best: { r: GameRosterPlayer; l: Line; score: number } | null = null;
  for (const r of s.roster as GameRosterPlayer[]) {
    const l = linesOf(season, r.id).find((x) => x.week === res.week && x.team === code);
    if (!l) continue;
    const scrim = l.rushYds + l.recYds;
    const hit = l.ppr >= 30 || l.passTd >= 4 || scrim >= 150 || l.recYds >= 150;
    if (!hit) continue;
    const score = l.ppr + l.passTd * 3;
    if (!best || score > best.score) best = { r, l, score };
  }
  if (!best) return null;
  const { r, l } = best;
  const expected = !notExpected(r.injuryStatus);
  let what: string;
  if (r.position === "QB" && l.passAtt > 0) {
    what = `threw for ${l.passYds} yards and ${word(l.passTd)} touchdown${l.passTd === 1 ? "" : "s"}`;
  } else if (l.rushYds + l.recYds >= 100 && l.carries + l.rec > 0) {
    const scrim = l.rushYds + l.recYds;
    what =
      `produced ${scrim} scrimmage yards` +
      (l.tds ? ` and ${word(l.tds)} touchdown${l.tds === 1 ? "" : "s"}` : "") +
      (l.carries >= 10 && l.rec >= 3 ? ` (${l.carries} carries, ${l.rec} catches)` : "");
  } else {
    what = `caught ${l.rec} passes for ${l.recYds} yards` + (l.tds ? ` and ${word(l.tds)} touchdown${l.tds === 1 ? "" : "s"}` : "");
  }
  return {
    id: "bigGame",
    side: s.key,
    score: expected ? 18 + Math.min(12, l.ppr / 4) : 0,
    text: `${r.name} ${what} in ${resultPhrase(res)}.`,
    subject: r.name,
    meta: { name: r.name, pos: r.position, week: res.week, line: l },
  };
}

/** A starter who will not, or may not, play, and who took his workload last game. */
function standIn(p: Preview, s: PreviewSide): Story | null {
  const season = p.meeting.season;
  const code = s.team.code.toUpperCase();
  for (const pos of ["RB", "WR", "TE"] as const) {
    const top = depthTop(s.roster, pos, pos === "WR" ? 2 : 1) as GameRosterPlayer[];
    for (const starter of top) {
      // Not expected this week AND missed the last game, so that game shows
      // who took his work.
      if (!notExpected(starter.injuryStatus) || starter.availability?.lastGame?.played !== false) continue;
      const lastWeek = starter.availability.lastGame.week;
      // The teammate at the position with the biggest workload in that game.
      let best: { r: GameRosterPlayer; l: Line } | null = null;
      for (const r of s.roster as GameRosterPlayer[]) {
        if (r.position !== pos || r.id === starter.id || notExpected(r.injuryStatus)) continue;
        const l = linesOf(season, r.id).find((x) => x.week === lastWeek && x.team === code);
        if (!l) continue;
        const load = pos === "RB" ? l.carries + l.rec : l.targets;
        if (!best || load > (pos === "RB" ? best.l.carries + best.l.rec : best.l.targets)) best = { r, l };
      }
      if (!best) continue;
      const { r, l } = best;
      const load = pos === "RB" ? l.carries + l.rec : l.targets;
      if (load < (pos === "RB" ? 12 : 7)) continue;
      const pending = starter.injuryStatus === PENDING;
      const scrim = l.rushYds + l.recYds;
      const did =
        pos === "RB"
          ? `produced ${scrim} scrimmage yards${l.tds ? ` and ${word(l.tds)} touchdown${l.tds === 1 ? "" : "s"}` : ""} on ${l.carries} carries and ${l.rec} catches`
          : `caught ${l.rec} of ${l.targets} targets for ${l.recYds} yards${l.tds ? ` and ${word(l.tds)} touchdown${l.tds === 1 ? "" : "s"}` : ""}`;
      const rookie = r.yearsExp === 0 ? "Rookie " : "";
      const text =
        `${rookie}${r.name} ${did} in Week ${lastWeek} while filling in for ${starter.name}. ` +
        (pending
          ? `${possessive(last(starter.name))} Week ${p.meeting.week} status is not set yet, and his availability decides how the ${s.team.nickname} split the work.`
          : `${last(starter.name)} is ${starter.injuryStatus === "Out" ? "out again" : `still on ${starter.injuryStatus}`}, so the role stays with ${last(r.name)}.`);
      return {
        id: "standIn",
        side: s.key,
        score: 22 + Math.min(10, l.ppr / 3) + (pending ? 2 : 0),
        text,
        subject: r.name,
        meta: { name: r.name, starter: starter.name, pending, pos },
      };
    }
  }
  return null;
}

function absence(p: Preview, s: PreviewSide): Story | null {
  const core = [
    ...depthTop(s.roster, "QB", 1),
    ...depthTop(s.roster, "RB", 1),
    ...depthTop(s.roster, "WR", 2),
    ...depthTop(s.roster, "TE", 1),
  ] as GameRosterPlayer[];
  const out = core.filter((r) => r.injuryStatus === "Out" || (notExpected(r.injuryStatus) && r.injuryStatus !== PENDING));
  if (!out.length) return null;
  const r = out[0]!;
  const next = starters(s.roster, r.position as "QB" | "RB" | "WR" | "TE", 1)[0];
  const status = r.injuryStatus === "Out" ? "is out" : `is on ${r.injuryStatus}`;
  return {
    id: "absence",
    side: s.key,
    score: r.position === "QB" ? 24 : 12,
    text: `${r.name} ${status} for the ${s.team.nickname}${next && next.position === r.position ? `, which puts ${next.name} in his role` : ""}.`,
    subject: r.name,
    meta: { pos: r.position },
  };
}

function gap(p: Preview): Story | null {
  const { away, home } = p;
  const ao = row(away.stats, "off-points");
  const ho = row(home.stats, "off-points");
  if (!ao || !ho) return null;
  const diff = Math.abs(ao.rank! - ho.rank!);
  if (diff < 9) return null;
  const [better, worse, rb, rw] = ao.rank! < ho.rank! ? [away, home, ao, ho] : [home, away, ho, ao];
  const yb = row(better.stats, "off-total-yards");
  const yw = row(worse.stats, "off-total-yards");
  const text =
    `The ${better.team.nickname} average ${num(rb.value)} points` +
    (yb ? ` and ${num(yb.value)} yards a game` : ` a game`) +
    ` (${rankOf(rb)} of 32 in scoring), while the ${worse.team.nickname} score ${num(rw.value)}` +
    (yw && yw.rank! >= 24 ? `, near the bottom of the league in both points and yards` : ` (${rankOf(rw)})`) +
    `.`;
  return { id: "gap", side: better.key, score: diff / 2, text };
}

function momentum(p: Preview, s: PreviewSide): Story | null {
  const f = p.form[s.key];
  if (!f || f.games.length < 3) return null;
  const outcomes = f.games.map((g) => g.outcome);
  let streak = 0;
  const lastOutcome = outcomes.at(-1)!;
  for (let i = outcomes.length - 1; i >= 0 && outcomes[i] === lastOutcome; i -= 1) streak += 1;
  if (lastOutcome !== "T" && streak >= 3) {
    return {
      id: "momentum",
      side: s.key,
      meta: { streak, won: lastOutcome === "W" },
      score: 6 + streak * 2,
      text:
        `The ${s.team.nickname} have ${lastOutcome === "W" ? "won" : "lost"} ${word(streak)} straight` +
        `${streak === f.games.length ? "" : `, ${f.record} over their last ${word(f.games.length)}`}, scoring ${trim(f.recent.pf)} a game in that stretch.`,
    };
  }
  const delta = f.recent.pf - f.season.pf;
  if (Math.abs(delta) >= 5) {
    return {
      id: "momentum",
      side: s.key,
      meta: { delta, recent: f.recent.pf },
      score: 5 + Math.abs(delta) / 2,
      text: `The ${s.team.nickname} have scored ${trim(f.recent.pf)} points a game over their last ${word(f.games.length)}, ${delta > 0 ? "up" : "down"} from ${trim(f.season.pf)} on the season.`,
    };
  }
  return null;
}

function target(p: Preview, s: PreviewSide, opp: PreviewSide): Story | null {
  const players = s.usage?.players ?? [];
  let best: { name: string; pos: string; share: number; rank: number } | null = null;
  for (const u of players) {
    if ((u.pos !== "WR" && u.pos !== "TE") || u.targetShare === null || u.targetShare < 20) continue;
    const r = s.roster.find((x) => x.id === u.sleeperId);
    if (!r || notExpected(r.injuryStatus)) continue;
    const rank = opp.fpa?.byPos[u.pos as "WR" | "TE"]?.rank ?? null;
    if (rank === null || rank > 10) continue;
    if (!best || u.targetShare > best.share) best = { name: u.name, pos: u.pos, share: u.targetShare, rank };
  }
  if (!best) return null;
  return {
    id: "target",
    side: s.key,
    score: 6 + (11 - best.rank) + best.share / 5,
    text:
      `${best.name} is the ${s.team.nickname} offense's most promising matchup: his ${one(best.share)}% target share meets ${an(opp.team.nickname)} defense ` +
      `allowing ${most(best.rank)} fantasy points to ${best.pos === "TE" ? "tight ends" : "wide receivers"}.`,
    subject: best.name,
  };
}

function mismatch(p: Preview, keys: GameKey[]): Story | null {
  const k = keys.find((x) => x.kind !== "injury" && x.kind !== "turnovers");
  if (!k || k.score < 12) return null;
  const off = k.side === "away" ? p.away : k.side === "home" ? p.home : null;
  if (!off) return null;
  // The key's own copy carries the figures; its "why" carries the reason.
  return { id: "mismatch", side: k.side, score: k.score / 2, text: `${k.copy} ${k.why}`, meta: { kind: k.kind } };
}

/** The two defenses' scoring allowed, when they are far apart. */
function defenseGap(p: Preview): Story | null {
  const ad = row(p.away.stats, "def-points");
  const hd = row(p.home.stats, "def-points");
  if (!ad || !hd || Math.abs(ad.rank! - hd.rank!) < 12) return null;
  const [better, worse, rb, rw] = ad.rank! < hd.rank! ? [p.away, p.home, ad, hd] : [p.home, p.away, hd, ad];
  return {
    id: "defenseGap",
    side: better.key,
    score: Math.abs(ad.rank! - hd.rank!) / 2,
    text:
      `On the other side of the ball, the ${better.team.nickname} allow ${num(rb.value)} points a game (${rankOf(rb)} of 32) ` +
      `and the ${worse.team.nickname} ${num(rw.value)} (${rankOf(rw)}), so ${rb.rank! <= 8 ? `points should be hard to come by for the ${worse.team.nickname}` : `the ${better.team.nickname} defense carries the edge`}.`,
  };
}

/** The starting quarterback's efficiency against the pass defense he faces, when one end is a league extreme. */
function qbEfficiency(p: Preview, s: PreviewSide, opp: PreviewSide): Story | null {
  const qb = starters(s.roster, "QB", 1)[0];
  const rating = row(s.stats, "off-passer-rating");
  const allowed = row(opp.stats, "def-passer-rating");
  if (!qb || !rating || !allowed) return null;
  const strong = rating.rank! <= 6 && allowed.rank! >= 20;
  const weak = rating.rank! >= 26 && allowed.rank! <= 8;
  if (!strong && !weak) return null;
  return {
    id: "qbEfficiency",
    side: s.key,
    score: 8 + Math.abs(rating.rank! - allowed.rank!) / 3,
    text: strong
      ? `The ${s.team.nickname} passing game, at a ${num(rating.value)} passer rating (${rankOf(rating)} of 32), meets ${an(opp.team.nickname)} pass defense allowing ${num(allowed.value)} (${rankOf(allowed)} of 32 defenses), a matchup that favors ${qb.name}.`
      : `${qb.name} and the ${s.team.nickname} passing game (${num(rating.value)} passer rating, ${rankOf(rating)} of 32) face ${an(opp.team.nickname)} pass defense holding opponents to ${num(allowed.value)} (${rankOf(allowed)} of 32 defenses).`,
    subject: qb.name,
  };
}

/** A starting QB, RB1, WR1-2 or TE1 listed Questionable or Doubtful for this game. */
function doubt(p: Preview, s: PreviewSide): Story | null {
  const core = new Set(
    [...depthTop(s.roster, "QB", 1), ...depthTop(s.roster, "RB", 1), ...depthTop(s.roster, "WR", 2), ...depthTop(s.roster, "TE", 1)].map((r) => r.name),
  );
  const row = p.injuries[s.key].find((r) => (r.status === "Questionable" || r.status === "Doubtful") && core.has(r.name));
  if (!row) return null;
  return {
    id: "doubt",
    side: s.key,
    score: (row.pos === "QB" ? 20 : 9) + (row.status === "Doubtful" ? 3 : 0),
    text: `${row.name} is listed ${row.status.toLowerCase()} for the ${s.team.nickname}. ${row.fallout.replace(/ Inactives post[^.]*\./, "")}`.trim(),
    subject: row.name,
  };
}

/* ------------------------------------------------------------ compose */

function opening(p: Preview, lead: Story | null): string {
  const { away, home, line } = p;
  const spread = line?.spread ?? null;
  const fav = spread === null || Math.abs(spread) < 1 ? null : spread < 0 ? home : away;
  const dog = fav ? (fav === home ? away : home) : null;
  const rec = (s: PreviewSide) => (s.record ? ` (${s.record})` : "");
  const division = away.team.division === home.team.division ? `In a ${away.team.division} game, ` : "";
  const venue = p.meeting.neutralSite ? `meet${p.meeting.venueCity ? ` in ${p.meeting.venueCity}` : ""}` : null;
  if (fav && dog && spread !== null) {
    const size = Math.abs(spread);
    const where = venue ? "" : fav === home ? " at home" : " on the road";
    const strength = size >= 10 ? "commanding " : size <= 3 ? "slight " : "";
    return (
      `${division}${division ? "the" : "The"} ${fav.team.nickname}${rec(fav)} are ${strength}${trim(size)}-point favorites${where} against the ${dog.team.nickname}${rec(dog)}` +
      (lead?.id === "gap" ? (size >= 6 ? `, and the season numbers explain why. ${lead.text}` : `. ${lead.text}`) : `.`)
    );
  }
  return (
    `${division}${division ? "the" : "The"} ${away.team.nickname}${rec(away)} and ${home.team.nickname}${rec(home)} ${venue ?? "meet"} ` +
    (spread !== null ? `in a game the market rates close to even.` : `in ${p.meeting.weekLabel}.`) +
    (lead?.id === "gap" ? ` ${lead.text}` : "")
  );
}

const PHASE: Record<string, string> = {
  passing: "the passing game",
  rushing: "the ground game",
  pressure: "the pass rush",
  turnovers: "turnovers",
  thirdDown: "third downs",
  injury: "the injury report",
};

/** The phase as the side holding the edge sees it: the Jets' edge on a Chargers passing key is their pass defense. */
function phaseFor(k: GameKey): string {
  const offenseHasIt = k.edge !== null && k.edge === k.side;
  switch (k.kind) {
    case "passing":
      return offenseHasIt ? "the passing game" : "pass defense";
    case "rushing":
      return offenseHasIt ? "the ground game" : "run defense";
    case "pressure":
      return offenseHasIt ? "pass protection" : "the pass rush";
    case "thirdDown":
      return offenseHasIt ? "third-down offense" : "third-down defense";
    default:
      return PHASE[k.kind] ?? "execution";
  }
}

function outlook(p: Preview, told: Story[], keys: GameKey[]): string {
  const { away, home, line } = p;
  const spread = line?.spread ?? null;
  const total = line?.total ?? null;
  const fav = spread === null || Math.abs(spread) < 2.5 ? null : spread < 0 ? home : away;
  const dog = fav ? (fav === home ? away : home) : null;
  void told;
  const parts: string[] = [];
  const key = keys.find((k) => k.kind !== "injury") ?? null;
  if (fav && dog && spread !== null && Math.abs(spread) >= 7) {
    const passD = row(fav.stats, "def-pass-yards");
    parts.push(
      `The challenge for the ${dog.team.nickname} is keeping this competitive long enough for their best matchups to matter. ` +
        `If the ${fav.team.nickname} build an early lead, the ${dog.team.nickname} are pushed into a pass-heavy script` +
        (passD && passD.rank! <= 10 ? ` against a pass defense ranked ${rankOf(passD)} of 32.` : `.`),
    );
  } else if (fav && dog) {
    const edge = key?.edge ? (key.edge === "away" ? away : home) : null;
    parts.push(
      `The ${fav.team.nickname} are favored, but by a margin one turnover or explosive play can erase. ` +
        (key && edge === dog
          ? `The ${possessive(dog.team.nickname)} best path to an upset runs through ${phaseFor(key)}, where they hold the edge.`
          : key && edge === fav
            ? `${cap(phaseFor(key))} is where the ${fav.team.nickname} can turn a narrow edge into a comfortable one.`
            : `Neither side has a phase it clearly controls, so execution decides it.`),
    );
  } else {
    const edge = key?.edge ? (key.edge === "away" ? away : home) : null;
    parts.push(
      `Nothing separates these teams on the line` +
        (key && edge ? `, so ${phaseFor(key)}, where the ${edge.team.nickname} hold the edge, may be the difference.` : `, so execution decides it.`),
    );
  }
  if (total !== null) {
    parts.push(
      total >= 48
        ? `A ${trim(total)}-point total points to a game with plenty of scoring opportunities.`
        : total <= 40
          ? `A ${trim(total)}-point total expects a low-scoring game.`
          : "",
    );
  }
  return parts.filter(Boolean).join(" ");
}

function headlineFor(p: Preview, top: Story | null, stories: Story[], keys: GameKey[]): string {
  const { away, home, line } = p;
  const spread = line?.spread ?? null;
  const fav = spread === null || Math.abs(spread) < 2.5 ? null : spread < 0 ? home : away;
  const dog = fav ? (fav === home ? away : home) : null;
  const pair = `${away.team.nickname} vs. ${home.team.nickname}`;
  const sideOf = (st: Story) => (st.side === "away" ? away : home);
  switch (top?.id) {
    case "newQb": {
      const side = sideOf(top);
      const other = side === away ? home : away;
      const qbOther = starters(other.roster, "QB", 1)[0]?.name ?? null;
      const hot = stories.find((s) => s.id === "bigGame" && s.side === other.key && s.meta?.pos === "QB");
      const who = top.meta?.rookie ? `the ${possessive(side.team.nickname)} rookie quarterback` : last(String(top.meta?.name));
      const otherPts = row(other.stats, "off-points");
      if (dog === side && (hot || (qbOther && otherPts && otherPts.rank! <= 10))) return `${pair}: Can ${who} keep pace with ${hot ? last(String(hot.meta!.name)) : last(qbOther!)}?`;
      return `${pair}: ${cap(who)} gets his ${ordWord(Number(top.meta?.nth ?? 1))} start`;
    }
    case "standIn":
      return top.meta?.pending
        ? `${pair}: ${possessive(sideOf(top).team.nickname)} ${top.meta!.pos === "RB" ? "backfield" : "passing game"} waits on ${last(String(top.meta!.starter))}`
        : `${pair}: ${top.meta!.name} steps in for the ${sideOf(top).team.nickname}`;
    case "bigGame": {
      const l = top.meta!.line as Line;
      if (top.meta!.pos === "QB") return `${pair}: Can ${last(String(top.meta!.name))} follow a ${word(l.passTd)}-touchdown game?`;
      const yards = l.rushYds + l.recYds;
      return `${pair}: ${top.meta!.name} brings a ${yards}-yard game into ${p.meeting.weekLabel}`;
    }
    case "absence":
      return `${pair}: The ${sideOf(top).team.nickname} without ${top.subject}`;
    case "doubt":
      return `${pair}: ${top.subject}'s status hangs over the ${sideOf(top).team.nickname}`;
    case "mismatch": {
      const k = keys.find((x) => x.kind === top.meta?.kind);
      if (k) return `${pair}: ${k.question}`;
      break;
    }
    case "target":
      return `${pair}: ${top.subject} draws a favorable matchup`;
    case "qbEfficiency":
      return `${pair}: ${top.subject} against the ${(top.side === "away" ? home : away).team.nickname} pass defense`;
    case "momentum": {
      const t = sideOf(top).team.nickname;
      if (typeof top.meta?.streak === "number") {
        return top.meta.won
          ? `${pair}: The ${t} put a ${word(Number(top.meta.streak))}-game winning streak on the line`
          : `${pair}: Can the ${t} end a ${word(Number(top.meta.streak))}-game skid?`;
      }
      return Number(top.meta?.delta) > 0 ? `${pair}: The ${t} offense is heating up` : `${pair}: Can the ${t} offense find its form?`;
    }
    default:
      break;
  }
  if (fav && dog && spread !== null && Math.abs(spread) >= 10) return `${pair}: Can the ${dog.team.nickname} stay with the ${fav.team.nickname}?`;
  if (!fav) return `${pair}: Little separates these teams`;
  return `${pair}: What decides ${p.meeting.weekLabel}`;
}

export function composePreview(p: Preview): PreviewNarrative | null {
  const keys = gameKeys(p, 5);
  const candidates: Array<Story | null> = [
    newQb(p, p.away, p.home),
    newQb(p, p.home, p.away),
    bigGame(p, p.away),
    bigGame(p, p.home),
    standIn(p, p.away),
    standIn(p, p.home),
    absence(p, p.away),
    absence(p, p.home),
    gap(p),
    momentum(p, p.away),
    momentum(p, p.home),
    target(p, p.away, p.home),
    target(p, p.home, p.away),
    mismatch(p, keys),
    defenseGap(p),
    qbEfficiency(p, p.away, p.home),
    qbEfficiency(p, p.home, p.away),
    doubt(p, p.away),
    doubt(p, p.home),
  ];
  // Last week's starts, workloads and designations describe only the clubs'
  // next game; a game further out keeps the season-level storylines.
  const recent = new Set(["newQb", "bigGame", "standIn", "doubt"]);
  const stories = candidates
    .filter((s): s is Story => s !== null && s.score > 0 && (p.nextGame || !recent.has(s.id)))
    .sort((a, b) => b.score - a.score);
  if (!stories.length && !p.line) return null;

  // The opening carries the scoring gap when there is one; the body tells the
  // strongest two to four of the rest, each player at most once.
  const gapStory = stories.find((s) => s.id === "gap") ?? null;
  const body: Story[] = [];
  const named = new Set<string>();
  for (const s of stories) {
    if (s.id === "gap") continue;
    if (body.length >= 4) break;
    if (s.subject && named.has(s.subject)) continue;
    // A stand-in story already tells the absence it comes from.
    if (s.id === "absence" && body.some((b) => b.side === s.side && (b.id === "standIn" || (b.id === "newQb" && s.meta?.pos === "QB")))) continue;
    if (s.id === "bigGame" && body.some((b) => b.id === "standIn" && b.subject === s.subject)) continue;
    body.push(s);
    if (s.subject) named.add(s.subject);
  }

  const top = body[0] ?? null;
  const paragraphs: string[] = [];
  paragraphs.push(opening(p, gapStory) + (top && body.length === 2 ? ` Beyond the line, two storylines could shape how it unfolds.` : ""));

  // Context: quarterback situations, absences and form; key matchups: the rest.
  const contextIds = new Set(["newQb", "absence", "momentum", "doubt", "defenseGap"]);
  const context = body.filter((s) => contextIds.has(s.id));
  const matchups = body.filter((s) => !contextIds.has(s.id));
  if (context.length) paragraphs.push(context.map((s) => s.text).join(" "));
  // One paragraph per matchup storyline, so each reads as its own point.
  for (const s of matchups) paragraphs.push(s.text);
  paragraphs.push(outlook(p, body, keys));

  const clean = paragraphs.map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
  const words = clean.join(" ").split(/\s+/).length;
  return {
    // The banner right above already names the pair ("Cardinals vs. Chiefs:
    // Week 11 Game Preview"), so the card's headline drops that prefix.
    headline: cap(headlineFor(p, top, stories, keys).replace(/^[^:]+:\s*/, "")),
    paragraphs: clean,
    storylines: [...(gapStory ? ["gap"] : []), ...body.map((s) => s.id)],
    words,
  };
}
