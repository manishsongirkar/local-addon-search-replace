"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileLog = void 0;
exports.classifyLine = classifyLine;
const node_fs_1 = __importDefault(require("node:fs"));
const retention_1 = require("./retention");
/**
 * Sort one line of WP-CLI or PHP output into a log level.
 * PHP prints `Warning:`, `Notice:` and `Deprecated:` (often with a `PHP ` prefix) on either stream.
 */
function classifyLine(line, stream = 'stdout') {
    const l = line.trim();
    if (/^(PHP )?(Fatal error|Parse error)|^Error:/i.test(l))
        return 'error';
    if (/^(PHP )?(Notice|Deprecated|Strict Standards)\b/i.test(l))
        return 'notice';
    if (/^(PHP )?Warning\b/i.test(l))
        return 'warn';
    return stream === 'stderr' ? 'warn' : 'info';
}
/** Append-only log file with a size cap. Never throws: a full disk must not stop a run. */
class FileLog {
    constructor(file, max = retention_1.MAX_LOG_BYTES) {
        this.file = file;
        this.max = max;
        this.bytes = 0;
        // A link planted at this name would make us append to some other file. Use a real file or nothing.
        if (file) {
            try {
                const st = node_fs_1.default.lstatSync(file);
                if (st.isSymbolicLink() || !st.isFile())
                    this.file = null;
            }
            catch (_a) {
                // Does not exist yet: fine.
            }
        }
    }
    get path() {
        return this.file;
    }
    write(level, t, text) {
        if (!this.file)
            return;
        const stamp = new Date(t).toISOString();
        // One row per line, so text from the database cannot fake a log row and the viewer can read every row.
        const row = text
            .split(/\r?\n/)
            .map((l) => `${stamp} [${level}] ${l}\n`)
            .join('');
        try {
            if (this.bytes + row.length <= this.max) {
                node_fs_1.default.appendFileSync(this.file, row, { mode: 0o600 });
                this.bytes += row.length;
            }
            else if (this.bytes <= this.max) {
                node_fs_1.default.appendFileSync(this.file, `${stamp} [warn] Log file limit reached. Later lines are only shown in the app.\n`);
                this.bytes = this.max + 1;
            }
        }
        catch (_a) {
            // Ignore.
        }
    }
}
exports.FileLog = FileLog;
