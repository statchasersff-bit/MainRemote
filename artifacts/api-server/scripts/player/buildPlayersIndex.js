import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DATA_DIR as SC_DATA_DIR } from "./paths.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VALID_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

/**
 * The position this player occupies in a fantasy lineup.
 *
 * Sleeper's `position` is the primary football position, which for a two-way
 * player is not necessarily the fantasy one: Travis Hunter is carried as a DB
 * with `fantasy_positions: ['DB','WR']`, and filtering on `position` alone
 * dropped him out of the index entirely - no player page, no link from any
 * ranking or outlook that names him. `fantasy_positions` is the field that
 * answers the question this index is actually asking, so it is the fallback
 * whenever the primary position is not one we carry.
 */
function fantasyPosition(p) {
  if (VALID_POSITIONS.includes(p.position)) return p.position;
  const alt = (p.fantasy_positions || []).find((pos) => VALID_POSITIONS.includes(pos));
  return alt || null;
}

const TEAM_ALIAS_MAP = {
  JAC: 'JAX',
  WSH: 'WAS',
  OAK: 'LV',
  STL: 'LAR',
  SD: 'LAC',
  LA: 'LAR',
};

const CANONICAL_TEAMS = [
  'ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE',
  'DAL','DEN','DET','GB','HOU','IND','JAX','KC',
  'LAC','LAR','LV','MIA','MIN','NE','NO','NYG',
  'NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS',
];

const TEAM_FULL_NAMES = {
  ARI: 'Arizona Cardinals', ATL: 'Atlanta Falcons', BAL: 'Baltimore Ravens',
  BUF: 'Buffalo Bills', CAR: 'Carolina Panthers', CHI: 'Chicago Bears',
  CIN: 'Cincinnati Bengals', CLE: 'Cleveland Browns', DAL: 'Dallas Cowboys',
  DEN: 'Denver Broncos', DET: 'Detroit Lions', GB: 'Green Bay Packers',
  HOU: 'Houston Texans', IND: 'Indianapolis Colts', JAX: 'Jacksonville Jaguars',
  KC: 'Kansas City Chiefs', LAC: 'Los Angeles Chargers', LAR: 'Los Angeles Rams',
  LV: 'Las Vegas Raiders', MIA: 'Miami Dolphins', MIN: 'Minnesota Vikings',
  NE: 'New England Patriots', NO: 'New Orleans Saints', NYG: 'New York Giants',
  NYJ: 'New York Jets', PHI: 'Philadelphia Eagles', PIT: 'Pittsburgh Steelers',
  SEA: 'Seattle Seahawks', SF: 'San Francisco 49ers', TB: 'Tampa Bay Buccaneers',
  TEN: 'Tennessee Titans', WAS: 'Washington Commanders',
};

function normalizeTeam(abbr) {
  if (!abbr) return 'FA';
  const upper = abbr.toUpperCase().trim();
  return TEAM_ALIAS_MAP[upper] || upper;
}

