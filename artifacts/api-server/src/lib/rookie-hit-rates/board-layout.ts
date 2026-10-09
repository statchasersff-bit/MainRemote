/**
 * Layout ladder for a draft class's expanded draft board, ported from the
 * standalone app's lib/draftBoardLayout.ts.
 *
 * The board degrades in fixed steps as it loses width, and every step is a
 * board-wide decision rather than a per-name one, so the whole board always
 * shows one consistent treatment. Each rung gives up the cheapest remaining
 * thing that buys name width; the caller renders the FIRST rung that fits.
 *
 *   0. full names, pills fill the column          (the roomy default)
 *   1. every name -> "F. Lastname"
 *   2. pills shrink to their content, 5px right of the longest name
 *   3. pill chrome (border/background/padding) dropped entirely
 *   4. rounds wrap onto extra rows, one round at a time
 *
 * Free of the DOM on purpose: the bundle measures the names (canvas text
 * metrics) and the column, and this picks the rung.
 */

export type Chrome = "normal" | "tight" | "none";

export interface BoardLayout {
  abbrev: boolean;
  chrome: Chrome;
  cols: number;
  /** true: columns share the width evenly (1fr). false: each sizes to content. */
  fill: boolean;
}

/** Widest name in a round, at each of the two name formats. */
export interface RoundWidth {
  full: number;
  abbrev: number;
}

export const AVATAR_W = 24;
export const AVATAR_GAP = 8;

export const PAD_LEFT = 6;
export const PAD_RIGHT_NORMAL = 8;
/** Rung 2's floor: the longest name ends 5px from the pill's right edge. */
export const PAD_RIGHT_TIGHT = 5;
/** 3px hit accent on the left + 1px on the right. Misses are 2px narrower. */
export const BORDER_X = 4;

/**
 * Horizontal space a pill spends on anything that isn't the name. Uses the hit
 * border (the wider of the two) so the fit check stays conservative.
 */
export function pillOverhead(chrome: Chrome): number {
  if (chrome === "none") return AVATAR_W + AVATAR_GAP;
  const padRight = chrome === "tight" ? PAD_RIGHT_TIGHT : PAD_RIGHT_NORMAL;
  return BORDER_X + PAD_LEFT + AVATAR_W + AVATAR_GAP + padRight;
}

/** Width one round's column needs under a given rung. */
export function roundNeeds(cfg: BoardLayout, rd: number, widths: Map<number, RoundWidth>): number {
  const w = widths.get(rd);
  if (!w) return 0;
  return pillOverhead(cfg.chrome) + (cfg.abbrev ? w.abbrev : w.full);
}

export function layoutFits(
  cfg: BoardLayout,
  rounds: number[],
  widths: Map<number, RoundWidth>,
  avail: number,
  gap: number,
): boolean {
  if (cfg.fill) {
    // Every column is the same width, so the widest round has to fit in it.
    const colW = (avail - (cfg.cols - 1) * gap) / cfg.cols;
    return rounds.every((rd) => roundNeeds(cfg, rd, widths) <= colW);
  }
  // Content-sized: rounds wrap in reading order, so grid column j carries every
  // round at index j, j+cols, ... and takes the widest of them.
  const colW = new Array<number>(cfg.cols).fill(0);
  rounds.forEach((rd, i) => {
    const j = i % cfg.cols;
    colW[j] = Math.max(colW[j]!, roundNeeds(cfg, rd, widths));
  });
  const total = colW.reduce((a, b) => a + b, 0) + (cfg.cols - 1) * gap;
  return total <= avail;
}

export function buildLadder(n: number): BoardLayout[] {
  const rungs: BoardLayout[] = [
    { abbrev: false, chrome: "normal", cols: n, fill: true },
    { abbrev: true, chrome: "normal", cols: n, fill: true },
    { abbrev: true, chrome: "tight", cols: n, fill: false },
    { abbrev: true, chrome: "none", cols: n, fill: false },
  ];
  // Last resort: drop one round onto a new row at a time.
  for (let c = n - 1; c >= 1; c--) {
    rungs.push({ abbrev: true, chrome: "none", cols: c, fill: false });
  }
  return rungs;
}

/** First rung that fits, falling back to the tightest when nothing does. */
export function chooseLayout(
  ladder: BoardLayout[],
  rounds: number[],
  widths: Map<number, RoundWidth>,
  avail: number,
  gap: number,
): BoardLayout {
  return ladder.find((cfg) => layoutFits(cfg, rounds, widths, avail, gap)) ?? ladder[ladder.length - 1]!;
}

export function sameLayout(a: BoardLayout, b: BoardLayout): boolean {
  return a.abbrev === b.abbrev && a.chrome === b.chrome && a.cols === b.cols && a.fill === b.fill;
}
