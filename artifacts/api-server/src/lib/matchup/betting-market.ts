/**
 * The completed game's Betting tab (mak, 2026-11-08; consolidated 2026-11-09
 * from a reviewer's critique: the old result panel, Betting Results and
 * Actual vs Implied told the same outcome three times, and two trend blocks
 * repeated the same records). Two sections since 2026-11-27 (mak), one fine
 * print:
 *
 *   01 Game Results vs Closing Odds   one table, a row per market: the result,
 *                                     then Open, Close and Movement (phones fold
 *                                     Open and Movement behind a button); then
 *                                     each team's actual vs implied points
 *   02 Betting Trends                 one card, two columns: the two-team
 *                                     records table through THIS game (season,
 *                                     last five, favorite / underdog / venue,
 *                                     meetings) beside one team's last games
 *                                     behind an away / home switch
 *
 * Player prop results are not built: no stored prop lines.
 *
 * Grading uses the closing spread and total in the stored box score - the same
 * line every trend grades against - and the final score with overtime. Opening
 * lines and moneylines come from data/matchup/odds/<season>.json
 * (scripts/matchup/buildGameOdds.mjs, one book), and are shown only when that
 * file's close agrees with the box score's. A market neither source has is
 * left out. No sportsbook name is printed. No final score either: the header
 * has it.
 */

import { escapeHtml } from "../render";
import { dataPath } from "../data-dir";
import { readDataJson } from "../team/read-json";
import type { GameOdds } from "./boxscore";
import { againstSpread, againstTotal, seasonGames, upTo, type SeasonGame } from "./season-data";
import { scoreboardResult, type ScoreboardGame } from "./scoreboard-hero";

const e = escapeHtml;
const MINUS = "−";
const DASH = "–";

/* ------------------------------------------------------------------ store */

export interface StoredMarket {
  /** Home-signed: -3 = home favored by 3. */
  spread: number | null;
  total: number | null;
  moneyline: { away: number | null; home: number | null };
}

export interface StoredOdds {
  provider: string | null;
  open: StoredMarket;
  close: StoredMarket;
}

/** One game's stored open and close, or null when the season or game is not stored. */
export function loadGameOdds(season: number, eventId: string | null | undefined): StoredOdds | null {
  if (!eventId) return null;
  const doc = readDataJson<{ games?: Record<string, StoredOdds> }>(dataPath("matchup", "odds", `${season}.json`));
  return doc?.games?.[eventId] ?? null;
}

/* ------------------------------------------------------------------ input */

type Side = "away" | "home";
const SIDES: readonly Side[] = ["away", "home"];

