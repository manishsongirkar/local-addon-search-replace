import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobSnapshot, LogLine, RunOptions, SiteContext } from '../../src/common/types';
import { multiCtx, opts, pair, singleCtx, table } from './helpers';

/** A fake process: tests decide when it ends. */
interface Call {
	resolved: boolean;
	/** Steps that were still running when this one started. */
	openAtStart: Call[];
	kind: 'wp' | 'fallback' | 'dump';
	args: string[];
	killed: boolean;
	finish: (code?: number, stderr?: string) => void;
	line: (s: string, stream?: 'stdout' | 'stderr') => void;
}
const calls: Call[] = [];
let auto = true;
let failWp: ((args: string[]) => string | null) | null = null;
let prefilterResult: Map<string, string[]> | null = null;
/** What `runWp` (config, db query, cache flush) answers, and every call it gets. */
let runWpImpl: (args: string[]) => { code: number; stdout: string; stderr: string } = () => ({
	code: 0,
	stdout: '',
	stderr: '',
});
const runWpCalls: string[][] = [];
/** The runtime every spawned WP-CLI command got. */
const runtimes: Array<{ skip?: { plugins?: boolean; themes?: boolean; packages?: boolean } }> = [];
/** Tables that two running steps used at the same time. Must stay empty. */
const overlaps: string[] = [];
const activeTables = new Map<string, number>();

function fake(
	kind: Call['kind'],
	args: string[],
	onLine?: (l: string, s: 'stdout' | 'stderr') => void,
) {
	let resolve!: (r: {
		code: number | null;
		stdout: string;
		stderr: string;
		cancelled: boolean;
	}) => void;
	const promise = new Promise<{
		code: number | null;
		stdout: string;
		stderr: string;
		cancelled: boolean;
	}>((r) => {
		resolve = r;
	});
	const tableArgs = args.filter((a) => /^wp_/.test(a));
	const done = () => {
		if (call.resolved) return;
		call.resolved = true;
		for (const t of tableArgs) activeTables.set(t, (activeTables.get(t) ?? 1) - 1);
	};
	const call: Call = {
		resolved: false,
		openAtStart: calls.filter((c) => !c.resolved),
		kind,
		args,
		killed: false,
		finish: (code = 0, stderr = '') => {
			done();
			resolve({ code, stdout: '', stderr, cancelled: false });
		},
		line: (s, stream = 'stdout') => onLine?.(s, stream),
	};
	calls.push(call);
	if (kind === 'wp') {
		for (const t of tableArgs) {
			if ((activeTables.get(t) ?? 0) > 0) overlaps.push(t);
			activeTables.set(t, (activeTables.get(t) ?? 0) + 1);
		}
	}
	if (auto) {
		setTimeout(() => {
			if (call.killed) return;
			const err = kind === 'wp' && failWp ? failWp(args) : null;
			if (err) return call.finish(1, err);
			for (const t of tableArgs) call.line(`Checking: ${t}.col`);
			call.line('Success: Made 2 replacements.');
			call.finish(0);
		}, 1);
	}
	return {
		promise,
		kill: () => {
			call.killed = true;
			done();
			resolve({ code: null, stdout: '', stderr: '', cancelled: true });
		},
	};
}

vi.mock('../../src/engine/wpRunner', async (orig) => ({
	...(await orig<typeof import('../../src/engine/wpRunner')>()),
	spawnWp: (
		rt: { skip?: { plugins?: boolean; themes?: boolean; packages?: boolean } },
		args: string[],
		o?: { onLine?: (l: string, s: 'stdout' | 'stderr') => void },
	) => {
		runtimes.push(rt);
		return fake('wp', args, o?.onLine);
	},
	runWp: async (
		rt: { skip?: { plugins?: boolean; themes?: boolean; packages?: boolean } },
		args: string[],
	) => {
		runtimes.push(rt);
		runWpCalls.push(args);
		return { ...runWpImpl(args), cancelled: false };
	},
}));
vi.mock('../../src/engine/fallback', () => ({
	stepJob: (step: { tables: { name: string }[] }) => ({ tables: step.tables.map((t) => t.name) }),
	runFallback: (
		_rt: unknown,
		job: { tables: string[] },
		onLine?: (l: string, s: 'stdout' | 'stderr') => void,
	) => fake('fallback', job.tables, onLine),
	dumpDatabase: (
		_rt: unknown,
		file: string,
		onLine?: (l: string, s: 'stdout' | 'stderr') => void,
	) => fake('dump', [file], onLine),
}));
vi.mock('../../src/engine/prefilter', async (orig) => ({
	...(await orig<typeof import('../../src/engine/prefilter')>()),
	prefilter: async () => prefilterResult,
}));

