/**
 * Fantasy-relevant roster, depth chart and injury designations, per team.
 *
 * Built from the SAME Sleeper player dictionary the news tool already
 * downloads to resolve each headline's team (see lib/teams.ts). That is the
 * point: the dictionary is ~14MB, and pulling it twice — or reaching for a
 * second provider for what is already in it — would be the expensive way to
 * learn things this app has in memory.
 *
 * Everything here is Sleeper's own data, unmodified:
 *   - `depth_chart_order` is the depth chart. It is not inferred, ranked or
 *     re-sorted by us, so "RB2" on the page means Sleeper lists him second.
 *   - `injury_status` / `injury_body_part` / `practice_participation` are the
 *     injury designations. A player with no designation is simply absent from
 *     Injury Watch — we never infer a status from a headline.
 *
 * Only QB/RB/WR/TE are indexed. The team pages are fantasy pages; a full
 * 90-man roster is a different product, and keeping the index to the four
 * positions that matter is also what keeps it small enough to hold in memory
 * and write to disk for all 32 teams.
 */

/** Positions a fantasy team page cares about. */
export const SKILL_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export type SkillPosition = (typeof SKILL_POSITIONS)[number];

export interface RosterPlayer {
  /** Sleeper player id — also what the headshot URL is keyed by. */
  id: string;
  name: string;
  position: SkillPosition;
  /** Lowercase team abbreviation, matching the canonical team id. */
  team: string;
  /** Sleeper's depth-chart slot, 1-based. Null when unlisted. */
  depthOrder: number | null;
  /** Sleeper's depth-chart position label, e.g. "LWR", "SWR", "RB". */
  depthPosition: string | null;
  jersey: number | null;
  yearsExp: number | null;
  /** Roster status, e.g. "Active", "Inactive". */
  status: string | null;
  /** e.g. "Questionable", "Out", "IR". Null when the player has no designation. */
  injuryStatus: string | null;
  /** e.g. "Ankle". Null when unspecified. */
  injuryBodyPart: string | null;
  /** e.g. "Limited Participation in Practice". */
  practice: string | null;
  headshot: string;
}

export interface TeamRoster {
  team: string;
  /** Depth-chart order per position, exactly as Sleeper lists it. */
  depthChart: Record<SkillPosition, RosterPlayer[]>;
  /** Everyone indexed for this team, depth-listed or not. */
  players: RosterPlayer[];
  /** Players carrying an injury designation right now. */
  injuries: RosterPlayer[];
  /** Epoch ms this snapshot was pulled from Sleeper. */
  fetchedAt: number;
}

/** The same CDN path the news cards already use for headshots. */
export function headshotUrl(playerId: string): string {
  return `https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`;
}

/** Shape of the fields this module reads out of Sleeper's player dictionary. */
export interface SleeperPlayer {
  player_id?: string | null;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  team?: string | null;
  depth_chart_order?: number | null;
  depth_chart_position?: string | null;
  number?: number | null;
  years_exp?: number | null;
  status?: string | null;
  injury_status?: string | null;
  injury_body_part?: string | null;
  practice_participation?: string | null;
  search_full_name?: string | null;
  search_rank?: number | null;
  active?: boolean | null;
}

/** Every indexed player keyed by team, plus a name index for news matching. */
interface RosterIndex {
  byTeam: Map<string, TeamRoster>;
  /** `search_full_name` -> lowercase team abbreviation. */
  teamByPlayerName: Map<string, string>;
  fetchedAt: number;
}

let index: RosterIndex = {
  byTeam: new Map(),
  teamByPlayerName: new Map(),
  fetchedAt: 0,
};

function emptyDepthChart(): Record<SkillPosition, RosterPlayer[]> {
  return { QB: [], RB: [], WR: [], TE: [] };
}

function isSkill(position: string | null | undefined): position is SkillPosition {
  return (SKILL_POSITIONS as readonly string[]).includes(position ?? "");
}

/**
 * A designation that means "not available", as opposed to a game-time question.
 * Used only to decide how a badge is coloured and worded — never to reorder or
 * remove anyone from the depth chart, which is Sleeper's to state, not ours.
 */
const OUT_DESIGNATIONS = new Set([
  "ir",
  "out",
  "pup",
  "nfi",
  "sus",
  "dnr",
  "cov",
  "na",
]);

