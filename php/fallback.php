<?php
/**
 * Fallback for the Search & Replace add-on, used when WP-CLI cannot run.
 * Needs only PHP and mysqli: WordPress is not loaded.
 * Works on PHP 7.2 to 8.5 (the versions WordPress and Local support): no newer syntax.
 *
 * Reads one JSON job from stdin: {"mode":"context|domains|replace","db":{...}, ...}
 * Prints WP-CLI style lines for "replace", and @@SR_JSON@@...@@SR_END@@ for the other modes.
 */

// PHP 8.1 turned mysqli errors into exceptions. Every call is checked by hand below.
mysqli_report( MYSQLI_REPORT_OFF );

function sr_fail( $message ) {
	fwrite( STDERR, 'Error: ' . $message . "\n" );
	exit( 1 );
}

function sr_ident( $name ) {
	return '`' . str_replace( '`', '``', $name ) . '`';
}

$job = json_decode( (string) stream_get_contents( STDIN ), true );
if ( ! is_array( $job ) || empty( $job['db'] ) || empty( $job['mode'] ) ) {
	sr_fail( 'Bad fallback job.' );
}

$d    = $job['db'];
$sock = ! empty( $d['socket'] ) ? $d['socket'] : null;
$db   = @new mysqli(
	$sock ? 'localhost' : $d['host'],
	$d['user'],
	$d['password'],
	$d['name'],
	$sock ? 0 : (int) $d['port'],
	$sock
);
if ( $db->connect_errno ) {
	sr_fail( 'Error establishing a database connection: ' . $db->connect_error );
}
$db->set_charset( 'utf8mb4' );

function sr_rows( $db, $sql ) {
	$res = $db->query( $sql );
	if ( ! $res instanceof mysqli_result ) {
		return array();
	}
	$out = array();
	while ( $row = $res->fetch_assoc() ) {
		$out[] = $row;
	}
	$res->free();
	return $out;
}

function sr_value( $db, $sql ) {
	$rows = sr_rows( $db, $sql );
	if ( ! $rows ) {
		return null;
	}
	$row = array_values( $rows[0] );
	return $row[0];
}

function sr_q( $db, $value ) {
	return "'" . $db->real_escape_string( (string) $value ) . "'";
}

/** Table prefix: the one whose options, posts and users tables all exist (sub-sites have no users table). */
function sr_prefix( $names ) {
	$prefix = null;
	foreach ( $names as $n ) {
		if ( substr( $n, -7 ) !== 'options' ) {
			continue;
		}
		$p = substr( $n, 0, -7 );
		if ( in_array( $p . 'posts', $names, true ) && in_array( $p . 'users', $names, true ) && ( null === $prefix || strlen( $p ) < strlen( $prefix ) ) ) {
			$prefix = $p;
		}
	}
	return $prefix;
}

function sr_option( $db, $prefix, $name ) {
	$v = sr_value( $db, 'SELECT option_value FROM ' . sr_ident( $prefix . 'options' ) . ' WHERE option_name = ' . sr_q( $db, $name ) . ' LIMIT 1' );
	return null === $v ? '' : $v;
}

function sr_tables( $db ) {
	$tables = array();
	foreach ( sr_rows( $db, 'SHOW TABLE STATUS' ) as $t ) {
		if ( null === $t['Engine'] ) {
			continue; // A view.
		}
		$tables[] = array(
			'name'  => $t['Name'],
			'bytes' => (int) $t['Data_length'] + (int) $t['Index_length'],
			'rows'  => (int) $t['Rows'],
		);
	}
	return $tables;
}

function sr_json( $data ) {
	$flags = defined( 'JSON_INVALID_UTF8_SUBSTITUTE' ) ? JSON_INVALID_UTF8_SUBSTITUTE : 0;
	echo "\n@@SR_JSON@@" . json_encode( $data, $flags ) . "@@SR_END@@\n";
}

