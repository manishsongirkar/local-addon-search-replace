import fs from 'node:fs';
import type { LogLevel } from '../common/types';
import { MAX_LOG_BYTES } from './retention';

/**
 * Sort one line of WP-CLI or PHP output into a log level.
 * PHP prints `Warning:`, `Notice:` and `Deprecated:` (often with a `PHP ` prefix) on either stream.
 */
export function classifyLine(line: string, stream: 'stdout' | 'stderr' = 'stdout'): LogLevel {
	const l = line.trim();
	if (/^(PHP )?(Fatal error|Parse error)|^Error:/i.test(l)) return 'error';
	if (/^(PHP )?(Notice|Deprecated|Strict Standards)\b/i.test(l)) return 'notice';
	if (/^(PHP )?Warning\b/i.test(l)) return 'warn';
	return stream === 'stderr' ? 'warn' : 'info';
}

/** Append-only log file with a size cap. Never throws: a full disk must not stop a run. */
export class FileLog {
	private bytes = 0;
	constructor(
		private file: string | null,
		private max = MAX_LOG_BYTES,
	) {
		// A link planted at this name would make us append to some other file. Use a real file or nothing.
		if (file) {
			try {
				const st = fs.lstatSync(file);
				if (st.isSymbolicLink() || !st.isFile()) this.file = null;
			} catch {
				// Does not exist yet: fine.
			}
		}
	}

	get path(): string | null {
		return this.file;
	}

	write(level: LogLevel, t: number, text: string): void {
		if (!this.file) return;
		const stamp = new Date(t).toISOString();
		// One row per line, so text from the database cannot fake a log row and the viewer can read every row.
		const row = text
			.split(/\r?\n/)
			.map((l) => `${stamp} [${level}] ${l}\n`)
			.join('');
		try {
			if (this.bytes + row.length <= this.max) {
				fs.appendFileSync(this.file, row, { mode: 0o600 });
				this.bytes += row.length;
			} else if (this.bytes <= this.max) {
				fs.appendFileSync(
					this.file,
					`${stamp} [warn] Log file limit reached. Later lines are only shown in the app.\n`,
				);
				this.bytes = this.max + 1;
			}
		} catch {
			// Ignore.
		}
	}
}
