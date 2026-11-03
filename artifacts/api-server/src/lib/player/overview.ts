/**
 * The Overview tab's sections, to mak's spec of 2026-09-29, in the order of
 * his player-entity brief of 2026-11-03.
 *
 * The brief's hierarchy is the player first, his statistics second, the
 * current context third and the fantasy analysis under those - so the tab
 * runs: the season strip, the latest news, the season's stat line, the
 * read with its usage meters, the recent games, the outlook and
 * availability cards, the career table, the About facts, then the peers
 * rail and the FAQ. The news, season-stats and About blocks are compact
 * versions of the News, Stats and Bio tabs with a link into each, so the
 * hub is a complete player page without reprinting those tabs. (The spec's
 * nearby-peers section was removed at mak's request; the profile's own
 * peers rail stays.) Each is a <section aria-labelledby> with its own H2
 * and, where the spec gives one, a one-line lede, and each is left out
 * whole when its data is not there, never rendered empty.
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
import { possessive } from "./title-case";
import { titleCase } from "./title-case";
import { renderFaqSection, selectFaq } from "./faq-engine";
import { overviewPool } from "./faq-pools";
import type { PlayerRenderOptions } from "../player-render";
import { sectionHref } from "./sections";
import { didNotPlayLabel, injuryForWeek } from "./injury-week";
import { getTeamByAbbreviation, type NflTeam } from "../team/teams";
import type { CareerStatRow } from "./stats-profile";
import type { PlayerPageData } from "./player-data";
import { getEntryPoints, SCORING_SHORT } from "./scoring";
import type { GameLogEntry } from "./types";
import { TIER_FILL, weeklyTier } from "./metrics";
import { renderNewsDigest } from "./news-tab";
import { seasonTotals, tableCols } from "./season-line";
import type { UpcomingGame } from "./upcoming";
import {
  designationSeverity,
  lastName,
  matchupBand,
  STARTSIT_BASE,
  teamInk,
} from "./header";

const DASH = "-";

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

/** A link inside running text: the club color, underlined. */
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

