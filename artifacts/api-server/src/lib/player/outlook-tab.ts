/**
 * The Outlook tab's spec sections, to mak's "Build Instructions: StatChasers
 * Player Outlook Tab" of 2026-09-29, appended UNDER the tab's existing content
 * (mak's instruction; see new-spec-sections-go-below).
 *
 * Seven sections: the take, the expectation check, the written outlook with its
 * sidebar, the drivers with their rank strips, contract and job security, what
 * could change his value, and a FAQ; then the Outlook footer. Each is a
 * <section aria-labelledby> with an H2 and is left out whole when its data is
 * not there.
 *
 * What the spec asks for that this server cannot supply, and what it does
 * instead, all within the spec's own fallbacks:
 *   - No weekly analyst take exists, so the staleness rule always resolves to
 *     the template version: tier line, summary and four paragraphs are built
 *     from the numbers on the page. The byline only dates the preseason piece.
 *     The authored record (fantasy_outlook_2026.json) is the preseason piece and
 *     is the archived "preseason outlook", printed as published.
 *   - No Redraft Command rank reaches this server, so the league-fit chips are
 *     derived from his season-to-date positional rank (last season's finish
 *     before Week 1) through the spec's cutoff table.
 *   - No contract feed: the deal card is hidden, as the spec says, and "How he
 *     got here" is his draft and club history from the bio.
 *   - No authored upside/risk bullets: generated from the schedule, the drivers,
 *     the depth chart and the injury designation.
 *   - SEO is untouched (mak): no title, meta or JSON-LD changes, and this FAQ
 *     is not added to the page's FAQPage node.
 *
 * Pure apart from the driver field (outlook-tab-data.ts), which reads the
 * outlook records.
 */

import { escapeHtml } from "../render";
import { titleCase } from "./title-case";
import type { PlayerRenderOptions } from "../player-render";
import type { PlayerPageData } from "./player-data";
import { getEntryPoints, SCORING_SHORT } from "./scoring";
import { lastName, matchupBand, teamInk } from "./header";
import { outlookMeasures, type DriverRow, type OutlookMeasures } from "./outlook-tab-data";
import { sectionHref } from "./sections";
import type { UpcomingGame } from "./upcoming";
import { renderFaqSection, selectFaq, type FaqCandidate } from "./faq-engine";

const REDRAFT_COMMAND_URL = "https://statchasers.com/redraft-command/";
const MINUS = "−";
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/* ------------------------------------------------------------------ atoms */

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

const word = (n: number): string => WORDS[n] ?? String(n);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const one = (v: number): string => v.toFixed(1).replace(/^-/, MINUS);

function a(href: string, text: string, attrs = ""): string {
  return `<a href="${escapeHtml(href)}"${attrs}>${escapeHtml(text)}</a>`;
}

function open(id: string, heading: string, lede: string, extra = ""): string {
  return (
    `<section class="scp-ox-sec${extra}" aria-labelledby="${id}">` +
    `<h2 class="scp-ox-h2" id="${id}">${escapeHtml(titleCase(heading))}</h2>` +
    (lede ? `<p class="scp-ox-lede">${escapeHtml(lede)}</p>` : "")
  );
}

/** "2026-06-16" → { iso, text: "June 16, 2026", month: "June 2026" }. */
function dateParts(raw: string | null | undefined): { iso: string; text: string; month: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw ?? "");
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return null;
  return { iso: `${m[1]}-${m[2]}-${m[3]}`, text: `${month} ${Number(m[3])}, ${m[1]}`, month: `${month} ${m[1]}` };
}

/* ------------------------------------------------------------------ model */

type Chip = { label: string; kind: "good" | "mid" | "bad" };

const STARTER: Chip = { label: "Weekly starter", kind: "good" };
const STREAM: Chip = { label: "Streamer", kind: "mid" };
const FLEX: Chip = { label: "Flex play", kind: "mid" };
const MATCHUP: Chip = { label: "Matchup play", kind: "mid" };
const STASH: Chip = { label: "Bench stash", kind: "mid" };
const WAIVER: Chip = { label: "Waiver wire", kind: "bad" };

const LEAGUES: Record<string, [string, string, string]> = {
  QB: ["Superflex / 2QB", "1QB, 12+ teams", "1QB, 10 teams"],
  RB: ["12-team PPR", "10-team PPR", "Half-PPR"],
  WR: ["12-team PPR", "10-team PPR", "Half-PPR"],
  TE: ["TE-premium", "12-team", "10-team"],
};

/** The spec's cutoff table: his rank to a chip per league row. */
export function leagueChips(pos: string, rank: number): [Chip, Chip, Chip] {
  if (pos === "QB") {
    if (rank <= 12) return [STARTER, STARTER, STARTER];
    if (rank <= 20) return [STARTER, STREAM, STREAM];
    if (rank <= 28) return [STARTER, STREAM, WAIVER];
    if (rank <= 36) return [STREAM, WAIVER, WAIVER];
    return [STASH, WAIVER, WAIVER];
  }
  if (pos === "TE") {
    if (rank <= 12) return [STARTER, STARTER, STARTER];
    if (rank <= 18) return [STARTER, MATCHUP, MATCHUP];
    if (rank <= 24) return [MATCHUP, STASH, WAIVER];
    return [STASH, WAIVER, WAIVER];
  }
  if (rank <= 24) return [STARTER, STARTER, STARTER];
  if (rank <= 36) return [FLEX, FLEX, FLEX];
  if (rank <= 48) return [STASH, WAIVER, STASH];
  return [WAIVER, WAIVER, WAIVER];
}

interface SeasonLine {
  season: number;
  gp: number;
  points: number;
  ppg: number;
  rank: number | null;
}

interface Model {
  name: string;
  last: string;
  pos: string;
  slug: string;
  rc: string;
  season: number;
  week: number;
  preseason: boolean;
  now: SeasonLine | null;
  prior: SeasonLine | null;
  /** The rank everything is judged on: this season's, or last season's before Week 1. */
  rank: number | null;
  projected: number | null;
  measures: OutlookMeasures | null;
  chips: [Chip, Chip, Chip] | null;
  injured: string | null;
  upcoming: UpcomingGame[];
  scoring: string;
}

/** The rank the header prints for this season. */
function currentRank(data: PlayerPageData): number | null {
  const row = data.production?.find((r) => r.season === data.season);
  return row?.posFinishPpg ?? data.seasonRank ?? row?.posFinishTotal ?? data.seasonRankTotal ?? null;
}

