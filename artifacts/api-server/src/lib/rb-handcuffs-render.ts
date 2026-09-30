/**
 * Markup for the RB handcuff rankings.
 *
 * Server-only, like the other tools' renderers. The whole board is in the
 * response — every backup, the starter he backs up, his score, tier and type,
 * and under each row the breakdown and the reasons it ranks where it does —
 * and client/rb-handcuffs.ts takes over the controls on top of it: the weight
 * sliders that re-rank the board, sorting, the expandable rows, the compare
 * tray and the player card.
 *
 * That is the substantive change from the app this came from. There the board
 * was React state: the WordPress plugin printed a plain snapshot table into the
 * page, and the bundle then CLEARED it and drew its own in its place, so the
 * HTML a crawler read and the table a reader used were two renderings of one
 * file kept in step by a build script. Here there is one table.
 *
 * The rules are the other tools':
 *
 * 1. A field we do not have is not rendered. The engine has no role trend,
 *    ADP, rostered share or committee flag for anyone this season, so none of
 *    those appear — the code for them is here, and they will when it does.
 * 2. Nothing predicts beyond what the model says. The scores are the engine's
 *    (lib/rb-handcuffs/engine), rescored at the default weights by the same
 *    module the bundle re-ranks with.
 *
 * And the one the rankings and the stats table follow:
 *
 * 3. **A control that cannot work is not shown.** The weight sliders, the sort
 *    buttons and the compare column do nothing without the bundle, so they ship
 *    `hidden` or are built by it. The model reference and the badge guide are
 *    `<details>`, and open with scripting off.
 */

import { escapeHtml, escapeJsonLd, teamLogoUrl } from "./render";
import { getTeamByAbbreviation } from "./team/teams";
import {
  archetypeLine,
  barBand,
  generateSummary,
  handcuffType,
  HANDCUFF_TYPES,
  METHODOLOGY_NOTE,
  PILLARS,
  rankTone,
  scoreTone,
  statusBadges,
  tierFor,
  toneOf,
  whyBullets,
  type HandcuffBoard,
  type HandcuffPlayer,
  type HandcuffType,
  type Pillar,
} from "./rb-handcuffs/handcuffs-data";
import {
  bestHandcuffs,
  bestHeading,
  handcuffFaq,
  HANDCUFF_FAQ_HEADING,
  type HandcuffFaq,
} from "./rb-handcuffs/handcuffs-faq";
import { icon } from "./rb-handcuffs/icons";
import { DEFAULT_WEIGHTS } from "./rb-handcuffs/recompute";

export interface HandcuffRenderOptions {
  /**
   * Embedded inside a statchasers.com page: drops the standalone padding,
   * because the host page supplies the heading and the surrounding copy.
   */
  embed?: boolean;
  /** Where a player link points. Defaults to this app's own /player/. */
  playerPathPrefix?: string;
  /** Carried onto player links so embed mode stays embed mode. */
  linkQuery?: string;
  /**
   * Where the bundle fetches a player card from. Absolute on the embed,
   * because a relative path printed inside a statchasers.com page resolves
   * against WordPress, not against this origin.
   */
  endpoint?: string;
}

const DEFAULT_PLAYER_PREFIX = "/player/";

/* ------------------------------------------------------------- formatting */

const MONTHS = [
  "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December",
];

/** "August 17, 2026", in UTC — no locale default, so the render is deterministic. */
function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

const NAME_SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"]);

/** "Christian McCaffrey" → "C. McCaffrey", skipping a suffix. MIRRORS abbreviateName(). */
function abbreviate(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return name;
  let last = parts.length - 1;
  if (NAME_SUFFIXES.has(parts[last]!.toLowerCase()) && last > 1) last -= 1;
  return `${parts[0]![0]}. ${parts[last]}`;
}

/** Initials for a card with no headshot: "Alvin Kamara" → "AK". */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]![0] : "")).toUpperCase();
}

/** Sleeper's logo files are lower case and use Sleeper's codes: WSH is `was`. */
function logoFor(team: string): string | null {
  const abbr = getTeamByAbbreviation(team)?.abbreviation ?? team.toLowerCase();
  return teamLogoUrl(abbr);
}

function headshotUrl(sleeperId: string): string {
  return `https://sleepercdn.com/content/nfl/players/thumb/${encodeURIComponent(sleeperId)}.jpg`;
}

function playerHref(slug: string, options: HandcuffRenderOptions): string {
  const prefix = options.playerPathPrefix ?? DEFAULT_PLAYER_PREFIX;
  return `${prefix}${slug}/${options.linkQuery ?? ""}`;
}

/**
 * The starter's status on this week's injury report, as a short tag. Only
 * while the statuses are fresh: a stale "Q" is worse than none.
 */
const STATUS_TAGS: Record<string, string> = {
  questionable: "Q",
  doubtful: "D",
  out: "O",
  ir: "IR",
  pup: "PUP",
  nfi: "NFI",
  sus: "SUS",
};

function statusTag(p: HandcuffPlayer, fresh: boolean): string {
  const status = p.starterInjuryStatus;
  if (!fresh || !status) return "";
  const tag = STATUS_TAGS[status.toLowerCase()] ?? status;
  const severe = ["out", "ir", "pup", "nfi", "sus", "doubtful"].includes(status.toLowerCase());
  return (
    ` <abbr class="rbh-inj${severe ? " is-severe" : ""}"` +
    ` title="${escapeHtml(`${p.starterName ?? "Starter"}: ${status}`)}">${escapeHtml(tag)}</abbr>`
  );
}

/* --------------------------------------------------------- the settings */

function pct(weight: number): number {
  return Math.round(weight * 100);
}

/**
 * The weight model: an allocation bar, the three pillar sliders and the
 * Re-rank button. `hidden` until the bundle wires it — every input here
 * re-ranks rows already on the page, and without the bundle it is a form that
 * does nothing.
 */
