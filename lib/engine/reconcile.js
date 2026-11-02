"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanId = exports.kindOf = void 0;
exports.normalizeValue = normalizeValue;
exports.orderRows = orderRows;
exports.reconcilePairs = reconcilePairs;
const urls_1 = require("./urls");
/**
 * Where a found domain belongs in the list:
 * - `main`: a domain the site is registered under (siteurl and home of every site, the network URL, the hosts in wp_site
 *   and wp_blogs). Ticked, so it is the first thing to look at;
 * - `close`: near a main domain (`api.example.com`, `example.net`), with a suggested replace. Not ticked;
 * - `other`: every other domain found in the database (CDNs, fonts, other companies). Not ticked, no suggestion.
 */
const kindOf = (c) => c.primary ? 'main' : c.suggestedReplace !== '' ? 'close' : 'other';
exports.kindOf = kindOf;
const RANK = { main: 0, close: 1, other: 2 };
const scanId = (value) => `scan:${value}`;
exports.scanId = scanId;
/** `HTTPS://A.com/` and `https://a.com` are the same domain. */
function normalizeValue(v) {
    const p = (0, urls_1.parseUrlish)(v);
    const base = p ? `${p.scheme ? `${p.scheme}://` : ''}${p.host}${p.port}${p.path}` : v.trim();
    return base.replace(/\/+$/, '');
}
/** A row made from a scan and not edited since. Editing its search text turns it into a custom row. */
const isScanRow = (p) => p.origin === 'scan' && p.id === (0, exports.scanId)(p.search);
const swapScheme = (u) => u.replace(/^https?:/i, (m) => (m.toLowerCase() === 'http:' ? 'https:' : 'http:'));
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
function orderRows(pairs) {
    const rank = (p) => { var _a; return (isScanRow(p) ? RANK[(_a = p.kind) !== null && _a !== void 0 ? _a : 'other'] : 3); };
    return pairs
        .map((p, i) => ({ p, i }))
        .sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i)
        .map((x) => x.p);
}
function reconcilePairs(saved, candidates) {
    var _a;
    const byKey = new Map(candidates.map((c) => [normalizeValue(c.value), c]));
    const removed = [];
    const pairs = [];
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
            pairs.push(Object.assign(Object.assign({}, p), { kind: (0, exports.kindOf)(c) }));
            continue;
        }
        // A row that still holds the suggestion it was given (or an empty text) follows a better suggestion, for example
        // https after SSL was turned on. A rows with text the user typed is never changed. A row saved before this
        // field existed counts as untouched when it is the old suggestion with the other protocol.
        const untouched = p.replace === '' ||
            (p.suggested !== undefined ? p.replace === p.suggested : p.replace === swapScheme(next));
        pairs.push(untouched
            ? Object.assign(Object.assign({}, p), { replace: next, suggested: next, kind: (0, exports.kindOf)(c) }) : Object.assign(Object.assign({}, p), { suggested: (_a = p.suggested) !== null && _a !== void 0 ? _a : next, kind: (0, exports.kindOf)(c) }));
    }
    const known = new Set(pairs.map((p) => normalizeValue(p.search)));
    const added = [];
    for (const c of candidates) {
        const key = normalizeValue(c.value);
        if (known.has(key))
            continue;
        known.add(key);
        added.push(c.value);
        pairs.push({
            id: (0, exports.scanId)(c.value),
            search: c.value,
            replace: c.suggestedReplace,
            regex: false,
            // The Local domain of this very site maps to itself: nothing to change, so it is not ticked.
            enabled: c.preselected && normalizeValue(c.suggestedReplace) !== normalizeValue(c.value),
            origin: 'scan',
            suggested: c.suggestedReplace,
            kind: (0, exports.kindOf)(c),
        });
    }
    return { pairs: orderRows(pairs), added, removed };
}
