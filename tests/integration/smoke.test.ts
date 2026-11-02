import { describe, expect, it } from 'vitest';
import { loadContext, scanDomains } from '../../src/engine/scan';
import { makeSite, seed } from './env';

describe('smoke', () => {
	it('installs a site and reads its context', async () => {
		const s = makeSite({ kind: 'single' });
		seed(s, 'https://prod.example.net');
		const ctx = await loadContext(s.rt);
		expect(ctx.multisite).toBe(false);
		expect(ctx.blogs[0].siteurl).toBe('https://prod.example.net');
		const c = await scanDomains(s.rt, ctx, 'https://s1.test');
		expect(c[0].value).toBe('https://prod.example.net');
		expect(c[0].suggestedReplace).toBe('https://s1.test');
		expect(c[0].preselected).toBe(true);
		console.log(JSON.stringify(c, null, 1));
	});
});
