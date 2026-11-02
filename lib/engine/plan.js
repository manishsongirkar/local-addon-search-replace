"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pairFlags = void 0;
exports.splitScopes = splitScopes;
exports.partitionTables = partitionTables;
exports.applyCase = applyCase;
exports.buildPlan = buildPlan;
exports.stepArgs = stepArgs;
const urls_1 = require("./urls");
const validate_1 = require("./validate");
/** Tables per WP-CLI process. Keeps the command line short on Windows. */
const MAX_TABLES_PER_PROCESS = 120;
/** Fixed cost of starting WP-CLI, in "bytes", so the progress bar moves for tiny databases too. */
const STEP_OVERHEAD = 65536;
const MIN_TABLE_WEIGHT = 16384;
const globToRegex = (g) => new RegExp(`^${g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
const NETWORK_TABLES = [
    'blogs',
    'site',
    'sitemeta',
    'signups',
    'registration_log',
    'blog_versions',
    'blogmeta',
];
function splitScopes(ctx, opts) {
    const skip = (0, validate_1.splitList)(opts.skipTables).map(globToRegex);
    const skipped = [];
    const eligible = ctx.tables.filter((t) => {
        // WP-CLI reads `--name=value` as an option even in a table position. A table cannot be searched under such a name.
        if (t.name.startsWith('-')) {
            skipped.push(t.name);
            return false;
        }
        if (!opts.allTables && !t.name.startsWith(ctx.prefix))
            return false;
        if (skip.some((r) => r.test(t.name))) {
            skipped.push(t.name);
            return false;
        }
        return true;
    });
    if (!ctx.multisite)
        return { scopes: [{ label: 'All tables', tables: eligible, main: true }], skipped };
    const subs = ctx.blogs.filter((b) => b.id !== 1).sort((a, b) => a.id - b.id);
    const taken = new Set();
    const scopes = [];
    for (const b of subs) {
        const tables = eligible.filter((t) => t.name.startsWith(b.tablePrefix));
        for (const t of tables)
            taken.add(t.name);
        if (tables.length) {
            scopes.push({
                label: `Sub-site ${b.id} (${b.siteurl || b.domain + b.path})`,
                tables,
                main: false,
            });
        }
    }
    // Longest prefix wins: `wp_12_` must not be claimed by `wp_1_`. Handled by exact blog prefixes including the trailing `_`.
    const rest = eligible.filter((t) => !taken.has(t.name));
    scopes.push({ label: 'Main site and network tables', tables: rest, main: true });
    return { scopes, skipped };
}
/**
 * Split tables into `groups` lists of similar total size, so parallel WP-CLI processes finish together.
 * Largest table first into the lightest group. A group never holds more than MAX_TABLES_PER_PROCESS tables.
 * With one group the original table order is kept.
 */
function partitionTables(tables, groups) {
    const k = Math.max(1, Math.min(groups, tables.length));
    const bins = Array.from({ length: k }, () => ({
        weight: 0,
        tables: [],
    }));
    const ordered = k === 1 ? tables : [...tables].sort((a, b) => b.bytes - a.bytes);
    for (const t of ordered) {
        const bin = k === 1 ? bins[0] : bins.reduce((m, b) => (b.weight < m.weight ? b : m));
        bin.tables.push(t);
        bin.weight += Math.max(t.bytes, MIN_TABLE_WEIGHT);
    }
    return bins.flatMap((b) => {
        const out = [];
        for (let i = 0; i < b.tables.length; i += MAX_TABLES_PER_PROCESS)
            out.push(b.tables.slice(i, i + MAX_TABLES_PER_PROCESS));
        return out;
    });
}
/**
 * Apply the "case sensitive" option to a generated pair.
 * Generated URL and host regexes ignore case (`i`), and a plain text pair matches exactly. So:
 * - case sensitive: the `i` flag is dropped, every pair matches exact case;
 * - not case sensitive (default): a plain text pair becomes a regex with `i`, every pair ignores case.
 * A regex written by the user keeps its own flags.
 */
function applyCase(p, caseSensitive) {
    if (p.user)
        return p;
    if (caseSensitive)
        return p.regex && p.flags === 'i' ? Object.assign(Object.assign({}, p), { flags: '' }) : p;
    if (p.regex)
        return p;
    return Object.assign(Object.assign({}, p), { regex: true, flags: 'i', search: (0, urls_1.quoteRegex)(p.search), replace: (0, urls_1.quoteReplacement)(p.replace) });
}
function buildPlan(ctx, opts, hits, workers = 1) {
    // A text pair with the same search and replace changes nothing. It is left out.
    const active = (0, validate_1.normalizePairs)(opts.pairs.filter((p) => p.enabled)).filter((p) => !(0, validate_1.isNoOp)(p));
    const expanded = [];
    for (const p of active) {
        if (p.regex) {
            expanded.push({
                search: p.search,
                replace: p.replace,
                regex: true,
                user: true,
                sortKey: 0,
                label: `${p.search} → ${p.replace} (regex)`,
            });
        }
        else if (opts.protectEmails && (0, urls_1.isHostLike)(p.search)) {
            expanded.push((0, urls_1.protectEmails)(p.search, p.replace));
        }
        else if (opts.includeVariants) {
            expanded.push(...(0, urls_1.expandVariants)(p));
        }
        else {
            expanded.push(Object.assign(Object.assign({}, p), { regex: false, sortKey: p.search.length, label: `${p.search} → ${p.replace}` }));
        }
    }
    // Network tables keep bare hosts. They must change even when the variant option is off, or the network will not load.
    if (ctx.multisite) {
        for (const p of active) {
            const n = !p.regex ? (0, urls_1.networkHostPair)(p, opts.protectEmails) : null;
            if (n)
                expanded.push(n);
        }
    }
    // Drop duplicate plain searches introduced by variants of different pairs.
    const seen = new Set();
    const pairs = (0, urls_1.orderPairs)(expanded.map((p) => applyCase(p, opts.caseSensitive))).filter((p) => {
        const k = `${p.regex}:${p.search}`;
        if (seen.has(k))
            return false;
        seen.add(k);
        return true;
    });
    const { scopes, skipped } = splitScopes(ctx, opts);
    const skipCols = new Set((0, validate_1.skipColumnsOf)(opts));
    const steps = [];
    for (const scope of scopes) {
        const barrier = ctx.multisite && scope.main;
        for (const pair of pairs) {
            if (pair.networkOnly && !scope.main)
                continue;
            let pool = pair.networkOnly
                ? scope.tables.filter((t) => NETWORK_TABLES.some((n) => t.name === `${ctx.prefix}${n}`))
                : scope.tables;
            // The pre-scan knows the text of the generated pairs only. A regex written by the user runs on every table.
            const filtered = !!hits && !pair.user;
            if (filtered)
                pool = pool.filter((t) => hits.has(t.name));
            for (const tables of partitionTables(pool, workers)) {
                const cols = filtered
                    ? [...new Set(tables.flatMap((t) => { var _a; return (_a = hits.get(t.name)) !== null && _a !== void 0 ? _a : []; }))].filter((c) => !skipCols.has(c))
                    : undefined;
                steps.push({
                    index: steps.length,
                    scope: scope.label,
                    pair,
                    tables,
                    weight: STEP_OVERHEAD + tables.reduce((n, t) => n + Math.max(t.bytes, MIN_TABLE_WEIGHT), 0),
                    // Every hit column is on the skip list: nothing to do for these tables.
                    includeColumns: cols,
                    barrier,
                });
            }
        }
    }
    // A filtered step with no column left has nothing to change.
    const live = steps
        .filter((s) => !s.includeColumns || s.includeColumns.length > 0)
        .map((s, index) => (Object.assign(Object.assign({}, s), { index })));
    return {
        steps: live,
        totalWeight: live.reduce((n, s) => n + s.weight, 0),
        tablePasses: live.reduce((n, s) => n + s.tables.length, 0),
        skippedTables: skipped,
    };
}
/** Regex flags for a pair: generated regexes carry their own, user regexes use the global flags. */
const pairFlags = (pair, opts) => { var _a; return (_a = pair.flags) !== null && _a !== void 0 ? _a : (pair.user ? opts.regexFlags : ''); };
exports.pairFlags = pairFlags;
/**
 * Arguments for `wp search-replace` for one step.
 * We always pass explicit table names, but WP-CLI silently drops every name it does not allow:
 * - `--all-tables`: every table in the database. It overrides the two flags below;
 * - otherwise `--all-tables-with-prefix`: every table with the site prefix, also plugin tables WordPress does not register
 *   (without it a table like `wp_yoast_indexable` would be skipped without an error);
 * - on a multisite also `--network`, so the tables of every sub-site are allowed.
 */
function stepArgs(step, opts, multisite = false) {
    var _a, _b;
    const positional = [step.pair.search, step.pair.replace, ...step.tables.map((t) => t.name)];
    const bad = positional.find((v) => v.startsWith('--'));
    if (bad !== undefined)
        throw new Error(`Refused: "${bad.slice(0, 40)}" would be read by WP-CLI as an option.`);
    const args = ['search-replace', ...positional, '--verbose'];
    if (opts.allTables)
        args.push('--all-tables');
    else {
        if (multisite)
            args.push('--network');
        args.push('--all-tables-with-prefix');
    }
    if (opts.dryRun)
        args.push('--dry-run');
    if (opts.precise)
        args.push('--precise');
    if (opts.reportChangedOnly)
        args.push('--report-changed-only');
    if ((_a = step.includeColumns) === null || _a === void 0 ? void 0 : _a.length)
        args.push(`--include-columns=${step.includeColumns.join(',')}`);
    const skipCols = (0, validate_1.skipColumnsOf)(opts);
    if (skipCols.length)
        args.push(`--skip-columns=${skipCols.join(',')}`);
    if (step.pair.regex) {
        const delim = (_b = (0, validate_1.chooseDelimiter)(step.pair.search)) !== null && _b !== void 0 ? _b : '/';
        args.push('--regex', `--regex-delimiter=${delim}`);
        const flags = (0, exports.pairFlags)(step.pair, opts);
        if (flags)
            args.push(`--regex-flags=${flags}`);
    }
    return args;
}
