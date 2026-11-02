import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareFingerprints, readFingerprint } from '../../src/engine/fingerprint';
import { scanDomains } from '../../src/engine/scan';
import { type TestSite, makeSite, seed } from './env';
import { opts, pair, runJob } from './helpers';

const ORIGIN = 'https://prod.example.net';
const O = 'prod.example.net';
const LOCAL = 'https://s1.test';

/** WP-CLI cannot start (the phar is missing), but the database is reachable. */
const broken = (s: TestSite) => ({ ...s.rt, wpCliPhar: '/nonexistent/wp-cli.phar', db: s.dbConn });

const options = (s: TestSite) =>
	s.sql(
		`SELECT CONCAT(option_name, '=', option_value) FROM ${s.prefix}options WHERE option_name LIKE 'sr\\_%' OR option_name IN ('siteurl','home') ORDER BY option_name`,
	);

function multisite(kind: 'multisite-subdir' | 'multisite-subdomain'): TestSite {
	const s = makeSite({ kind });
	const sub = (slug: string) =>
		kind === 'multisite-subdir' ? `https://${O}/${slug}` : `https://${slug}.${O}`;
	for (const slug of ['blog2', 'blog3']) {
		s.wp(['site', 'create', `--slug=${slug}`, `--title=${slug}`], { url: ORIGIN });
		for (const o of ['siteurl', 'home'])
			s.wp(['option', 'update', o, sub(slug)], { url: sub(slug).replace('https:', 'http:') });
		seed(s, sub(slug), sub(slug));
	}
	seed(s, ORIGIN, ORIGIN);
	return s;
}

