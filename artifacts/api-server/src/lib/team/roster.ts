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
 *   - `search_rank` is Sleeper's league-wide fantasy relevance, used to decide
 *     which designations are worth a row. It has to be, because being injured
 *     is itself what moves a player down the depth chart — see
 *     INJURY_RANK_LIMIT at the foot of this file.
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
  /**
   * Sleeper's own fantasy-relevance rank across the whole league (1 = the most
   * looked-up player). Null when Sleeper does not rank him at all, which is the
   * honest answer for a camp body.
   *
   * This is the only relevance signal here that an injury does not corrupt. See
   * `injuryWatch` below for why that matters.
   */
  searchRank: number | null;
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

/**
 * A player as the free-text matcher needs him: the name to print, the team to
 * tag, and the id the headshot URL is built from.
 *
 * Kept separate from RosterPlayer because this index covers EVERY player with a
 * team, not only the four fantasy positions — an X post about an offensive
 * lineman or a head coach's quarterback still names a person, and refusing to
 * recognise him because he cannot be started at flex would be the wrong reason.
 */
export interface NamedPlayer {
  id: string;
  name: string;
  team: string;
}

/** Every indexed player keyed by team, plus a name index for news matching. */
interface RosterIndex {
  byTeam: Map<string, TeamRoster>;
  /** `search_full_name` -> lowercase team abbreviation. */
  teamByPlayerName: Map<string, string>;
  /**
   * `search_full_name` -> that player, for matching names inside free text.
   *
   * Same keys and the same ambiguity rule as teamByPlayerName (a name on two
   * teams is in neither index), so the two can never disagree about who
   * "Josh Allen" is. This one additionally carries what the card needs to
   * render him.
   */
  playerByName: Map<string, NamedPlayer>;
  fetchedAt: number;
}