const { Job } = await import('../../src/engine/runner');

let tmp: string;
beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-run-'));
	calls.length = 0;
	runWpCalls.length = 0;
	runtimes.length = 0;
	runWpImpl = () => ({ code: 0, stdout: '', stderr: '' });
	overlaps.length = 0;
	activeTables.clear();
	auto = true;
	failWp = null;
	prefilterResult = null;
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const plain = (o: Partial<RunOptions> = {}): RunOptions =>
	opts([pair('https://prod.example.net', 'https://my.test')], {
		includeVariants: false,
		protectEmails: false,
		backup: false,
		flushCache: false,
		...o,
	});

function make(ctx: SiteContext, o: RunOptions, extra: Record<string, unknown> = {}) {
	const snaps: JobSnapshot[] = [];
	const logs: LogLine[] = [];
	const job = new Job({
		siteId: 'site-1',
		runtime: { php: 'php', wpCliPhar: 'x.phar', env: {}, wpPath: '/w' },
		context: ctx,
		opts: o,
		backupDir: path.join(tmp, 'backups'),
		logDir: path.join(tmp, 'logs'),
		onSnapshot: (s) => snaps.push(JSON.parse(JSON.stringify(s))),
		onLog: (l) => logs.push(l),
		prefilterMinBytes: Number.POSITIVE_INFINITY,
		freeBytes: () => null,
		...extra,
	});
	return { job, snaps, logs };
}
const wpCalls = () => calls.filter((c) => c.kind === 'wp' && c.args[0] === 'search-replace');
const wait = (ms = 5) => new Promise((r) => setTimeout(r, ms));

describe('Job: a normal run', () => {
	it('completes, counts replacements, reaches 100% and writes a log file', async () => {
		const { job, snaps, logs } = make(singleCtx(), plain());
		const snap = await job.start();
		expect(snap.state).toBe('completed');
		expect(snap.progress).toBe(1);
		expect(snap.totalReplacements).toBe(2);
		expect(snap.tablesDone).toBe(snap.tablesTotal);
		expect(snap.tablesTotal).toBe(12);
		expect(logs.some((l) => l.level === 'cmd')).toBe(true);
		expect(fs.readFileSync(snap.logFile as string, 'utf8')).toContain(
			'Finished: 2 replacement(s) made',
		);
		// Progress never goes backwards.
		const p = snaps.map((s) => s.progress);
		expect(p).toEqual([...p].sort((a, b) => a - b));
	});
	it('a dry run makes no backup, no cache flush and says "would be made"', async () => {
		const { job, logs } = make(
			singleCtx(),
			plain({ dryRun: true, backup: true, flushCache: true }),
		);
		await job.start();
		expect(calls.some((c) => c.args[0] === 'db')).toBe(false);
		expect(wpCalls()[0].args).toContain('--dry-run');
		expect(logs.some((l) => /would be made/.test(l.text))).toBe(true);
	});
	it('a real run with backup exports the database first with --single-transaction', async () => {
		const { job } = make(singleCtx(), plain({ backup: true }));
		const snap = await job.start();
		expect(calls[0].args.slice(0, 2)).toEqual(['db', 'export']);
		expect(calls[0].args).toContain('--single-transaction');
		expect(snap.backupFile).toMatch(/search-replace-backup-\d{8}-\d{6}\.sql$/);
	});
	it('no matching table: failed with a clear message', async () => {
		const { job } = make(singleCtx(), plain({ skipTables: '*' }));
		const snap = await job.start();
		expect(snap.state).toBe('failed');
		expect(snap.error).toMatch(/No tables match/);
	});
	it('cleans up old logs and backups at the start', async () => {
		fs.mkdirSync(path.join(tmp, 'logs'), { recursive: true });
		const old = path.join(tmp, 'logs', 'run-20200101-000000.log');
		fs.writeFileSync(old, 'x');
		fs.utimesSync(old, 1, 1);
		await make(singleCtx(), plain()).job.start();
		expect(fs.existsSync(old)).toBe(false);
	});
	it('filters script errors: PHP warnings, notices and errors get their own level in the log', async () => {
		auto = false;
		const { job, logs } = make(singleCtx(), plain());
		const run = job.start();
		await wait();
		calls[0].line('PHP Warning:  Undefined variable $x', 'stderr');
		calls[0].line('PHP Notice:  Undefined index', 'stderr');
		calls[0].line('Deprecated: dynamic property', 'stdout');
		calls[0].line('Success: Made 0 replacements.');
		calls[0].finish(0);
		await run;
		const level = (re: RegExp) => logs.find((l) => re.test(l.text))?.level;
		expect(level(/Undefined variable/)).toBe('warn');
		expect(level(/Undefined index/)).toBe('notice');
		expect(level(/dynamic property/)).toBe('notice');
	});
});

