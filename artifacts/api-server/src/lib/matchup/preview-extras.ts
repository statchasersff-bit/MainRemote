/**
 * Recent form, player battles and game conditions for the upcoming matchup
 * page (mak, 2026-11-06), built alongside the preview in buildPreview() and
 * printed by preview-premium.ts.
 *
 * Recent form   each team's last five results from its own schedule, and its
 *               points scored / allowed over them against the season average.
 * Player battles one card per offense: the QB against the pass rush, the
 *               tackles against the edge rushers, the top target against the
 *               secondary, the lead back against the front. Names come from the
 *               depth charts and usage file; defenders' season numbers from
 *               data/matchup/defenders_<season>.json (scripts/matchup/
 *               buildDefenders.mjs, nflverse weekly stats). No coverage or
 *               blocking assignment is ever stated: the card pairs units, and
 *               says so, because no alignment data backs a one-on-one.
 * Conditions    kickoff temperature, wind, rain chance and roof, with an impact
 *               note only when a threshold is met (wind 15+ mph, rain 50%+,
 *               25°F or colder, 90°F or hotter).
 */

import { dataPath } from "../data-dir";
import { depthChartNames, depthHeadshot, depthStarters, nameKey } from "../team/depth-charts";
import { readDataJson } from "../team/read-json";
import type { ScheduleGame } from "../team/schedule";
import type { StatRow, TeamStats } from "../team/stats";
import type { NflTeam } from "../team/teams";
import type { Forecast, GameLine } from "./game-lines";

/* ------------------------------------------------------------ recent form */

export interface FormGame {
  week: number;
  weekLabel: string;
  opp: string;
  homeAway: "home" | "away";
  outcome: "W" | "L" | "T";
  pf: number;
  pa: number;
}

export interface TeamForm {
  /** Oldest first, at most five. */
  games: FormGame[];
  record: string;
  recent: { pf: number; pa: number };
  season: { pf: number; pa: number; games: number };
}

const avg = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

export function teamForm(games: ScheduleGame[] | undefined, n = 5): TeamForm | null {
  const played = (games ?? [])
    .filter((g) => g.result && g.seasonType !== "post")
    .sort((a, b) => a.week - b.week);
  if (!played.length) return null;
  const last = played.slice(-n);
  const tally = (o: "W" | "L" | "T") => last.filter((g) => g.result!.outcome === o).length;
  const t = tally("T");
  return {
    games: last.map((g) => ({
      week: g.week,
      weekLabel: g.weekLabel,
      opp: (g.opponent?.abbreviation ?? g.opponentName).toUpperCase(),
      homeAway: g.homeAway,
      outcome: g.result!.outcome,
      pf: g.result!.teamScore,
      pa: g.result!.opponentScore,
    })),
    record: `${tally("W")}-${tally("L")}${t ? `-${t}` : ""}`,
    recent: { pf: avg(last.map((g) => g.result!.teamScore)), pa: avg(last.map((g) => g.result!.opponentScore)) },
    season: {
      pf: avg(played.map((g) => g.result!.teamScore)),
      pa: avg(played.map((g) => g.result!.opponentScore)),
      games: played.length,
    },
  };
}

/* --------------------------------------------------------- player battles */

interface DefenderRow {
  id: string;
  name: string;
  pos: string;
  games: number;
  sacks: number;
  qbHits: number;
  tfl: number;
  pd: number;
  int: number;
}

interface QbRow {
  name: string;
  games: number;
  attempts: number;
  sacksTaken: number;
}

interface DefendersDoc {
  season: number;
  builtAt: string;
  throughWeek: number;
  teams: Record<string, { defenders: DefenderRow[]; qbs: QbRow[] }>;
}

function defendersDoc(season: number): DefendersDoc | null {
  return readDataJson<DefendersDoc>(dataPath("matchup", `defenders_${season}.json`));
}

/** Freshness stamp for the page's cache key. */
export function defendersVersion(season: number): number {
  const doc = defendersDoc(season);
  return doc ? Date.parse(doc.builtAt) || 0 : 0;
}

export interface BattlePlayer {
  name: string;
  /** Short position under the name: "QB", "LT", "EDGE", "CB". */
  role: string;
  /** The numbers for the expanded view, e.g. "4.5 sacks · 11 QB hits"; "" when none. */
  stat: string;
  /** Headshot: a Sleeper id, else a depth-chart image URL for headshotImg(). */
  photo: { id: string | null; src: string | null };
  /** A defender's GSIS id from the season file, for his name's link. */
  gsisId?: string | null;
}

export type BattleKind = "qbRush" | "tackles" | "receiver" | "run";

