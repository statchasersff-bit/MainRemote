/**
 * Markup for the NFL Player Pages.
 *
 * Server-only, like lib/team-render.ts and for the same reason: the page ships
 * complete HTML and client/player.ts only enhances what is already there. This
 * replaces a 3,200-line React profile that built every one of these sections in
 * the browser, which meant a crawler received an empty div - the same problem
 * the news tool and the team hubs were moved off an iframe to solve.
 *
 * The rules are the team hub's, unchanged:
 *
 * 1. A field we do not have is not rendered. No "N/A", no em-dash standing in
 *    for a number nobody measured, no zero pretending to be a measurement. A
 *    section with no data is dropped and the tab strip is built from what
 *    actually rendered.
 *
 * 2. The team is an accent, not a repaint. Surfaces, headings and controls are
 *    StatChasers navy/gold/white; the player's team color appears as an aura
 *    behind the headshot and a hairline on the hero, and nowhere else.
 *
 * And one this page adds, because it is the one that gets broken:
 *
 * 3. **Nothing here predicts.** Every label - "Heating Up", "TD-Driven",
 *    "Elite" - is a restatement of a number that is printed beside it. The page
 *    describes what happened and says what it is calling that; it never asserts
 *    what happens next. Where the source data is a projection (the 2026
 *    outlook), it is kept apart from the measured sections rather than adopted
 *    in the page's voice: its own tab, and a heading that says outlook and
 *    names the season. The quote framing and the source line under it were
 *    removed by request; the tab and the heading are what is left doing that
 *    job, so neither should be softened into something vaguer.
 *
 * A note on color. The four finish tiers are an ORDINAL scale - POS1 through
 * Bust is an order, not a set of identities - so they take one hue in four
 * monotone lightness steps rather than four hues. The order is then visible in
 * the color itself, and the page stays on-brand instead of becoming a chart
 * with a fruit salad in it. Every tier also carries its own text label, so the
 * palest step never has to carry meaning alone.
 */

import { escapeHtml, escapeJsonLd, safeUrl } from "./render";
import { headshotImg } from "./headshot-html";
import { assetUrl } from "./asset-origin";
import { easternParts } from "./news-card";
// The tab strip's headings and standfirsts come from the same function the
// document head uses, so a heading swapped in by a click and one loaded with
// the page are generated from one place. player-seo.ts imports nothing from
// here - only a comment mentions it - so this does not close a cycle.
import { playerPageMeta } from "./player-seo";
import type { NflTeam } from "./team/teams";
import {
  finishBadge,
  fpts,
  keyStatSummary,
  metricAverage,
  perGameRates,
  gameLogColumns,
  RECEIVER_RUSH_COLUMNS,
  type LogColumn,
  positionMomentumMetrics,
  recentGames,
  TIER_FILL,
  weeklyTier,
  weeklyTierLabel,
  type WeeklyTier,
} from "./player/metrics";
import type { UpcomingGame } from "./player/upcoming";
import { playerSearchIndex } from "./player/player-data";
import { PPG_MIN_GAMES } from "./player/ranks";
import type {
  DirectoryPlayer,
  IndexedPlayer,
  PlayerDirectory,
  PlayerPageData,
} from "./player/player-data";
import {
  pointsBreakdown,
  SCORING_LABELS,
  SCORING_SHORT,
  type ScoringFormat,
} from "./player/scoring";
import type {
  CareerSeasonStat,
  GameLogEntry,
} from "./player/types";
import { type RiskLevel } from "./player/injury";
import { type CareerStatRow } from "./player/stats-profile";
import { canonicalizeMatchupPair } from "./matchup/pair";
import { percentileWord } from "./player/fantasy-read";
import type { OutlookBand } from "./player/types";
import {
  headerKind,
  matchupBand,
  OUTLOOK_SEASON,
  renderHero,
  STARTSIT_BASE,
  type MatchupBand,
} from "./player/header";
import { renderOverviewSections } from "./player/overview";
import { sectionHref } from "./player/sections";
import { currentRank, nextGame, oneDecimal, seasonPpg } from "./player/season-phase";
import { renderStatsTabParts, STATS_LEAD_ID } from "./player/stats-tab";
import { outlookTabParts } from "./player/outlook-tab";
import { renderOutlook2026 } from "./player/outlook-2026";
import { injuryTabParts } from "./player/injury-tab";
import { renderBioTab } from "./player/bio-tab";
import { renderNewsTabParts } from "./player/news-tab";
import { renderGamelogStory } from "./player/gamelog-sections";
import { renderFaqSection, selectFaq, tabHref } from "./player/faq-engine";
import { gameLogPool, statsPool } from "./player/faq-pools";
import { titleCase } from "./player/title-case";

export interface PlayerRenderOptions {
  /**
   * Embedded inside a statchasers.com page. Drops the standalone page's chrome
   * and demotes the player's name to an <h2>, because the host page supplies
   * the H1 - the same reasoning as the team hub's embed mode.
   */
  embed?: boolean;
  /** Where a player link points. Defaults to this app's own /player/. */
  playerPathPrefix?: string;
  /** Where a team link points. Defaults to this app's own /team/. */
  teamPathPrefix?: string;
  /**
   * Where matchup pages live. Defaults to this app's own /nfl/.
   *
   * Only the upcoming-games cards use it, and they build the address through
   * canonicalizeMatchupPair() like everywhere else - so a fixture against
   * Seattle and Seattle's own page against this club are one URL, whichever
   * side the reader arrived from.
   */
  matchupPathPrefix?: string;
  /**
   * Where the Fantasy Points Allowed page lives. Defaults to this app's own
   * /fpa. The upcoming-games caption is the one place that links to it: it
   * describes a rank the reader cannot check without the table it comes from.
   */
  fpaPath?: string;
  /** Carried onto internal links so embed mode stays embed mode. */
  linkQuery?: string;
  /**
   * Where the start/sit tool lives, for the control bar's button. Defaults to
   * Redraft Command's launcher on statchasers.com - an absolute URL rather than
   * a path, because this one destination is on the live site whether the markup
   * is being served standalone here or printed into a WordPress page there.
   */
  startSitBase?: string;
  /** Rendered for testability; the page cache keys on the data, not on this. */
  now?: number;
  /**
   * Where the page's FAQ questions are collected, instead of each block
   * emitting its own schema.
   *
   * INTERNAL: renderPlayerPage() sets one of these per section and emits a
   * single node from the sections that actually shipped. A caller that renders
   * a block on its own leaves it unset and gets the block's own schema, which
   * is what the section renderers' unit tests rely on.
   */
  faqSink?: Array<{ question: string; answer: string }>;
  /**
   * Render ONE section as the whole page, for a section-scoped URL.
   *
   * `/fantasy-football/players/<slug>/injury/` has to be a different page from
   * the player's main one or it is duplicate content wearing a second address:
   * six tabs of identical markup at every URL, competing with each other. So a
   * section page is the hero, that section, and a way back to the rest - and
   * its heading is the phrase the page is actually about.
   *
   * Ignored when the id does not match a section that rendered, which keeps a
   * stale link serving the full page rather than a 404.
   */
  section?: string;
  /**
   * The host has stood down: this fragment supplies the page's <h1>.
   *
   * Set by the WordPress plugin's "the tool supplies the heading" mode, which
   * empties the theme's page title. Without it the theme prints the same phrase
   * above the tool and the page carries the heading twice - once in the theme's
   * serif, once here with the gold rule under it.
   *
   * Exactly one panel is promoted either way. See promoteHeading(). The
   * header stays an <h2> in this mode as in any embed.
   */
  ownHeading?: boolean;
  /**
   * Where the ids of the sections that rendered are collected.
   *
   * INTERNAL, like faqSink: the SSR layer reads it to tell a section URL whose
   * section exists from one whose section does not, which must not stand as a
   * page (it would be the whole profile under the section's title).
   */
  sectionsSink?: string[];
}

/**
 * How a section-scoped page names itself.
 *
 * The heading is the page's H1 (its H2 in embed mode, where WordPress supplies
 * the H1) and is written as the phrase people search rather than as a tab
 * label: "Injury Update & History", not "Injury". Sections not listed here can
 * still be addressed; they just fall back to the tab's own label.
 */
const SECTION_HEADINGS: Record<string, string> = {
  stats: "Stats",
  injury: "Injury Update & History",
  "game-log": "Game Log",
  outlook: "Fantasy Outlook",
  // mak, 2026-09-30 (was "News & Analysis"); worded "Latest {name} News &
  // Updates" by sectionHeading() below.
  news: "News & Updates",
  bio: "Bio",
};

/**
 * The heading of the profile itself: "Josh Allen Fantasy Football".
 *
 * The profile's address is the Overview's address - `/overview/` 301s here - so
 * this is also the Overview tab's heading. It names the player and the intent,
 * like the six section headings beside it. The two it replaced did not: the
 * panel's "2026 Fantasy Snapshot" was the same words on every profile, and the
 * bare name was the same words as the hero.
 */
export function profileHeading(playerName: string): string {
  // "{Name} Fantasy Football" since 2026-10-09 (mak): the hub's search is
  // "X fantasy", and "Stats" belongs to the Stats tab's heading.
  return `${playerName} Fantasy Football`;
}

/** The small line under the hub's H1: "RB, Atlanta Falcons". */
export function profileSubtitle(data: PlayerPageData): string {
  return [data.player.position, data.team?.fullName].filter(Boolean).join(", ");
}

/** The public heading for a section page, e.g. "Jacoby Brissett Injury Update & History". */
export function sectionHeading(
  playerName: string,
  section: string,
  season?: number,
): string | null {
  const phrase = SECTION_HEADINGS[section];
  if (!phrase) return null;
  // "Jacoby Brissett Stats 2026" - the year is part of the phrase people type
  // for stats, a game log and an outlook, and not for the others. The outlook's
  // year is the one it projects, which is not always the season on the page.
  if (section === "outlook") return `${playerName} ${phrase} ${OUTLOOK_SEASON}`;
  if (section === "news") return `Latest ${playerName} ${phrase}`;
  const dated = season && (section === "stats" || section === "game-log");
  return dated ? `${playerName} ${phrase} ${season}` : `${playerName} ${phrase}`;
}

/* ------------------------------------------------------------------ atoms */

const DASH = "-";

/** The interpunct these pages join short facts with. */
const DOT = "·";

/**
 * The multiplication sign, which is the dismiss mark on a filter pill.
 *
 * Not the letter x and not a hyphen: it is the mark every dismissible chip on
 * the web uses, and at this size the letter reads as a word beside a club's
 * name rather than as a button.
 */
const TIMES = "×";

/** Where the Fantasy Points Allowed table lives on this origin. */
const DEFAULT_FPA_PATH = "/fpa";

/** This origin's own matchup pages. Same default the team hub uses. */
const DEFAULT_MATCHUP_PREFIX = "/nfl/";

/** The hub's arrow, for the one call-to-action this page has. */
const ARROW = `<span class="scp-arrow" aria-hidden="true">&rarr;</span>`;

/** Attribute-safe style declaration list, or "". */
function styleAttr(parts: Array<string | null | false>): string {
  const kept = parts.filter((p): p is string => typeof p === "string" && p !== "");
  return kept.length ? ` style="${escapeHtml(kept.join(";"))}"` : "";
}

/** A section heading with the compact gold rule beneath it. */
function h2(text: string, subtitle = ""): string {
  return (
    `<div class="scp-head">` +
    `<h2 class="scp-h2">${escapeHtml(text)}</h2>` +
    (subtitle ? `<p class="scp-head-sub">${escapeHtml(subtitle)}</p>` : "") +
    `</div>`
  );
}

function h3(text: string): string {
  return `<h3 class="scp-h3">${escapeHtml(text)}</h3>`;
}

/**
 * Promote a panel's own heading to the page's <h1>.
 *
 * Every section opens with `h2()` - "Jacoby Brissett Stats 2026" and its six
 * siblings - because the fragment is normally mounted in a page that already
 * has an H1 of its own. On a section address the host prints that same phrase
 * in the theme's title and the reader sees it twice: once in the theme's serif
 * at the top, once here with the gold rule under it, saying the same words.
 *
 * Where the host has agreed to stand down (the plugin's "the tool supplies the
 * heading" mode empties the theme's title), the panel's heading IS the page's
 * heading and should be marked up as one. Only the class stays - the styling is
 * `.scp-h2` in both cases, so this changes the document outline and nothing a
 * reader can see.
 *
 * The FIRST match only, and only ever one panel's worth: a section page renders
 * one panel, and the all-tabs page promotes just the panel it opens on, so the
 * document has exactly one H1 either way.
 *
 * `text` replaces the heading's words as well. The all-tabs page passes
 * profileHeading(): its opening panel is headed "2026 Fantasy Snapshot", which
 * names nobody and read the same on every profile once it was the H1.
 */
function promoteHeading(html: string, text?: string, subtitle?: string): string {
  return html.replace(
    /<h2 class="scp-h2">([\s\S]*?)<\/h2>/,
    (_, inner: string) =>
      `<h1 class="scp-h2">${text === undefined ? inner : escapeHtml(text)}</h1>` +
      // The hub's small line under its H1 - "RB, Atlanta Falcons" (mak,
      // 2026-10-09). Only the promoted heading carries it: the panel's own
      // <h2> is a snapshot caption, not the page's name.
      (subtitle ? `<p class="scp-head-sub">${escapeHtml(subtitle)}</p>` : ""),
  );
}

/**
 * Tabs whose panel heading is gone, and the section heading that is theirs now.
 *
 * mak dropped the Stats panel heading and the Outlook's "<season> Outlook" head
 * (2026-09-30), so each tab's first spec heading is the one the page's H1 has
 * to be: "{Name} {season} stats", "{Name} rest-of-season outlook". Its own
 * words, not sectionHeading()'s, so the H1 is the heading a reader sees.
 */
const LEAD_HEADINGS: Record<string, string> = {
  stats: STATS_LEAD_ID,
  outlook: "scp-ol-take-h",
};

/**
 * promoteHeading() for a tab in LEAD_HEADINGS. One that still has its old
 * panel heading (a Stats tab with no production section) promotes that, as
 * before.
 */
function promoteLeadHeading(html: string, id: string, fallbackText?: string): string {
  if (/<h2 class="scp-h2">/.test(html)) return promoteHeading(html, fallbackText);
  return html.replace(
    new RegExp(`<h2 class="scp-ox-h2 is-lead" id="${id}">([\\s\\S]*?)</h2>`),
    (_, inner: string) => `<h1 class="scp-ox-h2 is-lead" id="${id}">${inner}</h1>`,
  );
}

/**
 * A section heading with the gold rule under it.
 *
 * The Stats tab is a sequence of six blocks and an h3 alone was not enough to
 * mark where one ends and the next begins - the page read as a stack of
 * components. The rule is drawn by the heading rather than by a sibling node,
 * for the reason .scp-h2::after gives: it cannot be left behind by a heading
 * that moves.
 */
function sectionHead(text: string, sub = "", aside = ""): string {
  const text_ =
    `<h3 class="scp-sect-title">${escapeHtml(text)}</h3>` +
    (sub ? `<p class="scp-sect-sub">${escapeHtml(sub)}</p>` : "");

  // `aside` is a control that belongs to this block - the game log's season
  // selector is the one that uses it. On the heading's row rather than above
  // it, because a row of eleven years standing on its own line reads as a
  // section of the page; on the heading's row it reads as this block's filter,
  // which is what it is.
  if (!aside) return `<div class="scp-sect">${text_}</div>`;
  return (
    `<div class="scp-sect scp-sect--row">` +
    `<div class="scp-sect-text">${text_}</div>${aside}</div>`
  );
}

/**
 * A question-and-answer block, with FAQPage markup on the standalone page.
 *
 * Shared by the Stats and Injury tabs because both answer the same SHAPE of
 * query - a question somebody typed, answered from numbers already rendered
 * above it - and two copies would drift on the one thing that matters here:
 * the schema, and whether it is safe to emit.
 *
 * Embedded, WordPress owns the document's schema and a second FAQPage inside
 * the host's article is a conflict rather than an enhancement - the same reason
 * this mount adds no canonical and no H1. So the fragment ships the same
 * questions as INERT DATA instead, and statchasers-player.php lifts them into
 * Rank Math's graph: the markup then arrives inside the one <script> the page
 * already prints, rather than as a second one competing with it.
 *
 * Data rather than the plugin re-reading the rendered HTML, because by then the
 * answers have been escaped for display and putting them back together means
 * un-escaping prose in PHP to feed a crawler. This is the array the answers
 * were built from, which is the thing the schema is supposed to be about.
 */
function renderFaq(
  items: Array<{ question: string; answer: string }>,
  options: PlayerRenderOptions,
  heading: string,
  // Printed after `items` in the same block but left out of the FAQPage
  // node and faqSink: adding questions to the schema is an SEO change, which
  // mak approves separately.
  visibleOnly: Array<{ question: string; answer: string }> = [],
): string {
  if (items.length === 0 && visibleOnly.length === 0) return "";

  /*
   * One question, one fold - the shape the team hubs use.
   *
   * These blocks were four questions with all four answers permanently open,
   * which is a wall of restated prose at the bottom of a tab that has already
   * said all of it in numbers. Folded, the QUESTIONS are the index: a reader
   * scanning for the one they arrived with sees every question at once and
   * opens the single answer they came for.
   *
   * Shut by default, and per question rather than one fold around the block -
   * a single fold hides the questions too, which is the opposite of what an
   * index is for. The answers stay in the DOM either way: a crawler reads the
   * DOM rather than the open state, and the FAQPage node below is built from
   * the same list, so nothing about the structured data depends on this.
   *
   * <h4> inside the <summary> so the questions keep their place in the page
   * outline; the summary is the control, the heading is still the heading.
   */
  const body = [...items.map((entry) => ({ entry, cls: "" })), ...visibleOnly.map((entry) => ({ entry, cls: " is-visible-only" }))]
    .map(
      ({ entry, cls }) =>
        `<details class="scp-faq-item${cls}">` +
        `<summary class="scp-faq-q-row">` +
        `<h4 class="scp-faq-q">${escapeHtml(entry.question)}</h4>` +
        `</summary>` +
        `<p class="scp-faq-a">${escapeHtml(entry.answer)}</p>` +
        `</details>`,
    )
    .join("");

  // Handed up to the page when it is collecting: four blocks each printing
  // their own node put four FAQPages on the unsectioned profile, and a document
  // with two is the case that gets the whole lot ignored rather than merged.
  // sectionHead rather than a plain h3: on the team hubs this block closes the
  // page under the same gold-ruled heading its other sections carry, and on
  // the Stats tab here every sibling had the rule while the questions did not.
  // Same level in the outline, same device on the screen.
  const head = sectionHead(heading);

  if (options.faqSink || items.length === 0) {
    options.faqSink?.push(...items);
    return head + `<div class="scp-faq">${body}</div>`;
  }

  const schema = options.embed
    ? `<script type="application/json" class="scp-faq-data">` +
      escapeJsonLd(
        JSON.stringify(
          items.map((entry) => ({ q: entry.question, a: entry.answer })),
        ),
      ) +
      `</script>`
    : `<script type="application/ld+json">` +
      escapeJsonLd(
        JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: items.map((entry) => ({
            "@type": "Question",
            name: entry.question,
            acceptedAnswer: { "@type": "Answer", text: entry.answer },
          })),
        }),
      ) +
      `</script>`;

  return head + `<div class="scp-faq">${body}</div>` + schema;
}

