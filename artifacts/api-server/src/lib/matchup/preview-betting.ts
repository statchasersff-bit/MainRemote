/**
 * Betting Outlook (mak's brief, 2026-11-06), added under Fantasy Football
 * Impact on the upcoming page. Research, not picks: no probabilities, edges,
 * "best bets" or projections are produced anywhere here.
 *
 * Sources, all already in the app (no new odds feed):
 *   current market   p.line, the stored sportsbook line (one book, not a
 *                    consensus): spread + open, total + open, both moneylines
 *                    (no opening moneyline and no prices/vig are stored, so
 *                    neither is shown). Stale lines never reach here
 *                    (buildPreview's 72-hour check).
 *   trends           the season slate's closing spread and total per game
 *                    (positive spread = home favored), the same line for every
 *                    team and game; scored against the final score, pushes
 *                    counted. Never compared with today's line.
 *   insight          ONE line (mak, 2026-11-07 compaction): the sharpest
 *                    last-5 covering or totals contrast, else a long streak,
 *                    else a real line move. EPA stays in Team Comparison.
 * Player props: no prop markets exist in our data, so the subsection is not
 * built (the brief: omit rather than invent).
 *
 * The house rule stands: no provider is named in the page
 * ([[no-outside-sources-in-page-source]]).
 */

import type { ScheduleGame } from "../schedule/schedule-data";
import type { NflTeam } from "../team/teams";
import type { Preview, PreviewSide } from "./preview";

/* ------------------------------------------------------------- trends */

export interface Record3 {
  w: number;
  l: number;
  p: number;
}

/** One completed game against its own closing line, from this team's side. */
export interface RecentGame {
  week: number;
  opp: NflTeam | null;
  oppCode: string;
  home: boolean;
  own: number;
  allowed: number;
  /** This team's closing handicap: negative = favored ("-2.5"), 0 = pick'em. */
  handicap: number;
  total: number;
  ats: "w" | "l" | "p";
  ou: "o" | "u" | "p";
  /** Final margin plus the handicap: points beyond the number (negative = short of it). */
  vsSpread: number;
}

export interface TeamTrends {
  games: number;
  /** The last five games (or fewer), oldest first; the same games as last5Ats / last5Ou. */
  recent: RecentGame[];
  /** Averages over `recent`: points scored, allowed, combined, closing total, margin vs the spread. */
  recentAvg: { scored: number; allowed: number; combined: number; total: number; vsSpread: number };
  ats: Record3;
  last5Ats: Record3;
  last5Games: number;
  ou: { o: number; u: number; p: number };
  last5Ou: { o: number; u: number; p: number };
  /** In this game's venue role: road ATS for the away team, home ATS for the home team. */
  venueAts: Record3 & { games: number; venue: "home" | "road" };
  /** In this game's market role, when the line names one. */
  roleAts: (Record3 & { games: number; role: "favorite" | "underdog" }) | null;
}

const empty = (): Record3 => ({ w: 0, l: 0, p: 0 });

/**
 * One team's record against the closing lines of its completed games this
 * season, oldest first. `role` is the team's role in THIS game's market.
 */