function seasonLine(data: PlayerPageData, season: number, rank: number | null): SeasonLine | null {
  const log = (data.logCareer ?? []).find((s) => s.season === season);
  if (!log || log.weeks.length === 0) return null;
  const points = log.weeks.reduce((sum, e) => sum + getEntryPoints(e.stats, data.format), 0);
  const gp = log.weeks.length;
  return { season, gp, points, ppg: points / gp, rank: rank ?? log.finish };
}

/**
 * The preseason projection, from the published record: its authored range when
 * it has one, otherwise the rank its own text names ("around the QB30 range").
 */
export function projectedRank(data: PlayerPageData): number | null {
  const record = data.fantasyOutlook2026;
  const band = record?.range?.expected;
  if (band && Number.isFinite(band.best) && Number.isFinite(band.worst)) {
    return Math.round((band.best + band.worst) / 2);
  }
  const pos = data.player.position ?? "";
  const m = new RegExp(`\\b${pos}(\\d{1,2}) range\\b`).exec(record?.body ?? "");
  return m ? Number(m[1]) : null;
}

function model(data: PlayerPageData): Model | null {
  const pos = data.player.position ?? "";
  if (!LEAGUES[pos]) return null;
  const season = data.leagueSeason ?? data.season;
  const week = data.leagueWeek ?? 0;
  const now = seasonLine(data, season, currentRank(data));
  const prior = seasonLine(data, season - 1, null);
  const preseason = week < 1 || !now;
  const rank = preseason ? prior?.rank ?? null : now?.rank ?? null;
  const status = (data.designation?.injuryStatus ?? data.player.injury_status ?? "").trim();
  const out = /^(out|ir|pup|injured reserve|doubtful)/i.test(status);
  const part = data.designation?.injuryBodyPart ?? null;
  let chips = rank === null ? null : leagueChips(pos, rank);
  if (chips && out) {
    // Injured: a spot on the bench or nothing, never a start.
    chips = chips.map((c) => (c.kind === "bad" ? WAIVER : STASH)) as [Chip, Chip, Chip];
  }
  return {
    name: data.player.name,
    last: lastName(data.player.name),
    pos,
    slug: data.player.slug,
    rc: `${REDRAFT_COMMAND_URL}?player=${encodeURIComponent(data.player.slug)}`,
    season,
    week,
    preseason,
    now,
    prior,
    rank,
    projected: projectedRank(data),
    measures: outlookMeasures(data.fantasyOutlook2026),
    chips,
    injured: out ? `${cap(status.toLowerCase() === "ir" ? "on injured reserve" : status.toLowerCase())}${part ? `, ${part.toLowerCase()}` : ""}` : null,
    upcoming: (data.upcoming ?? []).slice(0, 4),
    scoring: SCORING_SHORT[data.format] ?? "PPR",
  };
}

/** "a weekly starter in superflex and 2QB leagues and a streamer in 1QB leagues", for the Overview FAQ. */
export function leagueFit(data: PlayerPageData): string | null {
  const m = model(data);
  return m && m.chips ? fitSentence(m) : null;
}

/**
 * "QB2, streamer": the tier and the 12-team league's call in a few words, for
 * the News tab's quick answers. Null when the tab itself would have no tier.
 */
export function outlookShort(data: PlayerPageData): string | null {
  const m = model(data);
  if (!m || m.rank === null || !m.chips) return null;
  return `${bucket(m.pos, m.rank)}, ${m.chips[1].label.toLowerCase()}`;
}

/**
 * The News sidebar's snapshot (mak, 2026-10-05): the season tier ("QB2") and
 * the 1QB/12-team call ("Streamer"), the same two words outlookShort joins.
 */
export function outlookSnapshot(data: PlayerPageData): { tier: string; call: string } | null {
  const m = model(data);
  if (!m || m.rank === null || !m.chips) return null;
  return { tier: bucket(m.pos, m.rank), call: m.chips[1].label };
}

/** "QB2": the fantasy tier a rank sits in. */
function bucket(pos: string, rank: number): string {
  const size = pos === "QB" || pos === "TE" ? 12 : 12;
  const tier = Math.floor((rank - 1) / size) + 1;
  if (pos === "TE" && tier > 2) return "depth TE";
  if (tier > 4) return `depth ${pos}`;
  return `${pos}${tier}`;
}

const ADJECTIVE: Record<string, string> = {
  "Passing volume": "Volume-driven",
  Efficiency: "Efficient",
  Rushing: "Dual-threat",
  "Rushing volume": "Workhorse",
  "Receiving role": "Pass-catching",
  "Target volume": "Target-heavy",
  "Downfield role": "Downfield",
  "Route participation": "Every-down",
  "Target share": "Target-heavy",
};

const PHRASE: Record<string, string> = {
  "Weekly starter": "every week",
  Streamer: "with streaming weeks",
  "Flex play": "with flex weeks",
  "Matchup play": "with matchup weeks",
  "Bench stash": "worth a bench spot",
  "Waiver wire": "for deep leagues only",
};

function topDriver(m: Model): DriverRow | null {
  const ranked = (m.measures?.drivers ?? []).filter((d) => d.rank !== null);
  return ranked.sort((x, y) => x.rank! / x.of - y.rank! / y.of)[0] ?? null;
}

function weakDriver(m: Model): DriverRow | null {
  const ranked = (m.measures?.drivers ?? []).filter((d) => d.rank !== null);
  const worst = ranked.sort((x, y) => y.rank! / y.of - x.rank! / x.of)[0] ?? null;
  return worst && worst.tier !== "good" ? worst : null;
}

/** The template tier line: "{Role adjective} {POS}{tier} {strength}", 4–8 words, no period. */
export function tierLine(m: Model): string | null {
  if (m.rank === null || !m.chips) return null;
  const top = topDriver(m);
  const adj = top && top.tier === "good" ? ADJECTIVE[top.label] ?? null : null;
  const phrase = PHRASE[m.chips[1].label] ?? "";
  if (m.injured) return `${adj ? `${adj} ` : ""}${bucket(m.pos, m.rank)} on the sideline for now`;
  return [adj, bucket(m.pos, m.rank), phrase].filter(Boolean).join(" ");
}

/** The league rows as a sentence names them. */
const PROSE_LEAGUES: Record<string, [string, string, string]> = {
  QB: ["superflex and 2QB", "12-team 1QB", "10-team 1QB"],
  RB: ["12-team PPR", "10-team PPR", "half-PPR"],
  WR: ["12-team PPR", "10-team PPR", "half-PPR"],
  TE: ["TE-premium", "12-team", "10-team"],
};

