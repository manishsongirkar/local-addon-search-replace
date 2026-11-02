import fs from 'node:fs';
import path from 'node:path';

export const RETENTION_DAYS = 30;
/** One run log may not grow past this. The app still shows every line live. */
export const MAX_LOG_BYTES = 10 * 1024 * 1024;

/**
 * Delete files in `dir` whose name matches `pattern` and that are older than `days`.
 * Returns the names removed. Never throws: clean-up must not break a run.
 */
export function pruneOld(
	dir: string,
	pattern: RegExp,
	days = RETENTION_DAYS,
	now = Date.now(),
): string[] {
	const removed: string[] = [];
	let names: string[];
	try {
		names = fs.readdirSync(dir);
	} catch {
		return removed;
	}
	const limit = now - days * 24 * 60 * 60 * 1000;
	for (const name of names) {
		if (!pattern.test(name)) continue;
		const file = path.join(dir, name);
		try {
			const st = fs.statSync(file);
			if (st.isFile() && st.mtimeMs < limit) {
				fs.unlinkSync(file);
				removed.push(name);
			}
		} catch {
			// In use or already gone.
		}
	}
	return removed;
}

export const LOG_PATTERN = /^(run|dry-run)-\d{8}-\d{6}\.log$|^activity-\d{8}\.log$/;
export const BACKUP_PATTERN = /^search-replace-backup-\d{8}-\d{6}\.sql$/;
