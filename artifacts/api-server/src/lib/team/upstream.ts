/**
 * Where the team hub's upstreams live.
 *
 * Overridable so tests/team.test.mjs can point them at a local replay of
 * recorded responses (tests/helpers/upstream-replay.mjs) and run with no
 * network: it used to call ESPN and Sleeper live and pass when they were down,
 * which left three sections untested whenever they were. Production never sets
 * these.
 */
const base = (name: string, fallback: string): string =>
  (process.env[name]?.trim() || fallback).replace(/\/+$/, "");

export const ESPN_SITE = base("SC_ESPN_SITE_BASE", "https://site.api.espn.com");
export const ESPN_WEB = base("SC_ESPN_WEB_BASE", "https://site.web.api.espn.com");
export const ESPN_CORE = base("SC_ESPN_CORE_BASE", "https://sports.core.api.espn.com");
export const SLEEPER = base("SC_SLEEPER_BASE", "https://api.sleeper.app");
