import { describe, expect, it } from 'vitest';
import { buildPlan, pairFlags, splitScopes, stepArgs } from '../../src/engine/plan';
import { skipColumnsOf, skipFlagsOf } from '../../src/engine/validate';
import { hasPhp, multiCtx, opts, pair, phpApply, singleCtx, table } from './helpers';

const origin = pair('https://prod.example.net', 'https://my.test');

describe('splitScopes', () => {
	it('single site: one scope with all prefix tables; other tables need allTables', () => {
		const ctx = singleCtx();
		ctx.tables.push(table('other_plugin_data'));
		const a = splitScopes(ctx, opts([origin], { allTables: false }));
		expect(a.scopes).toHaveLength(1);
		expect(a.scopes[0].tables.map((t) => t.name)).not.toContain('other_plugin_data');
		const b = splitScopes(ctx, opts([origin]));
		expect(b.scopes[0].tables.map((t) => t.name)).toContain('other_plugin_data');
	});
	it('skipTables supports * and reports what was skipped', () => {
		const r = splitScopes(singleCtx(), opts([origin], { skipTables: 'wp_comment*, wp_users' }));
		expect(r.skipped.sort()).toEqual(['wp_commentmeta', 'wp_comments', 'wp_users']);
		expect(r.scopes[0].tables.map((t) => t.name)).not.toContain('wp_users');
	});
	it('skipTables escapes regex characters in names', () => {
		const ctx = singleCtx();
		ctx.tables.push(table('wp_a.b'), table('wp_aXb'));
		const r = splitScopes(ctx, opts([origin], { skipTables: 'wp_a.b' }));
		expect(r.skipped).toEqual(['wp_a.b']);
	});
	it('multisite: sub-sites first by id, main and network tables last', () => {
		const { scopes } = splitScopes(multiCtx(false), opts([origin]));
		expect(scopes.map((s) => s.label.split(' (')[0])).toEqual([
			'Sub-site 2',
			'Sub-site 3',
			'Main site and network tables',
		]);
		expect(scopes[2].main).toBe(true);
		expect(scopes[0].tables.every((t) => t.name.startsWith('wp_2_'))).toBe(true);
		expect(scopes[2].tables.map((t) => t.name)).toEqual(
			expect.arrayContaining(['wp_options', 'wp_blogs', 'wp_site', 'wp_sitemeta']),
		);
	});
	it('multisite: blog 2 does not claim the tables of blog 20', () => {
		const ctx = multiCtx(false);
		ctx.blogs.push({
			id: 20,
			domain: 'prod.example.net',
			path: '/twenty/',
			siteurl: '',
			home: '',
			tablePrefix: 'wp_20_',
		});
		ctx.tables.push(table('wp_20_options'));
		const { scopes } = splitScopes(ctx, opts([origin]));
		const two = scopes.find((s) => s.label.startsWith('Sub-site 2 '));
		expect(two?.tables.map((t) => t.name)).not.toContain('wp_20_options');
		expect(
			scopes.find((s) => s.label.startsWith('Sub-site 20'))?.tables.map((t) => t.name),
		).toEqual(['wp_20_options']);
	});
	it('custom table prefix', () => {
		const ctx = singleCtx('xyz_');
		expect(
			splitScopes(ctx, opts([origin])).scopes[0].tables.every((t) => t.name.startsWith('xyz_')),
		).toBe(true);
	});
});

