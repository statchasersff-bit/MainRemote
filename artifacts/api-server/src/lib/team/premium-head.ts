/**
 * The premium tab header shared by Snap Counts & Player Usage, Depth Chart,
 * Contracts, Draft, Stats, Coaching, (since 2026-11-05 PM, mak: "use this
 * header design ... on the outlook tab header") the Fantasy Outlook and
 * (2026-11-05 evening, mak: the Schedule header "should have the same design
 * as the [Draft] header") the Schedule, and (same evening, mak: match "the
 * coaching tabs header") the News tab.
 *
 * mak, 2026-11-05: "I really like this design [the Formations & Personnel
 * panel header] ... apply it to [the six tab headers] so they are all
 * consistent." So this is that header, lifted out of the coaching
 * tendencies panel: navy gradient, diagonal geometry fading in on the right,
 * two slim gold accents at the edge, a gold-ringed icon tile, a gold rule,
 * the white title with its dek, and the faint play-art. One markup here, one
 * CSS block (`.sct-up-head*` in team.css). The per-tab `hook` class carries
 * no style; it is there for the tests and nothing else.
 */

import { escapeHtml } from "../render";

const stroke = (d: string): string =>
  `<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</g></svg>`;

/** One glyph per tab, in the Formations header's stroke style. */
export const PREMIUM_HEAD_ICON = {
  usage: stroke(`<path d="M12 3l9 4.5-9 4.5-9-4.5z"/><path d="M3 12l9 4.5 9-4.5"/><path d="M3 16.5L12 21l9-4.5"/>`),
  depth: stroke(`<path d="M4 5h16"/><path d="M6 10h12"/><path d="M8 15h8"/><path d="M10 20h4"/>`),
  contracts: stroke(`<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M12 9v9"/><path d="M14 11h-3a1.5 1.5 0 0 0 0 3h2a1.5 1.5 0 0 1 0 3h-3"/>`),
  draft: stroke(`<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M12 8l1.4 2.9 3.1.4-2.3 2.2.6 3.1-2.8-1.5-2.8 1.5.6-3.1-2.3-2.2 3.1-.4z"/>`),
  stats: stroke(`<path d="M4 20h16"/><path d="M7 16v-5M12 16V8M17 16v-3"/><path d="M5 9l4-4 4 3 6-5"/>`),
  coaching: stroke(`<path d="M5 6l4 4M9 6l-4 4"/><circle cx="17" cy="7" r="2.4"/><path d="M6 19c4-7 9-7 13-3"/><path d="M16.5 14.5l3 1.5-.8 3"/>`),
  outlook: stroke(`<path d="M4 19l5-6 4 3 7-9"/><path d="M16 7h4v4"/><path d="M4 5v14h16"/>`),
  news: stroke(`<path d="M4 5h13v14H6a2 2 0 0 1-2-2z"/><path d="M17 9h3v8a2 2 0 0 1-2 2"/><path d="M7 9h7M7 12h7M7 15h4"/>`),
  schedule: stroke(`<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4M16 3v4"/><path d="M8 14h3M13 14h3M8 18h3"/>`),
} as const;

export type PremiumHeadIcon = keyof typeof PREMIUM_HEAD_ICON;

/** The Formations & Personnel panel's play-art: routes, Xs and Os, faint on the right. */
const ART =
  `<svg viewBox="0 0 260 90" width="260" height="90" aria-hidden="true" class="sct-up-art">` +
  `<g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">` +
  `<path d="M18 72c30-38 62-44 96-30"/><path d="M106 44l10-4-2 10"/><path d="M60 78c26-10 40-28 54-52"/>` +
  `<path d="M150 76c20-2 38-16 52-40"/><path d="M196 40l8-3-1 9"/><path d="M118 80c24 2 40-8 52-22"/></g>` +
  `<g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">` +
  `<path d="M28 24l10 10M38 24l-10 10"/><path d="M62 16l10 10M72 16l-10 10"/><path d="M212 62l10 10M222 62l-10 10"/></g>` +
  `<g fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="140" cy="18" r="6"/><circle cx="174" cy="12" r="6"/>` +
  `<circle cx="238" cy="24" r="6"/><circle cx="92" cy="60" r="6"/></g></svg>`;

