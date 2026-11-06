/**
 * Team Comparison (mak's brief, 2026-11-06): the upcoming matchup page's NFL
 * team-vs-team table, replacing the old Team Matchup card. Offense, Defense
 * and Advanced tabs over one row structure; every value with its rank among
 * all 32 teams (1st = best on that metric's own direction).
 *
 * One definition per metric (METRICS below), two sources, no new fetches:
 *
 *   lib/team/stats.ts       the box-score ladders the team hub's Stats tab
 *                           prints (points, yards, yards/play, passing and
 *                           rushing yards, third down), with its own 32-team
 *                           ranks, read from data/team/efficiency_<season>.json
 *   efficiency_<season>.json the play-by-play ladders (EPA/play, success rate,
 *                           explosive rate) with their documented definitions
 *                           and 32-team ranks; and the box sheet's season
 *                           totals, from which the per-game turnover rows and
 *                           the sack rates are computed HERE for all 32 teams
 *                           (ties share a rank) because no file ranks them
 *
 * Not shown, because nothing we store measures them: red-zone TD % (offense
 * and defense) and pressure rate. Blitz rate is a different thing and is not
 * substituted. Season only: no per-game team sheet exists for all 32 teams,
 * so Last 3 / Last 5 ranks cannot be computed honestly yet.
 */

import { getEfficiencyDoc, type EfficiencyDoc } from "../team/efficiency";
import type { StatRow, TeamStats } from "../team/stats";
import type { NflTeam } from "../team/teams";

export type CompareTab = "offense" | "defense" | "advanced";

export interface CompareCell {
  /** Formatted, or null when the source has no value (printed as a dash). */
  value: string | null;
  rank: number | null;
  tied: boolean;
}

export interface CompareRow {
  id: string;
  label: string;
  tooltip: string;
  better: "higher" | "lower";
  away: CompareCell;
  home: CompareCell;
  /** The side with the edge, or "even" within EVEN_RANKS, or null when not comparable. */
  edge: "away" | "home" | "even" | null;
}

export interface TeamComparison {
  season: number;
  throughWeek: number | null;
  tabs: Array<{ id: CompareTab; label: string; rows: CompareRow[] }>;
}

/** Within three league places the two are treated as even (a presentation rule, not a significance test). */
export const EVEN_RANKS = 3;

interface Side {
  team: NflTeam;
  stats: TeamStats | null;
}

interface Ctx {
  doc: EfficiencyDoc | null;
  computed: Map<string, Map<string, CompareCell>>;
}

type Source = (side: Side, ctx: Ctx) => CompareCell;

interface MetricDef {
  id: string;
  label: string;
  tab: CompareTab;
  better: "higher" | "lower";
  tooltip: string;
  source: Source;
}

const EMPTY: CompareCell = { value: null, rank: null, tied: false };

/** A row from the box-score ladders (lib/team/stats.ts), value and rank as the hub prints them. */
function ladder(key: string): Source {
  return (side) => {
    const groups = side.stats ? [side.stats.offense, side.stats.defense, side.stats.situational] : [];
    const row: StatRow | undefined = groups.flat().find((r) => r.key === key);
    if (!row) return EMPTY;
    return { value: row.value, rank: row.rank, tied: (row.rankLabel ?? "").startsWith("T-") };
  };
}

