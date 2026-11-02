import { describe, expect, it } from 'vitest';
import { buildCandidates } from '../../src/engine/scan';
import { multiCtx, singleCtx } from './helpers';

const local = 'https://my.test';
const hit = (count: number, primary: boolean, sources: string[] = ['options (site 1)']) => ({
	count,
	sources,
	primary,
});

describe('buildCandidates', () => {
	it('single site: siteurl is primary, pre-selected and mapped to the Local URL', () => {
		const [c] = buildCandidates(
			{ 'https://prod.example.net': hit(1, true, ['siteurl (site 1)']) },
			singleCtx(),
			local,
		);
		expect(c).toMatchObject({
			host: 'prod.example.net',
			primary: true,
			preselected: true,
			suggestedReplace: local,
		});
	});
	it('other hosts are listed but not pre-selected', () => {
		const list = buildCandidates(
			{ 'https://prod.example.net': hit(1, true), 'https://cdn.partner.com': hit(9, false) },
			singleCtx(),
			local,
		);
		expect(list.map((c) => c.host)).toEqual(['prod.example.net', 'cdn.partner.com']);
		expect(list[1].preselected).toBe(false);
	});
	it('drops noise hosts unless they are primary', () => {
		const list = buildCandidates(
			{ 'https://wordpress.org': hit(50, false), 'https://gravatar.com': hit(5, false) },
			singleCtx(),
			local,
		);
		expect(list).toEqual([]);
	});
	it('the Local host itself is never pre-selected', () => {
		const ctx = singleCtx();
		ctx.blogs[0].siteurl = local;
		const [c] = buildCandidates({ [local]: hit(1, true) }, ctx, local);
		expect(c.preselected).toBe(false);
	});
	it('merges a trailing slash and an http/https value of the same text, adds counts and sources', () => {
		const list = buildCandidates(
			{
				'https://prod.example.net': hit(2, true, ['a']),
				'https://prod.example.net/': hit(3, false, ['b']),
			},
			singleCtx(),
			local,
		);
		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject({ count: 5, primary: true, sources: ['a', 'b'] });
	});
	it('keeps http and https as separate rows', () => {
		const list = buildCandidates(
			{ 'https://prod.example.net': hit(1, true), 'http://prod.example.net': hit(1, false) },
			singleCtx(),
			local,
		);
		expect(list).toHaveLength(2);
	});
	it('ignores values that are not URLs', () => {
		expect(buildCandidates({ 'not a url': hit(1, true) }, singleCtx(), local)).toEqual([]);
	});
	it('sub-domain network: every sub-site host is pre-selected with its own sub-domain of the Local host', () => {
		const raw = {
			'https://prod.example.net': hit(1, true),
			'https://one.prod.example.net': hit(1, true),
			'https://two.prod.example.net': hit(1, true),
			'https://cdn.other.org': hit(4, false),
		};
		const list = buildCandidates(raw, multiCtx(true), local);
		const sel = list.filter((c) => c.preselected).map((c) => [c.host, c.suggestedReplace]);
		expect(sel).toEqual(
			expect.arrayContaining([
				['prod.example.net', local],
				['one.prod.example.net', 'https://one.my.test'],
				['two.prod.example.net', 'https://two.my.test'],
			]),
		);
		expect(list.find((c) => c.host === 'cdn.other.org')?.preselected).toBe(false);
	});
	it('sub-directory network: only the main host is pre-selected; sub-site paths map under the Local URL', () => {
		const raw = {
			'https://prod.example.net': hit(1, true),
			'https://prod.example.net/one': hit(1, true),
		};
		const list = buildCandidates(raw, multiCtx(false), local);
		const withPath = list.find((c) => c.value.endsWith('/one'));
		expect(withPath?.suggestedReplace).toBe(`${local}/one`);
		expect(list.find((c) => c.value === 'https://prod.example.net')?.preselected).toBe(true);
		expect(withPath?.preselected).toBe(false);
	});
	it('wp_site and wp_blogs hosts (primary) are offered for a network', () => {
		const raw = {
			'https://prod.example.net': hit(1, true, ['wp_site']),
			'https://one.prod.example.net': hit(1, true, ['wp_blogs']),
		};
		const list = buildCandidates(raw, multiCtx(true), local);
		expect(list.map((c) => c.sources[0]).sort()).toEqual(['wp_blogs', 'wp_site']);
	});
	it('www twin is mapped to the plain Local URL and ticked; near domains are suggested but NOT ticked; unrelated hosts get nothing', () => {
		const raw = {
			'https://prod.example.net': hit(1, true),
			'https://www.prod.example.net': hit(7, false),
			'https://api.prod.example.net': hit(3, false),
			'https://prod.example.io': hit(2, false),
			'https://cdn.partner.com': hit(9, false),
		};
		const by = Object.fromEntries(buildCandidates(raw, singleCtx(), local).map((c) => [c.host, c]));
		expect(by['prod.example.net']).toMatchObject({ suggestedReplace: local, preselected: true });
		expect(by['www.prod.example.net']).toMatchObject({
			suggestedReplace: local,
			preselected: true,
		});
		expect(by['api.prod.example.net']).toMatchObject({
			suggestedReplace: 'https://api.my.test',
			preselected: false,
		});
		expect(by['prod.example.io']).toMatchObject({ suggestedReplace: local, preselected: false });
		expect(by['cdn.partner.com']).toMatchObject({ suggestedReplace: '', preselected: false });
	});
	it('a www twin with another scheme than the main URL is listed but not ticked', () => {
		const [, twin] = buildCandidates(
			{ 'https://prod.example.net': hit(1, true), 'http://www.prod.example.net': hit(2, false) },
			singleCtx(),
			local,
		);
		expect(twin).toMatchObject({ host: 'www.prod.example.net', preselected: false });
	});
	it('www of the Local host counts as the Local host and is never ticked', () => {
		const list = buildCandidates({ 'https://www.my.test': hit(1, true) }, singleCtx(), local);
		expect(list[0].preselected).toBe(false);
	});
	it('on a sub-domain network a non-sub-site sub-domain is still not suggested when it is outside the origin', () => {
		const list = buildCandidates({ 'https://one.other.org': hit(1, true) }, multiCtx(true), local);
		expect(list[0]).toMatchObject({ suggestedReplace: '', preselected: false });
	});
	it('a port in the Local URL is kept', () => {
		const [c] = buildCandidates(
			{ 'https://prod.example.net': hit(1, true) },
			singleCtx(),
			'http://my.test:10010',
		);
		expect(c.suggestedReplace).toBe('http://my.test:10010');
	});
});
