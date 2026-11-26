<?php
/**
 * Concurrent creation, with real processes (2026-11-26 audit, WEB-012).
 *
 * smoke-player-builder.php stages the races by hand, inside one process. This
 * runs them: several forked PHP processes create the same player page at the
 * same instant against one shared SQLite "posts" table, and wp_insert_post()
 * here behaves as WordPress's does where it matters - wp_unique_post_slug() is
 * a SELECT of the sibling slugs, then the INSERT, with nothing atomic between
 * them. That window is how D'Andre Swift got 4928 and 4929 on 2026-09-20.
 *
 *   1. N processes call statchasers_player_create_page() for one slug, all
 *      released at the same moment, ROUNDS times. The race is real: rounds
 *      where two or more processes got the bare slug from WordPress are
 *      counted. Afterwards exactly one page holds the slug, no suffixed page
 *      survives, and every process reports that page.
 *   2. N processes run the whole builder (statchasers_player_build_batch) at
 *      once against the same table, with the build lock in the same database.
 *      Afterwards every roster player has exactly one page.
 *
 * smoke.php runs it as STATCHASERS_SMOKE_GROUP=playerrace. Needs pcntl and
 * pdo_sqlite, both in the php-with-extensions build; skipped without them.
 *
 * @package StatChasers\Tests
 */

if ( ! function_exists( 'statchasers_player_create_page' ) ) {
	fwrite( STDERR, "smoke-player-race.php is included by smoke.php; run that.\n" );
	exit( 1 );
}

if ( ! function_exists( 'pcntl_fork' ) || ! class_exists( 'PDO' ) || ! in_array( 'sqlite', PDO::getAvailableDrivers(), true ) ) {
	echo "\nconcurrent creation: skipped (needs pcntl and pdo_sqlite)\n";
	return;
}

const SC_RACE_PROCS  = 8;
const SC_RACE_ROUNDS = 25;

$sc_race_file = tempnam( sys_get_temp_dir(), 'scrace' );

/** This process's connection. Opened after the fork, never shared. */
function sc_race_db(): PDO {
	static $pid = 0, $db = null;
	if ( null === $db || getmypid() !== $pid ) {
		$db = new PDO( 'sqlite:' . $GLOBALS['race_db'] );
		$db->setAttribute( PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION );
		$db->setAttribute( PDO::ATTR_TIMEOUT, 30 );
		$db->exec( 'PRAGMA busy_timeout = 30000' );
		$pid = getmypid();
	}
	return $db;
}

function sc_race_row_to_post( array $row ): WP_Post {
	$p               = new WP_Post();
	$p->ID           = (int) $row['ID'];
	$p->post_name    = (string) $row['post_name'];
	$p->post_parent  = (int) $row['post_parent'];
	$p->post_content = (string) $row['post_content'];
	$p->post_title   = (string) $row['post_title'];
	$p->post_status  = (string) $row['post_status'];
	return $p;
}

function sc_race_get_post( int $id ) {
	$q = sc_race_db()->prepare( 'SELECT * FROM posts WHERE ID = ?' );
	$q->execute( array( $id ) );
	$row = $q->fetch( PDO::FETCH_ASSOC );
	return $row ? sc_race_row_to_post( $row ) : null;
}

function sc_race_get_posts( array $args ): array {
	$sql    = "SELECT * FROM posts WHERE post_parent = ? AND post_status != 'trash'";
	$params = array( (int) ( $args['post_parent'] ?? 0 ) );
	if ( array_key_exists( 'name', $args ) ) {
		$sql     .= ' AND post_name = ?';
		$params[] = (string) $args['name'];
	}
	$sql .= ' ORDER BY ID ASC';
	$limit = (int) ( $args['numberposts'] ?? 5 );
	if ( $limit > 0 ) {
		$sql .= ' LIMIT ' . $limit;
	}
	$q = sc_race_db()->prepare( $sql );
	$q->execute( $params );
	$out = array();
	foreach ( $q->fetchAll( PDO::FETCH_ASSOC ) as $row ) {
		$out[] = 'ids' === ( $args['fields'] ?? '' ) ? (int) $row['ID'] : sc_race_row_to_post( $row );
	}
	return $out;
}

