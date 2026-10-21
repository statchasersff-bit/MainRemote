/**
 * The Usage & Opportunity Report's data: read, then shaped into what the tab
 * draws.
 *
 * Every number comes from `data/team/usage_<season>.json`, which
 * scripts/team/buildUsage.mjs builds from nflverse (see its header for the
 * sources and for what is deliberately not built). Nothing is fetched here and
 * nothing is estimated: a field the builder could not measure is null, and the
 * renderer leaves its block out.
 *
 * What this module decides, so the renderer and the copy do not have to:
 * which players get a row, each row's role and tier, the trend windows
 * (the last three games' average against the three before them), and which
 * players the three signal cards name.
 */

import { dataPath } from "../data-dir";
import { readDataJson } from "./read-json";
import { searchKey } from "../render";
import type { RosterPlayer } from "./roster";

/* ------------------------------------------------------------------ types */

export type UsagePos = "QB" | "RB" | "WR" | "TE";

export interface UsageWeek {
  week: number;
  /** Target share that game, % of team targets. Null = did not play. */
  ts: number | null;
  /** Offensive snap share that game, %. */
  snap: number | null;
  /** Red-zone carries + targets that game. */
  rz: number | null;
}

export type Situation = "early" | "third" | "rz" | "in10" | "twoMin" | "trailing";

export interface UsagePlayer {
  id: string;
  name: string;
  slug: string | null;
  sleeperId: string | null;
  pos: UsagePos;
  games: number;
  targets: number;
  receptions: number;
  carries: number;
  targetShare: number | null;
  airYardsShare: number | null;
  wopr: number | null;
  adot: number | null;
  ezTargets: number;
  /** Box-score rushing yards: carries, scrambles and kneels. */
  rushYards?: number;
  /** Targets 20+ air yards downfield (the pass map's deep row). */
  deepTargets?: number;
  firstReadShare: number | null;
  snapShare: number | null;
  rzTouches: number;
  gzCarries: number;
  wopp: number;
  woppPerGame: number | null;
  hvt: number;
  lastSeasonWoppPerGame: number | null;
  situation: Record<Situation, number>;
  longestRuns: Array<[number, RunGap]>;
  designedRunRate: number | null;
  scrambleRate: number | null;
  sackRate: number | null;
  dropbacks: number;
  passAdot: number | null;
  xfpPerGame: number | null;
  fpoePerGame: number | null;
  fpPerGame: number | null;
  yacPerAtt: number | null;
  touchShare?: number | null;
  woppShare?: number | null;
  rzOppShare?: number | null;
  weekly: UsageWeek[];
  /** Percentile vs the position league-wide, oriented so higher = better. */
  pct: Record<string, number | null>;
  qualified: boolean;
  leagueRank: { metric: string; rank: number | null };
  pool: number;
}

export type RunGap = "LE" | "LT" | "MID" | "RT" | "RE";
export type Zone = "DL" | "DM" | "DR" | "SL" | "SM" | "SR";

export interface RankedValue {
  value: number | null;
  rank: number | null;
}

export interface UsageTeam {
  games: number[];
  passAttempts: number;
  targets: number;
  passerId: string | null;
  /** The passer's charted attempts - the pass map's denominator. */
  passerZoneAttempts?: number;
  env: Record<
    "proe" | "rzPassRate" | "pace" | "playsPerGame" | "xfpPerGame" | "in10PassRate" | "passRate",
    RankedValue
  >;
  rbSituationTotals: Record<Situation, number>;
  runs: Record<RunGap, { att: number; ypc: number | null }>;
  zones: Partial<
    Record<
      Zone,
      {
        att: number;
        share: number | null;
        ypa: number | null;
        top: { id: string; name: string; share: number | null; targets: number } | null;
      }
    >
  >;
  players: UsagePlayer[];
}

export interface UsageDoc {
  season: number;
  throughWeek: number;
  weeks: number[];
  builtAt: string;
  rbWoppPool: number[];
  sources: string[];
  teams: Record<string, UsageTeam>;
}

export interface TargetShareCliff {
  seasons: string;
  above20: { ppg: number; seasons: number };
  from10to20: { ppg: number; seasons: number };
}

/* ------------------------------------------------------------------- read */

export function getUsageDoc(season: number): UsageDoc | null {
  return readDataJson<UsageDoc>(dataPath("team", `usage_${season}.json`));
}

export function getTargetShareCliff(): TargetShareCliff | null {
  return readDataJson<TargetShareCliff>(dataPath("team", "target_share_cliff.json"));
}