describe('fallback: WP-CLI cannot run', () => {
	it('single site: the scan and the run work and store exactly the data WP-CLI stores', async () => {
		const a = makeSite({ kind: 'single' });
		const b = makeSite({ kind: 'single' });
		seed(a, ORIGIN);
		seed(b, ORIGIN);
		const viaCli = await runJob(a, opts([pair(ORIGIN, LOCAL)], { backup: false }));
		const viaFallback = await runJob(b, opts([pair(ORIGIN, LOCAL)], { backup: false }), undefined, {
			rt: broken(b),
		});

		expect(viaCli.context.fallback).toBeUndefined();
		expect(viaFallback.context.fallback).toBe(true);
		expect(viaFallback.context.prefix).toBe(viaCli.context.prefix);
		expect(viaFallback.context.tables.map((t) => t.name).sort()).toEqual(
			viaCli.context.tables.map((t) => t.name).sort(),
		);
		expect(viaFallback.final.state).toBe('completed');
		// The number of occurrences is counted differently (WP-CLI counts fewer in serialized data). The stored data must be equal.
		expect(viaFallback.final.totalReplacements).toBeGreaterThan(5);
		expect(options(b)).toEqual(options(a));
		for (const q of [
			`SELECT post_content FROM ${a.prefix}posts WHERE post_title='T'`,
			`SELECT meta_value FROM ${a.prefix}postmeta WHERE meta_key='sr_meta'`,
		]) {
			expect(b.sql(q)).toEqual(a.sql(q));
		}
		expect(viaFallback.logs.some((l) => l.level === 'warn' && /fallback/i.test(l.text))).toBe(
			false,
		); // no WP-CLI try, no noise
	});

	it('the domain scan finds the origin without WP-CLI', async () => {
		const s = makeSite({ kind: 'single' });
		seed(s, ORIGIN);
		const { context } = await runJob(s, opts([pair(ORIGIN, LOCAL)], { dryRun: true }), undefined, {
			rt: broken(s),
		});
		const c = await scanDomains(broken(s), context, LOCAL);
		expect(c.find((x) => x.preselected)?.value).toBe(ORIGIN);
		expect(c.find((x) => x.value === 'https://cdn.other-site.org')).toBeTruthy();
	});

	it('tables with generated columns (MySQL 5.7+, MariaDB 10.2+) are changed without touching them', async () => {
		const s = makeSite({ kind: 'single' });
		seed(s, ORIGIN);
		s.sql(
			`CREATE TABLE ${s.prefix}gen (id INT PRIMARY KEY, v VARCHAR(200), v_len INT AS (CHAR_LENGTH(v)) VIRTUAL, v_up VARCHAR(200) AS (UPPER(v)) STORED); INSERT INTO ${s.prefix}gen (id, v) VALUES (1, '${ORIGIN}/g')`,
		);
		const { final } = await runJob(s, opts([pair(ORIGIN, LOCAL)], { backup: false }), undefined, {
			rt: broken(s),
		});
		expect(final.state).toBe('completed');
		expect(s.sql(`SELECT v, v_len FROM ${s.prefix}gen`)[0]).toBe(`${LOCAL}/g\t${LOCAL.length + 2}`);
	});

	it('a dry run changes nothing', async () => {
		const s = makeSite({ kind: 'single' });
		seed(s, ORIGIN);
		const before = options(s);
		const { final } = await runJob(s, opts([pair(ORIGIN, LOCAL)], { dryRun: true }), undefined, {
			rt: broken(s),
		});
		expect(final.state).toBe('completed');
		expect(final.totalReplacements).toBeGreaterThan(5);
		expect(options(s)).toEqual(before);
	});

	it('multisite sub-directory: the network, wp_blogs, wp_site and every sub-site are updated', async () => {
		const s = multisite('multisite-subdir');
		const { final, context } = await runJob(
			s,
			opts([pair(ORIGIN, 'https://ms.test')], { backup: false }),
			undefined,
			{ rt: broken(s) },
		);
		expect(context.fallback).toBe(true);
		expect(context.multisite).toBe(true);
		expect(context.subdomain).toBe(false);
		expect(context.blogs.map((b) => b.id)).toEqual([1, 2, 3]);
		expect(final.state).toBe('completed');
		expect(s.sql(`SELECT domain FROM ${s.prefix}blogs ORDER BY blog_id`)).toEqual([
			'ms.test',
			'ms.test',
			'ms.test',
		]);
		expect(s.sql(`SELECT domain FROM ${s.prefix}site`)).toEqual(['ms.test']);
		expect(
			s.sql(`SELECT option_value FROM ${s.prefix}2_options WHERE option_name='siteurl'`)[0],
		).toBe('https://ms.test/blog2');
		expect(
			s.sql(`SELECT COUNT(*) FROM ${s.prefix}3_options WHERE option_value LIKE '%//${O}%'`)[0],
		).toBe('0');
	});

	it('multisite sub-domain: detected as a sub-domain network and the sub-site hosts are offered', async () => {
		const s = multisite('multisite-subdomain');
		const { context } = await runJob(
			s,
			opts([pair(ORIGIN, 'https://ms.test')], { dryRun: true }),
			undefined,
			{ rt: broken(s) },
		);
		expect(context.subdomain).toBe(true);
		const c = await scanDomains(broken(s), context, 'https://ms.test');
		const b2 = c.find((x) => x.value === `https://blog2.${O}`);
		expect(b2).toMatchObject({ suggestedReplace: 'https://blog2.ms.test', preselected: true });
		expect(c.find((x) => x.value === ORIGIN)?.sources).toEqual(expect.arrayContaining(['wp_site']));
	});

	it('mysqldump backup works when WP-CLI cannot run', async () => {
		const s = makeSite({ kind: 'single' });
		seed(s, ORIGIN);
		const bin = process.env.SR_MYSQL_BIN ? `${process.env.SR_MYSQL_BIN}/mysqldump` : 'mysqldump';
		const rt = { ...broken(s), db: { ...s.dbConn, mysqldump: bin } };
		const { final } = await runJob(s, opts([pair(ORIGIN, LOCAL)]), undefined, { rt });
		expect(final.state).toBe('completed');
		expect(final.backupFile).toMatch(/\.sql$/);
		expect(fs.readFileSync(final.backupFile as string, 'utf8')).toContain('CREATE TABLE');
	});
});

