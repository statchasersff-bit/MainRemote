/**
 * The Overview tab, to mak's Overview redesign of 2026-11-05: five sections,
 * each with one job, and nothing the header above them already prints.
 *
 *   (alert)  an availability note, only when the designation comes with
 *            something the header's status pill does not say (the body
 *            part, the practice report)
 *   1. Season Stats            what he has produced this season
 *   2. Weekly Performance      how each week went (a bar chart) and who is
 *      & Upcoming Schedule     next (four rows with the matchup grade)
 *   3. Fantasy Outlook         one recommendation, one derived paragraph,
 *      & Efficiency            the efficiency percentiles
 *   4. Latest News             up to three items the chart does not repeat
 *                              (no game recaps); dropped when none qualify
 *   5. Career & Background     honors, career totals, the bio facts the
 *                              header does not carry
 *
 * then the peers rail and the FAQ, as on every tab.
 *
 * What left (each lives on its own tab): the seven-cell week strip and its
 * lede, the Recent Games table (Game Log), the Fantasy Profile card (typical
 * week, floor, ceiling, top-N, TD share), the Rest-of-Season Outlook card
 * (Outlook), the always-on Injury Status card and its history list (Injury),
 * the career table (Stats) and the About list's header facts (Bio).
 *
 * The header (./header.ts) carries: position, club, status pill, name,
 * number, age, height, weight, college, experience, draft slot, FPPG, POS
 * RANK (by PPG), rostered %, four season stat cards and the next matchup.
 * Nothing below prints those as standalone facts again; the season table
 * keeps the counting line the cards sample because it is the one complete
 * line, and drops PPG.
 *
 * Its own module, so tests/player-overview.test.mjs can render it against
 * hand-built states without the database. Everything is derived; the only
 * hand-written text it can print is the outlook's quick take, preseason.
 */

import { escapeHtml } from "../render";
import { possessive, titleCase } from "./title-case";
import { phoneHeading } from "./phone-heading";
import { renderFaqSection, selectFaq } from "./faq-engine";
import { overviewPool } from "./faq-pools";
import type { PlayerRenderOptions } from "../player-render";
import { sectionHref } from "./sections";
import { didNotPlayLabel, injuryForWeek } from "./injury-week";
import { getTeamByAbbreviation, type NflTeam } from "../team/teams";
import type { PlayerPageData } from "./player-data";
import { getEntryPoints, SCORING_SHORT } from "./scoring";
import type { GameLogEntry } from "./types";
import { renderNewsBrief } from "./news-tab";
import { seasonTotals, tableCols } from "./season-line";
import type { UpcomingGame } from "./upcoming";
import {
  CHIP_WORD,
  designationSeverity,
  lastName,
  matchupBand,
  startSitHref,
  teamInk,
} from "./header";
import { headArt, headIcon } from "./tab-head";
import { redraftPlayerUrl } from "./redraft-link";

const DASH = "-";

/* ------------------------------------------------------------------ atoms */

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

const one = (v: number): string => v.toFixed(1);
const whole = (v: number): string => Math.round(v).toLocaleString("en-US");

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n: number): string => WORDS[n] ?? String(n);
const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;