/** A fingerprint for the render cache: changes whenever the file is rebuilt. */
export function usageVersion(season: number): string {
  return getUsageDoc(season)?.builtAt ?? "";
}

/* ---------------------------------------------------------------- shaping */

export type Tier = "set" | "starter" | "flex" | "volatile" | "stash";

export interface Trend {
  /** The last three games, oldest first. */
  trail: Array<number | null>;
  trailWeeks: number[];
  /**
   * The last three games' average minus the average of the (up to) three
   * games before them, or null until a fourth game is in.
   */
  delta: number | null;
  /** The last week of the base window; null when there is no base. */
  baseWeek: number | null;
  /** Every week in the base window, oldest first. */
  baseWeeks: number[];
  direction: "up" | "down" | "flat";
  /**
   * The latest game confirms the direction: a rise ends at the trail's high, a
   * fall at its low. 3% → 19% → 8% is "up" against Week 1 and not a rise.
   */
  confirmed: boolean;
}

export interface UsageRow {
  player: UsagePlayer;
  /** "WR1", "RB2", "TE1", "QB1". */
  role: string;
  /** Position rank within the team (1 = the lead). */
  depth: number;
  tier: Tier;
  ts: Trend;
  snap: Trend;
  rz: Trend;
  /** True for the team's leader in red-zone opportunities. */
  leadsRz: boolean;
  /** Leads, but shares the lead with at least one teammate. */
  rzCoLead: boolean;
}

export interface Signal {
  kind: "buy" | "sell" | "watch";
  row: UsageRow;
  reason: "role" | "points" | "drift" | "fade";
}

export interface UsageView {
  doc: UsageDoc;
  team: UsageTeam;
  throughWeek: number;
  /** Every player with a touch, current roster or not. The target tree uses these. */
  all: UsagePlayer[];
  rows: UsageRow[];
  qb: UsagePlayer | null;
  /** Running backs by weighted opportunities, current roster only. */
  rbs: UsagePlayer[];
  signals: Signal[];
}

/**
 * Deltas compare the last three games' average with the average of the three
 * games before them (mak, 2026-10-21): one quiet game should not read as a
 * trend. A game the player sat out (no value) is skipped, not counted as zero.
 * Early in the season the base window is whatever played games precede the
 * last three, so the first delta appears with the fourth game.
 */
const WINDOW = 3;
const STEADY: Record<"ts" | "snap" | "rz", number> = { ts: 2, snap: 5, rz: 1 };

export function trend(weekly: UsageWeek[], key: "ts" | "snap" | "rz"): Trend {
  const last3 = weekly.slice(-3);
  const trail = last3.map((w) => w[key]);
  const trailWeeks = last3.map((w) => w.week);

  const played = weekly.filter((w) => w[key] != null);
  const recent = played.slice(-WINDOW);
  const base = played.slice(Math.max(0, played.length - 2 * WINDOW), played.length - WINDOW);
  const mean = (ws: UsageWeek[]) => ws.reduce((s, w) => s + (w[key] as number), 0) / ws.length;
  const delta =
    recent.length && base.length ? Math.round((mean(recent) - mean(base)) * 10) / 10 : null;
  const direction =
    delta == null || Math.abs(delta) < STEADY[key] ? "flat" : delta > 0 ? "up" : "down";
  const known = trail.filter((v): v is number => v != null);
  const last = known[known.length - 1];
  const earlier = known.slice(0, -1);
  const confirmed =
    last != null &&
    earlier.length > 0 &&
    (direction === "up"
      ? last >= Math.max(...earlier) - 1
      : direction === "down"
        ? last <= Math.min(...earlier) + 1
        : false);
  const baseWeeks = base.map((w) => w.week);
  return { trail, trailWeeks, delta, baseWeek: baseWeeks[baseWeeks.length - 1] ?? null, baseWeeks, direction, confirmed };
}

/** "W1-3" / "W3": the base window as the table prints it. */
export function baseLabel(t: Trend): string {
  const b = t.baseWeeks;
  if (b.length === 0) return "";
  return b.length === 1 ? `W${b[0]}` : `W${b[0]}-${b[b.length - 1]}`;
}

/** "Weeks 1-3" / "Week 3": the base window in prose. */
export function baseWords(t: Trend): string {
  const b = t.baseWeeks;
  if (b.length === 0) return "";
  return b.length === 1 ? `Week ${b[0]}` : `Weeks ${b[0]}-${b[b.length - 1]}`;
}

