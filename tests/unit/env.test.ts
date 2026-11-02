import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildWpEnv, findWpCliPhar } from '../../src/engine/env';

describe('buildWpEnv', () => {
	it('joins PATH with ":" on macOS and Linux, once, without duplicates', () => {
		const env = buildWpEnv({
			base: { PATH: '/usr/bin:/bin' },
			phpEnv: { PATH: '/php/bin:/usr/bin' },
			servicePaths: ['/db/bin', undefined],
			platform: 'darwin',
		});
		expect(env.PATH).toBe('/usr/bin:/bin:/db/bin:/php/bin');
	});
	it('uses ";" and keeps the spelling "Path" on Windows, with no second PATH key', () => {
		const env = buildWpEnv({
			base: { Path: 'C:\\Windows' },
			phpEnv: { Path: 'C:\\php' },
			servicePaths: ['C:\\mysql\\bin'],
			platform: 'win32',
		});
		expect(env.Path).toBe('C:\\Windows;C:\\mysql\\bin;C:\\php');
		expect(Object.keys(env).filter((k) => k.toLowerCase() === 'path')).toEqual(['Path']);
	});
	it('sets PHPRC and MYSQL_HOME only when given, and always turns off the update check', () => {
		const a = buildWpEnv({ base: {}, servicePaths: [], platform: 'linux' });
		expect(a.PHPRC).toBeUndefined();
		expect(a.MYSQL_HOME).toBeUndefined();
		expect(a.WP_CLI_DISABLE_AUTO_CHECK_UPDATE).toBe('1');
		const b = buildWpEnv({
			base: {},
			servicePaths: [],
			phpIniDir: '/c/php',
			mysqlHome: '/c/mysql',
			platform: 'linux',
		});
		expect(b).toMatchObject({ PHPRC: '/c/php', MYSQL_HOME: '/c/mysql' });
	});
	it('WP_CONFIG_PATH is only set when the file exists (Bedrock has none)', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-env-'));
		const file = path.join(dir, 'wp-config.php');
		expect(
			buildWpEnv({ base: {}, servicePaths: [], wpConfigPath: file }).WP_CONFIG_PATH,
		).toBeUndefined();
		fs.writeFileSync(file, '<?php');
		expect(buildWpEnv({ base: {}, servicePaths: [], wpConfigPath: file }).WP_CONFIG_PATH).toBe(
			file,
		);
		fs.rmSync(dir, { recursive: true });
	});
	it('does not change the input environment', () => {
		const base = { PATH: '/a' };
		buildWpEnv({ base, servicePaths: ['/b'], platform: 'linux' });
		expect(base).toEqual({ PATH: '/a' });
	});
	it('PHP service variables win over the base environment', () => {
		expect(buildWpEnv({ base: { FOO: '1' }, phpEnv: { FOO: '2' }, servicePaths: [] }).FOO).toBe(
			'2',
		);
	});
});

describe('findWpCliPhar', () => {
	it('returns the first folder that has the phar', () => {
		const a = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-phar-a-'));
		const b = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-phar-b-'));
		fs.mkdirSync(path.join(b, 'bin', 'wp-cli'), { recursive: true });
		fs.writeFileSync(path.join(b, 'bin', 'wp-cli', 'wp-cli.phar'), '');
		expect(findWpCliPhar([undefined, a, b])).toBe(path.join(b, 'bin', 'wp-cli', 'wp-cli.phar'));
		expect(findWpCliPhar([a])).toBeNull();
		fs.rmSync(a, { recursive: true });
		fs.rmSync(b, { recursive: true });
	});
});