/**
 * An external link into the main StatChasers site.
 *
 * `target="_top"` for the reason given in team-render.ts: in the legacy iframe
 * mount a plain link loads the destination inside the frame. A no-op when the
 * markup is mounted directly, which is how it is mounted now.
 */
function siteLink(href: string | null, label: string, className: string): string {
  if (!href) return "";
  return `<a class="${className}" href="${escapeHtml(href)}" target="_top">${escapeHtml(label)}</a>`;
}

/** One decimal, or the dash. Never "0.0" standing in for "we don't know". */
function num(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  return value.toFixed(digits);
}

/** A whole number with thousands separators, locale-free. */
function whole(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  const rounded = Math.round(value);
  return `${rounded < 0 ? "-" : ""}${String(Math.abs(rounded)).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ",",
  )}`;
}

function pct(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  return `${value.toFixed(digits)}%`;
}

/** "1st", "2nd", "23rd". */
function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const suffix = ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

/* --------------------------------------------------------------- the palette */

/** The weekly-points series and its trailing average. Two hues, validated. */
const SERIES_POINTS = "#2f63a8";
const SERIES_AVERAGE = "#a87905";

/* ------------------------------------------------------------ stat tiles */

interface Tile {
  label: string;
  value: string;
  sub?: string;
  /** A one-word verdict shown under the value, e.g. "Top tier". */
  note?: string;
}

/**
 * A stat tile, which is deliberately not a chart.
 *
 * Four numbers with no shared scale and no ordering between them are a set of
 * facts, not a series - drawing them as bars would invite a comparison that
 * means nothing. See the form heuristic: a single headline number is a tile.
 */
function renderTiles(tiles: Tile[], extraClass = ""): string {
  const kept = tiles.filter((t) => t.value !== DASH);
  if (kept.length === 0) return "";
  const cells = kept
    .map(
      (tile) =>
        `<div class="scp-tile">` +
        `<p class="scp-tile-label">${escapeHtml(tile.label)}</p>` +
        `<p class="scp-tile-value">${escapeHtml(tile.value)}</p>` +
        (tile.note ? `<p class="scp-tile-note">${escapeHtml(tile.note)}</p>` : "") +
        (tile.sub ? `<p class="scp-tile-sub">${escapeHtml(tile.sub)}</p>` : "") +
        `</div>`,
    )
    .join("");
  return `<div class="scp-tiles${extraClass ? ` ${extraClass}` : ""}">${cells}</div>`;
}

/** One figure on a stat rail: the number, what it is, and what it is of. */
interface RailCell {
  value: string;
  label: string;
  /** The qualifier under the label - "4 seasons", "in 2025", "Moderate". */
  sub?: string;
  /** "gold" paints this one figure. Reserved for fantasy and the live season. */
  accent?: string;
  /**
   * Set on the figures that lead the rail, which are drawn larger.
   *
   * Asymmetry on purpose: six cells at one size is a list, and a reader has to
   * pick the important one out of it themselves. Two leading and four
   * following is a sentence.
   */
  lead?: boolean;
}

/**
 * A stat rail: one row of figures, divided by hairlines and nothing else.
 *
 * The Stats tab is built from three component languages and no fourth - RAILS
 * (this), DATA PANELS (the passing and fantasy cards) and TABLES. Before it
 * had one language, the rounded card, repeated down the page until the bottom
 * half read as a dashboard: career rates, finish history and career bests were
 * three consecutive rows of four boxes that differed only in their contents.
 *
 * So the four figure-rows on this page are all this component. Repetition on
 * purpose reads as a system; repetition by default reads as a template, and
 * the difference is whether the repeated thing is doing the same JOB each
 * time. Here it always is: four or seven numbers that belong to one record.
 *
 *   hero   bordered and filled, larger figures. The season strip only - it is
 *          the answer to the query and the one rail that is a container.
 *   open   no box at all. A rule above, hairlines between, and the section
 *          heading doing the work the border used to.
 */
function renderRail(cells: RailCell[], variant: "hero" | "open" = "open"): string {
  const kept = cells.filter((cell) => cell.value !== DASH || variant === "open");
  if (kept.length === 0) return "";
  const leads = kept.filter((cell) => cell.lead).length;

  return (
    `<div class="scp-rail" data-variant="${variant}"` +
    ` data-count="${Math.min(kept.length, 8)}"` +
    (leads ? ` data-leads="${leads}"` : "") +
    `>` +
    kept
      .map(
        (cell) =>
          `<div class="scp-rail-cell"${
            cell.accent ? ` data-accent="${escapeHtml(cell.accent)}"` : ""
          }${cell.lead ? ` data-lead="1"` : ""}>` +
          `<p class="scp-rail-value">${escapeHtml(cell.value)}</p>` +
          `<p class="scp-rail-label">${escapeHtml(cell.label)}</p>` +
          (cell.sub ? `<p class="scp-rail-sub">${escapeHtml(cell.sub)}</p>` : "") +
          `</div>`,
      )
      .join("") +
    `</div>`
  );
}

/* ------------------------------------------------------------- chart marks */

/* The percentile METER - a filled bar read left to right - is gone, and so is
   the marker-on-a-track that briefly replaced it. A filled bar states a
   proportion ("73% complete") and a percentile is a position in a distribution
   rather than a proportion of one, so neither mark was saying the right thing.
   The reading in words with the rate and the ordinal under it replaced both,
   and that block (the Stats tab's Efficiency Profile) was removed in turn on
   2026-09-30. */

interface SparkPoint {
  week: number;
  opp: string;
  value: number;
}

/**
 * Weekly points with a three-game trailing average over them.
 *
 * Two series, so it carries a legend - identity is never color alone. The
 * points line is 2px and the average is drawn beneath it; markers sit at 8px so
 * they are a real hit target for the tooltip client/player.ts attaches, and the
 * <title> on each keeps the bare SVG readable with no script at all.
 */
function renderSparkline(
  points: SparkPoint[],
  average: number[],
  options: { averageLabel?: string } = {},
): string {
  if (points.length < 2) return "";

  // Two series, so the second one is named rather than left to the reader: the
  // Overview's chart smooths the same points over three games and this tab's
  // draws a flat season average, and a legend reading "average" on both would
  // be one word doing two different jobs.
  const averageLabel = options.averageLabel ?? "3-game average";

  // A fixed aspect ratio, scaled uniformly by the stylesheet. The obvious
  // alternative - preserveAspectRatio="none" plus a fixed CSS height - stretches
  // the drawing horizontally, which turns a 2px stroke into a 2px-by-nx one and
  // every circular marker into an ellipse.
  const width = 640;
  const height = 180;
  const padX = 34;
  const padTop = 16;
  const padBottom = 26;
  const max = Math.max(...points.map((p) => p.value), 1);
  const stepX = (width - padX * 2) / (points.length - 1);

  const x = (i: number) => padX + i * stepX;
  const y = (v: number) => height - padBottom - (v / max) * (height - padTop - padBottom);

  const path = (values: number[]) =>
    values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");

  const markers = points
    .map(
      (point, i) =>
        `<circle class="scp-spark-dot" cx="${x(i).toFixed(1)}" cy="${y(point.value).toFixed(1)}"` +
        ` r="4" fill="${SERIES_POINTS}" data-week="${point.week}"` +
        ` data-value="${escapeHtml(point.value.toFixed(1))}" data-opp="${escapeHtml(point.opp)}">` +
        `<title>${escapeHtml(
          `Week ${point.week} vs ${point.opp}: ${point.value.toFixed(1)} pts`,
        )}</title></circle>`,
    )
    .join("");

  // Two reference lines and nothing more: the zero baseline the bars are read
  // against, and the season high. A full gridded axis would be more chart than
  // five numbers deserve, and no reference at all leaves a line whose height
  // means nothing.
  const baselineY = height - padBottom;
  const maxY = y(max);
  const axis =
    `<line class="scp-spark-axis" x1="${padX}" y1="${baselineY}" x2="${width - padX}"` +
    ` y2="${baselineY}" />` +
    `<line class="scp-spark-grid" x1="${padX}" y1="${maxY.toFixed(1)}"` +
    ` x2="${width - padX}" y2="${maxY.toFixed(1)}" stroke-dasharray="3 4" />` +
    `<text class="scp-spark-tick" x="${padX - 8}" y="${(maxY + 4).toFixed(1)}"` +
    ` text-anchor="end">${escapeHtml(max.toFixed(0))}</text>` +
    `<text class="scp-spark-tick" x="${padX - 8}" y="${baselineY + 4}"` +
    ` text-anchor="end">0</text>`;

  // Week numbers under the first, last and best points only - a label on every
  // point is noise, and these three are the ones a reader looks for.
  const bestIndex = points.reduce(
    (best, point, i) => (point.value > points[best]!.value ? i : best),
    0,
  );
  const ticks = points
    .map((point, i) =>
      i === 0 || i === points.length - 1 || i === bestIndex
        ? `<text class="scp-spark-tick" x="${x(i).toFixed(1)}" y="${height - 8}"` +
          ` text-anchor="middle">${escapeHtml(`W${point.week}`)}</text>`
        : "",
    )
    .join("");

  return (
    `<figure class="scp-figure">` +
    `<svg class="scp-spark" viewBox="0 0 ${width} ${height}"` +
    ` role="img" aria-label="${escapeHtml(
      `Weekly fantasy points with ${averageLabel.toLowerCase()} over them`,
    )}">` +
    axis +
    ticks +
    `<path d="${path(average)}" fill="none" stroke="${SERIES_AVERAGE}" stroke-width="2"` +
    ` stroke-linecap="round" stroke-linejoin="round" />` +
    `<path d="${path(points.map((p) => p.value))}" fill="none" stroke="${SERIES_POINTS}"` +
    ` stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />` +
    markers +
    `</svg>` +
    `<figcaption class="scp-figcaption">` +
    `<ul class="scp-legend">` +
    `<li class="scp-legend-item"><span class="scp-legend-swatch" aria-hidden="true"` +
    styleAttr([`background:${SERIES_POINTS}`]) +
    `></span><span class="scp-legend-label">Weekly points</span></li>` +
    `<li class="scp-legend-item"><span class="scp-legend-swatch" aria-hidden="true"` +
    styleAttr([`background:${SERIES_AVERAGE}`]) +
    `></span><span class="scp-legend-label">${escapeHtml(averageLabel)}</span></li>` +
    `</ul>` +
    `</figcaption>` +
    `</figure>`
  );
}

/* ----------------------------------------------------------------- search */

/*
 * The player search, above the header.
 *
 * Every page on this site is one player deep: a reader who arrives on Ja'Marr
 * Chase's page and wants Tee Higgins has, until now, had to leave through a
 * link that happens to mention him. This is the way from any player page to
 * any other, and it sits above the header because that is where a reader looks
 * for it - before the page's own identity, not buried inside it.
 *
 * Three things it deliberately is NOT:
 *
 *   NOT a <form>. A form with no action submits to the current URL, so one
 *   Enter keypress would reload the page with a query string on it and mint a
 *   second address for the same content - the exact duplication the canonical
 *   work exists to prevent. Same call, and the same reason, as the news tool's
 *   filters. Enter opens the highlighted player instead.
 *
 *   NOT a fetch. The whole roster is inlined below; see playerSearchIndex().
 *   Nothing here talks to the network, which is what lets the same markup work
 *   printed into a WordPress page on another origin.
 *
 *   NOT shipped visible. It ships `hidden` and client/player-search.ts reveals
 *   it, because without that script it is a box that swallows typing and does
 *   nothing - worse than no box at all. The rest of the page is complete
 *   without script and stays that way: this is navigation, not content, and it
 *   is the only part of the page that is allowed to depend on the bundle.
 *
 * The links the results point at are built from the same prefix and query as
 * every other internal link on the page, so inside WordPress the results go to
 * statchasers.com/nfl/players/<slug>/ rather than back to the bare tool.
 *
 * ONE EXCEPTION, and it is the index's: a club row there is not a destination.
 * The index IS the roster, grouped by club, so a reader who picks the Chiefs
 * out of this box has asked to be shown the Chiefs' players - not to be taken
 * off the page they were reading to a hub that answers a different question.
 * `clubsFilter` is what says so, the index is the only caller that passes it,
 * and everything it changes happens in client/player-search.ts: the club row
 * becomes a button and the pick is handed to the directory beside it. A club
 * is still a destination from a profile, where there is no roster to filter,
 * and the card heading on the index is still a link to the hub either way.
 */
function renderPlayerSearch(
  options: PlayerRenderOptions,
  mode: { clubsFilter?: boolean } = {},
): string {
  const index = playerSearchIndex();
  // No roster, no search. A dictionary that failed to load is already a
  // degraded page; it should not also carry a control that can match nothing.
  if (index.rows.length === 0) return "";

  const prefix = options.playerPathPrefix ?? "/player/";
  const teamPrefix = options.teamPathPrefix ?? "/team/";
  const query = options.linkQuery ?? "";

  return (
    `<div class="scp-search" data-scp-search` +
    ` data-scp-prefix="${escapeHtml(prefix)}"` +
    // The clubs in the island are destinations too, and they live under a
    // different path - on WordPress, under a different page entirely.
    ` data-scp-team-prefix="${escapeHtml(teamPrefix)}"` +
    // Printed only by the index, read only by the client, and meaningless
    // without a directory in the same root to hand the pick to - which is why
    // the client checks for one rather than trusting this on its own.
    (mode.clubsFilter ? ` data-scp-club-filter` : "") +
    ` data-scp-query="${escapeHtml(query)}" hidden>` +
    // The label wraps the control, so the two need no for/id pair - which
    // matters here because a WordPress page may print two of these fragments
    // and a fixed id would then be in the document twice. Every id this widget
    // needs for its ARIA relations is minted per root by the client.
    `<label class="scp-search-field">` +
    `<span class="scp-sr">Search players and teams</span>` +
    `<svg class="scp-search-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" />` +
    `</svg>` +
    `<input class="scp-search-input" type="search" autocomplete="off"` +
    ` spellcheck="false" placeholder="Search any NFL player or team" />` +
    `</label>` +
    `<div class="scp-search-panel" hidden><div class="scp-search-list"></div></div>` +
    // How many matches there are, for a reader who cannot see the list appear.
    // Polite, never assertive: it must not interrupt the typing that caused it.
    `<p class="scp-sr" role="status" data-scp-search-status></p>` +
    // Not a <template>: the client reads this with textContent and parses it
    // once, and a JSON island is inert markup the browser never executes.
    // escapeJsonLd is what keeps a "</script" inside a name from ending it.
    `<script type="application/json" data-scp-roster>` +
    // `shots` is where the client builds a result's portrait URL from: this
    // server's versioned headshot route, absolute for the page's origin.
    escapeJsonLd(JSON.stringify({ ...index, shots: assetUrl("/news-image/player/") })) +
    `</script>` +
    `</div>`
  );
}

/* ------------------------------------------------------------- section nav */

interface Section {
  id: string;
  label: string;
  html: string;
}

/**
 * A tab that ends footer, then the peers rail, then its FAQ (mak, 2026-09-30:
 * Stats, Outlook and Injury). On the all-tabs page the panel carries its own
 * copy of the rail, as the Overview does; on a section page the panel is
 * `body` and the rest follows it, with the way back to the profile under the
 * footer.
 */
interface TabParts {
  body: string;
  foot: string;
  faq: string;
}

/**
 * The tab strip.
 *
 * Plain anchors switched by `:target` in CSS, exactly as the team hub does it:
 * every tab's content is in the initial HTML, the strip works with scripting
 * disabled, and the only URL state it can produce is a `#hash` - not a second
 * crawlable address for the same page. The tab roles and arrow-key behavior
 * are added by client/player.ts, which can deliver what those roles promise.
 */
/**
 * The section bar.
 *
 * Links to the sections' own addresses, not to `#hash` - the same change the
 * team hub's strip took, for the same reason. Seven section URLs per profile,
 * each with its own title, description and canonical, and nothing on the site
 * pointing at any of them is several thousand orphaned pages once the roster
 * is multiplied out.
 *
 * With scripting off a tab is a link and loads that page. With it,
 * client/player.ts switches the panel in place and pushes the same URL, so
 * nothing reloads and the address still names what is on screen.
 *
 * `data-scp-panel-id` is which panel to show, since the href no longer says.
 * `data-scp-heading` and `data-scp-lead` are what the H1 and standfirst above
 * the fragment should read once it has - those belong to the host page, so the
 * bundle cannot derive them and the server has to hand them over.
 */
