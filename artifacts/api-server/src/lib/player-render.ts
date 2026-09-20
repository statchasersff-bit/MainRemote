/**
 * Markup for the NFL Player Pages.
 *
 * Server-only, like lib/team-render.ts and for the same reason: the page ships
 * complete HTML and client/player.ts only enhances what is already there. This
 * replaces a 3,200-line React profile that built every one of these sections in
 * the browser, which meant a crawler received an empty div — the same problem
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
 *    StatChasers navy/gold/white; the player's team colour appears as an aura
 *    behind the headshot and a hairline on the hero, and nowhere else.
 *
 * And one this page adds, because it is the one that gets broken:
 *
 * 3. **Nothing here predicts.** Every label — "Heating Up", "TD-Driven",
 *    "Elite" — is a restatement of a number that is printed beside it. The page
 *    describes what happened and says what it is calling that; it never asserts
 *    what happens next. Where the source data is a projection (the 2026
 *    outlook), it is kept apart from the measured sections rather than adopted
 *    in the page's voice: its own tab, and a heading that says outlook and
 *    names the season. The quote framing and the source line under it were
 *    removed by request; the tab and the heading are what is left doing that
 *    job, so neither should be softened into something vaguer.
 *
 * A note on colour. The four finish tiers are an ORDINAL scale — POS1 through
 * Bust is an order, not a set of identities — so they take one hue in four
 * monotone lightness steps rather than four hues. The order is then visible in
 * the colour itself, and the page stays on-brand instead of becoming a chart
 * with a fruit salad in it. Every tier also carries its own text label, so the
 * palest step never has to carry meaning alone.
 */

