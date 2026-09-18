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
 *    outlook), it is attributed and quoted, not adopted in the page's voice.
 *
 * A note on colour. The four finish tiers are an ORDINAL scale — POS1 through
 * Bust is an order, not a set of identities — so they take one hue in four
 * monotone lightness steps rather than four hues. The order is then visible in
 * the colour itself, and the page stays on-brand instead of becoming a chart
 * with a fruit salad in it. Every tier also carries its own text label, so the
 * palest step never has to carry meaning alone.
 */

import { escapeHtml, itemTimestamp, safeUrl, type NewsItem } from "./render";
import type { NflTeam } from "./team/teams";
import {
  finishBadge,
  fpts,
  keyStatSummary,
  metricAverage,
  positionColumns,
  positionMomentumMetrics,
  rollingAverage,
  weeklyTier,
  weeklyTierLabel,
  type WeeklyTier,
} from "./player/metrics";
import type { PlayerPageData, ProductionSeason } from "./player/player-data";
import { SCORING_LABELS, SCORING_SHORT, type ScoringFormat } from "./player/scoring";
import type {
  CareerSeasonStat,
  GameLogEntry,
  PlayerBio,
} from "./player/types";
import type { RiskLevel } from "./player/injury";

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
  /** Carried onto internal links so embed mode stays embed mode. */
  linkQuery?: string;
  /** Rendered for testability; the page cache keys on the data, not on this. */
  now?: number;
}

/* ------------------------------------------------------------------ atoms */

const DASH = "—";

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

/* ------------------------------------------------------------- chart marks */

/**
 * A percentile meter: one bar, one hue, the value written beside it.
 *
 * Sequential rather than categorical — it encodes magnitude, so it gets one
 * hue and no legend. The number is always printed, so the bar is a second
 * reading of it and never the only one.
 */