describe('buildPlan: single site', () => {
	it('a full origin URL gives the two variant regex steps over all tables', () => {
		const plan = buildPlan(singleCtx(), opts([origin]));
		expect(plan.steps).toHaveLength(2);
		expect(plan.steps.every((s) => s.pair.regex)).toBe(true);
		expect(plan.steps.map((s) => s.index)).toEqual([0, 1]);
	});
	it('includeVariants off: one plain step', () => {
		const plan = buildPlan(singleCtx(), opts([origin], { includeVariants: false }));
		expect(plan.steps).toHaveLength(1);
		expect(plan.steps[0].pair).toMatchObject({ regex: false, search: origin.search });
	});
	it('a bare host uses the e-mail guard; off means a plain replace', () => {
		const on = buildPlan(singleCtx(), opts([pair('prod.example.net', 'my.test')]));
		expect(on.steps[0].pair.search).toContain('(*SKIP)(*FAIL)');
		const off = buildPlan(
			singleCtx(),
			opts([pair('prod.example.net', 'my.test')], { protectEmails: false }),
		);
		expect(off.steps[0].pair.regex).toBe(false);
	});
	it('disabled pairs are left out and text is trimmed', () => {
		const plan = buildPlan(
			singleCtx(),
			opts(
				[
					pair(' https://a.com ', 'https://my.test'),
					pair('https://x.com', 'https://y.test', { enabled: false }),
				],
				{ includeVariants: false },
			),
		);
		expect(plan.steps).toHaveLength(1);
		expect(plan.steps[0].pair.search).toBe('https://a.com');
	});
	it('user regex pairs run last and keep their text', () => {
		const plan = buildPlan(
			singleCtx(),
			opts([pair('a+b', 'x', { regex: true }), origin], { includeVariants: false }),
		);
		expect(plan.steps.map((s) => s.pair.search)).toEqual([origin.search, 'a+b']);
		expect(plan.steps[1].pair.user).toBe(true);
	});
	it('longest search runs first', () => {
		const plan = buildPlan(
			singleCtx(),
			opts(
				[
					pair('https://a.com', 'https://my.test'),
					pair('https://a.com/blog', 'https://my.test/blog'),
				],
				{ includeVariants: false },
			),
		);
		expect(plan.steps[0].pair.search).toBe('https://a.com/blog');
	});
	it('same plain search from two pairs runs once', () => {
		const plan = buildPlan(
			singleCtx(),
			opts(
				[
					pair('https://a.com', 'https://my.test', { id: '1' }),
					pair('https://a.com', 'https://my.test', { id: '2' }),
				],
				{ includeVariants: false },
			),
		);
		expect(plan.steps).toHaveLength(1);
	});
	it('splits more than 120 tables into several processes and weights every step', () => {
		const ctx = singleCtx();
		for (let i = 0; i < 250; i++) ctx.tables.push(table(`wp_extra${i}`));
		const plan = buildPlan(ctx, opts([origin], { includeVariants: false }));
		expect(plan.steps.length).toBe(Math.ceil((12 + 250) / 120));
		expect(plan.steps.every((s) => s.tables.length <= 120)).toBe(true);
		expect(plan.totalWeight).toBe(plan.steps.reduce((n, s) => n + s.weight, 0));
		expect(plan.totalWeight).toBeGreaterThan(0);
	});
	it('empty tables still have a minimum weight', () => {
		const ctx = singleCtx();
		ctx.tables = [table('wp_options', 0)];
		expect(
			buildPlan(ctx, opts([origin], { includeVariants: false })).steps[0].weight,
		).toBeGreaterThan(65536);
	});
	it('no matching tables means no steps', () => {
		const plan = buildPlan(singleCtx(), opts([origin], { skipTables: '*' }));
		expect(plan.steps).toHaveLength(0);
		expect(plan.skippedTables.length).toBeGreaterThan(0);
	});
});

describe('buildPlan: multisite', () => {
	it('sub-directory network: network host step runs only on main and network tables', () => {
		const plan = buildPlan(multiCtx(false), opts([origin]));
		const net = plan.steps.filter((s) => s.pair.networkOnly);
		expect(net).toHaveLength(1);
		expect(net[0].scope).toBe('Main site and network tables');
		expect(net[0].tables.map((t) => t.name).sort()).toEqual(
			[
				'wp_blogs',
				'wp_blogmeta',
				'wp_registration_log',
				'wp_signups',
				'wp_site',
				'wp_sitemeta',
			].sort(),
		);
	});
	it('the network host step is added even when variants are off (wp_blogs must change)', () => {
		const plan = buildPlan(multiCtx(false), opts([origin], { includeVariants: false }));
		expect(plan.steps.some((s) => s.pair.networkOnly)).toBe(true);
	});
	it('no network step for a single site, a regex pair or a bare host', () => {
		expect(buildPlan(singleCtx(), opts([origin])).steps.some((s) => s.pair.networkOnly)).toBe(
			false,
		);
		expect(
			buildPlan(multiCtx(false), opts([pair('a+', 'b', { regex: true })])).steps.some(
				(s) => s.pair.networkOnly,
			),
		).toBe(false);
		expect(
			buildPlan(multiCtx(false), opts([pair('prod.example.net', 'my.test')])).steps.some(
				(s) => s.pair.networkOnly,
			),
		).toBe(false);
	});
	it('sub-domain network: every sub-site host has its own pair and its own network step', () => {
		const pairs = [
			origin,
			pair('https://one.prod.example.net', 'https://one.my.test'),
			pair('https://two.prod.example.net', 'https://two.my.test'),
		];
		const plan = buildPlan(multiCtx(true), opts(pairs));
		expect(plan.steps.filter((s) => s.pair.networkOnly)).toHaveLength(3);
		// Longer host first: one.prod.example.net must run before prod.example.net.
		const hostSteps = plan.steps.filter((s) => s.pair.networkOnly && s.scope.startsWith('Main'));
		expect(hostSteps[hostSteps.length - 1].pair.label).toMatch(/^prod\.example\.net/);
	});
	it('order: every sub-site step comes before any main-site step', () => {
		const plan = buildPlan(multiCtx(false), opts([origin]));
		const firstMain = plan.steps.findIndex((s) => s.scope.startsWith('Main'));
		expect(plan.steps.slice(firstMain).every((s) => s.scope.startsWith('Main'))).toBe(true);
	});
});