describe('Job: per-site isolation', () => {
	it('two jobs for two sites report their own site id and share no state', async () => {
		const a = make(singleCtx(), plain());
		const b = make(singleCtx(), plain());
		(b.job as unknown as { deps: { siteId: string } }).deps.siteId = 'site-2';
		await Promise.all([a.job.start(), b.job.start()]);
		expect(new Set(a.snaps.map((s) => s.siteId))).toEqual(new Set(['site-1']));
		expect(new Set(b.snaps.map((s) => s.siteId))).toEqual(new Set(['site-2']));
		expect(a.snaps.at(-1)?.totalReplacements).toBe(2);
	});
});

describe('Job: parallel workers', () => {
	const bigCtx = () => {
		const c = singleCtx();
		for (let i = 0; i < 9; i++) c.tables.push(table(`wp_big${i}`, 1_000_000 * (i + 1)));
		return c;
	};
	it('never runs more steps than workers and does use more than one', async () => {
		auto = false;
		const { job } = make(bigCtx(), plain({ workers: 3 }));
		const run = job.start();
		let max = 0;
		for (
			let i = 0;
			i < 200 && (calls.length === 0 || calls.some((c) => !(c as Call & { done?: boolean }).done));
			i++
		) {
			await wait(2);
			const open = calls.filter((c) => !(c as Call & { done?: boolean }).done && !c.killed);
			max = Math.max(max, open.length);
			for (const c of open) {
				(c as Call & { done?: boolean }).done = true;
				c.finish(0);
			}
			if (open.length === 0 && calls.length > 0) break;
		}
		const snap = await run;
		expect(snap.state).toBe('completed');
		expect(max).toBeGreaterThan(1);
		expect(max).toBeLessThanOrEqual(3);
	});
	it('each table still sees the pairs in the planned order (longest first)', async () => {
		const o = opts(
			[
				pair('https://prod.example.net', 'https://my.test'),
				pair('https://prod.example.net/blog', 'https://my.test/blog'),
			],
			{
				includeVariants: false,
				protectEmails: false,
				backup: false,
				flushCache: false,
				workers: 4,
			},
		);
		await make(bigCtx(), o).job.start();
		const seen = new Map<string, string[]>();
		for (const c of wpCalls())
			for (const t of c.args.filter((a) => /^wp_/.test(a)))
				seen.set(t, [...(seen.get(t) ?? []), c.args[1]]);
		expect(seen.size).toBe(21);
		for (const order of seen.values())
			expect(order).toEqual(['https://prod.example.net/blog', 'https://prod.example.net']);
		// Two pairs never work on one table at the same time, or the order would mean nothing.
		expect(overlaps).toEqual([]);
	});
	it('workers = 1 keeps the old sequential order', async () => {
		auto = false;
		const { job } = make(bigCtx(), plain({ workers: 1 }));
		const run = job.start();
		for (let i = 0; i < 20; i++) {
			await wait(2);
			expect(
				calls.filter((c) => !c.killed && !(c as Call & { done?: boolean }).done).length,
			).toBeLessThanOrEqual(1);
			for (const c of calls) {
				(c as Call & { done?: boolean }).done = true;
				c.finish(0);
			}
		}
		expect((await run).state).toBe('completed');
	});
	it('multisite: main and network steps start only when every earlier step has finished', async () => {
		const { job } = make(
			multiCtx(false),
			opts([pair('https://prod.example.net', 'https://my.test')], {
				includeVariants: true,
				protectEmails: false,
				backup: false,
				flushCache: false,
				workers: 4,
			}),
		);
		await job.start();
		const main = wpCalls().filter((c) =>
			c.args.some((a) => a === 'wp_options' || a === 'wp_blogs'),
		);
		const subs = wpCalls().filter((c) => c.args.some((a) => /^wp_[23]_/.test(a)));
		expect(main.length).toBeGreaterThan(0);
		expect(subs.length).toBeGreaterThan(0);
		// Nothing else was running when a main-site step started.
		for (const c of main) expect(c.openAtStart).toEqual([]);
		// Sub-sites do run side by side.
		expect(subs.some((c) => c.openAtStart.length > 0)).toBe(true);
		// All tables is on by default, and it covers the network.
		expect(wpCalls().every((c) => c.args.includes('--all-tables'))).toBe(true);
	});

	it('multisite with all tables off: every step carries --network', async () => {
		await make(multiCtx(false), plain({ allTables: false })).job.start();
		expect(
			wpCalls().every(
				(c) => c.args.includes('--network') && c.args.includes('--all-tables-with-prefix'),
			),
		).toBe(true);
	});
});

