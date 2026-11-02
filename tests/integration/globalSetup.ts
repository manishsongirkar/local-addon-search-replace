import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Starts one throw-away MySQL for the whole integration run.
 * Set SR_DB_HOST/SR_DB_USER/SR_DB_PASS to use an existing server instead (CI).
 * Otherwise the MySQL that ships with Local is used (macOS/Linux).
 */
const LOCAL_SERVICES = path.join(
	os.homedir(),
	process.platform === 'darwin' ? 'Library/Application Support/Local' : '.config/Local',
	'lightning-services',
);

function findLocalBin(prefix: string, rel: string): string | null {
	if (!fs.existsSync(LOCAL_SERVICES)) return null;
	const dirs = fs
		.readdirSync(LOCAL_SERVICES)
		.filter((d) => d.startsWith(prefix))
		.sort()
		.reverse();
	for (const d of dirs) {
		const arch = fs.existsSync(path.join(LOCAL_SERVICES, d, 'bin'))
			? fs.readdirSync(path.join(LOCAL_SERVICES, d, 'bin'))
			: [];
		for (const a of arch) {
			const p = path.join(LOCAL_SERVICES, d, 'bin', a, rel);
			if (fs.existsSync(p)) return p;
		}
	}
	return null;
}

let mysqld: ChildProcess | null = null;
let dir = '';

export default async function setup(): Promise<() => Promise<void>> {
	process.env.SR_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-it-'));
	if (process.env.SR_DB_HOST) return async () => cleanup();

	const bin = process.env.SR_MYSQLD ?? findLocalBin('mysql-8', 'bin/mysqld');
	if (!bin) throw new Error('No MySQL found. Set SR_MYSQLD or SR_DB_HOST/SR_DB_USER/SR_DB_PASS.');
	const base = path.dirname(path.dirname(bin));
	dir = path.join(process.env.SR_TMP, 'mysql');
	const sock = path.join(process.env.SR_TMP, 'my.sock');
	execFileSync(
		bin,
		['--no-defaults', '--initialize-insecure', `--basedir=${base}`, `--datadir=${dir}`],
		{
			stdio: 'ignore',
		},
	);
	mysqld = spawn(
		bin,
		[
			'--no-defaults',
			`--basedir=${base}`,
			`--datadir=${dir}`,
			`--socket=${sock}`,
			'--skip-networking',
			'--mysqlx=OFF',
		],
		{ stdio: 'ignore' },
	);
	const client = path.join(path.dirname(bin), 'mysql');
	for (let i = 0; i < 60; i++) {
		try {
			execFileSync(client, ['--no-defaults', '-uroot', `-S${sock}`, '-e', 'SELECT 1'], {
				stdio: 'ignore',
			});
			break;
		} catch {
			await new Promise((r) => setTimeout(r, 500));
		}
	}
	process.env.SR_DB_HOST = `localhost:${sock}`;
	process.env.SR_DB_USER = 'root';
	process.env.SR_DB_PASS = '';
	process.env.SR_MYSQL_BIN = path.dirname(bin);
	return async () => cleanup();
}

function cleanup(): void {
	mysqld?.kill('SIGTERM');
	try {
		fs.rmSync(process.env.SR_TMP ?? '', { recursive: true, force: true });
	} catch {
		// Best effort.
	}
}
