/**
 * Turning CollegeFootballData.com rows into one player's college seasons.
 *
 * Pure: no network, no files. buildCollegeStats.mjs fetches and writes;
 * tests/college-stats.test.mjs feeds this recorded rows.
 *
 * The rows are CFBD's `/stats/player/season` shape, one row per stat:
 *
 *   { season, playerId, player, position, team, category, statType, stat }
 *
 * e.g. category "passing", statType "YDS", stat "3633". `/ppa/players/season`
 * rows join on `id` = `playerId`.
 *
 * Matching is by name, anchored on the school our own data records (bio_facts
 * or draft.json). A final season must be at that school. An earlier season may
 * be anywhere (transfers), but only when the name is unique among college
 * players at his position that year; otherwise it is left out rather than
 * guessed.
 */

/** Our spelling of a school, to CFBD's. Extend as the build reports misses. */
export const SCHOOL_ALIASES = {
  "north carolina state": "NC State",
  "nc state": "NC State",
  mississippi: "Ole Miss",
  "miami (fl)": "Miami",
  "miami (fla.)": "Miami",
  "miami fl": "Miami",
  "miami (oh)": "Miami (OH)",
  "miami (ohio)": "Miami (OH)",
  "southern california": "USC",
  "central florida": "UCF",
  "brigham young": "BYU",
  "southern methodist": "SMU",
  "texas christian": "TCU",
  "louisiana state": "LSU",
  pitt: "Pittsburgh",
  connecticut: "UConn",
  massachusetts: "UMass",
  "nevada-las vegas": "UNLV",
  "texas-san antonio": "UTSA",
  "texas-el paso": "UTEP",
  "alabama-birmingham": "UAB",
  hawaii: "Hawai'i",
  "san jose state": "San José State",
  fiu: "Florida International",
  "louisiana-lafayette": "Louisiana",
  "louisiana-monroe": "UL Monroe",
  "appalachian state": "App State",
  "southern mississippi": "Southern Miss",
};