function renderNav(
  sections: Section[],
  data: PlayerPageData,
  options: PlayerRenderOptions,
  activeId?: string,
): string {
  if (sections.length < 2) return "";

  const prefix = options.playerPathPrefix ?? "/player/";
  const active = activeId ?? sections[0]?.id;

  const items = sections
    .map((section) => {
      // The Overview is the profile: its address is the profile's own and its
      // heading is the profile's. `/overview/` only 301s back here.
      const isProfile = section.id === "overview";
      const heading = isProfile
        ? profileHeading(data.player.name)
        : (sectionHeading(data.player.name, section.id, data.season) ??
          data.player.name);
      const lead = playerPageMeta(data, "", isProfile ? undefined : section.id)
        .description;
      // The document title the tab's own address carries on WordPress, set by
      // the bundle before it pushes that address (see enhance.ts). The profile's
      // is the one the page builder stores; a section's is playerPageMeta's.
      // No " | StatChasers" on either since 2026-10-08.
      const title = playerPageMeta(data, "", isProfile ? undefined : section.id).title;
      const href = isProfile
        ? `${prefix}${data.player.slug}/`
        : `${prefix}${data.player.slug}/${section.id}/`;

      return (
        `<li><a class="scp-nav-link${section.id === active ? " is-active" : ""}"` +
        ` id="${escapeHtml(section.id)}-tab"` +
        ` href="${escapeHtml(href)}"` +
        ` data-scp-panel-id="${escapeHtml(section.id)}"` +
        ` data-scp-heading="${escapeHtml(heading)}"` +
        ` data-scp-lead="${escapeHtml(lead)}"` +
        // The header H1's second line for this tab; see headerKind().
        ` data-scp-kind="${escapeHtml(headerKind(data, section.id))}"` +
        ` data-sc-title="${escapeHtml(title)}"` +
        `>${escapeHtml(section.label)}</a></li>`
      );
    })
    .join("");

  return (
    `<nav class="scp-nav" aria-label="Player sections" data-scp-nav>` +
    `<ul class="scp-nav-list">${items}</ul>` +
    `</nav>`
  );
}

/**
 * The scoring-format switch.
 *
 * Real links to real URLs, because the format genuinely changes every number on
 * the page - it is not tool state to be hidden in a hash. `rel="nofollow"` and
 * the canonical on the PPR URL keep the three variants from becoming three
 * competing pages; PPR is the default and the one address that ranks.
 */
/**
 * This page's own URL, with one piece of its state changed.
 *
 * Every control that is a real link - the game log's season selector, and the
 * scoring toggle before the control bar traded it for the start/sit button -
 * builds its href here, so none of them can drop the state the others own.
 * Assembling them by hand is how `?format=half` used to lose `?embed=1`, which
 * silently unframed the page it was rendered into. The format is still carried
 * through every link this builds: nothing on the page changes it any more, but
 * a reader who arrived on `?format=half` must not be walked back to PPR by
 * pinning a season.
 *
 * Only the parameters this page actually carries are emitted, and each is
 * omitted at its default: the PPR profile of the active season is the bare
 * slug, which is the address the canonical points at.
 */
function pageUrl(
  data: PlayerPageData,
  options: PlayerRenderOptions,
  changes: { format?: ScoringFormat; log?: number; hash?: string } = {},
): string {
  const prefix = options.playerPathPrefix ?? "/player/";
  const params = new URLSearchParams();

  if ((options.linkQuery ?? "").includes("embed=1")) params.set("embed", "1");

  const format = changes.format ?? data.format;
  if (format !== "ppr") params.set("format", format);

  const log = changes.log ?? data.logSeason;
  if (log !== data.season) params.set("log", String(log));

  const query = params.toString();
  // The section is a path segment now, not a parameter. It used to be
  // `?section=`, which is still what the WordPress plugin fetches a fragment
  // with, but it is no longer an address - so a control on a section page has
  // to rebuild the section's own URL or following it would land the reader back
  // on the full profile with their format change and none of their place.
  const section = options.section ? `${options.section}/` : "";
  // A control inside a panel on the FULL profile has to name that panel, or
  // following it reopens the page on the first tab - changing the season on the
  // game log and landing on Overview. A section URL is already that page.
  const hash = !options.section && changes.hash ? `#${changes.hash}` : "";
  return `${prefix}${data.player.slug}/${section}${query ? `?${query}` : ""}${hash}`;
}

/* --------------------------------------------------------------- overview */

/* ----------------------------------------------------------------- overview */

/**
 * The Overview tab: what the numbers mean.
 *
 * It used to be a third arrangement of the same figures - 2026 totals, career
 * points per game, season-end finishes, efficiency rates, best week - all of
 * which now live on Stats or in the Game Log, where somebody asking "what
 * happened" will look for them. Three tabs showing the same numbers in three
 * layouts gave none of them a reason to exist.
 *
 * So the split is:
 *
 *   "What happened?"     -> Stats, Game Log.
 *   "What does it mean?" -> here.
 *
 * "277 passing yards" is a Stats fact; "strong passing volume" is this page.
 * Every phrase on this tab is still derived from a measured number - the
 * thresholds are in lib/player/fantasy-read.ts - and the numbers themselves
 * appear only as the evidence under a reading, never as the point.
 */

/**
 * The snapshot: tier, rate, role and direction, then one assembled sentence.
 *
 * Four readings rather than four totals. The sentence beneath is built from
 * clauses in fantasy-read.ts rather than written, so it cannot claim anything
 * the percentiles do not support, and it drops clauses instead of hedging when
 * the inputs are missing.
 */
/**
 * "Bijan Robinson is the RB3 in PPR this season (21.4 points per game) and
 * faces the Buccaneers in Week 6." - the hub's answer, near the top, in the
 * server HTML (mak, 2026-10-09). The rank phrase links to the Outlook tab and
 * the fixture to his start/sit page. A player on last season's page gets
 * last season's finish and this season's opener; a player with no rank gets
 * nothing rather than a sentence with a hole in it.
 */
function renderHubAnswer(data: PlayerPageData, options: PlayerRenderOptions): string {
  const pos = data.player.position ?? "";
  const rank = currentRank(data);
  const ppg = seasonPpg(data);
  // ppg > 0 for the same reason profileMeta() asks it: "WR162 (0.0 points
  // per game)" is a true sentence nobody wants under a heading.
  if (!pos || rank === null || ppg === null || ppg <= 0) return "";
  const scoring = SCORING_SHORT[data.format];
  const next = nextGame(data);
  const outlook = sectionHref(data, options, "outlook");
  const startSit = `${options.startSitBase ?? STARTSIT_BASE}${encodeURIComponent(data.player.slug)}`;
  const link = (href: string | null, text: string) =>
    href ? `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>` : escapeHtml(text);

  const rate = `(${oneDecimal(ppg)} points per game)`;
  const standing =
    data.season === data.leagueSeason
      ? `is the ${link(outlook, `${pos}${rank} in ${scoring} this season`)} ${rate}`
      : `finished ${data.season} as the ${link(outlook, `${pos}${rank} in ${scoring}`)} ${rate}`;
  const fixture = next
    ? ` and ${data.season === data.leagueSeason ? "faces" : `opens ${data.leagueSeason} against`} ` +
      link(startSit, `the ${next.opponent?.nickname ?? next.opponentName} in Week ${next.week}`)
    : "";
  // No fixture to hang the start/sit link on: it stands after the sentence.
  const trail = next ? "" : ` ${link(startSit, "Start/sit call")}.`;
  return `<p class="scp-answer">${escapeHtml(data.player.name)} ${standing}${fixture}.${trail}</p>`;
}

function renderFantasySnapshot(data: PlayerPageData, options: PlayerRenderOptions): string {
  const { stats, player, outlook } = data;
  if (!stats || stats.gamesPlayed === 0) return "";

  const badge = finishBadge(data.seasonRank, player.position);

  const reads: Array<{ label: string; value: string; mod: string }> = [];

  // Only when there IS a ranked finish. Without one this cell fell back to the
  // scoring rate, which is the next cell along - the same number twice under
  // two labels, which is worse than three cells.
  if (badge) {
    reads.push({
      label: "Producing as",
      value: `${player.position ?? ""}${data.seasonRank} ${DOT} ${badge.label}`,
      mod: badge.tier,
    });
  }

  reads.push(
    {
      label: "Scoring rate",
      value: `${stats.ppg.toFixed(1)} PPG`,
      mod: "",
    },
    {
      label: "Played",
      value: `${stats.gamesPlayed} game${stats.gamesPlayed === 1 ? "" : "s"}`,
      mod: "",
    },
    { label: "Role", value: outlook.roleLabel, mod: "" },
    { label: "Trend", value: outlook.formLabel, mod: outlook.formDirection },
  );

  return (
    `<section class="scp-read-hero">` +
    // The page's section heading, the same one the Outlook tab and the Stats
    // tab open on. This was an 11px gold eyebrow, which is a label worn over a
    // display line - there is no display line here, only the strip, so the
    // eyebrow was the tab's <h2> set six sizes below every other heading.
    h2(`${data.season} Fantasy Snapshot`) +
    // The answer-first sentence (mak, 2026-10-09): rank, rate and the next
    // game, linked to the start/sit page and the Outlook tab.
    renderHubAnswer(data, options) +
    `<div class="scp-read-grid">` +
    reads
      .map(
        // The first reading is the page's answer, and it is set larger than the
        // three beside it. A strip of four identically weighted cells has no
        // winner, and a scouting sheet is read from its headline outwards.
        // Label first in the MARKUP and second on screen (the cell places the
        // two rows) - "Scoring rate, 16.5 PPG" is the order it has to be said
        // in, and the reverse of the order it reads best in.
        (read, i) =>
          `<div class="scp-read-cell" data-mod="${escapeHtml(read.mod)}"` +
          `${i === 0 ? ` data-lead="1"` : ""}>` +
          `<p class="scp-read-label">${escapeHtml(read.label)}</p>` +
          `<p class="scp-read-value">${escapeHtml(read.value)}</p>` +
          `</div>`,
      )
      .join("") +
    `</div>` +
    `</section>`
  );
}

/**
 * Role Direction: the usage metrics that define this position, recent vs season.
 *
 * Usage rather than production, deliberately. Points are the outcome and
 * touches are the input, and a role that is growing shows up in the input
 * first - which is the only reason a "trending" section is worth printing at
 * all. Metrics marked `context` are the team's behavior rather than the
 * player's, and are labeled as such instead of being scored as their doing.
 */
function renderRoleDirection(data: PlayerPageData): string {
  const played = data.gameLog.filter((e) => e.game_status === "active");
  if (played.length < 4) return "";

  const metrics = positionMomentumMetrics(data.player.position);
  if (metrics.length === 0) return "";

  const rows = metrics
    .map((metric) => {
      const season = metricAverage(played, metric.key);
      const recent = metricAverage(played, metric.key, 4);
      if (season === 0 && recent === 0) return "";

      const delta = season > 0 ? ((recent - season) / season) * 100 : 0;
      const direction = delta > 8 ? "up" : delta < -8 ? "down" : "flat";
      const format = (value: number) =>
        metric.pct ? pct(value, 1) : num(value);

      return (
        `<tr>` +
        `<th scope="row">${escapeHtml(metric.label)}` +
        (metric.context
          ? `<span class="scp-ctx" title="Team context, not this player's own usage">team</span>`
          : "") +
        `</th>` +
        `<td>${escapeHtml(format(season))}</td>` +
        `<td>${escapeHtml(format(recent))}</td>` +
        `<td class="scp-delta" data-dir="${direction}">${escapeHtml(
          `${delta > 0 ? "+" : ""}${delta.toFixed(0)}%`,
        )}</td>` +
        `</tr>`
      );
    })
    .join("");

  if (!rows) return "";

  return (
    h3("Role Direction") +
    `<table class="scp-table scp-table--role">` +
    `<caption class="scp-caption">Season average against the last four games played.</caption>` +
    `<thead><tr><th scope="col">Usage</th><th scope="col">Season</th>` +
    `<th scope="col">Last 4</th><th scope="col">Change</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>`
  );
}

/* --------------------------------------------------------------------- bio */

function renderList(items: unknown, className: string): string {
  if (!Array.isArray(items) || items.length === 0) return "";
  const rows = items
    .filter((item): item is string => typeof item === "string" && item.trim() !== "")
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  return rows ? `<ul class="${className}">${rows}</ul>` : "";
}

/**
 * The bio, which is generated from the record rather than written.
 *
 * `data/player/bios.json` is produced by a deterministic template over the game
 * logs and the draft table - no coach names, no adjectives nobody measured, no
 * claims the numbers do not support. It is rendered defensively because it is
 * the one data file whose shape is free-form.
 */
/* ------------------------------------------------------------------ bio */

/*
 * The Bio tab - a player dossier, and nothing else.
 *
 * Every other tab here answers a fantasy question. This one answers "who is
 * he?", and the most valuable thing about it is what it leaves out: no points
 * per game, no efficiency, no start/sit, no injury risk. A page that mixes
 * "6 feet 4 inches" with "TD-dependent ceiling" is topically two pages and
 * ranks as well as neither.
 *
 * Three blocks, in the order the question gets answered:
 *
 *   1. a short factual story - who he is, in a paragraph
 *   2. the career timeline - every club, with its years and its badge
 *   3. the questions, answered directly
 *
 * The labeled fact grid - age, height, weight, born, college, high school,
 * experience, draft - used to sit between one and two, and every one of those
 * facts is a clause of the paragraph above it. "Born on December 11, 1992,
 * Brissett attended William T. Dwyer (FL) and played college football at North
 * Carolina State" says the same thing as three cells of the grid, in the order
 * a person would say it. The grid is gone; bioProfile.facts is still derived
 * for anything else that wants it.
 *
 * The draft has no block of its own either: the paragraph names the year, the
 * round, the pick and the club that made it, so a dossier under "NFL draft"
 * was the same five facts a third time.
 *
 * All of it is derived in lib/player/bio.ts and none of it is written, so it
 * stays true through a trade, a birthday or a new season with nobody rewriting
 * a paragraph. What is not in the data is not on the page: there is no hometown
 * row because the upstream source has no hometown for anybody.
 */

/**
 * The career timeline.
 *
 * A vertical rail with a team logo per stop, rather than a stack of cards:
 * this is the one block on the player pages that is genuinely a sequence, and
 * drawing it as a sequence is what stops Bio looking like every other tab. The
 * college sits at the top with no years - we know where a player went, not
 * when, and a made-up range would be worse than none.
 *
 * Each stop is a full-width row, not a run of inline spans hugging the rail.
 * The rail version put the year, the crest and the club name in the left
 * quarter of the column and left the other three quarters blank, which reads
 * as a sidebar that has lost its page. The row has three zones instead, and
 * each one earns its place:
 *
 *   YEARS   the range, tabular, so the column scans as a column
 *   CLUB    crest, club name, and the badge for the stop that is current
 *   COUNT   how long it lasted - right-aligned, against the far edge
 *
 * and under the club, when there is one, the line that says what kind of stop
 * it was: the draft that started the career, or the return to a club already
 * on the list. That is the whole difference between a list of logos and a
 * career: a reader should be able to see where he was taken, how long each
 * stop ran, and where he is now, without counting years off a range.
 */
function renderCareerTimeline(data: PlayerPageData): string {
  const { stints, college } = data.bioProfile;
  if (stints.length === 0) return "";

  // The crest cell is emitted empty rather than skipped: it is a grid column,
  // and a college stop that drops it would pull its name out of the line every
  // club below it sits on.
  const collegeStop = college
    ? `<li class="scp-stint" data-kind="college">` +
      `<span class="scp-stint-mark" aria-hidden="true"></span>` +
      `<span class="scp-stint-years">College</span>` +
      `<span class="scp-stint-crest"></span>` +
      `<span class="scp-stint-body">` +
      `<span class="scp-stint-name">${escapeHtml(college)}</span>` +
      `</span></li>`
    : "";

  const stops = stints
    .map((stint) => {
      const logo = stint.team
        ? `<img class="scp-stint-logo" src="${escapeHtml(stint.team.logo)}" alt=""` +
          ` width="28" height="28" loading="lazy" decoding="async" />`
        : "";

      // The second line, when the stop has something to say beyond its years.
      // Both halves are rare - most stints are a club and a date range - so
      // the line is emitted only when one of them is there, never as an empty
      // row of air under every stop.
      const sub = [stint.note, stint.detail].filter(Boolean).join(" · ");

      return (
        `<li class="scp-stint" data-kind="nfl"${stint.current ? ` data-current="1"` : ""}>` +
        `<span class="scp-stint-mark" aria-hidden="true"></span>` +
        `<span class="scp-stint-years">${escapeHtml(stint.years)}</span>` +
        `<span class="scp-stint-crest">${logo}</span>` +
        `<span class="scp-stint-body">` +
        `<span class="scp-stint-head">` +
        `<span class="scp-stint-name">${escapeHtml(stint.name)}</span>` +
        (stint.current
          ? `<span class="scp-stint-badge">Current team</span>`
          : "") +
        `</span>` +
        (sub ? `<span class="scp-stint-sub">${escapeHtml(sub)}</span>` : "") +
        `</span>` +
        `<span class="scp-stint-count">${escapeHtml(
          stint.seasons === 1 ? "1 season" : `${stint.seasons} seasons`,
        )}</span>` +
        `</li>`
      );
    })
    .join("");

  return (
    h3("Career Timeline") +
    `<ol class="scp-stints">${collegeStop}${stops}</ol>`
  );
}

/** The short factual story. Generated, so it cannot go stale. */
function renderBioNarrative(data: PlayerPageData): string {
  const paragraphs = data.bioProfile.narrative;
  if (paragraphs.length === 0) return "";

  // No heading over it. "About <name>" under "<name> bio" is the same words
  // twice, and the paragraph beneath is plainly about the player.
  return (
    `<div class="scp-bio">` +
    `<p class="scp-para">${escapeHtml(paragraphs.join(" "))}</p>` +
    `</div>`
  );
}

