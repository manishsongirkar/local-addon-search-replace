import React, { useEffect, useState } from 'react';
import { CH, type HistoryEntry } from '../common/types';
import { box, call, errText, fmtDuration } from './util';

const base = (p: string | null) => (p ? p.split(/[\\/]/).pop() : '-');

/** `refreshKey` changes when a run ends, so a finished run shows up without a click. */
export default function HistoryTab({ siteId, refreshKey }: { siteId: string; refreshKey: string }) {
	const [items, setItems] = useState<HistoryEntry[]>([]);
	const [error, setError] = useState('');
	const load = () =>
		call<HistoryEntry[]>(CH.history, siteId)
			.then((h) => {
				setItems(h);
				setError('');
			})
			.catch((e) => setError(errText(e)));
	// biome-ignore lint/correctness/useExhaustiveDependencies: reload only when the site or the run state changes
	useEffect(() => void load(), [siteId, refreshKey]);

	return (
		<div>
			<button type="button" className="sr-btn" onClick={load}>
				Refresh
			</button>
			{error && <p role="alert">{error}</p>}
			{items.length === 0 && !error && <p>No runs yet.</p>}
			{items.map((h) => (
				<div key={h.id} style={box}>
					<strong>{new Date(h.at).toLocaleString()}</strong> · {h.dryRun ? 'Dry run' : 'Run'} ·{' '}
					{h.state} · {fmtDuration(h.durationMs)} · {h.replacements} replacement(s)
					<ul style={{ margin: '6px 0' }}>
						{h.pairs.map((p) => (
							<li key={`${p.search}\u0000${p.replace}`}>
								{p.search} → {p.replace}
								{p.regex ? ' (regex)' : ''}
							</li>
						))}
					</ul>
					<small>
						Backup: {base(h.backupFile)} · Log: {base(h.logFile)}
					</small>
				</div>
			))}
		</div>
	);
}
