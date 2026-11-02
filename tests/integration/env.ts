import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DbConn } from '../../src/engine/fallback';
import type { WpRuntime } from '../../src/engine/wpRunner';

const LOCAL_DIR = path.join(
	os.homedir(),
	process.platform === 'darwin' ? 'Library/Application Support/Local' : '.config/Local',
);

function newest(dir: string, prefix: string): string | null {
	if (!fs.existsSync(dir)) return null;
	return (
		fs
			.readdirSync(dir)
			.filter((f) => f.startsWith(prefix))
			.sort()
			.reverse()[0] ?? null
	);
}

export function findPhp(): string {
	if (process.env.SR_PHP) return process.env.SR_PHP;
	const svc = path.join(LOCAL_DIR, 'lightning-services');
	const d = newest(svc, 'php-8.2') ?? newest(svc, 'php-8');
	if (d) {
		for (const a of fs.readdirSync(path.join(svc, d, 'bin'))) {
			const p = path.join(svc, d, 'bin', a, 'bin', 'php');
			if (fs.existsSync(p)) return p;
		}
	}
	return 'php'; // CI: setup-php.
}

export function findWpCli(): string {
	if (process.env.SR_WPCLI) return process.env.SR_WPCLI;
	const p = '/Applications/Local.app/Contents/Resources/extraResources/bin/wp-cli/wp-cli.phar';
	if (fs.existsSync(p)) return p;
	throw new Error('Set SR_WPCLI to a wp-cli.phar path.');
}

function findTarball(): string | null {
	if (process.env.SR_WP_TARBALL) return process.env.SR_WP_TARBALL;
	const dir = path.join(LOCAL_DIR, 'cached-wordpress');
	const f = newest(dir, 'wordpress-6.9');
	return f ? path.join(dir, f) : null;
}

let counter = 0;

export interface TestSite {
	/** What Local calls `paths.webRoot`. */
	webRoot: string;
	rt: WpRuntime;
	/** How the PHP fallback reaches this site's database. Kept out of `rt` so error tests still fail as before. */
	dbConn: DbConn;
	db: string;
	/** Run WP-CLI against the real install, with no skip flags. */
	wp: (args: string[], opts?: { url?: string }) => string;
	/** First column of a SQL query result. */
	sql: (query: string) => string[];
	prefix: string;
}

export type Kind =
	| 'single'
	| 'multisite-subdir'
	| 'multisite-subdomain'
	| 'bedrock'
	| 'subdir-install';

export interface MakeOpts {
	kind: Kind;
	/** Domain the "production" database uses. */
	origin?: string;
	/** Rewrite wp-config to a Local style domain, as Local does after an import (multisite only). */
	localDomain?: string;
	prefix?: string;
}

function baseEnv(): NodeJS.ProcessEnv {
	const bin = process.env.SR_MYSQL_BIN;
	return {
		...process.env,
		PATH: bin ? `${bin}${path.delimiter}${process.env.PATH}` : process.env.PATH,
	};
}

