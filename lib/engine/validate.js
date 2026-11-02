"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasErrors = exports.allTablesOnly = exports.isNoOp = exports.skipFlagsOf = void 0;
exports.chooseDelimiter = chooseDelimiter;
exports.normalizePairs = normalizePairs;
exports.splitList = splitList;
exports.skipColumnsOf = skipColumnsOf;
exports.validate = validate;
const types_1 = require("../common/types");
const urls_1 = require("./urls");
const DELIMITERS = ['/', '#', '~', '@', '%', '!', ';', ','];
const FLAG_CHARS = /^[imsxuADU]*$/;
const IDENT_LIST = /^[\w$*%.\-, ]*$/;
/** First regex delimiter that does not occur in the pattern, or null. */
function chooseDelimiter(pattern) {
    var _a;
    return (_a = DELIMITERS.find((d) => !pattern.includes(d))) !== null && _a !== void 0 ? _a : null;
}
/** Trim all user text. Pasted domains often carry spaces and line breaks. */
function normalizePairs(pairs) {
    return pairs.map((p) => (Object.assign(Object.assign({}, p), { search: p.search.trim(), replace: p.replace.trim() })));
}
function splitList(value) {
    return value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}
/**
 * Columns WP-CLI must leave alone. `guid` is always in the list unless the user chose to replace GUIDs,
 * whatever the text field says.
 */
