"use strict";
/** Types shared by the main process, the engine and the renderer. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_TABLES_NOTICE = exports.CH = exports.DEFAULT_OPTIONS = void 0;
exports.DEFAULT_OPTIONS = {
    dryRun: false,
    backup: true,
    allTables: true,
    precise: false,
    skipColumns: '',
    skipTables: '',
    includeVariants: true,
    protectEmails: true,
    regexFlags: '',
    flushCache: true,
    wpPath: '',
    caseSensitive: true,
    replaceGuid: false,
    reportChangedOnly: true,
    skipPlugins: true,
    skipThemes: true,
    skipPackages: true,
    fallback: true,
    workers: 0,
};
/** IPC channel names. `sr:` calls are renderer → main (ipcAsync). `sr:snapshot` and `sr:log` are main → renderer events. */
exports.CH = {
    scan: 'sr:scan',
    /** Did the database change since the last scan? Answer: `{ changed, reason }`. */
    check: 'sr:check',
    validate: 'sr:validate',
    start: 'sr:start',
    cancel: 'sr:cancel',
    state: 'sr:state',
    history: 'sr:history',
    loadConfig: 'sr:load-config',
    saveConfig: 'sr:save-config',
    snapshot: 'sr:snapshot',
    log: 'sr:log',
    logFiles: 'sr:log-files',
    readLog: 'sr:read-log',
    openFolder: 'sr:open-folder',
};
/** Shown in the UI and in the checks. There is no option to pick tables. */
exports.ALL_TABLES_NOTICE = 'Search and replace runs on all tables of the database, including plugin tables and tables without the WordPress prefix. You cannot choose single tables.';
