import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadContext, scanDomains } from '../../src/engine/scan';
import { EngineError } from '../../src/engine/scan';
import { resolveWpPath } from '../../src/engine/wpPath';
import { type TestSite, makeSite, seed } from './env';
import { option, opts, pair, runJob } from './helpers';

const O = 'prod.example.net';

function multisite(
	kind: 'multisite-subdir' | 'multisite-subdomain',
	localDomain?: string,
): TestSite {
	const s = makeSite({ kind });
	const sub = (slug: string) =>
		kind === 'multisite-subdir' ? `https://${O}/${slug}` : `https://${slug}.${O}`;
	for (const slug of ['blog2', 'blog3']) {
		s.wp(['site', 'create', `--slug=${slug}`, `--title=${slug}`], { url: `https://${O}` });
		const was = sub(slug).replace('https:', 'http:');
		for (const o of ['siteurl', 'home']) s.wp(['option', 'update', o, sub(slug)], { url: was });
		seed(s, sub(slug), sub(slug));
	}
	seed(s, `https://${O}`, `https://${O}`);
	if (localDomain) s.wp(['config', 'set', 'DOMAIN_CURRENT_SITE', localDomain]);
	return s;
}

describe('multisite subdirectory', () => {
	it('runs sub-sites first, main site last, and updates network tables', async () => {
		const s = multisite('multisite-subdir');
		const { final, logs, context } = await runJob(
			s,
			opts([pair(`https://${O}`, 'https://ms.test')], { backup: false }),
		);
		expect(context.multisite).toBe(true);
		expect(final.state).toBe('completed');

		const order = logs
			.filter((l) => l.level === 'cmd' && /Sub-site|Main site/.test(l.text))
			.map((l) => l.text);
		const firstMain = order.findIndex((t) => t.includes('Main site'));
		const lastSub = order.map((t) => t.includes('Sub-site')).lastIndexOf(true);
		expect(lastSub).toBeGreaterThanOrEqual(0);
		expect(lastSub).toBeLessThan(firstMain);
		// Sub-sites ascend by id.
		expect(order.findIndex((t) => t.includes('Sub-site 2'))).toBeLessThan(
			order.findIndex((t) => t.includes('Sub-site 3')),
		);

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
			s.sql(`SELECT option_value FROM ${s.prefix}options WHERE option_name='siteurl'`)[0],
		).toBe('https://ms.test');
		expect(
			s.sql(`SELECT option_value FROM ${s.prefix}3_options WHERE option_name='sr_plain'`)[0],
		).toContain('https://ms.test/blog3/page');
		// No URL of the old domain is left. E-mail addresses and bare host text are kept on purpose (protectEmails).
		expect(
			s.sql(`SELECT COUNT(*) FROM ${s.prefix}2_options WHERE option_value LIKE '%//${O}%'`)[0],
		).toBe('0');
	});

	it('does not touch other sub-sites when one is excluded by table', async () => {
		const s = multisite('multisite-subdir');
		await runJob(
			s,
			opts([pair(`https://${O}`, 'https://ms.test')], {
				backup: false,
				skipTables: `${s.prefix}3_*`,
			}),
		);
		expect(
			s.sql(`SELECT option_value FROM ${s.prefix}3_options WHERE option_name='siteurl'`)[0],
		).toContain(O);
		expect(
			s.sql(`SELECT option_value FROM ${s.prefix}2_options WHERE option_name='siteurl'`)[0],
		).toContain('ms.test');
	});

	it('a regex runs once per table and is not applied twice', async () => {
		const s = multisite('multisite-subdir');
		const { final } = await runJob(
			s,
			opts([pair(`(https://)${O.replace(/\./g, '\\.')}`, '${1}ms.test', true)], { backup: false }),
		);
		expect(final.state).toBe('completed');
		expect(
			s.sql(`SELECT option_value FROM ${s.prefix}2_options WHERE option_name='siteurl'`)[0],
		).toBe('https://ms.test/blog2');
	});

	it('loads the site when wp-config uses the Local domain but the DB has the production domain', async () => {
		const s = multisite('multisite-subdir', 'ms.test');
		const ctx = await loadContext(s.rt);
		expect(ctx.urlArg).toBeTruthy();
		const c = await scanDomains(s.rt, ctx, 'https://ms.test');
		expect(c.find((x) => x.preselected)?.value).toBe(`https://${O}`);
		const { final } = await runJob(
			s,
			opts([pair(`https://${O}`, 'https://ms.test')], { backup: false }),
		);
		expect(final.state).toBe('completed');
		expect(s.sql(`SELECT domain FROM ${s.prefix}site`)).toEqual(['ms.test']);
	});
});

