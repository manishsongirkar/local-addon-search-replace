"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseDbHost = parseDbHost;
exports.parseWpConfigDb = parseWpConfigDb;
exports.portFromListed = portFromListed;
exports.chooseDbConn = chooseDbConn;
exports.serviceConfDir = serviceConfDir;
const node_path_1 = __importDefault(require("node:path"));
const unescapeQuotes = (s) => s.replace(/\\(['"\\])/g, '$1');
/** Split a WordPress `DB_HOST`: `host`, `host:3306`, `localhost:/path/mysqld.sock`, `[::1]:3306`. */
function parseDbHost(value) {
    const v = value.trim();
    const v6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(v);
    if (v6)
        return { host: v6[1], port: v6[2] ? Number(v6[2]) : undefined };
    const i = v.indexOf(':');
    if (i < 0)
        return { host: v };
    const host = v.slice(0, i) || 'localhost';
    const rest = v.slice(i + 1);
    if (/^\d+$/.test(rest))
        return { host, port: Number(rest) };
    return rest ? { host, socket: rest } : { host };
}
/** Read the database constants of a `wp-config.php` that defines them with plain string literals. */
function parseWpConfigDb(text) {
    const out = {};
    const re = /define\s*\(\s*(['"])DB_(NAME|USER|PASSWORD|HOST)\1\s*,\s*(['"])((?:\\.|(?!\3)[^\\])*)\3\s*\)/g;
    for (let m = re.exec(text); m; m = re.exec(text)) {
        const value = unescapeQuotes(m[4]);
        if (m[2] === 'NAME')
            out.name = value;
        else if (m[2] === 'USER')
            out.user = value;
        else if (m[2] === 'PASSWORD')
            out.password = value;
        else
            Object.assign(out, parseDbHost(value));
    }
    return out;
}
const firstPort = (v) => {
    const n = Number(Array.isArray(v) ? v[0] : v);
    return Number.isInteger(n) && n > 0 ? n : undefined;
};
/** Port from a site record like `{ MYSQL: [10003] }`. The key is `MYSQL` for MySQL and MariaDB, but any key is accepted. */
function portFromListed(ports) {
    var _a;
    if (!ports || typeof ports !== 'object')
        return undefined;
    const p = ports;
    return (_a = firstPort(p.MYSQL)) !== null && _a !== void 0 ? _a : firstPort(Object.values(p)[0]);
}
/**
 * How to reach the database without WP-CLI, for any engine Local offers (MySQL, MariaDB, any version).
 * Credentials: Local's site record, then wp-config.php. Address: the service socket, then its port,
 * then wp-config.php, then 3306.
 */
function chooseDbConn(s) {
    var _a, _b, _c, _d, _e, _f, _g;
    const cfg = s.wpConfig ? parseWpConfigDb(s.wpConfig) : {};
    const name = ((_a = s.creds) === null || _a === void 0 ? void 0 : _a.database) || cfg.name;
    const user = ((_b = s.creds) === null || _b === void 0 ? void 0 : _b.user) || cfg.user;
    if (!name || !user)
        return undefined;
    const servicePort = (_c = firstPort(s.port)) !== null && _c !== void 0 ? _c : portFromListed(s.listedPorts);
    // A socket of wp-config.php is only used when Local gave neither a socket nor a port.
    const socket = s.socket || (servicePort ? undefined : cfg.socket);
    return {
        host: socket ? 'localhost' : cfg.host && cfg.host !== 'localhost' ? cfg.host : '127.0.0.1',
        port: (_d = servicePort !== null && servicePort !== void 0 ? servicePort : cfg.port) !== null && _d !== void 0 ? _d : 3306,
        socket,
        name,
        user,
        password: (_g = (_f = (_e = s.creds) === null || _e === void 0 ? void 0 : _e.password) !== null && _f !== void 0 ? _f : cfg.password) !== null && _g !== void 0 ? _g : '',
        mysqldump: s.mysqldump,
    };
}
/**
 * Folder with the `my.cnf` or `php.ini` of one service of a site. Local names it after the service
 * (`conf/mysql`, `conf/mariadb`, `conf/php`), so it must come from the service and not be written down.
 */
function serviceConfDir(confRoot, svc, fallbackName) {
    return (svc === null || svc === void 0 ? void 0 : svc.configPath) || node_path_1.default.join(confRoot, (svc === null || svc === void 0 ? void 0 : svc.serviceName) || fallbackName);
}
