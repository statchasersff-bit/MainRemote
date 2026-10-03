/**
 * How a team page interleaves its two providers.
 *
 * Its own module, and deliberately importing nothing. This is the one piece of
 * the read path that is a policy rather than a query - it decides what a reader
 * sees above the fold - so it is worth being able to state its behaviour in a
 * test without a database, a connection pool, or a log transport in the way.
 */

/**
 * How many of the first `WIRE_QUOTA_WINDOW` items a team page shows are held
 * for the player wire, when the wire has that many to give.
 *
 * The two providers do not publish at the same rate. A club files two to five
 * items a day in season - practice reports, previews, roster moves - where the
 * wire files a handful a week for any one team, so a merge ordered purely by
 * date hands a busy club every visible slot and buries "Suffers torn ACL at
 * practice" under "5 Takeaways from Wednesday's Press Conference". Both are
 * team news; only one of them changes what a reader does next.
 *
 * So the head of the list is quota'd rather than sorted. Four of the first ten,
 * which is TEAM_NEWS_VISIBLE - enough that a player note is always above the
 * fold, few enough that the page still reads as the club's week. Everything
 * past the window is plain date order again, because by then the reader has
 * chosen to keep going and chronology is what they want.
 *
 * A quota is not a promotion: nothing is reordered against the clock inside
 * either lane, and an empty lane simply yields its slots to the other rather
 * than leaving gaps.
 */
const WIRE_QUOTA = 4;
const WIRE_QUOTA_WINDOW = 10;

/**
 * Merge two date-ordered lanes, holding `quota` of the first `window` slots for
 * the second one.
 *
 * Both inputs must already be newest-first; neither is re-sorted. Exported for
 * the test, because the interesting cases are the degenerate ones - a lane
 * shorter than its quota, a lane that is empty, a window longer than the whole
 * list - and they are tedious to reach through a database.
 */
export function mergeNewsLanes<T extends { pubDateMs?: number | null }>(
  clubLane: readonly T[],
  wireLane: readonly T[],
  quota = WIRE_QUOTA,
  window = WIRE_QUOTA_WINDOW,
): T[] {
  const at = (item: T): number => item.pubDateMs ?? -Infinity;
  const merged: T[] = [];
  let club = 0;
  let wire = 0;

  while (club < clubLane.length || wire < wireLane.length) {
    const clubLeft = clubLane.length - club;
    const wireLeft = wireLane.length - wire;

    // Inside the window, the wire takes a slot whenever it still has one owed
    // and there are no longer enough slots left to pay it later.
    const slotsLeftInWindow = window - merged.length;
    const owed = Math.min(quota - wire, wireLeft);
    const mustTakeWire = slotsLeftInWindow > 0 && owed >= slotsLeftInWindow;

    const takeWire =
      clubLeft === 0 ||
      (wireLeft > 0 && (mustTakeWire || at(wireLane[wire]!) >= at(clubLane[club]!)));

    merged.push(takeWire ? wireLane[wire++]! : clubLane[club++]!);
  }

  return merged;
}
