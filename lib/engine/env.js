"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildWpEnv = buildWpEnv;
exports.findWpCliPhar = findWpCliPhar;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
/**
 * Environment for WP-CLI, built the way Local builds it for its own `wpCli.run`.
 * Handles the Windows habit of calling the variable `Path`, and uses the right list separator.
 */
function buildWpEnv(i) {
    var _a, _b, _c, _d, _e;
    const platform = (_a = i.platform) !== null && _a !== void 0 ? _a : process.platform;
    const delimiter = platform === 'win32' ? ';' : ':';
    const pathKey = (_b = Object.keys(i.base).find((k) => k.toLowerCase() === 'path')) !== null && _b !== void 0 ? _b : 'PATH';
    const split = (v) => (v ? v.split(delimiter) : []);
    const dirs = [
        ...split(i.base[pathKey]),
        ...i.servicePaths.flatMap(split),
        ...split((_d = (_c = i.phpEnv) === null || _c === void 0 ? void 0 : _c.PATH) !== null && _d !== void 0 ? _d : (_e = i.phpEnv) === null || _e === void 0 ? void 0 : _e.Path),
    ].filter(Boolean);
    const env = Object.assign(Object.assign({}, i.base), i.phpEnv);
    // Drop every spelling of PATH, then set one.
    for (const k of Object.keys(env))
        if (k.toLowerCase() === 'path')
            delete env[k];
    env[pathKey] = [...new Set(dirs)].join(delimiter);
    if (i.phpIniDir)
        env.PHPRC = i.phpIniDir;
    if (i.mysqlHome)
        env.MYSQL_HOME = i.mysqlHome;
    // Local points this at webRoot/wp-config.php. That file does not exist in Bedrock-style projects.
    if (i.wpConfigPath && node_fs_1.default.existsSync(i.wpConfigPath))
        env.WP_CONFIG_PATH = i.wpConfigPath;
    env.WP_CLI_DISABLE_AUTO_CHECK_UPDATE = '1';
    return env;
}
/** First existing `bin/wp-cli/wp-cli.phar` under the candidate resource folders. */
function findWpCliPhar(resourceDirs) {
    for (const d of resourceDirs) {
        if (!d)
            continue;
        const p = node_path_1.default.join(d, 'bin', 'wp-cli', 'wp-cli.phar');
        if (node_fs_1.default.existsSync(p))
            return p;
    }
    return null;
}