function renderWeights(): string {
  const segments = PILLARS.map(
    (p) =>
      `<span class="rbh-alloc-seg is-${p.accent}" data-rbh-seg="${p.key}"` +
      ` style="width:${pct(DEFAULT_WEIGHTS[p.key])}%"></span>`,
  ).join("");

  const keys = PILLARS.map(
    (p) =>
      `<span class="rbh-alloc-key"><span class="rbh-dot is-${p.accent}"></span>` +
      `<span>${escapeHtml(p.title)}</span>` +
      ` <strong data-rbh-key="${p.key}">${pct(DEFAULT_WEIGHTS[p.key])}%</strong></span>`,
  ).join("");

  const sliders = PILLARS.map((p) => renderSlider(p)).join("");

  return (
    `<div class="rbh-weights" data-rbh-weights hidden>` +
    `<p class="rbh-hint">Adjust how much each scoring pillar impacts the final handcuff ranking.</p>` +
    `<div class="rbh-alloc">` +
    `<div class="rbh-alloc-head">` +
    `<span class="rbh-label">Model Allocation</span>` +
    `<button type="button" class="rbh-reset" data-rbh-reset disabled>Reset</button>` +
    `</div>` +
    `<div class="rbh-alloc-bar">${segments}</div>` +
    `<div class="rbh-alloc-keys">${keys}</div>` +
    `</div>` +
    `<div class="rbh-sliders">${sliders}</div>` +
    `<div class="rbh-apply">` +
    `<div class="rbh-status" data-rbh-status aria-live="polite">` +
    `<span class="rbh-status-main is-ok">Model balanced</span>` +
    `<span class="rbh-status-sub">No unsaved changes</span>` +
    `</div>` +
    `<button type="button" class="rbh-rerank" data-rbh-apply disabled>Re-rank Players</button>` +
    `</div>` +
    `</div>`
  );
}

function renderSlider(p: Pillar): string {
  const value = pct(DEFAULT_WEIGHTS[p.key]);
  const id = `rbh-w-${p.key}`;
  return (
    `<div class="rbh-slider is-${p.accent}">` +
    `<div class="rbh-slider-cat"><span class="rbh-dot is-${p.accent}"></span>${escapeHtml(p.category)}</div>` +
    `<div class="rbh-slider-head">` +
    `<label class="rbh-slider-title" for="${id}">${escapeHtml(p.title)}</label>` +
    `<output class="rbh-slider-pct" for="${id}" data-rbh-out="${p.key}">${value}%</output>` +
    `</div>` +
    `<p class="rbh-slider-desc">${escapeHtml(p.description)}</p>` +
    `<input type="range" id="${id}" name="${p.key}" min="0" max="100" step="5"` +
    ` value="${value}" data-default="${value}" data-rbh-weight="${p.key}"` +
    ` style="--rbh-fill:${value}%" />` +
    `</div>`
  );
}

/** The three pillar cards. Each one's detail is a `<details>` of its own. */
function renderFactorReference(board: HandcuffBoard): string {
  const cards = PILLARS.map(
    (p) =>
      `<div class="rbh-pillar">` +
      `<p class="rbh-pillar-title">${escapeHtml(p.title)}</p>` +
      `<p class="rbh-pillar-tag">${escapeHtml(p.tagline)}</p>` +
      `<p class="rbh-chips">${p.chips.map((c) => `<span class="rbh-chip">${escapeHtml(c)}</span>`).join("")}</p>` +
      `<details class="rbh-more">` +
      `<summary><span class="rbh-more-show">View details</span><span class="rbh-more-hide">Hide details</span>${icon("chevron", "rbh-chev")}</summary>` +
      `<div class="rbh-more-body">` +
      `<p class="rbh-pillar-intro">${escapeHtml(p.intro)}</p>` +
      p.factors
        .map(
          (f) =>
            `<p class="rbh-factor"><strong>${escapeHtml(f.name)}</strong>` +
            `<span>${escapeHtml(f.desc)}</span></p>`,
        )
        .join("") +
      (p.closingNote ? `<p class="rbh-note-small">${escapeHtml(p.closingNote)}</p>` : "") +
      `</div>` +
      `</details>` +
      `</div>`,
  ).join("");

  return (
    `<p class="rbh-ref-intro">These are the three scoring pillars used to rank RB handcuffs.` +
    ` Backfield Opportunity and Path to Opportunity are measured on the ${board.statsSeason} season;` +
    ` Player Quality on each back's last six games played, reaching back into ${board.statsSeason - 1}` +
    ` when he has fewer than six this season, and never week 18. Scores are percentile-ranked against` +
    ` that pool.</p>` +
    `<div class="rbh-pillars">${cards}</div>` +
    `<p class="rbh-note-small">${escapeHtml(METHODOLOGY_NOTE)}</p>`
  );
}

function renderBadgeCard(t: HandcuffType): string {
  return (
    `<div class="rbh-badge-card">` +
    `<p class="rbh-badge-name rbh-type-${t.key}">${icon(t.key)}${escapeHtml(t.label)}</p>` +
    `<p class="rbh-badge-meaning">${escapeHtml(t.meaning)}</p>` +
    `<p class="rbh-badge-desc">${escapeHtml(t.desc)}</p>` +
    `</div>`
  );
}

function renderBadgeGuide(): string {
  const group = (key: HandcuffType["group"], title: string): string =>
    `<p class="rbh-badge-group is-${key}">${escapeHtml(title)}</p>` +
    `<div class="rbh-badge-grid">${HANDCUFF_TYPES.filter((t) => t.group === key)
      .map(renderBadgeCard)
      .join("")}</div>`;
  return (
    `<p class="rbh-ref-intro">Badge labels summarize each backup's stash profile.</p>` +
    group("priority", "Priority Stashes") +
    group("caution", "Caution Flags")
  );
}

