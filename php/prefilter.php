<?php
/**
 * Pre-scan for the Search & Replace add-on.
 * Finds, per table, which text columns contain one of the needles, with ONE pass over each table.
 * Works on PHP 7.2 to 8.5 (the versions WordPress and Local support): no newer syntax.
 * Run with: wp eval-file prefilter.php <base64 of {"tables":[...],"needles":[...]}>
 * Prints {"table":["col",...]} for tables with at least one hit.
 */
global $wpdb;

$wpdb->suppress_errors( true );

$job = json_decode( base64_decode( isset( $args[0] ) ? $args[0] : '' ), true );
if ( ! is_array( $job ) || empty( $job['tables'] ) || empty( $job['needles'] ) ) {
	WP_CLI::error( 'Bad pre-scan job.' );
}

$ident = function ( $name ) {
	return '`' . str_replace( '`', '``', $name ) . '`';
};

$hits = array();
foreach ( $job['tables'] as $table ) {
	$cols = array();
	foreach ( (array) $wpdb->get_results( 'SHOW COLUMNS FROM ' . $ident( $table ), ARRAY_A ) as $c ) {
		if ( preg_match( '/char|text|blob|json/i', $c['Type'] ) ) {
			$cols[] = $c['Field'];
		}
	}
	if ( ! $cols ) {
		continue;
	}
	$select = array();
	foreach ( $cols as $i => $col ) {
		$any = array();
		foreach ( $job['needles'] as $needle ) {
			// `%%` keeps a literal % in a column name away from prepare().
			$any[] = $wpdb->prepare( str_replace( '%', '%%', $ident( $col ) ) . ' LIKE %s', '%' . $wpdb->esc_like( $needle ) . '%' );
		}
		$select[] = 'MAX(' . implode( ' OR ', $any ) . ') AS c' . $i;
	}
	$row = $wpdb->get_row( 'SELECT ' . implode( ', ', $select ) . ' FROM ' . $ident( $table ), ARRAY_A );
	if ( null === $row ) {
		// The query failed (for example a damaged table). Treat the table as a hit so that nothing is skipped by mistake.
		$hits[ $table ] = $cols;
		continue;
	}
	$found = array();
	foreach ( $cols as $i => $col ) {
		if ( ! empty( $row[ 'c' . $i ] ) ) {
			$found[] = $col;
		}
	}
	if ( $found ) {
		$hits[ $table ] = $found;
	}
}

echo "\n@@SR_JSON@@" . wp_json_encode( (object) $hits ) . "@@SR_END@@\n";
