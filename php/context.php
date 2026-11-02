<?php
/**
 * Prints the site layout as JSON for the Search & Replace add-on.
 * Works on PHP 7.2 to 8.5 (the versions WordPress and Local support): no newer syntax.
 * Run with: wp eval-file context.php
 */
global $wpdb;

$wpdb->suppress_errors( true );

$prefix = $wpdb->base_prefix;
$multi  = is_multisite();
$rows   = $multi
	? $wpdb->get_results( "SELECT blog_id, domain, path FROM {$wpdb->blogs} ORDER BY blog_id", ARRAY_A )
	: array( array( 'blog_id' => 1, 'domain' => '', 'path' => '/' ) );

$blogs = array();
foreach ( (array) $rows as $row ) {
	$id     = (int) $row['blog_id'];
	$tp     = $wpdb->get_blog_prefix( $id );
	$values = array();
	$found  = $wpdb->get_results(
		"SELECT option_name, option_value FROM `{$tp}options` WHERE option_name IN ('siteurl','home')",
		ARRAY_A
	);
	foreach ( (array) $found as $o ) {
		$values[ $o['option_name'] ] = $o['option_value'];
	}
	$blogs[] = array(
		'id'          => $id,
		'domain'      => $row['domain'],
		'path'        => $row['path'],
		'siteurl'     => isset( $values['siteurl'] ) ? $values['siteurl'] : '',
		'home'        => isset( $values['home'] ) ? $values['home'] : '',
		'tablePrefix' => $tp,
	);
}

$tables = array();
foreach ( (array) $wpdb->get_results( 'SHOW TABLE STATUS', ARRAY_A ) as $t ) {
	if ( null === $t['Engine'] ) {
		continue; // A view.
	}
	$tables[] = array(
		'name'  => $t['Name'],
		'bytes' => (int) $t['Data_length'] + (int) $t['Index_length'],
		'rows'  => (int) $t['Rows'],
	);
}

echo "\n@@SR_JSON@@" . wp_json_encode(
	array(
		'wpVersion' => get_bloginfo( 'version' ),
		'prefix'    => $prefix,
		'multisite' => $multi,
		'subdomain' => $multi && is_subdomain_install(),
		'blogs'     => $blogs,
		'tables'    => $tables,
	)
) . "@@SR_END@@\n";
