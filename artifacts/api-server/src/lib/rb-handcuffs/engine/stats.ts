/**
 * The 2025 RB stats and injury history, merged into one record per back.
 *
 * Ported from the standalone app's server/rb-data-service.ts. What decides the
 * numbers is unchanged — the name normalisation, the per-game conversions,
 * the talent-only strip for a back who changed teams, the "season's starter is
 * the back with the most touches" rule for Backfield Opportunity. What changed
 * is the shape: these are pure functions over already-parsed rows, where the
 * original read files, cached for six hours and ran scheduler hooks. The
 * loading lives in handcuffs-data.ts.
 */

import { scorePlayerQuality, type RBStatRow } from "./player-quality";
import type { PlayerQualityResult } from "./types";

export interface MergedRBData {
  player: string;
  team: string;
  games: number;
  /** Age in the 2025 season, from the stats row. */
  age: number | null;
  snap_pct: number | null;
  touches_per_gm: number | null;
  /** 2025 rush attempts + receptions: ranks a team's backs. */
  season_touches: number | null;
  rush_att_per_gm: number | null;
  targets_per_gm: number | null;
  routes_per_gm: number | null;
  route_pct: number | null;
  rz_touches: number | null;
  rz_rush_att: number | null;
  goal_line_att: number | null;
  usage_role_score: number | null;
  role_trend: string | null;
  efficiency_score: number | null;
  yards_per_touch: number | null;
  yards_per_carry: number | null;
  explosive_run_pct: number | null;
  breakaway_run_pct: number | null;
  broken_tackles_per_att: number | null;
  epa_per_rush: number | null;
  player_quality: PlayerQualityResult | null;
}

export interface DataNorms {
  touches_per_gm: number;
  snap_pct: number;
  rush_att_per_gm: number;
  targets_per_gm: number;
  route_pct: number;
  rz_per_gm: number;
  goal_line_per_gm: number;
}

/* ------------------------------------------------------------------- names */

const TEAM_ALIASES: Record<string, string> = { LA: "LAR", JAC: "JAX", WSH: "WAS" };

/** Known by a nickname in one source and a legal name in another. Normalised on both sides. */
const NAME_ALIASES: Record<string, string> = { "bam knight": "zonovan knight" };

/** Lower case, no diacritics, punctuation to spaces, no Jr/Sr/II–V. MIRRORS normalizeName(). */
export function normalizeName(player: string): string {
  const normalized = player
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return NAME_ALIASES[normalized] ?? normalized;
}

/** LA → LAR, WSH → WAS, JAC → JAX. */
export function canonicalTeam(team: string): string {
  return TEAM_ALIASES[team.toUpperCase()] ?? team.toUpperCase();
}

function normalizeKey(player: string, team: string): string {
  return `${normalizeName(player)}|${canonicalTeam(team)}`;
}

/* ----------------------------------------------------------------- injuries */

export interface PlayerInjuryData {
  /** Games missed in `prevSeason`, the season before the stats basis. */
  games_missed_prev: number;
  /** Career games missed before `prevSeason`. */
  games_missed_prior: number;
  /** Seasons from his first up to `prevSeason`, × 17. */
  games_possible_prior: number | null;
}

interface InjuryRow {
  playerName?: string;
  data?: { nfl?: Array<{ season?: number | null; gamesMissed?: number | null }> };
}

/**
 * Name → injury history, split at `prevSeason`: that season on its own, and
 * everything before it. MIRRORS loadLocalInjuryData(), which fixed the split
 * at 2024 because its stats were 2025's; the split moves with the stats basis.
 */
