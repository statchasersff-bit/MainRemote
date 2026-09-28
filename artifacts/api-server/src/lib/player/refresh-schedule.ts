/**
 * When the after-game player refresh is due. Pure, and on its own so the
 * tests can pin the rule without loading the server — see live-refresh.ts.
 */

/** Kickoff to final, plus the time Sleeper takes to post: generous on purpose. */
const AFTER_KICKOFF_MS = 4 * 60 * 60 * 1000;
/** The morning-after catch-up, for stat corrections. */
const CATCH_UP_UTC_HOUR = 13;
const CATCH_UP_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * The most recent moment a refresh became due, at or before `nowMs`, or 0:
 * four hours after each kickoff that has happened, and 13:00 UTC on any day
 * within three days of a game.
 */
export function latestDueMs(kickoffs: number[], nowMs: number): number {
  // The latest catch-up moment at or before now.
  const catchUp = new Date(nowMs);
  catchUp.setUTCHours(CATCH_UP_UTC_HOUR, 0, 0, 0);
  if (catchUp.getTime() > nowMs) catchUp.setUTCDate(catchUp.getUTCDate() - 1);
  const catchUpMs = catchUp.getTime();

  let due = 0;
  for (const kickoff of kickoffs) {
    const over = kickoff + AFTER_KICKOFF_MS;
    if (over > nowMs) continue;
    if (over > due) due = over;
    // A catch-up follows a game that was already over by then, and only for a
    // few days after it — not the morning before, and not all season.
    if (over <= catchUpMs && catchUpMs - kickoff <= CATCH_UP_WINDOW_MS && catchUpMs > due) {
      due = catchUpMs;
    }
  }
  return due;
}
