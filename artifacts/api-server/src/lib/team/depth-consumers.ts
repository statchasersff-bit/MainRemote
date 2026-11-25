/**
 * The pages outside the Depth Chart tabs that print the depth-chart snapshot,
 * and a content hash for each, so a publication of the snapshot can purge
 * exactly the ones it changed (docs/DEPTH-SNAPSHOT-CONSUMERS-2026-11-25.md).
 *
 * Two readers, traced 2026-11-25:
 *
 * - The team hub's Draft tab (a hash tab, so it is the hub's own address,
 *   /nfl/teams/{slug}/): its Pos column is depthSlotFor() on the chart of the
 *   club each draftee is with NOW. A change to one club's chart can move the
 *   Pos cell on another club's hub (a player that club drafted who has since
 *   moved), so the hash here is of the printed cells themselves, hub by hub.
 *
 * - The matchup preview's Player Battles (preview-extras.ts): depthStarters()
 *   at EDGE, DL, LB, S and CB, depthChartNames() and depthHeadshot() over the
 *   two clubs' whole entries. A preview prints on the dated page of every
 *   unplayed game of the current season and on the pair's own page while it
 *   previews its next meeting (pairPreviewsMeeting). The hash is the two
 *   clubs' entry hashes, the same ones the Depth Chart tabs publish by.
 *
 * Both ride on GET /embed/depth-charts/version; the WordPress check compares
 * them with what it last published and purges only the paths whose hash
 * moved (statchasers-depth-charts-cache.php).
 *
 * KEEP IN STEP: if either page starts printing something else from the
 * snapshot, fold it into the hash below, or a change to it will not reach the
 * edge. The preview's "updated" stamp (updatedMs, which takes the snapshot's
 * fetchedAt among others) is deliberately left out: it moves with every line
 * refresh anyway, and a new stamp alone is not a reason to purge every preview.
 */

import crypto from "node:crypto";
import { canonicalizeMatchupPair, gameSegment, pairPreviewsMeeting, type MeetingFacts } from "../matchup/pair";
import type { ScheduleGame } from "../schedule/schedule-data";
import { depthChartsFingerprint, depthTeamHash } from "./depth-charts";
import { draftVersion, getDraftStatus, getDraftView, nextDraftYear } from "./draft";
import { depthSlotCell } from "./draft-render";
import { getTeamHubUrl } from "./links";
import { TEAMS, type NflTeam } from "./teams";

function sha(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 16);
}

/** The site path of a club's hub, which carries the Draft tab. */
export function hubPath(team: NflTeam): string {
  const url = getTeamHubUrl(team);
  return url ? new URL(url, "https://statchasers.com").pathname.replace(/\/?$/, "/") : `/nfl/teams/${team.slug}/`;
}

/* ------------------------------------------------------------- Draft tab */

let draftMemo: { key: string; hashes: Map<string, string> } | null = null;

/**
 * Per club, a hash of every Pos-column depth cell its Draft tab prints, or
 * "none" when the tab has no draft classes. Recomputed only when the
 * snapshot, the draft files or the season change.
 */
export function draftPosHashes(season: number): Map<string, string> {
  const key = `${depthChartsFingerprint()}|${draftVersion(nextDraftYear(season))}|${season}`;
  if (draftMemo && draftMemo.key === key) return draftMemo.hashes;
  const statusDoc = getDraftStatus();
  const hashes = new Map<string, string>();
  for (const team of TEAMS) {
    const club = team.abbreviation.toLowerCase();
    const seasons = getDraftView(team.abbreviation, season).history?.seasons ?? [];
    const cells = seasons.flatMap((s) => s.picks.map((p) => `${s.season}:${p.round}:${p.pick}=${depthSlotCell(p, club, statusDoc)}`));
    hashes.set(team.abbreviation.toUpperCase(), cells.length ? sha(cells.join("\n")) : "none");
  }
  draftMemo = { key, hashes };
  return hashes;
}

/* ------------------------------------------------------ matchup previews */

export interface PreviewPage {
  path: string;
  away: string;
  home: string;
  hash: string;
  /** Kickoff, epoch seconds, or null while unconfirmed. The plugin warms the near ones. */
  kickoff: number | null;
}

/**
 * Every matchup address printing a preview (and so Player Battles) right now,
 * from the current season's slate: each unplayed game's dated page, and the
 * pair's page while it previews that game.
 */
export function previewPages(games: readonly ScheduleGame[], season: number, now: number): PreviewPage[] {
  const facts = new Map<ScheduleGame, MeetingFacts>();
  const byPair = new Map<string, MeetingFacts[]>();
  for (const game of games) {
    if (game.status === "canceled" || !game.away || !game.home) continue;
    const pair = canonicalizeMatchupPair(game.away, game.home);
    if (!pair) continue;
    const f: MeetingFacts = { kickoffMs: game.kickoffMs, isFinal: game.status === "final", inPlay: game.status === "live" };
    facts.set(game, f);
    byPair.set(pair.slug, [...(byPair.get(pair.slug) ?? []), f]);
  }
  const pages: PreviewPage[] = [];
  for (const [game, f] of facts) {
    if (f.isFinal || !game.away || !game.home) continue;
    const pair = canonicalizeMatchupPair(game.away, game.home);
    if (!pair) continue;
    const away = game.away.abbreviation.toUpperCase();
    const home = game.home.abbreviation.toUpperCase();
    const hash = sha(`${away}:${depthTeamHash(away)}|${home}:${depthTeamHash(home)}`);
    const kickoff = game.kickoffMs !== null ? Math.floor(game.kickoffMs / 1000) : null;
    const pairPath = `/nfl/${pair.slug}/`;
    pages.push({ path: `${pairPath}${gameSegment({ season, week: game.week, seasonType: "regular" })}/`, away, home, hash, kickoff });
    if (pairPreviewsMeeting(f, byPair.get(pair.slug) ?? [], now)) pages.push({ path: pairPath, away, home, hash, kickoff });
  }
  return pages.sort((x, y) => x.path.localeCompare(y.path));
}