/* ---------------------------------------------------------------- context */
if ( 'context' === $job['mode'] ) {
	$tables = sr_tables( $db );
	$names  = array();
	foreach ( $tables as $t ) {
		$names[] = $t['name'];
	}
	$prefix = sr_prefix( $names );
	if ( null === $prefix ) {
		sr_fail( 'WordPress is not installed in this database (no options, posts and users tables).' );
	}
	$multi = in_array( $prefix . 'blogs', $names, true );
	$blogs = array();
	if ( $multi ) {
		foreach ( sr_rows( $db, 'SELECT blog_id, domain, path FROM ' . sr_ident( $prefix . 'blogs' ) . ' ORDER BY blog_id' ) as $r ) {
			$id    = (int) $r['blog_id'];
			$tp    = 1 === $id ? $prefix : $prefix . $id . '_';
			$blogs[] = array(
				'id'          => $id,
				'domain'      => $r['domain'],
				'path'        => $r['path'],
				'siteurl'     => sr_option( $db, $tp, 'siteurl' ),
				'home'        => sr_option( $db, $tp, 'home' ),
				'tablePrefix' => $tp,
			);
		}
	} else {
		$blogs[] = array(
			'id'          => 1,
			'domain'      => '',
			'path'        => '/',
			'siteurl'     => sr_option( $db, $prefix, 'siteurl' ),
			'home'        => sr_option( $db, $prefix, 'home' ),
			'tablePrefix' => $prefix,
		);
	}
	$sub = $multi && '1' === (string) sr_value( $db, 'SELECT meta_value FROM ' . sr_ident( $prefix . 'sitemeta' ) . " WHERE meta_key = 'subdomain_install' LIMIT 1" );
	sr_json(
		array(
			'wpVersion' => 'unknown',
			'prefix'    => $prefix,
			'multisite' => $multi,
			'subdomain' => $sub,
			'blogs'     => $blogs,
			'tables'    => $tables,
		)
	);
	exit( 0 );
}

/* ---------------------------------------------------------------- domains */
if ( 'domains' === $job['mode'] ) {
	$prefix = $job['prefix'];
	$multi  = ! empty( $job['multisite'] );
	$re     = '~(https?):(?:\\\\?/){2}([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(:\d+)?~i';
	$found  = array();
	$add    = function ( $value, $source, $primary ) use ( &$found ) {
		if ( ! isset( $found[ $value ] ) ) {
			$found[ $value ] = array( 'count' => 0, 'sources' => array(), 'primary' => false );
		}
		$found[ $value ]['count']++;
		if ( count( $found[ $value ]['sources'] ) < 5 && ! in_array( $source, $found[ $value ]['sources'], true ) ) {
			$found[ $value ]['sources'][] = $source;
		}
		if ( $primary ) {
			$found[ $value ]['primary'] = true;
		}
	};

	$scheme = 'https';
	if ( $multi ) {
		$network = sr_value( $db, 'SELECT meta_value FROM ' . sr_ident( $prefix . 'sitemeta' ) . " WHERE meta_key = 'siteurl' LIMIT 1" );
		if ( $network ) {
			$add( rtrim( $network, '/' ), 'network siteurl', true );
			if ( preg_match( '~^(https?):~i', $network, $sm ) ) {
				$scheme = strtolower( $sm[1] );
			}
		}
		foreach ( array( 'wp_site' => 'site', 'wp_blogs' => 'blogs' ) as $source => $suffix ) {
			foreach ( sr_rows( $db, 'SELECT domain FROM ' . sr_ident( $prefix . $suffix ) ) as $r ) {
				if ( $r['domain'] ) {
					$add( $scheme . '://' . strtolower( $r['domain'] ), $source, true );
				}
			}
		}
		$ids = array();
		foreach ( sr_rows( $db, 'SELECT blog_id FROM ' . sr_ident( $prefix . 'blogs' ) . ' ORDER BY blog_id' ) as $r ) {
			$ids[] = (int) $r['blog_id'];
		}
	} else {
		$ids = array( 1 );
	}

	$deep = 0;
	foreach ( $ids as $id ) {
		$tp    = 1 === $id ? $prefix : $prefix . $id . '_';
		$table = sr_ident( $tp . 'options' );
		foreach ( array( 'siteurl', 'home' ) as $name ) {
			$v = sr_option( $db, $tp, $name );
			if ( $v ) {
				$add( rtrim( $v, '/' ), $name . ' (site ' . $id . ')', true );
			}
		}
		if ( ++$deep > 200 ) {
			continue;
		}
		$last = 0;
		do {
			$rows = sr_rows(
				$db,
				'SELECT option_id, option_name, option_value FROM ' . $table .
				' WHERE option_id > ' . (int) $last . " AND option_value LIKE '%http%'" .
				" AND option_name NOT LIKE '\\_transient\\_%' AND option_name NOT LIKE '\\_site\\_transient\\_%'" .
				" AND option_name NOT IN ('siteurl','home') AND LENGTH(option_value) < 2000000" .
				' ORDER BY option_id LIMIT 500'
			);
			foreach ( $rows as $row ) {
				$last = (int) $row['option_id'];
				if ( preg_match_all( $re, $row['option_value'], $m, PREG_SET_ORDER ) ) {
					foreach ( $m as $hit ) {
						$add( strtolower( $hit[1] . '://' . $hit[2] . ( isset( $hit[3] ) ? $hit[3] : '' ) ), 'options (site ' . $id . ')', false );
					}
				}
			}
		} while ( 500 === count( $rows ) );
	}
	sr_json( (object) $found );
	exit( 0 );
}

