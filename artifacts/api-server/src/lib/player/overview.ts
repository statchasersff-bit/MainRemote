/**
 * The Overview tab's lower sections, to mak's spec of 2026-09-29.
 *
 * Sections under what the tab already had: the season strip, the read and its
 * sidebar, the efficiency meters, a game log summary, a career summary, the
 * outlook and availability cards, a FAQ and a footer. (The spec's nearby-peers
 * section was removed at mak's request; the profile's own peers rail stays.) Each is
 * a <section aria-labelledby> with its own H2 and a one-line lede, and each is
 * left out whole when its data is not there, never rendered empty.
 *
 * Its own module, like ./header.ts, so tests/player-overview.test.mjs can
 * render it against hand-built states without the database. It reads the
 * header's tokens and face (player.css, "overview" block).
 *
 * Everything is derived. The spec allows for analyst-written paragraphs in the
 * read; there are none, so the read is always the template version. The
 * spec's byline and footer were removed at mak's request.
 */

import { escapeHtml } from "../render";
import { titleCase } from "./title-case";
import { easternParts } from "../news-card";
import type { PlayerRenderOptions } from "../player-render";
import { getTeamByAbbreviation, type NflTeam } from "../team/teams";
import type { CareerStatRow } from "./stats-profile";
import type { PlayerPageData } from "./player-data";
import { getEntryPoints, SCORING_LABELS, SCORING_SHORT } from "./scoring";
import type { GameLogEntry } from "./types";
import type { UpcomingGame } from "./upcoming";
import {
  designationSeverity,
  lastName,
  matchupBand,
  STARTSIT_BASE,
  teamInk,
} from "./header";

const DASH = "—";

/**
 * A pause between a strip cell's parts, for the ear only: read aloud a cell is
 * "Week 1, Win, at LAC, 16.5, QB15", not one run-on word.
 */
const SEP = `<span class="scp-sr">, </span>`;
const REDRAFT_COMMAND_URL = "https://statchasers.com/redraft-command/";

/* ------------------------------------------------------------------ atoms */

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

const one = (v: number): string => v.toFixed(1);
const whole = (v: number): string => Math.round(v).toLocaleString("en-US");

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven"];
const word = (n: number): string => WORDS[n] ?? String(n);

function sectionOpen(id: string, heading: string, lede: string): string {
  return (
    `<section class="scp-ox-sec" aria-labelledby="${id}">` +
    `<h2 class="scp-ox-h2" id="${id}">${escapeHtml(titleCase(heading))}</h2>` +
    (lede ? `<p class="scp-ox-lede">${lede}</p>` : "")
  );
}

/** A link inside running text: the club colour, underlined. */
function a(href: string, text: string, attrs = ""): string {
  return `<a href="${escapeHtml(href)}"${attrs}>${escapeHtml(text)}</a>`;
}

/* ------------------------------------------------------ position rules */

/** Weekly finish bands: [good up to, mid up to]. RB/WR run twice as deep. */
function finishBands(pos: string): [number, number] {
  return pos === "RB" || pos === "WR" ? [24, 36] : [12, 24];
}

function finishClass(pos: string, rank: number): "good" | "mid" | "bad" {
  const [good, mid] = finishBands(pos);
  return rank <= good ? "good" : rank <= mid ? "mid" : "bad";
}

/** "Starter" weeks: top-12 at QB and TE, top-24 at RB and WR. */
const topN = (pos: string): number => finishBands(pos)[0];

/** What a season rank means for a lineup, by league type. */
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
  if (rank <= 12) return `a ${pos}1-level starter in 12-team leagues`;
  if (rank <= 24) return "a weekly starter in 12-team leagues";
  if (rank <= 36) return "a flex option in 12-team leagues";
  return "a bench stash in most leagues";
}

/* --------------------------------------------------------- the season */

interface WeekCell {
  week: number;
  kind: "played" | "dnp" | "bye" | "future";
  homeAway: "home" | "away" | null;
  oppCode: string;
  opp: NflTeam | null;
  result: "W" | "L" | "T" | null;
  score: string | null;
  entry: GameLogEntry | null;
  pts: number | null;
  game: UpcomingGame | null;
}

interface Season {
  pos: string;
  leagueSeason: number;
  leagueWeek: number;
  /** The page's stats are this season's. False for a player who has not played in it. */
  current: boolean;
  played: GameLogEntry[];
  pts: (e: GameLogEntry) => number;
  timeline: WeekCell[];
}