export function parseInjuries(rows: InjuryRow[], prevSeason = 2024): Map<string, PlayerInjuryData> {
  const result = new Map<string, PlayerInjuryData>();
  for (const row of rows) {
    if (!row.playerName) continue;
    const nfl = row.data?.nfl ?? [];
    const missedPrev = nfl
      .filter((i) => i.season === prevSeason)
      .reduce((s, i) => s + (i.gamesMissed ?? 0), 0);
    const missedPrior = nfl
      .filter((i) => i.season != null && i.season > 0 && i.season < prevSeason)
      .reduce((s, i) => s + (i.gamesMissed ?? 0), 0);
    const priorSeasons = nfl
      .map((i) => i.season)
      .filter((s): s is number => s != null && s > 2000 && s < prevSeason);
    const earliest = priorSeasons.length > 0 ? Math.min(...priorSeasons) : null;
    result.set(normalizeName(row.playerName), {
      games_missed_prev: missedPrev,
      games_missed_prior: missedPrior,
      games_possible_prior: earliest != null ? (prevSeason - earliest) * 17 : null,
    });
  }
  return result;
}

/* -------------------------------------------------------------------- stats */

function empty(player: string, team: string, games: number): MergedRBData {
  return {
    player, team, games,
    age: null,
    snap_pct: null, touches_per_gm: null, season_touches: null, rush_att_per_gm: null,
    targets_per_gm: null, routes_per_gm: null, route_pct: null,
    rz_touches: null, rz_rush_att: null, goal_line_att: null,
    usage_role_score: null, role_trend: null,
    efficiency_score: null, yards_per_touch: null, yards_per_carry: null,
    explosive_run_pct: null, breakaway_run_pct: null, broken_tackles_per_att: null,
    epa_per_rush: null,
    player_quality: null,
  };
}

/**
 * One record per (name, team), with Player Quality scored against the whole
 * pool. `scale` is the share of a season the rows cover (see
 * scorePlayerQuality). MIRRORS loadAndMerge().
 */
export function mergeStats(rows: RBStatRow[], scale = 1): Map<string, MergedRBData> {
  const map = new Map<string, MergedRBData>();
  const quality = scorePlayerQuality(rows, scale);

  for (const row of rows) {
    const name = (row.playerName ?? row.player) as string | null | undefined;
    if (!name || !row.team) continue;
    const g = (row.games as number | null | undefined) ?? 1;
    const key = normalizeKey(name, row.team);
    if (!map.has(key)) map.set(key, empty(name, row.team, g));
    const r = map.get(key)!;
    r.games = Math.max(r.games, g);
    const age = row["age"];
    if (typeof age === "number" && Number.isFinite(age)) r.age = r.age ?? age;
    r.player_quality = quality.get(row) ?? null;

    const n = (k: string): number | null => {
      const v = row[k];
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    };
    const rush = n("rushAttempts");
    const rec = n("receptions");
    if (n("snapPct") != null) r.snap_pct = r.snap_pct ?? n("snapPct");
    if (rush != null || rec != null) r.season_touches = r.season_touches ?? (rush ?? 0) + (rec ?? 0);
    if (rush != null) r.rush_att_per_gm = r.rush_att_per_gm ?? rush / g;
    if (n("targets") != null) r.targets_per_gm = r.targets_per_gm ?? n("targets")! / g;
    if (n("routes") != null) r.routes_per_gm = r.routes_per_gm ?? n("routes")! / g;
    if (n("redZoneOpportunities") != null) r.rz_touches = r.rz_touches ?? n("redZoneOpportunities");
    if (n("goalLineCarries") != null) r.goal_line_att = r.goal_line_att ?? n("goalLineCarries");
    if (n("rushYards") != null && rush != null) {
      const touches = rush + (rec ?? 0);
      if (touches > 0) {
        r.yards_per_touch = r.yards_per_touch ?? (n("rushYards")! + (n("receivingYards") ?? 0)) / touches;
      }
      if (rush > 0) r.yards_per_carry = r.yards_per_carry ?? n("rushYards")! / rush;
    }
    if (n("explosiveRunPct") != null) r.explosive_run_pct = r.explosive_run_pct ?? n("explosiveRunPct");
    if (n("breakawayRunPct") != null) r.breakaway_run_pct = r.breakaway_run_pct ?? n("breakawayRunPct");
    if (n("brokenTackles") != null && rush != null && rush > 0) {
      r.broken_tackles_per_att = r.broken_tackles_per_att ?? n("brokenTackles")! / rush;
    }
    if (n("epaPerPlay") != null) r.epa_per_rush = r.epa_per_rush ?? n("epaPerPlay");
  }
  return map;
}

