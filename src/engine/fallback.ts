import { type ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';
import type { RunOptions } from '../common/types';
import { PHP_DIR } from './phpDir';
import { type PlanStep, pairFlags } from './plan';
import { chooseDelimiter, skipColumnsOf } from './validate';
import {
	type RunHandle,
	type RunResult,
	type WpRuntime,
	appendCapped,
	extractJson,
	lineSplitter,
	neutralCwd,
} from './wpRunner';

/** How the fallback reaches the database. Built by main.ts from Local's site data. */
export interface DbConn {
	host: string;
	port: number;
	/** Unix socket or Windows named pipe path. When set it wins over host and port. */
	socket?: string;
	name: string;
	user: string;
	password: string;
	/** `mysqldump` of the site's database service, for the backup fallback. */
	mysqldump?: string;
}

interface SpawnRawOpts {
	env: NodeJS.ProcessEnv;
	stdin?: string;
	onLine?: (line: string, stream: 'stdout' | 'stderr') => void;
}

/** Start a process, feed it `stdin`, and collect its output. Passwords go through stdin or env, never the command line. */
export function spawnRaw(cmd: string, args: string[], o: SpawnRawOpts): RunHandle {
	let child: ChildProcess | null = null;
	let cancelled = false;
	const promise = new Promise<RunResult>((resolve) => {
		let stdout = '';
		let stderr = '';
		child = spawn(cmd, args, { env: o.env, cwd: neutralCwd(), windowsHide: true });
		const out = lineSplitter((l) => o.onLine?.(l, 'stdout'));
		const err = lineSplitter((l) => o.onLine?.(l, 'stderr'));
		child.stdout?.setEncoding('utf8').on('data', (d: string) => {
			stdout = appendCapped(stdout, d, 32 * 1024 * 1024);
			out.push(d);
		});
		child.stderr?.setEncoding('utf8').on('data', (d: string) => {
			stderr = appendCapped(stderr, d, 1024 * 1024);
			err.push(d);
		});
		child.on('error', (e) =>
			resolve({ code: -1, stdout, stderr: `${stderr}\n${e.message}`, cancelled }),
		);
		child.on('close', (code) => {
			out.end();
			err.end();
			resolve({ code, stdout, stderr, cancelled });
		});
		// A broken pipe (PHP exited early) must not crash the main process.
		child.stdin?.on('error', () => undefined);
		child.stdin?.end(o.stdin ?? '');
	});
	return {
		promise,
		kill: () => {
			cancelled = true;
			child?.kill();
		},
	};
}

/** Run `php/fallback.php` with one job. Same PHP binary and environment as WP-CLI, without the phar. */
export function runFallback(
	rt: WpRuntime,
	job: Record<string, unknown>,
	onLine?: (line: string, stream: 'stdout' | 'stderr') => void,
): RunHandle {
	return spawnRaw(rt.php, ['-d', 'memory_limit=-1', path.join(PHP_DIR, 'fallback.php')], {
		env: rt.env,
		stdin: JSON.stringify({ ...job, db: rt.db }),
		onLine,
	});
}

/** The job for one plan step: the same pair, tables and flags the WP-CLI step would use. */
export function stepJob(step: PlanStep, opts: RunOptions): Record<string, unknown> {
	const regex = step.pair.regex;
	const d = chooseDelimiter(step.pair.search) ?? '/';
	return {
		mode: 'replace',
		tables: step.tables.map((t) => t.name),
		search: step.pair.search,
		replace: step.pair.replace,
		regex,
		pattern: regex ? `${d}${step.pair.search}${d}${pairFlags(step.pair, opts)}` : '',
		dryRun: opts.dryRun,
		skipColumns: skipColumnsOf(opts),
		includeColumns: step.includeColumns ?? null,
	};
}

/** Read the site layout or the domain list without WP-CLI. `null` when the fallback cannot do it either. */
export async function fallbackJson<T>(
	rt: WpRuntime,
	job: Record<string, unknown>,
): Promise<{ data: T | null; error: string }> {
	const res = await runFallback(rt, job).promise;
	if (res.code !== 0)
		return { data: null, error: res.stderr.trim().split(/\r?\n/)[0] ?? 'Fallback failed.' };
	return { data: extractJson<T>(res.stdout), error: '' };
}

/** Database dump with the `mysqldump` of the site, when WP-CLI cannot make the backup. */
export function dumpDatabase(
	rt: WpRuntime,
	file: string,
	onLine?: (line: string, stream: 'stdout' | 'stderr') => void,
): RunHandle | null {
	const db = rt.db;
	if (!db?.mysqldump) return null;
	const conn = db.socket
		? [`--socket=${db.socket}`]
		: [`--host=${db.host}`, `--port=${db.port}`, '--protocol=tcp'];
	return spawnRaw(
		db.mysqldump,
		[
			'--no-defaults',
			...conn,
			`--user=${db.user}`,
			'--add-drop-table',
			'--single-transaction',
			'--default-character-set=utf8mb4',
			`--result-file=${file}`,
			db.name,
		],
		{ env: { ...rt.env, MYSQL_PWD: db.password }, onLine },
	);
}