/** The model reference: two accordions that work with scripting off. */
function renderReference(board: HandcuffBoard): string {
  return (
    `<div class="rbh-reference">` +
    `<p class="rbh-label">Model Reference</p>` +
    `<div class="rbh-accordions">` +
    `<details class="rbh-accordion">` +
    `<summary>${icon("info", "rbh-icon is-muted")}<span>What each component measures</span>${icon("chevron", "rbh-chev")}</summary>` +
    `<div class="rbh-accordion-body">${renderFactorReference(board)}</div>` +
    `</details>` +
    `<details class="rbh-accordion">` +
    `<summary>${icon("premium", "rbh-icon is-muted")}<span>Badge Guide</span>${icon("chevron", "rbh-chev")}</summary>` +
    `<div class="rbh-accordion-body">${renderBadgeGuide()}</div>` +
    `</details>` +
    `</div>` +
    `</div>`
  );
}

function renderPanel(board: HandcuffBoard): string {
  const updated = formatDate(board.updatedAt);
  return (
    `<div class="rbh-panel">` +
    (updated && board.updatedAt
      ? `<p class="rbh-updated">Depth charts and injury report as of ` +
        `<time datetime="${escapeHtml(board.updatedAt)}">${escapeHtml(updated)}</time>` +
        (board.statsWeek != null ? ` · ${board.statsSeason} stats through week ${board.statsWeek}` : "") +
        (board.statusFresh ? "" : ` · injury statuses are out of date and not counted`) +
        `</p>`
      : "") +
    renderWeights() +
    renderReference(board) +
    `</div>`
  );
}

/* --------------------------------------------------------------- the table */

/**
 * The legend the narrow table needs: below 640px the Note column is an icon,
 * and this maps the icons back to their names. Only the types on the board.
 */
function renderLegend(board: HandcuffBoard): string {
  const present = new Set(board.players.map((p) => p.handcuffType).filter(Boolean));
  const types = HANDCUFF_TYPES.filter((t) => present.has(t.label));
  if (types.length === 0) return "";
  return (
    `<p class="rbh-legend">` +
    types
      .map(
        (t) =>
          `<span class="rbh-legend-item rbh-type-${t.key}">${icon(t.key)}` +
          `<span>${escapeHtml(t.label)}</span></span>`,
      )
      .join("") +
    `</p>`
  );
}

function renderName(p: HandcuffPlayer, options: HandcuffRenderOptions): string {
  const inner =
    `<span class="rbh-name-full">${escapeHtml(p.playerName)}</span>` +
    `<span class="rbh-name-short" aria-hidden="true">${escapeHtml(abbreviate(p.playerName))}</span>`;
  if (!p.slug) return `<span class="rbh-name">${inner}</span>`;
  // target="_top" for the reason the rankings give: the legacy iframe mount
  // still exists, and a profile opening inside it is a page in a box.
  return (
    `<a class="rbh-name" href="${escapeHtml(playerHref(p.slug, options))}" target="_top">${inner}</a>`
  );
}

/**
 * The StatChasers note, when curation.json gives him one: an icon beside his
 * name that opens the note as a native popover. The top layer puts it above
 * the table's scroll box and any host stacking context, and the browser
 * handles Escape and click-away. The row's click handler ignores buttons, so
 * opening it does not also expand the row.
 */
function renderStatchasersNote(p: HandcuffPlayer): string {
  if (!p.statchasersNote) return "";
  const id = `rbh-scnote-${p.id}`;
  return (
    `<button type="button" class="rbh-scnote-btn" popovertarget="${escapeHtml(id)}"` +
    ` aria-label="StatChasers note on ${escapeHtml(p.playerName)}" title="StatChasers note">` +
    icon("note", "rbh-icon") +
    `</button>` +
    `<div class="rbh-scnote" id="${escapeHtml(id)}" popover>` +
    `<p class="rbh-scnote-head">${icon("note", "rbh-icon")}StatChasers Note` +
    `<button type="button" class="rbh-scnote-close" popovertarget="${escapeHtml(id)}"` +
    ` popovertargetaction="hide" aria-label="Close">&times;</button></p>` +
    `<p class="rbh-scnote-player">${escapeHtml(p.playerName)} · ${escapeHtml(p.team)}</p>` +
    `<p class="rbh-scnote-body">${escapeHtml(p.statchasersNote)}</p>` +
    `</div>`
  );
}

function renderStarter(p: HandcuffPlayer, fresh: boolean): string {
  if (!p.starterName) return `<span class="rbh-na">N/A</span>`;
  return (
    `<span class="rbh-name-full">${escapeHtml(p.starterName)}</span>` +
    `<span class="rbh-name-short" aria-hidden="true">${escapeHtml(abbreviate(p.starterName))}</span>` +
    statusTag(p, fresh)
  );
}

function renderNote(p: HandcuffPlayer): string {
  const type = handcuffType(p.handcuffType);
  if (!p.handcuffType) return `<span class="rbh-na">—</span>`;
  if (!type) return `<span class="rbh-note-text">${escapeHtml(p.handcuffType)}</span>`;
  return (
    `<span class="rbh-note rbh-type-${type.key}" title="${escapeHtml(type.label)}">` +
    icon(type.key, "rbh-icon rbh-note-icon") +
    `<span class="rbh-note-text">${escapeHtml(type.label)}</span>` +
    `</span>`
  );
}

/** One pillar in the expanded row: label, rank, score and bar. MetricBreakdown. */
function renderMetric(
  label: string,
  description: string,
  value: number | null,
  rank: number | null,
  poolSize: number | null,
): string {
  const width = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    `<div class="rbh-metric">` +
    `<p class="rbh-metric-head"><span class="rbh-metric-label">${escapeHtml(label)}` +
    (value != null && rank != null
      ? ` <span class="rbh-metric-rank">(#${rank}${poolSize ? ` of ${poolSize}` : ""})</span>`
      : "") +
    `</span><span class="rbh-metric-value">${value ?? "—"}</span></p>` +
    `<span class="rbh-bar"><span class="rbh-bar-fill is-${barBand(value)}" style="width:${width}%"></span></span>` +
    `<p class="rbh-metric-desc">${escapeHtml(description)}</p>` +
    `</div>`
  );
}