function tierFor(p: UsagePlayer, depth: number): Tier {
  if (p.pos === "QB") {
    const rank = p.leagueRank.rank;
    if (rank != null && rank <= 8) return "set";
    if (rank != null && rank <= 16) return "starter";
    return "volatile";
  }
  if (p.pos === "RB") {
    const share = p.woppShare ?? 0;
    if (depth === 1) {
      if (share >= 65) return "set";
      if (share >= 50 || (p.woppPerGame ?? 0) >= 15) return "starter";
      if (share >= 40 || (p.woppPerGame ?? 0) >= 12) return "flex";
      return "volatile";
    }
    return share >= 35 ? "volatile" : "stash";
  }
  const ts = p.targetShare ?? 0;
  if (ts >= 20) return "set";
  if (ts >= 17) return "starter";
  if (ts >= 15) return "flex";
  return "volatile";
}

/**
 * Who is still on the club.
 *
 * The file counts every snap a club took, including the ones a since-traded
 * player took for it. The target tree keeps those (the share is history), the
 * table does not (a row is a recommendation). Matched on Sleeper id first and
 * then on the name's search key. No roster at all means no filter.
 */
function onRoster(roster: readonly RosterPlayer[] | null): (p: UsagePlayer) => boolean {
  if (!roster || roster.length === 0) return () => true;
  const ids = new Set(roster.map((r) => r.id));
  const names = new Set(roster.map((r) => searchKey(r.name)));
  return (p) => (p.sleeperId != null && ids.has(p.sleeperId)) || names.has(searchKey(p.name));
}

export function buildUsageView(
  abbreviation: string,
  season: number,
  roster: readonly RosterPlayer[] | null,
): UsageView | null {
  const doc = getUsageDoc(season);
  const team = doc?.teams[abbreviation];
  if (!doc || !team || doc.throughWeek < 1 || team.players.length === 0) return null;

  const current = onRoster(roster);
  const all = team.players;
  const here = all.filter(current);
  const byTargets = (a: UsagePlayer, b: UsagePlayer) => b.targets - a.targets;

  const qb =
    here.find((p) => p.id === team.passerId && p.pos === "QB") ??
    here.filter((p) => p.pos === "QB").sort((a, b) => b.dropbacks - a.dropbacks)[0] ??
    null;

  const rbs = here.filter((p) => p.pos === "RB").sort((a, b) => b.wopp - a.wopp);
  const wrs = here.filter((p) => p.pos === "WR").sort(byTargets);
  const tes = here.filter((p) => p.pos === "TE").sort(byTargets);

  const picked: Array<{ p: UsagePlayer; depth: number }> = [];
  if (rbs[0]) picked.push({ p: rbs[0], depth: 1 });
  rbs.slice(1, 3).forEach((p, i) => {
    if ((p.woppShare ?? 0) >= 15) picked.push({ p, depth: i + 2 });
  });
  const receivers = [
    ...wrs.map((p, i) => ({ p, depth: i + 1 })),
    ...tes.map((p, i) => ({ p, depth: i + 1 })),
  ]
    .filter(({ p, depth }) =>
      p.pos === "TE" && depth === 1 ? (p.targetShare ?? 0) >= 6 : (p.targetShare ?? 0) >= 8,
    )
    .sort((a, b) => b.p.targets - a.p.targets)
    .slice(0, 5);
  picked.push(...receivers);

  // The team's own last game, not the league's: from Thursday night until the
  // Monday game is in, the feed's latest week holds two teams, and every other
  // page would claim a week it has not played (NE 2026-10-03: three games,
  // labeled "through Week 4"). A bye keeps the last week played.
  const through = team.games.length ? Math.max(...team.games) : doc.throughWeek;
  // Red-zone lead: everyone tied at the top is a leader (mak, 2026-10-21).
  const rzMax = here.reduce((m, p) => Math.max(m, p.rzTouches), 0);
  const rzLeaders = here.filter((p) => p.rzTouches === rzMax).length;

  const toRow = ({ p, depth }: { p: UsagePlayer; depth: number }): UsageRow => ({
    player: p,
    role: `${p.pos}${depth}`,
    depth,
    tier: tierFor(p, depth),
    ts: trend(p.weekly, "ts"),
    snap: trend(p.weekly, "snap"),
    rz: trend(p.weekly, "rz"),
    leadsRz: rzMax > 0 && p.rzTouches === rzMax,
    rzCoLead: rzMax > 0 && p.rzTouches === rzMax && rzLeaders > 1,
  });

  const stash = (r: UsageRow) => r.tier === "stash";
  const main = picked
    .map(toRow)
    .sort((a, b) => {
      if (stash(a) !== stash(b)) return stash(a) ? 1 : -1;
      return (b.player.xfpPerGame ?? 0) - (a.player.xfpPerGame ?? 0);
    });
  const rows = qb ? [...main, toRow({ p: qb, depth: 1 })] : main;

  return {
    doc,
    team,
    throughWeek: through,
    all,
    rows,
    qb,
    rbs,
    signals: pickSignals(rows),
  };
}