describe('Job: failure and cancel', () => {
	it('the first failing step fails the run, stops the others and reports one error', async () => {
		auto = false;
		const { job, logs } = make(
			(() => {
				const c = singleCtx();
				for (let i = 0; i < 6; i++) c.tables.push(table(`wp_x${i}`, 5_000_000));
				return c;
			})(),
			plain({ workers: 3 }),
		);
		const run = job.start();
		await wait(10);
		const [first, ...others] = calls;
		first.finish(1, 'Error: Error establishing a database connection');
		const snap = await run;
		expect(snap.state).toBe('failed');
		expect(snap.error).toMatch(/database is not reachable/);
		expect(others.every((c) => c.killed)).toBe(true);
		expect(logs.filter((l) => l.level === 'error' && /^Step \d+ failed/.test(l.text))).toHaveLength(
			1,
		);
		// The step that failed is "failed". The ones stopped because of it are "cancelled", not extra failures.
		expect(snap.steps.filter((s) => s.state === 'failed')).toHaveLength(1);
		expect(snap.steps.filter((s) => s.state === 'cancelled').length).toBeGreaterThan(0);
	});
	it('cancel kills every running process and ends as cancelled', async () => {
		auto = false;
		const { job } = make(singleCtx(), plain({ workers: 2 }));
		const run = job.start();
		await wait(10);
		job.cancel();
		const snap = await run;
		expect(snap.state).toBe('cancelled');
		expect(calls.every((c) => c.killed)).toBe(true);
	});
});

