<?php
/**
 * Finds http(s) hosts stored in the options tables and prints them as JSON.
 * Works on PHP 7.2 to 8.5 (the versions WordPress and Local support): no newer syntax.
 * Run with: wp eval-file domains.php
 */
global $wpdb;

$wpdb->suppress_errors( true );

$re    = '~(https?):(?:\\\\?/){2}([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(:\d+)?~i';
$found = array();

$add = function ( $value, $source, $primary ) use ( &$found ) {
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

$blog_ids = is_multisite() ? $wpdb->get_col( "SELECT blog_id FROM {$wpdb->blogs} ORDER BY blog_id" ) : array( 1 );

if ( is_multisite() ) {
	$network = $wpdb->get_var( "SELECT meta_value FROM {$wpdb->sitemeta} WHERE meta_key = 'siteurl' LIMIT 1" );
	if ( $network ) {
		$add( untrailingslashit( $network ), 'network siteurl', true );
	}
}

// wp_site and wp_blogs keep bare hosts. Use the scheme of the network (or main) URL to make them URLs.
if ( is_multisite() ) {
	$scheme = 'https';
	if ( ! empty( $network ) && preg_match( '~^(https?):~i', $network, $sm ) ) {
		$scheme = strtolower( $sm[1] );
	}
	foreach ( array( 'wp_site' => $wpdb->site, 'wp_blogs' => $wpdb->blogs ) as $source => $table ) {
		foreach ( (array) $wpdb->get_col( "SELECT domain FROM {$table}" ) as $host ) {
			if ( $host ) {
				$add( $scheme . '://' . strtolower( $host ), $source, true );
			}
		}
	}
}

// ponytail: deep scan stops after 200 blogs; siteurl/home are still read for every blog.
$deep = 0;
foreach ( $blog_ids as $id ) {
	$table = '`' . $wpdb->get_blog_prefix( (int) $id ) . 'options`';
	foreach ( array( 'siteurl', 'home' ) as $name ) {
		$v = $wpdb->get_var( $wpdb->prepare( "SELECT option_value FROM {$table} WHERE option_name = %s", $name ) );
		if ( $v ) {
			$add( untrailingslashit( $v ), "{$name} (site {$id})", true );
		}
	}
	if ( ++$deep > 200 ) {
		continue;
	}
	$last = 0;
	do {
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT option_id, option_name, option_value FROM {$table}
				 WHERE option_id > %d AND option_value LIKE %s
				 AND option_name NOT LIKE %s AND option_name NOT LIKE %s
				 AND option_name NOT IN ('siteurl','home')
				 AND LENGTH(option_value) < 2000000
				 ORDER BY option_id LIMIT 500",
				$last,
				'%http%',
				'\\_transient\\_%',
				'\\_site\\_transient\\_%'
			),
			ARRAY_A
		);
		foreach ( (array) $rows as $row ) {
			$last = (int) $row['option_id'];
			if ( preg_match_all( $re, $row['option_value'], $m, PREG_SET_ORDER ) ) {
				foreach ( $m as $hit ) {
					$add( strtolower( $hit[1] . '://' . $hit[2] . ( isset( $hit[3] ) ? $hit[3] : '' ) ), "options (site {$id})", false );
				}
			}
		}
	} while ( count( (array) $rows ) === 500 );
}

echo "\n@@SR_JSON@@" . wp_json_encode( $found ) . "@@SR_END@@\n";