import {
  escapeHtml,
  escapeJsonLd,
  itemTimestamp,
  safeUrl,
  type NewsItem,
} from "./render";
import { easternParts, newsStamp, splitHeadline } from "./news-card";
import { driverSeason } from "./player/outlook-drivers";
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
  rollingAverage,
  weeklyTier,
  weeklyTierLabel,
  type WeeklyTier,
} from "./player/metrics";
import type { UpcomingGame } from "./player/upcoming";
import type {
  IndexedPlayer,
  PlayerPageData,
  ProductionSeason,
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
import { gameLogFaq } from "./player/game-log-faq";
import { injuryWhen, type RiskLevel } from "./player/injury";
import {
  careerAvailability,
  passerRating,
  type CareerStatRow,
} from "./player/stats-profile";
import { canonicalizeMatchupPair } from "./matchup/pair";
import {
  fantasyProfile,
  percentileLevel,
  percentileRead,
  percentileWord,
  seasonSentence,
  weeklyFinishRange,
  type ProfileRow,
} from "./player/fantasy-read";
import type { OutlookBand } from "./player/types";

export interface PlayerRenderOptions {
  /**
   * Embedded inside a statchasers.com page. Drops the standalone page's chrome
   * and demotes the player's name to an <h2>, because the host page supplies
   * the H1 — the same reasoning as the team hub's embed mode.
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
   * canonicalizeMatchupPair() like everywhere else — so a fixture against
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
   * section page is the hero, that section, and a way back to the rest — and
   * its heading is the phrase the page is actually about.
   *
   * Ignored when the id does not match a section that rendered, which keeps a
   * stale link serving the full page rather than a 404.
   */
  section?: string;
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
  news: "News & Analysis",
  overview: "Season Overview",
  bio: "Bio",
};

/** The public heading for a section page, e.g. "Jacoby Brissett Injury Update & History". */
export function sectionHeading(
  playerName: string,
  section: string,
  season?: number,
): string | null {
  const phrase = SECTION_HEADINGS[section];
  if (!phrase) return null;
  // "Jacoby Brissett Stats 2026" — the year is part of the phrase people type
  // for stats and for a game log, and not for the others.
  const dated = season && (section === "stats" || section === "game-log");
  return dated ? `${playerName} ${phrase} ${season}` : `${playerName} ${phrase}`;
}

/* ------------------------------------------------------------------ atoms */

const DASH = "—";

/** The interpunct these pages join short facts with. */
const DOT = "·";

/**
 * The season the Outlook tab is about.
 *
 * Named once rather than written into six strings: this tab is the one place
 * on the page allowed to talk about a season nobody has played, and the year it
 * means has to be impossible to leave half-updated.
 */
const OUTLOOK_SEASON = 2026;

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
 * A section heading with the gold rule under it.
 *
 * The Stats tab is a sequence of six blocks and an h3 alone was not enough to
 * mark where one ends and the next begins — the page read as a stack of
 * components. The rule is drawn by the heading rather than by a sibling node,
 * for the reason .scp-h2::after gives: it cannot be left behind by a heading
 * that moves.
 */
function sectionHead(text: string, sub = "", aside = ""): string {
  const text_ =
    `<h3 class="scp-sect-title">${escapeHtml(text)}</h3>` +
    (sub ? `<p class="scp-sect-sub">${escapeHtml(sub)}</p>` : "");

  // `aside` is a control that belongs to this block — the game log's season
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
 * query — a question somebody typed, answered from numbers already rendered
 * above it — and two copies would drift on the one thing that matters here:
 * the schema, and whether it is safe to emit.
 *
 * Embedded, WordPress owns the document's schema and a second FAQPage inside
 * the host's article is a conflict rather than an enhancement — the same reason
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
): string {
  if (items.length === 0) return "";

  /*
   * One question, one fold — the shape the team hubs use.
   *
   * These blocks were four questions with all four answers permanently open,
   * which is a wall of restated prose at the bottom of a tab that has already
   * said all of it in numbers. Folded, the QUESTIONS are the index: a reader
   * scanning for the one they arrived with sees every question at once and
   * opens the single answer they came for.
   *
   * Shut by default, and per question rather than one fold around the block —
   * a single fold hides the questions too, which is the opposite of what an
   * index is for. The answers stay in the DOM either way: a crawler reads the
   * DOM rather than the open state, and the FAQPage node below is built from
   * the same list, so nothing about the structured data depends on this.
   *
   * <h4> inside the <summary> so the questions keep their place in the page
   * outline; the summary is the control, the heading is still the heading.
   */
  const body = items
    .map(
      (entry) =>
        `<details class="scp-faq-item">` +
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

  if (options.faqSink) {
    options.faqSink.push(...items);
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

/**
 * The four finish tiers, as one hue in four monotone lightness steps.
 *
 * Validated rather than chosen: OKLCH lightness ascends 0.359 / 0.500 / 0.628 /
 * 0.754 in even steps, and the palest step still clears 2:1 against the white
 * surface these pages render on, which is the floor an ordinal ramp's light end
 * has to hold. Anchored on SC Blue so the page's data and the page's brand are
 * the same colour.
 */
const TIER_FILL: Record<WeeklyTier, string> = {
  pos1: "#0b3a7a",
  pos2: "#2f63a8",
  pos3: "#5a8cc4",
  bust: "#8fb3da",
};

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
 * facts, not a series — drawing them as bars would invite a comparison that
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
  /** The qualifier under the label — "4 seasons", "in 2025", "Moderate". */
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
 * The Stats tab is built from three component languages and no fourth — RAILS
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
 *   hero   bordered and filled, larger figures. The season strip only — it is
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

/* The percentile METER — a filled bar read left to right — is gone, and so is
   the marker-on-a-track that briefly replaced it. A filled bar states a
   proportion ("73% complete") and a percentile is a position in a distribution
   rather than a proportion of one, so neither mark was saying the right thing.
   Both tabs now print the reading in words with the rate and the ordinal
   under it — see efficiencyRows(). */

interface StackSegment {
  tier: WeeklyTier;
  label: string;
  pct: number;
  games: number;
}

/**
 * The finish distribution, as one stacked bar.
 *
 * A 2px surface gap separates the segments so adjacent steps of the same hue
 * stay countable, and every segment wide enough to hold it is labelled in
 * place — the legend below covers the ones that are not.
 */
function renderStackedBar(
  segments: StackSegment[],
  /**
   * `slim` draws the same bar as a rule rather than as a block.
   *
   * On Overview this chart sits under a one-game sample, where a 34px band of
   * solid colour saying "100% QB2" is the loudest thing on the tab and the
   * least earned. Slim keeps the reading and gives it the weight of a
   * footnote — the inline percentages come off, because the legend under a
   * 10px bar is already printing them a line away.
   */
  options: { slim?: boolean; showEmpty?: boolean } = {},
): string {
  const shown = segments.filter((s) => s.pct > 0);
  if (shown.length === 0) return "";

  /*
   * `showEmpty` keeps the tiers he never reached in the legend.
   *
   * A one-game season draws one full-width segment reading "QB2 100%", which
   * is true and says nothing: 100% of one week. "QB1 0% · QB2 100% · QB3+ 0%"
   * is the same measurement with its scale attached, and the zero is the half
   * of it worth knowing. The BAR still only draws what happened — a segment of
   * no width is not a thing to name — so every drawn colour is still in the
   * legend, which is the rule this legend exists for.
   */
  const named = options.showEmpty ? segments : shown;

  const bar = shown
    .map(
      (segment) =>
        `<span class="scp-stack-seg" data-tier="${segment.tier}"${styleAttr([
          `flex-basis:${segment.pct}%`,
          `background:${TIER_FILL[segment.tier]}`,
        ])}>` +
        // Only wide segments get an inline label; the rest rely on the legend.
        (!options.slim && segment.pct >= 12
          ? `<span class="scp-stack-inline">${escapeHtml(segment.pct.toFixed(0))}%</span>`
          : "") +
        `</span>`,
    )
    .join("");

  const legend = named
    .map(
      (segment) =>
        `<li class="scp-legend-item"${segment.pct === 0 ? ` data-empty="1"` : ""}>` +
        `<span class="scp-legend-swatch" aria-hidden="true"${styleAttr([
          `background:${TIER_FILL[segment.tier]}`,
        ])}></span>` +
        `<span class="scp-legend-label">${escapeHtml(segment.label)}</span>` +
        `<span class="scp-legend-value">${escapeHtml(
          // The game count is what the percentage is OF, and a tier he never
          // reached has no "of" — "0% (0)" prints the same nothing twice.
          segment.games > 0
            ? `${segment.pct.toFixed(0)}% (${segment.games})`
            : `${segment.pct.toFixed(0)}%`,
        )}</span>` +
        `</li>`,
    )
    .join("");

  return (
    `<div class="scp-stack${options.slim ? " is-slim" : ""}">` +
    `<div class="scp-stack-bar" role="img" aria-label="${escapeHtml(
      shown.map((s) => `${s.label} ${s.pct.toFixed(0)}%`).join(", "),
    )}">${bar}</div>` +
    `<ul class="scp-legend">${legend}</ul>` +
    `</div>`
  );
}

interface SparkPoint {
  week: number;
  opp: string;
  value: number;
}

/**
 * Weekly points with a three-game trailing average over them.
 *
 * Two series, so it carries a legend — identity is never colour alone. The
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
  // alternative — preserveAspectRatio="none" plus a fixed CSS height — stretches
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

  // Week numbers under the first, last and best points only — a label on every
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

/* ------------------------------------------------------------------- hero */

/**
 * The player's headshot, standing on the floor of the hero.
 *
 * Sleeper's thumbnails are cut-out PNGs on transparency — head and shoulders,
 * cropped at the chest — so they are not photographs to be framed but figures
 * to be stood somewhere. The circle crop this replaced threw away the shoulders
 * and most of the height to fit a 96px disc; bottom-aligned and bled off the
 * card's edge, the same file reads as a person in the header.
 *
 * Portrait box over a landscape source on purpose: the source is 350x254 with
 * the subject in the middle half, so `cover` against a taller box crops the
 * empty sides rather than the player.
 *
 * A player with no photo gets nothing. There is no silhouette to fall back to
 * and an empty 140px column is worse than a hero that closes up around it.
 */
function renderHeadshot(data: PlayerPageData): string {
  const { player } = data;
  // Sleeper's thumbnail, the same CDN the news cards already use.
  const src = player.headshotUrl
    ? safeUrl(player.headshotUrl)
    : `https://sleepercdn.com/content/nfl/players/thumb/${encodeURIComponent(player.id)}.jpg`;
  if (!src) return "";
  return (
    `<div class="scp-photo">` +
    `<img class="scp-photo-img" src="${escapeHtml(src)}" alt=""` +
    ` width="350" height="254" decoding="async" />` +
    `</div>`
  );
}

/**
 * Suffixes that belong to the surname rather than standing as one.
 *
 * "Odell Beckham Jr." splits after Odell, not after Beckham: a hero reading
 * "JR." in 44px would be the one thing on the page nobody could misread as
 * anything but a bug.
 */
const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/**
 * A name as the hero sets it: given name small above, surname large below.
 *
 * The split is presentational and the H1 is not: `first` and `last` are
 * rendered as two spans with a real space between them, so the heading's text
 * content is still exactly `player.name` for a crawler, a screen reader and
 * the tests that compare the two. Anything this cannot split cleanly — a
 * single-word name, or a name that would not reassemble to itself — falls back
 * to one span, which is the old treatment and never wrong.
 */
function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return { first: "", last: name };

  const bare = (word: string): string => word.toLowerCase().replace(/\.+$/, "");
  // A suffix takes the name before it along with it, so "Beckham Jr." stays one
  // surname — but only when there is a given name left over to put above it.
  const cut =
    parts.length >= 3 && NAME_SUFFIXES.has(bare(parts[parts.length - 1] ?? ""))
      ? parts.length - 2
      : parts.length - 1;

  const first = parts.slice(0, cut).join(" ");
  const last = parts.slice(cut).join(" ");
  // The heading has to reassemble to the name it was built from, or the split
  // has quietly rewritten the H1. Double spaces and odd whitespace land here.
  if (`${first} ${last}` !== name) return { first: "", last: name };
  return { first, last };
}

/** Height stored as total inches ("73") rendered as feet and inches. */
function formatHeight(height: string | null): string {
  if (!height) return "";
  const trimmed = height.trim();
  if (trimmed.includes("'") || trimmed.includes("-")) return trimmed;
  const inches = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(inches) || inches <= 0) return trimmed;
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

/**
 * The figures in the hero's right-hand strip.
 *
 * The season this player is having, in the format the page is set to. A header
 * is the one place on a profile where a reader will accept being told the
 * answer before the question, and "16.8 a game across 14 games" is the answer
 * they came for.
 *
 * Season only — nothing career-long and nothing from a ranking. The strip is
 * captioned with the year above it, and a figure that does not belong to that
 * year would make the caption a lie about the cell beside it.
 *
 * All three or none. The strip is a reading of one season, and there is no
 * state where a player has points but no games to have scored them in.
 */
interface HeroStatCell {
  label: string;
  value: string;
  /** The headline of the three, which takes the gold. */
  lead?: boolean;
}

/**
 * The figures in the hero's right-hand panel.
 *
 * Three questions, in the order a fantasy reader asks them: how much is he
 * scoring, where does that put him, and does anyone else have him. A header is
 * the one place on a profile where a reader will accept being told the answer
 * before the question, and those three are the answers they came for.
 *
 * It used to be rate, total and games played, which answered the first
 * question three times — the total is the rate times the games, and a reader
 * who has the first two can do the third in their head. The rank and the
 * ownership are the two facts on this page that cannot be derived from
 * anything else in the header.
 *
 * Two rows to a cell, label over figure. The qualifiers that used to sit on a
 * third row — the games the average is over, which way the rank was measured,
 * whose ownership pool — are all stated in full further down the page, and a
 * line of grey under every figure was competing with the figures for the
 * reading the panel exists to give.
 *
 * The scoring cell is the only one that is always there. A rank needs a league
 * to rank within and ownership needs a source that has heard of him, and where
 * either is missing the panel is two cells wide rather than carrying a dash —
 * a placeholder is a figure that says nothing while taking the room of one
 * that would.
 */
/**
 * An ownership share, as a reader would say it.
 *
 * Whole numbers from ten up, where a tenth of a point is noise on a figure
 * that moves by several a week. Below ten the tenth IS the reading: 0.4% and
 * 4% are both "barely rostered" once rounded, and they are not the same
 * player.
 *
 * And 100% is reserved for 100%. Thirty players sat at 99.0 or above in the
 * week this was written and exactly one of them was in every league; rounding
 * would have printed the same "100%" over all thirty, which is a claim about
 * the last league in the game rather than a reading of a number.
 */
function rosteredPct(value: number): string {
  if (value < 10) return pct(value, 1);
  return pct(Math.min(Math.round(value), value >= 100 ? 100 : 99), 0);
}

function heroStats(data: PlayerPageData): HeroStatCell[] {
  const { stats, format, player } = data;
  if (!stats || stats.gamesPlayed === 0) return [];

  const pos = player.position ?? "";
  const season = data.production.find((row) => row.season === data.season);
  const cells: HeroStatCell[] = [];

  /* ---- what he is scoring ---- */

  cells.push({
    label: `${SCORING_SHORT[format]} PPG`,
    value: num(stats.ppg),
    lead: true,
  });

  /* ---- where that puts him ---- */

  // By points per game where that rank exists, by points scored until it does.
  // Which of the two is showing is left to the career table's Finish column and
  // the two finish tiles, where the distinction is drawn in full; the hero cell
  // carries the figure alone.
  const ppgRank = season?.posFinishPpg ?? data.seasonRank;
  const totalRank = season?.posFinishTotal ?? data.seasonRankTotal;
  const rank = ppgRank ?? totalRank;
  if (pos && rank !== null) {
    cells.push({
      label: "Pos rank",
      value: `${pos}${rank}`,
    });
  }

  /* ---- and whether anyone else has him ---- */

  if (data.rosterPct) {
    cells.push({
      label: "Rostered",
      // The pool it was measured in is Sleeper's redraft cut — see
      // scripts/player/buildRosterPct.mjs.
      value: rosteredPct(data.rosterPct.owned),
    });
  }

  return cells;
}


/*
 * The hero's responsive contract, in one place.
 *
 * Ported from the start/sit tool's player header, which states the rule this
 * file now follows: BREAKPOINTS DECIDE TOPOLOGY, MEASUREMENT DECIDES EVERYTHING
 * INSIDE. A media query here only answers "one row, two rows, or stacked". How
 * big the bust is, how wide the numbers are, how long the team's name is — none
 * of that is a function of the viewport, because the hero is one row whose three
 * parts each have a different natural width. It is measured, in `wireHeroFit`.
 *
 * And nothing truncates, hides or scrolls until every cheaper concession is
 * spent, in this order: whitespace, then type and column scale in proportion,
 * then word swaps, then wrapping. The headshot in particular does not vanish on
 * a phone — it shrinks to 65% and, below 460px, moves behind the name. A
 * reference header missing its figure is a worse product, not a smaller one.
 */

/**
 * A run of text in all three of its lengths.
 *
 * All three are in the HTML and CSS shows one, keyed off `data-scp-form` on
 * `.scp-hero-inner`. Two reasons it is not the client rewriting text nodes:
 * the page is complete before any script runs, so a reader with JS off gets
 * the full form and never a blank; and the probe can then render the same
 * markup at a forced form to measure what that form would cost, which is the
 * whole point — a variant has to be measured before it is chosen, or the
 * choice changes the width it was measured against.
 *
 * `display: none` on the two it is not showing, so exactly one is in the
 * accessibility tree and a screen reader reads the team's name once.
 */
function heroSwap(full: string, short: string, tight: string): string {
  return (
    `<span class="scp-swap scp-swap--full">${escapeHtml(full)}</span>` +
    `<span class="scp-swap scp-swap--short">${escapeHtml(short)}</span>` +
    `<span class="scp-swap scp-swap--tight">${escapeHtml(tight)}</span>`
  );
}

function renderHero(data: PlayerPageData, options: PlayerRenderOptions): string {
  const { player, team } = data;
  const Heading = options.embed ? "h2" : "h1";

  const teamPrefix = options.teamPathPrefix ?? "/team/";
  const query = options.linkQuery ?? "";

  // Position and club are the two facts that place a player, so they lead on
  // their own line. The measurements below them are the ones a reader scans
  // for rather than arrives for, and the jersey number goes with them.
  //
  // The club is the hero's one word swap: "New England Patriots" at full
  // width, "Patriots" when the row is tight, "NE" when it is tighter still.
  // Cheaper than shrinking the type beside it, which is why stage 3 spends it
  // before stage 5 touches the name's size.
  const billingParts: string[] = [];
  if (player.position) {
    // The position in the club's own colour, which is the one place on this
    // page the team's primary is used as ink rather than as a rule or a
    // wash. It is the first thing read in the line and the fact that places
    // the player, so it is the fact that takes the colour.
    billingParts.push(
      `<span class="scp-hero-pos">${escapeHtml(player.position)}</span>`,
    );
  }
  if (team) {
    billingParts.push(
      `<a class="scp-hero-team" href="${escapeHtml(
        `${teamPrefix}${team.slug}${query}`,
      )}" target="_top" title="${escapeHtml(team.fullName)}">` +
        heroSwap(team.fullName, team.nickname, team.code) +
        `</a>`,
    );
  }
  // The jersey number, last in the line of identity: it is the one fact here a
  // reader already knows the player by rather than one that places them, and
  // it leaves the line below as what it is, the measurements.
  if (player.number) billingParts.push(`#${escapeHtml(String(player.number))}`);

  const billing = billingParts.length
    ? `<p class="scp-hero-billing">` +
      billingParts.join(`<span class="scp-hero-sep"> ${DOT} </span>`) +
      `</p>`
    : "";

  /*
   * The measurements, and the one of them the header may give back.
   *
   * This line is usually the widest thing in the column — wider than the name
   * at 52px, because it is four facts and a name is one word — which makes it
   * the line that decides how much room the column needs, and so the only
   * line where a word swap can actually buy anything. Swapping the club's name
   * under a wider line than itself saves exactly nothing.
   *
   * "Exp 10 yrs" is what it gives back: the longest single item, the last one
   * a reader scans, and the one fact of the five that the Bio tab prints in
   * full a click away. It comes back the moment the room does. Nothing else
   * here is droppable — a height without a weight is not a smaller header,
   * it is a header missing a fact.
   */
  const factParts: string[] = [];
  if (player.age) factParts.push(`Age ${player.age}`);
  const height = formatHeight(player.height);
  if (height) factParts.push(height);
  if (player.weight) factParts.push(`${player.weight} lbs`);
  const factsShort = factParts.join(` ${DOT} `);
  if (player.years_exp !== null && player.years_exp !== undefined) {
    factParts.push(player.years_exp === 0 ? "Rookie" : `Exp ${player.years_exp} yrs`);
  }
  const factsFull = factParts.join(` ${DOT} `);
  const facts = factsFull
    ? `<p class="scp-hero-facts">` +
      (factsShort && factsShort !== factsFull
        ? heroSwap(factsFull, factsShort, factsShort)
        : escapeHtml(factsFull)) +
      `</p>`
    : "";

  // The draft, on the same terms the Bio tab prints it on: only when the year,
  // the round and the pick are all known. `draft.json` writes a null row both
  // for an undrafted player and for one whose draft simply is not recorded, so
  // a partial row says nothing rather than guessing which.
  //
  // Two lengths and then gone: the long form, an abbreviated one, and at the
  // tight form the line drops entirely — it is the least load-bearing fact in
  // the column, which is what makes it the right thing to spend first.
  const draft = data.bioProfile.draft;
  const draftFull =
    draft && draft.year && draft.round && draft.pick
      ? `Drafted ${draft.year}: Round ${draft.round}, Pick ${draft.pick}` +
        (draft.teamCode ? ` (${draft.teamCode})` : "")
      : "";
  const draftShort =
    draft && draft.year && draft.round && draft.pick
      ? `${draft.year}: Rd ${draft.round}, Pk ${draft.pick}`
      : "";

  // The current injury designation, which is the one piece of the hero that can
  // be urgent. Omitted entirely when there is none — never "Healthy", which is
  // a claim this data cannot support.
  const designation = player.injury_status
    ? `<div class="scp-hero-meta">` +
      `<span class="scp-hero-flag">${escapeHtml(player.injury_status)}</span>` +
      `</div>`
    : "";

  // The season the strip is a reading of, said once above it rather than
  // folded into all three labels — "2026 PPR PPG" three times is the year
  // shouted and the metric lost, and at 9.5px it wraps.
  /*
   * The panel, in three rows to a cell.
   *
   * Label above the figure rather than below it, which is the order a reader
   * needs them in: the label is the question and the figure is the answer, and
   * an answer read before its question has to be read twice. The third row is
   * what the figure was worth — the positional finish, or what the count is
   * out of — because a fantasy number without its rank is a number, not a
   * reading.
   *
   * The first cell takes the gold. It is the figure this header exists to
   * report, the same accent the open tab and the section rules use for "this
   * is the one", and it means the panel has a reading order rather than three
   * equal numbers competing.
   */
  const cells = heroStats(data);
  const strip = cells.length
    ? `<div class="scp-hero-stats">` +
      `<p class="scp-hero-stats-season">${escapeHtml(`${data.season} Season`)}</p>` +
      `<div class="scp-hero-stats-row">` +
      cells
        .map(
          (cell) =>
            `<div class="scp-hero-stat${cell.lead ? " is-lead" : ""}">` +
            `<span class="scp-hero-stat-label">${escapeHtml(cell.label)}</span>` +
            `<span class="scp-hero-stat-value">${escapeHtml(cell.value)}</span>` +
            `</div>`,
        )
        .join("") +
      `</div></div>`
    : "";

  // The club's mark, enormous and almost invisible, off the right edge inside
  // the card's gutter. Same device and the same 4% the production grid uses —
  // a page should not have two different ideas of how a watermark behaves.
  const watermark = team
    ? `<img class="scp-hero-mark" src="${escapeHtml(team.logo)}" alt=""` +
      ` aria-hidden="true" loading="lazy" decoding="async" width="200" height="200" />`
    : "";

  const rootStyle = styleAttr([
    team && `--team-primary:${team.primaryColor}`,
    team && `--team-secondary:${team.secondaryColor}`,
  ]);

  /*
   * The heading, in up to three spans.
   *
   * Given name and surname on one line, and — on a section-scoped URL — the
   * section's phrase under both, because "Jacoby Brissett Injury Update &
   * History" is what that page is about and what its H1 has to say. The spans
   * are separated by real spaces, so however the hero sets them the heading's
   * text is still the exact string the unscoped page's H1 has always been.
   * The section then drops its own heading; see renderInjury().
   *
   * No word swap on the name, and no measured "J. Brissett" fallback either.
   * A name is the one string on this page a reader came for, and an initial is
   * a worse answer than a smaller name or a second line; what the fitter has
   * to work with is its size, which is stage 5's last cut before the name is
   * allowed to wrap.
   */
  const { first, last } = splitName(player.name);
  const phrase = options.section
    ? sectionHeading(
        player.name,
        options.section,
        // Always the active season, including on the Game Log: ?log=2025 adds
        // 2025 under the selector, it does not turn this into the 2025 page.
        data.season,
      )
    : null;
  const rest = phrase ? phrase.slice(player.name.length).trim() : "";

  const title =
    (first ? `<span class="scp-title-first">${escapeHtml(first)}</span> ` : "") +
    `<span class="scp-title-last">${escapeHtml(last)}</span>` +
    (rest ? ` <span class="scp-title-rest">${escapeHtml(rest)}</span>` : "");

  const draftLine = draftFull
    ? `<p class="scp-hero-draft">` +
      `<span class="scp-swap scp-swap--full">${escapeHtml(draftFull)}</span>` +
      `<span class="scp-swap scp-swap--short">${escapeHtml(draftShort)}</span>` +
      `</p>`
    : "";

  /*
   * No probe in the HTML.
   *
   * The start/sit tool renders its measuring copies alongside the real ones,
   * which is the right call in a React tree where the two could otherwise
   * drift. Here the client clones the finished column instead — see
   * wireHeroFit — which is a stricter guarantee of the same thing and keeps
   * three duplicate copies of the player's name, club and draft out of a
   * document whose entire job is to be indexed for that name.
   */
  return (
    `<header class="scp-hero" data-scp-hero${rootStyle}>` +
    `<span class="scp-hero-decor" aria-hidden="true"></span>` +
    watermark +
    `<div class="scp-hero-inner" data-scp-form="full">` +
    renderHeadshot(data) +
    `<div class="scp-hero-text">` +
    `<${Heading} class="scp-title">${title}</${Heading}>` +
    billing +
    facts +
    draftLine +
    designation +
    `</div>` +
    strip +
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
 * The tab strip.
 *
 * Plain anchors switched by `:target` in CSS, exactly as the team hub does it:
 * every tab's content is in the initial HTML, the strip works with scripting
 * disabled, and the only URL state it can produce is a `#hash` — not a second
 * crawlable address for the same page. The tab roles and arrow-key behaviour
 * are added by client/player.ts, which can deliver what those roles promise.
 */
function renderNav(sections: Section[]): string {
  if (sections.length < 2) return "";
  const items = sections
    .map(
      (section, i) =>
        `<li><a class="scp-nav-link${i === 0 ? " is-active" : ""}"` +
        ` id="${escapeHtml(section.id)}-tab"` +
        ` href="#${escapeHtml(section.id)}">${escapeHtml(section.label)}</a></li>`,
    )
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
 * the page — it is not tool state to be hidden in a hash. `rel="nofollow"` and
 * the canonical on the PPR URL keep the three variants from becoming three
 * competing pages; PPR is the default and the one address that ranks.
 */
/**
 * This page's own URL, with one piece of its state changed.
 *
 * Every control that is a real link — the scoring toggle, the game log's season
 * selector — builds its href here, so none of them can drop the state the
 * others own. Assembling them by hand is how `?format=half` used to lose
 * `?embed=1`, which silently unframed the page it was rendered into.
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
  if (options.section) params.set("section", options.section);

  const format = changes.format ?? data.format;
  if (format !== "ppr") params.set("format", format);

  const log = changes.log ?? data.logSeason;
  if (log !== data.season) params.set("log", String(log));

  const query = params.toString();
  // The tab strip is :target-driven, so a control inside a panel has to name
  // that panel or following it reopens the page on the first tab — changing the
  // season on the game log and landing on Overview. A section-scoped URL has no
  // tab strip and needs no hash.
  const hash = !options.section && changes.hash ? `#${changes.hash}` : "";
  return `${prefix}${data.player.slug}${query ? `?${query}` : ""}${hash}`;
}

function renderFormatToggle(
  data: PlayerPageData,
  options: PlayerRenderOptions,
): string {
  const items = (["standard", "half", "ppr"] as ScoringFormat[])
    .map((format) => {
      const active = format === data.format;
      return (
        `<a class="scp-format-opt${active ? " is-active" : ""}"` +
        ` href="${escapeHtml(pageUrl(data, options, { format }))}"` +
        `${active ? ` aria-current="true"` : ` rel="nofollow"`}` +
        ` title="${escapeHtml(SCORING_LABELS[format])}">${escapeHtml(SCORING_SHORT[format])}</a>`
      );
    })
    .join("");
  return (
    `<div class="scp-format" data-scp-format>` +
    `<span class="scp-format-label">Scoring</span>${items}</div>`
  );
}

/* --------------------------------------------------------------- overview */

/* ----------------------------------------------------------------- overview */

/**
 * The Overview tab: what the numbers mean.
 *
 * It used to be a third arrangement of the same figures — 2026 totals, career
 * points per game, season-end finishes, efficiency rates, best week — all of
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
 * Every phrase on this tab is still derived from a measured number — the
 * thresholds are in lib/player/fantasy-read.ts — and the numbers themselves
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
function renderFantasySnapshot(data: PlayerPageData): string {
  const { stats, player, outlook } = data;
  if (!stats || stats.gamesPlayed === 0) return "";

  const badge = finishBadge(data.seasonRank, player.position);

  const reads: Array<{ label: string; value: string; mod: string }> = [];

  // Only when there IS a ranked finish. Without one this cell fell back to the
  // scoring rate, which is the next cell along — the same number twice under
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

  const sentence = seasonSentence({
    name: player.name,
    position: player.position,
    season: data.season,
    stats,
    seasonRank: data.seasonRank,
    td: data.tdDependency,
    efficiency: efficiencyReads(data).map((row) => ({
      label: row.label,
      phrase: row.phrase,
      percentile: row.percentile,
    })),
  });

  return (
    `<section class="scp-read-hero">` +
    // The page's section heading, the same one the Outlook tab and the Stats
    // tab open on. This was an 11px gold eyebrow, which is a label worn over a
    // display line — there is no display line here, only the strip, so the
    // eyebrow was the tab's <h2> set six sizes below every other heading.
    h2(`${data.season} Fantasy Snapshot`) +
    `<div class="scp-read-grid">` +
    reads
      .map(
        // The first reading is the page's answer, and it is set larger than the
        // three beside it. A strip of four identically weighted cells has no
        // winner, and a scouting sheet is read from its headline outwards.
        // Label first in the MARKUP and second on screen (the cell places the
        // two rows) — "Scoring rate, 16.5 PPG" is the order it has to be said
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
    (sentence ? `<p class="scp-read-line">${escapeHtml(sentence)}</p>` : "") +
    `</section>`
  );
}

/**
 * The efficiency rates, as READINGS rather than as a meter chart.
 *
 * The same three or four numbers the Stats tab now carries as bars, read back
 * as what they mean: "73.0% completion, 85th percentile — elite for the
 * position". Stats says the rate, this says whether it is any good.
 *
 * Returned as data rather than markup so the snapshot's sentence can pick the
 * best and worst out of the same list the section renders.
 */
interface EfficiencyRead {
  /** The column label — "TD per attempt". */
  label: string;
  /** How it reads mid-sentence — "touchdown rate". */
  phrase: string;
  value: string;
  percentile: number | null;
}

function efficiencyReads(data: PlayerPageData): EfficiencyRead[] {
  const { benchmarks, rates } = data;
  if (!benchmarks || !rates) return [];

  const isQB = benchmarks.position === "QB";
  const p = benchmarks.percentile;

  const reads: EfficiencyRead[] = [
    {
      label: isQB ? "Yards per attempt" : "Yards per catch",
      phrase: isQB ? "downfield efficiency" : "yards per catch",
      value: num(rates.yardsPerCatch),
      percentile: p?.yardsPerCatch ?? null,
    },
    {
      label: isQB ? "Completion rate" : "Catch rate",
      phrase: isQB ? "accuracy" : "his catch rate",
      value: pct(rates.catchPct),
      percentile: p?.catchPct ?? null,
    },
    {
      label: isQB ? "TD per attempt" : "TD per target",
      phrase: "touchdown rate",
      value: pct(rates.tdPerTarget, 1),
      percentile: p?.tdPerTarget ?? null,
    },
  ];

  if (isQB && rates.fpPerUsage !== undefined) {
    reads.push({
      label: "Points per usage",
      phrase: "scoring per dropback",
      value: num(rates.fpPerUsage, 2),
      percentile: p?.fpPerUsage ?? null,
    });
  }

  return reads;
}

/**
 * The efficiency rows, and the line that says what they are ranked against.
 *
 * ONE component, rendered on two tabs. Overview heads it "What Is Driving The
 * Production" and Stats heads it "Efficiency Profile", and underneath they are
 * the same four readings off the same four percentiles — which is exactly why
 * they must be the same markup. They were not: Stats drew a marker on a
 * percentile track with a two-word verdict in a fifth column, Overview drew a
 * phrase with the rate muted underneath, and the two disagreed about the order
 * of the metrics as well. Two renderings of one measurement is how a page ends
 * up contradicting itself over a rounding rule.
 */
function efficiencyRows(data: PlayerPageData): string {
  const reads = efficiencyReads(data);
  if (reads.length === 0) return "";

  const rows = reads
    .map((read) => {
      const meaning = percentileRead(read.percentile);
      return (
        `<div class="scp-dr-row" data-level="${escapeHtml(
          percentileLevel(read.percentile),
        )}">` +
        `<p class="scp-dr-label">${escapeHtml(read.label)}</p>` +
        `<div class="scp-dr-read">` +
        `<p class="scp-dr-value">${escapeHtml(meaning || read.value)}</p>` +
        // Unranked, the reading IS the raw rate, and the evidence line would
        // be the same string again underneath it. In four columns that read as
        // a rate with a unit under it; in two it reads as a mistake.
        (read.percentile === null
          ? ""
          : `<p class="scp-dr-detail">${escapeHtml(
              `${read.value} ${DOT} ${ordinal(read.percentile)} percentile`,
            )}</p>`) +
        `</div>` +
        `</div>`
      );
    })
    .join("");

  return `<div class="scp-dr">${rows}</div>`;
}

/** What the percentiles are measured against, or why there are none. */
function efficiencyNote(data: PlayerPageData): string {
  const marks = data.benchmarks;
  if (!marks) return "";
  return marks.playerQualified
    ? `Against every ${marks.position} with at least ${marks.qualifiedThreshold} ` +
      `${marks.position === "QB" ? "attempts" : "targets"} in ${marks.season}.`
    : `Not enough volume to rank against the position yet.`;
}

function renderProductionDrivers(data: PlayerPageData): string {
  const rows = efficiencyRows(data);
  if (!rows) return "";
  return (
    sectionHead("What Is Driving The Production", efficiencyNote(data)) + rows
  );
}

/**
 * The weekly identity: the range his weeks actually land in.
 *
 * Observed, and stamped with how many weeks it is drawn from. The Outlook tab
 * carries a PROJECTED floor/expected/ceiling that looks similar and means
 * something different; the labels and the stamp are what keep the two apart.
 */
function renderWeeklyProfile(data: PlayerPageData): string {
  const range = weeklyFinishRange(data.gameLog);
  const style = data.tdDependency;
  const position = data.player.position ?? "";
  const games = data.stats?.gamesPlayed ?? 0;

  if (!range && style.label === "N/A") return "";

  const spread = range
    ? `<div class="scp-spread">` +
      [
        { key: "floor", head: "Floor", rank: range.floor },
        { key: "typical", head: "Typical", rank: range.typical },
        { key: "ceiling", head: "Ceiling", rank: range.ceiling },
      ]
        .map(
          (step) =>
            `<div class="scp-spread-step" data-key="${step.key}">` +
            `<p class="scp-spread-head">${escapeHtml(step.head)}</p>` +
            `<p class="scp-spread-rank">${escapeHtml(`${position}${step.rank}`)}</p>` +
            `</div>`,
        )
        .join(`<span class="scp-spread-arrow" aria-hidden="true">&rarr;</span>`) +
      `</div>` +
      `<p class="scp-note">${escapeHtml(
        `Where his ${range.weeks} weeks actually finished. Measured, not projected.`,
      )}</p>`
    : // The count, not just the verdict: "too early" reads as a hedge, and
      // "1 game played" is the reason, which is the part worth printing.
      `<p class="scp-note">${escapeHtml(
        games > 0
          ? `${games} game${games === 1 ? "" : "s"} played ${DOT} not enough of a sample for a true range yet.`
          : "Not enough weeks yet to describe a range.",
      )}</p>`;

  const styleRow =
    style.label === "N/A"
      ? ""
      : `<p class="scp-styleline">` +
        `<span class="scp-styleline-label">Fantasy style</span>` +
        `<span class="scp-styleline-value">${escapeHtml(style.tag)}</span>` +
        `</p>`;

  return (
    sectionHead("Weekly Profile") +
    spread +
    renderDistribution(data) +
    styleRow
  );
}

/** The fantasy profile: six readings, and not one counting stat. */
function renderFantasyProfile(data: PlayerPageData): string {
  const { stats, outlook } = data;
  if (!stats || stats.gamesPlayed === 0 || !outlook.hasData) return "";

  const rows = fantasyProfile({
    stats,
    position: data.player.position,
    seasonRank: data.seasonRank,
    roleLabel: outlook.roleLabel,
    formLabel: outlook.formLabel,
    formDetail: outlook.formDetail,
    formDirection: outlook.formDirection,
    volatilityLabel: outlook.volatilityLabel,
    td: data.tdDependency,
  });

  return (
    sectionHead("Fantasy Profile") +
    /*
     * A two-column matrix rather than the Injury tab's full-width list.
     *
     * Six readings stacked one per row ran the height of a screen for six short
     * phrases — "Starter", "Low sample", "0% top-12" — none of which is wide
     * enough to earn a row of its own. Paired, the block is half as tall and
     * reads the way a scouting sheet does.
     *
     * The level ramp is the OVERVIEW ramp, which is the Injury tab's inverted:
     * there "high" is high risk and paints red, here a high ceiling rate is the
     * good end, and one shared ramp would tell a reader that a good ceiling is
     * a warning.
     */
    `<div class="scp-prof">` +
    rows
      .map(
        (row: ProfileRow) =>
          `<div class="scp-prof-cell" data-level="${escapeHtml(row.level ?? "")}">` +
          `<p class="scp-prof-label">${escapeHtml(row.label)}</p>` +
          `<p class="scp-prof-value">${escapeHtml(row.value)}</p>` +
          `<p class="scp-prof-detail">${escapeHtml(row.detail)}</p>` +
          `</div>`,
      )
      .join("") +
    `</div>`
  );
}

/**
 * Career Context in one strip, and a way through to the rest.
 *
 * One line rather than the four-tile career block that used to sit here: the
 * career rates, the season finishes and the full year-by-year table are all on
 * Stats now, and duplicating their headline here would rebuild the overlap this
 * split exists to remove. The link is the point of the section.
 */
function renderCareerContext(
  data: PlayerPageData,
  options: PlayerRenderOptions,
): string {
  /*
   * Read off the SAME rows the Stats tab's career table is built from.
   *
   * Not careerProfile, which is derived from the game logs and therefore covers
   * only the four seasons those files reach back to. Using it here printed
   * "Career 12.3 PPG" on Overview beside "10.1" on Stats — the same player's
   * career average, two numbers, one page, because the two blocks counted
   * different seasons. One source or they will drift again.
   */
  const { career, totals } = data.statsProfile;
  if (career.length === 0) return "";

  const best = career.reduce<number | null>(
    (pick, row) =>
      row.finish !== null && (pick === null || row.finish < pick) ? row.finish : pick,
    null,
  );

  const parts = [
    `${career.length} season${career.length === 1 ? "" : "s"}`,
    best !== null ? `Best finish ${data.player.position ?? ""}${best}` : "",
    totals.gamesPlayed > 0 ? `Career ${num(totals.ppg)} PPG` : "",
  ].filter(Boolean);

  if (parts.length === 0) return "";

  // Into the Stats tab's own URL when one is configured, otherwise the in-page
  // anchor — both work, and the anchor works with scripting disabled.
  const prefix = options.playerPathPrefix ?? "/player/";
  const href = `${prefix}${data.player.slug}${options.linkQuery ?? ""}#stats`;

  return (
    sectionHead("Career Context") +
    `<p class="scp-strip">` +
    `<span class="scp-strip-stats">${escapeHtml(parts.join(` ${DOT} `))}</span>` +
    `<a class="scp-crosslink" href="${escapeHtml(href)}">` +
    escapeHtml("View full career stats") +
    ` &rarr;</a></p>`
  );
}

/** Where this player's weeks landed, as one stacked bar. */
function renderDistribution(data: PlayerPageData): string {
  const { stats, player } = data;
  if (!stats || stats.gamesPlayed === 0) return "";

  const segments: StackSegment[] = (
    ["pos1", "pos2", "pos3", "bust"] as WeeklyTier[]
  ).map((tier) => ({
    tier,
    label: weeklyTierLabel(tier, player.position),
    pct:
      tier === "pos1"
        ? stats.pos1Pct
        : tier === "pos2"
          ? stats.pos2Pct
          : tier === "pos3"
            ? stats.pos3Pct
            : stats.bustPct,
    games:
      tier === "pos1"
        ? stats.pos1Games
        : tier === "pos2"
          ? stats.pos2Games
          : tier === "pos3"
            ? stats.pos3Games
            : stats.bustGames,
  }));

  if (segments.every((s) => s.pct === 0)) return "";

  const gooseEgg =
    stats.gooseEggPct > 0
      ? `<p class="scp-note">${escapeHtml(
          `${pct(stats.gooseEggPct)} of games finished with no fantasy points.`,
        )}</p>`
      : "";

  // No heading of its own: this is the evidence under "Weekly Profile", and a
  // second section head immediately below that one read as two blocks saying
  // the same thing.
  return (
    `<p class="scp-subhead">${escapeHtml("Where his weeks landed")}</p>` +
    renderStackedBar(segments, { slim: true, showEmpty: true }) +
    gooseEgg
  );
}

/** Weekly points and the trailing average, for the weeks actually played. */
function renderTrend(data: PlayerPageData): string {
  const played = data.gameLog.filter((e) => e.game_status === "active");
  if (played.length < 2) return "";

  const points: SparkPoint[] = played.map((entry) => ({
    week: entry.week,
    opp: entry.opp,
    value: fpts(entry, data.format),
  }));

  return (
    h3("Week By Week") +
    renderSparkline(points, rollingAverage(points.map((p) => p.value), 3))
  );
}


/**
 * Efficiency Profile — the Overview tab's block, under a Stats tab heading.
 *
 * It used to be its own thing: a rate, a marker on a percentile track, the
 * ordinal, and a two-word verdict in a fifth column. That is four columns of
 * chrome around the one sentence a reader wants, and the same four numbers
 * already read better one tab over, where the READING is the value and the
 * rate is its evidence. Two designs for one measurement is not two viewpoints,
 * it is a drift waiting to happen — so this is now literally the same markup,
 * from the same function, in the same order.
 *
 * What is left here that Overview does not have is the scoring style, which is
 * about where the points came FROM rather than how efficiently they were
 * earned. It takes the same line treatment Overview gives "Fantasy style".
 */
function renderProduction(data: PlayerPageData): string {
  const td = data.tdDependency;
  const rows = efficiencyRows(data);

  const style =
    td.label === "N/A"
      ? ""
      : `<p class="scp-styleline">` +
        `<span class="scp-styleline-label">Scoring style</span>` +
        `<span class="scp-styleline-value">${escapeHtml(td.label)}</span>` +
        `<span class="scp-styleline-sub">${escapeHtml(
          `${pct(td.pct)} of fantasy points came from touchdowns`,
        )}</span>` +
        `</p>`;

  if (!rows && !style) return "";

  return (
    sectionHead("Efficiency Profile", efficiencyNote(data)) + rows + style
  );
}

/**
 * Role Direction: the usage metrics that define this position, recent vs season.
 *
 * Usage rather than production, deliberately. Points are the outcome and
 * touches are the input, and a role that is growing shows up in the input
 * first — which is the only reason a "trending" section is worth printing at
 * all. Metrics marked `context` are the team's behaviour rather than the
 * player's, and are labelled as such instead of being scored as their doing.
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

/**
 * The career aggregate.
 *
 * Two sources, and the section used to read entirely off the wrong one.
 * `careerProfile` is derived from the game logs — so when those started at
 * 2023, "Career PPG 12.3 · 4 seasons" printed directly beneath a career table
 * whose own total row said 10.1 across eleven. Two numbers for one player's
 * career average, on one screen, because the block under the table counted a
 * different career than the table did.
 *
 * So the split is by what each figure NEEDS:
 *
 *   points per game, availability   sums over seasons -> statsProfile, the
 *                                   same rows the table above is built from,
 *                                   which is what makes the two agree.
 *   top-12 weeks, weekly swing      need to know what a week is -> the game
 *                                   logs, and therefore only the seasons they
 *                                   reach back to.
 *
 * The logs now reach as far back as the career table does, so for most players
 * the two windows are one window and neither cell says anything about it. When
 * they are NOT — a season production filed that the weekly stats have no
 * entries for — the shorter pair says so AT the number rather than in a
 * footnote, because a reader weighing "35%" against the eleven seasons in the
 * table above has to be told, at the figure, that this one covers fewer.
 *
 * Derived by comparing the two counts rather than written down, so it corrects
 * itself when the data changes instead of naming a year that was true on the
 * day someone typed it.
 */
function renderCareerSnapshot(data: PlayerPageData): string {
  const profile = data.careerProfile;
  const { totals, career } = data.statsProfile;
  const availability = careerAvailability(career, data.season);

  const cells: RailCell[] = [];

  if (totals.gamesPlayed > 0) {
    cells.push({
      value: num(totals.ppg),
      label: "Career PPG",
      sub:
        `${totals.seasons} season${totals.seasons === 1 ? "" : "s"} · ` +
        `${count(totals.gamesPlayed)} games`,
    });
  }

  if (availability) {
    cells.push({
      value: pct(availability.pct),
      label: "Availability",
      sub: `${count(availability.played)} of ${count(availability.possible)} games`,
    });
  }

  if (profile) {
    /*
     * The sample is printed only when it is a SHORTER one.
     *
     * Covering the same seasons, the two sources still disagree about the
     * count by a game or two — production files a game the weekly stats have
     * no qualifying line for — and "108 games" under a cell whose neighbour
     * says "110 games" is the same puzzle this section was just fixed for, in
     * miniature. When the window matches, the count is not the point and does
     * not appear; when it is short, it is the whole point and leads.
     */
    const from = Math.min(...profile.seasonPpgs.map((entry) => entry.season));
    const short = profile.seasons < totals.seasons;
    const window = short ? `${count(profile.gamesPlayed)} games since ${from}` : "";

    cells.push({
      value: pct(profile.pos1Pct),
      label: `Top-12 ${data.player.position ?? ""} weeks`.trim(),
      sub: short ? window : "Share of games played",
    });
    cells.push({
      value: num(profile.volatility),
      label: "Weekly swing",
      sub: short
        ? `${profile.volatilityLabel} · ${window}`
        : `${profile.volatilityLabel} · weekly SD`,
    });
  }

  if (cells.length === 0) return "";

  const caveat = profile?.smallSample
    ? `<p class="scp-note">${escapeHtml(
        `The weekly rates are drawn from ${profile.gamesPlayed} games and are too small a sample to read as a tendency.`,
      )}</p>`
    : "";

  return sectionHead("Career Rates") + renderRail(cells) + caveat;
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
 * logs and the draft table — no coach names, no adjectives nobody measured, no
 * claims the numbers do not support. It is rendered defensively because it is
 * the one data file whose shape is free-form.
 */
/* ------------------------------------------------------------------ bio */

/*
 * The Bio tab — a player dossier, and nothing else.
 *
 * Every other tab here answers a fantasy question. This one answers "who is
 * he?", and the most valuable thing about it is what it leaves out: no points
 * per game, no efficiency, no start/sit, no injury risk. A page that mixes
 * "6 feet 4 inches" with "TD-dependent ceiling" is topically two pages and
 * ranks as well as neither.
 *
 * Three blocks, in the order the question gets answered:
 *
 *   1. a short factual story — who he is, in a paragraph
 *   2. the career timeline — every club, with its years and its badge
 *   3. the questions, answered directly
 *
 * The labelled fact grid — age, height, weight, born, college, high school,
 * experience, draft — used to sit between one and two, and every one of those
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
 * college sits at the top with no years — we know where a player went, not
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
 *   COUNT   how long it lasted — right-aligned, against the far edge
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

  const collegeStop = college
    ? `<li class="scp-stint" data-kind="college">` +
      `<span class="scp-stint-mark" aria-hidden="true"></span>` +
      `<span class="scp-stint-years">College</span>` +
      `<span class="scp-stint-body">` +
      `<span class="scp-stint-head">` +
      `<span class="scp-stint-name">${escapeHtml(college)}</span>` +
      `</span></span></li>`
    : "";

  const stops = stints
    .map((stint) => {
      const logo = stint.team
        ? `<img class="scp-stint-logo" src="${escapeHtml(stint.team.logo)}" alt=""` +
          ` width="28" height="28" loading="lazy" decoding="async" />`
        : "";

      // The second line, when the stop has something to say beyond its years.
      // Both halves are rare — most stints are a club and a date range — so
      // the line is emitted only when one of them is there, never as an empty
      // row of air under every stop.
      const sub = [stint.note, stint.detail].filter(Boolean).join(" · ");

      return (
        `<li class="scp-stint" data-kind="nfl"${stint.current ? ` data-current="1"` : ""}>` +
        `<span class="scp-stint-mark" aria-hidden="true"></span>` +
        `<span class="scp-stint-years">${escapeHtml(stint.years)}</span>` +
        `<span class="scp-stint-body">` +
        `<span class="scp-stint-head">` +
        logo +
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
): string {
  if (data.bioProfile.empty) return "";

  const narrative = renderBioNarrative(data);
  const timeline = renderCareerTimeline(data);
  const faq = renderFaq(
    data.bioProfile.faq,
    options,
    `${data.player.name} FAQ`,
  );

  if (!narrative && !timeline && !faq) return "";

  // Scoped to its own URL the hero already says this; see renderPlayerPage().
  const heading =
    options.section === "bio"
      ? ""
      // No subtitle: it listed the facts of the table directly beneath it.
      : h2(`${data.player.name} Bio`);

  return heading + narrative + timeline + faq;
}

/* ------------------------------------------------------------------ outlook */

/**
 * The Outlook tab.
 *
 * Every other tab on this page answers "what happened". This one answers the
 * only question a fantasy manager actually arrives with — what should I expect
 * from here, and what do I do with him — and it is the one place on the page
 * where the answer is allowed to be forward-looking. Rule 3 at the top of this
 * file is not suspended here so much as quarantined to here: the tab is named
 * for the season it is about, the projected numbers are labelled as projections,
 * and the measured strip beneath them is stamped with the season it was
 * measured from, so the two can never be read as the same kind of claim.
 *
 * Six blocks, in the order a decision gets made:
 *
 *   1. the head — role, rest-of-season call, confidence, and the written read
 *   2. what drives it — four measured cards, adapted to the position
 *   3. the range of outcomes — floor, expected, ceiling, on one spectrum
 *   4. what moves it — upside triggers against warning signs
 *   5. how to use him — by format, and when not to
 *   6. the verdict
 *
 * Blocks 1, 3, 4, 5 and 6 are authored (fantasy_outlook_2026.json) and block 2
 * is measured; a record written before the decision layer existed carries none
 * of the authored fields, and every one of those blocks then renders as
 * nothing. That is the page's first rule holding: a tab with a headline, a body
 * and four driver cards is a smaller tab, not a tab full of empty labels.
 */

/** The confidence chip's three steps, lowercased for the attribute. */
function confidenceLevel(value: string | undefined): string {
  const level = (value ?? "").toLowerCase();
  return level === "high" || level === "moderate" || level === "low" ? level : "";
}

/**
 * The head: the written read, opening the tab.
 *
 * The chips are the whole tab in one line, and under them is the outlook
 * itself, whole. There is no quick take and no repeated name: the hero above
 * has already said who this is, and a two-sentence summary sitting six inches
 * above the two paragraphs it summarises is the same argument twice.
 *
 * No slab around it any more. A raised card is how this page marks a thing
 * that stands apart from the column it sits in, and the written read is the
 * opposite of that — it is the first section of the tab, and it now opens the
 * way every other section on the page opens: the shared h2 and its gold rule,
 * with the prose running flush underneath. The card was also nesting a box in
 * a box, since the chips carry their own frame.
 */
function renderOutlookHead(data: PlayerPageData): string {
  const outlook = data.fantasyOutlook2026;

  const chips: Array<{ label: string; value: string; mod: string }> = [];
  if (outlook?.weeklyRole) {
    chips.push({ label: "Weekly role", value: outlook.weeklyRole, mod: "" });
  }
  if (outlook?.restOfSeason) {
    chips.push({
      label: "Rest-of-season outlook",
      value: outlook.restOfSeason,
      mod: "lead",
    });
  }
  if (outlook?.confidence) {
    chips.push({
      label: "Confidence",
      value: outlook.confidence,
      mod: confidenceLevel(outlook.confidence),
    });
  }

  // Split on the blank line the generator writes between its two paragraphs,
  // so they are two paragraphs here rather than one with a newline in it.
  const paragraphs = (outlook?.body ?? "")
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (chips.length === 0 && paragraphs.length === 0) return "";

  // The outlook stamps its own season, so the heading cannot drift from the
  // record it is heading; data.season is the stats year and only the fallback.
  const season = outlook?.season ?? data.season;

  return (
    `<section class="scp-outlook-head">` +
    h2(`${season} Outlook`) +
    (chips.length
      ? `<div class="scp-verdict-chips">` +
        chips
          .map(
            (chip) =>
              `<div class="scp-chip" data-mod="${escapeHtml(chip.mod)}">` +
              `<p class="scp-chip-label">${escapeHtml(chip.label)}</p>` +
              `<p class="scp-chip-value">${escapeHtml(chip.value)}</p>` +
              `</div>`,
          )
          .join("") +
        `</div>`
      : "") +
    (paragraphs.length
      ? `<div class="scp-take">` +
        // The headline only runs when there is an authored quick take behind
        // it; without one it is a twelve-word restatement of the paragraph
        // directly beneath it.
        (outlook?.headline && outlook?.quickTake
          ? `<p class="scp-outlook-headline">${escapeHtml(outlook.headline)}</p>`
          : "") +
        paragraphs
          .map((part) => `<p class="scp-take-body">${escapeHtml(part)}</p>`)
          .join("") +
        `</div>`
      : "") +
    `</section>`
  );
}

/**
 * The four measured cards — an editorial strip, not four rounded boxes.
 *
 * Divided by hairlines rather than bordered individually: four bordered cards
 * in a row read as four unrelated facts, and these are four readings of one
 * player. The categories are chosen by position in lib/player/outlook-drivers.ts
 * and every value on them is a real number, so the section is stamped with the
 * season it was measured from and never borrows the tab's forward-looking voice.
 */
function renderOutlookDrivers(data: PlayerPageData): string {
  const drivers = data.outlookDrivers;
  if (drivers.length === 0) return "";

  const season = driverSeason(data.fantasyOutlook2026);
  const subtitle = season
    ? `Measured from the ${season} season, against every other ${
        data.player.position ?? "player"
      } who played it.`
    : "Measured from the player's most recent advanced line.";

  const cells = drivers
    .map(
      (driver) =>
        `<div class="scp-driver" data-level="${escapeHtml(driver.level)}">` +
        `<p class="scp-driver-label">${escapeHtml(driver.label)}</p>` +
        `<p class="scp-driver-value">${escapeHtml(driver.value)}</p>` +
        `<p class="scp-driver-detail">${escapeHtml(driver.detail)}</p>` +
        (driver.context
          ? `<p class="scp-driver-context">${escapeHtml(driver.context)}</p>`
          : "") +
        `</div>`,
    )
    .join("");

  return (
    h3("What Drives The Outlook") +
    `<p class="scp-sub">${escapeHtml(subtitle)}</p>` +
    `<div class="scp-drivers" data-count="${drivers.length}">${cells}</div>`
  );
}

/**
 * The range of outcomes, as one spectrum.
 *
 * Deliberately not three cards. Three cards say floor, expected and ceiling are
 * three separate facts; one axis says they are three points on the same one,
 * which is what a range is and is the whole reason the section is worth having.
 *
 * The axis runs worst rank on the left to best on the right — ranks invert, so
 * the axis is drawn on `worst - rank` and every position below is a percentage
 * of that span. The expected band is a painted segment rather than a point,
 * because a projection precise to one rank is a precision nobody has.
 */
function renderOutlookRange(data: PlayerPageData): string {
  const range = data.fantasyOutlook2026?.range;
  if (!range) return "";

  const { floor, expected, ceiling } = range;
  const pos = data.player.position ?? "";
  const bands = [floor, expected, ceiling];
  if (bands.some((band) => !band || !Number.isFinite(band.best) || !Number.isFinite(band.worst))) {
    return "";
  }

  // The axis is the whole claim, floor's bad end to ceiling's good end. A record
  // whose bands were authored inconsistently — a ceiling worse than the floor —
  // would divide by zero or draw backwards, so it is dropped instead.
  const worst = Math.max(floor.worst, expected.worst, ceiling.worst);
  const best = Math.min(floor.best, expected.best, ceiling.best);
  const span = worst - best;
  if (span <= 0) return "";

  /** Where a rank sits on the axis, 0% at the worst end. */
  const at = (rank: number): number =>
    Math.min(100, Math.max(0, ((worst - rank) / span) * 100));

  const label = (band: OutlookBand): string =>
    band.best === band.worst
      ? `${pos}${band.best}`
      : `${pos}${band.best}–${band.worst}`;

  const bandLeft = at(expected.worst);
  const bandWidth = at(expected.best) - bandLeft;
  const marker = at((expected.best + expected.worst) / 2);

  const notes = [
    { key: "floor", head: "Floor", band: floor },
    { key: "expected", head: "Expected", band: expected },
    { key: "ceiling", head: "Ceiling", band: ceiling },
  ]
    .map(
      (entry) =>
        `<div class="scp-range-note" data-key="${entry.key}">` +
        `<p class="scp-range-head">${escapeHtml(entry.head)}</p>` +
        `<p class="scp-range-rank">${escapeHtml(label(entry.band))}</p>` +
        (entry.band.note
          ? `<p class="scp-range-why">${escapeHtml(entry.band.note)}</p>`
          : "") +
        `</div>`,
    )
    .join("");

  return (
    h3("Range Of Outcomes") +
    `<p class="scp-sub">${escapeHtml(
      `Projected ${OUTLOOK_SEASON} positional finish. A range, not a number — nobody has the number.`,
    )}</p>` +
    `<div class="scp-range">` +
    `<div class="scp-range-axis">` +
    `<span class="scp-range-end is-floor">${escapeHtml(label(floor))}</span>` +
    `<span class="scp-range-track">` +
    `<span class="scp-range-band" style="${escapeHtml(
      `left:${bandLeft.toFixed(2)}%;width:${Math.max(bandWidth, 1).toFixed(2)}%`,
    )}"></span>` +
    `<span class="scp-range-marker" style="${escapeHtml(
      `left:${marker.toFixed(2)}%`,
    )}"><span class="scp-range-marker-label">${escapeHtml(label(expected))}</span></span>` +
    `</span>` +
    `<span class="scp-range-end is-ceiling">${escapeHtml(label(ceiling))}</span>` +
    `</div>` +
    `<div class="scp-range-notes">${notes}</div>` +
    `</div>`
  );
}

/**
 * What Moves The Outlook.
 *
 * Two columns of plain text under two headings, split by a rule. Not a green
 * box and a red box: the two lists are not a good thing and a bad thing, they
 * are the two directions the same season can go, and colouring them as a verdict
 * makes the page assert something the bullets themselves do not.
 *
 * It is also the block that ages best — these are the lines to rewrite in
 * October, without touching anything else on the tab.
 */
function renderOutlookMoves(data: PlayerPageData): string {
  const outlook = data.fantasyOutlook2026;
  const upside = outlook?.upsideTriggers?.filter((line) => line.trim()) ?? [];
  const warning = outlook?.warningSigns?.filter((line) => line.trim()) ?? [];
  if (upside.length === 0 && warning.length === 0) return "";

  const column = (
    head: string,
    mark: string,
    lines: string[],
    key: string,
  ): string =>
    lines.length
      ? `<div class="scp-moves-col" data-key="${key}">` +
        `<p class="scp-moves-head">` +
        `<span class="scp-moves-mark" aria-hidden="true">${mark}</span>` +
        `${escapeHtml(head)}</p>` +
        `<ul class="scp-moves-list">` +
        lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("") +
        `</ul></div>`
      : "";

  return (
    h3("What Moves The Outlook") +
    `<div class="scp-moves">` +
    column("Upside triggers", "&uarr;", upside, "up") +
    column("Warning signs", "&darr;", warning, "down") +
    `</div>`
  );
}

/**
 * How To Use Him.
 *
 * The practical section, and the one most likely to be the only thing a reader
 * came for. The two format labels adapt by position because the two questions
 * do: a quarterback's managers are asking about one-QB against superflex, and
 * everybody else's are asking about a standard league against a deep one.
 */
function renderOutlookUsage(data: PlayerPageData): string {
  const usage = data.fantasyOutlook2026?.usage;
  if (!usage) return "";

  const isQb = data.player.position === "QB";
  const rows = [
    { label: isQb ? "1QB leagues" : "12-team", value: usage.standard },
    { label: isQb ? "Superflex" : "Deep leagues", value: usage.deep },
    { label: "Best when", value: usage.bestWhen },
    { label: "Avoid when", value: usage.avoidWhen },
  ].filter((row) => (row.value ?? "").trim());

  if (rows.length === 0) return "";

  return (
    h3("How To Use Him") +
    `<dl class="scp-usage">` +
    rows
      .map(
        (row) =>
          `<div class="scp-usage-row">` +
          `<dt class="scp-usage-label">${escapeHtml(row.label)}</dt>` +
          `<dd class="scp-usage-value">${escapeHtml(row.value)}</dd>` +
          `</div>`,
      )
      .join("") +
    `</dl>`
  );
}

/**
 * The closing call.
 *
 * The one navy block on a white-first page, and the last thing in the tab. It
 * is a slab rather than a card because it is the conclusion rather than another
 * reading, and because the tab has to end on something that looks like an
 * answer. `data-tone` is derived from the call's own words rather than authored
 * separately — an author who writes "Sell" should not also have to remember to
 * mark it as a caution.
 */
function verdictTone(call: string): string {
  const text = call.toLowerCase();
  if (/\b(buy|start|must)\b/.test(text)) return "positive";
  if (/\b(sell|avoid|drop|fade|bench)\b/.test(text)) return "caution";
  return "neutral";
}

function renderOutlookVerdict(data: PlayerPageData): string {
  const verdict = data.fantasyOutlook2026?.verdict;
  if (!verdict?.call) return "";

  return (
    `<section class="scp-final" data-tone="${escapeHtml(verdictTone(verdict.call))}">` +
    `<p class="scp-final-label">StatChasers verdict</p>` +
    `<p class="scp-final-call">${escapeHtml(verdict.call)}</p>` +
    (verdict.rationale
      ? `<p class="scp-final-body">${escapeHtml(verdict.rationale)}</p>`
      : "") +
    `</section>`
  );
}

/** The whole tab, in the order a decision gets made. */
function renderOutlook2026(data: PlayerPageData): string {
  const head = renderOutlookHead(data);
  const drivers = renderOutlookDrivers(data);
  const range = renderOutlookRange(data);
  const moves = renderOutlookMoves(data);
  const usage = renderOutlookUsage(data);
  const verdict = renderOutlookVerdict(data);

  // The head carries the tab's <h2> and the written read, so a record with
  // nothing but a body still has a tab worth rendering.
  if (!head && !drivers && !range && !moves && !usage && !verdict) return "";

  return (
    head +
    drivers +
    range +
    moves +
    usage +
    verdict
  );
}

/* --------------------------------------------------------------- game log */

/*
 * What this tab is and is not.
 *
 * It answers one question — "show me every game he played and what he did" —
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
 * A ratio prints as a box score writes it — 27/37, not 0.73 — because that is
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
 * The season selector, and — on a scoped URL — the scoring toggle.
 *
 * Every season is a link rather than page state, for the reason the format
 * toggle is: it changes every number in the table. They carry `rel="nofollow"`
 * and the canonical stays on the profile, so one game log is the page that
 * ranks and `?log=2023` is a rendering of it rather than a second address
 * competing with it. Revisit if Search Console ever shows real demand for
 * "<player> 2023 game log" as its own query.
 *
 * The format toggle is repeated here ONLY on the section-scoped page, which has
 * no control bar above it. On the full profile it is already in the header and
 * a second copy would be two controls for one piece of state.
 */
function renderLogControls(
  data: PlayerPageData,
  options: PlayerRenderOptions,
): string {
  // The season switcher used to sit here, between the heading and the numbers.
  // It is an ARCHIVE, and an archive at the top of a page asks a reader which
  // year they want before showing them the one they asked for — see
  // renderLogSeasons(), which now draws it under the fixtures.
  const toggle =
    options.section === "game-log" ? renderFormatToggle(data, options) : "";

  if (!toggle) return "";
  return `<div class="scp-logbar">${toggle}</div>`;
}

/**
 * The other seasons, at the bottom.
 *
 * Two changes from the control bar this replaces, and they are the same
 * change: the block is a way OUT of this page rather than a setting on it.
 *
 * It sits under the fixtures because that is where a reader runs out of this
 * season — the weeks played, then the weeks coming, then "and here are his
 * other years". At the top it was a row of eleven years standing between a
 * heading that had just named 2026 and the 2026 numbers that answer it.
 *
 * It is not a block of its own down there either: the caller puts it on the
 * heading row of the block it opens — "Career By Season" under All, the year's
 * own heading when one is pinned — so the row of years and the name of what
 * they produced are one line rather than two stacked sections.
 *
 * And the active season is not in the list. A switcher offers somewhere to go;
 * the year the tab above is already showing is not somewhere to go. What is
 * left is exactly the archive — which is also exactly the list the game-log
 * FAQ's "previous seasons" answer is built from, so the two cannot disagree.
 *
 * Picking one of them no longer navigates away from the season on screen: it
 * opens that year underneath, and the chip lights up to say which. See
 * renderArchiveSeason().
 *
 * "All" leads the row and is where the selector rests. A bare row of eleven
 * years had no unselected state to show, so the block below it was empty until
 * the reader guessed that a year was clickable; All gives the default a name
 * and puts the career table under it — every season on one screen, which is
 * the question a list of eleven years is usually being asked. Picking a year
 * swaps that one block, and All is the way back. See renderLogCareer().
 */
function renderLogSeasons(
  data: PlayerPageData,
  options: PlayerRenderOptions,
): string {
  // The ACTIVE season is never a chip: it is the tab, always on screen above
  // this, and offering it would be offering the reader where they already are.
  // The pinned year IS a chip, and it is the lit one — it is the selector's
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
  // build the same href — one to leave, one to stay put.
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
  // years, and the row now sits on the heading of the block it opens — which
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
 * games PLAYED — per-game over weeks on a roster measures availability while
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
 * The season in one sentence, assembled from the totals of the weeks played.
 *
 * Generated rather than written, so it stays true as the season runs, and
 * deliberately not an essay: it exists to give the table a sentence of context
 * and to say in words what the columns say in numbers. No superlatives and no
 * claim about what happens next — rule 3.
 */
function seasonStatLine(entries: GameLogEntry[], position: string | null): string {
  const sum = (key: string): number =>
    entries.reduce((total, entry) => total + (statOf(entry, key) ?? 0), 0);
  const plural = (n: number, one: string, many: string): string =>
    `${whole(n)} ${n === 1 ? one : many}`;

  if (position === "QB") {
    const rushYd = sum("rush_yd");
    const rushTd = sum("rush_td");
    const passing =
      `completing ${whole(sum("pass_cmp"))} of ${whole(sum("pass_att"))} passes ` +
      `for ${whole(sum("pass_yd"))} yards with ` +
      `${plural(sum("pass_td"), "touchdown", "touchdowns")} and ` +
      `${plural(sum("pass_int"), "interception", "interceptions")}`;
    if (rushYd <= 0 && rushTd <= 0) return passing;
    // A zero is only worth printing where its absence is the fact — an
    // interception count is, a rushing touchdown count on a pocket passer is
    // not, and "and 0 rushing touchdowns" is a clause that says nothing.
    return (
      `${passing}, and adding ${whole(rushYd)} rushing yards` +
      (rushTd > 0
        ? ` and ${plural(rushTd, "rushing touchdown", "rushing touchdowns")}`
        : "")
    );
  }

  if (position === "RB") {
    const rec = sum("rec");
    const rushing =
      `carrying ${whole(sum("rush_att"))} times for ${whole(sum("rush_yd"))} yards ` +
      `and ${plural(sum("rush_td"), "touchdown", "touchdowns")}`;
    return rec > 0
      ? `${rushing}, with ${plural(rec, "catch", "catches")} for ` +
          `${whole(sum("rec_yd"))} yards and ` +
          `${plural(sum("rec_td"), "touchdown", "touchdowns")}`
      : rushing;
  }

  if (position === "WR" || position === "TE") {
    return (
      `catching ${whole(sum("rec"))} of ${whole(sum("rec_tgt"))} targets ` +
      `for ${whole(sum("rec_yd"))} yards and ` +
      `${plural(sum("rec_td"), "touchdown", "touchdowns")}`
    );
  }

  if (position === "K") {
    return (
      `making ${whole(sum("fgm"))} of ${whole(sum("fga"))} field goals ` +
      `and ${whole(sum("xpm"))} of ${whole(sum("xpa"))} extra points`
    );
  }

  return "";
}

/**
 * The season in prose, under the tiles that just gave it in figures.
 *
 * Two paragraphs that were once at opposite ends of the tab: the totals
 * sentence sat under the tiles and the per-game summary sat below the table,
 * three screens apart, each describing the same season to a reader who had
 * long since started reading rows. Together and above the table they are what
 * the tab is about, in words — read after the tiles rather than before them,
 * because the grid is the faster answer and the prose is the one that can say
 * what the numbers were made of.
 *
 * They stay two paragraphs and stay in this order because they say different
 * things: the first ADDS the season up — 27 of 37, 277 yards, worth 16.5
 * points — and the second DIVIDES it, into per-game rates and how many of those
 * weeks were startable. One paragraph doing both would switch between totals
 * and averages mid-sentence, which is the one way a stat line can lie without
 * printing a wrong number.
 */
function renderLogIntro(data: PlayerPageData): string {
  const lede = logLedeSentence(data);
  const summary = logSummarySentences(data);
  if (!lede && !summary) return "";

  return (
    `<div class="scp-logintro">` +
    (lede ? `<p class="scp-lede">${escapeHtml(lede)}</p>` : "") +
    (summary ? `<p class="scp-note">${escapeHtml(summary)}</p>` : "") +
    `</div>`
  );
}

function logLedeSentence(data: PlayerPageData): string {
  const stats = data.seasonLogStats;
  if (!stats || stats.gamesPlayed === 0) return "";

  const played = playedWeeks(data);
  const line = seasonStatLine(played, data.player.position);
  const games = `${stats.gamesPlayed} ${stats.gamesPlayed === 1 ? "game" : "games"}`;

  // The total, not the average: the summary under the table is the one that
  // talks in per-game terms, and two paragraphs on one page saying "16.5 points
  // per game" is one paragraph too many.
  const sentence =
    `${data.player.name} has played ${games} in ${data.logSeason}` +
    (line ? `, ${line}` : "") +
    `. That is worth ${num(stats.totalPts)} ${SCORING_LABELS[data.format]} ` +
    `fantasy points.`;

  return sentence;
}

/**
 * What one week's points were made of.
 *
 * The coefficients from scoring.ts, itemised. The total this is printed under
 * can come from Sleeper and carries scoring the breakdown does not model —
 * return yardage, two-point conversions, fumbles — so the difference is printed
 * as its own line rather than folded into one of the others. A breakdown that
 * quietly balances itself is worth less than one that shows where it cannot.
 */
function renderScoringBreakdown(entry: GameLogEntry, format: ScoringFormat): string {
  const parts = pointsBreakdown(entry.stats, format);
  if (parts.length === 0) return "";

  const total = fpts(entry, format);
  const modelled = parts.reduce((sum, part) => sum + part.points, 0);
  const remainder = Math.round((total - modelled) * 100) / 100;

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
 * Collapsed by the client — see the note on the table below for why it is not
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
        // "QB6 · QB1 week" — the rank, then the tier that rank lands in, which
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
      // "ranked 7th in points allowed", not "the 7th-most" — one phrasing that
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
   * does not reach as far back — so an older season rendered eighteen rows
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
              } that season — 1st allows the most`,
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
   * the reader has passed on the way down. The opponent chip is different — a
   * bare "20th" beside LAC is a coin flip unless the direction is written
   * down, and the direction currently lives only in a title attribute, which a
   * phone has no way to open.
   *
   * The wording is the upcoming-games caption's, to the word. The two blocks
   * rank the same quantity from different sources (this one from the season's
   * own logs, that one from the FPA snapshots) and the reader has no reason to
   * care which — what they cannot survive is the two of them being read in
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
 * question about form; this one is a question about consistency — how many
 * weeks were above the line a manager was starting him on — so the reference is
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
 * allowed to generate: it restates the table for a reader — and for a crawler —
 * that wants the shape of the season in a sentence rather than in eighteen
 * rows. It says nothing the table does not.
 *
 * ONE GAME IS NOT A SEASON, and this paragraph knows it. Its whole job is to
 * divide a season into rates, and with a single game the quotient is the
 * dividend: "that is worth 16.5 points" and "has averaged 16.5 points per
 * game" are the same sentence twice, which is exactly how it read once the two
 * paragraphs moved next to each other. So at one game the averages are dropped
 * — along with "of those weeks", which has nothing to refer back to — and the
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
    // Per-game throughout, which is the whole difference between this and the
    // sentence above it: that one adds the season up, this one divides it.
    // Only the rates that have a prose name — a completion percentage is not
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
 * already on the tab — that is the point: the FAQ is the form a search engine
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
  const stats = data.seasonLogStats;
  if (!stats) return "";

  const items = gameLogFaq({
    name: data.player.name,
    position: data.player.position,
    season: data.logSeason,
    inProgress: data.logSeason === data.season,
    played: playedWeeks(data),
    stats,
    format: data.format,
    otherSeasons: data.logSeasons.filter((year) => year !== data.logSeason),
  });

  return renderFaq(items, options, `${data.player.name} Game Log FAQ`);
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
 * Every card carries the same four things — the week, who, how hard, and when —
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
   * Null when either club cannot be resolved — a TBD playoff slot, an opponent
   * the schedule names and the team table does not — and a card without a pair
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
      // underneath it. One function so the colour and the word can never
      // disagree — a rank tinted as favourable and captioned "Tough" is worse
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
        // was the only thing saying so — a decoration a reader has to guess at.
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
              ` — ${data.team?.fullName ?? "this team"} vs ${game.opponentName}`,
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
   * descending — rank 1 allows the most — which is verified in
   * lib/fpa/fpa-data.ts rather than assumed here, so the caption states the
   * direction outright and leaves the reader to call it easy or hard.
   */
  /*
   * ...and the table it is measured from, linked.
   *
   * The caption defines the rank in a sentence; the link is where the reader
   * checks it. The phrase itself is the anchor rather than a "see also" tacked
   * on the end, because the words a reader stops on are the words that should
   * be clickable — and the rest of the sentence stays plain so the definition
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
 * Three bands, for a restrained tint rather than a red-to-green ramp.
 *
 * The rank is the reading and the colour is a hint underneath it, so only the
 * top and bottom thirds are tinted at all and the middle is left alone. A card
 * per fixture in full green or full red turns a schedule into a traffic light
 * and buries the thing the block is actually for, which is who and when.
 */
type MatchupBand = "soft" | "mid" | "tough";

function matchupBand(rank: number): MatchupBand {
  if (rank <= 10) return "soft";
  if (rank >= 23) return "tough";
  return "mid";
}

/**
 * The band, in a word.
 *
 * "12th vs QB" is only a reading if you hold the direction of the scale in your
 * head, and the caption that states the direction is at the foot of the block.
 * This is that sentence applied, one word per card.
 *
 * It follows the site's scale and not the other one: the points-allowed table
 * ranks DESCENDING, so 1st allows the most and is the soft matchup. A defence
 * ranked 30th against the position is one of the stingiest in the league, which
 * is why 30th reads "Tough" here rather than favourable.
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
 * Stats is totals, Game Log is games — the split the Stats tab is built on. The
 * career table and the career-finish tiles were both aggregates filed here;
 * they moved, and what is left is the thing this tab is named for.
 */
function renderGameLog(
  data: PlayerPageData,
  options: PlayerRenderOptions,
): string {
  if (data.gameLog.length === 0) return "";

  /*
   * No label under the heading.
   *
   * It read "2026 Season (Through Week 1)" — a caption restating the year the
   * heading had just given, in the one position on the tab where a reader is
   * most willing to be told something. The season in prose goes there instead;
   * "has played 1 game in 2026" carries how far in we are and says it in
   * words, which is what a line under a heading is for.
   */
  // The tab is the active season, whatever ?log= asks for; the archive season
  // is rendered separately, below the selector.
  const current = activeSeasonView(data);

  // Built once and handed to the two blocks that can carry it; exactly one of
  // them renders, so the page never shows two selectors.
  const seasons = renderLogSeasons(data, options);

  const heading =
    // Scoped to its own URL the hero already says this; see renderPlayerPage().
    options.section === "game-log"
      ? ""
      : h2(`${data.player.name} Game Log ${current.season}`);

  return (
    heading +
    // Built from `data`, not from `current`: the format toggle carries the
    // pinned season through in its URLs, so switching to Standard keeps the
    // archive season the reader opened rather than closing it.
    renderLogControls(data, options) +
    // Tiles first, prose second. The paragraph reads as a gloss on the tiles —
    // the same season, in sentences, with the context a grid of six numbers
    // cannot carry — and a reader who only wants the number gets it without
    // reading past a paragraph to reach it.
    renderLogTiles(current) +
    renderLogIntro(current) +
    renderWeeklyLog(current) +
    renderLogChart(current) +
    renderRecentGames(current) +
    renderUpcoming(current, options) +
    // One or the other, never both: All is the selector's resting state. The
    // selector itself goes INTO whichever one renders, on its heading's row —
    // it is that block's filter, and a reader changing years is looking at the
    // thing that changes.
    renderLogCareer(data, seasons) +
    renderArchiveSeason(data, options, seasons) +
    renderGameLogFaq(current, options)
  );
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
 * The data already carries both — `gameLog`/`stats` are the active season's
 * and `seasonLog`/`seasonLogStats` are the pinned one's — so this is a view
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
 * The same three blocks the active season leads with — the tiles, the
 * paragraph, the table — and none of the ones that only make sense for a
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
    `</section>`
  );
}

/**
 * What the All chip opens: every season on one line each.
 *
 * The same career table the Stats tab carries, rendered from the same
 * statsProfile, so the two cannot drift. It belongs in both places for
 * different reasons: on Stats it is the totals, and here it is the index to
 * eleven game logs — the reader is standing in front of a row of years being
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
  // Nothing to index for a player with one season — and the selector that
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

/** Career totals by season — the counting stats, not the rates. */

/* --------------------------------------------------------- advanced stats */

/**
 * The advanced table, grouped and ranked.
 *
 * Forty numbers read as five ideas because they are grouped, and each one
 * carries the percentile that says whether it is any good. The value is always
 * printed; the bar beside it is league context, never the only reading.
 *
 * Absent entirely for a player who is not in the table — which is most of the
 * league, and why the tab is dropped rather than shown empty.
 */
/**
 * The career in four finishes.
 *
 * The two finish tiles are measured differently and the labels say so, because
 * the two questions are different ones. The BEST finish is by total points —
 * the season that actually won weeks for whoever rostered it, which is a full
 * season of production and not a rate. The WORST is by points per game, so a
 * year ended by a week-3 injury is not recorded as the floor of this player's
 * range; it was a short season, not a bad one.
 *
 * A season with no positional rank behind it is counted nowhere here — hence
 * "ranked seasons" rather than "seasons played", which is the honest label for
 * what is being counted.
 *
 * Lives on the Stats tab, with the other career aggregates. It was briefly at
 * the top of the Game Log, which is where it went when the request was to lead
 * that tab with it; the Stats/Game Log split moved every aggregate here.
 */
function renderCareerFinishes(data: PlayerPageData): string {
  const played = data.production.filter((row) => row.gamesPlayed > 0);
  if (played.length === 0) return "";

  const byTotal = played.filter(
    (row): row is ProductionSeason & { posFinishTotal: number } =>
      row.posFinishTotal !== null,
  );
  const byPpg = played.filter(
    (row): row is ProductionSeason & { posFinishPpg: number } =>
      row.posFinishPpg !== null,
  );
  if (byTotal.length === 0 && byPpg.length === 0) return "";

  // Ties go to the most recent season: "best finish, in 2025" is a more useful
  // reading than the same rank attributed to 2018.
  const best = byTotal.reduce<(ProductionSeason & { posFinishTotal: number }) | null>(
    (pick, row) =>
      !pick ||
      row.posFinishTotal < pick.posFinishTotal ||
      (row.posFinishTotal === pick.posFinishTotal && row.season > pick.season)
        ? row
        : pick,
    null,
  );
  const worst = byPpg.reduce<(ProductionSeason & { posFinishPpg: number }) | null>(
    (pick, row) =>
      !pick ||
      row.posFinishPpg > pick.posFinishPpg ||
      (row.posFinishPpg === pick.posFinishPpg && row.season > pick.season)
        ? row
        : pick,
    null,
  );

  const top12 = byTotal.filter((row) => row.posFinishTotal <= 12).length;
  const position = data.player.position ?? best?.position ?? "";
  const inside = position ? `${position}12` : "the top 12";

  // The same rail as career rates above it and career bests below it. Three
  // adjacent sections of four figures should be one visual system, not three
  // that happen to be similar — that difference is most of what made the
  // bottom of this page read as a wall of generic boxes.
  return (
    sectionHead("Fantasy Finish History") +
    renderRail([
      {
        value: best ? `${best.position}${best.posFinishTotal}` : DASH,
        label: "Best finish",
        sub: best ? `${best.season} · by FPTS` : "no ranked season",
      },
      {
        value: byTotal.length ? String(top12) : DASH,
        label: "Top-12 seasons",
        sub: `inside ${inside}`,
      },
      {
        value: worst ? `${worst.position}${worst.posFinishPpg}` : DASH,
        label: "Worst finish",
        sub: worst ? `${worst.season} · by PPG` : "no ranked season",
      },
      {
        value: byTotal.length ? String(byTotal.length) : DASH,
        label: "Active seasons",
        sub: `ranked ${position} seasons`.replace("  ", " "),
      },
    ])
  );
}

/* -------------------------------------------------------------------- stats */

/**
 * The Stats tab.
 *
 * One page for one question — "what are his stats this season and over his
 * career" — which is a single intent that used to be spread across three
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
 * section — forty percentile bars across six groups, which buried the career
 * records under a wall of EPA and pressure rates that a general reader scrolls
 * past. They are not a tab of their own either: that page competed with this
 * one for the same queries on thinner content.
 *
 * The machinery is still here and still builds — renderAdvanced() below, the
 * `?adv=` season switch, and lib/player/advanced.ts — so bringing it back is a
 * one-line change in this function. Nothing calls it today.
 *
 * Order: the snapshot answers the query, the season tables back it, fantasy is
 * the layer this site adds, the career table catches every "<year> stats" and
 * "career stats" variant, and the records give the page somewhere to stop.
 */

/** A whole number with thousands separators. Never a dash — callers guard. */
function count(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/**
 * The season rail: the query's answer, before anything else.
 *
 * FANTASY FIRST, and per game.
 *
 * It used to open on games, passing yards, touchdowns, completion percentage,
 * interceptions and passer rating, with fantasy points added at the end — a
 * row that answers "how did he play" and says nothing about the question this
 * site exists for until its last cell. A reader who wanted passer rating did
 * not come here for it. So the two fantasy figures lead and are set larger,
 * and the box score behind them is rates rather than totals: yards per game
 * survives a bye and a one-game sample, and season totals are what the career
 * table underneath is for.
 *
 * Passer rating has not been dropped — it moved down into Production, where it
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

  // The two that lead. `lead` sets them larger than the rest of the rail —
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

  if (position === "QB" && t.passAtt > 0) {
    cells.push({ value: per(t.passYd, 0), label: "Pass yds/g" });
    cells.push({ value: per(t.passTd), label: "Pass TD/g" });
    cells.push({
      value: `${((t.passCmp / t.passAtt) * 100).toFixed(1)}%`,
      label: "Comp %",
    });
    if (t.rushYd > 0) cells.push({ value: per(t.rushYd, 0), label: "Rush yds/g" });
  } else if (position === "RB") {
    cells.push({ value: per(t.rushAtt), label: "Carries/g" });
    cells.push({ value: per(t.rushYd, 0), label: "Rush yds/g" });
    cells.push({ value: per(t.rec), label: "Rec/g" });
    cells.push({
      value: per(t.rushTd + t.recTd, 2),
      label: "TD/g",
    });
  } else {
    cells.push({ value: per(t.tgt), label: "Targets/g" });
    cells.push({ value: per(t.rec), label: "Rec/g" });
    cells.push({ value: per(t.recYd, 0), label: "Rec yds/g" });
    cells.push({ value: per(t.recTd + t.rushTd, 2), label: "TD/g" });
  }

  return (
    `<section class="scp-snapshot">` + renderRail(cells, "hero") + `</section>`
  );
}

/* statTable() — the two-column label/value table — went with the cards it was
   the inside of. Production is figure-over-label columns now, which reads as a
   stat sheet rather than as a settings page. */

/**
 * 2026 Production: the box score and the fantasy layer as ONE section.
 *
 * They were two cards — a nine-row passing table in a white box beside a
 * smaller white box of fantasy figures — and that composition was the page's
 * main problem. Two containers say "two components"; the heavier one wins on
 * size alone, so the box score looked like the subject and the fantasy layer
 * like an afterthought, which is backwards for this site. A skinny third box
 * underneath for rushing made it three.
 *
 * Now: no cards at all. Two columns of the same open composition, each a stack
 * of figure-over-label, their rows aligned across the gutter so the eye reads
 * either down one column or across both. The fantasy column carries the gold
 * kicker and the box score carries navy, which is the whole of the hierarchy —
 * no border, no fill, no shadow doing work that a rule and a colour can do.
 *
 * Position-adaptive throughout: the primary column is whatever the player's
 * line is about, and the other one drops to the rail underneath.
 */
interface ProdCell {
  value: string;
  label: string;
}

function renderProdColumn(
  title: string,
  cells: ProdCell[],
  accent: "navy" | "gold",
): string {
  if (cells.length === 0) return "";
  return (
    `<div class="scp-prod-col" data-accent="${accent}">` +
    `<p class="scp-prod-head">${escapeHtml(title)}</p>` +
    cells
      .map(
        (cell) =>
          `<div class="scp-prod-cell">` +
          `<p class="scp-prod-value">${escapeHtml(cell.value)}</p>` +
          `<p class="scp-prod-label">${escapeHtml(cell.label)}</p>` +
          `</div>`,
      )
      .join("") +
    `</div>`
  );
}

function renderSeasonProduction(data: PlayerPageData): string {
  const row = data.statsProfile.current;
  if (!row || row.gamesPlayed === 0) return "";

  const t = row.totals;
  const stats = data.stats;
  const position = data.player.position;

  /* ---- the primary line: whatever this player's football is about ---- */

  let title = "";
  let primary: ProdCell[] = [];

  if (position === "QB" && t.passAtt > 0) {
    const rating = passerRating(t);
    title = "Passing";
    primary = [
      { value: `${count(t.passCmp)} / ${count(t.passAtt)}`, label: "Cmp / Att" },
      { value: count(t.passYd), label: "Pass yds" },
      { value: (t.passYd / t.passAtt).toFixed(1), label: "Yards / att" },
      { value: `${count(t.passTd)} / ${count(t.passInt)}`, label: "TD / INT" },
      ...(rating === null
        ? []
        : [{ value: rating.toFixed(1), label: "Passer rating" }]),
    ];
  } else if (position === "RB" && t.rushAtt > 0) {
    title = "Rushing";
    primary = [
      { value: count(t.rushAtt), label: "Carries" },
      { value: count(t.rushYd), label: "Rush yds" },
      { value: (t.rushYd / t.rushAtt).toFixed(1), label: "Yards / carry" },
      { value: count(t.rushTd), label: "Rush TD" },
      { value: count(t.rushYd + t.recYd), label: "Yds from scrimmage" },
    ];
  } else if (t.rec > 0 || t.tgt > 0) {
    title = "Receiving";
    primary = [
      { value: `${count(t.rec)} / ${count(t.tgt)}`, label: "Rec / Tgt" },
      { value: count(t.recYd), label: "Rec yds" },
      ...(t.rec > 0
        ? [{ value: (t.recYd / t.rec).toFixed(1), label: "Yards / rec" }]
        : []),
      ...(t.tgt > 0
        ? [
            {
              value: `${((t.rec / t.tgt) * 100).toFixed(1)}%`,
              label: "Catch %",
            },
          ]
        : []),
      { value: count(t.recTd), label: "Rec TD" },
    ];
  }

  /* ---- the fantasy column, which is the point of the page ---- */

  const fantasy: ProdCell[] = [
    { value: row.points.toFixed(1), label: "Fantasy points" },
    { value: row.ppg.toFixed(1), label: "Points / game" },
  ];

  // Per-opportunity, which survives a small sample better than per-game does.
  if (position === "QB" && t.passAtt + t.rushAtt > 0) {
    fantasy.push({
      value: (row.points / (t.passAtt + t.rushAtt)).toFixed(2),
      label: "Points / dropback",
    });
  } else {
    const touches = t.rushAtt + t.rec;
    if (touches > 0) {
      fantasy.push({
        value: (row.points / touches).toFixed(2),
        label: "Points / touch",
      });
    } else if (t.tgt > 0) {
      fantasy.push({
        value: (row.points / t.tgt).toFixed(2),
        label: "Points / target",
      });
    }
  }

  if (stats?.bestWeek) {
    fantasy.push({
      value: fpts(stats.bestWeek, data.format).toFixed(1),
      label: `Best week · Wk ${stats.bestWeek.week}`,
    });
  }

  if (data.seasonRank !== null) {
    fantasy.push({
      value: `${position ?? ""}${data.seasonRank}`,
      label: "Fantasy finish",
    });
  }

  /* ---- the other line, as a rail rather than a third column ---- */

  const strip = (label: string, cells: Array<{ value: string; unit: string }>) =>
    `<div class="scp-bar">` +
    `<span class="scp-bar-label">${escapeHtml(label)}</span>` +
    `<div class="scp-bar-cells" data-count="${cells.length}">` +
    cells
      .map(
        (cell) =>
          `<p class="scp-bar-cell">` +
          `<span class="scp-bar-value">${escapeHtml(cell.value)}</span>` +
          `<span class="scp-bar-unit">${escapeHtml(cell.unit)}</span>` +
          `</p>`,
      )
      .join("") +
    `</div></div>`;

  let secondary = "";
  if (title === "Rushing" && (t.rec > 0 || t.tgt > 0)) {
    secondary = strip("Receiving", [
      { value: count(t.tgt), unit: "Tgt" },
      { value: count(t.rec), unit: "Rec" },
      { value: count(t.recYd), unit: "Yds" },
      { value: t.rec > 0 ? (t.recYd / t.rec).toFixed(1) : DASH, unit: "Avg" },
      { value: count(t.recTd), unit: "TD" },
    ]);
  } else if (title !== "Rushing" && t.rushAtt > 0) {
    secondary = strip("Rushing", [
      { value: count(t.rushAtt), unit: "Att" },
      { value: count(t.rushYd), unit: "Yds" },
      { value: (t.rushYd / t.rushAtt).toFixed(1), unit: "Avg" },
      { value: count(t.rushTd), unit: "TD" },
    ]);
  }

  if (primary.length === 0 && fantasy.length === 0) return "";

  /*
   * The club's mark, at four percent.
   *
   * Identity without decoration: at this opacity it is a texture behind the
   * fantasy column rather than a logo on the page, and it is aria-hidden and
   * lazy because it says nothing a reader needs and must never cost the first
   * paint. A page of pure grey type is honest and anonymous; every sports
   * annual ever printed put the crest somewhere.
   */
  const watermark = data.team
    ? `<img class="scp-prod-mark" src="${escapeHtml(data.team.logo)}" alt=""` +
      ` aria-hidden="true" loading="lazy" decoding="async" width="200" height="200">`
    : "";

  return (
    sectionHead(`${data.season} Production`) +
    `<div class="scp-prod-grid">` +
    watermark +
    renderProdColumn(title, primary, "navy") +
    renderProdColumn("Fantasy", fantasy, "gold") +
    `</div>` +
    secondary
  );
}

/**
 * Career, season by season.
 *
 * Reaches further back than the game logs do, because it is built off the
 * production snapshot — see lib/player/stats-profile.ts. There is no TEAM
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
   * it. Marked aria-hidden and skipped by the sorter — see wireSortableLog,
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
    // in PPR" — the season count is the number of rows, the games are the
    // Career row's own GP cell, and the format is named by the toggle in the
    // header. Three facts the table states, restated above the table.
    sectionHead("Career By Season", "", aside) +
    `<div class="scp-scroll">` +
    `<table class="scp-table scp-table--filled scp-table--career" data-scp-sortable>` +
    `<thead>${groupRow}${head}</thead>` +
    `<tbody>${body}</tbody><tfoot>${totalRow}</tfoot>` +
    `</table></div>`
  );
}

/** The records, so a reader gets an answer without reading the table. */
function renderCareerHighs(data: PlayerPageData): string {
  const highs = data.statsProfile.highs;
  if (highs.length === 0) return "";

  // A record board: the figure, what the record is, and the season it was set
  // in. Same rail as the two sections above it.
  return (
    sectionHead("Career Bests") +
    renderRail(
      highs.map((high) => ({
        value: high.value,
        label: high.label,
        sub: high.detail,
      })),
    )
  );
}

/** The questions people type, answered from the totals above them. */
function renderStatsFaq(data: PlayerPageData, options: PlayerRenderOptions): string {
  const faq = data.statsProfile.faq;
  if (faq.length === 0) return "";
  return renderFaq(faq, options, "Common Questions");
}

function renderStats(data: PlayerPageData, options: PlayerRenderOptions): string {
  const snapshot = renderStatsSnapshot(data);
  const season = renderSeasonProduction(data);
  const efficiency = renderProduction(data);
  const career = renderCareerStats(data);
  const careerRates = renderCareerSnapshot(data);
  const finishes = renderCareerFinishes(data);
  const highs = renderCareerHighs(data);
  const faq = renderStatsFaq(data, options);

  if (!snapshot && !season && !career && !efficiency) return "";

  /*
   * The heading, and nothing under it.
   *
   * There were two lines here and both were restating their surroundings. A
   * subtitle listed the section headings that follow it — "fantasy production,
   * efficiency, career stats and career bests" is a table of contents for four
   * blocks a reader can already see. Under that, a meta row gave the position,
   * the club, the season, the games played and the week, every one of which is
   * printed within a screen of it: the hero carries the position and the club,
   * the heading carries the year, and the rail underneath opens on the fantasy
   * rate with the games behind it.
   *
   * What they were for was authority — who, which season, how far in — and the
   * page earns that by being right rather than by captioning itself.
   */
  const heading =
    // Scoped to its own URL the hero carries this; see renderPlayerPage().
    options.section === "stats"
      ? ""
      : h2(`${data.player.name} Stats ${data.season}`);

  return (
    heading +
    snapshot +
    season +
    efficiency +
    career +
    careerRates +
    finishes +
    highs +
    faq
  );
}

function renderAdvanced(data: PlayerPageData, options: PlayerRenderOptions): string {
  const advanced = data.advanced;
  if (!advanced) return "";

  const groups = advanced.groups
    .map((group) => {
      const cells = group.cells
        .map(
          (cell) =>
            `<div class="scp-adv-cell">` +
            `<p class="scp-adv-label">${escapeHtml(cell.label)}</p>` +
            `<p class="scp-adv-value">${escapeHtml(cell.value)}</p>` +
            (cell.percentile === null
              ? ""
              : `<span class="scp-adv-bar" title="${escapeHtml(
                  `${ordinal(cell.percentile)} percentile`,
                )}"><span class="scp-adv-fill"${styleAttr([
                  `width:${Math.max(2, Math.min(100, cell.percentile))}%`,
                ])}></span></span>` +
                `<p class="scp-adv-pct">${escapeHtml(ordinal(cell.percentile))}</p>`) +
            `</div>`,
        )
        .join("");
      return (
        `<section class="scp-adv-group"${styleAttr([`--group-accent:${group.accent}`])}>` +
        `<h4 class="scp-adv-group-title">${escapeHtml(group.label)}</h4>` +
        `<div class="scp-adv-grid">${cells}</div>` +
        `</section>`
      );
    })
    .join("");

  const seasons = data.advancedSeasons;
  const prefix = options.playerPathPrefix ?? "/player/";
  const switcher =
    seasons.length > 1
      ? `<div class="scp-seasons" data-scp-adv-seasons>` +
        seasons
          .map((season) => {
            const active = season === advanced.season;
            const href =
              `${prefix}${data.player.slug}` +
              `?adv=${season}${data.format === "ppr" ? "" : `&format=${data.format}`}#stats`;
            return (
              `<a class="scp-season-opt${active ? " is-active" : ""}"` +
              ` href="${escapeHtml(href)}"${active ? ` aria-current="true"` : ` rel="nofollow"`}>` +
              `${escapeHtml(String(season))}</a>`
            );
          })
          .join("") +
        `</div>`
      : "";

  const context =
    advanced.rank !== null
      ? `${ordinal(advanced.rank)} of ${advanced.qualifyingPlayers} qualifying ${advanced.position.toUpperCase()}s`
      : `${advanced.qualifyingPlayers} qualifying ${advanced.position.toUpperCase()}s`;

  return (
    sectionHead("Advanced") +
    `<p class="scp-sub">${escapeHtml(
      advanced.throughWeek
        ? `${advanced.season} season through Week ${advanced.throughWeek} \u00b7 ${context}`
        : `${advanced.season} season \u00b7 ${context}`,
    )}</p>` +
    switcher +
    `<p class="scp-note">${escapeHtml(
      "Each bar is this player's percentile among qualifying players at the position. Metrics where a lower number is better are inverted, so a longer bar is always better.",
    )}</p>` +
    `<div class="scp-adv">${groups}</div>`
  );
}

