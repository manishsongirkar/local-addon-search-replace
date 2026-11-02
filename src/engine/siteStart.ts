/** The part of Local's site process manager that is used here. Older or newer Locals may not have all of it. */
export interface SiteStarter<S> {
	getSiteStatus?: (site: S) => string;
	start?: (site: S) => Promise<void>;
}
export interface DbWaiter<S> {
	waitForDB?: (site: S) => Promise<boolean>;
}

/**
 * Start the site when Local says it is stopped, so a scan can read its database.
 * This never throws and never blocks the old path: when Local has no such API, the site is not stopped, or the start
 * fails, it returns `false` and the caller goes on as before (and shows the usual "database not reachable" advice).
 */
export async function startIfHalted<S>(
	spm: SiteStarter<S> | undefined,
	db: DbWaiter<S> | undefined,
	site: S,
	log: (level: 'info' | 'warn', text: string) => void,
): Promise<boolean> {
	try {
		if (typeof spm?.getSiteStatus !== 'function' || typeof spm.start !== 'function') return false;
		if (spm.getSiteStatus(site) !== 'halted') return false;
		log('info', 'The site is stopped. Starting it in Local before the scan.');
		await spm.start(site);
		if (typeof db?.waitForDB === 'function') await db.waitForDB(site);
		log('info', 'The site is running.');
		return true;
	} catch (e) {
		log('warn', `Could not start the site: ${(e as Error).message}. Scanning without it.`);
		return false;
	}
}
