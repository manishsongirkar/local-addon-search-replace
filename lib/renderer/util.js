"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.input = exports.row = exports.box = exports.LEVEL_STYLE = exports.LEVELS = exports.errText = exports.call = void 0;
exports.fmtDuration = fmtDuration;
exports.parseLogFile = parseLogFile;
const renderer_1 = require("@getflywheel/local/renderer");
/** Typed wrapper. Errors thrown in main arrive as rejected promises. */
const call = (channel, ...args) => (0, renderer_1.ipcAsync)(channel, ...args);
exports.call = call;
const errText = (e) => (e instanceof Error ? e.message : String(e));
exports.errText = errText;
/** `75000` → `1:15`, `3725000` → `1:02:05`. */
function fmtDuration(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
exports.LEVELS = ['error', 'warn', 'notice', 'info', 'cmd'];
/**
 * Colour plus a text label, so the level never depends on colour alone.
 * The colors are CSS variables set by the theme (see theme.ts), with a fallback for a page without them.
 */
exports.LEVEL_STYLE = {
    error: { label: 'ERROR', color: 'var(--sr-error, #c62828)' },
    warn: { label: 'WARN', color: 'var(--sr-warn, #8a5300)' },
    notice: { label: 'NOTICE', color: 'var(--sr-notice, #6d3fd6)' },
    info: { label: 'INFO', color: 'var(--sr-info, #5c5c5c)' },
    cmd: { label: 'CMD', color: 'var(--sr-cmd, #1c5fa5)' },
};
/** Parse one line of a saved log file: `2025-01-02T03:04:05.000Z [level] text`. */
function parseLogFile(text) {
    return text
        .split(/\r?\n/)
        .filter(Boolean)
        .map((row) => {
        const m = /^(\S+) \[(error|warn|notice|info|cmd)\] (.*)$/.exec(row);
        return m
            ? { t: Date.parse(m[1]) || 0, level: m[2], text: m[3] }
            : { t: 0, level: 'info', text: row };
    });
}
exports.box = {
    border: '1px solid var(--sr-border, rgba(127,127,127,.35))',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
};
exports.row = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' };
/**
 * Form fields take their colors from the theme (light or dark), set as CSS variables on the root of the add-on.
 * Without them a field would be white on white (light text on a white field) in one of the two themes.
 */
exports.input = {
    padding: '6px 8px',
    minWidth: 0,
    color: 'var(--sr-field-fg, #1b1b1b)',
    background: 'var(--sr-field-bg, #ffffff)',
    border: '1px solid var(--sr-field-border, #8a8a8a)',
    borderRadius: 4,
};
