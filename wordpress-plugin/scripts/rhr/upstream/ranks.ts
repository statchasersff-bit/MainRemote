import type { SeasonFinish, RankedSeason, Scoring } from "./types";

function getRankField(scoring: Scoring): keyof SeasonFinish {
  switch (scoring) {
    case "ppr": return "rank_ppr";
    case "hppr": return "rank_hppr";
    case "std": return "rank_std";
  }
}

export function computeRanks(finishes: SeasonFinish[], scoring: Scoring): RankedSeason[] {
  const field = getRankField(scoring);
  return finishes.map((f) => ({
    ...f,
    pos_rank: f[field] as number,
  }));
}

export function buildRankMap(rankedSeasons: RankedSeason[]): Map<string, RankedSeason[]> {
  const map = new Map<string, RankedSeason[]>();
  for (const rs of rankedSeasons) {
    if (!map.has(rs.player_id)) map.set(rs.player_id, []);
    map.get(rs.player_id)!.push(rs);
  }
  return map;
}
