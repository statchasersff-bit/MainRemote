import { timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

/**
 * The one guard every write endpoint uses: news pull and push, the club sweep,
 * FPA ingest, and the X push, pull and account admin.
 *
 * Closed when INGEST_SECRET is unset. These routes used to treat "no secret" as
 * "this deployment is not exposed" and let anyone in, which with CORS open to
 * every origin meant any web page a visitor had open could spend our nflverse
 * bandwidth or put posts in the public feed. A server that has not been given a
 * secret now refuses with a 503 that says why, rather than a 401 that reads as
 * "you sent the wrong one".
 *
 * Returns true when the request may proceed; otherwise it has already answered.
 */
export function requireIngestSecret(req: Request, res: Response): boolean {
  const secret = process.env["INGEST_SECRET"];
  if (!secret) {
    res.status(503).json({
      ok: false,
      error: "writes are disabled: INGEST_SECRET is not configured on the server",
    });
    return false;
  }
  if (!secretMatches(req.get("x-ingest-secret"), secret)) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return false;
  }
  return true;
}

/** Constant-time comparison; a length mismatch is a plain no. */
export function secretMatches(given: string | undefined, secret: string): boolean {
  if (given === undefined) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
