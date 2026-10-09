/**
 * Which of a player's section URLs are pages, and the one way to link to them.
 *
 * Five of the seven sections render for every indexed player. Two do not:
 * Injury needs a logged injury record and Outlook needs a written take or
 * drivers (kickers, mostly). A section URL the player has no section for does
 * not 404 - it 302s back to the profile (routes/player.ts), so nothing on the
 * site may link to it: a tab strip, a status pill or an FAQ answer pointing at
 * a page that only redirects is a broken link in every crawler's report, and
 * there were hundreds of them (2026-10-08).
 *
 * The strip was already built from the sections that rendered. Every other
 * link to a section goes through sectionHref() below, which answers null when
 * the page does not exist, so the caller drops the link rather than the
 * reader following it round in a circle. The tests are the same ones
 * renderPlayerPage() applies, so a link and its page can never disagree.
 *
 * A leaf module on purpose: the header, the Bio and News tabs and the FAQ
 * pools import it, and they are kept off lib/player-render.ts's import graph.
 */

import type { PlayerRenderOptions } from "../player-render";
import { hasOutlookTab } from "./outlook-2026";
import type { PlayerPageData } from "./player-data";

/** The sections a player can be without. Every other section always renders. */
export type OptionalSection = "injury" | "outlook";

type SectionSource = Pick<PlayerPageData, "player" | "injury" | "fantasyOutlook2026" | "outlookDrivers">;

/** Whether this player's page has the section: the same test the render applies. */
export function hasPlayerSection(data: SectionSource, section: OptionalSection): boolean {
  // Injury: renderInjury() returns nothing without a record. Outlook:
  // renderOutlook2026() decides, and hasOutlookTab() is that decision.
  return section === "injury" ? Boolean(data.injury) : hasOutlookTab(data);
}

/**
 * The section's own URL, or null when this player has no such page.
 *
 * Null rather than the profile's URL: a "See his injury history" sentence
 * that lands on the page the reader is already on is not a link worth
 * keeping, so the caller leaves the sentence out.
 */
export function sectionHref(
  data: SectionSource,
  options: Pick<PlayerRenderOptions, "playerPathPrefix" | "linkQuery">,
  section: OptionalSection,
): string | null {
  if (!hasPlayerSection(data, section)) return null;
  return `${options.playerPathPrefix ?? "/player/"}${data.player.slug}/${section}/${options.linkQuery ?? ""}`;
}
