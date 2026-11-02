import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileLog, classifyLine } from '../../src/engine/logger';

describe('classifyLine', () => {
	it.each([
		['PHP Fatal error:  Uncaught Error in /x.php', 'stdout', 'error'],
		['Fatal error: Allowed memory size', 'stderr', 'error'],
		['PHP Parse error: syntax error', 'stdout', 'error'],
		['Error: Site not found', 'stderr', 'error'],
		['PHP Warning:  Undefined variable $a', 'stderr', 'warn'],
		['Warning: Made 0 replacements.', 'stdout', 'warn'],
		['PHP Notice:  Undefined index', 'stderr', 'notice'],
		['Notice: Trying to access array offset', 'stdout', 'notice'],
		['PHP Deprecated:  Passing null to parameter', 'stderr', 'notice'],
		['Deprecated: Creation of dynamic property', 'stdout', 'notice'],
		['Success: Made 3 replacements.', 'stdout', 'info'],
		['something odd on stderr', 'stderr', 'warn'],
		['plain line', 'stdout', 'info'],
	] as const)('%s (%s) → %s', (line, stream, level) => {
		expect(classifyLine(line, stream)).toBe(level);
	});
});

describe('FileLog', () => {
	let dir: string;
	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-log-'));
	});
	afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

	it('writes ISO time, level and text, one line each', () => {
		const f = new FileLog(path.join(dir, 'a.log'));
		f.write('warn', Date.UTC(2025, 0, 2, 3, 4, 5), 'hello');
		expect(fs.readFileSync(path.join(dir, 'a.log'), 'utf8')).toBe(
			'2025-01-02T03:04:05.000Z [warn] hello\n',
		);
	});
	it('stops at the size cap, writes one notice, and never throws', () => {
		const file = path.join(dir, 'a.log');
		const f = new FileLog(file, 100);
		for (let i = 0; i < 20; i++) f.write('info', 0, `line number ${i}`);
		const text = fs.readFileSync(file, 'utf8');
		expect(text.match(/Log file limit reached/g)).toHaveLength(1);
		expect(fs.statSync(file).size).toBeLessThan(300);
	});
	it('a null path or an unwritable path is silent', () => {
		expect(() => new FileLog(null).write('info', 0, 'x')).not.toThrow();
		expect(() =>
			new FileLog(path.join(dir, 'missing', 'a.log')).write('info', 0, 'x'),
		).not.toThrow();
		expect(new FileLog(null).path).toBeNull();
	});
});