function season(data: PlayerPageData): Season {
  const pos = data.player.position ?? "";
  const leagueSeason = data.leagueSeason ?? data.season;
  const leagueWeek = data.leagueWeek ?? 0;
  const current = data.season === leagueSeason && leagueWeek > 0;
  const pts = (e: GameLogEntry): number => getEntryPoints(e.stats, data.format);
  const log = current ? data.gameLog : [];
  const played = log.filter((e) => e.game_status === "active");
  const logByWeek = new Map(log.map((e) => [e.week, e]));

  const past: WeekCell[] = [];
  const schedule = data.schedule ?? [];
  if (schedule.length) {
    for (const game of schedule) {
      if (game.status !== "final") continue;
      const entry = logByWeek.get(game.week) ?? null;
      const active = entry?.game_status === "active";
      past.push({
        week: game.week,
        kind: active ? "played" : "dnp",
        homeAway: game.homeAway,
        oppCode: game.opponent?.code ?? game.opponentName,
        opp: game.opponent,
        result: game.result?.outcome ?? null,
        score: game.result ? `${game.result.teamScore}–${game.result.opponentScore}` : null,
        entry: active ? entry : null,
        pts: active && entry ? pts(entry) : null,
        game: null,
      });
    }
  } else {
    // No schedule: the log alone, with no home or away marker rather than a
    // guessed one.
    for (const e of log) {
      if (e.game_status === "bye") continue;
      const opp = getTeamByAbbreviation(e.opp);
      past.push({
        week: e.week,
        kind: e.game_status === "active" ? "played" : "dnp",
        homeAway: null,
        oppCode: opp?.code ?? e.opp,
        opp,
        result: (e.score?.r as "W" | "L" | "T" | undefined) ?? null,
        score: e.score ? `${e.score.tm}–${e.score.opp}` : null,
        entry: e.game_status === "active" ? e : null,
        pts: e.game_status === "active" ? pts(e) : null,
        game: null,
      });
    }
  }

  const future: WeekCell[] = (data.upcomingStrip ?? data.upcoming).map((game) => ({
    week: game.week,
    kind: "future" as const,
    homeAway: game.homeAway,
    oppCode: game.opponentCode,
    opp: game.opponent,
    result: null,
    score: null,
    entry: null,
    pts: null,
    game,
  }));

  const bye = data.byeWeek ?? null;
  const byeCell = (week: number): WeekCell => ({
    week, kind: "bye", homeAway: null, oppCode: "", opp: null,
    result: null, score: null, entry: null, pts: null, game: null,
  });
  if (bye !== null) {
    const lastFuture = future[future.length - 1]?.week ?? 0;
    if (past.some((c) => c.week < bye) && past.every((c) => c.week !== bye) && bye < (future[0]?.week ?? 99)) {
      past.push(byeCell(bye));
    } else if (future.length && bye > (future[0]?.week ?? 0) && bye < lastFuture) {
      future.push(byeCell(bye));
    } else if (!past.length && future.length && bye < (future[0]?.week ?? 0)) {
      future.push(byeCell(bye));
    }
  }
  past.sort((x, y) => x.week - y.week);
  future.sort((x, y) => x.week - y.week);

  // Seven cells: up to three played, the rest upcoming — more of either when
  // the other runs short.
  const pastN = Math.min(past.length, Math.max(3, 7 - future.length));
  const futureN = Math.min(future.length, 7 - pastN);
  const timeline = [...past.slice(past.length - pastN), ...future.slice(0, futureN)];

  return { pos, leagueSeason, leagueWeek, current, played, pts, timeline };
}

/** "at LAC" read aloud, "@ LAC" on screen. */
function oppMark(cell: { homeAway: "home" | "away" | null; oppCode: string }): string {
  const code = escapeHtml(cell.oppCode);
  if (cell.homeAway === "away") return `<span aria-hidden="true">@</span><span class="scp-sr">at</span> ${code}`;
  if (cell.homeAway === "home") return `vs ${code}`;
  return code;
}

const RESULT_WORD = { W: "Win", L: "Loss", T: "Tie" } as const;

function opponentName(team: NflTeam | null, code: string): string {
  return team?.nickname ?? code;
}

/** "at the Chargers" or "against the Seahawks". */
function againstPhrase(cell: WeekCell): string {
  const name = opponentName(cell.opp, cell.oppCode);
  return cell.homeAway === "away" ? `at the ${name}` : `against the ${name}`;
}

function isOut(data: PlayerPageData): boolean {
  const status = data.designation?.injuryStatus ?? data.player.injury_status ?? "";
  return status.trim() !== "" && designationSeverity(status) === "out";
}

/* ------------------------------------------------ section 1: the strip */