let index: RosterIndex = {
  byTeam: new Map(),
  teamByPlayerName: new Map(),
  playerByName: new Map(),
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
 * Designated players at a position who are NOT on the chart shown.
 *
 * The gap this fills: Sleeper demotes an injured player on its depth chart, so
 * a genuine WR1 on IR sits at WR6 and falls off a four-deep preview entirely —
 * the chart then shows somebody else first with nothing saying why, which reads
 * as a wrong chart to anyone who knows the roster. See INJURY_RANK_LIMIT below,
 * which exists for the same reason.
 *
 * `injuries` is Injury Watch's list rather than the raw roster because it is
 * already filtered to players worth naming: a WR7's hamstring did not move the
 * WR1 slot and does not belong under the chart.
 *
 * Shared by the chart and its FAQ so the two cannot disagree about who is
 * missing — they are the same claim in two registers.
 */
export function sidelinedBehind(
  injuries: readonly DepthChartEntry[],
  position: SkillPosition,
  shown: readonly DepthChartEntry[],
): DepthChartEntry[] {
  const visible = new Set(shown.map((entry) => entry.name));
  return injuries.filter(
    (entry) =>
      entry.position === position &&
      isOutDesignation(entry.injuryStatus) &&
      !visible.has(entry.name),
  );
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
  // Same keys, carrying who the name belongs to. Filled for every player with a
  // team; pruned below by exactly the same ambiguity verdict.
  const playerCandidates = new Map<string, NamedPlayer>();

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

      const displayName =
        player.full_name?.trim() ||
        [player.first_name, player.last_name].filter(Boolean).join(" ").trim();
      if (displayName && !playerCandidates.has(searchName)) {
        playerCandidates.set(searchName, {
          id: String(player.player_id ?? key),
          name: displayName,
          team,
        });
      }
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
      searchRank:
        typeof player.search_rank === "number" ? player.search_rank : null,
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
    // the biggest name first. That is Sleeper's search rank and NOT the depth
    // chart, because a player is demoted on the depth chart *by* the injury —
    // ordering on depth puts the WR1 who just landed on IR below a healthy-ish
    // WR4, which is backwards. Depth breaks ties among the unranked, then
    // position in lineup order, then the name so the list is stable.
    const positionRank: Record<SkillPosition, number> = {
      QB: 0,
      RB: 1,
      WR: 2,
      TE: 3,
    };
    roster.injuries.sort(
      (a, b) =>
        fantasyRank(a) - fantasyRank(b) ||
        (a.depthOrder ?? 99) - (b.depthOrder ?? 99) ||
        positionRank[a.position] - positionRank[b.position] ||
        a.name.localeCompare(b.name),
    );
  }

  const teamByPlayerName = new Map<string, string>();
  const playerByName = new Map<string, NamedPlayer>();
  for (const [name, team] of nameCandidates) {
    if (team === null) continue;
    teamByPlayerName.set(name, team);
    const player = playerCandidates.get(name);
    if (player) playerByName.set(name, player);
  }

  index = { byTeam, teamByPlayerName, playerByName, fetchedAt };
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

/**
 * Every folded name key the index puts on a team: the other direction of
 * teamForPlayerName, for pushing a team filter into SQL.
 */
export function nameKeysForTeam(team: string): string[] {
  const wanted = team.toLowerCase();
  const keys: string[] = [];
  for (const [key, owner] of index.teamByPlayerName) if (owner === wanted) keys.push(key);
  return keys;
}

/**
 * The player behind a folded name key, or null.
 *
 * The key is the same folding Sleeper's own search index uses — see
 * teamForPlayerName above, whose key() this is deliberately identical to. The
 * caller does the folding because it is matching many candidate substrings
 * against this index and should not pay to re-normalise on every one.
 */
export function playerForSearchKey(key: string): NamedPlayer | null {
  return index.playerByName.get(key) ?? null;
}

/** How many players the free-text matcher can currently recognise. */
export function namedPlayerCount(): number {
  return index.playerByName.size;
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
  // Optional, so a cache file written before this index existed still restores
  // everything it does have. The next refresh rebuilds the missing half; until
  // then free-text matching simply finds nobody, which is the same thing it
  // does before the first fetch of a cold start.
  playerByName: Record<string, NamedPlayer> = {},
): void {
  index = {
    byTeam: new Map(Object.entries(byTeam)),
    teamByPlayerName: new Map(Object.entries(teamByPlayerName)),
    playerByName: new Map(Object.entries(playerByName)),
    fetchedAt,
  };
}

/** Serialisable form of the index, for the disk cache. */
export function snapshotRosterIndex(): {
  byTeam: Record<string, TeamRoster>;
  teamByPlayerName: Record<string, string>;
  playerByName: Record<string, NamedPlayer>;
  fetchedAt: number;
} {
  return {
    byTeam: Object.fromEntries(index.byTeam),
    teamByPlayerName: Object.fromEntries(index.teamByPlayerName),
    playerByName: Object.fromEntries(index.playerByName),
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
 */
const INJURY_DEPTH_LIMIT = 4;

/**
 * League-wide fantasy relevance that still earns a row no matter how far down
 * the depth chart the injury has pushed him.
 *
 * This limit is the whole reason Injury Watch works. **Sleeper demotes an
 * injured player on the depth chart**, so a season-ending IR for a genuine WR1
 * lands him at WR6 — and a depth-only gate then hides precisely the injury the
 * page exists to report, while still printing the WR4 who is questionable.
 * Search rank is the signal the injury does not move: it is where Sleeper ranks
 * him among every player in the league, so a top-300 name on IR is news whether
 * his team currently lists him first or ninth.
 *
 * 300 is deliberately wider than a startable roster. A designated player that
 * relevant is worth a line even on a deep team, and the row limit below is what
 * keeps the panel short — not a rank tight enough to drop real players.
 */
const INJURY_RANK_LIMIT = 300;

/** Most rows shown, so one battered roster cannot swamp the panel. */
const INJURY_ROW_LIMIT = 6;

/** Sort key: Sleeper's rank, with the unranked last rather than first. */
function fantasyRank(player: RosterPlayer): number {
  // `?? null` rather than a bare read: a roster cache written before this field
  // existed restores players without it, and `undefined` in arithmetic would
  // turn every comparison into NaN and leave the list in input order.
  return player.searchRank ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Injury Watch rows: designated players who are either near the top of their
 * depth chart or fantasy-relevant league-wide. See INJURY_RANK_LIMIT — the
 * second test is what keeps an IR'd starter on the page after Sleeper has
 * demoted him for being hurt.
 */
export function injuryWatch(roster: TeamRoster | null): DepthChartEntry[] {
  if (!roster) return [];
  return roster.injuries
    .filter(
      (player) =>
        (player.depthOrder !== null &&
          player.depthOrder <= INJURY_DEPTH_LIMIT) ||
        fantasyRank(player) <= INJURY_RANK_LIMIT,
    )
    .slice(0, INJURY_ROW_LIMIT)
    .map((player) => ({
      ...player,
      slot: `${player.position}${player.depthOrder ?? ""}`,
    }));
}