describe('big database: pre-scan and parallel workers', () => {
	it('the pre-scan skips tables without the domain and the result is the same as without it', async () => {
		const a = makeSite({ kind: 'single' });
		const b = makeSite({ kind: 'single' });
		seed(a, ORIGIN);
		seed(b, ORIGIN);
		await runJob(a, opts([pair(ORIGIN, LOCAL)], { backup: false }));
		const { final, logs } = await runJob(
			b,
			opts([pair(ORIGIN, LOCAL)], { backup: false }),
			undefined,
			{ prefilterMinBytes: 0 },
		);
		expect(final.state).toBe('completed');
		const m = logs.map((l) => /Pre-scan: (\d+) of (\d+) table/.exec(l.text)).find(Boolean);
		expect(m).toBeTruthy();
		expect(Number(m?.[1])).toBeLessThan(Number(m?.[2]));
		expect(Number(m?.[1])).toBeGreaterThan(0);
		expect(options(b)).toEqual(options(a));
		expect(final.tablesTotal).toBeLessThan(25);
	});

	it('a domain that no table contains ends the run at once, without a backup', async () => {
		const s = makeSite({ kind: 'single' });
		seed(s, ORIGIN);
		const { final, logs } = await runJob(
			s,
			opts([pair('https://not-in-db.example.org', LOCAL)]),
			undefined,
			{ prefilterMinBytes: 0 },
		);
		expect(final.state).toBe('completed');
		expect(final.totalReplacements).toBe(0);
		expect(final.backupFile).toBeNull();
		expect(logs.some((l) => /Nothing to replace/.test(l.text))).toBe(true);
	});

	it('a user regex still runs on every table when the pre-scan is on', async () => {
		const s = makeSite({ kind: 'single' });
		seed(s, ORIGIN);
		s.sql(
			`CREATE TABLE ${s.prefix}plain_data (id INT PRIMARY KEY, v TEXT); INSERT INTO ${s.prefix}plain_data VALUES (1, 'color: red')`,
		);
		const { final } = await runJob(
			s,
			opts([pair(ORIGIN, LOCAL), pair('colo(u)?r', 'tint', true)], { backup: false }),
			undefined,
			{ prefilterMinBytes: 0 },
		);
		expect(final.state).toBe('completed');
		expect(s.sql(`SELECT v FROM ${s.prefix}plain_data`)[0]).toBe('tint: red');
	});

	it('several workers at once give the same data and never two steps on one table', async () => {
		const a = makeSite({ kind: 'single' });
		const b = makeSite({ kind: 'single' });
		for (const s of [a, b]) {
			seed(s, ORIGIN);
			for (let i = 0; i < 8; i++) {
				s.sql(
					`CREATE TABLE ${s.prefix}extra${i} (id INT PRIMARY KEY, v LONGTEXT); INSERT INTO ${s.prefix}extra${i} VALUES (1, '${ORIGIN}/p${i} and http://${O}/q${i}')`,
				);
			}
		}
		await runJob(
			a,
			opts([pair(ORIGIN, LOCAL), pair(`${ORIGIN}/blog`, `${LOCAL}/news`)], {
				backup: false,
				workers: 1,
			}),
		);
		const { final, snaps } = await runJob(
			b,
			opts([pair(ORIGIN, LOCAL), pair(`${ORIGIN}/blog`, `${LOCAL}/news`)], {
				backup: false,
				workers: 4,
			}),
		);
		expect(final.state).toBe('completed');
		expect(final.workers).toBe(4);
		expect(snaps.some((x) => x.activeTables.length > 1)).toBe(true);
		for (let i = 0; i < 8; i++) {
			expect(b.sql(`SELECT v FROM ${b.prefix}extra${i}`)).toEqual(
				a.sql(`SELECT v FROM ${a.prefix}extra${i}`),
			);
		}
		expect(options(b)).toEqual(options(a));
		const p = snaps.map((x) => x.progress);
		expect(p).toEqual([...p].sort((x, y) => x - y));
	});
});