/** What a season rank makes him, in three words: "a QB2/streaming option". */
function roleCall(pos: string, rank: number): string {
  if (pos === "QB") {
    if (rank <= 12) return "a weekly QB1";
    if (rank <= 24) return "a QB2/streaming option";
    return "a bench quarterback";
  }
  if (pos === "TE") {
    if (rank <= 12) return "a weekly TE1";
    if (rank <= 20) return "a streaming TE";
    return "a bench stash";
  }
  if (rank <= 12) return `a weekly ${pos}1`;
  if (rank <= 24) return `a weekly ${pos}2`;
  if (rank <= 36) return "a flex option";
  return "a bench stash";
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

  // Seven cells: up to three played, the rest upcoming - more of either when
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
  const maxPts = Math.max(0, ...timeline.map((c) => c.pts ?? 0));
  const bestWeek = timeline.find((c) => c.pts !== null && c.pts === maxPts && maxPts > 0)?.week ?? null;
  const nextWeek = timeline.find((c) => c.kind === "future")?.week ?? null;
  const out = isOut(data);

  // Three lines a card (mak, 2026-10-23): the week and opponent, the number,
  // the verdict. "W4 @ NYG / 13.4 · QB21 / Loss" for a played week, "W7 vs
  // DEN / 22nd vs QB / Neutral" for one ahead. The bar, the kickoff date,
  // the 40px rank and the opponent link under it are gone.
  const week = (c: WeekCell): string =>
    `<span class="scp-ox-wk-w"><span aria-hidden="true">W</span><span class="scp-sr">Week </span>${c.week}</span>`;
  const top = (c: WeekCell): string =>
    `<div class="scp-ox-wk-top">${week(c)}` +
    (c.kind === "bye" ? "" : `${SEP}<span class="scp-ox-wk-opp">${oppMark(c)}</span>`) +
    `</div>${SEP}`;
  const dot = `<span class="scp-ox-wk-dot" aria-hidden="true">\u00b7</span>${SEP}`;

  const cells = timeline
    .map((c) => {
      if (c.kind === "bye") {
        return (
          `<li class="scp-ox-wk is-bye">` + top(c) +
          `<div class="scp-ox-wk-line is-muted">Bye</div>${SEP}` +
          `<div class="scp-ox-wk-res">No game</div></li>`
        );
      }
      if (c.kind === "future" && c.game) {
        const m = c.game.matchup;
        const band = m ? matchupBand(m.rank) : null;
        const chip = band
          ? `<span class="scp-ox-chip is-${band === "soft" ? "good" : band === "mid" ? "mid" : "bad"}">` +
            `${band === "soft" ? "Favorable" : band === "mid" ? "Neutral" : "Tough"}</span>`
          : "";
        const isNext = c.week === nextWeek;
        return (
          `<li class="scp-ox-wk is-future${isNext ? " is-next" : ""}">` +
          (isNext ? `<span class="scp-sr">Up next. </span>` : "") +
          top(c) +
          (m
            ? `<div class="scp-ox-wk-line scp-ox-wk-rank">${ordinal(m.rank)}<small> vs ${escapeHtml(pos)}</small></div>${SEP}`
            : `<div class="scp-ox-wk-line is-muted">${DASH}</div>${SEP}`) +
          `<div class="scp-ox-wk-chips">${chip}` +
          (isNext && out ? `${SEP}<span class="scp-ox-chip is-bad">Out</span>` : "") +
          `</div>` +
          `</li>`
        );
      }
      const result = c.result ? RESULT_WORD[c.result] : "";
      const res = result
        ? `<div class="scp-ox-wk-res is-${c.result!.toLowerCase()}">${result}</div>`
        : `<div class="scp-ox-wk-res"></div>`;
      if (c.kind === "dnp" || c.pts === null) {
        // The reason when the injury record knows it, linked to the Injury
        // tab when he has one (the brief of 2026-10-10).
        const label = didNotPlayLabel(injuryForWeek(data, s.leagueSeason, c.week));
        const injuryHref = sectionHref(data, options, "injury");
        return (
          `<li class="scp-ox-wk is-dnp">` + top(c) +
          `<div class="scp-ox-wk-line is-muted">` +
          (injuryHref ? `<a class="scp-ox-wk-dnp" href="${escapeHtml(injuryHref)}">${escapeHtml(label)}</a>` : escapeHtml(label)) +
          `</div>${SEP}` + res + `</li>`
        );
      }
      const rank = c.entry?.pos_rank ?? null;
      return (
        `<li class="scp-ox-wk">` + top(c) +
        `<div class="scp-ox-wk-line">` +
        `<span class="scp-ox-wk-pts${c.week === bestWeek ? " is-best" : ""}">${one(c.pts)}</span>` + dot +
        (rank
          ? `<span class="scp-ox-wk-fin is-${finishClass(pos, rank)}">${escapeHtml(pos)}${rank}</span>`
          : `<span class="scp-ox-wk-fin is-muted">${DASH}</span>`) +
        `</div>${SEP}` + res +
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
    sectionOpen("scp-ox-strip-h", `${possessive(name)} ${s.leagueSeason} season, week by week`, escapeHtml(lede.trim())) +
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
    // One paragraph, not four (mak, 2026-10-23): the call, the rank and rate
    // with what is behind them, and the schedule. The rates and the weekly
    // range go on one small line under it. Everything here is still derived.
    const line = sumLine(played);
    const total = played.reduce((sum, e) => sum + s.pts(e), 0);
    const rank = seasonRank(data);
    const label = SCORING_SHORT[data.format];
    const games = `${played.length} game${played.length > 1 ? "s" : ""}`;

    // 1. The call, and what is behind it.
    let read = rank
      ? `${last} is ${roleCall(pos, rank)}. He is ${pos}${rank} at ${one(total / played.length)} ${label} PPG`
      : `${last} is averaging ${one(total / played.length)} ${label} points per game through ${games}`;
    const meters = data.meters?.meters ?? null;
    if (meters && meters.length >= 2) {
      const sorted = [...meters].sort((x, y) => y.percentile - x.percentile);
      const best = sorted[0]!;
      const worst = sorted[sorted.length - 1]!;
      // "a 73rd-percentile completion rate", "an 81st-percentile catch rate",
      // but "9th-percentile yards per attempt": the plural labels take none.
      const phrase = (m: { label: string; percentile: number }) => {
        const ord = ordinal(m.percentile);
        const article = /^(yards|fantasy points)/i.test(m.label) ? "" : /^(8|11th|18th)/.test(ord) ? "an " : "a ";
        return `${article}${ord}-percentile ${m.label.toLowerCase()}`;
      };
      const strong = best.percentile >= 65;
      const weak = worst.percentile <= 35;
      if (strong && weak) read += `, supported by ${phrase(best)} but limited by ${phrase(worst)}`;
      else if (strong) read += `, supported by ${phrase(best)}`;
      else if (weak) read += `, limited by ${phrase(worst)}`;
    }
    read += ".";

    // 2. The schedule: the softest of the next four spots, and the hardest.
    const upcoming = (data.upcomingStrip ?? data.upcoming).slice(0, 4).filter((g) => g.matchup);
    if (upcoming.length) {
      const byRank = [...upcoming].sort((x, y) => x.matchup!.rank - y.matchup!.rank);
      const soft = byRank[0]!;
      const hard = byRank[byRank.length - 1]!;
      const spot = (g: UpcomingGame): string => `the ${g.opponent?.nickname ?? g.opponentName} in Week ${g.week}`;
      read += ` His best upcoming spot is ${spot(soft)}`;
      read += hard !== soft && hard.matchup!.rank !== soft.matchup!.rank
        ? `, while ${spot(hard)} is a tougher matchup.`
        : ".";
    }
    paragraphs.push(escapeHtml(read));
  }

  // The efficiency meters sit under the paragraph (mak, 2026-10-23), in
  // place of the small rates line and of the section they used to be.
  const meters = renderMeterCards(data, s);

  /* ---- the sidebar: one card (mak, 2026-10-23) ---- */

  const profile = renderProfile(data, s, redraft);

  return (
    sectionOpen("scp-ox-read-h", `Should you start or roster ${name}?`, "") +
    `<div class="scp-ox-read">` +
    `<div>` +
    `<div class="scp-ox-prose">${paragraphs.map((p) => `<p>${p}</p>`).join("")}</div>` +
    meters +
    `</div>` +
    `<aside class="scp-ox-aside" aria-label="${escapeHtml(`${possessive(last)} fantasy profile`)}">${profile}</aside>` +
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

function renderProfile(data: PlayerPageData, s: Season, redraft: string): string {
  const { pos } = s;
  // This season's weeks, or last season's before he has played one.
  const entries = s.played.length ? s.played : data.gameLog.filter((e) => e.game_status === "active");
  const label = s.played.length ? "" : ` (${data.season})`;
  const ranks = entries.map((e) => e.pos_rank).filter((r): r is number => typeof r === "number").sort((x, y) => x - y);
  const rows: Array<[string, string]> = [];

  const depth = data.depth;
  if (depth) {
    rows.push(["Role", `${depth.order === 1 ? "Starter" : "Backup"} \u00b7 ${depth.position}${depth.order} depth chart`]);
  }
  if (ranks.length) {
    const median = ranks[Math.floor((ranks.length - 1) / 2)]!;
    rows.push([`Typical week${label}`, `${pos}${median}`]);
    rows.push([`Floor${label}`, `${pos}${ranks[ranks.length - 1]}`]);
    rows.push([`Ceiling${label}`, `${pos}${ranks[0]}`]);
    const n = topN(pos);
    rows.push([`Top-${n} weeks${label}`, `${ranks.filter((r) => r <= n).length} of ${ranks.length}`]);
  }
  if (data.tdDependency && data.tdDependency.pct > 0) {
    rows.push(["TD scoring", `${Math.round(data.tdDependency.pct)}%`]);
  }
  // The Redraft Command card and the profile card are one card now (mak,
  // 2026-10-23): the rows, then the button.
  return (
    `<div class="scp-ox-panel is-profile"><h3>Fantasy profile</h3>` +
    (rows.length
      ? `<dl class="scp-ox-profile">` +
        rows.map(([dt, dd]) => `<dt>${escapeHtml(dt)}</dt><dd>${escapeHtml(dd)}</dd>`).join("") +
        `</dl>`
      : "") +
    `<a class="scp-ox-btn" href="${escapeHtml(redraft)}" data-cta="redraft-command-sidebar">Open in Redraft Command</a>` +
    `</div>`
  );
}

/* -------------------------------------------- section 3: the meters */

/** The four meter cards, with no heading or lede of their own since 2026-10-23. */
function renderMeterCards(data: PlayerPageData, s: Season): string {
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
  const note = `Percentile vs. every ${m.position} with at least ${m.threshold} ${m.unit} in ${m.season}. The line marks the league median.`;
  return `<div class="scp-ox-meters" role="group" aria-label="${escapeHtml(note)}">${cards}</div>`;
}

/* ------------------------------------------- section 4: the game log */

/** A weekly finish as the Game Log tab prints it: a pill in its tier's blue. */
function finishPill(pos: string, rank: number | null | undefined): string {
  const tier = weeklyTier(rank);
  if (!tier || !rank) return DASH;
  return `<span class="scp-tier" data-tier="${tier}" style="--tier-fill:${TIER_FILL[tier]}">${escapeHtml(`${pos}${rank}`)}</span>`;
}

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
        `<tr class="scp-row"><th scope="row">${e.week}</th><td class="scp-opp">${oppCell}</td>` +
        `<td class="scp-score">${r ? escapeHtml(r + sc) : DASH}</td><td class="scp-pts">${one(p)}</td>` +
        `<td class="scp-col-fin">${finishPill(pos, e.pos_rank)}</td></tr>`
      );
    })
    .join("");

  const rank = seasonRank(data);
  const record = `${w}–${l}${t ? `–${t}` : ""}`;
  const splits = pos === "QB" ? "passing and rushing" : pos === "RB" ? "rushing and receiving" : "receiving";
  const href = `${options.playerPathPrefix ?? "/player/"}${data.player.slug}/game-log/${query}`;

  return (
    // "{Name} recent games" (the entity brief, 2026-11-03): the Game Log tab
    // owns "{Name} game log", and the same words twice on one page is the
    // repetition the brief asks to end.
    sectionOpen("scp-ox-log-h", `${data.player.name} recent games`, "") +
    // The Game Log tab's table, in its classes (mak, 2026-09-30); no caption.
    `<div class="scp-scroll"><table class="scp-table scp-table--filled scp-table--log scp-ox-log">` +
    `<thead><tr><th scope="col">Wk</th><th scope="col">Opp</th><th scope="col">Result</th>` +
    `<th scope="col" class="scp-col-pts">FPTS</th><th scope="col" class="scp-col-fin">Finish</th></tr></thead>` +
    `<tbody>${rows}</tbody>` +
    `<tfoot><tr class="scp-total"><th scope="row">Total</th><td></td><td>${escapeHtml(record)}</td>` +
    `<td class="scp-pts">${one(total)}</td><td>${rank ? escapeHtml(`${pos}${rank}`) : DASH}</td></tr></tfoot>` +
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
        `<tr class="scp-row${cur ? " is-cur" : ""}"><th scope="row">${r.season}</th><td>${escapeHtml(team(r.season))}</td>` +
        `<td class="scp-col-box">${r.gamesPlayed}</td>` +
        cols.map((c) => `<td class="scp-col-box">${whole(c.of(r))}</td>`).join("") +
        `<td class="scp-pts">${one(r.points)}</td><td class="scp-col-box">${one(r.ppg)}</td>` +
        `<td class="scp-col-fin">${!cur && r.finish ? escapeHtml(`${pos}${r.finish}`) : DASH}</td></tr>`
      );
    })
    .join("");

  // Summed from every season row, never a stored total.
  const gp = rows.reduce((sum, r) => sum + r.gamesPlayed, 0);
  const pts = rows.reduce((sum, r) => sum + r.points, 0);
  const career =
    `<tr class="scp-total"><th scope="row">Career</th><td></td><td>${gp}</td>` +
    cols.map((c) => `<td>${whole(rows.reduce((sum, r) => sum + c.of(r), 0))}</td>`).join("") +
    `<td class="scp-pts">${one(pts)}</td><td>${gp ? one(pts / gp) : DASH}</td><td></td></tr>`;

  const href = `${options.playerPathPrefix ?? "/player/"}${data.player.slug}/stats/${options.linkQuery ?? ""}`;
  return (
    // "{Name} career stats" (the entity brief, 2026-11-03); the Stats tab's
    // own table is "... career stats by season".
    sectionOpen("scp-ox-career-h", `${data.player.name} career stats`, "") +
    // The Game Log tab's table, in its classes (mak, 2026-09-30).
    `<div class="scp-scroll"><table class="scp-table scp-table--filled scp-table--log scp-ox-career">` +
    `<thead><tr><th scope="col">Season</th><th scope="col">Team</th><th scope="col">GP</th>` +
    cols.map((c) => `<th scope="col">${escapeHtml(c.label)}</th>`).join("") +
    `<th scope="col" class="scp-col-pts">FPTS</th><th scope="col">PPG</th><th scope="col" class="scp-col-fin">Finish</th></tr></thead>` +
    `<tbody>${body}</tbody><tfoot>${career}</tfoot></table></div>` +
    `<a class="scp-ox-more" href="${escapeHtml(href)}">${escapeHtml(`All ${rows.length} seasons and advanced stats`)}</a>` +
    `</section>`
  );
}

