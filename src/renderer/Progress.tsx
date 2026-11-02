import React, { useEffect, useState } from 'react';
import type { JobSnapshot, StepState } from '../common/types';
import { box, fmtDuration, row } from './util';

const STEP: Record<StepState, [string, string]> = {
	pending: ['○', 'pending'],
	running: ['▶', 'running'],
	done: ['✔', 'done'],
	failed: ['✖', 'failed'],
	cancelled: ['■', 'cancelled'],
};

export default function Progress({ snap }: { snap: JobSnapshot }) {
	const live = ['preparing', 'running', 'cancelling'].includes(snap.state);
	const [now, setNow] = useState(Date.now());
	useEffect(() => {
		if (!live) return;
		const t = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(t);
	}, [live]);

	const pct = Math.round(snap.progress * 100);
	const elapsed = snap.startedAt ? (snap.finishedAt ?? now) - snap.startedAt : 0;
	const remaining =
		snap.estimatedTotalMs === null ? null : Math.max(0, snap.estimatedTotalMs - elapsed);
	const tables = snap.activeTables.join(', ');

	return (
		<section style={box} aria-label="Progress">
			<output className="sr-only">
				{snap.dryRun ? 'Dry run' : 'Run'} {snap.state}
			</output>
			<div style={row}>
				<strong>
					{snap.dryRun ? 'Dry run' : 'Run'}: {snap.state}
				</strong>
				<span>{snap.currentLabel}</span>
			</div>
			<progress
				max={100}
				value={pct}
				aria-label="Search and replace progress"
				style={{ width: '100%', height: 14, margin: '8px 0' }}
			>
				{pct}%
			</progress>
			<div style={row}>
				<span>{pct}%</span>
				<span>
					Tables {snap.tablesDone} of {snap.tablesTotal}
				</span>
				<span>Elapsed {fmtDuration(elapsed)}</span>
				{live && (
					<span>Remaining {remaining === null ? 'calculating' : fmtDuration(remaining)}</span>
				)}
				{snap.workers > 1 && <span>{snap.workers} processes</span>}
			</div>
			{tables && live && (
				<div
					title={tables}
					style={{
						overflow: 'hidden',
						textOverflow: 'ellipsis',
						whiteSpace: 'nowrap',
						marginTop: 4,
					}}
				>
					Checking: {tables}
				</div>
			)}
			{snap.error && (
				<p role="alert" style={{ whiteSpace: 'pre-wrap' }}>
					{snap.error}
				</p>
			)}
			{!live && snap.state !== 'idle' && (
				<p>
					{snap.totalReplacements} replacement(s) {snap.dryRun ? 'would be made' : 'made'}.
					{snap.backupFile && (
						<>
							<br />
							Backup: {snap.backupFile}
						</>
					)}
					{snap.logFile && (
						<>
							<br />
							Log: {snap.logFile}
						</>
					)}
				</p>
			)}
			<details>
				<summary>Steps ({snap.steps.length})</summary>
				<ol style={{ maxHeight: 220, overflow: 'auto' }}>
					{snap.steps.map((s) => (
						<li key={s.index}>
							<span aria-hidden="true">{STEP[s.state][0]} </span>
							{STEP[s.state][1]} · {s.scope}: {s.label} ({s.tables} table(s)
							{s.state === 'done' ? `, ${s.replacements} replacement(s)` : ''})
						</li>
					))}
				</ol>
			</details>
		</section>
	);
}
