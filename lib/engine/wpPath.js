"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveWpPath = resolveWpPath;
exports.isInside = isInside;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
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
const isWp = (dir) => node_fs_1.default.existsSync(node_path_1.default.join(dir, 'wp-load.php'));
const isDir = (p) => {
    try {
        return node_fs_1.default.statSync(p).isDirectory();
    }
    catch (_a) {
        return false;
    }
};
/** Read `path:` from a wp-cli.yml next to (or above) the web root. */
function wpCliYmlPath(webRoot) {
    let dir = webRoot;
    for (let i = 0; i < 3; i++) {
        for (const name of ['wp-cli.local.yml', 'wp-cli.yml']) {
            const file = node_path_1.default.join(dir, name);
            if (!node_fs_1.default.existsSync(file))
                continue;
            const m = /^path:\s*["']?([^"'\r\n#]+?)["']?\s*(?:#.*)?$/m.exec(node_fs_1.default.readFileSync(file, 'utf8'));
            if (m) {
                const p = node_path_1.default.resolve(dir, m[1].trim());
                if (isWp(p))
                    return p;
            }
        }
        const up = node_path_1.default.dirname(dir);
        if (up === dir)
            break;
        dir = up;
    }
    return null;
}
function scan(root, depth, found) {
    if (isWp(root)) {
        found.push(root);
        return;
    }
    if (depth === 0)
        return;
    let entries;
    try {
        entries = node_fs_1.default.readdirSync(root, { withFileTypes: true });
    }
    catch (_a) {
        return;
    }
    for (const e of entries) {
        if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) {
            scan(node_path_1.default.join(root, e.name), depth - 1, found);
        }
    }
}
/**
 * Find the directory WP-CLI must use as `--path`.
 * Handles standard installs, WordPress in a sub-directory, Bedrock and wp-cli.yml projects.
 */
function resolveWpPath(webRoot, override = '') {
    if (override.trim()) {
        const p = node_path_1.default.resolve(override.trim());
        return isWp(p) ? { path: p, layout: 'manual', alternatives: [] } : null;
    }
    if (!isDir(webRoot))
        return null;
    const yml = wpCliYmlPath(webRoot);
    if (yml)
        return { path: yml, layout: 'wp-cli.yml', alternatives: [] };
    if (isWp(webRoot))
        return { path: webRoot, layout: 'standard', alternatives: [] };
    const bedrock = node_path_1.default.join(webRoot, 'web', 'wp');
    if (isWp(bedrock) && node_fs_1.default.existsSync(node_path_1.default.join(webRoot, 'config', 'application.php'))) {
        return { path: bedrock, layout: 'bedrock', alternatives: [] };
    }
    const found = [];
    for (const c of COMMON) {
        const p = node_path_1.default.join(webRoot, c);
        if (isWp(p))
            found.push(p);
    }
    if (found.length === 0)
        scan(webRoot, 3, found);
    if (found.length === 0)
        return null;
    // Shallowest copy first.
    found.sort((a, b) => a.split(node_path_1.default.sep).length - b.split(node_path_1.default.sep).length);
    return { path: found[0], layout: 'subdirectory', alternatives: found.slice(1) };
}
/** True when `child` is `parent` or inside it, after links are resolved. */
function isInside(parent, child) {
    try {
        const rel = node_path_1.default.relative(node_fs_1.default.realpathSync(parent), node_fs_1.default.realpathSync(child));
        return rel === '' || (!rel.startsWith('..') && !node_path_1.default.isAbsolute(rel));
    }
    catch (_a) {
        return false;
    }
}
