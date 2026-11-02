/**
 * Colors that follow Local's theme (light or dark).
 * The theme is read from the page itself (the real background and text color), so it is right for any theme setting
 * Local has, now or later. Pure functions only, so they can be tested without Local.
 */

export interface Palette {
	dark: boolean;
	fieldBg: string;
	fieldFg: string;
	fieldBorder: string;
	border: string;
	muted: string;
	accent: string;
	/** Text on a filled accent button. */
	onAccent: string;
	error: string;
	warn: string;
	notice: string;
	info: string;
	cmd: string;
	/** Background of the log viewer and other code areas. */
	code: string;
}

export const DARK: Palette = {
	dark: true,
	fieldBg: '#1e1e1e',
	fieldFg: '#f2f2f2',
	fieldBorder: '#6b6b6b',
	border: 'rgba(255,255,255,.22)',
	muted: '#b5b5b5',
	accent: '#51bb7b',
	onAccent: '#0b2a17',
	error: '#ff7b7b',
	warn: '#f0b429',
	notice: '#b794f6',
	info: '#a8a8a8',
	cmd: '#5aa9f0',
	code: 'rgba(0,0,0,.28)',
};

export const LIGHT: Palette = {
	dark: false,
	fieldBg: '#ffffff',
	fieldFg: '#1b1b1b',
	fieldBorder: '#8a8a8a',
	border: 'rgba(0,0,0,.2)',
	muted: '#5c5c5c',
	accent: '#2e8b57',
	onAccent: '#ffffff',
	error: '#c62828',
	warn: '#8a5300',
	notice: '#6d3fd6',
	info: '#5c5c5c',
	cmd: '#1c5fa5',
	code: 'rgba(0,0,0,.05)',
};

export type Rgba = [number, number, number, number];

/** `rgb(1, 2, 3)`, `rgba(1,2,3,.5)`, `#rgb` and `#rrggbb`. `null` for anything else (`transparent` is alpha 0). */
export function parseColor(input: string | null | undefined): Rgba | null {
	const s = (input ?? '').trim().toLowerCase();
	if (!s) return null;
	if (s === 'transparent') return [0, 0, 0, 0];
	const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
	if (hex) {
		const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
		return [
			Number.parseInt(h.slice(0, 2), 16),
			Number.parseInt(h.slice(2, 4), 16),
			Number.parseInt(h.slice(4, 6), 16),
			1,
		];
	}
	const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
	if (!m) return null;
	const a =
		m[4] === undefined
			? 1
			: m[4].endsWith('%')
				? Number.parseFloat(m[4]) / 100
				: Number.parseFloat(m[4]);
	return [Number(m[1]), Number(m[2]), Number(m[3]), a];
}

/** Perceived brightness, 0 (black) to 1 (white). */
export const luminance = ([r, g, b]: Rgba): number => (0.299 * r + 0.587 * g + 0.114 * b) / 255;

export interface ThemeProbe {
	/** Background colors from the add-on's container up to the page, nearest first. */
	backgrounds: Array<string | null | undefined>;
	/** Text color of the add-on's container. */
	text?: string | null;
	/** The operating system setting, used only when the page gives no answer. */
	prefersDark?: boolean;
}

/**
 * Dark or light? The nearest background that is mostly opaque decides. Without one, the text color decides (light text
 * means a dark theme). Without that, the operating system setting.
 */
export function detectDark(p: ThemeProbe): boolean {
	for (const bg of p.backgrounds) {
		const c = parseColor(bg);
		if (c && c[3] >= 0.5) return luminance(c) < 0.5;
	}
	const text = parseColor(p.text);
	if (text && text[3] >= 0.5) return luminance(text) >= 0.5;
	return p.prefersDark ?? false;
}

export const paletteFor = (dark: boolean): Palette => (dark ? DARK : LIGHT);

/** CSS custom properties for the root element of the add-on. */
export function cssVars(p: Palette): Record<string, string> {
	return {
		'--sr-field-bg': p.fieldBg,
		'--sr-field-fg': p.fieldFg,
		'--sr-field-border': p.fieldBorder,
		'--sr-border': p.border,
		'--sr-muted': p.muted,
		'--sr-accent': p.accent,
		'--sr-on-accent': p.onAccent,
		'--sr-error': p.error,
		'--sr-warn': p.warn,
		'--sr-notice': p.notice,
		'--sr-info': p.info,
		'--sr-cmd': p.cmd,
		'--sr-code': p.code,
	};
}

