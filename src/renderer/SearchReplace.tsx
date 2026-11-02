import type * as LocalRenderer from '@getflywheel/local/renderer';
import React, { useEffect, useRef, useState } from 'react';
import {
	CH,
	DEFAULT_OPTIONS,
	type ImportInfo,
	type JobSnapshot,
	type LogLine,
	type ReplacePair,
	type SavedConfig,
	type SiteJobView,
} from '../common/types';
import HistoryTab from './HistoryTab';
import LogsTab from './LogsTab';
import ReplaceTab, { type Options } from './ReplaceTab';
import { baseCss, cssVars, detectDark, paletteFor } from './theme';
import { call } from './util';

const MAX_LIVE_LINES = 5000;
const TABS = ['Replace', 'Logs', 'History'] as const;
type Tab = (typeof TABS)[number];

interface Props {
	site: { id: string };
	context: LocalRenderer.AddonRendererContext;
}

/** Mounted with `key={site.id}`, so every piece of state below belongs to exactly one site. */
export default function SearchReplace({ site, context }: Props) {
	const siteId = site.id;
	const [tab, setTab] = useState<Tab>('Replace');
	const [pairs, setPairs] = useState<ReplacePair[]>([]);
	const [options, setOptions] = useState<Options>(DEFAULT_OPTIONS);
	const [importInfo, setImportInfo] = useState<ImportInfo | null>(null);
	const [loaded, setLoaded] = useState(false);
	const [loadError, setLoadError] = useState('');
	const [snapshot, setSnapshot] = useState<JobSnapshot | null>(null);
	const [logs, setLogs] = useState<LogLine[]>([]);
	const pending = useRef<LogLine[]>([]);

	// Follow Local's theme. It is read from the page, again whenever the page changes its theme or the system does.
	const root = useRef<HTMLDivElement>(null);
	const [dark, setDark] = useState(true);
	useEffect(() => {
		const read = () => {
			const el = root.current;
			if (!el) return;
			const backgrounds: string[] = [];
			for (let n: Element | null = el; n; n = n.parentElement)
				backgrounds.push(getComputedStyle(n).backgroundColor);
			setDark(
				detectDark({
					backgrounds,
					text: getComputedStyle(el).color,
					prefersDark: window.matchMedia?.('(prefers-color-scheme: dark)').matches,
				}),
			);
		};
		read();
		const watch = new MutationObserver(read);
		for (const target of [document.documentElement, document.body]) {
			watch.observe(target, {
				attributes: true,
				attributeFilter: ['class', 'style', 'data-theme'],
			});
		}
		const media = window.matchMedia?.('(prefers-color-scheme: dark)');
		media?.addEventListener?.('change', read);
		window.addEventListener('focus', read);
		return () => {
			watch.disconnect();
			media?.removeEventListener?.('change', read);
			window.removeEventListener('focus', read);
		};
	}, []);
	const palette = paletteFor(dark);

	// Saved mappings and the running or last job.
	useEffect(() => {
		let gone = false;
		call<SavedConfig & { importInfo: ImportInfo | null }>(CH.loadConfig, siteId)
			.then((c) => {
				if (gone) return;
				setPairs(c.pairs);
				setOptions(c.options);
				setImportInfo(c.importInfo);
				// Only now is it safe to save: an empty form must never replace a config that could not be read.
				setLoaded(true);
			})
			.catch((e) => {
				if (!gone) setLoadError(e instanceof Error ? e.message : String(e));
			});
		call<SiteJobView>(CH.state, siteId)
			.then((v) => {
				if (gone) return;
				// Events that arrived before this answer are newer. Keep them.
				setSnapshot((cur) => cur ?? v.snapshot);
				setLogs((cur) => {
					const seen = new Set(cur.map((l) => `${l.t}|${l.level}|${l.text}`));
					return [...v.logs.filter((l) => !seen.has(`${l.t}|${l.level}|${l.text}`)), ...cur].slice(
						-MAX_LIVE_LINES,
					);
				});
			})
			.catch(() => undefined);
		return () => {
			gone = true;
		};
	}, [siteId]);

	// A finished real run may have replaced the imported domain. Main records it, so read the note again.
	const runState = snapshot?.state;
	useEffect(() => {
		if (runState !== 'completed') return;
		call<{ importInfo: ImportInfo | null }>(CH.loadConfig, siteId)
			.then((c) => setImportInfo(c.importInfo))
			.catch(() => undefined);
	}, [runState, siteId]);

	// Save after every change, but never before the first load, or an empty form would erase the saved pairs.
	const latest = useRef({ pairs, options });
	const unsaved = useRef(false);
	useEffect(() => {
		if (!loaded) return;
		latest.current = { pairs, options };
		unsaved.current = true;
		const t = setTimeout(() => {
			unsaved.current = false;
			void call(CH.saveConfig, siteId, { pairs, options }).catch(() => {
				unsaved.current = true;
			});
		}, 600);
		return () => clearTimeout(t);
	}, [loaded, siteId, pairs, options]);
	// Leaving the page (or another site) inside the 600 ms must not lose the last edit.
	useEffect(
		() => () => {
			if (unsaved.current) void call(CH.saveConfig, siteId, latest.current).catch(() => undefined);
		},
		[siteId],
	);

	// Live events. Local sends them to every window, so drop any event of another site.
	useEffect(() => {
		const ipc = context.electron.ipcRenderer;
		const onSnap = (_e: unknown, s: JobSnapshot) => s.siteId === siteId && setSnapshot(s);
		const onLog = (_e: unknown, id: string, line: LogLine) =>
			id === siteId && pending.current.push(line);
		ipc.on(CH.snapshot, onSnap);
		ipc.on(CH.log, onLog);
		// Batch log lines: a big run prints thousands of lines.
		const timer = setInterval(() => {
			if (!pending.current.length) return;
			const batch = pending.current;
			pending.current = [];
			setLogs((cur) => [...cur, ...batch].slice(-MAX_LIVE_LINES));
		}, 250);
		return () => {
			ipc.removeListener(CH.snapshot, onSnap);
			ipc.removeListener(CH.log, onLog);
			clearInterval(timer);
		};
	}, [siteId, context]);

	return (
		<div
			ref={root}
			className="sr-root"
			style={{ padding: 24, overflow: 'auto', ...(cssVars(palette) as React.CSSProperties) }}
		>
			<style>{baseCss(palette)}</style>
			{loadError && (
				<p role="alert">
					Could not load the saved settings: {loadError}. Nothing is saved from this page until they
					load. Close the page and open it again.
				</p>
			)}
			<div
				role="tablist"
				aria-label="Search and replace"
				onKeyDown={(e) => {
					const k = e.key;
					if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(k)) return;
					e.preventDefault();
					const at = TABS.indexOf(tab);
					const next =
						k === 'Home'
							? 0
							: k === 'End'
								? TABS.length - 1
								: (at + (k === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
					setTab(TABS[next]);
					document.getElementById(`sr-tab-${TABS[next]}`)?.focus();
				}}
				style={{
					display: 'flex',
					gap: 4,
					marginBottom: 20,
					borderBottom: '1px solid var(--sr-border)',
				}}
			>
				{TABS.map((t) => (
					<button
						key={t}
						id={`sr-tab-${t}`}
						type="button"
						role="tab"
						className="sr-tab"
						aria-selected={tab === t}
						aria-controls={`sr-panel-${t}`}
						tabIndex={tab === t ? 0 : -1}
						onClick={() => setTab(t)}
					>
						{t}
					</button>
				))}
			</div>
			{/* Keep the Replace tab mounted so a typed form and a running scan survive a tab switch. */}
			<div
				id="sr-panel-Replace"
				role="tabpanel"
				aria-labelledby="sr-tab-Replace"
				hidden={tab !== 'Replace'}
			>
				<ReplaceTab
					siteId={siteId}
					pairs={pairs}
					setPairs={setPairs}
					options={options}
					setOptions={setOptions}
					snapshot={snapshot}
					loaded={loaded}
					importInfo={importInfo}
					setImportInfo={setImportInfo}
					onShowLogs={() => setTab('Logs')}
					onStarted={() => {
						setSnapshot(null);
						pending.current = [];
						setLogs([]);
					}}
				/>
			</div>
			{tab === 'Logs' && (
				<div id="sr-panel-Logs" role="tabpanel" aria-labelledby="sr-tab-Logs">
					<LogsTab siteId={siteId} live={logs} snapshot={snapshot} />
				</div>
			)}
			{tab === 'History' && (
				<div id="sr-panel-History" role="tabpanel" aria-labelledby="sr-tab-History">
					<HistoryTab siteId={siteId} refreshKey={snapshot?.state ?? ''} />
				</div>
			)}
		</div>
	);
}