function renderStrip(data: PlayerPageData, s: Season, options: PlayerRenderOptions): string {
  const { timeline, pos } = s;
  if (timeline.length === 0) return "";
  const name = data.player.name;
  const fpa = `${options.fpaPath ?? "/fpa"}${options.linkQuery ?? ""}`;
  const maxPts = Math.max(0, ...timeline.map((c) => c.pts ?? 0));
  const bestWeek = timeline.find((c) => c.pts !== null && c.pts === maxPts && maxPts > 0)?.week ?? null;
  const nextWeek = timeline.find((c) => c.kind === "future")?.week ?? null;
  const out = isOut(data);

  const cells = timeline
    .map((c) => {
      const top = (right: string): string =>
        `<div class="scp-ox-wk-top"><span>Week ${c.week}</span>${right ? `${SEP}<span>${right}</span>` : "<span></span>"}</div>${SEP}`;
      if (c.kind === "bye") {
        return (
          `<li class="scp-ox-wk is-bye">` + top("") +
          `<div class="scp-ox-wk-opp">Bye</div>${SEP}<div class="scp-ox-wk-bar"></div>` +
          `<div class="scp-ox-wk-fin is-muted">No game</div></li>`
        );
      }
      if (c.kind === "future" && c.game) {
        const m = c.game.matchup;
        const band = m ? matchupBand(m.rank) : null;
        const chip = band
          ? `<span class="scp-ox-chip is-${band === "soft" ? "good" : band === "mid" ? "mid" : "bad"}">` +
            `${band === "soft" ? "Favorable" : band === "mid" ? "Neutral" : "Tough"}</span>`
          : "";
        const when = c.game.kickoffMs !== null
          ? (() => { const p = easternParts(c.game!.kickoffMs!); return `${p.month} ${p.day}`; })()
          : "TBD";
        const isNext = c.week === nextWeek;
        return (
          `<li class="scp-ox-wk is-future${isNext ? " is-next" : ""}">` +
          (isNext ? `<span class="scp-sr">Up next. </span>` : "") +
          top(escapeHtml(when)) +
          `<div class="scp-ox-wk-opp">${oppMark(c)}</div>${SEP}` +
          `<div class="scp-ox-wk-bar">` +
          (m
            ? `<div class="scp-ox-rank">${ordinal(m.rank)}<small><span class="scp-sr"> </span>pts allowed to ${escapeHtml(pos)}s</small></div>${SEP}`
            : "") +
          `</div>` +
          `<div class="scp-ox-wk-chips">${chip}` +
          (isNext && out ? `${SEP}<span class="scp-ox-chip is-bad">Out</span>` : "") +
          `</div>` +
          (m && c.opp
            ? `<a class="scp-ox-wk-link" href="${escapeHtml(fpa)}">${escapeHtml(`${c.opp.nickname} vs. ${pos}s`)}</a>`
            : "") +
          `</li>`
        );
      }
      const result = c.result ? RESULT_WORD[c.result] : "";
      if (c.kind === "dnp" || c.pts === null) {
        return (
          `<li class="scp-ox-wk is-dnp">` + top(result) +
          `<div class="scp-ox-wk-opp">${oppMark(c)}</div>${SEP}<div class="scp-ox-wk-bar"></div>` +
          `<div class="scp-ox-wk-pts">${DASH}</div>${SEP}` +
          `<div class="scp-ox-wk-fin is-muted">Did not play</div></li>`
        );
      }
      const height = Math.max(4, maxPts > 0 ? (c.pts / maxPts) * 100 : 4);
      const rank = c.entry?.pos_rank ?? null;
      return (
        `<li class="scp-ox-wk">` + top(result) +
        `<div class="scp-ox-wk-opp">${oppMark(c)}</div>${SEP}` +
        `<div class="scp-ox-wk-bar"><i style="height:${height.toFixed(1)}%"` +
        (c.week === bestWeek ? ` class="is-best"` : "") + `></i></div>` +
        `<div class="scp-ox-wk-pts">${one(c.pts)}</div>${SEP}` +
        (rank
          ? `<div class="scp-ox-wk-fin is-${finishClass(pos, rank)}">${escapeHtml(pos)}${rank}</div>`
          : `<div class="scp-ox-wk-fin is-muted">${DASH}</div>`) +
        `</li>`
      );
    })
    .join("");

  /* ---- the lede ---- */

  const bust = finishBands(pos)[1] + 1;
  const ranks = s.played.map((e) => e.pos_rank).filter((r): r is number => typeof r === "number");
  const top5 = ranks.filter((r) => r <= 5).length;
  const busts = ranks.filter((r) => r >= bust).length;
  const middle = ranks.length - top5 - busts;
  const parts = [
    top5 && `${word(top5)} top-5 week${top5 > 1 ? "s" : ""}`,
    middle && `${word(middle)} mid-range start${middle > 1 ? "s" : ""}`,
    busts && `${word(busts)} bust${busts > 1 ? "s" : ""}`,
  ].filter(Boolean) as string[];
  const tiers = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] ?? "";
  const next4 = (data.upcomingStrip ?? data.upcoming).slice(0, 4).filter((g) => g.matchup);
  const soft = next4.filter((g) => matchupBand(g.matchup!.rank) === "soft").length;
  const defense = pos === "RB" ? "run" : "pass";
  let lede = "";
  if (s.played.length) lede += `${s.played.length} game${s.played.length > 1 ? "s" : ""} played: ${tiers}. `;
  if (next4.length) {
    lede += soft
      ? `The next ${word(next4.length)} matchups include ${word(soft)} of the league's softest ${defense} defenses.`
      : `The next ${word(next4.length)} matchups are a tough stretch ahead.`;
  }

  const through = data.upcomingMatchupMode ?? "";
  const note =
    `Matchup rank is ${escapeHtml(SCORING_SHORT[data.format])} points allowed to ${escapeHtml(pos)}s` +
    (/^Week/.test(through) ? ` through ${escapeHtml(through)}` : through ? ` (${escapeHtml(through.toLowerCase())})` : "") +
    `. 1st allows the most, 32nd the fewest.`;

  return (
    sectionOpen("scp-ox-strip-h", `${name}'s ${s.leagueSeason} season, week by week`, escapeHtml(lede.trim())) +
    `<ol class="scp-ox-strip" role="list">${cells.replaceAll("<li ", '<li role="listitem" ')}</ol>` +
    (timeline.some((c) => c.kind === "future") ? `<p class="scp-ox-note">${note}</p>` : "") +
    `</section>`
  );
}

/* --------------------------------------------- section 2: the read */

interface Line {
  att: number; cmp: number; passYd: number; passTd: number; int: number;
  rushAtt: number; rushYd: number; rushTd: number;
  tgt: number; rec: number; recYd: number; recTd: number;
}

function sumLine(entries: GameLogEntry[]): Line {
  const t: Line = { att: 0, cmp: 0, passYd: 0, passTd: 0, int: 0, rushAtt: 0, rushYd: 0, rushTd: 0, tgt: 0, rec: 0, recYd: 0, recTd: 0 };
  const v = (x: number | null | undefined): number => (typeof x === "number" ? x : 0);
  for (const e of entries) {
    const st = e.stats;
    t.att += v(st.pass_att); t.cmp += v(st.pass_cmp); t.passYd += v(st.pass_yd);
    t.passTd += v(st.pass_td); t.int += v(st.pass_int);
    t.rushAtt += v(st.rush_att); t.rushYd += v(st.rush_yd); t.rushTd += v(st.rush_td);
    t.tgt += v(st.rec_tgt); t.rec += v(st.rec); t.recYd += v(st.rec_yd); t.recTd += v(st.rec_td);
  }
  return t;
}

function statLine(pos: string, t: Line): string {
  if (pos === "QB") {
    const rush = t.rushYd > 0 ? `, plus ${whole(t.rushYd)} rushing yards` : "";
    return `${whole(t.passYd)} passing yards, ${t.passTd} TD and ${t.int} INT${rush}`;
  }
  if (pos === "RB") {
    return `${whole(t.rushYd)} rushing yards and ${t.rushTd} TD on ${t.rushAtt} carries, plus ${t.rec} catches for ${whole(t.recYd)} yards`;
  }
  return `${t.rec} catches for ${whole(t.recYd)} yards and ${t.recTd} TD on ${t.tgt} targets`;
}

