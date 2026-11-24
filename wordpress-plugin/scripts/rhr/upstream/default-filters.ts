import type { Filters } from "./types";

// The tool's starting view. Shared by the app (data-context.tsx) and the
// build-time WordPress summary (script/wp-summary-entry.ts), so the table printed
// in the page always describes the view a reader first sees.
export const defaultFilters: Filters = {
  yearStart: 2017,
  yearEnd: 2025,
  format: "sf",
  scoring: "ppr",
  outcome: "elite",
  positions: ["QB", "RB", "WR", "TE"],
  rounds: [1, 2, 3, 4, 5],
  minGames: 8,
  showConfidence: false,
};