/** Rules that inline styles cannot express: the placeholder color, the native control scheme, buttons, tabs and the pair grid. */
export const baseCss = (p: Palette): string =>
	[
		`.sr-root{color-scheme:${p.dark ? 'dark' : 'light'}}`,
		'.sr-root input::placeholder,.sr-root textarea::placeholder{color:var(--sr-muted);opacity:.85}',
		'.sr-root :focus-visible{outline:2px solid var(--sr-accent);outline-offset:1px}',
		'.sr-card{border:1px solid var(--sr-border);border-radius:8px;padding:16px;margin-bottom:16px}',
		'.sr-muted{color:var(--sr-muted)}',
		'.sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}',
		'.sr-btn[aria-disabled=true]{opacity:.5;cursor:not-allowed}',
		'.sr-banner{border:1px solid var(--sr-border);border-left:3px solid var(--sr-accent);border-radius:6px;padding:10px 14px;margin-bottom:16px;background:var(--sr-code)}',
		'.sr-btn{font:inherit;padding:6px 14px;border-radius:4px;border:1px solid var(--sr-field-border);background:transparent;color:inherit;cursor:pointer}',
		'.sr-btn:hover:not(:disabled){border-color:var(--sr-accent)}',
		'.sr-btn:disabled{opacity:.5;cursor:not-allowed}',
		'.sr-btn-primary{background:var(--sr-accent);border-color:var(--sr-accent);color:var(--sr-on-accent);font-weight:600}',
		'.sr-btn-sm{padding:4px 10px;white-space:nowrap}',
		'.sr-tab{font:inherit;padding:8px 16px;background:transparent;border:0;border-bottom:2px solid transparent;color:inherit;cursor:pointer}',
		'.sr-tab[aria-selected=true]{font-weight:700;border-bottom-color:var(--sr-accent)}',
		'.sr-badge{display:inline-block;min-width:18px;padding:0 6px;border-radius:9px;background:var(--sr-code);text-align:center;font-size:11px}',
		'.sr-pair{border:0;padding:0;margin-inline:0;min-width:0;display:grid;grid-template-columns:20px minmax(0,1fr) 16px minmax(0,1fr) auto auto auto;gap:8px;align-items:center;margin-top:8px}',
		'.sr-pair-note{grid-column:2/-1;font-size:11px;color:var(--sr-muted)}',
		'.sr-group{border:0;border-top:1px solid var(--sr-border);margin:16px 0 0;padding:12px 0 0;min-width:0}',
		'.sr-group legend{padding:0 8px 0 0;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--sr-muted)}',
		'.sr-opts{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:8px 24px}',
		'.sr-check{display:flex;gap:8px;align-items:flex-start;cursor:pointer}',
		'.sr-check input{margin-top:3px}',
		'.sr-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px 24px}',
		'.sr-field{display:flex;flex-direction:column;gap:4px}',
		'.sr-field>span{font-weight:600}',
		'.sr-note{border-left:3px solid var(--sr-info);border-radius:4px;padding:8px 12px;margin-bottom:8px;background:var(--sr-code)}',
		'.sr-note-error{border-left-color:var(--sr-error)}',
		'.sr-note-warning{border-left-color:var(--sr-warn)}',
		'.sr-toast{position:fixed;right:24px;bottom:24px;z-index:1000;max-width:360px;padding:10px 16px;border-radius:6px;border:1px solid var(--sr-border);border-left:3px solid var(--sr-accent);background:var(--sr-field-bg);color:var(--sr-field-fg);box-shadow:0 4px 16px rgba(0,0,0,.3);pointer-events:none;transition:opacity .15s}',
		'.sr-toast:empty{opacity:0}',
		'@media (prefers-reduced-motion:reduce){.sr-toast{transition:none}}',
		'.sr-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
		'.sr-btn-primary:disabled{opacity:.5}',
		'@media (max-width:820px){.sr-pair{grid-template-columns:20px minmax(0,1fr) minmax(0,1fr) auto auto}.sr-arrow,.sr-src{display:none}}',
	].join('');