/** The efficiency sentence without percentiles, for a player below the threshold. */
function rateLine(pos: string, t: Line): string {
  if (pos === "QB" && t.att > 0) {
    return `He is completing ${one((t.cmp / t.att) * 100)}% of his passes at ${one(t.passYd / t.att)} yards per attempt.`;
  }
  if (pos === "RB" && t.rushAtt > 0) return `He is averaging ${one(t.rushYd / t.rushAtt)} yards per carry.`;
  if (t.tgt > 0) return `He has caught ${one((t.rec / t.tgt) * 100)}% of his targets at ${one(t.recYd / t.tgt)} yards per target.`;
  return "";
}

function playerLink(slug: string | null, name: string, options: PlayerRenderOptions): string {
  if (!slug) return escapeHtml(name);
  return a(`${options.playerPathPrefix ?? "/player/"}${slug}/${options.linkQuery ?? ""}`, name);
}

function seasonRank(data: PlayerPageData): number | null {
  const row = data.production.find((r) => r.season === data.season);
  return row?.posFinishPpg ?? data.seasonRank ?? row?.posFinishTotal ?? data.seasonRankTotal ?? null;
}

function renderRead(data: PlayerPageData, s: Season, options: PlayerRenderOptions): string {
  const { pos, played } = s;
  const name = data.player.name;
  const last = lastName(name);
  const slug = data.player.slug;
  const redraft = `${REDRAFT_COMMAND_URL}?player=${encodeURIComponent(slug)}`;
  const paragraphs: string[] = [];

  if (played.length === 0) {
    // Preseason, or no games yet: the outlook is the read.
    const outlook = data.fantasyOutlook2026;
    const text = outlook?.quickTake ?? outlook?.body ?? "";
    if (!text) return "";
    for (const para of text.split(/\n{2,}/).slice(0, 3)) paragraphs.push(escapeHtml(para.trim()));
  } else {
    const line = sumLine(played);
    const total = played.reduce((sum, e) => sum + s.pts(e), 0);
    const rank = seasonRank(data);
    const label = SCORING_SHORT[data.format];

    // 1. Headline production.
    paragraphs.push(
      escapeHtml(
        `${last} is averaging ${one(total / played.length)} ${label} points per game through ` +
          `${played.length} game${played.length > 1 ? "s" : ""}, with ${statLine(pos, line)}.` +
          (rank ? ` That ranks ${pos}${rank}, which makes him ${leagueRead(pos, rank)}.` : ""),
      ),
    );

    // 2. What's behind it.
    const meters = data.meters?.meters ?? null;
    let why = "";
    if (meters && meters.length >= 2) {
      const sorted = [...meters].sort((x, y) => y.percentile - x.percentile);
      const best = sorted[0]!;
      const worst = sorted[sorted.length - 1]!;
      why =
        escapeHtml(
          `His ${best.label.toLowerCase()} (${best.value}) is in the ${ordinal(best.percentile)} percentile ` +
            `among ${pos}s, the best of his efficiency marks; his ${worst.label.toLowerCase()} ` +
            `(${worst.value}) is the weakest, in the ${ordinal(worst.percentile)}.`,
        );
    } else {
      why = escapeHtml(rateLine(pos, line));
    }
    const mates = data.teammates ?? [];
    if (mates.length) {
      const names = mates.map((m) => playerLink(m.slug, m.name, options)).join(" and ");
      why +=
        pos === "QB"
          ? ` His most-targeted receiver${mates.length > 1 ? "s have" : " has"} been ${names}.`
          : ` His quarterback has been ${names}.`;
    }
    if (why.trim()) paragraphs.push(why.trim());

    // 3. Weekly range and schedule.
    const cells = s.timeline.filter((c) => c.kind === "played" && c.entry?.pos_rank);
    const all = playedCells(data, s);
    let range = "";
    if (all.length >= 2) {
      const byRank = [...all].sort((x, y) => (x.entry!.pos_rank ?? 99) - (y.entry!.pos_rank ?? 99));
      const hi = byRank[0]!;
      const lo = byRank[byRank.length - 1]!;
      range =
        `His best week was ${pos}${hi.entry!.pos_rank} in Week ${hi.week} ${againstPhrase(hi)} ` +
        `(${one(hi.pts!)} points); his worst, ${pos}${lo.entry!.pos_rank} in Week ${lo.week} ` +
        `${againstPhrase(lo)} (${one(lo.pts!)}).`;
    } else if (cells.length === 1) {
      const only = cells[0]!;
      range = `His one game so far was a ${pos}${only.entry!.pos_rank} finish ${againstPhrase(only)}.`;
    }
    const upcoming = (data.upcomingStrip ?? data.upcoming).filter((g) => g.matchup);
    const soft = upcoming.filter((g) => matchupBand(g.matchup!.rank) === "soft").slice(0, 2);
    const name2 = (g: UpcomingGame): string =>
      `the ${g.opponent?.nickname ?? g.opponentName} (${ordinal(g.matchup!.rank)} vs. ${pos}s) in Week ${g.week}`;
    let ahead = "";
    if (soft.length === 2) ahead = ` Two favorable matchups are coming: ${name2(soft[0]!)} and ${name2(soft[1]!)}.`;
    else if (soft.length === 1) ahead = ` One favorable matchup is ahead: ${name2(soft[0]!)}.`;
    else if (upcoming.length) {
      ahead = ` None of his next ${word(Math.min(upcoming.length, 7))} opponents ranks in the top 10 in points allowed to ${pos}s.`;
    }
    if ((range + ahead).trim()) paragraphs.push(escapeHtml((range + ahead).trim()));

    // 4. The season-long call.
    paragraphs.push(
      escapeHtml("For the season-long call, whether to hold, trade or start him, ") +
        a(redraft, `check where ${last} ranks among all ${pos}s in Redraft Command`, ` data-cta="redraft-command-prose"`) +
        ".",
    );
  }

  /* ---- the sidebar ---- */

  const rc =
    `<div class="scp-ox-panel is-rc">` +
    `<h3>Redraft Command</h3>` +
    `<p>${escapeHtml(`Rest-of-season rankings, trade values and waiver priorities for your league settings. ${last}'s value updates after every game.`)}</p>` +
    `<a class="scp-ox-btn" href="${escapeHtml(redraft)}" data-cta="redraft-command-sidebar">` +
    `${escapeHtml(`Open ${last} in Redraft Command`)}</a>` +
    `</div>`;

  const profile = renderProfile(data, s);

  return (
    sectionOpen("scp-ox-read-h", `Should you start or roster ${name}?`, "") +
    `<div class="scp-ox-read">` +
    `<div>` +
    `<div class="scp-ox-prose">${paragraphs.map((p) => `<p>${p}</p>`).join("")}</div>` +
    `</div>` +
    `<aside class="scp-ox-aside" aria-label="${escapeHtml(`${last} in Redraft Command and fantasy profile`)}">${rc}${profile}</aside>` +
    `</div></section>`
  );
}