/* ------------------------------------------------------------ fingerprint */
// A cheap summary of the database, to see that it changed (an import by any tool, a new site URL). Two hashes:
// - tables: every table name with the time it was created. An import drops and creates the tables, so this changes;
// - urls: siteurl and home of every site, and the hosts in wp_site and wp_blogs. A search-replace of the site URL changes it.
// The time of the last write is not used: WordPress writes options all the time and the summary would never rest.
if ( 'fingerprint' === $job['mode'] ) {
	$names = array();
	$parts = array();
	foreach ( sr_rows( $db, 'SELECT TABLE_NAME AS n, UNIX_TIMESTAMP(CREATE_TIME) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME' ) as $r ) {
		$names[] = $r['n'];
		$parts[] = $r['n'] . ':' . $r['c'];
	}
	$urls   = array();
	$prefix = sr_prefix( $names );
	if ( null !== $prefix ) {
		$ids = array( 1 );
		if ( in_array( $prefix . 'blogs', $names, true ) ) {
			$ids = array();
			foreach ( sr_rows( $db, 'SELECT blog_id, domain FROM ' . sr_ident( $prefix . 'blogs' ) . ' ORDER BY blog_id' ) as $r ) {
				$ids[]  = (int) $r['blog_id'];
				$urls[] = 'blog:' . $r['domain'];
			}
			foreach ( sr_rows( $db, 'SELECT domain FROM ' . sr_ident( $prefix . 'site' ) . ' ORDER BY id' ) as $r ) {
				$urls[] = 'site:' . $r['domain'];
			}
		}
		foreach ( $ids as $id ) {
			$tp = 1 === $id ? $prefix : $prefix . $id . '_';
			foreach ( array( 'siteurl', 'home' ) as $name ) {
				$urls[] = $id . ':' . $name . ':' . sr_option( $db, $tp, $name );
			}
		}
	}
	sr_json(
		array(
			'tables'  => md5( implode( '|', $parts ) ),
			'urls'    => md5( implode( '|', $urls ) ),
			'count'   => count( $names ),
			'siteurl' => isset( $urls[0] ) ? $urls[0] : '',
		)
	);
	exit( 0 );
}

/* ---------------------------------------------------------------- replace */
if ( 'replace' !== $job['mode'] ) {
	sr_fail( 'Unknown fallback mode.' );
}

$regex   = ! empty( $job['regex'] );
$search  = (string) $job['search'];
$replace = (string) $job['replace'];
$pattern = $regex ? (string) $job['pattern'] : '';
$dry     = ! empty( $job['dryRun'] );
$skip    = isset( $job['skipColumns'] ) ? (array) $job['skipColumns'] : array();
$only    = isset( $job['includeColumns'] ) ? (array) $job['includeColumns'] : null; // Columns from the pre-scan.
$count   = 0;
$skipped = 0;

if ( $regex && false === @preg_match( $pattern, '' ) ) {
	sr_fail( 'The regex pattern is not valid.' );
}

/**
 * Replace inside one value. Serialized data is unserialized without objects, changed, and serialized again,
 * so string lengths stay right. A value that holds a PHP object is left alone and counted as skipped.
 */
function sr_walk( $v, &$has_object ) {
	global $regex, $search, $replace, $pattern, $count;
	if ( is_array( $v ) ) {
		foreach ( $v as $k => $item ) {
			$v[ $k ] = sr_walk( $item, $has_object );
		}
		return $v;
	}
	if ( is_object( $v ) ) {
		$has_object = true;
		return $v;
	}
	if ( ! is_string( $v ) || '' === $v ) {
		return $v;
	}
	if ( ! $regex && false === strpos( $v, $search ) ) {
		return $v;
	}
	if ( preg_match( '/^(a|O|s|i|d|b|C|E):\d|^N;$/', $v ) ) {
		$u = @unserialize( $v, array( 'allowed_classes' => false ) );
		if ( false !== $u || 'b:0;' === $v ) {
			$obj = false;
			$new = sr_walk( $u, $obj );
			if ( $obj ) {
				$has_object = true;
				return $v;
			}
			return serialize( $new );
		}
	}
	if ( $regex ) {
		$out = preg_replace( $pattern, $replace, $v, -1, $c );
		if ( null === $out ) {
			sr_fail( 'The regex failed on a value (PCRE error ' . preg_last_error() . ').' );
		}
	} else {
		$out = str_replace( $search, $replace, $v, $c );
	}
	$count += $c;
	return $out;
}

