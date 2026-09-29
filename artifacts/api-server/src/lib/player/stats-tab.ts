/**
 * The Stats tab, to mak's spec of 2026-09-29 ("Stats Tab Spec"), minus its SEO
 * section.
 *
 * Six sections under the header and tab bar: this season's production cards
 * with a totals / per-game toggle, the two advanced cards, the career chart,
 * the career table, the career read with its rates and highs, and a FAQ. Each
 * is a <section aria-labelledby> with an H2 and a lede, and each is left out
 * whole when its data is not there, never rendered empty.
 *
 * Its own module, like ./overview.ts, so tests/player-stats-tab.test.mjs can
 * render it against hand-built states (preseason, one season, a trade, a
 * player below the threshold) without the database. It wears the Overview's
 * section styles (.scp-ox, player.css "overview, lower") plus its own block,
 * "stats tab".
 *
 * Every career figure is summed from the weekly logs (data.logCareer) and never
 * read from a stored total, so the chart, the table, the header and the Game
 * Log agree: games played is the count of games in the logs, and fantasy
 * points are the site's own scoring of each week.
 *
 * Where it departs from the spec, deliberately:
 *   - it sits UNDER the tab's existing content (mak's instruction), which
 *     keeps the panel heading the WordPress page promotes to its H1;
 *   - the advanced metrics no file here has are replaced (see stats-tab-data);
 *   - its FAQ is not in the page's FAQPage JSON-LD until mak approves that.
 *
 * Analyst copy comes from data/player/stats_copy.json (docs/STATS-COPY.md):
 * each field replaces only its own template text. College seasons come from
 * data/player/college_stats.json (scripts/player/buildCollegeStats.mjs): a
 * rookie's Card B is his final college season, and before his first NFL game
 * the tab is that card and a college table.
 */

import { escapeHtml } from "../render";
import type { PlayerRenderOptions } from "../player-render";
import { getTeamByAbbreviation } from "../team/teams";
import type { PlayerPageData } from "./player-data";
import { getEntryPoints, SCORING_SHORT } from "./scoring";
import { passerRating } from "./stats-profile";
import { collegeCard, type AdvCard, type AdvMetric, type CollegeCard, type LogSeason } from "./stats-tab-data";
import type { GameLogEntry } from "./types";
import { lastName, teamInk } from "./header";

const DASH = "—";

/** The scoring as the reference page words it: "full PPR", not the toggle's "PPR". */
const SCORING_WORDS = { ppr: "full PPR", half: "half-PPR", standard: "standard" } as const;
const MINUS = "−";
const REDRAFT_COMMAND_URL = "https://statchasers.com/redraft-command/";

/* ------------------------------------------------------------------ atoms */

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** A true minus sign, never a hyphen. */
const signed = (s: string): string => s.replace(/^-/, MINUS);
const one = (v: number): string => signed(v.toFixed(1));
const whole = (v: number): string => signed(Math.round(v).toLocaleString("en-US"));
const pct1 = (v: number): string => `${v.toFixed(1)}%`;
/** A label's first word, lowercased mid-sentence unless it is an acronym ("EPA"). */
const LC = /^[A-Z][a-z]/;

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n: number): string => WORDS[n] ?? String(n);
const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

function sectionOpen(id: string, heading: string, lede: string): string {
  return (
    `<section class="scp-ox-sec" aria-labelledby="${id}">` +
    `<h2 class="scp-ox-h2" id="${id}">${escapeHtml(heading)}</h2>` +
    (lede ? `<p class="scp-ox-lede">${lede}</p>` : "")
  );
}

function a(href: string, text: string, attrs = ""): string {
  return `<a href="${escapeHtml(href)}"${attrs}>${escapeHtml(text)}</a>`;
}

/* ------------------------------------------------------- analyst copy */

/** An analyst field, trimmed, or null when it is missing or blank. */
function own(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Analyst text as HTML: escaped, with `[text](url)` turned into a link when the
 * URL is http(s) or root-relative. Nothing else is interpreted.
 */
function copyHtml(text: string): string {
  let out = "";
  let at = 0;
  for (const m of text.matchAll(/\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)\s]+)\)/g)) {
    out += escapeHtml(text.slice(at, m.index)) + a(m[2]!, m[1]!);
    at = m.index! + m[0].length;
  }
  return out + escapeHtml(text.slice(at));
}

/* ------------------------------------------------------ position rules */

/** Season finish bands: [good up to, mid up to]. RB/WR run twice as deep. */
function finishBands(pos: string): [number, number] {
  return pos === "RB" || pos === "WR" ? [24, 36] : [12, 24];
}

function finishClass(pos: string, rank: number): "good" | "mid" | "bad" {
  const [good, mid] = finishBands(pos);
  return rank <= good ? "good" : rank <= mid ? "mid" : "bad";
}

/** "Starter" weeks: top 12 at QB and TE, top 24 at RB and WR. */
const topN = (pos: string): number => finishBands(pos)[0];

/** Weekly swing bands, by the standard deviation of weekly points. */
function swingWord(pos: string, sd: number): "low" | "moderate" | "high" {
  const [lo, hi] = pos === "TE" ? [5, 8] : pos === "QB" ? [6, 9] : [7, 10];
  return sd < lo ? "low" : sd <= hi ? "moderate" : "high";
}

/** Regular-season games a club played, by season. */
const teamGames = (season: number): number => (season <= 2020 ? 16 : 17);

/* ---------------------------------------------------------------- lines */

interface Line {
  gp: number;
  att: number; cmp: number; passYd: number; passTd: number; int: number;
  rushAtt: number; rushYd: number; rushTd: number; rushLong: number | null;
  tgt: number; rec: number; recYd: number; recTd: number;
  pts: number;
}

const EMPTY: Line = {
  gp: 0, att: 0, cmp: 0, passYd: 0, passTd: 0, int: 0,
  rushAtt: 0, rushYd: 0, rushTd: 0, rushLong: null,
  tgt: 0, rec: 0, recYd: 0, recTd: 0, pts: 0,
};

function sumLine(entries: GameLogEntry[], pts: (e: GameLogEntry) => number): Line {
  const t: Line = { ...EMPTY };
  const v = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  for (const e of entries) {
    const st = e.stats as unknown as Record<string, unknown>;
    t.gp += 1;
    t.att += v(st.pass_att); t.cmp += v(st.pass_cmp); t.passYd += v(st.pass_yd);
    t.passTd += v(st.pass_td); t.int += v(st.pass_int);
    t.rushAtt += v(st.rush_att); t.rushYd += v(st.rush_yd); t.rushTd += v(st.rush_td);
    if (typeof st.rush_lng === "number") t.rushLong = Math.max(t.rushLong ?? 0, st.rush_lng);
    t.tgt += v(st.rec_tgt); t.rec += v(st.rec); t.recYd += v(st.rec_yd); t.recTd += v(st.rec_td);
    t.pts += pts(e);
  }
  return t;
}

function addLines(lines: Line[]): Line {
  const t: Line = { ...EMPTY };
  for (const l of lines) {
    for (const k of Object.keys(t) as Array<keyof Line>) {
      if (k === "rushLong") continue;
      (t[k] as number) += l[k] as number;
    }
    if (l.rushLong !== null) t.rushLong = Math.max(t.rushLong ?? 0, l.rushLong);
  }
  return t;
}

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const fmtRatio = (a: number, b: number, digits = 1): string => {
  const r = ratio(a, b);
  return r === null ? DASH : signed(r.toFixed(digits));
};
const rating = (t: Line): number | null =>
  passerRating({ passAtt: t.att, passCmp: t.cmp, passYd: t.passYd, passTd: t.passTd, passInt: t.int } as never);

/* --------------------------------------------------------------- career */

