import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, type HistoryEntry } from '../../src/common/types';
import {
	MAX_HISTORY,
	addHistory,
	cleanOptions,
	cleanPairs,
	loadConfig,
	readHistory,
	saveConfig,
} from '../../src/engine/store';
import { pair } from './helpers';

let root: string;
beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-store-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const entry = (n: number): HistoryEntry => ({
	id: String(n),
	at: n,
	dryRun: false,
	state: 'completed',
	durationMs: 1,
	replacements: n,
	pairs: [],
	backupFile: null,
	logFile: null,
});

describe('config', () => {
	it('a new site gets no pairs and the default options', () => {
		expect(loadConfig(path.join(root, 'none'))).toEqual({ pairs: [], options: DEFAULT_OPTIONS });
	});
	it('mappings survive a save and a load (the "remember my domains" rule)', () => {
		const dir = path.join(root, 'site');
		const pairs = [
			pair('https://a.com', 'https://my.test', { id: 'p1' }),
			pair('a+', 'b', { id: 'p2', regex: true, enabled: false }),
		];
		saveConfig(dir, { pairs, options: { ...DEFAULT_OPTIONS, backup: false, skipTables: 'wp_x' } });
		const back = loadConfig(dir);
		expect(back.pairs).toEqual(pairs);
		expect(back.options).toMatchObject({ backup: false, skipTables: 'wp_x' });
	});
	it('each site has its own config: saving one never changes another', () => {
		const a = path.join(root, 'siteA');
		const b = path.join(root, 'siteB');
		saveConfig(a, { pairs: [pair('https://a.com', 'https://a.test')], options: DEFAULT_OPTIONS });
		saveConfig(b, {
			pairs: [pair('https://b.com', 'https://b.test')],
			options: { ...DEFAULT_OPTIONS, precise: true },
		});
		saveConfig(a, { pairs: [pair('https://a2.com', 'https://a2.test')], options: DEFAULT_OPTIONS });
		expect(loadConfig(b).pairs.map((p) => p.search)).toEqual(['https://b.com']);
		expect(loadConfig(b).options.precise).toBe(true);
		expect(loadConfig(a).pairs.map((p) => p.search)).toEqual(['https://a2.com']);
		expect(loadConfig(a).options.precise).toBe(false);
	});
	it('a changed mapping replaces the old one', () => {
		const dir = path.join(root, 's');
		saveConfig(dir, {
			pairs: [pair('https://a.com', 'https://one.test', { id: 'x' })],
			options: DEFAULT_OPTIONS,
		});
		saveConfig(dir, {
			pairs: [pair('https://a.com', 'https://two.test', { id: 'x' })],
			options: DEFAULT_OPTIONS,
		});
		expect(loadConfig(dir).pairs).toHaveLength(1);
		expect(loadConfig(dir).pairs[0].replace).toBe('https://two.test');
	});
	it('a saved dry run is never restored', () => {
		const dir = path.join(root, 's');
		saveConfig(dir, { pairs: [], options: { ...DEFAULT_OPTIONS, dryRun: true } });
		expect(loadConfig(dir).options.dryRun).toBe(false);
	});
	it('a damaged or hand-edited file does not crash and falls back safely', () => {
		const dir = path.join(root, 's');
		fs.mkdirSync(dir);
		fs.writeFileSync(path.join(dir, 'config.json'), '{ not json');
		expect(loadConfig(dir)).toEqual({ pairs: [], options: DEFAULT_OPTIONS });
		fs.writeFileSync(
			path.join(dir, 'config.json'),
			JSON.stringify({ pairs: 'x', options: { backup: 'yes', evil: 1, skipTables: 5 } }),
		);
		expect(loadConfig(dir)).toEqual({ pairs: [], options: DEFAULT_OPTIONS });
	});
	it('leaves no temp file behind', () => {
		const dir = path.join(root, 's');
		saveConfig(dir, { pairs: [], options: DEFAULT_OPTIONS });
		expect(fs.readdirSync(dir)).toEqual(['config.json']);
	});
	it('cleanPairs drops junk and fills defaults', () => {
		expect(
			cleanPairs([
				null,
				5,
				{ search: 'a', replace: 'b' },
				{ id: 'k', search: 1, regex: 'yes', enabled: false },
			]),
		).toEqual([
			{ id: 'pair-0', search: 'a', replace: 'b', regex: false, enabled: true, origin: 'custom' },
			{ id: 'k', search: '', replace: '', regex: false, enabled: false, origin: 'custom' },
		]);
		expect(cleanPairs(undefined)).toEqual([]);
	});
	it('cleanOptions keeps only known keys of the right type', () => {
		const o = cleanOptions({ backup: false, precise: 'x', extra: 1, wpPath: '/w' });
		expect(o).toMatchObject({ backup: false, precise: false, wpPath: '/w' });
		expect(o).not.toHaveProperty('extra');
	});
});

describe('history', () => {
	it('newest first, capped at MAX_HISTORY', () => {
		for (let i = 0; i < MAX_HISTORY + 5; i++) addHistory(root, entry(i));
		const h = readHistory(root);
		expect(h).toHaveLength(MAX_HISTORY);
		expect(h[0].id).toBe(String(MAX_HISTORY + 4));
	});
	it('is separate per site folder', () => {
		addHistory(path.join(root, 'a'), entry(1));
		expect(readHistory(path.join(root, 'b'))).toEqual([]);
	});
	it('reads [] from a damaged file and never throws on write errors', () => {
		fs.writeFileSync(path.join(root, 'history.json'), 'oops');
		expect(readHistory(root)).toEqual([]);
		const file = path.join(root, 'blocker');
		fs.writeFileSync(file, '');
		expect(() => addHistory(path.join(file, 'sub'), entry(1))).not.toThrow();
	});
});

describe('cleanOptions: case and GUID', () => {
	it('defaults to exact case and no GUID change, and ignores old saved values', () => {
		expect(cleanOptions({})).toMatchObject({ caseSensitive: true, replaceGuid: false });
		expect(cleanOptions({ caseSensitive: false, replaceGuid: true })).toMatchObject({
			caseSensitive: true,
			replaceGuid: false,
		});
	});
});
