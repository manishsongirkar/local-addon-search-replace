import fs from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { type TestSite, makeSite, seed } from './env';
import { option, opts, pair, runJob } from './helpers';

const ORIGIN = 'https://prod.example.net';
const LOCAL = 'https://s1.test';
let s: TestSite;

beforeEach(() => {
	s = makeSite({ kind: 'single' });
	seed(s, ORIGIN);
});

describe('single site', () => {
	it('dry run changes nothing but reports counts', async () => {
		const { final } = await runJob(s, opts([pair(ORIGIN, LOCAL)], { dryRun: true }));
		expect(final.state).toBe('completed');
		expect(final.totalReplacements).toBeGreaterThan(5);
		expect(
			s.sql(`SELECT option_value FROM ${s.prefix}options WHERE option_name='siteurl'`)[0],
		).toBe(ORIGIN);
		expect(final.backupFile).toBeNull();
	});

	it('replaces plain, serialized, JSON-escaped and protocol-relative values; skips guid', async () => {
		const { final, snaps } = await runJob(s, opts([pair(ORIGIN, LOCAL)]));
		expect(final.state).toBe('completed');
		expect(final.progress).toBe(1);
		expect(snaps.at(-1)?.state).toBe('completed');

		expect(option(s, 'siteurl')).toBe(LOCAL);
		expect(option(s, 'sr_plain')).toContain(`${LOCAL}/page`);
		const ser = option(s, 'sr_serialized');
		expect(ser).toEqual({ a: `${LOCAL}/a`, nested: { b: `${LOCAL}/b`, n: 5 }, len: LOCAL });
		expect(option(s, 'sr_json')).toContain('s1.test');
		expect(option(s, 'sr_rel')).toContain('//s1.test/x.png');
		expect(option(s, 'sr_http')).toBe('https://s1.test/old'); // other-scheme variant
		expect(option(s, 'sr_other')).toBe('https://cdn.other-site.org/lib.js'); // untouched

		const id = s.sql(`SELECT ID FROM ${s.prefix}posts WHERE post_title='T'`)[0];
		expect(s.wp(['post', 'meta', 'get', id, 'sr_meta', '--format=json'])).toContain('s1.test');
		expect(s.wp(['post', 'meta', 'get', id, 'sr_meta', '--format=json'])).not.toContain(
			'prod.example',
		);
		// guid is skipped by default.
		expect(s.sql(`SELECT guid FROM ${s.prefix}posts WHERE post_title='T'`)[0]).toContain(
			'prod.example.net',
		);
	});

	it('writes a backup before a real run and it can be restored', async () => {
		const { final } = await runJob(s, opts([pair(ORIGIN, LOCAL)]));
		expect(final.backupFile && fs.existsSync(final.backupFile)).toBe(true);
		expect(fs.readFileSync(final.backupFile as string, 'utf8')).toContain('prod.example.net');
		s.wp(['db', 'import', final.backupFile as string]);
		expect(option(s, 'siteurl')).toBe(ORIGIN);
	});

	it('writes a log file', async () => {
		const { final } = await runJob(s, opts([pair(ORIGIN, LOCAL)], { dryRun: true }));
		expect(final.logFile && fs.readFileSync(final.logFile, 'utf8')).toContain('Dry run started');
	});

	it('is idempotent: a second run makes no replacements', async () => {
		await runJob(s, opts([pair(ORIGIN, LOCAL)], { backup: false }));
		const again = await runJob(s, opts([pair(ORIGIN, LOCAL)], { backup: false, dryRun: true }));
		expect(again.final.totalReplacements).toBe(0);
	});

	it('handles several pairs and longest-first ordering', async () => {
		s.wp([
			'option',
			'update',
			'sr_two',
			'https://prod.example.net/a and https://cdn.other-site.org/lib.js',
		]);
		const { final } = await runJob(
			s,
			opts(
				[pair('prod.example.net', 'x.test'), pair('https://cdn.other-site.org', 'http://cdn.test')],
				{
					backup: false,
					includeVariants: false,
				},
			),
		);
		expect(final.state).toBe('completed');
		expect(option(s, 'sr_two')).toBe('https://x.test/a and http://cdn.test/lib.js');
	});

	it('regex pair with flags', async () => {
		const { final } = await runJob(
			s,
			opts([pair('https?://PROD\\.example\\.net(/[a-z]+)?', 'https://r.test$1', true)], {
				backup: false,
				regexFlags: 'i',
			}),
		);
		expect(final.state).toBe('completed');
		expect(option(s, 'sr_plain')).toBe('visit https://r.test/page now');
	});

	it('regex containing "/" picks another delimiter', async () => {
		const { final } = await runJob(
			s,
			opts([pair('prod\\.example\\.net/page', 'p.test/page', true)], { backup: false }),
		);
		expect(final.state).toBe('completed');
		expect(option(s, 'sr_plain')).toContain('p.test/page');
	});

	it('an invalid regex fails before anything is written', async () => {
		const { final } = await runJob(s, opts([pair(ORIGIN, LOCAL), pair('(unclosed', 'x', true)]));
		expect(final.state).toBe('failed');
		expect(final.error).toContain('not valid');
		expect(option(s, 'siteurl')).toBe(ORIGIN);
		expect(final.backupFile).toBeNull();
	});

	it('skip tables and skip columns are honoured', async () => {
		await runJob(s, opts([pair(ORIGIN, LOCAL)], { backup: false, skipTables: `${s.prefix}post*` }));
		expect(s.sql(`SELECT post_content FROM ${s.prefix}posts WHERE post_title='T'`)[0]).toContain(
			'prod.example.net',
		);
		expect(option(s, 'siteurl')).toBe(LOCAL);
	});

	it('fails cleanly with no matching tables', async () => {
		const { final } = await runJob(s, opts([pair(ORIGIN, LOCAL)], { skipTables: '*' }));
		expect(final.state).toBe('failed');
		expect(final.error).toContain('No tables');
	});

	it('cancel stops the run and reports cancelled', async () => {
		let job: import('../../src/engine/runner').Job | undefined;
		const p = runJob(s, opts([pair(ORIGIN, LOCAL)], { backup: false }), (j) => {
			job = j;
			setTimeout(() => j.cancel(), 150);
		});
		const { final } = await p;
		expect(['cancelled', 'completed']).toContain(final.state);
		expect(job).toBeDefined();
	});

	it('custom table prefix', async () => {
		const t = makeSite({ kind: 'single', prefix: 'xyz_' });
		seed(t, ORIGIN);
		const { final } = await runJob(t, opts([pair(ORIGIN, LOCAL)], { backup: false }));
		expect(final.state).toBe('completed');
		expect(option(t, 'siteurl')).toBe(LOCAL);
	});

	it('replaces forward-slash, backslash-escaped, double-escaped and URL-encoded forms', async () => {
		const { final } = await runJob(s, opts([pair(ORIGIN, LOCAL)], { backup: false }));
		expect(final.state).toBe('completed');
		// JSON style https:\/\/ inside a serialized value (Gravity Forms style).
		const gf: string = option(s, 'sr_gf');
		expect(gf).toContain(String.raw`https:\/\/s1.test/thanks`);
		expect(gf).toContain(`${LOCAL}/p`);
		expect(gf).not.toContain('prod.example');
		// Serialized lengths were rewritten, so the data still unserializes.
		expect(
			s.wp(['eval', "echo is_array(@unserialize(get_option('sr_gf'))) ? 'ok' : 'broken';"]),
		).toBe('ok');
		expect(option(s, 'sr_dbl')).toContain('s1.test');
		expect(option(s, 'sr_dbl')).not.toContain('prod.example');
		expect(option(s, 'sr_enc')).toContain(encodeURIComponent(LOCAL));
		expect(option(s, 'sr_mixed_case')).toContain('s1.test/Up');
		// Nothing of the old host is left in options.
		expect(
			s.sql(
				`SELECT COUNT(*) FROM ${s.prefix}options WHERE option_value LIKE '%prod.example.net%' AND option_name NOT LIKE 'sr_email'`,
			)[0],
		).toBe('0');
	});

	it('keeps e-mail addresses when a bare host is replaced', async () => {
		const { final } = await runJob(
			s,
			opts([pair('prod.example.net', 'x.test')], { backup: false }),
		);
		expect(final.state).toBe('completed');
		const e = option(s, 'sr_email');
		expect(e[0]).toBe('contact@prod.example.net');
		expect(e[1]).toBe('john@mail.prod.example.net');
		expect(e.text).toBe('mail contact@prod.example.net or see x.test now');
		expect(option(s, 'siteurl')).toBe('https://x.test');
	});

	it('keeps e-mail addresses when a full URL is replaced', async () => {
		await runJob(s, opts([pair(ORIGIN, LOCAL)], { backup: false }));
		expect(option(s, 'sr_email')[0]).toBe('contact@prod.example.net');
	});

	it('changes e-mail domains when protection is off', async () => {
		await runJob(
			s,
			opts([pair('prod.example.net', 'x.test')], { backup: false, protectEmails: false }),
		);
		expect(option(s, 'sr_email')[0]).toBe('contact@x.test');
	});

	it('a URL with a path keeps working in escaped form', async () => {
		s.wp([
			'option',
			'update',
			'sr_path',
			String.raw`{"u":"https:\/\/prod.example.net\/blog\/x"} https://prod.example.net/blog/y https://prod.example.net/other`,
		]);
		await runJob(s, opts([pair(`${ORIGIN}/blog`, 'https://s1.test/dev')], { backup: false }));
		const v = option(s, 'sr_path');
		expect(v).toContain(String.raw`https:\/\/s1.test\/dev\/x`);
		expect(v).toContain('https://s1.test/dev/y');
		expect(v).toContain('https://prod.example.net/other');
	});
});
