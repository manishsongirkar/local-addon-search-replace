import { describe, expect, it } from 'vitest';
import type { DomainCandidate } from '../../src/common/types';
import {
	type ExpandedPair,
	brandLabel,
	expandVariants,
	hostOf,
	isHostLike,
	isNoiseHost,
	networkHostPair,
	orderPairs,
	parseUrlish,
	protectEmails,
	quoteRegex,
	quoteReplacement,
	registrableDomain,
	sortCandidates,
	suggestReplacement,
} from '../../src/engine/urls';
import { hasPhp, opts, pair, phpApply } from './helpers';

describe('parseUrlish / hostOf', () => {
	it.each([
		['https://Example.COM', 'https', 'example.com', '', ''],
		['http://a.com:8080/x/y', 'http', 'a.com', ':8080', '/x/y'],
		['//cdn.a.com/x', '', 'cdn.a.com', '', '/x'],
		['a.com', '', 'a.com', '', ''],
		['  https://a.com  ', 'https', 'a.com', '', ''],
	])('parses %s', (input, scheme, host, port, path) => {
		expect(parseUrlish(input)).toEqual({ scheme, host, port, path });
	});

	it.each(['', 'not a url', 'https://', 'ftp://a.com', 'a b.com'])('rejects %j', (v) => {
		expect(parseUrlish(v)).toBeNull();
	});

	it('hostOf returns "" for junk', () => {
		expect(hostOf('https://Sub.A.com/x')).toBe('sub.a.com');
		expect(hostOf('???')).toBe('');
	});
});

describe('isNoiseHost / isHostLike', () => {
	it('treats WordPress and schema hosts as noise, including sub-domains', () => {
		expect(isNoiseHost('wordpress.org')).toBe(true);
		expect(isNoiseHost('api.WordPress.org')).toBe(true);
		expect(isNoiseHost('www.w3.org')).toBe(true);
		expect(isNoiseHost('mywordpress.org')).toBe(false);
		expect(isNoiseHost('client-site.com')).toBe(false);
	});
	it('isHostLike needs a dot and only host characters', () => {
		expect(isHostLike('a.com')).toBe(true);
		expect(isHostLike('a.com:8080')).toBe(true);
		expect(isHostLike('localhost')).toBe(false);
		expect(isHostLike('https://a.com')).toBe(false);
		expect(isHostLike('a.com/x')).toBe(false);
	});
});

describe('quoting', () => {
	it('quoteRegex escapes every PCRE metacharacter', () => {
		expect(quoteRegex('a.b+c?(d)[e]{f}^$|\\')).toBe(
			'a\\.b\\+c\\?\\(d\\)\\[e\\]\\{f\\}\\^\\$\\|\\\\',
		);
	});
	it('quoteReplacement escapes $ and backslash only', () => {
		expect(quoteReplacement('a$1\\b')).toBe('a\\$1\\\\b');
		expect(quoteReplacement('https://a.com')).toBe('https://a.com');
	});
});

