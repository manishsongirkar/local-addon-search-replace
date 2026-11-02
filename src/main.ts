import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type * as Local from '@getflywheel/local';
import * as LocalMain from '@getflywheel/local/main';
import {
	CH,
	type JobSnapshot,
	type LogFileInfo,
	type LogLevel,
	type LogLine,
	type RunOptions,
	type SavedConfig,
	type ScanResult,
	type SiteContext,
	type SiteJobView,
} from './common/types';
import { chooseDbConn, serviceConfDir } from './engine/dbconn';
import { buildWpEnv, findWpCliPhar } from './engine/env';
import {
	type Change,
	type Fingerprint,
	compareFingerprints,
	readFingerprint,
} from './engine/fingerprint';
import { markReplaced, nextImportInfo } from './engine/importInfo';
import { withSsl } from './engine/localurl';
import { FileLog } from './engine/logger';
import { reconcilePairs } from './engine/reconcile';
import { LOG_PATTERN } from './engine/retention';
import { Job } from './engine/runner';
import { EngineError, loadContext, scanDomains } from './engine/scan';
import { startIfHalted } from './engine/siteStart';
import {
	addHistory,
	cleanOptions,
	cleanPairs,
	loadConfig,
	readHistory,
	readImportInfo,
	saveConfig,
	writeImportInfo,
} from './engine/store';
import { hostOf } from './engine/urls';
import { allTablesOnly, hasErrors, skipFlagsOf, validate } from './engine/validate';
import { isInside, resolveWpPath } from './engine/wpPath';
import type { WpRuntime } from './engine/wpRunner';

const MAX_LOG_LINES = 2000;
/** Largest part of a saved log the app loads. The newest lines are kept. */
const MAX_READ_BYTES = 2 * 1024 * 1024;

interface SiteState {
	job: Job | null;
	snapshot: JobSnapshot | null;
	logs: LogLine[];
	scan: ScanResult | null;
	/** The site layout read last (by a scan or at the start of a run). A run needs no earlier scan. */
	context: SiteContext | null;
	localHost: string;
	/** Summary of the database at the last scan. A later difference means it was imported or changed. */
	fingerprint: Fingerprint | null;
	activity: FileLog | null;
	activityDay: string;
	/** A scan or a start is under way. A second one for the same site is refused. */
	busy: boolean;
}

/** Everything is keyed by the Local site id. Two sites never share a job, a log, a scan or a config. */
const states = new Map<string, SiteState>();
const stateOf = (id: string): SiteState => {
	const known = states.get(id);
	if (known) return known;
	const s: SiteState = {
		job: null,
		snapshot: null,
		logs: [],
		scan: null,
		context: null,
		localHost: '',
		fingerprint: null,
		activity: null,
		activityDay: '',
		busy: false,
	};
	states.set(id, s);
	return s;
};

const services = () => LocalMain.getServiceContainer().cradle;

function getSite(siteId: string): Local.Site {
	const site = services().siteData.getSite(siteId);
	if (!site) throw new EngineError('NO_SITE', 'This site was not found in Local.');
	return site;
}

/** Folder for this add-on's backups, logs, config and history, inside the site folder. */
const dataDir = (site: Local.Site, ...sub: string[]): string =>
	path.join(site.path, 'search-replace', ...sub);

/** Number of parallel WP-CLI processes when the user leaves "workers" at 0. */
const defaultWorkers = (): number => Math.min(4, Math.max(1, Math.floor(os.cpus().length / 2)));

const pushLog = (siteId: string, line: LogLine): void => {
	const st = stateOf(siteId);
	st.logs.push(line);
	if (st.logs.length > MAX_LOG_LINES) st.logs.splice(0, st.logs.length - MAX_LOG_LINES);
	LocalMain.sendIPCEvent(CH.log, siteId, line);
};

/**
 * Log for work outside a run (scan, reading files). One file per day, so a problem found while scanning
 * is still on disk after the app is closed. Old files are removed by the 30 day rotation.
 */