foreach ( (array) $job['tables'] as $table ) {
	$cols = array();
	foreach ( sr_rows( $db, 'SHOW COLUMNS FROM ' . sr_ident( $table ) ) as $c ) {
		// A generated column cannot be written (MySQL 5.7+, MariaDB 10.2+).
		if ( preg_match( '/char|text|json/i', $c['Type'] ) && ! preg_match( '/GENERATED|PERSISTENT|VIRTUAL/i', isset( $c['Extra'] ) ? $c['Extra'] : '' ) && ! in_array( $c['Field'], $skip, true ) && ( null === $only || in_array( $c['Field'], $only, true ) ) ) {
			$cols[] = $c['Field'];
		}
	}
	$pk = array();
	foreach ( sr_rows( $db, 'SHOW KEYS FROM ' . sr_ident( $table ) . " WHERE Key_name = 'PRIMARY'" ) as $k ) {
		$pk[ (int) $k['Seq_in_index'] ] = $k['Column_name'];
	}
	ksort( $pk );
	echo 'Checking: ' . $table . '.' . ( $cols ? $cols[0] : '-' ) . "\n";
	if ( ! $cols ) {
		continue;
	}
	if ( ! $pk ) {
		fwrite( STDERR, 'Warning: Table ' . $table . " has no primary key. It was skipped.\n" );
		continue;
	}

	$select  = implode( ', ', array_map( 'sr_ident', array_merge( $pk, $cols ) ) );
	$order   = implode( ', ', array_map( 'sr_ident', $pk ) );
	$single  = 1 === count( $pk );
	$last    = null;
	$offset  = 0;
	$changed = 0;
	do {
		$where = ( $single && null !== $last ) ? ' WHERE ' . sr_ident( $pk[1] ) . ' > ' . sr_q( $db, $last ) : '';
		$sql   = 'SELECT ' . $select . ' FROM ' . sr_ident( $table ) . $where . ' ORDER BY ' . $order . ' LIMIT 200' . ( $single ? '' : ' OFFSET ' . $offset );
		$rows  = sr_rows( $db, $sql );
		foreach ( $rows as $row ) {
			$set = array();
			foreach ( $cols as $col ) {
				if ( null === $row[ $col ] ) {
					continue;
				}
				$obj    = false;
				$before = $count;
				$new    = sr_walk( $row[ $col ], $obj );
				if ( $obj ) {
					$count = $before; // The value is left as it was, so its replacements do not count.
					if ( $regex || false !== strpos( $row[ $col ], $search ) ) {
						$skipped++;
					}
					continue;
				}
				if ( $new !== $row[ $col ] ) {
					$set[] = sr_ident( $col ) . ' = ' . sr_q( $db, $new );
				}
			}
			if ( $set ) {
				$changed++;
				if ( ! $dry ) {
					$cond = array();
					foreach ( $pk as $p ) {
						$cond[] = sr_ident( $p ) . ' = ' . sr_q( $db, $row[ $p ] );
					}
					if ( ! $db->query( 'UPDATE ' . sr_ident( $table ) . ' SET ' . implode( ', ', $set ) . ' WHERE ' . implode( ' AND ', $cond ) ) ) {
						sr_fail( 'Could not update ' . $table . ': ' . $db->error );
					}
				}
			}
			if ( $single ) {
				$last = $row[ $pk[1] ];
			}
		}
		$offset += 200;
	} while ( 200 === count( $rows ) );
	if ( $changed ) {
		echo $changed . " rows affected using PHP\n";
	}
}

if ( $skipped ) {
	fwrite( STDERR, 'Warning: ' . $skipped . " value(s) hold a PHP object and were not changed by the fallback.\n" );
}
echo $dry ? 'Success: ' . $count . " replacements to be made.\n" : 'Success: Made ' . $count . " replacements.\n";
