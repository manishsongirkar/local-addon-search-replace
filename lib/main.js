"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
exports.default = main;
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const LocalMain = __importStar(require("@getflywheel/local/main"));
const types_1 = require("./common/types");
const dbconn_1 = require("./engine/dbconn");
const env_1 = require("./engine/env");
const fingerprint_1 = require("./engine/fingerprint");
const importInfo_1 = require("./engine/importInfo");
const localurl_1 = require("./engine/localurl");
const logger_1 = require("./engine/logger");
const reconcile_1 = require("./engine/reconcile");
const retention_1 = require("./engine/retention");
const runner_1 = require("./engine/runner");
const scan_1 = require("./engine/scan");
const siteStart_1 = require("./engine/siteStart");
const store_1 = require("./engine/store");
const urls_1 = require("./engine/urls");
const validate_1 = require("./engine/validate");
const wpPath_1 = require("./engine/wpPath");
const MAX_LOG_LINES = 2000;
/** Largest part of a saved log the app loads. The newest lines are kept. */
const MAX_READ_BYTES = 2 * 1024 * 1024;
/** Everything is keyed by the Local site id. Two sites never share a job, a log, a scan or a config. */
const states = new Map();
const stateOf = (id) => {
    const known = states.get(id);
    if (known)
        return known;
    const s = {
        job: null,
        snapshot: null,
        logs: [],
        scan: null,
        context: null,
        localHost: '',
        fingerprint: null,
        activity: null,
        activityDay: '',
        busy: false,
    };
    states.set(id, s);
    return s;
};
const services = () => LocalMain.getServiceContainer().cradle;
function getSite(siteId) {
    const site = services().siteData.getSite(siteId);
    if (!site)
        throw new scan_1.EngineError('NO_SITE', 'This site was not found in Local.');
    return site;
}
/** Folder for this add-on's backups, logs, config and history, inside the site folder. */
const dataDir = (site, ...sub) => node_path_1.default.join(site.path, 'search-replace', ...sub);
/** Number of parallel WP-CLI processes when the user leaves "workers" at 0. */
const defaultWorkers = () => Math.min(4, Math.max(1, Math.floor(node_os_1.default.cpus().length / 2)));
const pushLog = (siteId, line) => {
    const st = stateOf(siteId);
    st.logs.push(line);
    if (st.logs.length > MAX_LOG_LINES)
        st.logs.splice(0, st.logs.length - MAX_LOG_LINES);
    LocalMain.sendIPCEvent(types_1.CH.log, siteId, line);
};
/**
 * Log for work outside a run (scan, reading files). One file per day, so a problem found while scanning
 * is still on disk after the app is closed. Old files are removed by the 30 day rotation.
 */
function activity(siteId, level, text) {
    const t = Date.now();
    pushLog(siteId, { t, level, text });
    try {
        const st = stateOf(siteId);
        const day = new Date(t).toISOString().slice(0, 10).replace(/-/g, '');
        if (!st.activity || st.activityDay !== day) {
            const dir = dataDir(getSite(siteId), 'logs');
            node_fs_1.default.mkdirSync(dir, { recursive: true, mode: 0o700 });
            st.activity = new logger_1.FileLog(node_path_1.default.join(dir, `activity-${day}.log`));
            st.activityDay = day;
        }
        st.activity.write(level, t, text);
    }
    catch (_a) {
        // Logging must never break the action it describes.
    }
}
/** How the PHP fallback reaches this site's database, whatever engine the site uses. */
function connFor(site, db, wpPath) {
    var _a, _b, _c, _d;
    const readConfig = () => {
        for (const dir of [site.paths.webRoot, wpPath, node_path_1.default.dirname(wpPath)]) {
            try {
                return node_fs_1.default.readFileSync(node_path_1.default.join(dir, 'wp-config.php'), 'utf8');
            }
            catch (_a) {
                // Not here. Bedrock keeps its settings elsewhere.
            }
        }
        return undefined;
    };
    const listed = Object.values((_a = site.services) !== null && _a !== void 0 ? _a : {}).find((s) => s.role === 'db');
    return (0, dbconn_1.chooseDbConn)({
        creds: site.mysql,
        socket: db === null || db === void 0 ? void 0 : db.socket,
        port: db === null || db === void 0 ? void 0 : db.port,
        listedPorts: listed === null || listed === void 0 ? void 0 : listed.ports,
        mysqldump: (_c = (_b = db === null || db === void 0 ? void 0 : db.bin) === null || _b === void 0 ? void 0 : _b.mysqldump) !== null && _c !== void 0 ? _c : (_d = db === null || db === void 0 ? void 0 : db.bin) === null || _d === void 0 ? void 0 : _d['mariadb-dump'],
        wpConfig: readConfig(),
    });
}
/**
 * The URL to suggest as the new domain. Local's own `site.url` is always `http://`, so SSL is added from the certificate:
 * a trusted certificate means the site is served on https. A slow or failing check never blocks the scan: it means http.
 */