interface SeasonRow {
  season: number;
  clubs: string[];
  line: Line;
  /** One line per club, in the order he played for them, when he was traded. */
  splits: Array<{ club: string; line: Line }>;
  finish: number | null;
  inProgress: boolean;
  weeks: GameLogEntry[];
}

interface Career {
  pos: string;
  rows: SeasonRow[];
  /** The season the page is about: the current one, or the last he played. */
  focus: SeasonRow | null;
  total: Line;
  leagueSeason: number;
  leagueWeek: number;
  pts: (e: GameLogEntry) => number;
}

function clubCode(raw: string | null | undefined): string {
  if (!raw) return "";
  return getTeamByAbbreviation(raw)?.code ?? raw.toUpperCase();
}

function career(data: PlayerPageData): Career {
  const pos = data.player.position ?? "";
  const leagueSeason = data.leagueSeason ?? data.season;
  const leagueWeek = data.leagueWeek ?? 0;
  const pts = (e: GameLogEntry): number => getEntryPoints(e.stats, data.format);
  const rows: SeasonRow[] = (data.logCareer ?? [])
    .filter((s: LogSeason) => s.weeks.length > 0)
    .map((s: LogSeason) => {
      const clubs: string[] = [];
      for (const e of s.weeks) {
        const c = clubCode(e.team);
        if (c && !clubs.includes(c)) clubs.push(c);
      }
      const splits =
        clubs.length > 1
          ? clubs.map((club) => ({ club, line: sumLine(s.weeks.filter((e) => clubCode(e.team) === club), pts) }))
          : [];
      const inProgress = s.season === leagueSeason && leagueWeek < 18;
      return {
        season: s.season,
        clubs,
        line: sumLine(s.weeks, pts),
        splits,
        // A season in progress is ranked as the header ranks it.
        finish: inProgress ? currentRank(data) ?? s.finish : s.finish,
        inProgress,
        weeks: s.weeks,
      };
    })
    .sort((x, y) => y.season - x.season);
  const focus = rows.find((r) => r.season === data.season) ?? rows[0] ?? null;
  // Summed from the season rows, never stored: a traded season counts once.
  return { pos, rows, focus, total: addLines(rows.map((r) => r.line)), leagueSeason, leagueWeek, pts };
}

/** The rank the header prints for the season on the page. */
function currentRank(data: PlayerPageData): number | null {
  const row = data.production?.find((r) => r.season === data.season);
  return row?.posFinishPpg ?? data.seasonRank ?? row?.posFinishTotal ?? data.seasonRankTotal ?? null;
}

/** Ranked metrics, best percentile first; descriptive and unranked ones dropped. */
function byPct(metrics: AdvMetric[]): AdvMetric[] {
  return metrics.filter((m) => m.pct !== null).sort((x, y) => y.pct! - x.pct!);
}

/* --------------------------------------------------- section 1: production */

interface Stat {
  label: string;
  total: string;
  /** The per-game figure, for a counting stat; rates and ranks have none. */
  pg?: string;
  small?: string;
}

function counting(label: string, total: number, gp: number): Stat {
  return { label, total: whole(total), pg: gp ? one(total / gp) : DASH };
}

function pair(label: string, a: number, b: number, gp: number): Stat {
  return {
    label,
    total: `${whole(a)} / ${whole(b)}`,
    pg: gp ? `${one(a / gp)} / ${one(b / gp)}` : DASH,
  };
}

function renderGroup(title: string, stats: Stat[], fan = false): string {
  if (stats.length === 0) return "";
  return (
    `<div class="scp-st-pgroup${fan ? " is-fan" : ""}"><h3>${escapeHtml(title)}</h3><dl>` +
    stats
      .map((s) => {
        const toggle = s.pg !== undefined ? ` data-total="${escapeHtml(s.total)}" data-pg="${escapeHtml(s.pg)}"` : "";
        return (
          `<div><dt>${escapeHtml(s.label)}</dt>` +
          `<dd><span${toggle}>${escapeHtml(s.total)}</span>` +
          (s.small ? `<small>${escapeHtml(s.small)}</small>` : "") +
          `</dd></div>`
        );
      })
      .join("") +
    `</dl></div>`
  );
}

function passingStats(t: Line): Stat[] {
  const r = rating(t);
  return [
    pair("Comp / Att", t.cmp, t.att, t.gp),
    counting("Yards", t.passYd, t.gp),
    pair("TD / INT", t.passTd, t.int, t.gp),
    { label: "Completion", total: t.att ? pct1((t.cmp / t.att) * 100) : DASH },
    { label: "Yards / att", total: fmtRatio(t.passYd, t.att) },
    { label: "Passer rating", total: r === null ? DASH : r.toFixed(1) },
  ];
}

function rushingStats(t: Line, full: boolean): Stat[] {
  const out = [
    counting(full ? "Carries" : "Attempts", t.rushAtt, t.gp),
    counting("Yards", t.rushYd, t.gp),
    { label: "Yards / carry", total: fmtRatio(t.rushYd, t.rushAtt) },
    counting("Touchdowns", t.rushTd, t.gp),
  ];
  if (full && t.rushLong !== null) out.push({ label: "Long", total: whole(t.rushLong) });
  return out;
}

function receivingStats(t: Line, full: boolean): Stat[] {
  const out = [counting("Targets", t.tgt, t.gp), counting("Receptions", t.rec, t.gp), counting("Yards", t.recYd, t.gp)];
  if (full) out.push({ label: "Yards / rec", total: fmtRatio(t.recYd, t.rec) });
  out.push(counting("TD", t.recTd, t.gp));
  if (full) out.push({ label: "Catch %", total: t.tgt ? pct1((t.rec / t.tgt) * 100) : DASH });
  return out;
}

interface WeekPick {
  entry: GameLogEntry;
  pts: number;
  caption: string;
}

function weekCaption(data: PlayerPageData, row: SeasonRow, e: GameLogEntry): string {
  // "@" or "vs" from the schedule feed, which is this season's only.
  const game = row.season === (data.leagueSeason ?? data.season)
    ? (data.schedule ?? []).find((g) => g.week === e.week)
    : undefined;
  const opp = clubCode(e.opp) || e.opp;
  const mark = game?.homeAway === "away" ? "@ " : game?.homeAway === "home" ? "vs " : "";
  return `Week ${e.week} ${mark}${opp}`.trim();
}

function bestWorst(data: PlayerPageData, c: Career, row: SeasonRow): { best: WeekPick; worst: WeekPick } | null {
  if (row.weeks.length === 0) return null;
  const picks = row.weeks.map((e) => ({ entry: e, pts: c.pts(e), caption: weekCaption(data, row, e) }));
  const sorted = [...picks].sort((x, y) => y.pts - x.pts || x.entry.week - y.entry.week);
  return { best: sorted[0]!, worst: sorted[sorted.length - 1]! };
}