function activity(siteId: string, level: LogLevel, text: string): void {
	const t = Date.now();
	pushLog(siteId, { t, level, text });
	try {
		const st = stateOf(siteId);
		const day = new Date(t).toISOString().slice(0, 10).replace(/-/g, '');
		if (!st.activity || st.activityDay !== day) {
			const dir = dataDir(getSite(siteId), 'logs');
			fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
			st.activity = new FileLog(path.join(dir, `activity-${day}.log`));
			st.activityDay = day;
		}
		st.activity.write(level, t, text);
	} catch {
		// Logging must never break the action it describes.
	}
}

/** How the PHP fallback reaches this site's database, whatever engine the site uses. */
function connFor(
	site: Local.Site,
	db: ReturnType<ReturnType<typeof services>['lightningServices']['getSiteServiceByRole']>,
	wpPath: string,
) {
	const readConfig = (): string | undefined => {
		for (const dir of [site.paths.webRoot, wpPath, path.dirname(wpPath)]) {
			try {
				return fs.readFileSync(path.join(dir, 'wp-config.php'), 'utf8');
			} catch {
				// Not here. Bedrock keeps its settings elsewhere.
			}
		}
		return undefined;
	};
	const listed = Object.values(site.services ?? {}).find(
		(s) => (s as { role?: string }).role === 'db',
	);
	return chooseDbConn({
		creds: site.mysql,
		socket: db?.socket,
		port: db?.port as number | null | undefined,
		listedPorts: (listed as { ports?: unknown } | undefined)?.ports,
		mysqldump: db?.bin?.mysqldump ?? db?.bin?.['mariadb-dump'],
		wpConfig: readConfig(),
	});
}

/**
 * The URL to suggest as the new domain. Local's own `site.url` is always `http://`, so SSL is added from the certificate:
 * a trusted certificate means the site is served on https. A slow or failing check never blocks the scan: it means http.
 */
async function localUrlOf(siteId: string, site: Local.Site): Promise<string> {
	let trusted = false;
	try {
		const answer = await Promise.race([
			services().x509Cert.certificateTrustStatus(site),
			new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
		]);
		trusted = answer === true;
	} catch (e) {
		activity(siteId, 'warn', `Could not check the SSL certificate: ${(e as Error).message}`);
	}
	const url = withSsl(site.url, trusted);
	activity(
		siteId,
		'info',
		`Local URL: ${url} (${trusted ? 'SSL certificate is trusted' : 'no trusted SSL certificate'})`,
	);
	return url;
}

/** WP-CLI the way Local starts it: Local's PHP, its WP-CLI phar, and the PATH of its PHP and database services. */
function buildRuntime(site: Local.Site, wpPathOverride: string, fallback: boolean): WpRuntime {
	const { lightningServices, electron } = services();
	const php = lightningServices.getSiteServiceByRole(site, 'php' as Local.SiteServiceRole);
	const db = lightningServices.getSiteServiceByRole(site, 'db' as Local.SiteServiceRole);
	const phpBin = php?.bin?.php;
	if (!php || !phpBin)
		throw new EngineError(
			'NO_PHP',
			'The PHP service of this site was not found. Start the site in Local.',
		);

	const resources = process.resourcesPath;
	const phar = findWpCliPhar([
		path.join(resources, 'extraResources'),
		resources,
		path.join(electron.app.getAppPath(), '..', 'extraResources'),
		path.join(electron.app.getAppPath(), 'extraResources'),
	]);
	// A missing phar is exactly the case the fallback is for. Without a fallback it is an error.
	if (!phar && !fallback)
		throw new EngineError('NO_WPCLI', 'WP-CLI was not found in this Local install.');

	const resolved = resolveWpPath(site.paths.webRoot, wpPathOverride);
	if (!resolved) {
		throw new EngineError(
			'NO_WP',
			'WordPress was not found. Set the WordPress path in Advanced options.',
		);
	}
	// WP-CLI runs the wp-config.php and the code of this folder. It must be part of this Local site.
	if (!isInside(site.path, resolved.path)) {
		throw new EngineError(
			'OUTSIDE',
			`The WordPress path (${resolved.path}) is outside the folder of this site. Choose a folder inside ${site.path}.`,
		);
	}
	return {
		php: phpBin,
		wpCliPhar: phar ?? path.join(resources, 'missing-wp-cli.phar'),
		wpPath: resolved.path,
		db: fallback ? connFor(site, db, resolved.path) : undefined,
		env: buildWpEnv({
			base: process.env,
			phpEnv: php.env,
			servicePaths: [php.$PATH, db?.$PATH],
			// Local names these folders after the service (`conf/mysql` or `conf/mariadb`), so ask the service.
			phpIniDir: serviceConfDir(site.paths.conf, php, 'php'),
			mysqlHome: serviceConfDir(site.paths.conf, db, 'mysql'),
			wpConfigPath: path.join(site.paths.webRoot, 'wp-config.php'),
		}),
	};
}

