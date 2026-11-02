"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.neutralCwd = neutralCwd;
exports.appendCapped = appendCapped;
exports.buildArgv = buildArgv;
exports.lineSplitter = lineSplitter;
exports.spawnWp = spawnWp;
exports.runWp = runWp;
exports.extractJson = extractJson;
exports.classifyError = classifyError;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
/** Largest output kept in memory per process. Lines are still passed on live. */
const MAX_STDOUT = 32 * 1024 * 1024;
const MAX_STDERR = 1024 * 1024;
/**
 * WP-CLI reads `wp-cli.yml` from the working directory and every parent of it, and that file can `require:` PHP files.
 * An imported site must not get to run code that way, so WP-CLI starts in an empty folder of our own.
 * `--path` already says where WordPress is.
 */
function neutralCwd() {
    const dir = node_path_1.default.join(node_os_1.default.tmpdir(), 'local-addon-search-replace-cwd');
    try {
        node_fs_1.default.mkdirSync(dir, { recursive: true, mode: 0o700 });
        return dir;
    }
    catch (_a) {
        return node_os_1.default.tmpdir();
    }
}
function appendCapped(buf, chunk, max) {
    return buf.length >= max ? buf : buf + chunk.slice(0, max - buf.length);
}
function buildArgv(rt, args, opts = {}) {
    var _a, _b, _c;
    const argv = ['-d', 'memory_limit=-1', rt.wpCliPhar, `--path=${rt.wpPath}`];
    if (rt.urlArg && !opts.noUrl)
        argv.push(`--url=${rt.urlArg}`);
    if (!opts.loadExtensions) {
        if (((_a = rt.skip) === null || _a === void 0 ? void 0 : _a.plugins) !== false)
            argv.push('--skip-plugins');
        if (((_b = rt.skip) === null || _b === void 0 ? void 0 : _b.themes) !== false)
            argv.push('--skip-themes');
    }
    if (((_c = rt.skip) === null || _c === void 0 ? void 0 : _c.packages) !== false)
        argv.push('--skip-packages');
    return [...argv, ...args];
}
/** Splits a byte stream into lines, keeping partial lines between chunks. */
function lineSplitter(onLine) {
    let buf = '';
    return {
        push(chunk) {
            var _a;
            buf += chunk;
            const parts = buf.split(/\r?\n/);
            buf = (_a = parts.pop()) !== null && _a !== void 0 ? _a : '';
            for (const p of parts)
                onLine(p);
        },
        end() {
            if (buf)
                onLine(buf);
            buf = '';
        },
    };
}
function spawnWp(rt, args, opts = {}) {
    let child = null;
    let cancelled = false;
    const promise = new Promise((resolve) => {
        var _a, _b;
        let stdout = '';
        let stderr = '';
        child = (0, node_child_process_1.spawn)(rt.php, buildArgv(rt, args, opts), {
            env: rt.env,
            cwd: neutralCwd(),
            windowsHide: true,
        });
        const out = lineSplitter((l) => { var _a; return (_a = opts.onLine) === null || _a === void 0 ? void 0 : _a.call(opts, l, 'stdout'); });
        const err = lineSplitter((l) => { var _a; return (_a = opts.onLine) === null || _a === void 0 ? void 0 : _a.call(opts, l, 'stderr'); });
        (_a = child.stdout) === null || _a === void 0 ? void 0 : _a.setEncoding('utf8').on('data', (d) => {
            stdout = appendCapped(stdout, d, MAX_STDOUT);
            out.push(d);
        });
        (_b = child.stderr) === null || _b === void 0 ? void 0 : _b.setEncoding('utf8').on('data', (d) => {
            stderr = appendCapped(stderr, d, MAX_STDERR);
            err.push(d);
        });
        child.on('error', (e) => {
            stderr += `\n${e.message}`;
            resolve({ code: -1, stdout, stderr, cancelled });
        });
        child.on('close', (code) => {
            out.end();
            err.end();
            resolve({ code, stdout, stderr, cancelled });
        });
    });
    return {
        promise,
        kill: () => {
            cancelled = true;
            child === null || child === void 0 ? void 0 : child.kill();
        },
    };
}
function runWp(rt, args, opts = {}) {
    return spawnWp(rt, args, opts).promise;
}
/** Pull the JSON payload printed between our markers. PHP notices around it are ignored. */
function extractJson(stdout) {
    const m = /@@SR_JSON@@([\s\S]*?)@@SR_END@@/.exec(stdout);
    if (!m)
        return null;
    try {
        return JSON.parse(m[1]);
    }
    catch (_a) {
        return null;
    }
}
/** Turn raw WP-CLI/PHP errors into advice a person can act on. */
function classifyError(stderr) {
    const s = stderr.trim();
    const rules = [
        [
            /Error establishing a database connection|Can't connect to|Connection refused|No such file or directory.*(sock|mysql)|mysqli_real_connect|Unknown database|Access denied for user/i,
            {
                code: 'DB_DOWN',
                message: 'The database is not reachable. Start the site in Local and try again.',
            },
        ],
        [
            /doesn't seem to be a WordPress installation|wp-load\.php/i,
            {
                code: 'NO_WP',
                message: 'WordPress was not found. Set the WordPress path in Advanced options.',
            },
        ],
        [
            /is not installed|ms_not_installed/i,
            {
                code: 'NOT_INSTALLED',
                message: 'WordPress is not installed in this database. Import the database first.',
            },
        ],
        [
            /Site '.*' not found|Verify DOMAIN_CURRENT_SITE|--url=/i,
            {
                code: 'SITE_URL',
                message: 'WordPress could not match the site domain. Check DOMAIN_CURRENT_SITE in wp-config.php.',
            },
        ],
        [
            /Allowed memory size|Out of memory/i,
            {
                code: 'MEMORY',
                message: 'PHP ran out of memory. Turn off "Precise" mode or skip very large tables.',
            },
        ],
        [/regex pattern/i, { code: 'BAD_REGEX', message: 'A regex pattern is not valid.' }],
    ];
    for (const [re, e] of rules)
        if (re.test(s))
            return Object.assign(Object.assign({}, e), { message: `${e.message}\n${firstLine(s)}` });
    return { code: 'UNKNOWN', message: firstLine(s) || 'WP-CLI failed without a message.' };
}
const firstLine = (s) => {
    var _a, _b;
    return (_b = (_a = s.split(/\r?\n/).find((l) => /^(Error|PHP|Warning|Fatal)/i.test(l.trim()))) !== null && _a !== void 0 ? _a : s.split(/\r?\n/)[0]) !== null && _b !== void 0 ? _b : '';
};