function prodLede(data: PlayerPageData, c: Career, row: SeasonRow): string {
  const last = lastName(data.player.name);
  const t = row.line;
  const now = row.inProgress;
  const club = data.team && row.clubs[row.clubs.length - 1] === data.team.code ? `the ${data.team.nickname}` : null;
  const lastWeek = Math.max(...row.weeks.map((e) => e.week));
  const open = now
    ? `Through Week ${Math.max(lastWeek, c.leagueWeek)}${club ? ` with ${club}` : ""}. `
    : `His final ${row.season} numbers${club ? ` with ${club}` : ""}. `;

  // Strongest and weakest of this season's ranked marks, when he qualifies.
  const card = now ? data.statsAdvanced?.current : null;
  const ranked = byPct(card?.qualified ? card.metrics : []);
  let read = "";
  if (ranked.length >= 2) {
    const best = ranked[0]!;
    const worst = ranked[ranked.length - 1]!;
    if (best.standing !== worst.standing) {
      read = `${last} is ${best.standing === "good" ? "strong" : "steady"} in ${best.label.replace(LC, (w) => w.toLowerCase())} (${best.read}) ` +
        `but ${worst.standing === "bad" ? "weak" : "only middling"} in ${worst.label.replace(LC, (w) => w.toLowerCase())} (${worst.read})`;
    }
  }
  if (!read) {
    if (c.pos === "QB" && t.att) {
      read = `${last} ${now ? "is completing" : "completed"} ${pct1((t.cmp / t.att) * 100)} of his passes at ${fmtRatio(t.passYd, t.att)} yards per attempt`;
    } else if (c.pos === "RB" && t.rushAtt) {
      read = `${last} ${now ? "is averaging" : "averaged"} ${fmtRatio(t.rushYd, t.rushAtt)} yards per carry on ${one(t.rushAtt / t.gp)} carries a game`;
    } else if (t.tgt) {
      read = `${last} ${now ? "has caught" : "caught"} ${pct1((t.rec / t.tgt) * 100)} of his targets at ${fmtRatio(t.recYd, t.tgt)} yards per target`;
    }
  }

  // What the fantasy line leans on: the share of his points from touchdowns.
  const share = t.pts > 0 ? Math.round((tdPoints(t) / t.pts) * 100) : 0;
  const lean =
    share >= 40
      ? `${share}% of his fantasy points ${now ? "have come" : "came"} from touchdowns, so his weeks ${now ? "swing" : "swung"} with them`
      : share > 0
        ? `touchdowns ${now ? "are" : "were"} ${share}% of his fantasy points, so his output ${now ? "rests" : "rested"} on volume more than scoring`
        : "";
  const sentence = [read, lean].filter(Boolean).join(", and ");
  return escapeHtml(open + (sentence ? `${sentence}.` : ""));
}

/** Fantasy points from touchdowns, on scoring.ts's values: 4 a pass TD, 6 any other. */
function tdPoints(t: Line): number {
  return t.passTd * 4 + (t.rushTd + t.recTd) * 6;
}

function renderProduction(data: PlayerPageData, c: Career, options: PlayerRenderOptions): string {
  const row = c.focus;
  if (!row) return "";
  const t = row.line;
  const pos = c.pos;
  const groups: string[] = [];

  if (pos === "QB") {
    groups.push(renderGroup("Passing", passingStats(t)));
    groups.push(renderGroup("Rushing", rushingStats(t, false)));
  } else if (pos === "RB") {
    groups.push(renderGroup("Rushing", rushingStats(t, true)));
    groups.push(renderGroup("Receiving", receivingStats(t, false)));
  } else {
    groups.push(renderGroup("Receiving", receivingStats(t, true)));
    // Hidden for a receiver without a carry.
    if (t.rushAtt > 0) groups.push(renderGroup("Rushing", rushingStats(t, false)));
  }

  const bw = bestWorst(data, c, row);
  const rank = row.finish;
  const fan: Stat[] = [
    { label: "Points", total: one(t.pts), pg: t.gp ? one(t.pts / t.gp) : DASH },
    { label: "Position rank", total: rank ? `${pos}${rank}` : DASH },
  ];
  if (bw) {
    fan.push({ label: "Best week", total: one(bw.best.pts), small: bw.best.caption });
    if (row.weeks.length > 1) fan.push({ label: "Worst week", total: one(bw.worst.pts), small: bw.worst.caption });
  }
  groups.push(renderGroup(`Fantasy (${SCORING_SHORT[data.format]})`, fan, true));

  const href = `${options.playerPathPrefix ?? "/player/"}${data.player.slug}/game-log/${options.linkQuery ?? ""}`;
  return (
    sectionOpen(
      "scp-st-prod-h",
      `${data.player.name} ${row.season} stats`,
      own(data.statsCopy?.prod_lede) ? copyHtml(own(data.statsCopy?.prod_lede)!) : prodLede(data, c, row),
    ) +
    `<div class="scp-st-seg" role="group" aria-label="Show stats as" data-scp-seg>` +
    `<button type="button" data-mode="total" aria-pressed="true">Season totals</button>` +
    `<button type="button" data-mode="pg" aria-pressed="false">Per game</button>` +
    `</div>` +
    `<div class="scp-st-prod">${groups.join("")}</div>` +
    `<a class="scp-ox-more" href="${escapeHtml(href)}">See these stats game by game</a>` +
    `</section>`
  );
}

/* ---------------------------------------------------- section 2: advanced */

function renderMetric(m: AdvMetric): string {
  return (
    `<div><dt>${escapeHtml(m.label)}</dt><dd>${escapeHtml(signed(m.value))}` +
    `<small class="scp-st-rk is-${m.standing}">${escapeHtml(m.read)}</small></dd></div>`
  );
}

function renderAdvCard(title: string, sub: string, card: AdvCard): string {
  return (
    `<div class="scp-st-advcard"><h3>${escapeHtml(title)}</h3><p class="scp-st-sub">${escapeHtml(sub)}</p>` +
    `<dl class="scp-st-mgrid">${card.metrics.map(renderMetric).join("")}</dl></div>`
  );
}

const byKey = (card: AdvCard | null | undefined, label: string): AdvMetric | undefined =>
  card?.metrics.find((m) => m.label === label);

function advLede(data: PlayerPageData, pos: string, cards: AdvCard[]): string {
  const last = lastName(data.player.name);
  // The style sentence reads the full season when there is one.
  const lastCard = data.statsAdvanced?.last ?? null;
  let style = "";
  if (pos === "QB") {
    const deep = lastCard?.pct["deep"] ?? null;
    const ttt = lastCard?.pct["ttt"] ?? null;
    if (deep !== null) {
      style = deep >= 60
        ? `${last} pushes the ball downfield more than most ${pos}s`
        : deep <= 40 ? `${last} works the short and intermediate areas more than most ${pos}s`
          : `${last} throws downfield at about a league-average rate`;
      if (ttt !== null && ttt >= 60) style += " and holds the ball longer than most";
      else if (ttt !== null && ttt <= 40) style += " and gets the ball out quickly";
    }
  } else if (pos === "RB") {
    const snap = byKey(cards[0], "Snap share");
    const tgt = byKey(cards[0], "Target share");
    if (snap && tgt && snap.value !== DASH) style = `${last} is on the field for ${snap.value} of snaps and draws ${tgt.value} of his team's targets`;
  } else {
    const adot = lastCard ? byKey(lastCard, "Average depth of target") : undefined;
    const share = byKey(cards[0], "Target share");
    if (adot && adot.value !== DASH) {
      const p = lastCard?.pct["adot"] ?? 50;
      style = `${last} is ${p >= 60 ? "a downfield target" : p <= 40 ? "a short-area target" : "an intermediate target"} (${adot.value} yards per target last season)`;
    }
    if (share && share.value !== DASH) style += `${style ? ", with" : `${last} has`} a ${share.value} target share this season`;
  }

  // The tradeoff: his weakest ranked mark, in the words printed under it.
  const weak = byPct(cards.flatMap((c) => (c.qualified ? c.metrics : []))).filter((m) => m.standing === "bad").pop();
  const trade = weak ? `The tradeoff shows in his ${weak.label.replace(LC, (w) => w.toLowerCase())}: ${weak.value}, ${weak.read}.` : "";
  return escapeHtml([style ? `${style}.` : "", trade].filter(Boolean).join(" "));
}