function renderBio(
  data: PlayerPageData,
  options: PlayerRenderOptions,
): TabParts | null {
  if (data.bioProfile.empty) return null;

  // mak's Bio spec (2026-09-30) replaces the old narrative and career
  // timeline: two bios and two timelines on one page confuse readers and
  // split the page's subject. A player with no fact record keeps the old ones.
  const spec = renderBioTab(data, options);
  const narrative = spec ? "" : renderBioNarrative(data);
  const timeline = spec ? "" : renderCareerTimeline(data);
  // The Bio tab's FAQ owns the evergreen entity searches (faq-engine.ts).
  const statsHref = tabHref(data, options, "stats");
  const pool = data.bioProfile.faq.map((f) => ({
    key: f.key,
    q: f.question,
    a: f.answer,
    link: f.key === "experience" || f.key === "teams" ? { href: statsHref, text: "View his career statistics." } : null,
  }));
  // Spec 2.8 question 7 (approved by mak 2026-09-30), asked only when true.
  // "Member of" the roster, never "played in" the game: the source is the
  // Super Bowl week's roster (bio-tab-data.ts).
  const rings = data.bioPage?.superBowls ?? [];
  if (rings.length) {
    const each = rings.map((b) => `the ${b.team} team that won Super Bowl ${b.name} after the ${b.season} season`);
    const at = pool.findIndex((f) => f.key === "teams");
    pool.splice(at < 0 ? pool.length : at + 1, 0, {
      key: "super-bowl",
      q: `Has ${data.player.name} won a Super Bowl?`,
      a:
        `Yes${rings.length > 1 ? `, ${rings.length} times` : ""}. ${data.player.name} was a member of ` +
        `${each.length > 1 ? `${each.slice(0, -1).join(", ")} and ${each[each.length - 1]}` : each[0]}.`,
      link: null,
    });
  }
  const items = selectFaq(pool);
  const faq = items.length ? `<div class="scp-ox">${renderFaqSection("bio", data, items, options)}</div>` : "";

  if (!narrative && !timeline && !faq && !spec) return null;

  // The tab's heading, on the scoped URL as well as in the full profile. The
  // header's H1 subtitle names the tab too, in a shorter phrase; this is the
  // panel's own heading. See renderHero().
  //
  // No subtitle: it listed the facts of the table directly beneath it.
  const heading = h2(`${data.player.name} Bio`);

  // The FAQ stays the tab's last block, under the peers rail the page stands
  // above it (mak, 2026-10-02).
  return { body: heading + narrative + timeline + spec, foot: "", faq };
}

/* ------------------------------------------------------------------ outlook */

// The authored blocks (range, moves, usage, verdict), the tab's existence test
// and hasOutlookTab() live in lib/player/outlook-2026.ts.

/* --------------------------------------------------------------- game log */

/*
 * What this tab is and is not.
 *
 * It answers one question - "show me every game he played and what he did" -
 * and it answers it with a table. Season totals belong to Stats, the written
 * take belongs to Outlook, the designation belongs to Injury, and none of them
 * are repeated here. What IS here beyond the table earns its place by making
 * the table readable: the per-game line above it so a number in a cell has a
 * baseline, one chart of the same column so the shape is visible at a glance,
 * and a row detail that shows where a week's points actually came from.
 *
 * Fantasy points sit immediately after the result, ahead of every box-score
 * column. That is the one ordering decision this table makes that NFL.com and
 * CBS do not, and it is the whole reason a fantasy reader is on this page
 * rather than on theirs.
 */

function statOf(entry: GameLogEntry, key: string): number | null {
  const value = (entry.stats as unknown as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** "W 24-17", from the score attached in ranks.ts. Empty when there is none. */
function scoreLabel(entry: GameLogEntry): string {
  const score = entry.score;
  if (!score) return "";
  return `${score.r} ${score.tm}-${score.opp}`;
}

/**
 * One cell of the log.
 *
 * A ratio prints as a box score writes it - 27/37, not 0.73 - because that is
 * the form a reader can check against the game they watched. A "per" column is
 * a rate and gets a decimal; everything else is a count.
 */
function logCell(entry: GameLogEntry, column: LogColumn): string {
  const value = statOf(entry, column.key);

  if (column.kind === "ratio") {
    const over = column.over ? statOf(entry, column.over) : null;
    if (value === null && over === null) return DASH;
    return `${whole(value ?? 0)}/${whole(over ?? 0)}`;
  }

  if (column.kind === "per") {
    const over = column.over ? statOf(entry, column.over) : null;
    if (!over || value === null) return DASH;
    return num(value / over);
  }

  return value === null ? DASH : whole(value);
}

/** The played weeks of whichever season the tab is showing. */
function playedWeeks(data: PlayerPageData): GameLogEntry[] {
  return data.seasonLog.filter((entry) => entry.game_status === "active");
}

/**
 * The other seasons, at the bottom.
 *
 * Two changes from the control bar this replaces, and they are the same
 * change: the block is a way OUT of this page rather than a setting on it.
 *
 * It sits under the fixtures because that is where a reader runs out of this
 * season - the weeks played, then the weeks coming, then "and here are his
 * other years". At the top it was a row of eleven years standing between a
 * heading that had just named 2026 and the 2026 numbers that answer it.
 *
 * It is not a block of its own down there either: the caller puts it on the
 * heading row of the block it opens - "<name> career stats by season" under All, the year's
 * own heading when one is pinned - so the row of years and the name of what
 * they produced are one line rather than two stacked sections.
 *
 * And the active season is not in the list. A switcher offers somewhere to go;
 * the year the tab above is already showing is not somewhere to go. What is
 * left is exactly the archive - which is also exactly the list the game-log
 * FAQ's "previous seasons" answer is built from, so the two cannot disagree.
 *
 * Picking one of them no longer navigates away from the season on screen: it
 * opens that year underneath, and the chip lights up to say which. See
 * renderArchiveSeason().
 *
 * "All" leads the row and is where the selector rests. A bare row of eleven
 * years had no unselected state to show, so the block below it was empty until
 * the reader guessed that a year was clickable; All gives the default a name
 * and puts the career table under it - every season on one screen, which is
 * the question a list of eleven years is usually being asked. Picking a year
 * swaps that one block, and All is the way back. See renderLogCareer().
 */
function renderLogSeasons(
  data: PlayerPageData,
  options: PlayerRenderOptions,
): string {
  // The ACTIVE season is never a chip: it is the tab, always on screen above
  // this, and offering it would be offering the reader where they already are.
  // The pinned year IS a chip, and it is the lit one - it is the selector's
  // state now that choosing a year adds a block instead of replacing the page.
  const others = data.logSeasons.filter((year) => year !== data.season);
  if (others.length === 0) return "";

  const chip = (value: string, label: string, on: boolean, href: string): string =>
    // One game log is the page that ranks; a pinned season is a rendering
    // of it rather than a second address competing with it.
    `<a class="scp-season-opt${on ? " is-active" : ""}" rel="nofollow"` +
    ` data-season="${escapeHtml(value)}"` +
    `${on ? ` aria-current="true"` : ""}` +
    ` href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;

  // Clearing the pin IS the All state, so both the lit year and the All chip
  // build the same href - one to leave, one to stay put.
  const clear = pageUrl(data, options, { log: data.season, hash: "game-log" });

  const chips =
    chip("all", "All", data.logSeason === data.season, clear) +
    others
      .map((year) => {
        const on = year === data.logSeason;
        // Lit, the chip is the way back out: it clears the selection rather
        // than re-selecting what is already open below it.
        const href = on ? clear : pageUrl(data, options, { log: year, hash: "game-log" });
        return chip(String(year), String(year), on, href);
      })
      .join("");

  // No visible label. "More <player> game logs" was a heading over a row of
  // years, and the row now sits on the heading of the block it opens - which
  // names that block outright, in bigger type, one line across. The <nav> keeps
  // the name for a screen reader, where there is no layout to read it from.
  return (
    `<nav class="scp-seasonnav" aria-label="Other game log seasons">` +
    `<div class="scp-seasons">${chips}</div>` +
    `</nav>`
  );
}

/**
 * The per-game line above the table.
 *
 * Rates, not totals: this tab is about what one week from this player looks
 * like, and the totals are the Stats tab's answer to a different question. Over
 * games PLAYED - per-game over weeks on a roster measures availability while
 * wearing the clothes of production.
 */
function renderLogTiles(data: PlayerPageData): string {
  const stats = data.seasonLogStats;
  if (!stats || stats.gamesPlayed === 0) return "";

  const rates = perGameRates(playedWeeks(data), data.player.position);

  return renderTiles(
    [
      {
        label: "Games played",
        value: String(stats.gamesPlayed),
      },
      {
        label: `FPTS/G (${SCORING_SHORT[data.format]})`,
        value: num(stats.ppg),
      },
      ...rates.map((rate) => ({
        label: rate.label,
        value: rate.pct ? pct(rate.value, rate.digits) : num(rate.value, rate.digits),
      })),
    ],
    "scp-tiles--log",
  );
}

/**
 * The season in prose, under the tiles that just gave it in figures.
 *
 * Per-game rates and how many of those weeks were startable, above the table.
 * It used to follow a totals sentence ("has played 3 games ... worth 49.6 PPR
 * fantasy points"); that was removed on request, since the tiles and the
 * table already give the totals.
 */
function renderLogIntro(data: PlayerPageData): string {
  const summary = logSummarySentences(data);
  if (!summary) return "";

  return (
    `<div class="scp-logintro">` +
    `<p class="scp-note">${escapeHtml(summary)}</p>` +
    `</div>`
  );
}

/**
 * What one week's points were made of.
 *
 * The coefficients from scoring.ts, itemized. The total this is printed under
 * can come from Sleeper and carries scoring the breakdown does not model -
 * return yardage, two-point conversions, fumbles - so the difference is printed
 * as its own line rather than folded into one of the others. A breakdown that
 * quietly balances itself is worth less than one that shows where it cannot.
 */
function renderScoringBreakdown(entry: GameLogEntry, format: ScoringFormat): string {
  const parts = pointsBreakdown(entry.stats, format);
  if (parts.length === 0) return "";

  const total = fpts(entry, format);
  const modeled = parts.reduce((sum, part) => sum + part.points, 0);
  const remainder = Math.round((total - modeled) * 100) / 100;

  const rows = [
    ...parts,
    ...(Math.abs(remainder) >= 0.05
      ? [
          {
            label: "Other",
            detail: "return yards, 2-pt, fumbles",
            points: remainder,
          },
        ]
      : []),
  ];

  const items = rows
    .map(
      (row) =>
        `<li class="scp-breakdown-row">` +
        `<span class="scp-breakdown-label">${escapeHtml(row.label)}</span>` +
        `<span class="scp-breakdown-detail">${escapeHtml(row.detail)}</span>` +
        `<span class="scp-breakdown-pts">${escapeHtml(
          `${row.points > 0 ? "+" : ""}${num(row.points)}`,
        )}</span></li>`,
    )
    .join("");

  return (
    `<div class="scp-breakdown">` +
    `<p class="scp-detail-label">${escapeHtml(
      `How the ${num(total)} points scored (${SCORING_LABELS[format]})`,
    )}</p>` +
    `<ul class="scp-breakdown-list">${items}</ul></div>`
  );
}

/**
 * The expandable detail under one week.
 *
 * Everything here is context the row itself cannot carry without becoming
 * twelve more columns: where the week sat against the player's own season, what
 * it finished as, how hard the matchup was, and what the points were made of.
 * Collapsed by the client - see the note on the table below for why it is not
 * collapsed by the server.
 */
function renderWeekDetail(
  data: PlayerPageData,
  entry: GameLogEntry,
  id: string,
  span: number,
): string {
  const { player, format } = data;
  const points = fpts(entry, format);
  const ppg = data.seasonLogStats?.ppg ?? null;
  const facts: { label: string; value: string }[] = [];

  if (entry.pos_rank) {
    const tier = weeklyTier(entry.pos_rank);
    facts.push({
      label: "Weekly finish",
      value:
        `${player.position ?? ""}${entry.pos_rank}` +
        // "QB6 · QB1 week" - the rank, then the tier that rank lands in, which
        // is the form the label is read in.
        (tier ? ` · ${weeklyTierLabel(tier, player.position)} week` : ""),
    });
  }

  // Meaningless before there are two weeks to compare: one game IS the
  // average, and "+0.0 pts" is a row that looks like a measurement.
  if (ppg !== null && Number.isFinite(ppg) && (data.seasonLogStats?.gamesPlayed ?? 0) > 1) {
    const diff = Math.round((points - ppg) * 100) / 100;
    facts.push({
      label: "Vs. season average",
      value: `${diff > 0 ? "+" : ""}${num(diff)} pts`,
    });
  }

  if (entry.opp_rank_vs_pos) {
    facts.push({
      label: "Matchup",
      // "ranked 7th in points allowed", not "the 7th-most" - one phrasing that
      // survives rank 1, where "the 1st-most" is not English. The direction is
      // stated under the table rather than in every row.
      value: `${entry.opp} ranked ${ordinal(entry.opp_rank_vs_pos)} in points ` +
        `allowed to ${player.position ?? "the position"} that season`,
    });
  }

  const snaps = statOf(entry, "off_snp");
  if (snaps !== null && snaps > 0) {
    facts.push({ label: "Offensive snaps", value: whole(snaps) });
  }

  const targetShare = statOf(entry, "target_share");
  if (targetShare !== null && targetShare > 0) {
    facts.push({ label: "Target share", value: pct(targetShare * 100, 1) });
  }

  if (facts.length === 0) return "";

  const list = facts
    .map(
      (fact) =>
        `<div class="scp-detail-fact">` +
        `<dt class="scp-detail-label">${escapeHtml(fact.label)}</dt>` +
        `<dd class="scp-detail-value">${escapeHtml(fact.value)}</dd></div>`,
    )
    .join("");

  const score = scoreLabel(entry);

  return (
    `<tr class="scp-detail" id="${escapeHtml(id)}">` +
    `<td class="scp-detail-cell" colspan="${span}">` +
    `<div class="scp-detail-inner">` +
    `<p class="scp-detail-head">${escapeHtml(
      `Week ${entry.week} · ${entry.opp}${score ? ` · ${score}` : ""} · ${num(points)} pts`,
    )}</p>` +
    `<dl class="scp-detail-facts">${list}</dl>` +
    renderScoringBreakdown(entry, format) +
    `</div></td></tr>`
  );
}

/**
 * The weekly game log.
 *
 * Every week of the season is a row, including the ones the player did not
 * play. That is the point of the table: a season with five blank weeks in it
 * looks like a season with five blank weeks in it, rather than like twelve
 * clean games. Byes and absences are marked as what they were.
 *
 * The detail rows are rendered EXPANDED and collapsed by client/player.ts,
 * which is the same posture as the sortable headers: the page that arrives
 * without JavaScript is complete rather than half-usable, and the enhancement
 * is what folds it up. A server-rendered [hidden] plus a server-rendered toggle
 * would be a control that does nothing and content nobody can reach.
 */
function renderWeeklyLog(data: PlayerPageData): string {
  const { seasonLog, player, format } = data;
  if (seasonLog.length === 0) return "";

  const spec = gameLogColumns(player.position);
  // A receiver only gets rushing columns in a season where he actually ran.
  const rushed =
    spec.conditionalRush &&
    seasonLog.some((entry) => (statOf(entry, "rush_att") ?? 0) > 0);
  const columns = rushed
    ? [...spec.columns, ...RECEIVER_RUSH_COLUMNS]
    : spec.columns;

  /*
   * Result is drawn only for a season that HAS results.
   *
   * The final scores come from a different source than the logs do, and it
   * does not reach as far back - so an older season rendered eighteen rows
   * under a "Result" heading with nothing in any of them, which reads as a
   * table that is broken rather than as a column that does not apply. Same
   * rule the receiver's rushing columns already follow: a column that is empty
   * for every row of this season is not a column of this season's table.
   */
  const scored = seasonLog.some((entry) => entry.score);

  // Wk, Opp, [Result], FPTS, the position's columns, Finish.
  const span = columns.length + (scored ? 5 : 4);

  const head =
    `<tr>` +
    `<th scope="col">Wk</th>` +
    `<th scope="col">Opp</th>` +
    (scored ? `<th scope="col">Result</th>` : "") +
    `<th scope="col" class="scp-col-pts">FPTS</th>` +
    columns
      .map(
        (column) =>
          `<th scope="col" class="scp-col-box${
            column.secondary ? " scp-col-2" : ""
          }">${escapeHtml(column.label)}</th>`,
      )
      .join("") +
    `<th scope="col" class="scp-col-fin">Finish</th>` +
    `</tr>`;

  const rows = seasonLog
    .map((entry) => {
      const status = entry.game_status ?? "out";
      if (status !== "active") {
        return (
          `<tr class="scp-row" data-status="${escapeHtml(status)}">` +
          `<th scope="row">${entry.week}</th>` +
          `<td colspan="${span - 1}" class="scp-row-empty">${escapeHtml(
            status === "bye" ? "Bye week" : "Did not play",
          )}</td>` +
          `</tr>`
        );
      }

      const points = fpts(entry, format);
      const tier = weeklyTier(entry.pos_rank);
      const oppRank = entry.opp_rank_vs_pos;
      const detailId = `gl-${data.logSeason}-w${entry.week}`;
      const detail = renderWeekDetail(data, entry, detailId, span);

      return (
        `<tr class="scp-row" data-status="active" data-week="${entry.week}"` +
        (detail ? ` data-detail="${escapeHtml(detailId)}"` : "") +
        `>` +
        `<th scope="row">${entry.week}</th>` +
        `<td class="scp-opp">${escapeHtml(entry.opp)}` +
        (oppRank
          ? `<span class="scp-opp-rank" title="${escapeHtml(
              `${entry.opp} ranked ${ordinal(oppRank)} in points allowed to ${
                player.position ?? "this position"
              } that season - 1st allows the most`,
            )}">${escapeHtml(ordinal(oppRank))}</span>`
          : "") +
        `</td>` +
        (scored
          ? `<td class="scp-score">${escapeHtml(scoreLabel(entry))}</td>`
          : "") +
        `<td class="scp-pts">${escapeHtml(num(points))}</td>` +
        columns
          .map(
            (column) =>
              `<td class="scp-col-box${column.secondary ? " scp-col-2" : ""}">` +
              `${escapeHtml(logCell(entry, column))}</td>`,
          )
          .join("") +
        `<td class="scp-col-fin">` +
        (tier && entry.pos_rank
          ? `<span class="scp-tier" data-tier="${tier}"${styleAttr([
              `--tier-fill:${TIER_FILL[tier]}`,
            ])}>${escapeHtml(
              `${player.position ?? ""}${entry.pos_rank}`,
            )}</span>`
          : DASH) +
        `</td>` +
        `</tr>` +
        detail
      );
    })
    .join("");

  /*
   * One caption, and only for the one thing the table cannot say itself.
   *
   * It used to have none, deliberately: a caption restating the heading, the
   * scoring the controls already name and the "Finish" header is three things
   * the reader has passed on the way down. The opponent chip is different - a
   * bare "20th" beside LAC is a coin flip unless the direction is written
   * down, and the direction currently lives only in a title attribute, which a
   * phone has no way to open.
   *
   * The wording is the upcoming-games caption's, to the word. The two blocks
   * rank the same quantity from different sources (this one from the season's
   * own logs, that one from the FPA snapshots) and the reader has no reason to
   * care which - what they cannot survive is the two of them being read in
   * opposite directions, which is what a second phrasing would invite.
   */
  const oppNote = seasonLog.some((entry) => entry.opp_rank_vs_pos)
    ? `<p class="scp-caption scp-log-note">` +
      escapeHtml(
        `Opponent rank is fantasy points allowed to ${
          player.position ? `${player.position}s` : "the position"
        } across ${data.logSeason}: 1st allows the most, 32nd the fewest.`,
      ) +
      `</p>`
    : "";

  return (
    `<div class="scp-scroll">` +
    `<table class="scp-table scp-table--filled scp-table--log" data-scp-sortable data-scp-expandable>` +
    `<thead>${head}</thead><tbody>${rows}</tbody></table></div>` +
    oppNote
  );
}