function maxOf(values: Array<number | null>): number {
  let m = 0;
  for (const v of values) if (v != null && v > m) m = v;
  return Math.max(m || 1, 1);
}

/** The pool maxima the role score normalises against. MIRRORS computeNorms(). */
export function computeNorms(data: Map<string, MergedRBData>): DataNorms {
  const all = Array.from(data.values());
  return {
    touches_per_gm: maxOf(all.map((r) => r.touches_per_gm)),
    snap_pct: maxOf(all.map((r) => r.snap_pct)),
    rush_att_per_gm: maxOf(all.map((r) => r.rush_att_per_gm)),
    targets_per_gm: maxOf(all.map((r) => r.targets_per_gm)),
    route_pct: maxOf(all.map((r) => r.route_pct)),
    rz_per_gm: maxOf(all.map((r) => (r.rz_touches != null && r.games > 0 ? r.rz_touches / r.games : null))),
    goal_line_per_gm: maxOf(
      all.map((r) => (r.goal_line_att != null && r.games > 0 ? r.goal_line_att / r.games : null)),
    ),
  };
}

export interface TeamBackfield {
  starter: MergedRBData | null;
  backup: MergedRBData | null;
}

/**
 * Each team's 2025 backfield from actual usage, NOT the current depth chart:
 * the two backs with the most touches. MIRRORS getTeamBackfields().
 */
export function getTeamBackfields(data: Map<string, MergedRBData>): Map<string, TeamBackfield> {
  const byTeam = new Map<string, MergedRBData[]>();
  for (const r of data.values()) {
    const team = canonicalTeam(r.team);
    const list = byTeam.get(team);
    if (list) list.push(r);
    else byTeam.set(team, [r]);
  }
  const result = new Map<string, TeamBackfield>();
  for (const [team, rbs] of byTeam) {
    const sorted = [...rbs].sort((a, b) => (b.season_touches ?? 0) - (a.season_touches ?? 0));
    result.set(team, { starter: sorted[0] ?? null, backup: sorted[1] ?? null });
  }
  return result;
}

/**
 * Keep the talent, drop the situation: a back who changed teams brings his
 * efficiency with him, but his old team's usage says nothing about his new one.
 * MIRRORS talentOnlyRecord().
 */
function talentOnly(record: MergedRBData): MergedRBData {
  return {
    ...record,
    snap_pct: null,
    touches_per_gm: null,
    rush_att_per_gm: null,
    targets_per_gm: null,
    routes_per_gm: null,
    route_pct: null,
    rz_touches: null,
    rz_rush_att: null,
    goal_line_att: null,
    usage_role_score: null,
    role_trend: null,
  };
}

/**
 * A back's record for his CURRENT team: exact first, then by name — full when
 * it is the same team under another spelling, talent-only when he moved.
 * MIRRORS lookupRBData().
 */
export function lookupRBData(
  data: Map<string, MergedRBData>,
  playerName: string,
  team: string,
): MergedRBData | null {
  const exact = data.get(normalizeKey(playerName, team));
  if (exact) return exact;
  const target = normalizeName(playerName);
  const current = canonicalTeam(team);
  for (const [key, record] of data) {
    const [name, recordTeam] = key.split("|");
    if (name === target) return recordTeam !== current ? talentOnly(record) : record;
  }
  return null;
}

/**
 * A starter's FULL 2025 record, usage intact across a team change — for the
 * signals that travel with him (durability, workload, age, quality) and never
 * for the pairing signals. MIRRORS lookupRBProfile().
 */
export function lookupRBProfile(
  data: Map<string, MergedRBData>,
  playerName: string,
  team: string,
): MergedRBData | null {
  const exact = data.get(normalizeKey(playerName, team));
  if (exact) return exact;
  const target = normalizeName(playerName);
  for (const [key, record] of data) {
    if (key.split("|")[0] === target) return record;
  }
  return null;
}

/* ------------------------------------------------------ last six games */

