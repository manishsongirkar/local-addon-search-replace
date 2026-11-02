import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * This repository is public. Test data must be made up: no real Local site names, no personal paths, no real e-mail
 * addresses. A site on your machine is called `<name>.test` or `<name>.local`, so any such host that is not on the list
 * below fails this test. Use a placeholder from the list. Add a new generic one only if it is not a real site.
 */
const ROOT = path.resolve(__dirname, '..', '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'lib', '.ci', 'coverage']);
const EXTENSIONS = /\.(ts|tsx|js|mjs|json|md|php|ya?ml|sh|hbs|svg)$/;

function files(dir: string, out: string[] = []): string[] {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		if (SKIP_DIRS.has(e.name)) continue;
		const p = path.join(dir, e.name);
		if (e.isDirectory()) files(p, out);
		else if (
			EXTENSIONS.test(e.name) &&
			e.name !== 'package-lock.json' &&
			e.name !== 'no-personal-data.test.ts'
		)
			out.push(p);
	}
	return out;
}

/** Placeholders (registrable part, the last two labels). `*.test` file names such as `urls.test.ts` are matched too. */
const ALLOWED_HOSTS = new Set([
	'my.test',
	'my-site.test',
	'mysite.local',
	'ms.test',
	's1.test',
	'b.test',
	'a.test',
	'x.test',
	'y.test',
	'u.test',
	't.test',
	'r.test',
	'p.test',
	'i.test',
	're.test',
	'1.test',
	'cdn.test',
	'other.test',
	'mine.test',
	'two.test',
	'two-custom.test',
	// File names, not hosts.
	'urls.test',
	'php.test',
	'wp-cli.local',
	'pattern.test',
	// Other generic made-up names.
	'mysite.test',
	'custom.test',
	'a2.test',
	'one.test',
	'n.test',
	'c.test',
	'2fmy.test',
	'acme.test',
	'mock.test',
]);

const all = files(ROOT).map((f) => ({
	f: path.relative(ROOT, f),
	text: fs.readFileSync(f, 'utf8'),
}));

describe('the repository holds no personal data', () => {
	it('finds files to check', () => {
		expect(all.length).toBeGreaterThan(20);
	});
	it('every .test and .local host is a placeholder from the list', () => {
		const bad: string[] = [];
		for (const { f, text } of all) {
			for (const m of text.matchAll(
				/\b([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)\.(test|local)\b(?!\.(?:ts|tsx|js|mjs)\b)/g,
			)) {
				const labels = `${m[1]}.${m[2]}`.toLowerCase().split('.');
				const registrable = labels.slice(-2).join('.');
				if (!ALLOWED_HOSTS.has(registrable)) bad.push(`${f}: ${m[0]}`);
			}
		}
		expect(
			bad,
			'Use a made-up name such as my-site.test, or add a generic one to ALLOWED_HOSTS.',
		).toEqual([]);
	});
	it('no personal folder paths', () => {
		const bad: string[] = [];
		for (const { f, text } of all) {
			// `<name>`, `x` or `me` style placeholders are fine.
			for (const m of text.matchAll(/(?:\/Users\/|\/home\/|[A-Z]:\\Users\\)([A-Za-z0-9._-]+)/g))
				if (!/^(?:[a-z]|me|user|name|runner|<.*>)$/i.test(m[1])) bad.push(`${f}: ${m[0]}`);
		}
		expect(bad).toEqual([]);
	});
	it('every e-mail address is on a reserved example domain', () => {
		const bad: string[] = [];
		for (const { f, text } of all) {
			for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)) {
				const host = m[1].toLowerCase();
				if (
					!/(^|\.)example\.(com|org|net|io)$/.test(host) &&
					!/\.test$/.test(host) &&
					!/^users\.noreply\.github\.com$/.test(host)
				)
					bad.push(`${f}: ${m[0]}`);
			}
		}
		expect(bad).toEqual([]);
	});
});
