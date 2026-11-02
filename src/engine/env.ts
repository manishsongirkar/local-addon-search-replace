import fs from 'node:fs';
import path from 'node:path';

export interface EnvInput {
	/** Usually `process.env`. */
	base: NodeJS.ProcessEnv;
	/** `env` getter of Local's PHP service. */
	phpEnv?: NodeJS.ProcessEnv;
	/** `$PATH` of the database and PHP services. */
	servicePaths: Array<string | undefined>;
	phpIniDir?: string;
	mysqlHome?: string;
	wpConfigPath?: string;
	platform?: NodeJS.Platform;
}

/**
 * Environment for WP-CLI, built the way Local builds it for its own `wpCli.run`.
 * Handles the Windows habit of calling the variable `Path`, and uses the right list separator.
 */
export function buildWpEnv(i: EnvInput): NodeJS.ProcessEnv {
	const platform = i.platform ?? process.platform;
	const delimiter = platform === 'win32' ? ';' : ':';
	const pathKey = Object.keys(i.base).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
	const split = (v?: string) => (v ? v.split(delimiter) : []);

	const dirs = [
		...split(i.base[pathKey]),
		...i.servicePaths.flatMap(split),
		...split(i.phpEnv?.PATH ?? i.phpEnv?.Path),
	].filter(Boolean);

	const env: NodeJS.ProcessEnv = { ...i.base, ...i.phpEnv };
	// Drop every spelling of PATH, then set one.
	for (const k of Object.keys(env)) if (k.toLowerCase() === 'path') delete env[k];
	env[pathKey] = [...new Set(dirs)].join(delimiter);
	if (i.phpIniDir) env.PHPRC = i.phpIniDir;
	if (i.mysqlHome) env.MYSQL_HOME = i.mysqlHome;
	// Local points this at webRoot/wp-config.php. That file does not exist in Bedrock-style projects.
	if (i.wpConfigPath && fs.existsSync(i.wpConfigPath)) env.WP_CONFIG_PATH = i.wpConfigPath;
	env.WP_CLI_DISABLE_AUTO_CHECK_UPDATE = '1';
	return env;
}

/** First existing `bin/wp-cli/wp-cli.phar` under the candidate resource folders. */
export function findWpCliPhar(resourceDirs: Array<string | undefined>): string | null {
	for (const d of resourceDirs) {
		if (!d) continue;
		const p = path.join(d, 'bin', 'wp-cli', 'wp-cli.phar');
		if (fs.existsSync(p)) return p;
	}
	return null;
}
