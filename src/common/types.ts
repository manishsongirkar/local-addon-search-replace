/** Types shared by the main process, the engine and the renderer. */

export interface ReplacePair {
	id: string;
	search: string;
	replace: string;
	regex: boolean;
	enabled: boolean;
	/**
	 * `scan`: created from a domain found in the database. It is removed again when the domain leaves the database.
	 * `custom` (or missing): typed by the user. It is never removed automatically.
	 */
	origin?: 'scan' | 'custom';
	/** The replace text that was suggested for a scan row. While the row still holds it, a better suggestion replaces it. */
	suggested?: string;
	/**
	 * Where a scan row belongs in the list. `main`: a domain the site is registered under (ticked). `close`: near a main
	 * domain, with a suggestion (not ticked). `other`: any other domain found in the database (not ticked).
	 */
	kind?: 'main' | 'close' | 'other';
}

export interface RunOptions {
	pairs: ReplacePair[];
	dryRun: boolean;
	/** Export the database before a real run. */
	backup: boolean;
	/**
	 * Search every table in the database (WP-CLI `--all-tables`), also tables without the WordPress prefix and
	 * plugin tables WordPress does not know. Off: only tables with the site prefix (`--all-tables-with-prefix`).
	 */
	allTables: boolean;
	/** WP-CLI --precise: always process in PHP (slower, safer for odd serialised data). */
	precise: boolean;
	/** Comma separated column names. `guid` is handled by `replaceGuid`, not by this list. */
	skipColumns: string;
	/** Comma separated table names; `*` is a wildcard. */
	skipTables: string;
	/** Also replace http/https twins, protocol-relative, JSON-escaped (`\/`) and URL-encoded forms of a URL. */
	includeVariants: boolean;
	/** Never change a domain that is part of an e-mail address. */
	protectEmails: boolean;
	/** Flags for regex pairs, for example `i`. */
	regexFlags: string;
	flushCache: boolean;
	/** Manual WordPress path. Empty = detect. */
	wpPath: string;
	/** Match upper and lower case exactly. Always on in the app (no option); off only in the engine tests. */
	caseSensitive: boolean;
	/** Also change the `guid` column. WordPress says GUIDs should stay as they are, so the app keeps it off (no option). */
	replaceGuid: boolean;
	/** WP-CLI `--report-changed-only`: the report lists only tables and columns that changed. On by default. */
	reportChangedOnly: boolean;
	/** WP-CLI `--skip-plugins`: do not load plugins. On by default: faster, and no plugin code runs. */
	skipPlugins: boolean;
	/** WP-CLI `--skip-themes`: do not load the theme. On by default. */
	skipThemes: boolean;
	/** WP-CLI `--skip-packages`: do not load installed WP-CLI packages. On by default. */
	skipPackages: boolean;
	/** Use the built-in PHP/MySQL fallback when WP-CLI cannot run. */
	fallback: boolean;
	/** Parallel WP-CLI processes. 0 = choose from the CPU count. */
	workers: number;
}

export interface TableInfo {
	name: string;
	bytes: number;
	rows: number;
}

export interface BlogInfo {
	id: number;
	domain: string;
	path: string;
	siteurl: string;
	home: string;
	/** Prefix of this blog's tables, for example `wp_2_`. */
	tablePrefix: string;
}

export interface SiteContext {
	wpPath: string;
	wpVersion: string;
	prefix: string;
	multisite: boolean;
	subdomain: boolean;
	blogs: BlogInfo[];
	tables: TableInfo[];
	/** WP-CLI could not run. Context and replace steps use the built-in PHP/MySQL fallback. */
	fallback?: boolean;
	/** `--url` value needed to load WordPress, when the DB domain differs from wp-config. */
	urlArg?: string;
}

export interface DomainCandidate {
	/** `scheme://host[:port][/path]` as found in the database. */
	value: string;
	host: string;
	count: number;
	sources: string[];
	/** Comes from siteurl/home or the network tables. */
	primary: boolean;
	suggestedReplace: string;
	preselected: boolean;
}

/** Where the database of this site came from, so the page can say it. Saved per site, apart from the pairs. */
export interface ImportInfo {
	/** The domain found in the imported database. */
	from: string;
	/** The Local domain it maps to. */
	to: string;
	/** When the import was first seen. */
	at: number;
	/** A real run replaced `from`. `to` is then the text it was replaced with. */
	replaced: boolean;
	/** When the run finished. */
	replacedAt?: number;
}

