import type { RookieDraft, SeasonFinish, Pos, Format, Scoring } from "./types";

// Base URL for the CSV data files. Defaults to the site-root "/data/" used by
// the standalone deployment, but can be overridden at runtime (e.g. when the app
// is embedded from a WordPress plugin subfolder) by setting
// `window.__RHR_DATA_BASE__` before the bundle loads.
const DATA_BASE: string =
  (typeof window !== "undefined" && (window as unknown as { __RHR_DATA_BASE__?: string }).__RHR_DATA_BASE__) ||
  "/data/";

const validPositions = new Set(["QB", "RB", "WR", "TE"]);

function parseCSV<T>(text: string, transform: (row: Record<string, string>) => T | null): T[] {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",");
  const results: T[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",");
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h.trim()] = (values[idx] || "").trim();
    });
    const result = transform(obj);
    if (result !== null) results.push(result);
  }
  return results;
}

export async function loadRookieDrafts(): Promise<RookieDraft[]> {
  const res = await fetch(`${DATA_BASE}rookie_drafts.csv`);
  const text = await res.text();
  return parseCSV(text, (row) => {
    const pos = row.pos as Pos;
    if (!validPositions.has(pos)) return null;

    const adpFormat = row.adp_format as Format;
    const scoringFormat = row.scoring_format as Scoring;

    return {
      player_id: row.player_id,
      player_name: row.player_name,
      pos,
      pos_rank: parseInt(row.pos_rank) || 0,
      rookie_year: parseInt(row.rookie_year),
      adp_format: adpFormat,
      scoring_format: scoringFormat,
      rookie_round: parseInt(row.rookie_round),
      rookie_pick: parseInt(row.rookie_pick),
      current_nfl_team: row.current_nfl_team || "FA",
      current_age: row.current_age && row.current_age !== "" ? parseInt(row.current_age) : null,
      height: row.height || "",
      weight: row.weight && row.weight !== "" ? parseInt(row.weight) : null,
    };
  });
}

export async function loadSeasonFinishes(): Promise<SeasonFinish[]> {
  const res = await fetch(`${DATA_BASE}season_finishes.csv`);
  const text = await res.text();
  return parseCSV(text, (row) => ({
    player_id: row.player_id,
    season: parseInt(row.season),
    pos: row.pos as Pos,
    games: parseInt(row.games),
    fantasy_points_ppr: parseFloat(row.fantasy_points_ppr),
    fantasy_points_hppr: parseFloat(row.fantasy_points_hppr),
    fantasy_points_std: parseFloat(row.fantasy_points_std),
    rank_ppr: parseInt(row.rank_ppr),
    rank_hppr: parseInt(row.rank_hppr),
    rank_std: parseInt(row.rank_std),
  }));
}
