import path from 'node:path';
import type { DbConn } from './fallback';

/** Local's own record of the site database (`site.mysql`). */
export interface SiteCreds {
	database: string;
	user: string;
	password: string;
}

export interface DbSources {
	creds?: SiteCreds | null;
	/** Unix socket of the database service. `null` on Windows. */
	socket?: string | null;
	/** Port of the database service. */
	port?: number | null;
	/** Any other port the site record lists for the database service. */
	listedPorts?: unknown;
	mysqldump?: string;
	/** Text of wp-config.php, the last source for what Local did not tell us. */
	wpConfig?: string;
}

export interface WpConfigDb {
	name?: string;
	user?: string;
	password?: string;
	host?: string;
	port?: number;
	socket?: string;
}

const unescapeQuotes = (s: string): string => s.replace(/\\(['"\\])/g, '$1');

/** Split a WordPress `DB_HOST`: `host`, `host:3306`, `localhost:/path/mysqld.sock`, `[::1]:3306`. */
export function parseDbHost(value: string): { host: string; port?: number; socket?: string } {
	const v = value.trim();
	const v6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(v);
	if (v6) return { host: v6[1], port: v6[2] ? Number(v6[2]) : undefined };
	const i = v.indexOf(':');
	if (i < 0) return { host: v };
	const host = v.slice(0, i) || 'localhost';
	const rest = v.slice(i + 1);
	if (/^\d+$/.test(rest)) return { host, port: Number(rest) };
	return rest ? { host, socket: rest } : { host };
}

/** Read the database constants of a `wp-config.php` that defines them with plain string literals. */
export function parseWpConfigDb(text: string): WpConfigDb {
	const out: WpConfigDb = {};
	const re =
		/define\s*\(\s*(['"])DB_(NAME|USER|PASSWORD|HOST)\1\s*,\s*(['"])((?:\\.|(?!\3)[^\\])*)\3\s*\)/g;
	for (let m = re.exec(text); m; m = re.exec(text)) {
		const value = unescapeQuotes(m[4]);
		if (m[2] === 'NAME') out.name = value;
		else if (m[2] === 'USER') out.user = value;
		else if (m[2] === 'PASSWORD') out.password = value;
		else Object.assign(out, parseDbHost(value));
	}
	return out;
}

const firstPort = (v: unknown): number | undefined => {
	const n = Number(Array.isArray(v) ? v[0] : v);
	return Number.isInteger(n) && n > 0 ? n : undefined;
};

/** Port from a site record like `{ MYSQL: [10003] }`. The key is `MYSQL` for MySQL and MariaDB, but any key is accepted. */
export function portFromListed(ports: unknown): number | undefined {
	if (!ports || typeof ports !== 'object') return undefined;
	const p = ports as Record<string, unknown>;
	return firstPort(p.MYSQL) ?? firstPort(Object.values(p)[0]);
}

/**
 * How to reach the database without WP-CLI, for any engine Local offers (MySQL, MariaDB, any version).
 * Credentials: Local's site record, then wp-config.php. Address: the service socket, then its port,
 * then wp-config.php, then 3306.
 */
export function chooseDbConn(s: DbSources): DbConn | undefined {
	const cfg = s.wpConfig ? parseWpConfigDb(s.wpConfig) : {};
	const name = s.creds?.database || cfg.name;
	const user = s.creds?.user || cfg.user;
	if (!name || !user) return undefined;
	const servicePort = firstPort(s.port) ?? portFromListed(s.listedPorts);
	// A socket of wp-config.php is only used when Local gave neither a socket nor a port.
	const socket = s.socket || (servicePort ? undefined : cfg.socket);
	return {
		host: socket ? 'localhost' : cfg.host && cfg.host !== 'localhost' ? cfg.host : '127.0.0.1',
		port: servicePort ?? cfg.port ?? 3306,
		socket,
		name,
		user,
		password: s.creds?.password ?? cfg.password ?? '',
		mysqldump: s.mysqldump,
	};
}

/**
 * Folder with the `my.cnf` or `php.ini` of one service of a site. Local names it after the service
 * (`conf/mysql`, `conf/mariadb`, `conf/php`), so it must come from the service and not be written down.
 */
export function serviceConfDir(
	confRoot: string,
	svc: { configPath?: string; serviceName?: string } | null | undefined,
	fallbackName: string,
): string {
	return svc?.configPath || path.join(confRoot, svc?.serviceName || fallbackName);
}