/** WordPress's shape: read the sibling slugs, pick a free one, then insert. Not atomic. */
function sc_race_insert_post( array $a ): int {
	$db     = sc_race_db();
	$name   = (string) ( $a['post_name'] ?? '' );
	$parent = (int) ( $a['post_parent'] ?? 0 );

	$q = $db->prepare( "SELECT post_name FROM posts WHERE post_parent = ? AND post_status != 'trash'" );
	$q->execute( array( $parent ) );
	$taken = array_fill_keys( $q->fetchAll( PDO::FETCH_COLUMN ), true );
	$base  = $name;
	for ( $n = 2; isset( $taken[ $name ] ); $n++ ) {
		$name = $base . '-' . $n;
	}
	$GLOBALS['race_got_bare'] = ( $name === $base );

	// The rest of wp_insert_post() between the check and the write: filters,
	// sanitizing, the GUID. Long enough for a neighbor to get in.
	usleep( random_int( 200, 4000 ) );

	$ins = $db->prepare( 'INSERT INTO posts ( post_name, post_parent, post_title, post_content, post_status ) VALUES ( ?, ?, ?, ?, ? )' );
	$ins->execute( array( $name, $parent, (string) ( $a['post_title'] ?? '' ), (string) ( $a['post_content'] ?? '' ), (string) ( $a['post_status'] ?? 'publish' ) ) );
	return (int) $db->lastInsertId();
}

function sc_race_delete_post( int $id ): bool {
	$q = sc_race_db()->prepare( 'DELETE FROM posts WHERE ID = ?' );
	$q->execute( array( $id ) );
	return true;
}

/** Fork $n children running $work( $i ) at $start (a microtime), collect what each prints. */
function sc_race_fork( int $n, float $start, callable $work ): array {
	$files = array();
	$pids  = array();
	for ( $i = 0; $i < $n; $i++ ) {
		$files[ $i ] = tempnam( sys_get_temp_dir(), 'scraceout' );
		$pid         = pcntl_fork();
		if ( 0 === $pid ) {
			$wait = $start - microtime( true );
			if ( $wait > 0 ) {
				usleep( (int) ( $wait * 1e6 ) );
			}
			$out = $work( $i );
			file_put_contents( $files[ $i ], json_encode( $out ) );
			// Straight out: no shutdown handlers, no buffered output twice.
			posix_kill( getmypid(), SIGKILL );
		}
		$pids[] = $pid;
	}
	foreach ( $pids as $pid ) {
		pcntl_waitpid( $pid, $status );
	}
	$results = array();
	foreach ( $files as $i => $file ) {
		$results[ $i ] = json_decode( (string) file_get_contents( $file ), true );
		unlink( $file );
	}
	return $results;
}

$GLOBALS['race_db'] = $sc_race_file;
$db                 = sc_race_db();
$db->exec( 'PRAGMA journal_mode = WAL' );
$db->exec( 'CREATE TABLE posts ( ID INTEGER PRIMARY KEY AUTOINCREMENT, post_name TEXT, post_parent INTEGER, post_title TEXT, post_content TEXT, post_status TEXT )' );
$db->exec( 'CREATE TABLE options ( option_name TEXT PRIMARY KEY, option_value TEXT )' );
$db->exec( "INSERT INTO posts ( ID, post_name, post_parent, post_title, post_content, post_status ) VALUES ( 500, 'nfl', 0, 'NFL', '', 'publish' ), ( 501, 'players', 500, 'Players', '', 'publish' )" );

/* --------------------------------------------- 1. one slug, N at once */

echo "\n" . SC_RACE_PROCS . ' processes create the same page at once, ' . SC_RACE_ROUNDS . " rounds\n";

$raced = 0;
$bad   = array();
for ( $round = 0; $round < SC_RACE_ROUNDS; $round++ ) {
	$slug    = 'race-player-' . chr( 97 + intdiv( $round, 26 ) ) . chr( 97 + $round % 26 );
	$row     = array( 'slug' => $slug, 'name' => 'Race Player ' . $round, 'position' => 'RB' );
	$results = sc_race_fork(
		SC_RACE_PROCS,
		microtime( true ) + 0.15,
		static function () use ( $row ): array {
			$made = statchasers_player_create_page( $row, 501 );
			return array( 'id' => $made['id'], 'bare' => $GLOBALS['race_got_bare'] ?? null, 'error' => $made['error'] );
		}
	);

	$bare = count( array_filter( $results, static fn( $r ) => true === ( $r['bare'] ?? null ) ) );
	if ( $bare >= 2 ) {
		++$raced; // WordPress handed the bare slug to two or more processes.
	}

	$q = $db->prepare( 'SELECT ID, post_name FROM posts WHERE post_parent = 501 AND ( post_name = ? OR post_name LIKE ? ) ORDER BY ID' );
	$q->execute( array( $slug, $slug . '-%' ) );
	$left = $q->fetchAll( PDO::FETCH_ASSOC );
	$ids  = array_unique( array_map( static fn( $r ) => (int) ( $r['id'] ?? 0 ), $results ) );
	if ( 1 !== count( $left ) || $left[0]['post_name'] !== $slug || array( (int) $left[0]['ID'] ) !== array_values( $ids ) ) {
		$bad[] = sprintf( '%s: left %s, processes said %s', $slug, json_encode( $left ), json_encode( array_values( $ids ) ) );
	}
}

