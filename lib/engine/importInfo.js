"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nextImportInfo = nextImportInfo;
exports.markReplaced = markReplaced;
const reconcile_1 = require("./reconcile");
/**
 * What a scan says about an import. A database that came from another domain still holds that domain as its main one,
 * and the Local domain is the suggested replace. When both are the same there is nothing to tell.
 * - a main domain that differs from its suggestion: an import is waiting. The first time it is seen it is recorded;
 * - no such domain, and the tables were created again: a new import from the same domain. The old note is stale;
 * - no such domain otherwise: keep the note, so it still says what was replaced after the run.
 */
function nextImportInfo(prev, candidates, tablesChanged, now = Date.now()) {
    const src = candidates.find((c) => c.primary &&
        c.suggestedReplace !== '' &&
        (0, reconcile_1.normalizeValue)(c.suggestedReplace) !== (0, reconcile_1.normalizeValue)(c.value));
    if (!src)
        return tablesChanged ? null : prev;
    const from = (0, reconcile_1.normalizeValue)(src.value);
    if (prev && (0, reconcile_1.normalizeValue)(prev.from) === from && !tablesChanged)
        return prev;
    return { from: src.value, to: src.suggestedReplace, at: now, replaced: false };
}
/** After a finished real run: did it replace the imported domain? */
function markReplaced(info, pairs, now = Date.now()) {
    if (!info || info.replaced)
        return info;
    const hit = pairs.find((p) => p.enabled && !p.regex && (0, reconcile_1.normalizeValue)(p.search) === (0, reconcile_1.normalizeValue)(info.from));
    return (hit === null || hit === void 0 ? void 0 : hit.replace) ? Object.assign(Object.assign({}, info), { to: hit.replace, replaced: true, replacedAt: now }) : info;
}
