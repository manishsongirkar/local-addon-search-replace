import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Everything needed to start WP-CLI for one site. Built by main.ts from Local's services. */
export interface WpRuntime {
	php: string;
	wpCliPhar: string;
	env: NodeJS.ProcessEnv;
	wpPath: string;
	/** Needed on multisite when the database domain differs from wp-config. */
	urlArg?: string;
	/** Global WP-CLI flags. Each one is on unless it says `false`. */
	skip?: { plugins?: boolean; themes?: boolean; packages?: boolean };
	/** How to reach the database without WP-CLI. Missing: no fallback. */
	db?: import('./fallback').DbConn;
}

export interface RunResult {
	code: number | null;
	stdout: string;
	stderr: string;
	cancelled: boolean;
}

export interface RunHandle {
	promise: Promise<RunResult>;
	kill: () => void;
}

export interface RunOpts {
	onLine?: (line: string, stream: 'stdout' | 'stderr') => void;
	/** Load plugins and themes. Default false: faster and avoids plugin side effects. */
	loadExtensions?: boolean;
	/** Do not add `--url`. */
	noUrl?: boolean;
}

/** Largest output kept in memory per process. Lines are still passed on live. */
const MAX_STDOUT = 32 * 1024 * 1024;
const MAX_STDERR = 1024 * 1024;

/**
 * WP-CLI reads `wp-cli.yml` from the working directory and every parent of it, and that file can `require:` PHP files.
 * An imported site must not get to run code that way, so WP-CLI starts in an empty folder of our own.
 * `--path` already says where WordPress is.
 */
export function neutralCwd(): string {
	const dir = path.join(os.tmpdir(), 'local-addon-search-replace-cwd');
	try {
		fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
		return dir;
	} catch {
		return os.tmpdir();
	}
}

export function appendCapped(buf: string, chunk: string, max: number): string {
	return buf.length >= max ? buf : buf + chunk.slice(0, max - buf.length);
}

export function buildArgv(rt: WpRuntime, args: string[], opts: RunOpts = {}): string[] {
	const argv = ['-d', 'memory_limit=-1', rt.wpCliPhar, `--path=${rt.wpPath}`];
	if (rt.urlArg && !opts.noUrl) argv.push(`--url=${rt.urlArg}`);
	if (!opts.loadExtensions) {
		if (rt.skip?.plugins !== false) argv.push('--skip-plugins');
		if (rt.skip?.themes !== false) argv.push('--skip-themes');
	}
	if (rt.skip?.packages !== false) argv.push('--skip-packages');
	return [...argv, ...args];
}

/** Splits a byte stream into lines, keeping partial lines between chunks. */
export function lineSplitter(onLine: (line: string) => void): {
	push(chunk: string): void;
	end(): void;
} {
	let buf = '';
	return {
		push(chunk) {
			buf += chunk;
			const parts = buf.split(/\r?\n/);
			buf = parts.pop() ?? '';
			for (const p of parts) onLine(p);
		},
		end() {
			if (buf) onLine(buf);
			buf = '';
		},
	};
}

export function spawnWp(rt: WpRuntime, args: string[], opts: RunOpts = {}): RunHandle {
	let child: ChildProcess | null = null;
	let cancelled = false;
	const promise = new Promise<RunResult>((resolve) => {
		let stdout = '';
		let stderr = '';
		child = spawn(rt.php, buildArgv(rt, args, opts), {
			env: rt.env,
			cwd: neutralCwd(),
			windowsHide: true,
		});
		const out = lineSplitter((l) => opts.onLine?.(l, 'stdout'));
		const err = lineSplitter((l) => opts.onLine?.(l, 'stderr'));
		child.stdout?.setEncoding('utf8').on('data', (d: string) => {
			stdout = appendCapped(stdout, d, MAX_STDOUT);
			out.push(d);
		});
		child.stderr?.setEncoding('utf8').on('data', (d: string) => {
			stderr = appendCapped(stderr, d, MAX_STDERR);
			err.push(d);
		});
		child.on('error', (e) => {
			stderr += `\n${e.message}`;
			resolve({ code: -1, stdout, stderr, cancelled });
		});
		child.on('close', (code) => {
			out.end();
			err.end();
			resolve({ code, stdout, stderr, cancelled });
		});
	});
	return {
		promise,
		kill: () => {
			cancelled = true;
			child?.kill();
		},
	};
}

export function runWp(rt: WpRuntime, args: string[], opts: RunOpts = {}): Promise<RunResult> {
	return spawnWp(rt, args, opts).promise;
}

/** Pull the JSON payload printed between our markers. PHP notices around it are ignored. */
export function extractJson<T>(stdout: string): T | null {
	const m = /@@SR_JSON@@([\s\S]*?)@@SR_END@@/.exec(stdout);
	if (!m) return null;
	try {
		return JSON.parse(m[1]) as T;
	} catch {
		return null;
	}
}

export interface FriendlyError {
	code: 'DB_DOWN' | 'NO_WP' | 'NOT_INSTALLED' | 'SITE_URL' | 'MEMORY' | 'BAD_REGEX' | 'UNKNOWN';
	message: string;
}

/** Turn raw WP-CLI/PHP errors into advice a person can act on. */
export function classifyError(stderr: string): FriendlyError {
	const s = stderr.trim();
	const rules: Array<[RegExp, FriendlyError]> = [
		[
			/Error establishing a database connection|Can't connect to|Connection refused|No such file or directory.*(sock|mysql)|mysqli_real_connect|Unknown database|Access denied for user/i,
			{
				code: 'DB_DOWN',
				message: 'The database is not reachable. Start the site in Local and try again.',
			},
		],
		[
			/doesn't seem to be a WordPress installation|wp-load\.php/i,
			{
				code: 'NO_WP',
				message: 'WordPress was not found. Set the WordPress path in Advanced options.',
			},
		],
		[
			/is not installed|ms_not_installed/i,
			{
				code: 'NOT_INSTALLED',
				message: 'WordPress is not installed in this database. Import the database first.',
			},
		],
		[
			/Site '.*' not found|Verify DOMAIN_CURRENT_SITE|--url=/i,
			{
				code: 'SITE_URL',
				message:
					'WordPress could not match the site domain. Check DOMAIN_CURRENT_SITE in wp-config.php.',
			},
		],
		[
			/Allowed memory size|Out of memory/i,
			{
				code: 'MEMORY',
				message: 'PHP ran out of memory. Turn off "Precise" mode or skip very large tables.',
			},
		],
		[/regex pattern/i, { code: 'BAD_REGEX', message: 'A regex pattern is not valid.' }],
	];
	for (const [re, e] of rules)
		if (re.test(s)) return { ...e, message: `${e.message}\n${firstLine(s)}` };
	return { code: 'UNKNOWN', message: firstLine(s) || 'WP-CLI failed without a message.' };
}

const firstLine = (s: string): string =>
	s.split(/\r?\n/).find((l) => /^(Error|PHP|Warning|Fatal)/i.test(l.trim())) ??
	s.split(/\r?\n/)[0] ??
	'';