export interface BettingMarketInput {
  game: ScoreboardGame;
  /** The box score's closing line: what everything is graded against. */
  odds: GameOdds;
  stored: StoredOdds | null;
  season: number;
  through: { seasonType: "regular" | "post"; week: number };
  inks: Record<Side, string>;
  /** The pair's stored meetings with lines, newest first, this one included. */
  meetings?: SeasonGame[];
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

function american(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `${MINUS}${Math.abs(n)}` : "EVEN";
}

function signedPts(n: number): string {
  const r = Math.round(n * 100) / 100;
  return r > 0 ? `+${trim(r)}` : r < 0 ? `${MINUS}${trim(Math.abs(r))}` : "0";
}

function section(id: string, title: string, body: string, sub = ""): string {
  return (
    `<section class="sct-rb-section sct-bm" aria-labelledby="${id}">` +
    // The sub sits in the head row beside the title (mak, 2026-11-11).
    (sub
      ? `<div class="sct-fp-head sct-gfp-head"><h2 class="sct-rb-h2" id="${id}">${e(title)}</h2>` +
        `<p class="sct-rb-sub sct-bm-sub">${e(sub)}</p></div>`
      : `<h2 class="sct-rb-h2" id="${id}">${e(title)}</h2>`) +
    body +
    `</section>`
  );
}

/** "SEA −3" for a home-signed spread, "Pick'em" at zero. */
function spreadText(game: ScoreboardGame, homeSigned: number): string {
  if (homeSigned === 0) return "Pick'em";
  const fav = homeSigned < 0 ? game.home.abbr : game.away.abbr;
  return `${fav} ${MINUS}${trim(Math.abs(homeSigned))}`;
}

/** The box score's close as a home-signed spread, or null when its favorite is not one of the two clubs. */
function closeSpread(input: BettingMarketInput): number | null {
  const { odds, game } = input;
  if (odds.favorite === null || odds.line === 0) return 0;
  if (odds.favorite === game.home.abbr) return -odds.line;
  if (odds.favorite === game.away.abbr) return odds.line;
  return null;
}

/** The stored file, only when its close is the line this page grades against. */
function trustedStore(input: BettingMarketInput, spread: number): StoredOdds | null {
  const s = input.stored;
  if (!s) return null;
  return s.close.spread === spread && s.close.total === input.odds.total ? s : null;
}

/* ------------------------------------- 01 results vs closing odds */

/**
 * One row per market (mak, 2026-11-27): the result first, then the line it
 * was graded against with its history (Open, Close, Movement) beside it. The
 * separate Opening vs Closing Lines card is gone. Open and Movement are the
 * line-history columns a phone folds behind "Show line history".
 */
interface MarketRow {
  market: string;
  tone: string;
  result: string;
  open: string | null;
  close: string;
  move: string | null;
}

function marketRows(input: BettingMarketInput, spread: number, store: StoredOdds | null): MarketRow[] {
  const { game } = input;
  const result = scoreboardResult(game)!;
  const total = input.odds.total!;
  const line = Math.abs(spread);
  const favSide: Side | null = spread < 0 ? "home" : spread > 0 ? "away" : null;
  const dogSide: Side | null = favSide ? (favSide === "home" ? "away" : "home") : null;
  const open = store?.open ?? null;
  const rows: MarketRow[] = [];

  // Spread: the side that covered, at its own number.
  let tone = "push";
  let res: string;
  if (favSide && dogSide) {
    const favMargin = result[favSide] - result[dogSide];
    const cover = favMargin - line;
    if (cover === 0) {
      res = `Push at <b>${e(spreadText(game, spread))}</b>`;
    } else {
      tone = "cover";
      const side = cover > 0 ? favSide : dogSide;
      const num = side === favSide ? `${MINUS}${trim(line)}` : `+${trim(line)}`;
      const extra = side === dogSide && favMargin < 0 ? ", won outright" : "";
      res = `<b>${e(`${game[side].abbr} ${num}`)}</b> covered by\u00a0${e(trim(Math.abs(cover)))}${extra}`;
    }
  } else {
    const margin = result.home - result.away;
    if (margin === 0) res = "Push at <b>Pick'em</b>";
    else {
      tone = "cover";
      res = `<b>${e(game[margin > 0 ? "home" : "away"].abbr)} PK</b> covered by\u00a0${Math.abs(margin)}`;
    }
  }
  const spreadOpen = open && open.spread !== null ? open.spread : null;
  rows.push({
    market: "Spread",
    tone,
    result: res,
    open: spreadOpen !== null ? spreadText(game, spreadOpen) : null,
    close: spreadText(game, spread),
    move:
      spreadOpen === null
        ? null
        : spread === spreadOpen
          ? "No change"
          : // Home-signed: a rising number moved toward the away side.
            `${trim(Math.abs(spread - spreadOpen))} pts toward ${spread > spreadOpen ? game.away.abbr : game.home.abbr}`,
  });

  const points = result.away + result.home;
  const off = Math.abs(points - total);
  const ou = points > total ? "Over" : points < total ? "Under" : "Push";
  const totalOpen = open && open.total !== null ? open.total : null;
  rows.push({
    market: "Total",
    tone: ou.toLowerCase(),
    result: `<b>${points} pts</b> · ${ou === "Push" ? "Push" : `${ou} by\u00a0${e(trim(off))}`}`,
    open: totalOpen !== null ? trim(totalOpen) : null,
    close: trim(total),
    move: totalOpen === null ? null : totalOpen === total ? "No change" : `${total > totalOpen ? "Up" : "Down"} ${trim(Math.abs(total - totalOpen))}`,
  });

  // Moneyline: only with the stored close, and not for a tie.
  const ml = (m: StoredMarket): string | null =>
    m.moneyline.away !== null && m.moneyline.home !== null
      ? // Each side's price held together, so a phone wraps at the slash.
        `${game.away.abbr}\u00a0${american(m.moneyline.away)} / ${game.home.abbr}\u00a0${american(m.moneyline.home)}`
      : null;
  const cm = store?.close.moneyline;
  if (store && cm && cm.away !== null && cm.home !== null && result.winner) {
    const w = result.winner;
    const hasOpen = open !== null && ml(open) !== null;
    // A lower home price = more money on the home side.
    const before = open?.moneyline.home ?? null;
    const toward = before === null ? null : cm.home < before ? game.home.abbr : cm.home > before ? game.away.abbr : null;
    rows.push({
      market: "Moneyline",
      tone: "ml",
      result: `<b>${e(game[w].abbr)}</b> won at ${e(american(cm[w]!))}`,
      open: hasOpen ? ml(open!) : null,
      close: ml(store.close)!,
      move: hasOpen ? (toward ? `Toward ${toward}` : "No change") : null,
    });
  }
  return rows;
}

function renderResults(input: BettingMarketInput, spread: number, store: StoredOdds | null): string {
  const { game } = input;
  const result = scoreboardResult(game)!;
  const total = input.odds.total!;
  const rows = marketRows(input, spread, store);
  const hist = rows.some((r) => r.open !== null);
  const H = ` class="sct-bm-hist"`;
  const table =
    `<div class="sct-bm-results" data-bm-results>` +
    `<div class="sct-bm-wrap"><table class="sct-bm-table is-results">` +
    `<caption class="sct-rb-sr">How the game finished against the closing spread, total and moneyline${hist ? ", with the opening line and the movement" : ""}</caption>` +
    `<thead><tr><th scope="col">Market</th><th scope="col">Result</th>` +
    (hist ? `<th scope="col"${H}>Open</th>` : "") +
    `<th scope="col">Close</th>` +
    (hist ? `<th scope="col"${H}>Movement</th>` : "") +
    `</tr></thead><tbody>` +
    rows
      .map(
        (r) =>
          `<tr class="is-${r.tone}"><th scope="row">${e(r.market)}</th><td class="sct-bm-res">${r.result}</td>` +
          (hist ? `<td${H}>${e(r.open ?? "-")}</td>` : "") +
          `<td class="sct-bm-close">${e(r.close)}</td>` +
          (hist ? `<td class="sct-bm-hist sct-bm-move">${e(r.move ?? "-")}</td>` : "") +
          `</tr>`,
      )
      .join("") +
    `</tbody></table></div>` +
    (hist
      ? `<button type="button" class="sct-pbp-btn sct-bm-histbtn" data-bm-hist aria-expanded="false" hidden>Show line history</button>`
      : "") +
    `</div>`;

  // Actual vs market-implied: one bar per team, the implied figure a marker
  // on the same scale, green / red only on the difference. The sentence that
  // repeated which side beat its number is gone (mak, 2026-11-27).
  const implied: Record<Side, number> = { home: (total - spread) / 2, away: (total + spread) / 2 };
  const scale = Math.max(1, ...SIDES.flatMap((k) => [implied[k], result[k]]));
  const w = (v: number): string => `${Math.max(0, Math.min(100, Math.round((v / scale) * 1000) / 10))}%`;
  const bars = SIDES.map((k) => {
    const diff = result[k] - implied[k];
    return (
      `<li class="sct-bm-imp">` +
      `<span class="sct-bm-imp-name"><i style="background:${input.inks[k]}" aria-hidden="true"></i>${e(game[k].name)}</span>` +
      `<span class="sct-bm-imp-track" aria-hidden="true"><span class="sct-bm-imp-fill" style="width:${w(result[k])}"></span>` +
      `<span class="sct-bm-imp-mark" style="width:${w(implied[k])}"></span></span>` +
      `<span class="sct-bm-imp-num is-actual">${result[k]}</span>` +
      `<span class="sct-bm-imp-num is-implied">${e(trim(implied[k]))}</span>` +
      `<span class="sct-bm-imp-num is-diff is-${diff > 0 ? "pos" : diff < 0 ? "neg" : "even"}">${e(signedPts(diff))}</span>` +
      `</li>`
    );
  }).join("");
  return section(
    "bm-results",
    "Game Results vs Closing Odds",
    table +
      `<div class="sct-bm-impbox">` +
      `<div class="sct-bm-imp is-head" aria-hidden="true"><span>Actual vs market-implied points</span>` +
      `<span class="sct-bm-imp-key"><i class="is-actual"></i>Actual <i class="is-implied"></i>Implied</span>` +
      `<span class="sct-bm-imp-num">Actual</span><span class="sct-bm-imp-num">Implied</span><span class="sct-bm-imp-num">vs mkt</span></div>` +
      `<ul class="sct-bm-implist" aria-label="Actual and market-implied points by team">${bars}</ul>` +
      `</div>`,
  );
}

/* --------------------------------------------------- 03 trends */

interface Graded {
  g: SeasonGame;
  ats: "W" | "L" | "P";
  ou: "O" | "U" | "P" | null;
}

function graded(input: BettingMarketInput, club: string): Graded[] {
  const { seasonType, week } = input.through;
  return seasonGames(input.season)
    .filter((g) => (g.away === club || g.home === club) && upTo(g, seasonType, week))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((g) => {
      const c = againstSpread(g, club);
      const t = againstTotal(g);
      return c
        ? { g, ats: c === "cover" ? "W" : c === "fail" ? "L" : "P", ou: t ? (t === "over" ? "O" : t === "under" ? "U" : "P") : null }
        : null;
    })
    .filter((x): x is Graded => x !== null);
}

function record(letters: string[], a: string, b: string): string {
  if (letters.length === 0) return DASH;
  const n = (l: string): number => letters.filter((x) => x === l).length;
  const p = n("P");
  return `${n(a)}${DASH}${n(b)}${p ? `${DASH}${p}` : ""}`;
}

function chipList(letters: string[]): string {
  return `<span class="sct-bm-chips">${letters.map((l) => `<span class="sct-bm-chip is-${l.toLowerCase()}">${l}</span>`).join("")}</span>`;
}

/**
 * The pair's priced meetings as letters (up to six, newest first in the
 * store): each side's ATS and the totals. Null under two meetings. Since
 * 2026-11-11 these are two rows of the trends table, not a sentence.
 */
function meetingLetters(input: BettingMarketInput): { n: number; ats: Record<Side, string[]>; ou: string[] } | null {
  const { game } = input;
  const priced = (input.meetings ?? []).filter((g) => g.odds && g.odds.total !== null).slice(0, 6);
  if (priced.length < 2) return null;
  const ats: Record<Side, string[]> = { away: [], home: [] };
  const ou: string[] = [];
  for (const g of priced) {
    for (const k of SIDES) {
      const c = againstSpread(g, game[k].abbr);
      if (c) ats[k].push(c === "cover" ? "W" : c === "fail" ? "L" : "P");
    }
    const t = againstTotal(g);
    if (t) ou.push(t === "over" ? "O" : t === "under" ? "U" : "P");
  }
  return { n: priced.length, ats, ou };
}

function renderTrends(input: BettingMarketInput): string {
  const { game } = input;
  const through =
    input.through.seasonType === "post" ? "through this playoff game" : `through Week ${input.through.week}`;
  const lists = SIDES.map((k) => graded(input, game[k].abbr));
  if (lists.every((l) => l.length === 0)) return "";
  const n = Math.min(5, Math.max(...lists.map((l) => l.length)));

  type Pick = (list: Graded[], k: Side) => string;
  const ats = (list: Graded[]): string[] => list.map((x) => x.ats);
  const ous = (list: Graded[]): string[] => list.map((x) => x.ou).filter((x): x is "O" | "U" | "P" => x !== null);
  const club = (k: Side): string => game[k].abbr;
  const rowsDef: Array<[string, Pick]> = [
    ["Season ATS", (l) => record(ats(l), "W", "L")],
    ["Season O/U (overs first)", (l) => record(ous(l), "O", "U")],
    ...(n > 1 && lists.some((l) => l.length > n)
      ? ([
          [`Last ${n} ATS`, (l) => record(ats(l.slice(-n)), "W", "L")],
          [`Last ${n} O/U`, (l) => record(ous(l.slice(-n)), "O", "U")],
        ] as Array<[string, Pick]>)
      : []),
    ["ATS as favorite", (l, k) => record(ats(l.filter((x) => x.g.odds?.favorite === club(k))), "W", "L")],
    ["ATS as underdog", (l, k) => record(ats(l.filter((x) => x.g.odds?.favorite && x.g.odds.favorite !== club(k))), "W", "L")],
    [
      "ATS at this game's venue",
      (l, k) =>
        `${record(ats(l.filter((x) => (x.g.home === club(k) ? "home" : "away") === k)), "W", "L")} <small>${k === "home" ? "home" : "road"}</small>`,
    ],
  ];
  // The head-to-head record against the lines (was a sentence under the
  // tables until 2026-11-11): two rows here instead.
  const met = meetingLetters(input);
  if (met) {
    rowsDef.push(
      [`Last ${met.n} meetings ATS`, (_l, k) => record(met.ats[k], "W", "L")],
      [`Last ${met.n} meetings O/U`, () => record(met.ou, "O", "U")],
    );
  }
  const table =
    `<div class="sct-bm-wrap"><table class="sct-bm-table is-trends">` +
    `<caption class="sct-rb-sr">${e(`Each team's ${game.seasonLabel} season against the closing lines ${through}`)}</caption>` +
    `<thead><tr><th scope="col">Record</th>` +
    SIDES.map((k) => `<th scope="col"><i style="background:${input.inks[k]}" aria-hidden="true"></i><abbr title="${e(game[k].short)}">${e(game[k].abbr)}</abbr></th>`).join("") +
    `</tr></thead><tbody>` +
    rowsDef
      .map(([label, pick]) => {
        const cells = SIDES.map((k, i) => {
          const v = pick(lists[i]!, k);
          return `<td>${v.startsWith(DASH) ? DASH : v.replace(/^([^<]+)/, (m) => e(m))}</td>`;
        });
        return `<tr><th scope="row">${e(label)}</th>${cells.join("")}</tr>`;
      })
      .join("") +
    `</tbody></table></div>`;

  // Last games beside the trends (mak, 2026-11-27): one team at a time
  // behind an away / home switch (away first on every page), four columns
  // with the related figures joined: "Wk 4 @ BUF", "W 29-26", "W (+7)",
  // "O (49.5)". Oldest to newest, this game last. Without the script both
  // teams' tables show, one under the other.
  const lastTables = SIDES.map((k, i) => {
    const abbr = club(k);
    const games = lists[i]!.slice(-n);
    if (games.length === 0) return "";
    const rows = games
      .map((x) => {
        const g = x.g;
        const home = g.home === abbr;
        const opp = home ? g.away : g.home;
        const us = home ? g.homeScore : g.awayScore;
        const them = home ? g.awayScore : g.homeScore;
        const o = g.odds!;
        const lineNum = o.favorite === null || o.line === 0 ? "PK" : o.favorite === abbr ? `${MINUS}${trim(o.line)}` : `+${trim(o.line)}`;
        const wk = g.seasonType === "post" ? "Playoffs" : `Wk ${g.week}`;
        return (
          `<tr><td>${e(wk)} <span class="sct-bm-opp">${home ? "vs" : "@"} ${e(opp)}</span></td>` +
          `<td>${us > them ? "W" : us < them ? "L" : "T"} ${us}${DASH}${them}</td>` +
          `<td><span class="sct-bm-chip is-${x.ats.toLowerCase()}">${x.ats}</span> <span class="sct-bm-num">(${e(lineNum)})</span></td>` +
          `<td>${x.ou ? `<span class="sct-bm-chip is-${x.ou.toLowerCase()}">${x.ou}</span>` : "-"}` +
          `${o.total !== null ? ` <span class="sct-bm-num">(${e(trim(o.total))})</span>` : ""}</td></tr>`
        );
      })
      .join("");
    return (
      `<div class="sct-bm-last-team" data-bm-team="${k}">` +
      `<table class="sct-bm-table is-games is-last">` +
      `<caption class="sct-rb-sr">${e(`${game[k].name}: last ${games.length} results against the closing lines ${through}, oldest to newest`)}</caption>` +
      `<thead><tr><th scope="col">Wk / Opp</th><th scope="col">Final</th><th scope="col">ATS</th><th scope="col">O/U</th></tr></thead>` +
      `<tbody>${rows}</tbody></table></div>`
    );
  });
  const lastTitle = n === 1 ? "Last Game" : `Last ${n} Games`;
  const last = lastTables.some(Boolean)
    ? `<div class="sct-bm-last" data-bm-last>` +
      `<div class="sct-bm-last-head"><h3 class="sct-bm-h3">${e(lastTitle)}</h3>` +
      `<div class="sct-pbp-filters sct-bm-switch" role="group" aria-label="${e(`Show one team's ${lastTitle.toLowerCase()}`)}" data-bm-switch hidden>` +
      SIDES.map(
        (k) =>
          `<button type="button" class="sct-pbp-filter${k === "away" ? " is-on" : ""}" data-bm-pick="${k}" aria-pressed="${k === "away"}">${e(game[k].abbr)}</button>`,
      ).join("") +
      `</div></div>` +
      `<div class="sct-bm-wrap">${lastTables.join("")}</div>` +
      `<p class="sct-bm-order">Oldest to newest, this game last.</p>` +
      `</div>`
    : "";

  return section(
    "bm-trends",
    "Betting Trends",
    `<div class="sct-bm-cq"><div class="sct-bm-split"><div class="sct-bm-trendcol">${table}</div>${last}</div></div>`,
    `${game.seasonLabel} season ${through}, this game included. Nothing after it counts.`,
  );
}

/* ------------------------------------------------------------------ all */

/**
 * The same, in two parts: Odds and Results (`lead`), which the recap's
 * Betting tab puts inside its header's container (mak, 2026-11-10), and
 * the movement, trends and fine print that follow it (`rest`).
 */
export function renderBettingMarketParts(input: BettingMarketInput): { lead: string; rest: string } | null {
  if (!scoreboardResult(input.game) || input.odds.total === null) return null;
  const spread = closeSpread(input);
  if (spread === null) return null;
  const store = trustedStore(input, spread);
  return {
    lead: renderResults(input, spread, store),
    rest:
    `<div class="sct-bm-block" data-bm-root>` +
    renderTrends(input) +
    `<div class="sct-bet-fine sct-bm-fine">` +
    `<p>Results and trends are graded against each game's closing line, overtime included. Pushes are counted separately.</p>` +
    `<p>21+. Gambling problem? Call 1-800-GAMBLER. Betting availability depends on your state.</p>` +
    `</div>` +
    `</div>`,
  };
}