export function isOutDesignation(status: string | null | undefined): boolean {
  return OUT_DESIGNATIONS.has((status ?? "").trim().toLowerCase());
}

/**
 * Rebuild the index from a freshly fetched dictionary.
 *
 * Called by lib/teams.ts with the payload it already has in hand, so this costs
 * one pass over an object that was going to be walked anyway.
 */
export function indexRoster(
  data: Record<string, SleeperPlayer | null>,
  fetchedAt: number,
): void {
  const byTeam = new Map<string, TeamRoster>();
  // Names seen more than once on different teams are dropped below rather than
  // resolved first-wins. This index is the fallback that attributes a news item
  // with no headshot, and there is no headline in which "which Josh Allen" can
  // be worked out — attributing one to the wrong team is worse than leaving it
  // unattributed, which is all an ambiguous name costs.
  const nameCandidates = new Map<string, string | null>();

  for (const key in data) {
    const player = data[key];
    if (!player) continue;

    const team = player.team ? String(player.team).toLowerCase() : null;
    if (!team) continue;

    const searchName = player.search_full_name?.trim().toLowerCase();
    if (searchName) {
      const seen = nameCandidates.get(searchName);
      if (seen === undefined) nameCandidates.set(searchName, team);
      else if (seen !== null && seen !== team) nameCandidates.set(searchName, null);
    }

    const position = player.position ?? null;
    if (!isSkill(position)) continue;

    const id = String(player.player_id ?? key);
    const name =
      player.full_name?.trim() ||
      [player.first_name, player.last_name].filter(Boolean).join(" ").trim();
    if (!name) continue;

    const entry: RosterPlayer = {
      id,
      name,
      position,
      team,
      depthOrder:
        typeof player.depth_chart_order === "number" &&
        player.depth_chart_order > 0
          ? player.depth_chart_order
          : null,
      depthPosition: player.depth_chart_position ?? null,
      jersey: typeof player.number === "number" ? player.number : null,
      yearsExp: typeof player.years_exp === "number" ? player.years_exp : null,
      status: player.status ?? null,
      injuryStatus: player.injury_status?.trim() || null,
      injuryBodyPart: player.injury_body_part?.trim() || null,
      practice: player.practice_participation?.trim() || null,
      headshot: headshotUrl(id),
    };

    let roster = byTeam.get(team);
    if (!roster) {
      roster = {
        team,
        depthChart: emptyDepthChart(),
        players: [],
        injuries: [],
        fetchedAt,
      };
      byTeam.set(team, roster);
    }
    roster.players.push(entry);
    if (entry.depthOrder !== null) roster.depthChart[position].push(entry);
    if (entry.injuryStatus) roster.injuries.push(entry);
  }

  for (const roster of byTeam.values()) {
    for (const position of SKILL_POSITIONS) {
      roster.depthChart[position].sort(
        (a, b) => (a.depthOrder ?? 99) - (b.depthOrder ?? 99),
      );
    }
    // Injury Watch reads top-down, so order it the way a fantasy manager cares:
    // starters first, then by position in lineup order. A WR4's hamstring is
    // real information but it is not the first thing on the page.
    const positionRank: Record<SkillPosition, number> = {
      QB: 0,
      RB: 1,
      WR: 2,
      TE: 3,
    };
    roster.injuries.sort(
      (a, b) =>
        (a.depthOrder ?? 99) - (b.depthOrder ?? 99) ||
        positionRank[a.position] - positionRank[b.position] ||
        a.name.localeCompare(b.name),
    );
  }

  const teamByPlayerName = new Map<string, string>();
  for (const [name, team] of nameCandidates) {
    if (team !== null) teamByPlayerName.set(name, team);
  }

  index = { byTeam, teamByPlayerName, fetchedAt };
}

/** The indexed roster for a team, or null before the first successful fetch. */
export function getTeamRoster(team: string): TeamRoster | null {
  return index.byTeam.get(team.toLowerCase()) ?? null;
}

/**
 * Team for a player name, using the same folding Sleeper's own search index
 * uses ("Ja'Marr Chase" -> "jamarrchase").
 *
 * This is the fallback that attributes a news item whose headshot is missing —
 * the archive has rows with a null image, and those would otherwise belong to
 * no team at all and never appear on any team page.
 */
