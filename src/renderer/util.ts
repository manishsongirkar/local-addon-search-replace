import { ipcAsync } from '@getflywheel/local/renderer';
import type { LogLevel, LogLine } from '../common/types';

/** Typed wrapper. Errors thrown in main arrive as rejected promises. */
export const call = <T = unknown>(channel: string, ...args: unknown[]): Promise<T> =>
	ipcAsync(channel, ...args);

export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** `75000` → `1:15`, `3725000` → `1:02:05`. */
export function fmtDuration(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const ss = String(s % 60).padStart(2, '0');
	return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export const LEVELS: LogLevel[] = ['error', 'warn', 'notice', 'info', 'cmd'];

/**
 * Colour plus a text label, so the level never depends on colour alone.
 * The colors are CSS variables set by the theme (see theme.ts), with a fallback for a page without them.
 */
export const LEVEL_STYLE: Record<LogLevel, { label: string; color: string }> = {
	error: { label: 'ERROR', color: 'var(--sr-error, #c62828)' },
	warn: { label: 'WARN', color: 'var(--sr-warn, #8a5300)' },
	notice: { label: 'NOTICE', color: 'var(--sr-notice, #6d3fd6)' },
	info: { label: 'INFO', color: 'var(--sr-info, #5c5c5c)' },
	cmd: { label: 'CMD', color: 'var(--sr-cmd, #1c5fa5)' },
};

/** Parse one line of a saved log file: `2025-01-02T03:04:05.000Z [level] text`. */
export function parseLogFile(text: string): LogLine[] {
	return text
		.split(/\r?\n/)
		.filter(Boolean)
		.map((row) => {
			const m = /^(\S+) \[(error|warn|notice|info|cmd)\] (.*)$/.exec(row);
			return m
				? { t: Date.parse(m[1]) || 0, level: m[2] as LogLevel, text: m[3] }
				: { t: 0, level: 'info', text: row };
		});
}

export const box = {
	border: '1px solid var(--sr-border, rgba(127,127,127,.35))',
	borderRadius: 8,
	padding: 16,
	marginBottom: 16,
} as const;
export const row = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } as const;
/**
 * Form fields take their colors from the theme (light or dark), set as CSS variables on the root of the add-on.
 * Without them a field would be white on white (light text on a white field) in one of the two themes.
 */
export const input = {
	padding: '6px 8px',
	minWidth: 0,
	color: 'var(--sr-field-fg, #1b1b1b)',
	background: 'var(--sr-field-bg, #ffffff)',
	border: '1px solid var(--sr-field-border, #8a8a8a)',
	borderRadius: 4,
} as const;
