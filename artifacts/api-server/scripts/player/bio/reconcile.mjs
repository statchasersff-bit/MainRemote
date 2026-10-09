/**
 * Stage 3 of the Bio pipeline: candidate values from several sources become
 * one fact record per field (Bio spec, Part 5, Stage 3).
 *
 * Pure. The builder (buildBioSources.mjs) collects what each source says; this
 * decides what gets published:
 *
 *   1. structured beats extracted (nothing is extracted yet, so every
 *      candidate here is structured);
 *   2. two independent sources agreeing -> approved, confidence 0.95. For a
 *      field reconciled with `majority` (birth dates), two sources agreeing
 *      also outvote the one ranked first;
 *   3. structured sources disagreeing with no majority -> the source ranked
 *      first for the field wins, the rest are kept as `superseded`, and the
 *      conflict is logged;
 *   4. one source alone -> approved at 0.9. Structured data from a named file
 *      is the spec's bar for publication; a second source only raises the
 *      confidence.
 */

/** A value as one source reported it. */
export function candidate(source, value, extra = {}) {
  return { source, value, ...extra };
}

/**
 * One field's candidates -> its records (the winner first) and a conflict, if any.
 *
 * `same(a, b)` decides agreement; the default compares JSON, which is right
 * for dates and numbers and wrong for names, so name fields pass their own.
 */
export function reconcileField(field, candidates, { same = (a, b) => JSON.stringify(a) === JSON.stringify(b), majority = false } = {}) {
  const present = candidates.filter((c) => c && c.value !== null && c.value !== undefined && c.value !== "");
  if (present.length === 0) return { records: [], conflict: null };

  // Group by agreement. The first source's group wins, unless the field is
  // settled by majority: then the largest group does, ties to the higher rank.
  const groups = [];
  for (const c of present) {
    const group = groups.find((g) => same(g[0].value, c.value));
    if (group) group.push(c);
    else groups.push([c]);
  }
  const best = majority ? groups.reduce((a, b) => (b.length > a.length ? b : a)) : groups[0];
  const [winner, ...agreeing] = best;
  const disagreeing = present.filter((c) => !best.includes(c));

  const records = [
    {
      field,
      value: winner.value,
      source: winner.source,
      ...(winner.url ? { url: winner.url } : {}),
      method: "structured",
      confidence: agreeing.length > 0 ? 0.95 : 0.9,
      status: "approved",
      ...(agreeing.length > 0 ? { agrees: agreeing.map((c) => c.source) } : {}),
    },
    ...disagreeing.map((c) => ({
      field,
      value: c.value,
      source: c.source,
      ...(c.url ? { url: c.url } : {}),
      method: "structured",
      confidence: 0.5,
      status: "superseded",
    })),
  ];

  const conflict = disagreeing.length
    ? { field, kept: { source: winner.source, value: winner.value }, dropped: disagreeing.map((c) => ({ source: c.source, value: c.value })) }
    : null;
  return { records, conflict };
}

/**
 * "Plant (FL)" and "Henry B. Plant High School" name the same school: every
 * word of the shorter name is in the longer one, once the state tag and the
 * generic words are gone.
 */
export function sameSchool(a, b) {
  const words = (s) =>
    String(s)
      .toLowerCase()
      .replace(/\([a-z]{2}\)/g, "")
      .replace(/\b(high school|senior high|high|school|academy|the|of)\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(" ")
      .filter((w) => w.length > 1);
  const [short, long] = [words(a), words(b)].sort((x, y) => x.length - y.length);
  return short.length > 0 && short.every((w) => long.includes(w));
}

/** Names one school goes by in different feeds. Keys and values are normalized. */
const COLLEGE_ALIASES = {
  usc: "southern california",
  "ole miss": "mississippi",
  "miami fl": "miami",
  "miami ohio": "miami oh",
  lsu: "louisiana state",
  tcu: "texas christian",
  smu: "southern methodist",
  byu: "brigham young",
  ucf: "central florida",
  utep: "texas el paso",
  utsa: "texas san antonio",
  unlv: "nevada las vegas",
  "pitt": "pittsburgh",
  // Wikipedia's short names.
  fiu: "florida international",
  fau: "florida atlantic",
  "southern miss": "southern mississippi",
  uconn: "connecticut",
  umass: "massachusetts",
  "ut martin": "tennessee martin",
  utc: "tennessee chattanooga",
  "ul monroe": "louisiana monroe",
  "louisiana lafayette": "louisiana",
  "app state": "appalachian state",
  "nc state": "north carolina state",
  uab: "alabama birmingham",
  ucla: "california los angeles",
  "cal": "california",
  "middle tennessee state": "middle tennessee",
  "west florida": "west florida",
  "sam houston state": "sam houston",
};

/** "N.C. State", "North Carolina State" and "North Carolina St." are one school. */
export function sameCollege(a, b) {
  const norm = (s) => {
    const n = String(s)
      .toLowerCase()
      .replace(/\bn\.?\s?c\.?(?=\s|$)/g, "north carolina")
      .replace(/\bst\.?$/g, "state")
      .replace(/\buniv(ersity)?\.?(?=\s|$)|\bof\b|\bthe\b|\bcollege\b/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    return COLLEGE_ALIASES[n] ?? n;
  };
  return norm(a) !== "" && norm(a) === norm(b);
}

/** Every fact for a player, plus the conflicts found while reconciling. */
export function reconcilePlayer(fields) {
  const facts = [];
  const conflicts = [];
  for (const [field, { candidates, same, majority }] of Object.entries(fields)) {
    const { records, conflict } = reconcileField(field, candidates, { ...(same ? { same } : {}), majority: Boolean(majority) });
    facts.push(...records);
    if (conflict) conflicts.push(conflict);
  }
  return { facts, conflicts };
}
