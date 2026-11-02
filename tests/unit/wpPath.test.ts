import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveWpPath } from '../../src/engine/wpPath';

let root: string;
beforeEach(() => {
	root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sr-wp-')));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const wp = (...p: string[]) => {
	fs.mkdirSync(path.join(root, ...p), { recursive: true });
	fs.writeFileSync(path.join(root, ...p, 'wp-load.php'), '<?php');
	return path.join(root, ...p);
};

describe('resolveWpPath', () => {
	it('standard: WordPress in the web root', () => {
		expect(resolveWpPath(wp())).toMatchObject({ path: root, layout: 'standard' });
	});
	it('sub-directory install', () => {
		const p = wp('blog');
		expect(resolveWpPath(root)).toMatchObject({ path: p, layout: 'subdirectory' });
	});
	it('Bedrock', () => {
		const p = wp('web', 'wp');
		fs.mkdirSync(path.join(root, 'config'));
		fs.writeFileSync(path.join(root, 'config', 'application.php'), '');
		expect(resolveWpPath(root)).toMatchObject({ path: p, layout: 'bedrock' });
	});
	it('wp-cli.yml path wins, quoted or not, and wp-cli.local.yml is read first', () => {
		const p = wp('cms', 'core');
		fs.writeFileSync(path.join(root, 'wp-cli.yml'), 'path: "cms/core"\n');
		expect(resolveWpPath(root)).toMatchObject({ path: p, layout: 'wp-cli.yml' });
		const other = wp('other');
		fs.writeFileSync(path.join(root, 'wp-cli.local.yml'), 'path: other  # comment\n');
		expect(resolveWpPath(root)?.path).toBe(other);
	});
	it('a wp-cli.yml that points nowhere is ignored', () => {
		const p = wp('wordpress');
		fs.writeFileSync(path.join(root, 'wp-cli.yml'), 'path: missing\n');
		expect(resolveWpPath(root)?.path).toBe(p);
	});
	it('manual override must contain wp-load.php', () => {
		const p = wp('x');
		expect(resolveWpPath(root, p)).toMatchObject({ path: p, layout: 'manual' });
		expect(resolveWpPath(root, path.join(root, 'nope'))).toBeNull();
		expect(resolveWpPath(root, `  ${p}  `)?.path).toBe(p);
	});
	it('reports the other copies and prefers the shallowest', () => {
		const a = wp('a');
		wp('a', 'deep', 'er');
		wp('b', 'c');
		const r = resolveWpPath(root);
		expect(r?.path).toBe(a);
	});
	it('does not look inside node_modules, vendor, wp-content or hidden folders', () => {
		wp('node_modules', 'x');
		wp('wp-content', 'x');
		wp('.git', 'x');
		expect(resolveWpPath(root)).toBeNull();
	});
	it('null for a missing or empty web root', () => {
		expect(resolveWpPath(path.join(root, 'none'))).toBeNull();
		expect(resolveWpPath(root)).toBeNull();
	});
	it('paths with spaces and non-ASCII characters', () => {
		const p = wp('Mój Site', 'wordpress');
		expect(resolveWpPath(root)?.path).toBe(p);
	});
});