const svg = (body: string): string =>
  `<svg class="scp-ovp-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const ICON = {
  stats: svg(`<path d="M5 20v-6M12 20V9M19 20V4"/>`),
  weekly: svg(`<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>`),
  outlook: svg(`<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>`),
  news: svg(`<path d="M4 5h13v14H6a2 2 0 0 1-2-2z"/><path d="M17 9h3v8a2 2 0 0 1-2 2"/><path d="M8 9h5M8 13h5"/>`),
  career: svg(`<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>`),
} as const;

/**
 * A section: the navy bar every other tab's sections wear (Outlook's
 * .scp-olr-bar, Bio's .scp-bop-bar) over a card body (mak, 2026-11-06).
 * Close with SECTION_END.
 */
function sectionOpen(id: string, heading: string, cls = "", icon: keyof typeof ICON = "stats", name = ""): string {
  return (
    `<section class="scp-ox-sec scp-ovp-sec${cls ? ` ${cls}` : ""}" aria-labelledby="${id}">` +
    `<header class="scp-ovp-bar">` +
    `<span class="scp-ovp-bar-icon">${ICON[icon]}</span>` +
    `<h2 class="scp-ovp-bar-title" id="${id}">${phoneHeading(titleCase(heading), name)}</h2>` +
    `<span class="scp-ovp-bar-grid" aria-hidden="true"></span>` +
    `<span class="scp-ovp-bar-stripes" aria-hidden="true"></span>` +
    `</header>` +
    `<div class="scp-ovp-body">`
  );
}
const SECTION_END = `</div></section>`;

/** A tab every player page has: Stats, Game Log, Bio, News. */
function tabHref(data: PlayerPageData, options: PlayerRenderOptions, seg: string): string {
  return `${options.playerPathPrefix ?? "/player/"}${data.player.slug}/${seg}/${options.linkQuery ?? ""}`;
}

function more(href: string, text: string, attrs = ""): string {
  return `<a class="scp-ox-more" href="${escapeHtml(href)}"${attrs}>${escapeHtml(text)}</a>`;
}

/**
 * The scoring word for a fantasy total. A quarterback's points are the same
 * in every format the site offers (the formats differ only per reception),
 * so his read "fantasy points", never "PPR points".
 */
function scoringWord(pos: string, format: PlayerPageData["format"]): string {
  return pos === "QB" ? "fantasy" : SCORING_SHORT[format];
}

/* ------------------------------------------------------ position rules */

/**
 * The one definition of a weekly "starter" finish: top-12 at QB, TE and K,
 * top-24 at RB and WR. The chart's gold bars and the paragraph's "top-12 in
 * four of eight" both read it.
 */
export function starterLine(pos: string): number {
  return pos === "RB" || pos === "WR" ? 24 : 12;
}

export interface FantasyCall {
  label: string;
  tone: "elite" | "starter" | "flex" | "depth" | "waiver";
}

/**
 * The recommendation, from his points-per-game rank at his position (the
 * same rank the header's POS RANK prints) and his rostered share. One table
 * per position, so a quarterback is never a "flex consideration" and a
 * receiver never a "streaming option":
 *
 *            elite  starter  flex/stream  depth
 *   QB        1-5    6-12     13-20        21-32
 *   TE        1-3    4-12     13-20        21-32
 *   RB, WR    1-8    9-24     25-36        37-60
 *   K         1-3    4-12     13-20        21-32
 *
 * Past the depth line: "Waiver consideration" when he is rostered in under
 * half of leagues (or the share is unknown), "Bench depth" when most leagues
 * still hold him.
 */
export function fantasyCall(pos: string, rank: number, rosteredPct: number | null): FantasyCall {
  const wide = pos === "RB" || pos === "WR";
  const [elite, starter, middle, depth] = wide ? [8, 24, 36, 60] : pos === "QB" ? [5, 12, 20, 32] : [3, 12, 20, 32];
  if (rank <= elite) return { label: "Elite starter", tone: "elite" };
  if (rank <= starter) return { label: "Weekly starter", tone: "starter" };
  if (rank <= middle) {
    if (wide) return { label: "Flex consideration", tone: "flex" };
    return { label: pos === "QB" ? "QB2 / streaming option" : "Streaming option", tone: "flex" };
  }
  if (rank <= depth) return { label: "Bench depth", tone: "depth" };
  return rosteredPct !== null && rosteredPct >= 50
    ? { label: "Bench depth", tone: "depth" }
    : { label: "Waiver consideration", tone: "waiver" };
}

/** His points-per-game rank this season, the header's POS RANK. */
function seasonRank(data: PlayerPageData): number | null {
  const row = data.production.find((r) => r.season === data.season);
  return row?.posFinishPpg ?? data.seasonRank ?? row?.posFinishTotal ?? data.seasonRankTotal ?? null;
}

/* --------------------------------------------------------- the season */

interface WeekCell {
  week: number;
  kind: "played" | "dnp" | "bye";
  homeAway: "home" | "away" | null;
  oppCode: string;
  opp: NflTeam | null;
  result: "W" | "L" | "T" | null;
  score: string | null;
  entry: GameLogEntry | null;
  pts: number | null;
}

interface Season {
  pos: string;
  leagueSeason: number;
  leagueWeek: number;
  /** The page's stats are this season's. False for a player who has not played in it. */
  current: boolean;
  played: GameLogEntry[];
  pts: (e: GameLogEntry) => number;
  /** Every completed week in order: played, did not play, and the bye. Never a future game. */
  weeks: WeekCell[];
  /** The next four games, with the bye in its place when it falls among them. */
  next: Array<UpcomingGame | { bye: number }>;
}

function season(data: PlayerPageData): Season {
  const pos = data.player.position ?? "";
  const leagueSeason = data.leagueSeason ?? data.season;
  const leagueWeek = data.leagueWeek ?? 0;
  const current = data.season === leagueSeason && leagueWeek > 0;
  const pts = (e: GameLogEntry): number => getEntryPoints(e.stats, data.format);
  const log = current ? data.gameLog : [];
  const played = log.filter((e) => e.game_status === "active").sort((x, y) => x.week - y.week);
  const logByWeek = new Map(log.map((e) => [e.week, e]));

  const weeks: WeekCell[] = [];
  const schedule = (data.schedule ?? []).filter((g) => g.seasonType !== "post");
  if (schedule.length) {
    // Final games only: a postponed or unplayed game is neither a result nor
    // a zero, so it is simply not a bar yet.
    for (const game of schedule) {
      if (game.status !== "final") continue;
      const entry = logByWeek.get(game.week) ?? null;
      const active = entry?.game_status === "active";
      weeks.push({
        week: game.week,
        kind: active ? "played" : "dnp",
        homeAway: game.homeAway,
        oppCode: game.opponent?.code ?? game.opponentName,
        opp: game.opponent,
        result: game.result?.outcome ?? null,
        score: game.result ? `${game.result.teamScore}-${game.result.opponentScore}` : null,
        entry: active ? entry : null,
        pts: active && entry ? pts(entry) : null,
      });
    }
  } else {
    // No schedule: the log alone, with no home or away marker rather than a
    // guessed one.
    for (const e of log) {
      if (e.game_status === "bye") continue;
      const opp = getTeamByAbbreviation(e.opp);
      const active = e.game_status === "active";
      weeks.push({
        week: e.week,
        kind: active ? "played" : "dnp",
        homeAway: null,
        oppCode: opp?.code ?? e.opp,
        opp,
        result: (e.score?.r as "W" | "L" | "T" | undefined) ?? null,
        score: e.score ? `${e.score.tm}-${e.score.opp}` : null,
        entry: active ? e : null,
        pts: active ? pts(e) : null,
      });
    }
  }
  // A game he has a log line for that the schedule does not yet carry as
  // final (the slate and the logs refresh on different clocks): the log is
  // the record of what he did, so the week is a bar, not a gap.
  for (const e of played) {
    if (weeks.some((c) => c.week === e.week)) continue;
    const opp = getTeamByAbbreviation(e.opp);
    const game = schedule.find((g) => g.week === e.week);
    weeks.push({
      week: e.week,
      kind: "played",
      homeAway: game?.homeAway ?? null,
      oppCode: opp?.code ?? e.opp,
      opp: game?.opponent ?? opp,
      result: (e.score?.r as "W" | "L" | "T" | undefined) ?? null,
      score: e.score ? `${e.score.tm}-${e.score.opp}` : null,
      entry: e,
      pts: pts(e),
    });
  }
  weeks.sort((x, y) => x.week - y.week);

  // The bye, between two completed weeks: a gap in the chart, never a zero.
  const bye = data.byeWeek ?? null;
  const lastDone = weeks[weeks.length - 1]?.week ?? 0;
  if (bye !== null && weeks.length && bye < lastDone && weeks.every((c) => c.week !== bye)) {
    weeks.push({ week: bye, kind: "bye", homeAway: null, oppCode: "", opp: null, result: null, score: null, entry: null, pts: null });
    weeks.sort((x, y) => x.week - y.week);
  }

  const ahead = [...(data.upcoming?.length ? data.upcoming : data.upcomingStrip ?? [])]
    .filter((g) => g.week > lastDone)
    .sort((x, y) => x.week - y.week)
    .slice(0, 4);
  const next: Season["next"] = [...ahead];
  if (bye !== null && bye > lastDone && ahead.length && bye < ahead[ahead.length - 1]!.week) {
    next.splice(next.findIndex((g) => "week" in g && g.week > bye), 0, { bye });
  }

  return { pos, leagueSeason, leagueWeek, current, played, pts, weeks, next };
}

/* --------------------------------------------- the availability alert */

/**
 * Only when there is a designation AND something to add to the header's pill:
 * the body part, the practice report. A healthy player, or a designation with
 * nothing behind it, prints nothing - the pill already says it.
 */
function renderAlert(data: PlayerPageData, options: PlayerRenderOptions): string {
  const status = (data.designation?.injuryStatus ?? data.player.injury_status ?? "").trim();
  if (!status) return "";
  const part = (data.designation?.injuryBodyPart ?? "").trim();
  const practice = (data.designation?.practice ?? "").trim();
  if (!part && !practice) return "";
  const severity = designationSeverity(status);
  const tone = severity === "out" || severity === "doubtful" ? "bad" : severity === "probable" ? "good" : "mid";
  const label = /^ir\b/i.test(status) || /injured reserve/i.test(status) ? "Injured reserve" : status;
  const href = sectionHref(data, options, "injury");
  return (
    `<aside class="scp-ox-alert is-${tone}" aria-label="Availability">` +
    `<p class="scp-ox-alert-h"><strong>${escapeHtml(part ? `${label} - ${part}` : label)}</strong></p>` +
    (practice ? `<p class="scp-ox-alert-p">${escapeHtml(`Latest practice report: ${practice.replace(/\s+in practice$/i, "").toLowerCase()}.`)}</p>` : "") +
    (href ? `<a class="scp-ox-alert-a" href="${escapeHtml(href)}">View injury details<span aria-hidden="true"> →</span></a>` : "") +
    `</aside>`
  );
}

/* ------------------------------------------------- 1. season stats */

/**
 * The season's line, summed through season-line.ts from the same weeks the
 * header's cards and the Stats tab sum, so the three agree. PPG is left out:
 * the header's FPPG is it. Only for a season in progress with a game in it.
 */
function renderSeasonStats(data: PlayerPageData, s: Season, options: PlayerRenderOptions): string {
  if (!s.current || s.played.length === 0) return "";
  const cols = tableCols(s.pos, SCORING_SHORT[data.format]).filter((c) => c.label !== "PPG");
  if (cols.length === 0) return "";
  const totals = seasonTotals(s.played, s.pts);
  const label = (c: { label: string }): string => (/ PTS$/.test(c.label) ? "FPTS" : c.label);
  const href = `${options.playerPathPrefix ?? "/player/"}${data.player.slug}/stats/${options.linkQuery ?? ""}`;
  return (
    sectionOpen("scp-ox-season-h", `${data.player.name} ${s.leagueSeason} season stats`, "", "stats", data.player.name) +
    `<dl class="scp-ox-season is-c${cols.length >= 9 ? 5 : 4}" style="--n:${cols.length}">` +
    cols
      .map(
        (c) =>
          `<div class="scp-ox-stat${/ PTS$/.test(c.label) ? " is-fpts" : ""}">` +
          `<dt><abbr title="${escapeHtml(/ PTS$/.test(c.label) && s.pos === "QB" ? "Fantasy points" : c.title)}">${escapeHtml(label(c))}</abbr></dt>` +
          `<dd>${escapeHtml(c.of(totals))}</dd></div>`,
      )
      .join("") +
    `</dl>` +
    more(href, `Complete ${data.player.name} stats and career statistics`) +
    SECTION_END
  );
}

/* ------------------------------------ 2. weekly performance + schedule */

const RESULT_WORD = { W: "Won", L: "Lost", T: "Tied" } as const;

function fixtureWords(c: { homeAway: "home" | "away" | null; opp: NflTeam | null; oppCode: string }): string {
  const name = c.opp?.nickname ?? c.oppCode;
  return c.homeAway === "away" ? `at ${name}` : c.homeAway === "home" ? `vs ${name}` : name;
}

function renderChart(data: PlayerPageData, s: Season, options: PlayerRenderOptions): string {
  const { weeks, pos } = s;
  if (!weeks.some((c) => c.kind === "played")) return "";
  const pts = weeks.filter((c) => c.pts !== null).map((c) => c.pts!);
  // The average is over games he played: a bye or an absence is not a zero.
  const avg = pts.reduce((a, b) => a + b, 0) / pts.length;
  const top = Math.max(10, Math.ceil(Math.max(...pts, avg) / 10) * 10);
  const pct = (v: number): string => `${Math.max(0, Math.min(100, (v / top) * 100)).toFixed(1)}%`;
  const line = starterLine(pos);
  const word = scoringWord(pos, data.format);
  const cols = weeks
    .map((c, i) => {
      const side = i < 2 ? " is-l" : i >= weeks.length - 2 ? " is-r" : "";
      const x = `<span class="scp-ow-x" aria-hidden="true">${c.week}</span>`;
      if (c.kind === "bye") {
        return (
          `<li class="scp-ow-col is-bye${side}">` +
          `<span class="scp-ow-mark" aria-hidden="true">Bye</span>` +
          `<span class="scp-ow-tip"><b>Week ${c.week}</b> Bye week</span>${x}</li>`
        );
      }
      if (c.kind === "dnp" || c.pts === null) {
        // "Out" only when an injury covers the week; a healthy backup who
        // never got in is "DNP" (mak, 2026-11-06: Minshew read "Out" for
        // weeks 1-7 as Murray's backup).
        const inj = injuryForWeek(data, s.leagueSeason, c.week);
        const why = didNotPlayLabel(inj, c.entry?.stats as { gp?: number } | undefined);
        return (
          `<li class="scp-ow-col is-dnp${inj ? " is-inj" : ""}${side}" tabindex="0">` +
          `<span class="scp-ow-mark" aria-hidden="true">${inj ? "Out" : "DNP"}</span>` +
          `<span class="scp-ow-tip"><b>${escapeHtml(`Week ${c.week} ${fixtureWords(c)}`)}</b> ${escapeHtml(why)}` +
          (c.result ? `<span>${escapeHtml(`${RESULT_WORD[c.result]} ${c.score ?? ""}`.trim())}</span>` : "") +
          `</span>${x}</li>`
        );
      }
      const rank = c.entry?.pos_rank ?? null;
      const tier = rank === null ? "" : rank <= line ? " is-hit" : "";
      return (
        `<li class="scp-ow-col is-played${tier}${side}" tabindex="0">` +
        `<span class="scp-ow-bar" style="height:${pct(c.pts)}"><span class="scp-ow-v" aria-hidden="true">${one(c.pts)}</span></span>` +
        `<span class="scp-ow-tip"><b>${escapeHtml(`Week ${c.week} ${fixtureWords(c)}`)}</b>` +
        `<span>${escapeHtml(`${one(c.pts)} ${word} points`)}</span>` +
        (rank !== null ? `<span>${escapeHtml(`${pos}${rank} that week`)}</span>` : "") +
        (c.result ? `<span>${escapeHtml(`${RESULT_WORD[c.result]} ${c.score ?? ""}`.trim())}</span>` : "") +
        `</span>${x}</li>`
      );
    })
    .join("");

  const caption =
    `${titleCase(word === "fantasy" ? "Fantasy" : word)} points by week. Gold bars are top-${line} ${pos} weeks; ` +
    `the dashed line is his ${one(avg)}-point average over games played.`;
  return (
    `<figure class="scp-ow-chart">` +
    `<figcaption class="scp-ow-cap">${escapeHtml(caption)}</figcaption>` +
    `<div class="scp-ow-plot" style="--n:${weeks.length}">` +
    `<span class="scp-ow-grid" aria-hidden="true">` +
    [1, 0.5, 0].map((f) => `<i style="bottom:${(f * 100).toFixed(0)}%"><b>${whole(top * f)}</b></i>`).join("") +
    `</span>` +
    `<span class="scp-ow-avg" style="bottom:${pct(avg)}" aria-hidden="true"><b>${escapeHtml(`Avg ${one(avg)}`)}</b></span>` +
    `<ol class="scp-ow-cols" role="list">${cols.replaceAll("<li ", '<li role="listitem" ')}</ol>` +
    `</div></figure>`
  );
}

function renderNext(data: PlayerPageData, s: Season): string {
  if (s.next.length === 0) return "";
  const pos = s.pos;
  const out = (() => {
    const status = (data.designation?.injuryStatus ?? data.player.injury_status ?? "").trim();
    return status !== "" && designationSeverity(status) === "out";
  })();
  let first = true;
  const rows = s.next
    .map((g) => {
      if ("bye" in g) {
        return `<li class="scp-ow-g is-bye"><span class="scp-ow-gw"><span class="scp-sr">Week </span><span aria-hidden="true">W</span>${g.bye}</span><span class="scp-ow-go">Bye</span><span></span><span></span></li>`;
      }
      const isNext = first;
      first = false;
      const m = g.matchup;
      const band = m ? matchupBand(m.rank) : null;
      const chip = band ? CHIP_WORD[band] : null;
      const logo = g.opponent?.logo
        ? `<img class="scp-ow-logo" src="${escapeHtml(g.opponent.logo)}" alt="" width="20" height="20" loading="lazy" decoding="async" />`
        : "";
      const code = escapeHtml(g.opponent?.code ?? g.opponentCode);
      const where = g.homeAway === "away" ? `<span aria-hidden="true">@ </span><span class="scp-sr">at </span>` : "vs ";
      return (
        `<li class="scp-ow-g${isNext ? " is-next" : ""}">` +
        `<span class="scp-ow-gw"><span class="scp-sr">Week </span><span aria-hidden="true">W</span>${g.week}</span>` +
        `<span class="scp-ow-go">${logo}${where}${code}</span>` +
        (m
          ? `<span class="scp-ow-gr">${ordinal(m.rank)}<small> vs ${escapeHtml(pos)}</small></span>`
          : `<span class="scp-ow-gr is-muted">${DASH}</span>`) +
        `<span class="scp-ow-gc">` +
        (isNext && out ? `<span class="scp-ox-chip is-bad">Out</span>` : chip ? `<span class="scp-ox-chip ${chip.cls}">${escapeHtml(titleCase(chip.word))}</span>` : "") +
        `</span></li>`
      );
    })
    .join("");
  const through = data.upcomingMatchupMode ?? "";
  const word = scoringWord(pos, data.format);
  const note =
    `Rank = ${word} points allowed to ${pos}s` +
    (/^Week/.test(through) ? ` through ${through}` : through ? ` (${through.toLowerCase()})` : "") +
    `. 1st allows the most. 1st-10th favorable, 23rd-32nd tough.`;
  return (
    `<div class="scp-ow-next">` +
    `<h3 class="scp-ow-h3">Upcoming</h3>` +
    `<ol class="scp-ow-games" role="list">${rows.replaceAll("<li ", '<li role="listitem" ')}</ol>` +
    `<p class="scp-ow-note">${escapeHtml(note)}</p>` +
    `</div>`
  );
}

function renderWeekly(data: PlayerPageData, s: Season, options: PlayerRenderOptions): string {
  const chart = s.current ? renderChart(data, s, options) : "";
  const next = renderNext(data, s);
  if (!chart && !next) return "";
  const href = tabHref(data, options, "game-log");
  return (
    sectionOpen("scp-ox-weekly-h", `${data.player.name} weekly performance & upcoming schedule`, "scp-ox-weekly", "weekly") +
    `<div class="scp-ow${chart && next ? "" : " is-one"}">${chart}${next}</div>` +
    (chart && href ? more(href, "View full game log") : "") +
    SECTION_END
  );
}

/* --------------------------------------- 3. fantasy outlook + efficiency */

/** The volume a position is read by, per game: attempts, touches, targets. */
function volumeOf(pos: string, e: GameLogEntry): { n: number; noun: string } | null {
  const v = (x: number | null | undefined): number => (typeof x === "number" ? x : 0);
  const st = e.stats;
  if (pos === "QB") return { n: v(st.pass_att), noun: "pass attempts" };
  if (pos === "RB") return { n: v(st.rush_att) + v(st.rec_tgt), noun: "carries plus targets" };
  if (pos === "WR" || pos === "TE") return { n: v(st.rec_tgt), noun: "targets" };
  return null;
}

/** The paragraph: role, rank, consistency, efficiency, trend, what is ahead. */
function outlookParagraph(data: PlayerPageData, s: Season, rank: number | null): string {
  const { pos, played } = s;
  const last = lastName(data.player.name);
  const sentences: string[] = [];
  const scoring = scoringWord(pos, data.format);

  // 1. Role and rank.
  const depth = data.depth;
  const club = data.team ? possessive(data.team.nickname) : null;
  const role =
    depth && club
      ? depth.order === 1 && ["QB", "RB", "TE", "K"].includes(pos)
        ? `${last} is the ${club} starting ${pos === "QB" ? "quarterback" : pos === "RB" ? "running back" : pos === "TE" ? "tight end" : "kicker"}`
        : `${last} is the ${depth.position}${depth.order} on the ${club} depth chart`
      : last;
  const rate = played.reduce((a, e) => a + s.pts(e), 0) / played.length;
  sentences.push(
    rank
      ? `${role}${role === last ? " ranks" : " and ranks"} ${pos}${rank} in ${scoring} points per game (${one(rate)}).`
      : `${role}${role === last ? " is" : " and is"} averaging ${one(rate)} ${scoring} points per game.`,
  );

  // 2. Consistency, against the one starter line.
  const ranks = played.map((e) => e.pos_rank).filter((r): r is number => typeof r === "number");
  if (ranks.length >= 3) {
    const line = starterLine(pos);
    const hits = ranks.filter((r) => r <= line).length;
    const share = hits / ranks.length;
    const read = share >= 0.7 ? "a reliable weekly floor" : share >= 0.4 ? "an uneven week-to-week line" : "a volatile weekly floor";
    sentences.push(`He has finished as a top-${line} ${pos} in ${hits === 0 ? "none" : word(hits)} of ${word(ranks.length)} games, ${read}.`);
  }

  // 3. Efficiency: the strongest and the weakest percentile, when they stand out.
  const meters = data.meters?.meters ?? null;
  if (meters && meters.length >= 2) {
    const sorted = [...meters].sort((x, y) => y.percentile - x.percentile);
    const best = sorted[0]!;
    const worst = sorted[sorted.length - 1]!;
    // Sentence case that keeps acronyms: "TD rate", "completion rate".
    const lower = (t: string): string => t.replace(/\b([A-Z])([a-z])/g, (_, a: string, b: string) => a.toLowerCase() + b);
    const phrase = (m: { label: string; percentile: number }): string => `${lower(m.label)} (${ordinal(m.percentile)} percentile)`;
    if (best.percentile >= 65 && worst.percentile <= 35) sentences.push(`His ${phrase(best)} is a strength; his ${phrase(worst)} holds him back.`);
    else if (best.percentile >= 65) sentences.push(`His efficiency backs it up, led by his ${phrase(best)}.`);
    else if (worst.percentile <= 35) sentences.push(`Efficiency is the concern, with his ${phrase(worst)} below most of his peers.`);
    else sentences.push(`His efficiency sits close to the league middle across the board.`);
  }

  // 4. Usage trend: the last three games against the season, when it moved.
  const vol = played.map((e) => volumeOf(pos, e)).filter((v): v is { n: number; noun: string } => v !== null);
  if (vol.length >= 5) {
    const season = vol.reduce((a, v) => a + v.n, 0) / vol.length;
    const recent = vol.slice(-3).reduce((a, v) => a + v.n, 0) / 3;
    if (season > 0 && Math.abs(recent - season) / season >= 0.15) {
      sentences.push(
        `His volume is ${recent > season ? "up" : "down"} lately: ${one(recent)} ${vol[0]!.noun} a game over the last three, against ${one(season)} for the season.`,
      );
    }
  }

  // 5. What is ahead: how the next four grade, never a promise. A player
  // ruled out gets his status instead: the schedule is moot until he returns.
  const status = (data.designation?.injuryStatus ?? data.player.injury_status ?? "").trim();
  const ahead = s.next.filter((g): g is UpcomingGame => !("bye" in g) && Boolean(g.matchup));
  if (status && designationSeverity(status) === "out") {
    const listed = /^ir\b/i.test(status) || /injured reserve/i.test(status) ? "on injured reserve" : `listed ${status.toLowerCase()}`;
    sentences.push(`He is ${listed}, so his value rests on the timing of his return.`);
  } else if (ahead.length >= 2) {
    const soft = ahead.filter((g) => matchupBand(g.matchup!.rank) === "soft").length;
    const tough = ahead.filter((g) => matchupBand(g.matchup!.rank) === "tough").length;
    const n = ahead.length;
    if (soft >= 2) sentences.push(`${titleCase(word(soft))} of his next ${word(n)} matchups grade favorable.`);
    else if (tough >= 2) sentences.push(`${titleCase(word(tough))} of his next ${word(n)} matchups grade tough, a reason to temper expectations.`);
  }
  const tier = data.fantasyOutlook2026?.restOfSeason;
  if (tier && sentences.length < 5) sentences.push(`Our rest-of-season tier: ${tier}.`);

  // The brief's 40-70 words: the role-and-rank and consistency sentences
  // always, then the rest in order while they fit.
  const kept: string[] = [];
  let words = 0;
  for (const [i, sentence] of sentences.entries()) {
    const n = sentence.split(/\s+/).length;
    if (i >= 2 && words + n > 70) continue;
    kept.push(sentence);
    words += n;
  }
  return kept.join(" ");
}

function renderMeters(data: PlayerPageData, s: Season): string {
  const m = data.meters;
  if (!m?.meters?.length || s.played.length === 0) return "";
  const rows = m.meters
    .map((meter) => {
      const p = meter.percentile;
      const tone = p >= 70 ? "good" : p >= 30 ? "mid" : "bad";
      const words = p >= 70 ? "above average" : p >= 40 ? "about average" : p >= 20 ? "below average" : "near the bottom";
      return (
        `<li class="scp-ox-eff">` +
        `<span class="scp-ox-eff-l">${escapeHtml(meter.label)}</span>` +
        `<b class="scp-ox-eff-v">${escapeHtml(meter.value)}</b>` +
        `<span class="scp-ox-eff-bar" aria-hidden="true"><i class="is-${tone}" style="width:${Math.max(2, p)}%"></i></span>` +
        `<span class="scp-ox-eff-p">${escapeHtml(`${ordinal(p)} pct`)}<span class="scp-sr">ile</span><span class="scp-ox-eff-w">${escapeHtml(`, ${words}`)}</span></span>` +
        `</li>`
      );
    })
    .join("");
  const note = `Percentile vs. every ${m.position} with at least ${m.threshold} ${m.unit} in ${m.season}.`;
  return (
    `<div class="scp-ox-effs">` +
    `<h3 class="scp-ow-h3">Efficiency</h3>` +
    `<ul class="scp-ox-eff-list" role="list">${rows}</ul>` +
    `<p class="scp-ow-note">${escapeHtml(note)}</p>` +
    `</div>`
  );
}

function renderOutlook(data: PlayerPageData, s: Season, options: PlayerRenderOptions): string {
  const name = data.player.name;
  const last = lastName(name);
  const pos = s.pos;
  const redraft = redraftPlayerUrl(data.player);
  const rank = s.played.length ? seasonRank(data) : null;

  let call = "";
  let para = "";
  if (s.played.length === 0) {
    // Preseason, or no games yet: the outlook's own take is the read, and
    // there is no rank to grade him on.
    const o = data.fantasyOutlook2026;
    const text = (o?.quickTake ?? o?.body?.split(/\n{2,}/)[0] ?? "").trim();
    if (!text) return "";
    para = escapeHtml(text);
  } else {
    if (rank && pos) {
      const c = fantasyCall(pos, rank, data.rosterPct ? data.rosterPct.owned : null);
      call =
        `<p class="scp-ox-call is-${c.tone}"><span class="scp-sr">Recommendation: </span>${escapeHtml(c.label)} ` +
        `<span class="scp-ox-call-sub">${escapeHtml(`${pos}${rank} by points per game, ${plural(s.played.length, "game")}`)}</span></p>`;
    }
    para = escapeHtml(outlookParagraph(data, s, rank));
  }

  const startHref = startSitHref(data, options);
  // The phone's "Should I start" (mak, 2026-11-05): moved out of the header
  // to where the answer is; player.css shows it at 560px and under.
  const startLink = startHref
    ? `<a class="scp-ox-startsit" href="${escapeHtml(startHref)}" data-cta="startsit-overview-mobile" data-scp-cta="startsit-header">${escapeHtml(`Should I start ${last}?`)}<span aria-hidden="true">→</span></a>`
    : "";

  return (
    sectionOpen("scp-ox-read-h", `${name} fantasy outlook & efficiency`, "scp-ox-outlook", "outlook") +
    startLink +
    `<div class="scp-ox-read">` +
    `<div class="scp-ox-read-main">${call}<p class="scp-ox-prose">${para}</p></div>` +
    renderMeters(data, s) +
    `</div>` +
    more(redraft, "Analyze in Redraft Command", ` data-cta="redraft-command-sidebar"`) +
    SECTION_END
  );
}

/* ------------------------------------------------------- 4. latest news */

function renderNews(data: PlayerPageData, options: PlayerRenderOptions): string {
  const brief = renderNewsBrief(data, options, 3);
  if (!brief) return "";
  return sectionOpen("scp-ox-news-h", `${data.player.name} latest news`, "", "news") + brief + SECTION_END;
}

/* ------------------------------------------------ 5. career + background */

/** Facts the header prints already, by label: never repeated here. */
const IN_HEADER = /^(age|height|weight|colleges?|jersey|number|experience|nfl experience|team|position|drafted|draft)$/i;

function careerLine(data: PlayerPageData, pos: string): { totals: string; span: string } | null {
  const rows = data.statsProfile?.career ?? [];
  if (rows.length === 0) return null;
  // Only when the rows reach back to his first season: a total over the part
  // the logs cover is not his career total.
  const first = Math.min(...rows.map((r) => r.season));
  const entry = data.bioPage?.raw.draft?.year ?? data.bioPage?.raw.undrafted?.year ?? data.bioProfile?.draft?.year ?? null;
  if (entry === null || first > entry) return null;
  const sum = (f: (r: (typeof rows)[number]) => number): number => rows.reduce((a, r) => a + f(r), 0);
  const gp = sum((r) => r.gamesPlayed);
  if (!gp) return null;
  const span = `${first}-${Math.max(...rows.map((r) => r.season))}`;
  let totals: string | null = null;
  if (pos === "QB") totals = `${plural(gp, "game")}, ${whole(sum((r) => r.totals.passYd))} passing yards, ${whole(sum((r) => r.totals.passTd))} passing TD`;
  else if (pos === "RB") totals = `${plural(gp, "game")}, ${whole(sum((r) => r.totals.rushYd))} rushing yards, ${whole(sum((r) => r.totals.rushTd + r.totals.recTd))} total TD`;
  else if (pos === "WR" || pos === "TE") totals = `${plural(gp, "game")}, ${whole(sum((r) => r.totals.rec))} catches, ${whole(sum((r) => r.totals.recYd))} receiving yards, ${whole(sum((r) => r.totals.recTd))} TD`;
  return totals ? { totals, span } : null;
}

function renderBackground(data: PlayerPageData, s: Season, options: PlayerRenderOptions): string {
  const { player } = data;
  const page = data.bioPage;

  /* ---- highlights: only what the fact store vouches for ---- */
  const honors: string[] = [];
  for (const sb of page?.superBowls ?? []) honors.push(`Super Bowl ${sb.name} champion`);
  const quick = page?.quick ?? [];
  const count = (label: string): number => Number(quick.find((f) => f.label === label)?.value ?? 0) || 0;
  const pro = count("Pro Bowls");
  if (pro) honors.push(`${plural(pro, "Pro Bowl")}`);
  const allPro = count("All-Pro");
  // "All-Pro": the store does not say first or second team, so neither is claimed.
  if (allPro) honors.push(`${allPro}x All-Pro`);
  const career = ["QB", "RB", "WR", "TE"].includes(s.pos) ? careerLine(data, s.pos) : null;

  /* ---- background: the bio facts the header does not carry ---- */
  const facts: Array<[string, string]> = [];
  const source = quick.length ? quick : data.bioProfile?.facts ?? [];
  for (const f of source) {
    if (IN_HEADER.test(f.label) || /^(pro bowls|all-pro|super bowls?)$/i.test(f.label)) continue;
    facts.push([f.label, f.value]);
  }
  // The header prints the draft slot; the club that made the pick is new.
  const draftTeam = page?.raw.draft?.team ?? data.bioProfile?.draft?.teamCode ?? null;
  const by = draftTeam ? getTeamByAbbreviation(draftTeam) : null;
  if (by) facts.push(["Drafted by", by.fullName]);
  else if (page?.raw.undrafted) facts.push(["Entered the NFL", `Undrafted, ${page.raw.undrafted.year}`]);

  if (!honors.length && !career && facts.length < 2) return "";
  const statsHref = tabHref(data, options, "stats");
  const bioHref = tabHref(data, options, "bio");
  // Two cards side by side (mak's brief, 2026-11-06): navy heads with a gold
  // icon, rule and diagonals; the honors as gold pills over the career
  // totals; the background facts in a two-column grid, each with its icon.
  const card = (kind: string, icon: string, id: string, title: string, body: string): string =>
    `<section class="scp-ox-bgc is-${kind}" aria-labelledby="${id}">` +
    `<header class="scp-ox-bgc-head"><span class="scp-ox-bgc-icon" aria-hidden="true">${BG_ICON[icon]}</span>` +
    `<span class="scp-ox-bgc-rule" aria-hidden="true"></span><h3 class="scp-ox-bgc-h" id="${id}">${escapeHtml(title)}</h3>` +
    `<span class="scp-ox-bgc-slash" aria-hidden="true"></span></header>` +
    `<div class="scp-ox-bgc-body">${body}</div></section>`;
  const highlights =
    honors.length || career
      ? card(
          "career",
          "trophy",
          "scp-ox-hl-h",
          "Career highlights",
          (honors.length
            ? `<ul class="scp-ox-honors" role="list">${honors.map((h) => `<li><span class="scp-ox-honor-star" aria-hidden="true">${BG_ICON.star}</span>${escapeHtml(h)}</li>`).join("")}</ul>`
            : "") +
            (career
              ? `<div class="scp-ox-career-line"><span class="scp-ox-bgc-ficon" aria-hidden="true">${BG_ICON.bars}</span>` +
                `<p><span class="scp-ox-bgc-k">Career</span> <b class="scp-ox-bgc-total">${escapeHtml(career.totals)}</b> ` +
                `<span class="scp-ox-bgc-span">(${escapeHtml(career.span)})</span></p></div>`
              : ""),
        )
      : "";
  const background = facts.length
    ? card(
        "bg",
        "person",
        "scp-ox-bgf-h",
        "Background",
        `<dl class="scp-ox-about">` +
          facts
            .map(
              ([dt, dd]) =>
                `<div class="scp-ox-bgc-fact"><dt><span class="scp-ox-bgc-ficon" aria-hidden="true">${BG_ICON[factIcon(dt)]}</span>${escapeHtml(dt)}</dt><dd>${escapeHtml(dd)}</dd></div>`,
            )
            .join("") +
          `</dl>`,
      )
    : "";
  return (
    sectionOpen("scp-ox-about-h", `${player.name} career & background`, "scp-ox-bg", "career") +
    `<div class="scp-ox-bgc-grid${highlights && background ? "" : " is-one"}">${highlights}${background}</div>` +
    `<p class="scp-ox-links">` +
    (statsHref ? more(statsHref, "Full career stats") : "") +
    (bioHref ? more(bioHref, `${possessive(lastName(player.name))} timeline and biography`) : "") +
    `</p>` +
    SECTION_END
  );
}

/** The cards' line icons: 24px grid, stroke only. */
const BG_SVG = (body: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">${body}</svg>`;
const BG_ICON: Record<string, string> = {
  trophy: BG_SVG(`<path d="M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 20h8"/>`),
  person: BG_SVG(`<circle cx="12" cy="8" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>`),
  star: BG_SVG(`<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>`),
  bars: BG_SVG(`<path d="M5 20V12M10 20V6M15 20v-9M20 20V9M3 20h18"/>`),
  calendar: BG_SVG(`<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>`),
  pin: BG_SVG(`<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>`),
  cap: BG_SVG(`<path d="M2.5 9.5 12 5l9.5 4.5L12 14z"/><path d="M6.5 11.5V16c1.5 1.5 3.5 2.2 5.5 2.2s4-.7 5.5-2.2v-4.5M21.5 9.5V15"/>`),
  group: BG_SVG(`<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.3"/><path d="M15.5 14.2A4.5 4.5 0 0 1 21 18.5"/>`),
  football: BG_SVG(`<ellipse cx="12" cy="12" rx="9" ry="5.5" transform="rotate(-35 12 12)"/><path d="M9.5 14.5l5-5M11 11.5l1.5 1.5M12.5 10l1.5 1.5"/>`),
  info: BG_SVG(`<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.8v.2"/>`),
};

