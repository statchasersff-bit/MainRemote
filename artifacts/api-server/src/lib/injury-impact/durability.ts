/**
 * The durability model: the Gridiron Medical + page's `hydrate`
 * (RESEARCH-Injury-Impact-Analysis at c6a49ce, public/gridiron-medical.html),
 * ported verbatim. Every drafted QB, RB, WR and TE since 2009 gets a
 * durability score out of 100 from recency-weighted availability, shrunk
 * toward the position average by the evidence behind it, minus capped
 * injury penalties. The flat injury-event rows feed the event database, the
 * aggregates feed the overview, and the per-season miss history feeds the
 * roster simulator.
 *
 * Shared by the server (the default view of every tab) and the bundle (the
 * filters, sorts and the simulator). Pure: no DOM, no clock, and the
 * simulator takes its random source as an argument so the tests can seed it.
 */

/* ------------------------------------------------------------------ input */

/** One player of data/injury-impact/gridiron.json, as the page's builder wrote it. */
export interface GmPlayerRaw {
  /** Full name. */
  n: string;
  /** GSIS id, when the crosswalk had one. */
  id?: string | null;
  pos: string;
  /** Latest team code. */
  tm: string;
  /** Team by season. */
  t?: Record<string, string>;
  /** Healthy PPR points per game. */
  ppg: number;
  /** Season -> [games played, games missed to injury], playoffs included. */
  s: Record<string, [number, number]>;
  /** Season -> [playoff games played, missed to injury, team playoff games]. */
  ps?: Record<string, [number, number, number]>;
  /** Season -> week string: P played, X missed to injury, D dressed, - other, B bye; playoffs after "|". */
  w?: Record<string, string>;
  /** Season -> offensive snap share. */
  u?: Record<string, number>;
  /** [year, label, bodyPart, severity, gamesMissed, type, recurrence, side?] */
  inj?: (string | number)[][];
  /** This season's redraft PPR ADP, and its rank on the board. */
  adp?: number | null;
  adpRank?: number | null;
  /** On an NFL roster now: team and status (ACT, IR, RES). */
  cur?: { tm: string; st: string } | null;
  college?: { school?: string; s: Record<string, [number, number]> } | null;
}

export interface GridironCurrent {
  season: number;
  week: number;
  statsWeek: number;
  /** Rostered QB/RB/WR/TE, and how many of them have a score. */
  skill: number;
  scored: number;
}

export interface GridironDataset {
  years: number[];
  source: string;
  generatedAt?: string;
  current?: GridironCurrent | null;
  /** The season in progress: team code -> bye week, for projected returns (the server adds it from the schedule). */
  byes?: Record<string, number>;
  /** The impact study's draft cost and labels by player-season (the server adds it from analysis.json + current.json). */
  study?: StudyIndex;
  players: GmPlayerRaw[];
}

/**
 * "<gsis>|<season>" -> the study's redraft ADP for that player-season and its
 * impact label per week of injury. Built by studyIndex() in data.ts; the event
 * rows read ADP, Games missed, Season ending and Impact from it so the Injury
 * database carries the impact study table's columns (the retired Injury history tab's).
 */
export type StudyIndex = Record<string, { a: number | null; l: Record<string, string> }>;

/** The season in progress's label in the impact study's table, used here for its events too. */
export const EVENT_IN_PROGRESS = "In progress";

/**
 * The study's impact rule (analysis.json meta.methodology.impact_labels), which
 * reproduces every one of its rows: Severe = top-24 ADP and 8+ games missed,
 * Major = top-60 and 5+, Moderate = top-120 and 3+, Minor otherwise, and No ADP
 * Impact for a player drafted past 180 or not at all.
 */
export function impactLabel(adp: number | null, gamesMissed: number): string {
  if (adp == null || adp > 180) return "No ADP Impact";
  if (adp <= 24 && gamesMissed >= 8) return "Severe";
  if (adp <= 60 && gamesMissed >= 5) return "Major";
  if (adp <= 120 && gamesMissed >= 3) return "Moderate";
  return "Minor";
}

/** The sort order of the impact column: the heaviest label first. */
export const IMPACT_RANK: Record<string, number> = { Severe: 5, Major: 4, Moderate: 3, Minor: 2, [EVENT_IN_PROGRESS]: 1, "No ADP Impact": 0 };

/**
 * An event's draft cost and impact label from the study. The study has the
 * label for the exact event (same week); for another event in a season the
 * study priced, the rule is applied to this event's games missed (playoff
 * games included, where the study counts the regular season). The season in
 * progress reads "In progress" when the player was drafted (the study's row,
 * else this season's board). A season the study never priced has neither.
 */
export function studyFor(study: StudyIndex | undefined, p: { id?: string | null; adp?: number | null }, e: { year: number; gm: number; timing: InjuryTiming }, currentSeason: number | null): { adp: number | null; impact: string | null } {
  const row = study && p.id ? study[`${p.id}|${e.year}`] : undefined;
  const live = currentSeason != null && e.year === currentSeason;
  const adp = row ? row.a : live ? (p.adp ?? null) : null;
  if (live) return { adp, impact: adp != null ? EVENT_IN_PROGRESS : row ? "No ADP Impact" : null };
  if (!row) return { adp: null, impact: null };
  const exact = e.timing.week != null ? row.l[String(e.timing.week)] : undefined;
  return { adp, impact: exact ?? impactLabel(adp, e.gm) };
}