/** Every played week this season, with its cell data, not only the seven on the strip. */
function playedCells(data: PlayerPageData, s: Season): WeekCell[] {
  const bySchedule = new Map((data.schedule ?? []).map((g) => [g.week, g]));
  return s.played
    .filter((e) => typeof e.pos_rank === "number")
    .map((e) => {
      const game = bySchedule.get(e.week);
      const opp = game?.opponent ?? getTeamByAbbreviation(e.opp);
      return {
        week: e.week, kind: "played" as const, homeAway: game?.homeAway ?? null,
        oppCode: opp?.code ?? e.opp, opp, result: game?.result?.outcome ?? null,
        score: null, entry: e, pts: s.pts(e), game: null,
      };
    });
}

function renderProfile(data: PlayerPageData, s: Season): string {
  const { pos } = s;
  // This season's weeks, or last season's before he has played one.
  const entries = s.played.length ? s.played : data.gameLog.filter((e) => e.game_status === "active");
  const label = s.played.length ? "" : ` (${data.season})`;
  const ranks = entries.map((e) => e.pos_rank).filter((r): r is number => typeof r === "number").sort((x, y) => x - y);
  const rows: Array<[string, string]> = [];

  const depth = data.depth;
  if (depth) {
    rows.push(["Role", `${depth.order === 1 ? "Starter" : "Backup"}, ${depth.position}${depth.order} on depth chart`]);
  }
  if (ranks.length) {
    const median = ranks[Math.floor((ranks.length - 1) / 2)]!;
    rows.push([`Weekly floor${label}`, `${pos}${ranks[ranks.length - 1]}`]);
    rows.push([`Typical week${label}`, `${pos}${median}`]);
    rows.push([`Ceiling${label}`, `${pos}${ranks[0]}`]);
    const n = topN(pos);
    rows.push([`Top-${n} weeks${label}`, `${ranks.filter((r) => r <= n).length} of ${ranks.length}`]);
  }
  if (data.tdDependency && data.tdDependency.pct > 0) {
    rows.push(["Points from TDs", `${Math.round(data.tdDependency.pct)}%`]);
  }
  if (rows.length === 0) return "";
  return (
    `<div class="scp-ox-panel"><h3>Fantasy profile</h3><dl class="scp-ox-profile">` +
    rows.map(([dt, dd]) => `<dt>${escapeHtml(dt)}</dt><dd>${escapeHtml(dd)}</dd>`).join("") +
    `</dl></div>`
  );
}

/* -------------------------------------------- section 3: the meters */

function renderMeters(data: PlayerPageData, s: Season): string {
  const m = data.meters;
  if (!m?.meters || s.played.length === 0) return "";
  const cards = m.meters
    .map((meter) => {
      const p = meter.percentile;
      const tone = p >= 70 ? "good" : p >= 20 ? "mid" : "bad";
      const words = p >= 70 ? "above average" : p >= 40 ? "about average" : p >= 20 ? "below average" : "near the bottom";
      return (
        `<div class="scp-ox-meter">` +
        `<div class="scp-ox-meter-row"><h3>${escapeHtml(meter.label)}</h3>` +
        `<span class="scp-ox-meter-val">${escapeHtml(meter.value)}</span></div>` +
        `<div class="scp-ox-track"><i class="is-${tone}" style="width:${Math.max(2, p)}%"></i></div>` +
        `<p class="scp-ox-meter-pct">${escapeHtml(`${ordinal(p)} percentile, ${words}`)}</p>` +
        `</div>`
      );
    })
    .join("");
  const lede = `Percentile vs. every ${m.position} with at least ${m.threshold} ${m.unit} in ${m.season}. The line marks the league median.`;
  return (
    sectionOpen("scp-ox-meters-h", "What's driving his production", escapeHtml(lede)) +
    `<div class="scp-ox-meters">${cards}</div></section>`
  );
}

/* ------------------------------------------- section 4: the game log */