/** "Ja'Marr Chase Jr." -> "jamarr chase". */
export function nameKey(name) {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'’`]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A school, compared the way CFBD spells it. */
export function schoolKey(school) {
  const raw = String(school ?? "").trim();
  const alias = SCHOOL_ALIASES[raw.toLowerCase()] ?? raw;
  return alias
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Position groups CFBD may file a player under. */
const GROUPS = {
  QB: ["QB"],
  RB: ["RB", "FB", "HB", "ATH"],
  WR: ["WR", "ATH"],
  TE: ["TE"],
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Stat rows -> one record per CFBD player per season:
 * { id, name, key, position, team, season, pass, rush, rec }.
 */
export function collapseRows(rows) {
  const byId = new Map();
  for (const r of rows ?? []) {
    const id = `${r.season}:${r.playerId}`;
    let p = byId.get(id);
    if (!p) {
      p = {
        id: String(r.playerId), name: r.player, key: nameKey(r.player),
        position: String(r.position ?? "").toUpperCase(), team: r.team, season: Number(r.season),
        pass: null, rush: null, rec: null,
      };
      byId.set(id, p);
    }
    const t = String(r.statType ?? "").toUpperCase();
    const v = num(r.stat);
    if (r.category === "passing") {
      p.pass ??= { cmp: 0, att: 0, yds: 0, td: 0, int: 0 };
      if (t === "COMPLETIONS") p.pass.cmp = v;
      else if (t === "ATT") p.pass.att = v;
      else if (t === "YDS") p.pass.yds = v;
      else if (t === "TD") p.pass.td = v;
      else if (t === "INT") p.pass.int = v;
    } else if (r.category === "rushing") {
      p.rush ??= { att: 0, yds: 0, td: 0, long: 0 };
      if (t === "CAR") p.rush.att = v;
      else if (t === "YDS") p.rush.yds = v;
      else if (t === "TD") p.rush.td = v;
      else if (t === "LONG") p.rush.long = v;
    } else if (r.category === "receiving") {
      p.rec ??= { rec: 0, yds: 0, td: 0, long: 0 };
      if (t === "REC") p.rec.rec = v;
      else if (t === "YDS") p.rec.yds = v;
      else if (t === "TD") p.rec.td = v;
      else if (t === "LONG") p.rec.long = v;
    }
  }
  return [...byId.values()];
}

/**
 * One NFL player's college seasons, oldest first, or null when his final
 * season cannot be found at his school.
 *
 * `players` is collapseRows() output across every season fetched.
 */
export function matchPlayer({ name, position, school, finalSeason }, players) {
  const key = nameKey(name);
  const group = GROUPS[position] ?? [position];
  const home = schoolKey(school);
  const mine = players.filter((p) => p.key === key && (group.includes(p.position) || !p.position));

  const final = mine.filter((p) => p.season === finalSeason && schoolKey(p.team) === home);
  if (final.length !== 1) return null;

  const seasons = [final[0]];
  for (let year = finalSeason - 1; year >= finalSeason - 6; year -= 1) {
    const that = mine.filter((p) => p.season === year);
    const sameSchool = that.filter((p) => schoolKey(p.team) === home);
    // Same school is unambiguous; a transfer year is taken only when the name
    // is the only one at his position in the country that year.
    const pick = sameSchool.length === 1 ? sameSchool[0] : sameSchool.length === 0 && that.length === 1 ? that[0] : null;
    if (pick) seasons.push(pick);
  }
  return seasons
    .sort((a, b) => a.season - b.season)
    .map(({ season, team, pass, rush, rec, id }) => ({ season, school: team, cfbdId: id, pass, rush, rec }));
}

/* ------------------------------------------------------------ ranking */

/**
 * The final-season metrics, and where each ranks among the qualified college
 * players at his position that year. Descriptive metrics carry no rank.
 */
export const METRICS = {
  QB: {
    qualifies: (p) => (p.pass?.att ?? 0) >= 150,
    pool: "passers with 150+ attempts",
    list: [
      { key: "cmp", label: "Completion %", of: (p) => (p.pass?.att ? (p.pass.cmp / p.pass.att) * 100 : null), fmt: "pct" },
      { key: "ypa", label: "Yards per attempt", of: (p) => (p.pass?.att ? p.pass.yds / p.pass.att : null), fmt: "1" },
      { key: "ptd", label: "Passing TDs", of: (p) => p.pass?.td ?? null, fmt: "int" },
      { key: "int", label: "Interceptions", of: (p) => p.pass?.int ?? null, fmt: "int", lowerIsBetter: true },
      { key: "ryd", label: "Rushing yards", of: (p) => p.rush?.yds ?? null, fmt: "int" },
      { key: "ppa", label: "EPA per play (PPA)", of: (p) => p.ppa ?? null, fmt: "signed" },
    ],
  },
  RB: {
    qualifies: (p) => (p.rush?.att ?? 0) >= 100,
    pool: "backs with 100+ carries",
    list: [
      { key: "car", label: "Carries", of: (p) => p.rush?.att ?? null, fmt: "int" },
      { key: "ypc", label: "Yards per carry", of: (p) => (p.rush?.att ? p.rush.yds / p.rush.att : null), fmt: "1" },
      { key: "rtd", label: "Rushing TDs", of: (p) => p.rush?.td ?? null, fmt: "int" },
      { key: "rec", label: "Receptions", of: (p) => p.rec?.rec ?? null, fmt: "int" },
      { key: "recyd", label: "Receiving yards", of: (p) => p.rec?.yds ?? null, fmt: "int" },
      { key: "ppa", label: "EPA per play (PPA)", of: (p) => p.ppa ?? null, fmt: "signed" },
    ],
  },
  WR: {
    qualifies: (p) => (p.rec?.rec ?? 0) >= 30,
    pool: "receivers with 30+ catches",
    list: [
      { key: "rec", label: "Receptions", of: (p) => p.rec?.rec ?? null, fmt: "int" },
      { key: "recyd", label: "Receiving yards", of: (p) => p.rec?.yds ?? null, fmt: "int" },
      { key: "ypr", label: "Yards per reception", of: (p) => (p.rec?.rec ? p.rec.yds / p.rec.rec : null), fmt: "1" },
      { key: "retd", label: "Receiving TDs", of: (p) => p.rec?.td ?? null, fmt: "int" },
      { key: "long", label: "Longest reception", of: (p) => p.rec?.long ?? null, fmt: "int", descriptive: true },
      { key: "ppa", label: "EPA per play (PPA)", of: (p) => p.ppa ?? null, fmt: "signed" },
    ],
  },
};
METRICS.TE = { ...METRICS.WR, pool: "tight ends with 30+ catches", qualifies: (p) => (p.rec?.rec ?? 0) >= 30 };

/**
 * Each metric's value, rank and percentile for `me` among `pool` (the
 * qualified players at his position group that season, him included).
 */
export function rankFinal(me, pool, position) {
  const def = METRICS[position];
  if (!def) return {};
  const qualified = def.qualifies(me);
  const out = {};
  for (const m of def.list) {
    const v = m.of(me);
    if (v === null || v === undefined) continue;
    const entry = { value: v };
    if (qualified && !m.descriptive) {
      // Compared with everyone but himself: alone at the top is the 100th
      // percentile, not the 0th.
      const others = pool
        .filter((p) => !(p.id === me.id && p.season === me.season))
        .map((p) => m.of(p))
        .filter((x) => x !== null && x !== undefined);
      const better = others.filter((x) => (m.lowerIsBetter ? x < v : x > v)).length;
      const worse = others.filter((x) => (m.lowerIsBetter ? x > v : x < v)).length;
      entry.rank = better + 1;
      entry.of = others.length + 1;
      entry.pct = others.length ? Math.round((worse / others.length) * 100) : 100;
    }
    out[m.key] = entry;
  }
  return out;
}

/** The qualified players at a position group in one season, for rankFinal(). */
export function qualifiedPool(players, season, position) {
  const def = METRICS[position];
  const group = GROUPS[position] ?? [position];
  return players.filter((p) => p.season === season && group.includes(p.position) && def.qualifies(p));
}