/**
 * One chart, of the one column this page is built around.
 *
 * Weekly points against the season average, and nothing else. The Overview tab
 * already draws the same series under a three-game trailing average, which is a
 * question about form; this one is a question about consistency - how many
 * weeks were above the line a manager was starting him on - so the reference is
 * flat and the chart stays a second reading of the FPTS column rather than an
 * analysis of its own. The table is the hero.
 */
function renderLogChart(data: PlayerPageData): string {
  const played = playedWeeks(data);
  if (played.length < 3) return "";

  const points: SparkPoint[] = played.map((entry) => ({
    week: entry.week,
    opp: entry.opp,
    value: fpts(entry, data.format),
  }));

  const average =
    data.seasonLogStats?.ppg ??
    points.reduce((sum, point) => sum + point.value, 0) / points.length;
  if (!Number.isFinite(average)) return "";

  return (
    h3("Fantasy Points By Week") +
    renderSparkline(
      points,
      points.map(() => average),
      { averageLabel: `Season average (${num(average)})` },
    )
  );
}

/**
 * The trailing five games.
 *
 * Dropped entirely when the season IS five games or fewer, because "the last
 * five" and "the season" would then be the same list under two headings. Played
 * games, not calendar weeks: a player back from a three-week absence has played
 * one game recently, not four.
 */
function renderRecentGames(data: PlayerPageData): string {
  const played = playedWeeks(data);
  if (played.length <= 5) return "";

  const recent = recentGames(data.seasonLog, 5);
  const values = recent.map((entry) => fpts(entry, data.format));
  const ppg = values.reduce((sum, value) => sum + value, 0) / values.length;
  const first = recent[0]?.week;
  const last = recent[recent.length - 1]?.week;

  return (
    h3("Last Five Games") +
    renderTiles(
      [
        {
          label: `FPTS/G (${SCORING_SHORT[data.format]})`,
          value: num(ppg),
          sub: first && last ? `Weeks ${first}–${last}` : undefined,
        },
        { label: "High", value: num(Math.max(...values)) },
        { label: "Low", value: num(Math.min(...values)) },
        ...perGameRates(recent, data.player.position)
          .slice(0, 2)
          .map((rate) => ({
            label: rate.label,
            value: rate.pct ? pct(rate.value, rate.digits) : num(rate.value, rate.digits),
          })),
      ],
      "scp-tiles--log",
    )
  );
}

/**
 * The season divided, under the sentence that added it up.
 *
 * Programmatic and factual, which is the only kind of summary this page is
 * allowed to generate: it restates the table for a reader - and for a crawler -
 * that wants the shape of the season in a sentence rather than in eighteen
 * rows. It says nothing the table does not.
 *
 * ONE GAME IS NOT A SEASON, and this paragraph knows it. Its whole job is to
 * divide a season into rates, and with a single game the quotient is the
 * dividend: "that is worth 16.5 points" and "has averaged 16.5 points per
 * game" are the same sentence twice, which is exactly how it read once the two
 * paragraphs moved next to each other. So at one game the averages are dropped
 * - along with "of those weeks", which has nothing to refer back to - and the
 * paragraph renders as nothing at all. The lede above it has already said
 * everything one game supports, and the week's finish is in the table's own
 * Finish column.
 */
function logSummarySentences(data: PlayerPageData): string {
  const stats = data.seasonLogStats;
  if (!stats || stats.gamesPlayed === 0) return "";

  const { player, format, logSeason } = data;
  const played = playedWeeks(data);
  const position = player.position ?? "";
  const single = stats.gamesPlayed === 1;
  const sentences: string[] = [];

  if (!single) {
    // Per-game throughout: the tiles add the season up, this divides it.
    // Only the rates that have a prose name - a completion percentage is not
    // something a player "averaged", and a tile label in a sentence reads like
    // a column header that wandered out of the table.
    const averages = perGameRates(played, player.position)
      .filter((rate) => rate.prose)
      .slice(0, 2)
      .map((rate) => `${num(rate.value, rate.digits)} ${rate.prose}`);

    averages.push(`${num(stats.ppg)} ${SCORING_LABELS[format]} fantasy points`);
    const last = averages.pop() as string;
    const averageLine =
      averages.length > 0 ? `${averages.join(", ")} and ${last}` : last;

    sentences.push(
      `Across ${stats.gamesPlayed} games in ${logSeason}, ` +
        `${player.name} has averaged ${averageLine} per game.`,
    );
  }

  // Only when the weeks are actually ranked. Without ranks every count below is
  // zero, and "finished as a top-12 QB in 0 of 6 weeks" is a false statement
  // rather than a missing one. And only past one game: counting "of those
  // weeks" needs weeks to count, and the Finish column prints the single
  // week's rank a row away from this paragraph.
  if (!single && played.some((entry) => entry.pos_rank)) {
    const starter = stats.pos1Games + stats.pos2Games;
    sentences.push(
      `${player.name} has finished as a top-12 ${position || "option"} in ` +
        `${stats.pos1Games} of those weeks, and inside the top 24 in ${starter}.`,
    );
  }

  const best = stats.bestWeek;
  const worst = played.reduce<GameLogEntry | null>(
    (low, entry) =>
      !low || fpts(entry, format) < fpts(low, format) ? entry : low,
    null,
  );
  if (best && worst && best.week !== worst.week) {
    sentences.push(
      `The best week was Week ${best.week} against ${best.opp} ` +
        `(${num(fpts(best, format))} points); the lowest was Week ${worst.week} ` +
        `against ${worst.opp} (${num(fpts(worst, format))}).`,
    );
  }

  return sentences.join(" ");
}

/**
 * The Game Log FAQ.
 *
 * Deliberately last, under the summary sentence. Everything it answers is
 * already on the tab - that is the point: the FAQ is the form a search engine
 * can lift an answer out of, not a second source of numbers. It repeats the
 * tiles and the table in the words somebody typed.
 *
 * Scoped to weekly questions only. The Stats tab carries the career FAQ, and
 * the two are kept apart for the same reason the tabs are.
 */
function renderGameLogFaq(
  data: PlayerPageData,
  options: PlayerRenderOptions,
): string {
  // Last game, a named week, best and worst: the Game Log's own intents
  // (faq-pools.ts). Season totals are the Stats tab's.
  const items = selectFaq(gameLogPool(data, options));
  return items.length ? `<div class="scp-ox">${renderFaqSection("game-log", data, items, options)}</div>` : "";
}

/* --------------------------------------------------------- upcoming games */

/**
 * What is next, under what has already happened.
 *
 * The one block on this tab that is not about a game that has been played, and
 * it is kept visibly separate from the table above it for a reason that is
 * editorial as much as technical: a fixture list rendered as table rows with
 * dashes in the stat columns reads as though the player was inactive. Results
 * are a table; fixtures are cards.
 *
 * Every card carries the same four things - the week, who, how hard, and when -
 * and nothing else. In particular there is no projected-points figure, because
 * this codebase has no per-game projection to print: the rankings file is a
 * season-long positional order, not a weekly forecast. The card has a slot for
 * one the day a real projection exists, and until then it stays empty rather
 * than being filled with something derived to look like one.
 */
function renderUpcoming(
  data: PlayerPageData,
  options: PlayerRenderOptions,
): string {
  const games = data.upcoming;
  if (games.length === 0) return "";

  const position = data.player.position;

  /*
   * Every card is a door into the pair's own page.
   *
   * Through canonicalizeMatchupPair(), which is the one place in the app that
   * turns two clubs into a URL: alphabetical by slug, so this player's fixture
   * against Seattle and Seattle's page against his club are the same address
   * rather than two competing for it. Which side the reader came from cannot
   * reach the URL.
   *
   * Null when either club cannot be resolved - a TBD playoff slot, an opponent
   * the schedule names and the team table does not - and a card without a pair
   * simply has no link, rather than one pointing at a page that is not there.
   */
  const matchupPrefix = (options.matchupPathPrefix ?? DEFAULT_MATCHUP_PREFIX).trim();
  const matchupHref = (opponent: NflTeam | null): string | null => {
    const pair = canonicalizeMatchupPair(data.team, opponent);
    return pair
      ? `${matchupPrefix}${pair.slug}/${options.linkQuery ?? ""}`
      : null;
  };

  const cards = games
    .map((game, index) => {
      const away = game.homeAway === "away";
      const logo = game.opponent
        ? `<img class="scp-next-logo" src="${escapeHtml(game.opponent.logo)}" alt=""` +
          ` width="36" height="36" loading="lazy" decoding="async" />`
        : "";

      // The matchup rank, or nothing. A kicker has no row in the points-allowed
      // table and neither does a position the ingest does not cover, and an
      // empty slot is the honest rendering of that.
      //
      // The band does two jobs now: the tint it always carried, and the word
      // underneath it. One function so the color and the word can never
      // disagree - a rank tinted as favorable and captioned "Tough" is worse
      // than either signal on its own.
      const band = game.matchup ? matchupBand(game.matchup.rank) : null;
      const matchup = game.matchup
        ? `<div class="scp-next-matchup">` +
          `<p class="scp-next-rankline">` +
          `<span class="scp-next-rank" data-band="${band}">` +
          `${escapeHtml(ordinal(game.matchup.rank))}</span>` +
          `<span class="scp-next-vs">${escapeHtml(`vs ${game.matchup.position}`)}</span>` +
          `</p>` +
          `<p class="scp-next-read" data-band="${band}">` +
          `${escapeHtml(BAND_READ[band as MatchupBand])}</p>` +
          `</div>`
        : `<div class="scp-next-matchup scp-next-matchup--none">` +
          `<p class="scp-next-rankline">` +
          `<span class="scp-next-vs">No matchup rank</span></p></div>`;

      const when = kickoffLine(game);
      const href = matchupHref(game.opponent);

      return (
        `<li class="scp-next" data-homeaway="${game.homeAway}"` +
        (index === 0 ? ` data-next="1"` : "") +
        `>` +
        // The first card is the one being played next, and the gold rule on it
        // was the only thing saying so - a decoration a reader has to guess at.
        // The word makes the claim the rule was already making.
        //
        // A sibling of the week line rather than inside it: "Week 2" is the
        // card's own label and stays exactly that, whatever sits beside it.
        `<div class="scp-next-top">` +
        `<p class="scp-next-week">${escapeHtml(`Week ${game.week}`)}</p>` +
        (index === 0 ? `<p class="scp-next-flag">Next</p>` : "") +
        `</div>` +
        `<p class="scp-next-team">` +
        logo +
        // The home/away marker sits on the focal line rather than in a chip of
        // its own: "@ SEA" is read in one glance and a separate "Away" label is
        // a second thing to find. See the spec note in the commit.
        `<span class="scp-next-ha" aria-hidden="true">${away ? "@" : "vs"}</span>` +
        `<span class="scp-next-code">${escapeHtml(game.opponentCode)}</span>` +
        `</p>` +
        `<p class="scp-next-name">` +
        `<span class="scp-sr">${away ? "Away at " : "Home vs "}</span>` +
        `${escapeHtml(game.opponentName)}</p>` +
        matchup +
        (when ? `<p class="scp-next-when">${escapeHtml(when)}</p>` : "") +
        // Pinned to the foot of the card by CSS, so the row of buttons lines
        // up whether or not a fixture has a kickoff time yet.
        (href
          ? `<a class="scp-next-cta" href="${escapeHtml(href)}">` +
            `<span>View matchup</span>` +
            `<span class="scp-sr">${escapeHtml(
              ` - ${data.team?.fullName ?? "this team"} vs ${game.opponentName}`,
            )}</span>` +
            ARROW +
            `</a>`
          : "") +
        `</li>`
      );
    })
    .join("");

  /*
   * The direction of the rank, said once and in full.
   *
   * "14th vs QB" means nothing on its own, and "14th easiest" would be a claim
   * about a scale this block does not own. The points-allowed table ranks
   * descending - rank 1 allows the most - which is verified in
   * lib/fpa/fpa-data.ts rather than assumed here, so the caption states the
   * direction outright and leaves the reader to call it easy or hard.
   */
  /*
   * ...and the table it is measured from, linked.
   *
   * The caption defines the rank in a sentence; the link is where the reader
   * checks it. The phrase itself is the anchor rather than a "see also" tacked
   * on the end, because the words a reader stops on are the words that should
   * be clickable - and the rest of the sentence stays plain so the definition
   * still reads as one statement.
   */
  const fpaHref = `${options.fpaPath ?? DEFAULT_FPA_PATH}${
    options.linkQuery ?? ""
  }`;
  const allowed = siteLink(fpaHref, "fantasy points allowed", "scp-caption-link");

  const scale =
    `Matchup rank is ${allowed} to ` +
    (position ? escapeHtml(`${position}s`) : "the position") +
    `, in ${escapeHtml(SCORING_LABELS[data.format])}: 1st allows the most, ` +
    `32nd the fewest.`;

  return (
    // No sub-line. "Next on the schedule · Upcoming opponents and fantasy
    // matchup difficulty" restated the heading and then described the cards
    // directly beneath it, which say it better than a sentence can.
    // "Upcoming Matchups", not "<Name> upcoming games": the H1, the hero and
    // the tab above it have all already said whose page this is, and the word
    // this block turns on is the matchup rather than the fixture.
    sectionHead("Upcoming Matchups") +
    `<ul class="scp-nexts">${cards}</ul>` +
    `<p class="scp-caption scp-next-note">` +
    scale +
    (data.upcomingMatchupMode
      ? escapeHtml(` Measured through ${data.upcomingMatchupMode}.`)
      : "") +
    `</p>`
  );
}

/**
 * The band, in a word.
 *
 * "12th vs QB" is only a reading if you hold the direction of the scale in your
 * head, and the caption that states the direction is at the foot of the block.
 * This is that sentence applied, one word per card.
 *
 * It follows the site's scale and not the other one: the points-allowed table
 * ranks DESCENDING, so 1st allows the most and is the soft matchup. A defense
 * ranked 30th against the position is one of the stingiest in the league, which
 * is why 30th reads "Tough" here rather than favorable.
 */
const BAND_READ: Record<MatchupBand, string> = {
  soft: "Favorable matchup",
  mid: "Neutral matchup",
  tough: "Tough matchup",
};

/** "Sun · Sep 20 · 4:25 PM ET", degrading as ESPN's certainty does. */
function kickoffLine(game: UpcomingGame): string {
  if (game.kickoffMs === null) return "Date TBD";
  const parts = easternParts(game.kickoffMs);
  const day = `${parts.weekday} · ${parts.month} ${parts.day}`;
  return game.timeConfirmed ? `${day} · ${parts.time}` : `${day} · Time TBD`;
}

/**
 * The Game Log tab.
 *
 * Stats is totals, Game Log is games - the split the Stats tab is built on. The
 * career table and the career-finish tiles were both aggregates filed here;
 * they moved, and what is left is the thing this tab is named for.
 */
function renderGameLog(
  data: PlayerPageData,
  options: PlayerRenderOptions,
): TabParts | null {
  if (data.gameLog.length === 0) return null;

  /*
   * No label under the heading.
   *
   * It read "2026 Season (Through Week 1)" - a caption restating the year the
   * heading had just given, in the one position on the tab where a reader is
   * most willing to be told something. The tiles give "Games played"
   * instead, which is how far in we are.
   */
  // The tab is the active season, whatever ?log= asks for; the archive season
  // is rendered separately, below the selector.
  const current = activeSeasonView(data);

  // Built once and handed to the two blocks that can carry it; exactly one of
  // them renders, so the page never shows two selectors.
  const seasons = renderLogSeasons(data, options);

  // The panel's own heading, printed on the scoped URL too.
  const heading = h2(`${data.player.name} Game Log ${current.season}`);

  // The FAQ split out, so the page can stand the peers rail above it
  // (mak, 2026-10-02).
  const body =
    heading +
    // No scoring control here, and none anywhere else either. This tab used to
    // print its own toggle on a scoped URL, because a section page had no
    // control bar above it to carry one; the bar came back when the sections
    // became addresses, and then the toggle went from the bar. `?format=half` is still a URL the server renders - what
    // is gone is the control that advertised it, on the page where the numbers
    // it changes live.
    //
    // Tiles first, prose second. The paragraph reads as a gloss on the tiles -
    // the same season, in sentences, with the context a grid of six numbers
    // cannot carry - and a reader who only wants the number gets it without
    // reading past a paragraph to reach it.
    renderLogTiles(current) +
    renderLogIntro(current) +
    renderWeeklyLog(current) +
    // The two sections of mak's 2026-10-01 Game Log spec, directly after the
    // week-by-week table as it places them: the finish ladder and the per-game
    // cards. Everything below them predates the spec and stays.
    renderGamelogStory(current) +
    renderLogChart(current) +
    renderRecentGames(current) +
    renderUpcoming(current, options) +
    // One or the other, never both: All is the selector's resting state. The
    // selector itself goes INTO whichever one renders, on its heading's row -
    // it is that block's filter, and a reader changing years is looking at the
    // thing that changes.
    renderLogCareer(data, seasons) +
    renderArchiveSeason(data, options, seasons);
  return { body, foot: "", faq: renderGameLogFaq(current, options) };
}

