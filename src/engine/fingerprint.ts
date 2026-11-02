import { fallbackJson } from './fallback';
import type { WpRuntime } from './wpRunner';

/** A summary of the database. See `fingerprint` in php/fallback.php. */
export interface Fingerprint {
	/** Every table with its creation time. Changes when tables are dropped and created again, as an import does. */
	tables: string;
	/** siteurl and home of every site, and the hosts of wp_site and wp_blogs. */
	urls: string;
	count: number;
}

export interface Change {
	changed: boolean;
	/** Why, in words for the log and for the page. Empty when nothing changed. */
	reason: string;
}

/** Read the fingerprint with mysqli. `null` when the database cannot be reached. */
export async function readFingerprint(rt: WpRuntime): Promise<Fingerprint | null> {
	if (!rt.db) return null;
	const res = await fallbackJson<Fingerprint>(rt, { mode: 'fingerprint' });
	return res.data;
}

/**
 * Did the database change since the last scan?
 * An import by any tool (WP-CLI, phpMyAdmin, the mysql command) recreates the tables. A new site URL changes the URLs.
 * Content that changes without either is not seen: use "Scan site" for that.
 */
export function compareFingerprints(
	previous: Fingerprint | null,
	next: Fingerprint | null,
): Change {
	if (!next) return { changed: false, reason: '' };
	if (!previous) return { changed: true, reason: 'This site was not scanned in this session.' };
	const tables = previous.tables !== next.tables;
	const urls = previous.urls !== next.urls;
	if (tables && urls)
		return {
			changed: true,
			reason: 'The database was replaced: its tables were created again and its site URL changed.',
		};
	if (tables) {
		return {
			changed: true,
			reason:
				previous.count !== next.count
					? `The tables of the database changed (${previous.count} before, ${next.count} now), for example after an import.`
					: 'The tables of the database were created again, for example after an import.',
		};
	}
	if (urls) return { changed: true, reason: 'The site URL or the domains of the network changed.' };
	return { changed: false, reason: '' };
}
