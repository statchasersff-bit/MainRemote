/**
 * The pieces a player's table cell shares across the matchup page: his face
 * and his "SEA · WR" line. Here rather than in matchup-render.ts so the
 * fantasy section (which matchup-render imports) can use them too.
 */

import { headshotImg } from "../headshot-html";
import { escapeHtml } from "../render";

/** The face in a well of `size` px; the locally served derivative, never the CDN. */
export function playerPhoto(playerId: string, className: string, size: number): string {
  const img =
    headshotImg({ src: null, id: playerId, className: "sct-mu-ps-img", alt: "", variants: ["160"], width: size, height: size, loading: "lazy" }) ?? "";
  return `<span class="${className}" aria-hidden="true">${img}</span>`;
}

/**
 * "SEA · WR": the team first, then the position in its ink (mak, 2026-09-30).
 * `order: "position-first"` writes "WR · SEA" instead (the game-log cards,
 * mak, 2026-11-02).
 */
export function teamPosition(
  teamCode: string | null | undefined,
  position: string | null | undefined,
  className: string,
  order: "team-first" | "position-first" = "team-first",
): string {
  const pos = (position ?? "").trim();
  const code = (teamCode ?? "").trim().toUpperCase();
  if (!pos && !code) return "";
  const team = code ? `<span class="sct-pos-team">${escapeHtml(code)}</span>` : "";
  const dot = pos && code ? `<span class="sct-pos-dot" aria-hidden="true"> · </span>` : "";
  const slot = pos ? `<span class="sct-pos" data-pos="${escapeHtml(pos.toUpperCase())}">${escapeHtml(pos)}</span>` : "";
  return `<span class="${className}">${order === "position-first" ? slot + dot + team : team + dot + slot}</span>`;
}
