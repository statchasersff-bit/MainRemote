/**
 * The key WordPress carries, and the pages that need it.
 *
 * Everything this app renders is meant to reach readers through
 * statchasers.com: the WordPress plugin fetches each fragment server-side and
 * prints it into the page, behind Cloudflare. Nothing stopped anyone from
 * skipping WordPress and pulling the same fragments, and the whole player,
 * team, schedule and stats corpus, straight from this origin. With SC_EMBED_KEY
 * set, the data surfaces below answer only a request that carries it:
 *
 *   - the X-StatChasers-Key header, which the plugin adds to every request it
 *     makes to this origin (statchasers-proxy.php), or
 *   - a cookie set by visiting any protected URL once with ?key=<the key>, so a
 *     person can still look at the standalone pages in a browser.
 *
 * Unset, everything is open: development, the tests and the Replit preview run
 * without it. Assets (CSS, JS, images), /embed.js, the health and ingest
 * routes (which have their own secret), the CSV and calendar downloads, and the
 * web-vitals beacon stay public: a reader's browser loads those directly.
 *
 * The four widgets that used to fetch fragments from this origin in the
 * reader's browser (Player Stats, FPA, RB Handcuffs cards, news refresh) are
 * pointed at the WordPress proxy instead once SC_BROWSER_PROXY is set; see
 * browserEndpoint().
 */

import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { publicOrigin } from "./request";

export const KEY_HEADER = "x-statchasers-key";
const COOKIE = "sc_embed";
const COOKIE_DAYS = 30;

function key(): string {
  return (process.env["SC_EMBED_KEY"] ?? "").trim();
}

/** Constant-time string comparison, so the key cannot be guessed a byte at a time. */
function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** What the cookie holds: a digest of the key, never the key itself. */
function cookieValue(secret: string): string {
  return crypto.createHash("sha256").update(`sc-embed:${secret}`).digest("hex");
}

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

/**
 * The protected surfaces: every fragment, the news feed, and the standalone
 * pages. Matched by path so a static file or a route not listed here is never
 * caught by accident.
 */
export function isProtectedPath(path: string): boolean {
  // Not "/": the deployment's health check requests it, and a 403 there would
  // fail a deploy. It is the news page, the least of what this origin serves.
  if (path.startsWith("/embed/")) return true;
  if (path === "/api/news") return true;
  if (path === "/player" || path.startsWith("/player/")) return true;
  if (path === "/team" || path.startsWith("/team/")) return true;
  if (path.startsWith("/nfl/")) return true;
  if (path === "/schedule" || /^\/schedule\/week-/.test(path)) return true;
  if (path === "/fpa") return true;
  if (path === "/player-stats" || path.startsWith("/player-stats/")) return true;
  if (path === "/rb-handcuff-rankings" || path.startsWith("/rb-handcuff-rankings/")) return true;
  return false;
}

/** Does this request carry the key (header or unlocked cookie)? True when no key is configured. */
export function hasEmbedKey(req: Request): boolean {
  const secret = key();
  if (!secret) return true;
  const header = req.get(KEY_HEADER);
  if (header && same(header, secret)) return true;
  const cookie = readCookie(req, COOKIE);
  return cookie !== null && same(cookie, cookieValue(secret));
}

export function requireEmbedKey(req: Request, res: Response, next: NextFunction): void {
  const secret = key();
  const read = req.method === "GET" || req.method === "HEAD";
  if (!secret || !read || !isProtectedPath(req.path)) {
    next();
    return;
  }

  // A person unlocking the standalone pages in a browser: ?key=<key> once,
  // then a cookie, and the URL without the key in it.
  const offered = typeof req.query["key"] === "string" ? req.query["key"] : null;
  if (offered !== null && same(offered, secret)) {
    const url = new URL(req.originalUrl, "http://x");
    url.searchParams.delete("key");
    res.cookie(COOKIE, cookieValue(secret), {
      httpOnly: true,
      secure: req.secure || req.get("x-forwarded-proto") === "https",
      sameSite: "lax",
      maxAge: COOKIE_DAYS * 24 * 60 * 60 * 1000,
      path: "/",
    });
    res.set("Cache-Control", "no-store").redirect(302, `${url.pathname}${url.search}`);
    return;
  }

  if (hasEmbedKey(req)) {
    // A shared cache must never hand a keyed response to a request without it.
    res.vary("X-StatChasers-Key").vary("Cookie");
    next();
    return;
  }

  res
    .status(403)
    .set("Cache-Control", "no-store")
    .set("X-Robots-Tag", "noindex")
    .type("text/plain")
    .send("This content is published on statchasers.com.\n");
}

/**
 * The address a reader's BROWSER should fetch a fragment from.
 *
 * With SC_BROWSER_PROXY set (the plugin's proxy, e.g.
 * https://statchasers.com/wp-json/statchasers/v1/p), the widgets call
 * WordPress, which adds the key and forwards the request here. Without it they
 * call this origin directly, as they always did.
 */
export function browserEndpoint(req: Request, path: string): string {
  const proxy = (process.env["SC_BROWSER_PROXY"] ?? "").trim().replace(/\/+$/, "");
  if (/^https:\/\/[^\s"'<>]+$/.test(proxy)) return `${proxy}${path}`;
  return `${publicOrigin(req)}${path}`;
}
