/**
 * The hub's current-season overview (mak's "Team Pages - Phase 1" brief,
 * 2026-11-19): what the default tab opens on once the regular season has a
 * final, in place of the preseason fantasy outlook, which moves into a
 * labeled archive under it (renderOutlook in team-render.ts).
 *
 * Every figure is read, never written: the schedule slate (last/next game,
 * the division race), the Stats tab's league table (offense and defense with
 * ranks), the player pages' own game logs (key contributors, so a yardage
 * here is the yardage on the player's profile), the Usage file (snap and
 * target shares, the backfield order, the usage changes) and the Sleeper
 * roster (injury designations, depth order). A block whose source is missing
 * renders nothing; nothing is estimated to fill it.
 *
 * Season-aware by construction: `overviewPhase()` says whether the season
 * has started (a regular-season final exists). Before that the hub keeps the
 * preseason outlook as its default; after the season ends the overview stays
 * and reads as the final word on that season (no next game, final record).
 */

import { escapeHtml, searchKey } from "../render";
import { headshotImg } from "../headshot-html";
import { loadGameLogs, loadPlayers } from "../player/data";
import { getEntryPoints } from "../player/scoring";
import { hasParticipation } from "../player/ranks";
import type { GameLogEntry } from "../player/types";
import type { TeamPageData } from "./team-data";
import type { NflTeam } from "./teams";
import type { RosterPlayer } from "./roster";
import { lastResult, nextGame, recordThrough, type ScheduleGame, type TeamSchedule } from "./schedule";
import type { StatRow } from "./stats";
import type { UsagePlayer, UsageView } from "./usage";
import { usageTrends } from "./usage-copy";
import { premiumTabHead } from "./premium-head";
import { getPlayerProfileUrl } from "./links";
import {
  gameDateLine,
  gameMatchupHref,
  injuryBadge,
  injurySeverity,
  matchupHref,
  nextGameLabel,
  playerName,
  slotChip,
  type TeamRenderOptions,
} from "../team-render";

const e = escapeHtml;

/** Designations that take a player off the field for now. */
const UNAVAILABLE = /^(ir|out|pup|sus|suspended|nfi|cov)/i;

export type OverviewPhase = "preseason" | "season";

/**
 * "season" once a regular-season game has a final (or the postseason has
 * begun); "preseason" before that. The same evidence team-data.ts uses to
 * decide whether ESPN's record describes this season: the slate, not the
 * calendar, because Sleeper calls Week 1 days before anybody plays it.
 */
export function overviewPhase(data: TeamPageData): OverviewPhase {
  if (lastResult(data.schedule) || lastResult(data.postseason)) return "season";
  if (data.state.seasonType === "post") return "season";
  // The slate unreadable mid-season: the calendar is the only evidence left,
  // and falling back to the preseason take would put draft advice back on
  // top of the hub for as long as the feed is down.
  if (!data.schedule && data.state.regularSeasonUnderway) return "season";
  return "preseason";
}

/* ----------------------------------------------------------------- pieces */

function panel(id: string, title: string, body: string, extra = ""): string {
  if (!body) return "";
  return (
    `<section class="sct-up-panel sct-ovw-panel sct-ovw-${id}" aria-labelledby="sct-ovw-${id}-h">` +
    `<div class="sct-up-ph"><h3 class="sct-up-ph-title" id="sct-ovw-${id}-h">${e(title)}</h3>${extra}</div>` +
    `<div class="sct-ovw-body">${body}</div>` +
    `</section>`
  );
}

function moreLink(href: string | null, text: string): string {
  if (!href) return "";
  return `<a class="sct-ovw-more" href="${e(href)}" target="_top">${e(text)}<span aria-hidden="true"> ›</span></a>`;
}

function logo(team: NflTeam | null): string {
  return team
    ? `<img class="sct-ovw-logo" src="${e(team.logo)}" alt="" width="36" height="36" loading="lazy" decoding="async">`
    : "";
}