/**
 * The Injury tab.
 *
 * Reordered around the question people actually arrive with. Somebody who
 * searches a player's name and the word "injury" wants three things, in this
 * order: is he hurt right now, is he playing, what happened. The career record
 * — the durability grade, the body-region tallies, the five-year timeline — is
 * what they want SECOND, and it used to be the whole tab with the current
 * designation filed one tab over under News.
 *
 * So the order is now:
 *
 *   1. current status, with this season's availability beside it
 *   2. the career record at a glance
 *   3. the availability profile — four readings, each with its record printed
 *   4. injuries by body part, as a table
 *   5. the history itself, one entry at a time, as real prose in the HTML
 *   6. the questions people type, answered from the record
 *
 * A note on the history, because it is the part that carries the most weight
 * and has the least behind it. Those records have no per-entry provenance —
 * no source, no URL, no retrieved-at — and the script that produced them
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
 * The status block: the answer, above everything else.
 *
 * Always rendered, unlike the old designation card, because "no designation" is
 * the answer most readers are looking for and the absence of a card does not
 * communicate it. What the block must NOT do is turn that into a clean bill of
 * health: the roster snapshot reports what clubs have filed, so the line reads
 * "no current injury designation" rather than "healthy", and it is stamped with
 * when the snapshot was taken.
 */
