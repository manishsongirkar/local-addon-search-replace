import fs from 'node:fs';
import path from 'node:path';

export type Layout = 'standard' | 'subdirectory' | 'bedrock' | 'wp-cli.yml' | 'manual';

export interface ResolvedWp {
	path: string;
	layout: Layout;
	/** Other WordPress copies found while scanning. */
	alternatives: string[];
}

const SKIP_DIRS = new Set([
	'node_modules',
	'vendor',
	'wp-content',
	'wp-admin',
	'wp-includes',
	'.git',
]);
const COMMON = [
	'wp',
	'web/wp',
	'public/wp',
	'wordpress',
	'cms',
	'core',
	'public_html',
	'htdocs',
	'web',
];

const isWp = (dir: string): boolean => fs.existsSync(path.join(dir, 'wp-load.php'));
const isDir = (p: string): boolean => {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
};

/** Read `path:` from a wp-cli.yml next to (or above) the web root. */
function wpCliYmlPath(webRoot: string): string | null {
	let dir = webRoot;
	for (let i = 0; i < 3; i++) {
		for (const name of ['wp-cli.local.yml', 'wp-cli.yml']) {
			const file = path.join(dir, name);
			if (!fs.existsSync(file)) continue;
			const m = /^path:\s*["']?([^"'\r\n#]+?)["']?\s*(?:#.*)?$/m.exec(
				fs.readFileSync(file, 'utf8'),
			);
			if (m) {
				const p = path.resolve(dir, m[1].trim());
				if (isWp(p)) return p;
			}
		}
		const up = path.dirname(dir);
		if (up === dir) break;
		dir = up;
	}
	return null;
}

function scan(root: string, depth: number, found: string[]): void {
	if (isWp(root)) {
		found.push(root);
		return;
	}
	if (depth === 0) return;
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(root, { withFileTypes: true });
	} catch {
		return;
	}
	for (const e of entries) {
		if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) {
			scan(path.join(root, e.name), depth - 1, found);
		}
	}
}

/**
 * Find the directory WP-CLI must use as `--path`.
 * Handles standard installs, WordPress in a sub-directory, Bedrock and wp-cli.yml projects.
 */
export function resolveWpPath(webRoot: string, override = ''): ResolvedWp | null {
	if (override.trim()) {
		const p = path.resolve(override.trim());
		return isWp(p) ? { path: p, layout: 'manual', alternatives: [] } : null;
	}
	if (!isDir(webRoot)) return null;

	const yml = wpCliYmlPath(webRoot);
	if (yml) return { path: yml, layout: 'wp-cli.yml', alternatives: [] };
	if (isWp(webRoot)) return { path: webRoot, layout: 'standard', alternatives: [] };

	const bedrock = path.join(webRoot, 'web', 'wp');
	if (isWp(bedrock) && fs.existsSync(path.join(webRoot, 'config', 'application.php'))) {
		return { path: bedrock, layout: 'bedrock', alternatives: [] };
	}

	const found: string[] = [];
	for (const c of COMMON) {
		const p = path.join(webRoot, c);
		if (isWp(p)) found.push(p);
	}
	if (found.length === 0) scan(webRoot, 3, found);
	if (found.length === 0) return null;
	// Shallowest copy first.
	found.sort((a, b) => a.split(path.sep).length - b.split(path.sep).length);
	return { path: found[0], layout: 'subdirectory', alternatives: found.slice(1) };
}

/** True when `child` is `parent` or inside it, after links are resolved. */
export function isInside(parent: string, child: string): boolean {
	try {
		const rel = path.relative(fs.realpathSync(parent), fs.realpathSync(child));
		return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
	} catch {
		return false;
	}
}