describe('--all-tables and --network', () => {
	const setup = (s: TestSite) => {
		seed(s, ORIGIN);
		// A plugin table WordPress does not register, and a table of another application.
		s.sql(
			`CREATE TABLE ${s.prefix}plugin_data (id INT PRIMARY KEY, v TEXT); INSERT INTO ${s.prefix}plugin_data VALUES (1, '${ORIGIN}/x')`,
		);
		s.sql(
			`CREATE TABLE other_app (id INT PRIMARY KEY, v TEXT); INSERT INTO other_app VALUES (1, '${ORIGIN}/y')`,
		);
	};
	it('default (all tables): unregistered plugin tables and tables without the prefix are changed', async () => {
		const s = makeSite({ kind: 'single' });
		setup(s);
		const { final } = await runJob(s, opts([pair(ORIGIN, LOCAL)], { backup: false }));
		expect(final.state).toBe('completed');
		expect(s.sql(`SELECT v FROM ${s.prefix}plugin_data`)[0]).toBe(`${LOCAL}/x`);
		expect(s.sql('SELECT v FROM other_app')[0]).toBe(`${LOCAL}/y`);
	});
	it('all tables off: the plugin table with the prefix is still changed, the other application is not', async () => {
		const s = makeSite({ kind: 'single' });
		setup(s);
		const { final } = await runJob(
			s,
			opts([pair(ORIGIN, LOCAL)], { backup: false, allTables: false }),
		);
		expect(final.state).toBe('completed');
		expect(s.sql(`SELECT v FROM ${s.prefix}plugin_data`)[0]).toBe(`${LOCAL}/x`);
		expect(s.sql('SELECT v FROM other_app')[0]).toBe(`${ORIGIN}/y`);
	});
	for (const allTables of [true, false]) {
		it(`multisite sub-directory, all tables ${allTables ? 'on' : 'off'}: network and every sub-site table are changed`, async () => {
			const s = multisite('multisite-subdir');
			s.sql(
				`CREATE TABLE ${s.prefix}3_plugin_data (id INT PRIMARY KEY, v TEXT); INSERT INTO ${s.prefix}3_plugin_data VALUES (1, '${ORIGIN}/blog3/z')`,
			);
			const { final } = await runJob(
				s,
				opts([pair(ORIGIN, 'https://ms.test')], { backup: false, allTables }),
			);
			expect(final.state).toBe('completed');
			expect(s.sql(`SELECT domain FROM ${s.prefix}site`)).toEqual(['ms.test']);
			expect(s.sql(`SELECT domain FROM ${s.prefix}blogs ORDER BY blog_id`)).toEqual([
				'ms.test',
				'ms.test',
				'ms.test',
			]);
			expect(
				s.sql(`SELECT option_value FROM ${s.prefix}2_options WHERE option_name='siteurl'`)[0],
			).toBe('https://ms.test/blog2');
			expect(s.sql(`SELECT v FROM ${s.prefix}3_plugin_data`)[0]).toBe('https://ms.test/blog3/z');
		});
	}
	it('multisite sub-domain with workers: every sub-site host is replaced', async () => {
		const s = multisite('multisite-subdomain');
		const pairs = [
			pair(ORIGIN, 'https://ms.test'),
			pair(`https://blog2.${O}`, 'https://blog2.ms.test'),
			pair(`https://blog3.${O}`, 'https://blog3.ms.test'),
		];
		const { final } = await runJob(s, opts(pairs, { backup: false, workers: 3 }));
		expect(final.state).toBe('completed');
		expect(s.sql(`SELECT domain FROM ${s.prefix}blogs ORDER BY blog_id`)).toEqual([
			'ms.test',
			'blog2.ms.test',
			'blog3.ms.test',
		]);
		expect(s.sql(`SELECT domain FROM ${s.prefix}site`)).toEqual(['ms.test']);
	});
});

