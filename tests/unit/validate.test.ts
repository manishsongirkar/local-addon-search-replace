import { describe, expect, it } from 'vitest';
import {
	allTablesOnly,
	chooseDelimiter,
	hasErrors,
	normalizePairs,
	splitList,
	validate,
} from '../../src/engine/validate';
import { opts, pair } from './helpers';

const ctx = { localHost: 'my.test', dbHosts: ['prod.example.net'] };
const codes = (o: ReturnType<typeof opts>, c = ctx) => validate(o, c).map((i) => i.code);

describe('helpers', () => {
	it('chooseDelimiter skips delimiters that occur in the pattern', () => {
		expect(chooseDelimiter('abc')).toBe('/');
		expect(chooseDelimiter('a/b')).toBe('#');
		expect(chooseDelimiter('a/#b')).toBe('~');
		expect(chooseDelimiter('/#~@%!;,')).toBeNull();
	});
	it('splitList trims and drops empties', () => {
		expect(splitList(' a, b ,,c ')).toEqual(['a', 'b', 'c']);
		expect(splitList('')).toEqual([]);
	});
	it('normalizePairs trims both fields and keeps the rest', () => {
		expect(normalizePairs([pair(' https://a.com \n', ' https://b.test ')])[0]).toMatchObject({
			search: 'https://a.com',
			replace: 'https://b.test',
			enabled: true,
		});
	});
	it('hasErrors only counts errors', () => {
		expect(hasErrors([{ level: 'warning', code: 'x', message: '' }])).toBe(false);
		expect(hasErrors([{ level: 'error', code: 'x', message: '' }])).toBe(true);
	});
});

describe('allTablesOnly', () => {
	it('forces all tables and drops any skip-tables value from an old config, and keeps the rest', () => {
		const o = opts([pair('https://a.com', 'https://my.test')], {
			allTables: false,
			skipTables: 'wp_users, wp_x*',
			precise: true,
		});
		expect(allTablesOnly(o)).toMatchObject({
			allTables: true,
			skipTables: '',
			precise: true,
			pairs: o.pairs,
		});
		expect(o.skipTables).toBe('wp_users, wp_x*'); // the input is not changed
	});
});

describe('allTablesOnly: no case or GUID option', () => {
	it('forces exact case matching and keeps the guid column out, whatever an old config says', () => {
		const o = opts([pair('https://a.com', 'https://my.test')], {
			caseSensitive: false,
			replaceGuid: true,
		});
		expect(allTablesOnly(o)).toMatchObject({ caseSensitive: true, replaceGuid: false });
	});
});

describe('validate: errors', () => {
	it('no enabled pair', () => {
		expect(codes(opts([]))).toContain('NO_PAIRS');
		expect(codes(opts([pair('https://a.com', 'https://b.test', { enabled: false })]))).toContain(
			'NO_PAIRS',
		);
	});
	it('empty search', () => expect(codes(opts([pair('  ', 'x')]))).toContain('EMPTY_SEARCH'));
	it('control characters', () => {
		expect(codes(opts([pair('a\nb.com', 'x.test')]))).toContain('CONTROL_CHARS');
		expect(codes(opts([pair('a.com', 'x\n.test')]))).toContain('CONTROL_CHARS');
	});
	it('values that start with -- would become WP-CLI options', () => {
		expect(codes(opts([pair('--all-tables', 'x.test')]))).toContain('DASH_PREFIX');
		expect(codes(opts([pair('a.test', '--dry-run')]))).toContain('DASH_PREFIX');
	});
	it('same search and replace', () =>
		expect(codes(opts([pair('https://a.com', 'https://a.com')]))).toContain('SAME'));
	it('bad regex flags and bad lists', () => {
		expect(codes(opts([pair('a.com', 'b.test')], { regexFlags: 'ig' }))).toContain('BAD_FLAGS');
		expect(codes(opts([pair('a.com', 'b.test')], { skipColumns: 'a;DROP' }))).toContain('BAD_LIST');
		expect(codes(opts([pair('a.com', 'b.test')], { skipTables: 'wp_*, other' }))).not.toContain(
			'BAD_LIST',
		);
	});
	it('same search twice: conflicting is an error, identical is a warning', () => {
		const conflict = validate(
			opts([
				pair('https://a.com', 'https://b.test', { id: '1' }),
				pair('https://a.com', 'https://c.test', { id: '2' }),
			]),
			ctx,
		);
		expect(conflict.find((i) => i.code === 'CONFLICTING_PAIR')?.level).toBe('error');
		const dup = validate(
			opts([
				pair('https://a.com', 'https://b.test', { id: '1' }),
				pair('https://a.com', 'https://b.test', { id: '2' }),
			]),
			ctx,
		);
		expect(dup.find((i) => i.code === 'DUPLICATE_PAIR')?.level).toBe('warning');
	});
	it('a disabled pair is ignored by every check', () => {
		expect(codes(opts([pair('a.com', 'b.test'), pair('', '', { enabled: false })]))).not.toContain(
			'EMPTY_SEARCH',
		);
	});
});