function renderInjuryStatus(
  data: PlayerPageData,
  options: PlayerRenderOptions,
): string {
  const injury = data.injury;
  const designation = data.designation;
  const status = designation?.injuryStatus ?? null;
  const now = options.now ?? Date.now();

  const severity = status ? designationSeverity(status) : "active";
  const headline = status ?? "Active";

  const detail = status
    ? [designation?.injuryBodyPart, designation?.practice]
        .filter((part): part is string => Boolean(part))
        .join(" · ")
    : "No current injury designation";

  const stamp =
    data.rosterFetchedAt > 0
      ? `<p class="scp-status-stamp">Last checked ` +
        `<time datetime="${escapeHtml(new Date(data.rosterFetchedAt).toISOString())}"` +
        ` data-ts="${data.rosterFetchedAt}" data-ts-compact>` +
        `${escapeHtml(relativeAge(data.rosterFetchedAt, now))}</time></p>`
      : "";

  // This season's availability and the last thing that happened to him — the
  // two facts that turn "is he hurt" into "should I expect him on Sunday",
  // without the page predicting Sunday.
  const facts: Array<{ label: string; value: string; sub: string }> = [];

  if (injury?.seasonMissed !== null && injury?.seasonMissed !== undefined) {
    facts.push({
      label: `${data.season} games missed`,
      value: String(injury.seasonMissed),
      sub:
        injury.lastPlayedWeek !== null
          ? `Last played Week ${injury.lastPlayedWeek}`
          : "Has not played this season",
    });
  }

  const latest = injury?.latest;
  if (latest) {
    const when = injuryWhen(latest);
    facts.push({
      label: "Latest injury",
      value: `${latest.type} · ${latest.season}`,
      sub:
        (latest.gamesMissed ?? 0) > 0
          ? `${latest.gamesMissed} game${latest.gamesMissed === 1 ? "" : "s"} missed`
          : when
            ? `${when} · played through`
            : "Played through",
    });
  }

  return (
    `<section class="scp-status" data-severity="${escapeHtml(severity)}">` +
    `<div class="scp-status-main">` +
    `<p class="scp-status-label">Current status</p>` +
    `<p class="scp-status-value">` +
    `<span class="scp-status-dot" aria-hidden="true"></span>` +
    `${escapeHtml(headline)}</p>` +
    (detail ? `<p class="scp-status-detail">${escapeHtml(detail)}</p>` : "") +
    stamp +
    `</div>` +
    (facts.length
      ? `<div class="scp-status-facts">` +
        facts
          .map(
            (fact) =>
              `<div class="scp-status-fact">` +
              `<p class="scp-status-fact-label">${escapeHtml(fact.label)}</p>` +
              `<p class="scp-status-fact-value">${escapeHtml(fact.value)}</p>` +
              `<p class="scp-status-fact-sub">${escapeHtml(fact.sub)}</p>` +
              `</div>`,
          )
          .join("") +
        `</div>`
      : "") +
    `</section>`
  );
}

