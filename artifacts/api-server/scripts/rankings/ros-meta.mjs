/**
 * The rest-of-season board's meta from one date (2026-11-20): the date the
 * page prints ("November 24, 2026") and the instant the player hubs' seven-day
 * stale guard reads (midnight US Eastern that day, with its real offset) come
 * from one input, so they can never disagree. Used by check-ros.mjs --install.
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * "-05:00" or "-04:00": the Eastern offset at midnight that date. Probed at
 * 04:30 UTC, half an hour after Eastern midnight in either offset, so the
 * clock-change days read right (Nov 1 2026 midnight is still EDT).
 */
export function easternOffset(ymd) {
  const probe = new Date(`${ymd}T04:30:00Z`);
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" })
    .formatToParts(probe)
    .find((p) => p.type === "timeZoneName")?.value ?? "GMT-5";
  const h = Number(name.replace("GMT", "")) || -5;
  return `${h < 0 ? "-" : "+"}${String(Math.abs(h)).padStart(2, "0")}:00`;
}

export function metaFor(ymd, seasonYear) {
  const [y, m, d] = ymd.split("-").map(Number);
  return {
    season: seasonYear,
    scoring: "PPR",
    updatedAt: `${MONTHS[m - 1]} ${d}, ${y}`,
    updatedAtIso: `${ymd}T00:00:00${easternOffset(ymd)}`,
  };
}