/** Rows that share a chip, merged: [[chip, "12-team 1QB and 10-team 1QB"]]. */
function fitGroups(m: Model): Array<[Chip, string]> {
  if (!m.chips) return [];
  const names = PROSE_LEAGUES[m.pos]!;
  const groups: Array<[Chip, string[]]> = [];
  m.chips.forEach((c, i) => {
    const last = groups[groups.length - 1];
    if (last && last[0].label === c.label) last[1].push(names[i]!);
    else groups.push([c, [names[i]!]]);
  });
  return groups.map(([c, n]) => [
    c,
    m.pos === "QB" && n.length === 2 && n.every((x) => x.endsWith("1QB")) ? "1QB" : listWords(n),
  ]);
}

/** "he's a weekly starter in superflex and 2QB leagues and a streamer in 1QB leagues". */
function fitSentence(m: Model): string {
  return listWords(fitGroups(m).map(([c, where]) => `${chipPhrase(c)} in ${where} leagues`));
}

/** The chip as a noun phrase: "a streamer", "waiver-wire material". */
function chipPhrase(c: Chip): string {
  return c.label === "Waiver wire" ? "waiver-wire material" : `a ${c.label.toLowerCase()}`;
}

/** A starter in every league the page lists: his job is not the question. */
function elite(m: Model): boolean {
  return Boolean(m.chips?.every((c) => c.label === "Weekly starter"));
}

function favorable(m: Model): UpcomingGame[] {
  return m.upcoming.filter((g) => g.matchup && matchupBand(g.matchup.rank) === "soft");
}

function oppName(g: UpcomingGame): string {
  return g.opponent?.nickname ?? g.opponentName;
}

