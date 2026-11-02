import type { DomainCandidate, ImportInfo, ReplacePair } from '../common/types';
import { normalizeValue } from './reconcile';

/**
 * What a scan says about an import. A database that came from another domain still holds that domain as its main one,
 * and the Local domain is the suggested replace. When both are the same there is nothing to tell.
 * - a main domain that differs from its suggestion: an import is waiting. The first time it is seen it is recorded;
 * - no such domain, and the tables were created again: a new import from the same domain. The old note is stale;
 * - no such domain otherwise: keep the note, so it still says what was replaced after the run.
 */
export function nextImportInfo(
	prev: ImportInfo | null,
	candidates: DomainCandidate[],
	tablesChanged: boolean,
	now = Date.now(),
): ImportInfo | null {
	const src = candidates.find(
		(c) =>
			c.primary &&
			c.suggestedReplace !== '' &&
			normalizeValue(c.suggestedReplace) !== normalizeValue(c.value),
	);
	if (!src) return tablesChanged ? null : prev;
	const from = normalizeValue(src.value);
	if (prev && normalizeValue(prev.from) === from && !tablesChanged) return prev;
	return { from: src.value, to: src.suggestedReplace, at: now, replaced: false };
}

/** After a finished real run: did it replace the imported domain? */
export function markReplaced(
	info: ImportInfo | null,
	pairs: ReplacePair[],
	now = Date.now(),
): ImportInfo | null {
	if (!info || info.replaced) return info;
	const hit = pairs.find(
		(p) => p.enabled && !p.regex && normalizeValue(p.search) === normalizeValue(info.from),
	);
	return hit?.replace ? { ...info, to: hit.replace, replaced: true, replacedAt: now } : info;
}
