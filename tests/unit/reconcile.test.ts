import { describe, expect, it } from 'vitest';
import type { DomainCandidate } from '../../src/common/types';
import {
	kindOf,
	normalizeValue,
	orderRows,
	reconcilePairs,
	scanId,
} from '../../src/engine/reconcile';
import { buildCandidates } from '../../src/engine/scan';
import { multiCtx, pair, singleCtx } from './helpers';

const cand = (value: string, suggestedReplace: string, preselected = true): DomainCandidate => ({
	value,
	host: value.replace(/^https?:\/\//, ''),
	count: 1,
	sources: [],
	primary: true,
	suggestedReplace,
	preselected,
});
const scanPair = (value: string, replace: string, extra = {}) =>
	pair(value, replace, { id: scanId(value), origin: 'scan', ...extra });

describe('normalizeValue', () => {
	it('ignores case, trailing slash and default parts', () => {
		expect(normalizeValue('HTTPS://A.com/')).toBe('https://a.com');
		expect(normalizeValue('https://a.com:8080/x/')).toBe('https://a.com:8080/x');
		expect(normalizeValue('not a url ')).toBe('not a url');
	});
});

describe('reconcilePairs', () => {
	it('first scan: every domain becomes a scan row, pre-selected ones are ticked', () => {
		const r = reconcilePairs(
			[],
			[cand('https://a.com', 'https://my.test'), cand('https://cdn.x.org', '', false)],
		);
		expect(r.added).toEqual(['https://a.com', 'https://cdn.x.org']);
		expect(r.pairs).toEqual([
			{
				id: 'scan:https://a.com',
				search: 'https://a.com',
				replace: 'https://my.test',
				regex: false,
				enabled: true,
				origin: 'scan',
				suggested: 'https://my.test',
				kind: 'main',
			},
			{
				id: 'scan:https://cdn.x.org',
				search: 'https://cdn.x.org',
				replace: '',
				regex: false,
				enabled: false,
				origin: 'scan',
				suggested: '',
				kind: 'main', // the test helper marks every candidate as primary
			},
		]);
	});
	it('a known domain keeps the replace text the user typed, the tick and the order', () => {
		const saved = [
			scanPair('https://b.com', 'https://custom.test', { enabled: false }),
			scanPair('https://a.com', 'https://mine.test'),
		];
		const r = reconcilePairs(saved, [
			cand('https://a.com', 'https://my.test'),
			cand('https://b.com', 'https://my.test'),
		]);
		// Replace text, tick and order are kept. The row also remembers the suggestion it was offered.
		expect(r.pairs.map(({ suggested, kind, ...rest }) => rest)).toEqual(saved);
		expect(r.added).toEqual([]);
		expect(r.removed).toEqual([]);
	});
	it('a new domain is added BELOW the saved rows', () => {
		const saved = [scanPair('https://a.com', 'https://my.test')];
		const r = reconcilePairs(saved, [
			cand('https://new.sub.a.com', 'https://new.my.test'),
			cand('https://a.com', 'https://my.test'),
		]);
		expect(r.pairs.map((p) => p.search)).toEqual(['https://a.com', 'https://new.sub.a.com']);
		expect(r.added).toEqual(['https://new.sub.a.com']);
	});
	it('a saved scan row whose domain left the database is removed', () => {
		const saved = [
			scanPair('https://a.com', 'https://my.test'),
			scanPair('https://gone.com', 'https://x.test'),
		];
		const r = reconcilePairs(saved, [cand('https://a.com', 'https://my.test')]);
		expect(r.pairs.map((p) => p.search)).toEqual(['https://a.com']);
		expect(r.removed).toEqual(['https://gone.com']);
	});
	it('custom rows are never removed, even when the domain is not in the database', () => {
		const saved = [
			pair('https://typed.com', 'https://t.test'),
			pair('a+', 'b', { regex: true }),
			scanPair('https://a.com', 'https://my.test'),
		];
		const r = reconcilePairs(saved, []);
		expect(r.pairs.map((p) => p.search)).toEqual(['https://typed.com', 'a+']);
		expect(r.removed).toEqual(['https://a.com']);
	});
	it('a scan row whose search text was edited counts as custom and is kept', () => {
		const edited = scanPair('https://a.com', 'https://my.test', { search: 'https://a.com/blog' });
		const r = reconcilePairs([edited], []);
		expect(r.pairs).toEqual([edited]);
		expect(r.removed).toEqual([]);
	});
	it('does not add a domain twice when the user already typed the same domain', () => {
		const typed = pair('https://a.com/', 'https://t.test');
		const r = reconcilePairs([typed], [cand('https://a.com', 'https://my.test')]);
		expect(r.pairs).toEqual([typed]);
		expect(r.added).toEqual([]);
	});
	it('matches domains ignoring case and trailing slash', () => {
		const r = reconcilePairs(
			[scanPair('HTTPS://A.com/', 'https://my.test')],
			[cand('https://a.com', 'https://my.test')],
		);
		expect(r.removed).toEqual([]);
		expect(r.added).toEqual([]);
	});
	it('an empty replace gets a suggestion that did not exist before; typed text is never overwritten', () => {
		const empty = scanPair('https://a.com', '');
		expect(
			reconcilePairs([empty], [cand('https://a.com', 'https://my.test')]).pairs[0].replace,
		).toBe('https://my.test');
		expect(reconcilePairs([empty], [cand('https://a.com', '')]).pairs[0].replace).toBe('');
		const typed = scanPair('https://a.com', 'https://mine.test');
		expect(
			reconcilePairs([typed], [cand('https://a.com', 'https://my.test')]).pairs[0].replace,
		).toBe('https://mine.test');
	});
	it('is stable: a second scan with the same database changes nothing', () => {
		const c = [
			cand('https://a.com', 'https://my.test'),
			cand('https://one.a.com', 'https://one.my.test'),
		];
		const first = reconcilePairs([], c);
		const second = reconcilePairs(first.pairs, c);
		expect(second.pairs).toEqual(first.pairs);
		expect(second.added).toEqual([]);
		expect(second.removed).toEqual([]);
	});
	it('sub-domain and sub-directory rows are stored, edited and kept like any other', () => {
		const c = [
			cand('https://a.com', 'https://my.test'),
			cand('https://a.com/one', 'https://my.test/one'),
			cand('https://two.a.com', 'https://two.my.test'),
		];
		const first = reconcilePairs([], c);
		const edited = first.pairs.map((p) =>
			p.search === 'https://two.a.com' ? { ...p, replace: 'https://two-custom.test' } : p,
		);
		const again = reconcilePairs(edited, c);
		expect(again.pairs.find((p) => p.search === 'https://two.a.com')?.replace).toBe(
			'https://two-custom.test',
		);
	});
	it('does not change its input', () => {
		const saved = [scanPair('https://gone.com', 'https://x.test')];
		const copy = JSON.parse(JSON.stringify(saved));
		reconcilePairs(saved, []);
		expect(saved).toEqual(copy);
	});
});

describe('every domain found in the database is listed: main first, then close, then the others', () => {
	const hit = (count: number, primary: boolean, sources: string[]) => ({ count, primary, sources });
	// A single site: siteurl and home are one domain, and the options table is full of other hosts.
	const raw = {
		'https://prod.example.net': hit(94, true, [
			'siteurl (site 1)',
			'home (site 1)',
			'options (site 1)',
		]),
		'https://cdn.partner.com': hit(259, false, ['options (site 1)']),
		'https://api.prod.example.net': hit(120, false, ['options (site 1)']),
		'https://fonts.vendor.io': hit(198, false, ['options (site 1)']),
		'https://prod.example.io': hit(11, false, ['options (site 1)']),
		'https://api.service.dev': hit(162, false, ['options (site 1)']),
	};
	const rowsOf = (r: typeof raw, ctx = singleCtx(), saved: ReturnType<typeof pair>[] = []) =>
		reconcilePairs(saved, buildCandidates(r, ctx, 'https://my.test'));
	const by = (pairs: ReturnType<typeof pair>[]) =>
		Object.fromEntries(pairs.map((p) => [p.search, p]));

	it('lists all of them, none dropped', () => {
		const { pairs, added } = rowsOf(raw);
		expect(pairs).toHaveLength(6);
		expect(added).toHaveLength(6);
	});
	it('the main domain is first and ticked, with the Local URL as the replace', () => {
		const { pairs } = rowsOf(raw);
		expect(pairs[0]).toMatchObject({
			search: 'https://prod.example.net',
			replace: 'https://my.test',
			enabled: true,
			kind: 'main',
		});
	});
	it('close domains come next: a suggested replace, not ticked', () => {
		const { pairs } = rowsOf(raw);
		const close = pairs.filter((p) => p.kind === 'close');
		expect(close.map((p) => p.search).sort()).toEqual([
			'https://api.prod.example.net',
			'https://prod.example.io',
		]);
		expect(by(pairs)['https://api.prod.example.net']).toMatchObject({
			replace: 'https://api.my.test',
			enabled: false,
		});
		expect(pairs.indexOf(close[0])).toBeLessThan(pairs.findIndex((p) => p.kind === 'other'));
	});
	it('every other domain follows: not ticked, no replace text', () => {
		const { pairs } = rowsOf(raw);
		const other = pairs.filter((p) => p.kind === 'other');
		expect(other.map((p) => p.search).sort()).toEqual([
			'https://api.service.dev',
			'https://cdn.partner.com',
			'https://fonts.vendor.io',
		]);
		expect(other.every((p) => !p.enabled && p.replace === '')).toBe(true);
	});
	it('the order is main, close, other, whatever order the domains were found in', () => {
		const kinds = rowsOf(raw).pairs.map((p) => p.kind);
		expect(kinds).toEqual(
			[...kinds].sort(
				(a, b) =>
					['main', 'close', 'other'].indexOf(a as string) -
					['main', 'close', 'other'].indexOf(b as string),
			),
		);
	});
	it('a main domain found later goes above the others, not below them', () => {
		const first = rowsOf({
			'https://cdn.partner.com': hit(5, false, ['options (site 1)']),
			'https://prod.example.net': hit(1, true, ['siteurl (site 1)']),
		}).pairs;
		const later = { ...raw, 'https://new-main.example.net': hit(1, true, ['wp_blogs']) };
		const pairs = rowsOf(later, singleCtx(), first).pairs;
		expect(pairs.findIndex((p) => p.search === 'https://new-main.example.net')).toBeLessThan(
			pairs.findIndex((p) => p.search === 'https://cdn.partner.com'),
		);
	});
	it('ticking an "other" domain and typing its replace text is kept on the next scan', () => {
		const first = rowsOf(raw).pairs.map((p) =>
			p.search === 'https://api.service.dev'
				? { ...p, enabled: true, replace: 'https://api.mock.test' }
				: p,
		);
		const again = by(rowsOf(raw, singleCtx(), first).pairs)['https://api.service.dev'];
		expect(again).toMatchObject({ enabled: true, replace: 'https://api.mock.test', kind: 'other' });
	});
	it('a domain that leaves the database leaves the list, whatever its group; rows typed by the user stay and come last', () => {
		const first = rowsOf(raw).pairs;
		const typed = pair('https://typed.example', 'https://t.test');
		const { pairs, removed } = rowsOf(
			{ 'https://prod.example.net': hit(1, true, ['siteurl (site 1)']) },
			singleCtx(),
			[typed, ...first],
		);
		expect(removed).toHaveLength(5);
		expect(pairs.map((p) => p.search)).toEqual([
			'https://prod.example.net',
			'https://typed.example',
		]);
	});
	it('a domain that moves between groups (a new site URL makes it main) follows', () => {
		const first = rowsOf(raw).pairs;
		const moved = { ...raw, 'https://cdn.partner.com': hit(259, true, ['wp_blogs']) };
		expect(by(rowsOf(moved, singleCtx(), first).pairs)['https://cdn.partner.com'].kind).toBe(
			'main',
		);
	});
	it('a network: registered hosts are main and ticked, a close domain is unticked, the rest are other', () => {
		const net = {
			'https://prod.example.net': hit(1, true, ['network siteurl', 'wp_site', 'wp_blogs']),
			'https://one.prod.example.net': hit(1, true, ['wp_blogs', 'siteurl (site 2)']),
			'https://api.prod.example.net': hit(40, false, ['options (site 1)']),
			'https://cdn.partner.com': hit(300, false, ['options (site 1)']),
		};
		const { pairs } = rowsOf(net as typeof raw, multiCtx(true));
		expect(
			pairs
				.filter((p) => p.enabled)
				.map((p) => p.search)
				.sort(),
		).toEqual(['https://one.prod.example.net', 'https://prod.example.net']);
		expect(pairs.map((p) => p.kind)).toEqual(['main', 'main', 'close', 'other']);
	});
	it('kindOf', () => {
		expect(kindOf({ ...cand('https://a.com', 'x'), primary: true })).toBe('main');
		expect(kindOf({ ...cand('https://a.com', 'x'), primary: false })).toBe('close');
		expect(kindOf({ ...cand('https://a.com', ''), primary: false })).toBe('other');
	});
	it('orderRows keeps the order inside a group and puts custom rows after the scanned ones', () => {
		const rows = [
			pair('typed', 'x'),
			pair('o1', '', { id: scanId('o1'), origin: 'scan', kind: 'other' }),
			pair('m1', 'x', { id: scanId('m1'), origin: 'scan', kind: 'main' }),
			pair('o2', '', { id: scanId('o2'), origin: 'scan', kind: 'other' }),
			pair('m2', 'x', { id: scanId('m2'), origin: 'scan', kind: 'main' }),
		];
		expect(orderRows(rows).map((p) => p.search)).toEqual(['m1', 'm2', 'o1', 'o2', 'typed']);
	});
	it('no blank rows: every row has a search text', () => {
		expect(rowsOf(raw).pairs.every((p) => p.search.length > 0)).toBe(true);
	});
});

describe('suggestions follow SSL without overwriting what the user typed', () => {
	const c = (replace: string) => [cand('https://prod.example.net', replace)];
	it('a new row remembers what was suggested', () => {
		expect(reconcilePairs([], c('https://my.test')).pairs[0]).toMatchObject({
			replace: 'https://my.test',
			suggested: 'https://my.test',
		});
	});
	it('SSL was turned on: a row that still holds the old http suggestion becomes https', () => {
		const first = reconcilePairs([], c('http://my.test')).pairs;
		const again = reconcilePairs(first, c('https://my.test')).pairs[0];
		expect(again).toMatchObject({ replace: 'https://my.test', suggested: 'https://my.test' });
	});
	it('a row saved by an older version (no remembered suggestion) with the old http suggestion is healed too', () => {
		const old = [scanPair('https://prod.example.net', 'http://my.test')];
		expect(reconcilePairs(old, c('https://my.test')).pairs[0].replace).toBe('https://my.test');
	});
	it('text the user typed is never replaced, even when it differs only by the protocol of the suggestion', () => {
		const first = reconcilePairs([], c('http://my.test')).pairs;
		const typed = first.map((p) => ({ ...p, replace: 'http://my.test/custom' }));
		expect(reconcilePairs(typed, c('https://my.test')).pairs[0].replace).toBe(
			'http://my.test/custom',
		);
		const legacyTyped = [scanPair('https://prod.example.net', 'http://other.test')];
		expect(reconcilePairs(legacyTyped, c('https://my.test')).pairs[0].replace).toBe(
			'http://other.test',
		);
	});
	it('a user who keeps the old text on purpose: it stays when the row was edited, even to the same words', () => {
		const first = reconcilePairs([], c('http://my.test')).pairs;
		const edited = first.map((p) => ({
			...p,
			suggested: 'something else',
			replace: 'http://my.test',
		}));
		expect(reconcilePairs(edited, c('https://my.test')).pairs[0].replace).toBe('http://my.test');
	});
	it('stable: the same suggestion changes nothing', () => {
		const first = reconcilePairs([], c('https://my.test')).pairs;
		expect(reconcilePairs(first, c('https://my.test')).pairs).toEqual(first);
	});
});

describe("the site's own Local domain", () => {
	it('is listed but not ticked: it maps to itself, so there is nothing to change', () => {
		const own = { ...cand('https://my-site.test', 'https://my-site.test'), preselected: true };
		const { pairs } = reconcilePairs(
			[],
			[own, cand('https://old.example.net', 'https://my-site.test')],
		);
		expect(pairs.find((p) => p.search === 'https://my-site.test')?.enabled).toBe(false);
		expect(pairs.find((p) => p.search === 'https://old.example.net')?.enabled).toBe(true);
	});
});