export interface Battle {
  kind: BattleKind;
  offense: BattlePlayer[];
  defense: BattlePlayer[];
  /** One line of team context with ranks; no assignment claimed. */
  note: string;
  /** Relevance, for picking the page's few (pickBattles). */
  score?: number;
}

export const BATTLE_WORD: Record<BattleKind, string> = {
  qbRush: "Quarterback vs pass rush",
  tackles: "Tackles vs edge rushers",
  receiver: "Top target vs coverage",
  run: "Run game vs front",
};

/** Usage players, the slice this card reads. */
export interface UsageLite {
  name: string;
  sleeperId?: string | null;
  pos: string;
  targets: number;
  targetShare: number | null;
  recYards?: number;
  carries: number;
  rushYards?: number;
}

export interface BattleSide {
  team: NflTeam;
  stats: TeamStats | null;
  usage: UsageLite[];
  qb: string | null;
  /** The expected lead back for THIS game (availability-aware starters()), or null. */
  rb?: string | null;
  /** Name keys of offensive players not expected to play this game (Out, reserve, pending). */
  unavailable?: Set<string>;
  /** Sleeper ids by name key (roster and usage), for the headshots. */
  ids: Record<string, string>;
}

/** A player's headshot source: his Sleeper id when known, else the depth chart's image. */
function photoOf(side: BattleSide, name: string): BattlePlayer["photo"] {
  const clean = name.replace(/ \(Q\)$/, "");
  const id = side.ids[nameKey(clean)] ?? null;
  return { id, src: id ? null : depthHeadshot(side.team.abbreviation, clean) };
}

const one = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const plural = (n: number, word: string): string => `${one(n)} ${word}${n === 1 ? "" : "s"}`;

function row(stats: TeamStats | null, key: string): StatRow | null {
  if (!stats) return null;
  for (const group of [stats.offense, stats.defense, stats.situational, stats.volume]) {
    const r = group.find((x) => x.key === key);
    if (r && r.rank !== null) return r;
  }
  return null;
}

/** Out of 32 (mak's 2026-11-18 brief): "8th of 32", "28th of 32 defenses". */
function rank(r: StatRow, mode: "nfl" | "fewest" | "most"): string {
  const label = r.rankLabel ?? String(r.rank);
  const place = label.startsWith("T-") ? `tied for ${label.slice(2)}` : label;
  return mode === "fewest" ? `${place} of 32 defenses` : `${place} of 32`;
}

function find<T extends { name: string }>(rows: T[], name: string): T | null {
  const key = nameKey(name);
  return rows.find((r) => nameKey(r.name) === key) ?? null;
}

const q = (p: { questionable: boolean }): string => (p.questionable ? " (Q)" : "");

/** Never a pass rusher, whatever his sack count (a blitzing safety is not the pass rush). */
const SECONDARY = /^(CB|S|SAF|FS|SS|DB)$/;
/** Front positions in the season stats file. */
const FRONT = /^(DE|DT|DL|NT|OLB|EDGE)$/;

/** The rank gap between two rows plus a bonus for a league extreme: how lopsided a phase is. */
function lopsided(a: StatRow | null, b: StatRow | null): number {
  if (!a || !b) return 0;
  const ext = (r: number) => (r <= 3 || r >= 30 ? 6 : r <= 5 || r >= 28 ? 3 : 0);
  return Math.abs(a.rank! - b.rank!) + ext(a.rank!) + ext(b.rank!);
}

/**
 * One offense's battles with a relevance score each (mak's 2026-11-18 brief:
 * "three excellent, context-rich matchup analyses rather than eight generic
 * pairings"). Every participant is checked for the role: pass rushers come
 * from the defense's EDGE and DL depth-chart slots (the season file lists
 * edge rushers as "LB" and counts a safety's blitz sacks), a tight end is
 * matched with the linebackers and safeties who cover tight ends, and the
 * quarterback, lead back and top target are the ones expected to play this
 * game. preview.ts keeps the best three of both offenses (pickBattles).
 */
