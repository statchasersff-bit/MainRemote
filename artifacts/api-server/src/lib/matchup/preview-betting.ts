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
 *   angles           the Team Comparison metrics (lib/team/stats.ts ladders
 *                    and the efficiency file's EPA ranks), each team's season
 *                    scoring, line movement and the kickoff conditions.
 * Player props: no prop markets exist in our data, so the subsection is not
 * built (the brief: omit rather than invent).
 *
 * The house rule stands: no provider is named in the page
 * ([[no-outside-sources-in-page-source]]).
 */

import type { ScheduleGame } from "../schedule/schedule-data";
import type { NflTeam } from "../team/teams";
import { teamComparison, type CompareRow } from "./preview-compare";
import { ordinal, type Preview, type PreviewSide } from "./preview";

/* ------------------------------------------------------------- trends */

export interface Record3 {
  w: number;
  l: number;
  p: number;
}

export interface TeamTrends {
  games: number;
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
    return {
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
  return {
    games: rows.length,
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
}

export interface BettingAngle {
  category: "Spread" | "Total" | "Market";
  headline: string;
  text: string;
}

export interface BettingOutlook {
  market: MarketRow[];
  /** When the line was last seen, for the "Updated" stamp. */
  seenAt: number | null;
  angles: BettingAngle[];
}

/** Combined offensive + defensive EPA rank places the underdog must be ahead by to "lean the other way". */
const LEAN_PLACES = 6;

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

function cmpRow(rows: CompareRow[], id: string): CompareRow | null {
  return rows.find((r) => r.id === id) ?? null;
}

export function bettingOutlook(p: Preview): BettingOutlook | null {
  const { away, home, line } = p;
  if (!line || line.spread === null || line.total === null) return null;
  const market: MarketRow[] = [
    {
      label: "Spread",
      open: line.spreadOpen !== null ? spreadText(line.spreadOpen, away.team, home.team) : null,
      current: spreadText(line.spread, away.team, home.team),
      move: line.spreadOpen !== null ? spreadMove(line.spreadOpen, line.spread, away.team, home.team) : null,
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
    },
  ];
  const mlA = odds(line.moneyline.away);
  const mlH = odds(line.moneyline.home);
  if (mlA && mlH) market.push({ label: "Moneyline", open: null, current: `${code(away.team)} ${mlA} · ${code(home.team)} ${mlH}`, move: null });

  /* ---- angles: measured, data-backed, no projections */
  const angles: BettingAngle[] = [];
  const cmp = teamComparison({ team: away.team, stats: away.stats }, { team: home.team, stats: home.stats });
  const rows = cmp?.tabs.flatMap((t) => t.rows) ?? [];
  const epaO = cmpRow(rows, "adv-epa-off");
  const epaD = cmpRow(rows, "adv-epa-def");
  const size = Math.abs(line.spread);
  const fav: PreviewSide | null = line.spread < 0 ? home : line.spread > 0 ? away : null;
  const dog: PreviewSide | null = fav === home ? away : fav === away ? home : null;
  const cell = (r: CompareRow | null, s: PreviewSide) => (r ? (s.key === "away" ? r.away : r.home) : null);
  const rk = (r: CompareRow | null, s: PreviewSide) => {
    const c = cell(r, s);
    return c && c.rank !== null ? `${c.tied ? "T-" : ""}${ordinal(c.rank)}` : null;
  };
  if (epaO && epaD) {
    const net = (s: PreviewSide) => (cell(epaO, s)?.rank ?? 99) + (cell(epaD, s)?.rank ?? 99);
    const profile = (s: PreviewSide) =>
      `the ${s.team.nickname} rank ${rk(epaO, s) ?? "-"} in offensive EPA per play and ${rk(epaD, s) ?? "-"} in EPA allowed`;
    if (fav && dog) {
      const favBoth = (cell(epaO, fav)?.rank ?? 99) < (cell(epaO, dog)?.rank ?? 99) && (cell(epaD, fav)?.rank ?? 99) < (cell(epaD, dog)?.rank ?? 99);
      // The underdog "leans" only by a clear margin: six combined EPA places.
      const dogLeans = net(dog) + LEAN_PLACES <= net(fav);
      const headline = favBoth ? "Efficiency backs the favorite" : dogLeans ? "The per-play numbers lean the other way" : "A split efficiency profile";
      angles.push({
        category: "Spread",
        headline,
        text:
          `The market makes the ${fav.team.nickname} ${trim(size)}-point favorites. ` +
          `${cap(profile(fav))}; ${profile(dog)}.` +
          (favBoth ? "" : dogLeans ? ` The price leans on more than season efficiency here.` : ` Each side has an area the other does not.`),
      });
    } else {
      angles.push({ category: "Spread", headline: "A pick'em market", text: `Neither side is favored. ${cap(profile(away))}; ${profile(home)}.` });
    }
  }
  const pts = cmpRow(rows, "off-points");
  const allowed = cmpRow(rows, "def-points");
  if (pts && allowed && pts.away.value && pts.home.value && allowed.away.value && allowed.home.value) {
    const scored = Number(pts.away.value) + Number(pts.home.value);
    const conceded = Number(allowed.away.value) + Number(allowed.home.value);
    const headline =
      scored > line.total + 3
        ? "Season scoring runs above the number"
        : scored < line.total - 3
          ? "Season scoring runs below the number"
          : "The total sits near season scoring";
    angles.push({
      category: "Total",
      headline,
      text:
        `The total is ${trim(line.total)}. The ${away.team.nickname} score ${pts.away.value} and allow ${allowed.away.value} a game; ` +
        `the ${home.team.nickname} score ${pts.home.value} and allow ${allowed.home.value}, ` +
        `${trim(scored)} combined points scored and ${trim(conceded)} allowed per game between them.` +
        (p.conditions?.impact ? ` ${p.conditions.impact}` : ""),
    });
  }
  // A third angle only for a real signal: a big move, a flip, or a QB in doubt.
  const notes: string[] = [];
  if (line.spreadOpen !== null && (Math.abs(line.spread - line.spreadOpen) >= 1.5 || Math.sign(line.spread) !== Math.sign(line.spreadOpen))) {
    notes.push(
      `The spread has moved from ${spreadText(line.spreadOpen, away.team, home.team)} at open to ${spreadText(line.spread, away.team, home.team)}; these numbers do not show why.`,
    );
  }
  if (line.totalOpen !== null && Math.abs(line.total - line.totalOpen) >= 2) {
    notes.push(`The total has moved from ${trim(line.totalOpen)} to ${trim(line.total)} since it opened.`);
  }
  for (const s of [away, home]) {
    const qb = p.injuries[s.key].find((r) => r.pos === "QB" && (r.status === "Out" || r.status === "Doubtful"));
    if (qb) notes.push(`${qb.name} is listed ${qb.status}; the ${s.team.nickname} quarterback spot is the largest source of uncertainty in this market.`);
  }
  if (notes.length) angles.push({ category: "Market", headline: "Worth monitoring", text: notes.join(" ") });

  return { market, seenAt: line.seenAt ?? null, angles };
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
