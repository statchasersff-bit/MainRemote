/**
 * The question pools for the Overview, Stats and Game Log tabs (faq-engine.ts
 * has the rules). Outlook, Injury and News build theirs next to the models
 * they read (outlook-tab.ts, injury-tab.ts, news-tab.ts); Bio in bio.ts.
 *
 * Pool order is priority order. Every answer is built from the page's own
 * data and leads with the fact asked for; a question the data cannot answer,
 * or that does not fit the player's state (no games yet, a backup with no
 * snaps, a bye week), is left out rather than guessed at.
 */

import type { PlayerRenderOptions } from "../player-render";
import type { PlayerPageData } from "./player-data";
import type { GameLogEntry } from "./types";
import type { ScheduleGame } from "../team/schedule";
import { getEntryPoints, SCORING_SHORT } from "./scoring";
import { designationSeverity, lastName, matchupBand, STARTSIT_BASE } from "./header";
import { leagueFit } from "./outlook-tab";
import { aPos, count, listWords, one, ordinal, tabHref, whole, word, type FaqCandidate } from "./faq-engine";

/* ---------------------------------------------------------------- context */

interface Ctx {
  name: string;
  last: string;
  pos: string;
  fmt: string;
  season: number;
  /** This season's games he was active in, oldest first. */
  played: GameLogEntry[];
  pts: (e: GameLogEntry) => number;
  games: ScheduleGame[];
  out: boolean;
  status: string;
}

function ctx(data: PlayerPageData): Ctx {
  const season = data.leagueSeason ?? data.season;
  const log = data.season === season ? data.gameLog ?? [] : [];
  const status = (data.designation?.injuryStatus ?? data.player.injury_status ?? "").trim();
  return {
    name: data.player.name,
    last: lastName(data.player.name),
    pos: data.player.position ?? "",
    fmt: SCORING_SHORT[data.format] ?? "PPR",
    season,
    played: log.filter((e) => (e.game_status ?? "active") === "active" && e.stats),
    pts: (e) => getEntryPoints(e.stats, data.format),
    games: data.schedule ?? [],
    out: status !== "" && designationSeverity(status) === "out",
    status,
  };
}

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const sum = (es: GameLogEntry[], key: string): number =>
  es.reduce((t, e) => t + n((e.stats as unknown as Record<string, unknown>)[key]), 0);

/** "at the 49ers" / "against the Seahawks", from the schedule. */
function vs(c: Ctx, week: number, fallback: string): string {
  const g = c.games.find((x) => x.week === week);
  const opp = g?.opponent?.nickname ?? g?.opponentName ?? fallback;
  return g?.homeAway === "away" ? `at the ${opp}` : `against the ${opp}`;
}

function result(c: Ctx, e: GameLogEntry): string {
  const g = c.games.find((x) => x.week === e.week);
  const r = g?.result;
  if (r) {
    const word = r.outcome === "W" ? "win" : r.outcome === "L" ? "loss" : "tie";
    return `a ${Math.max(r.teamScore, r.opponentScore)}–${Math.min(r.teamScore, r.opponentScore)} ${word}`;
  }
  if (e.score) {
    const word = e.score.r === "W" ? "win" : e.score.r === "L" ? "loss" : "tie";
    return `a ${Math.max(e.score.tm, e.score.opp)}–${Math.min(e.score.tm, e.score.opp)} ${word}`;
  }
  return "the game";
}

/** One game's box score as a clause: "38 of 52 passes for 280 yards, two TDs...". */
function line(c: Ctx, e: GameLogEntry): string {
  const s = e.stats;
  const td = (k: number, what: string) => (k ? ` and ${count(k, what)}` : "");
  if (c.pos === "QB") {
    let out = `completed ${n(s.pass_cmp)} of ${n(s.pass_att)} passes for ${n(s.pass_yd)} yards` +
      (n(s.pass_td) || n(s.pass_int) ? ` with ${[n(s.pass_td) ? count(n(s.pass_td), "touchdown") : "", n(s.pass_int) ? count(n(s.pass_int), "interception") : ""].filter(Boolean).join(" and ")}` : "");
    if (n(s.rush_att)) out += `, and ran ${count(n(s.rush_att), "time")} for ${n(s.rush_yd)} yards${n(s.rush_td) ? ` and ${count(n(s.rush_td), "touchdown")}` : ""}`;
    return out;
  }
  if (c.pos === "RB") {
    return `ran ${count(n(s.rush_att), "time")} for ${n(s.rush_yd)} yards${td(n(s.rush_td), "touchdown")}` +
      (n(s.rec_tgt) ? `, and caught ${n(s.rec)} of ${count(n(s.rec_tgt), "target")} for ${n(s.rec_yd)} yards${td(n(s.rec_td), "touchdown")}` : "");
  }
  return `caught ${n(s.rec)} of ${count(n(s.rec_tgt), "target")} for ${n(s.rec_yd)} yards${td(n(s.rec_td), "touchdown")}` +
    (n(s.rush_att) ? `, and ran for ${n(s.rush_yd)} yards` : "");
}