/** Injuries By Body Part. A table, because it is tabular. */
function renderInjuryRegions(data: PlayerPageData): string {
  const regions = data.injury?.regions ?? [];
  if (regions.length === 0) return "";

  const rows = regions
    .map(
      (region) =>
        `<tr>` +
        `<th scope="row">${escapeHtml(region.region)}</th>` +
        `<td>${escapeHtml(String(region.count))}</td>` +
        `<td>${escapeHtml(String(region.gamesMissed))}</td>` +
        `</tr>`,
    )
    .join("");

  return (
    h3("Injuries By Body Part") +
    `<div class="scp-scroll">` +
    `<table class="scp-table scp-table--filled scp-table--regions">` +
    `<thead><tr>` +
    `<th scope="col">Area</th>` +
    `<th scope="col">Injuries</th>` +
    `<th scope="col">Games missed</th>` +
    `</tr></thead>` +
    `<tbody>${rows}</tbody>` +
    `</table></div>`
  );
}

/**
 * The history, one injury at a time.
 *
 * Every entry is a heading, a line of circumstance and a paragraph of prose,
 * all of it in the HTML rather than behind a disclosure — a reader searching
 * for one specific injury is searching for the words in that paragraph, and
 * words a crawler cannot see answer nobody.
 */
function renderInjuryHistory(data: PlayerPageData): string {
  const seasons = data.injury?.seasons ?? [];
  if (seasons.length === 0) return "";

  const entries = seasons
    .flatMap((season) =>
      season.entries.map((entry) => {
        const when = injuryWhen(entry);
        const missed = entry.gamesMissed ?? 0;
        const cost =
          missed > 0
            ? `${missed} game${missed === 1 ? "" : "s"} missed`
            : "Played through";
        const meta = [when, cost].filter(Boolean).join(" · ");
        const side = entry.side && entry.side !== "unknown" ? entry.side : "";

        return (
          `<li class="scp-episode" data-severity="${escapeHtml(entry.severity ?? "")}">` +
          `<h4 class="scp-episode-head">` +
          `<span class="scp-episode-year">${escapeHtml(String(entry.season))}</span>` +
          `<span class="scp-episode-type">${escapeHtml(entry.type)}</span>` +
          (side ? `<span class="scp-episode-side">${escapeHtml(side)}</span>` : "") +
          `</h4>` +
          `<p class="scp-episode-meta">${escapeHtml(meta)}</p>` +
          (entry.description
            ? `<p class="scp-episode-body">${escapeHtml(entry.description)}</p>`
            : "") +
          `</li>`
        );
      }),
    )
    .join("");

  /*
   * The one honest thing that can be said about where this came from.
   *
   * Deliberately undated. These records carry no captured-at, and the only
   * timestamp available is the data file's mtime — which on a fresh deploy is
   * the moment the repository was checked out, not the moment anything was
   * gathered. A line reading "last updated today" on a record that has not
   * changed in months is a fabricated provenance, which is worse than none.
   * Put a real date here when the record starts carrying one.
   */
  const provenance =
    "Compiled injury record; entries are not individually sourced. " +
    "Games missed are regular-season games.";

  return (
    h3(`${data.player.name} Injury History`) +
    `<ol class="scp-episodes">${entries}</ol>` +
    `<p class="scp-note">${escapeHtml(provenance)}</p>`
  );
}

