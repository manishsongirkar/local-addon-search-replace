import type { DomainCandidate, ReplacePair } from '../common/types';

export interface UrlParts {
	scheme: '' | 'http' | 'https';
	host: string;
	port: string;
	path: string;
}

/**
 * A host name as it can appear in a database. Anything else (`=`, quotes, brackets, a leading `-`) is refused:
 * a host ends up in WP-CLI arguments and in wp-config.php, so `--exec=...` must never pass as a domain.
 */
export const isSafeHost = (h: string): boolean =>
	/^[\p{L}\p{N}_](?:[\p{L}\p{N}_.-]*[\p{L}\p{N}_])?$/u.test(h);

/** Parse `https://a.com:8080/x`, `//a.com` or bare `a.com`. Returns null when it is not URL-like. */
export function parseUrlish(input: string): UrlParts | null {
	const m = /^(?:(https?):)?(?:\/\/)?([^/\s:?#]+)(:\d+)?(\/[^\s]*)?$/i.exec(input.trim());
	if (!m || !isSafeHost(m[2])) return null;
	return {
		scheme: (m[1] || '').toLowerCase() as UrlParts['scheme'],
		host: m[2].toLowerCase(),
		port: m[3] || '',
		path: m[4] || '',
	};
}

export function hostOf(input: string): string {
	return parseUrlish(input)?.host ?? '';
}

/** Hosts that appear in nearly every WordPress database and should never be offered for replacement. */
const NOISE_HOSTS = [
	'wordpress.org',
	'w.org',
	'wp.org',
	'gravatar.com',
	'schemas.xmlsoap.org',
	'www.w3.org',
	'purl.org',
	'ogp.me',
	'github.com',
	'example.com',
	'example.org',
	'localhost',
];

export function isNoiseHost(host: string): boolean {
	const h = host.toLowerCase();
	return NOISE_HOSTS.some((n) => h === n || h.endsWith(`.${n}`));
}

/** `www.a.com` and `a.com` are the same site. */
export const stripWww = (host: string): string => host.replace(/^www\./i, '');

/** Second-level labels that are part of a country suffix: `co` in `example.co.uk`. A short list, not the full public suffix list. */
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'or', 'ne', 'go']);

/** `shop.example.co.uk` gives `example.co.uk`; `www.example.com` gives `example.com`. */
export function registrableDomain(host: string): string {
	const parts = stripWww(host).split('.');
	if (parts.length <= 2) return parts.join('.');
	const twoLevel =
		parts[parts.length - 1].length === 2 && SECOND_LEVEL.has(parts[parts.length - 2]);
	return parts.slice(twoLevel ? -3 : -2).join('.');
}

/** `example` for `example.com`, `shop.example.org` and `example.co.uk`. */
export const brandLabel = (host: string): string => registrableDomain(host).split('.')[0];

/**
 * Suggest the replacement for one found URL, based on the main DB origin and the Local URL.
 * A domain that is close to the origin gets a suggestion. The caller decides what is ticked: only the domains a site is
 * registered under are, a close domain is suggested but left unticked.
 * - the origin and its `www` twin map to the Local URL (never `www.<local host>`, which does not exist);
 * - a sub-domain of the origin (`api.example.com`) maps to the same sub-domain of the Local host (`api.my.test`);
 * - the same brand on another top-level domain (`example.net` for `example.com`) maps to the Local URL;
 * - a domain with the same name as this Local site (`acme.com`, `api.acme.com` for the site `acme.test`), which is
 *   typically the live site the database came from, even when the database was exported from a staging URL;
 * - everything else (CDNs, partners, unrelated hosts) gets no suggestion, `''`.
 */
export function suggestReplacement(
	candidateValue: string,
	originHost: string,
	localUrl: string,
): string {
	const cand = parseUrlish(candidateValue);
	const local = parseUrlish(localUrl);
	const originBase = stripWww(originHost);
	if (!cand || !local || !originBase) return '';
	const scheme = local.scheme || 'http';
	const keepPath = cand.path.replace(/\/+$/, '');
	const root = `${scheme}://${local.host}${local.port}${keepPath}`;
	const candBase = stripWww(cand.host);
	const originReg = registrableDomain(originBase);
	const under = (base: string) =>
		`${scheme}://${candBase.slice(0, -base.length - 1)}.${local.host}${local.port}${keepPath}`;
	if (candBase === originBase || candBase === originReg) return root;
	if (candBase.endsWith(`.${originBase}`)) return under(originBase);
	if (candBase.endsWith(`.${originReg}`)) return under(originReg);
	if (brandLabel(candBase) === brandLabel(originBase)) return root;
	// The live site this Local site was made from usually has the name of the Local site.
	if (brandLabel(candBase) === brandLabel(local.host) && candBase !== stripWww(local.host)) {
		const reg = registrableDomain(candBase);
		return candBase === reg ? root : under(reg);
	}
	return '';
}

/** Fill-in order: primary hosts first, then by how often they appear. */
export function sortCandidates(list: DomainCandidate[]): DomainCandidate[] {
	return [...list].sort(
		(a, b) =>
			Number(b.primary) - Number(a.primary) || b.count - a.count || a.value.localeCompare(b.value),
	);
}

export interface ExpandedPair {
	search: string;
	replace: string;
	regex: boolean;
	/** Flags of a generated regex. A user regex uses the global flags instead. */
	flags?: string;
	/** Human label shown in the progress list. */
	label: string;
	/** Run only on the multisite network tables (blogs, site, sitemeta ...). */
	networkOnly?: boolean;
	/** The user wrote this regex. It runs last, in the user's order. */
	user?: boolean;
	/** Length of the original search. Longest runs first. */
	sortKey: number;
}