export function makeSite(o: MakeOpts): TestSite {
	const origin = o.origin ?? 'prod.example.net';
	const prefix = o.prefix ?? 'wp_';
	const id = `${process.pid}_${++counter}_${randomBytes(3).toString('hex')}`;
	const root = path.join(process.env.SR_TMP as string, `site${id}`);
	const db = `sr_${id}`;
	const php = findPhp();
	const phar = findWpCli();
	const tar = findTarball();
	if (!tar) throw new Error('Set SR_WP_TARBALL to a WordPress .tar.gz.');
	const env = baseEnv();

	const wpDir =
		o.kind === 'bedrock'
			? path.join(root, 'web', 'wp')
			: o.kind === 'subdir-install'
				? path.join(root, 'app', 'public', 'blog')
				: path.join(root, 'app', 'public');
	fs.mkdirSync(wpDir, { recursive: true });
	execFileSync('tar', ['xzf', tar, '-C', wpDir, '--strip-components=1']);

	const mysqlArgs = (q: string) => {
		const host = process.env.SR_DB_HOST as string;
		const sock = host.startsWith('localhost:') ? [`-S${host.slice(10)}`] : [`-h${host}`];
		return [
			'--no-defaults',
			`-u${process.env.SR_DB_USER}`,
			`-p${process.env.SR_DB_PASS ?? ''}`.replace(/^-p$/, '--skip-password'),
			...sock,
			'-N',
			'-e',
			q,
		];
	};
	const mysqlBin = process.env.SR_MYSQL_BIN
		? path.join(process.env.SR_MYSQL_BIN, 'mysql')
		: 'mysql';
	execFileSync(mysqlBin, mysqlArgs(`DROP DATABASE IF EXISTS ${db}; CREATE DATABASE ${db}`), {
		env,
	});

	const wp = (args: string[], opts: { url?: string } = {}): string =>
		execFileSync(
			php,
			[
				'-d',
				'memory_limit=-1',
				phar,
				`--path=${wpDir}`,
				...(opts.url ? [`--url=${opts.url}`] : []),
				...args,
			],
			{ env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
		);

	if (o.kind === 'bedrock') {
		fs.mkdirSync(path.join(root, 'config'), { recursive: true });
		fs.writeFileSync(
			path.join(root, 'config', 'application.php'),
			`<?php
define('DB_NAME', '${db}');
define('DB_USER', '${process.env.SR_DB_USER}');
define('DB_PASSWORD', '${process.env.SR_DB_PASS ?? ''}');
define('DB_HOST', '${process.env.SR_DB_HOST}');
if (!defined('ABSPATH')) { define('ABSPATH', dirname(__DIR__) . '/web/wp/'); }
$table_prefix = '${prefix}';
`,
		);
		fs.writeFileSync(
			path.join(root, 'web', 'wp-config.php'),
			"<?php\nrequire_once dirname(__DIR__) . '/config/application.php';\nrequire_once ABSPATH . 'wp-settings.php';\n",
		);
		fs.writeFileSync(path.join(root, 'wp-cli.yml'), 'path: web/wp\n');
	} else {
		wp([
			'config',
			'create',
			`--dbname=${db}`,
			`--dbuser=${process.env.SR_DB_USER}`,
			`--dbpass=${process.env.SR_DB_PASS ?? ''}`,
			`--dbhost=${process.env.SR_DB_HOST}`,
			`--dbprefix=${prefix}`,
			'--skip-check',
		]);
	}

	const url = `https://${origin}`;
	const install = [
		'--title=Prod',
		'--admin_user=admin',
		'--admin_password=pw',
		'--admin_email=a@example.org',
		'--skip-email',
	];
	if (o.kind.startsWith('multisite')) {
		wp([
			'core',
			'multisite-install',
			`--url=${url}`,
			...(o.kind === 'multisite-subdomain' ? ['--subdomains'] : []),
			...install,
		]);
	} else {
		wp(['core', 'install', `--url=${url}`, ...install]);
	}

	const web =
		o.kind === 'bedrock'
			? root
			: o.kind === 'subdir-install'
				? path.join(root, 'app', 'public')
				: wpDir;
	const site: TestSite = {
		webRoot: web,
		db,
		prefix,
		wp,
		sql: (q) =>
			execFileSync(mysqlBin, [...mysqlArgs(q).slice(0, -2), db, '-N', '-e', q], {
				env,
				encoding: 'utf8',
			})
				.split('\n')
				.filter(Boolean),
		dbConn: (() => {
			const host = process.env.SR_DB_HOST as string;
			const sock = host.startsWith('localhost:') ? host.slice(10) : undefined;
			const [h, port] = sock ? ['localhost', '3306'] : host.split(':');
			return {
				host: h,
				port: Number(port) || 3306,
				socket: sock,
				name: db,
				user: process.env.SR_DB_USER as string,
				password: process.env.SR_DB_PASS ?? '',
			};
		})(),
		rt: { php, wpCliPhar: phar, env, wpPath: wpDir },
	};
	return site;
}

/**
 * Seed URL-bearing data in every form a real database has. `url` is the origin URL of the blog.
 * The PHP below is written with `String.raw`, so backslashes are exactly what PHP sees.
 */
export function seed(site: TestSite, url: string, urlOpt?: string): void {
	const host = url.replace(/^https?:\/\//, '');
	const code = String.raw`
$u = '${url}'; $h = '${host}';
$esc = str_replace('/', '\/', $u);        // JSON style:  https:\/\/host
$dbl = str_replace('/', '\\/', $u);       // double style: https:\\/\\/host
update_option('sr_plain', "visit $u/page now");
update_option('sr_serialized', array('a' => "$u/a", 'nested' => array('b' => "$u/b", 'n' => 5), 'len' => $u));
update_option('sr_json', '{"u":"' . $esc . '/j"}');
update_option('sr_rel', "<img src='//$h/x.png'>");
update_option('sr_http', 'http://' . $h . '/old');
update_option('sr_other', 'https://cdn.other-site.org/lib.js');
update_option('sr_mixed_case', 'HTTPS://' . strtoupper($h) . '/Up');
update_option('sr_email', array('contact@' . $h, 'john@mail.' . $h, 'text' => "mail contact@$h or see $h now"));
update_option('sr_gf', serialize(array('redirect' => $esc . '/thanks', 'plain' => "$u/p", 'json' => '{"x":"' . $esc . '"}')));
update_option('sr_dbl', '{"a":"' . $dbl . '/d"}');
update_option('sr_enc', 'https://x.org/?r=' . rawurlencode($u));
$id = wp_insert_post(array('post_title' => 'T', 'post_status' => 'publish', 'post_content' => "<a href='$u/p'>x</a> <!-- wp:image {\"url\":\"$esc/i.png\"} -->"));
update_post_meta($id, 'sr_meta', array('url' => "$u/m", 'list' => array("$u/1", "$u/2")));
global $wpdb; $wpdb->update($wpdb->posts, array('guid' => "$u/?p=$id"), array('ID' => $id));
`;
	site.wp(['eval', code], { url: urlOpt });
}
