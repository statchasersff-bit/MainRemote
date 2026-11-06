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
}

export type BattleKind = "qbRush" | "tackles" | "receiver" | "run";

export interface Battle {
  kind: BattleKind;
  offense: BattlePlayer[];
  defense: BattlePlayer[];
  /** One line of team context with ranks; no assignment claimed. */
  note: string;
}

export const BATTLE_WORD: Record<BattleKind, string> = {
  qbRush: "Quarterback vs pass rush",
  tackles: "Tackles vs edge rushers",
  receiver: "Top target vs secondary",
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

function rank(r: StatRow, mode: "nfl" | "fewest" | "most"): string {
  const label = r.rankLabel ?? String(r.rank);
  const place = label.startsWith("T-") ? `tied for ${label.slice(2)}` : label;
  return mode === "nfl" ? `${place} in the NFL` : `${place}-${mode}`;
}

function find<T extends { name: string }>(rows: T[], name: string): T | null {
  const key = nameKey(name);
  return rows.find((r) => nameKey(r.name) === key) ?? null;
}

const q = (p: { questionable: boolean }): string => (p.questionable ? " (Q)" : "");

export function battlesFor(o: BattleSide, d: BattleSide, season: number): Battle[] {
  const doc = defendersDoc(season);
  const off = doc?.teams[o.team.abbreviation.toUpperCase()] ?? null;
  const stored = doc?.teams[d.team.abbreviation.toUpperCase()] ?? null;
  if (!off || !stored) return [];
  // Data check: a defender is named only while he is on the team's current
  // depth chart and available (released, traded, IR and Out are dropped).
  const onChart = depthChartNames(d.team.abbreviation);
  const def = onChart ? { ...stored, defenders: stored.defenders.filter((x) => onChart.has(nameKey(x.name))) } : stored;
  const O = o.team.nickname;
  const D = d.team.nickname;
  const out: Battle[] = [];

  // QB vs the pass rush: his sacks taken; their two sack leaders.
  const qbName = o.qb ?? off.qbs[0]?.name ?? null;
  const qb = qbName ? find(off.qbs, qbName) : null;
  const rushers = def.defenders.filter((x) => x.sacks > 0).slice(0, 2);
  if (qbName && qb && rushers.length) {
    const allowed = row(o.stats, "sacks-allowed");
    const made = row(d.stats, "sacks-made");
    out.push({
      kind: "qbRush",
      offense: [{ name: qbName, role: "QB", stat: `${plural(qb.sacksTaken, "sack")} taken on ${qb.attempts} attempts`, photo: photoOf(o, qbName) }],
      defense: rushers.map((x) => ({ name: x.name, role: x.pos, stat: `${plural(x.sacks, "sack")} · ${x.qbHits} QB hits`, photo: photoOf(d, x.name) })),
      note:
        allowed && made
          ? `The ${O} have allowed ${allowed.value} sacks (${rank(allowed, "fewest")}); the ${D} have ${made.value} (${rank(made, "most")}).`
          : "",
    });
  }

  // Tackles vs edge rushers: the depth chart's starters, no side-by-side claim.
  const lt = depthStarters(o.team.abbreviation, "LT", 1)[0];
  const rt = depthStarters(o.team.abbreviation, "RT", 1)[0];
  let edges = depthStarters(d.team.abbreviation, "EDGE", 2);
  if (!edges.length) {
    edges = def.defenders
      .filter((x) => /^(DE|OLB|EDGE)$/.test(x.pos))
      .slice(0, 2)
      .map((x) => ({ name: x.name, questionable: false }));
  }
  if (lt && rt && edges.length) {
    out.push({
      kind: "tackles",
      offense: [
        { name: `${lt.name}${q(lt)}`, role: "LT", stat: "", photo: photoOf(o, lt.name) },
        { name: `${rt.name}${q(rt)}`, role: "RT", stat: "", photo: photoOf(o, rt.name) },
      ],
      defense: edges.map((e) => {
        const s = find(def.defenders, e.name);
        return { name: `${e.name}${q(e)}`, role: "EDGE", stat: s ? `${plural(s.sacks, "sack")} · ${s.qbHits} QB hits` : "No sacks yet", photo: photoOf(d, e.name) };
      }),
      note: "Edge rushers move between sides, so this pairs the units rather than naming one-on-one assignments.",
    });
  }

  // The top target vs the secondary: no coverage assignment is implied.
  const target = [...o.usage].filter((u) => u.pos === "WR" || u.pos === "TE").sort((a, b) => b.targets - a.targets)[0];
  const corners = depthStarters(d.team.abbreviation, "CB", 2);
  if (target && target.targets > 0 && corners.length) {
    const ypa = row(d.stats, "def-yards-per-attempt");
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
      defense: corners.map((c) => {
        const s = find(def.defenders, c.name);
        return {
          name: `${c.name}${q(c)}`,
          role: "CB",
          stat: s ? `${s.pd} ${s.pd === 1 ? "pass" : "passes"} defended${s.int ? ` · ${s.int} INT` : ""}` : "No passes defended yet",
          photo: photoOf(d, c.name),
        };
      }),
      note:
        (ypa ? `The ${D} allow ${ypa.value} yards per pass attempt (${rank(ypa, "fewest")}). ` : "") +
        `Coverage assignments are not charted, so this is the receiver against the secondary, not a set matchup.`,
    });
  }

  // The lead back vs the front: the front's tackles-for-loss leaders.
  const back = [...o.usage].filter((u) => u.pos === "RB").sort((a, b) => b.carries - a.carries)[0];
  // Defenders the pass-rush and edge battles already named go last, so the
  // front reads as more of the defense than its sack leaders again.
  const named = new Set(out.flatMap((b) => b.defense.map((x) => nameKey(x.name.replace(/ \(Q\)$/, "")))));
  const front = def.defenders
    .filter((x) => !/^(CB|S|SAF|FS|SS|DB)$/.test(x.pos) && x.tfl > 0)
    .sort((a, b) => Number(named.has(nameKey(a.name))) - Number(named.has(nameKey(b.name))) || b.tfl - a.tfl || b.sacks - a.sacks)
    .slice(0, 2);
  if (back && back.carries > 0 && front.length) {
    const yds = row(o.stats, "off-rush-yards");
    const allowed = row(d.stats, "def-rush-yards");
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
      defense: front.map((x) => ({ name: x.name, role: x.pos, stat: `${one(x.tfl)} tackles for loss · ${plural(x.sacks, "sack")}`, photo: photoOf(d, x.name) })),
      note:
        yds && allowed
          ? `The ${O} run for ${yds.value} yards a game (${rank(yds, "nfl")}); the ${D} allow ${allowed.value} (${rank(allowed, "fewest")}).`
          : "",
    });
  }
  return out;
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