describe('stepArgs', () => {
	const step = buildPlan(singleCtx(), opts([origin], { includeVariants: false })).steps[0];
	it('base arguments: pair, table names, verbose, skip guid', () => {
		const a = stepArgs(step, opts([origin], { allTables: false }), false);
		expect(a.slice(0, 3)).toEqual(['search-replace', origin.search, origin.replace]);
		expect(a).toContain('wp_options');
		expect(a).toContain('--verbose');
		expect(a).toContain('--skip-columns=guid');
		expect(a).not.toContain('--dry-run');
		expect(a).not.toContain('--network');
	});
	it('every table name given is allowed by the flags of the same plan (nothing is silently skipped)', () => {
		const ctx = multiCtx(false);
		ctx.tables.push(table('wp_yoast_indexable'), table('other_app_table'), table('wp_3_yoast_x'));
		for (const allTables of [true, false]) {
			const o = opts([origin], { allTables, includeVariants: false });
			const plan = buildPlan(ctx, o);
			expect(plan.steps.length).toBeGreaterThan(0);
			for (const s of plan.steps) {
				const a = stepArgs(s, o, true);
				const reach = a.includes('--all-tables')
					? () => true
					: (t: string) => t.startsWith(ctx.prefix);
				for (const t of s.tables) expect(reach(t.name)).toBe(true);
			}
		}
	});
	it('with all tables on, tables without the prefix and plugin tables are in the plan', () => {
		const ctx = singleCtx();
		ctx.tables.push(table('wp_yoast_indexable'), table('other_app_table'));
		const names = buildPlan(ctx, opts([origin], { includeVariants: false })).steps.flatMap((s) =>
			s.tables.map((t) => t.name),
		);
		expect(names).toEqual(expect.arrayContaining(['wp_yoast_indexable', 'other_app_table']));
		const prefixOnly = buildPlan(
			ctx,
			opts([origin], { includeVariants: false, allTables: false }),
		).steps.flatMap((s) => s.tables.map((t) => t.name));
		expect(prefixOnly).toContain('wp_yoast_indexable');
		expect(prefixOnly).not.toContain('other_app_table');
	});
	it('dry run and precise', () => {
		const a = stepArgs(step, opts([origin], { dryRun: true, precise: true }), false);
		expect(a).toEqual(expect.arrayContaining(['--dry-run', '--precise']));
	});
	it('empty skip columns adds no flag', () => {
		expect(
			stepArgs(step, opts([origin], { skipColumns: '', replaceGuid: true }), false).some((x) =>
				x.startsWith('--skip-columns'),
			),
		).toBe(false);
	});
	it('all tables is the default and gives --all-tables, which overrides the other two table flags', () => {
		for (const multisite of [false, true]) {
			const a = stepArgs(step, opts([origin]), multisite);
			expect(a).toContain('--all-tables');
			expect(a).not.toContain('--network');
			expect(a).not.toContain('--all-tables-with-prefix');
		}
	});
	it('all tables off, single site: only --all-tables-with-prefix (so unregistered plugin tables are still reached)', () => {
		const a = stepArgs(step, opts([origin], { allTables: false }), false);
		expect(a).toContain('--all-tables-with-prefix');
		expect(a).not.toContain('--network');
		expect(a).not.toContain('--all-tables');
	});
	it('all tables off, multisite: --network and --all-tables-with-prefix', () => {
		const a = stepArgs(step, opts([origin], { allTables: false }), true);
		expect(a).toEqual(expect.arrayContaining(['--network', '--all-tables-with-prefix']));
		expect(a).not.toContain('--all-tables');
	});
	it('user regex: delimiter that is not in the pattern, and the global flags', () => {
		const rx = buildPlan(
			singleCtx(),
			opts([pair('a/b+', 'x', { regex: true })], { regexFlags: 'i' }),
		).steps[0];
		const a = stepArgs(rx, opts([pair('a/b+', 'x', { regex: true })], { regexFlags: 'i' }), false);
		expect(a).toEqual(
			expect.arrayContaining(['--regex', '--regex-delimiter=#', '--regex-flags=i']),
		);
	});
	it('generated regex carries its own flags, not the global ones', () => {
		const o = opts([origin], { regexFlags: 'm', caseSensitive: false });
		const gen = buildPlan(singleCtx(), o).steps[0];
		expect(pairFlags(gen.pair, o)).toBe('i');
		expect(stepArgs(gen, o, false)).toContain('--regex-flags=i');
	});
	it('a plain pair has no regex flags', () => {
		expect(stepArgs(step, opts([origin]), false).some((x) => x.startsWith('--regex'))).toBe(false);
	});
});

