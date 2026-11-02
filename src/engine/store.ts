import fs from 'node:fs';
import path from 'node:path';
import {
	DEFAULT_OPTIONS,
	type HistoryEntry,
	type ImportInfo,
	type ReplacePair,
	type SavedConfig,
} from '../common/types';

export const MAX_HISTORY = 20;
const CONFIG_FILE = 'config.json';
const HISTORY_FILE = 'history.json';
const IMPORT_FILE = 'import.json';

/** Write to a temp file, then rename. A crash never leaves half a file. */
function writeAtomic(file: string, data: string): void {
	fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	const tmp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, data, { mode: 0o600 });
	fs.renameSync(tmp, file);
}

function readJson(file: string): unknown {
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch {
		return null;
	}
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Keep only well-formed pairs. A hand-edited or damaged file must not crash the UI. */
export function cleanPairs(raw: unknown): ReplacePair[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
		.map((p, i) => ({
			id: str(p.id) || `pair-${i}`,
			search: str(p.search),
			replace: str(p.replace),
			regex: p.regex === true,
			enabled: p.enabled !== false,
			origin: p.origin === 'scan' ? ('scan' as const) : ('custom' as const),
			...(typeof p.suggested === 'string' ? { suggested: p.suggested } : {}),
			...(p.kind === 'main' || p.kind === 'close' || p.kind === 'other' ? { kind: p.kind } : {}),
		}));
}

/** Known option keys only, each with the right type. Anything else falls back to the default. */
export function cleanOptions(raw: unknown): SavedConfig['options'] {
	const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const out = { ...DEFAULT_OPTIONS } as Record<string, unknown>;
	for (const [k, def] of Object.entries(DEFAULT_OPTIONS)) {
		if (typeof o[k] === typeof def) out[k] = o[k];
	}
	// A saved dry run would make the next click do nothing. Always start as a real run.
	out.dryRun = false;
	// No option in the UI any more: an old file with `false` or `true` must not change the matching.
	out.caseSensitive = true;
	out.replaceGuid = false;
	return out as SavedConfig['options'];
}

export function loadConfig(dir: string): SavedConfig {
	const raw = readJson(path.join(dir, CONFIG_FILE)) as Partial<SavedConfig> | null;
	return { pairs: cleanPairs(raw?.pairs), options: cleanOptions(raw?.options) };
}

export function saveConfig(dir: string, cfg: SavedConfig): SavedConfig {
	const clean = { pairs: cleanPairs(cfg.pairs), options: cleanOptions(cfg.options) };
	writeAtomic(path.join(dir, CONFIG_FILE), JSON.stringify(clean, null, 2));
	return clean;
}

export function readHistory(dir: string): HistoryEntry[] {
	const raw = readJson(path.join(dir, HISTORY_FILE));
	return Array.isArray(raw) ? (raw as HistoryEntry[]) : [];
}

/** Newest first, capped. Never throws: history must not fail a run. */
export function addHistory(dir: string, entry: HistoryEntry): void {
	try {
		writeAtomic(
			path.join(dir, HISTORY_FILE),
			JSON.stringify([entry, ...readHistory(dir)].slice(0, MAX_HISTORY)),
		);
	} catch {
		// Read-only folder or full disk.
	}
}

export function readImportInfo(dir: string): ImportInfo | null {
	const r = readJson(path.join(dir, IMPORT_FILE)) as Partial<ImportInfo> | null;
	if (!r || !str(r.from) || !str(r.to)) return null;
	return {
		from: str(r.from),
		to: str(r.to),
		at: typeof r.at === 'number' ? r.at : 0,
		replaced: r.replaced === true,
		...(typeof r.replacedAt === 'number' ? { replacedAt: r.replacedAt } : {}),
	};
}

/** Never throws: a note about the import must not fail a scan or a run. */
export function writeImportInfo(dir: string, info: ImportInfo | null): void {
	try {
		const file = path.join(dir, IMPORT_FILE);
		if (info) writeAtomic(file, JSON.stringify(info));
		else fs.rmSync(file, { force: true });
	} catch {
		// Read-only folder or full disk.
	}
}