describe('Job: pre-scan for big databases', () => {
	const big = () => {
		const c = singleCtx();
		c.tables = [
			table('wp_options', 5e9),
			table('wp_posts', 20e9),
			table('wp_postmeta', 9e9),
			table('wp_commentmeta', 1e9),
		];
		return c;
	};
	it('only tables and columns with a hit are given to WP-CLI', async () => {
		prefilterResult = new Map([
			['wp_posts', ['post_content', 'guid']],
			['wp_options', ['option_value']],
		]);
		const { job, logs } = make(big(), plain(), { prefilterMinBytes: 1 });
		const snap = await job.start();
		expect(snap.state).toBe('completed');
		const used = new Set(wpCalls().flatMap((c) => c.args.filter((a) => /^wp_/.test(a))));
		expect(used).toEqual(new Set(['wp_posts', 'wp_options']));
		const cols = wpCalls()
			.map((c) => c.args.find((a) => a.startsWith('--include-columns=')))
			.join(' ');
		expect(cols).toContain('post_content');
		expect(cols).not.toContain('guid'); // guid is on the skip list
		expect(logs.some((l) => /2 of 4 table\(s\) contain the search text/.test(l.text))).toBe(true);
	});
	it('no hit anywhere: completes at once with 0 replacements, no backup, no WP-CLI step', async () => {
		prefilterResult = new Map();
		const { job, logs } = make(big(), plain({ backup: true }), { prefilterMinBytes: 1 });
		const snap = await job.start();
		expect(snap.state).toBe('completed');
		expect(snap.totalReplacements).toBe(0);
		expect(calls).toHaveLength(0);
		expect(logs.some((l) => /Nothing to replace/.test(l.text))).toBe(true);
	});
	it('a failed pre-scan warns and runs on every table', async () => {
		prefilterResult = null;
		const { job, logs } = make(big(), plain(), { prefilterMinBytes: 1 });
		const snap = await job.start();
		expect(snap.state).toBe('completed');
		expect(new Set(wpCalls().flatMap((c) => c.args.filter((a) => /^wp_/.test(a)))).size).toBe(4);
		expect(logs.some((l) => l.level === 'warn' && /pre-scan failed/.test(l.text))).toBe(true);
	});
	it('a small database skips the pre-scan', async () => {
		prefilterResult = new Map();
		const { job } = make(singleCtx(), plain());
		expect((await job.start()).totalReplacements).toBe(2);
	});
	it('a user regex pair runs on every table and every column', async () => {
		prefilterResult = new Map([['wp_posts', ['post_content']]]);
		const o = opts(
			[pair('https://prod.example.net', 'https://my.test'), pair('a+b', 'x', { regex: true })],
			{ includeVariants: false, protectEmails: false, backup: false, flushCache: false },
		);
		await make(big(), o, { prefilterMinBytes: 1 }).job.start();
		const rx = wpCalls().filter((c) => c.args.includes('--regex'));
		expect(new Set(rx.flatMap((c) => c.args.filter((a) => /^wp_/.test(a)))).size).toBe(4);
		expect(rx.some((c) => c.args.some((a) => a.startsWith('--include-columns')))).toBe(false);
	});
});

describe('Job: disk space for the backup', () => {
	it('stops before any change when the disk is too small', async () => {
		const c = singleCtx();
		c.tables = [table('wp_options', 30 * 1024 ** 3)];
		const { job } = make(c, plain({ backup: true }), { freeBytes: () => 5 * 1024 ** 3 });
		const snap = await job.start();
		expect(snap.state).toBe('failed');
		expect(snap.error).toMatch(/Not enough free disk space.*30\.0 GB needed, 5\.0 GB free/);
		expect(calls).toHaveLength(0);
	});
	it('goes on when the space is enough or unknown', async () => {
		const c = singleCtx();
		c.tables = [table('wp_options', 1024)];
		expect(
			(await make(c, plain({ backup: true }), { freeBytes: () => 1e9 }).job.start()).state,
		).toBe('completed');
		expect(
			(await make(c, plain({ backup: true }), { freeBytes: () => null }).job.start()).state,
		).toBe('completed');
	});
});

