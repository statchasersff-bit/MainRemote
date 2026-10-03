/**
 * ESPN's game summary cut down to the fields src/lib/matchup/boxscore.ts reads.
 *
 * The full document is about half a megabyte - articles, every play, win
 * probability by play, videos. The parser reads a few objects out of it, so the
 * stored copy keeps exactly those and nothing else: roughly 15 KB a game, a
 * season in a few megabytes.
 *
 * Kept as ESPN's own shape rather than as the parsed box score, so the page
 * still runs its parser over the stored copy. A parser fix then reaches every
 * stored game without a rebuild, and the team objects the parser attaches
 * (names, colours) come from the current team table, not from the day the game
 * was saved.
 *
 * THE CONTRACT. `SHAPE` mirrors the `EspnSummary` interface in boxscore.ts and
 * `EspnScoringPlay` in scoring-plays.ts. A field the parser starts reading has
 * to be added here too, or stored games will parse without it - the builder's
 * `--verify` run and tests/boxscore-store.test.mjs are what catch that.
 */

/** `true` keeps a value as it is; an object keeps those keys; `[x]` maps a list. */
const SCORING_PLAY = {
  text: true,
  type: { text: true, abbreviation: true },
  scoringType: { name: true, abbreviation: true },
  period: { number: true },
  clock: { displayValue: true },
  team: { abbreviation: true },
};

export const SHAPE = {
  header: {
    competitions: [
      {
        status: { type: { completed: true } },
        competitors: [
          {
            homeAway: true,
            score: true,
            team: { abbreviation: true },
            linescores: [{ value: true, displayValue: true }],
          },
        ],
      },
    ],
  },
  boxscore: {
    teams: [
      {
        team: { abbreviation: true },
        statistics: [{ name: true, displayValue: true }],
      },
    ],
    players: [
      {
        team: { abbreviation: true },
        statistics: [
          {
            name: true,
            keys: true,
            athletes: [
              {
                athlete: { id: true, displayName: true, position: { abbreviation: true } },
                stats: true,
              },
            ],
          },
        ],
      },
    ],
  },
  scoringPlays: [SCORING_PLAY],
  drives: {
    previous: [
      {
        team: { abbreviation: true },
        start: { period: { number: true }, clock: { displayValue: true } },
        timeElapsed: { displayValue: true },
        yards: true,
        offensivePlays: true,
        result: true,
        displayResult: true,
      },
    ],
  },
  pickcenter: [
    {
      provider: { name: true, priority: true },
      spread: true,
      overUnder: true,
      details: true,
      homeTeamOdds: { favorite: true },
      awayTeamOdds: { favorite: true },
    },
  ],
  gameInfo: { attendance: true },
  broadcasts: [{ media: { shortName: true }, station: true }],
};

function pick(value, shape) {
  if (shape === true) return value;
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(shape)) {
    return Array.isArray(value) ? value.map((item) => pick(item, shape[0])) : undefined;
  }
  if (typeof value !== "object" || Array.isArray(value)) return undefined;
  const out = {};
  for (const [key, sub] of Object.entries(shape)) {
    const kept = pick(value[key], sub);
    if (kept !== undefined) out[key] = kept;
  }
  return out;
}

/** The summary with everything the parser does not read removed. */
export function trimEspnSummary(summary) {
  return pick(summary, SHAPE) ?? {};
}