function fantasyNote(data: PlayerPageData, c: Career, cards: AdvCard[]): string {
  const last = lastName(data.player.name);
  const pos = c.pos;
  const ranked = byPct(cards.flatMap((x) => (x.qualified ? x.metrics : [])));
  const good = ranked.filter((m) => m.standing === "good");
  const bad = ranked.filter((m) => m.standing === "bad").reverse();
  const row = c.focus;
  const parts: string[] = [];
  if (good.length) {
    parts.push(`<strong>What works:</strong> ${escapeHtml(`${good.slice(0, 2).map((m) => `${m.label.replace(LC, (w) => w.toLowerCase())} (${m.read})`).join(" and ")}.`)}`);
  }
  if (bad.length) {
    parts.push(`<strong>What limits him:</strong> ${escapeHtml(`${bad.slice(0, 2).map((m) => `${m.label.replace(LC, (w) => w.toLowerCase())} (${m.read})`).join(" and ")}.`)}`);
  }
  if (row && row.line.gp) {
    const t = row.line;
    const volume =
      pos === "QB" ? `${one(t.att / t.gp)} pass attempts and ${one(t.rushAtt / t.gp)} carries a game`
        : pos === "RB" ? `${one(t.rushAtt / t.gp)} carries and ${one(t.tgt / t.gp)} targets a game`
          : `${one(t.tgt / t.gp)} targets a game`;
    parts.push(escapeHtml(`For fantasy, ${last}'s floor is his volume, ${volume}${row.inProgress ? " this season" : ` in ${row.season}`}; the marks above decide how much of it turns into points.`));
  }
  if (parts.length === 0) return "";
  return `<div class="scp-st-read">${parts.join(" ")}</div>`;
}

/**
 * A rookie: no NFL season before this one. His Card B is his final college
 * season (spec, section 2 rules) when college_stats.json has him.
 */
function isRookie(data: PlayerPageData, c: Career): boolean {
  return c.rows.every((r) => r.season >= c.leagueSeason);
}

/** The college card's lede: where he came from, his best mark and his weakest. */
function collegeLede(data: PlayerPageData, card: CollegeCard): string {
  const last = lastName(data.player.name);
  const ranked = byPct(card.metrics);
  let text = `${last} arrives from ${card.school}.`;
  if (ranked.length >= 2) {
    const best = ranked[0]!;
    const worst = ranked[ranked.length - 1]!;
    text += ` His best mark in ${card.season} was ${best.label.replace(LC, (w) => w.toLowerCase())} (${best.value}, ${best.read}); ` +
      `his weakest, ${worst.label.replace(LC, (w) => w.toLowerCase())} (${worst.value}, ${worst.read}).`;
  }
  return escapeHtml(text);
}

function renderAdvanced(data: PlayerPageData, c: Career): string {
  const adv = data.statsAdvanced;
  const college = isRookie(data, c) ? collegeCard(data.college, c.pos) : null;
  if ((!adv || (!adv.current && !adv.last)) && !college) return "";
  const pos = c.pos;
  const cats = pos === "QB" ? "passing" : pos === "RB" ? "rushing" : "receiving";
  const cards: string[] = [];
  const used: AdvCard[] = [];
  const sources: string[] = [];

  if (adv?.current) {
    const cur = adv.current;
    const title = cur.throughWeek ? `${cur.season} through Week ${cur.throughWeek}` : `${cur.season} season`;
    const sub = cur.qualified
      ? `Rank or percentile among ${cur.qualifiedCount} qualified ${pos}s.`
      : `Below the qualifying line so far, so the figures are shown without ranks.`;
    cards.push(renderAdvCard(title, sub, cur));
    used.push(cur);
    sources.push(`${cur.season}: nflverse play-by-play and weekly stats`);
  }
  if (college) {
    const sub = `${college.school}, ${college.season}. ` +
      (college.qualified ? `Ranked among ${college.qualifiedCount} ${college.pool}.` : `Below the ${college.pool.replace(/^college \w+ with /, "")} line, so shown without ranks.`);
    cards.push(renderAdvCard("College final season", sub, college));
    used.push(college);
    sources.push(`college: CollegeFootballData.com season stats and PPA (its EPA)`);
  } else if (adv?.last) {
    const prev = adv.last;
    const sub = `${plural(prev.games, "game")} in weeks 1–17. ${prev.qualified ? `Compared with ${prev.qualifiedCount} qualified ${pos}s.` : "Below the qualifying line, so shown without ranks."}`;
    cards.push(renderAdvCard(`${prev.season} full season`, sub, prev));
    used.push(prev);
    sources.push(`${prev.season}: the StatChasers advanced stats table (nflverse play-by-play plus charting for ${pos === "QB" ? "time to throw and pressure" : pos === "RB" ? "contact yards and broken tackles" : "routes and depth of target"}), weeks 1–17`);
  }

  const copy = data.statsCopy;
  const note = own(copy?.adv_fantasy_note)
    ? `<div class="scp-st-read"><strong>What it means for fantasy:</strong> ${copyHtml(own(copy?.adv_fantasy_note)!)}</div>`
    : fantasyNote(data, c, used);
  const lede = own(copy?.adv_lede)
    ? copyHtml(own(copy?.adv_lede)!)
    : college && !adv?.current ? collegeLede(data, college) : advLede(data, pos, used);
  return (
    sectionOpen("scp-st-adv-h", `Advanced ${cats} stats`, lede) +
    `<div class="scp-st-adv2">${cards.join("")}</div>` +
    note +
    `<p class="scp-st-src">${escapeHtml(`Sources: ${sources.join("; ")}. Qualifying lines match the advanced stats tool's defaults, scaled to the weeks played. No proprietary grades are used.`)}</p>` +
    `</section>`
  );
}

/* ------------------------------------------------------- section 3: chart */

function renderChart(data: PlayerPageData, c: Career): string {
  const rows = [...c.rows].sort((x, y) => x.season - y.season);
  if (rows.length === 0) return "";
  const pos = c.pos;
  const ppg = (r: SeasonRow): number => (r.line.gp ? r.line.pts / r.line.gp : 0);
  const max = Math.max(...rows.map(ppg));
  const scale = Math.max(3, Math.ceil(max / 3) * 3);
  const careerPpg = c.total.gp ? c.total.pts / c.total.gp : 0;
  const done = rows.filter((r) => !r.inProgress);
  const best = done.length ? done.reduce((x, y) => (ppg(y) > ppg(x) ? y : x)) : null;
  const current = data.team?.code ?? "";
  const n = rows.length;

  const cols = rows
    .map((r) => {
      const v = ppg(r);
      const h = v <= 0 ? 1 : Math.max(1, (v / scale) * 100);
      const cls = r.inProgress ? " is-now" : best && r.season === best.season && n > 1 ? " is-best" : "";
      return `<div class="scp-st-col${cls}"><b>${one(v)}</b><i style="height:${h.toFixed(1)}%"></i></div>`;
    })
    .join("");
  const years = rows.map((r) => `<div><strong>${r.season}</strong>${r.line.gp} GP</div>`).join("");
  const teams = rows
    .map((r) => {
      const label = r.clubs.join("/") || DASH;
      return `<span${current && r.clubs.includes(current) ? ` class="is-cur"` : ""}>${escapeHtml(label)}</span>`;
    })
    .join("");

  const showAvg = n > 1;
  const aria =
    `${pos} fantasy points per game by season: ` +
    rows.map((r) => `${r.season} ${one(ppg(r))}${r.inProgress ? " (in progress)" : ""}`).join(", ") +
    (showAvg ? `. Career average ${one(careerPpg)}.` : ".");

  // The lede: how many clubs, where the best years came, and the pace now.
  const clubs = new Set(rows.flatMap((r) => r.clubs));
  const top = [...done].sort((x, y) => ppg(y) - ppg(x)).slice(0, 2).sort((x, y) => x.season - y.season);
  const sentences: string[] = [];
  sentences.push(
    `${plural(n, "season")}${clubs.size ? ` with ${word(clubs.size)} ${clubs.size === 1 ? "team" : "teams"}` : ""}` +
      (top.length && n > 1
        ? `; his best came in ${top.map((r) => `${r.season} (${one(ppg(r))})`).join(" and ")}.`
        : "."),
  );
  const now = rows.find((r) => r.inProgress);
  if (now && showAvg && now.line.gp) {
    const diff = ppg(now) - careerPpg;
    sentences.push(
      Math.abs(diff) < 0.5
        ? `This season's ${one(ppg(now))} is right on his career average of ${one(careerPpg)}.`
        : `This season's ${one(ppg(now))} is ${diff > 0 ? "above" : "below"} his career average of ${one(careerPpg)}.`,
    );
  }

  const legend =
    (best && n > 1 ? `<span class="is-best">Career best</span>` : "") +
    (now ? `<span class="is-now">${now.season}, in progress</span>` : "") +
    (showAvg ? `<span class="is-avg">Dashed line: career average</span>` : "");

  const avgPos = Math.min(1, careerPpg / scale);
  return (
    sectionOpen("scp-st-arc-h", "Fantasy points per game, every season", escapeHtml(sentences.join(" "))) +
    `<figure class="scp-st-arc${showAvg ? " has-avg" : ""}" style="--scp-n:${n};--scp-avg:${avgPos.toFixed(4)}">` +
    // The scroller is the chart alone, so the legend stays put while a long
    // career scrolls; client/player.ts opens it on the newest season.
    `<div class="scp-st-arc-scroll" data-scp-arc>` +
    `<div class="scp-st-plot${showAvg ? " has-avg" : ""}" role="img" aria-label="${escapeHtml(aria)}">` +
    cols +
    (showAvg ? `<span class="scp-st-avg" aria-hidden="true">Career avg<b>${one(careerPpg)}</b></span>` : "") +
    `</div>` +
    `<div class="scp-st-x" aria-hidden="true">${years}</div>` +
    `<div class="scp-st-teams" aria-hidden="true">${teams}</div>` +
    `</div>` +
    (legend ? `<figcaption class="scp-st-legend">${legend}</figcaption>` : "") +
    `</figure></section>`
  );
}