/**
 * The active season's view of a page that may have an archive season pinned.
 *
 * `?log=2025` used to re-scope the whole tab: the heading, the tiles, the
 * table and the prose all became 2025 and the current season left the page.
 * That is not what the selector is for. A reader picking an old year is asking
 * to SEE 2025, not to lose 2026, so the tab is now always the active season
 * and the pinned year is an extra block under the selector.
 *
 * The data already carries both - `gameLog`/`stats` are the active season's
 * and `seasonLog`/`seasonLogStats` are the pinned one's - so this is a view
 * over the same object rather than a second load, and it is the identity when
 * nothing is pinned.
 */
function activeSeasonView(data: PlayerPageData): PlayerPageData {
  if (data.logSeason === data.season) return data;
  return {
    ...data,
    logSeason: data.season,
    logSeasonLabel: data.seasonLabel,
    seasonLog: data.gameLog,
    seasonLogStats: data.stats,
  };
}

/**
 * A pinned archive season, under the selector that pinned it.
 *
 * The same three blocks the active season leads with - the tiles, the
 * paragraph, the table - and none of the ones that only make sense for a
 * season in progress: no fixtures, because a finished year has none; no
 * trailing-five and no consistency chart, because both are readings of current
 * FORM and this block is a record.
 *
 * Every id inside it is namespaced by season already (`gl-2025-w4`), which is
 * what lets two game-log tables sit on one page without the week-detail
 * toggles of one opening rows in the other.
 */
function renderArchiveSeason(
  data: PlayerPageData,
  options: PlayerRenderOptions,
  seasonNav = "",
): string {
  if (data.logSeason === data.season) return "";
  if (data.seasonLog.length === 0) return "";

  return (
    `<section class="scp-archive" data-scp-archive` +
    ` data-season="${escapeHtml(String(data.logSeason))}"` +
    ` aria-label="${escapeHtml(
      `${data.player.name} ${data.logSeason} game log`,
    )}">` +
    sectionHead(`${data.player.name} Game Log ${data.logSeason}`, "", seasonNav) +
    renderLogTiles(data) +
    renderLogIntro(data) +
    renderWeeklyLog(data) +
    // The spec's two sections follow the pinned year's table too, in the past
    // tense; seasons with no stored box scores render neither, silently.
    renderGamelogStory(data, { archive: true }) +
    `</section>`
  );
}

/**
 * What the All chip opens: every season on one line each.
 *
 * The same career table the Stats tab carries, rendered from the same
 * statsProfile, so the two cannot drift. It belongs in both places for
 * different reasons: on Stats it is the totals, and here it is the index to
 * eleven game logs - the reader is standing in front of a row of years being
 * asked to pick one, and this is the screen that tells them which year is
 * worth opening.
 *
 * It occupies the archive's slot rather than sitting beside it, so exactly one
 * block is ever under the selector: All when nothing is pinned, that season
 * when one is. Sharing the .scp-archive class is what gives it the same rule
 * and spacing, and what keeps it out of the current-season blocks the tests
 * compare across a pin.
 */
function renderLogCareer(data: PlayerPageData, seasonNav = ""): string {
  if (data.logSeason !== data.season) return "";
  // Nothing to index for a player with one season - and the selector that
  // would offer All is not drawn for one either.
  if (data.logSeasons.filter((year) => year !== data.season).length === 0) return "";

  const table = renderCareerStats(data, seasonNav);
  if (!table) return "";

  return (
    `<section class="scp-archive scp-archive--career" data-scp-archive` +
    ` data-season="all"` +
    ` aria-label="${escapeHtml(`${data.player.name} career by season`)}">` +
    table +
    `</section>`
  );
}

/** Career totals by season - the counting stats, not the rates. */

/* --------------------------------------------------------- advanced stats */

/**
 * The advanced table, grouped and ranked.
 *
 * Forty numbers read as five ideas because they are grouped, and each one
 * carries the percentile that says whether it is any good. The value is always
 * printed; the bar beside it is league context, never the only reading.
 *
 * Absent entirely for a player who is not in the table - which is most of the
 * league, and why the tab is dropped rather than shown empty.
 */
/* -------------------------------------------------------------------- stats */

/**
 * The Stats tab.
 *
 * One page for one question - "what are his stats this season and over his
 * career" - which is a single intent that used to be spread across three
 * places: season totals half-stated on Overview, the career table filed under
 * Game Log, and an Advanced Stats tab competing for the same searches with a
 * thinner page.
 *
 * The split that holds the whole thing up: **Stats is totals, Game Log is
 * games.** A reader asking how many yards he has and a reader asking what he
 * did in Week 3 want different pages, and every section here is a sum, a rate
 * or a record. Nothing on this tab knows what a week is.
 *
 * Advanced metrics are NOT on this tab. They were, briefly, as its last
 * section - forty percentile bars across six groups, which buried the career
 * records under a wall of EPA and pressure rates that a general reader scrolls
 * past. They are not a tab of their own either: that page competed with this
 * one for the same queries on thinner content.
 *
 * The code behind it (renderAdvanced(), the `?adv=` season switch and
 * lib/player/advanced.ts) was deleted on 2026-09-30; git history has it.
 *
 * Order: the snapshot answers the query, the season tables back it, fantasy is
 * the layer this site adds, the career table catches every "<year> stats" and
 * "career stats" variant, and the records give the page somewhere to stop.
 */

/** A whole number with thousands separators. Never a dash - callers guard. */
function count(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/**
 * The season rail: the query's answer, before anything else.
 *
 * FANTASY FIRST, and per game.
 *
 * It used to open on games, passing yards, touchdowns, completion percentage,
 * interceptions and passer rating, with fantasy points added at the end - a
 * row that answers "how did he play" and says nothing about the question this
 * site exists for until its last cell. A reader who wanted passer rating did
 * not come here for it. So the two fantasy figures lead and are set larger,
 * and the box score behind them is rates rather than totals: yards per game
 * survives a bye and a one-game sample, and season totals are what the career
 * table underneath is for.
 *
 * Passer rating has not been dropped - it moved down into Production, where it
 * sits with the rest of the line it belongs to.
 *
 * Position-aware, because the four numbers a reader wants after the fantasy
 * pair are not the same four for a quarterback and a receiver.
 */
function renderStatsSnapshot(data: PlayerPageData): string {
  const row = data.statsProfile.current;
  if (!row || row.gamesPlayed === 0) return "";

  const position = data.player.position;
  const t = row.totals;
  const g = row.gamesPlayed;
  const per = (value: number, digits = 1) => (value / g).toFixed(digits);

  // The two that lead. `lead` sets them larger than the rest of the rail -
  // hierarchy by size, because a row of six equal figures has no answer in it.
  const cells: RailCell[] = [
    {
      value: row.ppg.toFixed(1),
      label: "Fantasy PPG",
      accent: "gold",
      lead: true,
    },
  ];

  if (data.seasonRank !== null) {
    cells.push({
      value: `${position ?? ""}${data.seasonRank}`,
      label: "Fantasy finish",
      accent: "gold",
      lead: true,
    });
  }

  // Two rates after the fantasy pair (mak, 2026-09-30: simplify the strip
  // under the chart); the strip at the top of the tab has the rest.
  if (position === "QB" && t.passAtt > 0) {
    cells.push({ value: per(t.passYd, 0), label: "Pass yds/g" });
    cells.push({ value: per(t.passTd), label: "Pass TD/g" });
  } else if (position === "RB") {
    cells.push({ value: per(t.rushYd, 0), label: "Rush yds/g" });
    cells.push({ value: per(t.rec), label: "Rec/g" });
  } else {
    cells.push({ value: per(t.tgt), label: "Targets/g" });
    cells.push({ value: per(t.recYd, 0), label: "Rec yds/g" });
  }

  return (
    `<section class="scp-snapshot">` + renderRail(cells, "hero") + `</section>`
  );
}

/* statTable() - the two-column label/value table - went with the cards it was
   the inside of. Production is figure-over-label columns now, which reads as a
   stat sheet rather than as a settings page. */

/**
 * Career, season by season.
 *
 * Reaches further back than the game logs do, because it is built off the
 * production snapshot - see lib/player/stats-profile.ts. There is no TEAM
 * column: that file does not record one, and a column that is blank for most of
 * a career is worse than no column.
 */
function renderCareerStats(data: PlayerPageData, aside = ""): string {
  const { career, totals } = data.statsProfile;
  if (career.length === 0) return "";

  const position = data.player.position;
  const isQb = position === "QB";
  const t = (row: CareerStatRow) => row.totals;

  const columns: Array<{ label: string; get: (row: CareerStatRow) => string }> = isQb
    ? [
        { label: "Cmp", get: (r) => count(t(r).passCmp) },
        { label: "Att", get: (r) => count(t(r).passAtt) },
        { label: "Pass yds", get: (r) => count(t(r).passYd) },
        { label: "TD", get: (r) => count(t(r).passTd) },
        { label: "INT", get: (r) => count(t(r).passInt) },
        { label: "Rush yds", get: (r) => count(t(r).rushYd) },
      ]
    : position === "RB"
      ? [
          { label: "Car", get: (r) => count(t(r).rushAtt) },
          { label: "Rush yds", get: (r) => count(t(r).rushYd) },
          { label: "Rush TD", get: (r) => count(t(r).rushTd) },
          { label: "Rec", get: (r) => count(t(r).rec) },
          { label: "Rec yds", get: (r) => count(t(r).recYd) },
          { label: "Rec TD", get: (r) => count(t(r).recTd) },
        ]
      : [
          { label: "Tgt", get: (r) => count(t(r).tgt) },
          { label: "Rec", get: (r) => count(t(r).rec) },
          { label: "Rec yds", get: (r) => count(t(r).recYd) },
          { label: "Rec TD", get: (r) => count(t(r).recTd) },
          { label: "Rush yds", get: (r) => count(t(r).rushYd) },
        ];

  /*
   * A group row above the column row.
   *
   * Eleven seasons across twelve columns is one long sheet, and a reader
   * scanning for a passing line has to count headers to find where it starts.
   * The groups say where each block of columns begins and cost one row to do
   * it. Marked aria-hidden and skipped by the sorter - see wireSortableLog,
   * which reads the LAST header row so these are not mistaken for sort buttons.
   */
  const groups: Array<{ label: string; span: number }> = isQb
    ? [
        { label: "", span: 2 },
        { label: "Passing", span: 5 },
        { label: "Rushing", span: 1 },
        { label: "Fantasy", span: 3 },
      ]
    : position === "RB"
      ? [
          { label: "", span: 2 },
          { label: "Rushing", span: 3 },
          { label: "Receiving", span: 3 },
          { label: "Fantasy", span: 3 },
        ]
      : [
          { label: "", span: 2 },
          { label: "Receiving", span: 4 },
          { label: "Rushing", span: 1 },
          { label: "Fantasy", span: 3 },
        ];

  const groupRow =
    `<tr class="scp-group-row" aria-hidden="true">` +
    groups
      .map(
        (group) =>
          `<td colspan="${group.span}"${group.label ? "" : ' class="scp-group-pad"'}>` +
          `${escapeHtml(group.label)}</td>`,
      )
      .join("") +
    `</tr>`;

  const head =
    `<tr><th scope="col">Season</th><th scope="col">GP</th>` +
    columns.map((c) => `<th scope="col">${escapeHtml(c.label)}</th>`).join("") +
    `<th scope="col">FPTS</th><th scope="col">PPG</th><th scope="col">Finish</th></tr>`;

  const body = career
    .map(
      (row) =>
        `<tr class="scp-row${row.inProgress ? " is-current" : ""}"` +
        `${row.inProgress ? ' data-partial="1"' : ""}>` +
        `<th scope="row">${escapeHtml(String(row.season))}` +
        (row.inProgress
          ? `<span class="scp-partial" title="Season in progress">to date</span>`
          : "") +
        `</th>` +
        `<td>${escapeHtml(count(row.gamesPlayed))}</td>` +
        columns.map((c) => `<td>${escapeHtml(c.get(row))}</td>`).join("") +
        `<td class="scp-pts">${escapeHtml(row.points.toFixed(1))}</td>` +
        `<td>${escapeHtml(row.ppg.toFixed(1))}</td>` +
        `<td>${escapeHtml(
          row.finish !== null ? `${position ?? ""}${row.finish}` : DASH,
        )}</td>` +
        `</tr>`,
    )
    .join("");

  const totalRow =
    `<tr class="scp-total"><th scope="row">Career</th>` +
    `<td>${escapeHtml(count(totals.gamesPlayed))}</td>` +
    columns
      .map(
        (c) =>
          `<td>${escapeHtml(
            c.get({
              season: 0,
              inProgress: false,
              gamesPlayed: totals.gamesPlayed,
              totals: totals.totals,
              points: totals.points,
              ppg: totals.ppg,
              finish: null,
            }),
          )}</td>`,
      )
      .join("") +
    `<td class="scp-pts">${escapeHtml(totals.points.toFixed(1))}</td>` +
    `<td>${escapeHtml(totals.ppg.toFixed(1))}</td>` +
    `<td>${DASH}</td></tr>`;

  return (
    // No line under the heading. It read "11 seasons, 102 games. Fantasy points
    // in PPR" - the season count is the number of rows, the games are the
    // Career row's own GP cell, and the format is named by the column head
    // ("FPTS/G (PPR)") and by the hero's lead cell above it. Three facts the
    // table states, restated above the table.
    sectionHead(`${data.player.name} career stats by season`, "", aside) +
    `<div class="scp-scroll">` +
    `<table class="scp-table scp-table--filled scp-table--career" data-scp-sortable>` +
    `<thead>${groupRow}${head}</thead>` +
    `<tbody>${body}</tbody><tfoot>${totalRow}</tfoot>` +
    `</table></div>`
  );
}

/** The Stats tab's FAQ: season and career totals, position-aware (faq-pools.ts). */
function renderStatsFaq(data: PlayerPageData, options: PlayerRenderOptions): string {
  const items = selectFaq(statsPool(data, options));
  return items.length ? `<div class="scp-ox scp-st">${renderFaqSection("stats", data, items, options)}</div>` : "";
}

function renderStats(data: PlayerPageData, options: PlayerRenderOptions): TabParts | null {
  const snapshot = renderStatsSnapshot(data);
  // The "Efficiency Profile" block was removed at mak's request (2026-09-30).
  const career = renderCareerStats(data);
  const faq = renderStatsFaq(data, options);
  // The sections of mak's Stats tab spec of 2026-09-29 (lib/player/stats-tab.ts).
  // Since 2026-09-30 its first three (production, advanced, career chart) open
  // the tab, above everything it already had; the rest stay under it. For a
  // rookie before his first NFL game it is his college card and table, and it
  // is the whole tab.
  const spec = renderStatsTabParts(data, options);

  if (!snapshot && !career && !spec.top && !spec.rest) return null;

  /*
   * The heading, and nothing under it.
   *
   * There were two lines here and both were restating their surroundings. A
   * subtitle listed the section headings that follow it - "fantasy production,
   * efficiency, career stats and career bests" is a table of contents for four
   * blocks a reader can already see. Under that, a meta row gave the position,
   * the club, the season, the games played and the week, every one of which is
   * printed within a screen of it: the hero carries the position and the club,
   * the heading carries the year, and the rail underneath opens on the fantasy
   * rate with the games behind it.
   *
   * What they were for was authority - who, which season, how far in - and the
   * page earns that by being right rather than by captioning itself.
   */
  // The panel's own heading, printed on the scoped URL too. Since 2026-09-30
  // only when the spec's production section is missing (a rookie's college
  // tab, a kicker): mak dropped it, and "{Name} {season} stats" right under
  // it now heads the tab and becomes the WordPress H1 (promoteLeadHeading).
  const heading = spec.top.includes(`id="${STATS_LEAD_ID}"`) ? "" : h2(`${data.player.name} Stats ${data.season}`);

  return {
    body: heading + spec.top + snapshot + career + spec.rest,
    foot: spec.foot,
    faq,
  };
}

/**
 * The Injury tab.
 *
 * Reordered around the question people actually arrive with. Somebody who
 * searches a player's name and the word "injury" wants three things, in this
 * order: is he hurt right now, is he playing, what happened. The career record
 * - the durability grade, the body-region tallies, the five-year timeline - is
 * what they want SECOND, and it used to be the whole tab with the current
 * designation filed one tab over under News.
 *
 * So the order is now:
 *
 *   1. current status, with this season's availability beside it
 *   2. the career record at a glance
 *   3. the availability profile - four readings, each with its record printed
 *   4. injuries by body part, as a table
 *   5. the history itself, one entry at a time, as real prose in the HTML
 *   6. the questions people type, answered from the record
 *
 * A note on the history, because it is the part that carries the most weight
 * and has the least behind it. Those records have no per-entry provenance -
 * no source, no URL, no retrieved-at - and the script that produced them
 * scraped a dev server of an app that is not in this repository. The page
 * therefore says what it can defend and nothing more: that it is a compiled
 * record, and when the file it came from was last written. See the note under
 * the timeline, and do not replace it with a source line until there is a
 * source to name.
 */

const RISK_WORD: Record<RiskLevel, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
};


/**
 * The Injury tab: its heading, mak's spec (lib/player/injury-tab.ts), and one
 * FAQ, which stands after the Nearby Positional Peers rail (mak, 2026-09-30).
 * `faq` is returned apart so the section page can print it after the rail it
 * shares with every tab; the all-tabs page carries its own copy of the rail
 * inside the panel, as the Overview does.
 *
 * The injury record's own questions (data.injury.faq) are folded into the
 * spec's FAQ where it doesn't already ask them, and the FAQPage node is built
 * from exactly what prints - mak approved that schema change on 2026-09-30.
 */
function renderInjury(
  data: PlayerPageData,
  options: PlayerRenderOptions,
): TabParts | null {
  if (!data.injury) return null;

  // The tab's heading, and the thing that names the panel - on the scoped URL
  // as well. See renderHero(). No subtitle since 2026-09-30: the status
  // panel's answer follows the H1.
  const heading = h2(`${data.player.name} Injury Update & History`);

  // The original tab's sections (status card, at-a-glance grade and tiles,
  // availability profile, body-part table and history) were removed on
  // 2026-09-30 at mak's request.
  const parts = injuryTabParts(data, options, data.injury.faq ?? []);
  if (!parts) return { body: heading, foot: "", faq: "" };
  options.faqSink?.push(...parts.faqText);
  return { body: heading + parts.body, foot: parts.foot, faq: parts.faq };
}

/* -------------------------------------------------------------------- news */