function sideWords(game: ScheduleGame): string {
  return game.site === "neutral" ? "vs" : game.site === "away" ? "at" : "vs";
}

/** The newest final, regular season or postseason. */
export function latestFinal(data: TeamPageData): ScheduleGame | null {
  return lastResult(data.postseason) ?? lastResult(data.schedule);
}

export function upcoming(data: TeamPageData, now: number): ScheduleGame | null {
  return nextGame(data.schedule, now) ?? nextGame(data.postseason, now);
}

function lastGameCard(data: TeamPageData, options: TeamRenderOptions, now: number): string {
  const game = latestFinal(data);
  if (!game?.result) return "";
  const { outcome, teamScore, opponentScore } = game.result;
  const word = outcome === "W" ? "Won" : outcome === "L" ? "Lost" : "Tied";
  const schedule = (game.seasonType === "post" ? data.postseason : data.schedule) as TeamSchedule;
  const href = gameMatchupHref(data.team, game, schedule, options, now);
  const body =
    `<div class="sct-ovw-game">` +
    logo(game.opponent) +
    `<p class="sct-ovw-game-main">` +
    `<span class="sct-ovw-result" data-outcome="${outcome}">${outcome}</span>` +
    `<span class="sct-ovw-score">${teamScore}-${opponentScore}</span>` +
    `<span class="sct-ovw-opp">${e(`${sideWords(game)} ${game.opponent?.nickname ?? game.opponentName}`)}</span>` +
    `</p>` +
    `</div>` +
    `<p class="sct-ovw-meta">${e([game.weekLabel, gameDateLine(game).date, game.statusDetail && /OT/i.test(game.statusDetail) ? "Overtime" : null].filter(Boolean).join(" · "))}</p>` +
    `<p class="sct-visually-hidden">${e(`${word} ${teamScore}-${opponentScore}`)}</p>` +
    moreLink(href, "Box score and recap");
  return panel("last", "Last Game", body);
}

function nextGameCard(data: TeamPageData, options: TeamRenderOptions, now: number): string {
  const game = upcoming(data, now);
  if (!game) {
    const final = latestFinal(data);
    if (!final) return "";
    const record = data.schedule ? recordThrough(data.schedule.games).text : null;
    return panel(
      "next",
      "Next Game",
      `<p class="sct-ovw-meta">${e(`The ${data.team.nickname}' season is complete${record ? ` (${record} in the regular season)` : ""}.`)}</p>`,
    );
  }
  const when = gameDateLine(game);
  const bye = data.schedule?.byeWeek;
  // The bye is news only while it is the week being played: the next game
  // is then a week later than the league's next slate.
  const byeNow = bye != null && data.state.seasonType === "regular" && data.state.week === bye;
  const href = matchupHref(data.team, game.opponent, options);
  const defense = data.nextOpponentDefense;
  const defenseLine =
    defense && game.opponent && defense.abbreviation === game.opponent.abbreviation && defense.rankLabel
      ? `<p class="sct-ovw-meta">${e(defenseWords(game.opponent.nickname, defense))}</p>`
      : "";
  const body =
    (byeNow ? `<p class="sct-ovw-bye">${e(`Bye in Week ${bye}`)}</p>` : "") +
    `<div class="sct-ovw-game">` +
    logo(game.opponent) +
    `<p class="sct-ovw-game-main">` +
    `<span class="sct-ovw-opp is-lead">${e(`${sideWords(game)} ${game.opponent?.nickname ?? game.opponentName}`)}</span>` +
    `</p>` +
    `</div>` +
    `<p class="sct-ovw-meta">${e([game.weekLabel, when.date, when.time, game.network].filter(Boolean).join(" · "))}</p>` +
    defenseLine +
    moreLink(href, "Matchup preview");
  return panel("next", nextGameLabel(game, now), body);
}