/** One back's line in one game, as scripts/rb-handcuffs/buildStats.mjs logs it. */
export interface GameLine {
  week: number;
  team: string | null;
  carries: number;
  rushYards: number;
  targets: number;
  receptions: number;
  recYards: number;
  recYac: number;
  fumbles: number;
  pfrCarries: number;
  ybc: number;
  yac: number;
  broken: number;
  pbpRushes: number;
  r10: number;
  r15: number;
  r20: number;
  r30: number;
  longest: number | null;
  longestTd: number | null;
}

/** One back's season of games: `rb_games_<season>.json`'s players. */
export interface GameLog {
  gsisId: string;
  playerId: string | null;
  playerName: string;
  team: string | null;
  games: GameLine[];
}

/** How many games Player Quality reads, and the week it never reads. */
export const TALENT_GAMES = 6;
export const SKIPPED_WEEK = 18;

/**
 * Each back's last six games as one row, for Player Quality (mak, 2026-09-24):
 * the six most recent games he played, newest season first, reaching back
 * into the previous season when this one has fewer — and never week 18,
 * where rested starters and callups make it another game. A game played is a
 * game with a carry or a target, so a week of special teams alone does not
 * use up one of the six.
 *
 * Counts are summed and rates rebuilt from the sums, with the same
 * definitions buildStats.mjs uses for a season. Role is not read from this:
 * it comes from the current season's totals.
 *
 * `seasons` oldest first. Backs are matched across seasons by gsis id, which
 * both logs carry.
 */
export function lastGames(seasons: GameLog[][], count = TALENT_GAMES): RBStatRow[] {
  const byId = new Map<string, { who: GameLog; lines: GameLine[] }>();
  for (const season of seasons) {
    for (const log of season) {
      const played = log.games.filter((g) => g.week !== SKIPPED_WEEK && g.carries + g.targets > 0);
      const entry = byId.get(log.gsisId);
      // Later seasons' games go after, so the newest are last.
      if (entry) {
        entry.lines.push(...played);
        entry.who = log;
      } else byId.set(log.gsisId, { who: log, lines: [...played] });
    }
  }

  const out: RBStatRow[] = [];
  for (const { who, lines } of byId.values()) {
    const games = lines.slice(-count);
    if (!games.length) continue;
    const sum = (k: keyof GameLine): number => games.reduce((a, g) => a + ((g[k] as number | null) ?? 0), 0);
    const max = (k: "longest" | "longestTd"): number | null => {
      const vals = games.map((g) => g[k]).filter((v): v is number => v != null);
      return vals.length ? Math.max(...vals) : null;
    };
    const carries = sum("carries");
    const receptions = sum("receptions");
    const rushYards = sum("rushYards");
    const recYards = sum("recYards");
    const pfrCarries = sum("pfrCarries");
    const broken = sum("broken");
    const touches = carries + receptions;
    out.push({
      playerName: who.playerName,
      playerId: who.playerId,
      team: who.team,
      position: "RB",
      games: games.length,
      rushAttempts: carries,
      targets: sum("targets"),
      receptions,
      rushYards,
      receivingYards: recYards,
      yardsPerCarry: carries > 0 ? rushYards / carries : null,
      yardsPerReception: receptions > 0 ? recYards / receptions : null,
      receivingYardsAfterCatch: sum("recYac"),
      fumbles: sum("fumbles"),
      yardsAfterContactPerAttempt: pfrCarries > 0 ? sum("yac") / pfrCarries : null,
      yardsBeforeContactPerAttempt: pfrCarries > 0 ? sum("ybc") / pfrCarries : null,
      brokenTackles: broken,
      rushAttemptsPerBrokenTackle: broken > 0 ? carries / broken : null,
      tackleEludedRate: touches > 0 ? (broken / touches) * 100 : null,
      rushes10Plus: sum("r10"),
      rushes20Plus: sum("r20"),
      rushes30Plus: sum("r30"),
      explosiveRunPct: carries > 0 ? (sum("r10") / carries) * 100 : null,
      breakawayRunPct: carries > 0 ? (sum("r15") / carries) * 100 : null,
      longestRush: max("longest"),
      longestRushTouchdown: max("longestTd"),
    });
  }
  return out;
}