export function teamTrends(
  team: NflTeam,
  slate: ScheduleGame[],
  venue: "home" | "road",
  role: "favorite" | "underdog" | null,
  before: number,
): TeamTrends | null {
  const games = slate
    .filter(
      (g) =>
        g.status === "final" &&
        g.awayScore !== null &&
        g.homeScore !== null &&
        g.spreadLine !== null &&
        g.totalLine !== null &&
        g.week < before &&
        (g.away?.abbreviation === team.abbreviation || g.home?.abbreviation === team.abbreviation),
    )
    .sort((a, b) => a.week - b.week);
  if (!games.length) return null;
  const rows = games.map((g) => {
    const home = g.home?.abbreviation === team.abbreviation;
    const own = home ? g.homeScore! : g.awayScore!;
    const opp = home ? g.awayScore! : g.homeScore!;
    // spread_line is home-signed: positive = home favored by that many.
    const handicap = home ? -g.spreadLine! : g.spreadLine!;
    const cover = own - opp + handicap;
    const sum = own + opp;
    const oppTeam = home ? g.away : g.home;
    return {
      week: g.week,
      opp: oppTeam,
      oppCode: oppTeam?.code.toUpperCase() ?? (home ? g.awayCode : g.homeCode).toUpperCase(),
      own,
      allowed: opp,
      handicap,
      total: g.totalLine!,
      vsSpread: cover,
      home,
      ats: cover > 0 ? "w" : cover < 0 ? "l" : "p",
      ou: sum > g.totalLine! ? "o" : sum < g.totalLine! ? "u" : "p",
      favored: home ? g.spreadLine! > 0 : g.spreadLine! < 0,
      dog: home ? g.spreadLine! < 0 : g.spreadLine! > 0,
    } as const;
  });
  const tally = (list: typeof rows): Record3 => {
    const r = empty();
    for (const x of list) r[x.ats] += 1;
    return r;
  };
  const ouTally = (list: typeof rows) => {
    const r = { o: 0, u: 0, p: 0 };
    for (const x of list) r[x.ou] += 1;
    return r;
  };
  const last5 = rows.slice(-5);
  const venueRows = rows.filter((x) => x.home === (venue === "home"));
  const roleRows = role ? rows.filter((x) => (role === "favorite" ? x.favored : x.dog)) : [];
  const avg = (f: (x: (typeof rows)[number]) => number) => Math.round((last5.reduce((a, x) => a + f(x), 0) / last5.length) * 10) / 10;
  return {
    games: rows.length,
    recent: last5.map(({ favored: _f, dog: _d, ...x }) => x),
    recentAvg: {
      scored: avg((x) => x.own),
      allowed: avg((x) => x.allowed),
      combined: avg((x) => x.own + x.allowed),
      total: avg((x) => x.total),
      vsSpread: avg((x) => x.vsSpread),
    },
    ats: tally(rows),
    last5Ats: tally(last5),
    last5Games: last5.length,
    ou: ouTally(rows),
    last5Ou: ouTally(last5),
    venueAts: { ...tally(venueRows), games: venueRows.length, venue },
    roleAts: role ? { ...tally(roleRows), games: roleRows.length, role } : null,
  };
}

/* ------------------------------------------------------------- market */

export interface MarketRow {
  label: "Spread" | "Total" | "Moneyline";
  open: string | null;
  current: string;
  move: string | null;
  /** Arrow for the move cell: the total goes up or down, the spread moves toward a team. */
  dir: "up" | "down" | "toward" | "none" | null;
}

export interface BettingOutlook {
  market: MarketRow[];
  /** When the line was last seen, for the "Updated" stamp. */
  seenAt: number | null;
  /**
   * ONE key insight (mak, 2026-11-07: "show the number once, explain its
   * significance once"): the sharpest contrast the tables above cannot say on
   * their own, or null when nothing stands out.
   */
  insight: string | null;
}

const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");
const odds = (n: number | null): string | null => (n === null ? null : n > 0 ? `+${n}` : `−${Math.abs(n)}`);
const code = (t: NflTeam): string => t.code.toUpperCase();
const trim = (n: number): string => String(Math.round(n * 10) / 10);

/** "NE -3", "PK", from the home-signed spread (negative = home favored). */
export function spreadText(spread: number, away: NflTeam, home: NflTeam): string {
  if (spread === 0) return "PK";
  return spread < 0 ? `${code(home)} ${signed(spread)}` : `${code(away)} ${signed(-spread)}`;
}

/**
 * Movement from open to now on the home-signed spread, so a change of
 * favorite reads correctly: a falling number moved toward the home team.
 */
export function spreadMove(open: number, now: number, away: NflTeam, home: NflTeam): string {
  const d = Math.round((now - open) * 10) / 10;
  if (d === 0) return "No change";
  return `${trim(Math.abs(d))} toward ${d < 0 ? code(home) : code(away)}`;
}

export function bettingOutlook(p: Preview): BettingOutlook | null {
  const { away, home, line } = p;
  if (!line || line.spread === null || line.total === null) return null;
  const totalDir = line.totalOpen === null ? null : line.total > line.totalOpen ? "up" : line.total < line.totalOpen ? "down" : "none";
  const market: MarketRow[] = [
    {
      label: "Spread",
      open: line.spreadOpen !== null ? spreadText(line.spreadOpen, away.team, home.team) : null,
      current: spreadText(line.spread, away.team, home.team),
      move: line.spreadOpen !== null ? spreadMove(line.spreadOpen, line.spread, away.team, home.team) : null,
      dir: line.spreadOpen === null ? null : line.spread === line.spreadOpen ? "none" : "toward",
    },
    {
      label: "Total",
      open: line.totalOpen !== null ? trim(line.totalOpen) : null,
      current: trim(line.total),
      move:
        line.totalOpen !== null
          ? line.total === line.totalOpen
            ? "No change"
            : `${line.total > line.totalOpen ? "Up" : "Down"} ${trim(Math.abs(line.total - line.totalOpen))}`
          : null,
      dir: totalDir,
    },
  ];
  const mlA = odds(line.moneyline.away);
  const mlH = odds(line.moneyline.home);
  if (mlA && mlH) market.push({ label: "Moneyline", open: null, current: `${code(away.team)} ${mlA} · ${code(home.team)} ${mlH}`, move: null, dir: null });

  return { market, seenAt: line.seenAt ?? null, insight: keyInsight(p) };
}