const finishOf = (c: Ctx, e: GameLogEntry): string => (e.pos_rank ? `, ${aPos(c.pos)} ${c.pos}${e.pos_rank} finish` : "");

/* --------------------------------------------------------------- Overview */

/** "a weekly starter in one-QB leagues": what a season rank means for a lineup. */
function leagueRead(pos: string, rank: number): string {
  if (pos === "QB") {
    if (rank <= 12) return "a weekly starter in one-QB leagues";
    if (rank <= 24) return "a streaming option in one-QB leagues and a starter in superflex and two-QB leagues";
    return "depth in one-QB leagues and a bye-week fill-in in superflex";
  }
  if (pos === "TE") {
    if (rank <= 12) return "a weekly starter in 12-team leagues";
    if (rank <= 20) return "a streaming option in 12-team leagues";
    return "a bench stash in most leagues";
  }
  if (rank <= 24) return "a weekly starter in 12-team leagues";
  if (rank <= 36) return "a flex play in 12-team leagues";
  return "depth in most leagues";
}

/**
 * Overview: fantasy value, start/sit, rank, rosterability, role, matchups,
 * consistency. Injury, bio facts, stat totals and single games belong to the
 * other tabs and are not asked here.
 */
export function overviewPool(data: PlayerPageData, options: PlayerRenderOptions): FaqCandidate[] {
  const c = ctx(data);
  const out: Array<FaqCandidate | null> = [];
  // As the header reads it: by points per game where that rank exists.
  const row = (data.production ?? []).find((r) => r.season === c.season);
  const rankPpg = row?.posFinishPpg ?? data.seasonRank ?? null;
  const rankTotal = row?.posFinishTotal ?? data.seasonRankTotal ?? null;
  // Per game once there is one; total points until then, as the header does.
  const rank = rankPpg ?? rankTotal;
  const rankBy = rankPpg ? "points per game" : "total points";
  const total = c.played.reduce((t, e) => t + c.pts(e), 0);
  const ppg = c.played.length ? total / c.played.length : 0;
  const startSit = `${options.startSitBase ?? STARTSIT_BASE}${encodeURIComponent(data.player.slug)}`;

  // 1. Start/sit this week (dynamic week, never hard-coded).
  const next = (data.upcomingStrip ?? data.upcoming ?? [])[0];
  if (next) {
    const opp = next.opponent?.nickname ?? next.opponentName;
    const where = next.homeAway === "away" ? `at the ${opp}` : `against the ${opp}`;
    let a = c.out
      ? `No: ${c.name} is ${/^ir$/i.test(c.status) ? "on injured reserve" : `listed as ${c.status.toLowerCase()}`} for Week ${next.week} ${where}, so he should sit.`
      : rank && c.played.length
        ? `${c.name} is ${leagueRead(c.pos, rank)} for Week ${next.week} ${where}, as the ${c.pos}${rank} in ${c.fmt} ${rankBy} this season (${one(ppg)} a game).`
        : `${c.name} plays Week ${next.week} ${where}.`;
    if (next.matchup && !c.out) {
      const band = matchupBand(next.matchup.rank);
      a += ` The ${opp} rank ${ordinal(next.matchup.rank)} in ${c.fmt} points allowed to ${c.pos}s, ${band === "soft" ? "a favorable matchup" : band === "mid" ? "a neutral matchup" : "a tough matchup"}.`;
    }
    out.push({
      key: "start",
      q: `Should I start ${c.name} in Week ${next.week}?`,
      a,
      link: { href: startSit, text: `Get the start/sit call for ${c.last}.`, cta: "startsit-overview-faq" },
    });
  }

  if (c.played.length) {
    // 2. Average.
    out.push({
      key: "ppg",
      q: `How many fantasy points is ${c.name} averaging in ${c.season}?`,
      a: `${c.name} is averaging ${one(ppg)} ${c.fmt} fantasy points per game in ${c.season}, ${one(total)} points across ${count(c.played.length, "game")}. ` +
        `His last game produced ${one(c.pts(c.played[c.played.length - 1]!))} points.`,
    });

    // 3. Rank.
    if (rank) {
      out.push({
        key: "rank",
        q: `Where does ${c.name} rank in fantasy football in ${c.season}?`,
        a: `${c.name} ranks ${c.pos}${rank} in ${c.fmt} ${rankBy} in ${c.season}` +
          (rankPpg && rankTotal ? ` and ${c.pos}${rankTotal} in total points` : "") +
          `, through ${count(c.played.length, "game")}. That makes him ${leagueRead(c.pos, rank)}.`,
        link: { href: tabHref(data, options, "stats"), text: `View his complete season statistics.` },
      });
    }
  }

  // 4. Rosterability, league by league (the Outlook tab's calls).
  const fit = leagueFit(data);
  if (fit) {
    const rostered = data.rosterPct ? ` He is rostered in ${Math.round(data.rosterPct.owned)}% of leagues.` : "";
    out.push({
      key: "roster",
      q: `Is ${c.name} worth rostering in fantasy football?`,
      a: `${/weekly starter|streamer|flex|matchup|stash/i.test(fit) ? "Yes, in the right league" : "Mostly not"}: ${c.name} is ${fit}.${rostered}`,
    });
  }

  // 5. Role.
  const depth = data.depth;
  if (depth && c.played.length) {
    const gp = c.played.length;
    const usage =
      c.pos === "QB"
        ? `${one(sum(c.played, "pass_att") / gp)} pass attempts and ${one(sum(c.played, "rush_att") / gp)} carries a game`
        : c.pos === "RB"
          ? `${one(sum(c.played, "rush_att") / gp)} carries and ${one(sum(c.played, "rec_tgt") / gp)} targets a game`
          : `${one(sum(c.played, "rec_tgt") / gp)} targets a game`;
    const snaps = sum(c.played, "off_snp"), team = sum(c.played, "tm_off_snp");
    const share = snaps && team && c.pos !== "QB" ? `, on ${Math.round((snaps / team) * 100)}% of the offensive snaps` : "";
    out.push({
      key: "role",
      q: `What is ${c.name}'s fantasy football role?`,
      a: `${c.name} is ${depth.order === 1 ? `the ${possessive(data.team?.nickname ?? "team")} starting ${depth.position}` : `${depth.position}${depth.order} on the ${data.team?.nickname ?? "team"} depth chart`}` +
        `${depth.next && depth.order === 1 ? `, with ${depth.next.name} behind him` : ""}. ` +
        `He is averaging ${usage}${share} in ${c.season}.`,
    });
  }

  // 6. Upcoming matchups.
  const strip = (data.upcomingStrip ?? []).filter((g) => g.matchup).slice(0, 3);
  if (strip.length >= 2) {
    const parts = strip.map((g) => {
      const opp = g.opponent?.nickname ?? g.opponentName;
      const band = matchupBand(g.matchup!.rank);
      return `Week ${g.week} ${g.homeAway === "away" ? "at" : "vs."} the ${opp} (${ordinal(g.matchup!.rank)} in ${c.fmt} points allowed to ${c.pos}s, ${band === "soft" ? "favorable" : band === "mid" ? "neutral" : "tough"})`;
    });
    const soft = strip.filter((g) => matchupBand(g.matchup!.rank) === "soft").length;
    out.push({
      key: "matchups",
      q: `What are ${c.name}'s upcoming fantasy football matchups?`,
      a: `${c.name}'s next ${word(strip.length)} games are ${listWords(parts)}. ${cap(word(soft))} of them ${soft === 1 ? "is" : "are"} favorable by points allowed to the position.`,
    });
  }

  // 7. Consistency, and 8. floor and ceiling (two games or more).
  const st = data.stats;
  if (st && c.played.length >= 2) {
    const top = st.pos1Games;
    const bust = st.bustGames;
    out.push({
      key: "consistency",
      q: `How consistent has ${c.name} been in fantasy football this season?`,
      a: `${c.name} has finished as a top-12 ${c.pos} in ${top} of his ${count(c.played.length, "game")} this season` +
        (bust ? ` and outside the top 36 in ${bust}` : "") +
        `. His weekly scoring has a standard deviation of ${one(st.volatility)} points around his ${one(ppg)}-point average.`,
    });
    const byPts = [...c.played].sort((x, y) => c.pts(x) - c.pts(y));
    const lo = byPts[0]!, hi = byPts[byPts.length - 1]!;
    out.push({
      key: "range",
      q: `What is ${c.name}'s fantasy floor and ceiling?`,
      a: `This season ${c.name}'s floor has been ${one(c.pts(lo))} ${c.fmt} points (Week ${lo.week}${lo.pos_rank ? `, ${c.pos}${lo.pos_rank}` : ""}) and his ceiling ${one(c.pts(hi))} (Week ${hi.week}${hi.pos_rank ? `, ${c.pos}${hi.pos_rank}` : ""}). ` +
        `His median week has been ${one(median(c.played.map(c.pts)))} points.`,
      link: { href: tabHref(data, options, "game-log"), text: `See ${c.last}'s full game log.` },
    });
  }

  return out.filter((x): x is FaqCandidate => x !== null);
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
/** "Cardinals'", "Jets'", but "Arizona's". */
const possessive = (s: string): string => (s.endsWith("s") ? `${s}'` : `${s}'s`);
function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/* ------------------------------------------------------------------ Stats */

/**
 * Stats: season and career totals, position-aware. One question per stat
 * (never a TD question and a "TDs" question); the answer carries the
 * variations. Single games are the Game Log's.
 */
export function statsPool(data: PlayerPageData, options: PlayerRenderOptions): FaqCandidate[] {
  const c = ctx(data);
  const out: FaqCandidate[] = [];
  const cur = data.statsProfile?.current ?? null;
  const has = cur && cur.gamesPlayed > 0 && data.season === c.season;
  const t = cur?.totals;
  const gp = cur?.gamesPlayed ?? 0;
  const per = (v: number, digits = 1) => (gp ? (v / gp).toFixed(digits) : "0");
  // The league's week, not his last game: an injured player's season is
  // still "through Week 3".
  const thru = (data.leagueWeek ?? 0) > 0 ? ` through Week ${data.leagueWeek}` : "";
  const gameLog = { href: tabHref(data, options, "game-log"), text: `See how those numbers break down week by week.` };
  /** " His high was 280 yards, in Week 3 at the 49ers." (two games or more) */
  const high = (key: string, unit: string): string => {
    if (c.played.length < 2) return "";
    const top = [...c.played].sort((x, y) => n((y.stats as unknown as Record<string, unknown>)[key]) - n((x.stats as unknown as Record<string, unknown>)[key]))[0]!;
    const v = n((top.stats as unknown as Record<string, unknown>)[key]);
    return v > 0 ? ` His high was ${v} ${unit}, in Week ${top.week} ${vs(c, top.week, top.opp)}.` : "";
  };

  if (has && t) {
    out.push({
      key: "fpts",
      q: `How many fantasy points does ${c.name} have in ${c.season}?`,
      a: `${c.name} has ${one(cur!.points)} ${c.fmt} fantasy points in ${c.season}${thru}, ${one(cur!.ppg)} per game across ${count(gp, "game")}.` +
        (data.seasonRankTotal ? ` That total ranks ${c.pos}${data.seasonRankTotal} at the position.` : ""),
      link: gameLog,
    });

    if (c.pos === "QB") {
      out.push({
        key: "passyd",
        q: `How many passing yards does ${c.name} have this season?`,
        a: `${c.name} has ${whole(t.passYd)} passing yards in ${c.season}${thru}, ${per(t.passYd, 0)} a game over ${count(gp, "game")}, on ${t.passCmp} of ${t.passAtt} completions.` + high("pass_yd", "yards"),
      });
      out.push({
        key: "passtd",
        q: `How many passing touchdowns does ${c.name} have this season?`,
        a: `${c.name} has thrown ${count(t.passTd, "touchdown pass", "touchdown passes")} in ${c.season}${thru}` +
          (t.rushTd ? ` and run for ${count(t.rushTd, "more touchdown", "more touchdowns")}, ${t.passTd + t.rushTd} total` : "") + `.`,
      });
      out.push({
        key: "int",
        q: `How many interceptions has ${c.name} thrown this season?`,
        a: `${c.name} has thrown ${count(t.passInt, "interception")} in ${c.season}${thru}, one every ${t.passInt ? Math.round(t.passAtt / t.passInt) : t.passAtt} attempts, against ${count(t.passTd, "touchdown pass", "touchdown passes")}.`,
      });
      if (t.passAtt) {
        out.push({
          key: "cmp",
          q: `What is ${c.name}'s completion percentage?`,
          a: `${c.name} is completing ${((t.passCmp / t.passAtt) * 100).toFixed(1)}% of his passes in ${c.season}, ${t.passCmp} of ${t.passAtt}, at ${(t.passYd / t.passAtt).toFixed(1)} yards per attempt.`,
        });
      }
      if (t.rushAtt) {
        out.push({
          key: "rushyd",
          q: `How many rushing yards does ${c.name} have this season?`,
          a: `${c.name} has ${whole(t.rushYd)} rushing yards on ${count(t.rushAtt, "carry", "carries")} in ${c.season}${thru}` +
            (t.rushTd ? `, with ${count(t.rushTd, "rushing touchdown")}` : "") + `.` + high("rush_yd", "yards"),
        });
      }
    } else if (c.pos === "RB") {
      out.push({
        key: "rushyd",
        q: `How many rushing yards does ${c.name} have this season?`,
        a: `${c.name} has ${whole(t.rushYd)} rushing yards in ${c.season}${thru}, ${per(t.rushYd, 0)} a game at ${t.rushAtt ? (t.rushYd / t.rushAtt).toFixed(1) : "0.0"} yards per carry.` + high("rush_yd", "yards"),
      });
      out.push({
        key: "td",
        q: `How many touchdowns does ${c.name} have this season?`,
        a: `${c.name} has ${count(t.rushTd + t.recTd, "touchdown")} in ${c.season}${thru}: ${t.rushTd} rushing and ${t.recTd} receiving.`,
      });
      out.push({
        key: "rushtd",
        q: `How many rushing touchdowns does ${c.name} have this season?`,
        a: `${c.name} has ${count(t.rushTd, "rushing touchdown")} in ${c.season}${thru}, on ${count(t.rushAtt, "carry", "carries")}.`,
      });
      out.push({
        key: "carries",
        q: `How many carries does ${c.name} have this season?`,
        a: `${c.name} has ${count(t.rushAtt, "carry", "carries")} in ${c.season}${thru}, ${per(t.rushAtt)} a game, for ${whole(t.rushYd)} yards.` + high("rush_att", "carries"),
      });
      out.push({
        key: "rec",
        q: `How many receptions does ${c.name} have this season?`,
        a: `${c.name} has ${count(t.rec, "reception")} for ${whole(t.recYd)} yards in ${c.season}${thru}, on ${count(t.tgt, "target")}.` + high("rec", "catches"),
      });
      out.push({
        key: "recyd",
        q: `How many receiving yards does ${c.name} have this season?`,
        a: `${c.name} has ${whole(t.recYd)} receiving yards in ${c.season}${thru}, ${per(t.recYd)} a game on ${count(t.rec, "catch", "catches")}.` + high("rec_yd", "yards"),
      });
      out.push({
        key: "tgt",
        q: `How many targets does ${c.name} have this season?`,
        a: `${c.name} has drawn ${count(t.tgt, "target")} in ${c.season}${thru}, ${per(t.tgt)} a game, and caught ${t.rec} of them.` + high("rec_tgt", "targets"),
      });
    } else {
      out.push({
        key: "recyd",
        q: `How many receiving yards does ${c.name} have this season?`,
        a: `${c.name} has ${whole(t.recYd)} receiving yards in ${c.season}${thru}, on ${count(t.rec, "catch", "catches")} and ${count(t.tgt, "target")}.` + high("rec_yd", "yards"),
      });
      out.push({
        key: "rec",
        q: `How many receptions does ${c.name} have this season?`,
        a: `${c.name} has ${count(t.rec, "reception")} in ${c.season}${thru}, ${per(t.rec)} a game, on ${count(t.tgt, "target")}.` + high("rec", "catches"),
      });
      out.push({
        key: "tgt",
        q: `How many targets does ${c.name} have this season?`,
        a: `${c.name} has drawn ${count(t.tgt, "target")} in ${c.season}${thru}, ${per(t.tgt)} a game, and caught ${t.tgt ? Math.round((t.rec / t.tgt) * 100) : 0}% of them.` + high("rec_tgt", "targets"),
      });
      out.push({
        key: "rectd",
        q: `How many receiving touchdowns does ${c.name} have this season?`,
        a: `${c.name} has ${count(t.recTd, "receiving touchdown")} in ${c.season}${thru}` +
          (t.rushTd ? `, plus ${count(t.rushTd, "rushing touchdown")}` : "") + `.`,
      });
      out.push({
        key: "recypg",
        q: `How many receiving yards per game is ${c.name} averaging?`,
        a: `${c.name} is averaging ${per(t.recYd)} receiving yards per game in ${c.season}, ${whole(t.recYd)} yards across ${count(gp, "game")}.`,
      });
      if (t.rec) {
        out.push({
          key: "ypr",
          q: `How many yards per reception is ${c.name} averaging?`,
          a: `${c.name} is averaging ${(t.recYd / t.rec).toFixed(1)} yards per reception in ${c.season}, ${whole(t.recYd)} yards on ${count(t.rec, "catch", "catches")}.`,
        });
      }
    }

    out.push({
      key: "games",
      q: `How many games has ${c.name} played in ${c.season}?`,
      a: `${c.name} has played ${count(gp, "game")} in the ${c.season} season${thru}` +
        (data.injury?.seasonMissed ? `, after missing ${count(data.injury.seasonMissed, "game")} to injury` : "") + `.`,
    });
  }

  // Last season, career.
  const prev = data.statsProfile?.career.find((r) => r.season === c.season - 1 && r.gamesPlayed > 0);
  if (prev) {
    const p = prev.totals;
    const body =
      c.pos === "QB"
        ? `completed ${p.passCmp} of ${p.passAtt} passes for ${whole(p.passYd)} yards, ${count(p.passTd, "touchdown")} and ${count(p.passInt, "interception")}, adding ${whole(p.rushYd)} rushing yards`
        : c.pos === "RB"
          ? `ran for ${whole(p.rushYd)} yards and ${count(p.rushTd, "touchdown")} and caught ${p.rec} passes for ${whole(p.recYd)} yards`
          : `caught ${p.rec} of ${count(p.tgt, "target")} for ${whole(p.recYd)} yards and ${count(p.recTd, "touchdown")}`;
    out.push({
      key: "last",
      q: `What were ${c.name}'s stats last season?`,
      a: `In ${prev.season}, ${c.name} ${body} in ${count(prev.gamesPlayed, "game")}. That was ${one(prev.points)} ${c.fmt} points (${one(prev.ppg)} per game)` +
        (prev.finish ? `, ${aPos(c.pos)} ${c.pos}${prev.finish} finish.` : "."),
    });
  }

  const tot = data.statsProfile?.totals;
  if (tot && tot.gamesPlayed > 0) {
    const k = tot.totals;
    const body =
      c.pos === "QB"
        ? `${whole(k.passYd)} passing yards, ${count(k.passTd, "touchdown pass", "touchdown passes")} and ${count(k.passInt, "interception")}, plus ${whole(k.rushYd)} rushing yards`
        : c.pos === "RB"
          ? `${whole(k.rushYd)} rushing yards and ${k.rushTd} rushing touchdowns, plus ${k.rec} catches for ${whole(k.recYd)} yards`
          : `${k.rec} catches for ${whole(k.recYd)} yards and ${count(k.recTd, "touchdown")}`;
    out.push({
      key: "career",
      q: `What are ${c.name}'s career NFL stats?`,
      a: `Across ${count(tot.seasons, "season")} and ${count(tot.gamesPlayed, "game")}, ${c.name} has ${body}, for ${one(tot.points)} ${c.fmt} fantasy points (${one(tot.ppg)} per game).`,
    });
    const tds = k.passTd + k.rushTd + k.recTd;
    out.push({
      key: "careertd",
      q: `How many touchdowns does ${c.name} have in his career?`,
      a: c.pos === "QB"
        ? `${c.name} has thrown ${count(k.passTd, "touchdown pass", "touchdown passes")} and run for ${count(k.rushTd, "touchdown")} in his NFL career, ${tds} in all, over ${count(tot.gamesPlayed, "game")}.`
        : `${c.name} has ${count(k.rushTd + k.recTd, "touchdown")} in his NFL career: ${k.rushTd} rushing and ${k.recTd} receiving, over ${count(tot.gamesPlayed, "game")}.`,
    });
    if (c.pos === "QB") {
      out.push({
        key: "careerpass",
        q: `How many career passing yards does ${c.name} have?`,
        a: `${c.name} has ${whole(k.passYd)} career passing yards over ${count(tot.seasons, "season")}, on ${whole(k.passCmp)} completions in ${whole(k.passAtt)} attempts.`,
      });
    } else if (c.pos !== "RB") {
      out.push({
        key: "careerrec",
        q: `How many career receiving yards does ${c.name} have?`,
        a: `${c.name} has ${whole(k.recYd)} career receiving yards over ${count(tot.seasons, "season")}, on ${whole(k.rec)} catches.`,
      });
    }
  }
  return out;
}

/* --------------------------------------------------------------- Game Log */

/**
 * Game Log: the last game, a named week, best and worst games. Season totals
 * are the Stats tab's; this tab answers "last game", "Week N" and "today".
 */
export function gameLogPool(data: PlayerPageData, options: PlayerRenderOptions): FaqCandidate[] {
  const c = ctx(data);
  const out: FaqCandidate[] = [];
  const p = c.played;
  if (p.length === 0) return out;
  const last = p[p.length - 1]!;
  const s = last.stats;
  const opp = vs(c, last.week, last.opp);
  const statsLink = { href: tabHref(data, options, "stats"), text: `View his ${c.season} season totals.` };
  const avg = p.reduce((t, e) => t + c.pts(e), 0) / p.length;

  out.push({
    key: "last",
    q: `How did ${c.name} do in his last game?`,
    a: `${c.name} scored ${one(c.pts(last))} ${c.fmt} points in Week ${last.week} ${opp}, ${result(c, last)}${finishOf(c, last)}. He ${line(c, last)}.`,
    link: statsLink,
  });

  const diff = c.pts(last) - avg;
  out.push({
    key: "lastpts",
    q: `How many fantasy points did ${c.name} score in his last game?`,
    a: `${c.name} scored ${one(c.pts(last))} ${c.fmt} fantasy points in his last game, Week ${last.week} ${opp}${finishOf(c, last)} for the week.` +
      (p.length > 1 ? ` That was ${Math.abs(diff) < 0.5 ? "right at" : `${one(Math.abs(diff))} ${diff > 0 ? "above" : "below"}`} his season average of ${one(avg)}.` : ""),
  });

  if (c.pos === "QB") {
    out.push({
      key: "lastyd",
      q: `How many passing yards did ${c.name} have in his last game?`,
      a: `${c.name} threw for ${n(s.pass_yd)} yards in Week ${last.week} ${opp}, completing ${n(s.pass_cmp)} of ${n(s.pass_att)} passes` +
        (n(s.rush_yd) ? `, and added ${n(s.rush_yd)} rushing yards` : "") + `.`,
    });
    out.push({
      key: "lasttd",
      q: `How many touchdowns did ${c.name} throw in his last game?`,
      a: `${c.name} threw ${count(n(s.pass_td), "touchdown pass", "touchdown passes")} in Week ${last.week} ${opp}` +
        (n(s.pass_int) ? ` with ${count(n(s.pass_int), "interception")}` : " without an interception") +
        (n(s.rush_td) ? `, and ran for ${count(n(s.rush_td), "more touchdown", "more touchdowns")}` : "") + `.`,
    });
  } else {
    const yd = c.pos === "RB" ? "rushing" : "receiving";
    out.push({
      key: "lastyd",
      q: `How many ${yd} yards did ${c.name} have in his last game?`,
      a: c.pos === "RB"
        ? `${c.name} ran for ${n(s.rush_yd)} yards on ${count(n(s.rush_att), "carry", "carries")} in Week ${last.week} ${opp}` + (n(s.rec_yd) ? `, and added ${n(s.rec_yd)} receiving yards` : "") + `.`
        : `${c.name} had ${n(s.rec_yd)} receiving yards on ${count(n(s.rec), "catch", "catches")} in Week ${last.week} ${opp}, from ${count(n(s.rec_tgt), "target")}.`,
    });
    const tds = n(s.rush_td) + n(s.rec_td);
    out.push({
      key: "lasttd",
      q: `How many touchdowns did ${c.name} score in his last game?`,
      a: tds
        ? `${c.name} scored ${count(tds, "touchdown")} in Week ${last.week} ${opp}: ${n(s.rush_td)} rushing and ${n(s.rec_td)} receiving.`
        : `${c.name} did not score a touchdown in Week ${last.week} ${opp}; his ${one(c.pts(last))} points came from yardage and catches.`,
    });
    if (c.pos === "RB") {
      out.push({
        key: "lastcar",
        q: `How many carries did ${c.name} have in his last game?`,
        a: `${c.name} had ${count(n(s.rush_att), "carry", "carries")} for ${n(s.rush_yd)} yards in Week ${last.week} ${opp}` +
          (n(s.off_snp) && n(s.tm_off_snp) ? `, playing ${Math.round((n(s.off_snp) / n(s.tm_off_snp)) * 100)}% of the offensive snaps` : "") + `.`,
      });
    }
    out.push({
      key: "lastrec",
      q: `How many receptions did ${c.name} have in his last game?`,
      a: `${c.name} caught ${n(s.rec)} of ${count(n(s.rec_tgt), "target")} for ${n(s.rec_yd)} yards in Week ${last.week} ${opp}.`,
    });
  }

  // The game before the last, by its week (dynamic, never hard-coded).
  const before = p[p.length - 2];
  if (before) {
    out.push({
      key: "week",
      q: `What were ${c.name}'s stats in Week ${before.week}?`,
      a: `In Week ${before.week} ${vs(c, before.week, before.opp)}, ${result(c, before)}, ${c.name} ${line(c, before)}. That was ${one(c.pts(before))} ${c.fmt} points${finishOf(c, before)}.`,
    });
  }

  if (p.length >= 2) {
    const sorted = [...p].sort((x, y) => c.pts(y) - c.pts(x) || x.week - y.week);
    const best = sorted[0]!, worst = sorted[sorted.length - 1]!;
    out.push({
      key: "best",
      q: `What was ${c.name}'s best game this season?`,
      a: `${c.name}'s best ${c.season} game was Week ${best.week} ${vs(c, best.week, best.opp)}: ${one(c.pts(best))} ${c.fmt} points${finishOf(c, best)}. He ${line(c, best)}.`,
    });
    out.push({
      key: "worst",
      q: `What was ${c.name}'s worst game this season?`,
      a: `${c.name}'s lowest-scoring ${c.season} game was Week ${worst.week} ${vs(c, worst.week, worst.opp)}: ${one(c.pts(worst))} ${c.fmt} points${finishOf(c, worst)}. He ${line(c, worst)}.`,
    });
  }

  const scored = p.filter((e) => (c.pos === "QB" ? n(e.stats.pass_td) + n(e.stats.rush_td) : n(e.stats.rush_td) + n(e.stats.rec_td)) > 0);
  out.push(
    c.pos === "QB"
      ? {
          key: "tdgames",
          q: `In how many games has ${c.name} thrown a touchdown pass this season?`,
          a: `${c.name} has thrown a touchdown pass in ${p.filter((e) => n(e.stats.pass_td) > 0).length} of his ${count(p.length, "game")} this season, and scored a touchdown of any kind in ${scored.length}.`,
        }
      : {
          key: "tdgames",
          q: `How many games has ${c.name} scored a touchdown in this season?`,
          a: `${c.name} has scored a touchdown in ${scored.length} of his ${count(p.length, "game")} this season` +
            (scored.length ? `, most recently in Week ${scored[scored.length - 1]!.week}.` : "."),
        },
  );

  // Earlier seasons live under the same URL's season selector.
  const seasons = (data.logCareer ?? []).map((l) => l.season).filter((y) => y < c.season).sort((a, b) => b - a);
  if (seasons.length) {
    out.push({
      key: "archive",
      q: `Can I see ${c.name}'s game logs from previous seasons?`,
      a: seasons.length === 1
        ? `Yes. The season selector above the game log switches it to ${c.last}'s weekly results from ${seasons[0]}.`
        : `Yes. The season selector above the game log switches it to ${c.last}'s weekly results from any season from ${Math.min(...seasons)} through ${Math.max(...seasons)}.`,
    });
  }
  return out;
}