/* ---------------------------------------------------------------- signals */

/**
 * The three cards: one riser to buy, one faller to sell, one player to watch.
 *
 * Every pick is a rule over the trend numbers, never a judgment typed in, so
 * the cards move with the data every week. A card with no qualifying player is
 * left out rather than filled with a weak one.
 */
export function pickSignals(rows: UsageRow[]): Signal[] {
  const pool = rows.filter((r) => r.player.pos !== "QB" && r.tier !== "stash");
  const out: Signal[] = [];
  const used = new Set<UsageRow>();

  // BUY LOW: the biggest role gain, as target share plus a fifth of the snap
  // gain; or, failing that, volume that the box score has not paid yet.
  const roleGain = (r: UsageRow) => (r.ts.delta ?? 0) + (r.snap.delta ?? 0) / 5;
  const riser = pool
    .filter(
      (r) =>
        r.tier !== "set" &&
        (((r.ts.delta ?? 0) >= 3 && r.ts.confirmed) || ((r.snap.delta ?? 0) >= 10 && r.snap.confirmed)) &&
        (r.ts.delta ?? 0) > -2,
    )
    .sort((a, b) => roleGain(b) - roleGain(a))[0];
  const unpaid = pool
    .filter((r) => (r.player.fpoePerGame ?? 0) <= -2 && (r.player.xfpPerGame ?? 0) >= 9)
    .sort((a, b) => (a.player.fpoePerGame ?? 0) - (b.player.fpoePerGame ?? 0))[0];
  if (riser) {
    out.push({ kind: "buy", row: riser, reason: "role" });
    used.add(riser);
  } else if (unpaid) {
    out.push({ kind: "buy", row: unpaid, reason: "points" });
    used.add(unpaid);
  }

  // SELL HIGH: a share sliding by 3+ points from a player whose season line
  // still looks like a starter's, or scoring well over his volume.
  const faller = pool
    .filter(
      (r) =>
        !used.has(r) &&
        // Target share is a pass-catcher's number, and a Set & Forget alpha is
        // not sold on one soft week: this card is for the WR2 whose name
        // outruns his role.
        (r.player.pos === "WR" || r.player.pos === "TE") &&
        r.tier !== "set" &&
        (r.ts.delta ?? 0) <= -3 &&
        r.ts.confirmed &&
        ((r.player.targetShare ?? 0) >= 12 || (r.player.fpoePerGame ?? 0) >= 3),
    )
    .sort((a, b) => (a.ts.delta ?? 0) - (b.ts.delta ?? 0))[0];
  if (faller) {
    out.push({ kind: "sell", row: faller, reason: "drift" });
    used.add(faller);
  }

  // WATCH: a pass-catcher under 12% whose share or snaps are falling.
  const fading = pool
    .filter(
      (r) =>
        !used.has(r) &&
        (r.player.pos === "WR" || r.player.pos === "TE") &&
        (r.player.targetShare ?? 0) < 12 &&
        ((r.ts.direction === "down" && r.ts.confirmed) || (r.snap.direction === "down" && r.snap.confirmed)),
    )
    .sort((a, b) => (a.player.targetShare ?? 0) - (b.player.targetShare ?? 0))[0];
  if (fading) out.push({ kind: "watch", row: fading, reason: "fade" });

  return out;
}

/* ---------------------------------------------------------------- helpers */

/** "Josh Allen" → "Allen"; suffixes dropped. */
export function surname(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => !/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(part));
  return parts.length > 1 ? parts[parts.length - 1]! : (parts[0] ?? name);
}

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/** Where a weighted-opportunity figure would rank among qualified backs. */
export function rbRankFor(pool: number[], woppPerGame: number): number {
  return 1 + pool.filter((v) => v > woppPerGame).length;
}