/** Each background fact's icon, by its label. */
function factIcon(label: string): string {
  const l = label.toLowerCase();
  if (/^born|birth ?date/.test(l)) return "calendar";
  if (/birthplace|hometown/.test(l)) return "pin";
  if (/school|college/.test(l)) return "cap";
  if (/^teams?$/.test(l)) return "group";
  if (/draft|entered the nfl/.test(l)) return "football";
  return "info";
}

/* ------------------------------------------------------- the lead head */

/**
 * The tab's first section bar wears the team pages' tab header (tab-head.ts;
 * mak, 2026-11-06), with a dek; the sections under it keep their bars.
 */
function leadHead(data: PlayerPageData, s: Season, html: string): string {
  const name = lastName(data.player.name);
  const DEK: Record<string, string> = {
    "scp-ox-season-h": `${possessive(name)} ${s.leagueSeason} season so far: games, volume, touchdowns and fantasy points.`,
    "scp-ox-weekly-h": `Fantasy points by week and his next four matchups.`,
    "scp-ox-read-h": `Where he ranks, what it means for your lineup, and how efficient he has been.`,
    "scp-ox-news-h": `The latest reports on ${name}, newest first.`,
    "scp-ox-about-h": `Career totals, honors and background.`,
  };
  return html.replace(
    /<header class="scp-ovp-bar">(<span class="scp-ovp-bar-icon">[\s\S]*?<\/span>)<h2 class="scp-ovp-bar-title" id="([^"]+)">([\s\S]*?)<\/h2>/,
    (_m, icon: string, id: string, title: string) =>
      `<header class="scp-ovp-bar scp-up-head">${headIcon("overview")}${icon}` +
      `<div class="scp-up-head-text"><h2 class="scp-ovp-bar-title scp-up-h2" id="${id}">${title}</h2>` +
      (DEK[id] ? `<p class="scp-up-dek">${escapeHtml(DEK[id]!)}</p>` : "") +
      `</div>${headArt("overview")}`,
  );
}