describe('multisite subdomain', () => {
	it('suggests per-sub-site replacements and replaces sub-site hosts', async () => {
		const s = multisite('multisite-subdomain');
		const ctx = await loadContext(s.rt);
		expect(ctx.subdomain).toBe(true);
		const c = await scanDomains(s.rt, ctx, 'https://ms.test');
		const b2 = c.find((x) => x.value === `https://blog2.${O}`);
		expect(b2?.suggestedReplace).toBe('https://blog2.ms.test');
		expect(b2?.preselected).toBe(true);

		const { final } = await runJob(
			s,
			opts(
				[
					pair(`https://blog2.${O}`, 'https://blog2.ms.test'),
					pair(`https://blog3.${O}`, 'https://blog3.ms.test'),
					pair(`https://${O}`, 'https://ms.test'),
				],
				{ backup: false },
			),
		);
		expect(final.state).toBe('completed');
		expect(s.sql(`SELECT domain FROM ${s.prefix}blogs ORDER BY blog_id`)).toEqual([
			'ms.test',
			'blog2.ms.test',
			'blog3.ms.test',
		]);
		expect(s.sql(`SELECT option_value FROM ${s.prefix}2_options WHERE option_name='home'`)[0]).toBe(
			'https://blog2.ms.test',
		);
	});
});

describe('layouts', () => {
	it('Bedrock', async () => {
		const s = makeSite({ kind: 'bedrock' });
		seed(s, `https://${O}`);
		expect(resolveWpPath(s.webRoot)?.layout).toBe('wp-cli.yml');
		fs.rmSync(path.join(s.webRoot, 'wp-cli.yml'));
		expect(resolveWpPath(s.webRoot)?.layout).toBe('bedrock');
		const { final } = await runJob(
			s,
			opts([pair(`https://${O}`, 'https://b.test')], { backup: false }),
		);
		expect(final.state).toBe('completed');
		expect(option(s, 'siteurl')).toBe('https://b.test');
	});

	it('WordPress in a sub-directory of the web root', async () => {
		const s = makeSite({ kind: 'subdir-install' });
		seed(s, `https://${O}`);
		const r = resolveWpPath(s.webRoot);
		expect(r?.layout).toBe('subdirectory');
		expect(r?.path).toBe(s.rt.wpPath);
	});

	it('standard layout and manual override', async () => {
		const s = makeSite({ kind: 'single' });
		expect(resolveWpPath(s.webRoot)?.layout).toBe('standard');
		expect(resolveWpPath('/nonexistent/x', s.webRoot)?.layout).toBe('manual');
		expect(resolveWpPath('/nonexistent/x')).toBeNull();
	});
});

describe('errors', () => {
	it('empty database is reported as not installed', async () => {
		const s = makeSite({ kind: 'single' });
		s.sql(`DROP DATABASE ${s.db}; CREATE DATABASE ${s.db}`);
		await expect(loadContext(s.rt)).rejects.toMatchObject({
			code: expect.stringMatching(/NOT_INSTALLED|UNKNOWN/),
		});
	});

	it('wrong database credentials give a friendly message', async () => {
		const s = makeSite({ kind: 'single' });
		s.wp(['config', 'set', 'DB_PASSWORD', 'wrong']);
		s.wp(['config', 'set', 'DB_USER', 'nobody']);
		const err = await loadContext(s.rt).catch((e) => e);
		expect(err).toBeInstanceOf(EngineError);
		expect(err.code).toBe('DB_DOWN');
	});

	it('a missing WordPress path is reported', async () => {
		const s = makeSite({ kind: 'single' });
		const err = await loadContext({ ...s.rt, wpPath: '/nonexistent/wp' }).catch((e) => e);
		expect(err).toBeInstanceOf(EngineError);
	});
});
