import { describe, expect, it } from 'vitest';
import { withSsl } from '../../src/engine/localurl';
import { suggestReplacement } from '../../src/engine/urls';

describe('withSsl: the protocol a Local site is served on', () => {
	it('a site domain with a trusted certificate (SSL on) is https', () => {
		expect(withSsl('http://my-site.test', true)).toBe('https://my-site.test');
		expect(withSsl('http://sub.my-site.test/', true)).toBe('https://sub.my-site.test');
	});
	it('without a trusted certificate (SSL off, the state of a new site) it stays http', () => {
		expect(withSsl('http://my-site.test', false)).toBe('http://my-site.test');
	});
	it('localhost routing is plain http on a port, SSL or not', () => {
		expect(withSsl('http://localhost:10008', true)).toBe('http://localhost:10008');
		expect(withSsl('http://my-site.test:8080', true)).toBe('http://my-site.test:8080');
		expect(withSsl('http://127.0.0.1', true)).toBe('http://127.0.0.1');
	});
	it('an https URL stays, and junk is returned as it is', () => {
		expect(withSsl('https://my-site.test', true)).toBe('https://my-site.test');
		expect(withSsl('https://my-site.test', false)).toBe('https://my-site.test');
		expect(withSsl('???', true)).toBe('???');
	});
});

describe('the suggested replace uses the protocol of the Local URL', () => {
	it.each([
		[true, 'https'],
		[false, 'http'],
	])('SSL %s gives %s for the main domain, a sub-domain and a close domain', (ssl, scheme) => {
		const local = withSsl('http://my-site.test', ssl);
		expect(suggestReplacement('https://prod.example.net', 'prod.example.net', local)).toBe(
			`${scheme}://my-site.test`,
		);
		expect(suggestReplacement('http://www.prod.example.net/blog', 'prod.example.net', local)).toBe(
			`${scheme}://my-site.test/blog`,
		);
		expect(suggestReplacement('https://api.prod.example.net', 'prod.example.net', local)).toBe(
			`${scheme}://api.my-site.test`,
		);
		expect(suggestReplacement('https://prod.example.io', 'prod.example.net', local)).toBe(
			`${scheme}://my-site.test`,
		);
	});
});