export function battlesFor(o: BattleSide, d: BattleSide, season: number): Battle[] {
  const doc = defendersDoc(season);
  const off = doc?.teams[o.team.abbreviation.toUpperCase()] ?? null;
  const stored = doc?.teams[d.team.abbreviation.toUpperCase()] ?? null;
  if (!off || !stored) return [];
  // Data check: a defender is named only while he is on the team's current
  // depth chart and available (released, traded, IR and Out are dropped).
  const onChart = depthChartNames(d.team.abbreviation);
  const def = onChart ? { ...stored, defenders: stored.defenders.filter((x) => onChart.has(nameKey(x.name))) } : stored;
  const unavailable = o.unavailable ?? new Set<string>();
  const available = (name: string) => !unavailable.has(nameKey(name));
  const O = o.team.nickname;
  const D = d.team.nickname;
  const out: Battle[] = [];

  // The defense's front by its depth chart: edge and interior starters.
  const chartFront = [...depthStarters(d.team.abbreviation, "EDGE", 3), ...depthStarters(d.team.abbreviation, "DL", 3)];
  const frontKeys = new Set(chartFront.map((x) => nameKey(x.name)));
  const rushersFrom = (n: number) => {
    const fromChart = def.defenders.filter((x) => frontKeys.has(nameKey(x.name)) && !SECONDARY.test(x.pos));
    const pool = fromChart.length ? fromChart : def.defenders.filter((x) => FRONT.test(x.pos));
    return pool
      .filter((x) => x.sacks > 0 || x.qbHits > 0)
      .sort((a, b) => b.sacks - a.sacks || b.qbHits - a.qbHits)
      .slice(0, n);
  };

  // QB vs the pass rush: his sacks taken; the front's two leading rushers.
  const qbName = o.qb && available(o.qb) ? o.qb : null;
  const qb = qbName ? find(off.qbs, qbName) : null;
  const rushers = rushersFrom(2);
  const allowed = row(o.stats, "sacks-allowed");
  const made = row(d.stats, "sacks-made");
  if (qbName && rushers.length) {
    out.push({
      kind: "qbRush",
      offense: [
        {
          name: qbName,
          role: "QB",
          stat: qb ? `${plural(qb.sacksTaken, "sack")} taken on ${qb.attempts} attempts` : "",
          photo: photoOf(o, qbName),
        },
      ],
      defense: rushers.map((x) => ({ name: x.name, role: x.pos === "LB" || x.pos === "OLB" ? "EDGE" : x.pos, stat: `${plural(x.sacks, "sack")} · ${x.qbHits} QB hits`, photo: photoOf(d, x.name), gsisId: x.id ?? null })),
      note:
        allowed && made
          ? `The ${O} have allowed ${allowed.value} sacks (${rank(allowed, "nfl")}); the ${D} have ${made.value} (${rank(made, "nfl")}).`
          : "",
      score: 8 + lopsided(allowed, made) + (qb && qb.attempts < 60 ? 6 : 0),
    });
  }

  // The top target vs the players who cover him: corners for a receiver, the
  // linebacker and safety for a tight end. No one-on-one assignment implied.
  const target = [...o.usage]
    .filter((u) => (u.pos === "WR" || u.pos === "TE") && available(u.name))
    .sort((a, b) => b.targets - a.targets)[0];
  const ypa = row(d.stats, "def-yards-per-attempt");
  if (target && target.targets > 0) {
    const isTe = target.pos === "TE";
    const cover = isTe
      ? [...depthStarters(d.team.abbreviation, "LB", 1).map((x) => ({ ...x, role: "LB" })), ...depthStarters(d.team.abbreviation, "S", 1).map((x) => ({ ...x, role: "S" }))]
      : depthStarters(d.team.abbreviation, "CB", 2).map((x) => ({ ...x, role: "CB" }));
    if (cover.length) {
      out.push({
        kind: "receiver",
        offense: [
          {
            name: target.name,
            role: target.pos,
            stat:
              `${target.targets} targets` +
              (target.targetShare !== null ? ` (${target.targetShare.toFixed(1)}% share)` : "") +
              (target.recYards !== undefined ? ` · ${target.recYards} yds` : ""),
            photo: photoOf(o, target.name),
          },
        ],
        defense: cover.map((c) => {
          const st = find(def.defenders, c.name);
          return {
            name: `${c.name}${q(c)}`,
            role: c.role,
            stat: st
              ? c.role === "LB"
                ? `${one(st.tfl)} tackles for loss · ${st.pd} ${st.pd === 1 ? "pass" : "passes"} defended`
                : `${st.pd} ${st.pd === 1 ? "pass" : "passes"} defended${st.int ? ` · ${st.int} INT` : ""}`
              : "No passes defended yet",
            photo: photoOf(d, c.name),
            gsisId: st?.id ?? null,
          };
        }),
        note:
          (ypa ? `The ${D} allow ${ypa.value} yards per pass attempt (${rank(ypa, "fewest")}). ` : "") +
          (isTe
            ? `Tight ends are covered mostly by linebackers and safeties, so this is ${target.name} against that pair, not a charted assignment.`
            : `Coverage assignments are not charted, so this is the receiver against the starting corners, not a set matchup.`),
        score: 6 + (target.targetShare ?? 0) / 2 + (ypa ? Math.max(0, (ypa.rank! - 16) / 2) : 0),
      });
    }
  }

  // The lead back expected to play vs the front's run stoppers.
  const backName = o.rb && available(o.rb) ? o.rb : null;
  const back =
    (backName ? find(o.usage, backName) : null) ??
    [...o.usage].filter((u) => u.pos === "RB" && available(u.name)).sort((a, b) => b.carries - a.carries)[0] ??
    null;
  const named = new Set(out.flatMap((b) => b.defense.map((x) => nameKey(x.name.replace(/ \(Q\)$/, "")))));
  const front = def.defenders
    .filter((x) => !SECONDARY.test(x.pos) && x.tfl > 0)
    .sort((a, b) => Number(named.has(nameKey(a.name))) - Number(named.has(nameKey(b.name))) || b.tfl - a.tfl || b.sacks - a.sacks)
    .slice(0, 2);
  const yds = row(o.stats, "off-rush-yards");
  const rushAllowed = row(d.stats, "def-rush-yards");
  if (back && back.carries > 0 && front.length) {
    out.push({
      kind: "run",
      offense: [
        {
          name: back.name,
          role: "RB",
          stat:
            `${back.carries} carries` +
            (back.rushYards !== undefined ? ` · ${back.rushYards} yds (${(back.rushYards / back.carries).toFixed(1)} a carry)` : ""),
          photo: photoOf(o, back.name),
        },
      ],
      defense: front.map((x) => ({ name: x.name, role: x.pos, stat: `${one(x.tfl)} tackles for loss · ${plural(x.sacks, "sack")}`, photo: photoOf(d, x.name), gsisId: x.id ?? null })),
      note:
        yds && rushAllowed
          ? `The ${O} run for ${yds.value} yards a game (${rank(yds, "nfl")}); the ${D} allow ${rushAllowed.value} (${rank(rushAllowed, "fewest")}).`
          : "",
      score: 4 + lopsided(yds, rushAllowed),
    });
  }
  return out;
}

