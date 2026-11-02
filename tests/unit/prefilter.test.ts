import { describe, expect, it } from 'vitest';
import { needlesFor } from '../../src/engine/prefilter';
import { pair } from './helpers';

describe('needlesFor', () => {
	it('a URL gives its host, without scheme, path or port', () => {
		expect(needlesFor([pair('https://prod.example.net', 'https://my.test')])).toEqual([
			'prod.example.net',
		]);
		expect(needlesFor([pair('https://prod.example.net:8080/blog', 'x')])).toEqual([
			'prod.example.net',
		]);
	});
	it('a bare host gives itself, a plain text gives the text', () => {
		expect(
			needlesFor([pair('prod.example.net', 'my.test'), pair('old company name', 'new')]),
		).toEqual(['prod.example.net', 'old company name']);
	});
	it('regex and disabled pairs give nothing; duplicates collapse; text is trimmed', () => {
		expect(
			needlesFor([
				pair('a+', 'b', { regex: true }),
				pair('https://x.com', 'y', { enabled: false }),
			]),
		).toEqual([]);
		expect(
			needlesFor([
				pair(' https://a.com ', 'x', { id: '1' }),
				pair('http://a.com', 'y', { id: '2' }),
			]),
		).toEqual(['a.com']);
	});
	it('the host is lower case, so it matches any case in the database', () => {
		expect(needlesFor([pair('https://Prod.Example.NET', 'x')])).toEqual(['prod.example.net']);
	});
});

describe('needlesFor and no-op rows', () => {
	it('a row with the same search and replace gives no search text', () => {
		expect(
			needlesFor([
				pair('https://my-site.test', 'https://my-site.test'),
				pair('https://old.example.net', 'https://my-site.test'),
			]),
		).toEqual(['old.example.net']);
	});
});