function normalizeName(name) {
  if (!name) return '';
  return name
    .replace(/[‘’‚‛`´]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/–|—/g, '-')
    .trim();
}

function buildSlug(fullName) {
  if (!fullName) return '';
  return fullName
    .toLowerCase()
    .replace(/[''`´‘’‚‛]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/* ------------------------------------------------------------------- slugs */

/**
 * The slug ledger: which player currently publishes at which address, and what
 * they published at before.
 *
 * WHY THIS FILE EXISTS. A slug is a URL, and these URLs are the whole point of
 * the player pages - they are what WordPress mounts and what Google indexes.
 * Two things were wrong without a ledger:
 *
 *   1. A name shared by two players was resolved by whoever Sleeper happened to
 *      list first, which for an integer-keyed object means the lower id. That
 *      handed `kenneth-walker` to a retired free-agent receiver and pushed the
 *      Kansas City running back to `kenneth-walker-8151`. Same story for Frank
 *      Gore Jr., Kyle Williams and Antonio Williams.
 *   2. Even with a better rule, the rule alone is not enough: it reads the
 *      roster, and the roster moves. A back who signs somewhere in March would
 *      take the bare slug from whoever held it in February, and a page that had
 *      been indexed for a season would change address for no reason.
 *
 * So the rule decides only the addresses nobody holds yet, and the ledger holds
 * every address already in use. Once a player is published at a slug it is his
 * until his name changes.
 */
const SLUG_LEDGER_VERSION = 1;

function readJsonSafe(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * How strong a player's claim on the bare slug is. Lower sorts first.
 *
 * Rostered beats free agent, active beats inactive, and a starter beats a
 * backup - in that order, because that is the order in which they predict who
 * the person typing the name is looking for. Nobody searches for the 2019
 * practice-squad receiver who shares a name with a starting running back.
 *
 * Years of experience breaks a tie between two players with equal standing, and
 * the Sleeper id breaks the last one so the result never depends on the order
 * the API returned.
 */
function claimRank(row) {
  const id = Number(row.id);
  return [
    row.team === 'FA' ? 1 : 0,
    row.status === 'Active' ? 0 : 1,
    row.depth_chart_order ?? 99,
    -(row.years_exp ?? 0),
    Number.isFinite(id) ? id : Number.MAX_SAFE_INTEGER,
  ];
}

function byClaim(a, b) {
  const ra = claimRank(a);
  const rb = claimRank(b);
  for (let i = 0; i < ra.length; i += 1) {
    if (ra[i] !== rb[i]) return ra[i] - rb[i];
  }
  return 0;
}

/**
 * Give every row its slug, and say which ones moved.
 *
 * `held` is id -> the slug the LEDGER assigned that player, and it is the only
 * thing that freezes an address. `prior` is id -> whatever he last published
 * at, ledger or not, and it is only used to report the moves. The two differ
 * exactly once: on the first run there is no ledger, so nothing is frozen and
 * every base is decided on merit - which is what corrects the assignments the
 * old first-come rule made. Afterwards `held` is populated and the addresses
 * stop moving.
 *
 * Within one base the holder keeps it; everyone else takes `<base>-<id>`,
 * which is deterministic and needs no arbitration. Only a base nobody holds is
 * decided by claimRank().
 *
 * @param {Array<object>} rows  Player rows, each carrying a `base`.
 * @param {Record<string,string>} held   Frozen addresses, from the ledger.
 * @param {Record<string,string>} prior  Last published addresses, for the moves.
 * @return {Array<{id:string,name:string,from:string,to:string}>} Moves.
 */
function assignSlugs(rows, held, prior) {
  const groups = new Map();

  for (const row of rows) {
    const group = groups.get(row.base);
    if (group) {
      group.push(row);
    } else {
      groups.set(row.base, [row]);
    }
  }

  for (const [base, group] of groups) {
    let holder = group.find((row) => held[row.id] === base);
    if (!holder) {
      holder = group.slice().sort(byClaim)[0];
    }
    for (const row of group) {
      row.slug = row === holder ? base : `${base}-${row.id}`;
    }
  }

  const moves = [];
  for (const row of rows) {
    const from = prior[row.id];
    if (from && from !== row.slug) {
      moves.push({ id: row.id, name: row.name, from, to: row.slug });
    }
  }
  return moves;
}

/**
 * The ledger to write, given what was just assigned and what was there before.
 *
 * `previous` is the redirect list: the addresses this player used to answer at.
 * It accumulates, because a page indexed two seasons ago is still linked from
 * somewhere. The one thing it must never contain is a slug some OTHER player
 * now publishes at - that would 301 a live page onto a different man - so the
 * last pass strips any address that is currently in use.
 */
function buildLedger(players, prior, previousLedger, moves) {
  const live = new Set(players.map((row) => row.slug));
  const entries = {};

  for (const row of players) {
    const previous = new Set(previousLedger?.players?.[row.id]?.previous ?? []);
    const was = prior[row.id];
    if (was && was !== row.slug) {
      previous.add(was);
    }
    for (const slug of [...previous]) {
      if (live.has(slug)) previous.delete(slug);
    }

    entries[row.id] = previous.size
      ? { slug: row.slug, previous: [...previous].sort() }
      : { slug: row.slug };
  }

  return {
    version: SLUG_LEDGER_VERSION,
    generated_at: new Date().toISOString(),
    // What THIS run changed, which is not the same list as the redirects: a
    // swap ("A gives up the bare slug, B takes it") leaves A with nothing to
    // redirect and still moves A's data. migrateSlugs.js reads this to carry
    // the slug-keyed files across; the redirects read `previous`.
    moves,
    players: entries,
  };
}

async function main() {
  const outDir = SC_DATA_DIR;
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'players.json');
  const ledgerPath = path.join(outDir, 'player_slugs.json');

  const reassign = process.argv.includes('--reassign');
  const previousLedger = readJsonSafe(ledgerPath, null);

  // A move list that has not been spent means the last build renamed somebody
  // and migrateSlugs.js never carried his bio, draft row and outlook across.
  // Rebuilding on top of that would overwrite the list with this run's, and the
  // only record of what still needs moving would be gone - leaving those
  // profiles permanently missing half their sections, with nothing on disk to
  // say why. Cheaper to stop.
  if (Array.isArray(previousLedger?.moves) && previousLedger.moves.length) {
    console.error(
      `The last build moved ${previousLedger.moves.length} slug(s) and the data ` +
        'files have not been migrated yet:',
    );
    for (const move of previousLedger.moves) {
      console.error(`    ${move.from} -> ${move.to}`);
    }
    console.error('Run: node scripts/player/migrateSlugs.js');
    console.error('Then run this again.');
    process.exit(1);
  }

  console.log('Fetching NFL players from Sleeper API...');
  const res = await fetch('https://api.sleeper.app/v1/players/nfl');
  if (!res.ok) throw new Error(`Sleeper API error: ${res.status}`);

  const playersMap = await res.json();
  console.log(`Received ${Object.keys(playersMap).length} players from API`);

  // Two different questions, and they only have the same answer after the
  // first run. `held` is what may not move; `prior` is what was last published,
  // which is what the redirects are built from.
  //
  // `--reassign` drops the freeze for one run and re-decides every shared name
  // on merit. It is how a bad address gets corrected once the ledger exists,
  // and it is deliberately not the default: it changes live URLs.
  const prior = {};
  const held = {};

  if (previousLedger && previousLedger.players) {
    for (const [id, entry] of Object.entries(previousLedger.players)) {
      if (entry && entry.slug) {
        prior[id] = entry.slug;
        if (!reassign) held[id] = entry.slug;
      }
    }
    if (reassign) {
      console.log('--reassign: ignoring the ledger\'s claims and re-deciding every shared name.');
    }
  } else {
    // No ledger yet, so nothing is frozen and every shared name is decided on
    // merit. The slugs on disk still matter - they are the addresses currently
    // indexed, and they seed the first redirect list.
    for (const row of readJsonSafe(outPath, [])) {
      if (row && row.id && row.slug) prior[row.id] = row.slug;
    }
    console.log('No slug ledger found; deciding every shared name on merit and seeding the redirects from players.json.');
  }

  const players = [];
  const teamsWithDef = new Set();

  for (const [playerId, p] of Object.entries(playersMap)) {
    if (!p.full_name && p.position !== 'DEF') continue;
    const position = fantasyPosition(p);
    if (!position) continue;

    const rawName = position === 'DEF' ? (p.full_name || `${p.first_name} ${p.last_name}`) : p.full_name;
    const name = normalizeName(rawName);
    const base = buildSlug(name);
    if (!base) continue;

    const team = normalizeTeam(p.team);

    if (position === 'DEF' && team !== 'FA') {
      teamsWithDef.add(team);
    }

    players.push({
      id: playerId,
      name,
      // Replaced by assignSlugs() below, which needs every row in hand before
      // it can say who gets the bare address.
      base,
      slug: '',
      position,
      team,
      status: p.status || null,
      injury_status: p.injury_status || null,
      age: p.age || null,
      height: p.height || null,
      weight: p.weight || null,
      number: p.number ?? null,
      depth_chart_order: p.depth_chart_order ?? null,
      years_exp: p.years_exp ?? null,
    });
  }

  const moves = assignSlugs(players, held, prior);
  const slugSet = new Set(players.map((row) => row.slug));

  for (const team of CANONICAL_TEAMS) {
    if (!teamsWithDef.has(team)) {
      const fullName = TEAM_FULL_NAMES[team] || team;
      const slug = buildSlug(fullName);
      if (!slugSet.has(slug)) {
        slugSet.add(slug);
        players.push({
          id: `DEF-${team}`,
          name: fullName,
          base: slug,
          slug,
          position: 'DEF',
          team,
          status: 'Active',
          injury_status: null,
          age: null,
          height: null,
          weight: null,
          number: null,
          depth_chart_order: 1,
          years_exp: null,
        });
        console.log(`  Generated missing DEF entry: ${fullName} (${team})`);
      }
    }
  }

  players.sort((a, b) => {
    const posOrder = { QB: 0, RB: 1, WR: 2, TE: 3, K: 4, DEF: 5 };
    const pa = posOrder[a.position] ?? 99;
    const pb = posOrder[b.position] ?? 99;
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name);
  });

  const ledger = buildLedger(players, prior, previousLedger, moves);

  // `base` is scaffolding for the assignment above and means nothing to any
  // consumer, so it does not ship.
  const output = players.map(({ base, ...row }) => row);

  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  console.log(`Wrote ${output.length} players to ${outPath}`);
  console.log(`  Teams with DEF: ${teamsWithDef.size}/32`);
  console.log(`Wrote the slug ledger to ${ledgerPath}`);

  if (moves.length) {
    console.log(`  ${moves.length} slug change(s) - every old address needs a 301:`);
    for (const move of moves) {
      console.log(`    ${move.name}: ${move.from} -> ${move.to}`);
    }
    console.log('  Next: node scripts/player/migrateSlugs.js, then buildIndexedPlayers.js,');
    console.log('  then the WordPress builder to move the pages and register the redirects.');
  }
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
