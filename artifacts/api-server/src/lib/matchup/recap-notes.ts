/**
 * Hand-written sentences for a game recap, per game.
 *
 * The recap (recap.ts) is written from the box score and says only what the
 * numbers on the page can back. What a person knows and the data does not —
 * a quarterback's first playoff win, a record broken — goes here, and is
 * printed as given at the start of the recap's third paragraph, before the
 * line about where the win led.
 *
 * Keyed by the game's address below /nfl/: `<pair slug>/<game segment>`. A
 * game with no entry simply has no notes. Kept in source, like the team
 * outlooks, so every claim is reviewable in a diff.
 */
export const RECAP_NOTES: Record<string, string[]> = {
  "arizona-cardinals-vs-los-angeles-rams/2021-wild-card": [
    "The win was Matthew Stafford's first career playoff victory.",
  ],
};

export function recapNotes(pairSlug: string, gameSegment: string): string[] {
  return RECAP_NOTES[`${pairSlug}/${gameSegment}`] ?? [];
}