describe('option: case sensitive', () => {
	const o = (extra = {}) =>
		opts([pair('https://Prod.Example.net', 'https://my.test')], {
			includeVariants: false,
			protectEmails: false,
			...extra,
		});
	it('off (the default): a plain pair ignores case, with the text quoted for PCRE and the replacement kept literal', () => {
		const p = buildPlan(singleCtx(), o({ caseSensitive: false })).steps[0].pair;
		expect(p).toMatchObject({
			regex: true,
			flags: 'i',
			search: 'https://Prod\\.Example\\.net',
			replace: 'https://my.test',
		});
		expect(
			buildPlan(
				singleCtx(),
				opts([pair('a.com', 'b$1\\c')], {
					includeVariants: false,
					protectEmails: false,
					caseSensitive: false,
				}),
			).steps[0].pair.replace,
		).toBe('b\\$1\\\\c');
	});
	it('on: a plain pair stays a plain exact pair', () => {
		expect(buildPlan(singleCtx(), o({ caseSensitive: true })).steps[0].pair).toMatchObject({
			regex: false,
			search: 'https://Prod.Example.net',
		});
	});
	it('on: the generated URL and host regexes lose the i flag; off keeps it', () => {
		const url = (cs: boolean) =>
			buildPlan(
				singleCtx(),
				opts([pair('https://prod.example.net', 'https://my.test')], { caseSensitive: cs }),
			).steps.map((s) => pairFlags(s.pair, opts([], { caseSensitive: cs })));
		expect(url(true)).toEqual(['', '']);
		expect(url(false)).toEqual(['i', 'i']);
		const host = (cs: boolean) =>
			buildPlan(singleCtx(), opts([pair('prod.example.net', 'my.test')], { caseSensitive: cs }))
				.steps[0].pair.flags;
		expect(host(true)).toBe('');
		expect(host(false)).toBe('i');
	});
	it('a regex the user wrote keeps its own flags, whatever this option says', () => {
		for (const cs of [true, false]) {
			const plan = buildPlan(
				singleCtx(),
				opts([pair('a+b', 'x', { regex: true })], { caseSensitive: cs, regexFlags: 'm' }),
			);
			expect(pairFlags(plan.steps[0].pair, opts([], { regexFlags: 'm' }))).toBe('m');
			expect(plan.steps[0].pair.search).toBe('a+b');
		}
	});
	it('a URL with a path gives regex steps with i for every form (plain, JSON-escaped, double-escaped) when off', () => {
		const plan = buildPlan(
			singleCtx(),
			opts([pair('https://a.com/blog', 'https://my.test/news')], { caseSensitive: false }),
		);
		expect(plan.steps).toHaveLength(3);
		expect(plan.steps.every((s) => s.pair.regex && s.pair.flags === 'i')).toBe(true);
	});
	it.skipIf(!hasPhp())('with real PCRE: off finds any case, on finds the exact case only', () => {
		const run = (cs: boolean, subject: string) => {
			const op = opts([pair('https://Prod.Example.net', 'https://my.test')], {
				includeVariants: false,
				protectEmails: false,
				caseSensitive: cs,
			});
			return buildPlan(singleCtx(), op).steps.reduce((s, st) => phpApply(st.pair, op, s), subject);
		};
		expect(run(false, 'a HTTPS://PROD.EXAMPLE.NET/x b')).toBe('a https://my.test/x b');
		expect(run(true, 'a HTTPS://PROD.EXAMPLE.NET/x b')).toBe('a HTTPS://PROD.EXAMPLE.NET/x b');
		expect(run(true, 'a https://Prod.Example.net/x b')).toBe('a https://my.test/x b');
	});
});

