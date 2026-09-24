/**
 * Structured data for the rankings boards: one ItemList per ranked position.
 *
 * A board is a ranked list of players, and ItemList is what says so. The host
 * page's SEO plugin already emits WebPage and BreadcrumbList, so this adds only
 * the lists — the plugin grafts them into that graph, the standalone page
 * prints them on its own. Nothing here is an application: see schema.ts for
 * why SoftwareApplication is gone.
 *
 * Which lists follow the address. A position page (/rb/) is about that
 * position and carries its list alone; the All board prints all four boards,
 * so it carries all four. Not one merged list: ranks are positional (RB7 and
 * WR7 are not the same pick), and a single ordered list would claim they were.
 *
 * Each entry is a Person with the player's page on the site when there is one.
 * No team: the board carries an abbreviation, and a SportsTeam named "BUF" is
 * worse than none.
 */

import {
  POSITION_NAMES,
  STAT_POSITIONS,
  type PositionFilter,
  type RankingsData,
  type StatPosition,
} from "./rankings-data";
import { getPlayerPageUrl } from "../team/links";

type Node = Record<string, unknown>;

function boardLabel(data: RankingsData): string {
  return data.board === "ros" ? "Rest of Season" : "Redraft";
}

function positionList(data: RankingsData, pos: StatPosition): Node | null {
  const players = data.byPosition[pos].flatMap((group) => group.players);
  if (players.length === 0) return null;

  return {
    "@type": "ItemList",
    name: `${data.season} ${boardLabel(data)} Fantasy Football ${POSITION_NAMES[pos]} Rankings`,
    itemListOrder: "https://schema.org/ItemListOrderAscending",
    numberOfItems: players.length,
    itemListElement: players.map((player) => {
      const url = getPlayerPageUrl(player.slug);
      return {
        "@type": "ListItem",
        position: player.rank,
        item: {
          "@type": "Person",
          name: player.name,
          ...(url ? { url } : {}),
        },
      };
    }),
  };
}

/** The lists for the board this page opens on; empty when there are none. */
export function rankingsItemLists(
  data: RankingsData,
  position: PositionFilter = "All",
): Node[] {
  const positions =
    position === "All" ? STAT_POSITIONS : STAT_POSITIONS.filter((p) => p === position);

  return positions
    .map((pos) => positionList(data, pos))
    .filter((node): node is Node => node !== null);
}
