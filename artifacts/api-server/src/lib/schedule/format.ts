/**
 * How a kickoff is written down.
 *
 * Lifted out of schedule-render.ts when schedule-faq.ts needed the same
 * formatters, and lifted rather than copied for the reason the rest of this
 * tool keeps repeating: an answer that says "1:00 PM ET" about a row that says
 * "1:05 PM ET" is the one error a reader would act on, and two formatters are
 * two things to keep in step. Everything that turns a date or a time into
 * words for this tool is here, and the board, the exports and the FAQ
 * all read it.
 *
 * The feed's dates are calendar dates and its times are US Eastern wall clock,
 * always, whatever the venue - see schedule-data.ts. Nothing here converts
 * either; the zone is labelled instead, and the client bundle does the
 * conversion once it can actually ask the browser where the reader is.
 */

function dateParts(date: string): Date | null {
  // Noon UTC, so no timezone the server might be in can roll the date back a
  // day. The feed's dates are calendar dates, not instants.
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** "Sun, Sep 24" - the weekly board's date line. */
export function formatGameDate(
  date: string | null,
  weekday: string | null,
): string {
  if (!date) return weekday ?? "Date TBD";
  const parsed = dateParts(date);
  if (!parsed) return weekday ?? date;
  const day = parsed.toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
  const rest = parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${day}, ${rest}`;
}

/**
 * "Sep 24" - a date as a table column rather than as a line of prose.
 *
 * Written for the team lens's date column, which has since moved to the team
 * hub; team-render.ts's gameShortDate() sets the same pair from its own Eastern
 * parse. Kept here because this is the module that owns this tool's date words
 * and the exports still reach for them.
 */
export function formatShortDate(
  date: string | null,
  weekday: string | null,
): string {
  if (!date) return weekday ?? "TBD";
  const parsed = dateParts(date);
  if (!parsed) return weekday ?? date;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * "Thursday, September 24" - the long form, for prose.
 *
 * The board sets its dates short because they are a column; a sentence that
 * says "Thu, Sep 24" is a table somebody typed out. Same parse as the column
 * either way, so the FAQ and the row cannot disagree about which day a game is
 * on. Same reasoning as team/schedule-faq.ts's LONG_DATE.
 */
export function formatLongDate(
  date: string | null,
  weekday: string | null,
): string {
  if (!date) return weekday ?? "";
  const parsed = dateParts(date);
  if (!parsed) return weekday ?? date;
  return parsed.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "Thursday" - the weekday a date falls on, from the date itself. */
export function weekdayName(
  date: string | null,
  weekday: string | null,
): string | null {
  if (!date) return weekday;
  const parsed = dateParts(date);
  if (!parsed) return weekday;
  return parsed.toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });
}

/**
 * "1:00 PM ET".
 *
 * The zone is labelled rather than converted. Every kickoff in the feed is US
 * Eastern, and the server has no idea what zone the reader is in - rendering it
 * as the server's local time would be wrong for almost everyone, and silently.
 * The client bundle converts to the reader's own zone once it can actually ask
 * the browser.
 */
export function formatKickoff(time: string | null): string {
  if (!time) return "Time TBD";
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return time;
  const hour = Number(match[1]);
  const suffix = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${match[2]} ${suffix} ET`;
}

/** The kickoff hour on a 24-hour Eastern clock, or null. */
export function kickoffHour(time: string | null): number | null {
  const match = /^(\d{1,2}):/.exec((time ?? "").trim());
  if (!match) return null;
  const hour = Number(match[1]);
  return Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : null;
}
