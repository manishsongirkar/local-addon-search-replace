import path from 'node:path';
import type { ReplacePair, TableInfo } from '../common/types';
import { PHP_DIR } from './phpDir';
import { type Hits, partitionTables } from './plan';
import { parseUrlish } from './urls';
import { isNoOp, normalizePairs } from './validate';
import { type RunHandle, type WpRuntime, extractJson, spawnWp } from './wpRunner';

/** Below this much data the pre-scan costs more than it saves. */
export const PREFILTER_MIN_BYTES = 64 * 1024 * 1024;

/**
 * Text that every database form of a pair must contain, for a cheap `LIKE` test.
 * A URL becomes its host (JSON-escaped, double-escaped and URL-encoded forms keep the host as it is; the port may not be).
 * Regex pairs give nothing: they run on every table.
 */
export function needlesFor(pairs: ReplacePair[]): string[] {
	const out = new Set<string>();
	for (const p of normalizePairs(pairs.filter((x) => x.enabled && !x.regex))) {
		if (isNoOp(p)) continue;
		if (!p.search) continue;
		const u = parseUrlish(p.search);
		out.add(u && (u.scheme || p.search.includes('.')) ? u.host : p.search);
	}
	return [...out];
}

/** Run the pre-scan on `workers` groups of tables at the same time. Returns null when it cannot tell. */
export async function prefilter(
	rt: WpRuntime,
	tables: TableInfo[],
	needles: string[],
	workers: number,
	onHandle?: (h: RunHandle) => void,
): Promise<Hits | null> {
	if (needles.length === 0 || tables.length === 0) return null;
	const hits: Hits = new Map();
	const groups = partitionTables(tables, workers);
	const results = await Promise.all(
		groups.map(async (group) => {
			const job = Buffer.from(
				JSON.stringify({ tables: group.map((t) => t.name), needles }),
			).toString('base64');
			const handle = spawnWp(rt, ['eval-file', path.join(PHP_DIR, 'prefilter.php'), job]);
			onHandle?.(handle);
			const res = await handle.promise;
			return res.code === 0 ? extractJson<Record<string, string[]>>(res.stdout) : null;
		}),
	);
	if (results.some((r) => r === null)) return null;
	for (const r of results) for (const [t, cols] of Object.entries(r ?? {})) hits.set(t, cols);
	return hits;
}