/* ---------------------------------------------------------------- FAQ */

function renderFaq(data: PlayerPageData, options: PlayerRenderOptions): string {
  // Fantasy value only (faq-pools.ts): injury, bio facts, totals and single
  // games are the other tabs' questions.
  return renderFaqSection("overview", data, selectFaq(overviewPool(data, options)), options);
}

/* ------------------------------------------------------------ the tab */

/**
 * The Overview, in the redesign's order. `extras.peers` is the profile's own
 * peers rail (renderPositionPeers in player-render.ts), above the FAQ.
 */
export function renderOverviewSections(
  data: PlayerPageData,
  options: PlayerRenderOptions = {},
  extras: { peers?: string } = {},
): string {
  const s = season(data);
  const ink = teamInk(data.team);
  const open = `<div class="scp-ox"${ink ? ` style="--scp-team:${escapeHtml(ink)}"` : ""}>`;
  const before = leadHead(
    data,
    s,
    renderAlert(data, options) +
      renderSeasonStats(data, s, options) +
      renderWeekly(data, s, options) +
      renderOutlook(data, s, options) +
      renderNews(data, options) +
      renderBackground(data, s, options),
  );
  const faq = renderFaq(data, options);
  return (
    (before ? `${open}${before}</div>` : "") +
    (extras.peers ?? "") +
    (faq ? `${open}${faq}</div>` : "")
  );
}
