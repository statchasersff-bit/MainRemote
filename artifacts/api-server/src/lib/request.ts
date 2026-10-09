import type { Request } from "express";

/**
 * The one public name for the newsfeed: canonical URLs, og:url, the embed
 * snippets and every absolute /news-image/ and /team-logos/ URL name it.
 * The deployment answers on its *.replit.app address as well, and the
 * WordPress plugin may fetch fragments over either, but markup printed into
 * statchasers.com must not depend on which one carried the request - a
 * fragment fetched over the Replit host used to come back with Replit image
 * URLs. The image and crest routes live on this host; they are not to be
 * moved onto api.statchasers.com.
 */
export const CANONICAL_PUBLIC_ORIGIN = "https://news.statchasers.com";

const ORIGIN = /^https?:\/\/[a-z0-9.-]+(?::\d+)?$/i;

/**
 * The origin fixed by configuration, or null to derive it from the request.
 *
 * `PUBLIC_ORIGIN` names another one (a staging deployment behind its own
 * name) or, as the literal `request`, switches the pin off. Unset, a
 * production process pins itself to the canonical name and everything else
 * (the workspace preview, the test suite) follows the request, so a local
 * page loads its images from the local server.
 */
export function configuredPublicOrigin(): string | null {
  const raw = (process.env["PUBLIC_ORIGIN"] ?? "").trim().replace(/\/+$/, "");
  if (raw.toLowerCase() === "request") return null;
  if (ORIGIN.test(raw)) return raw;
  return process.env["NODE_ENV"] === "production" ? CANONICAL_PUBLIC_ORIGIN : null;
}

/**
 * The public origin this server is reachable at.
 *
 * Pinned by configuredPublicOrigin() where that applies. Otherwise, behind a
 * proxy (Replit terminates TLS and forwards x-forwarded-*) the raw
 * protocol/host are the internal ones, so prefer the forwarded values. Used for
 * the canonical URL, absolute OG URLs, and the generated embed snippets - all
 * of which are wrong if they point at the internal host.
 */
export function publicOrigin(req: Request): string {
  const configured = configuredPublicOrigin();
  if (configured) return configured;
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto =
    forwardedProto === "http" || forwardedProto === "https"
      ? forwardedProto
      : (req.protocol ?? "https");
  const forwarded = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  // A forwarded host is only believed when it is one of ours. Anybody can send
  // the header, and it goes into the canonical and og:url: a request carrying
  // `X-Forwarded-Host: evil.example` got `<link rel="canonical"
  // href="http://evil.example/…">` back, which a shared cache would then serve
  // to everyone. The Host header needs no such check - a request only reaches
  // this app through a router that matched it.
  const host =
    (forwarded && trustedHost(forwarded) ? forwarded : undefined) ??
    req.get("host") ??
    "localhost";
  return `${proto}://${host}`;
}

/**
 * Hosts this app is published at. `PUBLIC_HOSTS` (comma-separated, `*.` for
 * subdomains) replaces the default list for a deployment behind another name.
 *
 * The default names this Repl's own domains exactly, from `REPLIT_DOMAINS`, and
 * never `*.replit.app` or `*.replit.dev`: anyone can register a name under
 * those, and a forwarded host we believe ends up in cached markup.
 */
function trustedHost(host: string): boolean {
  const bare = host.toLowerCase().replace(/:\d+$/, "");
  const patterns = (
    process.env["PUBLIC_HOSTS"]?.trim() ||
    [
      process.env["REPLIT_DOMAINS"] ?? "",
      "statchasers.com,*.statchasers.com,localhost,127.0.0.1",
    ].join(",")
  )
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  return patterns.some((p) =>
    p.startsWith("*.") ? bare.endsWith(p.slice(1)) : bare === p,
  );
}

/**
 * The canonical URL for a request: origin + path, with the query string and
 * fragment deliberately discarded.
 *
 * Tool state must never change the canonical. Sorting/filtering parameters are
 * a classic source of duplicate URLs, so `/?a=1` and `/?a=2` both canonicalize
 * to the bare page. `PUBLIC_CANONICAL_URL` overrides this entirely for
 * deployments that sit behind a different public URL.
 */
export function canonicalUrl(req: Request): string {
  const override = process.env["PUBLIC_CANONICAL_URL"]?.trim();
  if (override) return override;

  // req.path excludes the query string; normalize so "/index.html" and "/" -
  // the two ways to reach the app - agree on one canonical.
  // Lower-cased: routing matches /Schedule and /player/Lamar-Jackson too, and
  // each used to name itself as its own canonical.
  const path = req.path === "/index.html" ? "/" : req.path.toLowerCase();
  return `${publicOrigin(req)}${path}`;
}