/* ----------------------------------------------------------------- output */

export type TierKey = "iron" | "moderate" | "elevated" | "high";

export interface Tier {
  key: TierKey;
  name: string;
}

export type InjuryType = "soft" | "structural" | "head" | "other";

export interface GmInjury {
  year: number;
  label: string;
  bodyPart: string;
  /** 1 minor (<2 games), 2 moderate (2-5), 3 major (6+ or season-ending). */
  sev: number;
  gm: number;
  type: InjuryType;
  /** 1 when the same body part caused an earlier event. */
  rec: 0 | 1;
  side: string;
  timing: InjuryTiming;
}

/**
 * When an injury started and ended, read from the event's label and the
 * player's week string for that season. A playoff-only event has no week.
 */
export interface InjuryTiming {
  /** The regular-season week of the first game missed; null for a playoff-only event. */
  week: number | null;
  /** The label said season-ending, or he missed the rest of the regular season and the playoffs. */
  seasonEnding: boolean;
  /** Still out as of the data's last week (the season in progress only). */
  ongoing: boolean;
  /** Weeks from the first missed game to the return, bye included; to the data's last week when still out; to the season's end when he never came back. */
  weeksOut: number | null;
  /** The regular-season week he came back, when he did. */
  returnWeek: number | null;
  /** He came back in the playoffs, not the regular season. */
  returnedInPlayoffs: boolean;
  /** Still out: the week he is projected to return, null when that is past the season's end. */
  projectedReturn: number | null;
}

export interface GmPlayer extends Omit<GmPlayerRaw, "inj" | "college"> {
  seasons: Record<number, [number, number]>;
  seasonYears: number[];
  post: Record<number, [number, number, number]>;
  availRatio: number;
  availPct: number;
  gpTot: number;
  gmTot: number;
  possTot: number;
  perYearRate: number;
  inj: GmInjury[];
  sevPen: number;
  recPen: number;
  major: number;
  soft: number;
  reinj: boolean;
  /** Evidence, in full-workload games. */
  nEff: number;
  penalty: number;
  shrunk: number;
  score: number;
  tier: Tier;
  pointsLostCareer: number;
  /** Games missed per loaded season, scaled to 17, for the simulator. */
  missHistory: number[];
  /** How often the simulator draws each of those seasons. */
  missWeights: number[];
  college: { school: string; s: Record<number, [number, number]> } | null;
  /** The lookup key: the GSIS id, else the normalized name. */
  key: string;
}

export interface InjuryEventRow {
  player: string;
  /** The player's lookup key. */
  key: string;
  gsisId: string | null;
  pos: string;
  tm: string;
  year: number;
  label: string;
  bodyPart: string;
  side: string;
  type: InjuryType;
  sev: number;
  gm: number;
  pointsLost: number;
  rec: 0 | 1;
  timing: InjuryTiming;
  /** The study's redraft ADP for the player-season, when it priced one. */
  adp: number | null;
  /** The study's impact label, or null for a season it never priced. */
  impact: string | null;
}

export interface Durability {
  source: string;
  years: number[];
  players: GmPlayer[];
  rows: InjuryEventRow[];
  positions: string[];
  totalGamesMissed: number;
  totalPointsLost: number;
  riskyCount: number;
  current: GridironCurrent | null;
  byKey: Record<string, GmPlayer>;
}

/* -------------------------------------------------------------- constants */

export const TYPE_LABEL: Record<InjuryType, string> = { soft: "soft tissue", structural: "structural", head: "head", other: "other" };
export const SEV_LABEL: Record<number, string> = { 1: "minor (<2 games)", 2: "moderate (2-5)", 3: "major (6+ / season-ending)" };
export const SEV_SHORT = ["", "minor", "moderate", "major"];
export const FULL_SEASON_ODDS: Record<string, string> = { QB: "~35%", RB: "~10%", WR: "~18%", TE: "~8%" };

/** Snap share of a typical starter, for the workload scaling in the durability score. */
export const STARTER_SNAP_SHARE: Record<string, number> = { QB: 0.95, RB: 0.6, WR: 0.8, TE: 0.7 };
/** How many full-workload games of league-average availability every player starts with. */
export const PRIOR_GAMES = 17;
/** Weight of a season (and its injuries) per year before the current one. */
export const SEASON_WEIGHTS = [1, 0.8, 0.55, 0.35, 0.25, 0.15];
/** Weight of the season in progress: below last season and the one before, so a few games can't swamp them. */
export const IN_PROGRESS_WEIGHT = 0.6;
/** The Current players tab: the top of this season's ADP board. */
export const ADP_TOP = 200;
/** The simulator's roster cap and run count. */
export const ROSTER_CAP = 8;
export const SIM_SEASONS = 2000;
export const SIM_BINS = 28;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Weight of a season k years before the last complete one (k >= 5 is the floor). */
export const seasonWeight = (k: number): number => SEASON_WEIGHTS[Math.min(Math.max(0, k), SEASON_WEIGHTS.length - 1)]!;

