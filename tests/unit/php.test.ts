import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { expandVariants, networkHostPair, protectEmails } from '../../src/engine/urls';
import { opts, phpApply, phpBinaries } from './helpers';

const PHP_DIR = path.resolve(__dirname, '..', '..', 'php');
const files = fs.readdirSync(PHP_DIR).filter((f) => f.endsWith('.php'));
const versions = phpBinaries();

/** WordPress needs PHP 7.2.24 or newer, and Local ships 7.4 to 8.5. These scripts must run on all of them. */
describe('PHP scripts: syntax that needs a newer PHP than 7.2 is not used', () => {
	const banned: Array<[string, RegExp]> = [
		['arrow function (7.4)', /\bfn\s*\(/],
		['null-safe operator (8.0)', /\?->/],
		['match expression (8.0)', /\bmatch\s*\(/],
		[
			'str_contains / str_starts_with / str_ends_with (8.0)',
			/\bstr_(contains|starts_with|ends_with)\s*\(/,
		],
		['null coalescing assignment (7.4)', /\?\?=/],
		[
			'array_key_first / array_key_last / is_countable (7.3)',
			/\b(array_key_first|array_key_last|is_countable)\s*\(/,
		],
		['JSON_THROW_ON_ERROR (7.3)', /JSON_THROW_ON_ERROR/],
		[
			'typed property or mixed type (7.4 / 8.0)',
			/^\s*(public|protected|private)\s+(int|string|array|bool|float|\?)\w*\s+\$/m,
		],
		['attribute (8.0)', /^\s*#\[/m],
		['enum / readonly (8.1)', /^\s*(enum|readonly)\s/m],
		[
			'constructor promotion (8.0)',
			/function\s+__construct\s*\([^)]*\b(public|private|protected)\s/,
		],
		['spread of string keys / named arguments (8.0)', /\(\s*\w+:\s*[$'"\d]/],
	];
	it.each(files)('%s', (f) => {
		const src = fs.readFileSync(path.join(PHP_DIR, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
		for (const [name, re] of banned) expect(re.test(src), `${f}: ${name}`).toBe(false);
	});
	it('every script says which PHP versions it supports', () => {
		for (const f of files.filter((x) => x !== 'preg-check.php')) {
			expect(fs.readFileSync(path.join(PHP_DIR, f), 'utf8'), f).toMatch(/PHP 7\.2/);
		}
	});
});

describe.skipIf(versions.length === 0)(
	`PHP scripts on every PHP found here (${versions.map((v) => v.version).join(', ') || 'none'})`,
	() => {
		it.each(versions.map((v) => [v.version, v.bin]))(
			'PHP %s: every script is valid and prints no deprecation',
			(_v, bin) => {
				for (const f of files) {
					const out = execFileSync(
						bin,
						['-d', 'error_reporting=-1', '-d', 'display_errors=1', '-l', path.join(PHP_DIR, f)],
						{ encoding: 'utf8' },
					);
					expect(out, f).toMatch(/No syntax errors/);
					expect(out, f).not.toMatch(/Deprecated|Warning/);
				}
			},
		);
		it.each(versions.map((v) => [v.version, v.bin]))(
			'PHP %s: preg-check says ok or invalid',
			(_v, bin) => {
				const run = (p: string) =>
					execFileSync(bin, [path.join(PHP_DIR, 'preg-check.php'), p], {
						encoding: 'utf8',
						stdio: ['ignore', 'pipe', 'ignore'],
					});
				expect(run('/a+b/i')).toBe('ok');
				expect(run('#https?://x\\.com(*SKIP)(*FAIL)|y#i')).toBe('ok');
				expect(run('/(unclosed/')).toBe('invalid');
				expect(run('/a/zz')).toBe('invalid');
			},
		);
		it('the generated regexes give the same result on every PHP version', () => {
			const cases: Array<[ReturnType<typeof expandVariants>, string, string]> = [
				[
					expandVariants({ search: 'https://prod.example.net', replace: 'https://my.test' }),
					'a https://prod.example.net/x {"u":"https:\\/\\/prod.example.net\\/j"} //prod.example.net/i r=https%3A%2F%2Fprod.example.net HTTP://PROD.EXAMPLE.NET',
					'a https://my.test/x {"u":"https:\\/\\/my.test\\/j"} //my.test/i r=https%3A%2F%2Fmy.test https://my.test',
				],
				[
					[protectEmails('prod.example.net', 'my.test')],
					'a@prod.example.net prod.example.net b@mail.prod.example.net',
					'a@prod.example.net my.test b@mail.prod.example.net',
				],
				[
					[
						networkHostPair({
							search: 'https://prod.example.net',
							replace: 'https://my.test',
						}) as never,
					],
					'prod.example.net admin@prod.example.net',
					'my.test admin@prod.example.net',
				],
			];
			const o = opts([]);
			for (const { bin, version } of versions) {
				for (const [steps, input, expected] of cases) {
					const out = steps.reduce((s, p) => phpApply(p, o, s, bin), input);
					expect(out, `PHP ${version}`).toBe(expected);
				}
			}
		});
	},
);
