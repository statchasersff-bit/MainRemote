/**
 * Which provider this deployment is using.
 *
 * The only place in the application that names a concrete provider class. Every
 * other file talks to XPostProvider, which is what makes "switch to the paid
 * API" a change to two environment variables rather than a change to the news
 * tool.
 *
 * Built once per process and rebuilt only when the configuration changes under
 * it, so the official provider's handle->id cache survives between polls.
 */

import { logger } from "../logger";
import { xProviderName } from "./config";
import { OfficialXApiProvider } from "./official-provider";
import { PublicXProvider } from "./public-provider";
import { RestXProvider } from "./rest-provider";
import type { XPostProvider } from "./types";

let cached: { key: string; provider: XPostProvider } | null = null;

/** Replace the provider — the seam the tests inject a fixture through. */
export function setXProvider(provider: XPostProvider | null): void {
  cached = provider ? { key: `override:${provider.name}`, provider } : null;
}

/**
 * The configured provider, or null when it cannot be built.
 *
 * Null rather than a throw: an official provider with no token is a
 * misconfiguration of an optional subsystem, and the correct response is that X
 * ingestion does not run while everything else does.
 */
export function getXProvider(): XPostProvider | null {
  const name = xProviderName();
  const token = process.env["X_API_BEARER_TOKEN"]?.trim() ?? "";
  // The URL is part of the key so that re-pointing X_API_URL at a different
  // vendor takes effect without a restart.
  const key = `${name}:${token ? "token" : "no-token"}:${process.env["X_API_URL"] ?? ""}`;

  if (cached?.key.startsWith("override:")) return cached.provider;
  if (cached?.key === key) return cached.provider;

  let provider: XPostProvider | null = null;

  switch (name) {
    case "official":
      if (!token) {
        logger.error(
          "[X INGEST] X_PROVIDER=official but X_API_BEARER_TOKEN is not set — X ingestion is idle",
        );
        return null;
      }
      provider = new OfficialXApiProvider(token);
      break;
    case "public":
      provider = new PublicXProvider();
      break;
    // Any commercial JSON API that serves X posts — see rest-provider.ts. This
    // is the route that actually keeps up with 37 reporters at a price that is
    // not the official API's.
    case "api":
    case "rest": {
      const rest = RestXProvider.fromEnv();
      if (!rest) return null;
      provider = rest;
      break;
    }
    default:
      logger.error({ provider: name }, "[X INGEST] unknown X_PROVIDER — X ingestion is idle");
      return null;
  }

  cached = { key, provider };
  return provider;
}
