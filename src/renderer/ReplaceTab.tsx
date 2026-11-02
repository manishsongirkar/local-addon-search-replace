import React, { useEffect, useRef, useState } from 'react';
import {
	ALL_TABLES_NOTICE,
	CH,
	type ImportInfo,
	type Issue,
	type JobSnapshot,
	type ReplacePair,
	type RunOptions,
	type ScanResult,
} from '../common/types';
import Progress from './Progress';
import { box, call, errText, input, row } from './util';

export type Options = Omit<RunOptions, 'pairs'>;

interface Props {
	siteId: string;
	pairs: ReplacePair[];
	setPairs: (f: (p: ReplacePair[]) => ReplacePair[]) => void;
	options: Options;
	setOptions: (o: Options) => void;
	snapshot: JobSnapshot | null;
	onStarted: () => void;
	/** Called when a run was accepted, so the page can show its logs. */
	onShowLogs: () => void;
	/** The saved settings are loaded. Before that nothing may be scanned or saved. */
	loaded: boolean;
	/** Where the database came from, when it came from another domain. */
	importInfo: ImportInfo | null;
	setImportInfo: (i: ImportInfo | null) => void;
}

const BOOL_GROUPS: Array<[string, Array<[keyof Options, string]>]> = [
	[
		'Safety',
		[
			['backup', 'Back up the database first'],
			['precise', 'Precise mode (slower, safer for odd serialized data)'],
		],
	],
	[
		'Matching',
		[
			['includeVariants', 'Include http/https, //, escaped and encoded forms'],
			['protectEmails', 'Keep domains inside e-mail addresses'],
		],
	],
	[
		'WP-CLI',
		[
			['reportChangedOnly', 'Report changed tables only (--report-changed-only)'],
			['skipPlugins', 'Do not load plugins (--skip-plugins)'],
			['skipThemes', 'Do not load the theme (--skip-themes)'],
			['skipPackages', 'Do not load WP-CLI packages (--skip-packages)'],
			['flushCache', 'Flush the cache when done'],
			['fallback', 'Use the built-in fallback if WP-CLI cannot run'],
		],
	],
];
const TEXTS: Array<[keyof Options, string, string]> = [
	['skipColumns', 'Skip columns', 'Comma separated. The guid column is always skipped.'],
	['regexFlags', 'Regex flags', 'For regex pairs, for example i.'],
	['wpPath', 'WordPress path', 'Empty = detect.'],
];
const ICON = {
	error: ['✖', 'Error'],
	warning: ['⚠', 'Warning'],
	info: ['ℹ', 'Info'],
} as const;
let seq = 0;
const newId = (kind: string) => `${kind}-${Math.random().toString(36).slice(2, 10)}${++seq}`;

