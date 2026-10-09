/**
 * The all-time series: the top of the head-to-head section.
 *
 * Every figure is counted from one source per page - the complete list of
 * meetings when the page has it, or a precomputed summary when it does not,
 * never some of each. The list comes from data/rivalry/all-time.json (every
 * game since 1920, built by scripts/build-rivalry-history.mjs) plus the
 * current season's finals from the page's own schedule.
 *
 * Location and relocation history ("when the Cardinals played in Chicago") is
 * only ever printed from the hand-written intro in rivalry-notes.ts. The
 * generated intro says when they first met, how often, and - for a division
 * pair - since when, all of which the list can prove.
 *
 * Pure: input in, HTML and sentences out.
 */

import { escapeHtml } from "../render";

const DASH = "–";

export interface RivalryGame {
  season: number;
  /** "1937-10-03". */
  date: string;
  away: string;
  home: string;
  awayScore: number;
  homeScore: number;
  playoff: boolean;
  /** The season's last game, played for the championship (1966 season on). */
  superBowl?: boolean;
  /** This game's recap page, when the site has one. */
  url: string | null;
}

export interface LargestWin {
  winnerScore: number;
  loserScore: number;
  season: number;
  url: string | null;
}

export interface AllTimeSummary {
  meetings: number;
  firstMeetingSeason: number;
  /** Keyed by display code. */
  wins: Record<string, number>;
  ties: number;
  /** Seasons each side won a playoff meeting, oldest first. */
  postseasonWins: Record<string, number[]>;
  largestWin: Record<string, LargestWin | null>;
}

export interface RivalryInput {
  /** Hand-written, from rivalry-notes.ts; null to generate one. */
  intro: string | null;
  /** "NFC West" when the two share a division now; null otherwise. */
  divisionName: string | null;
  divisionRivalsSince: number | null;
  /** Every meeting ever, when the page has them all… */
  allGames?: RivalryGame[];
  /** …or the backend's summary when it does not. Never both. */
  allTimeSummary?: AllTimeSummary;
}

export interface RivalryTeam {
  abbr: string;
  short: string;
  /** Text color for this side's figures, already safe on the card. */
  ink: string;
}

/* ------------------------------------------------------------- counting */

/** The summary, counted from the games when the page has them. */
export function allTimeSummary(input: RivalryInput, away: string, home: string): AllTimeSummary | null {
  if (!input.allGames) return input.allTimeSummary ?? null;
  const games = input.allGames.filter(
    (g) => (g.away === away && g.home === home) || (g.away === home && g.home === away),
  );
  if (games.length === 0) return null;
  const wins: Record<string, number> = { [away]: 0, [home]: 0 };
  const postseasonWins: Record<string, number[]> = { [away]: [], [home]: [] };
  const largestWin: Record<string, LargestWin | null> = { [away]: null, [home]: null };
  let ties = 0;
  const ordered = [...games].sort((x, y) => x.date.localeCompare(y.date));
  for (const g of ordered) {
    if (g.awayScore === g.homeScore) {
      ties += 1;
      continue;
    }
    const winner = g.awayScore > g.homeScore ? g.away : g.home;
    const high = Math.max(g.awayScore, g.homeScore);
    const low = Math.min(g.awayScore, g.homeScore);
    wins[winner] = (wins[winner] ?? 0) + 1;
    if (g.playoff) postseasonWins[winner]!.push(g.season);
    const best = largestWin[winner];
    // ">=" over games in date order: a tied margin goes to the most recent.
    if (!best || high - low >= best.winnerScore - best.loserScore) {
      largestWin[winner] = { winnerScore: high, loserScore: low, season: g.season, url: g.url };
    }
  }
  return {
    meetings: games.length,
    firstMeetingSeason: ordered[0]!.season,
    wins,
    ties,
    postseasonWins,
    largestWin,
  };
}

/**
 * The first season from which the pair met twice in every regular season up
 * to `through` - the schedule of division rivals - or null. The 1982 strike
 * season is forgiven. Never earlier than 1970, when today's division names
 * began, so "AFC East rivals since" is a claim about the AFC East.
 */
export function divisionRivalsSince(
  games: RivalryGame[],
  a: string,
  b: string,
  through: number,
): number | null {
  const perSeason = new Map<number, number>();
  for (const g of games) {
    if (g.playoff) continue;
    if (!((g.away === a && g.home === b) || (g.away === b && g.home === a))) continue;
    perSeason.set(g.season, (perSeason.get(g.season) ?? 0) + 1);
  }
  let since: number | null = null;
  for (let s = through; s >= 1970; s -= 1) {
    if ((perSeason.get(s) ?? 0) >= 2 || s === 1982) since = s;
    else break;
  }
  return since === 1982 ? null : since;
}

/* ------------------------------------------------------------- sentences */

