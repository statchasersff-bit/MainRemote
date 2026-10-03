/**
 * Carry the slug-keyed data files across a slug change.
 *
 * WHY THIS IS NOT OPTIONAL. buildPlayersIndex.js owns the slug, but it is not
 * the only file that stores one. bios.json, draft.json and bio_facts.json are
 * OBJECTS KEYED BY SLUG; fantasy_outlook_2026.json is keyed by Sleeper id and
 * carries the slug as a field; depth_charts.json carries it as `sleeper_slug`.
 * Rename a player and none of that follows him - the profile renders with no
 * bio, no draft row, no outlook and no depth-chart slot, which looks exactly
 * like a data outage and is much harder to trace back to a URL change.
 *
 * WHY IT IS ONE PASS AND NOT A SEQUENCE OF REPLACEMENTS. The renames include
 * swaps. When the Kansas City running back took `kenneth-walker` from the
 * retired receiver, the receiver moved to `kenneth-walker-4634` in the same
 * run, and bio_facts.json held a record under each. Applying those two renames
 * one after the other gives the running back the receiver's birthday and his
 * college. So the walk below resolves every node against the map ONCE and
 * builds a new document, rather than editing the old one in place.
 *
 * WHAT IT MATCHES. Whole strings only, and only strings that are exactly a slug
 * this run moved. A slug appearing inside prose is not a key and is not
 * rewritten - the outlook bodies name players constantly and none of those are
 * addresses.
 *
 * WHY THE MOVE LIST IS CONSUMED. A second pass over the same list would not be
 * a no-op, it would be a corruption - and for the same reason the walk is one
 * pass. After the first run `kenneth-walker` is the running back's address, and
 * the list still says `kenneth-walker -> kenneth-walker-4634`, so running again
 * would hand his bio to the receiver. So a successful run empties `moves` in
 * the ledger. That is what makes re-running safe, and it is why `moves` means
 * "changed by the last build and not yet carried across" rather than "history":
 * the cumulative record is `previous`, which the redirects read and which this
 * script never touches.
 *
 * Reads the move list from data/player/player_slugs.json, which the index
 * builder writes.
 *
 *   node scripts/player/migrateSlugs.js [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './paths.mjs';

/** Every file that stores a slug, as a key or as a value. */
const TARGETS = [
  'bios.json',
  'draft.json',
  'bio_facts.json',
  'fantasy_outlook_2026.json',
  'depth_charts.json',
];

/**
 * Rebuild `node` with every whole-string slug resolved through `map`.
 *
 * Object keys and string values are both addresses in these files, so both are
 * rewritten. Key order is preserved, which keeps the diff to the lines that
 * actually changed.
 *
 * @param {unknown} node
 * @param {Map<string,string>} map  old slug -> new slug
 * @param {{keys:number,values:number}} counts  Mutated as it goes.
 */
function rewrite(node, map, counts) {
  if (typeof node === 'string') {
    const next = map.get(node);
    if (next !== undefined) {
      counts.values += 1;
      return next;
    }
    return node;
  }

  if (Array.isArray(node)) {
    return node.map((item) => rewrite(item, map, counts));
  }

  if (node && typeof node === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      const nextKey = map.get(key);
      if (nextKey !== undefined) counts.keys += 1;
      out[nextKey ?? key] = rewrite(value, map, counts);
    }
    return out;
  }

  return node;
}

/**
 * Serialise `value` the way `original` was serialised.
 *
 * Indentation is read off the first nested line, so a file written with two
 * spaces comes back with two and a minified one comes back minified. The
 * trailing newline is copied for the same reason.
 *
 * @param {string} original  The file as it was read.
 * @param {unknown} value    The document to write.
 */
function serializeLike(original, value) {
  const match = original.match(/^\{\r?\n(\s+)/);
  const indent = match ? match[1].length : 0;
  const json = JSON.stringify(value, null, indent);
  return original.endsWith('\n') ? `${json}\n` : json;
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const ledgerPath = path.join(DATA_DIR, 'player_slugs.json');

  if (!fs.existsSync(ledgerPath)) {
    console.error(`No slug ledger at ${ledgerPath}. Run buildPlayersIndex.js first.`);
    process.exit(1);
  }

  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const moves = Array.isArray(ledger.moves) ? ledger.moves : [];

  if (moves.length === 0) {
    console.log('The last index build moved no slugs; nothing to migrate.');
    return;
  }

  const map = new Map(moves.map((move) => [move.from, move.to]));
  console.log(`${map.size} slug change(s) to carry across ${TARGETS.length} files.`);

  let touched = 0;

  for (const name of TARGETS) {
    const file = path.join(DATA_DIR, name);
    if (!fs.existsSync(file)) {
      console.log(`  ${name}: not present, skipped`);
      continue;
    }

    const before = fs.readFileSync(file, 'utf8');
    const counts = { keys: 0, values: 0 };
    const after = rewrite(JSON.parse(before), map, counts);

    if (counts.keys === 0 && counts.values === 0) {
      console.log(`  ${name}: no change`);
      continue;
    }

    touched += 1;
    console.log(`  ${name}: ${counts.keys} key(s), ${counts.values} value(s)`);

    if (!dryRun) {
      // Written back in the shape it arrived in. These files do not agree on a
      // format - bios.json and draft.json are indented two, bio_facts.json and
      // the outlook are minified - and a migration that normalised them would
      // bury four renamed keys in a million-line diff.
      fs.writeFileSync(file, serializeLike(before, after));
    }
  }

  if (dryRun) {
    console.log(`Dry run: ${touched} file(s) would change. The move list is kept.`);
    return;
  }

  // Consumed, not kept. See the note at the top: these renames are only correct
  // to apply once.
  ledger.moves = [];
  ledger.migrated_at = new Date().toISOString();
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

  console.log(`Rewrote ${touched} file(s); the move list is now spent.`);
}

main();
