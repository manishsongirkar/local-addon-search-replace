import { describe, expect, it } from 'vitest';
import {
	type WpRuntime,
	buildArgv,
	classifyError,
	extractJson,
	lineSplitter,
	runWp,
} from '../../src/engine/wpRunner';

const rt: WpRuntime = {
	php: 'php',
	wpCliPhar: '/r/wp-cli.phar',
	env: {},
	wpPath: '/site/app/public',
};

describe('buildArgv', () => {
	it('lifts the memory limit, sets the path, and skips plugins, themes and packages by default', () => {
		expect(buildArgv(rt, ['option', 'get', 'home'])).toEqual([
			'-d',
			'memory_limit=-1',
			'/r/wp-cli.phar',
			'--path=/site/app/public',
			'--skip-plugins',
			'--skip-themes',
			'--skip-packages',
			'option',
			'get',
			'home',
		]);
	});
	it.each([
		[{ plugins: false }, ['--skip-themes', '--skip-packages'], ['--skip-plugins']],
		[{ themes: false }, ['--skip-plugins', '--skip-packages'], ['--skip-themes']],
		[{ packages: false }, ['--skip-plugins', '--skip-themes'], ['--skip-packages']],
		[
			{ plugins: false, themes: false, packages: false },
			[],
			['--skip-plugins', '--skip-themes', '--skip-packages'],
		],
	])('each skip flag can be turned off alone: %j', (skip, present, absent) => {
		const a = buildArgv({ ...rt, skip }, []);
		for (const f of present) expect(a).toContain(f);
		for (const f of absent) expect(a).not.toContain(f);
	});
	it('adds --url only when set and not suppressed', () => {
		expect(buildArgv({ ...rt, urlArg: 'a.com' }, [])).toContain('--url=a.com');
		expect(
			buildArgv({ ...rt, urlArg: 'a.com' }, [], { noUrl: true }).some((a) => a.startsWith('--url')),
		).toBe(false);
		expect(buildArgv(rt, []).some((a) => a.startsWith('--url'))).toBe(false);
	});
	it('loadExtensions drops the plugin and theme skip flags, not the package flag', () => {
		const a = buildArgv(rt, [], { loadExtensions: true });
		expect(a).not.toContain('--skip-plugins');
		expect(a).not.toContain('--skip-themes');
		expect(a).toContain('--skip-packages');
	});
	it('keeps paths with spaces as one argument (Windows and macOS user folders)', () => {
		expect(
			buildArgv({ ...rt, wpPath: 'C:\\Users\\A B\\Local Sites\\x\\app\\public' }, []),
		).toContain('--path=C:\\Users\\A B\\Local Sites\\x\\app\\public');
	});
});

describe('lineSplitter', () => {
	it('joins chunks, handles CRLF, and flushes the last partial line', () => {
		const lines: string[] = [];
		const s = lineSplitter((l) => lines.push(l));
		s.push('one\r\ntw');
		s.push('o\nthr');
		s.push('ee');
		expect(lines).toEqual(['one', 'two']);
		s.end();
		expect(lines).toEqual(['one', 'two', 'three']);
		s.end();
		expect(lines).toHaveLength(3);
	});
});

describe('extractJson', () => {
	it('reads the payload between the markers and ignores PHP notices around it', () => {
		expect(
			extractJson<{ a: number }>('Notice: x\n@@SR_JSON@@{"a":1}@@SR_END@@\nDeprecated: y'),
		).toEqual({ a: 1 });
	});
	it('returns null without markers or with broken JSON', () => {
		expect(extractJson('nothing')).toBeNull();
		expect(extractJson('@@SR_JSON@@{bad@@SR_END@@')).toBeNull();
	});
	it('handles a multi-line payload', () => {
		expect(extractJson('@@SR_JSON@@{"a":\n[1,2]}@@SR_END@@')).toEqual({ a: [1, 2] });
	});
});

describe('classifyError', () => {
	it.each([
		['Error: Error establishing a database connection.', 'DB_DOWN'],
		[
			'Warning: mysqli_real_connect(): (HY000/2002): No such file or directory (mysql.sock)',
			'DB_DOWN',
		],
		['ERROR 1045 (28000): Access denied for user', 'DB_DOWN'],
		['Error: This does not seem to be a WordPress installation. wp-load.php', 'NO_WP'],
		['Error: The site you have requested is not installed.', 'NOT_INSTALLED'],
		["Error: Site 'a.com' not found. Verify DOMAIN_CURRENT_SITE", 'SITE_URL'],
		['Fatal error: Allowed memory size of 134217728 bytes exhausted', 'MEMORY'],
		['Error: The regex pattern is bad', 'BAD_REGEX'],
		['something else', 'UNKNOWN'],
	])('%s → %s', (stderr, code) => {
		expect(classifyError(stderr).code).toBe(code);
	});
	it('puts the first real error line in the message and is never empty', () => {
		expect(classifyError('Notice: n\nError: boom\nmore').message).toContain('Error: boom');
		expect(classifyError('').message).toBe('WP-CLI failed without a message.');
	});
});

describe('runWp', () => {
	it('reports a missing PHP binary as a failed result, not an exception', async () => {
		const r = await runWp({ ...rt, php: '/definitely/not/php', wpPath: process.cwd() }, ['--info']);
		expect(r.code).toBe(-1);
		expect(r.stderr).toMatch(/ENOENT/);
	});
});