/* ------------------------------------------------------- section 4: table */

interface Col {
  label: string;
  group: number;
  of: (t: Line) => string;
}

function tableCols(pos: string): { groups: Array<{ label: string; span: number; fan?: boolean }>; cols: Col[] } {
  const c = (label: string, group: number, of: (t: Line) => string): Col => ({ label, group, of });
  if (pos === "QB") {
    return {
      groups: [{ label: "Passing", span: 6 }, { label: "Rushing", span: 2 }],
      cols: [
        c("Cmp", 0, (t) => whole(t.cmp)), c("Att", 0, (t) => whole(t.att)), c("Yds", 0, (t) => whole(t.passYd)),
        c("TD", 0, (t) => whole(t.passTd)), c("INT", 0, (t) => whole(t.int)), c("Y/A", 0, (t) => fmtRatio(t.passYd, t.att)),
        c("Rush Yds", 1, (t) => whole(t.rushYd)), c("Rush TD", 1, (t) => whole(t.rushTd)),
      ],
    };
  }
  if (pos === "RB") {
    return {
      groups: [{ label: "Rushing", span: 4 }, { label: "Receiving", span: 4 }],
      cols: [
        c("Car", 0, (t) => whole(t.rushAtt)), c("Yds", 0, (t) => whole(t.rushYd)),
        c("Y/C", 0, (t) => fmtRatio(t.rushYd, t.rushAtt)), c("TD", 0, (t) => whole(t.rushTd)),
        c("Tgt", 1, (t) => whole(t.tgt)), c("Rec", 1, (t) => whole(t.rec)),
        c("Yds", 1, (t) => whole(t.recYd)), c("TD", 1, (t) => whole(t.recTd)),
      ],
    };
  }
  return {
    groups: [{ label: "Receiving", span: 5 }, { label: "Rushing", span: 2 }],
    cols: [
      c("Tgt", 0, (t) => whole(t.tgt)), c("Rec", 0, (t) => whole(t.rec)), c("Yds", 0, (t) => whole(t.recYd)),
      c("Y/R", 0, (t) => fmtRatio(t.recYd, t.rec)), c("TD", 0, (t) => whole(t.recTd)),
      c("Rush Yds", 1, (t) => whole(t.rushYd)), c("Rush TD", 1, (t) => whole(t.rushTd)),
    ],
  };
}

function renderTable(data: PlayerPageData, c: Career): string {
  const { pos, rows } = c;
  if (rows.length === 0) return "";
  const { groups, cols } = tableCols(pos);
  const cells = (t: Line): string =>
    cols.map((col) => `<td>${escapeHtml(col.of(t))}</td>`).join("") +
    `<td>${one(t.pts)}</td><td>${t.gp ? one(t.pts / t.gp) : DASH}</td>`;
  const finishCell = (r: SeasonRow): string => {
    if (!r.finish) return `<td>${DASH}</td>`;
    return `<td class="scp-st-f is-${finishClass(pos, r.finish)}">${escapeHtml(`${pos}${r.finish}${r.inProgress ? "*" : ""}`)}</td>`;
  };

  const body = rows
    .map((r) => {
      // A traded season: a line per club, then the combined one, which is the
      // only one the career row counts.
      const splits = r.splits
        .map(
          (s) =>
            `<tr class="is-split"><th scope="row"><span class="scp-sr">${r.season} </span></th><td>${escapeHtml(s.club)}</td>` +
            `<td>${s.line.gp}</td>${cells(s.line)}<td></td></tr>`,
        )
        .join("");
      return (
        splits +
        `<tr${r.inProgress ? ` class="is-cur"` : ""}><th scope="row">${r.season}</th>` +
        `<td>${escapeHtml(r.splits.length ? `${r.clubs.length} teams` : r.clubs[0] ?? DASH)}</td>` +
        `<td>${r.line.gp}</td>${cells(r.line)}${finishCell(r)}</tr>`
      );
    })
    .join("");

  const t = c.total;
  const total = `<tr class="is-tot"><th scope="row">Career</th><td></td><td>${t.gp}</td>${cells(t)}<td>${DASH}</td></tr>`;

  const grp =
    `<tr class="scp-st-grp"><td colspan="3"></td>` +
    groups.map((g) => `<th colspan="${g.span}" scope="colgroup"><span>${escapeHtml(g.label)}</span></th>`).join("") +
    `<th colspan="3" scope="colgroup" class="is-fan"><span>Fantasy</span></th></tr>`;
  const head =
    `<tr><th scope="col">Season</th><th scope="col">Team</th><th scope="col">GP</th>` +
    cols.map((col) => `<th scope="col">${escapeHtml(col.label)}</th>`).join("") +
    `<th scope="col">Pts</th><th scope="col">PPG</th><th scope="col">Finish</th></tr>`;

  const cur = rows.find((r) => r.inProgress && r.finish);
  const n = rows.length;
  const best = [...rows].filter((r) => !r.inProgress && r.finish).sort((x, y) => x.finish! - y.finish!)[0];
  const lede =
    `${plural(n, "season")}, ${t.gp} games, ${one(t.pts)} fantasy points` +
    (best && n > 1 ? `. His best finish was ${pos}${best.finish} in ${best.season}.` : ".");

  return (
    sectionOpen("scp-st-table-h", `${data.player.name} career stats by season`, escapeHtml(lede)) +
    `<div class="scp-ox-tbl"><table class="scp-ox-table scp-st-table">` +
    `<caption>${escapeHtml(`Regular season only. Fantasy points use ${SCORING_WORDS[data.format]} (see scoring below). Finish is season-end rank among ${pos}s.`)}</caption>` +
    `<thead>${grp}${head}</thead><tbody>${body}${total}</tbody></table></div>` +
    (cur ? `<p class="scp-st-note">${escapeHtml(`*Current rank through Week ${c.leagueWeek}.`)}</p>` : "") +
    `</section>`
  );
}

