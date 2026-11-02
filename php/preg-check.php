<?php
/**
 * Compiles a regex. Prints "ok" or "invalid".
 * Run with: php preg-check.php <delimited-pattern>
 * A script file avoids shell quoting differences between Windows, macOS and Linux.
 */
echo false === @preg_match( isset( $argv[1] ) ? $argv[1] : '', '' ) ? 'invalid' : 'ok';
