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
exports.Job = void 0;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const fallback_1 = require("./fallback");
const logger_1 = require("./logger");
const phpDir_1 = require("./phpDir");
const plan_1 = require("./plan");
const prefilter_1 = require("./prefilter");
const retention_1 = require("./retention");
const urls_1 = require("./urls");
const validate_1 = require("./validate");
const wpRunner_1 = require("./wpRunner");
const MAX_WORKERS = 8;
/** One log line may not be longer than this. A table of one huge value must not flood the app. */
const MAX_LINE = 4000;
function freeBytesOf(dir) {
    try {
        const st = node_fs_1.default.statfsSync(dir);
        return Number(st.bavail) * Number(st.bsize);
    }
    catch (_a) {
        return null;
    }
}
const gb = (n) => `${(n / Math.pow(1024, 3)).toFixed(1)} GB`;
const SNAPSHOT_INTERVAL_MS = 250;
/** Do not trust `elapsed / progress` before this much of the work is done. */
const MIN_PROGRESS_FOR_ETA = 0.03;
const stamp = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
class Job {
    constructor(deps) {
        var _a;
        this.deps = deps;
        this.state = 'idle';
        this.doneWeight = 0;
        this.startedAt = null;
        this.finishedAt = null;
        this.error = null;
        this.backupFile = null;
        this.logFile = new logger_1.FileLog(null);
        this.currentLabel = '';
        this.tablesDone = 0;
        this.replacements = 0;
        /** Process of a phase that is not a step (backup, pre-scan). */
        this.current = null;
        /** Steps that run now, by step index. */
        this.live = new Map();
        this.cancelled = false;
        this.aborting = false;
        /** When the steps started. The ETA ignores the time before it (backup, pre-scan). */
        this.runStartedAt = null;
        this.prescanHandles = [];
        this.skippedValues = false;
        this.lastEmit = 0;
        this.now = (_a = deps.now) !== null && _a !== void 0 ? _a : Date.now;
        // Every WP-CLI command of this run (pre-scan, backup, steps, wp-config, cache) uses the skip flags of the options.
        this.deps = Object.assign(Object.assign({}, deps), { runtime: Object.assign(Object.assign({}, deps.runtime), { skip: (0, validate_1.skipFlagsOf)(deps.opts) }) });
        this.workers = Math.max(1, Math.min(MAX_WORKERS, deps.opts.workers || deps.defaultWorkers || 1));
        this.plan = (0, plan_1.buildPlan)(deps.context, deps.opts, undefined, this.workers);
        this.steps = this.makeSteps();
    }
    makeSteps() {
        return this.plan.steps.map((s) => ({
            index: s.index,
            label: s.pair.label,
            scope: s.scope,
            tables: s.tables.length,
            state: 'pending',
            replacements: 0,
        }));
    }
    get stepCount() {
        return this.plan.steps.length;
    }
    get isActive() {
        return this.state === 'preparing' || this.state === 'running' || this.state === 'cancelling';
    }
    snapshot() {
        const total = this.plan.totalWeight || 1;
        const live = [...this.live.values()];
        const liveBytes = live.reduce((n, l) => n + l.doneBytes, 0);
        const progress = this.state === 'completed' ? 1 : Math.min(1, (this.doneWeight + liveBytes) / total);
        return {
            siteId: this.deps.siteId,
            state: this.state,
            dryRun: this.deps.opts.dryRun,
            steps: this.steps,
            progress,
            startedAt: this.startedAt,
            finishedAt: this.finishedAt,
            estimatedTotalMs: this.estimate(progress),
            currentLabel: live.length === 1
                ? live[0].label
                : live.length > 1
                    ? `${live.length} steps running in parallel`
                    : this.currentLabel,
            activeTables: live.map((l) => l.table).filter(Boolean),
            workers: this.workers,
            tablesDone: this.state === 'completed'
                ? this.plan.tablePasses
                : this.tablesDone + live.reduce((n, l) => n + l.tables, 0),
            tablesTotal: this.plan.tablePasses,
            totalReplacements: this.replacements,
            error: this.error,
            backupFile: this.backupFile,
            logFile: this.logFile.path,
        };
    }
    estimate(progress) {
        var _a;
        if (this.startedAt === null)
            return null;
        if (this.finishedAt !== null)
            return this.finishedAt - this.startedAt;
        if (this.runStartedAt !== null && progress >= MIN_PROGRESS_FOR_ETA) {
            // Time before the steps (backup, pre-scan) is counted once, and only the steps are extrapolated.
            const prep = this.runStartedAt - this.startedAt;
            return prep + (this.now() - this.runStartedAt) / progress;
        }
        return (_a = this.deps.priorEstimateMs) !== null && _a !== void 0 ? _a : null;
    }
    emit(force = false) {
        const t = this.now();
        if (!force && t - this.lastEmit < SNAPSHOT_INTERVAL_MS)
            return;
        this.lastEmit = t;
        this.deps.onSnapshot(this.snapshot());
    }
    log(level, full) {
        const text = full.length > MAX_LINE
            ? `${full.slice(0, MAX_LINE)}… (${full.length - MAX_LINE} more characters)`
            : full;
        const line = { t: this.now(), level, text };
        this.logFile.write(level, line.t, text);
        this.deps.onLog(line);
    }
    setState(s) {
        this.state = s;
        this.emit(true);
    }
    cancel() {
        var _a;
        if (!this.isActive || this.cancelled)
            return;
        this.cancelled = true;
        this.log('warn', 'Cancel requested. Stopping WP-CLI.');
        this.setState('cancelling');
        (_a = this.current) === null || _a === void 0 ? void 0 : _a.kill();
        for (const h of this.prescanHandles)
            h.kill();
        this.killLive();
    }
    killLive() {
        var _a;
        for (const l of this.live.values())
            (_a = l.handle) === null || _a === void 0 ? void 0 : _a.kill();
    }
    fail(message) {
        // Several steps may fail at once. The first message is the cause.
        if (this.error)
            return this.snapshot();
        this.error = message;
        this.finishedAt = this.now();
        this.log('error', message);
        this.setState('failed');
        return this.snapshot();
    }
    /** Runs the job. Whatever goes wrong inside, the job ends as `failed` and never stays active. */
    start() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            try {
                return yield this.execute();
            }
            catch (e) {
                this.aborting = true;
                this.killLive();
                (_a = this.current) === null || _a === void 0 ? void 0 : _a.kill();
                for (const h of this.prescanHandles)
                    h.kill();
                (_b = this.finishedAt) !== null && _b !== void 0 ? _b : (this.finishedAt = this.now());
                return this.fail(`Unexpected error: ${e.message}`);
            }
        });
    }
    execute() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const { opts } = this.deps;
            this.startedAt = this.now();
            this.setState('preparing');
            // Log rotation: remove this add-on's logs and backups older than RETENTION_DAYS.
            // Old logs go at the start. Old backups go only after a run that worked, so the undo is never deleted first.
            const old = (0, retention_1.pruneOld)(this.deps.logDir, retention_1.LOG_PATTERN);
            try {
                node_fs_1.default.mkdirSync(this.deps.logDir, { recursive: true, mode: 0o700 });
                this.logFile = new logger_1.FileLog(node_path_1.default.join(this.deps.logDir, `${opts.dryRun ? 'dry-run' : 'run'}-${stamp(new Date())}.log`));
            }
            catch (_b) {
                this.logFile = new logger_1.FileLog(null);
            }
            this.log('info', `${opts.dryRun ? 'Dry run' : 'Run'} started: ${this.plan.steps.length} step(s), ${this.plan.skippedTables.length} table(s) skipped.`);
            this.log('info', `WordPress path: ${this.deps.runtime.wpPath}`);
            if (old.length)
                this.log('info', `Removed ${old.length} file(s) older than ${retention_1.RETENTION_DAYS} days.`);
            if (this.plan.steps.length === 0)
                return this.fail('No tables match the current settings. Nothing to do.');
            const badRegex = yield this.checkRegex();
            if (badRegex)
                return this.fail(badRegex);
            if (this.cancelled)
                return this.finishCancelled();
            yield this.prescan();
            if (this.cancelled)
                return this.finishCancelled();
            if (this.plan.steps.length === 0) {
                this.finishedAt = this.now();
                this.log('info', 'Nothing to replace: no table contains the search text.');
                this.setState('completed');
                return this.snapshot();
            }
            if (!opts.dryRun && opts.backup) {
                const err = yield this.backup();
                if (err)
                    return this.fail(err);
                if (this.cancelled)
                    return this.finishCancelled();
            }
            this.runStartedAt = this.now();
            this.setState('running');
            const ok = yield this.runSteps();
            if (this.cancelled)
                return this.finishCancelled();
            if (!ok)
                return this.snapshot();
            if (this.deps.context.fallback) {
                if (!opts.dryRun)
                    this.log('warn', 'WP-CLI was not used, so wp-config.php and the object cache were not touched. Check DOMAIN_CURRENT_SITE and flush the cache yourself.');
            }
            else {
                if (!opts.dryRun && this.deps.context.multisite)
                    yield this.fixNetworkConfig();
                if (this.cancelled)
                    return this.finishCancelled();
                if (!opts.dryRun && opts.flushCache)
                    yield this.flush();
            }
            if (this.cancelled)
                return this.finishCancelled();
            if (this.skippedValues) {
                this.log('warn', 'Some values hold PHP objects and were not changed by the fallback. Run again when WP-CLI works.');
            }
            this.finishedAt = this.now();
            this.currentLabel = '';
            this.log('info', `${opts.dryRun ? 'Dry run finished' : 'Finished'}: ${this.replacements} replacement(s) ${opts.dryRun ? 'would be made. Nothing was changed' : 'made'} in ${((this.finishedAt - ((_a = this.startedAt) !== null && _a !== void 0 ? _a : 0)) / 1000).toFixed(1)}s.`);
            if (!opts.dryRun) {
                const oldBackups = (0, retention_1.pruneOld)(this.deps.backupDir, retention_1.BACKUP_PATTERN);
                if (oldBackups.length)
                    this.log('info', `Removed ${oldBackups.length} backup(s) older than ${retention_1.RETENTION_DAYS} days.`);
            }
            this.setState('completed');
            return this.snapshot();
        });
    }
    finishCancelled() {
        this.finishedAt = this.now();
        for (const s of this.steps)
            if (s.state === 'running')
                s.state = 'cancelled';
        this.log('warn', 'Cancelled. Some steps may have changed data. Use the backup to restore.');
        this.setState('cancelled');
        return this.snapshot();
    }
    /**
     * On a big database most tables never contain the domain. One fast pass in MySQL finds the tables and columns
     * that do, so WP-CLI only touches those. Any failure here only costs speed: the run goes on with every table.
     */
    prescan() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const generated = this.plan.steps.filter((s) => !s.pair.user);
            const tables = [
                ...new Map(generated.flatMap((s) => s.tables).map((t) => [t.name, t])).values(),
            ];
            const needles = (0, prefilter_1.needlesFor)(this.deps.opts.pairs);
            const min = (_a = this.deps.prefilterMinBytes) !== null && _a !== void 0 ? _a : prefilter_1.PREFILTER_MIN_BYTES;
            if (needles.length === 0 || tables.reduce((n, t) => n + t.bytes, 0) < min)
                return;
            this.currentLabel = 'Scanning tables for the search text';
            this.log('cmd', `Pre-scan: ${tables.length} table(s), ${gb(tables.reduce((n, t) => n + t.bytes, 0))}, ${this.workers} process(es).`);
            this.emit(true);
            const hits = yield (0, prefilter_1.prefilter)(Object.assign(Object.assign({}, this.deps.runtime), { urlArg: this.deps.context.urlArg }), tables, needles, this.workers, (h) => {
                this.prescanHandles.push(h);
            });
            this.prescanHandles = [];
            if (this.cancelled)
                return;
            if (!hits) {
                this.log('warn', 'The pre-scan failed. The run goes on with every table, which is slower.');
                return;
            }
            this.plan = (0, plan_1.buildPlan)(this.deps.context, this.deps.opts, hits, this.workers);
            this.steps = this.makeSteps();
            this.log('info', `Pre-scan: ${hits.size} of ${tables.length} table(s) contain the search text. ${this.plan.steps.length} step(s) to run.`);
            this.emit(true);
        });
    }
    /**
     * Run steps in order, up to `workers` at a time. A step waits while an earlier unfinished step uses one of its tables,
     * so each table still sees the pairs in the planned order. A barrier step waits for every earlier step and blocks later ones.
     */
    runSteps() {
        return __awaiter(this, void 0, void 0, function* () {
            const pending = [...this.plan.steps];
            const running = new Map();
            const names = new Map(this.plan.steps.map((s) => [s.index, new Set(s.tables.map((t) => t.name))]));
            const clash = (a, b) => {
                var _a, _b, _c, _d, _e;
                if (a.barrier || b.barrier)
                    return true;
                const [small, big] = ((_b = (_a = names.get(a.index)) === null || _a === void 0 ? void 0 : _a.size) !== null && _b !== void 0 ? _b : 0) < ((_d = (_c = names.get(b.index)) === null || _c === void 0 ? void 0 : _c.size) !== null && _d !== void 0 ? _d : 0) ? [a, b] : [b, a];
                const bigSet = names.get(big.index);
                return !!bigSet && [...((_e = names.get(small.index)) !== null && _e !== void 0 ? _e : [])].some((n) => bigSet.has(n));
            };
            let failed = false;
            while (pending.length || running.size) {
                if (!failed && !this.cancelled) {
                    for (let i = 0; i < pending.length && running.size < this.workers;) {
                        const step = pending[i];
                        const blocked = [...running.values()].some((r) => clash(r.step, step)) ||
                            pending.slice(0, i).some((e) => clash(e, step));
                        if (blocked) {
                            i++;
                            continue;
                        }
                        pending.splice(i, 1);
                        const done = this.runStep(step).then((ok) => {
                            running.delete(step.index);
                            if (!ok && !failed) {
                                failed = true;
                                this.aborting = true;
                                this.killLive();
                            }
                        });
                        running.set(step.index, { step, done });
                    }
                }
                if (running.size === 0)
                    break;
                yield Promise.race([...running.values()].map((r) => r.done));
            }
            return !failed && !this.cancelled;
        });
    }
    /** Compile every regex in PHP before any write. A bad pattern must fail the run at step 0. */
    checkRegex() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const seen = new Set();
            for (const s of this.plan.steps) {
                if (!s.pair.regex || seen.has(s.pair.search))
                    continue;
                seen.add(s.pair.search);
                const d = (_a = (0, validate_1.chooseDelimiter)(s.pair.search)) !== null && _a !== void 0 ? _a : '/';
                const flags = (0, plan_1.pairFlags)(s.pair, this.deps.opts);
                const res = yield new Promise((resolve) => {
                    const p = (0, node_child_process_1.spawn)(this.deps.runtime.php, [node_path_1.default.join(phpDir_1.PHP_DIR, 'preg-check.php'), `${d}${s.pair.search}${d}${flags}`], { env: this.deps.runtime.env, windowsHide: true });
                    let out = '';
                    p.stdout.on('data', (b) => {
                        out += b;
                    });
                    p.on('error', () => resolve('ok')); // Cannot check; WP-CLI will check again.
                    p.on('close', () => resolve(out.trim() || 'ok'));
                });
                if (res === 'invalid')
                    return `The regex "${s.pair.search}" is not valid PHP (PCRE) syntax. Nothing was changed.`;
            }
            return null;
        });
    }
    backup() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            node_fs_1.default.mkdirSync(this.deps.backupDir, { recursive: true, mode: 0o700 });
            const file = node_path_1.default.join(this.deps.backupDir, `search-replace-backup-${stamp(new Date())}.sql`);
            // The dump tool writes to this path and follows links. Never write into a file or link that is already there.
            try {
                node_fs_1.default.lstatSync(file);
                return `A file named ${node_path_1.default.basename(file)} already exists. Try again in a second.`;
            }
            catch (_d) {
                // Free.
            }
            // A dump is about as large as the data. Running out of disk half way would waste the time already spent.
            const need = this.deps.context.tables.reduce((n, t) => n + t.bytes, 0);
            const free = ((_a = this.deps.freeBytes) !== null && _a !== void 0 ? _a : freeBytesOf)(this.deps.backupDir);
            if (free !== null && free < need) {
                return `Not enough free disk space for the backup: about ${gb(need)} needed, ${gb(free)} free. Free some space, or turn off "Backup" to continue.`;
            }
            this.currentLabel = 'Creating database backup';
            this.log('cmd', `wp db export ${file}`);
            this.emit(true);
            const onLine = (l, stream) => this.log((0, logger_1.classifyLine)(l, stream), l);
            const useDump = this.deps.opts.fallback && !!((_b = this.deps.runtime.db) === null || _b === void 0 ? void 0 : _b.mysqldump);
            let handle = this.deps.context.fallback && useDump ? (0, fallback_1.dumpDatabase)(this.deps.runtime, file, onLine) : null;
            handle !== null && handle !== void 0 ? handle : (handle = (0, wpRunner_1.spawnWp)(this.deps.runtime, ['db', 'export', file, '--add-drop-table', '--single-transaction'], { onLine }));
            this.current = handle;
            let res = yield handle.promise;
            if (res.code !== 0 && useDump && !this.cancelled && !this.deps.context.fallback) {
                this.log('warn', 'wp db export failed. Trying mysqldump directly.');
                handle = (_c = (0, fallback_1.dumpDatabase)(this.deps.runtime, file, onLine)) !== null && _c !== void 0 ? _c : handle;
                this.current = handle;
                res = yield handle.promise;
            }
            this.current = null;
            if (this.cancelled || res.code !== 0)
                node_fs_1.default.rmSync(file, { force: true }); // A part of a dump must not look like a restore point.
            if (this.cancelled)
                return null;
            if (res.code !== 0) {
                return `Backup failed, so nothing was changed. Free disk space, or turn off "Backup" to continue.\n${(0, wpRunner_1.classifyError)(res.stderr).message}`;
            }
            try {
                node_fs_1.default.chmodSync(file, 0o600); // A dump holds password hashes.
            }
            catch (_e) {
                // Not supported on every system.
            }
            this.backupFile = file;
            this.log('info', `Backup saved: ${file}`);
            return null;
        });
    }
    runStep(step) {
        return __awaiter(this, void 0, void 0, function* () {
            const info = this.steps[step.index];
            info.state = 'running';
            let args;
            try {
                args = (0, plan_1.stepArgs)(step, this.deps.opts, this.deps.context.multisite);
            }
            catch (e) {
                info.state = 'failed';
                this.fail(`Step ${step.index + 1} refused. ${e.message}`);
                return false;
            }
            this.log('cmd', `[${step.index + 1}/${this.plan.steps.length}] ${step.scope}: ${step.pair.label}`);
            const names = new Set(step.tables.map((t) => t.name));
            this.log('cmd', `wp ${args.filter((a) => !names.has(a)).join(' ')} <${step.tables.length} table(s)>`);
            const sizes = new Map(step.tables.map((t) => [t.name, Math.max(t.bytes, 16384)]));
            const lv = {
                label: `${step.scope}: ${step.pair.label}`,
                doneBytes: 0,
                tables: 0,
                table: '',
                handle: null,
                /** Tables WP-CLI finished. A retry must not run them again. */
                finished: new Set(),
            };
            this.live.set(step.index, lv);
            this.emit(true);
            let stepTotal = 0;
            const onLine = (line, stream) => {
                var _a;
                const chk = /^Checking: (.+)\.([^.]+)$/.exec(line);
                if (chk) {
                    if (chk[1] !== lv.table) {
                        // WP-CLI moves to the next table: the one before is finished.
                        if (lv.table) {
                            lv.doneBytes += (_a = sizes.get(lv.table)) !== null && _a !== void 0 ? _a : 0;
                            lv.tables++;
                            lv.finished.add(lv.table);
                        }
                        lv.table = chk[1];
                        this.emit();
                    }
                    return; // Too many lines to show; progress already tells the story.
                }
                const rows = /^(\d+) rows? affected using (SQL|PHP)/.exec(line);
                if (rows) {
                    if (Number(rows[1]) > 0)
                        this.log('info', `${lv.table}: ${line}`);
                    return;
                }
                const total = /(\d+) replacements?/.exec(line);
                if (total && /^(Success|Made|Warning)/.test(line))
                    stepTotal = Number(total[1]);
                // The report: one row per changed column. Shown as a readable line, because it says what changed (or would change).
                const rep = /^(\S+)\t(\S+)\t(\d+)\t(SQL|PHP)$/.exec(line);
                if (rep) {
                    this.log('info', `${rep[1]}.${rep[2]}: ${rep[3]} replacement(s) (${rep[4]})`);
                    return;
                }
                if (/^Table\tColumn\tReplacements\tType$/.test(line))
                    return;
                if (/hold a PHP object/.test(line))
                    this.skippedValues = true;
                this.log((0, logger_1.classifyLine)(line, stream), line);
            };
            const rt = Object.assign(Object.assign({}, this.deps.runtime), { urlArg: this.deps.context.urlArg });
            const canFallback = !!rt.db && this.deps.opts.fallback;
            // When the scan already needed the fallback, WP-CLI cannot work for this site. Do not try it again for every step.
            let usedFallback = canFallback && this.deps.context.fallback === true;
            const start = (fb) => fb
                ? (0, fallback_1.runFallback)(rt, 
                // Tables WP-CLI already finished are not run again: a pair like a.com to a.com/blog would apply twice.
                (0, fallback_1.stepJob)(Object.assign(Object.assign({}, step), { tables: step.tables.filter((t) => !lv.finished.has(t.name)) }), this.deps.opts), onLine)
                : (0, wpRunner_1.spawnWp)(rt, args, { onLine });
            lv.handle = start(usedFallback);
            let res = yield lv.handle.promise;
            if (res.code !== 0 &&
                canFallback &&
                !usedFallback &&
                !this.cancelled &&
                !this.aborting &&
                (0, wpRunner_1.classifyError)(res.stderr).code !== 'BAD_REGEX') {
                this.log('warn', `WP-CLI failed: ${(0, wpRunner_1.classifyError)(res.stderr).message.split('\n').pop()}\nTrying the built-in fallback for this step.`);
                usedFallback = true;
                lv.table = '';
                stepTotal = 0;
                lv.handle = start(true);
                res = yield lv.handle.promise;
            }
            this.live.delete(step.index);
            if (this.cancelled)
                return false;
            // Another step failed and this one was stopped on purpose. That is not a second error.
            if (this.aborting) {
                info.state = 'cancelled';
                return false;
            }
            if (res.code !== 0) {
                info.state = 'failed';
                const e = (0, wpRunner_1.classifyError)(res.stderr);
                this.log('error', `WP-CLI exited with code ${res.code}.`);
                this.fail(`Step ${step.index + 1} failed (${step.scope}: ${step.pair.label}).\n${e.message}\nEarlier steps already ran. Restore the backup to undo them.`);
                return false;
            }
            info.state = 'done';
            info.replacements = stepTotal;
            this.replacements += stepTotal;
            this.doneWeight += step.weight;
            this.tablesDone += step.tables.length;
            this.emit(true);
            return true;
        });
    }
    /**
     * A multisite refuses to load when DOMAIN_CURRENT_SITE does not match the network domain in the database.
     * Point it at the new network domain. Bedrock and other env-based configs are left alone.
     */
    fixNetworkConfig() {
        return __awaiter(this, void 0, void 0, function* () {
            const rt = Object.assign(Object.assign({}, this.deps.runtime), { urlArg: undefined });
            const q = yield (0, wpRunner_1.runWp)(rt, [
                'db',
                'query',
                `SELECT domain FROM \`${this.deps.context.prefix.replace(/`/g, '``')}site\` ORDER BY id LIMIT 1`,
                '--skip-column-names',
            ], { noUrl: true });
            const host = q.stdout.trim().split(/\r?\n/)[0];
            if (q.code !== 0 || !host)
                return;
            // The domain comes from the database and is written into wp-config.php as PHP. Only a plain host may pass.
            if (!(0, urls_1.isSafeHost)(host.replace(/:\d+$/, ''))) {
                this.log('warn', `The network domain in the database ("${host.slice(0, 80)}") is not a plain host name. wp-config.php was not changed.`);
                return;
            }
            const cur = yield (0, wpRunner_1.runWp)(rt, ['config', 'get', 'DOMAIN_CURRENT_SITE'], { noUrl: true });
            if (cur.code !== 0) {
                this.log('info', 'DOMAIN_CURRENT_SITE is not set in wp-config.php (Bedrock or env based). Check it yourself.');
                return;
            }
            if (cur.stdout.trim() === host)
                return;
            const set = yield (0, wpRunner_1.runWp)(rt, ['config', 'set', 'DOMAIN_CURRENT_SITE', host], { noUrl: true });
            this.log(set.code === 0 ? 'info' : 'warn', set.code === 0
                ? `wp-config.php: DOMAIN_CURRENT_SITE changed from ${cur.stdout.trim()} to ${host}.`
                : `Could not update DOMAIN_CURRENT_SITE. Set it to ${host} in wp-config.php.`);
        });
    }
    flush() {
        return __awaiter(this, void 0, void 0, function* () {
            this.currentLabel = 'Flushing cache';
            this.log('cmd', 'wp cache flush');
            // After a multisite run the DB domain changed. Try without --url, then with the old one.
            let res = yield (0, wpRunner_1.runWp)(Object.assign(Object.assign({}, this.deps.runtime), { urlArg: undefined }), ['cache', 'flush']);
            if (res.code !== 0 && this.deps.context.urlArg) {
                res = yield (0, wpRunner_1.runWp)(this.deps.runtime, ['cache', 'flush']);
            }
            if (res.code !== 0) {
                this.log('warn', `Could not flush the cache. Run "wp cache flush" yourself if you use an object cache.\n${(0, wpRunner_1.classifyError)(res.stderr).message}`);
            }
        });
    }
}
exports.Job = Job;
