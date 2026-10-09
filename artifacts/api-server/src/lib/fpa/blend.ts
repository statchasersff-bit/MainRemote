/**
 * How the two seasons are mixed, and how the page says so.
 *
 * Both halves of one decision live here: `currentSeasonWeight` is the weight
 * the ingest actually applies, and `describeDataMode` is the sentence the page
 * prints about it. They are separate functions - one is arithmetic, one is copy
 * - and they must not drift apart, which is the whole reason they share a file
 * and why `tests/fpa.test.mjs` asserts the prose against the weights.
 *
 * Deliberately free of any database or network import. That is not tidiness: it
 * is what lets the agreement between the two be tested without a Postgres
 * connection, and these are the two pieces of this tool most likely to be
 * edited by someone reasoning about football rather than about code.
 */

export type FpaView = "raw" | "adjusted";

export const FPA_VIEWS: readonly FpaView[] = ["raw", "adjusted"] as const;

export function parseFpaView(value: unknown): FpaView {
  return value === "adjusted" ? "adjusted" : "raw";
}

/**
 * How much the current season is worth, given how many weeks it has run.
 *
 * Rises quickly and then stops: by week 4 last season is a fifth of the number,
 * and from week 12 it is gone entirely in favor of a rolling window. The shape
 * is a judgment about sample size, not a fitted curve, and it is stated here
 * rather than buried so it can be argued with.
 */
export function currentSeasonWeight(weeksPlayed: number): number {
  if (weeksPlayed <= 0) return 0;
  if (weeksPlayed === 1) return 0.25;
  if (weeksPlayed === 2) return 0.4;
  if (weeksPlayed === 3) return 0.6;
  if (weeksPlayed === 4) return 0.8;
  if (weeksPlayed < 12) return Math.min(0.9, 0.8 + (weeksPlayed - 4) * 0.02);
  return 1;
}

export interface DataModeDescription {
  /** A short label: "Preseason baseline", "Week 3". */
  dataMode: string;
  /** One paragraph saying exactly what the number is a mix of. */
  methodology: string;
  isPreseason: boolean;
}

/**
 * What the figure currently is, in words.
 *
 * The percentages are derived from `currentSeasonWeight` rather than retyped,
 * so the prose cannot claim a blend the ingest does not apply. Only the
 * sentences differ per week - early ones carry a sample-size warning that later
 * ones have no business carrying.
 */
export function describeDataMode(
  weekNumber: number | null,
  baselineSeason: number,
  currentSeason: number,
): DataModeDescription {
  if (weekNumber === null || weekNumber < 1) {
    return {
      dataMode: "Preseason baseline",
      methodology:
        `No ${currentSeason} regular-season games have been played, so every ` +
        `figure is the ${baselineSeason} season in full (weeks 1-17).`,
      isPreseason: true,
    };
  }

  const live = Math.round(currentSeasonWeight(weekNumber) * 100);
  const mix =
    `${100 - live}% ${baselineSeason} baseline and ${live}% ${currentSeason} data`;

  if (weekNumber >= 12) {
    return {
      dataMode: `Week ${weekNumber}`,
      methodology:
        `A rolling ten-week window of ${currentSeason} data only. ` +
        `${baselineSeason} no longer contributes.`,
      isPreseason: false,
    };
  }

  const caution =
    weekNumber <= 2
      ? weekNumber === 1
        ? " One week is a very small sample - treat the ranks as last season's with a nudge, not as this season's."
        : " Still a small sample; ranks will move a lot."
      : "";

  return {
    dataMode: `Week ${weekNumber}`,
    methodology: `${mix}.${caution}`,
    isPreseason: false,
  };
}