function renderMeter(label: string, value: string, percentile: number | null): string {
  const bar =
    percentile === null
      ? `<span class="scp-meter-empty">no rank</span>`
      : `<span class="scp-meter-track">` +
        `<span class="scp-meter-fill"${styleAttr([
          `width:${Math.max(2, Math.min(100, percentile))}%`,
        ])}></span>` +
        `</span>` +
        `<span class="scp-meter-pct">${escapeHtml(ordinal(percentile))}</span>`;
  return (
    `<div class="scp-meter">` +
    `<span class="scp-meter-label">${escapeHtml(label)}</span>` +
    `<span class="scp-meter-value">${escapeHtml(value)}</span>` +
    `<span class="scp-meter-bar">${bar}</span>` +
    `</div>`
  );
}

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
function renderStackedBar(segments: StackSegment[]): string {
  const shown = segments.filter((s) => s.pct > 0);
  if (shown.length === 0) return "";

  const bar = shown
    .map(
      (segment) =>
        `<span class="scp-stack-seg" data-tier="${segment.tier}"${styleAttr([
          `flex-basis:${segment.pct}%`,
          `background:${TIER_FILL[segment.tier]}`,
        ])}>` +
        // Only wide segments get an inline label; the rest rely on the legend.
        (segment.pct >= 12
          ? `<span class="scp-stack-inline">${escapeHtml(segment.pct.toFixed(0))}%</span>`
          : "") +
        `</span>`,
    )
    .join("");

  const legend = shown
    .map(
      (segment) =>
        `<li class="scp-legend-item">` +
        `<span class="scp-legend-swatch" aria-hidden="true"${styleAttr([
          `background:${TIER_FILL[segment.tier]}`,
        ])}></span>` +
        `<span class="scp-legend-label">${escapeHtml(segment.label)}</span>` +
        `<span class="scp-legend-value">${escapeHtml(
          `${segment.pct.toFixed(0)}% (${segment.games})`,
        )}</span>` +
        `</li>`,
    )
    .join("");

  return (
    `<div class="scp-stack">` +
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
function renderSparkline(points: SparkPoint[], average: number[]): string {
  if (points.length < 2) return "";

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
    ` role="img" aria-label="Weekly fantasy points with a three-game trailing average">` +
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
    `></span><span class="scp-legend-label">3-game average</span></li>` +
    `</ul>` +
    `</figcaption>` +
    `</figure>`
  );
}

/* ------------------------------------------------------------------- hero */

/** The player's headshot, with the team colour as a faint aura behind it. */
function renderHeadshot(data: PlayerPageData): string {
  const { player } = data;
  // Sleeper's thumbnail, the same CDN the news cards already use. A player with
  // no photo gets the StatChasers mark rather than a grey silhouette.
  const src = player.headshotUrl
    ? safeUrl(player.headshotUrl)
    : `https://sleepercdn.com/content/nfl/players/thumb/${encodeURIComponent(player.id)}.jpg`;
  if (!src) return "";
  return (
    `<div class="scp-photo">` +
    `<img class="scp-photo-img" src="${escapeHtml(src)}" alt=""` +
    ` width="128" height="128" decoding="async" />` +
    `</div>`
  );
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

function renderHero(data: PlayerPageData, options: PlayerRenderOptions): string {
  const { player, team, dynasty } = data;
  const Heading = options.embed ? "h2" : "h1";

  const teamPrefix = options.teamPathPrefix ?? "/team/";
  const query = options.linkQuery ?? "";

  const facts: string[] = [];
  if (player.position) facts.push(player.position);
  if (player.number) facts.push(`#${player.number}`);
  if (player.age) facts.push(`Age ${player.age}`);
  const height = formatHeight(player.height);
  if (height) facts.push(height);
  if (player.weight) facts.push(`${player.weight} lb`);
  if (player.years_exp !== null && player.years_exp !== undefined) {
    facts.push(player.years_exp === 0 ? "Rookie" : `${player.years_exp} yr exp`);
  }

  const teamLine = team
    ? `<a class="scp-hero-team" href="${escapeHtml(
        `${teamPrefix}${team.slug}${query}`,
      )}" target="_top">` +
      `<img class="scp-hero-logo" src="${escapeHtml(team.logo)}" alt="" width="24" height="24"` +
      ` loading="lazy" decoding="async" />` +
      `<span>${escapeHtml(team.fullName)}</span></a>`
    : "";

  // The current injury designation, which is the one piece of the hero that can
  // be urgent. Omitted entirely when there is none — never "Healthy", which is
  // a claim this data cannot support.
  const designation = player.injury_status
    ? `<span class="scp-hero-flag">${escapeHtml(player.injury_status)}</span>`
    : "";

  const rank =
    dynasty && Number.isFinite(dynasty.positionalRank)
      ? `<div class="scp-hero-rank">` +
        `<span class="scp-hero-rank-value">${escapeHtml(
          `${player.position ?? ""}${dynasty.positionalRank}`,
        )}</span>` +
        `<span class="scp-hero-rank-label">Dynasty positional rank</span>` +
        `</div>`
      : "";

  const rootStyle = styleAttr([
    team && `--team-primary:${team.primaryColor}`,
    team && `--team-secondary:${team.secondaryColor}`,
  ]);

  return (
    `<header class="scp-hero"${rootStyle}>` +
    `<span class="scp-hero-decor" aria-hidden="true"></span>` +
    `<div class="scp-hero-inner">` +
    renderHeadshot(data) +
    `<div class="scp-hero-text">` +
    `<p class="scp-eyebrow">StatChasers</p>` +
    `<${Heading} class="scp-title">${escapeHtml(player.name)}</${Heading}>` +
    `<p class="scp-hero-facts">${escapeHtml(facts.join("  ·  "))}</p>` +
    `<div class="scp-hero-meta">${teamLine}${designation}</div>` +
    `</div>` +
    rank +
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
function renderFormatToggle(
  data: PlayerPageData,
  options: PlayerRenderOptions,
): string {
  const prefix = options.playerPathPrefix ?? "/player/";
  const base = `${prefix}${data.player.slug}`;
  const items = (["standard", "half", "ppr"] as ScoringFormat[])
    .map((format) => {
      const active = format === data.format;
      const href = format === "ppr" ? base : `${base}?format=${format}`;
      return (
        `<a class="scp-format-opt${active ? " is-active" : ""}"` +
        ` href="${escapeHtml(href)}"${active ? ` aria-current="true"` : ` rel="nofollow"`}` +
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

/** The season headline: four numbers, no shared scale, so four tiles. */
function renderSeasonSummary(data: PlayerPageData): string {
  const { stats, seasonRank, player, seasonLabel } = data;
  if (!stats || stats.gamesPlayed === 0) return "";

  const best = stats.bestWeek;
  const badge = finishBadge(seasonRank, player.position);

  return (
    h2(
      `${data.season} Season Summary`,
      seasonLabel ?? undefined,
    ) +
    renderTiles([
      {
        label: `Points per game (${SCORING_LABELS[data.format]})`,
        value: num(stats.ppg),
        sub: `${stats.gamesPlayed} game${stats.gamesPlayed === 1 ? "" : "s"} played`,
      },
      {
        label: "Positional finish",
        value: seasonRank ? `${player.position ?? ""}${seasonRank}` : DASH,
        note: badge?.label,
        sub: badge?.descriptor,
      },
      {
        label: "Best week",
        value: best ? num(fpts(best, data.format)) : DASH,
        sub: best ? `Week ${best.week} vs ${best.opp}` : undefined,
      },
      {
        label: "Week-to-week swing",
        value: num(stats.volatility),
        note: data.outlook.volatilityLabel,
        sub: "Standard deviation of weekly points",
      },
    ])
  );
}

/**
 * The four-box read on form, role, consistency and ceiling.
 *
 * Each box states a number and the word the page is using for it, in that
 * order, so the label can always be checked against the thing it describes.
 */
function renderOutlookBoxes(data: PlayerPageData): string {
  const { outlook, stats } = data;
  if (!outlook.hasData || !stats) return "";

  const cards = [
    {
      label: "Recent form",
      value: outlook.formLabel,
      sub: outlook.formDetail,
      mod: outlook.formDirection,
    },
    {
      label: "Role",
      value: outlook.roleLabel,
      sub: `${pct(stats.pos1Pct + stats.pos2Pct)} of weeks finished as a starter`,
      mod: "",
    },
    {
      label: "Consistency",
      value: outlook.volatilityLabel,
      sub: `${num(stats.volatility)} pt swing on ${num(stats.ppg)} PPG`,
      mod: outlook.volatilityLevel,
    },
    {
      label: "Ceiling",
      value: pct(stats.pos1Pct),
      sub: `Weeks finishing as a top-12 ${data.player.position ?? "option"}`,
      mod: "",
    },
  ];

  const boxes = cards
    .map(
      (card) =>
        `<div class="scp-read" data-mod="${escapeHtml(card.mod)}">` +
        `<p class="scp-read-label">${escapeHtml(card.label)}</p>` +
        `<p class="scp-read-value">${escapeHtml(card.value)}</p>` +
        `<p class="scp-read-sub">${escapeHtml(card.sub)}</p>` +
        `</div>`,
    )
    .join("");

  return (
    `<div class="scp-reads">${boxes}</div>` +
    (outlook.bestWeekSentence
      ? `<p class="scp-note">${escapeHtml(outlook.bestWeekSentence)}</p>`
      : "")
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

  return (
    h3("Weekly finish distribution") +
    renderStackedBar(segments) +
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
    h3("Week by week") +
    renderSparkline(points, rollingAverage(points.map((p) => p.value), 3))
  );
}

/** Totals and per-game for the counting stats that matter at this position. */
function renderKeyStats(data: PlayerPageData): string {
  const played = data.gameLog.filter((e) => e.game_status === "active");
  const rows = keyStatSummary(played, data.player.position);
  if (rows.length === 0) return "";

  const cells = rows
    .map(
      (row) =>
        `<div class="scp-keystat">` +
        `<p class="scp-keystat-label">${escapeHtml(row.label)}</p>` +
        `<p class="scp-keystat-total">${escapeHtml(whole(row.total))}</p>` +
        `<p class="scp-keystat-pg">${escapeHtml(
          `${num(row.perGame, row.decimal ? 1 : 1)} per game`,
        )}</p>` +
        `</div>`,
    )
    .join("");

  return h3(`${data.season} totals`) + `<div class="scp-keystats">${cells}</div>`;
}

/**
 * Where the points came from, and how efficient they were.
 *
 * The TD-dependency line is the page's one genuine forward-looking hint, and it
 * is phrased as what it is — a description of this season's mix — because
 * touchdown rate is the part of a stat line least likely to repeat.
 */
function renderProduction(data: PlayerPageData): string {
  const { tdDependency: td, benchmarks } = data;
  if (td.label === "N/A" && !benchmarks) return "";

  const tdBlock =
    td.label === "N/A"
      ? ""
      : `<div class="scp-td" data-high="${td.isHigh ? "1" : "0"}">` +
        `<p class="scp-td-label">Scoring mix</p>` +
        `<p class="scp-td-value">${escapeHtml(td.label)}</p>` +
        `<p class="scp-td-sub">${escapeHtml(
          `${pct(td.pct)} of fantasy points came from touchdowns`,
        )}</p>` +
        `</div>`;

  // Each rate is printed as a number first and a bar second. The bar is the
  // league context — a 12.8 yards per catch is excellent for a tight end and
  // unremarkable for a deep threat, and the percentile is the only part of the
  // row that says which.
  let efficiency = "";
  if (data.benchmarks && data.rates) {
    const { benchmarks, rates } = data;
    const isQB = benchmarks.position === "QB";
    const p = benchmarks.percentile;

    const meters = [
      {
        label: isQB ? "Yards per attempt" : "Yards per catch",
        value: num(rates.yardsPerCatch),
        percentile: p?.yardsPerCatch ?? null,
      },
      {
        label: isQB ? "Completion rate" : "Catch rate",
        value: pct(rates.catchPct),
        percentile: p?.catchPct ?? null,
      },
      {
        label: isQB ? "TD per attempt" : "TD per target",
        value: pct(rates.tdPerTarget, 1),
        percentile: p?.tdPerTarget ?? null,
      },
    ];

    if (isQB && rates.fpPerUsage !== undefined) {
      meters.push({
        label: "Points per usage",
        value: num(rates.fpPerUsage, 2),
        percentile: p?.fpPerUsage ?? null,
      });
    }

    const rows = meters
      .map((m) => renderMeter(m.label, m.value, m.percentile))
      .join("");

    // Below the volume threshold the rates are still shown — they are what the
    // player did — but the percentiles are withheld, and the page says why
    // rather than quietly printing an empty bar.
    const caveat = benchmarks.playerQualified
      ? `<p class="scp-meters-note">${escapeHtml(
          `Ranked against every ${benchmarks.position} with at least ${benchmarks.qualifiedThreshold} ${
            isQB ? "attempts" : "targets"
          } in ${benchmarks.season}.`,
        )}</p>`
      : `<p class="scp-meters-note">${escapeHtml(
          `Not enough volume to rank: league percentiles need at least ${benchmarks.qualifiedThreshold} ${
            isQB ? "attempts" : "targets"
          }.`,
        )}</p>`;

    efficiency = `<div class="scp-meters">${rows}${caveat}</div>`;
  }

  return h3("Production profile") + `<div class="scp-prod">${tdBlock}${efficiency}</div>`;
}

/**
 * Role direction: the usage metrics that define this position, recent vs season.
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
    h3("Role direction") +
    `<table class="scp-table scp-table--role">` +
    `<caption class="scp-caption">Season average against the last four games played.</caption>` +
    `<thead><tr><th scope="col">Usage</th><th scope="col">Season</th>` +
    `<th scope="col">Last 4</th><th scope="col">Change</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>`
  );
}

/** The career aggregate. Omitted for a player with one season — see player-data. */
function renderCareerSnapshot(data: PlayerPageData): string {
  const profile = data.careerProfile;
  if (!profile) return "";

  const caveat = profile.smallSample
    ? `<p class="scp-note">${escapeHtml(
        `Career rates are drawn from ${profile.gamesPlayed} games and are too small a sample to read as a tendency.`,
      )}</p>`
    : "";

  return (
    h3("Career snapshot") +
    renderTiles(
      [
        {
          label: "Career points per game",
          value: num(profile.ppg),
          sub: `${profile.seasons} seasons`,
        },
        {
          label: "Availability",
          value: pct(profile.durabilityPct),
          sub: `${profile.gamesPlayed} of ${profile.maxGames} possible games`,
        },
        {
          label: `Top-12 ${data.player.position ?? ""} weeks`.trim(),
          value: pct(profile.pos1Pct),
          sub: "Share of games played",
        },
        {
          label: "Career swing",
          value: num(profile.volatility),
          note: profile.volatilityLabel,
          sub: "Standard deviation of weekly points",
        },
      ],
      "scp-tiles--career",
    ) +
    caveat
  );
}

/**
 * Season-end finishes, newest first.
 *
 * The single most useful block on the page for a drafting reader, because it is
 * the only one that answers "has this happened before" rather than "what is
 * happening now". Sourced from the production snapshot, which carries its own
 * positional finish per scoring format rather than re-deriving one here.
 */
function renderFinishTimeline(data: PlayerPageData): string {
  const seasons: ProductionSeason[] = data.production.filter(
    (row) => row.gamesPlayed > 0,
  );
  if (seasons.length === 0) return "";

  const rows = seasons
    .map((season) => {
      const badge = finishBadge(season.posFinishPpg, season.position);
      return (
        `<li class="scp-finish">` +
        `<span class="scp-finish-season">${escapeHtml(String(season.season))}</span>` +
        `<span class="scp-finish-rank">` +
        (season.posFinishPpg
          ? escapeHtml(`${season.position}${season.posFinishPpg}`)
          : DASH) +
        `</span>` +
        (badge
          ? `<span class="scp-finish-badge" data-tier="${escapeHtml(badge.tier)}">` +
            `${escapeHtml(badge.label)}</span>`
          : "") +
        `<span class="scp-finish-ppg">${escapeHtml(`${num(season.ppg)} PPG`)}</span>` +
        `<span class="scp-finish-gp">${escapeHtml(`${season.gamesPlayed} g`)}</span>` +
        `</li>`
      );
    })
    .join("");

  return (
    h3("Season-end finishes") +
    `<p class="scp-note">${escapeHtml(
      `Positional finish by points per game, ${SCORING_LABELS[data.format]}.`,
    )}</p>` +
    `<ul class="scp-finishes">${rows}</ul>`
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
 * logs and the draft table — no coach names, no adjectives nobody measured, no
 * claims the numbers do not support. It is rendered defensively because it is
 * the one data file whose shape is free-form.
 */
function renderBio(bio: PlayerBio | null, playerName: string): string {
  if (!bio) return "";

  const bullets = renderList(bio.snapshot_bullets, "scp-bullets");

  const style = bio.style
    ? [
        bio.style.how_he_wins
          ? `<div class="scp-style-row"><p class="scp-style-label">How he wins</p>` +
            `<p class="scp-style-text">${escapeHtml(bio.style.how_he_wins)}</p></div>`
          : "",
        bio.style.fantasy_translation
          ? `<div class="scp-style-row"><p class="scp-style-label">Fantasy translation</p>` +
            `<p class="scp-style-text">${escapeHtml(bio.style.fantasy_translation)}</p></div>`
          : "",
      ].join("")
    : "";

  const tiles = Array.isArray(bio.career_context_tiles)
    ? renderTiles(
        bio.career_context_tiles
          .filter((tile) => tile && typeof tile.label === "string" && tile.value)
          .map((tile) => ({
            label: String(tile.label),
            value: String(tile.value),
            sub: tile.detail ? String(tile.detail) : undefined,
          })),
        "scp-tiles--bio",
      )
    : "";

  const timeline = Array.isArray(bio.timeline)
    ? bio.timeline
        .filter((step) => step && (step.label || step.detail))
        .map(
          (step) =>
            `<li class="scp-step">` +
            (step.season
              ? `<span class="scp-step-season">${escapeHtml(String(step.season))}</span>`
              : "") +
            (step.label
              ? `<span class="scp-step-label">${escapeHtml(String(step.label))}</span>`
              : "") +
            (step.detail
              ? `<span class="scp-step-detail">${escapeHtml(String(step.detail))}</span>`
              : "") +
            `</li>`,
        )
        .join("")
    : "";

  const narrative = Array.isArray(bio.narrative_paragraphs)
    ? bio.narrative_paragraphs
        .filter((p): p is string => typeof p === "string" && p.trim() !== "")
        .map((p) => `<p class="scp-para">${escapeHtml(p)}</p>`)
        .join("")
    : "";

  const body =
    bullets +
    style +
    tiles +
    (timeline ? `<ol class="scp-steps">${timeline}</ol>` : "") +
    narrative;

  if (!body) return "";

  const stamp = bio.last_updated
    ? `<p class="scp-stamp">${escapeHtml(`Profile compiled ${bio.last_updated}`)}</p>`
    : "";

  return h3(`About ${playerName}`) + `<div class="scp-bio">${body}${stamp}</div>`;
}

/**
 * The precomputed 2026 outlook.
 *
 * The only section on the page that looks forward, and the only one whose words
 * are not the page's own — so it is framed as a quoted view with its season
 * named, not merged into the surrounding prose. Rule 3 at the top of this file
 * is about exactly this block.
 */
function renderOutlook2026(data: PlayerPageData): string {
  const outlook = data.fantasyOutlook2026;
  if (!outlook?.headline && !outlook?.body) return "";
  return (
    h3("2026 fantasy outlook") +
    `<blockquote class="scp-outlook">` +
    (outlook.headline
      ? `<p class="scp-outlook-headline">${escapeHtml(outlook.headline)}</p>`
      : "") +
    (outlook.body ? `<p class="scp-outlook-body">${escapeHtml(outlook.body)}</p>` : "") +
    `<footer class="scp-outlook-src">StatChasers 2026 outlook</footer>` +
    `</blockquote>`
  );
}

/* --------------------------------------------------------------- game log */

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
 * The weekly game log.
 *
 * Every week of the season is a row, including the ones the player did not
 * play. That is the point of the table: a season with five blank weeks in it
 * looks like a season with five blank weeks in it, rather than like twelve
 * clean games. Byes and absences are marked as what they were.
 */
function renderWeeklyLog(data: PlayerPageData): string {
  const { gameLog, player, format } = data;
  if (gameLog.length === 0) return "";

  const columns = positionColumns(player.position);
  // WR/TE only get rushing columns in a season where they actually ran.
  const rushed =
    columns.conditionalRush &&
    gameLog.some((entry) => (statOf(entry, "rush_att") ?? 0) > 0);
  const primary = rushed
    ? [
        ...columns.primary,
        { key: "rush_att", label: "CAR" },
        { key: "rush_yd", label: "RUSH YDS" },
        { key: "rush_td", label: "RUSH TD" },
      ]
    : columns.primary;
  const all = [...primary, ...columns.detail];

  const head =
    `<tr>` +
    `<th scope="col">Wk</th>` +
    `<th scope="col">Opp</th>` +
    `<th scope="col">Result</th>` +
    all.map((c) => `<th scope="col">${escapeHtml(c.label)}</th>`).join("") +
    `<th scope="col">Pts</th>` +
    `<th scope="col">Finish</th>` +
    `</tr>`;

  const rows = gameLog
    .map((entry) => {
      const status = entry.game_status ?? "out";
      if (status !== "active") {
        return (
          `<tr class="scp-row" data-status="${escapeHtml(status)}">` +
          `<th scope="row">${entry.week}</th>` +
          `<td colspan="${all.length + 4}" class="scp-row-empty">${escapeHtml(
            status === "bye" ? "Bye week" : "Did not play",
          )}</td>` +
          `</tr>`
        );
      }

      const points = fpts(entry, format);
      const tier = weeklyTier(entry.pos_rank);
      const oppRank = entry.opp_rank_vs_pos;

      return (
        `<tr class="scp-row" data-status="active">` +
        `<th scope="row">${entry.week}</th>` +
        `<td class="scp-opp">${escapeHtml(entry.opp)}` +
        (oppRank
          ? `<span class="scp-opp-rank" title="${escapeHtml(
              `${entry.opp} allowed the ${ordinal(oppRank)}-fewest points to ${
                player.position ?? "this position"
              } that season`,
            )}">${escapeHtml(ordinal(oppRank))}</span>`
          : "") +
        `</td>` +
        `<td class="scp-score">${escapeHtml(scoreLabel(entry))}</td>` +
        all
          .map((column) => {
            const value = statOf(entry, column.key);
            return `<td>${value === null ? DASH : escapeHtml(whole(value))}</td>`;
          })
          .join("") +
        `<td class="scp-pts">${escapeHtml(num(points))}</td>` +
        `<td>` +
        (tier && entry.pos_rank
          ? `<span class="scp-tier" data-tier="${tier}"${styleAttr([
              `--tier-fill:${TIER_FILL[tier]}`,
            ])}>${escapeHtml(
              `${player.position ?? ""}${entry.pos_rank}`,
            )}</span>`
          : DASH) +
        `</td>` +
        `</tr>`
      );
    })
    .join("");

  return (
    h2(`${data.season} game log`, data.seasonLabel ?? undefined) +
    `<div class="scp-scroll">` +
    `<table class="scp-table scp-table--log" data-scp-log>` +
    `<caption class="scp-caption">${escapeHtml(
      `Every week of the ${data.season} season. Fantasy points are ${SCORING_LABELS[format]}; "Finish" is the weekly rank among all ${player.position ?? "players"}.`,
    )}</caption>` +
    `<thead>${head}</thead><tbody>${rows}</tbody></table></div>`
  );
}

/** Career totals by season — the counting stats, not the rates. */
function renderCareerTable(data: PlayerPageData): string {
  const seasons = data.careerSeasons;
  if (seasons.length === 0) return "";

  const position = data.player.position;
  const isQB = position === "QB";
  const isRB = position === "RB";

  const columns: { label: string; get: (row: CareerSeasonStat) => number }[] = isQB
    ? [
        { label: "CMP", get: (r) => r.pass_cmp },
        { label: "ATT", get: (r) => r.pass_att },
        { label: "PASS YDS", get: (r) => r.pass_yd },
        { label: "PASS TD", get: (r) => r.pass_td },
        { label: "INT", get: (r) => r.pass_int },
        { label: "RUSH YDS", get: (r) => r.rush_yd },
        { label: "RUSH TD", get: (r) => r.rush_td },
      ]
    : isRB
      ? [
          { label: "CAR", get: (r) => r.rush_att },
          { label: "RUSH YDS", get: (r) => r.rush_yd },
          { label: "RUSH TD", get: (r) => r.rush_td },
          { label: "REC", get: (r) => r.receptions },
          { label: "REC YDS", get: (r) => r.rec_yd },
          { label: "REC TD", get: (r) => r.rec_td },
        ]
      : [
          { label: "TGT", get: (r) => r.targets },
          { label: "REC", get: (r) => r.receptions },
          { label: "REC YDS", get: (r) => r.rec_yd },
          { label: "REC TD", get: (r) => r.rec_td },
          { label: "RUSH YDS", get: (r) => r.rush_yd },
        ];

  const head =
    `<tr><th scope="col">Season</th><th scope="col">G</th><th scope="col">PPG</th>` +
    `<th scope="col">Finish</th>` +
    columns.map((c) => `<th scope="col">${escapeHtml(c.label)}</th>`).join("") +
    `</tr>`;

  const rows = seasons
    .map(
      (row) =>
        `<tr>` +
        `<th scope="row">${escapeHtml(String(row.season))}</th>` +
        `<td>${row.gp}</td>` +
        `<td class="scp-pts">${escapeHtml(num(row.ppg))}</td>` +
        `<td>${row.posRank ? escapeHtml(`${position ?? ""}${row.posRank}`) : DASH}</td>` +
        columns.map((c) => `<td>${escapeHtml(whole(c.get(row)))}</td>`).join("") +
        `</tr>`,
    )
    .join("");

  // Totals rather than an average row: adding up counting stats is meaningful,
  // and averaging a rate across seasons of different length is not.
  const totals = seasons.reduce(
    (acc, row) => {
      acc.gp += row.gp;
      return acc;
    },
    { gp: 0 },
  );

  const foot =
    `<tr class="scp-total"><th scope="row">Career</th><td>${totals.gp}</td>` +
    `<td class="scp-pts">${escapeHtml(num(data.careerProfile?.ppg))}</td><td>${DASH}</td>` +
    columns
      .map((c) =>
        `<td>${escapeHtml(whole(seasons.reduce((sum, row) => sum + c.get(row), 0)))}</td>`,
      )
      .join("") +
    `</tr>`;

  return (
    h3("Career by season") +
    `<div class="scp-scroll">` +
    `<table class="scp-table scp-table--career">` +
    `<thead>${head}</thead><tbody>${rows}</tbody><tfoot>${foot}</tfoot>` +
    `</table></div>`
  );
}

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
              `?adv=${season}${data.format === "ppr" ? "" : `&format=${data.format}`}#advanced`;
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
    h2(
      "Advanced stats",
      advanced.throughWeek
        ? `${advanced.season} season through Week ${advanced.throughWeek} · ${context}`
        : context,
    ) +
    switcher +
    `<p class="scp-note">${escapeHtml(
      "Each bar is this player's percentile among qualifying players at the position. Metrics where a lower number is better are inverted, so a longer bar is always better.",
    )}</p>` +
    `<div class="scp-adv">${groups}</div>`
  );
}

/* ------------------------------------------------------------------ injury */

const RISK_WORD: Record<RiskLevel, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
};

/**
 * Injury and availability.
 *
 * Built on games missed rather than injuries logged, because the two are very
 * different numbers and only one of them cost anybody a fantasy week. Nothing
 * here is a medical claim or a forecast; it is the record, tallied, with the
 * page's own labels attached and the rule for each label stated.
 */
function renderInjury(data: PlayerPageData): string {
  const injury = data.injury;
  if (!injury) return "";

  const { summary, history, risks, regions, seasons, insight } = injury;

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
      sub: "Across every logged injury",
    },
    {
      label: "Injuries logged",
      value: whole(summary.injuriesLogged),
      sub: `${summary.affectedRegions} body region${summary.affectedRegions === 1 ? "" : "s"}`,
    },
    {
      label: "Most recent",
      value: summary.lastSeason ? String(summary.lastSeason) : DASH,
      sub: "Last season with a logged injury",
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
        `<li class="scp-risk" data-level="${risk.level}">` +
        `<span class="scp-risk-label">${escapeHtml(risk.label)}</span>` +
        `<span class="scp-risk-level">${escapeHtml(RISK_WORD[risk.level])}</span>` +
        `</li>`,
    )
    .join("");

  const regionRows = regions
    .map(
      (region) =>
        `<li class="scp-region">` +
        `<span class="scp-region-name">${escapeHtml(region.region)}</span>` +
        `<span class="scp-region-count">${escapeHtml(
          `${region.count} injur${region.count === 1 ? "y" : "ies"}`,
        )}</span>` +
        `<span class="scp-region-missed">${escapeHtml(
          region.gamesMissed > 0 ? `${region.gamesMissed} g missed` : "none missed",
        )}</span>` +
        `</li>`,
    )
    .join("");

  const timeline = seasons
    .map(
      (season) =>
        `<li class="scp-inj-season">` +
        `<p class="scp-inj-year">${escapeHtml(String(season.season))}` +
        (season.gamesMissed > 0
          ? `<span class="scp-inj-missed">${escapeHtml(
              `${season.gamesMissed} game${season.gamesMissed === 1 ? "" : "s"} missed`,
            )}</span>`
          : `<span class="scp-inj-played">played through</span>`) +
        `</p>` +
        `<ul class="scp-inj-list">` +
        season.entries
          .map(
            (entry) =>
              `<li class="scp-inj-item" data-severity="${escapeHtml(entry.severity ?? "")}">` +
              `<span class="scp-inj-type">${escapeHtml(entry.type)}</span>` +
              (entry.week
                ? `<span class="scp-inj-week">${escapeHtml(`Wk ${entry.week}`)}</span>`
                : "") +
              (entry.description
                ? `<span class="scp-inj-desc">${escapeHtml(entry.description)}</span>`
                : "") +
              `</li>`,
          )
          .join("") +
        `</ul></li>`,
    )
    .join("");

  return (
    h2("Injury & health", "Logged injuries and the games they actually cost") +
    `<div class="scp-injury-top">${grade}${tiles}</div>` +
    (insight ? `<p class="scp-note scp-note--lead">${escapeHtml(insight)}</p>` : "") +
    (riskRows
      ? h3("Risk profile") +
        `<ul class="scp-risks">${riskRows}</ul>` +
        `<p class="scp-note">${escapeHtml(
          "Each row is one explicit rule over the record below — recent injuries, repeats to the same body part, total games missed, and how concentrated those injuries are. They are shown separately because they can disagree.",
        )}</p>`
      : "") +
    (regionRows ? h3("By body region") + `<ul class="scp-regions">${regionRows}</ul>` : "") +
    (timeline ? h3("History") + `<ol class="scp-inj-timeline">${timeline}</ol>` : "")
  );
}

/* -------------------------------------------------------------------- news */

/**
 * The player's news, from this app's own archive.
 *
 * The standalone player app scraped eight club websites for this tab. Here the
 * pipeline that already ingests that news answers instead, so a player's news
 * is the same rows, with the same dedupe and the same categories, as the news
 * tool and the team hubs — one archive, three views of it.
 */
function renderNews(data: PlayerPageData, options: PlayerRenderOptions): string {
  if (data.news.length === 0) return "";
  const now = options.now ?? Date.now();

  const cards = data.news
    .map((item: NewsItem) => {
      const href = safeUrl(item.link ?? null);
      const ts = itemTimestamp(item);
      const headline = escapeHtml(item.title);
      return (
        `<li class="scp-news-item">` +
        `<h3 class="scp-news-title">` +
        (href
          ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${headline}</a>`
          : headline) +
        `</h3>` +
        (item.summary
          ? `<p class="scp-news-summary">${escapeHtml(item.summary)}</p>`
          : "") +
        `<p class="scp-news-meta">` +
        (item.source ? `<span class="scp-news-source">${escapeHtml(item.source)}</span>` : "") +
        (ts !== null
          ? `<time class="scp-news-time" datetime="${escapeHtml(
              new Date(ts).toISOString(),
            )}" data-ts="${ts}">${escapeHtml(relativeAge(ts, now))}</time>`
          : "") +
        `</p></li>`
      );
    })
    .join("");

  return (
    h2("News & analysis", `Latest reporting on ${data.player.name}`) +
    `<ul class="scp-news">${cards}</ul>`
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

export function renderPlayerPage(
  data: PlayerPageData,
  options: PlayerRenderOptions = {},
): string {
  const overview =
    renderSeasonSummary(data) +
    renderOutlookBoxes(data) +
    renderDistribution(data) +
    renderTrend(data) +
    renderKeyStats(data) +
    renderProduction(data) +
    renderRoleDirection(data) +
    renderCareerSnapshot(data) +
    renderFinishTimeline(data) +
    renderOutlook2026(data);

  const bio = renderBio(data.bio, data.player.name);
  const gameLog = renderWeeklyLog(data) + renderCareerTable(data);
  const advanced = renderAdvanced(data, options);
  const injury = renderInjury(data);
  const news = renderNews(data, options);

  // Built from what actually rendered: a section that produced no markup is not
  // in the page and must not be in the navigation pointing at nothing. A backup
  // with no game log gets a two-tab page, not five tabs of empty panels.
  const sections: Section[] = [
    { id: "overview", label: "Overview", html: overview },
    { id: "game-log", label: "Game Log", html: gameLog },
    { id: "advanced", label: "Advanced Stats", html: advanced },
    { id: "bio", label: "Bio", html: bio },
    { id: "injury", label: "Injury & Health", html: injury },
    { id: "news", label: "News", html: news },
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
    ` data-format="${escapeHtml(data.format)}">` +
    renderHero(data, options) +
    `<div class="scp-controls">` +
    renderNav(sections) +
    renderFormatToggle(data, options) +
    `</div>` +
    body +
    `</div>`
  );
}

export interface PlayerIndexEntry {
  slug: string;
  name: string;
  position: string | null;
  team: NflTeam | null;
}

/**
 * A plain index of the indexed players at /player.
 *
 * Its job is navigation and verification, not presentation: it is how you check
 * that every slug resolves, and it gives the 404 somewhere useful to send a
 * reader. A full document rather than a fragment, because nothing embeds it.
 */
export function renderPlayerIndex(
  entries: PlayerIndexEntry[],
  options: { playerPathPrefix?: string; linkQuery?: string } = {},
): string {
  const prefix = options.playerPathPrefix ?? "/player/";
  const query = options.linkQuery ?? "";

  const byTeam = new Map<string, { team: NflTeam | null; players: PlayerIndexEntry[] }>();
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
    `<p class="scp-eyebrow">StatChasers</p>` +
    `<h1 class="scp-title">NFL Player Pages</h1>` +
    `<p class="scp-hero-facts">Game logs, advanced stats, injury history and fantasy outlook.</p>` +
    `</div></div></header>` +
    `<div class="scp-section"><div class="scp-index">${groups}</div></div>` +
    `</div></body></html>`
  );
}
