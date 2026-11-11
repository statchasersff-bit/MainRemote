/**
 * The completed game's Betting tab (mak, 2026-11-08; consolidated 2026-11-09
 * from a reviewer's critique: the old result panel, Betting Results and
 * Actual vs Implied told the same outcome three times, and two trend blocks
 * repeated the same records). Three sections, one fine print:
 *
 *   01 Game Results vs Closing Odds   spread, total and moneyline in one row,
 *                                     then each team's actual vs implied points
 *                                     on one scale and one sentence
 *   02 Opening vs Closing Lines       one sportsbook's open and close with a
 *                                     Movement column
 *   03 Betting Trends                 one two-team table through THIS game:
 *                                     season, last five, favorite / underdog /
 *                                     venue splits; streak chips (oldest to
 *                                     newest), game lists, the series line
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

function card(kind: string, eyebrow: string, big: string, line: string): string {
  return (
    `<div class="sct-bm-card is-${kind}">` +
    `<p class="sct-bm-eyebrow">${e(eyebrow)}</p>` +
    `<p class="sct-bm-big">${big}</p>` +
    `<p class="sct-bm-line">${line}</p>` +
    `</div>`
  );
}

function renderResults(input: BettingMarketInput, spread: number, store: StoredOdds | null): string {
  const { game } = input;
  const result = scoreboardResult(game)!;
  const total = input.odds.total!;
  const line = Math.abs(spread);
  const favSide: Side | null = spread < 0 ? "home" : spread > 0 ? "away" : null;
  const dogSide: Side | null = favSide ? (favSide === "home" ? "away" : "home") : null;

  // Spread: the side that covered, at its own number.
  let spreadCard: string;
  if (favSide && dogSide) {
    const favMargin = result[favSide] - result[dogSide];
    const cover = favMargin - line;
    if (cover === 0) {
      spreadCard = card("push", "Spread", `${e(game[favSide].abbr)} ${MINUS}${e(trim(line))}`, "Push");
    } else {
      const side = cover > 0 ? favSide : dogSide;
      const num = side === favSide ? `${MINUS}${trim(line)}` : `+${trim(line)}`;
      const extra = side === dogSide && favMargin < 0 ? ", won outright" : "";
      spreadCard = card("cover", "Spread", `${e(game[side].abbr)} ${e(num)}`, `Covered by ${e(trim(Math.abs(cover)))}${extra}`);
    }
  } else {
    const margin = result.home - result.away;
    spreadCard =
      margin === 0
        ? card("push", "Spread", "Pick'em", "Push")
        : card("cover", "Spread", `${e(game[margin > 0 ? "home" : "away"].abbr)} PK`, `Covered by ${Math.abs(margin)}`);
  }
  const cards = [spreadCard];

  const points = result.away + result.home;
  const off = Math.abs(points - total);
  const ou = points > total ? "Over" : points < total ? "Under" : "Push";
  cards.push(
    card(
      ou.toLowerCase(),
      "Game total",
      `${points} pts`,
      ou === "Push" ? `Push on ${e(trim(total))}` : `${ou} ${e(trim(total))} by ${e(trim(off))}`,
    ),
  );

  // Moneyline: only with the stored close, and not for a tie.
  const ml = store?.close.moneyline;
  if (ml && ml.away !== null && ml.home !== null && result.winner) {
    const w = result.winner;
    const l: Side = w === "home" ? "away" : "home";
    const favorite = ml[w]! < ml[l]!;
    cards.push(
      card(
        "ml",
        "Moneyline",
        `${e(game[w].abbr)} ${e(american(ml[w]!))}`,
        `${favorite ? "Favorite" : "Underdog"} won <span>· ${e(game[l].abbr)} ${e(american(ml[l]!))}</span>`,
      ),
    );
  }

  // Actual vs market-implied: one bar per team, the implied figure a marker
  // on the same scale, green / red only on the difference.
  const implied: Record<Side, number> = { home: (total - spread) / 2, away: (total + spread) / 2 };
  const scale = Math.max(1, ...SIDES.flatMap((k) => [implied[k], result[k]]));
  const w = (v: number): string => `${Math.max(0, Math.min(100, Math.round((v / scale) * 1000) / 10))}%`;
  const rows = SIDES.map((k) => {
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
  const diffs = SIDES.map((k) => result[k] - implied[k]);
  const fantasy = `<a href="#fantasy-recap">Fantasy tab</a>`;
  const lead =
    diffs.every((d) => d < 0)
      ? `Both offenses finished below the market's expectation; the ${fantasy} has the player lines.`
      : diffs.every((d) => d > 0)
        ? `Both offenses beat the market's expectation; the ${fantasy} shows who cashed in.`
        : (() => {
            const hi: Side = diffs[0]! >= diffs[1]! ? "away" : "home";
            const lo: Side = hi === "away" ? "home" : "away";
            return `${e(`The ${game[hi].short} beat their implied total and the ${game[lo].short} fell short of theirs;`)} the ${fantasy} has the player lines.`;
          })();
  return section(
    "bm-results",
    "Game Results vs Closing Odds",
    `<div class="sct-bm-cards">${cards.join("")}</div>` +
      `<div class="sct-bm-impbox">` +
      `<div class="sct-bm-imp is-head" aria-hidden="true"><span>Actual vs market-implied points</span>` +
      `<span class="sct-bm-imp-key"><i class="is-actual"></i>Actual <i class="is-implied"></i>Implied</span>` +
      `<span class="sct-bm-imp-num">Actual</span><span class="sct-bm-imp-num">Implied</span><span class="sct-bm-imp-num">vs mkt</span></div>` +
      `<ul class="sct-bm-implist" aria-label="Actual and market-implied points by team">${rows}</ul>` +
      `</div>` +
      `<p class="sct-bm-summary">${lead}</p>`,
  );
}

/* ------------------------------------------- 02 opening vs closing */