describe('options: case sensitive and replace GUID', () => {
	const setup = (s: TestSite) => {
		seed(s, ORIGIN);
		s.sql(
			`CREATE TABLE ${s.prefix}notes (id INT PRIMARY KEY, v TEXT); INSERT INTO ${s.prefix}notes VALUES (1, 'Acme Corp'), (2, 'ACME CORP'), (3, 'acme corp'), (4, 'x acme corp (the Acme Corp team)')`,
		);
	};
	const notes = (s: TestSite) => s.sql(`SELECT v FROM ${s.prefix}notes ORDER BY id`);
	it('off (the default): every case of a plain text pair is replaced', async () => {
		const s = makeSite({ kind: 'single' });
		setup(s);
		const { final } = await runJob(
			s,
			opts([pair('Acme Corp', 'Beta Inc')], { backup: false, caseSensitive: false }),
		);
		expect(final.state).toBe('completed');
		expect(notes(s)).toEqual([
			'Beta Inc',
			'Beta Inc',
			'Beta Inc',
			'x Beta Inc (the Beta Inc team)',
		]);
	});
	it('on: only the exact case is replaced', async () => {
		const s = makeSite({ kind: 'single' });
		setup(s);
		await runJob(s, opts([pair('Acme Corp', 'Beta Inc')], { backup: false, caseSensitive: true }));
		expect(notes(s)).toEqual([
			'Beta Inc',
			'ACME CORP',
			'acme corp',
			'x acme corp (the Beta Inc team)',
		]);
	});
	it('off: a domain in capitals is found in plain, serialized and escaped forms; on: it is not', async () => {
		for (const [cs, expected] of [
			[false, 'https://s1.test/Up'],
			[true, 'HTTPS://PROD.EXAMPLE.NET/Up'],
		] as const) {
			const s = makeSite({ kind: 'single' });
			seed(s, ORIGIN);
			await runJob(s, opts([pair(ORIGIN, LOCAL)], { backup: false, caseSensitive: cs }));
			expect(
				s.sql(`SELECT option_value FROM ${s.prefix}options WHERE option_name='sr_mixed_case'`)[0],
			).toBe(expected);
		}
	});
	it('replace GUID off (the default): the guid column is left alone; on: it is replaced', async () => {
		const guid = (s: TestSite) =>
			s.sql(`SELECT guid FROM ${s.prefix}posts WHERE post_title='T'`)[0];
		const off = makeSite({ kind: 'single' });
		seed(off, ORIGIN);
		await runJob(off, opts([pair(ORIGIN, LOCAL)], { backup: false }));
		expect(guid(off)).toMatch(/^https:\/\/prod\.example\.net\/\?p=\d+$/);
		const on = makeSite({ kind: 'single' });
		seed(on, ORIGIN);
		await runJob(on, opts([pair(ORIGIN, LOCAL)], { backup: false, replaceGuid: true }));
		expect(guid(on)).toMatch(/^https:\/\/s1\.test\/\?p=\d+$/);
	});
	it('replace GUID also works through the fallback', async () => {
		const s = makeSite({ kind: 'single' });
		seed(s, ORIGIN);
		await runJob(s, opts([pair(ORIGIN, LOCAL)], { backup: false, replaceGuid: true }), undefined, {
			rt: broken(s),
		});
		expect(s.sql(`SELECT guid FROM ${s.prefix}posts WHERE post_title='T'`)[0]).toMatch(
			/^https:\/\/s1\.test\//,
		);
	});
	it('dry run changes nothing and makes no backup', async () => {
		const s = makeSite({ kind: 'single' });
		setup(s);
		const before = notes(s);
		const { final } = await runJob(
			s,
			opts([pair('Acme Corp', 'Beta Inc')], { dryRun: true, caseSensitive: false }),
		);
		expect(final.state).toBe('completed');
		expect(final.totalReplacements).toBeGreaterThan(0);
		expect(final.backupFile).toBeNull();
		expect(notes(s)).toEqual(before);
	});
});