function localUrlOf(siteId, site) {
    return __awaiter(this, void 0, void 0, function* () {
        let trusted = false;
        try {
            const answer = yield Promise.race([
                services().x509Cert.certificateTrustStatus(site),
                new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
            ]);
            trusted = answer === true;
        }
        catch (e) {
            activity(siteId, 'warn', `Could not check the SSL certificate: ${e.message}`);
        }
        const url = (0, localurl_1.withSsl)(site.url, trusted);
        activity(siteId, 'info', `Local URL: ${url} (${trusted ? 'SSL certificate is trusted' : 'no trusted SSL certificate'})`);
        return url;
    });
}
/** WP-CLI the way Local starts it: Local's PHP, its WP-CLI phar, and the PATH of its PHP and database services. */
function buildRuntime(site, wpPathOverride, fallback) {
    var _a;
    const { lightningServices, electron } = services();
    const php = lightningServices.getSiteServiceByRole(site, 'php');
    const db = lightningServices.getSiteServiceByRole(site, 'db');
    const phpBin = (_a = php === null || php === void 0 ? void 0 : php.bin) === null || _a === void 0 ? void 0 : _a.php;
    if (!php || !phpBin)
        throw new scan_1.EngineError('NO_PHP', 'The PHP service of this site was not found. Start the site in Local.');
    const resources = process.resourcesPath;
    const phar = (0, env_1.findWpCliPhar)([
        node_path_1.default.join(resources, 'extraResources'),
        resources,
        node_path_1.default.join(electron.app.getAppPath(), '..', 'extraResources'),
        node_path_1.default.join(electron.app.getAppPath(), 'extraResources'),
    ]);
    // A missing phar is exactly the case the fallback is for. Without a fallback it is an error.
    if (!phar && !fallback)
        throw new scan_1.EngineError('NO_WPCLI', 'WP-CLI was not found in this Local install.');
    const resolved = (0, wpPath_1.resolveWpPath)(site.paths.webRoot, wpPathOverride);
    if (!resolved) {
        throw new scan_1.EngineError('NO_WP', 'WordPress was not found. Set the WordPress path in Advanced options.');
    }
    // WP-CLI runs the wp-config.php and the code of this folder. It must be part of this Local site.
    if (!(0, wpPath_1.isInside)(site.path, resolved.path)) {
        throw new scan_1.EngineError('OUTSIDE', `The WordPress path (${resolved.path}) is outside the folder of this site. Choose a folder inside ${site.path}.`);
    }
    return {
        php: phpBin,
        wpCliPhar: phar !== null && phar !== void 0 ? phar : node_path_1.default.join(resources, 'missing-wp-cli.phar'),
        wpPath: resolved.path,
        db: fallback ? connFor(site, db, resolved.path) : undefined,
        env: (0, env_1.buildWpEnv)({
            base: process.env,
            phpEnv: php.env,
            servicePaths: [php.$PATH, db === null || db === void 0 ? void 0 : db.$PATH],
            // Local names these folders after the service (`conf/mysql` or `conf/mariadb`), so ask the service.
            phpIniDir: (0, dbconn_1.serviceConfDir)(site.paths.conf, php, 'php'),
            mysqlHome: (0, dbconn_1.serviceConfDir)(site.paths.conf, db, 'mysql'),
            wpConfigPath: node_path_1.default.join(site.paths.webRoot, 'wp-config.php'),
        }),
    };
}
/** The fingerprint of the site database, read directly (no WP-CLI, no WordPress). `null` when it cannot be reached. */
function fingerprintOf(site, wpPath) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            return yield (0, fingerprint_1.readFingerprint)(buildRuntime(site, wpPath, true));
        }
        catch (_a) {
            return null;
        }
    });
}
/**
 * Did the database change since the last scan, by an import with any tool or by a new site URL?
 * The page asks when it opens and when you come back to Local. A change makes it scan again.
 */