export default function ReplaceTab({
	siteId,
	pairs,
	setPairs,
	options,
	setOptions,
	snapshot,
	onStarted,
	onShowLogs,
	loaded,
	importInfo,
	setImportInfo,
}: Props) {
	const [scan, setScan] = useState<ScanResult | null>(null);
	const [scanning, setScanning] = useState(false);
	const [error, setError] = useState('');
	// A run that did not start. Shown under the Run buttons, where the click happened.
	const [runError, setRunError] = useState('');
	const [starting, setStarting] = useState(false);
	const [scannedAt, setScannedAt] = useState<number | null>(null);
	const [autoNote, setAutoNote] = useState('');
	const [issues, setIssues] = useState<Issue[]>([]);
	const [confirmed, setConfirmed] = useState(false);
	const active = !!snapshot && ['preparing', 'running', 'cancelling'].includes(snapshot.state);
	const runOpts = (dryRun: boolean): RunOptions => ({ ...options, pairs, dryRun });

	// Live validation. A real run is checked, so the strictest rules show.
	// biome-ignore lint/correctness/useExhaustiveDependencies: runOpts is rebuilt every render
	useEffect(() => {
		const t = setTimeout(() => {
			call<Issue[]>(CH.validate, siteId, runOpts(false))
				.then(setIssues)
				.catch(() => setIssues([]));
		}, 400);
		return () => clearTimeout(t);
	}, [siteId, pairs, options]);

	const needsConfirm = issues.some((i) => i.needsConfirm);
	const hasErrors = issues.some((i) => i.level === 'error');
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset when the set of issues changes
	useEffect(() => setConfirmed(false), [issues.map((i) => i.code + (i.pairId ?? '')).join()]);

	const doScan = async (note = '', startSite = false) => {
		setScanning(true);
		setError('');
		try {
			const res = await call<ScanResult>(
				CH.scan,
				siteId,
				options.wpPath,
				{ pairs, options },
				startSite,
			);
			setScan(res);
			setImportInfo(res.importInfo);
			setScannedAt(Date.now());
			setAutoNote(note);
			// Main already merged the scan into the saved list and saved it. Show that list.
			setPairs(() => res.pairs);
		} catch (e) {
			setScan(null);
			setError(errText(e));
		} finally {
			setScanning(false);
		}
	};

	// The database can change under this page: an import with WP-CLI, phpMyAdmin or the mysql command, a new site URL.
	// So the page asks main when it opens and when you come back to Local, and scans again when something changed.
	const busyNow = useRef(false);
	busyNow.current = scanning || active || starting;
	const lastCheck = useRef(0);
	const checkNow = useRef<() => Promise<void>>(async () => undefined);
	checkNow.current = async () => {
		if (busyNow.current) return;
		lastCheck.current = Date.now();
		try {
			const c = await call<{ changed: boolean; reason: string }>(CH.check, siteId, options.wpPath);
			if (c.changed) await doScan(c.reason);
		} catch {
			// The site may be stopped. The Scan site button shows the reason when you press it.
		}
	};
	// biome-ignore lint/correctness/useExhaustiveDependencies: siteId is a trigger, so a site switch checks again.
	useEffect(() => {
		if (!loaded) return;
		void checkNow.current();
		const onFocus = () => {
			if (Date.now() - lastCheck.current > 15000) void checkNow.current();
		};
		window.addEventListener('focus', onFocus);
		return () => window.removeEventListener('focus', onFocus);
	}, [loaded, siteId]);

	const start = async (dryRun: boolean) => {
		setRunError('');
		setStarting(true);
		try {
			onStarted();
			await call(CH.start, siteId, runOpts(dryRun));
			// The run is under way. Show its logs, live, for a dry run and a real run alike.
			onShowLogs();
		} catch (e) {
			setRunError(errText(e));
		} finally {
			setStarting(false);
		}
	};

	const patch = (id: string, change: Partial<ReplacePair>) =>
		setPairs((cur) => cur.map((p) => (p.id === id ? { ...p, ...change } : p)));
	const trim = (v: string) => v.replace(/\/+$/, '');
	const infoFor = (p: ReplacePair) =>
		p.origin === 'scan'
			? scan?.candidates.find((c) => trim(c.value) === trim(p.search))
			: undefined;
	const levelOrder = ['error', 'warning', 'info'];
	const sorted = [...issues].sort(
		(a, b) => levelOrder.indexOf(a.level) - levelOrder.indexOf(b.level),
	);
	const [filter, setFilter] = useState('');
	const q = filter.trim().toLowerCase();
	const matches = (p: ReplacePair) =>
		!q || p.search.toLowerCase().includes(q) || p.replace.toLowerCase().includes(q);
	type Group = 'main' | 'close' | 'other' | 'custom';
	const groupOf = (p: ReplacePair): Group => (p.origin === 'scan' ? (p.kind ?? 'other') : 'custom');
	const GROUPS: Array<[Group, string, string]> = [
		['main', 'Main domains', 'The domains this site is registered under. Ticked: start here.'],
		['close', 'Close domains', 'Near a main domain, with a suggested replace. Not ticked.'],
		[
			'other',
			'Other domains found in the database',
			'Not ticked. Tick one and type its replace text to change it too.',
		],
		['custom', 'Added by you', ''],
	];
	const renderRow = (p: ReplacePair) => (
		<fieldset key={p.id} className="sr-pair" aria-label={p.search || 'New pair'}>
			<input
				type="checkbox"
				aria-label="Replace this domain"
				checked={p.enabled}
				onChange={(e) => patch(p.id, { enabled: e.target.checked })}
			/>
			<input
				style={{ ...input, width: '100%' }}
				aria-label="Search"
				placeholder="Search"
				value={p.search}
				onChange={(e) => patch(p.id, { search: e.target.value })}
			/>
			<span className="sr-arrow sr-muted" aria-hidden="true">
				→
			</span>
			<input
				style={{ ...input, width: '100%' }}
				aria-label="Replace"
				placeholder="Replace"
				value={p.replace}
				onChange={(e) => patch(p.id, { replace: e.target.value })}
			/>
			<small className="sr-src sr-muted">{p.origin === 'scan' ? 'from scan' : 'custom'}</small>
			<label style={{ whiteSpace: 'nowrap' }}>
				<input
					type="checkbox"
					checked={p.regex}
					onChange={(e) => patch(p.id, { regex: e.target.checked })}
				/>{' '}
				Regex
			</label>
			<button
				type="button"
				className="sr-btn sr-btn-sm"
				aria-label={`Remove pair ${p.search}`.trim()}
				onClick={() => setPairs((cur) => cur.filter((x) => x.id !== p.id))}
			>
				Remove
			</button>
			{infoFor(p) && (
				<small className="sr-pair-note">
					Found {infoFor(p)?.count}× · {infoFor(p)?.sources.join(', ')}
				</small>
			)}
		</fieldset>
	);

	const blocked = active || scanning || hasErrors || pairs.every((p) => !p.enabled);

	return (
		<div>
			{importInfo && (
				<aside className="sr-banner" aria-label="Database import">
					<strong>{importInfo.replaced ? 'Last import' : 'Imported database'}</strong>
					<div>
						Imported from <code>{importInfo.from}</code>{' '}
						{importInfo.replaced ? 'and replaced with' : '→ Local domain'}{' '}
						<code>{importInfo.to}</code>
					</div>
					<small className="sr-muted">
						{importInfo.replaced
							? `Replaced on ${new Date(importInfo.replacedAt ?? importInfo.at).toLocaleString()}.`
							: `Seen on ${new Date(importInfo.at).toLocaleString()}. Tick the pair below and run to replace it.`}
					</small>
				</aside>
			)}
			<p role="note" className="sr-muted" style={{ margin: '0 0 16px' }}>
				<strong>All tables:</strong> {ALL_TABLES_NOTICE}
			</p>
			<section className="sr-card" aria-label="Scan">
				<div style={row}>
					<button
						type="button"
						className="sr-btn"
						onClick={() => {
							if (!scanning && !active) void doScan('', true);
						}}
						aria-disabled={scanning || active}
					>
						{scanning ? 'Scanning…' : 'Scan site'}
					</button>
					{scan && (
						<span className="sr-muted">
							Local URL: {scan.localUrl} ·{' '}
							{scan.context.multisite
								? scan.context.subdomain
									? 'multisite (sub-domains)'
									: 'multisite (sub-directories)'
								: 'single site'}
						</span>
					)}
				</div>
				<output className="sr-muted" style={{ display: 'block', marginTop: scanning ? 8 : 0 }}>
					{scanning
						? 'Scanning. If the site is stopped, Local starts it first. This can take a minute.'
						: ''}
				</output>
				{scan?.context.fallback && (
					<output style={{ display: 'block' }}>
						WP-CLI could not run; using built-in fallback.
					</output>
				)}
				{scannedAt && (
					<p style={{ margin: '8px 0 0' }}>
						<small className="sr-muted">
							Last scan {new Date(scannedAt).toLocaleTimeString()}.{' '}
							{autoNote
								? `Scanned again automatically: ${autoNote}`
								: 'The page checks the database when you open it and when you return to Local, and scans again if it changed.'}
						</small>
					</p>
				)}
				{error && <p role="alert">{error}</p>}
				{scan && (scan.added.length > 0 || scan.removed.length > 0) && (
					<details>
						<summary>
							Added {scan.added.length} new domain(s), removed {scan.removed.length} that are no
							longer in the database
						</summary>
						{scan.added.length > 0 && <p>Added: {scan.added.join(', ')}</p>}
						{scan.removed.length > 0 && <p>Removed: {scan.removed.join(', ')}</p>}
					</details>
				)}
				{scan && scan.added.length === 0 && scan.removed.length === 0 && (
					<output style={{ display: 'block', margin: '8px 0 0' }}>
						Scan finished. The saved list already matches the database.
					</output>
				)}
			</section>

			<section className="sr-card" aria-label="Search and replace pairs">
				<strong>Pairs</strong> <small className="sr-muted">(saved for this site)</small>
				{pairs.length === 0 && <p>No pairs yet. Scan the site or add a domain.</p>}
				{pairs.length > 8 && (
					<p style={{ margin: '12px 0 0' }}>
						<input
							type="search"
							style={{ ...input, width: '100%', maxWidth: 360 }}
							aria-label="Filter domains"
							placeholder="Filter domains"
							value={filter}
							onChange={(e) => setFilter(e.target.value)}
						/>
					</p>
				)}
				{q && (
					<output className="sr-only">
						{pairs.filter(matches).length} of {pairs.length} domains shown
					</output>
				)}
				{GROUPS.map(([group, title, hint]) => {
					const rows = pairs.filter((p) => groupOf(p) === group);
					const shown = rows.filter(matches);
					if (rows.length === 0) return null;
					return (
						<div key={group} style={{ marginTop: 20 }}>
							<h3 style={{ display: 'inline', fontSize: 'inherit', margin: 0 }}>{title}</h3>{' '}
							<span className="sr-badge">
								{q ? `${shown.length} of ${rows.length}` : rows.length}
							</span>
							{hint && (
								<div>
									<small className="sr-muted">{hint}</small>
								</div>
							)}
							<div
								style={
									group === 'other'
										? { maxHeight: 360, overflow: 'auto', marginTop: 4, paddingRight: 4 }
										: undefined
								}
							>
								{shown.map(renderRow)}
							</div>
						</div>
					);
				})}
				<p style={{ margin: '16px 0 0' }}>
					<button
						type="button"
						className="sr-btn"
						onClick={() =>
							setPairs((cur) => [
								...cur,
								{
									id: newId('custom'),
									origin: 'custom',
									search: '',
									replace: '',
									regex: false,
									enabled: true,
								},
							])
						}
					>
						Add domain
					</button>
				</p>
			</section>

			<details className="sr-card">
				<summary style={{ cursor: 'pointer', fontWeight: 600 }}>Options</summary>
				<p className="sr-muted" style={{ margin: '8px 0 0' }}>
					<small>
						Always on: exact upper and lower case matching. The guid column is never changed.
					</small>
				</p>
				{BOOL_GROUPS.map(([title, items]) => (
					<fieldset key={title} className="sr-group">
						<legend>{title}</legend>
						<div className="sr-opts">
							{items.map(([k, label]) => (
								<label key={k} className="sr-check">
									<input
										type="checkbox"
										checked={options[k] as boolean}
										onChange={(e) => setOptions({ ...options, [k]: e.target.checked })}
									/>
									<span>{label}</span>
								</label>
							))}
						</div>
					</fieldset>
				))}
				<fieldset className="sr-group">
					<legend>Advanced</legend>
					<div className="sr-fields">
						{TEXTS.map(([k, label, hint]) => (
							<label key={k} className="sr-field">
								<span>{label}</span>
								<input
									style={{ ...input, width: '100%' }}
									value={options[k] as string}
									onChange={(e) => setOptions({ ...options, [k]: e.target.value })}
								/>
								<small className="sr-muted">{hint}</small>
							</label>
						))}
						<label className="sr-field">
							<span>Parallel processes</span>
							<input
								type="number"
								min={0}
								style={{ ...input, width: '100%' }}
								value={options.workers}
								onChange={(e) =>
									setOptions({
										...options,
										workers: Math.max(0, Number.parseInt(e.target.value, 10) || 0),
									})
								}
							/>
							<small className="sr-muted">0 = auto.</small>
						</label>
					</div>
				</fieldset>
			</details>

			{sorted.length > 0 && (
				<ul style={{ listStyle: 'none', margin: '0 0 16px', padding: 0 }} aria-label="Checks">
					{sorted.map((i, n) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: issues have no id
						<li key={n} className={`sr-note sr-note-${i.level}`}>
							<strong>
								<span aria-hidden="true">{ICON[i.level][0]} </span>
								{ICON[i.level][1]}:
							</strong>{' '}
							{i.message}
						</li>
					))}
				</ul>
			)}
			<section className="sr-card sr-actions" aria-label="Run">
				{needsConfirm && (
					<label className="sr-check" style={{ flex: '1 1 100%' }}>
						<input
							type="checkbox"
							checked={confirmed}
							onChange={(e) => setConfirmed(e.target.checked)}
						/>
						<span>I understand the warnings above and want to run anyway.</span>
					</label>
				)}
				<button
					type="button"
					className="sr-btn"
					onClick={() => start(true)}
					disabled={blocked || starting}
				>
					Dry run
				</button>
				<button
					type="button"
					className="sr-btn sr-btn-primary"
					onClick={() => start(false)}
					disabled={blocked || starting || (needsConfirm && !confirmed)}
				>
					Run
				</button>
				{active && (
					<button
						type="button"
						className="sr-btn"
						onClick={() => call(CH.cancel, siteId).catch((e) => setError(errText(e)))}
						disabled={snapshot?.state === 'cancelling'}
					>
						Cancel
					</button>
				)}
				<span className="sr-muted" style={{ marginLeft: 'auto' }}>
					<small>A dry run changes nothing. It shows what a run would do.</small>
				</span>
			</section>
			{starting && <output style={{ display: 'block', marginBottom: 8 }}>Starting…</output>}
			{runError && (
				<p role="alert" style={{ color: 'var(--sr-error, #c62828)', fontWeight: 600 }}>
					{runError}
				</p>
			)}
			{snapshot && <Progress snap={snapshot} />}
		</div>
	);
}