describe('database changes are found, however the database was imported', () => {
	const rtDb = (s: TestSite) => ({ ...s.rt, db: s.dbConn });
	const read = async (s: TestSite) =>
		(await readFingerprint(rtDb(s))) as NonNullable<Awaited<ReturnType<typeof readFingerprint>>>;
	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
	// Table creation times have a resolution of one second. A real import is never in the same second as the install.
	const OTHER_SECOND = 1200;
	const dump = (s: TestSite, name: string) => {
		const file = `${s.webRoot}/../${name}.sql`;
		s.wp(['db', 'export', file, '--add-drop-table']);
		return file;
	};

	it('nothing changed: the same fingerprint, no change', async () => {
		const s = makeSite({ kind: 'single' });
		seed(s, ORIGIN);
		const a = await read(s);
		expect(compareFingerprints(a, await read(s)).changed).toBe(false);
		expect(a.count).toBeGreaterThan(10);
	});

	it('WordPress writing options all the time (cron, transients) is not a change', async () => {
		const s = makeSite({ kind: 'single' });
		seed(s, ORIGIN);
		const a = await read(s);
		s.sql(
			`UPDATE ${s.prefix}options SET option_value='x' WHERE option_name='sr_plain'; INSERT INTO ${s.prefix}options (option_name, option_value) VALUES ('_transient_x', '1')`,
		);
		expect(compareFingerprints(a, await read(s)).changed).toBe(false);
	});

	it('an import with WP-CLI (wp db import) is found', async () => {
		const s = makeSite({ kind: 'single' });
		seed(s, ORIGIN);
		const file = dump(s, 'cli-import');
		const before = await read(s);
		await sleep(OTHER_SECOND);
		s.wp(['db', 'import', file]);
		const change = compareFingerprints(before, await read(s));
		expect(change.changed).toBe(true);
		expect(change.reason).toMatch(/created again|replaced/);
	});

	it('an import with plain SQL through the mysql client, which is what phpMyAdmin sends, is found', async () => {
		const s = makeSite({ kind: 'single' });
		seed(s, ORIGIN);
		const file = dump(s, 'pma-import');
		const sql = fs.readFileSync(file, 'utf8');
		const before = await read(s);
		await sleep(OTHER_SECOND);
		// The dump is plain SQL: the same statements a web import tool sends.
		s.sql(sql);
		expect(compareFingerprints(before, await read(s)).changed).toBe(true);
	});

	it('an imported database with another site URL is found, and the rescan lists that domain', async () => {
		const s = makeSite({ kind: 'single' });
		seed(s, ORIGIN);
		const before = await read(s);
		await sleep(OTHER_SECOND);
		s.sql(
			`UPDATE ${s.prefix}options SET option_value='https://new-live.example.net' WHERE option_name IN ('siteurl','home')`,
		);
		const change = compareFingerprints(before, await read(s));
		expect(change.changed).toBe(true);
		expect(change.reason).toMatch(/site URL/);
		const { context } = await runJob(s, opts([pair(ORIGIN, LOCAL)], { dryRun: true }), undefined, {
			rt: broken(s),
		});
		const c = await scanDomains(broken(s), context, LOCAL);
		expect(c.some((x) => x.value === 'https://new-live.example.net' && x.primary)).toBe(true);
	});

	it('a network: a changed sub-site domain is found', async () => {
		const s = multisite('multisite-subdomain');
		const before = await read(s);
		s.sql(`UPDATE ${s.prefix}blogs SET domain='renamed.${O}' WHERE blog_id=2`);
		expect(compareFingerprints(before, await read(s)).changed).toBe(true);
	});

	it('a database that cannot be reached gives no reading, and no change is claimed', async () => {
		const s = makeSite({ kind: 'single' });
		const bad = { ...s.rt, db: { ...s.dbConn, name: 'no_such_database_here' } };
		expect(await readFingerprint(bad)).toBeNull();
		expect(await readFingerprint(s.rt)).toBeNull(); // no connection details at all
	});
});