/**
 * The expanded row: the three pillars, the reasons, and the way into the
 * player card. `hidden` until the row is opened.
 */
function renderDetail(p: HandcuffPlayer): string {
  const reasons = p.topReasons.slice(0, 3);
  return (
    `<tr class="rbh-detail" data-rbh-detail="${escapeHtml(p.id)}" hidden>` +
    `<td colspan="7">` +
    `<div class="rbh-detail-grid">` +
    `<div class="rbh-detail-col">` +
    `<p class="rbh-label">Score Breakdown</p>` +
    renderMetric(
      "Backfield Opportunity",
      "Total RB opportunity created by the offense.",
      p.contingentUpsideScore,
      p.contingentUpsideRank,
      p.poolSize,
    ) +
    renderMetric(
      "Player Quality",
      "Yards per carry and per catch, contact, and explosiveness.",
      p.playerQualityScore,
      p.playerQualityRank,
      p.poolSize,
    ) +
    renderMetric(
      "Path to Opportunity",
      "How likely the backup is to gain meaningful touches.",
      p.pathScore,
      p.pathToOpportunityRank,
      p.poolSize,
    ) +
    `</div>` +
    `<div class="rbh-detail-col">` +
    `<p class="rbh-label">Why This Rank</p>` +
    (reasons.length > 0
      ? `<ul class="rbh-reasons">${reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>`
      : `<p class="rbh-muted">No standout drivers.</p>`) +
    (p.riskFlags.length > 0
      ? `<p class="rbh-flags">${p.riskFlags.map((f) => `<span class="rbh-flag">${escapeHtml(f)}</span>`).join("")}</p>`
      : "") +
    `</div>` +
    `<div class="rbh-detail-col is-actions">` +
    `<p class="rbh-label">Actions</p>` +
    `<button type="button" class="rbh-profile-btn" data-rbh-card="${escapeHtml(p.id)}">` +
    `View Full Profile<svg class="rbh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>` +
    `</button>` +
    `</div>` +
    `</div>` +
    `</td>` +
    `</tr>`
  );
}

/** A figure for a data attribute: the number, or empty for a missing one. */
function attr(value: number | string | null | undefined): string {
  return value == null ? "" : escapeHtml(String(value));
}

function renderRow(p: HandcuffPlayer, fresh: boolean, options: HandcuffRenderOptions): string {
  const tier = tierFor(p.handcuffScore);
  const type = handcuffType(p.handcuffType);
  const logo = logoFor(p.team);
  const inputs = p.overallInputs;

  return (
    `<tr class="rbh-row" data-id="${escapeHtml(p.id)}"` +
    ` data-name="${escapeHtml(p.playerName)}"` +
    ` data-team="${escapeHtml(p.team)}"` +
    ` data-starter="${attr(p.starterName)}"` +
    ` data-type="${attr(p.handcuffType)}"` +
    ` data-type-key="${attr(type?.key)}"` +
    // The weight-independent inputs the bundle re-ranks from.
    ` data-in-cu="${inputs.contingentUpside}" data-in-pw="${inputs.pathToWorkload}"` +
    ` data-in-pq="${inputs.playerQuality}" data-in-cost="${attr(inputs.cost)}"` +
    (inputs.playerQualityPinned ? ` data-pinned="1"` : "") +
    // The displayed pillars and their ranks, for the compare columns.
    ` data-cu="${attr(p.contingentUpsideScore)}" data-cu-rank="${attr(p.contingentUpsideRank)}"` +
    ` data-pto="${attr(p.pathScore)}" data-pto-rank="${attr(p.pathToOpportunityRank)}"` +
    ` data-pq="${attr(p.playerQualityScore)}" data-pq-rank="${attr(p.playerQualityRank)}"` +
    ` data-pool="${attr(p.poolSize)}"` +
    ` data-tpg="${attr(p.starterTouchesPerGame)}"` +
    ` data-offense="${attr(p.offenseQuality)}"` +
    ` data-trend="${attr(p.roleTrend)}"` +
    (p.committeeRisk ? ` data-committee="1"` : "") +
    ` data-score="${p.handcuffScore}" data-rank="${p.rank}">` +
    `<td class="rbh-rank">${p.rank}</td>` +
    `<th scope="row" class="rbh-player">` +
    (p.statchasersNote
      ? `<span class="rbh-name-line">${renderName(p, options)}${renderStatchasersNote(p)}</span>`
      : renderName(p, options)) +
    // Mobile parity, as the standalone table had it: the Handcuff For column
    // drops out on a narrow table, and which starter a backup is behind is
    // the whole point of the tool — so it moves under the name.
    (p.starterName
      ? `<span class="rbh-for">for ${escapeHtml(p.starterName)}${statusTag(p, fresh)}</span>`
      : "") +
    `</th>` +
    `<td class="rbh-team">` +
    (logo
      ? `<img class="rbh-logo" src="${escapeHtml(logo)}" alt="" width="20" height="20" loading="lazy" decoding="async" />`
      : "") +
    `<span>${escapeHtml(p.team)}</span>` +
    `</td>` +
    `<td class="rbh-starter">${renderStarter(p, fresh)}</td>` +
    `<td class="rbh-score">` +
    `<span class="rbh-score-num" data-rbh-score>${p.handcuffScore}</span>` +
    `<span class="rbh-bar is-thin"><span class="rbh-bar-fill is-tier-${tier.key}" data-rbh-bar` +
    ` style="width:${Math.max(0, Math.min(100, p.handcuffScore))}%"></span></span>` +
    `</td>` +
    `<td class="rbh-type">${renderNote(p)}</td>` +
    `<td class="rbh-comp" hidden></td>` +
    `</tr>` +
    renderDetail(p)
  );
}

