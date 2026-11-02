import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	DARK,
	LIGHT,
	type Palette,
	type Rgba,
	baseCss,
	cssVars,
	detectDark,
	luminance,
	paletteFor,
	parseColor,
} from '../../src/renderer/theme';

describe('parseColor', () => {
	it.each([
		['rgb(38, 38, 38)', [38, 38, 38, 1]],
		['rgba(0,0,0,.5)', [0, 0, 0, 0.5]],
		['rgb(10 20 30 / 50%)', [10, 20, 30, 0.5]],
		['#fff', [255, 255, 255, 1]],
		['#1b1B1b', [27, 27, 27, 1]],
		['transparent', [0, 0, 0, 0]],
		['rgba(0, 0, 0, 0)', [0, 0, 0, 0]],
	])('%s', (input, expected) => {
		expect(parseColor(input)).toEqual(expected);
	});
	it.each(['', null, undefined, 'red', 'not a color', 'rgb(1,2)', '#12'])(
		'%j is not understood',
		(v) => {
			expect(parseColor(v as string)).toBeNull();
		},
	);
});

describe('detectDark', () => {
	it('Local dark: a dark page background', () => {
		expect(
			detectDark({
				backgrounds: ['rgba(0, 0, 0, 0)', 'rgb(38, 38, 38)'],
				text: 'rgb(255,255,255)',
			}),
		).toBe(true);
	});
	it('Local light: a light page background', () => {
		expect(
			detectDark({
				backgrounds: ['rgba(0, 0, 0, 0)', 'rgb(250, 250, 250)'],
				text: 'rgb(30,30,30)',
			}),
		).toBe(false);
	});
	it('the nearest opaque background decides, not a far one', () => {
		expect(detectDark({ backgrounds: ['rgb(20,20,20)', 'rgb(255,255,255)'] })).toBe(true);
		expect(detectDark({ backgrounds: ['transparent', 'rgb(255,255,255)', 'rgb(0,0,0)'] })).toBe(
			false,
		);
	});
	it('a mostly transparent layer is skipped', () => {
		expect(detectDark({ backgrounds: ['rgba(0,0,0,0.2)', 'rgb(240,240,240)'] })).toBe(false);
	});
	it('no background anywhere: light text means a dark theme', () => {
		expect(
			detectDark({ backgrounds: ['transparent', null, undefined], text: 'rgb(240,240,240)' }),
		).toBe(true);
		expect(detectDark({ backgrounds: ['transparent'], text: 'rgb(20,20,20)' })).toBe(false);
	});
	it('nothing readable: the system setting, then light', () => {
		expect(detectDark({ backgrounds: [], prefersDark: true })).toBe(true);
		expect(detectDark({ backgrounds: [], prefersDark: false })).toBe(false);
		expect(detectDark({ backgrounds: [] })).toBe(false);
	});
});

describe('palettes', () => {
	const bg = (p: Palette): Rgba => (p.dark ? [38, 38, 38, 1] : [255, 255, 255, 1]);
	/** WCAG contrast ratio. */
	const lin = (v: number) => {
		const c = v / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	const L = ([r, g, b]: Rgba) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
	const contrast = (a: Rgba, b: Rgba) =>
		(Math.max(L(a), L(b)) + 0.05) / (Math.min(L(a), L(b)) + 0.05);
	const color = (s: string) => parseColor(s) as Rgba;

	it('paletteFor picks by theme', () => {
		expect(paletteFor(true)).toBe(DARK);
		expect(paletteFor(false)).toBe(LIGHT);
	});
	it.each([DARK, LIGHT])('text in a field is readable (4.5:1 or better), dark=$dark', (p) => {
		expect(contrast(color(p.fieldFg), color(p.fieldBg))).toBeGreaterThanOrEqual(4.5);
	});
	it.each([DARK, LIGHT])(
		'every level colour and the muted text are readable on the page, dark=$dark',
		(p) => {
			for (const key of ['error', 'warn', 'notice', 'info', 'cmd', 'muted', 'accent'] as const) {
				expect(
					contrast(color(p[key]), bg(p)),
					`${key} (${p.dark ? 'dark' : 'light'})`,
				).toBeGreaterThanOrEqual(3);
			}
			for (const key of ['error', 'warn', 'notice', 'info', 'cmd', 'muted'] as const) {
				expect(
					contrast(color(p[key]), bg(p)),
					`${key} text (${p.dark ? 'dark' : 'light'})`,
				).toBeGreaterThanOrEqual(4.5);
			}
		},
	);
	it('a dark field is dark and a light field is light, so a field never looks white-on-white', () => {
		expect(luminance(color(DARK.fieldBg))).toBeLessThan(0.3);
		expect(luminance(color(DARK.fieldFg))).toBeGreaterThan(0.7);
		expect(luminance(color(LIGHT.fieldBg))).toBeGreaterThan(0.7);
		expect(luminance(color(LIGHT.fieldFg))).toBeLessThan(0.3);
	});
	it('cssVars gives every variable the styles use, and baseCss sets the control scheme', () => {
		const vars = cssVars(DARK);
		for (const k of [
			'--sr-field-bg',
			'--sr-field-fg',
			'--sr-field-border',
			'--sr-border',
			'--sr-muted',
			'--sr-accent',
			'--sr-error',
			'--sr-warn',
			'--sr-notice',
			'--sr-info',
			'--sr-cmd',
			'--sr-code',
		]) {
			expect(vars[k], k).toBeTruthy();
		}
		expect(baseCss(DARK)).toContain('color-scheme:dark');
		expect(baseCss(LIGHT)).toContain('color-scheme:light');
	});
});

describe('the UI only uses variables the theme defines', () => {
	it('every var(--sr-...) in src/renderer is in cssVars', () => {
		const dir = path.resolve(__dirname, '..', '..', 'src', 'renderer');
		const used = new Set<string>();
		for (const f of fs.readdirSync(dir).filter((n) => /\.(ts|tsx)$/.test(n) && n !== 'theme.ts')) {
			for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/var\((--sr-[a-z-]+)/g))
				used.add(m[1]);
		}
		expect(used.size).toBeGreaterThan(5);
		const defined = Object.keys(cssVars(DARK));
		for (const v of used) expect(defined, v).toContain(v);
	});
});