/** One slash as stored in a database: `/`, `\/`, `\\/` (JSON in JSON) or URL-encoded `%2F`. */
const SEP = '(?:\\\\*/|%2[Ff])';
/** A host ends here: not followed by more name characters, but a final full stop is fine. */
const BOUND = '(?![A-Za-z0-9-]|\\.[A-Za-z0-9])';
// Possessive quantifiers and a look-behind: one linear pass, even with the PCRE JIT off, on a 1 MB value.
const EMAIL = '(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]++@[A-Za-z0-9.-]++';

export const quoteRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const quoteReplacement = (s: string): string => s.replace(/[\\$]/g, '\\$&');
const escSlash = (s: string): string => s.replace(/\//g, '\\/');

export const isHostLike = (s: string): boolean =>
	/^[A-Za-z0-9.-]+(:\d+)?$/.test(s) && s.includes('.');

/**
 * Replace a bare host but never inside an e-mail address.
 * `(*SKIP)(*FAIL)` makes PCRE step over `name@host` as a whole.
 */
export function protectEmails(
	search: string,
	replace: string,
	extra: Partial<ExpandedPair> = {},
): ExpandedPair {
	return {
		search: `${EMAIL}(*SKIP)(*FAIL)|(?<![A-Za-z0-9-])${quoteRegex(search)}${BOUND}`,
		replace: quoteReplacement(replace),
		regex: true,
		flags: 'i',
		label: `${search} → ${replace} (e-mail addresses kept)`,
		sortKey: search.length,
		...extra,
	};
}

/**
 * Expand a `scheme://host` pair into every form a URL takes inside a WordPress database:
 * http and https, protocol-relative (`//host`), JSON-escaped (`\/`), double-escaped (`\\/`) and URL-encoded (`%2F`).
 * Two regex steps cover all of them. Pairs with a path get plain exact and escaped steps instead.
 */
export function expandVariants(pair: Pick<ReplacePair, 'search' | 'replace'>): ExpandedPair[] {
	const sortKey = pair.search.length;
	const plain: ExpandedPair = {
		...pair,
		regex: false,
		label: `${pair.search} → ${pair.replace}`,
		sortKey,
	};
	const s = parseUrlish(pair.search);
	const r = parseUrlish(pair.replace);
	if (!s || !r || !s.scheme || !r.scheme) return [plain];

	if (s.path !== '' && s.path !== '/') {
		const out = [plain];
		for (const [kind, f] of [
			['JSON-escaped', escSlash],
			['double-escaped', (x: string) => x.replace(/\//g, '\\\\/')],
		] as const) {
			out.push({
				...plain,
				search: f(pair.search),
				replace: f(pair.replace),
				label: `${plain.label} (${kind})`,
			});
		}
		return out;
	}

	const sHost = quoteRegex(`${s.host}${s.port}`);
	const rHost = quoteReplacement(`${r.host}${r.port}`);
	// Slashes of a replacement path reuse the style of the slash that was matched.
	const rPath = (group: number): string =>
		quoteReplacement(r.path.replace(/\/+$/, '')).replace(/\//g, `\${${group}}`);
	const label = `${pair.search} → ${pair.replace}`;
	return [
		{
			search: `https?(:|%3[Aa])(${SEP})(${SEP})${sHost}${BOUND}`,
			replace: `${r.scheme}\${1}\${2}\${3}${rHost}${rPath(3)}`,
			regex: true,
			flags: 'i',
			label: `${label} (http, https, escaped and encoded forms)`,
			sortKey,
		},
		{
			search: `(?<![:\\w])(?<!%3[Aa])(${SEP})(${SEP})${sHost}${BOUND}`,
			replace: `\${1}\${2}${rHost}${rPath(2)}`,
			regex: true,
			flags: 'i',
			label: `${label} (protocol-relative)`,
			sortKey,
		},
	];
}

/**
 * Multisite keeps bare hosts (no scheme) in `wp_blogs.domain` and `wp_site.domain`.
 * Returns a host-only pair for those network tables, or null when the pair is not a plain origin URL.
 */
export function networkHostPair(
	pair: Pick<ReplacePair, 'search' | 'replace'>,
	keepEmails = true,
): ExpandedPair | null {
	const s = parseUrlish(pair.search);
	const r = parseUrlish(pair.replace);
	if (!s || !r || !s.scheme || !r.scheme || (s.path !== '' && s.path !== '/')) return null;
	const search = `${s.host}${s.port}`;
	const replace = `${r.host}${r.port}`;
	if (search === replace) return null;
	const extra = { networkOnly: true, label: `${search} → ${replace} (network tables)` };
	// sitemeta holds `admin_email`, so the e-mail guard matters here.
	return keepEmails
		? protectEmails(search, replace, extra)
		: { search, replace, regex: false, sortKey: search.length, ...extra };
}

/**
 * Longest original search first, so `https://a.com/blog` runs before `https://a.com`.
 * Regex pairs written by the user keep their order and run last.
 */
export function orderPairs(pairs: ExpandedPair[]): ExpandedPair[] {
	const generated = pairs.filter((p) => !p.user && !p.networkOnly);
	// The network tables hold the domain that WordPress boots with. Change them after every other generated step,
	// whatever the length of the host, or the steps after them could not load the site.
	const network = pairs.filter((p) => !p.user && p.networkOnly);
	const user = pairs.filter((p) => p.user);
	// Array.prototype.sort is stable.
	return [
		...generated.sort((a, b) => b.sortKey - a.sortKey),
		...network.sort((a, b) => b.sortKey - a.sortKey),
		...user,
	];
}