/** The questions people type, answered from the record above them. */
function renderInjuryFaq(data: PlayerPageData, options: PlayerRenderOptions): string {
  // Named for the player and the subject rather than "Common Questions": these
  // are the sentences somebody typed into a search box, and the heading over
  // them should read like the thing they were looking for.
  return renderFaq(
    data.injury?.faq ?? [],
    options,
    `${data.player.name} Injury FAQ`,
  );
}

/**
 * The availability profile and the body-part table, side by side.
 *
 * They are two readings of one record — how the absences are distributed in
 * TIME, and how they are distributed across the BODY — and a reader compares
 * them rather than reading one after the other. Stacked, the comparison needed
 * a scroll; beside each other it is one glance. Each is four rows, so neither
 * column pulls far ahead of the other.
 *
 * Either side may be absent: a player with a logged injury but no body region
 * recorded gets the profile alone, and the grid collapses to one column rather
 * than leaving a hole where the table would be.
 */
function renderAvailabilityPair(data: PlayerPageData, riskRows: string): string {
  const profile = riskRows
    ? `<div class="scp-pair-col">` +
      h3("Availability Profile") +
      `<ul class="scp-avails">${riskRows}</ul>` +
      `<details class="scp-how">` +
      `<summary class="scp-how-summary">How this is calculated</summary>` +
      `<p class="scp-how-body">${escapeHtml(
        "Each row is one explicit rule over the record below — how recent the injuries are, whether any body region repeats, total games missed, and how concentrated those injuries are across regions. They are shown separately because they can disagree, and a single blended score would hide exactly the part worth acting on. Nothing here is a medical assessment.",
      )}</p>` +
      `</details>` +
      `</div>`
    : "";

  const regions = renderInjuryRegions(data);
  const table = regions ? `<div class="scp-pair-col">${regions}</div>` : "";

  if (!profile && !table) return "";
  if (!profile || !table) return `${profile}${table}`;

  return `<div class="scp-pair">${profile}${table}</div>`;
}

