"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.spawnRaw = spawnRaw;
exports.runFallback = runFallback;
exports.stepJob = stepJob;
exports.fallbackJson = fallbackJson;
exports.dumpDatabase = dumpDatabase;
const node_child_process_1 = require("node:child_process");
const node_path_1 = __importDefault(require("node:path"));
const phpDir_1 = require("./phpDir");
const plan_1 = require("./plan");
const validate_1 = require("./validate");
const wpRunner_1 = require("./wpRunner");
/** Start a process, feed it `stdin`, and collect its output. Passwords go through stdin or env, never the command line. */
function spawnRaw(cmd, args, o) {
    let child = null;
    let cancelled = false;
    const promise = new Promise((resolve) => {
        var _a, _b, _c, _d, _e;
        let stdout = '';
        let stderr = '';
        child = (0, node_child_process_1.spawn)(cmd, args, { env: o.env, cwd: (0, wpRunner_1.neutralCwd)(), windowsHide: true });
        const out = (0, wpRunner_1.lineSplitter)((l) => { var _a; return (_a = o.onLine) === null || _a === void 0 ? void 0 : _a.call(o, l, 'stdout'); });
        const err = (0, wpRunner_1.lineSplitter)((l) => { var _a; return (_a = o.onLine) === null || _a === void 0 ? void 0 : _a.call(o, l, 'stderr'); });
        (_a = child.stdout) === null || _a === void 0 ? void 0 : _a.setEncoding('utf8').on('data', (d) => {
            stdout = (0, wpRunner_1.appendCapped)(stdout, d, 32 * 1024 * 1024);
            out.push(d);
        });
        (_b = child.stderr) === null || _b === void 0 ? void 0 : _b.setEncoding('utf8').on('data', (d) => {
            stderr = (0, wpRunner_1.appendCapped)(stderr, d, 1024 * 1024);
            err.push(d);
        });
        child.on('error', (e) => resolve({ code: -1, stdout, stderr: `${stderr}\n${e.message}`, cancelled }));
        child.on('close', (code) => {
            out.end();
            err.end();
            resolve({ code, stdout, stderr, cancelled });
        });
        // A broken pipe (PHP exited early) must not crash the main process.
        (_c = child.stdin) === null || _c === void 0 ? void 0 : _c.on('error', () => undefined);
        (_d = child.stdin) === null || _d === void 0 ? void 0 : _d.end((_e = o.stdin) !== null && _e !== void 0 ? _e : '');
    });
    return {
        promise,
        kill: () => {
            cancelled = true;
            child === null || child === void 0 ? void 0 : child.kill();
        },
    };
}
/** Run `php/fallback.php` with one job. Same PHP binary and environment as WP-CLI, without the phar. */
function runFallback(rt, job, onLine) {
    return spawnRaw(rt.php, ['-d', 'memory_limit=-1', node_path_1.default.join(phpDir_1.PHP_DIR, 'fallback.php')], {
        env: rt.env,
        stdin: JSON.stringify(Object.assign(Object.assign({}, job), { db: rt.db })),
        onLine,
    });
}
/** The job for one plan step: the same pair, tables and flags the WP-CLI step would use. */
function stepJob(step, opts) {
    var _a, _b;
    const regex = step.pair.regex;
    const d = (_a = (0, validate_1.chooseDelimiter)(step.pair.search)) !== null && _a !== void 0 ? _a : '/';
    return {
        mode: 'replace',
        tables: step.tables.map((t) => t.name),
        search: step.pair.search,
        replace: step.pair.replace,
        regex,
        pattern: regex ? `${d}${step.pair.search}${d}${(0, plan_1.pairFlags)(step.pair, opts)}` : '',
        dryRun: opts.dryRun,
        skipColumns: (0, validate_1.skipColumnsOf)(opts),
        includeColumns: (_b = step.includeColumns) !== null && _b !== void 0 ? _b : null,
    };
}
/** Read the site layout or the domain list without WP-CLI. `null` when the fallback cannot do it either. */
function fallbackJson(rt, job) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const res = yield runFallback(rt, job).promise;
        if (res.code !== 0)
            return { data: null, error: (_a = res.stderr.trim().split(/\r?\n/)[0]) !== null && _a !== void 0 ? _a : 'Fallback failed.' };
        return { data: (0, wpRunner_1.extractJson)(res.stdout), error: '' };
    });
}
/** Database dump with the `mysqldump` of the site, when WP-CLI cannot make the backup. */
function dumpDatabase(rt, file, onLine) {
    const db = rt.db;
    if (!(db === null || db === void 0 ? void 0 : db.mysqldump))
        return null;
    const conn = db.socket
        ? [`--socket=${db.socket}`]
        : [`--host=${db.host}`, `--port=${db.port}`, '--protocol=tcp'];
    return spawnRaw(db.mysqldump, [
        '--no-defaults',
        ...conn,
        `--user=${db.user}`,
        '--add-drop-table',
        '--single-transaction',
        '--default-character-set=utf8mb4',
        `--result-file=${file}`,
        db.name,
    ], { env: Object.assign(Object.assign({}, rt.env), { MYSQL_PWD: db.password }), onLine });
}