/** "19.8 points allowed per game, 6th fewest in the NFL" - the metric named, the rank's direction said. */
export function defenseWords(nickname: string, d: NonNullable<TeamPageData["nextOpponentDefense"]>): string {
  return `${nickname} defense: ${d.value} points allowed per game, ${d.rankLabel} fewest in the NFL this season`;
}

export interface DivisionRow {
  team: NflTeam;
  wins: number;
  losses: number;
  ties: number;
  pct: number;
  /** Shares its win percentage with another club: no tiebreaker applied. */
  tied: boolean;
  /** Games behind the best record; 0 for the leaders. */
  gb: number;
}

/**
 * The division by record, from the slate. No NFL tiebreakers are applied
 * (they need head-to-head, division, common-game and conference records
 * this app does not compute), so equal records are marked tied and listed
 * alphabetically, never ranked. Null before any club has played.
 */
export function divisionRows(data: TeamPageData): DivisionRow[] | null {
  const rows = data.division;
  if (!rows || rows.length < 2) return null;
  if (rows.every((r) => r.wins + r.losses + r.ties === 0)) return null;
  const pct = (r: { wins: number; losses: number; ties: number }) => {
    const g = r.wins + r.losses + r.ties;
    return g ? (r.wins + r.ties / 2) / g : 0;
  };
  const sorted = [...rows].sort((a, b) => pct(b) - pct(a) || a.team.nickname.localeCompare(b.team.nickname));
  const lead = sorted[0];
  return sorted.map((r) => ({
    ...r,
    pct: pct(r),
    tied: sorted.filter((o) => pct(o) === pct(r)).length > 1,
    gb: Math.max(0, (lead.wins - r.wins + (r.losses - lead.losses)) / 2),
  }));
}

