/**
 * What a person knows about one game that no feed says: the official
 * highlights upload, who left the game hurt, who played through something and
 * who came back.
 *
 * No free feed carries in-game exits — ESPN's per-game injuries block is the
 * current report, not who was carted off in the third quarter — and no feed
 * maps a game to the league's own YouTube upload. Both are written here by
 * hand, and a game with no entry simply has no video and no injuries block —
 * except that the league's highlights upload for most games is found by
 * scripts/find-game-videos.mjs and kept in game-videos.ts, which an entry
 * here overrides.
 * The injuries block is printed only for a game with an entry, so "No in-game
 * injuries reported" is never said of a game nobody checked.
 *
 * Only official league or team uploads, which allow embedding. Keyed like
 * recap-notes.ts: `<pair slug>/<game segment>`. Kept in source so every claim
 * is reviewable in a diff.
 */

import fs from "node:fs";
import { dataPath } from "../data-dir";
import type { GameInjuryNotes } from "./fantasy-section";
import { GAME_VIDEOS } from "./game-videos";

export interface GameVideo {
  youtubeId: string;
  title: string;
  /** "2022-01-18". */
  uploadDate: string;
  publisher: string;
}

export interface GameNotes {
  video?: GameVideo;
  injuries?: GameInjuryNotes;
}

export const GAME_NOTES: Record<string, GameNotes> = {
  "arizona-cardinals-vs-los-angeles-rams/2021-wild-card": {
    video: {
      youtubeId: "VfMqgtKsoag",
      title: "Cardinals vs. Rams Super Wild Card Weekend Highlights | NFL 2021",
      uploadDate: "2022-01-18",
      publisher: "NFL",
    },
    injuries: {
      injuries: [
        {
          player: "Budda Baker",
          team: "ARI",
          pos: "S",
          text: "left on a stretcher in the third quarter after a helmet-to-helmet collision with Cam Akers",
        },
      ],
      playedThrough: ["James Conner and Chase Edmonds (ribs)"],
      returned: ["J.J. Watt (shoulder surgery, first game since late October)", "Rondale Moore (ankle)"],
    },
  },
};

/**
 * Finds since the last publish: what `find-game-videos.mjs --live` wrote from
 * the production refresh (live-refresh.ts). Read once, and again after
 * resetLiveVideos(); a missing or unreadable file is no videos.
 */
let liveVideos: Record<string, GameVideo> | null = null;

function live(): Record<string, GameVideo> {
  if (liveVideos) return liveVideos;
  try {
    liveVideos = JSON.parse(fs.readFileSync(dataPath("matchup", "game-videos-live.json"), "utf8")) as Record<
      string,
      GameVideo
    >;
  } catch {
    liveVideos = {};
  }
  return liveVideos;
}

/** Drop the live finds, so the next page reads the file again. */
export function resetLiveVideos(): void {
  liveVideos = null;
}

export function gameNotes(pairSlug: string, gameSegment: string): GameNotes {
  const key = `${pairSlug}/${gameSegment}`;
  const notes = GAME_NOTES[key] ?? {};
  const video = notes.video ?? GAME_VIDEOS[key] ?? live()[key];
  return video ? { ...notes, video } : notes;
}

/**
 * The video the page describes in its JSON-LD: whichever one it shows, the
 * scanned uploads in game-videos.ts included (mak approved, 2026-09-30).
 */
export function schemaVideo(pairSlug: string, gameSegment: string): GameVideo | null {
  return gameNotes(pairSlug, gameSegment).video ?? null;
}