function check(siteId_1) {
    return __awaiter(this, arguments, void 0, function* (siteId, wpPath = '') {
        var _a;
        const site = getSite(siteId);
        const st = stateOf(siteId);
        if (st.busy || ((_a = st.job) === null || _a === void 0 ? void 0 : _a.isActive))
            return { changed: false, reason: '' };
        const next = yield fingerprintOf(site, wpPath);
        // Without a reading, nothing can be compared. A site never scanned in this session is still scanned.
        const change = next
            ? (0, fingerprint_1.compareFingerprints)(st.fingerprint, next)
            : { changed: !st.scan, reason: st.scan ? '' : 'This site was not scanned in this session.' };
        if (change.changed && st.scan)
            activity(siteId, 'info', `Database change found. ${change.reason} Scanning again.`);
        return change;
    });
}
function scan(siteId_1, wpPath_2, current_1) {
    return __awaiter(this, arguments, void 0, function* (siteId, wpPath, current, startSite = false) {
        const site = getSite(siteId);
        const st = stateOf(siteId);
        if (st.busy)
            throw new scan_1.EngineError('BUSY', 'A scan or a run is already starting for this site.');
        st.busy = true;
        // The form may hold edits that are not saved yet. Reconcile with what the user sees, not with an older file.
        const saved = current
            ? { pairs: (0, store_1.cleanPairs)(current.pairs), options: (0, store_1.cleanOptions)(current.options) }
            : (0, store_1.loadConfig)(dataDir(site));
        activity(siteId, 'cmd', 'Scan started.');
        try {
            // Only a click on "Scan site" starts a stopped site. The scan that runs by itself when the page opens never does.
            if (startSite) {
                const { siteProcessManager, siteDatabase } = services();
                yield (0, siteStart_1.startIfHalted)(siteProcessManager, siteDatabase, site, (level, text) => activity(siteId, level, text));
            }
            const rt = Object.assign(Object.assign({}, buildRuntime(site, wpPath || saved.options.wpPath, saved.options.fallback)), { skip: (0, validate_1.skipFlagsOf)(saved.options) });
            activity(siteId, 'info', `WordPress path: ${rt.wpPath}`);
            // Taken before the scan, so a change during the scan is seen at the next check.
            const fingerprint = yield fingerprintOf(site, wpPath || saved.options.wpPath);
            const context = yield (0, scan_1.loadContext)(rt);
            if (context.fallback) {
                activity(siteId, 'warn', 'WP-CLI could not run for this site. The built-in PHP/MySQL fallback read the database instead.');
            }
            const localUrl = yield localUrlOf(siteId, site);
            const candidates = yield (0, scan_1.scanDomains)(rt, context, localUrl);
            // A change of the tables since the last scan in this session is an import.
            const tablesChanged = !!(st.fingerprint &&
                fingerprint &&
                st.fingerprint.tables !== fingerprint.tables);
            const prevImport = (0, store_1.readImportInfo)(dataDir(site));
            const importInfo = (0, importInfo_1.nextImportInfo)(prevImport, candidates, tablesChanged);
            if (importInfo !== prevImport)
                (0, store_1.writeImportInfo)(dataDir(site), importInfo);
            // Check the saved list against the database now, and save the result.
            const { pairs, added, removed } = (0, reconcile_1.reconcilePairs)(saved.pairs, candidates);
            if (added.length || removed.length || current)
                (0, store_1.saveConfig)(dataDir(site), Object.assign(Object.assign({}, saved), { pairs }));
            const result = {
                context,
                candidates,
                pairs,
                added,
                removed,
                localUrl,
                localHost: (0, urls_1.hostOf)(localUrl),
                importInfo,
            };
            Object.assign(st, { scan: result, context, localHost: result.localHost, fingerprint });
            activity(siteId, 'info', `Scan finished: ${context.tables.length} table(s), ${context.blogs.length} site(s), ${candidates.length} domain(s). Added ${added.length}, removed ${removed.length}.`);
            for (const d of removed)
                activity(siteId, 'info', `Removed from the saved list (not in the database any more): ${d}`);
            return result;
        }
        catch (e) {
            activity(siteId, 'error', `Scan failed: ${e.message}`);
            throw e;
        }
        finally {
            st.busy = false;
        }
    });
}
function issuesFor(siteId, options) {
    const opts = (0, validate_1.allTablesOnly)(options);
    const st = stateOf(siteId);
    return (0, validate_1.validate)(opts, {
        localHost: st.localHost || (0, urls_1.hostOf)(getSite(siteId).url),
        // Unknown (empty) until the site layout was read once. The validation then skips the checks that need it.
        dbHosts: st.context
            ? st.context.blogs.map((b) => (0, urls_1.hostOf)(b.siteurl || b.home)).filter(Boolean)
            : [],
    });
}
function start(siteId, options) {
    return __awaiter(this, void 0, void 0, function* () {
        const opts = (0, validate_1.allTablesOnly)(options);
        const kind = opts.dryRun ? 'Dry run' : 'Run';
        try {
            yield prepareAndStart(siteId, opts);
        }
        catch (e) {
            // Every refusal is written to the log, so the Logs tab explains why nothing started.
            activity(siteId, 'error', `${kind} not started: ${e.message}`);
            throw e;
        }
    });
}
function prepareAndStart(siteId, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const st = stateOf(siteId);
        if ((_a = st.job) === null || _a === void 0 ? void 0 : _a.isActive)
            throw new scan_1.EngineError('BUSY', 'A run is already active for this site.');
        if (st.busy)
            throw new scan_1.EngineError('BUSY', 'A scan or a run is already starting for this site.');
        const site = getSite(siteId);
        const history = (0, store_1.readHistory)(dataDir(site));
        st.busy = true;
        let runtime;
        let context;
        try {
            runtime = Object.assign(Object.assign({}, buildRuntime(site, opts.wpPath, opts.fallback)), { skip: (0, validate_1.skipFlagsOf)(opts) });
            // The tables are read again at every start: they may have changed (import, clone, a plugin). A scan in this
            // session is not needed: after a restart of Local the saved rows are there, and a run must still work.
            try {
                context = yield (0, scan_1.loadContext)(runtime);
                st.context = context;
                st.localHost = st.localHost || (0, urls_1.hostOf)(site.url);
            }
            catch (e) {
                if (!st.context)
                    throw e;
                activity(siteId, 'warn', `Could not refresh the table list. The last one is used. ${e.message}`);
                context = st.context;
            }
        }
        finally {
            st.busy = false;
        }
        const errors = issuesFor(siteId, opts).filter((i) => i.level === 'error');
        if (errors.length) {
            throw new scan_1.EngineError('INVALID', `Fix this before you run: ${errors.map((i) => i.message).join(' ')}`);
        }
        activity(siteId, 'cmd', `${opts.dryRun ? 'Dry run' : 'Run'} requested.`);
        const job = new runner_1.Job({
            siteId,
            runtime,
            context,
            opts,
            backupDir: dataDir(site, 'backups'),
            logDir: dataDir(site, 'logs'),
            defaultWorkers: defaultWorkers(),
            priorEstimateMs: (_c = (_b = history.find((h) => h.dryRun && h.state === 'completed')) === null || _b === void 0 ? void 0 : _b.durationMs) !== null && _c !== void 0 ? _c : null,
            onSnapshot: (snap) => {
                st.snapshot = snap;
                LocalMain.sendIPCEvent(types_1.CH.snapshot, snap);
            },
            onLog: (line) => pushLog(siteId, line),
        });
        st.job = job;
        void job
            .start()
            .then((snap) => {
            var _a, _b, _c;
            if (snap.state === 'completed' && !snap.dryRun) {
                const before = (0, store_1.readImportInfo)(dataDir(site));
                const after = (0, importInfo_1.markReplaced)(before, opts.pairs);
                if (after !== before)
                    (0, store_1.writeImportInfo)(dataDir(site), after);
            }
            (0, store_1.addHistory)(dataDir(site), {
                id: `${snap.startedAt}`,
                at: (_a = snap.startedAt) !== null && _a !== void 0 ? _a : Date.now(),
                dryRun: snap.dryRun,
                state: snap.state,
                durationMs: ((_b = snap.finishedAt) !== null && _b !== void 0 ? _b : Date.now()) - ((_c = snap.startedAt) !== null && _c !== void 0 ? _c : Date.now()),
                replacements: snap.totalReplacements,
                pairs: opts.pairs
                    .filter((p) => p.enabled)
                    .map(({ search, replace, regex }) => ({ search, replace, regex })),
                backupFile: snap.backupFile,
                logFile: snap.logFile,
            });
        })
            .catch((e) => {
            var _a;
            // Job.start reports its own failures. This only catches a bug.
            activity(siteId, 'error', `Unexpected error: ${(_a = e.stack) !== null && _a !== void 0 ? _a : e.message}`);
        });
    });
}
function logFiles(siteId) {
    const dir = dataDir(getSite(siteId), 'logs');
    let names;
    try {
        names = node_fs_1.default.readdirSync(dir);
    }
    catch (_a) {
        return [];
    }
    return names
        .filter((n) => retention_1.LOG_PATTERN.test(n))
        .map((name) => {
        try {
            const st = node_fs_1.default.lstatSync(node_path_1.default.join(dir, name));
            return st.isFile() ? { name, bytes: st.size, mtime: st.mtimeMs } : null;
        }
        catch (_a) {
            return null;
        }
    })
        .filter((f) => f !== null)
        .sort((a, b) => b.mtime - a.mtime);
}
/** Text of one saved log. The name must be one of our own log names, so it can never point outside the folder. */
function readLog(siteId, name) {
    if (!retention_1.LOG_PATTERN.test(name))
        throw new scan_1.EngineError('BAD_NAME', 'This is not a log file of the add-on.');
    const file = node_path_1.default.join(dataDir(getSite(siteId), 'logs'), name);
    // Only a real file of ours. A link or a pipe planted under a log name is refused.
    const info = node_fs_1.default.lstatSync(file);
    if (!info.isFile())
        throw new scan_1.EngineError('BAD_NAME', 'This is not a log file of the add-on.');
    const size = info.size;
    const fd = node_fs_1.default.openSync(file, 'r');
    try {
        const len = Math.min(size, MAX_READ_BYTES);
        const buf = Buffer.alloc(len);
        node_fs_1.default.readSync(fd, buf, 0, len, size - len);
        const text = buf.toString('utf8');
        return size > len
            ? `[Only the last ${MAX_READ_BYTES / 1024 / 1024} MB are shown.]\n${text.slice(text.indexOf('\n') + 1)}`
            : text;
    }
    finally {
        node_fs_1.default.closeSync(fd);
    }
}
function main() {
    const { addIpcAsyncListener } = LocalMain;
    addIpcAsyncListener(types_1.CH.scan, (siteId, wpPath = '', current, startSite = false) => scan(siteId, wpPath, current, startSite === true));
    addIpcAsyncListener(types_1.CH.check, (siteId, wpPath = '') => check(siteId, wpPath));
    addIpcAsyncListener(types_1.CH.validate, (siteId, opts) => issuesFor(siteId, opts));
    addIpcAsyncListener(types_1.CH.start, (siteId, opts) => start(siteId, opts));
    addIpcAsyncListener(types_1.CH.cancel, (siteId) => {
        var _a;
        getSite(siteId);
        (_a = stateOf(siteId).job) === null || _a === void 0 ? void 0 : _a.cancel();
    });
    addIpcAsyncListener(types_1.CH.state, (siteId) => {
        getSite(siteId);
        const { snapshot, logs } = stateOf(siteId);
        return { snapshot, logs };
    });
    addIpcAsyncListener(types_1.CH.history, (siteId) => (0, store_1.readHistory)(dataDir(getSite(siteId))));
    addIpcAsyncListener(types_1.CH.loadConfig, (siteId) => {
        const dir = dataDir(getSite(siteId));
        return Object.assign(Object.assign({}, (0, store_1.loadConfig)(dir)), { importInfo: (0, store_1.readImportInfo)(dir) });
    });
    addIpcAsyncListener(types_1.CH.saveConfig, (siteId, cfg) => (0, store_1.saveConfig)(dataDir(getSite(siteId)), cfg));
    addIpcAsyncListener(types_1.CH.logFiles, (siteId) => logFiles(siteId));
    addIpcAsyncListener(types_1.CH.readLog, (siteId, name) => readLog(siteId, name));
    addIpcAsyncListener(types_1.CH.openFolder, (siteId) => __awaiter(this, void 0, void 0, function* () {
        const dir = dataDir(getSite(siteId), 'logs');
        node_fs_1.default.mkdirSync(dir, { recursive: true });
        yield services().electron.shell.openPath(dir);
    }));
}