function listWords(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function matchupList(games: UpcomingGame[]): string {
  return listWords(games.slice(0, 2).map((g) => `the ${oppName(g)} in Week ${g.week}`));
}

/* ------------------------------------------------------ section 1: the take */

function renderTake(m: Model): string {
  const tier = tierLine(m);
  if (!tier || !m.chips) return "";
  const leagues = LEAGUES[m.pos]!;

  // mak's hero rework, 2026-10-01, then 2026-10-05: the dot-separated meta
  // line under the tier ("QB17 through Week 4 · 15.8 PPG · 34.6 att/game")
  // is gone, and the tier line wears the section ledes' style. The full
  // reasoning lives one section down, in Our Take; the league-by-league call
  // is the chips beside it, under a "Best fit" label.
  return (
    `<section class="scp-ox-sec scp-ol-sec-take" aria-labelledby="scp-ol-take-h"><div class="scp-ol-take">` +
    `<div>` +
    `<h2 class="scp-ox-h2 is-lead" id="scp-ol-take-h">${escapeHtml(titleCase(`${m.name} rest-of-season outlook`))}</h2>` +
    // The body's first sentence names the page's search, "fantasy outlook",
    // and the reading it is built on (mak, 2026-10-09).
    `<p class="scp-ox-lede scp-ol-lede">${escapeHtml(outlookLede(m))}</p>` +
    `<p class="scp-ol-tier">${escapeHtml(tier)}</p>` +
    (m.injured ? `<p class="scp-ol-injured">${escapeHtml(`${m.injured}.`)}</p>` : "") +
    `</div>` +
    `<div class="scp-ol-fitwrap">` +
    `<div class="scp-ol-fithead" aria-hidden="true">Best fit</div>` +
    `<div class="scp-ol-fits" role="list" aria-label="Best fit by league type">` +
    m.chips
      .map(
        (chip, i) =>
          `<div class="scp-ol-fit" role="listitem"><span>${escapeHtml(leagues[i]!)}</span>` +
          `<span class="scp-ol-chip is-${chip.kind}">${escapeHtml(chip.label)}</span></div>`,
      )
      .join("") +
    `</div></div>` +
    `</div></section>`
  );
}

/**
 * "Bijan Robinson's fantasy outlook for the rest of 2026: RB3 through Week 5
 * at 21.4 PPR points per game." Before Week 1 it is the projection and last
 * season's finish instead.
 */
function outlookLede(m: Model): string {
  if (!m.preseason && m.now?.rank) {
    return (
      `${m.name}'s fantasy outlook for the rest of ${m.season}: ${m.pos}${m.now.rank} through ` +
      `Week ${m.week} at ${one(m.now.ppg)} ${m.scoring} points per game.`
    );
  }
  if (!m.preseason) {
    return `${m.name}'s fantasy outlook for the rest of ${m.season}, from his role, his usage and the matchups ahead.`;
  }
  const projected = m.projected ? `: projected as ${preseasonWords(m.pos, m.projected)}` : "";
  const prior = m.prior?.rank ? ` He finished ${m.pos}${m.prior.rank} in ${m.prior.season} at ${one(m.prior.ppg)} points per game.` : "";
  return `${m.name}'s ${m.season} fantasy outlook${projected}.${prior}`;
}

/* --------------------------------------------- section 2: expectation check */

function preseasonWords(pos: string, rank: number): string {
  const b = bucket(pos, rank);
  if (b.endsWith("1")) return `a weekly ${pos} starter`;
  if (pos === "QB" && b === "QB2") return "a QB2 and superflex option";
  if (pos === "QB") return "a backup-level fantasy quarterback";
  if (b.endsWith("2")) return `a ${pos}2 and flex option`;
  return `a depth ${pos}`;
}

function renderExpect(m: Model): string {
  const panels: string[] = [];
  const arrow = `<span class="scp-ol-arrow" aria-hidden="true">›</span>`;
  if (m.projected) {
    // Short labels (mak, 2026-10-01): "Preseason", "Through Week n" - the
    // panel row reads as a progression, and the long forms made it a caption.
    panels.push(
      `<div class="scp-ol-ex"><div class="scp-ol-when">Preseason</div>` +
        `<div class="scp-ol-rk">~${m.pos}${m.projected}</div>` +
        `<div class="scp-ol-exsub">${escapeHtml(`Viewed as ${preseasonWords(m.pos, m.projected)}`)}</div>${arrow}</div>`,
    );
  }
  if (m.prior?.rank) {
    panels.push(
      `<div class="scp-ol-ex"><div class="scp-ol-when">${m.prior.season} final</div>` +
        `<div class="scp-ol-rk">${m.pos}${m.prior.rank}</div>` +
        `<div class="scp-ol-exsub">${escapeHtml(`${one(m.prior.ppg)} PPG over ${m.prior.gp} games`)}</div>${arrow}</div>`,
    );
  }
  if (!m.preseason && m.now?.rank) {
    panels.push(
      `<div class="scp-ol-ex is-now"><div class="scp-ol-when">Through Week ${m.week}</div>` +
        `<div class="scp-ol-rk">${m.pos}${m.now.rank}</div>` +
        `<div class="scp-ol-exsub">${escapeHtml(`${one(m.now.ppg)} PPG over ${m.now.gp} games`)}</div></div>`,
    );
  } else if (m.preseason && m.upcoming[0]) {
    const g = m.upcoming[0];
    panels.push(
      `<div class="scp-ol-ex is-now"><div class="scp-ol-when">${m.season}</div>` +
        `<div class="scp-ol-rk is-text">Season starts Week ${g.week}</div>` +
        `<div class="scp-ol-exsub">${escapeHtml(`${g.homeAway === "home" ? "vs." : "at"} ${oppName(g)}`)}</div></div>`,
    );
  }
  if (panels.length === 0) return "";
  // No button here (mak, 2026-10-01): Redraft Command gets one main CTA - the
  // sidebar card in Our Take - and one quiet one at the foot of upside/risk.
  panels.push(
    `<div class="scp-ol-ex is-ros"><div class="scp-ol-when">Rest of season</div>` +
      `<div class="scp-ol-rk is-text">Live rank</div>` +
      `<div class="scp-ol-exsub">Updated after every game</div></div>`,
  );

  let lede = "";
  if (m.projected && !m.preseason && m.now?.rank) {
    lede = `He was projected as ${preseasonWords(m.pos, m.projected)}.`;
    if (m.prior) {
      const diff = m.now.ppg - m.prior.ppg;
      const pace =
        Math.abs(diff) <= 1
          ? `scoring at almost exactly last season's pace`
          : diff > 0
            ? `scoring ${one(diff)} points per game more than last season`
            : `scoring ${one(-diff)} points per game less than last season`;
      lede += ` ${cap(word(m.week))} week${m.week === 1 ? "" : "s"} in, he's ${m.pos}${m.now.rank}, ${pace}.`;
    } else {
      lede += ` ${cap(word(m.week))} week${m.week === 1 ? "" : "s"} in, he's ${m.pos}${m.now.rank}.`;
    }
  } else if (m.prior?.rank) {
    lede = `He finished ${m.pos}${m.prior.rank} last season at ${one(m.prior.ppg)} points per game.`;
  }

  return (
    open("scp-ol-exp-h", "Preseason projection vs. reality", lede) +
    `<div class="scp-ol-expect" style="--scp-ol-n:${panels.length}">${panels.join("")}</div>` +
    `</section>`
  );
}

/* ---------------------------------------------- section 3: written outlook */

function paragraphs(m: Model, data: PlayerPageData): string[] {
  const out: string[] = [];
  const top = topDriver(m);
  const weak = weakDriver(m);
  // 1. Performance against expectation.
  if (!m.preseason && m.now) {
    let p = m.projected ? `We projected ${m.last} in the ${m.pos}${m.projected} range this summer. ` : "";
    p += `Through ${m.now.gp} game${m.now.gp === 1 ? "" : "s"} he's ${m.pos}${m.now.rank ?? "-"} at ${one(m.now.ppg)} ${m.scoring} points per game`;
    if (m.prior) {
      p += `, against ${one(m.prior.ppg)} over ${m.prior.gp} games last season${m.prior.rank ? ` (${m.pos}${m.prior.rank})` : ""}.`;
      const diff = m.now.ppg - m.prior.ppg;
      p +=
        Math.abs(diff) <= 1
          ? " The role is producing the same fantasy output two years running."
          : diff > 0
            ? " He's running ahead of last season's pace."
            : " He's running behind last season's pace.";
    } else p += ".";
    out.push(p);
  }
  // 2. How he produces.
  const drivers = (m.measures?.drivers ?? []).filter((d) => d.rank !== null);
  if (drivers.length) {
    let p =
      `Last season he ranked ` +
      listWords(drivers.map((d) => `${ordinal(d.rank!)} of ${d.of} in ${d.label.toLowerCase()} (${d.unit === d.label.toLowerCase() ? d.value : `${d.value} ${d.unit}`})`)) +
      `.`;
    if (top && top.tier === "good") p += ` His points come from his ${top.label.toLowerCase()}.`;
    if (weak) p += ` ${cap(weak.label.toLowerCase())} is the soft spot.`;
    const mates = data.teammates ?? [];
    if (m.pos === "QB" && mates.length >= 2) {
      p += ` ${mates[0]!.name} and ${mates[1]!.name} are his top two targets.`;
    } else if (m.pos !== "QB" && mates[0]) {
      p += ` ${mates[0].name} is his quarterback.`;
    }
    out.push(p);
  }
  // 3. The biggest risk to his role.
  const depth = data.depth;
  if (m.injured) {
    out.push(`He's ${m.injured.toLowerCase()}. Until he's back, his value is a bench spot at most${depth?.next ? `, and ${depth.next.name} takes his snaps` : ""}.`);
  } else if (depth && depth.order === 1 && depth.next && elite(m)) {
    out.push(
      `The job is secure: he's the listed starter and one of the best at his position. The main risk is health, and ${depth.next.name} is next on the depth chart if he misses time.`,
    );
  } else if (depth && depth.order === 1 && depth.next) {
    out.push(
      `The main risk is the job itself. He's the listed starter with ${depth.next.name} next on the depth chart, and a benching or an injury would take his value to zero overnight.`,
    );
  } else if (depth && depth.order > 1) {
    out.push(`He's ${m.pos}${depth.order} on the depth chart, so his value depends on the players ahead of him.`);
  }
  // 4. The schedule ahead. This paragraph used to reopen with the league-fit
  // sentence ("Until something changes, he's a weekly starter in superflex
  // and 2QB…") - the third statement of the league call on one tab. mak
  // (2026-10-01): the league types are said once, in the hero, so the close
  // keeps only what is new here. With no favorable matchup coming, it is
  // nothing, and the take ends on the role paragraph.
  const fav = favorable(m);
  if (fav.length) {
    out.push(
      `The next favorable ${fav.length === 1 ? "matchup is" : "matchups are"} ${listWords(
        fav.slice(0, 2).map((g) => `the ${oppName(g)} in Week ${g.week} (${ordinal(g.matchup!.rank)} against ${m.pos}s)`),
      )}.`,
    );
  }
  return out;
}

function renderRead(m: Model, data: PlayerPageData): string {
  const record = data.fantasyOutlook2026;
  const published = dateParts((record as unknown as { generatedAt?: string } | null)?.generatedAt);
  const preseasonParas = (record?.body ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  // No Redraft Command link in the prose (mak, 2026-10-01): the tab carries
  // exactly two - the sidebar card beside this text, and the quiet line at
  // the foot of upside/risk. The take ends on its own last sentence.
  let prose: string[];
  let byline: string;
  let archive = "";
  if (m.preseason) {
    if (preseasonParas.length === 0) return "";
    prose = preseasonParas.map((p) => escapeHtml(p));
    byline = `By the StatChasers staff.${published ? ` Published <time datetime="${published.iso}">${published.text}</time>.` : ""}`;
  } else {
    prose = paragraphs(m, data).map((p) => escapeHtml(p));
    if (prose.length === 0) return "";
    // mak, 2026-09-30: no "Updated automatically after Week n" line;
    // 2026-10-02: no "Preseason outlook originally published" line either.
    byline = "";
    if (preseasonParas.length && published) {
      archive =
        `<details class="scp-ol-prev"><summary>${escapeHtml(`Read our preseason outlook (${published.month})`)}</summary>` +
        `<div class="scp-ox-prose">` +
        `<p class="scp-ol-stamp">${escapeHtml(`Published ${published.text}. Kept for reference; the take above replaces it.`)}</p>` +
        preseasonParas.map((p) => `<p>${escapeHtml(p)}</p>`).join("") +
        `</div></details>`;
    }
  }

  // Sidebar: Redraft Command, then the outlook at a glance.
  const rc =
    `<div class="scp-ox-panel is-rc"><h3>Redraft Command</h3>` +
    `<p>${escapeHtml(
      `This outlook explains the why. Redraft Command gives you the number: ${m.last}'s rest-of-season rank and trade value for your league's scoring, updated after every game.`,
    )}</p>` +
    `<a class="scp-ox-btn" href="${escapeHtml(m.rc)}" data-cta="redraft-command-outlook-sidebar">${escapeHtml(`Open ${m.last} in Redraft Command`)}</a>` +
    `</div>`;
  const rows: Array<[string, string]> = [];
  const depth = data.depth;
  if (depth) {
    rows.push(["Role", depth.order === 1 ? "Starter" : `${depth.position}${depth.order}`]);
    if (depth.order === 1 && depth.next) rows.push(["Backup", depth.next.name]);
  }
  if (m.pos === "QB" && (data.teammates ?? []).length >= 2) {
    rows.push(["Top targets", `${lastName(data.teammates[0]!.name)}, ${lastName(data.teammates[1]!.name)}`]);
  }
  const next2 = m.upcoming.filter((g) => g.matchup).slice(0, 2);
  if (next2.length) {
    const words = next2.map((g) => ({ soft: "Favorable", mid: "Neutral", tough: "Tough" })[matchupBand(g.matchup!.rank)]);
    rows.push([`Next ${next2.length === 1 ? "matchup" : `${word(next2.length)} matchups`}`, words[0] === words[1] || words.length === 1 ? words[0]! : `${words[0]}, then ${words[1]!.toLowerCase()}`]);
  }
  const glance = rows.length
    ? `<div class="scp-ox-panel"><h3>Outlook at a glance</h3><dl class="scp-ol-profile">` +
      rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join("") +
      `</dl></div>`
    : "";

  return (
    open("scp-ol-read-h", m.preseason ? `Our ${m.season} preseason outlook` : `Our take after Week ${m.week}`, "") +
    `<div class="scp-ox-read">` +
    `<div>${byline ? `<p class="scp-st-byline">${byline}</p>` : ""}` +
    `<div class="scp-ox-prose">${prose.map((p) => `<p>${p}</p>`).join("")}</div>` +
    archive +
    `</div>` +
    `<aside class="scp-ox-aside" aria-label="${escapeHtml(`${m.last} in Redraft Command`)}">${rc}${glance}</aside>` +
    `</div></section>`
  );
}

/* --------------------------------------------------------- section 4: drivers */

function renderDrivers(m: Model): string {
  const ms = m.measures;
  if (!ms || ms.drivers.length === 0) return "";
  const noun = `${ms.position}s`;
  const rows = ms.drivers
    .map((d) => {
      const strip =
        d.rank === null
          ? `<p class="scp-ol-unranked">${escapeHtml(`Fewer than 6 games in ${ms.season}, so not ranked.`)}</p>`
          : `<div class="scp-ol-dots" role="img" aria-label="${escapeHtml(`${ordinal(d.rank)} of ${d.of} ${noun}`)}" style="--scp-ol-cols:${d.of}">` +
            Array.from({ length: d.of }, (_, i) => (i === d.rank! - 1 ? `<i class="is-me"></i>` : `<i></i>`)).join("") +
            `</div>` +
            `<div class="scp-ol-axis"><span>1st</span><span><b>${escapeHtml(`${ordinal(d.rank)} of ${d.of}`)}</b></span><span>${ordinal(d.of)}</span></div>`;
      return (
        `<div class="scp-ol-drv">` +
        `<div><h3>${escapeHtml(d.label)}</h3>${d.word ? `<div class="scp-ol-dverdict is-${d.tier}">${escapeHtml(d.word)}</div>` : ""}</div>` +
        `<div class="scp-ol-val"><strong>${escapeHtml(d.value)}</strong>${escapeHtml(d.unit)}</div>` +
        `<div class="scp-ol-dotwrap">${strip}</div>` +
        `</div>`
      );
    })
    .join("");
  const adv = ms.advanced.length
    ? `<dl class="scp-ol-adv" aria-label="${escapeHtml(`${ms.season} advanced profile`)}">` +
      ms.advanced.map((c) => `<div><dt>${escapeHtml(c.label)}</dt><dd>${escapeHtml(c.value)}</dd></div>`).join("") +
      `</dl>`
    : "";
  const noun1 = { QB: "quarterback", RB: "running back", WR: "receiver", TE: "tight end" }[ms.position] ?? ms.position;
  return (
    open(
      "scp-ol-drv-h",
      "What drives his outlook",
      `His ${ms.season} rank among the ${ms.field} ${noun1}s who played at least six games. Each bar is one ${noun1}, best on the left; his is highlighted.`,
    ) +
    `<div class="scp-ol-drivers">${rows}</div>` +
    adv +
    `</section>`
  );
}

/* ---------------------------------------------------------- section 5: contract */

function renderContract(m: Model, data: PlayerPageData): string {
  const bio = data.bioProfile;
  const stints = (bio?.stints ?? []).filter((s) => s.kind === "nfl");
  const events: Array<{ when: string; text: string }> = [];
  const draft = bio?.draft;
  if (draft?.year && draft.round && draft.pick) {
    events.push({
      when: String(draft.year),
      text: `Drafted in round ${draft.round}, pick ${draft.pick}${draft.team ? ` by the ${draft.team.nickname}` : ""}.`,
    });
  }
  for (const stint of stints.slice(-3)) {
    if (!stint.team) continue;
    // "2025–" is a stint still running: the year he joined, said as such.
    const current = /–$/.test(stint.years);
    // The club that drafted him, the year it did: the draft row already says so.
    if (draft?.year && draft.team?.slug === stint.team.slug && stint.years.startsWith(String(draft.year))) continue;
    events.push({
      when: current ? stint.years.replace(/–$/, "") : stint.years,
      text: current
        ? `Joined the ${stint.team.nickname}${stint.detail ? ` (${stint.detail})` : ""}.`
        : `Played for the ${stint.team.nickname}${stint.detail ? ` (${stint.detail})` : ""}.`,
    });
  }
  if (m.prior?.rank) {
    events.push({ when: String(m.prior.season), text: `Finished ${m.pos}${m.prior.rank} at ${one(m.prior.ppg)} points per game over ${m.prior.gp} games.` });
  }
  const depth = data.depth;
  if (depth) {
    events.push({
      when: String(m.season),
      text: depth.order === 1 ? `Listed as the starter${depth.next ? `, with ${depth.next.name} behind him` : ""}.` : `Listed as ${depth.position}${depth.order} on the depth chart.`,
    });
  }
  const timeline = events.slice(-5);
  if (timeline.length < 2) return "";

  const angle =
    depth?.order === 1
      ? `He holds the job today${depth.next ? `, and ${depth.next.name} is the next man up` : ""}. With no contract terms on file here, the job is his only as long as he produces.`
      : depth
        ? `He's ${depth.position}${depth.order} on the depth chart, so he needs an injury or a demotion ahead of him to start. That caps his value until the chart changes.`
        : `His club's depth chart doesn't list him, so treat his role as unsettled. That caps his value until it's clear.`;

  return (
    open("scp-ol-con-h", "Contract and job security", "") +
    `<div class="scp-ol-contract">` +
    `<div class="scp-ol-card"><h3>How he got here</h3><p class="scp-ol-cardsub">And what it means for his fantasy value.</p>` +
    `<ol class="scp-ol-timeline">` +
    timeline.map((e) => `<li><span class="scp-ol-when-b">${escapeHtml(e.when)}</span><span>${escapeHtml(e.text)}</span></li>`).join("") +
    `</ol>` +
    `<div class="scp-ol-angle"><strong>Fantasy angle:</strong> ${escapeHtml(angle)}</div>` +
    `</div></div></section>`
  );
}

/* ---------------------------------------------------- section 6: upside / risk */

function schedChips(m: Model): string {
  const games = m.upcoming.filter((g) => g.matchup);
  if (!games.length) return "";
  return (
    `<span class="scp-ol-sched">` +
    games
      .map((g) => {
        const band = matchupBand(g.matchup!.rank);
        const kind = band === "soft" ? "good" : band === "tough" ? "bad" : "mid";
        return `<span class="scp-ol-chip is-${kind}">${escapeHtml(`Wk ${g.week} ${g.opponentCode}, ${ordinal(g.matchup!.rank)}`)}</span>`;
      })
      .join("") +
    `</span>`
  );
}

function renderTriggers(m: Model, data: PlayerPageData): string {
  const up: string[] = [];
  const risk: string[] = [];
  // The claim is the line you read; the evidence sits under it as subtext
  // (mak, 2026-10-01). Both halves are the same words as before - what moved
  // is the emphasis, so the list scans as six claims instead of six sentences.
  const b = (label: string, text: string): string =>
    `<span class="scp-ol-claim">${escapeHtml(label.replace(/\.$/, ""))}</span>` +
    `<span class="scp-ol-evid">${escapeHtml(text)}</span>`;

  const fav = favorable(m);
  const games = m.upcoming.filter((g) => g.matchup);
  if (games.length) {
    up.push(
      (fav.length
        ? b(fav.length >= 2 ? "A soft stretch." : "A soft spot.", `${cap(matchupList(fav))} ${fav.length === 1 ? "is a top-10 matchup" : "are top-10 matchups"} for ${m.pos}s.`)
        : b("The schedule.", `None of his next ${word(games.length)} opponents is a top-10 matchup for ${m.pos}s.`)) + schedChips(m),
    );
  }
  const drivers = (m.measures?.drivers ?? []).filter((d) => d.rank !== null && d.tier === "good");
  const driverLabel = (d: DriverRow): string =>
    d.label.toLowerCase().startsWith((d.word ?? "").toLowerCase()) ? `${d.label}.` : `${d.word} ${d.label.toLowerCase()}.`;
  for (const d of drivers.slice(0, 2)) {
    up.push(b(driverLabel(d), `${d.value} ${d.unit}, ${ordinal(d.rank!)} of ${d.of} ${m.pos}s in ${m.measures!.season}.`));
  }

  const depth = data.depth;
  if (m.injured) risk.push(b("Injury.", `He's ${m.injured.toLowerCase()}${depth?.next ? `, and ${depth.next.name} is next on the depth chart` : ""}.`));
  else if (depth?.order === 1 && depth.next && elite(m)) risk.push(b("Health.", `His role is secure; if he misses time, ${depth.next.name} is next on the depth chart.`));
  else if (depth?.order === 1 && depth.next) risk.push(b("Job security.", `${depth.next.name} is next on the depth chart; a benching or injury hands him the job.`));
  else if (depth && depth.order > 1) risk.push(b("Role.", `He's ${depth.position}${depth.order} on the depth chart.`));
  const weak = (m.measures?.drivers ?? []).filter((d) => d.rank !== null && d.tier === "bad");
  for (const d of weak.slice(0, 1)) {
    risk.push(b(driverLabel(d), `${d.value} ${d.unit}, ${ordinal(d.rank!)} of ${d.of} ${m.pos}s in ${m.measures!.season}.`));
  }
  const tough = games.filter((g) => matchupBand(g.matchup!.rank) === "tough");
  if (tough.length) {
    risk.push(b(tough.length === 1 ? "A tough matchup." : "Tough matchups.", `${cap(listWords(tough.slice(0, 2).map((g) => `the ${oppName(g)} in Week ${g.week} (${ordinal(g.matchup!.rank)})`)))} ${tough.length === 1 ? "is" : "are"} among the stingiest defenses against ${m.pos}s.`));
  }
  const ks = data.fantasyOutlook2026?.keyStats;
  const n = (k: string): number | null => (typeof ks?.[k] === "number" ? (ks[k] as number) : null);
  if (risk.length < 3 && m.pos === "QB" && n("sacks") !== null && n("pressurePct") !== null) {
    risk.push(b("Pressure and sacks.", `${n("sacks")} sacks and a ${n("pressurePct")!.toFixed(1)}% pressure rate in ${m.measures?.season ?? m.season - 1}.`));
  }
  if (risk.length < 3 && m.pos !== "QB" && n("fumbles") && n("fumbles")! >= 2) {
    risk.push(b("Ball security.", `${n("fumbles")} fumbles in ${m.measures?.season ?? m.season - 1}.`));
  }
  if (risk.length < 3 && (m.pos === "WR" || m.pos === "TE") && n("dropPct") !== null && n("dropPct")! >= 6) {
    risk.push(b("Drops.", `A ${n("dropPct")!.toFixed(1)}% drop rate in ${m.measures?.season ?? m.season - 1}.`));
  }

  if (up.length === 0 && risk.length === 0) return "";
  const card = (title: string, items: string[], kind: string): string =>
    items.length
      ? `<div class="scp-ol-card is-${kind}"><h3>${title}</h3><ul>${items.slice(0, 3).map((i) => `<li>${i}</li>`).join("")}</ul></div>`
      : "";
  const noun = { QB: "quarterback", RB: "running back", WR: "receiver", TE: "tight end" }[m.pos] ?? m.pos;
  return (
    // No lede (mak, 2026-10-02).
    open("scp-ol-ur-h", "What could change his value", "") +
    `<div class="scp-ol-ur">${card("Upside", up, "up")}${card("Risk", risk, "risk")}</div>` +
    `<div class="scp-ol-cta"><span>${escapeHtml(`Weighing ${m.last} against another ${noun} on your roster?`)}</span>` +
    `<a href="${escapeHtml(m.rc)}" data-cta="redraft-command-outlook-risk">Compare them in Redraft Command</a></div>` +
    `</section>`
  );
}

/* ------------------------------------------------------------- section 7: FAQ */

/**
 * The Outlook FAQ (faq-engine.ts): forward-looking only. Rest-of-season value,
 * rank against the projection, buy or sell, role, volume trend, upside, risk,
 * the schedule and the playoffs, each answered with the model's own numbers.
 * Rosterability is the Overview's; last season's line is the Stats tab's.
 */
function outlookPool(m: Model, data: PlayerPageData, options: PlayerRenderOptions): Array<FaqCandidate | null> {
  const pool: Array<FaqCandidate | null> = [];
  const through = m.week >= 1 && m.now ? ` through Week ${m.week}` : "";
  const ros = m.week >= 1 ? `the rest of the ${m.season} season` : `the ${m.season} season`;
  const top = topDriver(m);
  const weak = weakDriver(m);
  const drv = (d: DriverRow): string => `${d.label.toLowerCase()} (${d.value} ${d.unit}, ${ordinal(d.rank!)} of ${d.of} ${m.pos}s in ${m.measures!.season})`;
  const noun = m.pos === "QB" ? "pass attempts" : m.pos === "RB" ? "touches" : "targets";
  const log = data.season === m.season ? (data.gameLog ?? []).filter((e) => (e.game_status ?? "active") === "active" && e.stats) : [];
  const vol = (e: (typeof log)[number]): number =>
    m.pos === "QB" ? e.stats.pass_att ?? 0 : m.pos === "RB" ? (e.stats.rush_att ?? 0) + (e.stats.rec_tgt ?? 0) : e.stats.rec_tgt ?? 0;

  // 1. The outlook.
  const tier = tierLine(m);
  if (tier && m.chips) {
    pool.push({
      key: "outlook",
      q: `What is ${m.name}'s fantasy outlook for ${ros}?`,
      a: `${m.name} projects as ${/^[aeiou]/i.test(tier) ? "an" : "a"} ${tier.charAt(0).toLowerCase() + tier.slice(1)} for ${ros}: ${fitSentence(m)}.` +
        (top && top.tier === "good" ? ` His ${drv(top)} supports that.` : "") +
        (weak ? ` His ${drv(weak)} holds him back.` : ""),
      link: { href: m.rc, text: `See his live rank in Redraft Command.` },
    });
  }

  // 2. Rank against the projection.
  if (m.rank !== null) {
    pool.push({
      key: "rosrank",
      q: `What is ${m.name}'s rest-of-season fantasy ranking?`,
      a: `${m.name} is the ${m.pos}${m.rank} in ${m.scoring} points per game${through}` +
        (m.projected ? `, against a preseason projection of about ${m.pos}${m.projected}` : "") +
        `. That puts him in ${bucket(m.pos, m.rank)} territory, ${chipPhrase(m.chips![1])} in ${PROSE_LEAGUES[m.pos]![1]} leagues.`,
    });
  }

  // 3. Buy low or sell high, from the gap between rank and projection.
  if (m.rank !== null && m.projected && m.week >= 2 && !m.injured) {
    const gap = m.projected - m.rank;
    pool.push({
      key: "trade",
      q: `Should I buy low or sell high on ${m.name}?`,
      a: gap >= 6
        ? `${m.name} is outperforming his projection, ${m.pos}${m.rank} against about ${m.pos}${m.projected}, so his trade value is near its high. Selling is reasonable if an offer pays for the ${bucket(m.pos, m.rank)} he has been rather than the ${bucket(m.pos, m.projected)} he was projected to be.`
        : gap <= -6
          ? `${m.name} is below his projection, ${m.pos}${m.rank} against about ${m.pos}${m.projected}, which is a buy-low window if his usage holds` +
            (top && top.tier === "good" ? `: his ${drv(top)} is still there.` : ".")
          : `Neither: ${m.name} is playing to his projection, ${m.pos}${m.rank} against about ${m.pos}${m.projected}, so his price matches his production. Hold him unless a trade fills a bigger need.`,
    });
  }

  // 4. Role going forward.
  const depth = data.depth;
  if (depth) {
    pool.push({
      key: "role",
      q: `What is ${m.name}'s projected role going forward?`,
      a: depth.order === 1
        ? `${m.name} is the listed starting ${depth.position}${depth.next ? `, with ${depth.next.name} next on the depth chart` : ""}. ` +
          (m.injured ? `He is ${m.injured.toLowerCase()} for now, which puts that role on hold.` : `Nothing on the chart threatens the job, so the role is his to lose on performance.`)
        : `${m.name} is ${depth.position}${depth.order} on the depth chart, so a bigger role needs an injury or a change ahead of him.`,
    });
  }

  // 5. Volume trend (three games or more).
  if (log.length >= 3) {
    const season = log.reduce((t, e) => t + vol(e), 0) / log.length;
    const recent = log.slice(-2).reduce((t, e) => t + vol(e), 0) / 2;
    const diff = recent - season;
    const steady = Math.abs(diff) < Math.max(1.5, season * 0.08);
    pool.push({
      key: "volume",
      q: `Will ${m.name} get more ${noun}?`,
      a: `${m.name}'s ${noun} are ${steady ? "holding steady" : diff > 0 ? "trending up" : "trending down"}: ${one(recent)} a game over his last two games against ${one(season)} for the season.` +
        (m.pos === "QB" ? ` Game script drives much of that, and trailing teams throw more.` : ` His share of the offense is what his fantasy value rides on.`),
    });
  }

  // 6. Upside.
  const bestWeek = log.length ? [...log].sort((x, y) => getEntryPoints(y.stats, data.format) - getEntryPoints(x.stats, data.format))[0] : null;
  const fav = favorable(m);
  if (bestWeek || (top && top.tier === "good") || fav.length) {
    const parts: string[] = [];
    if (bestWeek) parts.push(`his ceiling this season is ${one(getEntryPoints(bestWeek.stats, data.format))} ${m.scoring} points (Week ${bestWeek.week}${bestWeek.pos_rank ? `, ${m.pos}${bestWeek.pos_rank}` : ""})`);
    if (top && top.tier === "good") parts.push(`his ${drv(top)} gives him a weekly floor to build on`);
    if (fav.length) parts.push(`${matchupList(fav)} ${fav.length === 1 ? "is a top-10 matchup" : "are top-10 matchups"} for ${m.pos}s`);
    pool.push({
      key: "upside",
      q: `What is ${m.name}'s fantasy football upside?`,
      a: `${m.name}'s upside: ${listWords(parts)}.`,
    });
  }

  // 7. Risk.
  const risks: string[] = [];
  if (m.injured) risks.push(`he is ${m.injured.toLowerCase()}`);
  if (depth?.order === 1 && depth.next && !m.injured) risks.push(`${depth.next.name} is next on the depth chart if he is benched or hurt`);
  if (weak) risks.push(`his ${drv(weak)} limits his scoring`);
  const tough = m.upcoming.filter((g) => g.matchup && matchupBand(g.matchup.rank) === "tough");
  if (tough.length) risks.push(`${listWords(tough.slice(0, 2).map((g) => `the ${oppName(g)} in Week ${g.week}`))} ${tough.length === 1 ? "is a tough matchup" : "are tough matchups"}`);
  if (risks.length) {
    pool.push({
      key: "risk",
      q: `What could hurt ${m.name}'s fantasy value?`,
      a: `${m.name}'s risks: ${listWords(risks)}.`,
      link: ((href) => (href ? { href, text: `See his injury status and history.` } : null))(sectionHref(data, options, "injury")),
    });
  }

  // 8. The remaining schedule, and 9. the playoffs.
  const strip = (data.upcomingStrip ?? []).filter((g) => g.matchup);
  if (strip.length >= 3) {
    const soft = strip.filter((g) => matchupBand(g.matchup!.rank) === "soft").length;
    const hard = strip.filter((g) => matchupBand(g.matchup!.rank) === "tough").length;
    pool.push({
      key: "schedule",
      q: `How difficult is ${m.name}'s remaining fantasy schedule?`,
      a: `${soft > hard ? "Favorable" : hard > soft ? "Difficult" : "About average"}: of his next ${word(strip.length)} games, ${soft} ${soft === 1 ? "comes" : "come"} against a top-10 matchup for ${m.pos}s and ${hard} against one of the stingiest defenses, by ${m.scoring} points allowed to the position.`,
    });
  }
  const playoffs = strip.filter((g) => g.week >= 15 && g.week <= 17);
  if (playoffs.length >= 2) {
    const soft = playoffs.filter((g) => matchupBand(g.matchup!.rank) === "soft").length;
    pool.push({
      key: "playoffs",
      q: `Is ${m.name} a good fantasy playoff option?`,
      a: `His Weeks 15 to 17 opponents are ${listWords(playoffs.map((g) => `the ${oppName(g)} (${ordinal(g.matchup!.rank)} in points allowed to ${m.pos}s)`))}; ${soft ? `${word(soft)} of them ${soft === 1 ? "is" : "are"} favorable` : "none of them is a top-10 matchup"}.`,
    });
  }
  return pool;
}

function renderFaq(m: Model, data: PlayerPageData, options: PlayerRenderOptions): string {
  const items = selectFaq(outlookPool(m, data, options));
  return renderFaqSection("outlook", data, items, options, "scp-ol-faq");
}

/* ------------------------------------------------------------------ the tab */

/** "Contract and job security" is hidden for now, at mak's request (2026-09-30). Flip back to show it. */
const SHOW_CONTRACT = false;

export function renderOutlookTab(data: PlayerPageData, options: PlayerRenderOptions = {}): string {
  const parts = outlookTabParts(data, options);
  return parts ? parts.body + parts.foot + parts.faq : "";
}

/**
 * The tab split at its footer and FAQ, which the page stands under the peers
 * rail, footer first (mak, 2026-09-30).
 */
export function outlookTabParts(
  data: PlayerPageData,
  options: PlayerRenderOptions = {},
): { body: string; foot: string; faq: string } | null {
  const m = model(data);
  if (!m) return null;
  const main =
    renderTake(m) +
    renderExpect(m) +
    renderRead(m, data) +
    renderDrivers(m) +
    (SHOW_CONTRACT ? renderContract(m, data) : "") +
    renderTriggers(m, data);
  const faq = renderFaq(m, data, options);
  if (!main && !faq) return null;
  // No methodology footer (mak, 2026-10-02).
  const foot = "";
  const ink = teamInk(data.team);
  const wrap = (html: string): string =>
    html ? `<div class="scp-ox scp-st scp-ol"${ink ? ` style="--scp-team:${escapeHtml(ink)}"` : ""}>${html}</div>` : "";
  return { body: wrap(main), foot: wrap(foot), faq: wrap(faq) };
}