function skipColumnsOf(opts) {
    const user = splitList(opts.skipColumns).filter((c) => c !== 'guid');
    return opts.replaceGuid ? user : ['guid', ...user];
}
/** The WP-CLI skip flags that belong to these options. */
const skipFlagsOf = (o) => ({
    plugins: o.skipPlugins,
    themes: o.skipThemes,
    packages: o.skipPackages,
});
exports.skipFlagsOf = skipFlagsOf;
/** A text pair that would replace a text with itself. It changes nothing, so it is skipped, not an error. */
const isNoOp = (p) => !p.regex && p.search.trim() !== '' && p.search.trim() === p.replace.trim();
exports.isNoOp = isNoOp;
function validate(opts, ctx) {
    const issues = [];
    const push = (i) => issues.push(i);
    const active = opts.pairs.filter((p) => p.enabled);
    if (active.length === 0) {
        push({
            level: 'error',
            code: 'NO_PAIRS',
            message: 'Add at least one search and replace pair.',
        });
    }
    else if (active.every(exports.isNoOp)) {
        push({
            level: 'error',
            code: 'NO_PAIRS',
            message: 'Nothing to change: every ticked row has the same search and replace text.',
        });
    }
    if (!FLAG_CHARS.test(opts.regexFlags)) {
        push({
            level: 'error',
            code: 'BAD_FLAGS',
            message: 'Regex flags may only use i, m, s, x, u, A, D, U.',
        });
    }
    for (const [label, v] of [
        ['Skip columns', opts.skipColumns],
        ['Skip tables', opts.skipTables],
    ]) {
        if (!IDENT_LIST.test(v)) {
            push({
                level: 'error',
                code: 'BAD_LIST',
                message: `${label} must be a comma separated list of names.`,
            });
        }
    }
    if (opts.replaceGuid) {
        push({
            level: 'warning',
            code: 'REPLACE_GUID',
            message: 'GUID values are identifiers, not links. WordPress advises to leave them as they are. After a change, feed readers can show old posts as new.',
        });
    }
    if (opts.allTables)
        push({ level: 'info', code: 'ALL_TABLES', message: types_1.ALL_TABLES_NOTICE });
    const seen = new Map();
    active.forEach((p, idx) => {
        const n = idx + 1;
        const at = (m) => `Pair ${n} (${p.search.trim().slice(0, 40) || 'empty'}): ${m}`;
        const raw = p;
        const search = raw.search.trim();
        const replace = raw.replace.trim();
        if (raw.search !== search || raw.replace !== replace) {
            push({
                level: 'info',
                code: 'TRIMMED',
                pairId: p.id,
                message: at('Spaces around the text were removed.'),
            });
        }
        if (!search) {
            push({ level: 'error', code: 'EMPTY_SEARCH', pairId: p.id, message: at('Search is empty.') });
            return;
        }
        if (/[\r\n\t\0]/.test(search) || /[\r\n\0]/.test(replace)) {
            push({
                level: 'error',
                code: 'CONTROL_CHARS',
                pairId: p.id,
                message: at('Text has a line break or control character. Paste one value per field.'),
            });
        }
        if (search.startsWith('--') || replace.startsWith('--')) {
            push({
                level: 'error',
                code: 'DASH_PREFIX',
                pairId: p.id,
                message: at('A value cannot start with "--". WP-CLI would read it as an option.'),
            });
        }
        const dupKey = `${p.regex ? 'r' : 'p'}:${search}`;
        const prev = seen.get(dupKey);
        if (prev) {
            const same = prev.replace.trim() === replace;
            push({
                level: same ? 'warning' : 'error',
                code: same ? 'DUPLICATE_PAIR' : 'CONFLICTING_PAIR',
                pairId: p.id,
                message: at(same
                    ? 'Same pair as an earlier row. It will run once.'
                    : 'Same search text as an earlier row with a different replace. Remove one.'),
            });
        }
        seen.set(dupKey, p);
        if (p.regex) {
            try {
                if (new RegExp(search).test('')) {
                    push({
                        level: 'warning',
                        code: 'REGEX_MATCHES_EMPTY',
                        pairId: p.id,
                        needsConfirm: true,
                        message: at('This regex matches an empty string. It can change every value in the database.'),
                    });
                }
            }
            catch (_a) {
                // PCRE syntax differs from JavaScript. PHP checks the real pattern before the run.
            }
            if (chooseDelimiter(search) === null) {
                push({
                    level: 'error',
                    code: 'NO_DELIMITER',
                    pairId: p.id,
                    message: at('The pattern uses every delimiter character. Simplify it.'),
                });
            }
            return;
        }
        if (search === replace) {
            // Typically the Local domain of this site itself. It changes nothing, so it is skipped and never blocks the run.
            push({
                level: 'warning',
                code: 'SAME',
                pairId: p.id,
                message: at('Search and replace are the same. This row changes nothing and is skipped.'),
            });
            return;
        }
        if (!replace) {
            push({
                level: 'warning',
                code: 'EMPTY_REPLACE',
                pairId: p.id,
                needsConfirm: true,
                message: at(`Replace is empty. Every "${search}" will be deleted from the database.`),
            });
        }
        if (search.length < 4) {
            push({
                level: 'warning',
                code: 'SHORT_SEARCH',
                pairId: p.id,
                needsConfirm: true,
                message: at(`"${search}" is very short and will match many unrelated values.`),
            });
        }
        if (/\s/.test(replace)) {
            push({
                level: 'warning',
                code: 'SPACE_IN_REPLACE',
                pairId: p.id,
                message: at('Replace has a space inside. A domain cannot have spaces.'),
            });
        }
        const s = (0, urls_1.parseUrlish)(search);
        const r = (0, urls_1.parseUrlish)(replace);
        if (s && r) {
            if (Boolean(s.scheme) !== Boolean(r.scheme)) {
                push({
                    level: 'warning',
                    code: 'SCHEME_MISMATCH',
                    pairId: p.id,
                    message: at('Only one side has http:// or https://. Check that this is what you want.'),
                });
            }
            if (s.path.endsWith('/') !== r.path.endsWith('/') ||
                search.endsWith('/') !== replace.endsWith('/')) {
                push({
                    level: 'warning',
                    code: 'TRAILING_SLASH',
                    pairId: p.id,
                    message: at('Only one side ends with "/". Links can break.'),
                });
            }
            if (s.scheme === 'https' && r.scheme === 'http') {
                push({
                    level: 'info',
                    code: 'DOWNGRADE',
                    pairId: p.id,
                    message: at('The replace uses http://. Use https:// if your Local site has SSL on.'),
                });
            }
            if (opts.caseSensitive && search !== search.toLowerCase()) {
                push({
                    level: 'info',
                    code: 'UPPERCASE',
                    pairId: p.id,
                    message: at('Search has capital letters. Case sensitive is on, so only this exact case is found.'),
                });
            }
        }
        if (replace.includes(search)) {
            push({
                level: 'warning',
                code: 'REPLACE_CONTAINS_SEARCH',
                pairId: p.id,
                needsConfirm: true,
                message: at('Replace contains the search text. Running it twice would repeat the change.'),
            });
        }
        if (s && s.host === ctx.localHost) {
            push({
                level: 'info',
                code: 'SEARCH_IS_LOCAL',
                pairId: p.id,
                message: at('Search is already this Local site domain.'),
            });
        }
    });
    // Cross-pair checks on plain pairs only.
    const plain = active.filter((p) => !p.regex && p.search.trim() && p.replace.trim() && !(0, exports.isNoOp)(p));
    plain.forEach((a, i) => {
        plain.forEach((b, j) => {
            if (i >= j || a.search.trim() === b.search.trim())
                return;
            const aS = a.search.trim();
            const bS = b.search.trim();
            if (a.replace.trim().includes(bS)) {
                push({
                    level: 'warning',
                    code: 'CHAIN',
                    pairId: b.id,
                    message: `Replace of row ${i + 1} contains the search of row ${j + 1}. Text may be changed twice.`,
                });
            }
            if (aS.includes(bS) || bS.includes(aS)) {
                push({
                    level: 'info',
                    code: 'OVERLAP',
                    pairId: b.id,
                    message: `Rows ${i + 1} and ${j + 1} overlap. The longer search runs first.`,
                });
            }
        });
    });
    // Will the site still load?
    const replaceHosts = plain.map((p) => { var _a; return (_a = (0, urls_1.parseUrlish)(p.replace.trim())) === null || _a === void 0 ? void 0 : _a.host; }).filter(Boolean);
    // Without a scan in this session the domains of the database are unknown, so nothing can be said about them.
    const dbKnown = ctx.dbHosts.length > 0;
    const dbIsLocal = dbKnown && ctx.dbHosts.every((h) => h === ctx.localHost);
    if (dbKnown &&
        active.length > 0 &&
        active.every((p) => !p.regex) &&
        !dbIsLocal &&
        !replaceHosts.includes(ctx.localHost) &&
        ctx.localHost) {
        push({
            level: 'warning',
            code: 'NOT_LOCAL_HOST',
            message: `No ticked row replaces to this site's Local domain (${ctx.localHost}), and the database still uses ${[...new Set(ctx.dbHosts)].filter((h) => h !== ctx.localHost).join(', ')}. After the run WordPress may redirect to that domain, or the site may not load.`,
            needsConfirm: true,
        });
    }
    return issues;
}
/**
 * The add-on has no per-table option: every run covers all tables, whatever an old config file says.
 * It has no case or GUID option either: matching is exact, and the guid column is never changed.
 */
const allTablesOnly = (o) => (Object.assign(Object.assign({}, o), { allTables: true, skipTables: '', caseSensitive: true, replaceGuid: false }));
exports.allTablesOnly = allTablesOnly;
const hasErrors = (issues) => issues.some((i) => i.level === 'error');
exports.hasErrors = hasErrors;