/**
 * The Draft tab's art in place of the play diagram (mak, 2026-11-06: the
 * X/O arrows "don't relate to a draft"): a draft board - three rounds of
 * pick cards, each a name line over a position tag, with one pick starred
 * and an arrow carrying it up the board. Same size, stroke and opacity as ART.
 */
function draftArt(): string {
  const cards: string[] = [];
  const cols = [96, 136, 176, 216];
  const rows = [8, 36, 64];
  rows.forEach((y, r) => {
    cols.forEach((x, c) => {
      const star = r === 0 && c === 3;
      if (star) return;
      cards.push(
        `<rect x="${x}" y="${y}" width="32" height="20" rx="3"/>` +
        `<path d="M${x + 5} ${y + 7}h${c % 2 ? 16 : 20}"/>` +
        `<path d="M${x + 5} ${y + 13}h8"/>`,
      );
    });
  });
  return (
    `<svg viewBox="0 0 260 90" width="260" height="90" aria-hidden="true" class="sct-up-art">` +
    `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    cards.join("") +
    // Round labels down the left edge of the board.
    `<path d="M74 14h10M74 18h6"/><path d="M74 42h10M74 46h6"/><path d="M74 70h10M74 74h6"/>` +
    // The starred pick, a heavier card.
    `<rect x="216" y="8" width="32" height="20" rx="3" stroke-width="2.6"/>` +
    `<path d="M232 11.5l1.9 3.8 4.2.6-3 3 .7 4.2-3.8-2-3.8 2 .7-4.2-3-3 4.2-.6z"/>` +
    // A pick moving up the board: a traded-up arrow.
    `<path d="M20 78c18 0 34-14 42-34"/><path d="M54 46l8-4 2 9"/>` +
    `<rect x="8" y="70" width="22" height="14" rx="3"/>` +
    `</g></svg>`
  );
}

const DRAFT_ART = draftArt();

/**
 * The Coaching tab's art (mak, 2026-11-06): the play-caller's kit - a
 * headset with its mic boom, a clipboard carrying one drawn-up play, and a
 * call sheet of play lines beside it. Same size, stroke and opacity as ART.
 */
const COACHING_ART =
  `<svg viewBox="0 0 260 90" width="260" height="90" aria-hidden="true" class="sct-up-art">` +
  `<g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">` +
  // Headset: band, two ear cups, mic boom.
  `<path d="M22 50V40a22 22 0 0 1 44 0v10"/>` +
  `<rect x="16" y="46" width="12" height="20" rx="5"/><rect x="60" y="46" width="12" height="20" rx="5"/>` +
  `<path d="M22 66c0 10 10 14 24 14"/><circle cx="49" cy="80" r="3"/>` +
  // Clipboard with its clip.
  `<rect x="98" y="10" width="64" height="76" rx="5"/>` +
  `<path d="M118 10V6h24v4"/><rect x="116" y="6" width="28" height="9" rx="3"/>` +
  `</g>` +
  // The play on the clipboard: a line of Os, a defender X, two routes.
  `<g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">` +
  `<circle cx="112" cy="70" r="3.4"/><circle cx="124" cy="70" r="3.4"/><circle cx="136" cy="70" r="3.4"/><circle cx="148" cy="70" r="3.4"/>` +
  `<circle cx="130" cy="80" r="3.4"/>` +
  `<path d="M146 30l7 7M153 30l-7 7"/><path d="M110 30l7 7M117 30l-7 7"/>` +
  `<path d="M112 66V44l14-10"/><path d="M122 33l4 1-1 4"/>` +
  `<path d="M148 66c0-14-4-20-12-24"/><path d="M139 40l-3 2 3 3"/>` +
  `</g>` +
  // The call sheet: rows of play names with a checked call.
  `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
  `<rect x="180" y="14" width="66" height="68" rx="4"/><path d="M180 28h66"/><path d="M188 21h24"/>` +
  `<path d="M188 38h34M188 48h44M188 58h28M188 68h38"/><path d="M234 36l3 3 5-6"/>` +
  `</g></svg>`;

/**
 * The Outlook tab's art (mak, 2026-11-06): a season projection - the
 * played weeks as a solid line, then a dashed projection inside a widening
 * range band, ending at a target flag. Same size, stroke and opacity as ART.
 */
const OUTLOOK_ART =
  `<svg viewBox="0 0 260 90" width="260" height="90" aria-hidden="true" class="sct-up-art">` +
  `<g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">` +
  // Axes.
  `<path d="M70 8v74h176"/>` +
  `<path d="M66 26h4M66 46h4M66 66h4"/>` +
  // Played weeks: solid line with points.
  `<path d="M78 70l18-10 18 6 18-20 18-6"/>` +
  `<circle cx="96" cy="60" r="3"/><circle cx="114" cy="66" r="3"/><circle cx="132" cy="46" r="3"/><circle cx="150" cy="40" r="3.6"/>` +
  `</g>` +
  // The projection: range band and dashed line from the last point.
  `<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">` +
  `<path d="M150 40L230 12M150 40L230 50" stroke-dasharray="2 5"/>` +
  `<path d="M150 40l80-20" stroke-width="2.2" stroke-dasharray="7 6"/>` +
  `<path d="M150 8v74" stroke-dasharray="2 5"/>` +
  `</g>` +
  // Target flag at the end of the projection.
  `<g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">` +
  `<path d="M232 20V4l12 4-12 4"/>` +
  `</g></svg>`;

/**
 * The Stats tab's art (mak, 2026-11-06): a box score - a stat table with
 * a header row and number columns - beside a small bar chart.
 * Same size, stroke and opacity as ART.
 */
const STATS_ART =
  `<svg viewBox="0 0 260 90" width="260" height="90" aria-hidden="true" class="sct-up-art">` +
  `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
  // Box score table.
  `<rect x="60" y="10" width="112" height="72" rx="4"/>` +
  `<path d="M60 24h112"/><path d="M104 10v72M126 10v72M148 10v72"/>` +
  `<path d="M67 17h22M110 17h10M132 17h10M154 17h10"/>` +
  `<path d="M67 34h28M67 48h22M67 62h26M67 75h18"/>` +
  `<path d="M110 34h10M110 48h8M110 62h10M110 75h6"/>` +
  `<path d="M132 34h8M132 48h10M132 62h6M132 75h10"/>` +
  `<path d="M154 34h10M154 48h6M154 62h10M154 75h8"/>` +
  // Bar chart.
  `<path d="M186 82h62"/>` +
  `<rect x="190" y="52" width="10" height="30" rx="2"/><rect x="206" y="34" width="10" height="48" rx="2"/>` +
  `<rect x="222" y="44" width="10" height="38" rx="2"/><rect x="238" y="16" width="10" height="66" rx="2"/>` +
  `</g></svg>`;

export interface PremiumTabHeadOptions {
  /** A per-tab class for the tests (e.g. "sct-dpp-hero"); no CSS reads it. */
  hook?: string;
  icon: PremiumHeadIcon;
  /** The heading, already marked up: `<h2 class="sct-h2 sct-up-h2 ...">` (promoted to the H1 on a section address). */
  heading: string;
  /** Plain text; escaped here. */
  dek?: string;
  /**
   * The dek already marked up (the Outlook stamp with its gold separators);
   * printed as-is inside the `.sct-up-dek` paragraph. Wins over `dek`.
   */
  dekHtml?: string;
  /** An extra class on the dek paragraph (the Outlook's `.sct-tfo-stamp`). */
  dekClass?: string;
  /**
   * Controls printed inside the band on its right (the Depth Chart's view
   * buttons, mak 2026-11-06). The art is left out when they are there: the
   * two would share the same spot.
   */
  actionsHtml?: string;
  /** The faint art on the right: the play diagram unless a tab has its own. */
  art?: "play" | "draft" | "coaching" | "outlook" | "stats" | "contracts" | "news" | "depth" | "schedule";
}

/**
 * The Contracts tab's art (mak, 2026-11-06): a contract with its folded
 * corner, clause lines and a signature, a dollar seal, and the cap - a
 * segmented bar of committed money with room left at the end.
 * Same size, stroke and opacity as ART.
 */
const CONTRACTS_ART =
  `<svg viewBox="0 0 260 90" width="260" height="90" aria-hidden="true" class="sct-up-art">` +
  `<g fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">` +
  // The contract.
  `<path d="M70 6h46l14 14v64H70z"/><path d="M116 6v14h14"/>` +
  `<path d="M78 24h28M78 34h44M78 42h40M78 50h44M78 58h30"/>` +
  `<path d="M78 74c4-6 7-6 8-1s4 4 8-2 6-4 7 0 5 2 9-2"/>` +
  // The dollar seal.
  `<circle cx="160" cy="28" r="16"/>` +
  `<path d="M165 21h-7a3.5 3.5 0 0 0 0 7h4a3.5 3.5 0 0 1 0 7h-7"/><path d="M160 18v3M160 35v3"/>` +
  // The cap: committed segments, then room.
  `<rect x="146" y="62" width="104" height="14" rx="4"/>` +
  `<path d="M174 62v14M196 62v14M212 62v14M224 62v14"/>` +
  `<path d="M226 58v22" stroke-dasharray="2 4"/>` +
  `</g></svg>`;

/**
 * The News tab's art (mak, 2026-11-06): a news page - masthead rule,
 * headline, photo block and columns of copy - with a breaking-news signal
 * beside it. Same size, stroke and opacity as ART.
 */
const NEWS_ART =
  `<svg viewBox="0 0 260 90" width="260" height="90" aria-hidden="true" class="sct-up-art">` +
  `<g fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">` +
  // The page.
  `<rect x="66" y="6" width="120" height="78" rx="4"/>` +
  `<path d="M66 20h120"/><path d="M96 13h60"/>` +
  `<path d="M74 28h72M74 35h56"/>` +
  `<rect x="74" y="44" width="40" height="32" rx="2"/><path d="M78 70l10-10 7 6 6-5 9 9"/>` +
  `<path d="M122 46h56M122 54h56M122 62h48M122 70h52M152 28h26M152 35h20"/>` +
  // Breaking signal: a mast with waves.
  `<path d="M224 84V44"/><circle cx="224" cy="38" r="4"/>` +
  `<path d="M212 28a17 17 0 0 0 0 20M236 28a17 17 0 0 1 0 20"/>` +
  `<path d="M204 20a28 28 0 0 0 0 36M244 20a28 28 0 0 1 0 36"/>` +
  `<path d="M214 84h20"/>` +
  `</g></svg>`;

/**
 * The Depth Chart tab's art (mak, 2026-11-06): a depth board - five
 * position columns, each a tag over a starter card (heavier) and two
 * backups, with 1-2-3 ticks down the left. Same size, stroke and opacity as ART.
 */
function depthArt(): string {
  const cols = [92, 124, 156, 188, 220];
  const parts: string[] = [];
  for (const x of cols) {
    parts.push(
      `<path d="M${x + 6} 16h12"/>` +
      `<rect x="${x}" y="23" width="24" height="14" rx="3" stroke-width="2.6"/><path d="M${x + 5} 30h14"/>` +
      `<rect x="${x}" y="43" width="24" height="14" rx="3"/><path d="M${x + 5} 50h10"/>` +
      `<rect x="${x}" y="63" width="24" height="14" rx="3" stroke-dasharray="3 3"/>`,
    );
  }
  return (
    `<svg viewBox="0 0 260 90" width="260" height="90" aria-hidden="true" class="sct-up-art">` +
    `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    parts.join("") +
    // 1-2-3 down the left edge.
    `<path d="M76 26v8"/><path d="M72 46h6l-6 8h7"/><path d="M72 65h6l-3 4a3 3 0 1 1-3 4"/>` +
    // A backup moving up a line.
    `<path d="M60 70c-8-8-8-30 0-40"/><path d="M56 34l4-4 4 4"/>` +
    `</g></svg>`
  );
}

const DEPTH_ART = depthArt();

/**
 * The Schedule tab's art (mak, 2026-11-06): a calendar page - binder rings,
 * a week grid with game days marked, the bye crossed out and the next game
 * circled - beside a kickoff clock. Same size, stroke and opacity as ART.
 */
function scheduleArt(): string {
  const cells: string[] = [];
  const xs = [82, 104, 126, 148, 170];
  const ys = [30, 48, 66];
  ys.forEach((y, r) => {
    xs.forEach((x, c) => {
      const i = r * 5 + c;
      if (i === 7) cells.push(`<circle cx="${x + 8}" cy="${y + 6}" r="9" stroke-width="2.6"/><circle cx="${x + 8}" cy="${y + 6}" r="2.4" fill="currentColor"/>`);
      else if (i === 4) cells.push(`<path d="M${x + 3} ${y + 1}l10 10M${x + 13} ${y + 1}l-10 10"/>`);
      else if (i % 2 === 0) cells.push(`<circle cx="${x + 8}" cy="${y + 6}" r="2.4" fill="currentColor"/>`);
      else cells.push(`<path d="M${x + 4} ${y + 6}h8"/>`);
    });
  });
  return (
    `<svg viewBox="0 0 260 90" width="260" height="90" aria-hidden="true" class="sct-up-art">` +
    `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    `<rect x="72" y="10" width="118" height="76" rx="5"/><path d="M72 24h118"/>` +
    `<path d="M96 4v12M166 4v12"/>` +
    cells.join("") +
    // Kickoff clock.
    `<circle cx="226" cy="46" r="22"/><path d="M226 32v14l10 6"/>` +
    `<path d="M226 20v3M226 69v3M200 46h3M249 46h3"/>` +
    `</g></svg>`
  );
}

const SCHEDULE_ART = scheduleArt();

const TAB_ART: Record<NonNullable<PremiumTabHeadOptions["art"]>, string> = {
  play: ART,
  draft: DRAFT_ART,
  coaching: COACHING_ART,
  outlook: OUTLOOK_ART,
  stats: STATS_ART,
  contracts: CONTRACTS_ART,
  news: NEWS_ART,
  depth: DEPTH_ART,
  schedule: SCHEDULE_ART,
};

export function premiumTabHead(o: PremiumTabHeadOptions): string {
  return (
    `<header class="sct-up-head${o.hook ? ` ${o.hook}` : ""}${o.actionsHtml ? " has-actions" : ""}">` +
    `<span class="sct-up-head-icon">${PREMIUM_HEAD_ICON[o.icon]}</span>` +
    `<span class="sct-up-head-rule" aria-hidden="true"></span>` +
    `<div class="sct-up-head-text">${o.heading}<p class="sct-up-dek${o.dekClass ? ` ${o.dekClass}` : ""}">${o.dekHtml ?? escapeHtml(o.dek ?? "")}</p></div>` +
    (o.actionsHtml
      ? `<div class="sct-up-head-actions">${o.actionsHtml}</div>`
      : o.art ? TAB_ART[o.art] : ART) +
    `</header>`
  );
}