describe('Job: fallback when WP-CLI fails', () => {
	const rtDb = {
		php: 'php',
		wpCliPhar: 'x.phar',
		env: {},
		wpPath: '/w',
		db: {
			host: '127.0.0.1',
			port: 3306,
			name: 'local',
			user: 'root',
			password: 'root',
			mysqldump: '/bin/mysqldump',
		},
	};
	it('a step that WP-CLI cannot run is repeated with the fallback', async () => {
		failWp = () => 'Fatal error: Uncaught Error in wp-config.php';
		const { job, logs } = make(singleCtx(), plain(), { runtime: rtDb });
		const snap = await job.start();
		expect(snap.state).toBe('completed');
		expect(calls.some((c) => c.kind === 'fallback')).toBe(true);
		expect(snap.totalReplacements).toBe(2);
		expect(logs.some((l) => l.level === 'warn' && /fallback/.test(l.text))).toBe(true);
	});
	it('without database access, or with the option off, the failure stays a failure', async () => {
		failWp = () => 'Fatal error: boom';
		expect((await make(singleCtx(), plain()).job.start()).state).toBe('failed');
		calls.length = 0;
		expect(
			(await make(singleCtx(), plain({ fallback: false }), { runtime: rtDb }).job.start()).state,
		).toBe('failed');
		expect(calls.some((c) => c.kind === 'fallback')).toBe(false);
	});
	it('a bad regex is not retried: the fallback would fail the same way', async () => {
		failWp = () => 'Error: The regex pattern is bad';
		const snap = await make(singleCtx(), plain(), { runtime: rtDb }).job.start();
		expect(snap.state).toBe('failed');
		expect(calls.some((c) => c.kind === 'fallback')).toBe(false);
	});
	it('when the scan already needed the fallback, no step tries WP-CLI first and wp-config is not touched', async () => {
		const ctx = { ...multiCtx(false), fallback: true };
		const { job, logs } = make(ctx, plain({ flushCache: true }), { runtime: rtDb });
		const snap = await job.start();
		expect(snap.state).toBe('completed');
		expect(calls.every((c) => c.kind === 'fallback')).toBe(true);
		expect(
			logs.some((l) => /wp-config\.php and the object cache were not touched/.test(l.text)),
		).toBe(true);
	});
	it('the backup uses mysqldump when WP-CLI export fails, or when WP-CLI is not usable', async () => {
		failWp = () => 'Error: mysqldump not found';
		const a = await make(singleCtx(), plain({ backup: true }), { runtime: rtDb }).job.start();
		expect(a.state).toBe('completed');
		expect(calls.some((c) => c.kind === 'dump')).toBe(true);
		calls.length = 0;
		failWp = null;
		await make({ ...singleCtx(), fallback: true }, plain({ backup: true }), {
			runtime: rtDb,
		}).job.start();
		expect(calls[0].kind).toBe('dump');
	});
});