describe('option: replace GUID', () => {
	const args = (extra = {}) => {
		const op = opts([pair('https://a.com', 'https://my.test')], {
			includeVariants: false,
			...extra,
		});
		return stepArgs(buildPlan(singleCtx(), op).steps[0], op, false);
	};
	it('off (the default): guid is always skipped, even when the skip list is empty or does not name it', () => {
		expect(args({ skipColumns: '' })).toContain('--skip-columns=guid');
		expect(args({ skipColumns: 'foo' })).toContain('--skip-columns=guid,foo');
	});
	it('on: guid is replaced, so it is not skipped, and it is removed from a skip list that names it', () => {
		expect(
			args({ replaceGuid: true, skipColumns: '' }).some((a) => a.startsWith('--skip-columns')),
		).toBe(false);
		expect(args({ replaceGuid: true, skipColumns: 'guid, foo' })).toContain('--skip-columns=foo');
	});
	it('skipColumnsOf', () => {
		expect(skipColumnsOf({ skipColumns: ' a, guid ,b', replaceGuid: false })).toEqual([
			'guid',
			'a',
			'b',
		]);
		expect(skipColumnsOf({ skipColumns: ' a, guid ,b', replaceGuid: true })).toEqual(['a', 'b']);
	});
	it('the pre-scan hit columns also respect it: a table whose only hit is guid is skipped, unless guid is replaced', () => {
		const hits = new Map([['wp_posts', ['guid']]]);
		const plan = (rg: boolean) =>
			buildPlan(
				singleCtx(),
				opts([pair('https://a.com', 'https://my.test')], {
					includeVariants: false,
					replaceGuid: rg,
				}),
				hits,
			);
		expect(plan(false).steps).toHaveLength(0);
		expect(plan(true).steps).toHaveLength(1);
		expect(plan(true).steps[0].includeColumns).toEqual(['guid']);
	});
});

describe('a row with the same search and replace is left out of the plan', () => {
	it('only the rows that change something become steps', () => {
		const o = opts(
			[
				pair('https://my-site.test', 'https://my-site.test', { id: 'same' }),
				pair('https://old.example.net', 'https://my-site.test', { id: 'real' }),
			],
			{ includeVariants: false },
		);
		const plan = buildPlan(singleCtx(), o);
		expect(plan.steps.length).toBeGreaterThan(0);
		expect(plan.steps.every((s) => s.pair.search === 'https://old.example.net')).toBe(true);
	});
	it('text around the equal texts is trimmed first, so padded copies are no-ops too', () => {
		const o = opts([pair(' https://my-site.test ', 'https://my-site.test')], {
			includeVariants: false,
		});
		expect(buildPlan(singleCtx(), o).steps).toHaveLength(0);
	});
});

describe('options: --report-changed-only and the skip flags', () => {
	const o = (extra = {}) =>
		opts([pair('https://a.com', 'https://my.test')], { includeVariants: false, ...extra });
	const args = (extra = {}) => stepArgs(buildPlan(singleCtx(), o(extra)).steps[0], o(extra), false);
	it('--report-changed-only is on by default, for a dry run and a real run', () => {
		expect(args()).toContain('--report-changed-only');
		expect(args({ dryRun: true })).toContain('--report-changed-only');
		expect(args({ dryRun: true })).toContain('--dry-run');
	});
	it('it can be turned off', () => {
		expect(args({ reportChangedOnly: false })).not.toContain('--report-changed-only');
	});
	it('the skip options are on by default and map to the WP-CLI flags', () => {
		expect(skipFlagsOf(o())).toEqual({ plugins: true, themes: true, packages: true });
		expect(skipFlagsOf(o({ skipThemes: false }))).toEqual({
			plugins: true,
			themes: false,
			packages: true,
		});
	});
});
