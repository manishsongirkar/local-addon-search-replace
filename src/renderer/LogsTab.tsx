import React, { useEffect, useRef, useState } from 'react';
import {
	CH,
	type JobSnapshot,
	type LogFileInfo,
	type LogLevel,
	type LogLine,
} from '../common/types';
import Progress from './Progress';
import { LEVELS, LEVEL_STYLE, call, errText, input, parseLogFile, row } from './util';

const MAX_RENDER = 2000;

export default function LogsTab({
	siteId,
	live,
	snapshot,
}: {
	siteId: string;
	live: LogLine[];
	snapshot: JobSnapshot | null;
}) {
	const [levels, setLevels] = useState<Set<LogLevel>>(new Set(LEVELS));
	const [query, setQuery] = useState('');
	const [auto, setAuto] = useState(true);
	const [cleared, setCleared] = useState(0); // Hides the first N live lines. The file keeps everything.
	const [files, setFiles] = useState<LogFileInfo[]>([]);
	const [saved, setSaved] = useState<{ name: string; lines: LogLine[] } | null>(null);
	const [error, setError] = useState('');
	const box = useRef<HTMLDivElement>(null);
	// A short message that goes away by itself. It sits in a live region, so a screen reader says it too.
	const [toast, setToast] = useState('');
	const toastTimer = useRef<ReturnType<typeof setTimeout>>();
	const notify = (text: string) => {
		clearTimeout(toastTimer.current);
		setToast(text);
		toastTimer.current = setTimeout(() => setToast(''), 2500);
	};
	useEffect(() => () => clearTimeout(toastTimer.current), []);

	const loadFiles = () =>
		call<LogFileInfo[]>(CH.logFiles, siteId)
			.then(setFiles)
			.catch((e) => setError(errText(e)));
	// biome-ignore lint/correctness/useExhaustiveDependencies: list once per site
	useEffect(() => void loadFiles(), [siteId]);

	// A new run empties the live list. An old "clear" position must not hide the first lines of the new one.
	useEffect(() => {
		if (cleared > live.length) setCleared(0);
	}, [live.length, cleared]);

	const source = saved ? saved.lines : live.slice(cleared);
	const q = query.toLowerCase();
	const shown = source
		.filter((l) => levels.has(l.level) && (!q || l.text.toLowerCase().includes(q)))
		.slice(-MAX_RENDER);
	const fmt = (l: LogLine) =>
		`${l.t ? new Date(l.t).toISOString() : ''} [${LEVEL_STYLE[l.level].label}] ${l.text}`;

	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll when a line is added
	useEffect(() => {
		if (auto && box.current) box.current.scrollTop = box.current.scrollHeight;
	}, [auto, shown.length]);

	const open = (name: string) => {
		if (!name) return setSaved(null);
		call<string>(CH.readLog, siteId, name)
			.then((text) => setSaved({ name, lines: parseLogFile(text) }))
			.catch((e) => setError(errText(e)));
	};
	const toggle = (lv: LogLevel) =>
		setLevels((prev) => {
			const next = new Set(prev);
			next.has(lv) ? next.delete(lv) : next.add(lv);
			return next;
		});

	return (
		<div>
			{snapshot && !saved && <Progress snap={snapshot} />}
			<fieldset
				aria-label="Log filters"
				style={{ ...row, marginBottom: 8, border: 0, padding: 0, marginInline: 0 }}
			>
				{LEVELS.map((lv) => (
					<label key={lv}>
						<input type="checkbox" checked={levels.has(lv)} onChange={() => toggle(lv)} />{' '}
						{LEVEL_STYLE[lv].label}
					</label>
				))}
				<input
					type="search"
					placeholder="Search"
					aria-label="Search the log"
					style={input}
					value={query}
					onChange={(e) => setQuery(e.target.value)}
				/>
				<label>
					<input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />{' '}
					Auto-scroll
				</label>
			</fieldset>
			<div style={{ ...row, marginBottom: 8 }}>
				<button
					type="button"
					className="sr-btn"
					onClick={() => {
						const text = shown.map(fmt).join('\n');
						const n = shown.length;
						(navigator.clipboard?.writeText(text) ?? Promise.reject())
							.then(() => notify(`Copied ${n} log line${n === 1 ? '' : 's'}.`))
							.catch(() => notify('Could not copy to the clipboard.'));
					}}
				>
					Copy visible
				</button>
				<button
					type="button"
					className="sr-btn"
					onClick={() => {
						setCleared(live.length);
						notify('Log view cleared. The saved log file keeps every line.');
					}}
					disabled={!!saved}
				>
					Clear view
				</button>
				<button
					type="button"
					className="sr-btn"
					onClick={() => call(CH.openFolder, siteId).catch((e) => setError(errText(e)))}
				>
					Open log folder
				</button>
				<label>
					Saved logs{' '}
					<select
						style={input}
						value={saved?.name ?? ''}
						onChange={(e) => open(e.target.value)}
						onFocus={loadFiles}
					>
						<option value="">Live</option>
						{files.map((f) => (
							<option key={f.name} value={f.name}>
								{f.name} ({Math.max(1, Math.round(f.bytes / 1024))} KB)
							</option>
						))}
					</select>
				</label>
				{saved && (
					<>
						<strong>Saved file: {saved.name}</strong>
						<button type="button" className="sr-btn" onClick={() => setSaved(null)}>
							Back to live
						</button>
					</>
				)}
			</div>
			{error && <p role="alert">{error}</p>}
			<div
				ref={box}
				role="log"
				aria-live="off"
				// biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling log must be reachable by keyboard
				tabIndex={0}
				aria-label="Log lines"
				style={{
					fontFamily: 'monospace',
					fontSize: 12,
					height: 380,
					overflow: 'auto',
					whiteSpace: 'pre-wrap',
					border: '1px solid var(--sr-border, rgba(127,127,127,.35))',
					background: 'var(--sr-code, transparent)',
					padding: 8,
				}}
			>
				{shown.length === 0 && <em>No log lines.</em>}
				{shown.map((l, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: lines have no id and only append
					<div key={i}>
						<span style={{ color: LEVEL_STYLE[l.level].color, fontWeight: 600 }}>
							[{LEVEL_STYLE[l.level].label}]
						</span>{' '}
						{l.text}
					</div>
				))}
			</div>
			<output className="sr-toast">{toast}</output>
		</div>
	);
}
