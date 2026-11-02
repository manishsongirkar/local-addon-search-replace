import path from 'node:path';
import {
	DEFAULT_OPTIONS,
	type JobSnapshot,
	type LogLine,
	type ReplacePair,
	type RunOptions,
} from '../../src/common/types';
import { Job, type JobDeps } from '../../src/engine/runner';
import { loadContext } from '../../src/engine/scan';
import type { WpRuntime } from '../../src/engine/wpRunner';
import type { TestSite } from './env';

let n = 0;
export const pair = (search: string, replace: string, regex = false): ReplacePair => ({
	id: `p${++n}`,
	search,
	replace,
	regex,
	enabled: true,
});

export const opts = (pairs: ReplacePair[], over: Partial<RunOptions> = {}): RunOptions => ({
	...DEFAULT_OPTIONS,
	// The app always matches case exactly. These tests exercise both engine modes, so they name the mode: ignore case unless a test says otherwise.
	caseSensitive: false,
	pairs,
	...over,
});

export async function runJob(
	site: TestSite,
	o: RunOptions,
	onJob?: (j: Job) => void,
	extra: Partial<JobDeps> & { rt?: WpRuntime } = {},
) {
	const { rt = site.rt, ...deps } = extra;
	const context = await loadContext(rt);
	const logs: LogLine[] = [];
	const snaps: JobSnapshot[] = [];
	const job = new Job({
		siteId: 'test',
		runtime: { ...rt, urlArg: context.urlArg },
		context,
		opts: o,
		backupDir: path.join(site.webRoot, '..', 'sql'),
		logDir: path.join(site.webRoot, '..', 'logs'),
		onLog: (l) => logs.push(l),
		onSnapshot: (s) => snaps.push(s),
		...deps,
	});
	onJob?.(job);
	const final = await job.start();
	return { final, logs, snaps, context, job };
}

/** Option value, parsed from WP-CLI JSON. */
// biome-ignore lint/suspicious/noExplicitAny: tests read any shape of option
export const option = (site: TestSite, name: string, url?: string): any =>
	JSON.parse(site.wp(['option', 'get', name, '--format=json'], { url }).trim());