function renderInjury(data: PlayerPageData, options: PlayerRenderOptions): string {
  const injury = data.injury;
  if (!injury) return "";

  const { summary, history, risks, insight } = injury;

  const grade =
    history.grade && history.score !== null
      ? `<div class="scp-grade">` +
        `<span class="scp-grade-letter">${escapeHtml(history.grade)}</span>` +
        `<span class="scp-grade-score">${escapeHtml(`${history.score}/100 durability`)}</span>` +
        `</div>`
      : "";

  const tiles = renderTiles([
    {
      label: "Games missed",
      value: whole(summary.totalMissed),
      sub: "Career, every logged injury",
    },
    {
      label: "Injuries",
      value: whole(summary.injuriesLogged),
      sub: `${summary.affectedRegions} body region${summary.affectedRegions === 1 ? "" : "s"}`,
    },
    {
      label: "Latest injury",
      value: summary.lastSeason ? String(summary.lastSeason) : DASH,
      sub: injury.latest?.type ?? "Last season with a logged injury",
    },
    {
      label: "Biggest absence",
      value: summary.primaryDriver ? whole(summary.primaryDriver.missed) : DASH,
      sub: summary.primaryDriver?.label,
    },
  ]);

  const riskRows = risks
    .map(
      (risk) =>
        `<li class="scp-avail" data-level="${risk.level}">` +
        `<span class="scp-avail-label">${escapeHtml(risk.label)}</span>` +
        `<span class="scp-avail-value">${escapeHtml(risk.value)}</span>` +
        `<span class="scp-avail-detail">${escapeHtml(risk.detail)}</span>` +
        `</li>`,
    )
    .join("");

  // Scoped to its own URL, the hero already says this. Unscoped, it is the
  // tab's heading and the thing that names the panel.
  const heading =
    options.section === "injury"
      ? ""
      : h2(
          `${data.player.name} Injury Update & History`,
          "Current status, games missed and every logged injury.",
        );

  return (
    heading +
    renderInjuryStatus(data, options) +
    h3("Injury History At A Glance") +
    `<div class="scp-injury-top">${grade}${tiles}</div>` +
    (insight ? `<p class="scp-note scp-note--lead">${escapeHtml(insight)}</p>` : "") +
    renderAvailabilityPair(data, riskRows) +
    renderInjuryHistory(data) +
    renderInjuryFaq(data, options)
  );
}

/* -------------------------------------------------------------------- news */

/**
 * How severe a designation is, for the pill's accent.
 *
 * Four buckets, matching the team hub's `injurySeverity` exactly so the same
 * status is the same colour on both pages. Anything unrecognised is treated as
 * "questionable" rather than dropped — an unfamiliar designation is still a
 * designation, and guessing it is harmless while hiding it is not.
 */
function designationSeverity(status: string | null | undefined): string {
  const key = (status ?? "").trim().toLowerCase();
  if (/^(out|ir|pup|nfi|susp|dnr|doubtful-out)/.test(key) || key.includes("injured reserve")) {
    return "out";
  }
  if (key === "doubtful") return "doubtful";
  if (key === "probable" || key === "active" || key === "full") return "probable";
  return "questionable";
}

