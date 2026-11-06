/**
 * A player's own page in Redraft Command (mak, 2026-11-06: "View fantasy
 * profile" opened the tool's home page). Redraft Command serves player
 * profiles at /redraft-command/players/:playerId, where the param is the
 * Sleeper id (or its name-TEAM-POS slug); a `?player=` query is not read
 * there, which is why the old links landed on the home page. The Sleeper id
 * resolves without its player database, so it is the one used.
 */

const REDRAFT_COMMAND_URL = "https://statchasers.com/redraft-command/";

export function redraftPlayerUrl(player: { id?: string | null }): string {
  const id = (player.id ?? "").trim();
  return id ? `${REDRAFT_COMMAND_URL}players/${encodeURIComponent(id)}` : REDRAFT_COMMAND_URL;
}