/* ------------------------------------------- section 5: read, rates, highs */

/** A "starter" season by volume: the line a regular would clear. */
function isStarterSeason(pos: string, t: Line): boolean {
  if (!t.gp) return false;
  if (pos === "QB") return t.att / t.gp >= 20;
  if (pos === "RB") return (t.rushAtt + t.tgt) / t.gp >= 12;
  return t.tgt / t.gp >= (pos === "TE" ? 4 : 5);
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

function renderRead(data: PlayerPageData, c: Career, options: PlayerRenderOptions): string {
  const { pos, rows, total } = c;
  if (rows.length === 0 || total.gp === 0) return "";
  const name = data.player.name;
  const last = lastName(name);
  const redraft = `${REDRAFT_COMMAND_URL}?player=${encodeURIComponent(data.player.slug)}`;
  const ppg = (t: Line): number => (t.gp ? t.pts / t.gp : 0);
  const done = rows.filter((r) => !r.inProgress);
  const n = rows.length;
  const paragraphs: string[] = [];

  // 1. Career-level context.
  // Top-12 seasons at every position, as the spec words it; the table's
  // colours run deeper at RB and WR.
  const good = 12;
  const topSeasons = done.filter((r) => r.finish && r.finish <= good).sort((x, y) => x.season - y.season);
  const starter = rows.filter((r) => isStarterSeason(pos, r.line));
  const backup = rows.filter((r) => !isStarterSeason(pos, r.line));
  let p1 =
    `${last} has averaged ${one(ppg(total))} fantasy points per game over ${plural(total.gp, "game")} and ${plural(n, "season")}` +
    (topSeasons.length
      ? `, with ${word(topSeasons.length)} top-${good} finish${topSeasons.length > 1 ? "es" : ""} (${topSeasons.map((r) => r.season).join(", ")}).`
      : done.length ? `, without a top-${good} finish.` : ".");
  if (starter.length && backup.length) {
    p1 += ` The average hides two careers: ${one(ppg(addLines(starter.map((r) => r.line))))} a game in his ${word(starter.length)} ${starter.length === 1 ? "season" : "seasons"} with a starter's volume, ` +
      `${one(ppg(addLines(backup.map((r) => r.line))))} in the ${word(backup.length)} without it.`;
  }
  paragraphs.push(escapeHtml(p1));

  // 2. The recent trend, and who it runs through.
  const recent = rows.slice(0, 3);
  if (recent.length >= 2) {
    const [now, prev] = recent as [SeasonRow, SeasonRow];
    const diff = ppg(now.line) - ppg(prev.line);
    const vol = (t: Line): number =>
      t.gp ? (pos === "QB" ? t.att / t.gp : pos === "RB" ? (t.rushAtt + t.tgt) / t.gp : t.tgt / t.gp) : 0;
    const unit = pos === "QB" ? "pass attempts" : pos === "RB" ? "carries plus targets" : "targets";
    const dv = vol(now.line) - vol(prev.line);
    const volNow = vol(now.line);
    const volThen = vol(prev.line);
    const change = Math.abs(diff) < 0.5 ? "level with" : diff > 0 ? `up ${one(diff)} from` : `down ${one(-diff)} from`;
    let why: string;
    if (Math.abs(dv) < 1) {
      why = `His volume has held at about ${one(volNow)} ${unit} a game, so ${Math.abs(diff) < 0.5 ? "the output has too" : "the change is efficiency and scoring"}.`;
    } else if (Math.abs(diff) < 0.5) {
      why = `His volume is ${dv > 0 ? "up" : "down"} (${one(volNow)} ${unit} a game against ${one(volThen)}) but ${dv > 0 ? "less of it is turning into points" : "he is doing more with it"}.`;
    } else if (Math.sign(dv) === Math.sign(diff)) {
      why = `Volume is the driver: ${one(volNow)} ${unit} a game against ${one(volThen)}.`;
    } else {
      why = `That is despite ${dv > 0 ? "more" : "less"} volume (${one(volNow)} ${unit} a game against ${one(volThen)}), so efficiency and scoring are doing it.`;
    }
    const p2 =
      (now.inProgress ? `So far in ${now.season} he is at ` : `In ${now.season} he averaged `) + `${one(ppg(now.line))} per game, ` +
      `${change} ${prev.season}. ${why}`;
    const mates = data.teammates ?? [];
    let mateHtml = "";
    const when = now.inProgress ? "this season" : `in ${now.season}`;
    if (mates.length) {
      const link = (m: { slug: string | null; name: string }): string =>
        m.slug ? a(`${options.playerPathPrefix ?? "/player/"}${m.slug}/${options.linkQuery ?? ""}`, m.name) : escapeHtml(m.name);
      mateHtml =
        pos === "QB"
          ? ` His most-targeted receiver${mates.length > 1 ? "s" : ""} ${when} ${now.inProgress ? (mates.length > 1 ? "have been" : "has been") : mates.length > 1 ? "were" : "was"} ${mates.map(link).join(" and ")}.`
          : ` His quarterback ${when} ${now.inProgress ? "has been" : "was"} ${mates.map(link).join(" and ")}.`;
    }
    paragraphs.push(escapeHtml(p2) + mateHtml);
  }

  // An analyst's paragraphs (up to three) replace the two generated ones; the
  // Redraft Command paragraph stays last either way, since it carries the
  // tracked link.
  const written = (data.statsCopy?.career_paragraphs ?? []).map(own).filter((p): p is string => p !== null).slice(0, 3);
  if (written.length) paragraphs.splice(0, paragraphs.length, ...written.map(copyHtml));

  // 3. The forward call.
  paragraphs.push(
    escapeHtml("Career numbers describe the past; for what he is worth from here, ") +
      a(redraft, `see ${last}'s rest-of-season rank and trade value in Redraft Command`, ` data-cta="redraft-command-stats-prose"`) +
      ".",
  );

  const rc =
    `<div class="scp-ox-panel is-rc"><h3>Redraft Command</h3>` +
    `<p>${escapeHtml(`Career stats tell you who he's been. Redraft Command projects what he's worth from here: rest-of-season rank, trade value and waiver priority for your league settings.`)}</p>` +
    `<a class="scp-ox-btn" href="${escapeHtml(redraft)}" data-cta="redraft-command-stats-sidebar">${escapeHtml(`Open ${last} in Redraft Command`)}</a>` +
    `</div>`;

  /* ---- career rates ---- */
  const first = Math.min(...rows.map((r) => r.season));
  const lastSeason = c.leagueWeek > 0 ? c.leagueSeason : Math.max(...rows.map((r) => r.season));
  let games = 0;
  for (let s = first; s <= lastSeason; s++) {
    if (s === c.leagueSeason && c.leagueWeek > 0 && c.leagueWeek < 18) {
      const finals = (data.schedule ?? []).filter((g) => g.status === "final").length;
      games += finals || Math.max(...(rows.find((r) => r.season === s)?.weeks.map((e) => e.week) ?? [c.leagueWeek]));
    } else games += teamGames(s);
  }
  const allWeeks = rows.flatMap((r) => r.weeks);
  const ranked = allWeeks.filter((e) => typeof e.pos_rank === "number");
  const n12 = topN(pos);
  const top = ranked.filter((e) => e.pos_rank! <= n12).length;
  const sd = stdev(allWeeks.map(c.pts));
  const tiles: string[] = [
    rate(one(ppg(total)), "Career PPG", `${plural(total.gp, "game")} over ${plural(n, "season")}`),
  ];
  if (games > 0) tiles.push(rate(`${Math.min(100, Math.round((total.gp / games) * 100))}%`, "Availability", "Share of team games he played"));
  if (ranked.length) tiles.push(rate(`${Math.round((top / ranked.length) * 100)}%`, `Top-${n12} weeks`, n12 === 12 ? `Share of his games as a ${pos}1` : `Share of his games as a top-${n12} ${pos}`));
  if (n > 1 && allWeeks.length > 1) tiles.push(rate(one(sd), "Weekly swing", `Standard deviation, ${swingWord(pos, sd)}`));

  /* ---- career highs ---- */
  const bests = careerHighs(c);

  return (
    sectionOpen("scp-st-read-h", "What his career numbers say", "") +
    byline(data) +
    `<div class="scp-ox-read">` +
    `<div><div class="scp-ox-prose">${paragraphs.map((p) => `<p>${p}</p>`).join("")}</div></div>` +
    `<aside class="scp-ox-aside" aria-label="${escapeHtml(`${last} in Redraft Command`)}">${rc}</aside>` +
    `</div>` +
    `<div class="scp-st-rates">${tiles.join("")}</div>` +
    bests +
    `</section>`
  );
}

function rate(value: string, title: string, caption: string): string {
  return `<div class="scp-st-rate"><p class="scp-st-v">${escapeHtml(value)}</p><h3>${escapeHtml(title)}</h3><p>${escapeHtml(caption)}</p></div>`;
}

function careerHighs(c: Career): string {
  const { pos, rows, total } = c;
  const done = rows.filter((r) => r.line.gp > 0);
  if (done.length === 0) return "";
  const top = (of: (t: Line) => number): SeasonRow =>
    done.reduce((x, y) => (of(y.line) > of(x.line) ? y : x));
  // "Passing yards, 2025": the value, what it is and the season it came in.
  const items: Array<{ v: string; label: string }> = [];
  const push = (of: (t: Line) => number, label: string): void => {
    const r = top(of);
    if (of(r.line) > 0) items.push({ v: whole(of(r.line)), label: `${label}, ${r.season}` });
  };
  if (pos === "QB") {
    push((t) => t.passYd, "Passing yards");
    push((t) => t.passTd, "Passing TDs");
  } else if (pos === "RB") {
    push((t) => t.rushYd, "Rushing yards");
    push((t) => t.rushTd + t.recTd, "Total TDs");
  } else {
    push((t) => t.recYd, "Receiving yards");
    push((t) => t.recTd, "Receiving TDs");
  }
  const bestFan = top((t) => t.pts);
  items.push({
    v: one(bestFan.line.pts),
    label: `Fantasy points, ${bestFan.season}${bestFan.finish && !bestFan.inProgress ? ` (${pos}${bestFan.finish})` : ""}`,
  });
  if (pos === "QB") items.push({ v: whole(total.passYd), label: "Career passing yards" });
  else if (pos === "RB") items.push({ v: whole(total.rushYd + total.recYd), label: "Career scrimmage yards" });
  else items.push({ v: whole(total.recYd), label: "Career receiving yards" });
  return (
    `<h3 class="scp-st-bests-h">Career highs</h3>` +
    `<ul class="scp-st-bests">` +
    items.map((i) => `<li><span class="scp-st-v">${escapeHtml(i.v)}</span><span>${escapeHtml(i.label)}</span></li>`).join("") +
    `</ul>`
  );
}

/**
 * "By the StatChasers staff. Updated September 29, 2026."
 *
 * The analyst's name and date when stats_copy.json gives them; otherwise the
 * staff, dated by when the game logs were last written.
 */
function byline(data: PlayerPageData): string {
  const copy = data.statsCopy;
  const author = own(copy?.author) ?? "the StatChasers staff";
  const written = own(copy?.updated_date);
  let d: Date | null = null;
  if (written && /^\d{4}-\d{2}-\d{2}$/.test(written)) d = new Date(`${written}T12:00:00Z`);
  else if (data.statsUpdatedMs) d = new Date(data.statsUpdatedMs);
  if (!d || Number.isNaN(d.getTime())) return "";
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const human = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "long", day: "numeric" }).format(d);
  return `<p class="scp-st-byline">${escapeHtml(`By ${author}. Updated `)}<time datetime="${iso}">${escapeHtml(human)}</time>.</p>`;
}

