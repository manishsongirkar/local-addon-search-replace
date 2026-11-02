import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	chooseDbConn,
	parseDbHost,
	parseWpConfigDb,
	portFromListed,
	serviceConfDir,
} from '../../src/engine/dbconn';

describe('parseDbHost', () => {
	it.each([
		['localhost', { host: 'localhost' }],
		['127.0.0.1:10003', { host: '127.0.0.1', port: 10003 }],
		[
			'localhost:/Users/a/Local Sites/x/run/mysql/mysqld.sock',
			{ host: 'localhost', socket: '/Users/a/Local Sites/x/run/mysql/mysqld.sock' },
		],
		[':/tmp/mysql.sock', { host: 'localhost', socket: '/tmp/mysql.sock' }],
		['[::1]:3307', { host: '::1', port: 3307 }],
		['db.internal', { host: 'db.internal' }],
		['  127.0.0.1  ', { host: '127.0.0.1' }],
	])('%s', (v, expected) => {
		expect(parseDbHost(v)).toEqual(expected);
	});
});

describe('parseWpConfigDb', () => {
	it('reads single and double quoted constants, with spaces and escapes', () => {
		const cfg = parseWpConfigDb(`<?php
define( 'DB_NAME', 'local' );
define("DB_USER","root");
define( 'DB_PASSWORD', 'p\\'a"ss\\\\word' );
define('DB_HOST', 'localhost:/x y/mysqld.sock');
define('DB_CHARSET', 'utf8');`);
		expect(cfg).toEqual({
			name: 'local',
			user: 'root',
			password: `p'a"ss\\word`,
			host: 'localhost',
			socket: '/x y/mysqld.sock',
		});
	});
	it('ignores constants that are not plain strings (Bedrock, env, getenv)', () => {
		expect(
			parseWpConfigDb(
				"define('DB_NAME', getenv('DB_NAME')); Config::define('DB_USER', env('DB_USER'));",
			),
		).toEqual({});
		expect(parseWpConfigDb('')).toEqual({});
	});
	it('a commented-out define of the same name does not break reading the real one', () => {
		expect(parseWpConfigDb("// define('DB_NAME', 'old');\ndefine('DB_NAME', 'new');").name).toBe(
			'new',
		);
	});
});

describe('portFromListed', () => {
	it('MYSQL key for MySQL and MariaDB, but any key works', () => {
		expect(portFromListed({ MYSQL: [10003] })).toBe(10003);
		expect(portFromListed({ MYSQL: 10004 })).toBe(10004);
		expect(portFromListed({ DB: [10005] })).toBe(10005);
	});
	it('junk gives nothing', () => {
		for (const v of [null, undefined, 'x', {}, { MYSQL: [] }, { MYSQL: ['abc'] }, { MYSQL: [0] }])
			expect(portFromListed(v)).toBeUndefined();
	});
});

describe('chooseDbConn: any MySQL or MariaDB service Local offers', () => {
	const creds = { database: 'local', user: 'root', password: 'root' };
	it('Linux and macOS: the service socket wins', () => {
		expect(
			chooseDbConn({ creds, socket: '/run/mysqld.sock', port: 10003, mysqldump: '/bin/mysqldump' }),
		).toEqual({
			host: 'localhost',
			port: 10003,
			socket: '/run/mysqld.sock',
			name: 'local',
			user: 'root',
			password: 'root',
			mysqldump: '/bin/mysqldump',
		});
	});
	it('Windows: no socket, so the service port over TCP', () => {
		expect(chooseDbConn({ creds, socket: null, port: 10005 })).toMatchObject({
			host: '127.0.0.1',
			port: 10005,
			socket: undefined,
		});
	});
	it('no service port: the port listed on the site record, then wp-config, then 3306', () => {
		expect(chooseDbConn({ creds, listedPorts: { MYSQL: [10006] } })?.port).toBe(10006);
		expect(chooseDbConn({ creds, wpConfig: "define('DB_HOST','127.0.0.1:10007');" })).toMatchObject(
			{ host: '127.0.0.1', port: 10007 },
		);
		expect(chooseDbConn({ creds })?.port).toBe(3306);
	});
	it('nothing from Local: everything from wp-config.php, including a socket', () => {
		const wp =
			"define('DB_NAME','n');define('DB_USER','u');define('DB_PASSWORD','p');define('DB_HOST','localhost:/s/m.sock');";
		expect(chooseDbConn({ wpConfig: wp })).toMatchObject({
			name: 'n',
			user: 'u',
			password: 'p',
			socket: '/s/m.sock',
			host: 'localhost',
		});
	});
	it('Local credentials win over wp-config.php; an empty Local password is kept', () => {
		const wp = "define('DB_NAME','other');define('DB_USER','other');define('DB_PASSWORD','x');";
		expect(
			chooseDbConn({ creds: { database: 'local', user: 'root', password: '' }, wpConfig: wp }),
		).toMatchObject({ name: 'local', user: 'root', password: '' });
	});
	it('no name or user anywhere: no fallback instead of a wrong connection', () => {
		expect(chooseDbConn({})).toBeUndefined();
		expect(chooseDbConn({ creds: { database: '', user: 'root', password: '' } })).toBeUndefined();
	});
});

describe('serviceConfDir', () => {
	const conf = path.join('/site', 'conf');
	it('uses the config folder the service reports, for MySQL, MariaDB and PHP alike', () => {
		expect(
			serviceConfDir(conf, { configPath: '/site/conf/mariadb', serviceName: 'mariadb' }, 'mysql'),
		).toBe('/site/conf/mariadb');
	});
	it('without configPath it is named after the service, not hard-coded to mysql', () => {
		expect(serviceConfDir(conf, { serviceName: 'mariadb' }, 'mysql')).toBe(
			path.join(conf, 'mariadb'),
		);
		expect(serviceConfDir(conf, null, 'mysql')).toBe(path.join(conf, 'mysql'));
	});
});
