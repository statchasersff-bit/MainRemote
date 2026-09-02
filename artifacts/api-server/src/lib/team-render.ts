/**
 * Markup for the NFL Team Hub.
 *
 * Server-only, unlike lib/render.ts — the team page ships complete HTML and the
 * client bundle only enhances what is already there (sticky-nav highlighting,
 * closing the team switcher, relabelling timestamps). Nothing on this page is
 * built in the browser, so nothing here has to be re-runnable there.
 *
 * Two rules run through every function below.
 *
 * 1. A field we do not have is not rendered. There is no "N/A", no "--", no
 *    zero standing in for a number nobody measured. Sections whose data failed
 *    to load are dropped entirely and the section navigation is built from what
 *    actually rendered, so the page is never a set of labelled holes.
 *
 * 2. The team is an accent, not a repaint. Every surface, border, heading and
 *    button is StatChasers navy/gold/white; the team's own colours appear as a
 *    faint aura behind the logo, a hairline above the hero, and the tint on a
 *    player card's photo well. A Patriots page has to read as StatChasers first.
 */

import {
  escapeHtml,
  itemTimestamp,
  safeUrl,
  searchKey,
  type NewsItem,
} from "./render";
import type { NflTeam } from "./team/teams";
import { TEAM_GROUPS } from "./team/teams";
import { networkMarkFor } from "./team/network-marks";
import {
  getTeamOutlook,
  type OutlookFact,
  type OutlookGroup,
  type OutlookPlayer,
} from "./team/outlook";
import type { TeamPageData } from "./team/team-data";
import type {
  HistorySeason,
  PlayBalance,
  StatRow,
  TeamStats,
} from "./team/stats";
import type { SnapshotMetric } from "./team/snapshot";
import { TEAM_NEWS_VISIBLE } from "./team/team-data";
import { isOutDesignation, SKILL_POSITIONS, type DepthChartEntry } from "./team/roster";
import { upcomingGames, type ScheduleGame } from "./team/schedule";
import {
  getFPAUrl,
  getPlayerProfileUrl,
  getSOSUrl,
  getTeamDepthChartUrl,
  getTeamPlayersUrl,
  getTeamScheduleUrl,
} from "./team/links";

export interface TeamRenderOptions {
  /**
   * Embedded inside a statchasers.com page. Drops the standalone page's own
   * chrome and demotes the team name to an <h2>, because the host page supplies
   * the H1 — the same reasoning as `heading: false` on the news tool.
   */
  embed?: boolean;
  /** Where a team-switcher link points. Defaults to this app's own /team/. */
  teamPathPrefix?: string;
  /** Carried onto switcher links so embed mode stays embed mode. */
  linkQuery?: string;
  /** Rendered for testability; the page cache keys on the data, not on this. */
  now?: number;
}

/* ------------------------------------------------------------------ atoms */

const ARROW = `<span class="sct-arrow" aria-hidden="true">&rarr;</span>`;

/** Attribute-safe style declaration list, or "". */
function styleAttr(parts: Array<string | null>): string {
  const kept = parts.filter((p): p is string => !!p);
  return kept.length ? ` style="${escapeHtml(kept.join(";"))}"` : "";
}

/**
 * A section heading with the compact gold rule beneath it.
 *
 * The rule is drawn by CSS on the element rather than being a separate node, so
 * it cannot be left behind by a heading that moves.
 */
function h2(text: string, extraClass = ""): string {
  return `<h2 class="sct-h2${extraClass ? ` ${extraClass}` : ""}">${escapeHtml(text)}</h2>`;
}

/**
 * An external link into the main StatChasers site.
 *
 * `target="_top"` because these pages are read inside statchasers.com, and in
 * the legacy iframe mount a plain link would load the destination *inside the
 * frame* — a full site rendered in a 900px box. Breaking out is the correct
 * behaviour in the frame and a no-op when the markup is mounted directly.
 */
function siteLink(
  href: string | null,
  label: string,
  className: string,
  extra = "",
): string {
  if (!href) return "";
  return (
    `<a class="${className}" href="${escapeHtml(href)}" target="_top"${extra}>` +
    `${label}</a>`
  );
}

const MONTHS_UPPER = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

interface DateParts {
  monthUpper: string;
  month: string;
  day: string;
  year: string;
  weekday: string;
  time: string;
}

/**
 * Date pieces in US Eastern — the league's own timezone, and the same one the
 * news cards already format in. Pinned rather than locale-derived so a cached
 * render is correct for every reader and identical on every request.
 */
function easternParts(ms: number): DateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(ms));
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  const monthIndex = Number(get("month")) - 1;
  return {
    monthUpper: MONTHS_UPPER[monthIndex] ?? "",
    month: (MONTHS_UPPER[monthIndex] ?? "").charAt(0) + (MONTHS_UPPER[monthIndex] ?? "").slice(1).toLowerCase(),
    day: get("day"),
    year: get("year"),
    weekday: get("weekday"),
    time: `${get("hour")}:${get("minute")} ${get("dayPeriod").toUpperCase()} ET`,
  };
}

/* ------------------------------------------------------------------- hero */

function heroFacts(data: TeamPageData): string {
  const facts: Array<{ label: string; value: string }> = [];

  facts.push({ label: "Division", value: data.team.division });

  // Withheld out of season — see team-data.ts. Present here only when it means
  // what the heading says it means.
  if (data.profile?.record) {
    facts.push({ label: "Record", value: data.profile.record });
  }
  if (data.profile?.standing) {
    facts.push({ label: "Standing", value: data.profile.standing });
  }
  if (data.profile?.headCoach) {
    facts.push({ label: "Head Coach", value: data.profile.headCoach });
  }
  if (data.schedule?.byeWeek) {
    facts.push({ label: "Bye", value: `Week ${data.schedule.byeWeek}` });
  }

  if (facts.length === 0) return "";

  return (
    `<ul class="sct-facts">` +
    facts
      .map(
        (fact) =>
          `<li class="sct-fact">` +
          `<span class="sct-fact-label">${escapeHtml(fact.label)}</span>` +
          `<span class="sct-fact-value">${escapeHtml(fact.value)}</span>` +
          `</li>`,
      )
      .join("") +
    `</ul>`
  );
}

function teamSwitcher(team: NflTeam, options: TeamRenderOptions): string {
  const prefix = options.teamPathPrefix ?? "/team/";
  const query = options.linkQuery ?? "";

  const groups = TEAM_GROUPS.map((conference) => {
    const divisions = conference.divisions
      .map((division) => {
        const links = division.teams
          .map((entry) => {
            const current = entry.abbreviation === team.abbreviation;
            return (
              `<li>` +
              `<a class="sct-switch-team${current ? " is-current" : ""}"` +
              ` href="${escapeHtml(`${prefix}${entry.slug}${query}`)}"` +
              (current ? ` aria-current="page"` : "") +
              `>` +
              // Decorative: the team's name is right beside it in text, so a
              // second announcement of "Bills logo, Bills" adds nothing.
              `<img class="sct-switch-logo" src="${escapeHtml(entry.logo)}" alt=""` +
              ` width="20" height="20" loading="lazy" decoding="async" />` +
              `<span>${escapeHtml(entry.nickname)}</span>` +
              `</a></li>`
            );
          })
          .join("");
        return (
          `<div class="sct-switch-div">` +
          `<p class="sct-switch-div-title">${escapeHtml(division.division)}</p>` +
          `<ul class="sct-switch-list">${links}</ul>` +
          `</div>`
        );
      })
      .join("");
    return (
      `<div class="sct-switch-conf">` +
      `<p class="sct-switch-conf-title">${escapeHtml(conference.conference)}</p>` +
      divisions +
      `</div>`
    );
  }).join("");

  // <details> rather than a scripted menu: it opens, closes, takes focus and
  // works on a phone with no JavaScript at all, and every destination is a real
  // <a href> — so the switcher is also 31 crawlable internal links rather than
  // a dead end. The client bundle only adds outside-click and Escape.
  return (
    `<details class="sct-switch" data-sct-switch>` +
    `<summary class="sct-switch-summary">` +
    // Lazy even though it is above the fold: a lazy image inside the viewport
    // is still fetched straight away, just at a lower priority than the hero
    // crest beside it. That ordering is the point — this is a 22px decoration
    // and the crest is the LCP candidate.
    `<img class="sct-switch-logo" src="${escapeHtml(team.logo)}" alt=""` +
    ` width="22" height="22" loading="lazy" decoding="async" />` +
    `<span class="sct-switch-name">${escapeHtml(team.fullName)}</span>` +
    `<span class="sct-switch-caret" aria-hidden="true"></span>` +
    `</summary>` +
    `<div class="sct-switch-panel">` +
    `<p class="sct-switch-heading">Change team</p>` +
    `<div class="sct-switch-grid">${groups}</div>` +
    `</div>` +
    `</details>`
  );
}

function renderHero(data: TeamPageData, options: TeamRenderOptions): string {
  const { team } = data;
  const headingTag = options.embed ? "h2" : "h1";

  const updated =
    data.newsUpdatedAtMs !== null
      ? (() => {
          const parts = easternParts(data.newsUpdatedAtMs);
          return (
            `<p class="sct-hero-updated">Latest report ` +
            `<time datetime="${escapeHtml(new Date(data.newsUpdatedAtMs).toISOString())}"` +
            ` data-ts="${data.newsUpdatedAtMs}">` +
            `${escapeHtml(`${parts.month} ${parts.day}, ${parts.time}`)}</time></p>`
          );
        })()
      : "";

  return (
    `<header class="sct-hero">` +
    // Two decorative layers: the team-coloured aura behind the crest and the
    // oversized crest itself at 4% opacity. Both aria-hidden, both painted from
    // custom properties set on the root element so there is one place a team's
    // colours enter the page.
    //
    // They are wrapped rather than being direct children of the hero because
    // the wrapper is what carries the clip. The hero itself used to, and an
    // `overflow: hidden` hero also clips the team switcher's dropdown — which
    // opens below its summary and was therefore being cut off. See
    // .sct-hero-decor in team.css.
    `<span class="sct-hero-decor" aria-hidden="true">` +
    `<span class="sct-hero-aura"></span>` +
    `<span class="sct-hero-watermark"></span>` +
    `</span>` +
    `<div class="sct-hero-inner">` +
    `<div class="sct-hero-crest">` +
    // The hero logo is the page's likeliest LCP element, so it loads eagerly and
    // at high priority. It is the only image on the page that does.
    `<img class="sct-hero-logo" src="${escapeHtml(team.logo)}"` +
    ` alt="${escapeHtml(`${team.fullName} logo`)}" width="88" height="88"` +
    ` fetchpriority="high" decoding="sync" />` +
    `</div>` +
    `<div class="sct-hero-text">` +
    `<p class="sct-eyebrow">${escapeHtml(`${team.division} · ${data.state.season} Season`)}</p>` +
    `<${headingTag} class="sct-title">${escapeHtml(team.fullName)}</${headingTag}>` +
    `<p class="sct-subtitle">${escapeHtml(`${team.fullName} fantasy football hub`)}</p>` +
    heroFacts(data) +
    updated +
    `</div>` +
    `<div class="sct-hero-actions">${teamSwitcher(team, options)}</div>` +
    `</div>` +
    `</header>`
  );
}

/* ------------------------------------------------------------- section nav */

interface Section {
  id: string;
  label: string;
  html: string;
}

/**
 * The section bar.
 *
 * Plain anchors, deliberately. The panels below are switched by `:target` in
 * CSS, so this bar is a working tab strip with scripting disabled and needs no
 * ARIA to be honest about what it is: a list of links to sections of this page.
 * The tab roles, `aria-selected` and the roving tabindex are added by
 * client/team.ts once it can also deliver the arrow-key behaviour those roles
 * promise — announcing a tablist that does not answer arrow keys is worse than
 * announcing a list of links that does exactly what it says.
 */
function renderNav(sections: Section[]): string {
  if (sections.length < 2) return "";
  const items = sections
    .map(
      (section, i) =>
        `<li><a class="sct-nav-link${i === 0 ? " is-active" : ""}"` +
        ` id="${escapeHtml(section.id)}-tab"` +
        ` href="#${escapeHtml(section.id)}">${escapeHtml(section.label)}</a></li>`,
    )
    .join("");
  return (
    `<nav class="sct-nav" aria-label="Team sections" data-sct-nav>` +
    `<ul class="sct-nav-list">${items}</ul>` +
    `</nav>`
  );
}

