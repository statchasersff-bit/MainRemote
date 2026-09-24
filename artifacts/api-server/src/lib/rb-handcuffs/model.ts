/**
 * The parts of the handcuff model that both sides need: the tiers, the
 * score-bar bands, the handcuff types and the compare column's labels.
 *
 * Pure, like recompute.ts: client/rb-handcuffs.ts imports this for the compare
 * columns it builds, so nothing here may touch a Node module.
 */

export interface TierInfo {
  label: "Elite" | "Great" | "Good" | "Deep";
  key: "elite" | "great" | "good" | "deep";
  desc: string;
}

/** The tier cut-offs. MIRRORS getTierInfo() in the standalone lib/tiers.ts. */
export function tierFor(score: number): TierInfo {
  if (score >= 72) {
    return { label: "Elite", key: "elite", desc: "Score ≥ 72. Top-tier handcuff with elite upside and/or path." };
  }
  if (score >= 55) {
    return { label: "Great", key: "great", desc: "Score ≥ 55. Strong priority target in most formats." };
  }
  if (score >= 38) {
    return { label: "Good", key: "good", desc: "Score ≥ 38. Solid add where roster space allows." };
  }
  return { label: "Deep", key: "deep", desc: "Score < 38. Speculative. Only in deep leagues or as a stash." };
}

/**
 * The score-bar band: 76+ green, 51+ navy, 26+ yellow, below that red. The
 * standalone scoreBarColor(), used by the breakdown bars and the compare
 * columns. A missing score is its own band.
 */
export function barBand(value: number | null): string {
  if (value == null) return "none";
  if (value >= 76) return "hi";
  if (value >= 51) return "mid";
  if (value >= 26) return "low";
  return "bad";
}

export interface HandcuffType {
  label: string;
  /** The CSS hook for its colour and icon. */
  key: string;
  meaning: string;
  desc: string;
  group: "priority" | "caution";
}

/**
 * The handcuff types, in the order the legend prints them. Labels, meanings
 * and descriptions are type-legend.tsx's; the order is the table's TYPE_META.
 */
export const HANDCUFF_TYPES: HandcuffType[] = [
  {
    label: "Premium Handcuff",
    key: "premium",
    meaning: "Best overall profile",
    desc: "Strong backup, strong environment, realistic path.",
    group: "priority",
  },
  {
    label: "Premium Contingency",
    key: "contingency",
    meaning: "Great stash, less immediate path",
    desc: "Valuable situation, but touches may require more patience.",
    group: "priority",
  },
  {
    label: "Talent Stash",
    key: "talent",
    meaning: "Good player, blocked role",
    desc: "Player quality is strong, but opportunity is limited.",
    group: "priority",
  },
  {
    label: "Opportunity Stash",
    key: "opportunity",
    meaning: "Situation-driven upside",
    desc: "The setup is attractive, but talent profile is less certain.",
    group: "priority",
  },
  {
    label: "Trap Handcuff",
    key: "trap",
    meaning: "Looks better than it is",
    desc: "Low-upside profile that needs too many things to go right.",
    group: "caution",
  },
  {
    label: "Low-Ceiling Backup",
    key: "ceiling",
    meaning: "Capped upside",
    desc: "Opportunity is possible, but player quality limits ceiling.",
    group: "caution",
  },
  {
    label: "Dead-Zone Handcuff",
    key: "deadzone",
    meaning: "Low-priority stash",
    desc: "Weak environment may not create usable fantasy production.",
    group: "caution",
  },
];

const TYPE_BY_LABEL = new Map(HANDCUFF_TYPES.map((t) => [t.label, t]));

export function handcuffType(label: string | null | undefined): HandcuffType | null {
  return label ? (TYPE_BY_LABEL.get(label) ?? null) : null;
}

/** The compare column's starter-load label. starterLoadLabel(). */
export function starterLoadLabel(tpg: number | null | undefined): string {
  if (tpg == null) return "Unknown";
  if (tpg >= 22) return "Very High";
  if (tpg >= 18) return "High";
  if (tpg >= 14) return "Moderate";
  return "Limited";
}

/** The compare column's scoring-environment label. offenseLabel(). */
export function offenseLabel(v: number): string {
  if (v >= 72) return "Strong";
  if (v >= 52) return "Solid";
  if (v >= 38) return "Average";
  return "Below Average";
}