/* ----------------------------------------- the entity brief's blocks */

/**
 * The latest news, compact (the entity brief, 2026-11-03): the News tab's
 * feed, four items deep, with the tab linked under it. Under the strip and
 * before the numbers, because "what happened to him this week" is the
 * second thing a reader asks after "who is he".
 */
function renderNews(data: PlayerPageData, options: PlayerRenderOptions): string {
  const digest = renderNewsDigest(data, options, 4);
  if (!digest) return "";
  return sectionOpen("scp-ox-news-h", `${data.player.name} latest news`, "") + digest + `</section>`;
}

/**
 * The season's stat line as a one-row table (the entity brief, 2026-11-03):
 * the counting stats by position, the rate the position is read by, then
 * the fantasy total and rate - summed through season-line.ts from the same
 * weeks the hero's line and the Stats tab's production section sum, so the
 * three cannot disagree. Only for a season in progress with a game in it;
 * the career table below covers everything else.
 */
function renderSeasonStats(data: PlayerPageData, s: Season, options: PlayerRenderOptions): string {
  if (!s.current || s.played.length === 0) return "";
  const cols = tableCols(s.pos, SCORING_SHORT[data.format]);
  if (cols.length === 0) return "";
  const totals = seasonTotals(s.played, s.pts);
  const href = `${options.playerPathPrefix ?? "/player/"}${data.player.slug}/stats/${options.linkQuery ?? ""}`;
  const through = s.leagueWeek > 0 ? `Through Week ${s.leagueWeek}` : "";
  return (
    // "{Name} 2026 season stats": the Stats tab's lead heading is "{Name}
    // 2026 stats", and the hub carries both panels.
    sectionOpen("scp-ox-season-h", `${data.player.name} ${s.leagueSeason} season stats`, through ? escapeHtml(through) : "") +
    `<div class="scp-scroll"><table class="scp-table scp-table--filled scp-ox-season">` +
    `<thead><tr>` +
    cols.map((c) => `<th scope="col"><abbr title="${escapeHtml(c.title)}">${escapeHtml(c.label)}</abbr></th>`).join("") +
    `</tr></thead>` +
    `<tbody><tr>${cols.map((c) => `<td>${escapeHtml(c.of(totals))}</td>`).join("")}</tr></tbody>` +
    `</table></div>` +
    `<a class="scp-ox-more" href="${escapeHtml(href)}">${escapeHtml(`Complete ${data.player.name} stats and career statistics`)}</a>` +
    `</section>`
  );
}