function renderTable(board: HandcuffBoard, options: HandcuffRenderOptions): string {
  const body = board.players.map((p) => renderRow(p, board.statusFresh, options)).join("");
  return (
    `<div class="rbh-table-card">` +
    `<div class="rbh-scroll">` +
    `<table class="rbh-table" data-rbh-table>` +
    // Names the table for screen readers and for anything parsing the page's
    // structure. The standalone table's caption, word for word.
    `<caption class="rbh-sr-only">NFL RB handcuff rankings — backup running backs ranked by` +
    ` handcuff score, with their team, the starter they back up, and the case for each.</caption>` +
    `<thead><tr>` +
    `<th scope="col" class="rbh-th-rank" data-sort="rank" data-sort-type="number" data-sort-dir="ascending"` +
    ` aria-sort="ascending"><abbr title="Rank">Rk</abbr></th>` +
    `<th scope="col" class="rbh-th-player" data-sort="name" data-sort-type="text">Player</th>` +
    `<th scope="col" class="rbh-th-team" data-sort="team" data-sort-type="text">Team</th>` +
    `<th scope="col" class="rbh-th-starter" data-sort="starter" data-sort-type="text">Handcuff For</th>` +
    `<th scope="col" class="rbh-th-score" data-sort="score" data-sort-type="number">Score</th>` +
    `<th scope="col" class="rbh-th-type" data-sort="type" data-sort-type="text">Note</th>` +
    `<th scope="col" class="rbh-th-comp" hidden><abbr title="Add to compare (up to 3)">Comp</abbr></th>` +
    `</tr></thead>` +
    `<tbody>${body}</tbody>` +
    `</table>` +
    `</div>` +
    `</div>` +
    `<p class="rbh-foot">` +
    `<span>${board.players.length} backups</span>` +
    `<span data-rbh-hint hidden> · click a row for the breakdown, a header to sort</span>` +
    `</p>`
  );
}

/* ------------------------------------------------- the best, and the faq */

/**
 * The best handcuffs, by name, as a short ordered list after the table.
 *
 * The table already holds every backup, but it is a control: the bundle
 * re-ranks it, sorts it, and on a phone abbreviates the names. This is the
 * board's own answer to "who are the best RB handcuffs", in plain sentences a
 * reader or a crawler can take at face value, and it does not move with the
 * sliders — it is the StatChasers ranking, which the note under the heading
 * says.
 */
function renderBest(board: HandcuffBoard, options: HandcuffRenderOptions): string {
  const best = bestHandcuffs(board);
  if (best.length === 0) return "";

  const updated = formatDate(board.updatedAt);
  const items = best
    .map((p) => {
      const name = p.slug
        ? `<a class="rbh-best-name" href="${escapeHtml(playerHref(p.slug, options))}" target="_top">` +
          `${escapeHtml(p.playerName)}</a>`
        : `<span class="rbh-best-name">${escapeHtml(p.playerName)}</span>`;
      const behind = p.starterName ? `, handcuff for ${escapeHtml(p.starterName)}` : "";
      const type = handcuffType(p.handcuffType);
      return (
        `<li class="rbh-best-item">` +
        `<span class="rbh-best-rank" aria-hidden="true">${p.rank}</span>` +
        `<span class="rbh-best-text">${name}` +
        `<span class="rbh-best-meta">${escapeHtml(p.team)}${behind}` +
        (type ? ` · <span class="rbh-type-${type.key}">${escapeHtml(type.label)}</span>` : "") +
        `</span></span>` +
        `<span class="rbh-best-score" title="Handcuff score">${p.handcuffScore}</span>` +
        `</li>`
      );
    })
    .join("");

  return (
    `<section class="rbh-best" aria-labelledby="rbh-best-title">` +
    `<h2 class="rbh-best-title" id="rbh-best-title">${escapeHtml(bestHeading(board))}</h2>` +
    `<p class="rbh-best-note">The top ${best.length} backups on the StatChasers board at the ` +
    `default model weights${updated ? `, as of ${escapeHtml(updated)}` : ""}.</p>` +
    `<ol class="rbh-best-list">${items}</ol>` +
    `</section>`
  );
}

/**
 * The questions, and the FAQPage built from the same list. The rankings'
 * arrangement (rankings-render.ts), for its reasons: each question its own
 * shut <details> under one <h2>; standalone, the page emits the node itself;
 * embedded, an inert island the plugin lifts onto Rank Math's graph and then
 * strips, because WordPress owns that document's structured data.
 */
function renderFaq(board: HandcuffBoard, options: HandcuffRenderOptions): string {
  const items = handcuffFaq(board);
  if (items.length === 0) return "";

  const body = items
    .map(
      (entry) =>
        `<details class="rbh-faq-item">` +
        `<summary class="rbh-faq-q-row">` +
        `<h3 class="rbh-faq-q">${escapeHtml(entry.question)}</h3>` +
        `</summary>` +
        `<p class="rbh-faq-a">${escapeHtml(entry.answer)}</p>` +
        `</details>`,
    )
    .join("");

  return (
    `<section class="rbh-faq-block" aria-labelledby="rbh-faq-title">` +
    `<h2 class="rbh-faq-title" id="rbh-faq-title">${escapeHtml(HANDCUFF_FAQ_HEADING)}</h2>` +
    `<div class="rbh-faq">${body}</div>` +
    `</section>` +
    renderFaqSchema(items, options)
  );
}