function renderLog(data: PlayerPageData, s: Season, options: PlayerRenderOptions): string {
  if (!s.current || s.played.length === 0) return "";
  const { pos } = s;
  const teamPrefix = options.teamPathPrefix ?? "/team/";
  const query = options.linkQuery ?? "";
  const bySchedule = new Map((data.schedule ?? []).map((g) => [g.week, g]));
  let w = 0, l = 0, t = 0, total = 0;

  const rows = s.played
    .map((e) => {
      const game = bySchedule.get(e.week);
      const opp = game?.opponent ?? getTeamByAbbreviation(e.opp);
      const mark = game?.homeAway === "away" ? "@ " : game?.homeAway === "home" ? "vs " : "";
      const oppCell = opp
        ? `${mark}${a(`${teamPrefix}${opp.slug}/${query}`, opp.nickname, ` target="_top"`)}`
        : escapeHtml(`${mark}${e.opp}`);
      const r = game?.result?.outcome ?? (e.score?.r as "W" | "L" | "T" | undefined) ?? null;
      if (r === "W") w += 1; else if (r === "L") l += 1; else if (r === "T") t += 1;
      const sc = game?.result
        ? ` ${game.result.teamScore}–${game.result.opponentScore}`
        : e.score ? ` ${e.score.tm}–${e.score.opp}` : "";
      const p = s.pts(e);
      total += p;
      return (
        `<tr><th scope="row">${e.week}</th><td>${oppCell}</td>` +
        `<td>${r ? escapeHtml(r + sc) : DASH}</td><td>${one(p)}</td>` +
        `<td>${e.pos_rank ? escapeHtml(`${pos}${e.pos_rank}`) : DASH}</td></tr>`
      );
    })
    .join("");

  const rank = seasonRank(data);
  const record = `${w}–${l}${t ? `–${t}` : ""}`;
  const splits = pos === "QB" ? "passing and rushing" : pos === "RB" ? "rushing and receiving" : "receiving";
  const href = `${options.playerPathPrefix ?? "/player/"}${data.player.slug}/game-log/${query}`;

  return (
    sectionOpen("scp-ox-log-h", `${data.player.name} ${data.season} game log`, "") +
    `<div class="scp-ox-tbl"><table class="scp-ox-table">` +
    `<caption>${escapeHtml(`${SCORING_LABELS[data.format]} scoring. Finish is weekly rank among ${pos}s.`)}</caption>` +
    `<thead><tr><th scope="col">Week</th><th scope="col">Opponent</th><th scope="col">Result</th>` +
    `<th scope="col">Fantasy pts</th><th scope="col">Finish</th></tr></thead>` +
    `<tbody>${rows}<tr class="is-tot"><th scope="row">Total</th><td></td><td>${escapeHtml(record)}</td>` +
    `<td>${one(total)}</td><td>${rank ? escapeHtml(`${pos}${rank}`) : DASH}</td></tr></tbody>` +
    `</table></div>` +
    `<a class="scp-ox-more" href="${escapeHtml(href)}">${escapeHtml(`Full game log with ${splits} splits`)}</a>` +
    `</section>`
  );
}

/* ------------------------------------------- section 5: the career */

interface CareerCol {
  label: string;
  of: (row: CareerStatRow) => number;
}

function careerCols(pos: string): CareerCol[] {
  if (pos === "QB") {
    return [
      { label: "Pass yds", of: (r) => r.totals.passYd },
      { label: "TD", of: (r) => r.totals.passTd },
      { label: "INT", of: (r) => r.totals.passInt },
      { label: "Rush yds", of: (r) => r.totals.rushYd },
    ];
  }
  if (pos === "RB") {
    return [
      { label: "Rush yds", of: (r) => r.totals.rushYd },
      { label: "Rush TD", of: (r) => r.totals.rushTd },
      { label: "Rec", of: (r) => r.totals.rec },
      { label: "Rec yds", of: (r) => r.totals.recYd },
      { label: "Rec TD", of: (r) => r.totals.recTd },
    ];
  }
  return [
    { label: "Tgt", of: (r) => r.totals.tgt },
    { label: "Rec", of: (r) => r.totals.rec },
    { label: "Rec yds", of: (r) => r.totals.recYd },
    { label: "Rec TD", of: (r) => r.totals.recTd },
  ];
}

function renderCareer(data: PlayerPageData, s: Season, options: PlayerRenderOptions): string {
  const { pos } = s;
  if (!["QB", "RB", "WR", "TE"].includes(pos)) return "";
  let rows = [...(data.statsProfile?.career ?? [])].sort((x, y) => y.season - x.season);
  if (rows.length === 0) return "";

  // The season in progress is summed from the same weeks the strip and the
  // game log print, so all three agree to the tenth.
  const inProgress = (r: CareerStatRow): boolean => r.season === s.leagueSeason && s.leagueWeek < 18;
  rows = rows.map((r) => {
    if (!(inProgress(r) && s.current && s.played.length)) return r;
    const points = s.played.reduce((sum, e) => sum + s.pts(e), 0);
    return { ...r, gamesPlayed: s.played.length, points, ppg: points / s.played.length };
  });

  const cols = careerCols(pos);
  const clubs = data.seasonClubs ?? {};
  const team = (season: number): string => (clubs[season] ?? []).join("/") || DASH;
  const shown = rows.slice(0, 5);

  const body = shown
    .map((r) => {
      const cur = inProgress(r);
      return (
        `<tr${cur ? ` class="is-cur"` : ""}><th scope="row">${r.season}</th><td>${escapeHtml(team(r.season))}</td>` +
        `<td>${r.gamesPlayed}</td>` +
        cols.map((c) => `<td>${whole(c.of(r))}</td>`).join("") +
        `<td>${one(r.points)}</td><td>${one(r.ppg)}</td>` +
        `<td>${!cur && r.finish ? escapeHtml(`${pos}${r.finish}`) : DASH}</td></tr>`
      );
    })
    .join("");

  // Summed from every season row, never a stored total.
  const gp = rows.reduce((sum, r) => sum + r.gamesPlayed, 0);
  const pts = rows.reduce((sum, r) => sum + r.points, 0);
  const career =
    `<tr class="is-tot"><th scope="row">Career</th><td></td><td>${gp}</td>` +
    cols.map((c) => `<td>${whole(rows.reduce((sum, r) => sum + c.of(r), 0))}</td>`).join("") +
    `<td>${one(pts)}</td><td>${gp ? one(pts / gp) : DASH}</td><td></td></tr>`;

  const href = `${options.playerPathPrefix ?? "/player/"}${data.player.slug}/stats/${options.linkQuery ?? ""}`;
  return (
    sectionOpen("scp-ox-career-h", "Career fantasy stats by season", "") +
    `<div class="scp-ox-tbl"><table class="scp-ox-table">` +
    `<thead><tr><th scope="col">Season</th><th scope="col">Team</th><th scope="col">GP</th>` +
    cols.map((c) => `<th scope="col">${escapeHtml(c.label)}</th>`).join("") +
    `<th scope="col">Fantasy pts</th><th scope="col">PPG</th><th scope="col">Finish</th></tr></thead>` +
    `<tbody>${body}${career}</tbody></table></div>` +
    `<a class="scp-ox-more" href="${escapeHtml(href)}">${escapeHtml(`All ${rows.length} seasons and advanced stats`)}</a>` +
    `</section>`
  );
}