export const recordText = (r: { wins: number; losses: number; ties: number }) =>
  r.ties ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`;

function divisionCard(data: TeamPageData): string {
  const sorted = divisionRows(data);
  if (!sorted) return "";
  const anyTie = sorted.some((r) => r.tied);
  const gb = (r: DivisionRow) => (r.gb <= 0 ? "-" : r.gb % 1 ? r.gb.toFixed(1) : String(r.gb));
  const body =
    `<table class="sct-ovw-div"><caption class="sct-visually-hidden">${e(`${data.team.division} records`)}</caption>` +
    `<thead><tr><th scope="col">Team</th><th scope="col">W-L</th><th scope="col"><abbr title="Games back">GB</abbr></th></tr></thead><tbody>` +
    sorted
      .map(
        (r) =>
          `<tr${r.team.abbreviation === data.team.abbreviation ? ` class="is-team"` : ""}>` +
          `<th scope="row"><span class="sct-ovw-div-team">${logo(r.team)}${e(r.team.nickname)}` +
          (r.tied ? `<span class="sct-ovw-tie">Tied</span>` : "") +
          `</span></th>` +
          `<td>${e(recordText(r))}</td>` +
          `<td>${e(gb(r))}</td>` +
          `</tr>`,
      )
      .join("") +
    `</tbody></table>` +
    (anyTie
      ? `<p class="sct-ovw-note">Tied teams share a record and are listed alphabetically. NFL tiebreakers are not applied here, so this order is not the official standing.</p>`
      : `<p class="sct-ovw-note">Ordered by record; NFL tiebreakers are not applied.</p>`);
  return panel("division", `${data.team.division} Race`, body);
}

/* ------------------------------------------------------------ performance */

const OFFENSE: Array<[string, string]> = [
  ["off-points", "Points/G"],
  ["off-total-yards", "Yards/G"],
  ["off-pass-yards", "Pass Yds/G"],
  ["off-rush-yards", "Rush Yds/G"],
];
const DEFENSE: Array<[string, string]> = [
  ["def-points", "Points Allowed/G"],
  ["def-total-yards", "Yards Allowed/G"],
  ["def-pass-yards", "Pass Yds Allowed/G"],
  ["def-rush-yards", "Rush Yds Allowed/G"],
];

function tier(rank: number | null): string {
  if (rank == null) return "none";
  return rank <= 10 ? "good" : rank <= 22 ? "mid" : "poor";
}

function statList(rows: StatRow[], keys: Array<[string, string]>, side: string): string {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const items = keys
    .map(([key, label]) => {
      const row = byKey.get(key);
      if (!row) return "";
      return (
        `<li class="sct-ovw-stat">` +
        `<span class="sct-ovw-stat-l">${e(label)}</span>` +
        `<span class="sct-ovw-stat-v">${e(row.value)}</span>` +
        (row.rankLabel
          ? `<span class="sct-ovw-rank" data-tier="${tier(row.rank)}">${e(row.rankLabel)}<span class="sct-visually-hidden"> in the NFL</span></span>`
          : "") +
        `</li>`
      );
    })
    .join("");
  return items ? `<div class="sct-ovw-side"><h4 class="sct-ovw-h4">${e(side)}</h4><ul class="sct-ovw-stats">${items}</ul></div>` : "";
}

function performanceCard(data: TeamPageData, statsHref: string | null): string {
  const stats = data.stats;
  if (!stats || stats.season !== data.state.season) return "";
  const body = statList(stats.offense, OFFENSE, "Offense") + statList(stats.defense, DEFENSE, "Defense");
  if (!body) return "";
  const games = stats.gamesPlayed ? `Through ${stats.gamesPlayed} game${stats.gamesPlayed === 1 ? "" : "s"}. ` : "";
  return panel(
    "perf",
    "Offense & Defense",
    `<div class="sct-ovw-sides">${body}</div>` +
      `<p class="sct-ovw-note">${e(`${games}Ranks are among all 32 teams; 1st is best on both sides.`)}</p>` +
      moreLink(statsHref, "Full team stats"),
  );
}

/* ----------------------------------------------------------- contributors */

export interface Contributor {
  player: RosterPlayer;
  games: number;
  ppr: number;
  t: Record<string, number>;
  usage: UsagePlayer | null;
}

function totals(
  rows: GameLogEntry[],
  club: string,
  // The player pages' own "played" rule (ranks.ts hasParticipation), for a
  // contributor's G and PPR/G: the header FPPG and Game Log divide by those
  // games, so a week he was active for without a snap is not a game here
  // either (release gate 2026-11-19: Cody White 4.2 here vs 4.7 on his page).
  position?: string,
): { games: number; t: Record<string, number> } {
  const t: Record<string, number> = {};
  let games = 0;
  for (const row of rows) {
    if ((row.team ?? "").toLowerCase() !== club) continue;
    if (row.game_status === "bye" || row.game_status === "out") continue;
    const s = row.stats as unknown as Record<string, number | undefined>;
    if (!s || !(s.gp ?? s.off_snp ?? s.pts_ppr)) continue;
    if (position && !hasParticipation(row.stats, position)) continue;
    games += 1;
    for (const [k, v] of Object.entries(s)) if (typeof v === "number") t[k] = (t[k] ?? 0) + v;
    // Fantasy points through the player pages' own scorer, so the overview's
    // PPR/G follows whatever totals policy they follow (house scoring via
    // SC_SCORING_TOTALS once the scoring work lands; Sleeper's pts_ppr today).
    t.fantasyPpr = (t.fantasyPpr ?? 0) + getEntryPoints(row.stats, "ppr");
  }
  return { games, t };
}

const n0 = (v: number | undefined) => Math.round(v ?? 0).toLocaleString("en-US");

function statLine(c: Contributor): string {
  const t = c.t;
  const pos = c.player.position;
  if (pos === "QB") {
    const parts = [`${n0(t.pass_yd)} pass yds`, `${n0(t.pass_td)} TD`, `${n0(t.pass_int)} INT`];
    if ((t.rush_yd ?? 0) >= 100) parts.push(`${n0(t.rush_yd)} rush yds`);
    return parts.join(" · ");
  }
  if (pos === "RB") {
    const td = (t.rush_td ?? 0) + (t.rec_td ?? 0);
    return [`${n0(t.rush_yd)} rush yds`, `${n0(t.rec)} rec, ${n0(t.rec_yd)} yds`, `${td} TD`].join(" · ");
  }
  return [`${n0(t.rec)} rec`, `${n0(t.rec_yd)} yds`, `${n0(t.rec_td)} TD`, `${n0(t.rec_tgt)} tgt`].join(" · ");
}

function shareLine(c: Contributor, view: UsageView | null): string {
  const u = c.usage;
  if (!u || !view) return "";
  const pos = c.player.position;
  if (pos === "RB" && u.snapShare != null) return `${Math.round(u.snapShare)}% of snaps`;
  if ((pos === "WR" || pos === "TE") && u.targetShare != null) return `${u.targetShare.toFixed(1)}% target share`;
  return "";
}

export function contributors(data: TeamPageData, view: UsageView | null): Contributor[] {
  const roster = data.roster?.players ?? [];
  if (roster.length === 0) return [];
  const logs = loadGameLogs(data.state.season);
  const club = data.team.abbreviation.toLowerCase();
  const usageById = new Map((view?.all ?? []).filter((p) => p.sleeperId).map((p) => [p.sleeperId as string, p]));
  const out: Contributor[] = [];
  for (const player of roster) {
    if (!["QB", "RB", "WR", "TE"].includes(player.position)) continue;
    const rows = logs[player.id];
    if (!rows?.length) continue;
    const { games, t } = totals(rows, club, player.position);
    if (games === 0) continue;
    out.push({ player, games, ppr: t.fantasyPpr ?? 0, t, usage: usageById.get(player.id) ?? null });
  }
  const qb = out
    .filter((c) => c.player.position === "QB")
    .sort((a, b) => (b.t.pass_att ?? 0) - (a.t.pass_att ?? 0))[0];
  const others = out
    .filter((c) => c.player.position !== "QB")
    .sort((a, b) => b.ppr - a.ppr)
    .slice(0, qb ? 5 : 6);
  return (qb ? [qb, ...others] : others).sort((a, b) => b.ppr - a.ppr);
}

export interface Leader {
  name: string;
  yards: number;
  td: number;
  count: number;
}

/**
 * The club's rushing and receiving leaders this season from the game logs,
 * every player who played for it (a back traded away still led it), with
 * the player pages' own box-score totals.
 */
export function teamLeaders(data: TeamPageData): { rushing: Leader | null; receiving: Leader | null } {
  const logs = loadGameLogs(data.state.season);
  const club = data.team.abbreviation.toLowerCase();
  const names = new Map(loadPlayers().map((p) => [p.id, p.name]));
  let rushing: Leader | null = null;
  let receiving: Leader | null = null;
  for (const [id, rows] of Object.entries(logs)) {
    const { games, t } = totals(rows, club);
    if (games === 0) continue;
    const name = names.get(id);
    if (!name) continue;
    const r = { name, yards: t.rush_yd ?? 0, td: t.rush_td ?? 0, count: t.rush_att ?? 0 };
    const c = { name, yards: t.rec_yd ?? 0, td: t.rec_td ?? 0, count: t.rec ?? 0 };
    if (r.yards > (rushing?.yards ?? 0)) rushing = r;
    if (c.yards > (receiving?.yards ?? 0)) receiving = c;
  }
  return { rushing, receiving };
}

function contributorRow(c: Contributor, view: UsageView | null): string {
  const p = c.player;
  const photo =
    headshotImg({ src: p.headshot, className: "sct-ovw-face-img", alt: "", variants: ["160"], width: 40, height: 40, loading: "lazy" }) ?? "";
  const share = shareLine(c, view);
  const ppg = c.games ? c.ppr / c.games : 0;
  return (
    `<li class="sct-ovw-p">` +
    `<span class="sct-ovw-face" aria-hidden="true">${photo}</span>` +
    `<span class="sct-ovw-who">` +
    `<span class="sct-ovw-name-row">${playerName(p.name, "sct-ovw-name")}${slotChip(p.position, true)}${injuryBadge(p, "sct-ovw-inj")}</span>` +
    `<span class="sct-ovw-line">${e(statLine(c))}${share ? `<span class="sct-ovw-share">${e(` · ${share}`)}</span>` : ""}</span>` +
    `</span>` +
    `<span class="sct-ovw-ppg"><b>${ppg.toFixed(1)}</b><span>PPR/G</span><span class="sct-ovw-gp">${c.games} G</span></span>` +
    `</li>`
  );
}

export interface Backfield {
  rb1: UsagePlayer;
  /** rb1's designation when it keeps him off the field ("IR", "Out"). */
  rb1Status: string | null;
  /** The first back behind rb1 by the same measure who is not ruled out. */
  next: UsagePlayer | null;
  /** next's slot on the current depth chart, e.g. 2; null when unlisted. */
  nextDepth: number | null;
  /** The back the depth chart lists directly behind rb1, when that is someone else. */
  depthNext: string | null;
  /** Backs above next by share who are ruled out right now. */
  skipped: Array<{ name: string; status: string }>;
}

/**
 * The backfield from this season's work, checked against who can play.
 *
 * Selection is by ONE measure, said on the page: share of the running
 * backs' weighted opportunities this season (carries + 2 x targets, the
 * Usage tab's measure). The lead back is the leader by it; "next" is the
 * first back behind him by it whose current designation is not IR, Out,
 * PUP or a suspension. The depth chart does not pick anyone; its slot is
 * reported beside the pick, and a disagreement is printed rather than
 * resolved. No preseason take and no "handcuff" verdict enters it.
 */
export function backfield(data: TeamPageData, view: UsageView | null): Backfield | null {
  if (!view || view.rbs.length === 0) return null;
  const roster = data.roster?.players ?? [];
  const byId = new Map(roster.map((p) => [p.id, p]));
  const byName = new Map(roster.map((p) => [searchKey(p.name), p]));
  const live = (u: UsagePlayer) => (u.sleeperId ? byId.get(u.sleeperId) : undefined) ?? byName.get(searchKey(u.name));
  // The roster carries this week's statuses (current-injuries.ts, applied in
  // team-data.ts), so an expired Out does not skip a back who is playing.
  const status = (u: UsagePlayer) => live(u)?.injuryStatus ?? "";
  const out = (u: UsagePlayer) => UNAVAILABLE.test(status(u));
  const [rb1, ...rest] = view.rbs;
  const skipped: Backfield["skipped"] = [];
  let next: UsagePlayer | null = null;
  for (const u of rest) {
    if ((u.woppShare ?? 0) < 5) break;
    if (out(u)) skipped.push({ name: u.name, status: status(u) });
    else {
      next = u;
      break;
    }
  }
  const nextRow = next ? live(next) : undefined;
  const nextDepth = nextRow?.depthPosition === "RB" && nextRow.depthOrder ? nextRow.depthOrder : null;
  const rb1Row = live(rb1);
  const depthNextRow = roster.find(
    (p) => p.position === "RB" && p.depthPosition === "RB" && p.depthOrder === (rb1Row?.depthOrder ?? 1) + 1,
  );
  return {
    rb1,
    rb1Status: out(rb1) ? status(rb1) : null,
    next,
    nextDepth,
    depthNext: depthNextRow && (!next || depthNextRow.id !== next.sleeperId) ? depthNextRow.name : null,
    skipped,
  };
}

function backfieldLine(data: TeamPageData, view: UsageView | null): string {
  const b = backfield(data, view);
  if (!b) return "";
  const name = (n: string) => {
    const href = getPlayerProfileUrl(n);
    return href ? `<a class="sct-player-link" href="${e(href)}" target="_top">${e(n)}</a>` : e(n);
  };
  const share = (u: UsagePlayer) => (u.woppShare != null ? `${Math.round(u.woppShare)}%` : "-");
  const parts = [
    `${name(b.rb1.name)} has ${e(share(b.rb1))} of the running backs' opportunities this season${b.rb1Status ? ` (now ${e(b.rb1Status)})` : ""}.`,
  ];
  for (const s of b.skipped) parts.push(`${name(s.name)} is next by share but is ${e(s.status)}.`);
  if (b.next) {
    parts.push(
      `Next among available backs: ${name(b.next.name)}, ${e(share(b.next))}` +
        (b.nextDepth ? `, RB${b.nextDepth} on the depth chart.` : ", not listed on the depth chart.") +
        (b.depthNext ? ` The depth chart lists ${name(b.depthNext)} second.` : ""),
    );
  } else {
    parts.push(`No other available back has 5% of the work.`);
  }
  return (
    `<p class="sct-ovw-backfield"><span class="sct-ovw-tag">Backfield</span> ${parts.join(" ")}</p>` +
    `<p class="sct-ovw-note">Opportunities = carries + 2 x targets. Availability is the current injury report.</p>`
  );
}