/**
 * The News tab: mak's News spec of 2026-09-30 (lib/player/news-tab.ts), which
 * replaced the designation card and the two headline lists this tab used to
 * be. The panel heading, the section page's H1, was "News & Analysis" until
 * mak approved "Latest News & Updates" the same day.
 */
function renderNews(data: PlayerPageData, options: PlayerRenderOptions): TabParts | null {
  const parts = renderNewsTabParts(data, options);
  if (!parts) return null;
  // The panel names the player, as every section's heading does; it is the
  // section page's H1 when WordPress hands the heading to the tool.
  return { body: h2(`Latest ${data.player.name} News & Updates`) + parts.body, foot: "", faq: parts.faq };
}


/* --------------------------------------------------------- page assembly */

/**
 * The page's FAQ, once, from the sections that actually shipped.
 *
 * Standalone this is the FAQPage node; embedded it is the inert island that
 * statchasers-player.php lifts into Rank Math's graph - the same two shapes
 * renderFaq() used to emit per block, hoisted so the document gets one of them.
 *
 * Collected from the sections that are ON THIS PAGE rather than from every
 * section that was rendered: a section-scoped URL builds all of them and then
 * shows one, so describing the lot would put questions in the structured data
 * that the reader cannot see anywhere on the page.
 */
function renderPlayerFaqSchema(
  items: Array<{ question: string; answer: string }>,
  options: PlayerRenderOptions,
): string {
  // One question once. The Overview's FAQ and the Game Log's both ask what he
  // is averaging; a FAQPage that repeats a question is a page asking a crawler
  // to choose between two answers. The first, in document order, is kept.
  const seen = new Set<string>();
  items = items.filter((entry) => {
    const key = entry.question.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (items.length === 0) return "";

  if (options.embed) {
    return (
      `<script type="application/json" class="scp-faq-data">` +
      escapeJsonLd(
        JSON.stringify(
          items.map((entry) => ({ q: entry.question, a: entry.answer })),
        ),
      ) +
      `</script>`
    );
  }

  return (
    `<script type="application/ld+json">` +
    escapeJsonLd(
      JSON.stringify({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: items.map((entry) => ({
          "@type": "Question",
          name: entry.question,
          acceptedAnswer: { "@type": "Answer", text: entry.answer },
        })),
      }),
    ) +
    `</script>`
  );
}

/* ------------------------------------------------------------------ peers */

/**
 * "Nearby Positional Peers" - the rail at the foot of every player page.
 *
 * Ported from the standalone app's RankNeighborsRail, and it answers the
 * question the header's rank cell asks and cannot itself answer: QB16 of whom?
 * The three players either side, with this one among them in true rank order
 * and marked, is that answer in a form a reader can act on - every card is the
 * next page.
 *
 * Three deliberate differences from the app it came from:
 *
 *   It is rendered here, not fetched. The original called /api/players/:slug/
 *   related from the browser; the whole neighborhood is arithmetic over logs
 *   already in memory, so it ships in the HTML like the rest of the page.
 *
 *   It survives September. The original ranked on points per game with a
 *   four-game minimum, which in week 2 is a rail that never appears for
 *   anybody. This one slices whichever table the header is ranking by - the
 *   rate once it exists, points scored until then - and the subheading says
 *   which, so the cards and the header can never disagree.
 *
 *   Its cards are this site's, not that app's. Same structure - portrait well,
 *   rank pill, name, club, the figure - in the player page's own tokens, with
 *   the club's color as the one accent, which is the rule the hero follows.
 *
 * Outside the tab panels, so it stands under whichever tab is open. That is
 * where the original put it, and it is right for the reason a tab is not: this
 * is not part of the argument a tab makes, it is the way out of the page.
 */
function renderPositionPeers(
  data: PlayerPageData,
  options: PlayerRenderOptions,
): string {
  const peers = data.peers;
  if (!peers || peers.rows.length < 2) return "";

  const prefix = options.playerPathPrefix ?? "/player/";
  const query = options.linkQuery ?? "";
  const pos = peers.position;
  const unit = peers.measure === "ppg" ? "PPG" : "PTS";

  const cards = peers.rows
    .map((row) => {
      // The same derivatives the hero uses, keyed by the same Sleeper id
      // (headshot-html.ts): the full figure at 160 wide for 1x, 350 for 2x.
      const photo =
        `<span class="scp-peer-well">` +
        // Nothing behind the portrait. The original app laid the player's
        // initials under it as a fallback for a thumbnail the CDN does not
        // have - but Sleeper's thumbnails are CUTOUTS on transparency, so the
        // letters did not sit behind a missing image, they sat behind the
        // player's shoulders on every card that had one. A player with no
        // thumbnail gets the club's wash and nothing else, which is the well
        // doing its own job.
        (headshotImg({
          src: row.headshot,
          id: row.id,
          className: "scp-peer-img",
          alt: "",
          variants: ["f160", "f350"],
          sizes: "150px",
          // The derivatives' own 350x254 ratio at the card's width, so the
          // box the browser reserves is the box the file fills. The old
          // 150x98 (the well's height) was the wrong ratio: on a phone the
          // full-width card grew 10px when WP Rocket swapped the file in
          // (docs/CLS-ANALYSIS.md, Finding 3).
          width: 150,
          height: 109,
          loading: "lazy",
        }) ?? "") +
        `<span class="scp-peer-rank">${escapeHtml(`${pos}${row.rank}`)}</span>` +
        (row.isCurrent
          ? `<span class="scp-peer-here">You are here</span>`
          : "") +
        `</span>`;

      const body =
        `<span class="scp-peer-body">` +
        `<span class="scp-peer-name">${escapeHtml(row.name)}</span>` +
        `<span class="scp-peer-club">${escapeHtml(
          row.team?.nickname ?? "Free agent",
        )}</span>` +
        `<span class="scp-peer-value">` +
        `<b>${escapeHtml(num(row.value))}</b> ${escapeHtml(unit)}` +
        `</span>` +
        // The club's mark, faint, behind the text - the hero's watermark at
        // card scale, and the same 4%-of-the-page device the production grid
        // uses rather than a third idea of what a watermark is.
        (row.team
          ? `<img class="scp-peer-logo" src="${escapeHtml(row.team.logo)}" alt=""` +
            ` aria-hidden="true" loading="lazy" decoding="async" width="48" height="48" />`
          : "") +
        `</span>`;

      const style = styleAttr([
        row.team && `--peer-team:${row.team.primaryColor}`,
      ]);

      // The card for the player whose page this is is not a link to it. The
      // original made every card clickable including that one; a link that
      // reloads the page you are on is a dead end wearing a pointer, and the
      // card already says what it is.
      if (row.isCurrent) {
        return (
          `<div class="scp-peer is-current" aria-current="page"${style}>` +
          photo +
          body +
          `</div>`
        );
      }

      return (
        `<a class="scp-peer" href="${escapeHtml(
          `${prefix}${row.slug}/${query}`,
        )}" target="_top"${style}>` +
        photo +
        body +
        `</a>`
      );
    })
    .join("");

  return (
    `<section class="scp-peers" aria-labelledby="scp-peers-h">` +
    // The Overview's section-title device (.scp-ox-h2), so it reads as one
    // more section of the page, like the FAQ above it.
    // "QBs like Jacoby Brissett" (mak, 2026-09-30), not "Nearby Positional Peers".
    `<h2 class="scp-ox-h2" id="scp-peers-h">${escapeHtml(titleCase(`${pos}s like ${data.player.name}`))}</h2>` +
    // Scrolled to center the marked card by client/player.ts. Without it the
    // rail simply starts at its best-ranked end, which is a fine place to
    // start reading and needs nothing.
    `<div class="scp-peer-rail" data-scp-peers>${cards}</div>` +
    `</section>`
  );
}

export function renderPlayerPage(
  data: PlayerPageData,
  options: PlayerRenderOptions = {},
): string {
  // One sink per section, so the schema below can be built from the sections
  // that ship rather than from everything that was rendered.
  const faqBySection = new Map<string, Array<{ question: string; answer: string }>>();
  const withFaq = (id: string): PlayerRenderOptions => {
    const sink: Array<{ question: string; answer: string }> = [];
    faqBySection.set(id, sink);
    return { ...options, faqSink: sink };
  };
  // The written 2026 take is its own tab, ahead of Overview: it is the one
  // block on the page that says what to expect rather than what happened, and
  // buried at the bottom of a long overview nobody scrolled to it. Players
  // without a written outlook simply do not get the tab - same rule as the rest.
  // Under everything the tab already had: the sections of mak's Outlook tab
  // spec of 2026-09-29 (lib/player/outlook-tab.ts). Only on a tab that exists
  // already, so no player gains an Outlook URL from this.
  const existingOutlook = renderOutlook2026(data);
  const outlookSpec = existingOutlook.exists ? outlookTabParts(data, withFaq("outlook")) : null;
  const outlookParts: TabParts | null = existingOutlook.exists
    ? {
        body: existingOutlook.html + (outlookSpec?.body ?? ""),
        foot: outlookSpec?.foot ?? "",
        faq: outlookSpec?.faq ?? "",
      }
    : null;

  /*
   * Overview is the interpretation layer now - see the note above
   * renderFantasySnapshot(). What left: the 2026 counting totals and the best
   * week (Stats owns them), the efficiency meters and the career rate tiles
   * (moved to Stats, then removed there on 2026-09-30), and the season-finish
   * timeline (the career table's own Finish column already says it).
   */
  /*
   * Three bands, not seven stacked modules.
   *
   *   SNAPSHOT   the answer, and the sentence under it.
   *   PROFILE    what kind of fantasy asset he is, and what is driving it.
   *   WEEKLY     the shape of his weeks, and the usage behind them.
   *
   * The grouping is what carries the rhythm: the gap INSIDE a band is small
   * and the gap BETWEEN bands is large, so the tab reads as three things with
   * parts rather than as seven equal blocks with the same air around each. A
   * band whose every section returned "" is not emitted - an empty wrapper
   * still draws its own top margin.
   */
  const band = (parts: string[]): string => {
    const html = parts.join("");
    return html ? `<div class="scp-ov-band">${html}</div>` : "";
  };

  const overviewBody =
    renderFantasySnapshot(data, options) +
    // The profile band ("Fantasy Profile", "What Is Driving The Production"),
    // the weekly one's "Weekly Profile" and "Week By Week" chart, and "Career
    // Context" are gone: the read's sidebar profile, the meters, the season
    // strip and the career table further down the tab answer all five.
    band([renderRoleDirection(data)]);

  // The wrapper is what every rule on this tab is scoped to - the sections
  // below reuse markup the Stats and Injury tabs own, and Overview's tighter
  // rhythm must not follow those classes onto the other tabs.
  //
  // Under it, the sections of the Overview spec - see
  // lib/player/overview.ts. Its FAQ feeds the page's one FAQPage node.
  const overview =
    (overviewBody ? `<div class="scp-ov">${overviewBody}</div>` : "") +
    // The peers rail sits above the Overview's FAQ, as it now does on every
    // other tab too (mak, 2026-10-02).
    renderOverviewSections(data, withFaq("overview"), {
      peers: renderPositionPeers(data, options),
    });

  const bioParts = renderBio(data, withFaq("bio"));

  // Stats is totals, Game Log is games - the split the Stats tab is built on.
  // The career table and the career-finish tiles were both aggregates filed
  // here; they moved to Stats, and what is left is the thing this tab is named
  // for. A reader asking "what did he do in Week 3" gets a page of weeks.
  const gameLogParts = renderGameLog(data, withFaq("game-log"));
  const statsParts = renderStats(data, withFaq("stats"));
  const injuryParts = renderInjury(data, withFaq("injury"));
  const newsParts = renderNews(data, withFaq("news"));
  const split = new Map<string, TabParts>();
  if (statsParts) split.set("stats", statsParts);
  if (gameLogParts) split.set("game-log", gameLogParts);
  if (outlookParts) split.set("outlook", outlookParts);
  if (injuryParts) split.set("injury", injuryParts);
  if (newsParts) split.set("news", newsParts);
  if (bioParts) split.set("bio", bioParts);
  // Every tab carries the rail above its FAQ, as on the Overview (mak,
  // 2026-10-02) - so there is no copy after the panels any more. The Stats
  // footer closes its page, under the FAQ (mak, 2026-10-02); the Injury
  // footer keeps its place above the rail.
  const whole = (id: string, parts: TabParts | null): string =>
    parts
      ? parts.body +
        (id === "stats" ? "" : parts.foot) +
        renderPositionPeers(data, options) +
        parts.faq +
        (id === "stats" ? parts.foot : "")
      : "";
  const stats = whole("stats", statsParts);
  const gameLog = whole("game-log", gameLogParts);
  const outlook = whole("outlook", outlookParts);
  const injury = whole("injury", injuryParts);
  const news = whole("news", newsParts);
  const bio = whole("bio", bioParts);

  // Built from what actually rendered: a section that produced no markup is not
  // in the page and must not be in the navigation pointing at nothing. A backup
  // with no game log gets a two-tab page, not five tabs of empty panels.
  const sections: Section[] = [
    { id: "overview", label: "Overview", html: overview },
    { id: "stats", label: "Stats", html: stats },
    { id: "game-log", label: "Game Log", html: gameLog },
    { id: "outlook", label: "Outlook", html: outlook },
    { id: "injury", label: "Injury", html: injury },
    { id: "news", label: "News", html: news },
    { id: "bio", label: "Bio", html: bio },
  ].filter((section) => section.html !== "");
  options.sectionsSink?.push(...sections.map((section) => section.id));

  if (sections.length === 0) {
    // Everything failed to produce markup, which for this page means the player
    // exists in the dictionary and has no recorded football. The hero alone is
    // the honest page: who they are, and nothing claimed beyond it.
    return (
      `<div class="scp${options.embed ? " is-embed" : ""}" data-scp-root="1">` +
      renderPlayerSearch(options) +
      renderHero(data, options) +
      `<div class="scp-section is-default is-active"><p class="scp-empty">${escapeHtml(
        `No game log has been recorded for ${data.player.name}.`,
      )}</p></div></div>`
    );
  }

  /*
   * A section-scoped page: one section, standing alone at its own URL.
   *
   * It carries the strip, with the current tab marked, plus a link back to the
   * full profile. It used to carry no strip at all, on the grounds that six
   * tabs that all leave this URL is navigation pretending to be tabs - true
   * while they were `#hash` links and the opposite of true now they are
   * addresses. A reader arriving here from search had no way to reach the
   * other six, and those six had nothing linking to them.
   *
   * Everything else - the hero, the control bar, the markup of the section
   * itself - is unchanged, so the two addresses render the same component and
   * cannot drift.
   */
  // The Overview is not a section page: it is the profile, which opens on it.
  // `/overview/` 301s to the profile, and anything that still asks for it
  // scoped gets the profile rather than a second copy at a second address.
  const scoped =
    options.section && options.section !== "overview"
      ? sections.find((entry) => entry.id === options.section)
      : undefined;

  if (scoped) {
    // The Injury panel without the rail and FAQ it carries on the all-tabs
    // page: here both follow the panel.
    const parts = split.get(scoped.id);
    const panelHtml = parts ? parts.body : scoped.html;
    const prefix = options.playerPathPrefix ?? "/player/";
    const back =
      `<p class="scp-back">` +
      `<a class="scp-crosslink" href="${escapeHtml(
        `${prefix}${data.player.slug}/${options.linkQuery ?? ""}`,
      )}" target="_top">${escapeHtml(`All ${data.player.name} stats & analysis`)}</a>` +
      `</p>`;

    return (
      `<div class="scp${options.embed ? " is-embed" : ""}" data-scp-root="1"` +
      ` data-player="${escapeHtml(data.player.slug)}"` +
      ` data-position="${escapeHtml(data.player.position ?? "")}"` +
      ` data-season="${escapeHtml(String(data.season))}"` +
      // The season the Game Log tab is headed with, which the WordPress plugin
      // reads off the fragment to put the right year in the document title.
      // Always the active season now: ?log=2025 adds 2025 under the selector
      // rather than re-scoping the tab, so a title naming 2025 would name the
      // block at the bottom of the page. Kept as its own attribute because the
      // plugin's regex is deployed separately from this render.
      ` data-log-season="${escapeHtml(String(data.season))}"` +
      // The pinned archive year, when there is one - state, not subject.
      (data.logSeason === data.season
        ? ""
        : ` data-archive-season="${escapeHtml(String(data.logSeason))}"`) +
      ` data-format="${escapeHtml(data.format)}"` +
      ` data-section="${escapeHtml(scoped.id)}">` +
      renderPlayerSearch(options) +
      renderHero(data, options, scoped.id) +
      `<div class="scp-controls">` +
      renderNav(sections, data, options, scoped.id) +
      `</div>` +
      `<section class="scp-section is-default is-active" data-scp-panel` +
      ` id="${escapeHtml(scoped.id)}">` +
      // In the address's words, not the panel's: the Outlook panel opens on
      // "2026 Outlook", which names nobody. The words are the ones the strip
      // hands the host's H1 for this tab, so the two cannot disagree.
      (options.ownHeading
        ? LEAD_HEADINGS[scoped.id]
          ? promoteLeadHeading(
              panelHtml,
              LEAD_HEADINGS[scoped.id]!,
              scoped.id === "stats" ? undefined : sectionHeading(data.player.name, scoped.id, data.season) ?? undefined,
            )
          : promoteHeading(
              panelHtml,
              sectionHeading(data.player.name, scoped.id, data.season) ?? undefined,
            )
        : panelHtml) +
      `</section>` +
      // The tab's footer, the way back, the rail, then its FAQ (mak,
      // 2026-09-30) - except Stats, whose footer closes the page under the
      // FAQ (mak, 2026-10-02).
      (parts
        ? (scoped.id === "stats" ? "" : parts.foot) +
          back +
          renderPositionPeers(data, options) +
          parts.faq +
          (scoped.id === "stats" ? parts.foot : "")
        : back + renderPositionPeers(data, options)) +
      renderPlayerFaqSchema(faqBySection.get(scoped.id) ?? [], options) +
      `</div>`
    );
  }

  // `is-default` marks the panel shown when the URL names no section - a class
  // rather than :first-of-type, because the CSS must not depend on this element
  // being the first <section> among its siblings. Same reasoning as the hub.
  const body = sections
    .map(
      (section, i) =>
        `<section class="scp-section${i === 0 ? " is-default is-active" : ""}"` +
        ` data-scp-panel id="${escapeHtml(section.id)}"` +
        ` aria-labelledby="${escapeHtml(section.id)}-tab">` +
        // Only the panel the page opens on. The other six keep their <h2>, so
        // the document has one H1 whichever tab a reader switches to. It reads
        // as the profile rather than as the panel: this address is the profile.
        (options.ownHeading && i === 0
          ? promoteHeading(section.html, profileHeading(data.player.name), profileSubtitle(data))
          : section.html) +
        `</section>`,
    )
    .join("");

  return (
    `<div class="scp${options.embed ? " is-embed" : ""}" data-scp-root="1"` +
    ` data-player="${escapeHtml(data.player.slug)}"` +
    ` data-position="${escapeHtml(data.player.position ?? "")}"` +
    ` data-season="${escapeHtml(String(data.season))}"` +
    ` data-log-season="${escapeHtml(String(data.season))}"` +
    (data.logSeason === data.season
      ? ""
      : ` data-archive-season="${escapeHtml(String(data.logSeason))}"`) +
    ` data-format="${escapeHtml(data.format)}">` +
    renderPlayerSearch(options) +
    renderHero(data, options, sections[0]?.id) +
    `<div class="scp-controls">` +
    renderNav(sections, data, options) +
    `</div>` +
    body +
    // No copy outside the panels any more: every tab carries the rail above
    // its own FAQ (mak, 2026-10-02), so a shared one under the panels would
    // double it on every tab.
    // Document order, so the node reads down the page the way the questions do.
    renderPlayerFaqSchema(
      sections.flatMap((section) => faqBySection.get(section.id) ?? []),
      options,
    ) +
    `</div>`
  );
}

/* --------------------------------------------------------------- directory */

/*
 * The index of every profile: the container page at /nfl/players/ mounts it as
 * a fragment, and /player on this origin is the same thing in a page shell.
 * Neither carries a heading of its own - the host page supplies it.
 *
 * It used to be six hundred names in thirty-two <ul>s. That was honest about
 * what it had - a list of slugs - and it was the one surface here that looked
 * nothing like the pages it points at: no portrait, no club color, no
 * position ink, no number, and no way to find a player on it but the browser's
 * own find-in-page.
 *
 * What it borrows, and from where, because none of this is a new design:
 *
 *   - the ROW is the search panel's result row (renderPlayerSearch above, and
 *     the option builder in client/player-search.ts): a portrait at the head,
 *     the name, and the position in its own ink. A reader who has used the
 *     search box has already read this row.
 *   - the STANDING pill is the peers rail's rank badge (renderPositionPeers),
 *     navy on the card, and it says the same thing that rail says: where this
 *     player stands at his position, measured the way his own profile header
 *     measures it.
 *   - the CLUB CARD is the recessed treatment the stylesheet's header note
 *     describes, with the club's primary as a rule and a wash exactly as the
 *     peer card uses --peer-team. Its heading links to the team hub, which is
 *     the cross-link the old list had nowhere to put.
 *   - the POSITION CHIPS are the pill group the scoring toggle wore before
 *     the control bar traded it for the start/sit button, as buttons rather
 *     than links because they filter what is already here rather than
 *     fetching anything.
 *
 * Nothing here needs JavaScript to be complete: every player, every portrait,
 * every standing is in the markup the server sends, grouped and ordered. The
 * chips and the search box are the two things that are not, so both ship
 * hidden and the client reveals them - the convention renderPlayerSearch()
 * already set, and the reason is the same: a control with no script behind it
 * is a promise the page cannot keep.
 */

/** What both index renderings need to know about where links go. */
interface PlayerIndexOptions {
  playerPathPrefix?: string;
  teamPathPrefix?: string;
  linkQuery?: string;
}

/**
 * The order rows read in within a club: the depth chart's, not the alphabet's.
 *
 * A roster that opens with its quarterback and ends with its kicker is the
 * order every other surface on this site lists a team in - the depth chart,
 * the outlook cards, the matchup tables. Alphabetical order is the order of a
 * list that expects to be searched rather than read.
 */
const DIRECTORY_POSITIONS = ["QB", "RB", "WR", "TE", "K"];

function positionOrder(position: string | null | undefined): number {
  const i = DIRECTORY_POSITIONS.indexOf((position ?? "").toUpperCase());
  return i === -1 ? DIRECTORY_POSITIONS.length : i;
}

/**
 * How loudly one row reads: the rank band it falls in.
 *
 * A card of eighteen rows all shouting equally is a card nobody scans - the
 * eye has to read every name to find the six that matter. The band is what
 * the stylesheet varies name weight, pill fill and row tint by, so the page
 * can be read at a glance rather than a row at a time.
 *
 * The cut points are finishBadge()'s, not new ones. It already knows that a
 * position's shape decides where "startable" ends - QB12 is an every-week
 * starter where WR12 is a first-rounder - and it maps onto the same ordinal
 * tier ramp this stylesheet paints finishes with everywhere else. A second,
 * flat set of cut points here would only disagree with it.
 *
 * `idle` is the one band finishBadge() has no opinion about: a player who has
 * not taken a snap, and a player who is on the list with a rank but no points
 * to his name. Both are noise on a page about production, and both drop to
 * the quietest treatment the card has.
 */
function directoryBand(row: DirectoryPlayer): string {
  const standing = row.standing;
  if (!standing || !row.position || standing.value <= 0) return "idle";
  return finishBadge(standing.rank, row.position)?.tier ?? "idle";
}

/** `QB14` over `17.2 ppg`, or the dash for a player who has not played. */
function renderDirectoryStanding(row: DirectoryPlayer): string {
  const standing = row.standing;
  if (!standing || !row.position) {
    // The column still prints something, because an empty cell in a list of
    // six hundred reads as a rendering fault rather than as "no games".
    return `<span class="scp-dir-stand is-empty" aria-label="No games this season">${DASH}</span>`;
  }

  // Lowercase, because the pill above it is the loud half of this pair and two
  // shouting lines read as two facts rather than as one.
  const unit = standing.measure === "ppg" ? "ppg" : "pts";

  return (
    `<span class="scp-dir-stand">` +
    `<b class="scp-dir-rank">${escapeHtml(`${row.position}${standing.rank}`)}</b>` +
    `<span class="scp-dir-value">${escapeHtml(num(standing.value))} ${escapeHtml(unit)}</span>` +
    `</span>`
  );
}

function renderDirectoryRow(
  row: DirectoryPlayer,
  options: PlayerIndexOptions,
  lead = false,
): string {
  const prefix = options.playerPathPrefix ?? "/player/";
  const query = options.linkQuery ?? "";
  const position = (row.position ?? "").toUpperCase();

  return (
    // The position is on the <li> as well as in the pill: the chips filter by
    // it, and a filter that had to read the pill's text would be reading the
    // rendering rather than the data.
    `<li class="scp-dir-item"${position ? ` data-pos="${escapeHtml(position)}"` : ""}` +
    // What the stylesheet varies the row's weight by. See directoryBand().
    ` data-band="${escapeHtml(directoryBand(row))}"` +
    // The first row of a position run inside this card. It takes a hairline
    // above it, which is as much grouping as a card this size can carry
    // without turning into five sections with five headings.
    `${lead ? " data-lead" : ""}>` +
    `<a class="scp-dir-row" href="${escapeHtml(`${prefix}${row.slug}/${query}`)}" target="_top">` +
    `<span class="scp-dir-face">` +
    // 38 to match the well in the stylesheet, so the box the browser reserves
    // before the image answers is the box the portrait lands in. The 160px
    // square derivative, keyed by the same Sleeper id the hero uses; a player
    // with no photo gets the empty well (headshot-html.ts).
    (headshotImg({
      src: row.headshot,
      id: row.id,
      className: "scp-dir-shot",
      alt: "",
      variants: ["160"],
      width: 38,
      height: 38,
      loading: "lazy",
    }) ?? "") +
    `</span>` +
    `<span class="scp-dir-who">` +
    `<span class="scp-dir-name">${escapeHtml(row.name)}</span>` +
    (position
      ? `<span class="scp-dir-pos" data-pos="${escapeHtml(position)}">${escapeHtml(position)}</span>`
      : "") +
    `</span>` +
    renderDirectoryStanding(row) +
    `</a></li>`
  );
}

/** One club's card: its mark, its name, its count, its players. */
function renderDirectoryClub(
  team: NflTeam | null,
  rows: DirectoryPlayer[],
  options: PlayerIndexOptions,
): string {
  const teamPrefix = options.teamPathPrefix ?? "/team/";
  const query = options.linkQuery ?? "";
  const name = team?.fullName ?? "Free agents";

  const ordered = rows.slice().sort((a, b) => {
    const byPosition = positionOrder(a.position) - positionOrder(b.position);
    if (byPosition !== 0) return byPosition;
    // Inside a position, the table's order - and the players with no standing
    // after the ones who have one, rather than mixed in at an arbitrary place.
    const aRank = a.standing?.rank ?? Number.POSITIVE_INFINITY;
    const bRank = b.standing?.rank ?? Number.POSITIVE_INFINITY;
    if (aRank !== bRank) return aRank - bRank;
    return a.name.localeCompare(b.name);
  });

  const heading = team
    ? `<a class="scp-dir-club-link" href="${escapeHtml(
        `${teamPrefix}${team.slug}/${query}`,
      )}" target="_top">${escapeHtml(name)}</a>`
    : escapeHtml(name);

  const mark = team
    ? `<img class="scp-dir-club-logo" src="${escapeHtml(team.logo)}" alt=""` +
      ` width="26" height="26" loading="lazy" decoding="async" />`
    : "";

  const style = styleAttr([team && `--club:${team.primaryColor}`]);

  // How many of them are actually producing. The bare roster count answered a
  // question nobody asked - thirty-two cards all saying "about seventeen" -
  // where "6 of 18 scoring" is the one number that separates a club worth
  // opening from a club with three names on it a reader has heard of.
  const scoring = ordered.filter((row) => directoryBand(row) !== "idle").length;

  const items = ordered
    .map((row, i) => {
      // A position run opens wherever this row's position differs from the one
      // above it. The first row of the card opens nothing: a hairline across
      // the top of a list is a border, not a grouping.
      const previous = i > 0 ? ordered[i - 1] : undefined;
      const lead =
        i > 0 && positionOrder(row.position) !== positionOrder(previous?.position);
      return renderDirectoryRow(row, options, lead);
    })
    .join("");

  return (
    `<section class="scp-dir-club" data-scp-club` +
    ` data-team="${escapeHtml(team?.code ?? "FA")}"${style}>` +
    `<header class="scp-dir-club-head">` +
    mark +
    `<h2 class="scp-dir-club-name">${heading}</h2>` +
    // Both halves are updated by the client as the chips filter; the server's
    // values are the whole roster, which is what it is before anything is.
    `<span class="scp-dir-club-count">` +
    `<b data-scp-club-scoring>${scoring}</b>` +
    `<span class="scp-dir-club-of"> of <b data-scp-club-count>${ordered.length}</b></span>` +
    `<span class="scp-visually-hidden"> players scoring this season</span>` +
    `</span>` +
    `</header>` +
    `<ul class="scp-dir-list" data-scp-dir-list data-grouped>` +
    items +
    `</ul>` +
    `</section>`
  );
}

/**
 * The position chips, one per position the roster actually has.
 *
 * Counted from the rows rather than hard-coded, so a list with no kickers on
 * it has no K chip to press and find nothing behind.
 */
function renderDirectoryFilters(rows: DirectoryPlayer[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const position = (row.position ?? "").toUpperCase();
    if (!position) continue;
    counts.set(position, (counts.get(position) ?? 0) + 1);
  }

  const positions = Array.from(counts.keys()).sort(
    (a, b) => positionOrder(a) - positionOrder(b) || a.localeCompare(b),
  );

  const chip = (value: string, label: string, count: number, active: boolean) =>
    `<button type="button" class="scp-dir-chip${active ? " is-active" : ""}"` +
    ` data-scp-pos="${escapeHtml(value)}" aria-pressed="${active ? "true" : "false"}">` +
    `${escapeHtml(label)}<span class="scp-dir-chip-n">${count}</span>` +
    `</button>`;

  return (
    // Hidden until the client reveals it: see the note at the head of this
    // section. `hidden` rather than a class, so it is inert for a screen
    // reader too rather than merely invisible.
    `<div class="scp-dir-filters" data-scp-dir-filters hidden>` +
    `<span class="scp-dir-filters-label">Position</span>` +
    `<div class="scp-dir-chips" role="group" aria-label="Filter players by position">` +
    chip("all", "All", rows.length, true) +
    positions
      .map((position) => chip(position, position, counts.get(position) ?? 0, false))
      .join("") +
    `</div>` +
    /*
     * The club filter, which is a pill rather than a chip group.
     *
     * There are thirty-two clubs and one is picked at a time, so a row of
     * thirty-two chips beside the five positions would be the toolbar's whole
     * height for a choice the search box above already makes better. This is
     * the chosen club's name and the way back out of it, and nothing until one
     * is chosen - which is why it ships hidden and empty rather than absent:
     * the client fills in the name, and the words around it stay here with the
     * rest of the page's words.
     */
    `<div class="scp-dir-club-filter" data-scp-dir-club hidden>` +
    `<span class="scp-dir-filters-label">Team</span>` +
    `<div class="scp-dir-chips">` +
    `<button type="button" class="scp-dir-chip is-active" data-scp-dir-club-clear>` +
    `<span data-scp-dir-club-name></span>` +
    `<span class="scp-dir-chip-x" aria-hidden="true">${TIMES}</span>` +
    // The mark is decoration; this is what the button actually says.
    `<span class="scp-sr"> - clear the team filter and show every club</span>` +
    `</button>` +
    `</div></div>` +
    `</div>`
  );
}

/**
 * The line under the toolbar: how many players, and what the numbers are.
 *
 * It exists because the standings column is meaningless without it. "QB14" is
 * a claim about a season, a scoring format and a measure, and a page that
 * prints six hundred of them and says none of the three is asking to be
 * misread - particularly in September, when the rank is over points scored in
 * a game or two rather than the rate it will be by October.
 */
function renderDirectoryNote(data: PlayerDirectory, shown: number): string {
  const rate = data.rows.some((row) => row.standing?.measure === "ppg");
  const measured = rate
    ? `points per game (${PPG_MIN_GAMES}-game minimum)`
    : "points scored";
  const through = data.week > 0 ? ` through Week ${data.week}` : "";
  const season = data.season > 0 ? `${data.season} ` : "";

  return (
    `<p class="scp-dir-note">` +
    `<b data-scp-dir-count>${shown}</b> players ${DOT} ` +
    escapeHtml(
      `ranked by ${season}${SCORING_SHORT[data.format]} ${measured}${through}`,
    ) +
    `</p>`
  );
}

/**
 * Every indexed player, grouped by club.
 *
 * Shared by the standalone /player page and by the fragment the WordPress
 * container page at /nfl/players/ mounts, for the same reason the team index
 * shares one: two renderings of a six-hundred-name roster is one that goes
 * stale, and it is the one nobody looks at.
 */
function renderPlayerDirectory(
  data: PlayerDirectory,
  options: PlayerIndexOptions = {},
): string {
  const byTeam = new Map<string, { team: NflTeam | null; rows: DirectoryPlayer[] }>();
  for (const row of data.rows) {
    // Free agents key on a string no club code can collide with, and sort to
    // the end below rather than under "F".
    const key = row.team?.abbreviation ?? "zz-free-agent";
    const group = byTeam.get(key);
    if (group) group.rows.push(row);
    else byTeam.set(key, { team: row.team, rows: [row] });
  }

  const clubs = Array.from(byTeam.values())
    .sort((a, b) =>
      (a.team?.fullName ?? "zzz").localeCompare(b.team?.fullName ?? "zzz"),
    )
    .map((group) => renderDirectoryClub(group.team, group.rows, options))
    .join("");

  return (
    `<div class="scp-dir-tools">` +
    // See renderPlayerSearch(): on this page a club row filters the list
    // below rather than leaving the page for the club's hub.
    renderPlayerSearch(options, { clubsFilter: true }) +
    renderDirectoryFilters(data.rows) +
    `</div>` +
    renderDirectoryNote(data, data.rows.length) +
    `<div class="scp-dir" data-scp-dir>${clubs}</div>` +
    // The client unhides this when a filter matches nobody. It is in the
    // markup rather than built on demand so the string lives with the rest of
    // the page's words instead of inside a bundle.
    `<p class="scp-dir-empty" data-scp-dir-empty hidden>` +
    `No player at that position has a page yet.</p>`
  );
}

/**
 * The index as a bare fragment, for the WordPress container page to print.
 *
 * No heading: the page at /nfl/players/ supplies it, the same division of
 * labor every other mount here follows - and, since the hero came off the
 * standalone page too, the only thing this fragment now drops is the shell.
 */
export function renderPlayerIndexFragment(
  data: PlayerDirectory,
  options: PlayerIndexOptions = {},
): string {
  return (
    // data-scp-index is what the client boots the directory from, and it is
    // deliberately not data-scp-root: the profile's wiring - tabs, charts,
    // sortable tables, the header fitter - has nothing to do on this page.
    `<div class="scp is-embed" data-scp-index="1">` +
    `<div class="scp-section">${renderPlayerDirectory(data, options)}</div>` +
    `</div>`
  );
}

/** The index as its own page on this origin: /player. */
export function renderPlayerIndex(
  data: PlayerDirectory,
  options: PlayerIndexOptions = {},
): string {
  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0" />` +
    `<title>NFL Player Pages | StatChasers</title>` +
    `<meta name="robots" content="noindex, indexifembedded" />` +
    `<link rel="stylesheet" href="/player.css" />` +
    `</head><body class="scp-page"><div class="scp" data-scp-index="1">` +
    `<div class="scp-section">${renderPlayerDirectory(data, options)}</div>` +
    `</div>` +
    // The same bundle public/player.html gives a profile, for the same reason:
    // the search box and the position chips are both shipped hidden for a
    // client to reveal, and on this page there was no client to do it. They
    // have been inert here since the index grew them - visible, because a
    // `display` of their own beat the `hidden` attribute, and unwired.
    `<script src="/dist/statchasers-player.js" defer></script>` +
    `</body></html>`
  );
}