/* --------------------------------------------------------------- snapshot */

/**
 * Rank tiers. Deliberately three coarse buckets rather than a gradient: the
 * difference between 11th and 13th is noise, and shading it implies a precision
 * the number does not have.
 */
function rankTier(rank: number | null): "good" | "mid" | "poor" | "none" {
  if (rank === null) return "none";
  if (rank <= 8) return "good";
  if (rank >= 25) return "poor";
  return "mid";
}

const TIER_WORD: Record<string, string> = {
  good: "Top tier",
  mid: "Middle tier",
  poor: "Bottom tier",
};

/**
 * The accent a card paints a rank with — the tier, plus a top-five band.
 *
 * A shade finer than the tier itself, and only ever a colour. The tier is the
 * page's verdict and stays three buckets wide everywhere it is spoken aloud,
 * because the difference between 11th and 13th is noise. This exists because a
 * row of cards has to be sortable at a glance, and 2nd earns the right to
 * separate itself from 8th when the two are sitting side by side. Gold rather
 * than a deeper green: the top of the league is the one result on this page
 * worth spending the brand colour on.
 */
function rankAccent(tier: string, rank: number | null): string {
  if (tier === "good" && rank !== null && rank <= 5) return "elite";
  return tier;
}

/**
 * The Stats tab's offence row for a snapshot metric, or null.
 *
 * Only used for the movement arrow, and deliberately fussy about earning it.
 * The two blocks are fetched from different ESPN documents in parallel, each
 * falls back a season on its own, and each ranks by its own reading of the
 * league — so a row only counts when it is describing the same season and has
 * arrived at the same rank ESPN printed on the card. Anything else would draw
 * "2nd, up 12" out of a delta measured from third place.
 */
function snapshotMovement(
  data: TeamPageData,
  metric: SnapshotMetric,
  season: number,
): StatRow | null {
  const stats = data.stats;
  if (!stats || stats.season !== season || metric.rankValue === null) return null;
  const row = stats.offense.find((r) => r.key === `off-${metric.key}`);
  if (!row || row.rank !== metric.rankValue) return null;
  return row;
}

/**
 * One snapshot card: label, number, and a footer that says where the team
 * stands and which way it is going.
 *
 * Built from the same parts as the .sct-tile below it — gold mark, ruled
 * footer, the ordinal captioned rather than housed in a pill, a percentile
 * groove along the bottom edge — at the larger scale four across earns. That
 * rhyme used to span two tabs and now runs down one: the snapshot opens the
 * Stats tab and the tiles follow it, so a reader learns the shape once at the
 * top of the page and reads every block under it for free.
 *
 * "in NFL" is gone from the ordinal. The section is titled Team Snapshot and
 * sits under the team's own name, so the league was never in doubt, and four
 * cards each repeating it cost a line apiece to say nothing. The caption beside
 * the ordinal is the one that carries it, once, quietly.
 */
function snapshotCard(data: TeamPageData, metric: SnapshotMetric, season: number): string {
  const tier = rankTier(metric.rankValue);
  const accent = rankAccent(tier, metric.rankValue);
  const move = snapshotMovement(data, metric, season);

  // The percentile groove, flush with the bottom edge: 1st fills the card and
  // 32nd leaves a stub, so a row of four can be read as a shape before any of
  // the ordinals are read as numbers. No rank, no groove — an empty track reads
  // as missing data rather than as last place.
  const track =
    metric.rankValue !== null
      ? `<span class="sct-metric-track" data-tier="${accent}" aria-hidden="true">` +
        `<span class="sct-metric-fill" style="${escapeHtml(`width:${rankFill(metric.rankValue)}`)}"></span>` +
        `</span>`
      : "";

  // Rank left, movement right, a hairline above them. They are two different
  // facts — where this team stands, and which way it is going — and running
  // them together as "2nd up 12" invites the arrow to be read as part of the
  // ordinal.
  const foot = metric.rank
    ? `<p class="sct-metric-foot">` +
      // The tier is carried as a word as well as a colour and a dot, so a
      // reader who cannot separate the tints still gets the judgement.
      `<span class="sct-metric-rank" data-tier="${tier}" data-accent="${accent}">` +
      `<span class="sct-metric-dot" aria-hidden="true"></span>` +
      `<span class="sct-metric-rank-value">${escapeHtml(metric.rank)}</span>` +
      // Hidden from the reading order rather than repeated: "2nd NFL rank of
      // 32" is the same fact twice. The caption exists to tell an eye what the
      // ordinal is measuring; a screen reader is told outright.
      `<span class="sct-metric-rank-label" aria-hidden="true">NFL rank</span>` +
      `<span class="sct-visually-hidden"> of 32` +
      (tier !== "none" ? ` — ${escapeHtml(TIER_WORD[tier] ?? "")}` : "") +
      `</span>` +
      `</span>` +
      (move ? rankMove(move, true) : "") +
      `</p>`
    : "";

  return (
    `<li class="sct-metric">` +
    `<p class="sct-metric-label">${escapeHtml(metric.label)}` +
    `<span class="sct-visually-hidden"> (${escapeHtml(metric.description)})</span></p>` +
    `<p class="sct-metric-value">${escapeHtml(metric.value)}</p>` +
    foot +
    track +
    `</li>`
  );
}

function renderSnapshot(data: TeamPageData): string {
  const snapshot = data.snapshot;
  if (!snapshot || snapshot.metrics.length === 0) return "";

  const cards = snapshot.metrics
    .map((metric) => snapshotCard(data, metric, snapshot.season))
    .join("");

  // Keyed on the season that came back, not the one the page asked for.
  // getTeamSnapshot() falls back a year when ESPN has nothing for the current
  // season yet, and `state.statsSeasonIsPrior` describes the request — it would
  // caption a block of 2025 numbers as 2026 for the whole of Week 1. The Stats
  // tab labels itself the same way, from the same evidence.
  const seasonNote =
    snapshot.season < data.state.season
      ? `<p class="sct-note">${escapeHtml(`${snapshot.season} regular season — the ${data.state.season} season has no completed team stats yet.`)}</p>`
      : `<p class="sct-note">${escapeHtml(`${snapshot.season} regular season to date.`)}</p>`;

  return (
    `<div class="sct-block">` +
    h2("Team Snapshot") +
    seasonNote +
    `<ul class="sct-metrics">${cards}</ul>` +
    `</div>`
  );
}

/* --------------------------------------------------------- advanced stats */

/**
 * The rank bar's fill.
 *
 * Rank, not value: the point of the bar is where this team sits among 32, and a
 * bar drawn from the raw number would make 4.2 and 4.4 yards a carry look
 * identical when they are 13th and 3rd. 1st fills the track, 32nd leaves a
 * stub — never nothing, because an empty track reads as missing data rather
 * than as last place.
 */
function rankFill(rank: number): string {
  const share = (33 - Math.min(Math.max(rank, 1), 32)) / 32;
  return `${(share * 100).toFixed(1)}%`;
}

/**
 * A metric's tier, or "none" for the ones that do not have a better end.
 *
 * `volume` rows — plays per game, pass rate — are ranked but never tinted. A
 * green bar on "66 plays a game" would be the page asserting that pace is good,
 * which it is not; it is just pace, and the reader is the one who knows whether
 * they want it.
 */
function statTier(row: StatRow): "good" | "mid" | "poor" | "none" {
  if (row.direction === "volume") return "none";
  return rankTier(row.rank);
}

/**
 * One row of a ladder: label, rank bar, value, rank.
 *
 * The bar carries `aria-hidden` because it says nothing the rank chip beside it
 * does not already say in words — the same reasoning as the tier colour on the
 * snapshot cards, which is doubled by TIER_WORD rather than left to colour.
 */
function statRow(row: StatRow): string {
  const tier = statTier(row);
  const bar =
    row.rank !== null
      ? `<span class="sct-stat-bar" data-tier="${tier}" aria-hidden="true">` +
        `<span class="sct-stat-fill" style="${escapeHtml(`width:${rankFill(row.rank)}`)}"></span>` +
        `</span>`
      : // No rank, no track. An empty bar next to a real number would imply a
        // league position we did not establish.
        `<span class="sct-stat-bar is-empty" aria-hidden="true"></span>`;

  const rank = row.rankLabel
    ? `<span class="sct-stat-rank" data-tier="${tier}">${escapeHtml(row.rankLabel)}` +
      (tier !== "none"
        ? `<span class="sct-visually-hidden"> of 32 — ${escapeHtml(TIER_WORD[tier] ?? "")}</span>`
        : `<span class="sct-visually-hidden"> of 32</span>`) +
      `</span>`
    : "";

  return (
    `<li class="sct-stat">` +
    `<span class="sct-stat-label">${escapeHtml(row.label)}` +
    `<span class="sct-visually-hidden"> — ${escapeHtml(row.description)}</span></span>` +
    bar +
    `<span class="sct-stat-value">${escapeHtml(row.value)}</span>` +
    rank +
    rankMove(row) +
    `</li>`
  );
}

/**
 * Year-on-year movement in the rank, as an arrow and a number of places.
 *
 * Direction is read off the rank, not the value: 1st is best on both ladders,
 * so a rank that fell from 11 to 4 is "up 7" whether the metric counts points
 * scored or points allowed. That is the whole reason the ranking direction was
 * settled once in lib/team/stats.ts rather than being decided per component.
 *
 * A rank that did not move renders nothing. An arrow pointing sideways beside
 * thirty other rows is noise, and "no change" is already what an empty slot
 * says.
 */
function rankMove(row: StatRow, unit = false): string {
  if (row.rank === null || row.previousRank === null) return "";
  const places = row.previousRank - row.rank;
  if (places === 0) return "";
  const up = places > 0;
  const size = Math.abs(places);
  // A stroke arrow rather than a filled triangle. The triangle carried more
  // weight than a secondary number deserves beside a rank chip that is already
  // tinted; this says the same thing at a whisper.
  const arrow = up ? "&#8593;" : "&#8595;";
  // The noun only where there is room for it. On a tile the arrow ends a line
  // by itself and "up 4" reads as four sacks unless something says otherwise;
  // in a ladder row the slot is 26px wide and the rank chip is beside it, so
  // the word would wrap before it clarified anything.
  const word = unit
    ? `<span class="sct-move-unit"> spot${size === 1 ? "" : "s"}</span>`
    : "";
  return (
    `<span class="sct-stat-move" data-dir="${up ? "up" : "down"}">` +
    `<span aria-hidden="true">${arrow}&#8239;${size}${word}</span>` +
    // Spelled out, because an arrow and a number is not a sentence.
    `<span class="sct-visually-hidden"> ${up ? "up" : "down"} ${size} ` +
    `place${size === 1 ? "" : "s"} from last season</span>` +
    `</span>`
  );
}

/**
 * One unit's ladder.
 *
 * `data-unit` is what the stylesheet uses to put the gold rule beside Offense
 * and the navy one beside Defense; nothing here decides colour.
 */
function statLadder(
  unit: "offense" | "defense",
  title: string,
  caption: string,
  rows: StatRow[],
): string {
  if (rows.length === 0) return "";
  return (
    `<section class="sct-ladder" data-unit="${unit}">` +
    `<h3 class="sct-ladder-title">${escapeHtml(title)}</h3>` +
    `<p class="sct-ladder-caption">${escapeHtml(caption)}</p>` +
    `<ul class="sct-ladder-list">${rows.map(statRow).join("")}</ul>` +
    `</section>`
  );
}

/** A tile footer's accent, from the row's tier. */
function tileAccent(row: StatRow): string {
  return rankAccent(statTier(row), row.rank);
}

