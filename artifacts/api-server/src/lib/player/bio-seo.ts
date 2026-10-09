/**
 * The Bio section's SEO (mak's Bio spec, section 2.11; approved 2026-09-30):
 * the meta description and the Person node the WordPress plugin grafts into
 * Rank Math's graph as the ProfilePage's mainEntity.
 *
 * Everything comes from BioPageFacts, which reads approved fact records only,
 * so the schema never states what the page does not.
 */

import type { PlayerPageData } from "./player-data";
import type { BioPageFacts } from "./bio-tab-data";

const POSITION_WORDS: Record<string, string> = {
  QB: "quarterback",
  RB: "running back",
  WR: "wide receiver",
  TE: "tight end",
  K: "kicker",
  FB: "fullback",
};

const MAX_DESCRIPTION = 160;

function inchesLabel(n: number): string {
  return `${Math.floor(n / 12)}'${n % 12}"`;
}

/**
 * Spec 2.11's description: "{Name} is a {age}-year-old {team} {position}
 * ({height}, {weight} lb) from {college}, {draft phrase}. His career across
 * {n} stops and {t} teams." Kept at 160 characters by dropping the least
 * important part first; free agents and former players get their own frame.
 */
export function bioDescription(data: PlayerPageData, page: BioPageFacts): string | null {
  const name = data.player.name;
  const pos = POSITION_WORDS[data.player.position ?? ""] ?? null;
  const raw = page.raw;
  const age = page.quick.find((q) => q.label === "Age")?.value ?? null;
  const body = raw.heightIn && raw.weightLb ? `(${inchesLabel(raw.heightIn)}, ${raw.weightLb} lb)` : null;
  const college = raw.colleges.length ? raw.colleges[raw.colleges.length - 1] : null;
  const draftTeam = raw.draft?.team ? page.stops.find((s) => s.code === raw.draft?.team)?.team?.nickname ?? raw.draft.team : null;
  const draft = raw.draft
    ? `drafted ${draftTeam ? `by the ${draftTeam} ` : ""}in ${raw.draft.year} (Round ${raw.draft.round}, Pick ${raw.draft.pick})`
    : raw.undrafted
      ? `undrafted in ${raw.undrafted.year}`
      : null;
  const teams = new Set(page.stops.map((s) => s.code)).size;
  const stops = page.stops.length;
  const career = stops > 1 ? `His career across ${stops} stops and ${teams} ${teams === 1 ? "team" : "teams"}.` : null;
  if (!pos) return null;

  const tail = [college ? `from ${college}` : null, draft].filter(Boolean).join(", ");
  const frames: string[] = [];
  if (page.status === "active" && data.team) {
    const who = (team: string) => `${name} is a ${age ? `${age}-year-old ` : ""}${team} ${pos}${body ? ` ${body}` : ""}${tail ? ` ${tail}` : ""}.`;
    frames.push(
      [who(data.team.fullName), career].filter(Boolean).join(" "),
      [who(data.team.nickname), career].filter(Boolean).join(" "),
      who(data.team.fullName),
      who(data.team.nickname),
    );
  } else if (page.status === "free-agent") {
    const who = `${name} is a ${age ? `${age}-year-old ` : ""}free-agent ${pos}${body ? ` ${body}` : ""}${tail ? ` ${tail}` : ""}.`;
    frames.push([who, career].filter(Boolean).join(" "), who);
  } else {
    const first = page.stops[0]?.from;
    const last = page.stops[page.stops.length - 1]?.to;
    const span = first && last ? (first === last ? ` in ${first}` : ` from ${first} to ${last}`) : "";
    frames.push(
      `${name} is a former NFL ${pos}${tail ? ` ${tail}` : ""}, who played for ${teams} ${teams === 1 ? "team" : "teams"}${span}.`,
      `${name} is a former NFL ${pos}${tail ? ` ${tail}` : ""}.`,
    );
  }
  frames.push(`${name} ${pos} bio: age, height, college, draft and every NFL team.`);
  return frames.find((f) => f.length <= MAX_DESCRIPTION) ?? null;
}

/**
 * The Person node, without @id and url: the plugin knows the public profile
 * address and adds both. sameAs comes from the ID crosswalk (spec 2.11).
 */
export function bioPersonNode(data: PlayerPageData, page: BioPageFacts): Record<string, unknown> {
  const raw = page.raw;
  const pos = POSITION_WORDS[data.player.position ?? ""] ?? null;
  const node: Record<string, unknown> = { "@type": "Person", name: data.player.name };
  if (data.player.headshotUrl) node["image"] = data.player.headshotUrl;
  if (raw.birthDate) node["birthDate"] = raw.birthDate;
  if (raw.birthPlace) node["birthPlace"] = { "@type": "Place", name: raw.birthPlace };
  if (raw.heightIn) node["height"] = { "@type": "QuantitativeValue", value: raw.heightIn, unitCode: "INH" };
  if (raw.weightLb) node["weight"] = { "@type": "QuantitativeValue", value: raw.weightLb, unitCode: "LBR" };
  if (pos) node["jobTitle"] = pos.replace(/\b\w/g, (c) => c.toUpperCase());
  const alumni: Record<string, unknown>[] = [...raw.colleges]
    .reverse()
    .map((c) => ({ "@type": "CollegeOrUniversity", name: c }));
  if (raw.highSchool) alumni.push({ "@type": "HighSchool", name: raw.highSchool.replace(/\s*\([A-Z]{2}\)$/, "") });
  if (alumni.length) node["alumniOf"] = alumni;
  // award (approved by mak 2026-09-30): the same Super Bowl list the page shows.
  if (page.superBowls.length) {
    const awards = page.superBowls.map((b) => `Super Bowl ${b.name} champion (${b.team})`);
    node["award"] = awards.length === 1 ? awards[0] : awards;
  }
  const roles = page.stops.map((s) => ({
    "@type": "Role",
    ...(pos ? { roleName: node["jobTitle"] } : {}),
    startDate: String(s.from),
    ...(s.current ? {} : { endDate: String(s.to) }),
    memberOf: { "@type": "SportsTeam", name: s.name },
  }));
  if (roles.length) node["memberOf"] = roles;
  return node;
}