/**
 * The battles the page shows: the best `max` of both offenses by score, at
 * most two from one offense, in each offense's own order.
 */
export function pickBattles(away: Battle[], home: Battle[], max = 3): { away: Battle[]; home: Battle[] } {
  const all = [...away.map((b) => ({ b, side: "away" as const })), ...home.map((b) => ({ b, side: "home" as const }))].sort(
    (x, y) => (y.b.score ?? 0) - (x.b.score ?? 0),
  );
  const keep = new Set<Battle>();
  const per = { away: 0, home: 0 };
  for (const { b, side } of all) {
    if (keep.size >= max) break;
    if (per[side] >= 2) continue;
    keep.add(b);
    per[side] += 1;
  }
  return { away: away.filter((b) => keep.has(b)), home: home.filter((b) => keep.has(b)) };
}

/* ------------------------------------------------------------- conditions */

export interface Conditions {
  indoor: boolean | null;
  tempF: number | null;
  windMph: number | null;
  precipPct: number | null;
  sky: string | null;
  /** Only when a threshold is met; null otherwise. */
  impact: string | null;
}

export function gameConditions(line: GameLine | null, forecast: Forecast | null): Conditions | null {
  const indoor = line?.indoor ?? null;
  if (indoor) return { indoor: true, tempF: null, windMph: null, precipPct: null, sky: null, impact: null };
  const tempF = forecast?.tempF ?? line?.weather?.tempF ?? null;
  const windMph = forecast?.windMph ?? null;
  const precipPct = forecast?.precipPct ?? line?.weather?.precipPct ?? null;
  const sky = line?.weather?.condition ?? null;
  if (indoor === null && tempF === null && windMph === null && precipPct === null && !sky) return null;
  const notes: string[] = [];
  if (windMph !== null && windMph >= 15)
    notes.push(`Kickoff wind of ${Math.round(windMph)} mph is strong enough to cut into deep passing and long field goals.`);
  if (precipPct !== null && precipPct >= 50)
    notes.push(`A ${Math.round(precipPct)}% chance of rain at kickoff favors short passes and the run game, and raises fumble risk.`);
  if (tempF !== null && tempF <= 25) notes.push(`A ${Math.round(tempF)}°F kickoff makes the ball harder to throw and catch.`);
  if (tempF !== null && tempF >= 90) notes.push(`A ${Math.round(tempF)}°F kickoff tests depth and conditioning late in the game.`);
  return { indoor, tempF, windMph, precipPct, sky, impact: notes.length ? notes.join(" ") : null };
}
