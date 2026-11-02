import type { DomainCandidate, ReplacePair } from '../common/types';
import { parseUrlish } from './urls';

export type Kind = NonNullable<ReplacePair['kind']>;

/**
 * Where a found domain belongs in the list:
 * - `main`: a domain the site is registered under (siteurl and home of every site, the network URL, the hosts in wp_site
 *   and wp_blogs). Ticked, so it is the first thing to look at;
 * - `close`: near a main domain (`api.example.com`, `example.net`), with a suggested replace. Not ticked;
 * - `other`: every other domain found in the database (CDNs, fonts, other companies). Not ticked, no suggestion.
 */
export const kindOf = (c: DomainCandidate): Kind =>
	c.primary ? 'main' : c.suggestedReplace !== '' ? 'close' : 'other';

const RANK: Record<Kind, number> = { main: 0, close: 1, other: 2 };

export const scanId = (value: string): string => `scan:${value}`;

/** `HTTPS://A.com/` and `https://a.com` are the same domain. */
export function normalizeValue(v: string): string {
	const p = parseUrlish(v);
	const base = p ? `${p.scheme ? `${p.scheme}://` : ''}${p.host}${p.port}${p.path}` : v.trim();
	return base.replace(/\/+$/, '');
}

/** A row made from a scan and not edited since. Editing its search text turns it into a custom row. */
const isScanRow = (p: ReplacePair): boolean => p.origin === 'scan' && p.id === scanId(p.search);

const swapScheme = (u: string): string =>
	u.replace(/^https?:/i, (m) => (m.toLowerCase() === 'http:' ? 'https:' : 'http:'));

export interface Reconciled {
	pairs: ReplacePair[];
	added: string[];
	removed: string[];
}

/**
 * Check the saved list against what the database has now:
 * 1. a saved scan row whose domain is still in the database stays, with the user's replace text, tick and order;
 * 2. a saved scan row whose domain left the database is removed;
 * 3. a domain that is new in the database is added to its group, with its suggestion;
 * 4. custom rows (typed by the user, regex rows, edited rows) are never touched.
 */
/**
 * Main domains first, then close ones, then the others. Rows the user typed come after the scanned rows.
 * The order inside a group is kept, so a list the user knows does not jump around.
 */
export function orderRows(pairs: ReplacePair[]): ReplacePair[] {
	const rank = (p: ReplacePair): number => (isScanRow(p) ? RANK[p.kind ?? 'other'] : 3);
	return pairs
		.map((p, i) => ({ p, i }))
		.sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i)
		.map((x) => x.p);
}

export function reconcilePairs(saved: ReplacePair[], candidates: DomainCandidate[]): Reconciled {
	const byKey = new Map(candidates.map((c) => [normalizeValue(c.value), c]));
	const removed: string[] = [];
	const pairs: ReplacePair[] = [];
	for (const p of saved) {
		if (!isScanRow(p)) {
			pairs.push(p);
			continue;
		}
		const c = byKey.get(normalizeValue(p.search));
		if (!c) {
			removed.push(p.search);
			continue;
		}
		const next = c.suggestedReplace;
		if (!next) {
			pairs.push({ ...p, kind: kindOf(c) });
			continue;
		}
		// A row that still holds the suggestion it was given (or an empty text) follows a better suggestion, for example
		// https after SSL was turned on. A rows with text the user typed is never changed. A row saved before this
		// field existed counts as untouched when it is the old suggestion with the other protocol.
		const untouched =
			p.replace === '' ||
			(p.suggested !== undefined ? p.replace === p.suggested : p.replace === swapScheme(next));
		pairs.push(
			untouched
				? { ...p, replace: next, suggested: next, kind: kindOf(c) }
				: { ...p, suggested: p.suggested ?? next, kind: kindOf(c) },
		);
	}
	const known = new Set(pairs.map((p) => normalizeValue(p.search)));
	const added: string[] = [];
	for (const c of candidates) {
		const key = normalizeValue(c.value);
		if (known.has(key)) continue;
		known.add(key);
		added.push(c.value);
		pairs.push({
			id: scanId(c.value),
			search: c.value,
			replace: c.suggestedReplace,
			regex: false,
			// The Local domain of this very site maps to itself: nothing to change, so it is not ticked.
			enabled: c.preselected && normalizeValue(c.suggestedReplace) !== normalizeValue(c.value),
			origin: 'scan',
			suggested: c.suggestedReplace,
			kind: kindOf(c),
		});
	}
	return { pairs: orderRows(pairs), added, removed };
}
