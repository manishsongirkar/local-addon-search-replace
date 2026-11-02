#!/usr/bin/env node
// Copies the build of this add-on into Local's add-ons folder, the way Local itself installs an add-on.
// Only what a user gets is copied (the "files" list of package.json), never src/ or node_modules/.
// Usage: npm run sync          build once and copy
//        npm run dev           build and copy again after every change in src/ or php/
// Another folder: LOCAL_ADDONS_DIR=/path npm run sync
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const watch = process.argv.includes('--watch');

function addonsDir() {
	if (process.env.LOCAL_ADDONS_DIR) return process.env.LOCAL_ADDONS_DIR;
	if (process.platform === 'darwin')
		return path.join(os.homedir(), 'Library', 'Application Support', 'Local', 'addons');
	if (process.platform === 'win32')
		return path.join(
			process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
			'Local',
			'addons',
		);
	return path.join(os.homedir(), '.config', 'Local', 'addons');
}

// Local names the folder after the package: `@scope/name` becomes `scope-name`.
const target = path.join(addonsDir(), pkg.name.replace(/^@/, '').replace('/', '-'));

function build() {
	const r = spawnSync('npx', ['tsc'], {
		cwd: root,
		stdio: 'inherit',
		shell: process.platform === 'win32',
	});
	return r.status === 0;
}

function copy() {
	fs.mkdirSync(target, { recursive: true });
	const items = [...(pkg.files ?? []), 'package.json'];
	for (const item of items) {
		const from = path.join(root, item);
		const to = path.join(target, item);
		if (!fs.existsSync(from)) continue;
		fs.rmSync(to, { recursive: true, force: true });
		fs.cpSync(from, to, { recursive: true });
	}
	console.log(`[${new Date().toLocaleTimeString()}] Copied to ${target}`);
}

function once() {
	if (!build()) return console.error('Build failed. Nothing was copied.');
	copy();
}

once();
if (!watch) {
	console.log(
		'Restart Local to load the new version. Then enable the add-on in Preferences > Add-ons (first time only).',
	);
} else {
	console.log(
		'Watching src/ and php/. Restart Local after a change in src/main.ts; the window reload (Cmd/Ctrl+R) is enough for the UI.',
	);
	let timer;
	for (const dir of ['src', 'php']) {
		fs.watch(path.join(root, dir), { recursive: true }, () => {
			clearTimeout(timer);
			timer = setTimeout(once, 300);
		});
	}
}