/** The fingerprint of the site database, read directly (no WP-CLI, no WordPress). `null` when it cannot be reached. */
async function fingerprintOf(site: Local.Site, wpPath: string): Promise<Fingerprint | null> {
	try {
		return await readFingerprint(buildRuntime(site, wpPath, true));
	} catch {
		return null;
	}
}

/**
 * Did the database change since the last scan, by an import with any tool or by a new site URL?
 * The page asks when it opens and when you come back to Local. A change makes it scan again.
 */
async function check(siteId: string, wpPath = ''): Promise<Change> {
	const site = getSite(siteId);
	const st = stateOf(siteId);
	if (st.busy || st.job?.isActive) return { changed: false, reason: '' };
	const next = await fingerprintOf(site, wpPath);
	// Without a reading, nothing can be compared. A site never scanned in this session is still scanned.
	const change = next
		? compareFingerprints(st.fingerprint, next)
		: { changed: !st.scan, reason: st.scan ? '' : 'This site was not scanned in this session.' };
	if (change.changed && st.scan)
		activity(siteId, 'info', `Database change found. ${change.reason} Scanning again.`);
	return change;
}

async function scan(
	siteId: string,
	wpPath: string,
	current?: SavedConfig,
	startSite = false,
): Promise<ScanResult> {
	const site = getSite(siteId);
	const st = stateOf(siteId);
	if (st.busy) throw new EngineError('BUSY', 'A scan or a run is already starting for this site.');
	st.busy = true;
	// The form may hold edits that are not saved yet. Reconcile with what the user sees, not with an older file.
	const saved: SavedConfig = current
		? { pairs: cleanPairs(current.pairs), options: cleanOptions(current.options) }
		: loadConfig(dataDir(site));
	activity(siteId, 'cmd', 'Scan started.');
	try {
		// Only a click on "Scan site" starts a stopped site. The scan that runs by itself when the page opens never does.
		if (startSite) {
			const { siteProcessManager, siteDatabase } = services();
			await startIfHalted(siteProcessManager, siteDatabase, site, (level, text) =>
				activity(siteId, level, text),
			);
		}
		const rt = {
			...buildRuntime(site, wpPath || saved.options.wpPath, saved.options.fallback),
			skip: skipFlagsOf(saved.options),
		};
		activity(siteId, 'info', `WordPress path: ${rt.wpPath}`);
		// Taken before the scan, so a change during the scan is seen at the next check.
		const fingerprint = await fingerprintOf(site, wpPath || saved.options.wpPath);
		const context = await loadContext(rt);
		if (context.fallback) {
			activity(
				siteId,
				'warn',
				'WP-CLI could not run for this site. The built-in PHP/MySQL fallback read the database instead.',
			);
		}
		const localUrl = await localUrlOf(siteId, site);
		const candidates = await scanDomains(rt, context, localUrl);
		// A change of the tables since the last scan in this session is an import.
		const tablesChanged = !!(
			st.fingerprint &&
			fingerprint &&
			st.fingerprint.tables !== fingerprint.tables
		);
		const prevImport = readImportInfo(dataDir(site));
		const importInfo = nextImportInfo(prevImport, candidates, tablesChanged);
		if (importInfo !== prevImport) writeImportInfo(dataDir(site), importInfo);
		// Check the saved list against the database now, and save the result.
		const { pairs, added, removed } = reconcilePairs(saved.pairs, candidates);
		if (added.length || removed.length || current) saveConfig(dataDir(site), { ...saved, pairs });
		const result: ScanResult = {
			context,
			candidates,
			pairs,
			added,
			removed,
			localUrl,
			localHost: hostOf(localUrl),
			importInfo,
		};
		Object.assign(st, { scan: result, context, localHost: result.localHost, fingerprint });
		activity(
			siteId,
			'info',
			`Scan finished: ${context.tables.length} table(s), ${context.blogs.length} site(s), ${candidates.length} domain(s). Added ${added.length}, removed ${removed.length}.`,
		);
		for (const d of removed)
			activity(siteId, 'info', `Removed from the saved list (not in the database any more): ${d}`);
		return result;
	} catch (e) {
		activity(siteId, 'error', `Scan failed: ${(e as Error).message}`);
		throw e;
	} finally {
		st.busy = false;
	}
}