function renderMovement(input: BettingMarketInput, store: StoredOdds): string {
  const { game } = input;
  const { open, close } = store;
  const rows: string[] = [];
  const row = (market: string, o: string, c: string, move: string): string =>
    `<tr><th scope="row">${e(market)}</th><td>${e(o)}</td><td>${e(c)}</td><td class="sct-bm-move">${e(move)}</td></tr>`;
  if (open.spread !== null && close.spread !== null) {
    const delta = close.spread - open.spread;
    // Home-signed: a rising number moved toward the away side.
    rows.push(
      row(
        "Spread",
        spreadText(game, open.spread),
        spreadText(game, close.spread),
        delta === 0 ? "No change" : `${trim(Math.abs(delta))} pts toward ${delta > 0 ? game.away.abbr : game.home.abbr}`,
      ),
    );
  }
  if (open.total !== null && close.total !== null) {
    const delta = close.total - open.total;
    rows.push(
      row("Total", trim(open.total), trim(close.total), delta === 0 ? "No change" : `${delta > 0 ? "Up" : "Down"} ${trim(Math.abs(delta))}`),
    );
  }
  const ml = (m: StoredMarket): string | null =>
    m.moneyline.away !== null && m.moneyline.home !== null
      ? `${game.away.abbr} ${american(m.moneyline.away)} · ${game.home.abbr} ${american(m.moneyline.home)}`
      : null;
  if (ml(open) && ml(close)) {
    // A lower home price = more money on the home side.
    const before = open.moneyline.home!;
    const after = close.moneyline.home!;
    const toward = after < before ? game.home.abbr : after > before ? game.away.abbr : null;
    rows.push(row("Moneyline", ml(open)!, ml(close)!, toward ? `Toward ${toward}` : "No change"));
  }
  if (rows.length === 0) return "";
  return section(
    "bm-movement",
    "Opening vs Closing Lines",
    `<div class="sct-bm-wrap"><table class="sct-bm-table is-move">` +
      `<caption class="sct-rb-sr">Opening and closing lines at one sportsbook, with the movement</caption>` +
      `<thead><tr><th scope="col">Market</th><th scope="col">Open</th><th scope="col">Close</th><th scope="col">Movement</th></tr></thead>` +
      `<tbody>${rows.join("")}</tbody></table></div>`,
    "One sportsbook's opening and closing lines. Its close matches the line graded above.",
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
    SIDES.map((k) => `<th scope="col"><i style="background:${input.inks[k]}" aria-hidden="true"></i>${e(game[k].short)}</th>`).join("") +
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

  // Recent results (mak, 2026-11-11, from a reviewer: the "Last N" chips,
  // the collapsed game-by-game tables and the meetings sentence told the same
  // history three ways). One open table: each team's last games, oldest to
  // newest, this game last, with the line, total and both results.
  const recentRows = SIDES.map((k, i) => {
    const abbr = club(k);
    return lists[i]!
      .slice(-n)
      .map((x, at, all) => {
        const g = x.g;
        const home = g.home === abbr;
        const opp = home ? g.away : g.home;
        const us = home ? g.homeScore : g.awayScore;
        const them = home ? g.awayScore : g.homeScore;
        const o = g.odds!;
        const lineNum = o.favorite === null || o.line === 0 ? "PK" : o.favorite === abbr ? `${MINUS}${trim(o.line)}` : `+${trim(o.line)}`;
        const wk = g.seasonType === "post" ? "Playoffs" : `Wk ${g.week}`;
        const first = at === 0;
        return (
          `<tr class="is-${k}${first ? " is-first" : ""}">` +
          (first
            ? `<th scope="rowgroup" rowspan="${all.length}" class="sct-bm-r-team"><i style="background:${input.inks[k]}" aria-hidden="true"></i>${e(abbr)}</th>`
            : "") +
          `<td>${e(wk)}</td><td>${home ? "vs" : "@"} ${e(opp)}</td>` +
          `<td>${us > them ? "W" : us < them ? "L" : "T"} ${us}${DASH}${them}</td>` +
          `<td>${e(lineNum)}</td><td><span class="sct-bm-chip is-${x.ats.toLowerCase()}">${x.ats}</span></td>` +
          `<td>${o.total !== null ? e(trim(o.total)) : "-"}</td>` +
          `<td>${x.ou ? `<span class="sct-bm-chip is-${x.ou.toLowerCase()}">${x.ou}</span>` : "-"}</td></tr>`
        );
      })
      .join("");
  }).join("");
  const recent = recentRows
    ? `<p class="sct-bm-streaks-k">Recent results, oldest to newest <span>(this game last)</span></p>` +
      `<div class="sct-bm-wrap"><table class="sct-bm-table is-games is-recent">` +
      `<caption class="sct-rb-sr">${e(`Each team's last ${n} results against the closing lines ${through}`)}</caption>` +
      `<thead><tr><th scope="col">Team</th><th scope="col">Week</th><th scope="col">Opp</th><th scope="col">Final</th><th scope="col">Line</th><th scope="col">ATS</th><th scope="col">Total</th><th scope="col">O/U</th></tr></thead>` +
      `<tbody>${recentRows}</tbody></table></div>`
    : "";

  return section(
    "bm-trends",
    "Betting Trends",
    table + recent,
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
    (store ? renderMovement(input, store) : "") +
    renderTrends(input) +
    `<div class="sct-bet-fine sct-bm-fine">` +
    `<p>Results and trends are graded against each game's closing line, overtime included. Pushes are counted separately.</p>` +
    `<p>21+. Gambling problem? Call 1-800-GAMBLER. Betting availability depends on your state.</p>` +
    `</div>` +
    `</div>`,
  };
}
