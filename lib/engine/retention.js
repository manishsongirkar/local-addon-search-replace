"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BACKUP_PATTERN = exports.LOG_PATTERN = exports.MAX_LOG_BYTES = exports.RETENTION_DAYS = void 0;
exports.pruneOld = pruneOld;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
exports.RETENTION_DAYS = 30;
/** One run log may not grow past this. The app still shows every line live. */
exports.MAX_LOG_BYTES = 10 * 1024 * 1024;
/**
 * Delete files in `dir` whose name matches `pattern` and that are older than `days`.
 * Returns the names removed. Never throws: clean-up must not break a run.
 */
function pruneOld(dir, pattern, days = exports.RETENTION_DAYS, now = Date.now()) {
    const removed = [];
    let names;
    try {
        names = node_fs_1.default.readdirSync(dir);
    }
    catch (_a) {
        return removed;
    }
    const limit = now - days * 24 * 60 * 60 * 1000;
    for (const name of names) {
        if (!pattern.test(name))
            continue;
        const file = node_path_1.default.join(dir, name);
        try {
            const st = node_fs_1.default.statSync(file);
            if (st.isFile() && st.mtimeMs < limit) {
                node_fs_1.default.unlinkSync(file);
                removed.push(name);
            }
        }
        catch (_b) {
            // In use or already gone.
        }
    }
    return removed;
}
exports.LOG_PATTERN = /^(run|dry-run)-\d{8}-\d{6}\.log$|^activity-\d{8}\.log$/;
exports.BACKUP_PATTERN = /^search-replace-backup-\d{8}-\d{6}\.sql$/;