function issuesFor(siteId: string, options: RunOptions) {
	const opts = allTablesOnly(options);
	const st = stateOf(siteId);
	return validate(opts, {
		localHost: st.localHost || hostOf(getSite(siteId).url),
		// Unknown (empty) until the site layout was read once. The validation then skips the checks that need it.
		dbHosts: st.context
			? st.context.blogs.map((b) => hostOf(b.siteurl || b.home)).filter(Boolean)
			: [],
	});
}

async function start(siteId: string, options: RunOptions): Promise<void> {
	const opts = allTablesOnly(options);
	const kind = opts.dryRun ? 'Dry run' : 'Run';
	try {
		await prepareAndStart(siteId, opts);
	} catch (e) {
		// Every refusal is written to the log, so the Logs tab explains why nothing started.
		activity(siteId, 'error', `${kind} not started: ${(e as Error).message}`);
		throw e;
	}
}

async function prepareAndStart(siteId: string, opts: RunOptions): Promise<void> {
	const st = stateOf(siteId);
	if (st.job?.isActive) throw new EngineError('BUSY', 'A run is already active for this site.');
	if (st.busy) throw new EngineError('BUSY', 'A scan or a run is already starting for this site.');
	const site = getSite(siteId);
	const history = readHistory(dataDir(site));
	st.busy = true;
	let runtime: WpRuntime;
	let context: SiteContext;
	try {
		runtime = { ...buildRuntime(site, opts.wpPath, opts.fallback), skip: skipFlagsOf(opts) };
		// The tables are read again at every start: they may have changed (import, clone, a plugin). A scan in this
		// session is not needed: after a restart of Local the saved rows are there, and a run must still work.
		try {
			context = await loadContext(runtime);
			st.context = context;
			st.localHost = st.localHost || hostOf(site.url);
		} catch (e) {
			if (!st.context) throw e;
			activity(
				siteId,
				'warn',
				`Could not refresh the table list. The last one is used. ${(e as Error).message}`,
			);
			context = st.context;
		}
	} finally {
		st.busy = false;
	}
	const errors = issuesFor(siteId, opts).filter((i) => i.level === 'error');
	if (errors.length) {
		throw new EngineError(
			'INVALID',
			`Fix this before you run: ${errors.map((i) => i.message).join(' ')}`,
		);
	}
	activity(siteId, 'cmd', `${opts.dryRun ? 'Dry run' : 'Run'} requested.`);
	const job = new Job({
		siteId,
		runtime,
		context,
		opts,
		backupDir: dataDir(site, 'backups'),
		logDir: dataDir(site, 'logs'),
		defaultWorkers: defaultWorkers(),
		priorEstimateMs: history.find((h) => h.dryRun && h.state === 'completed')?.durationMs ?? null,
		onSnapshot: (snap) => {
			st.snapshot = snap;
			LocalMain.sendIPCEvent(CH.snapshot, snap);
		},
		onLog: (line) => pushLog(siteId, line),
	});
	st.job = job;
	void job
		.start()
		.then((snap) => {
			if (snap.state === 'completed' && !snap.dryRun) {
				const before = readImportInfo(dataDir(site));
				const after = markReplaced(before, opts.pairs);
				if (after !== before) writeImportInfo(dataDir(site), after);
			}
			addHistory(dataDir(site), {
				id: `${snap.startedAt}`,
				at: snap.startedAt ?? Date.now(),
				dryRun: snap.dryRun,
				state: snap.state,
				durationMs: (snap.finishedAt ?? Date.now()) - (snap.startedAt ?? Date.now()),
				replacements: snap.totalReplacements,
				pairs: opts.pairs
					.filter((p) => p.enabled)
					.map(({ search, replace, regex }) => ({ search, replace, regex })),
				backupFile: snap.backupFile,
				logFile: snap.logFile,
			});
		})
		.catch((e: Error) => {
			// Job.start reports its own failures. This only catches a bug.
			activity(siteId, 'error', `Unexpected error: ${e.stack ?? e.message}`);
		});
}