/** A compact card for the metrics that are a number rather than a comparison. */
function statTile(row: StatRow): string {
  const tier = statTier(row);
  const accent = tileAccent(row);

  // The percentile groove along the bottom edge. Same rank-not-value fill as a
  // ladder bar, drawn at 3px because it is a texture for scanning eight cards
  // at once rather than a figure to be read off — the ordinal above it is the
  // figure. No rank, no groove, for the reason the ladder gives.
  const track =
    row.rank !== null
      ? `<span class="sct-tile-track" data-tier="${accent}" aria-hidden="true">` +
        `<span class="sct-tile-fill" style="${escapeHtml(`width:${rankFill(row.rank)}`)}"></span>` +
        `</span>`
      : "";

  // Rank left, movement right, on one ruled line: they are two different facts
  // — where this team stands, and which way it is going — and running them
  // together as "2nd in NFL ▲12" invited the arrow to be read as part of the
  // ordinal. The rule under the value is what makes the split legible.
  const foot = row.rankLabel
    ? `<p class="sct-tile-foot">` +
      // The tier is carried as a word as well as a colour and a dot — a reader
      // who cannot distinguish the tints still gets the judgement.
      `<span class="sct-tile-rank" data-tier="${tier}" data-accent="${accent}">` +
      `<span class="sct-tile-dot" aria-hidden="true"></span>` +
      `<span class="sct-tile-rank-value">${escapeHtml(row.rankLabel)}</span>` +
      // Hidden from the reading order rather than repeated: "2nd NFL rank of
      // 32" is the same fact twice. The caption exists to tell an eye which
      // ladder the ordinal belongs to; a screen reader is told outright.
      `<span class="sct-tile-rank-label" aria-hidden="true">NFL rank</span>` +
      `<span class="sct-visually-hidden"> of 32` +
      (tier !== "none" ? ` — ${escapeHtml(TIER_WORD[tier] ?? "")}` : "") +
      `</span>` +
      `</span>` +
      rankMove(row, true) +
      `</p>`
    : "";

  return (
    `<li class="sct-tile">` +
    `<p class="sct-tile-label">${escapeHtml(row.label)}` +
    `<span class="sct-visually-hidden"> (${escapeHtml(row.description)})</span></p>` +
    `<p class="sct-tile-value">${escapeHtml(row.value)}</p>` +
    foot +
    track +
    `</li>`
  );
}

/* ---------------------------------------------------------- season history */

/**
 * Five seasons as a table.
 *
 * A real `<table>`, unlike everything else on this page. The rest of the hub is
 * lists of things that happen to be laid out in columns — a schedule, a depth
 * chart — and those are marked up as lists because that is what they are. This
 * is genuinely a matrix: every cell is the intersection of a season and a
 * metric, and a reader on a screen reader needs to be told which row and which
 * column they are in. `<th scope>` is the only thing that does that.
 *
 * It is the one block on the tab that scrolls sideways on a phone. Six metric
 * columns cannot be stacked without becoming five separate cards — at which
 * point the comparison between seasons, the entire reason the block exists, is
 * gone. The stylesheet fades the right edge so the scroll is visible.
 */
/**
 * Rank tiers for the history table, finer than the page-wide three.
 *
 * The coarse buckets exist because the difference between 11th and 13th is
 * noise, and that reasoning still holds — none of these tiers is spoken aloud
 * as a verdict, and 11th through 22nd is one flat slate band for exactly that
 * reason. What is different here is the job: thirty numbers in a grid have to
 * be sortable by eye in a single pass, and a table where two thirds of the
 * cells are the same green cannot be. So the top half splits at 5, which is the
 * band a reader is actually looking for, and the bottom stays one bucket
 * because 23rd and 31st are the same news.
 */
function historyTier(row: StatRow): "elite" | "good" | "mid" | "poor" | "none" {
  if (row.direction === "volume" || row.rank === null) return "none";
  if (row.rank <= 5) return "elite";
  if (row.rank <= 10) return "good";
  if (row.rank <= 22) return "mid";
  return "poor";
}

/**
 * Which of the three groups a history column belongs to.
 *
 * Read off the key prefix the metric definitions already use rather than a
 * second list kept in step by hand: a column added to HISTORY_KEYS lands in the
 * right group without this being touched, and one that is neither side of the
 * ball — turnover margin is the only one today — falls into its own group at
 * the end, which is where the table wants it anyway.
 */
function historyGroup(key: string): string {
  if (key.startsWith("off-")) return "offense";
  if (key.startsWith("def-")) return "defense";
  return "other";
}

/**
 * The number behind a preformatted cell value: "28.8", "+3", "42.9%".
 *
 * Null when there is nothing to read, so a caller comparing seasons skips the
 * cell rather than treating it as a zero.
 */