echo "  (rounds where two or more processes got the bare slug from WordPress: $raced of " . SC_RACE_ROUNDS . ")\n";
is( $raced > 0, true, 'the same-instant race actually happened' );
is( $bad, array(), 'every round: one page at the slug, no -2, and every process names it' );

/* ------------------------------------------- 2. N whole builds at once */

echo "\n" . SC_RACE_PROCS . " whole builds at once, the lock in the shared database\n";

$GLOBALS['wpdb'] = new class {
	public $posts   = 'wp_posts';
	public $options = 'wp_options';
	public function prepare( $q, ...$a ) {
		$quoted = array_map( static fn( $v ) => "'" . str_replace( "'", "''", (string) $v ) . "'", $a );
		return vsprintf( str_replace( '%d', '%s', (string) $q ), $quoted );
	}
	public function esc_like( $s ) {
		return $s;
	}
	public function get_results( $q ) {
		if ( ! preg_match( "/post_parent = '(\d+)'/", (string) $q, $m ) ) {
			return array();
		}
		$r = sc_race_db()->prepare( "SELECT ID, post_name FROM posts WHERE post_parent = ? AND post_status != 'trash' ORDER BY ID" );
		$r->execute( array( (int) $m[1] ) );
		return array_map( static fn( $row ) => (object) $row, $r->fetchAll( PDO::FETCH_ASSOC ) );
	}
	public function get_col( $q ) {
		return array_map( static fn( $o ) => $o->post_name, $this->get_results( $q ) );
	}
	public function query( $q ) {
		if ( preg_match( "/INSERT IGNORE INTO `wp_options`.*VALUES \( '([^']+)', '([^']*)'/s", (string) $q, $m ) ) {
			$ins = sc_race_db()->prepare( 'INSERT OR IGNORE INTO options ( option_name, option_value ) VALUES ( ?, ? )' );
			$ins->execute( array( $m[1], $m[2] ) );
			return $ins->rowCount();
		}
		return 0;
	}
};
// The lock's other half (the stale check and the release) through the same table.
$GLOBALS['race_options'] = true;

$players = array();
for ( $i = 0; $i < 12; $i++ ) {
	$letter    = chr( 97 + $i ); // Letters: a real slug never ends in -<digit>.
	$players[] = array( 'id' => (string) ( 9000 + $i ), 'slug' => 'build-player-' . $letter, 'name' => 'Build Player ' . strtoupper( $letter ), 'position' => 'WR', 'team' => 'CHI', 'teamName' => 'Chicago Bears' );
}
$GLOBALS['http_body'] = json_encode( array( 'ok' => true, 'players' => $players ) );
$GLOBALS['pages_by_path'] = array( 'nfl' => sc_race_get_post( 500 ), 'nfl/players' => sc_race_get_post( 501 ) );

$results = sc_race_fork(
	SC_RACE_PROCS,
	microtime( true ) + 0.2,
	static function (): array {
		$r = statchasers_player_build_batch( 0 );
		return array( 'locked' => $r['locked'], 'created' => $r['created'], 'errors' => $r['errors'] );
	}
);

$ran     = count( array_filter( $results, static fn( $r ) => false === ( $r['locked'] ?? true ) ) );
$created = array_sum( array_map( static fn( $r ) => (int) ( $r['created'] ?? 0 ), $results ) );
echo "  (builds that ran: $ran, held off by the lock: " . ( SC_RACE_PROCS - $ran ) . ")\n";

$counts = $db->query( "SELECT post_name, COUNT(*) AS n FROM posts WHERE post_parent = 501 AND post_name LIKE 'build-player-%' GROUP BY post_name" )->fetchAll( PDO::FETCH_KEY_PAIR );
is( count( $counts ), 12, 'every roster player has a page' );
is( array_filter( $counts, static fn( $n ) => 1 !== (int) $n ), array(), 'and exactly one each' );
is( preg_grep( '/-\d+$/', array_keys( $counts ) ), array(), 'with no suffixed slug' );
is( $created, 12, 'created once in total across all the builds' );

unset( $GLOBALS['race_db'] );
@unlink( $sc_race_file );
@unlink( $sc_race_file . '-wal' );
@unlink( $sc_race_file . '-shm' );
