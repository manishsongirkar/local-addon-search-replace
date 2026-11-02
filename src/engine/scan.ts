import path from 'node:path';
import type { BlogInfo, DomainCandidate, SiteContext, TableInfo } from '../common/types';
import {
	hostOf,
	isNoiseHost,
	parseUrlish,
	sortCandidates,
	stripWww,
	suggestReplacement,
} from './urls';
import { type WpRuntime, classifyError, extractJson, runWp } from './wpRunner';

import { fallbackJson } from './fallback';
import { PHP_DIR } from './phpDir';

export class EngineError extends Error {
	constructor(
		public code: string,
		message: string,
	) {
		super(message);
	}
}

interface RawContext {
	wpVersion: string;
	prefix: string;
	multisite: boolean;
	subdomain: boolean;
	blogs: BlogInfo[];
	tables: TableInfo[];
}

/**
 * When the imported database has another domain than wp-config, a multisite refuses to load.
 * Read the network domain straight from the database so WP-CLI can get `--url`.
 */
async function guessNetworkUrl(rt: WpRuntime): Promise<string | undefined> {
	const t = await runWp(rt, ['db', 'query', 'SHOW TABLES', '--skip-column-names'], { noUrl: true });
	if (t.code !== 0) return undefined;
	const names = t.stdout.split(/\r?\n/).map((s) => s.trim());
	const siteTable = names.find(
		(n) => /^.+_?site$/.test(n) && names.includes(`${n.slice(0, -4)}blogs`),
	);
	if (!siteTable) return undefined;
	const q = await runWp(
		rt,
		[
			'db',
			'query',
			`SELECT CONCAT(domain, path) FROM \`${siteTable.replace(/`/g, '``')}\` ORDER BY id LIMIT 1`,
			'--skip-column-names',
		],
		{ noUrl: true },
	);
	return q.code === 0 ? q.stdout.trim().split(/\r?\n/)[0] || undefined : undefined;
}

export async function loadContext(rt: WpRuntime): Promise<SiteContext> {
	const script = path.join(PHP_DIR, 'context.php');
	let run = await runWp(rt, ['eval-file', script]);
	let urlArg: string | undefined;
	if (run.code !== 0 && classifyError(run.stderr).code === 'SITE_URL') {
		urlArg = await guessNetworkUrl(rt);
		if (urlArg) run = await runWp({ ...rt, urlArg }, ['eval-file', script]);
	}
	if (run.code !== 0 && rt.db) {
		// WP-CLI could not run (broken phar, plugin fatal, bad wp-config ...). Read the database directly.
		const fb = await fallbackJson<RawContext>(rt, { mode: 'context' });
		if (fb.data) return { wpPath: rt.wpPath, urlArg, fallback: true, ...fb.data };
	}
	if (run.code !== 0) {
		const e = classifyError(run.stderr);
		throw new EngineError(e.code, e.message);
	}
	const raw = extractJson<RawContext>(run.stdout);
	if (!raw) throw new EngineError('UNKNOWN', 'Could not read the site layout from WP-CLI.');
	if (!raw.tables.some((t) => t.name === `${raw.prefix}options`)) {
		throw new EngineError(
			'NOT_INSTALLED',
			'WordPress tables were not found. Import the database first.',
		);
	}
	return { wpPath: rt.wpPath, urlArg, ...raw };
}

interface RawCandidates {
	[value: string]: { count: number; sources: string[]; primary: boolean };
}

/**
 * Find domains in the options tables and suggest a replacement for each.
 * The domain of the main site is pre-selected and maps to the Local URL.
 */
export async function scanDomains(
	rt: WpRuntime,
	ctx: SiteContext,
	localUrl: string,
): Promise<DomainCandidate[]> {
	const run = ctx.fallback
		? { code: 1, stdout: '', stderr: '', cancelled: false }
		: await runWp({ ...rt, urlArg: ctx.urlArg }, ['eval-file', path.join(PHP_DIR, 'domains.php')]);
	if (run.code !== 0 && rt.db) {
		const fb = await fallbackJson<RawCandidates>(rt, {
			mode: 'domains',
			prefix: ctx.prefix,
			multisite: ctx.multisite,
		});
		if (fb.data) return buildCandidates(fb.data, ctx, localUrl);
	}
	if (run.code !== 0) {
		const e = classifyError(run.stderr);
		throw new EngineError(e.code, e.message);
	}
	const raw = extractJson<RawCandidates>(run.stdout) ?? {};
	return buildCandidates(raw, ctx, localUrl);
}

export function buildCandidates(
	raw: RawCandidates,
	ctx: SiteContext,
	localUrl: string,
): DomainCandidate[] {
	const localHost = hostOf(localUrl);
	const main = ctx.blogs.find((b) => b.id === 1) ?? ctx.blogs[0];
	const mainUrl = main?.siteurl || main?.home || '';
	const mainParts = parseUrlish(mainUrl);
	const originHost = hostOf(mainUrl);
	const originPath = (mainParts?.path ?? '').replace(/\/+$/, '');

	const list: DomainCandidate[] = [];
	for (const [value, info] of Object.entries(raw)) {
		const p = parseUrlish(value);
		if (!p) continue;
		if (!info.primary && isNoiseHost(p.host)) continue;
		const isLocal = stripWww(p.host) === stripWww(localHost);
		const suggested = suggestReplacement(value, originHost, localUrl);
		// A sub-directory sub-site (`host/one`) is already covered by the pair for `host`. Do not run it twice.
		const path = p.path.replace(/\/+$/, '');
		const pathOk = path === '' || path === originPath;
		// Pre-select what a person would tick: the origin and, on subdomain networks, its sub-sites.
		// A `www` twin that only appears in content is ticked too, when it has the scheme of the main URL.
		const wwwTwin =
			stripWww(p.host) === stripWww(originHost) &&
			p.host !== originHost &&
			p.scheme === mainParts?.scheme;
		list.push({
			value,
			host: p.host,
			count: info.count,
			sources: info.sources,
			primary: info.primary,
			suggestedReplace: suggested,
			preselected: !isLocal && !!suggested && pathOk && (info.primary || wwwTwin),
		});
	}
	// `https://a.com` from siteurl and the same value found in options are one row.
	const merged = new Map<string, DomainCandidate>();
	for (const c of list) {
		const key = c.value.replace(/\/+$/, '');
		const prev = merged.get(key);
		if (!prev) merged.set(key, { ...c, value: key });
		else {
			prev.count += c.count;
			prev.primary ||= c.primary;
			prev.preselected ||= c.preselected;
			prev.sources = [...new Set([...prev.sources, ...c.sources])].slice(0, 5);
		}
	}
	return sortCandidates([...merged.values()]);
}