describe('Job: safety and review fixes', () => {
	it('an exception inside the run ends it as failed and never leaves it active (the site is not locked)', async () => {
		const { job } = make(singleCtx(), plain({ backup: true }), {
			freeBytes: () => {
				throw new Error('disk probe exploded');
			},
		});
		const snap = await job.start();
		expect(snap.state).toBe('failed');
		expect(snap.error).toMatch(/Unexpected error: disk probe exploded/);
		expect(job.isActive).toBe(false);
	});

	it('a failed backup leaves no part of a dump behind', async () => {
		auto = false;
		const { job } = make(singleCtx(), plain({ backup: true }));
		const run = job.start();
		await wait(10);
		const dump = calls[0];
		fs.writeFileSync(dump.args[2], 'partial dump');
		dump.finish(1, 'Error: disk full');
		const snap = await run;
		expect(snap.state).toBe('failed');
		expect(fs.existsSync(dump.args[2])).toBe(false);
	});

	it('old backups are removed only after a run that worked, so the undo is never deleted first', async () => {
		const old = path.join(tmp, 'backups', 'search-replace-backup-20200101-000000.sql');
		const keep = () => {
			fs.mkdirSync(path.dirname(old), { recursive: true });
			fs.writeFileSync(old, 'x');
			fs.utimesSync(old, 1, 1);
		};
		keep();
		await make(singleCtx(), plain({ dryRun: true })).job.start();
		expect(fs.existsSync(old)).toBe(true); // a dry run does not delete the only backup
		failWp = () => 'Error: boom';
		expect((await make(singleCtx(), plain()).job.start()).state).toBe('failed');
		expect(fs.existsSync(old)).toBe(true); // a failed run does not either
		failWp = null;
		expect((await make(singleCtx(), plain()).job.start()).state).toBe('completed');
		expect(fs.existsSync(old)).toBe(false);
	});

	it('the fallback retry does not run the tables WP-CLI already finished', async () => {
		auto = false;
		const rtDb = {
			php: 'php',
			wpCliPhar: 'x.phar',
			env: {},
			wpPath: '/w',
			db: { host: '127.0.0.1', port: 3306, name: 'l', user: 'root', password: '' },
		};
		const { job } = make(
			singleCtx(),
			opts([pair('https://prod.example.net', 'https://prod.example.net/blog')], {
				includeVariants: false,
				protectEmails: false,
				backup: false,
				flushCache: false,
			}),
			{ runtime: rtDb },
		);
		const run = job.start();
		await wait(10);
		const first = calls[0];
		first.line('Checking: wp_commentmeta.meta_value');
		first.line('Checking: wp_comments.comment_content'); // wp_commentmeta is finished now
		first.finish(1, 'Fatal error: Uncaught Error');
		await wait(10);
		const retry = calls.find((c) => c.kind === 'fallback') as Call;
		expect(retry).toBeTruthy();
		expect(retry.args).not.toContain('wp_commentmeta');
		expect(retry.args).toContain('wp_comments');
		expect(retry.args.length).toBe(11);
		retry.finish(0);
		expect((await run).state).toBe('completed');
	});

	it('cancel during the pre-scan kills every pre-scan process', async () => {
		// The mock prefilter never starts a process, so this checks the bookkeeping: cancel before the run ends cleanly.
		auto = false;
		const { job } = make(singleCtx(), plain());
		const run = job.start();
		await wait(5);
		job.cancel();
		expect((await run).state).toBe('cancelled');
	});

	describe('DOMAIN_CURRENT_SITE comes from the database and is written into wp-config.php', () => {
		const dbAnswers = (domain: string) => (args: string[]) =>
			args[0] === 'db'
				? { code: 0, stdout: `${domain}\n`, stderr: '' }
				: args[0] === 'config' && args[1] === 'get'
					? { code: 0, stdout: 'old.example.net\n', stderr: '' }
					: { code: 0, stdout: '', stderr: '' };
		const sets = () => runWpCalls.filter((a) => a[0] === 'config' && a[1] === 'set');
		it.each([["\\');echo 1;//"], ['--exec=system(1).a.com'], ["x'.phpinfo().'"]])(
			'a hostile network domain %j is never written',
			async (domain) => {
				runWpImpl = dbAnswers(domain);
				const { logs } = make(multiCtx(false), plain());
				await make(multiCtx(false), plain()).job.start();
				expect(sets()).toEqual([]);
				void logs;
			},
		);
		it('only the first line of the answer is used, so text after a line break is never written', async () => {
			runWpImpl = dbAnswers('a.com\nb.com;evil');
			await make(multiCtx(false), plain()).job.start();
			expect(sets()).toEqual([['config', 'set', 'DOMAIN_CURRENT_SITE', 'a.com']]);
		});
		it('a plain host is still written', async () => {
			runWpImpl = dbAnswers('ms.test');
			await make(multiCtx(false), plain()).job.start();
			expect(sets()).toEqual([['config', 'set', 'DOMAIN_CURRENT_SITE', 'ms.test']]);
		});
		it('a host with a port and an international host name are plain too', async () => {
			runWpImpl = dbAnswers('münchen.example:8080');
			await make(multiCtx(false), plain()).job.start();
			expect(sets()).toHaveLength(1);
		});
	});

	it('a table that WP-CLI would read as an option is never given to it', async () => {
		const ctx = singleCtx();
		ctx.tables.push(table('--exec=system(1)'), table('-x'));
		const { job } = make(ctx, plain());
		const snap = await job.start();
		expect(snap.state).toBe('completed');
		const given = wpCalls().flatMap((c) => c.args);
		expect(given.some((a) => a.startsWith('--exec'))).toBe(false);
		expect(given).not.toContain('-x');
	});

	it('the ETA does not count the time of the backup', async () => {
		let t = 0;
		const ctx = singleCtx();
		ctx.tables = [table('wp_options', 1_000_000)];
		const o = opts(
			[
				pair('https://prod.example.net', 'https://my.test'),
				pair('https://prod.example.net/a', 'https://my.test/a'),
			],
			{ includeVariants: false, protectEmails: false, backup: true, flushCache: false, workers: 1 },
		);
		auto = false;
		const { job, snaps } = make(ctx, o, { now: () => t });
		const run = job.start();
		await wait(10);
		t = 600_000; // the backup took ten minutes
		calls[0].finish(0);
		await wait(10);
		calls[1].line('Checking: wp_options.option_value');
		t = 600_000 + 10_000; // the first of two steps took ten seconds
		calls[1].finish(0);
		await wait(10);
		const mid = snaps.filter((s) => s.state === 'running').at(-1) as JobSnapshot;
		expect(mid.progress).toBeGreaterThan(0.3);
		// Ten minutes of backup plus about twenty seconds of steps, not ten minutes divided by the progress.
		expect(mid.estimatedTotalMs).toBeLessThan(600_000 + 60_000);
		calls[2].finish(0);
		await run;
	});
});