export function teamForPlayerName(name: string | null | undefined): string | null {
  const key = (name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (!key) return null;
  return index.teamByPlayerName.get(key) ?? null;
}

/** When the roster snapshot was taken, or 0 if there is none yet. */
export function rosterFetchedAt(): number {
  return index.fetchedAt;
}

/** Restore an index from the disk cache without a network call. */
export function restoreRosterIndex(
  byTeam: Record<string, TeamRoster>,
  teamByPlayerName: Record<string, string>,
  fetchedAt: number,
): void {
  index = {
    byTeam: new Map(Object.entries(byTeam)),
    teamByPlayerName: new Map(Object.entries(teamByPlayerName)),
    fetchedAt,
  };
}

/** Serialisable form of the index, for the disk cache. */
export function snapshotRosterIndex(): {
  byTeam: Record<string, TeamRoster>;
  teamByPlayerName: Record<string, string>;
  fetchedAt: number;
} {
  return {
    byTeam: Object.fromEntries(index.byTeam),
    teamByPlayerName: Object.fromEntries(index.teamByPlayerName),
    fetchedAt: index.fetchedAt,
  };
}

export interface DepthChartEntry extends RosterPlayer {
  /** Display slot, e.g. "RB2" — Sleeper's order, not a ranking of our own. */
  slot: string;
}

/** How deep the condensed preview goes per position. */
export const DEPTH_PREVIEW_LIMITS: Record<SkillPosition, number> = {
  QB: 2,
  RB: 3,
  WR: 4,
  TE: 2,
};

/** The condensed offence-only depth chart shown on the team page. */
export function depthPreview(
  roster: TeamRoster | null,
): Record<SkillPosition, DepthChartEntry[]> {
  const out = { QB: [], RB: [], WR: [], TE: [] } as Record<
    SkillPosition,
    DepthChartEntry[]
  >;
  if (!roster) return out;
  for (const position of SKILL_POSITIONS) {
    out[position] = roster.depthChart[position]
      .slice(0, DEPTH_PREVIEW_LIMITS[position])
      .map((player, i) => ({ ...player, slot: `${position}${i + 1}` }));
  }
  return out;
}

/**
 * The handful of players who decide a team's fantasy season: QB1, both backs,
 * the top two receivers and TE1.
 *
 * Taken straight off the depth chart rather than from any ranking — this app
 * has no ADP or projection data, and inventing an ordering to look authoritative
 * is exactly the thing not to do. RB2 and WR2 are dropped when the team does not
 * list one.
 */
export function fantasyCornerstones(
  roster: TeamRoster | null,
): DepthChartEntry[] {
  if (!roster) return [];
  const wanted: Array<[SkillPosition, number]> = [
    ["QB", 0],
    ["RB", 0],
    ["RB", 1],
    ["WR", 0],
    ["WR", 1],
    ["TE", 0],
  ];
  const out: DepthChartEntry[] = [];
  for (const [position, i] of wanted) {
    const player = roster.depthChart[position][i];
    if (player) out.push({ ...player, slot: `${position}${i + 1}` });
  }
  return out;
}

/**
 * How deep into a position group an injury is still fantasy news.
 *
 * Sleeper designates everyone, including camp bodies on IR who are not on the
 * depth chart at all. Listing them turns Injury Watch into a transactions log:
 * the brief is fantasy-relevant offensive players, and a WR7's arm is not that.
 * A player off the depth chart entirely is excluded outright.
 */
const INJURY_DEPTH_LIMIT = 4;

/** Most rows shown, so one battered roster cannot swamp the panel. */
const INJURY_ROW_LIMIT = 6;

/** Injury Watch rows: designated players near the top of the depth chart. */
export function injuryWatch(roster: TeamRoster | null): DepthChartEntry[] {
  if (!roster) return [];
  return roster.injuries
    .filter(
      (player) =>
        player.depthOrder !== null && player.depthOrder <= INJURY_DEPTH_LIMIT,
    )
    .slice(0, INJURY_ROW_LIMIT)
    .map((player) => ({
      ...player,
      slot: `${player.position}${player.depthOrder ?? ""}`,
    }));
}