export interface ScanResult {
	context: SiteContext;
	candidates: DomainCandidate[];
	/** The saved mapping list after it was checked against this scan. Already saved. Show this list. */
	pairs: ReplacePair[];
	/** Domains new in the database since the last scan, appended to `pairs`. */
	added: string[];
	/** Saved domains that left the database, removed from `pairs`. */
	removed: string[];
	localUrl: string;
	localHost: string;
	/** The import of this site, or `null` when the database never came from another domain. */
	importInfo: ImportInfo | null;
}

export type IssueLevel = 'error' | 'warning' | 'info';

export interface Issue {
	level: IssueLevel;
	code: string;
	message: string;
	pairId?: string;
	/** The user must tick a confirmation before a real run. */
	needsConfirm?: boolean;
}

export type JobState =
	| 'idle'
	| 'preparing'
	| 'running'
	| 'cancelling'
	| 'completed'
	| 'failed'
	| 'cancelled';

export type StepState = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

export interface StepInfo {
	index: number;
	label: string;
	scope: string;
	tables: number;
	state: StepState;
	replacements: number;
}

export interface JobSnapshot {
	siteId: string;
	state: JobState;
	dryRun: boolean;
	steps: StepInfo[];
	/** 0..1, weighted by table size. */
	progress: number;
	startedAt: number | null;
	finishedAt: number | null;
	/** Estimated total duration in ms. `null` while unknown. */
	estimatedTotalMs: number | null;
	currentLabel: string;
	/** Tables WP-CLI is checking now, one per running process. */
	activeTables: string[];
	/** Parallel WP-CLI processes in use. */
	workers: number;
	/** Table checks finished and total over all steps. */
	tablesDone: number;
	tablesTotal: number;
	totalReplacements: number;
	error: string | null;
	backupFile: string | null;
	logFile: string | null;
}

/** `cmd` marks a step or command. `notice` is a PHP/WP-CLI notice or deprecation. */
export type LogLevel = 'info' | 'notice' | 'warn' | 'error' | 'cmd';

export interface LogLine {
	t: number;
	level: LogLevel;
	text: string;
}

export interface HistoryEntry {
	id: string;
	at: number;
	dryRun: boolean;
	state: JobState;
	durationMs: number;
	replacements: number;
	pairs: Array<{ search: string; replace: string; regex: boolean }>;
	backupFile: string | null;
	logFile: string | null;
}

export const DEFAULT_OPTIONS: Omit<RunOptions, 'pairs'> = {
	dryRun: false,
	backup: true,
	allTables: true,
	precise: false,
	skipColumns: '',
	skipTables: '',
	includeVariants: true,
	protectEmails: true,
	regexFlags: '',
	flushCache: true,
	wpPath: '',
	caseSensitive: true,
	replaceGuid: false,
	reportChangedOnly: true,
	skipPlugins: true,
	skipThemes: true,
	skipPackages: true,
	fallback: true,
	workers: 0,
};

/** What is saved per site, so mappings and options survive a restart. */
export interface SavedConfig {
	pairs: ReplacePair[];
	options: Omit<RunOptions, 'pairs'>;
}

/** IPC channel names. `sr:` calls are renderer → main (ipcAsync). `sr:snapshot` and `sr:log` are main → renderer events. */
export const CH = {
	scan: 'sr:scan',
	/** Did the database change since the last scan? Answer: `{ changed, reason }`. */
	check: 'sr:check',
	validate: 'sr:validate',
	start: 'sr:start',
	cancel: 'sr:cancel',
	state: 'sr:state',
	history: 'sr:history',
	loadConfig: 'sr:load-config',
	saveConfig: 'sr:save-config',
	snapshot: 'sr:snapshot',
	log: 'sr:log',
	logFiles: 'sr:log-files',
	readLog: 'sr:read-log',
	openFolder: 'sr:open-folder',
} as const;

/** What the renderer gets when it opens: the running or last job and its recent log. */
export interface SiteJobView {
	snapshot: JobSnapshot | null;
	logs: LogLine[];
}

export interface LogFileInfo {
	name: string;
	bytes: number;
	mtime: number;
}

/** Shown in the UI and in the checks. There is no option to pick tables. */
export const ALL_TABLES_NOTICE =
	'Search and replace runs on all tables of the database, including plugin tables and tables without the WordPress prefix. You cannot choose single tables.';