const signed = (v: number, d: number): string => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}`;

/** A play-by-play ladder from the efficiency file, with its own rank. */
function pbp(side: "offense" | "defense", key: "epaPlay" | "successRate" | "explosiveRate"): Source {
  return ({ team }, { doc }) => {
    const m = doc?.teams[team.abbreviation]?.[side]?.[key] as { value: number; rank: number; tied: boolean } | undefined;
    if (!m || typeof m.value !== "number") return EMPTY;
    return {
      value: key === "epaPlay" ? signed(m.value, 2) : `${m.value.toFixed(1)}%`,
      rank: m.rank ?? null,
      tied: Boolean(m.tied),
    };
  };
}

/** A metric computed here for all 32 teams and ranked (ties share a rank). */
function computed(id: string): Source {
  return ({ team }, { computed }) => computed.get(id)?.get(team.abbreviation) ?? EMPTY;
}

export const METRICS: MetricDef[] = [
  // Offense
  { id: "off-points", label: "Points / Game", tab: "offense", better: "higher", tooltip: "Points scored per game.", source: ladder("off-points") },
  { id: "off-yards", label: "Yards / Game", tab: "offense", better: "higher", tooltip: "Net yards gained per game.", source: ladder("off-total-yards") },
  { id: "off-ypp", label: "Yards / Play", tab: "offense", better: "higher", tooltip: "Net yards over pass attempts, sacks and rushing attempts.", source: ladder("off-yards-per-play") },
  { id: "off-pass", label: "Pass Yards / Game", tab: "offense", better: "higher", tooltip: "Net passing yards per game, sack yardage removed.", source: ladder("off-pass-yards") },
  { id: "off-rush", label: "Rush Yards / Game", tab: "offense", better: "higher", tooltip: "Rushing yards per game.", source: ladder("off-rush-yards") },
  { id: "off-third", label: "3rd Down %", tab: "offense", better: "higher", tooltip: "Third downs converted, as a share of third-down attempts.", source: ladder("off-third-down") },
  { id: "off-giveaways", label: "Giveaways / Game", tab: "offense", better: "lower", tooltip: "Interceptions thrown plus fumbles lost, per game.", source: computed("giveaways") },
  // Defense
  { id: "def-points", label: "Points Allowed / Game", tab: "defense", better: "lower", tooltip: "Points allowed per game.", source: ladder("def-points") },
  { id: "def-yards", label: "Yards Allowed / Game", tab: "defense", better: "lower", tooltip: "Net yards allowed per game.", source: ladder("def-total-yards") },
  { id: "def-ypp", label: "Yards / Play Allowed", tab: "defense", better: "lower", tooltip: "Opponents' net yards per play.", source: ladder("def-yards-per-play") },
  { id: "def-pass", label: "Pass Yards Allowed", tab: "defense", better: "lower", tooltip: "Opponents' net passing yards per game.", source: ladder("def-pass-yards") },
  { id: "def-rush", label: "Rush Yards Allowed", tab: "defense", better: "lower", tooltip: "Opponents' rushing yards per game.", source: ladder("def-rush-yards") },
  { id: "def-third", label: "Opp. 3rd Down %", tab: "defense", better: "lower", tooltip: "Third downs opponents converted, as a share of their attempts.", source: ladder("def-third-down") },
  { id: "def-takeaways", label: "Takeaways / Game", tab: "defense", better: "higher", tooltip: "Interceptions plus fumbles recovered, per game.", source: computed("takeaways") },
  // Advanced (play-by-play)
  { id: "adv-epa-off", label: "Offensive EPA / Play", tab: "advanced", better: "higher", tooltip: "Expected Points Added per offensive play: how much each play changes expected scoring.", source: pbp("offense", "epaPlay") },
  { id: "adv-epa-def", label: "Defensive EPA / Play", tab: "advanced", better: "lower", tooltip: "EPA per play allowed: lower means opponents gained less expected scoring.", source: pbp("defense", "epaPlay") },
  { id: "adv-sr-off", label: "Success Rate", tab: "advanced", better: "higher", tooltip: "Share of offensive plays with positive EPA.", source: pbp("offense", "successRate") },
  { id: "adv-sr-def", label: "Success Rate Allowed", tab: "advanced", better: "lower", tooltip: "Share of opponents' plays with positive EPA.", source: pbp("defense", "successRate") },
  { id: "adv-exp-off", label: "Explosive Play Rate", tab: "advanced", better: "higher", tooltip: "Share of plays gaining 15+ yards on a dropback or 10+ on a designed run.", source: pbp("offense", "explosiveRate") },
  { id: "adv-exp-def", label: "Explosive Rate Allowed", tab: "advanced", better: "lower", tooltip: "Share of opponents' plays gaining 15+ yards on a dropback or 10+ on a designed run.", source: pbp("defense", "explosiveRate") },
  { id: "adv-sack-def", label: "Defensive Sack Rate", tab: "advanced", better: "higher", tooltip: "Sacks per opponent dropback. (Pressure rate is not charted in our data.)", source: computed("sackRateDef") },
  { id: "adv-sack-off", label: "Sack Rate Allowed", tab: "advanced", better: "lower", tooltip: "Sacks taken per dropback.", source: computed("sackRateOff") },
];

const TAB_LABEL: Record<CompareTab, string> = { offense: "Offense", defense: "Defense", advanced: "Advanced" };

/** Competition ranking over all teams with a value: 1st = best, ties share a rank. */
function rankAll(values: Map<string, number>, better: "higher" | "lower", format: (v: number) => string): Map<string, CompareCell> {
  const sorted = [...values.values()].sort((a, b) => (better === "higher" ? b - a : a - b));
  const out = new Map<string, CompareCell>();
  for (const [team, v] of values) {
    const key = Number(v.toFixed(6));
    const rank = sorted.findIndex((x) => Number(x.toFixed(6)) === key) + 1;
    const tied = sorted.filter((x) => Number(x.toFixed(6)) === key).length > 1;
    out.set(team, { value: format(v), rank, tied });
  }
  return out;
}

function computeLeague(doc: EfficiencyDoc | null): Map<string, Map<string, CompareCell>> {
  const out = new Map<string, Map<string, CompareCell>>();
  if (!doc) return out;
  const give = new Map<string, number>();
  const take = new Map<string, number>();
  const sackOff = new Map<string, number>();
  const sackDef = new Map<string, number>();
  for (const [abbr, t] of Object.entries(doc.teams)) {
    const own = (t as { box?: { own?: Record<string, number> } }).box?.own;
    const gp = own?.["gamesPlayed"];
    if (own && gp) {
      if (typeof own["giveaways"] === "number") give.set(abbr, own["giveaways"] / gp);
      if (typeof own["takeaways"] === "number") take.set(abbr, own["takeaways"] / gp);
    }
    const o = t.offense as { dropbacks?: number; sacks?: { value: number } } | undefined;
    const d = t.defense as { dropbacks?: number; sacks?: { value: number } } | undefined;
    if (o?.dropbacks && typeof o.sacks?.value === "number") sackOff.set(abbr, (o.sacks.value / o.dropbacks) * 100);
    if (d?.dropbacks && typeof d.sacks?.value === "number") sackDef.set(abbr, (d.sacks.value / d.dropbacks) * 100);
  }
  // A rank needs the whole league: a partial sheet ranks nothing.
  const full = (m: Map<string, number>) => m.size === 32;
  if (full(give)) out.set("giveaways", rankAll(give, "lower", (v) => v.toFixed(1)));
  if (full(take)) out.set("takeaways", rankAll(take, "higher", (v) => v.toFixed(1)));
  if (full(sackOff)) out.set("sackRateOff", rankAll(sackOff, "lower", (v) => `${v.toFixed(1)}%`));
  if (full(sackDef)) out.set("sackRateDef", rankAll(sackDef, "higher", (v) => `${v.toFixed(1)}%`));
  return out;
}

function edgeOf(a: CompareCell, h: CompareCell): CompareRow["edge"] {
  if (a.value === null || h.value === null || a.rank === null || h.rank === null) return null;
  if (Math.abs(a.rank - h.rank) <= EVEN_RANKS) return "even";
  return a.rank < h.rank ? "away" : "home";
}

export function teamComparison(away: Side, home: Side): TeamComparison | null {
  const season = away.stats?.season ?? home.stats?.season ?? null;
  if (season === null) return null;
  // One season for every row: the ladders' season decides, and the
  // efficiency file is read for that same season (never mixed).
  if (home.stats && away.stats && home.stats.season !== away.stats.season) return null;
  const doc = getEfficiencyDoc(season);
  const ctx: Ctx = { doc, computed: computeLeague(doc) };
  const tabs = (["offense", "defense", "advanced"] as CompareTab[])
    .map((tab) => ({
      id: tab,
      label: TAB_LABEL[tab],
      rows: METRICS.filter((m) => m.tab === tab)
        .map((m): CompareRow => {
          const a = m.source(away, ctx);
          const h = m.source(home, ctx);
          return { id: m.id, label: m.label, tooltip: m.tooltip, better: m.better, away: a, home: h, edge: edgeOf(a, h) };
        })
        // A metric neither team has is not a row; one side missing prints a dash.
        .filter((r) => r.away.value !== null || r.home.value !== null),
    }))
    // An Advanced tab with nothing verified behind it is not shown.
    .filter((t) => t.rows.length > 0);
  if (!tabs.length) return null;
  return { season, throughWeek: doc?.throughWeek ?? null, tabs };
}