function list(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

interface Record_ {
  text: string;
  leader: RivalryTeam | null;
  other: RivalryTeam;
}

/** "53–41–2" from the leader's side; ties only when there are any. */
function record(s: AllTimeSummary, away: RivalryTeam, home: RivalryTeam): Record_ {
  const wa = s.wins[away.abbr] ?? 0;
  const wh = s.wins[home.abbr] ?? 0;
  const [leader, other] = wh > wa ? [home, away] : [away, home];
  const text =
    `${Math.max(wa, wh)}${DASH}${Math.min(wa, wh)}` + (s.ties ? `${DASH}${s.ties}` : "");
  return { text, leader: wa === wh ? null : leader, other };
}

/** The playoff record from the side with more playoff wins, and that side. */
function postseason(s: AllTimeSummary, away: RivalryTeam, home: RivalryTeam) {
  const pa = s.postseasonWins[away.abbr] ?? [];
  const ph = s.postseasonWins[home.abbr] ?? [];
  const [first, second] = ph.length > pa.length ? [home, away] : [away, home];
  const [fw, sw] = ph.length > pa.length ? [ph, pa] : [pa, ph];
  return { first, second, fw, sw, total: fw.length + sw.length };
}

function postseasonCaption(s: AllTimeSummary, away: RivalryTeam, home: RivalryTeam): string {
  const { first, second, fw, sw, total } = postseason(s, away, home);
  if (total === 0) return "No playoff meetings";
  const years = (seasons: number[]): string => list(seasons.map(String));
  if (sw.length === 0) {
    return total <= 3
      ? `${first.short} won in ${years(fw)}`
      : `${first.short} won all ${total}, most recently in ${Math.max(...fw)}`;
  }
  if (total >= 4) return `Split ${fw.length}${DASH}${sw.length}`;
  return `${first.short} won in ${years(fw)}; ${second.short} won in ${years(sw)}`;
}

/** The written intro, or the generated one. */
export function rivalryIntro(
  input: RivalryInput,
  s: AllTimeSummary,
  away: RivalryTeam,
  home: RivalryTeam,
): string {
  if (input.intro) return input.intro;
  const met =
    `The ${away.short} and ${home.short} first met in ${s.firstMeetingSeason} ` +
    `and have played ${s.meetings} time${s.meetings === 1 ? "" : "s"} since.`;
  return input.divisionName && input.divisionRivalsSince
    ? `${met} They have been ${input.divisionName} rivals since ${input.divisionRivalsSince}.`
    : met;
}

/** The FAQ's all-time answer; the visible FAQ and its JSON-LD both print it. */
export function allTimeAnswer(s: AllTimeSummary, away: RivalryTeam, home: RivalryTeam): string {
  const r = record(s, away, home);
  const since = `across ${s.meetings} meeting${s.meetings === 1 ? "" : "s"} since ${s.firstMeetingSeason}`;
  const post = postseason(s, away, home);
  if (r.leader) {
    const lw = (s.postseasonWins[r.leader.abbr] ?? []).length;
    const ow = (s.postseasonWins[r.other.abbr] ?? []).length;
    return post.total
      ? `The ${r.leader.short} lead the all-time series ${r.text} ${since}, including a ${lw}${DASH}${ow} record in the postseason.`
      : `The ${r.leader.short} lead the all-time series ${r.text} ${since}.`;
  }
  return post.total
    ? `The all-time series is tied ${r.text} ${since}, and the ${post.first.short} are ${post.fw.length}${DASH}${post.sw.length} in the postseason.`
    : `The all-time series is tied ${r.text} ${since}.`;
}

/**
 * What does not add up, for the log. `recent` is the "since" record the page
 * prints under the tiles; an all-time count below it means the two sources
 * disagree.
 */
export function validateAllTime(
  s: AllTimeSummary,
  recent: { wins: Record<string, number>; ties: number; games: number },
): string[] {
  const problems: string[] = [];
  const counted = Object.values(s.wins).reduce((a, b) => a + b, 0) + s.ties;
  if (counted !== s.meetings) {
    problems.push(`wins and ties add up to ${counted}, the meeting count is ${s.meetings}`);
  }
  if (s.meetings < recent.games) {
    problems.push(`all-time meetings (${s.meetings}) are fewer than the recent ones (${recent.games})`);
  }
  for (const [abbr, n] of Object.entries(recent.wins)) {
    if ((s.wins[abbr] ?? 0) < n) {
      problems.push(`${abbr} has ${s.wins[abbr] ?? 0} all-time wins, fewer than ${n} recent ones`);
    }
  }
  if (s.ties < recent.ties) problems.push(`all-time ties (${s.ties}) are fewer than recent ones (${recent.ties})`);
  return problems;
}

/* ----------------------------------------------------------------- tiles */

function tile(label: string, number: string, caption: string, numberAttrs = ""): string {
  return (
    `<div class="sct-rb-at">` +
    `<dt>${escapeHtml(label)}</dt>` +
    `<dd><b class="sct-rb-at-num"${numberAttrs}>${number}</b>` +
    `<span class="sct-rb-at-cap">${escapeHtml(caption)}</span></dd>` +
    `</div>`
  );
}

function largestTile(s: AllTimeSummary, team: RivalryTeam): string {
  const win = s.largestWin[team.abbr] ?? null;
  const label = `Largest ${team.short} win`;
  if (!win) return tile(label, "-", "No wins yet", ` data-none="1"`);
  const score = escapeHtml(`${win.winnerScore}${DASH}${win.loserScore}`);
  const number = win.url
    ? `<a class="sct-rb-at-link" href="${escapeHtml(win.url)}">${score}</a>`
    : score;
  return tile(label, number, String(win.season), ` style="${escapeHtml(`--rb-at-ink:${team.ink}`)}"`);
}

/** The four tiles, away side's largest win before the home side's. */
export function renderAllTimeTiles(s: AllTimeSummary, away: RivalryTeam, home: RivalryTeam): string {
  const r = record(s, away, home);
  const post = postseason(s, away, home);
  return (
    `<dl class="sct-rb-alltime">` +
    tile(
      "All-time series",
      escapeHtml(r.text),
      `${r.leader ? `${r.leader.short} lead` : "Series tied"}, ${s.meetings} meeting${s.meetings === 1 ? "" : "s"} since ${s.firstMeetingSeason}`,
    ) +
    tile(
      "Postseason",
      escapeHtml(post.total ? `${post.fw.length}${DASH}${post.sw.length}` : "0"),
      postseasonCaption(s, away, home),
    ) +
    largestTile(s, away) +
    largestTile(s, home) +
    `</dl>`
  );
}