describe('validate: warnings that need confirmation', () => {
	const need = (o: ReturnType<typeof opts>) =>
		validate(o, ctx)
			.filter((i) => i.needsConfirm)
			.map((i) => i.code);
	it('empty replace', () =>
		expect(need(opts([pair('https://a.com', '')]))).toContain('EMPTY_REPLACE'));
	it('very short search', () => expect(need(opts([pair('ab', 'cd')]))).toContain('SHORT_SEARCH'));
	it('regex that matches the empty string', () => {
		expect(need(opts([pair('.*', 'x', { regex: true })]))).toContain('REGEX_MATCHES_EMPTY');
		expect(need(opts([pair('a+b', 'x', { regex: true })]))).not.toContain('REGEX_MATCHES_EMPTY');
	});
	it('no pair reaches the Local host', () => {
		expect(need(opts([pair('https://a.com', 'https://b.test')]))).toContain('NOT_LOCAL_HOST');
		expect(need(opts([pair('https://a.com', 'https://my.test')]))).not.toContain('NOT_LOCAL_HOST');
		// Database already on the Local host: nothing to warn about.
		expect(
			validate(opts([pair('https://a.com', 'https://b.test')]), {
				localHost: 'my.test',
				dbHosts: ['my.test'],
			}).map((i) => i.code),
		).not.toContain('NOT_LOCAL_HOST');
	});
	it('a regex-only run is not checked for the Local host', () => {
		expect(codes(opts([pair('a+b', 'x', { regex: true })]))).not.toContain('NOT_LOCAL_HOST');
	});
});

describe('validate: the new options', () => {
	it('replace GUID is a warning, off is silent', () => {
		expect(
			codes(opts([pair('https://a.com', 'https://my.test')], { replaceGuid: true })),
		).toContain('REPLACE_GUID');
		expect(codes(opts([pair('https://a.com', 'https://my.test')]))).not.toContain('REPLACE_GUID');
	});
	it('the capital letters hint only matters when case sensitive is on', () => {
		const p = pair('https://A.com', 'https://my.test');
		expect(codes(opts([p], { caseSensitive: true }))).toContain('UPPERCASE');
		expect(codes(opts([p], { caseSensitive: false }))).not.toContain('UPPERCASE');
	});
});

describe('validate: hints', () => {
	it.each([
		['SCHEME_MISMATCH', pair('https://a.com', 'my.test')],
		['TRAILING_SLASH', pair('https://a.com/', 'https://my.test')],
		['SPACE_IN_REPLACE', pair('https://a.com', 'https://my test')],
		['REPLACE_CONTAINS_SEARCH', pair('a.com', 'sub.a.com')],
		['SEARCH_IS_LOCAL', pair('https://my.test', 'https://other.test')],
	])('%s', (code, p) => {
		expect(codes(opts([p]))).toContain(code);
	});
	it('https to http is only info', () => {
		const i = validate(opts([pair('https://a.com', 'http://my.test')]), ctx).find(
			(x) => x.code === 'DOWNGRADE',
		);
		expect(i?.level).toBe('info');
	});
	it('chained and overlapping pairs across rows', () => {
		const chain = codes(
			opts([pair('https://a.com', 'https://b.com'), pair('https://b.com', 'https://my.test')]),
		);
		expect(chain).toContain('CHAIN');
		const overlap = codes(
			opts([
				pair('https://a.com', 'https://my.test'),
				pair('https://a.com/blog', 'https://my.test/blog'),
			]),
		);
		expect(overlap).toContain('OVERLAP');
	});
	it('trimmed text is reported as info', () => {
		expect(codes(opts([pair(' https://a.com ', 'https://my.test')]))).toContain('TRIMMED');
	});
	it('the notice that every run covers all tables is always shown while all tables is on', () => {
		const i = validate(opts([pair('https://a.com', 'https://my.test')]), ctx).find(
			(x) => x.code === 'ALL_TABLES',
		);
		expect(i?.level).toBe('info');
		expect(i?.message).toMatch(/all tables/i);
		expect(i?.message).toMatch(/cannot choose single tables/);
	});
	it('all tables on is an info, off is silent', () => {
		expect(codes(opts([pair('https://a.com', 'https://my.test')]))).toContain('ALL_TABLES');
		expect(
			codes(opts([pair('https://a.com', 'https://my.test')], { allTables: false })),
		).not.toContain('ALL_TABLES');
	});
	it('a clean pair gives no error', () => {
		expect(
			hasErrors(validate(opts([pair('https://prod.example.net', 'https://my.test')]), ctx)),
		).toBe(false);
	});
	it('regex pair that uses every delimiter is an error', () => {
		expect(codes(opts([pair('/#~@%!;,', 'x', { regex: true })]))).toContain('NO_DELIMITER');
	});
});