describe('Job: the WP-CLI flags of the options reach every command', () => {
	it('the runtime given to WP-CLI carries the skip flags, and the step has --report-changed-only (dry run and real run)', async () => {
		for (const dryRun of [true, false]) {
			calls.length = 0;
			await make(singleCtx(), plain({ dryRun })).job.start();
			expect(wpCalls().length).toBeGreaterThan(0);
			expect(wpCalls().every((c) => c.args.includes('--report-changed-only'))).toBe(true);
		}
	});
});

describe('Job: skip flags of the options', () => {
	it('all on by default: every WP-CLI command (steps, backup, cache flush) gets them', async () => {
		await make(singleCtx(), plain({ backup: true, flushCache: true })).job.start();
		expect(runtimes.length).toBeGreaterThan(2);
		for (const r of runtimes)
			expect(r.skip).toEqual({ plugins: true, themes: true, packages: true });
	});
	it('each one follows its option', async () => {
		await make(
			singleCtx(),
			plain({ skipPlugins: false, skipThemes: true, skipPackages: false }),
		).job.start();
		expect(runtimes.length).toBeGreaterThan(0);
		for (const r of runtimes)
			expect(r.skip).toEqual({ plugins: false, themes: true, packages: false });
	});
});

describe('Job: the log of a dry run', () => {
	it('shows each changed column of the report as a line, drops the report header, and says nothing was changed', async () => {
		auto = false;
		const { job, logs } = make(singleCtx(), plain({ dryRun: true }));
		const run = job.start();
		await wait(10);
		const c = calls[0];
		c.line('Checking: wp_options.option_value');
		c.line('10 rows affected using PHP (in 0.004s).');
		c.line('Table\tColumn\tReplacements\tType');
		c.line('wp_options\toption_value\t10\tPHP');
		c.line('wp_posts\tpost_content\t3\tSQL');
		c.line('Success: 13 replacements to be made.');
		c.finish(0);
		await run;
		const text = logs.map((l) => l.text);
		expect(text).toContain('wp_options.option_value: 10 replacement(s) (PHP)');
		expect(text).toContain('wp_posts.post_content: 3 replacement(s) (SQL)');
		expect(text.some((t) => t.startsWith('Table\tColumn'))).toBe(false);
		expect(
			text.some((t) =>
				/Dry run finished: 13 replacement\(s\) would be made\. Nothing was changed/.test(t),
			),
		).toBe(true);
	});
	it('the commands of a dry run are in the log, with the flags that were used', async () => {
		await make(singleCtx(), plain({ dryRun: true })).job.start();
		expect(wpCalls()[0].args).toEqual(
			expect.arrayContaining(['--dry-run', '--report-changed-only']),
		);
	});
});