/** The scoring rules, in the words the career table's caption points down to. */
function renderFooter(data: PlayerPageData): string {
  const rec =
    data.format === "ppr" ? "1 point per reception, " : data.format === "half" ? "half a point per reception, " : "no points for receptions, ";
  return (
    `<footer class="scp-st-foot"><p>${escapeHtml(
      `Stats are official NFL regular-season data processed by StatChasers. Fantasy points use ${SCORING_WORDS[data.format]} scoring: ` +
        `${rec}1 per 25 passing yards, 4 per passing TD, ${MINUS}1 per interception, 1 per 10 rushing or receiving yards and 6 per rushing or receiving TD.` +
        // PPR and half-PPR are Sleeper's stored points (scoring.ts), which also
        // count what the formula above leaves out.
        (data.format === "standard" ? "" : " Two-point conversions and lost fumbles count as Sleeper scores them."),
    )}</p></footer>`
  );
}

/* ---------------------------------------------------------- section 6: FAQ */

interface Faq {
  question: string;
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

export function statsTabFaqs(data: PlayerPageData, options: PlayerRenderOptions = {}): Faq[] {
  const c = career(data);
  const row = c.focus;
  if (!row) return [];
  const name = data.player.name;
  const pos = c.pos;
  const t = row.line;
  const tot = c.total;
  const label = SCORING_SHORT[data.format];
  const yr = row.season;
  const so = row.inProgress ? "has" : "had";
  const out: Faq[] = [];

  // 1. Yards.
  if (pos === "QB") {
    out.push(faq(`How many passing yards does ${name} have in ${yr}?`, [
      `${name} ${so} ${whole(t.passYd)} passing yards in ${yr}, ${one(t.passYd / t.gp)} per game over ${plural(t.gp, "game")}, ` +
        `at ${fmtRatio(t.passYd, t.att)} yards per attempt${t.att ? ` with a ${pct1((t.cmp / t.att) * 100)} completion rate` : ""}.`,
    ]));
  } else if (pos === "RB") {
    out.push(faq(`How many rushing yards does ${name} have in ${yr}?`, [
      `${name} ${so} ${whole(t.rushYd)} rushing yards on ${plural(t.rushAtt, "carry").replace("carrys", "carries")} in ${yr}, ` +
        `${one(t.rushYd / t.gp)} per game at ${fmtRatio(t.rushYd, t.rushAtt)} yards per carry.`,
    ]));
  } else {
    out.push(faq(`How many receiving yards does ${name} have in ${yr}?`, [
      `${name} ${so} ${whole(t.recYd)} receiving yards on ${t.rec} catches and ${t.tgt} targets in ${yr}, ` +
        `${one(t.recYd / t.gp)} per game at ${fmtRatio(t.recYd, t.rec)} yards per catch.`,
    ]));
  }

  // 2. Touchdowns.
  const split =
    pos === "QB" ? `${plural(t.passTd, "passing touchdown")} and ${plural(t.rushTd, "rushing touchdown")}`
      : pos === "RB" ? `${plural(t.rushTd, "rushing touchdown")} and ${plural(t.recTd, "receiving touchdown")}`
        : `${plural(t.recTd, "receiving touchdown")}${t.rushTd ? ` and ${plural(t.rushTd, "rushing touchdown")}` : ""}`;
  const careerTd =
    pos === "QB" ? `${tot.passTd} passing and ${tot.rushTd} rushing`
      : tot.rushTd && tot.recTd ? `${tot.rushTd + tot.recTd} total (${tot.rushTd} rushing, ${tot.recTd} receiving)`
        : tot.recTd ? `${tot.recTd} receiving` : `${tot.rushTd} rushing`;
  out.push(faq(`How many touchdowns does ${name} have?`, [
    `${name} ${so} ${split} in ${yr}. Across his career he has ${careerTd} touchdowns.`,
  ]));

  // 3. Fantasy points.
  const rank = row.finish;
  const bestSeason = c.rows.filter((r) => !r.inProgress && r.line.gp).sort((x, y) => y.line.pts - x.line.pts)[0];
  const overview = `${options.playerPathPrefix ?? "/player/"}${data.player.slug}/${options.linkQuery ?? ""}`;
  out.push(faq(`How many fantasy points does ${name} have?`, [
    `${name} ${so} ${one(t.pts)} ${label} fantasy points in ${yr}, ${one(t.pts / t.gp)} per game` +
      (rank ? `, ranking ${pos}${rank}${row.inProgress ? " so far" : ""}. ` : ". ") +
      (bestSeason && bestSeason.season !== yr
        ? `His best season was ${bestSeason.season}: ${one(bestSeason.line.pts)} points${bestSeason.finish ? ` and a ${pos}${bestSeason.finish} finish` : ""}. `
        : ""),
    { href: overview, text: `See his fantasy outlook on the ${lastName(name)} overview` },
    ".",
  ]));

  // 4. Career.
  const seasons = c.rows.length;
  const line =
    pos === "QB"
      ? `${whole(tot.passYd)} passing yards, ${tot.passTd} touchdowns and ${tot.int} interceptions, plus ${whole(tot.rushYd)} rushing yards and ${plural(tot.rushTd, "rushing touchdown")}`
      : pos === "RB"
        ? `${whole(tot.rushYd)} rushing yards and ${tot.rushTd} rushing touchdowns, plus ${tot.rec} catches for ${whole(tot.recYd)} yards and ${tot.recTd} touchdowns`
        : `${tot.rec} catches for ${whole(tot.recYd)} yards and ${tot.recTd} touchdowns, plus ${whole(tot.rushYd)} rushing yards and ${plural(tot.rushTd, "rushing touchdown")}`;
  out.push(faq(`What are ${name}'s career stats?`, [
    `In ${plural(seasons, "season")} and ${plural(tot.gp, "game")}, ${name} has ${line}. ` +
      `That is ${one(tot.gp ? tot.pts / tot.gp : 0)} ${label} fantasy points per game.`,
  ]));
  return out;
}

function renderFaq(data: PlayerPageData, options: PlayerRenderOptions): string {
  const items = statsTabFaqs(data, options);
  if (items.length === 0) return "";
  // Not pushed to options.faqSink: adding these to the page's FAQPage JSON-LD
  // is an SEO change, which mak approves separately.
  return (
    sectionOpen("scp-st-faq-h", `${data.player.name} stats FAQ`, "") +
    `<div class="scp-ox-faq scp-st-faq">` +
    items
      .map((f, i) => `<details${i === 0 ? " open" : ""}><summary>${escapeHtml(f.question)}</summary><p>${f.html}</p></details>`)
      .join("") +
    `</div></section>`
  );
}

/* ------------------------------------------------------------ the tab */

/**
 * A rookie before his first NFL game: his college seasons, under the caption
 * the spec gives them ("College stats"). No fantasy columns: fantasy points are
 * an NFL scoring and his college games were not scored.
 */
function renderCollegeTable(data: PlayerPageData, pos: string): string {
  const profile = data.college;
  if (!profile?.seasons?.length) return "";
  type S = (typeof profile.seasons)[number];
  const v = (x: number | undefined | null): string => (typeof x === "number" ? whole(x) : DASH);
  const r = (a: number | undefined, b: number | undefined): string => (a !== undefined && b ? one(a / b) : DASH);
  const groups: Array<{ label: string; cols: Array<[string, (s: S) => string]> }> = [];
  const pass: Array<[string, (s: S) => string]> = [
    ["Cmp", (s) => v(s.pass?.cmp)], ["Att", (s) => v(s.pass?.att)], ["Yds", (s) => v(s.pass?.yds)],
    ["TD", (s) => v(s.pass?.td)], ["INT", (s) => v(s.pass?.int)], ["Y/A", (s) => r(s.pass?.yds, s.pass?.att)],
  ];
  const rush: Array<[string, (s: S) => string]> = [
    ["Car", (s) => v(s.rush?.att)], ["Yds", (s) => v(s.rush?.yds)], ["Y/C", (s) => r(s.rush?.yds, s.rush?.att)], ["TD", (s) => v(s.rush?.td)],
  ];
  const rec: Array<[string, (s: S) => string]> = [
    ["Rec", (s) => v(s.rec?.rec)], ["Yds", (s) => v(s.rec?.yds)], ["Y/R", (s) => r(s.rec?.yds, s.rec?.rec)], ["TD", (s) => v(s.rec?.td)],
  ];
  if (pos === "QB") groups.push({ label: "Passing", cols: pass }, { label: "Rushing", cols: rush });
  else if (pos === "RB") groups.push({ label: "Rushing", cols: rush }, { label: "Receiving", cols: rec });
  else groups.push({ label: "Receiving", cols: rec }, { label: "Rushing", cols: rush });
  // A group he never touched is dropped rather than shown as dashes.
  const used = groups.filter((g) => profile.seasons.some((s) => g.cols.some(([, of]) => of(s) !== DASH && of(s) !== "0")));
  if (used.length === 0) return "";
  const rows = [...profile.seasons].sort((x, y) => y.season - x.season);
  const body = rows
    .map((s) => `<tr><th scope="row">${s.season}</th><td>${escapeHtml(s.school)}</td>` +
      used.map((g) => g.cols.map(([, of]) => `<td>${escapeHtml(of(s))}</td>`).join("")).join("") + `</tr>`)
    .join("");
  const schools = [...new Set(rows.map((s) => s.school))];
  const lede = `${plural(rows.length, "college season")} at ${schools.join(" and ")}. He has not played an NFL game yet.`;
  return (
    sectionOpen("scp-st-table-h", `${data.player.name} college stats by season`, escapeHtml(lede)) +
    `<div class="scp-ox-tbl"><table class="scp-ox-table scp-st-table">` +
    `<caption>College stats, from CollegeFootballData.com.</caption>` +
    `<thead><tr class="scp-st-grp"><td colspan="2"></td>` +
    used.map((g) => `<th colspan="${g.cols.length}" scope="colgroup"><span>${escapeHtml(g.label)}</span></th>`).join("") +
    `</tr><tr><th scope="col">Season</th><th scope="col">School</th>` +
    used.map((g) => g.cols.map(([label]) => `<th scope="col">${escapeHtml(label)}</th>`).join("")).join("") +
    `</tr></thead><tbody>${body}</tbody></table></div></section>`
  );
}

/**
 * The whole Stats tab, in the spec's order. A rookie before his first NFL game
 * gets only his college card and college table (spec, edge states); a player
 * with neither NFL games nor college data gets nothing.
 */
export function renderStatsTab(data: PlayerPageData, options: PlayerRenderOptions = {}): string {
  const c = career(data);
  if (!["QB", "RB", "WR", "TE"].includes(c.pos)) return "";
  const ink = teamInk(data.team);
  const open = `<div class="scp-ox scp-st"${ink ? ` style="--scp-team:${escapeHtml(ink)}"` : ""}>`;
  if (!c.focus) {
    // No NFL games: only his college seasons can say anything here.
    if (!collegeCard(data.college, c.pos)) return "";
    const college = renderAdvanced(data, c) + renderCollegeTable(data, c.pos);
    return college ? `${open}${college}</div>` : "";
  }
  return (
    open +
    renderProduction(data, c, options) +
    renderAdvanced(data, c) +
    renderChart(data, c) +
    renderTable(data, c) +
    renderRead(data, c, options) +
    renderFaq(data, options) +
    renderFooter(data) +
    `</div>`
  );
}
