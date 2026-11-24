/**
 * The game-state strip under a matchup page's hero (WEB-040, 2026-11-24).
 *
 * One line: the status, the score and the clock, from the GameStateRecord the
 * schedule row shares (game-state.ts), plus when the score was read. It is
 * printed in the server's HTML, so a fresh request is right on its own; the
 * browser (client/game-state.ts) keeps an open tab right by asking
 * /api/game-state/<id> while the game can change, and redraws the same
 * markup from the same record.
 *
 * Before kickoff the strip is printed `hidden`: the preview's own hero
 * carries the kickoff, and the strip exists only so an open tab knows which
 * game to follow and from when.
 */

import { escapeHtml } from "../render";
import { phaseBadge, pollPlan, stripParts, type GameStateRecord } from "./game-state";

export interface StripOptions {
  /** Absolute URL of /api/game-state/<id> on the API origin. */
  endpoint: string;
  /** The game's own dated address, for the "box score" link once final. */
  gameHref: string;
  /** Is this page the game's dated address itself? */
  onGamePage: boolean;
  now: number;
}

/** The strip, or "" when the page has nothing for it to say or follow. */
export function renderGameStateStrip(record: GameStateRecord | null, options: StripOptions): string {
  if (!record) return "";
  const plan = pollPlan(record, options.now);
  const finalReady = record.phase === "final" && record.detailsReady !== false;
  // A final with its box score is the page itself: nothing to add or follow.
  if (finalReady) return "";
  const scheduled = record.phase === "scheduled";
  // A scheduled game far from kickoff still gets the hidden strip: an open
  // tab has to know the kickoff to wake up for it.
  const parts = stripParts(record);
  const e = escapeHtml;
  return (
    `<section class="sct-gs" data-sc-game-state` +
    ` data-game-id="${e(record.gameId)}"` +
    ` data-phase="${e(record.phase)}"` +
    ` data-version="${e(record.version)}"` +
    ` data-endpoint="${e(options.endpoint)}"` +
    ` data-game-href="${e(options.gameHref)}"` +
    ` data-on-game-page="${options.onGamePage ? "1" : "0"}"` +
    (record.kickoffMs !== null ? ` data-kickoff="${record.kickoffMs}"` : "") +
    ` data-poll="${plan.active ? plan.everyMs : 0}"` +
    ` aria-label="Game status"` +
    (scheduled ? " hidden" : "") +
    `>` +
    `<p class="sct-gs-line">` +
    `<span class="sct-gs-badge" data-phase="${e(record.phase)}">${e(phaseBadge(record))}</span>` +
    (parts.score ? `<span class="sct-gs-score">${e(parts.score)}</span>` : "") +
    (parts.status && record.phase !== "final" ? `<span class="sct-gs-status">${e(parts.status)}</span>` : "") +
    `</p>` +
    `<p class="sct-gs-note" aria-live="polite">${parts.note ? e(parts.note) : ""}</p>` +
    `</section>`
  );
}
