import type { Request } from "express";

/**
 * The public origin this server is reachable at.
 *
 * Behind a proxy (Replit terminates TLS and forwards x-forwarded-*) the raw
 * protocol/host are the internal ones, so prefer the forwarded values. Used for
 * the canonical URL, absolute OG URLs, and the generated embed snippets — all
 * of which are wrong if they point at the internal host.
 */
export function publicOrigin(req: Request): string {
  const proto = (
    req.get("x-forwarded-proto")?.split(",")[0] ??
    req.protocol ??
    "https"
  ).trim();
  const host = req.get("x-forwarded-host") ?? req.get("host") ?? "localhost";
  return `${proto}://${host}`;
}

/**
 * The canonical URL for a request: origin + path, with the query string and
 * fragment deliberately discarded.
 *
 * Tool state must never change the canonical. Sorting/filtering parameters are
 * a classic source of duplicate URLs, so `/?a=1` and `/?a=2` both canonicalise
 * to the bare page. `PUBLIC_CANONICAL_URL` overrides this entirely for
 * deployments that sit behind a different public URL.
 */
export function canonicalUrl(req: Request): string {
  const override = process.env["PUBLIC_CANONICAL_URL"]?.trim();
  if (override) return override;

  // req.path excludes the query string; normalise so "/index.html" and "/" —
  // the two ways to reach the app — agree on one canonical.
  const path = req.path === "/index.html" ? "/" : req.path;
  return `${publicOrigin(req)}${path}`;
}
