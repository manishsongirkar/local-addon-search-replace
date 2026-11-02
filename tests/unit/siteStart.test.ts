import { describe, expect, it, vi } from 'vitest';
import { startIfHalted } from '../../src/engine/siteStart';

const log = vi.fn();
describe('startIfHalted', () => {
	it('starts a halted site and waits for the database', async () => {
		const start = vi.fn().mockResolvedValue(undefined);
		const waitForDB = vi.fn().mockResolvedValue(true);
		expect(
			await startIfHalted({ getSiteStatus: () => 'halted', start }, { waitForDB }, 's', log),
		).toBe(true);
		expect(start).toHaveBeenCalledWith('s');
		expect(waitForDB).toHaveBeenCalledWith('s');
	});
	it('leaves a running site alone', async () => {
		const start = vi.fn();
		expect(
			await startIfHalted({ getSiteStatus: () => 'running', start }, undefined, 's', log),
		).toBe(false);
		expect(start).not.toHaveBeenCalled();
	});
	it('does nothing when Local has no such API', async () => {
		expect(await startIfHalted(undefined, undefined, 's', log)).toBe(false);
		expect(await startIfHalted({}, undefined, 's', log)).toBe(false);
		expect(await startIfHalted({ getSiteStatus: () => 'halted' }, undefined, 's', log)).toBe(false);
	});
	it('falls back instead of throwing when the start fails', async () => {
		const warn = vi.fn();
		const start = vi.fn().mockRejectedValue(new Error('boom'));
		expect(
			await startIfHalted({ getSiteStatus: () => 'halted', start }, undefined, 's', warn),
		).toBe(false);
		expect(warn).toHaveBeenCalledWith('warn', expect.stringContaining('boom'));
	});
	it('falls back when the status call throws', async () => {
		const getSiteStatus = () => {
			throw new Error('x');
		};
		expect(await startIfHalted({ getSiteStatus, start: vi.fn() }, undefined, 's', log)).toBe(false);
	});
});
