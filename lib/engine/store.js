"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_HISTORY = void 0;
exports.cleanPairs = cleanPairs;
exports.cleanOptions = cleanOptions;
exports.loadConfig = loadConfig;
exports.saveConfig = saveConfig;
exports.readHistory = readHistory;
exports.addHistory = addHistory;
exports.readImportInfo = readImportInfo;
exports.writeImportInfo = writeImportInfo;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const types_1 = require("../common/types");
exports.MAX_HISTORY = 20;
const CONFIG_FILE = 'config.json';
const HISTORY_FILE = 'history.json';
const IMPORT_FILE = 'import.json';
/** Write to a temp file, then rename. A crash never leaves half a file. */
function writeAtomic(file, data) {
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    node_fs_1.default.writeFileSync(tmp, data, { mode: 0o600 });
    node_fs_1.default.renameSync(tmp, file);
}
function readJson(file) {
    try {
        return JSON.parse(node_fs_1.default.readFileSync(file, 'utf8'));
    }
    catch (_a) {
        return null;
    }
}
const str = (v) => (typeof v === 'string' ? v : '');
/** Keep only well-formed pairs. A hand-edited or damaged file must not crash the UI. */
function cleanPairs(raw) {
    if (!Array.isArray(raw))
        return [];
    return raw
        .filter((p) => !!p && typeof p === 'object')
        .map((p, i) => (Object.assign(Object.assign({ id: str(p.id) || `pair-${i}`, search: str(p.search), replace: str(p.replace), regex: p.regex === true, enabled: p.enabled !== false, origin: p.origin === 'scan' ? 'scan' : 'custom' }, (typeof p.suggested === 'string' ? { suggested: p.suggested } : {})), (p.kind === 'main' || p.kind === 'close' || p.kind === 'other' ? { kind: p.kind } : {}))));
}
/** Known option keys only, each with the right type. Anything else falls back to the default. */
function cleanOptions(raw) {
    const o = (raw && typeof raw === 'object' ? raw : {});
    const out = Object.assign({}, types_1.DEFAULT_OPTIONS);
    for (const [k, def] of Object.entries(types_1.DEFAULT_OPTIONS)) {
        if (typeof o[k] === typeof def)
            out[k] = o[k];
    }
    // A saved dry run would make the next click do nothing. Always start as a real run.
    out.dryRun = false;
    // No option in the UI any more: an old file with `false` or `true` must not change the matching.
    out.caseSensitive = true;
    out.replaceGuid = false;
    return out;
}
function loadConfig(dir) {
    const raw = readJson(node_path_1.default.join(dir, CONFIG_FILE));
    return { pairs: cleanPairs(raw === null || raw === void 0 ? void 0 : raw.pairs), options: cleanOptions(raw === null || raw === void 0 ? void 0 : raw.options) };
}
function saveConfig(dir, cfg) {
    const clean = { pairs: cleanPairs(cfg.pairs), options: cleanOptions(cfg.options) };
    writeAtomic(node_path_1.default.join(dir, CONFIG_FILE), JSON.stringify(clean, null, 2));
    return clean;
}
function readHistory(dir) {
    const raw = readJson(node_path_1.default.join(dir, HISTORY_FILE));
    return Array.isArray(raw) ? raw : [];
}
/** Newest first, capped. Never throws: history must not fail a run. */
function addHistory(dir, entry) {
    try {
        writeAtomic(node_path_1.default.join(dir, HISTORY_FILE), JSON.stringify([entry, ...readHistory(dir)].slice(0, exports.MAX_HISTORY)));
    }
    catch (_a) {
        // Read-only folder or full disk.
    }
}
function readImportInfo(dir) {
    const r = readJson(node_path_1.default.join(dir, IMPORT_FILE));
    if (!r || !str(r.from) || !str(r.to))
        return null;
    return Object.assign({ from: str(r.from), to: str(r.to), at: typeof r.at === 'number' ? r.at : 0, replaced: r.replaced === true }, (typeof r.replacedAt === 'number' ? { replacedAt: r.replacedAt } : {}));
}
/** Never throws: a note about the import must not fail a scan or a run. */
function writeImportInfo(dir, info) {
    try {
        const file = node_path_1.default.join(dir, IMPORT_FILE);
        if (info)
            writeAtomic(file, JSON.stringify(info));
        else
            node_fs_1.default.rmSync(file, { force: true });
    }
    catch (_a) {
        // Read-only folder or full disk.
    }
}