describe('suggestReplacement', () => {
	const local = 'https://mysite.local';
	const sug = (v: string, origin = 'prod.com', l = local) => suggestReplacement(v, origin, l);
	it('maps the origin host to the Local URL and keeps a path', () => {
		expect(sug('https://prod.com')).toBe(local);
		expect(sug('https://prod.com/blog/')).toBe(`${local}/blog`);
	});
	it('keeps the port of the Local URL', () => {
		expect(sug('https://prod.com', 'prod.com', 'http://mysite.local:10010')).toBe(
			'http://mysite.local:10010',
		);
	});
	it('www twin of the origin maps to the plain Local URL, never www.<local host>', () => {
		expect(sug('https://www.prod.com')).toBe(local);
		expect(sug('https://www.prod.com/blog')).toBe(`${local}/blog`);
		expect(sug('https://prod.com', 'www.prod.com')).toBe(local);
	});
	it('a sub-domain of the origin maps to the same sub-domain of the Local host', () => {
		expect(sug('https://api.prod.com')).toBe('https://api.mysite.local');
		expect(sug('https://one.prod.com')).toBe('https://one.mysite.local');
		expect(sug('https://www.one.prod.com')).toBe('https://one.mysite.local');
		expect(sug('https://a.b.prod.com/x')).toBe('https://a.b.mysite.local/x');
	});
	it('a site on a sub-domain: its siblings are relative to the registrable domain', () => {
		expect(sug('https://api.example.com', 'wp.example.com')).toBe('https://api.mysite.local');
		expect(sug('https://x.wp.example.com', 'wp.example.com')).toBe('https://x.mysite.local');
		expect(sug('https://example.com', 'wp.example.com')).toBe(local);
	});
	it('the same brand on another top-level domain maps to the Local URL', () => {
		expect(sug('https://prod.net')).toBe(local);
		expect(sug('https://shop.prod.org', 'prod.com')).toBe(local);
		expect(sug('https://prod.co.uk', 'prod.com')).toBe(local);
	});
	it('country suffixes with a second level are read as one suffix', () => {
		expect(sug('https://api.example.co.uk', 'example.co.uk')).toBe('https://api.mysite.local');
		expect(sug('https://other.co.uk', 'example.co.uk')).toBe('');
	});
	it.each([
		['external host', 'https://cdn.other.org'],
		['look-alike suffix', 'https://notprod.com'],
		['look-alike prefix', 'https://prodigy.com'],
		['unrelated sub-domain host', 'https://img.cdn.partner.net'],
	])('no suggestion for %s', (_n, v) => {
		expect(sug(v)).toBe('');
	});
	it('a domain with the name of the Local site is suggested, also when the database came from a staging URL', () => {
		const lc = 'https://acme.test';
		const origin = 'acme-staging.hosting-example.net'; // the siteurl of the imported database
		expect(sug('https://acme.com', origin, lc)).toBe(lc);
		expect(sug('https://www.acme.com/blog', origin, lc)).toBe(`${lc}/blog`);
		expect(sug('https://api.acme.com', origin, lc)).toBe('https://api.acme.test');
		expect(sug('https://shop.eu.acme.co.uk', origin, lc)).toBe('https://shop.eu.acme.test');
		expect(sug('https://acme.test', origin, lc)).toBe(''); // the Local domain itself is not a source
		expect(sug('https://acmecorp.com', origin, lc)).toBe(''); // a longer name is another name
		expect(sug('https://cdn.partner.com', origin, lc)).toBe('');
	});
	it('no suggestion when the origin is unknown or the value is not a URL', () => {
		expect(sug('https://prod.com', '')).toBe('');
		expect(sug('???')).toBe('');
	});
});

describe('registrableDomain / brandLabel', () => {
	it.each([
		['example.com', 'example.com', 'example'],
		['www.example.com', 'example.com', 'example'],
		['a.b.example.com', 'example.com', 'example'],
		['shop.example.co.uk', 'example.co.uk', 'example'],
		['example.com.au', 'example.com.au', 'example'],
		['localhost', 'localhost', 'localhost'],
	])('%s', (host, reg, brand) => {
		expect(registrableDomain(host)).toBe(reg);
		expect(brandLabel(host)).toBe(brand);
	});
});

describe('sortCandidates', () => {
	const c = (value: string, count: number, primary: boolean): DomainCandidate => ({
		value,
		host: value,
		count,
		sources: [],
		primary,
		suggestedReplace: '',
		preselected: false,
	});
	it('puts primary first, then higher count, then alphabetical; does not mutate', () => {
		const input = [c('b', 1, false), c('a', 1, false), c('z', 1, true), c('m', 9, false)];
		const copy = [...input];
		expect(sortCandidates(input).map((x) => x.value)).toEqual(['z', 'm', 'a', 'b']);
		expect(input).toEqual(copy);
	});
});

describe('expandVariants', () => {
	it('returns one plain pair for a non-URL or scheme-less pair', () => {
		expect(expandVariants({ search: 'a.com', replace: 'b.test' })).toHaveLength(1);
		expect(expandVariants({ search: 'https://a.com', replace: 'b.test' })).toHaveLength(1);
	});
	it('a pair with a path gives plain, JSON-escaped and double-escaped steps', () => {
		const out = expandVariants({ search: 'https://a.com/blog', replace: 'https://b.test/news' });
		expect(out.map((p) => p.search)).toEqual([
			'https://a.com/blog',
			'https:\\/\\/a.com\\/blog',
			'https:\\\\/\\\\/a.com\\\\/blog',
		]);
		expect(out.every((p) => !p.regex)).toBe(true);
	});
	it('an origin URL gives two regex steps: scheme forms and protocol-relative', () => {
		const out = expandVariants({ search: 'https://a.com', replace: 'https://b.test' });
		expect(out).toHaveLength(2);
		expect(out.every((p) => p.regex && p.flags === 'i')).toBe(true);
		expect(out[1].label).toMatch(/protocol-relative/);
	});
});

