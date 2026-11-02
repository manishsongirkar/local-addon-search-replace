import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	DEFAULT_OPTIONS,
	type ReplacePair,
	type RunOptions,
	type SiteContext,
	type TableInfo,
} from '../../src/common/types';
import { pairFlags } from '../../src/engine/plan';
import { type ExpandedPair } from '../../src/engine/urls';
import { chooseDelimiter } from '../../src/engine/validate';

export const table = (name: string, bytes = 100000): TableInfo => ({ name, bytes, rows: 10 });

export const pair = (
	search: string,
	replace: string,
	extra: Partial<ReplacePair> = {},
): ReplacePair => ({
	id: `${search}->${replace}`,
	search,
	replace,
	regex: false,
	enabled: true,
	origin: 'custom',
	...extra,
});

export const opts = (pairs: ReplacePair[], extra: Partial<RunOptions> = {}): RunOptions => ({
	...DEFAULT_OPTIONS,
	// Most tests check plain text pairs as typed. The default (ignore case) has its own tests.
	caseSensitive: true,
	pairs,
	...extra,
});

const WP_TABLES = [
	'commentmeta',
	'comments',
	'links',
	'options',
	'postmeta',
	'posts',
	'term_relationships',
	'term_taxonomy',
	'termmeta',
	'terms',
	'usermeta',
	'users',
];

export const singleCtx = (prefix = 'wp_', extra: Partial<SiteContext> = {}): SiteContext => ({
	wpPath: '/site/app/public',
	wpVersion: '6.8',
	prefix,
	multisite: false,
	subdomain: false,
	blogs: [
		{
			id: 1,
			domain: '',
			path: '/',
			siteurl: 'https://prod.example.net',
			home: 'https://prod.example.net',
			tablePrefix: prefix,
		},
	],
	tables: WP_TABLES.map((t) => table(`${prefix}${t}`)),
	...extra,
});

/** Multisite with sub-sites 2 and 3. `subdomain` picks the network type. */
export function multiCtx(subdomain: boolean, prefix = 'wp_'): SiteContext {
	const blog = (id: number, domain: string, path: string) => ({
		id,
		domain,
		path,
		siteurl: `https://${domain}${path === '/' ? '' : path.replace(/\/$/, '')}`,
		home: `https://${domain}${path === '/' ? '' : path.replace(/\/$/, '')}`,
		tablePrefix: id === 1 ? prefix : `${prefix}${id}_`,
	});
	const blogs = subdomain
		? [
				blog(1, 'prod.example.net', '/'),
				blog(2, 'one.prod.example.net', '/'),
				blog(3, 'two.prod.example.net', '/'),
			]
		: [
				blog(1, 'prod.example.net', '/'),
				blog(2, 'prod.example.net', '/one/'),
				blog(3, 'prod.example.net', '/two/'),
			];
	const network = ['blogs', 'site', 'sitemeta', 'signups', 'registration_log', 'blogmeta'];
	const perBlog = (p: string) => ['options', 'posts', 'postmeta'].map((t) => table(`${p}${t}`));
	return {
		...singleCtx(prefix),
		multisite: true,
		subdomain,
		blogs,
		tables: [
			...singleCtx(prefix).tables,
			...network.map((t) => table(`${prefix}${t}`)),
			...perBlog(`${prefix}2_`),
			...perBlog(`${prefix}3_`),
		],
	};
}

let phpOk: boolean | undefined;
export function hasPhp(): boolean {
	if (phpOk === undefined) {
		try {
			execFileSync('php', ['-r', 'echo 1;'], { stdio: 'pipe' });
			phpOk = true;
		} catch {
			phpOk = false;
		}
	}
	return phpOk;
}

/**
 * Apply one expanded pair to a string the way WP-CLI does: PHP `preg_replace`
 * for regex pairs, `str_replace` for plain pairs. Needs a `php` binary.
 */
export function phpApply(p: ExpandedPair, opts_: RunOptions, subject: string, bin = 'php'): string {
	const code = p.regex
		? 'echo preg_replace($argv[1], $argv[2], $argv[3]);'
		: 'echo str_replace($argv[1], $argv[2], $argv[3]);';
	const d = chooseDelimiter(p.search) ?? '/';
	const search = p.regex ? `${d}${p.search}${d}${pairFlags(p, opts_)}` : p.search;
	return execFileSync(bin, ['-r', code, '--', search, p.replace, subject], { encoding: 'utf8' });
}

/**
 * Every PHP binary we can test with: `php` on the PATH, the PHP builds that ship with Local, and `SR_PHP_BINS`
 * (a PATH-style list). CI adds the old versions (7.2 .. 8.0) through the PATH one at a time.
 */
export function phpBinaries(): Array<{ bin: string; version: string }> {
	const found = new Set<string>();
	if (hasPhp()) found.add('php');
	for (const b of (process.env.SR_PHP_BINS ?? '').split(path.delimiter)) if (b) found.add(b);
	const base =
		process.platform === 'win32'
			? path.join(process.env.APPDATA ?? '', 'Local')
			: path.join(
					os.homedir(),
					process.platform === 'darwin' ? 'Library/Application Support/Local' : '.config/Local',
				);
	const services = path.join(base, 'lightning-services');
	if (fs.existsSync(services)) {
		for (const d of fs.readdirSync(services).filter((n) => n.startsWith('php-'))) {
			const bins = path.join(services, d, 'bin');
			if (!fs.existsSync(bins)) continue;
			for (const arch of fs.readdirSync(bins)) {
				for (const rel of ['bin/php', 'php.exe', 'bin/php.exe']) {
					const p = path.join(bins, arch, rel);
					if (fs.existsSync(p)) found.add(p);
				}
			}
		}
	}
	const out: Array<{ bin: string; version: string }> = [];
	const seen = new Set<string>();
	for (const bin of found) {
		try {
			const version = execFileSync(bin, ['-r', 'echo PHP_VERSION;'], {
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore'],
			});
			if (!seen.has(version)) {
				seen.add(version);
				out.push({ bin, version });
			}
		} catch {
			// Not runnable here (wrong architecture, for example).
		}
	}
	return out.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
}