/* ------------------------------------ section 6: outlook + availability */

function renderCards(data: PlayerPageData, options: PlayerRenderOptions): string {
  const prefix = `${options.playerPathPrefix ?? "/player/"}${data.player.slug}`;
  const query = options.linkQuery ?? "";
  const cards: string[] = [];

  /* ---- outlook ---- */
  const o = data.fantasyOutlook2026;
  if (o) {
    const bits: string[] = [];
    // The written take, or the forward-looking end of the body: its last
    // paragraph is the one about the season ahead, not the one behind.
    const paras = (o.body ?? "").split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
    const tail = (paras[paras.length - 1] ?? "").match(/[^.!?]+[.!?]+/g)?.slice(0, 3).join("").trim() ?? "";
    const take = (o.quickTake ?? tail).trim();
    if (take) bits.push(escapeHtml(take));
    const depth = data.depth;
    if (depth?.next) {
      bits.push(
        escapeHtml(depth.order === 1 ? "Behind him on the depth chart: " : "Next on the depth chart after him: ") +
          playerLink(depth.next.slug, depth.next.name, options) + ".",
      );
    }
    if (o.restOfSeason) bits.push(escapeHtml(`Rest-of-season tier: ${o.restOfSeason}.`));
    if (bits.length) {
      cards.push(
        `<div class="scp-ox-card"><h3>Outlook</h3><p>${bits.join(" ")} ` +
          `<a href="${escapeHtml(`${prefix}/outlook/${query}`)}">Full outlook</a></p></div>`,
      );
    }
  }

  /* ---- injury ---- */
  const status = (data.designation?.injuryStatus ?? data.player.injury_status ?? "").trim();
  const severity = status ? designationSeverity(status) : null;
  const tone = !severity ? "good" : severity === "out" || severity === "doubtful" ? "bad" : "mid";
  const label = !status
    ? "Active, no designation"
    : /^ir\b/i.test(status) || /injured reserve/i.test(status) ? "Injured reserve" : status;
  const inj = data.injury;
  const sentences: string[] = [];
  if (inj?.seasonMissed !== null && inj?.seasonMissed !== undefined) {
    sentences.push(inj.seasonMissed === 0 ? "He has not missed a game this season." : `He has missed ${inj.seasonMissed} game${inj.seasonMissed > 1 ? "s" : ""} this season.`);
  }
  const history = [...(inj?.history.nfl ?? [])].sort((x, y) => y.season - x.season || (y.week ?? 0) - (x.week ?? 0));
  const through = history.find((e) => e.season === (data.leagueSeason ?? data.season) && (e.gamesMissed ?? 0) === 0 && e.bodyPart);
  if (through) sentences.push(`He played through a ${through.bodyPart!.toLowerCase()} issue${through.week ? ` in Week ${through.week}` : ""}.`);
  if (inj) sentences.push(`Career games missed to injury: ${inj.summary.totalMissed}.`);
  const list = history.slice(0, 4).map((e) => {
    const side = e.side && !/^(unknown|n\/?a)$/i.test(e.side) ? e.side : "";
    const part = [side, e.bodyPart ?? e.type].filter(Boolean).join(" ") || "Injury";
    const missed = e.gamesMissed ?? 0;
    return (
      `<li><span>${e.season}</span><span>${escapeHtml(part)}</span>` +
      `<span>${escapeHtml(missed ? `${missed} game${missed > 1 ? "s" : ""}` : "Played through")}</span></li>`
    );
  });
  const injury =
    `<div class="scp-ox-card"><h3>Injury status</h3>` +
    `<p class="scp-ox-status is-${tone}">${escapeHtml(label)}</p>` +
    (sentences.length ? `<p>${escapeHtml(sentences.join(" "))} <a href="${escapeHtml(`${prefix}/injury/${query}`)}">Injury history</a></p>` : "") +
    (list.length ? `<ul class="scp-ox-inj">${list.join("")}</ul>` : "") +
    `</div>`;

  // A player who is out leads with it.
  if (tone === "bad") cards.unshift(injury);
  else cards.push(injury);

  const lede = o?.restOfSeason
    ? `${escapeHtml(lastName(data.player.name))} projects as ${escapeHtml(o.restOfSeason)} the rest of the way, and ${status ? `is listed ${escapeHtml(label.toLowerCase())}` : "carries no injury designation"}.`
    : status ? `${escapeHtml(lastName(data.player.name))} is listed ${escapeHtml(label.toLowerCase())}.` : "";
  return (
    sectionOpen("scp-ox-cards-h", "Rest-of-season outlook and availability", lede) +
    `<div class="scp-ox-two">${cards.join("")}</div></section>`
  );
}

/* --------------------------------------------------- section 8: FAQ */

interface Faq {
  question: string;
  /** The answer as HTML, and the same words as plain text for the schema. */
  html: string;
  text: string;
}

function faq(question: string, parts: Array<string | { href: string; text: string }>): Faq {
  return {
    question,
    html: parts.map((p) => (typeof p === "string" ? escapeHtml(p) : a(p.href, p.text))).join(""),
    text: parts.map((p) => (typeof p === "string" ? p : p.text)).join(""),
  };
}