const WORD = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight"];
const word = (n: number): string => WORD[n] ?? String(n);

/** Same result in a row at the latest end of `recent` (pushes end it). */
function streak(t: TeamTrends, k: "ats" | "ou"): { v: string; n: number } {
  const list = t.recent.map((g) => g[k]);
  const v = list[list.length - 1];
  let n = 0;
  for (let i = list.length - 1; i >= 0 && list[i] === v && v !== "p"; i--) n++;
  return { v, n };
}

/**
 * The one insight: a covering contrast (two or more covers apart over the
 * last five) and/or a totals contrast (three or more overs apart), in one or
 * two sentences; else a long single-team streak; else a real line move.
 */
export function keyInsight(p: Preview): string | null {
  const { away, home, line } = p;
  const ta = p.trends.away;
  const th = p.trends.home;
  const parts: string[] = [];
  if (ta && th && ta.last5Games >= 3 && th.last5Games >= 3) {
    const [hi, lo, thi, tlo] = ta.last5Ats.w >= th.last5Ats.w ? [away, home, ta, th] : [home, away, th, ta];
    if (thi.last5Ats.w - tlo.last5Ats.w >= 2) {
      const pushes = thi.last5Ats.p ? ` with ${thi.last5Ats.p === 1 ? "one push" : `${word(thi.last5Ats.p)} pushes`}` : "";
      parts.push(
        `The ${hi.team.nickname} have covered ${word(thi.last5Ats.w)} of their last ${word(thi.last5Games)}${pushes}, while the ${lo.team.nickname} are ${rec(tlo.last5Ats)} ATS.`,
      );
    }
    const sa = streak(ta, "ou");
    const sh = streak(th, "ou");
    const ouLine = (s: PreviewSide, t: TeamTrends) => `${code(s.team)} ${t.last5Ou.o}-${t.last5Ou.u}${t.last5Ou.p ? `-${t.last5Ou.p}` : ""}`;
    if (sa.n >= 3 && sh.n >= 3 && sa.v !== sh.v) {
      const say = (s: PreviewSide, st: { v: string; n: number }) => `${s.team.nickname} games have gone ${st.v === "o" ? "over" : "under"} ${word(st.n)} straight`;
      parts.push(`The totals split sharply: ${say(away, sa)}, ${say(home, sh)}.`);
    } else if (Math.abs(ta.last5Ou.o - th.last5Ou.o) >= 3) {
      parts.push(`Their totals trends diverge: ${ouLine(away, ta)} and ${ouLine(home, th)} O/U over the last five.`);
    }
    if (!parts.length) {
      for (const [s, t] of [[away, ta], [home, th]] as const) {
        const st = streak(t, "ou");
        if (st.n >= 4) {
          parts.push(`${s.team.nickname} games have gone ${st.v === "o" ? "over" : "under"} ${word(st.n)} straight.`);
          break;
        }
      }
    }
  }
  if (!parts.length && line && line.spread !== null && line.spreadOpen !== null) {
    const flip = Math.sign(line.spread) !== Math.sign(line.spreadOpen) && line.spreadOpen !== 0;
    if (flip || Math.abs(line.spread - line.spreadOpen) >= 1.5) {
      parts.push(
        flip
          ? `The favorite has flipped since the open: ${spreadText(line.spreadOpen, away.team, home.team)} then, ${spreadText(line.spread, away.team, home.team)} now.`
          : `The spread has moved ${spreadMove(line.spreadOpen, line.spread, away.team, home.team)} since it opened.`,
      );
    }
  }
  return parts.length ? parts.join(" ") : null;
}

const rec = (r: Record3): string => `${r.w}-${r.l}${r.p ? `-${r.p}` : ""}`;