function contributorsCard(data: TeamPageData, view: UsageView | null, usageHref: string | null): string {
  const list = contributors(data, view);
  if (list.length === 0) return "";
  return panel(
    "players",
    "Key Offensive Contributors",
    `<ul class="sct-ovw-plist">${list.map((c) => contributorRow(c, view)).join("")}</ul>` +
      backfieldLine(data, view) +
      `<p class="sct-ovw-note">Season totals with this team, the same box scores as each player's page. PPR points per game played.</p>` +
      moreLink(usageHref, "Snap counts and usage"),
  );
}

/* --------------------------------------------------------------- injuries */

function injuriesCard(data: TeamPageData, depthHref: string | null): string {
  if (!data.roster) return "";
  // Already this week's statuses (current-injuries.ts via team-data.ts).
  const rows = data.injuries;
  const body = rows.length
    ? `<ul class="sct-ovw-inj-list">` +
      rows
        .map((p) => {
          const detail = [p.injuryBodyPart, p.practice].filter(Boolean).join(" · ");
          return (
            `<li class="sct-ovw-inj-row">` +
            `<span class="sct-ovw-inj-who">${playerName(p.name, "sct-ovw-inj-name")}${slotChip(p.position, true)}` +
            (detail ? `<span class="sct-ovw-inj-detail">${e(detail)}</span>` : "") +
            `</span>` +
            `<span class="sct-nwp-status sct-ovw-status" data-severity="${injurySeverity(p.injuryStatus)}">${e(p.injuryStatus ?? "")}</span>` +
            `</li>`
          );
        })
        .join("") +
      `</ul>`
    : `<p class="sct-ovw-meta">${e(`No ${data.team.nickname} skill-position players carry an injury designation right now.`)}</p>`;
  const fresh = data.injuryFreshness?.note ? `<p class="sct-ovw-note">${e(data.injuryFreshness.note)}</p>` : "";
  return panel("injuries", "Injuries & Availability", body + fresh + moreLink(depthHref, "Depth chart"));
}