describe('a row whose search and replace are the same (the Local domain of the site itself)', () => {
	const same = pair('https://my-site.test', 'https://my-site.test', { id: 'same' });
	const real = pair('https://old.example.net', 'https://my-site.test', { id: 'real' });
	const issues = (pairs: ReturnType<typeof pair>[]) =>
		validate(opts(pairs), { localHost: 'my-site.test', dbHosts: ['old.example.net'] });
	it('does not block the run when another row has work to do: it is a warning', () => {
		const list = issues([same, real]);
		expect(list.find((i) => i.code === 'SAME')?.level).toBe('warning');
		expect(hasErrors(list)).toBe(false);
	});
	it('the message says which row it is, by its search text', () => {
		const m = issues([same, real]).find((i) => i.code === 'SAME')?.message ?? '';
		expect(m).toContain('https://my-site.test');
		expect(m).toMatch(/skipped/);
	});
	it('when every ticked row changes nothing there is nothing to run: an error that says so', () => {
		const list = issues([same]);
		expect(hasErrors(list)).toBe(true);
		expect(list.find((i) => i.code === 'NO_PAIRS')?.message).toMatch(
			/every ticked row has the same/,
		);
	});
	it('a regex row is not a no-op just because both texts are equal', () => {
		expect(hasErrors(issues([pair('a+', 'a+', { regex: true }), real]))).toBe(false);
		expect(issues([pair('a+', 'a+', { regex: true })]).some((i) => i.code === 'NO_PAIRS')).toBe(
			false,
		);
	});
	it('it does not take part in the chain and overlap checks of the other rows', () => {
		const codesOf = issues([same, real]).map((i) => i.code);
		expect(codesOf).not.toContain('CHAIN');
		expect(codesOf).not.toContain('OVERLAP');
	});
});

describe('NOT_LOCAL_HOST: "no ticked row replaces to this Local domain"', () => {
	const rows = [pair('https://old.example.net', 'https://other.test')];
	it('shows when the database uses another domain and no ticked row goes to the Local domain, and names that domain', () => {
		const i = validate(opts(rows), {
			localHost: 'my-site.test',
			dbHosts: ['prod.example.net'],
		}).find((x) => x.code === 'NOT_LOCAL_HOST');
		expect(i?.needsConfirm).toBe(true);
		expect(i?.message).toContain('my-site.test');
		expect(i?.message).toContain('prod.example.net');
	});
	it('does not show when the database already uses the Local domain', () => {
		expect(
			codes(opts(rows), { localHost: 'my-site.test', dbHosts: ['my-site.test'] }),
		).not.toContain('NOT_LOCAL_HOST');
	});
	it('does not show when the database domains are unknown (no scan in this session)', () => {
		expect(codes(opts(rows), { localHost: 'my-site.test', dbHosts: [] })).not.toContain(
			'NOT_LOCAL_HOST',
		);
	});
	it('does not show when a ticked row replaces to the Local domain', () => {
		const ok = opts([pair('https://prod.example.net', 'https://my-site.test')]);
		expect(codes(ok, { localHost: 'my-site.test', dbHosts: ['prod.example.net'] })).not.toContain(
			'NOT_LOCAL_HOST',
		);
	});
	it('a row that replaces the Local domain with itself does not count as going to the Local domain', () => {
		const same = opts([
			pair('https://my-site.test', 'https://my-site.test'),
			pair('https://old.example.net', 'https://other.test'),
		]);
		expect(codes(same, { localHost: 'my-site.test', dbHosts: ['prod.example.net'] })).toContain(
			'NOT_LOCAL_HOST',
		);
	});
});