function historyNumber(value: string): number | null {
  const parsed = Number.parseFloat(value.replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The best figure this team has posted in each column, across the seasons shown.
 *
 * The table already says where a season stood in its own league year. This is
 * the other axis, and the one a rank cannot give: whether 28.8 is a good number
 * FOR THIS TEAM, which is most of what five seasons side by side are for.
 *
 * "Best" is the metric's own good end — highest points scored, lowest points
 * allowed — so a volume metric has none and is skipped rather than being handed
 * one arbitrarily. Ties are kept: two seasons at +7 are two best seasons and
 * both get marked.
 *
 * A season still in progress is excluded from the cumulative columns, where a
 * running total is not yet the same kind of number as a finished season's.
 */
function historyBests(history: readonly HistorySeason[]): Map<string, number> {
  const mostGames = Math.max(
    0,
    ...history.map((season) => season.gamesPlayed ?? 0),
  );
  const bests = new Map<string, number>();
  for (const season of history) {
    const partial = (season.gamesPlayed ?? 0) < mostGames;
    for (const cell of season.cells) {
      if (cell.direction === "volume") continue;
      if (partial && cell.cumulative) continue;
      const value = historyNumber(cell.value);
      if (value === null) continue;
      const current = bests.get(cell.key);
      if (
        current === undefined ||
        (cell.direction === "low" ? value < current : value > current)
      ) {
        bests.set(cell.key, value);
      }
    }
  }
  return bests;
}

function renderHistory(stats: TeamStats): string {
  if (stats.history.length < 2) return "";

  // Column heads come from the first row, so a metric ESPN dropped for one old
  // season cannot silently shift the columns underneath it — a row that is
  // missing a cell is padded below rather than closing up.
  const columns = stats.history[0]?.cells.map((cell) => cell.key) ?? [];
  if (columns.length === 0) return "";

  // Where one group of metrics ends and the next begins, so the stylesheet can
  // put a gap and a header divider there. Computed once from the column order
  // rather than asked per cell, because every row needs the same answer and the
  // first column of the table is never a boundary — there is nothing to its
  // left to be separated from.
  const groups = columns.map(historyGroup);
  const startsGroup = groups.map((group, i) => i > 0 && group !== groups[i - 1]);
  const attrs = (i: number) =>
    ` data-group="${escapeHtml(groups[i] ?? "")}"` +
    (startsGroup[i] ? ` class="is-group-start"` : "");

  const head =
    `<tr><th scope="col" class="sct-hist-season">Season</th>` +
    (stats.history[0]?.cells ?? [])
      .map(
        (cell, i) =>
          `<th scope="col"${attrs(i)}>${escapeHtml(cell.label)}` +
          `<span class="sct-visually-hidden"> — ${escapeHtml(cell.description)}</span></th>`,
      )
      .join("") +
    `</tr>`;

  const bests = historyBests(stats.history);
  const seasonCount = stats.history.length;

  const body = stats.history
    .map((season, i) => {
      const cells = new Map(season.cells.map((cell) => [cell.key, cell]));
      const row = columns
        .map((key, col) => {
          const cell = cells.get(key);
          // An absent cell is an empty cell. It is not a zero and it is not a
          // dash pretending to be a measurement.
          if (!cell)
            return `<td class="sct-hist-cell is-empty"${attrs(col)}></td>`;
          const tier = historyTier(cell);
          const best =
            bests.has(key) && historyNumber(cell.value) === bests.get(key);
          // The gold mark is a colour, so it says nothing on its own. The note
          // is what actually carries it to a reader who is not looking at the
          // table, and it is per-cell rather than a legend because a legend
          // several rows away is not an explanation of this number.
          const bestNote = best
            ? `<span class="sct-visually-hidden"> — best of the last ` +
              `${escapeHtml(String(seasonCount))} seasons</span>`
            : "";
          const cls =
            "sct-hist-cell" + (startsGroup[col] ? " is-group-start" : "");
          return (
            `<td class="${cls}" data-group="${escapeHtml(groups[col] ?? "")}">` +
            `<span class="sct-hist-value${best ? " is-best" : ""}">` +
            `${escapeHtml(cell.value)}${bestNote}</span>` +
            (cell.rankLabel
              ? `<span class="sct-hist-rank" data-tier="${tier}">` +
                `${escapeHtml(cell.rankLabel)}` +
                `<span class="sct-visually-hidden"> of 32</span></span>`
              : "") +
            `</td>`
          );
        })
        .join("");
      // "17 games" rather than "17 G". The abbreviation saved a character in a
      // cell that had the room for the word, and read as a stat line of its own
      // sitting directly under a four-digit year.
      const games = season.gamesPlayed
        ? `<span class="sct-hist-games">${escapeHtml(
            `${season.gamesPlayed} ${season.gamesPlayed === 1 ? "game" : "games"}`,
          )}</span>`
        : "";
      // The top row already carries a gold hairline down its left edge. The
      // chip says the same thing in words, which the hairline cannot, and marks
      // the row whose numbers are the ones every other page on this hub is
      // quoting.
      const current = i === 0 ? `<span class="sct-hist-now">Current</span>` : "";
      return (
        `<tr${i === 0 ? ` class="is-current"` : ""}>` +
        `<th scope="row" class="sct-hist-season">` +
        `<span class="sct-hist-year">${escapeHtml(String(season.season))}` +
        current +
        `</span>` +
        games +
        `</th>` +
        row +
        `</tr>`
      );
    })
    .join("");

  const span = stats.history[stats.history.length - 1]?.season;
  return (
    `<div class="sct-block">` +
    h2("Season History") +
    `<p class="sct-note">${escapeHtml(
      span
        ? `Every season back to ${span}, each number ranked against the 32 teams of that year.`
        : "Each number ranked against the 32 teams of its own season.",
    )}</p>` +
    `<div class="sct-hist-scroll">` +
    `<table class="sct-hist">` +
    `<caption class="sct-visually-hidden">` +
    `Team production by season, with each figure's NFL rank for that season.` +
    `</caption>` +
    `<thead>${head}</thead><tbody>${body}</tbody>` +
    `</table>` +
    `</div>` +
    `</div>`
  );
}

/**
 * A tile grid.
 *
 * `cols` is the intended full-width row length for this block — four for the
 * eight situational metrics, three for the six volume ones — so each block
 * fills complete rows rather than leaving a stray pair hanging off the end of
 * one shared four-column grid. The stylesheet overrides it below 900px, where
 * neither number fits.
 */
function statTiles(rows: StatRow[], cols: 3 | 4): string {
  if (rows.length === 0) return "";
  return (
    `<ul class="sct-tiles" data-cols="${cols}">` +
    rows.map(statTile).join("") +
    `</ul>`
  );
}

/**
 * The pass/run split as one bar.
 *
 * Two numbers that sum to 100 are a proportion, and a proportion is the one
 * thing a bar shows better than a pair of figures does. Both halves are still
 * printed underneath — the bar is the shape, the legend is the fact.
 */
function playMix(label: string, caption: string, balance: PlayBalance): string {
  return (
    `<div class="sct-mix">` +
    `<p class="sct-mix-label">${escapeHtml(label)}</p>` +
    `<span class="sct-mix-bar" aria-hidden="true">` +
    `<span class="sct-mix-seg" data-kind="pass" style="${escapeHtml(`width:${balance.passPct.toFixed(1)}%`)}"></span>` +
    `<span class="sct-mix-seg" data-kind="rush" style="${escapeHtml(`width:${balance.rushPct.toFixed(1)}%`)}"></span>` +
    `</span>` +
    `<p class="sct-mix-legend">` +
    `<span class="sct-mix-key" data-kind="pass">Pass ${escapeHtml(balance.passPct.toFixed(1))}%</span>` +
    `<span class="sct-mix-key" data-kind="rush">Run ${escapeHtml(balance.rushPct.toFixed(1))}%</span>` +
    `</p>` +
    `<p class="sct-mix-caption">${escapeHtml(caption)}</p>` +
    `</div>`
  );
}

/**
 * The Stats tab.
 *
 * Three blocks, in the order a reader actually asks the questions: how good is
 * each unit, how does it behave in the situations that decide drives, and how
 * much work is there to go round — which is the only one of the three a fantasy
 * manager is really here for.
 *
 * The two ladders are the same nine metrics in the same order, so the columns
 * line up row for row and "28.8 scored / 18.8 allowed" can be read across
 * without hunting. That symmetry is enforced in lib/team/stats.ts, not here.
 */
function renderTeamStats(data: TeamPageData): string {
  const stats = data.stats;
  if (!stats) return "";

  const ladders = statLadder(
    "offense",
    "Offense",
    "What they did",
    stats.offense,
  ) + statLadder("defense", "Defense", "What they allowed", stats.defense);

  const situational = statTiles(stats.situational, 4);
  const volume = statTiles(stats.volume, 3);
  const mix =
    (stats.balance
      ? playMix("Own play mix", "How this offense splits its snaps.", stats.balance)
      : "") +
    (stats.balanceFaced
      ? playMix(
          "Play mix faced",
          "How opponents attack this defense.",
          stats.balanceFaced,
        )
      : "");

  const history = renderHistory(stats);

  if (!ladders && !situational && !volume && !mix && !history) return "";

  const games =
    stats.gamesPlayed && stats.gamesPlayed > 0
      ? ` · ${stats.gamesPlayed} game${stats.gamesPlayed === 1 ? "" : "s"}`
      : "";
  // Keyed on the season that came back, not on the one the page asked for.
  // getTeamStats() falls back a year when the current season has no completed
  // football in it yet, and the sentence has to describe what is on the screen
  // — `state.statsSeasonIsPrior` describes the request and would say "2026" over
  // a block of 2025 numbers through the whole of Week 1.
  const seasonNote =
    stats.season < data.state.season
      ? `${stats.season} regular season${games} — the ${data.state.season} season has no completed team stats yet.`
      : `${stats.season} regular season to date${games}.`;

  const blocks: string[] = [];

  if (ladders) {
    blocks.push(
      `<div class="sct-block">` +
        h2("Offense & Defense") +
        `<p class="sct-note">${escapeHtml(seasonNote)}</p>` +
        // Stated once, plainly, because a rank is meaningless until the reader
        // knows which way it runs — and on the defense column it runs the way
        // most people would guess wrong.
        `<p class="sct-note">Ranked against all 32 teams. On defense 1st means ` +
        `fewest allowed, not most.</p>` +
        `<div class="sct-ladders">${ladders}</div>` +
        `</div>`,
    );
  }

  if (situational) {
    blocks.push(
      `<div class="sct-block">` +
        h2("Situational & Ball Security") +
        `<p class="sct-note">Third and fourth down, the pass rush at both ends of ` +
        `it, and what each side does with the football.</p>` +
        situational +
        `</div>`,
    );
  }

  if (volume || mix) {
    blocks.push(
      `<div class="sct-block">` +
        h2("Volume & Play Mix") +
        `<p class="sct-note">Opportunity, not quality: how many snaps there are ` +
        `to go round and how they are divided. Ranks here are most to least, ` +
        `with no better end.</p>` +
        volume +
        (mix ? `<div class="sct-mixes">${mix}</div>` : "") +
        `</div>`,
    );
  }

  // Last, deliberately. The three blocks above answer "what is this team now",
  // which is the question almost everyone arrives with; the history answers
  // "and is that new", which only makes sense once the first is answered.
  if (history) blocks.push(history);

  return blocks.join("");
}

/* ----------------------------------------------------- fantasy cornerstones */

/**
 * The depth-chart slot chip: "WR2", "QB1".
 *
 * `data-pos` carries the bare position so the stylesheet can colour it — QB
 * red, RB green, WR blue, TE gold — while the text keeps the depth number,
 * which is the part that says whether this is the starter. Derived here rather
 * than passed in because the slot string is already the only thing the three
 * call sites have, and an unrecognised position simply falls back to the
 * stylesheet's neutral gold.
 */
function slotChip(slot: string, small = false): string {
  const position = (/^[a-z]+/i.exec(slot)?.[0] ?? "").toUpperCase();
  return (
    `<span class="sct-slot${small ? " is-small" : ""}"` +
    ` data-pos="${escapeHtml(position)}">${escapeHtml(slot)}</span>`
  );
}

/**
 * The long designations, shortened for the inline chip.
 *
 * Only the ones that are actually long: "Out", "IR", "PUP" and "Sus" are
 * already as short as they can be, and an entry that is not here falls through
 * unchanged rather than being truncated to something unreadable.
 */
/**
 * Four bands rather than the two this page used to draw.
 *
 * "Out" and "questionable" collapsed a real distinction: doubtful is a player
 * who is probably not playing and questionable is a coin toss, and a manager
 * setting a lineup is doing nothing else but telling those two apart. The
 * colours run the way the risk does — red for gone, red-orange for doubtful,
 * gold for the coin toss, green for a designation that is close to good news.
 *
 * Anything unrecognised lands on "questionable", the neutral middle: an
 * unfamiliar designation is a reason to look, not a reason to assume the worst
 * or the best.
 */
function injurySeverity(
  status: string | null | undefined,
): "out" | "doubtful" | "questionable" | "probable" {
  const key = (status ?? "").trim().toLowerCase();
  if (isOutDesignation(key)) return "out";
  if (key === "doubtful") return "doubtful";
  if (key === "probable" || key === "active" || key === "full") return "probable";
  return "questionable";
}

const SHORT_INJURY_STATUS: Record<string, string> = {
  questionable: "Q",
  doubtful: "D",
  probable: "P",
};

/**
 * The status chip that sits next to a name on a card or a depth-chart row.
 *
 * One letter where there is one — Q, D, P. Spelled out and trailing a body
 * part this ran to "Questionable · Knee - ACL", wider than the name it was
 * annotating on a card four to a row; "Ques" was shorter but is not a word, and
 * it still took enough width in a depth-chart row to push itself onto a second
 * line. "Out", "IR", "PUP" and "Sus" are already as short as they can be and
 * pass through unchanged.
 *
 * The letter is for the eye only. A screen reader is given the designation and
 * the body part in full instead — `title` is not reliably announced, and "Q"
 * read aloud is nothing at all. The Injury Report panel below still carries
 * status, body part and practice status in full, so this is a second way to the
 * same fact rather than the only one.
 */
function injuryBadge(player: DepthChartEntry, extraClass = ""): string {
  if (!player.injuryStatus) return "";
  const short =
    SHORT_INJURY_STATUS[player.injuryStatus.toLowerCase()] ?? player.injuryStatus;
  const detail = injuryDetail(player);
  return (
    `<span class="sct-injury-badge${extraClass ? ` ${extraClass}` : ""}"` +
    ` data-severity="${injurySeverity(player.injuryStatus)}"` +
    ` title="${escapeHtml(detail)}">` +
    `<span aria-hidden="true">${escapeHtml(short)}</span>` +
    `<span class="sct-visually-hidden">${escapeHtml(detail)}</span>` +
    `</span>`
  );
}

/** Status and body part spelled out: "Questionable · Knee - ACL". */
function injuryDetail(player: DepthChartEntry): string {
  if (!player.injuryStatus) return "";
  return player.injuryBodyPart
    ? `${player.injuryStatus} · ${player.injuryBodyPart}`
    : player.injuryStatus;
}

/**
 * A player name, linked to their StatChasers profile when one is configured.
 *
 * Unlinked by default and on purpose: this server cannot tell whether a profile
 * exists for a given player, and a page of names pointing at 404s is worse than
 * a page of names. Set SC_PLAYER_PROFILE_URL_TEMPLATE and every name here
 * becomes a link — see lib/team/links.ts.
 */
function playerName(name: string, className: string, label?: string): string {
  // `label` is already-escaped markup, for the one caller that needs the name
  // rendered as two alternative spellings rather than as one string — see
  // briefName(). It never carries anything a caller did not build here.
  const inner = label ?? escapeHtml(name);
  const href = getPlayerProfileUrl(name);
  if (!href) return `<span class="${className}">${inner}</span>`;
  return (
    `<a class="${className} sct-player-link" href="${escapeHtml(href)}" target="_top">` +
    `${inner}</a>`
  );
}

/**
 * "Rhamondre Stevenson" as "R. Stevenson", or null if it already fits.
 *
 * A depth-chart row is one line by construction — the name cell clips rather
 * than wraps, because a name on two lines makes that row taller than the eleven
 * around it and the column stops being a chart. Clipping alone would end a
 * quarter of the league in an ellipsis, so the long ones are shortened to
 * something that is still a name.
 *
 * The budget is in characters rather than pixels because this is rendered once
 * and cached for every viewport; the server cannot measure a column it will
 * never see. One budget, not two: the name now has the whole width beside the
 * photo to itself — the slot and the status moved to their own line under it —
 * so it no longer matters whether the player is carrying a designation. Twenty
 * characters is what the cell holds four across, between the shell's full width
 * and the 1080px where the grid drops to two columns.
 *
 * Six names in the league's 810 cross it. That is the point: this is for the
 * Croskey-Merritts, not a house style that renames everybody.
 *
 * Returns null rather than a shortened form when there is nothing to shorten —
 * a single-word name, or an abbreviation that would not actually be shorter.
 * The cell still clips those; there is simply no better spelling to offer.
 */
function briefName(name: string): string | null {
  const full = name.trim();
  if (full.length <= 20) return null;

  const gap = full.indexOf(" ");
  if (gap <= 0) return null;
  const rest = full.slice(gap + 1).trim();
  if (!rest) return null;

  // The first letter, not the first token: "A.J. Brown" becomes "A. Brown"
  // rather than "A.J.. Brown", and a suffix rides along on the rest so
  // "Michael Pittman Jr." keeps its "Jr.".
  const brief = `${full.charAt(0).toUpperCase()}. ${rest}`;
  return brief.length < full.length ? brief : null;
}

/* ---------------------------------------------------------------- outlook */

/**
 * One "what changed" fact: an offseason arrival, the play caller, the pace.
 *
 * A <div> pair inside a <dl> rather than a card, because these are the page's
 * cheapest facts and dressing them as tiles would put them at the same weight
 * as the snapshot's ranks directly above. They are context for the take below,
 * not findings of their own.
 *
 * The rank rides on the value rather than getting a line of its own. It is the
 * same relationship the snapshot card draws between a figure and its ordinal —
 * the reading, then what the reading is worth — and giving it a third line here
 * would make a six-item strip twice as tall for a two-character word.
 */
function outlookFact(fact: OutlookFact): string {
  const rank = fact.rank
    ? ` <span class="sct-outlook-fact-rank">${escapeHtml(fact.rank)}` +
      `<span class="sct-visually-hidden"> in the NFL</span></span>`
    : "";
  return (
    `<div class="sct-outlook-fact">` +
    `<dt class="sct-outlook-fact-label">${escapeHtml(fact.label)}</dt>` +
    `<dd class="sct-outlook-fact-value">${escapeHtml(fact.value)}${rank}</dd>` +
    `</div>`
  );
}

/**
 * The compact evidence row under a player's thesis.
 *
 * A list, not a sentence: three facts separated by dots are read by jumping
 * between them, and that is the whole job of this row — it is what a reader
 * checks the claim above against before deciding whether the paragraph below
 * is worth their time.
 *
 * Renders nothing on an empty array rather than an empty rule, because a
 * player who arrived this offseason genuinely has no line to quote here and a
 * bar of dots with nothing between them would be worse than the gap.
 */
function outlookStats(stats: string[]): string {
  if (stats.length === 0) return "";
  return (
    `<ul class="sct-outlook-stats">` +
    stats
      .map((stat) => `<li class="sct-outlook-stat">${escapeHtml(stat)}</li>`)
      .join("") +
    `</ul>`
  );
}

/**
 * One player's card: a face, the call, the evidence, the case.
 *
 * The same card every other player on this page gets — the .sct-player shell,
 * the depth chart's round team-tinted headshot well, and the position chip both
 * of them already use. The take is what is different about this block; the card
 * it arrives in should not be.
 *
 * The card reads top to bottom in decreasing commitment, which is what lets a
 * reader stop at any point and still have taken something away: the tier is the
 * answer, the thesis is the answer in a sentence, the stat row is what the
 * sentence rests on, and the paragraph is for the reader who has decided this
 * player matters to them. It used to be a name and then four sentences, which
 * asked for all of that attention or none of it.
 *
 * `data-pos` is on the card as well as the chip so the stylesheet can put the
 * position's colour on the card's edge — see the inset accent in team.css.
 *
 * `headshot` is whatever the roster could match by name, and null is an
 * ordinary outcome: an outlook can name a rookie Sleeper has not indexed yet.
 * The well is drawn either way and simply stays a tinted disc, which is the
 * same degradation the depth chart takes when the CDN has no thumbnail.
 */
function outlookPlayerCard(player: OutlookPlayer, headshot: string | null): string {
  const position = player.position.toUpperCase();

  // Decorative, so the alt is empty: the name is on the same row, and
  // announcing the face as well would read the player out twice.
  const photo = headshot
    ? `<img class="sct-outlook-photo" src="${escapeHtml(headshot)}" alt=""` +
      ` width="64" height="64" loading="lazy" decoding="async" />`
    : "";

  // The name carries the link and a stretched ::after makes the whole card
  // clickable — the news card's device rather than the cornerstone's bare
  // overlay, because that one lays a box over the card's whole text and these
  // cards carry a paragraph a reader may well want to select.
  const href = getPlayerProfileUrl(player.name);
  const name = href
    ? `<a class="sct-outlook-link" href="${escapeHtml(href)}" target="_top">` +
      `${escapeHtml(player.name)}</a>`
    : escapeHtml(player.name);

  // Text beside the chip rather than a pill of its own. A second lozenge on
  // this line is what the market-rank and verdict chips were, and the reason
  // they went; the classification is a continuation of "QB", not a badge
  // competing with it.
  const tier = player.tier
    ? `<span class="sct-dot" aria-hidden="true"></span>` +
      `<span class="sct-outlook-tier">${escapeHtml(player.tier)}</span>`
    : "";

  return (
    `<li class="sct-outlook-player" data-pos="${escapeHtml(position)}">` +
    `<div class="sct-outlook-head">` +
    `<span class="sct-outlook-well">${photo}</span>` +
    `<div class="sct-outlook-who">` +
    `<h4 class="sct-outlook-name">${name}</h4>` +
    `<p class="sct-outlook-meta">` +
    slotChip(position, true) +
    tier +
    `</p>` +
    `</div>` +
    `</div>` +
    (player.thesis
      ? `<p class="sct-outlook-thesis">${escapeHtml(player.thesis)}</p>`
      : "") +
    outlookStats(player.stats) +
    `<p class="sct-outlook-note">${escapeHtml(player.note)}</p>` +
    `</li>`
  );
}

/**
 * One band of players under its own heading.
 *
 * The heading is the take: "Core fantasy pieces" is an assertion about which
 * four of the seven decide a draft, and it is the reason this section is a
 * curated list rather than a roster dump. It is an <h3> under the section's
 * <h2>, which is what puts the player names at <h4> — the outline follows the
 * page rather than the other way round.
 *
 * Every card in every band carries the team crest as a watermark — the page's
 * existing device (.sct-news-body::before), not a new one. It briefly ran on
 * the core band alone as that band's emphasis; with it on all of them the
 * heading is what tells the bands apart.
 */
function outlookGroup(group: OutlookGroup, headshots: Map<string, string>): string {
  if (group.players.length === 0) return "";
  const cards = group.players
    .map((player) =>
      outlookPlayerCard(player, headshots.get(searchKey(player.name)) ?? null),
    )
    .join("");
  return (
    `<div class="sct-outlook-group">` +
    `<h3 class="sct-outlook-group-label">${escapeHtml(group.label)}</h3>` +
    `<ul class="sct-outlook-players">${cards}</ul>` +
    `</div>`
  );
}

/**
 * The headshot for a name the outlook mentions, from the roster already loaded.
 *
 * Matched on searchKey rather than the raw string, the same normalisation the
 * news pipeline attributes stories with — the outlook is written by hand and
 * "A.J. Brown" should find "AJ Brown" whichever way Sleeper spells it.
 */
function outlookHeadshots(data: TeamPageData): Map<string, string> {
  const byName = new Map<string, string>();
  for (const player of data.roster?.players ?? []) {
    const key = searchKey(player.name);
    if (key && !byName.has(key)) byName.set(key, player.headshot);
  }
  return byName;
}

/**
 * The team's draft-season take, on the Overview tab.
 *
 * Nothing here is fetched, and the meta line says so. Every other block on this
 * page carries a timestamp because it was pulled from a provider minutes ago;
 * this one is a written opinion that will not change until somebody changes it.
 * The line carries the month it was last written for the same reason a byline
 * carries a date — it is the only thing that lets a reader judge how much of it
 * the season has already overtaken — and it keeps "not live data" beside that
 * date so the date cannot be mistaken for a refresh.
 */
function renderOutlook(data: TeamPageData): string {
  const outlook = getTeamOutlook(data.team.abbreviation);
  if (!outlook) return "";

  const headshots = outlookHeadshots(data);
  const groups = outlook.groups.map((group) => outlookGroup(group, headshots)).join("");
  if (!groups) return "";

  // An outlook written for a season the calendar has passed is dropped rather
  // than dated. "A.J. Brown arrives" is true for one offseason and misleading
  // forever after, and a heading reading 2026 on a 2027 page does not rescue
  // the sentence under it — the reader has already taken the advice. Nothing
  // rewrites these but a person, so the page removes them instead of ageing
  // them.
  if (outlook.season < data.state.season) return "";

  const facts = outlook.facts.length
    ? `<dl class="sct-outlook-facts">${outlook.facts.map(outlookFact).join("")}</dl>`
    : "";

  const meta = [
    "Preseason outlook",
    ...(outlook.updated ? [`Updated ${outlook.updated}`] : []),
  ]
    .map((part) => `<span class="sct-outlook-meta-item">${escapeHtml(part)}</span>`)
    .join(`<span class="sct-dot" aria-hidden="true"></span>`);

  const bottomLine = outlook.bottomLine
    ? `<p class="sct-outlook-bottom">` +
      `<span class="sct-outlook-bottom-label">Bottom line</span>` +
      escapeHtml(outlook.bottomLine) +
      `</p>`
    : "";

  return (
    `<div class="sct-block">` +
    h2(`${outlook.season} Fantasy Outlook`) +
    `<p class="sct-outlook-stamp">${meta}</p>` +
    `<p class="sct-outlook-lede">${escapeHtml(outlook.summary)}</p>` +
    facts +
    groups +
    bottomLine +
    `</div>`
  );
}

/**
 * The four depth-chart starters, as photo cards.
 *
 * NOT CURRENTLY MOUNTED. This sat under the outlook on the Overview tab and was
 * taken off it; nothing calls this today. It is kept rather than deleted
 * because the block is complete and correct and the page has already moved one
 * section between tabs this week — the cost of keeping it is a function nobody
 * calls, and the cost of deleting it is writing it again. If it is still
 * unmounted when the hub next settles, delete it along with the .sct-player
 * rules in team.css (all but .sct-player-link, which the news byline uses).
 */
function renderCornerstones(data: TeamPageData): string {
  if (data.cornerstones.length === 0) return "";

  const cards = data.cornerstones
    .map((player) => {
      const href = getPlayerProfileUrl(player.name);
      const cta = href
        ? `<span class="sct-player-cta">View player ${ARROW}</span>`
        : "";
      return (
        `<li class="sct-player">` +
        (href
          ? `<a class="sct-player-hit" href="${escapeHtml(href)}" target="_top"` +
            ` aria-label="${escapeHtml(
              [player.name, player.slot, injuryDetail(player)]
                .filter(Boolean)
                .join(", "),
            )}"></a>`
          : "") +
        `<div class="sct-player-well">` +
        `<img class="sct-player-photo" src="${escapeHtml(player.headshot)}"` +
        ` alt="${escapeHtml(player.name)}" width="150" height="150"` +
        ` loading="lazy" decoding="async" />` +
        // Pinned to the top-right corner of the photo rather than sitting in
        // the body under the name: the status belongs to the face, and down
        // there it pushed the name, slot and CTA around by a row height on
        // exactly the cards that were already the busiest.
        injuryBadge(player, "is-pinned") +
        `</div>` +
        `<div class="sct-player-body">` +
        // Name first, position beneath it. The slot used to lead, which read as
        // a label the card was filed under rather than as a fact about the
        // player; with the photo above, the name is what the eye is looking
        // for. Matches the hit link's aria-label, which already says
        // "<name>, <slot>".
        `<p class="sct-player-name">${escapeHtml(player.name)}</p>` +
        slotChip(player.slot) +
        cta +
        `</div>` +
        `</li>`
      );
    })
    .join("");

  return (
    `<div class="sct-block">` +
    h2("Fantasy Cornerstones") +
    `<p class="sct-note">Depth-chart starters at the four fantasy positions.</p>` +
    `<ul class="sct-players">${cards}</ul>` +
    `</div>`
  );
}

/* ------------------------------------------------------------------- news */

/**
 * The headline with the leading player name removed.
 *
 * The feed writes titles as "TreVeyon Henderson: Dealing with ankle injury",
 * and this card prints the player's name on its own line directly beneath. Left
 * alone the name would appear twice on every card. Only stripped when the title
 * really does start with the stored player name, so a title in any other shape
 * is passed through untouched.
 */
export function splitHeadline(item: NewsItem): string {
  const title = item.title.trim();
  const name = (item.playerName ?? "").trim();
  if (!name) return title;
  const separator = title.indexOf(":");
  if (separator <= 0) return title;
  if (searchKey(title.slice(0, separator)) !== searchKey(name)) return title;
  const rest = title.slice(separator + 1).trim();
  return rest || title;
}

function newsStamp(item: NewsItem): string {
  const ts = itemTimestamp(item);
  if (ts === null) return `<span class="sct-news-kicker">Player News</span>`;
  const parts = easternParts(ts);
  return (
    `<p class="sct-news-meta">` +
    `<span class="sct-news-kicker">Player News</span>` +
    `<span class="sct-dot" aria-hidden="true"></span>` +
    `<time datetime="${escapeHtml(new Date(ts).toISOString())}" data-ts="${ts}">` +
    `${escapeHtml(`${parts.monthUpper} ${parts.day}`)}` +
    `<span class="sct-news-time"> · ${escapeHtml(parts.time)}</span>` +
    `</time></p>`
  );
}

function renderNewsCard(
  item: NewsItem,
  team: NflTeam,
  featured: boolean,
): string {
  const link = safeUrl(item.link);
  const image = safeUrl(item.image);
  const name = (item.playerName ?? "").trim();
  const headline = escapeHtml(splitHeadline(item));

  // 16:9 on the attributes, matching the band the CSS cuts. These are the
  // browser's before-load aspect hint, not a size — the well's own
  // aspect-ratio governs once the stylesheet is in — and the square they used
  // to declare was a headshot's shape, from before the clubs' landscape art
  // was the common case.
  const media = image
    ? `<img class="sct-news-photo" src="${escapeHtml(image)}" alt="${escapeHtml(name)}"` +
      ` width="${featured ? 640 : 480}" height="${featured ? 360 : 270}"` +
      ` loading="lazy" decoding="async" />`
    : // No image: the well keeps its team tint and shows nothing else. A
      // stand-in mark would be one more thing to load for no information.
      `<span class="sct-news-photo-empty" aria-hidden="true"></span>`;

  const byline =
    name || team.fullName
      ? `<p class="sct-news-byline">` +
        (name ? playerName(name, "sct-news-player") : "") +
        `<span class="sct-news-team">${escapeHtml(team.fullName)}</span>` +
        `</p>`
      : "";

  const heading = link
    ? `<h3 class="sct-news-title"><a class="sct-news-link" href="${escapeHtml(link)}"` +
      ` target="_blank" rel="noopener noreferrer">${headline}</a></h3>`
    : `<h3 class="sct-news-title">${headline}</h3>`;

  return (
    `<article class="sct-news${featured ? " is-featured" : ""}">` +
    `<div class="sct-news-well">${media}</div>` +
    `<div class="sct-news-body">` +
    newsStamp(item) +
    heading +
    byline +
    (link
      ? `<p class="sct-news-cta"><span class="sct-news-more">Read report ${ARROW}</span></p>`
      : "") +
    `</div>` +
    `</article>`
  );
}

function renderNewsList(
  items: NewsItem[],
  team: NflTeam,
  startIndex: number,
): string {
  if (items.length === 0) return "";
  return (
    `<ol class="sct-news-list" start="${startIndex + 1}">` +
    items
      .map(
        (item, i) =>
          `<li class="sct-news-item">` +
          renderNewsCard(item, team, startIndex === 0 && i === 0) +
          `</li>`,
      )
      .join("") +
    `</ol>`
  );
}

function renderNewsColumn(data: TeamPageData): string {
  const { team, news } = data;

  if (news.length === 0) {
    return (
      h2(`Latest ${team.nickname} News`) +
      `<div class="sct-empty">` +
      `<p class="sct-empty-title">${escapeHtml(`No recent ${team.nickname} updates.`)}</p>` +
      `<p class="sct-empty-body">We'll surface new reports here as they arrive.</p>` +
      `</div>`
    );
  }

  const visible = news.slice(0, TEAM_NEWS_VISIBLE);
  const rest = news.slice(TEAM_NEWS_VISIBLE);

  // The remainder is a <details>, not a fetch: every story is already in this
  // response, so "view more" is a disclosure rather than a request. It also
  // means a reader with no JavaScript can still open it.
  const more = rest.length
    ? `<details class="sct-more">` +
      `<summary class="sct-more-summary">` +
      `<span>${escapeHtml(`View ${rest.length} more ${team.nickname} ${rest.length === 1 ? "story" : "stories"}`)}</span>` +
      `</summary>` +
      renderNewsList(rest, team, TEAM_NEWS_VISIBLE) +
      `</details>`
    : "";

  return (
    h2(`Latest ${team.nickname} News`) +
    renderNewsList(visible, team, 0) +
    more
  );
}

/* ---------------------------------------------------------- injury watch */

function renderInjuryPanel(data: TeamPageData): string {
  const rows = data.injuries;

  // No roster snapshot at all: say nothing rather than claim a clean bill of
  // health we have not checked.
  if (!data.roster) return "";

  const body = rows.length
    ? `<ul class="sct-injuries">` +
      rows
        .map(
          (player) =>
            `<li class="sct-injury">` +
            slotChip(player.slot, true) +
            `<span class="sct-injury-name">${escapeHtml(player.name)}</span>` +
            `<span class="sct-injury-status"` +
            ` data-severity="${injurySeverity(player.injuryStatus)}">` +
            `${escapeHtml(player.injuryStatus ?? "")}</span>` +
            // Body part and practice status share the line under the name. Two
            // stacked lines of grey footnote made a two-player card as tall as
            // the news column beside it, and the pair reads as one qualifier.
            ((player.injuryBodyPart ? 1 : 0) + (player.practice ? 1 : 0)
              ? `<span class="sct-injury-detail">` +
                [player.injuryBodyPart, player.practice]
                  .filter(Boolean)
                  .map((part) => escapeHtml(String(part)))
                  .join(` <span class="sct-injury-dot">·</span> `) +
                `</span>`
              : "") +
            `</li>`,
        )
        .join("") +
      `</ul>`
    : `<p class="sct-panel-empty">${escapeHtml(`No ${data.team.nickname} skill-position players carry an injury designation right now.`)}</p>`;

  return (
    `<section class="sct-panel">` +
    `<h2 class="sct-panel-title">Injury Watch</h2>` +
    body +
    `</section>`
  );
}

/* ------------------------------------------------------------- next game */

function gameDateLine(game: ScheduleGame): { date: string; time: string } {
  if (game.kickoffMs === null) return { date: "Date TBD", time: "" };
  const parts = easternParts(game.kickoffMs);
  return {
    date: `${parts.weekday}, ${parts.month} ${parts.day}`,
    time: game.timeConfirmed ? parts.time : "Time TBD",
  };
}

/**
 * One side of the matchup: crest, code, name.
 *
 * `isTeam` marks the side this page is about, which is the whole reason the
 * card can afford to draw both of them — on a hub for one team, an undifferentiated
 * pair reads as a fixture list rather than as "your next game".
 */
function matchupSide(
  team: NflTeam | null,
  fallbackName: string,
  isTeam: boolean,
): string {
  const logo = team
    ? `<img class="sct-matchup-logo" src="${escapeHtml(team.logo)}" alt=""` +
      ` width="40" height="40" loading="lazy" decoding="async" />`
    : "";
  // The abbreviation is the headline and the nickname the gloss, which is the
  // way a scoreboard reads. With no canonical team behind the name — ESPN
  // naming an opponent the table does not know — there is no code to print, so
  // the name takes the headline and nothing is faked in its place.
  const code = team
    ? `<span class="sct-matchup-code">${escapeHtml(team.abbreviation.toUpperCase())}</span>`
    : "";
  const name = team?.nickname ?? fallbackName;
  return (
    `<div class="sct-matchup-side${isTeam ? " is-team" : ""}">` +
    logo +
    code +
    `<span class="sct-matchup-name${code ? "" : " is-lead"}">${escapeHtml(name)}</span>` +
    `</div>`
  );
}

function renderNextGamePanel(data: TeamPageData, now: number): string {
  const next = upcomingGames(data.schedule, now, 1)[0];
  if (!next) return "";
  const when = gameDateLine(next);
  const away = next.homeAway === "away";

  // Away side first, home side second — the order every scoreboard uses, so the
  // card says who is travelling without a word for it. A neutral-site game has
  // no host to put second, so it reads "vs" and keeps this team on the left.
  const left = away || next.neutralSite ? data.team : next.opponent;
  const right = away || next.neutralSite ? next.opponent : data.team;
  const leftIsTeam = away || next.neutralSite;

  const matchup =
    // Hidden wholesale from assistive tech, with the sentence below carrying
    // the fact instead. Read out, the three crests and two codes are "NE
    // Patriots at SEA Seahawks" — every name twice and two airport codes.
    `<div class="sct-matchup" aria-hidden="true">` +
    matchupSide(left, leftIsTeam ? data.team.nickname : next.opponentName, leftIsTeam) +
    `<span class="sct-matchup-at" aria-hidden="true">` +
    `${next.neutralSite ? "vs" : "@"}</span>` +
    matchupSide(right, leftIsTeam ? next.opponentName : data.team.nickname, !leftIsTeam) +
    `</div>` +
    // The visual matchup is three logos and two codes, which a screen reader
    // would read as an alphabet. This is the same fact as a sentence.
    `<p class="sct-visually-hidden">${escapeHtml(
      `${data.team.nickname} ${next.neutralSite ? "vs" : away ? "at" : "host"} ` +
        `${next.opponent?.nickname ?? next.opponentName}`,
    )}</p>`;

  // One line of context, and only when it is about the fixture actually shown —
  // see TeamPageData.nextOpponentDefense on why the two can disagree. Points
  // allowed per game with its rank, because it is the one defensive number that
  // needs no explanation and it is the number a manager is asking about.
  const defense = data.nextOpponentDefense;
  const context =
    defense &&
    next.opponent &&
    defense.abbreviation === next.opponent.abbreviation &&
    defense.rankLabel
      ? `<p class="sct-matchup-note">` +
        `<span class="sct-matchup-note-team">${escapeHtml(next.opponent.nickname)} defense</span>` +
        `<span class="sct-matchup-note-value">${escapeHtml(defense.rankLabel)}` +
        `<span class="sct-matchup-note-unit"> · ${escapeHtml(defense.value)} pts/g</span>` +
        `</span></p>`
      : "";

  return (
    `<section class="sct-panel">` +
    `<h2 class="sct-panel-title">Next Game</h2>` +
    `<p class="sct-nextgame-week">${escapeHtml(`Week ${next.week}`)}</p>` +
    matchup +
    `<p class="sct-nextgame-when">${escapeHtml(when.date)}` +
    (when.time ? `<span class="sct-nextgame-time"> · ${escapeHtml(when.time)}</span>` : "") +
    `</p>` +
    (next.venue ? `<p class="sct-nextgame-venue">${escapeHtml(next.venue)}</p>` : "") +
    context +
    `</section>`
  );
}

/* ------------------------------------------------------------ quick links */

interface ResourceCard {
  /** Stable name for the tool, independent of the team in the title. Written
   *  out as data-tool so the stylesheet can drop a card on the tabs where the
   *  page already carries what it links to. */
  key: string;
  title: string;
  /**
   * The title with the team's name taken off: "Depth Chart", not "Patriots
   * Depth Chart".
   *
   * Both forms are needed. "More <team> Tools" is a block of cards that could
   * be lifted onto any page, and its cards say which team they are for. Quick
   * Links sits in the rail of a page whose hero, nav and every heading already
   * say Patriots — there the word is five repetitions of something the reader
   * cannot have missed, and dropping it is what lets the tile grid fit two to a
   * row.
   */
  short: string;
  body: string;
  href: string;
}

function resourceCards(team: NflTeam): ResourceCard[] {
  const candidates: Array<[string | null, string, string, string, string]> = [
    [
      getTeamDepthChartUrl(team),
      "depth-chart",
      `${team.nickname} Depth Chart`,
      "Depth Chart",
      "Starters, backups and the roster battles that decide touches.",
    ],
    [
      getTeamPlayersUrl(team),
      "players",
      `${team.nickname} Player Profiles`,
      "Player Profiles",
      `Research every ${team.city} fantasy asset in one place.`,
    ],
    [
      getTeamScheduleUrl(team),
      "schedule",
      `${team.nickname} Schedule`,
      "Schedule",
      "Every regular-season matchup, week by week.",
    ],
    [
      getSOSUrl(team),
      "sos",
      "Strength of Schedule",
      "Strength of Schedule",
      "Matchup difficulty by fantasy position, including the playoff weeks.",
    ],
    [
      getFPAUrl(team),
      "fpa",
      "Fantasy Points Allowed",
      "Fantasy Points Allowed",
      `How ${team.city}'s defense performs against QB, RB, WR and TE.`,
    ],
  ];
  return candidates
    .filter((entry): entry is [string, string, string, string, string] => !!entry[0])
    .map(([href, key, title, short, body]) => ({ href, key, title, short, body }));
}

function renderQuickLinksPanel(team: NflTeam): string {
  // The whole set, not the first four. This rail is the only route to the tools
  // on the News tab, where the "More <team> Tools" block is hidden as a
  // duplicate of it, so a truncated rail there would leave Fantasy Points
  // Allowed unreachable from that tab. Five rows is one more line in a panel
  // that is already shorter than the news column beside it.
  const cards = resourceCards(team);
  if (cards.length === 0) return "";
  return (
    `<section class="sct-panel">` +
    `<h2 class="sct-panel-title">Quick Links</h2>` +
    `<ul class="sct-quicklinks">` +
    cards
      .map(
        (card) =>
          `<li class="sct-quicklink-item">` +
          siteLink(
            card.href,
            `<span class="sct-quicklink-text">${escapeHtml(card.short)}</span>${ARROW}`,
            "sct-quicklink",
          ) +
          `</li>`,
      )
      .join("") +
    `</ul>` +
    `</section>`
  );
}

/* ------------------------------------------------------------ depth chart */

/**
 * The name cell: one spelling, or two for the names that need shortening.
 *
 * Both are emitted when a short form exists, and CSS picks — the brief one
 * while the chart is four across, the full one from the breakpoint where it
 * drops to two columns and the room is there. Doing it this way rather than
 * choosing on the server is what keeps the abbreviation tied to the width that
 * caused it: one cached fragment serves every viewport, and a phone showing
 * "R. Stevenson" down a full-width column would be shortening a name to fit a
 * column it is not in.
 *
 * The full name is the one in the accessibility tree either way — the brief
 * span is aria-hidden, and the long one is only ever hidden visually — so a
 * screen reader reads "Rhamondre Stevenson" at every width, once.
 */
function depthName(player: DepthChartEntry): string {
  const brief = briefName(player.name);
  if (!brief) return playerName(player.name, "sct-depth-name");
  return playerName(
    player.name,
    "sct-depth-name",
    `<span class="sct-depth-name-long">${escapeHtml(player.name)}</span>` +
      `<span class="sct-depth-name-brief" aria-hidden="true">${escapeHtml(brief)}</span>`,
  );
}

function renderDepthChart(data: TeamPageData): string {
  const { team, depthChart } = data;
  const groups = SKILL_POSITIONS.filter(
    (position) => depthChart[position].length > 0,
  );
  if (groups.length === 0) return "";

  const columns = groups
    .map((position) => {
      const rows = depthChart[position]
        .map(
          (player) =>
            // Two cells: the photo, and a stack of the name over the slot and
            // whatever designation the player is carrying.
            //
            // The name gets a line to itself because it is the thing being
            // looked up — four across, sharing that line with a slot chip and a
            // status pill left it about 120px, which is where the abbreviating
            // and the clipping came from. Underneath it, "RB1" and "Q" read as
            // what they are: two labels on the player above them, in a lighter
            // register, on a line of their own that cannot push the name
            // anywhere.
            `<li class="sct-depth-row">` +
            // Decorative, so the alt is empty: the name is on the same row, and
            // announcing the face as well would read the player out twice. It
            // also means a headshot the CDN does not hold degrades to the bare
            // tinted well rather than to a broken-image icon captioned with the
            // player's name.
            `<span class="sct-depth-well">` +
            `<img class="sct-depth-photo" src="${escapeHtml(player.headshot)}"` +
            ` alt="" width="38" height="38" loading="lazy" decoding="async" />` +
            `</span>` +
            `<span class="sct-depth-body">` +
            depthName(player) +
            `<span class="sct-depth-meta">` +
            slotChip(player.slot, true) +
            injuryBadge(player) +
            `</span>` +
            `</span>` +
            `</li>`,
        )
        .join("");
      // The count earns its place: a column showing two quarterbacks and one
      // showing four receivers are different amounts of information, and with
      // the cards no longer padded to a common height the number is what says
      // a short column is short because the chart is, not because the page
      // failed to load the rest.
      const listed = depthChart[position].length;
      return (
        `<div class="sct-depth-col">` +
        `<h3 class="sct-depth-pos">` +
        `<span class="sct-depth-pos-name">${escapeHtml(position)}</span>` +
        `<span class="sct-depth-count">${listed}` +
        `<span class="sct-visually-hidden"> player${listed === 1 ? "" : "s"} listed</span>` +
        `</span>` +
        `</h3>` +
        `<ol class="sct-depth-list">${rows}</ol>` +
        `</div>`
      );
    })
    .join("");

  const full = getTeamDepthChartUrl(team);

  return (
    h2(`${team.nickname} Fantasy Depth Chart`) +
    `<p class="sct-note">Offensive skill positions only. Order as listed on the team's depth chart.</p>` +
    `<div class="sct-depth">${columns}</div>` +
    (full
      ? `<p class="sct-block-footer">` +
        // Not "View the full Patriots depth chart": the heading two lines above
        // already says whose chart this is, and repeating it was most of a
        // button that ran wider than the cards it sat under.
        //
        // .sct-textlink, not .sct-button — the same treatment the schedule and
        // news footers use. A filled navy button was the loudest thing on the
        // tab and it was pointing away from it; all three block footers are the
        // same quiet gold-underlined link now.
        siteLink(full, `View full depth chart ${ARROW}`, "sct-textlink") +
        `</p>`
      : "")
  );
}

/* --------------------------------------------------------------- schedule */

/**
 * What is worth saying about a fixture beyond who and when.
 *
 * One list, built once, used by both the cards and the season table — the two
 * surfaces sit one above the other and a game that is a division game in the
 * card and an ordinary one in the row would read as two different games.
 *
 * Ordered by how much it changes a decision: the division game is the one a
 * reader is looking for, and where the game is played comes last. The kickoff
 * time already says whether it is a night game. `neutral` is suppressed for an
 * international game because every international game is played at a neutral
 * site — printing both is one fact twice.
 */
function fixtureTags(game: ScheduleGame): Array<{ kind: string; label: string }> {
  const tags: Array<{ kind: string; label: string }> = [];
  if (game.divisional) tags.push({ kind: "division", label: "Div" });
  if (game.international) tags.push({ kind: "intl", label: "Intl" });
  if (game.neutralSite && !game.international) {
    tags.push({ kind: "neutral", label: "Neutral" });
  }
  return tags;
}

/**
 * The broadcaster's name, at the width a badge in a table column has.
 *
 * This is the fallback's fallback now: every network the NFL schedule names has
 * a logo, so the only strings that reach here are the local call signs ESPN
 * sends in place of one ("WBZ", "KHOU"), which are already short. The table
 * stays because those are not the only strings it can ever send — a future
 * "Prime Video" arriving where no logo matched is better as "Prime" than as
 * "Prime Vid…" in a 66px cell. Anything not listed passes through untouched
 * rather than being truncated to something unreadable, which is the same rule
 * the injury designations follow.
 *
 * The full name stays on the element as a title, so shortening never loses it.
 */
const SHORT_NETWORK: Record<string, string> = {
  "prime video": "Prime",
  "amazon prime video": "Prime",
  "nfl network": "NFLN",
  "nfl net": "NFLN",
};

function shortNetwork(network: string): string {
  return SHORT_NETWORK[network.trim().toLowerCase()] ?? network.trim();
}

/**
 * A broadcaster as its own logo, or as the short text when it has none.
 *
 * The <use> points at a symbol defined once per page by networkDefs() — a
 * season carries the same four or five networks across seventeen rows, and
 * repeating the path data on each of them is the same picture seventeen times.
 *
 * The <svg> carries the crop twice over, and both copies earn their place.
 * `viewBox` with `meet` is what guarantees the artwork can never be stretched:
 * whatever box the stylesheet gives it, the logo scales to fit inside and
 * centres, so a box that is a rounding off the ratio costs a stray pixel of air
 * rather than a squashed wordmark. `--sct-net-aspect` is the same crop as a
 * number, which is what lets the stylesheet size the box to the shape instead
 * of leaving that air — see .sct-net-mark. The label is the broadcaster's full
 * name, because "CBS" is what the text version says and a logo should not read
 * as less.
 *
 * The text branch is still reachable: ESPN names a local call sign ("WBZ",
 * "KHOU") for some games, and a station we cannot identify keeps its own name.
 */
function networkHtml(network: string, className: string): string {
  const mark = networkMarkFor(network);
  if (!mark) {
    return (
      `<span class="${className}"><span class="sct-net-text" title="${escapeHtml(network)}">` +
      `${escapeHtml(shortNetwork(network))}</span></span>`
    );
  }
  return (
    `<span class="${className}" title="${escapeHtml(network)}">` +
    `<svg class="sct-net-mark" viewBox="${mark.viewBox}" preserveAspectRatio="xMidYMid meet"` +
    ` style="--sct-net-aspect:${mark.aspect}"` +
    ` role="img" aria-label="${escapeHtml(mark.title)}">` +
    `<use href="#sct-net-${mark.key}" />` +
    `</svg></span>`
  );
}

/**
 * The symbols the marks on this page point at, defined once.
 *
 * Only the networks this team actually plays on: a schedule that never touches
 * Netflix has no reason to carry its path. The block is inert — no size, hidden
 * from assistive tech — and lives inside the schedule section so it travels
 * with the only thing that references it.
 *
 * Each part carries its own fill, because these are the broadcasters' real
 * marks and their colours are the point. Paint order is the table's order: the
 * NFL shield's white stars are shapes laid over its navy field, not holes in
 * it, and drawing them first would lose them under it.
 */
function networkDefs(networks: Array<string | null>): string {
  const marks = new Map<string, ReturnType<typeof networkMarkFor>>();
  for (const network of networks) {
    if (!network) continue;
    const mark = networkMarkFor(network);
    if (mark) marks.set(mark.key, mark);
  }
  if (marks.size === 0) return "";
  return (
    `<svg class="sct-net-defs" aria-hidden="true" focusable="false"><defs>` +
    [...marks.values()]
      .map(
        (mark) =>
          `<symbol id="sct-net-${mark!.key}" viewBox="${mark!.viewBox}">` +
          mark!.paths
            .map(
              (part) =>
                `<path fill="${part.fill}"` +
                (part.evenOdd ? ` fill-rule="evenodd"` : "") +
                ` d="${part.d}" />`,
            )
            .join("") +
          `</symbol>`,
      )
      .join("") +
    `</defs></svg>`
  );
}

/**
 * Where the game stands: the result once there is one, otherwise what it is.
 *
 * The column exists before the season does. A schedule that grows a result
 * column in Week 1 is a table that changes shape under the reader; one that
 * says "Upcoming" in August and "W 27-20" in September is the same table
 * twice. That is why the placeholder is a word rather than an empty cell.
 */
function gameStatusCell(game: ScheduleGame): string {
  if (game.result) {
    const { outcome, teamScore, opponentScore } = game.result;
    // An en dash between the scores, as a score line is set — the hyphen read
    // as a subtraction next to a W.
    return (
      `<span class="sct-result" data-outcome="${outcome}">` +
      `<span aria-hidden="true">${escapeHtml(`${outcome} ${teamScore}\u2013${opponentScore}`)}</span>` +
      `<span class="sct-visually-hidden">` +
      `${outcome === "W" ? "Won" : outcome === "L" ? "Lost" : "Tied"} ${teamScore} to ${opponentScore}` +
      `</span></span>`
    );
  }
  if (game.status === "live") {
    return `<span class="sct-sstatus" data-state="live">Live</span>`;
  }
  return `<span class="sct-sstatus" data-state="upcoming">Upcoming</span>`;
}

/**
 * One upcoming fixture.
 *
 * The card is read top to bottom as: which week and where it is played, who it
 * is against, then when and on what. That ordering is the whole design — the
 * three lines that used to sit loose in the middle (date, venue, network) are
 * now one metadata block below a hairline, and the home/away chip that used to
 * dangle at the bottom has moved up to pair with the week, which is the other
 * half of the same fact.
 *
 * `index === 0` is the next game. It gets a gold rule across its top and a
 * label, so a row of three is a hierarchy rather than three equal boxes.
 */
function renderUpcomingCard(game: ScheduleGame, index: number): string {
  const when = gameDateLine(game);
  const opponent = game.opponent;
  const nickname = opponent?.nickname ?? game.opponentName;

  // Qualifiers other than home/away. They sit with the home/away chip because
  // they describe the fixture rather than its logistics.
  const tags = fixtureTags(game).map(
    (tag) =>
      `<span class="sct-game-tag" data-kind="${tag.kind}">${escapeHtml(tag.label)}</span>`,
  );

  // Venue and network on one line. Either can be missing — ESPN has no network
  // for a game it has not scheduled a window for — and a lone separator is
  // worse than a shorter line. The network is markup rather than text because
  // it may be a mark; the venue is escaped here so the two can be joined.
  const where = [
    game.venue ? escapeHtml(game.venue) : "",
    game.network ? networkHtml(game.network, "sct-game-tv") : "",
  ].filter(Boolean);

  return (
    `<li class="sct-game"${index === 0 ? ` data-next="1"` : ""}>` +
    // The opponent's mark, at 2.5% opacity behind the content. Decorative and
    // hidden from assistive tech: the same logo is already in the matchup line
    // above, where it is the one that counts.
    (opponent
      ? `<img class="sct-game-mark" src="${escapeHtml(opponent.logo)}" alt=""` +
        ` aria-hidden="true" width="120" height="120" loading="lazy" decoding="async" />`
      : "") +
    (index === 0 ? `<p class="sct-game-next">Next game</p>` : "") +
    `<div class="sct-game-head">` +
    `<span class="sct-game-week">${escapeHtml(`Week ${game.week}`)}</span>` +
    `<span class="sct-game-pills">${tags.join("")}` +
    `<span class="sct-game-pill" data-kind="${game.homeAway}">` +
    `${game.homeAway === "home" ? "Home" : "Away"}</span>` +
    `</span>` +
    `</div>` +
    `<div class="sct-game-matchup">` +
    (opponent
      ? `<img class="sct-game-logo" src="${escapeHtml(opponent.logo)}" alt=""` +
        ` width="46" height="46" loading="lazy" decoding="async" />`
      : "") +
    `<span class="sct-game-teams">` +
    `<span class="sct-game-opp">` +
    `<span class="sct-homeaway">${game.homeAway === "home" ? "vs" : "at"}</span> ` +
    `${escapeHtml(nickname)}</span>` +
    (opponent
      ? `<span class="sct-game-full">${escapeHtml(opponent.fullName)}</span>`
      : "") +
    `</span>` +
    `</div>` +
    `<div class="sct-game-meta">` +
    `<p class="sct-game-when">${escapeHtml(when.date)}` +
    (when.time
      ? ` · <span class="sct-game-time">${escapeHtml(when.time)}</span>`
      : "") +
    `</p>` +
    (where.length
      ? `<p class="sct-game-where">${where.join(" · ")}</p>`
      : "") +
    `</div>` +
    `</li>`
  );
}

/**
 * The full season as rows, with the bye slotted into its own week.
 *
 * Inserting the bye is what turns a list of 17 fixtures into a calendar a
 * fantasy manager can read — the week their roster loses a starter is the one
 * week that is not in the fixture list at all.
 */
function renderFullSchedule(data: TeamPageData): string {
  const schedule = data.schedule;
  if (!schedule) return "";

  interface Row {
    week: number;
    html: string;
  }
  const rows: Row[] = schedule.games.map((game) => {
    const when = gameDateLine(game);
    // The same qualifiers the cards carry, one size down. "vs"/"at" is gone:
    // two words that differ by one letter, set in the middle of a line of other
    // words, is not something a reader scans — a chip in a column of its own
    // is, which is the whole difference between reading this table and
    // searching it.
    const tags = fixtureTags(game)
      .map(
        (tag) =>
          `<span class="sct-badge is-tiny" data-kind="${tag.kind}">` +
          `${escapeHtml(tag.label.toUpperCase())}</span>`,
      )
      .join("");
    return {
      week: game.week,
      html:
        `<li class="sct-srow">` +
        `<span class="sct-srow-week">${escapeHtml(`WK ${game.week}`)}</span>` +
        `<span class="sct-srow-side" data-kind="${game.homeAway}">` +
        `${game.homeAway === "home" ? "Home" : "Away"}</span>` +
        `<span class="sct-srow-opp">` +
        (game.opponent
          ? `<img class="sct-srow-logo" src="${escapeHtml(game.opponent.logo)}" alt=""` +
            ` width="22" height="22" loading="lazy" decoding="async" />`
          : "") +
        `<span class="sct-srow-name">` +
        `${escapeHtml(game.opponent?.nickname ?? game.opponentName)}</span>` +
        tags +
        `</span>` +
        `<span class="sct-srow-when">${escapeHtml(when.date)}${when.time ? ` · ${escapeHtml(when.time)}` : ""}</span>` +
        `<span class="sct-srow-venue">${escapeHtml(game.venue ?? "")}</span>` +
        // Its own cell rather than trailing the venue. On the cards the network
        // is the last thing on a line you read once; in a table it is a column
        // people run their eye down looking for the games they can watch.
        (game.network
          ? networkHtml(game.network, "sct-srow-tv")
          : // Kept, and empty. ESPN has no network for a game it has not put in
            // a window yet, and dropping the cell would shift every column to
            // its right on exactly those rows.
            `<span class="sct-srow-tv"></span>`) +
        gameStatusCell(game) +
        `</li>`,
    };
  });

  if (schedule.byeWeek) {
    rows.push({
      week: schedule.byeWeek,
      html:
        `<li class="sct-srow is-bye">` +
        `<span class="sct-srow-week">${escapeHtml(`WK ${schedule.byeWeek}`)}</span>` +
        // One cell across the rest of the row. The bye is the only row with
        // nothing to say in five of the six columns, and filling them with
        // empty spans drew five column rules through the one row that is not a
        // fixture.
        `<span class="sct-srow-bye">Bye week</span>` +
        `</li>`,
    });
  }

  rows.sort((a, b) => a.week - b.week);

  return `<ol class="sct-slist">${rows.map((row) => row.html).join("")}</ol>`;
}

function renderSchedule(data: TeamPageData, now: number): string {
  const { team, schedule } = data;

  if (!schedule) {
    return (
      h2(`${data.state.season} ${team.nickname} Schedule`) +
      `<div class="sct-empty">` +
      `<p class="sct-empty-title">Schedule information is temporarily unavailable.</p>` +
      `<p class="sct-empty-body">It will reappear here as soon as the fixture data loads.</p>` +
      `</div>`
    );
  }

  const next = upcomingGames(schedule, now, 3);
  const full = getTeamScheduleUrl(team);

  return (
    h2(`${schedule.season} ${team.nickname} Schedule`) +
    networkDefs(schedule.games.map((game) => game.network)) +
    (schedule.byeWeek
      ? `<p class="sct-note">${escapeHtml(`Bye in Week ${schedule.byeWeek}.`)}</p>`
      : "") +
    // A label over the cards, so the three of them read as a deliberate "what is
    // coming up" strip rather than an unexplained extract of the season. The
    // count is the real one: late in the year upcomingGames() returns fewer
    // than three, and a heading that says otherwise is just wrong.
    (next.length
      ? `<p class="sct-games-eyebrow">${escapeHtml(
          next.length === 1 ? "Next game" : `Next ${next.length} games`,
        )}</p>` +
        `<ul class="sct-games">${next.map((game, i) => renderUpcomingCard(game, i)).join("")}</ul>`
      : "") +
    renderFullSchedule(data) +
    (full
      ? `<p class="sct-block-footer">` +
        // "View full schedule", not "See the full 2026 schedule": the heading
        // above already carries the season and the team, and the depth chart's
        // footer three tabs over now reads the same way.
        siteLink(full, `View full schedule ${ARROW}`, "sct-textlink") +
        `</p>`
      : "")
  );
}

/* -------------------------------------------------------------- resources */

function renderResources(team: NflTeam): string {
  const cards = resourceCards(team);
  if (cards.length === 0) return "";
  return (
    `<section class="sct-section" id="resources">` +
    h2(`More ${team.nickname} Tools`) +
    `<ul class="sct-resources">` +
    cards
      .map(
        (card) =>
          `<li class="sct-resource" data-tool="${escapeHtml(card.key)}">` +
          `<a class="sct-resource-link" href="${escapeHtml(card.href)}" target="_top">` +
          `<span class="sct-resource-title">${escapeHtml(card.title)}</span>` +
          `<span class="sct-resource-body">${escapeHtml(card.body)}</span>` +
          `<span class="sct-resource-cta">Open ${ARROW}</span>` +
          `</a></li>`,
      )
      .join("") +
    `</ul>` +
    `</section>`
  );
}

/* ------------------------------------------------------------------- page */

/**
 * The complete team hub as one fragment.
 *
 * This is what both mounts receive: the standalone page drops it into its shell
 * and the WordPress mount prints it straight into the page body, exactly as the
 * news tool's fragment already works.
 */
export function renderTeamPage(
  data: TeamPageData,
  options: TeamRenderOptions = {},
): string {
  const { team } = data;
  const now = options.now ?? Date.now();

  // Overview is the outlook alone. Fantasy Cornerstones used to follow it;
  // renderCornerstones() is still here and still correct, just not mounted —
  // see the note above it.
  const overview = renderOutlook(data);

  const sidebar =
    renderInjuryPanel(data) +
    renderNextGamePanel(data, now) +
    renderQuickLinksPanel(team);

  // A team with almost no archived news leaves a one-card column beside a
  // three-panel rail, which is several hundred pixels of dead space rather than
  // a layout. Below three stories the rail moves underneath and spreads out.
  // The archive is genuinely thin for some teams, so this is the normal case
  // for them, not an edge case.
  const stacked = data.news.length < 3;

  const newsSection =
    `<div class="sct-news-grid${stacked ? " is-stacked" : ""}">` +
    `<div class="sct-news-main">${renderNewsColumn(data)}</div>` +
    (sidebar ? `<aside class="sct-sidebar">${sidebar}</aside>` : "") +
    `</div>`;

  // The snapshot leads the Stats tab: it is the four-card version of the
  // ladders directly below it, and a reader who opens Stats is asking the
  // question it answers first. Concatenated rather than folded into
  // renderTeamStats() so the tab still appears carrying the snapshot alone when
  // ESPN's season statistics fail but its team summary does not — the two come
  // from different endpoints and fail independently.
  const stats = renderSnapshot(data) + renderTeamStats(data);
  const depth = renderDepthChart(data);
  const schedule = renderSchedule(data, now);

  // Built from what actually rendered: a section that produced no markup is not
  // in the page and must not be in the navigation pointing at nothing.
  const sections: Section[] = [
    { id: "overview", label: "Overview", html: overview },
    // Directly right of Overview rather than behind the news archive: it now
    // opens with the Team Snapshot and expands it, so it is the whole team at a
    // glance and then the same reading one level deeper.
    { id: "stats", label: "Stats", html: stats },
    { id: "news", label: "News", html: newsSection },
    { id: "depth-chart", label: "Depth Chart", html: depth },
    { id: "schedule", label: "Schedule", html: schedule },
  ].filter((section) => section.html !== "");

  // `is-default` marks the panel that shows when the URL names no section. It
  // is a class rather than :first-of-type because the CSS must not depend on
  // this element being the first <section> among its siblings — the hero and
  // the resources block are sections too, and a reorder here would silently
  // blank the page rather than fail visibly.
  const body = sections
    .map(
      (section, i) =>
        `<section class="sct-section${i === 0 ? " is-default is-active" : ""}"` +
        ` data-sct-panel id="${escapeHtml(section.id)}"` +
        ` aria-labelledby="${escapeHtml(section.id)}-tab">${section.html}</section>`,
    )
    .join("");

  // One place a team's colours enter the page. Everything team-tinted below
  // reads these custom properties, so there is no per-team CSS and no component
  // that has to know which team it is drawing.
  const rootStyle = styleAttr([
    `--team-primary:${team.primaryColor}`,
    `--team-secondary:${team.secondaryColor}`,
    `--team-logo:url('${team.logo}')`,
  ]);

  return (
    `<div class="sct${options.embed ? " is-embed" : ""}" data-sct-root="1"` +
    ` data-team="${escapeHtml(team.abbreviation)}"` +
    ` data-season="${escapeHtml(String(data.state.season))}"${rootStyle}>` +
    renderHero(data, options) +
    renderNav(sections) +
    body +
    renderResources(team) +
    `</div>`
  );
}

/* -------------------------------------------------------------- team index */

/**
 * A plain index of all 32 hubs at /team.
 *
 * Its job is navigation and verification, not presentation: it is how you check
 * that every team resolves, and it gives the 404 page somewhere useful to send
 * a reader. A full document rather than a fragment, because nothing embeds it.
 */
export function renderTeamIndex(
  teams: readonly NflTeam[],
  options: { linkQuery?: string; teamPathPrefix?: string } = {},
): string {
  const prefix = options.teamPathPrefix ?? "/team/";
  const query = options.linkQuery ?? "";

  const groups = TEAM_GROUPS.map((conference) => {
    const divisions = conference.divisions
      .map((division) => {
        const links = division.teams
          .filter((team) => teams.some((t) => t.abbreviation === team.abbreviation))
          .map(
            (team) =>
              `<li><a class="sct-switch-team" href="${escapeHtml(`${prefix}${team.slug}${query}`)}">` +
              `<img class="sct-switch-logo" src="${escapeHtml(team.logo)}" alt=""` +
              ` width="22" height="22" loading="lazy" decoding="async" />` +
              `<span>${escapeHtml(team.fullName)}</span></a></li>`,
          )
          .join("");
        return (
          `<div class="sct-switch-div">` +
          `<p class="sct-switch-div-title">${escapeHtml(division.division)}</p>` +
          `<ul class="sct-switch-list">${links}</ul>` +
          `</div>`
        );
      })
      .join("");
    return (
      `<section class="sct-switch-conf">` +
      `<h2 class="sct-switch-conf-title">${escapeHtml(conference.conference)}</h2>` +
      divisions +
      `</section>`
    );
  }).join("");

  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0" />` +
    `<title>NFL Team Hubs | StatChasers</title>` +
    `<meta name="robots" content="noindex, indexifembedded" />` +
    `<link rel="stylesheet" href="/team.css" />` +
    `</head><body class="sct-page"><div class="sct">` +
    `<header class="sct-hero"><span class="sct-hero-decor" aria-hidden="true"></span>` +
    `<div class="sct-hero-inner"><div class="sct-hero-text">` +
    `<p class="sct-eyebrow">StatChasers</p>` +
    `<h1 class="sct-title">NFL Team Hubs</h1>` +
    `<p class="sct-subtitle">News, depth charts, schedules and fantasy outlook for all 32 teams.</p>` +
    `</div></div></header>` +
    `<div class="sct-section"><div class="sct-switch-grid is-index">${groups}</div></div>` +
    `</div></body></html>`
  );
}