/** The position spelled out beside its code: "Wide receiver (WR)". */
const POSITION_WORDS: Record<string, string> = {
  QB: "Quarterback",
  RB: "Running back",
  WR: "Wide receiver",
  TE: "Tight end",
  K: "Kicker",
  FB: "Fullback",
};

/**
 * "About {Name}" (the entity brief, 2026-11-03): the facts that answer the
 * plain questions - what team, what number, how old, how tall, where he
 * went to college, when he was drafted - as a definition list, with the
 * Bio tab linked under it. The sourced fact store's quick facts where the
 * player has a record, the dictionary-and-draft profile where he has not;
 * never both, and never a fact that is not there. Nothing fantasy.
 */
function renderAbout(data: PlayerPageData, options: PlayerRenderOptions): string {
  const { player, team } = data;
  const prefix = options.playerPathPrefix ?? "/player/";
  const q = options.linkQuery ?? "";
  const teamPrefix = options.teamPathPrefix ?? "/team/";
  const rows: Array<[string, string]> = [];
  const pos = player.position ?? "";
  if (team) rows.push(["Team", a(`${teamPrefix}${team.slug}/${q}`, team.fullName, ` target="_top"`)]);
  else rows.push(["Team", "Free agent"]);
  if (pos) rows.push(["Position", escapeHtml(POSITION_WORDS[pos] ? `${POSITION_WORDS[pos]} (${pos})` : pos)]);
  const facts: Array<{ label: string; value: string }> =
    data.bioPage?.quick?.length ? data.bioPage.quick : data.bioProfile?.facts ?? [];
  // The sourced quick facts carry his jersey number themselves ("Jersey
  // No."); the dictionary's number only fills in where they do not.
  if (player.number && !facts.some((f) => /jersey|number/i.test(f.label))) {
    rows.push(["Number", escapeHtml(`#${player.number}`)]);
  }
  for (const f of facts) rows.push([f.label, escapeHtml(f.value)]);
  if (rows.length < 4) return "";
  const href = `${prefix}${player.slug}/bio/${q}`;
  return (
    sectionOpen("scp-ox-about-h", `About ${player.name}`, "") +
    `<dl class="scp-ox-about">` +
    rows.map(([dt, dd]) => `<div><dt>${escapeHtml(dt)}</dt><dd>${dd}</dd></div>`).join("") +
    `</dl>` +
    `<a class="scp-ox-more" href="${escapeHtml(href)}">${escapeHtml(`${player.name} bio, career timeline and draft history`)}</a>` +
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
      // The link only when the Outlook tab exists for this player.
      const outlookHref = sectionHref(data, options, "outlook");
      cards.push(
        `<div class="scp-ox-card"><h3>Outlook</h3><p>${bits.join(" ")}` +
          (outlookHref ? ` <a href="${escapeHtml(outlookHref)}">Full outlook</a>` : "") +
          `</p></div>`,
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
  const injuryHref = sectionHref(data, options, "injury");
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
    (sentences.length ? `<p>${escapeHtml(sentences.join(" "))}${injuryHref ? ` <a href="${escapeHtml(injuryHref)}">Injury history</a>` : ""}</p>` : "") +
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

function renderFaq(data: PlayerPageData, options: PlayerRenderOptions): string {
  // Fantasy value only (faq-pools.ts): injury, bio facts, totals and single
  // games are the other tabs' questions.
  return renderFaqSection("overview", data, selectFaq(overviewPool(data, options)), options);
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
    renderNews(data, options) +
    renderSeasonStats(data, s, options) +
    renderRead(data, s, options) +
    renderLog(data, s, options) +
    renderCards(data, options) +
    renderCareer(data, s, options) +
    renderAbout(data, options);
  const faq = renderFaq(data, options);
  // The rail stands between two wrappers rather than inside one, so it
  // inherits the panel's type exactly as its copy under the other tabs does.
  return (
    (before ? `${open}${before}</div>` : "") +
    (extras.peers ?? "") +
    (faq ? `${open}${faq}</div>` : "")
  );
}