/**
 * The current injury report card.
 *
 * The one genuinely time-sensitive thing on the page, so it leads the tab and
 * carries the snapshot time — it must never look fresher than it is.
 *
 * **Rendered only when there IS a designation.** A player with none gets no
 * card, because the absence of a filing is not a clean bill of health: this
 * snapshot reports what clubs have filed, and "nothing filed" and "fit" are
 * different claims. The standalone app had the same rule and this keeps it.
 */
function renderDesignation(data: PlayerPageData, options: PlayerRenderOptions): string {
  const designation = data.designation;
  if (!designation?.injuryStatus) return "";

  const now = options.now ?? Date.now();
  const severity = designationSeverity(designation.injuryStatus);

  const detail = [designation.injuryBodyPart, designation.practice]
    .filter((part): part is string => Boolean(part))
    .map((part) => escapeHtml(part))
    .join(` <span class="scp-report-dot">\u00b7</span> `);

  const stamp =
    data.rosterFetchedAt > 0
      ? `<p class="scp-report-stamp">Designation as of ` +
        `<time datetime="${escapeHtml(new Date(data.rosterFetchedAt).toISOString())}"` +
        ` data-ts="${data.rosterFetchedAt}" data-ts-compact>` +
        `${escapeHtml(relativeAge(data.rosterFetchedAt, now))}</time></p>`
      : "";

  return (
    `<section class="scp-report" data-severity="${escapeHtml(severity)}">` +
    `<div class="scp-report-head">` +
    `<p class="scp-report-label">Current injury report</p>` +
    `<span class="scp-report-pill">${escapeHtml(designation.injuryStatus)}</span>` +
    `</div>` +
    (detail ? `<p class="scp-report-detail">${detail}</p>` : "") +
    stamp +
    `</section>`
  );
}

/**
 * One news card — the team hub's card, under this page's class prefix.
 *
 * The two surfaces draw the same story and now draw it the same way: picture
 * above the words, the kicker and the Eastern stamp, the headline, a byline,
 * and a way through to the report. The shared decisions behind that card — what
 * the kicker says for an X post, which timezone the stamp is in, whether the
 * headline still carries the "Name:" the feed wrote on the front of it — are in
 * lib/news-card.ts so the two pages cannot drift into telling a reader
 * different things about one item.
 *
 * Two differences from the hub's card, both because of where this one sits:
 *
 *   - No crest watermark and no team tint in the picture well. Rule 2 at the
 *     top of this file: on a player page the team is an accent behind the
 *     headshot and a hairline on the hero, and the news column is neither. The
 *     well's wash falls back to brand navy, which is what --team-primary
 *     resolves to everywhere on this page that is not the hero.
 *   - The summary is printed on the lead card only. The grid cards are the
 *     hub's compact card and stay it; the lead is a row, and its text column
 *     would otherwise be three lines tall beside a picture twice that.
 *
 * `showPlayer` is for the team's stories, where which player a story is about
 * is the thing the reader needs and the headline has just had that name
 * stripped off it. On the player's own stories the name is the page.
 */
function renderNewsCard(
  item: NewsItem,
  options: { featured: boolean; showPlayer: boolean },
): string {
  const href = safeUrl(item.link ?? null);
  const image = safeUrl(item.image ?? null);
  const ts = itemTimestamp(item);
  const headline = escapeHtml(splitHeadline(item));
  const name = (item.playerName ?? "").trim();

  // Decorative: the headline sits directly beside it and carries the meaning,
  // so a repeat of the name here would be read out twice.
  const media = image
    ? `<img class="scp-news-photo" src="${escapeHtml(image)}" alt=""` +
      ` width="${options.featured ? 640 : 480}" height="${options.featured ? 360 : 270}"` +
      ` loading="lazy" decoding="async" />`
    : `<span class="scp-news-photo-empty" aria-hidden="true"></span>`;

  const heading =
    `<h4 class="scp-news-title">` +
    (href
      ? `<a class="scp-news-link" href="${escapeHtml(href)}"` +
        ` target="_blank" rel="noopener noreferrer">${headline}</a>`
      : headline) +
    `</h4>`;

  const summary =
    options.featured && item.summary
      ? `<p class="scp-news-summary">${escapeHtml(item.summary)}</p>`
      : "";

  const credit = (item.source ?? "").trim();
  const byline =
    (options.showPlayer && name) || credit
      ? `<p class="scp-news-byline">` +
        (options.showPlayer && name
          ? `<span class="scp-news-player">${escapeHtml(name)}</span>`
          : "") +
        (credit ? `<span class="scp-news-source">${escapeHtml(credit)}</span>` : "") +
        `</p>`
      : "";

  return (
    `<li class="scp-news-item">` +
    `<article class="scp-newscard${options.featured ? " is-featured" : ""}">` +
    `<div class="scp-news-well">${media}</div>` +
    `<div class="scp-news-body">` +
    newsStamp(item, ts, "scp") +
    heading +
    summary +
    byline +
    (href
      ? `<p class="scp-news-cta"><span class="scp-news-read">Read report ${ARROW}</span></p>`
      : "") +
    `</div></article></li>`
  );
}

/** A list of cards. A <ul> rather than the hub's <ol>: nothing here is ranked. */
function renderNewsList(
  items: NewsItem[],
  options: { lead: boolean; showPlayer: boolean; extraClass?: string },
): string {
  return (
    `<ul class="scp-news${options.extraClass ? ` ${options.extraClass}` : ""}">` +
    items
      .map((item, i) =>
        renderNewsCard(item, {
          featured: options.lead && i === 0,
          showPlayer: options.showPlayer,
        }),
      )
      .join("") +
    `</ul>`
  );
}

/**
 * News & Analysis.
 *
 * The standalone app's version of this tab had two lazily-fetched views behind
 * a toggle — articles and the injury report — and showed nothing at all for the
 * twenty-four teams whose club sites it did not scrape. This one has no toggle
 * and no fetch: everything is already in the response, so stacking the sections
 * is both simpler and strictly more readable than hiding half of them behind a
 * button. It also covers all 32 teams, because the club feeds this app ingests
 * for the team hubs are the same feeds.
 *
 * Three blocks, in the order a reader needs them: what is true right now (the
 * designation), what is being said about this player, and what is being said
 * about their team.
 *
 * Only the player's own newest story leads. The hub gives the whole column one
 * lead for the same reason: a second one further down does not read as a second
 * lead, it reads as the page having lost track of which story is the story.
 *
 * There are no impact tags or generated blurbs on these cards. The original had
 * them; this app does not produce them, and inventing a "high impact" label
 * would be the page asserting an editorial judgement nobody made.
 */
function renderNews(data: PlayerPageData, options: PlayerRenderOptions): string {
  const report = renderDesignation(data, options);

  // The cross-link now runs News -> Injury, the reverse of what it used to.
  // The full status, this season's availability and the whole history lead the
  // Injury tab; this card is the same designation kept beside the reporting
  // that explains it, and it should hand a reader on rather than be the end of
  // the road. A real in-page anchor, so it works with scripting disabled.
  const reportLink = report
    ? `<p class="scp-note">` +
      `<a class="scp-crosslink" href="#injury">` +
      escapeHtml(`See ${data.player.name}'s full injury history`) +
      `</a></p>`
    : "";

  const own = data.news.length
    ? h3(`Latest On ${data.player.name}`) +
      renderNewsList(data.news, { lead: true, showPlayer: false })
    : "";

  const team = data.teamNews.length
    ? h3(data.team ? `Around The ${data.team.nickname}` : "Around The League") +
      renderNewsList(data.teamNews, {
        lead: false,
        showPlayer: true,
        extraClass: "scp-news--team",
      }) +
      teamHubLink(data, options)
    : "";

  // Nothing to say is said by dropping the tab, not by an empty heading — the
  // navigation is built from what rendered. A designation on its own is still
  // worth a tab: it is the most time-sensitive fact on the page.
  if (!report && !own && !team) return "";

  return (
    h2("News & Analysis", `Injury status and the latest reporting on ${data.player.name}`) +
    report +
    reportLink +
    own +
    team
  );
}

/** A way through to the team hub, which is where the rest of this lives. */
function teamHubLink(data: PlayerPageData, options: PlayerRenderOptions): string {
  if (!data.team) return "";
  const prefix = options.teamPathPrefix ?? "/team/";
  const href = `${prefix}${data.team.slug}${options.linkQuery ?? ""}`;
  return (
    `<p class="scp-news-more">` +
    siteLink(href, `All ${data.team.fullName} news`, "scp-news-more-link") +
    `</p>`
  );
}

/**
 * A coarse relative age.
 *
 * Coarse on purpose: the server renders this into cacheable HTML, so a string
 * that changes every minute would make every fragment stale within one. The
 * client refines it from the `data-ts` attribute once it loads — the same split
 * the team hub uses.
 */
function relativeAge(ms: number, now: number): string {
  const hours = Math.floor((now - ms) / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`;
}

/* --------------------------------------------------------- page assembly */

/**
 * The page's FAQ, once, from the sections that actually shipped.
 *
 * Standalone this is the FAQPage node; embedded it is the inert island that
 * statchasers-player.php lifts into Rank Math's graph — the same two shapes
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
  // without a written outlook simply do not get the tab — same rule as the rest.
  const outlook = renderOutlook2026(data);

  /*
   * Overview is the interpretation layer now — see the note above
   * renderFantasySnapshot(). What left: the 2026 counting totals and the best
   * week (Stats owns them), the efficiency meters and the career rate tiles
   * (moved to Stats), and the season-finish timeline (the career table's own
   * Finish column and the Fantasy Finish History module already say it twice).
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
   * band whose every section returned "" is not emitted — an empty wrapper
   * still draws its own top margin.
   */
  const band = (parts: string[]): string => {
    const html = parts.join("");
    return html ? `<div class="scp-ov-band">${html}</div>` : "";
  };

  const overviewBody =
    renderFantasySnapshot(data) +
    band([renderFantasyProfile(data), renderProductionDrivers(data)]) +
    band([
      renderWeeklyProfile(data),
      renderTrend(data),
      renderRoleDirection(data),
    ]) +
    band([renderCareerContext(data, options)]);

  // The wrapper is what every rule on this tab is scoped to — the sections
  // below reuse markup the Stats and Injury tabs own, and Overview's tighter
  // rhythm must not follow those classes onto the other tabs.
  const overview = overviewBody ? `<div class="scp-ov">${overviewBody}</div>` : "";

  const bio = renderBio(data, withFaq("bio"));

  // Stats is totals, Game Log is games — the split the Stats tab is built on.
  // The career table and the career-finish tiles were both aggregates filed
  // here; they moved to Stats, and what is left is the thing this tab is named
  // for. A reader asking "what did he do in Week 3" gets a page of weeks.
  const gameLog = renderGameLog(data, withFaq("game-log"));
  const stats = renderStats(data, withFaq("stats"));
  const injury = renderInjury(data, withFaq("injury"));
  const news = renderNews(data, options);

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

  if (sections.length === 0) {
    // Everything failed to produce markup, which for this page means the player
    // exists in the dictionary and has no recorded football. The hero alone is
    // the honest page: who they are, and nothing claimed beyond it.
    return (
      `<div class="scp${options.embed ? " is-embed" : ""}" data-scp-root="1">` +
      renderHero(data, options) +
      `<div class="scp-section is-default is-active"><p class="scp-empty">${escapeHtml(
        `No game log has been recorded for ${data.player.name}.`,
      )}</p></div></div>`
    );
  }

  /*
   * A section-scoped page: one section, standing alone at its own URL.
   *
   * The tab strip is replaced by a link back to the full profile, because a
   * strip of six tabs that all leave this URL is navigation pretending to be
   * tabs. Everything else — the hero, the format toggle, the markup of the
   * section itself — is unchanged, so the two addresses render the same
   * component and cannot drift.
   */
  const scoped = options.section
    ? sections.find((entry) => entry.id === options.section)
    : undefined;

  if (scoped) {
    const prefix = options.playerPathPrefix ?? "/player/";
    const back =
      `<p class="scp-back">` +
      `<a class="scp-crosslink" href="${escapeHtml(
        `${prefix}${data.player.slug}${options.linkQuery ?? ""}`,
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
      // The pinned archive year, when there is one — state, not subject.
      (data.logSeason === data.season
        ? ""
        : ` data-archive-season="${escapeHtml(String(data.logSeason))}"`) +
      ` data-format="${escapeHtml(data.format)}"` +
      ` data-section="${escapeHtml(scoped.id)}">` +
      renderHero(data, options) +
      `<section class="scp-section is-default is-active" data-scp-panel` +
      ` id="${escapeHtml(scoped.id)}">${scoped.html}</section>` +
      back +
      renderPlayerFaqSchema(faqBySection.get(scoped.id) ?? [], options) +
      `</div>`
    );
  }

  // `is-default` marks the panel shown when the URL names no section — a class
  // rather than :first-of-type, because the CSS must not depend on this element
  // being the first <section> among its siblings. Same reasoning as the hub.
  const body = sections
    .map(
      (section, i) =>
        `<section class="scp-section${i === 0 ? " is-default is-active" : ""}"` +
        ` data-scp-panel id="${escapeHtml(section.id)}"` +
        ` aria-labelledby="${escapeHtml(section.id)}-tab">${section.html}</section>`,
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
    renderHero(data, options) +
    `<div class="scp-controls">` +
    renderNav(sections) +
    renderFormatToggle(data, options) +
    `</div>` +
    body +
    // Document order, so the node reads down the page the way the questions do.
    renderPlayerFaqSchema(
      sections.flatMap((section) => faqBySection.get(section.id) ?? []),
      options,
    ) +
    `</div>`
  );
}

/**
 * A plain index of the indexed players at /player.
 *
 * Its job is navigation and verification, not presentation: it is how you check
 * that every slug resolves, and it gives the 404 somewhere useful to send a
 * reader. A full document rather than a fragment, because nothing embeds it.
 */
export function renderPlayerIndex(
  entries: IndexedPlayer[],
  options: { playerPathPrefix?: string; linkQuery?: string } = {},
): string {
  const prefix = options.playerPathPrefix ?? "/player/";
  const query = options.linkQuery ?? "";

  const byTeam = new Map<string, { team: NflTeam | null; players: IndexedPlayer[] }>();
  for (const entry of entries) {
    const key = entry.team?.abbreviation ?? "zz-free-agent";
    const group = byTeam.get(key);
    if (group) group.players.push(entry);
    else byTeam.set(key, { team: entry.team, players: [entry] });
  }

  const groups = Array.from(byTeam.entries())
    .sort((a, b) => (a[1].team?.fullName ?? "zzz").localeCompare(b[1].team?.fullName ?? "zzz"))
    .map(([key, group]) => {
      const links = group.players
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(
          (entry) =>
            `<li><a class="scp-index-link" href="${escapeHtml(
              `${prefix}${entry.slug}${query}`,
            )}">${escapeHtml(entry.name)}` +
            (entry.position
              ? `<span class="scp-index-pos">${escapeHtml(entry.position)}</span>`
              : "") +
            `</a></li>`,
        )
        .join("");
      return (
        `<div class="scp-index-group">` +
        `<h2 class="scp-index-team">${escapeHtml(group.team?.fullName ?? "Free agents")}</h2>` +
        `<ul class="scp-index-list" data-team="${escapeHtml(key)}">${links}</ul>` +
        `</div>`
      );
    })
    .join("");

  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0" />` +
    `<title>NFL Player Pages | StatChasers</title>` +
    `<meta name="robots" content="noindex, indexifembedded" />` +
    `<link rel="stylesheet" href="/player.css" />` +
    `</head><body class="scp-page"><div class="scp">` +
    `<header class="scp-hero"><span class="scp-hero-decor" aria-hidden="true"></span>` +
    `<div class="scp-hero-inner"><div class="scp-hero-text">` +
    // The same two-part heading the player hero sets, so the index and the
    // pages it lists read as one piece of furniture.
    `<h1 class="scp-title"><span class="scp-title-first">StatChasers</span> ` +
    `<span class="scp-title-last">NFL Player Pages</span></h1>` +
    `<p class="scp-hero-facts">Game logs, advanced stats, injury history and fantasy outlook.</p>` +
    `</div></div></header>` +
    `<div class="scp-section"><div class="scp-index">${groups}</div></div>` +
    `</div></body></html>`
  );
}
