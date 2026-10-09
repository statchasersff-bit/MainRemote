/**
 * The authored half of the Outlook tab, and the one test of whether a player
 * has an Outlook page at all.
 *
 * Moved out of lib/player-render.ts (2026-10-08) so that modules kept off that
 * file's import graph - the header, the Bio and News tabs, the FAQ pools - can
 * ask hasOutlookTab() before they write a link to `/outlook/`. A link to a
 * section the player does not have only redirects back to the profile, and the
 * site's link report counted hundreds of them.
 */

import { escapeHtml } from "../render";
import type { PlayerPageData } from "./player-data";
import type { OutlookBand } from "./types";

/**
 * The season the Outlook tab is about.
 *
 * Named once rather than written into six strings: this tab is the one place
 * on the page allowed to talk about a season nobody has played, and the year it
 * means has to be impossible to leave half-updated.
 */
export const OUTLOOK_SEASON = 2026;

/** The same section-heading atom lib/player-render.ts uses, kept local to stay off its import graph. */
function h3(text: string): string {
  return `<h3 class="scp-h3">${escapeHtml(text)}</h3>`;
}

/**
 * The Outlook tab.
 *
 * Every other tab on this page answers "what happened". This one answers the
 * only question a fantasy manager actually arrives with - what should I expect
 * from here, and what do I do with him - and it is the one place on the page
 * where the answer is allowed to be forward-looking. Rule 3 at the top of this
 * file is not suspended here so much as quarantined to here: the tab is named
 * for the season it is about, the projected numbers are labelled as projections,
 * and the measured strip beneath them is stamped with the season it was
 * measured from, so the two can never be read as the same kind of claim.
 *
 * Six blocks, in the order a decision gets made:
 *
 *   1. the head - role, rest-of-season call, confidence, and the written read
 *   2. what drives it - four measured cards, adapted to the position
 *   3. the range of outcomes - floor, expected, ceiling, on one spectrum
 *   4. what moves it - upside triggers against warning signs
 *   5. how to use him - by format, and when not to
 *   6. the verdict
 *
 * Blocks 1, 3, 4, 5 and 6 are authored (fantasy_outlook_2026.json) and block 2
 * is measured; a record written before the decision layer existed carries none
 * of the authored fields, and every one of those blocks then renders as
 * nothing. That is the page's first rule holding: a tab with a headline, a body
 * and four driver cards is a smaller tab, not a tab full of empty labels.
 */

/** The confidence chip's three steps, lowercased for the attribute. */
/**
 * The range of outcomes, as one spectrum.
 *
 * Deliberately not three cards. Three cards say floor, expected and ceiling are
 * three separate facts; one axis says they are three points on the same one,
 * which is what a range is and is the whole reason the section is worth having.
 *
 * The axis runs worst rank on the left to best on the right - ranks invert, so
 * the axis is drawn on `worst - rank` and every position below is a percentage
 * of that span. The expected band is a painted segment rather than a point,
 * because a projection precise to one rank is a precision nobody has.
 */
function renderOutlookRange(data: OutlookSource): string {
  const range = data.fantasyOutlook2026?.range;
  if (!range) return "";

  const { floor, expected, ceiling } = range;
  const pos = data.player.position ?? "";
  const bands = [floor, expected, ceiling];
  if (bands.some((band) => !band || !Number.isFinite(band.best) || !Number.isFinite(band.worst))) {
    return "";
  }

  // The axis is the whole claim, floor's bad end to ceiling's good end. A record
  // whose bands were authored inconsistently - a ceiling worse than the floor -
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
      `Projected ${OUTLOOK_SEASON} positional finish. A range, not a number - nobody has the number.`,
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
 * It is also the block that ages best - these are the lines to rewrite in
 * October, without touching anything else on the tab.
 */
function renderOutlookMoves(data: OutlookSource): string {
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
function renderOutlookUsage(data: OutlookSource): string {
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
 * separately - an author who writes "Sell" should not also have to remember to
 * mark it as a caution.
 */
function verdictTone(call: string): string {
  const text = call.toLowerCase();
  if (/\b(buy|start|must)\b/.test(text)) return "positive";
  if (/\b(sell|avoid|drop|fade|bench)\b/.test(text)) return "caution";
  return "neutral";
}

function renderOutlookVerdict(data: OutlookSource): string {
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

/**
 * The whole tab, in the order a decision gets made.
 *
 * The written "<season> Outlook" head and the "What Drives The Outlook" strip
 * were taken off on 2026-09-30 at mak's request; the spec sections appended
 * below (lib/player/outlook-tab.ts) say both. The written body still decides
 * whether the tab exists, so no player gained or lost an Outlook URL.
 */
/**
 * What the Outlook tab is drawn from: the written take and the drivers built
 * off it, nothing else. Narrowed so hasOutlookTab() can answer for the whole
 * roster without building a page's worth of data per player.
 */
export type OutlookSource = Pick<PlayerPageData, "player" | "fantasyOutlook2026" | "outlookDrivers">;

/**
 * Whether this player gets an Outlook tab at all.
 *
 * The same test renderPlayerPage() applies, exported for /embed/players.json:
 * the sitemap must not list an /outlook/ address that only redirects.
 */
export function hasOutlookTab(data: OutlookSource): boolean {
  return renderOutlook2026(data).exists;
}

export function renderOutlook2026(data: OutlookSource): { exists: boolean; html: string } {
  const outlook = data.fantasyOutlook2026;
  const range = renderOutlookRange(data);
  const moves = renderOutlookMoves(data);
  const usage = renderOutlookUsage(data);
  const verdict = renderOutlookVerdict(data);
  const html = range + moves + usage + verdict;

  const written = /\S/.test(outlook?.body ?? "") ||
    !!(outlook?.weeklyRole || outlook?.restOfSeason || outlook?.confidence);
  return { exists: written || (data.outlookDrivers ?? []).length > 0 || html !== "", html };
}