describe.skipIf(!hasPhp())('generated regexes against real PCRE (php)', () => {
	const o = opts([]);
	/** Run every step of a pair, in order, the way the runner does. */
	const run = (steps: ExpandedPair[], subject: string) =>
		steps.reduce((s, p) => phpApply(p, o, s), subject);
	const origin = expandVariants({ search: 'https://prod.example.net', replace: 'https://my.test' });

	it.each([
		['plain https', 'visit https://prod.example.net/page now', 'visit https://my.test/page now'],
		['http twin becomes the new scheme', 'http://prod.example.net/x', 'https://my.test/x'],
		[
			'forward slashes in JSON are kept',
			'{"u":"https:\\/\\/prod.example.net\\/j"}',
			'{"u":"https:\\/\\/my.test\\/j"}',
		],
		[
			'double-escaped slashes',
			'https:\\\\/\\\\/prod.example.net\\\\/d',
			'https:\\\\/\\\\/my.test\\\\/d',
		],
		['url-encoded', 'r=https%3A%2F%2Fprod.example.net%2Fp', 'r=https%3A%2F%2Fmy.test%2Fp'],
		['protocol-relative', "<img src='//prod.example.net/x.png'>", "<img src='//my.test/x.png'>"],
		['upper case host', 'HTTPS://PROD.EXAMPLE.NET/Up', 'https://my.test/Up'],
		[
			'host with a longer name is untouched',
			'https://prod.example.network/x',
			'https://prod.example.network/x',
		],
		[
			'a sub-domain is untouched',
			'https://cdn.prod.example.net/x',
			'https://cdn.prod.example.net/x',
		],
		['sentence end', 'See https://prod.example.net.', 'See https://my.test.'],
		['other host', 'https://cdn.other-site.org/lib.js', 'https://cdn.other-site.org/lib.js'],
		['e-mail style host is not a URL', 'mail a@prod.example.net', 'mail a@prod.example.net'],
	])('%s', (_n, input, expected) => {
		expect(run(origin, input)).toBe(expected);
	});

	it('a new URL with a path keeps the slash style of the match', () => {
		const steps = expandVariants({
			search: 'https://prod.example.net',
			replace: 'https://my.test/sub',
		});
		expect(run(steps, 'https://prod.example.net/a')).toBe('https://my.test/sub/a');
		expect(run(steps, 'https:\\/\\/prod.example.net\\/a')).toBe('https:\\/\\/my.test\\/sub\\/a');
	});

	it('a $ or backslash in the replacement is literal', () => {
		const steps = expandVariants({
			search: 'https://prod.example.net',
			replace: 'https://my$1.test',
		});
		expect(run(steps, 'https://prod.example.net/')).toBe('https://my$1.test/');
	});

	it('protectEmails changes a bare host but never an e-mail address', () => {
		const p = protectEmails('prod.example.net', 'my.test');
		expect(phpApply(p, o, 'contact@prod.example.net and prod.example.net')).toBe(
			'contact@prod.example.net and my.test',
		);
		expect(phpApply(p, o, 'john@mail.prod.example.net')).toBe('john@mail.prod.example.net');
		expect(phpApply(p, o, 'a-prod.example.net')).toBe('a-prod.example.net');
	});

	it('network host pair changes the bare host in wp_blogs style data', () => {
		const p = networkHostPair({
			search: 'https://prod.example.net',
			replace: 'https://my.test',
		}) as ExpandedPair;
		expect(phpApply(p, o, 'prod.example.net')).toBe('my.test');
		expect(phpApply(p, o, 'admin@prod.example.net')).toBe('admin@prod.example.net');
	});
});

describe('networkHostPair', () => {
	it('is null for pairs with a path, no scheme, or the same host', () => {
		expect(networkHostPair(pair('https://a.com/x', 'https://b.test/x'))).toBeNull();
		expect(networkHostPair(pair('a.com', 'b.test'))).toBeNull();
		expect(networkHostPair(pair('https://a.com', 'http://a.com'))).toBeNull();
	});
	it('is network-only; plain when e-mail protection is off', () => {
		const p = networkHostPair(pair('https://a.com:8080', 'https://b.test'), false);
		expect(p).toMatchObject({
			search: 'a.com:8080',
			replace: 'b.test',
			regex: false,
			networkOnly: true,
		});
		expect(networkHostPair(pair('https://a.com', 'https://b.test'))).toMatchObject({
			regex: true,
			networkOnly: true,
		});
	});
});

describe('orderPairs', () => {
	const e = (search: string, user = false): ExpandedPair => ({
		search,
		replace: 'x',
		regex: false,
		label: search,
		sortKey: search.length,
		user,
	});
	it('longest first; user regexes last in their own order', () => {
		const out = orderPairs([e('aa'), e('u2', true), e('aaaa'), e('u1', true), e('aaa')]);
		expect(out.map((p) => p.search)).toEqual(['aaaa', 'aaa', 'aa', 'u2', 'u1']);
	});
	it('is stable for equal lengths and does not mutate', () => {
		const input = [e('bb'), e('aa')];
		expect(orderPairs(input).map((p) => p.search)).toEqual(['bb', 'aa']);
		expect(input.map((p) => p.search)).toEqual(['bb', 'aa']);
	});
});