/* ----------------------------------------------------------------- trends */

function changesCard(view: UsageView | null, usageHref: string | null): string {
  if (!view) return "";
  const trends = usageTrends(view).slice(0, 3);
  if (trends.length === 0) return "";
  const body =
    `<ul class="sct-ovw-trends">` +
    trends
      .map(
        (t) =>
          `<li class="sct-ovw-trend" data-dir="${t.direction}">` +
          `<span class="sct-ovw-arrow" aria-hidden="true">${t.direction === "up" ? "▲" : "▼"}</span>` +
          `<span>${playerName(t.player.name, "sct-ovw-trend-name")}: ${e(t.short)}</span>` +
          `</li>`,
      )
      .join("") +
    `</ul>` +
    `<p class="sct-ovw-note">Last three games against the three before them.</p>` +
    moreLink(usageHref, "All usage changes");
  return panel("changes", "Recent Usage Changes", body);
}

/* ----------------------------------------------------------------- public */

export interface OverviewLinks {
  usage: string | null;
  stats: string | null;
  depth: string | null;
}

export function renderTeamOverview(
  data: TeamPageData,
  view: UsageView | null,
  options: TeamRenderOptions,
  now: number,
  links: OverviewLinks,
): string {
  const { team, state } = data;
  const final = latestFinal(data);
  const through = final ? final.weekLabel : null;
  // Reading order is the phone order: the games and the race first, then the
  // players, then availability and the unit numbers. On wider screens the
  // players and their usage changes take the left column, availability and
  // the unit numbers the right.
  const top = [lastGameCard(data, options, now), nextGameCard(data, options, now), divisionCard(data)].join("");
  const left = contributorsCard(data, view, links.usage) + changesCard(view, links.usage);
  const right = injuriesCard(data, links.depth) + performanceCard(data, links.stats);
  const empty = !top && !left && !right;
  // In season an empty overview still renders (header and a plain note), so
  // a feed outage never hands the default tab back to the preseason take.
  if (empty && overviewPhase(data) !== "season") return "";
  const head = premiumTabHead({
    hook: "sct-ovw-head",
    icon: "stats",
    art: "outlook",
    heading: `<h2 class="sct-h2 sct-up-h2 sct-ovw-title">${e(`${team.fullName} ${state.season} Season Overview`)}</h2>`,
    phoneTitle: "Season Overview",
    // Before a final (the next season's preseason with no outlook written)
    // the overview says so rather than leaving last season's numbers to
    // read as current: every season-to-date block is empty then anyway.
    dek: [`${state.season} NFL Season`, through ? `Through ${through}` : "Before Week 1"].join(" · "),
  });
  return (
    `<div class="sct-block sct-up sct-ovw" id="team-overview">` +
    head +
    (empty ? `<p class="sct-ovw-note sct-ovw-empty">Current-season figures are not available right now.</p>` : "") +
    (top ? `<div class="sct-ovw-top">${top}</div>` : "") +
    (left || right
      ? `<div class="sct-ovw-cols">` +
        (left ? `<div class="sct-ovw-col is-main">${left}</div>` : "") +
        (right ? `<div class="sct-ovw-col is-side">${right}</div>` : "") +
        `</div>`
      : "") +
    `</div>`
  );
}

/**
 * The preseason outlook, kept and labeled for what it is: a take written
 * before Week 1. Closed by default; the summary line says so before anyone
 * opens it.
 */
export function renderPreseasonArchive(season: number, updated: string, inner: string): string {
  if (!inner) return "";
  return (
    `<details class="sct-ovw-archive" id="preseason-outlook">` +
    `<summary class="sct-ovw-archive-sum">` +
    `<span class="sct-ovw-archive-title">${e(`${season} Preseason Fantasy Outlook`)}</span>` +
    `<span class="sct-ovw-archive-dek">${e(`Archived · written before Week 1${updated ? `, last edited ${updated}` : ""}`)}</span>` +
    `</summary>` +
    `<p class="sct-ovw-archive-note">This outlook was written before the season and is kept as a record. Its tiers, roles and draft advice are not updated during the season; current roles are on the Usage and Depth Chart tabs.</p>` +
    inner +
    `</details>`
  );
}
