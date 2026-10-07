/**
 * The origin a request's markup should name for this server's own files.
 *
 * The team hub, the player pages and the matchup pages are printed into
 * statchasers.com by the WordPress plugin, so a root-relative `/team-logos/…`
 * or `/news-image/…` in their markup would resolve against the wrong host.
 * They need absolute URLs, and the renderers that print those URLs are
 * thousands of lines that never see the request. Rather than thread an
 * origin through every signature, app.ts runs each request inside an
 * AsyncLocalStorage context carrying its public origin, and assetUrl() reads
 * it wherever a file path is printed. Outside a request (a warm-up, a test of
 * a pure function) it yields the path unchanged.
 *
 * Server-only: the browser bundles (src/client) must never import this. The
 * news tool, whose renderer runs in the browser too, keeps passing its origin
 * explicitly (lib/render.ts).
 */

import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<string>();

/** Run `fn` with `origin` as the asset origin for everything it (a)waits. */
export function runWithAssetOrigin<T>(origin: string, fn: () => T): T {
  return store.run(origin.replace(/\/+$/, ""), fn);
}

/** The current request's public origin, or "" outside a request. */
export function currentAssetOrigin(): string {
  return store.getStore() ?? "";
}

/** A root-relative path on this server, made absolute for the current request. */
export function assetUrl(path: string): string {
  return `${currentAssetOrigin()}${path}`;
}
