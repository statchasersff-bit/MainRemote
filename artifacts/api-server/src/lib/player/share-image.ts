/**
 * The one image a player page is about: his headshot, as the StatChasers-
 * hosted, versioned WebP the hero draws (lib/headshot-html.ts), at the full
 * figure's largest size.
 *
 * Until 2026-10-24 no player page declared an image at all - no og:image,
 * no Person.image on the hub (it keyed on a headshotUrl the store rarely
 * carries; the hero itself draws from his id), no featured image on the
 * WordPress page - so Google chose one from the page, and the page is full
 * of club crests that rotate weekly: a Cardinal came up in the results
 * wearing a Browns helmet. This names the headshot everywhere a crawler
 * looks for a page's picture: og:image and twitter:image, Person.image,
 * primaryImageOfPage.
 *
 * Null for a player Sleeper has no photo of (the store says so), so no page
 * claims a picture it cannot show. A player the store has not met yet gets
 * the `latest` address, which redirects to his version once resolved - the
 * same thing the hero does on his first render.
 */

import { assetUrl } from "../asset-origin";
import { HEADSHOT_VARIANTS, imageKeyFor, imagePath, type HeadshotVariant } from "../image-urls";
import { enqueueImageResolve, imageVersionFor } from "../image-versions";
import type { PlayerPageData } from "./player-data";

/** The largest full-figure derivative a Sleeper thumb yields (its own size). */
const SHARE_VARIANT: HeadshotVariant = "f350";

export interface PlayerShareImage {
  /** Absolute, on the public asset origin. */
  url: string;
  width: number;
  height: number;
  alt: string;
}

export function playerShareImage(data: PlayerPageData): PlayerShareImage | null {
  const key = data.player.id || imageKeyFor(data.player.headshotUrl);
  if (!key) return null;
  const version = imageVersionFor(key);
  if (version === null) return null;
  if (version === undefined) void enqueueImageResolve(key);
  const shape = HEADSHOT_VARIANTS[SHARE_VARIANT];
  return {
    url: assetUrl(imagePath(key, version, SHARE_VARIANT)),
    width: shape.width,
    height: shape.height,
    alt: `${data.player.name} headshot`,
  };
}