export function overviewFaqs(data: PlayerPageData, options: PlayerRenderOptions = {}): Faq[] {
  const name = data.player.name;
  const pos = data.player.position ?? "";
  const s = season(data);
  const out: Faq[] = [];
  const startSit = `${options.startSitBase ?? STARTSIT_BASE}${encodeURIComponent(data.player.slug)}`;
  const status = (data.designation?.injuryStatus ?? data.player.injury_status ?? "").trim();

  // 1. This week.
  const next = (data.upcomingStrip ?? data.upcoming)[0];
  if (next) {
    const opp = next.opponent?.nickname ?? next.opponentName;
    const where = next.homeAway === "away" ? `at the ${opp}` : `against the ${opp}`;
    const bye = data.byeWeek ?? null;
    const onBye = bye !== null && bye > s.leagueWeek && bye < next.week;
    const week = onBye ? bye : next.week;
    const parts: Array<string | { href: string; text: string }> = [];
    if (onBye) parts.push(`${name} is on bye in Week ${bye}. His next game is Week ${next.week} ${where}. `);
    else if (isOut(data)) parts.push(`${name} is listed as ${status} and will not play in Week ${week}, ${where}. `);
    else parts.push(`${name} plays Week ${next.week} ${where}. `);
    if (next.matchup && !isOut(data)) {
      const band = matchupBand(next.matchup.rank);
      const verdict = band === "soft" ? "a favorable matchup" : band === "mid" ? "a neutral matchup" : "a tough matchup";
      parts.push(`The ${opp} rank ${ordinal(next.matchup.rank)} in ${SCORING_SHORT[data.format]} points allowed to ${pos}s, ${verdict}. `);
    }
    const rank = seasonRank(data);
    if (rank && !isOut(data) && s.current) parts.push(`As the ${pos}${rank} this season, he is ${leagueRead(pos, rank)}. `);
    parts.push({ href: startSit, text: `Get the start/sit call for ${lastName(name)}` }, ".");
    out.push(faq(`Should I start ${name} in Week ${week}?`, parts));
  } else if (s.leagueWeek >= 18) {
    const o = data.fantasyOutlook2026?.quickTake;
    if (o) out.push(faq(`Will ${name} be a good fantasy pick in ${s.leagueSeason + 1}?`, [o]));
  }

  // 2. Average.
  if (s.current && s.played.length) {
    const total = s.played.reduce((sum, e) => sum + s.pts(e), 0);
    const rank = seasonRank(data);
    out.push(
      faq(`How many fantasy points is ${name} averaging in ${s.leagueSeason}?`, [
        `${name} is averaging ${one(total / s.played.length)} ${SCORING_SHORT[data.format]} points per game in ${s.leagueSeason}, ` +
          `${one(total)} points across ${s.played.length} game${s.played.length > 1 ? "s" : ""}` +
          (rank ? `. That ranks ${pos}${rank} at the position.` : "."),
      ]),
    );

    // 3. Best game.
    const best = [...playedCells(data, s)].sort((x, y) => (y.pts ?? 0) - (x.pts ?? 0))[0];
    if (best) {
      const where = best.homeAway === "away" ? "at" : "vs.";
      out.push(
        faq(`What was ${name}'s best fantasy game in ${s.leagueSeason}?`, [
          `${name}'s best ${s.leagueSeason} game was Week ${best.week} ${where} the ${opponentName(best.opp, best.oppCode)}: ` +
            `${one(best.pts!)} ${SCORING_SHORT[data.format]} points, a ${pos}${best.entry!.pos_rank} finish.`,
        ]),
      );
    }
  }

  // 4. Injury.
  const missed = data.injury?.seasonMissed;
  const missedLine = missed ? ` He has missed ${missed} game${missed > 1 ? "s" : ""} this season.` : missed === 0 ? " He has not missed a game this season." : "";
  const part = data.designation?.injuryBodyPart;
  out.push(
    faq(`Is ${name} injured?`, [
      status
        ? `${name} is listed as ${status}${part ? ` (${part})` : ""} on the latest injury report.${missedLine}`
        : `${name} has no injury designation on the latest report.${missedLine}`,
    ]),
  );

  // 5. Last season.
  const prev = data.production.find((r) => r.season === s.leagueSeason - 1);
  if (prev && prev.gamesPlayed > 0) {
    out.push(
      faq(`Where did ${name} finish in fantasy last season?`, [
        `${name} scored ${one(prev.total)} ${SCORING_SHORT[data.format]} points in ${prev.gamesPlayed} games in ${prev.season} ` +
          `(${one(prev.ppg)} per game)` +
          (prev.posFinishTotal ? `, finishing ${pos}${prev.posFinishTotal}.` : "."),
      ]),
    );
  }
  return out;
}

function renderFaq(data: PlayerPageData, options: PlayerRenderOptions): string {
  const items = overviewFaqs(data, options);
  if (items.length === 0) return "";
  // Into the page's one FAQPage node, word for word.
  options.faqSink?.push(...items.map((f) => ({ question: f.question, answer: f.text })));
  return (
    sectionOpen("scp-ox-faq-h", `${data.player.name} fantasy FAQ`, "") +
    `<div class="scp-ox-faq">` +
    items
      .map(
        (f, i) =>
          `<details${i === 0 ? " open" : ""}><summary>${escapeHtml(f.question)}</summary><p>${f.html}</p></details>`,
      )
      .join("") +
    `</div></section>`
  );
}

/* ------------------------------------------------------------ the tab */

/**
 * The sections, in the spec's order, for the bottom of the Overview.
 *
 * `extras.peers` is the profile's own peers rail (renderPositionPeers in
 * player-render.ts), which stands above the FAQ here.
 */
export function renderOverviewSections(
  data: PlayerPageData,
  options: PlayerRenderOptions = {},
  extras: { peers?: string } = {},
): string {
  const s = season(data);
  const ink = teamInk(data.team);
  const open = `<div class="scp-ox"${ink ? ` style="--scp-team:${escapeHtml(ink)}"` : ""}>`;
  const before =
    renderStrip(data, s, options) +
    renderRead(data, s, options) +
    renderMeters(data, s) +
    renderLog(data, s, options) +
    renderCareer(data, s, options) +
    renderCards(data, options);
  const faq = renderFaq(data, options);
  // The rail stands between two wrappers rather than inside one, so it
  // inherits the panel's type exactly as its copy under the other tabs does.
  return (
    (before ? `${open}${before}</div>` : "") +
    (extras.peers ?? "") +
    (faq ? `${open}${faq}</div>` : "")
  );
}
