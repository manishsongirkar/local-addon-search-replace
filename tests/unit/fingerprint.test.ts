import { describe, expect, it } from 'vitest';
import { type Fingerprint, compareFingerprints } from '../../src/engine/fingerprint';

const fp = (tables = 't1', urls = 'u1', count = 12): Fingerprint => ({ tables, urls, count });

describe('compareFingerprints: did the database change since the last scan?', () => {
	it('the same database is no change, and gives no reason', () => {
		expect(compareFingerprints(fp(), fp())).toEqual({ changed: false, reason: '' });
	});
	it('the database cannot be read: no change is claimed', () => {
		expect(compareFingerprints(fp(), null)).toEqual({ changed: false, reason: '' });
		expect(compareFingerprints(null, null)).toEqual({ changed: false, reason: '' });
	});
	it('never scanned in this session: scan', () => {
		const c = compareFingerprints(null, fp());
		expect(c.changed).toBe(true);
		expect(c.reason).toMatch(/not scanned in this session/);
	});
	it('tables created again (an import, whatever the tool): changed, and the count is told when it differs', () => {
		const same = compareFingerprints(fp('a'), fp('b'));
		expect(same).toMatchObject({ changed: true });
		expect(same.reason).toMatch(/created again/);
		const more = compareFingerprints(fp('a', 'u', 12), fp('b', 'u', 40));
		expect(more.reason).toMatch(/12 before, 40 now/);
	});
	it('only the site URL changed (a search-replace of the site URL): changed', () => {
		const c = compareFingerprints(fp('a', 'u1'), fp('a', 'u2'));
		expect(c.changed).toBe(true);
		expect(c.reason).toMatch(/site URL/);
	});
	it('both changed: the database was replaced', () => {
		expect(compareFingerprints(fp('a', 'u1'), fp('b', 'u2')).reason).toMatch(/replaced/);
	});
});