export const fmtScore = (n: number): string => Number(n).toFixed(1);

export function tierOf(score: number): Tier {
  if (score >= 85) return { key: "iron", name: "Iron tier" };
  if (score >= 70) return { key: "moderate", name: "Moderate risk" };
  if (score >= 55) return { key: "elevated", name: "Elevated risk" };
  return { key: "high", name: "High risk" };
}

/** "D.J. Moore" and "DJ Moore", "Marvin Harrison Jr." and "Marvin Harrison" share a key. */
export function nameKey(name: string): string {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ timing */

/** Regular-season weeks in a season: 18 since the 17-game schedule (2021), 17 before. */
export const regularWeeks = (year: number): number => (year >= 2021 ? 18 : 17);

/** The four games a player on injured reserve must miss. */
export const IR_MIN_GAMES = 4;

/**
 * An event's timing from its label ("Knee — out 3 games from week 12",
 * "Hamstring — out week 4", "... (season-ending)", "... (on IR, ongoing)",
 * "Knee — out 1 playoff game") and the player's week string for the season.
 * The return week is the first game played after the run of missed weeks;
 * when the string and the label disagree (a handful of rows), the label's
 * games stand in. `current` is the dataset's season in progress when this
 * event belongs to it, so a still-out player's weeks count only to the last
 * week with stats.
 */
export function injuryTiming(label: string, gm: number, year: number, weekString: string, current: GridironCurrent | null): InjuryTiming {
  const none: InjuryTiming = { week: null, seasonEnding: false, ongoing: false, weeksOut: null, returnWeek: null, returnedInPlayoffs: false, projectedReturn: null };
  const m = /from week (\d+)|out week (\d+)/.exec(label);
  if (!m) return none;
  const week = Number(m[1] ?? m[2]);
  const seasonEnding = /season-ending/.test(label);
  const [reg = "", post = ""] = weekString.split("|");
  const last = regularWeeks(year);
  const out: InjuryTiming = { ...none, week, seasonEnding };
  const stillOut = (): InjuryTiming => {
    // The season in progress: the record ends while he is out.
    out.ongoing = true;
    out.weeksOut = Math.max(1, (current!.statsWeek || reg.length) - week + 1);
    return out;
  };
  // Out through the end of the regular season: season-ending whether or not
  // the label said so, unless he came back for the playoffs.
  const neverBack = (): InjuryTiming => {
    out.returnedInPlayoffs = post.includes("P");
    out.weeksOut = Math.max(1, last - week + 1);
    out.seasonEnding = out.seasonEnding || !out.returnedInPlayoffs;
    return out;
  };

  if (current && /ongoing/.test(label)) return stillOut();
  const i = week - 1;
  if (i >= reg.length || reg[i] === "P") {
    // The week string has no record of this absence: the label's games are the weeks.
    if (seasonEnding) return neverBack();
    if (current && i >= reg.length) return stillOut();
    out.returnWeek = Math.min(week + Math.max(1, gm), last);
    out.weeksOut = out.returnWeek - week;
    return out;
  }
  let j = i;
  while (j < reg.length && (reg[j] === "X" || reg[j] === "B")) j += 1;
  if (j >= reg.length) return current && !seasonEnding ? stillOut() : neverBack();
  if (reg[j] === "P") {
    out.returnWeek = j + 1;
    out.weeksOut = out.returnWeek - week;
    return out;
  }
  // Dressed-not-played or off the roster after the run: the return is the next game played, if any.
  let k = j;
  while (k < reg.length && reg[k] !== "P") k += 1;
  if (k < reg.length) {
    out.returnWeek = k + 1;
    out.weeksOut = out.returnWeek - week;
    return out;
  }
  if (current) return stillOut();
  out.returnedInPlayoffs = post.includes("P");
  out.weeksOut = j - i;
  return out;
}

/**
 * A projected return for every player still out this season: the typical
 * absence for the body part across the database (the median games missed of
 * completed events; the injury type's when the body part has few), never
 * fewer than the games already missed plus one, and at least IR_MIN_GAMES
 * for a player on injured reserve. The team's bye is skipped. Not a report:
 * a base rate.
 */
export function projectReturns(players: GmPlayer[], live: number | null, current: GridironCurrent | null, byes: Record<string, number>): void {
  if (live == null || !current) return;
  const byPart: Record<string, number[]> = {};
  const byType: Record<string, number[]> = {};
  for (const p of players) {
    for (const e of p.inj) {
      if (e.timing.week == null || e.timing.ongoing) continue;
      (byPart[e.bodyPart] ??= []).push(e.gm);
      (byType[e.type] ??= []).push(e.gm);
    }
  }
  const median = (xs: number[] | undefined): number | null => {
    if (!xs || !xs.length) return null;
    const a = [...xs].sort((x, y) => x - y);
    const mid = a.length >> 1;
    return a.length % 2 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2;
  };
  const MIN_SAMPLE = 8;
  for (const p of players) {
    for (const e of p.inj) {
      const t = e.timing;
      if (!t.ongoing || t.week == null) continue;
      const partN = byPart[e.bodyPart]?.length ?? 0;
      const typical = (partN >= MIN_SAMPLE ? median(byPart[e.bodyPart]) : median(byType[e.type])) ?? e.gm + 1;
      const onIr = p.cur?.st === "IR" || /on IR/.test(e.label);
      const expected = Math.max(e.gm + 1, Math.ceil(typical), onIr ? IR_MIN_GAMES : 0);
      const team = (p.t && p.t[String(e.year)]) || p.cur?.tm || p.tm;
      const bye = byes[team] ?? null;
      const last = regularWeeks(e.year);
      let games = 0;
      let w = t.week;
      while (w <= last && games < expected) {
        if (w !== bye) games += 1;
        w += 1;
      }
      if (games < expected) continue;
      w = Math.max(w, (current.statsWeek || 0) + 1);
      if (w === bye) w += 1;
      t.projectedReturn = w <= last ? w : null;
    }
  }
}

/* ----------------------------------------------------------------- hydrate */

export function hydrate(data: GridironDataset): Durability {
  const years = (data.years ?? []).map(Number).sort((a, b) => a - b);
  const yearIndex: Record<number, number> = {};
  years.forEach((y, i) => (yearIndex[y] = i));
  const live = data.current ? Number(data.current.season) : null;

  const players: GmPlayer[] = (data.players ?? []).map((p) => {
    const seasons: Record<number, [number, number]> = {};
    for (const k of Object.keys(p.s ?? {})) {
      const y = Number(k);
      if (yearIndex[y] !== undefined) {
        const arr = p.s[k]!;
        seasons[y] = [Number(arr[0]) || 0, Number(arr[1]) || 0];
      }
    }
    const seasonYears = Object.keys(seasons)
      .map(Number)
      .sort((a, b) => a - b);

    // The score is a read on THIS season's risk, so every season (and every
    // injury) fades with age: weight seasonWeight(k), k = seasons before the
    // anchor, the last complete season for a player on a roster now, else
    // his last season. The season in progress gets IN_PROGRESS_WEIGHT.
    const playerLive = p.cur && live != null ? live : null;
    const anchor = playerLive != null ? playerLive - 1 : (seasonYears[seasonYears.length - 1] ?? 0);
    const decay = (y: number): number => (playerLive != null && y >= playerLive ? IN_PROGRESS_WEIGHT : seasonWeight(anchor - y));

    let wNum = 0;
    let wDen = 0;
    let nEff = 0;
    for (const y of seasonYears) {
      const d = decay(y);
      const [gp, gm] = seasons[y]!;
      wNum += d * gp;
      wDen += d * (gp + gm);
      // Evidence, in full-workload games: games scaled by snap share against a
      // starter at the position (no snap data: full weight).
      const u = p.u && p.u[y] != null ? clamp(Number(p.u[y]) / (STARTER_SNAP_SHARE[p.pos] ?? 0.8), 0.15, 1) : 1;
      nEff += d * u * (gp + gm);
    }
    const availRatio = wDen > 0 ? wNum / wDen : 0;

    let gpTot = 0;
    let gmTot = 0;
    for (const y of seasonYears) {
      gpTot += seasons[y]![0];
      gmTot += seasons[y]![1];
    }
    const possTot = gpTot + gmTot;
    const availPct = possTot > 0 ? (100 * gpTot) / possTot : 0;
    const perYearRate = seasonYears.length ? gmTot / seasonYears.length : 0;

    const inj: GmInjury[] = (p.inj ?? [])
      .map((t) => {
        const year = Number(t[0]);
        const label = String(t[1] ?? "");
        const gm = Number(t[4]) || 0;
        return {
          year,
          label,
          bodyPart: String(t[2] ?? ""),
          sev: Number(t[3]),
          gm,
          type: ((t[5] as InjuryType) || "other") as InjuryType,
          rec: (Number(t[6]) ? 1 : 0) as 0 | 1,
          side: String(t[7] ?? ""),
          timing: injuryTiming(label, gm, year, (p.w && p.w[String(year)]) || "", live != null && year === live ? (data.current ?? null) : null),
        };
      })
      .filter((e) => yearIndex[e.year] !== undefined)
      .sort((a, b) => b.year - a.year);

    let sevPen = 0;
    let recPen = 0;
    let major = 0;
    let soft = 0;
    let reinj = false;
    for (const e of inj) {
      const d = decay(e.year);
      if (e.sev === 3) {
        sevPen += 6 * d;
        major += 1;
      } else if (e.sev === 2) sevPen += 2 * d;
      if (e.type === "soft") soft += 1;
      if (e.rec) {
        recPen += 4 * d;
        reinj = true;
      }
    }
    const penalty = 0.6 * Math.min(sevPen, 24) + 0.6 * Math.min(recPen, 16);

    const pointsLostCareer = inj.reduce((s, e) => s + e.gm * p.ppg, 0);
    // Seasons include playoff games, so each season's miss rate is scaled to
    // the simulator's 17 games; recent seasons are drawn more often, a season
    // in progress less (a few games are a noisy guide to the whole year).
    const missHistory = seasonYears.map((y) => {
      const [gp, gm] = seasons[y]!;
      return gp + gm > 0 ? Math.round((17 * gm) / (gp + gm)) : 0;
    });
    const missWeights = seasonYears.map((y) => {
      const [gp, gm] = seasons[y]!;
      return decay(y) * Math.min(1, (gp + gm) / 17);
    });

    const post: Record<number, [number, number, number]> = {};
    for (const k of Object.keys(p.ps ?? {})) {
      const y = Number(k);
      const arr = p.ps![k]!;
      if (seasons[y]) post[y] = [Number(arr[0]) || 0, Number(arr[1]) || 0, Number(arr[2]) || 0];
    }

    const college =
      p.college && p.college.s
        ? {
            school: p.college.school ?? "",
            s: Object.fromEntries(Object.keys(p.college.s).map((k) => [Number(k), [Number(p.college!.s[k]![0]) || 0, Number(p.college!.s[k]![1]) || 0] as [number, number]])),
          }
        : null;

    return {
      ...p,
      seasons,
      seasonYears,
      post,
      availRatio,
      availPct,
      gpTot,
      gmTot,
      possTot,
      perYearRate,
      inj,
      sevPen,
      recPen,
      major,
      soft,
      reinj,
      nEff,
      penalty,
      shrunk: 0,
      score: 0,
      tier: tierOf(0),
      pointsLostCareer,
      missHistory,
      missWeights,
      college,
      key: p.id || nameKey(p.n),
    };
  });

  // Durability score: availability shrunk toward the position average by how
  // much evidence backs it (PRIOR_GAMES full-workload games' worth), minus the
  // injury penalties. 0-100, one decimal, no cap, so a long clean record
  // outranks a short one.
  const posAvail: Record<string, [number, number]> = {};
  for (const p of players) {
    const a = (posAvail[p.pos] ??= [0, 0]);
    a[0] += p.gpTot;
    a[1] += p.possTot;
  }
  for (const p of players) {
    const a = posAvail[p.pos]!;
    const mu = a[1] > 0 ? a[0] / a[1] : 0.9;
    p.shrunk = (p.availRatio * p.nEff + mu * PRIOR_GAMES) / (p.nEff + PRIOR_GAMES);
    p.score = Math.round(10 * clamp(100 * p.shrunk - p.penalty, 0, 100)) / 10;
    p.tier = tierOf(p.score);
  }

  projectReturns(players, live, data.current ?? null, data.byes ?? {});

  const rows: InjuryEventRow[] = [];
  for (const p of players) {
    for (const e of p.inj) {
      rows.push({
        player: p.n,
        key: p.key,
        gsisId: p.id ?? null,
        pos: p.pos,
        tm: (p.t && p.t[String(e.year)]) || p.tm,
        year: e.year,
        label: e.label,
        bodyPart: e.bodyPart,
        side: e.side,
        type: e.type,
        sev: e.sev,
        gm: e.gm,
        pointsLost: e.gm * p.ppg,
        rec: e.rec,
        timing: e.timing,
        ...studyFor(data.study, p, e, data.current?.season ?? null),
      });
    }
  }

  const positions = [...new Set(players.map((p) => p.pos))];
  const totalGamesMissed = players.reduce((s, p) => s + p.gmTot, 0);
  const totalPointsLost = rows.reduce((s, r) => s + r.pointsLost, 0);
  const riskyCount = players.filter((p) => p.tier.key === "elevated" || p.tier.key === "high").length;

  const byKey: Record<string, GmPlayer> = {};
  for (const p of players) {
    byKey[p.key] = p;
    if (!byKey[nameKey(p.n)]) byKey[nameKey(p.n)] = p;
  }

  return { source: data.source || "Imported dataset", years, players, rows, positions, totalGamesMissed, totalPointsLost, riskyCount, current: data.current ?? null, byKey };
}

/** A player by GSIS id, exact name or loose name. */
export function findPlayer(d: Durability, keyOrName: string | null | undefined): GmPlayer | null {
  if (!keyOrName) return null;
  return d.byKey[keyOrName] ?? d.byKey[nameKey(keyOrName)] ?? null;
}

/* ---------------------------------------------------------------- overview */

export interface OverviewView {
  yearSpan: string;
  topLost: GmPlayer[];
  topDurable: GmPlayer[];
  posRows: { pos: string; avg: number }[];
  posMax: number;
  bpRows: { bp: string; gm: number }[];
  bpMax: number;
}

export function overviewView(d: Durability): OverviewView {
  const topLost = [...d.players].sort((x, y) => y.pointsLostCareer - x.pointsLostCareer).slice(0, 8);
  // Durability needs a track record: 3+ loaded seasons, else one healthy year
  // scores 99. Ties break on more seasons of evidence, then scoring.
  const proven = d.players.filter((p) => p.seasonYears.length >= 3);
  const topDurable = [...(proven.length >= 6 ? proven : d.players)].sort((x, y) => y.score - x.score || y.seasonYears.length - x.seasonYears.length || y.ppg - x.ppg).slice(0, 6);

  const posAgg: Record<string, { gm: number; seasons: number }> = {};
  for (const p of d.players) {
    const a = (posAgg[p.pos] ??= { gm: 0, seasons: 0 });
    a.gm += p.gmTot;
    a.seasons += p.seasonYears.length;
  }
  const posRows = Object.keys(posAgg)
    .map((pos) => ({ pos, avg: posAgg[pos]!.seasons ? posAgg[pos]!.gm / posAgg[pos]!.seasons : 0 }))
    .sort((x, y) => y.avg - x.avg);
  const posMax = Math.max(...posRows.map((r) => r.avg), 0.001);

  const bpAgg: Record<string, number> = {};
  for (const r of d.rows) bpAgg[r.bodyPart] = (bpAgg[r.bodyPart] ?? 0) + r.gm;
  const bpRows = Object.keys(bpAgg)
    .map((bp) => ({ bp, gm: bpAgg[bp]! }))
    .sort((x, y) => y.gm - x.gm)
    .slice(0, 8);
  const bpMax = Math.max(...bpRows.map((r) => r.gm), 1);

  return { yearSpan: `${d.years[0]}-${d.years[d.years.length - 1]}`, topLost, topDurable, posRows, posMax, bpRows, bpMax };
}

/* ---------------------------------------------------------- event database */

export interface EventFilters {
  search: string;
  pos: string;
  season: string;
  bodyPart: string;
  sev: string;
  /** The impact study table's other filters: team code, impact label, season-ending only. */
  team: string;
  impact: string;
  seasonEndingOnly: boolean;
}

export type EventSortKey = "player" | "pos" | "year" | "adp" | "week" | "bodyPart" | "type" | "sev" | "gm" | "weeksOut" | "returnWeek" | "seasonEnding" | "impact";

export interface EventState {
  filters: EventFilters;
  sort: { key: EventSortKey; dir: 1 | -1 };
  pageIndex: number;
  pageSize: number;
}

export const EVENT_PAGE_SIZES = [25, 50, 100];

export function defaultEventState(): EventState {
  return { filters: { search: "", pos: "", season: "", bodyPart: "", sev: "", team: "", impact: "", seasonEndingOnly: false }, sort: { key: "year", dir: -1 }, pageIndex: 0, pageSize: 50 };
}

/** The sort direction a column starts on: names ascending, numbers descending. */
export function eventSortStart(key: EventSortKey): 1 | -1 {
  return key === "player" || key === "pos" || key === "adp" ? 1 : -1;
}

export function eventOptions(d: Durability): { seasons: number[]; bodyParts: string[]; positions: string[]; teams: string[]; impacts: string[] } {
  return {
    seasons: [...d.years].sort((x, y) => y - x),
    bodyParts: [...new Set(d.rows.map((r) => r.bodyPart))].sort(),
    positions: d.positions.slice().sort(),
    teams: [...new Set(d.rows.map((r) => r.tm).filter(Boolean))].sort(),
    // Heaviest label first, as the column sorts.
    impacts: [...new Set(d.rows.map((r) => r.impact).filter((x): x is string => x != null))].sort((a, b) => (IMPACT_RANK[b] ?? 0) - (IMPACT_RANK[a] ?? 0)),
  };
}

/** The value a column sorts on; the return column sorts on the projection when he is still out. */
export function eventSortValue(r: InjuryEventRow, key: EventSortKey): string | number | null {
  switch (key) {
    case "week":
      return r.timing.week;
    case "weeksOut":
      return r.timing.weeksOut;
    case "returnWeek":
      return r.timing.returnWeek ?? r.timing.projectedReturn;
    case "type":
      return r.type;
    case "seasonEnding":
      return r.timing.seasonEnding ? 2 : r.timing.ongoing ? 1 : 0;
    case "impact":
      return r.impact == null ? null : IMPACT_RANK[r.impact] ?? 0;
    default:
      return r[key];
  }
}

export function eventRows(d: Durability, state: EventState): InjuryEventRow[] {
  const f = state.filters;
  const q = f.search.toLowerCase().trim();
  const rows = d.rows.filter((r) => {
    if (f.pos && r.pos !== f.pos) return false;
    if (f.season && String(r.year) !== f.season) return false;
    if (f.bodyPart && r.bodyPart !== f.bodyPart) return false;
    if (f.sev && String(r.sev) !== f.sev) return false;
    if (f.team && r.tm !== f.team) return false;
    if (f.impact && r.impact !== f.impact) return false;
    if (f.seasonEndingOnly && !r.timing.seasonEnding) return false;
    if (q) {
      const hay = `${r.player} ${r.label} ${r.tm} ${r.bodyPart} ${r.pos}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const { key, dir } = state.sort;
  rows.sort((x, y) => {
    const xv = eventSortValue(x, key);
    const yv = eventSortValue(y, key);
    if (typeof xv === "string" || typeof yv === "string") {
      const a = String(xv).toLowerCase();
      const b = String(yv).toLowerCase();
      return a < b ? -dir : a > b ? dir : 0;
    }
    // Rows without the value (playoff-only events, no return) sort last either way.
    if (xv == null || yv == null) return xv == null && yv == null ? 0 : xv == null ? 1 : -1;
    return (xv - yv) * dir;
  });
  return rows;
}

/** The event table's return column as plain text: the week, a projection, or why there is none. */
export function returnPlain(t: InjuryTiming): string {
  if (t.week == null) return "";
  if (t.ongoing) return t.projectedReturn == null ? "Proj. season" : `Proj. ${t.projectedReturn}`;
  if (t.returnWeek != null) return String(t.returnWeek);
  if (t.returnedInPlayoffs) return "Playoffs";
  return t.seasonEnding ? "Out for season" : "Did not return";
}

export const EVENT_CSV_HEADER = ["Player", "Position", "Team", "Season", "ADP", "Week of injury", "Injury", "Body part", "Side", "Type", "Severity", "Games missed", "Weeks out", "Still out", "Season ending", "Return week", "Impact", "Re-injury"];

/** The event rows as CSV, in the order given: the table's columns plus the detail behind them. */
export function eventCsv(rows: InjuryEventRow[]): string {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const line = (r: InjuryEventRow) => {
    const t = r.timing;
    return [r.player, r.pos, r.tm, r.year, r.adp ?? "", t.week ?? "Playoffs", r.label.replace(/\s+—\s+/g, ", "), r.bodyPart, r.side, TYPE_LABEL[r.type], SEV_SHORT[r.sev] ?? "", r.gm, t.weeksOut ?? "", t.ongoing ? "yes" : "", t.seasonEnding ? "yes" : "", returnPlain(t), r.impact ?? "", r.rec ? "yes" : ""].map(esc).join(",");
  };
  return `${EVENT_CSV_HEADER.join(",")}\n${rows.map(line).join("\n")}`;
}

/* --------------------------------------------------------- current players */

export interface RankFilters {
  search: string;
  pos: string;
  team: string;
  status: string;
  minSeasons: number;
}

export type RankSortKey = "n" | "pos" | "tm" | "score" | "adp" | "seasons" | "avail" | "gm" | "major";

export interface RankState {
  filters: RankFilters;
  sort: { key: RankSortKey; dir: 1 | -1 };
  pageIndex: number;
  pageSize: number;
}

export function defaultRankState(): RankState {
  return { filters: { search: "", pos: "", team: "", status: "", minSeasons: 1 }, sort: { key: "score", dir: -1 }, pageIndex: 0, pageSize: 50 };
}

export function rankSortStart(key: RankSortKey): 1 | -1 {
  return key === "n" || key === "pos" || key === "tm" || key === "adp" ? 1 : -1;
}

export interface RankRow {
  p: GmPlayer;
  n: string;
  pos: string;
  tm: string;
  score: number;
  adp: number | null;
  seasons: number;
  avail: number;
  gm: number;
  major: number;
  rank: number;
}

/**
 * Current players on the list: the top ADP_TOP of this season's ADP board,
 * or every current player when the dataset has no ADP.
 */
export function rankPool(d: Durability): GmPlayer[] {
  const cur = d.players.filter((p) => p.cur);
  return cur.some((p) => p.adpRank != null) ? cur.filter((p) => p.adpRank != null && p.adpRank <= ADP_TOP) : cur;
}

export function rankTeams(d: Durability): string[] {
  return [...new Set(rankPool(d).map((p) => p.cur!.tm))].sort();
}

export function rankRows(d: Durability, state: RankState): RankRow[] {
  const f = state.filters;
  const q = f.search.toLowerCase().trim();
  const all = rankPool(d);
  const rows: RankRow[] = all
    .filter((p) => (!f.pos || p.pos === f.pos) && (!f.team || p.cur!.tm === f.team) && (!f.status || p.cur!.st === f.status) && p.seasonYears.length >= (f.minSeasons || 1) && (!q || `${p.n} ${p.cur!.tm}`.toLowerCase().includes(q)))
    .map((p) => ({ p, n: p.n, pos: p.pos, tm: p.cur!.tm, score: p.score, adp: p.adp ?? null, seasons: p.seasonYears.length, avail: p.availPct, gm: p.gmTot, major: p.major, rank: 0 }));
  // The rank is the durability order (score; healthy PPG breaks exact ties), whatever the sort.
  [...rows].sort((x, y) => y.score - x.score || y.p.ppg - x.p.ppg).forEach((r, i) => (r.rank = i + 1));
  const { key, dir } = state.sort;
  rows.sort((x, y) => {
    if (key === "score") return (x.rank - y.rank) * -dir;
    const xv = x[key] as string | number | null;
    const yv = y[key] as string | number | null;
    if (xv == null || yv == null) return Number(xv == null) - Number(yv == null) || x.rank - y.rank;
    if (typeof xv === "string") {
      const a = xv.toLowerCase();
      const b = String(yv).toLowerCase();
      return (a < b ? -dir : a > b ? dir : 0) || x.rank - y.rank;
    }
    return (xv - (yv as number)) * dir || x.rank - y.rank;
  });
  return rows;
}

/** "2019-25" for a career, "2026" for a rookie. */
export const RANK_CSV_HEADER = ["Rank", "Player", "Position", "Team", "Roster status", "Durability", "Tier", "ADP", "Seasons", "Season span", "Available %", "Games missed", "Major injuries", "Thin record"];

/** The current players table as CSV, in the order given: its columns plus the detail behind them. */
export function rankCsv(rows: RankRow[]): string {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const line = (r: RankRow) =>
    [r.rank, r.n, r.pos, r.tm, r.p.cur?.st ?? "", r.score, r.p.tier.name, r.adp ?? "", r.seasons, seasonSpanOf(r.p), Math.round(r.avail * 10) / 10, r.gm, r.major, r.p.nEff < PRIOR_GAMES ? "yes" : ""].map(esc).join(",");
  return `${RANK_CSV_HEADER.join(",")}\n${rows.map(line).join("\n")}`;
}

export function seasonSpanOf(p: GmPlayer): string {
  const ys = p.seasonYears;
  return ys.length > 1 ? `${ys[0]}-${String(ys[ys.length - 1]).slice(2)}` : String(ys[0] ?? "");
}

/* ---------------------------------------------------------------- simulator */

/**
 * Preset pool: players in the latest loaded season with a 3+ season track
 * record and 24+ games played (so a backup's few starts can't inflate PPG),
 * falling back to everyone on small or older datasets.
 */
export function presetPool(d: Durability): GmPlayer[] {
  const last = d.years[d.years.length - 1]!;
  const cur = d.players.filter((p) => p.seasonYears.includes(last) && p.seasonYears.length >= 3 && p.gpTot >= 24);
  return cur.length >= 14 ? cur : d.players;
}

/** Among fantasy starters (the top half by healthy PPG), the most durable seven. */
export function presetSafe(d: Durability): string[] {
  const pool = presetPool(d);
  const cut = [...pool].sort((x, y) => y.ppg - x.ppg)[Math.floor(pool.length / 2)]?.ppg ?? 0;
  const starters = pool.filter((p) => p.ppg >= cut);
  return [...(starters.length >= 7 ? starters : pool)]
    .sort((x, y) => y.score - x.score || y.ppg - x.ppg)
    .slice(0, 7)
    .map((p) => p.key);
}

/** The seven highest scorers outside the iron tier. */
export function presetUpside(d: Durability): string[] {
  let pool = presetPool(d).filter((p) => p.tier.key !== "iron");
  if (pool.length < 5) pool = presetPool(d).slice();
  return [...pool]
    .sort((x, y) => y.ppg - x.ppg)
    .slice(0, 7)
    .map((p) => p.key);
}

export interface SimResult {
  n: number;
  mean: number;
  ceiling: number;
  avgMissed: number;
  bigShare: number;
  p10: number;
  p50: number;
  p90: number;
  min: number;
  max: number;
  /** Histogram: a count per bin, lowest totals first, and whether the bin sits under the 10th percentile. */
  bins: { count: number; mid: number; low: boolean }[];
}

/** A value drawn with probability proportional to its weight. */
function pickWeighted(vals: number[], weights: number[], rng: () => number): number {
  const tot = weights.reduce((t, w) => t + w, 0);
  if (!vals.length || !(tot > 0)) return vals.length ? vals[Math.floor(rng() * vals.length)]! : 0;
  let r = rng() * tot;
  for (let i = 0; i < vals.length; i += 1) {
    r -= weights[i]!;
    if (r < 0) return vals[i]!;
  }
  return vals[vals.length - 1]!;
}

/**
 * Stress-test a roster against injury luck. Every rostered player draws games
 * missed from his own per-season history, then: +1-3 games with p=0.18
 * (fresh bad luck), -2 with p=0.12 (good luck), a forced major with p=0.05.
 * Points = (17 - missed) x PPG, no replacement scoring.
 */
export function runSim(roster: GmPlayer[], rng: () => number = Math.random, n = SIM_SEASONS): SimResult | null {
  if (roster.length < 2) return null;
  const rint = (k: number): number => Math.floor(rng() * k);
  const totals: number[] = [];
  let sumMissed = 0;
  let seasonsWithBig = 0;
  const ceiling = roster.reduce((s, p) => s + 17 * p.ppg, 0);
  for (let s = 0; s < n; s += 1) {
    let pts = 0;
    let rosterMissed = 0;
    let big = false;
    for (const p of roster) {
      let missed = pickWeighted(p.missHistory, p.missWeights, rng);
      if (rng() < 0.18) missed += 1 + rint(3);
      if (rng() < 0.12) missed -= 2;
      if (rng() < 0.05) missed = Math.max(missed, 6 + rint(8));
      missed = clamp(missed, 0, 17);
      if (missed >= 6) big = true;
      rosterMissed += missed;
      pts += (17 - missed) * p.ppg;
    }
    totals.push(pts);
    sumMissed += rosterMissed;
    if (big) seasonsWithBig += 1;
  }
  totals.sort((a, b) => a - b);
  const mean = totals.reduce((a, b) => a + b, 0) / n;
  const pct = (q: number): number => totals[clamp(Math.floor(q * n), 0, n - 1)]!;
  const min = totals[0]!;
  const max = totals[n - 1]!;
  const p10 = pct(0.1);
  const span = max - min || 1;
  const counts = new Array<number>(SIM_BINS).fill(0);
  for (const t of totals) counts[clamp(Math.floor(((t - min) / span) * SIM_BINS), 0, SIM_BINS - 1)] += 1;
  const bins = counts.map((count, i) => ({ count, mid: min + ((i + 0.5) / SIM_BINS) * span, low: min + ((i + 1) / SIM_BINS) * span <= p10 }));
  return { n, mean, ceiling, avgMissed: sumMissed / n, bigShare: seasonsWithBig / n, p10, p50: pct(0.5), p90: pct(0.9), min, max, bins };
}

/** A small seeded generator (mulberry32), for tests and for a repeatable run. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
