import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	BACKUP_PATTERN,
	LOG_PATTERN,
	MAX_LOG_BYTES,
	RETENTION_DAYS,
	pruneOld,
} from '../../src/engine/retention';

const DAY = 24 * 60 * 60 * 1000;
let dir: string;
beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-ret-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const touch = (name: string, ageDays: number) => {
	const f = path.join(dir, name);
	fs.writeFileSync(f, 'x');
	const t = (Date.now() - ageDays * DAY) / 1000;
	fs.utimesSync(f, t, t);
};

describe('log rotation', () => {
	it('keeps 30 days and the log cap is 10 MB', () => {
		expect(RETENTION_DAYS).toBe(30);
		expect(MAX_LOG_BYTES).toBe(10 * 1024 * 1024);
	});
	it('removes our logs and backups older than 30 days, keeps newer ones', () => {
		touch('run-20240101-101010.log', 31);
		touch('dry-run-20240101-101010.log', 45);
		touch('run-20240601-101010.log', 29);
		touch('search-replace-backup-20240101-101010.sql', 60);
		touch('search-replace-backup-20240601-101010.sql', 1);
		const removed = [...pruneOld(dir, LOG_PATTERN), ...pruneOld(dir, BACKUP_PATTERN)].sort();
		expect(removed).toEqual([
			'dry-run-20240101-101010.log',
			'run-20240101-101010.log',
			'search-replace-backup-20240101-101010.sql',
		]);
		expect(fs.readdirSync(dir).sort()).toEqual([
			'run-20240601-101010.log',
			'search-replace-backup-20240601-101010.sql',
		]);
	});
	it('never deletes files that are not ours, however old', () => {
		touch('my-own-dump.sql', 400);
		touch('notes.log', 400);
		touch('run-1.log', 400);
		expect(pruneOld(dir, LOG_PATTERN)).toEqual([]);
		expect(pruneOld(dir, BACKUP_PATTERN)).toEqual([]);
		expect(fs.readdirSync(dir)).toHaveLength(3);
	});
	it('the day limit is exact and honours an injected clock', () => {
		touch('run-20240101-101010.log', 10);
		expect(pruneOld(dir, LOG_PATTERN, 30, Date.now() + 19 * DAY)).toEqual([]);
		expect(pruneOld(dir, LOG_PATTERN, 30, Date.now() + 21 * DAY)).toEqual([
			'run-20240101-101010.log',
		]);
	});
	it('does not follow directories with a matching name and does not throw on a missing folder', () => {
		fs.mkdirSync(path.join(dir, 'run-20240101-101010.log'));
		expect(pruneOld(dir, LOG_PATTERN, 0, Date.now() + DAY)).toEqual([]);
		expect(pruneOld(path.join(dir, 'nope'), LOG_PATTERN)).toEqual([]);
	});
	it('the log name check used by the log reader rejects anything that is not one of our files', () => {
		for (const bad of [
			'../run-20250102-030405.log',
			'run-20250102-030405.log/..',
			'/etc/passwd',
			'run-1.log',
			'activity-20250102.log.bak',
			'run-20250102-030405.log\n../x',
			'C:\\x\\run-20250102-030405.log',
			'',
		]) {
			expect(LOG_PATTERN.test(bad), bad).toBe(false);
		}
		expect(LOG_PATTERN.test('activity-20250102.log')).toBe(true);
	});
	it('patterns match the names the runner writes', () => {
		expect(LOG_PATTERN.test('run-20250102-030405.log')).toBe(true);
		expect(LOG_PATTERN.test('dry-run-20250102-030405.log')).toBe(true);
		expect(BACKUP_PATTERN.test('search-replace-backup-20250102-030405.sql')).toBe(true);
	});
});