function logFiles(siteId: string): LogFileInfo[] {
	const dir = dataDir(getSite(siteId), 'logs');
	let names: string[];
	try {
		names = fs.readdirSync(dir);
	} catch {
		return [];
	}
	return names
		.filter((n) => LOG_PATTERN.test(n))
		.map((name): LogFileInfo | null => {
			try {
				const st = fs.lstatSync(path.join(dir, name));
				return st.isFile() ? { name, bytes: st.size, mtime: st.mtimeMs } : null;
			} catch {
				return null;
			}
		})
		.filter((f): f is LogFileInfo => f !== null)
		.sort((a, b) => b.mtime - a.mtime);
}

/** Text of one saved log. The name must be one of our own log names, so it can never point outside the folder. */
function readLog(siteId: string, name: string): string {
	if (!LOG_PATTERN.test(name))
		throw new EngineError('BAD_NAME', 'This is not a log file of the add-on.');
	const file = path.join(dataDir(getSite(siteId), 'logs'), name);
	// Only a real file of ours. A link or a pipe planted under a log name is refused.
	const info = fs.lstatSync(file);
	if (!info.isFile()) throw new EngineError('BAD_NAME', 'This is not a log file of the add-on.');
	const size = info.size;
	const fd = fs.openSync(file, 'r');
	try {
		const len = Math.min(size, MAX_READ_BYTES);
		const buf = Buffer.alloc(len);
		fs.readSync(fd, buf, 0, len, size - len);
		const text = buf.toString('utf8');
		return size > len
			? `[Only the last ${MAX_READ_BYTES / 1024 / 1024} MB are shown.]\n${text.slice(text.indexOf('\n') + 1)}`
			: text;
	} finally {
		fs.closeSync(fd);
	}
}

export default function main(): void {
	const { addIpcAsyncListener } = LocalMain;
	addIpcAsyncListener(
		CH.scan,
		(siteId: string, wpPath = '', current?: SavedConfig, startSite = false) =>
			scan(siteId, wpPath, current, startSite === true),
	);
	addIpcAsyncListener(CH.check, (siteId: string, wpPath = '') => check(siteId, wpPath));
	addIpcAsyncListener(CH.validate, (siteId: string, opts: RunOptions) => issuesFor(siteId, opts));
	addIpcAsyncListener(CH.start, (siteId: string, opts: RunOptions) => start(siteId, opts));
	addIpcAsyncListener(CH.cancel, (siteId: string) => {
		getSite(siteId);
		stateOf(siteId).job?.cancel();
	});
	addIpcAsyncListener(CH.state, (siteId: string): SiteJobView => {
		getSite(siteId);
		const { snapshot, logs } = stateOf(siteId);
		return { snapshot, logs };
	});
	addIpcAsyncListener(CH.history, (siteId: string) => readHistory(dataDir(getSite(siteId))));
	addIpcAsyncListener(CH.loadConfig, (siteId: string) => {
		const dir = dataDir(getSite(siteId));
		return { ...loadConfig(dir), importInfo: readImportInfo(dir) };
	});
	addIpcAsyncListener(CH.saveConfig, (siteId: string, cfg: SavedConfig) =>
		saveConfig(dataDir(getSite(siteId)), cfg),
	);
	addIpcAsyncListener(CH.logFiles, (siteId: string) => logFiles(siteId));
	addIpcAsyncListener(CH.readLog, (siteId: string, name: string) => readLog(siteId, name));
	addIpcAsyncListener(CH.openFolder, async (siteId: string) => {
		const dir = dataDir(getSite(siteId), 'logs');
		fs.mkdirSync(dir, { recursive: true });
		await services().electron.shell.openPath(dir);
	});
}