function renderFaqSchema(items: HandcuffFaq[], options: HandcuffRenderOptions): string {
  if (options.embed) {
    return (
      `<script type="application/json" class="rbh-faq-data">` +
      escapeJsonLd(JSON.stringify(items.map((entry) => ({ q: entry.question, a: entry.answer })))) +
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

/* ---------------------------------------------------------------- the page */

/** The heading the board carries for anyone navigating by headings. */
export function handcuffHeading(board: HandcuffBoard): string {
  return `${board.season} Fantasy Football RB Handcuff Rankings`;
}

export function renderHandcuffPage(
  board: HandcuffBoard,
  options: HandcuffRenderOptions = {},
): string {
  return (
    `<div class="rbh${options.embed ? " is-embed" : ""}" data-rbh-root="1"` +
    // The season, for the WordPress plugin's schema node, which describes the
    // tool before the page has printed it.
    ` data-season="${board.season}"` +
    (options.endpoint ? ` data-rbh-endpoint="${escapeHtml(options.endpoint)}"` : "") +
    `>` +
    `<h2 class="rbh-sr-only">${escapeHtml(handcuffHeading(board))}</h2>` +
    renderPanel(board) +
    renderLegend(board) +
    renderTable(board, options) +
    renderBest(board, options) +
    renderFaq(board, options) +
    `</div>`
  );
}

export function renderHandcuffEmpty(options: HandcuffRenderOptions = {}): string {
  return (
    `<div class="rbh${options.embed ? " is-embed" : ""}" data-rbh-root="1" data-empty="1">` +
    `<p class="rbh-empty">${escapeHtml(
      "RB handcuff rankings are not available right now.",
    )}</p></div>`
  );
}

/* ---------------------------------------------------------- the player card */

/**
 * A collapsible breakdown: the pillar's name, its rank in the pool, and its
 * drivers. MetricSection with `headerRank`, which is how the card used it for
 * all three pillars.
 */
function renderSection(
  name: string,
  subLabel: string,
  score: number | null,
  rank: number | null,
  poolSize: number,
  body: string,
  open: boolean,
): string {
  const tone = rank != null ? rankTone(rank, poolSize) : toneOf(score).key;
  return (
    `<details class="rbh-section"${open ? " open" : ""}>` +
    `<summary>${icon("chevron", "rbh-chev")}` +
    `<span class="rbh-section-text"><span class="rbh-section-head">` +
    `<span class="rbh-section-name">${escapeHtml(name)}</span>` +
    `<span class="rbh-section-rank is-${tone}">${rank != null ? `#${rank}` : "—"}</span>` +
    `</span>` +
    `<span class="rbh-section-sub">${escapeHtml(subLabel)}</span></span>` +
    `</summary>` +
    `<div class="rbh-section-body">${body}</div>` +
    `</details>`
  );
}

/** One driver: metric, measured value, and its rank, coloured by its score. DriverRow. */
function renderDriver(
  label: string,
  score: string,
  tone: string,
  tooltip: string,
  measure?: string,
): string {
  return (
    `<p class="rbh-driver">` +
    `<span class="rbh-driver-label" title="${escapeHtml(tooltip)}">${escapeHtml(label)}${icon("info", "rbh-icon is-tip")}</span>` +
    `<span class="rbh-driver-vals">` +
    (measure ? `<span class="rbh-driver-measure">${escapeHtml(measure)}</span>` : "") +
    `<span class="rbh-driver-score is-${tone}">${escapeHtml(score)}</span>` +
    `</span>` +
    `</p>`
  );
}

function rankText(rank: { rank: number } | undefined, fallback: string): string {
  return rank ? `#${rank.rank}` : fallback;
}

/** Coloured by the rank the row shows; by the score only when it shows the score. */
function driverTone(rank: { rank: number; poolSize: number } | undefined, score: number | null): string {
  return rank ? rankTone(rank.rank, rank.poolSize) : scoreTone(score);
}

function renderPathSection(p: HandcuffPlayer, season: number): string {
  const pto = p.pathToOpportunityDetail;
  const ranks = p.pathComponentRanks ?? {};
  let body: string;
  if (!pto) {
    body = `<p class="rbh-muted">Not enough data to break down Path to Opportunity.</p>`;
  } else {
    const c = pto.components;
    const has = (flag: string): boolean => pto.flags.includes(flag);
    const rows: string[] = [];
    // A component with no data is left out entirely — its weight was already
    // spread across the others in the score, so a "No data" row is noise.
    if (!has("missing_starter_durability_history")) {
      rows.push(
        renderDriver(
          "Starter Durability History",
          rankText(ranks["starterDurabilityHistoryRisk"], String(c.starterDurabilityHistoryRisk.score)),
          driverTone(ranks["starterDurabilityHistoryRisk"], c.starterDurabilityHistoryRisk.score),
          `The current starter's missed-game rate: ${season} so far 20%, ${season - 1} 60%, career before that 20% (plus current status when fresh). Higher = the starter is more likely to open a path. (25% of Path to Opportunity)`,
        ),
      );
    }
    if (!has("missing_starter_workload")) {
      const tpg = c.starterWorkloadStress.starterTouchesPerGame;
      rows.push(
        renderDriver(
          "Starter Workload Stress",
          rankText(ranks["starterWorkloadStress"], String(c.starterWorkloadStress.score)),
          driverTone(ranks["starterWorkloadStress"], c.starterWorkloadStress.score),
          `The current starter's touches per game over his last six games (week 18 excluded), ranked against every other starter on the board (heaviest 100, lightest 0). Heavier usage raises wear-and-tear opportunity risk. (20% of Path to Opportunity)`,
          tpg != null ? `${tpg.toFixed(1)} tch/g` : undefined,
        ),
      );
    }
    if (!has("missing_starter_age")) {
      const age = c.starterAgeRisk.age;
      rows.push(
        renderDriver(
          "Starter Age Risk",
          rankText(ranks["starterAgeRisk"], String(c.starterAgeRisk.score)),
          driverTone(ranks["starterAgeRisk"], c.starterAgeRisk.score),
          "RB-specific age curve for the current starter — older starters are likelier to decline or miss time.",
          age != null ? `age ${age}` : undefined,
        ),
      );
    }
    if (!(has("missing_usage_ratio") && !has("committee_usage_detected"))) {
      const share = c.backupUsageRatio.backupUsageShare;
      rows.push(
        renderDriver(
          "Backup Usage Ratio",
          rankText(ranks["backupUsageRatio"], String(c.backupUsageRatio.score)),
          driverTone(ranks["backupUsageRatio"], c.backupUsageRatio.score),
          `The share of the two-back workload (touches, snaps, routes, targets, red-zone) ${p.playerName} holds vs the current starter in ${season}, ranked against every other backup on the board (biggest share 100, smallest 0). A bigger share means a clearer path. Dropped when ${p.playerName} has no ${season} snaps for this team. (25% of Path to Opportunity)`,
          share != null ? `${Math.round(share * 100)}% of backfield` : undefined,
        ),
      );
    }
    if (!has("missing_starter_player_quality")) {
      rows.push(
        renderDriver(
          "Starter Quality Vulnerability",
          rankText(ranks["starterQualityVulnerability"], String(c.starterQualityVulnerability.score)),
          driverTone(ranks["starterQualityVulnerability"], c.starterQualityVulnerability.score),
          "Inverted Player Quality of the current starter — a weaker starter is easier to unseat. Backup Player Quality is NOT included here.",
        ),
      );
    }
    if (has("committee_usage_detected")) {
      rows.push(`<p class="rbh-warn-note">Committee usage detected — backup already shares the backfield.</p>`);
    }
    if (pto.source === "fallback" && !has("committee_usage_detected")) {
      rows.push(
        `<p class="rbh-muted">Not enough data to break this down — score uses a neutral baseline.</p>`,
      );
    }
    body = rows.join("");
  }
  return renderSection(
    "Path to Opportunity",
    "How likely the backup is to gain a bigger role.",
    p.pathScore,
    p.pathToOpportunityRank,
    p.poolSize,
    body,
    true,
  );
}

function backfieldValue(perGame: number | null, kind: "count" | "pct"): string {
  if (perGame == null) return "No data";
  return kind === "pct" ? `${Math.round(perGame)}%` : `${perGame.toFixed(1)}/g`;
}

const BACKFIELD_ROWS: Array<{
  key: "rushAttempts" | "snapPct" | "targets" | "redZone" | "goalLine" | "routes";
  label: string;
  kind: "count" | "pct";
  tooltip: string;
}> = [
  {
    key: "rushAttempts",
    label: "Backfield Carries",
    kind: "count",
    tooltip:
      "Combined {season} starter + top backup rush attempts per game, ranked vs every team's {season} backfield. Largest input to Backfield Opportunity.",
  },
  {
    key: "snapPct",
    label: "Backfield Snaps",
    kind: "pct",
    tooltip: "Combined {season} starter + top backup snap share, ranked vs every team's {season} backfield.",
  },
  {
    key: "targets",
    label: "Backfield Targets",
    kind: "count",
    tooltip: "Combined {season} starter + top backup targets per game, ranked vs every team's {season} backfield.",
  },
  {
    key: "redZone",
    label: "Backfield Red Zone",
    kind: "count",
    tooltip:
      "Combined {season} starter + top backup red-zone opportunities per game, ranked vs every team's {season} backfield.",
  },
  {
    key: "goalLine",
    label: "Backfield Goal Line",
    kind: "count",
    tooltip:
      "Combined {season} starter + top backup goal-line carries per game — high-value scoring touches, ranked vs every team's {season} backfield.",
  },
  {
    key: "routes",
    label: "Backfield Routes",
    kind: "count",
    tooltip: "Combined {season} starter + top backup routes run per game, ranked vs every team's {season} backfield.",
  },
];

function renderBackfieldSection(p: HandcuffPlayer, season: number): string {
  const bv = p.backfieldVolumeComponents;
  const ranks = p.backfieldComponentRanks ?? {};
  const body = bv
    ? BACKFIELD_ROWS.map((row) => {
        const c = bv[row.key];
        // A metric nobody has — routes, in season — was left out of the score,
        // so it is left off the card rather than shown as "No data".
        if (c.perGame == null && c.percentile == null) return "";
        return renderDriver(
          row.label,
          rankText(ranks[row.key], c.percentile != null ? String(c.percentile) : "—"),
          driverTone(ranks[row.key], c.percentile),
          row.tooltip.replace(/\{season\}/g, String(season)),
          backfieldValue(c.perGame, row.kind),
        );
      }).join("")
    : `<p class="rbh-muted">No backfield usage data available for this room.</p>`;
  return renderSection(
    "Backfield Opportunity",
    `How much total RB opportunity this offense has produced in ${season} between the team's two highest-usage RBs`,
    p.contingentUpsideScore,
    p.contingentUpsideRank,
    p.poolSize,
    body,
    false,
  );
}

const QUALITY_ROWS: Array<{
  key: "rushing" | "receiving" | "contact" | "explosiveness";
  label: string;
  tooltip: string;
}> = [
  {
    key: "rushing",
    label: "Yards per Carry",
    tooltip:
      "Yards per carry, ranked against qualified running backs. Under 40 carries it is scored toward below average. (30% of Player Quality)",
  },
  {
    key: "receiving",
    label: "Yards per Reception",
    tooltip:
      "Yards per reception, ranked against qualified running backs. Under 10 catches it is scored toward below average. (30% of Player Quality)",
  },
  {
    key: "contact",
    label: "Contact & Ball Security",
    tooltip:
      "Yards after contact per attempt (10%), elude % (5%), and fumbles per carry, lower is better (5%). (20% of Player Quality)",
  },
  {
    key: "explosiveness",
    label: "Explosiveness",
    tooltip:
      "The advanced stats table's Explosiveness grade: explosive & breakaway run rates, 10+/20+/30+ yard runs, and longest run. (20% of Player Quality)",
  },
];

function renderQualitySection(p: HandcuffPlayer): string {
  const detail = p.playerQualityDetail;
  const ranks = p.playerQualityCategoryRanks ?? {};
  const body = detail
    ? QUALITY_ROWS.map((row) => {
        const score = detail.categories[row.key].score;
        const rank = ranks[row.key];
        return renderDriver(
          row.label,
          rank != null ? `#${rank}` : String(score),
          rank != null ? rankTone(rank, p.playerQualityCategoryPoolSize) : scoreTone(score),
          row.tooltip,
        );
      }).join("")
    : `<p class="rbh-driver"><span class="rbh-driver-label">Player Quality</span>` +
      `<span class="rbh-driver-score is-warn">No stats available</span></p>`;
  return renderSection(
    "Player Quality",
    "How good this backup is as a player — independent of his current role behind the starter.",
    p.playerQualityScore,
    p.playerQualityRank,
    p.poolSize,
    body,
    false,
  );
}

/**
 * The player card, as the bundle's drawer shows it: identity, the verdict, the
 * summary, why he ranks here, and the three breakdowns. The standalone
 * player-card-drawer.tsx, section for section, less the depth chart — the
 * static build it was published as never had depth-chart data to show there.
 *
 * Nothing on it moves with the weights, which is why it can be rendered here
 * once and fetched when a card is opened.
 */
export function renderHandcuffCard(
  p: HandcuffPlayer,
  options: HandcuffRenderOptions = {},
  statusFresh = false,
  season = new Date().getUTCFullYear(),
): string {
  const lastName = p.playerName.split(/\s+/).slice(-1)[0] ?? p.playerName;
  const badges = statusBadges(p);
  const bullets = whyBullets(p);
  const logo = logoFor(p.team);
  const summary = p.notes?.trim() ? p.notes.trim() : generateSummary(p);

  const trend = p.roleTrend
    ? `<span class="rbh-pill is-${
        p.roleTrend === "Rising Fast" || p.roleTrend === "Trending Up"
          ? "good"
          : p.roleTrend === "Falling Fast" || p.roleTrend === "Trending Down"
            ? "bad"
            : "none"
      }">${escapeHtml(p.roleTrend)}</span>`
    : "";

  // This week's report on the starter, which is part of why the path score is
  // what it is — shown only while it is fresh enough to have counted.
  const starterStatus =
    statusFresh && p.starterInjuryStatus && p.starterName
      ? `<span class="rbh-pill is-warn">${escapeHtml(`${p.starterName}: ${p.starterInjuryStatus}`)}</span>`
      : "";

  const pills =
    badges.length > 0 || trend || starterStatus
      ? `<p class="rbh-pills">${badges
          .map((b) => `<span class="rbh-pill is-${b.tone}">${escapeHtml(b.text)}</span>`)
          .join("")}${trend}${starterStatus}</p>`
      : "";

  const profile = p.slug
    ? `<a class="rbh-card-cta" href="${escapeHtml(playerHref(p.slug, options))}" target="_top">` +
      `View Full Profile${icon("external")}</a>`
    : "";

  const adp =
    p.adpOrCost != null || p.rosteredPct != null
      ? `<p class="rbh-kv"><span>ADP / Rostered</span><span>${
          p.adpOrCost != null ? `#${p.adpOrCost}` : "—"
        } / ${p.rosteredPct != null ? `${p.rosteredPct}%` : "—"}</span></p>`
      : "";
  const cost =
    p.costScore != null ? `<p class="rbh-kv"><span>Cost Value</span><span>${p.costScore}</span></p>` : "";

  return (
    `<article class="rbh-card" data-rbh-card-id="${escapeHtml(p.id)}">` +
    `<div class="rbh-hero">` +
    (logo
      ? `<img class="rbh-hero-mark" src="${escapeHtml(logo)}" alt="" width="128" height="128" loading="lazy" decoding="async" />`
      : "") +
    `<div class="rbh-hero-photo">` +
    `<span class="rbh-hero-initials" aria-hidden="true">${escapeHtml(initials(p.playerName))}</span>` +
    (p.sleeperId
      ? `<img src="${escapeHtml(headshotUrl(p.sleeperId))}" alt="${escapeHtml(p.playerName)}" width="120" height="120" decoding="async" />`
      : "") +
    `</div>` +
    `<div class="rbh-hero-body">` +
    `<div class="rbh-hero-top">` +
    `<div class="rbh-hero-id">` +
    `<h2 class="rbh-hero-name">${escapeHtml(p.playerName)}</h2>` +
    `<p class="rbh-hero-team">${escapeHtml(p.team)} · RB</p>` +
    `<p class="rbh-hero-arch">${escapeHtml(archetypeLine(p))}</p>` +
    `</div>` +
    profile +
    `</div>` +
    pills +
    `</div>` +
    `</div>` +
    `<section class="rbh-card-block">` +
    `<h3 class="rbh-card-h">Summary</h3>` +
    `<p class="rbh-summary">${escapeHtml(summary)}</p>` +
    `</section>` +
    (bullets.length > 0
      ? `<section class="rbh-why">` +
        `<h3 class="rbh-card-h">Why ${escapeHtml(lastName)} Ranks Here</h3>` +
        `<ul class="rbh-why-list">${bullets
          .map(
            (b) =>
              `<li class="${b.ok ? "is-ok" : "is-warn"}">` +
              icon(b.ok ? "check" : "trap") +
              `<span>${escapeHtml(b.text)}</span></li>`,
          )
          .join("")}</ul>` +
        `</section>`
      : "") +
    `<section class="rbh-card-block">` +
    `<h3 class="rbh-card-h">Score Breakdown</h3>` +
    renderPathSection(p, season) +
    renderBackfieldSection(p, season) +
    renderQualitySection(p) +
    adp +
    cost +
    `</section>` +
    `</article>`
  );
}
