"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EngineError = void 0;
exports.loadContext = loadContext;
exports.scanDomains = scanDomains;
exports.buildCandidates = buildCandidates;
const node_path_1 = __importDefault(require("node:path"));
const urls_1 = require("./urls");
const wpRunner_1 = require("./wpRunner");
const fallback_1 = require("./fallback");
const phpDir_1 = require("./phpDir");
class EngineError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
exports.EngineError = EngineError;
/**
 * When the imported database has another domain than wp-config, a multisite refuses to load.
 * Read the network domain straight from the database so WP-CLI can get `--url`.
 */
function guessNetworkUrl(rt) {
    return __awaiter(this, void 0, void 0, function* () {
        const t = yield (0, wpRunner_1.runWp)(rt, ['db', 'query', 'SHOW TABLES', '--skip-column-names'], { noUrl: true });
        if (t.code !== 0)
            return undefined;
        const names = t.stdout.split(/\r?\n/).map((s) => s.trim());
        const siteTable = names.find((n) => /^.+_?site$/.test(n) && names.includes(`${n.slice(0, -4)}blogs`));
        if (!siteTable)
            return undefined;
        const q = yield (0, wpRunner_1.runWp)(rt, [
            'db',
            'query',
            `SELECT CONCAT(domain, path) FROM \`${siteTable.replace(/`/g, '``')}\` ORDER BY id LIMIT 1`,
            '--skip-column-names',
        ], { noUrl: true });
        return q.code === 0 ? q.stdout.trim().split(/\r?\n/)[0] || undefined : undefined;
    });
}
function loadContext(rt) {
    return __awaiter(this, void 0, void 0, function* () {
        const script = node_path_1.default.join(phpDir_1.PHP_DIR, 'context.php');
        let run = yield (0, wpRunner_1.runWp)(rt, ['eval-file', script]);
        let urlArg;
        if (run.code !== 0 && (0, wpRunner_1.classifyError)(run.stderr).code === 'SITE_URL') {
            urlArg = yield guessNetworkUrl(rt);
            if (urlArg)
                run = yield (0, wpRunner_1.runWp)(Object.assign(Object.assign({}, rt), { urlArg }), ['eval-file', script]);
        }
        if (run.code !== 0 && rt.db) {
            // WP-CLI could not run (broken phar, plugin fatal, bad wp-config ...). Read the database directly.
            const fb = yield (0, fallback_1.fallbackJson)(rt, { mode: 'context' });
            if (fb.data)
                return Object.assign({ wpPath: rt.wpPath, urlArg, fallback: true }, fb.data);
        }
        if (run.code !== 0) {
            const e = (0, wpRunner_1.classifyError)(run.stderr);
            throw new EngineError(e.code, e.message);
        }
        const raw = (0, wpRunner_1.extractJson)(run.stdout);
        if (!raw)
            throw new EngineError('UNKNOWN', 'Could not read the site layout from WP-CLI.');
        if (!raw.tables.some((t) => t.name === `${raw.prefix}options`)) {
            throw new EngineError('NOT_INSTALLED', 'WordPress tables were not found. Import the database first.');
        }
        return Object.assign({ wpPath: rt.wpPath, urlArg }, raw);
    });
}
/**
 * Find domains in the options tables and suggest a replacement for each.
 * The domain of the main site is pre-selected and maps to the Local URL.
 */
function scanDomains(rt, ctx, localUrl) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const run = ctx.fallback
            ? { code: 1, stdout: '', stderr: '', cancelled: false }
            : yield (0, wpRunner_1.runWp)(Object.assign(Object.assign({}, rt), { urlArg: ctx.urlArg }), ['eval-file', node_path_1.default.join(phpDir_1.PHP_DIR, 'domains.php')]);
        if (run.code !== 0 && rt.db) {
            const fb = yield (0, fallback_1.fallbackJson)(rt, {
                mode: 'domains',
                prefix: ctx.prefix,
                multisite: ctx.multisite,
            });
            if (fb.data)
                return buildCandidates(fb.data, ctx, localUrl);
        }
        if (run.code !== 0) {
            const e = (0, wpRunner_1.classifyError)(run.stderr);
            throw new EngineError(e.code, e.message);
        }
        const raw = (_a = (0, wpRunner_1.extractJson)(run.stdout)) !== null && _a !== void 0 ? _a : {};
        return buildCandidates(raw, ctx, localUrl);
    });
}
function buildCandidates(raw, ctx, localUrl) {
    var _a, _b;
    const localHost = (0, urls_1.hostOf)(localUrl);
    const main = (_a = ctx.blogs.find((b) => b.id === 1)) !== null && _a !== void 0 ? _a : ctx.blogs[0];
    const mainUrl = (main === null || main === void 0 ? void 0 : main.siteurl) || (main === null || main === void 0 ? void 0 : main.home) || '';
    const mainParts = (0, urls_1.parseUrlish)(mainUrl);
    const originHost = (0, urls_1.hostOf)(mainUrl);
    const originPath = ((_b = mainParts === null || mainParts === void 0 ? void 0 : mainParts.path) !== null && _b !== void 0 ? _b : '').replace(/\/+$/, '');
    const list = [];
    for (const [value, info] of Object.entries(raw)) {
        const p = (0, urls_1.parseUrlish)(value);
        if (!p)
            continue;
        if (!info.primary && (0, urls_1.isNoiseHost)(p.host))
            continue;
        const isLocal = (0, urls_1.stripWww)(p.host) === (0, urls_1.stripWww)(localHost);
        const suggested = (0, urls_1.suggestReplacement)(value, originHost, localUrl);
        // A sub-directory sub-site (`host/one`) is already covered by the pair for `host`. Do not run it twice.
        const path = p.path.replace(/\/+$/, '');
        const pathOk = path === '' || path === originPath;
        // Pre-select what a person would tick: the origin and, on subdomain networks, its sub-sites.
        // A `www` twin that only appears in content is ticked too, when it has the scheme of the main URL.
        const wwwTwin = (0, urls_1.stripWww)(p.host) === (0, urls_1.stripWww)(originHost) &&
            p.host !== originHost &&
            p.scheme === (mainParts === null || mainParts === void 0 ? void 0 : mainParts.scheme);
        list.push({
            value,
            host: p.host,
            count: info.count,
            sources: info.sources,
            primary: info.primary,
            suggestedReplace: suggested,
            preselected: !isLocal && !!suggested && pathOk && (info.primary || wwwTwin),
        });
    }
    // `https://a.com` from siteurl and the same value found in options are one row.
    const merged = new Map();
    for (const c of list) {
        const key = c.value.replace(/\/+$/, '');
        const prev = merged.get(key);
        if (!prev)
            merged.set(key, Object.assign(Object.assign({}, c), { value: key }));
        else {
            prev.count += c.count;
            prev.primary || (prev.primary = c.primary);
            prev.preselected || (prev.preselected = c.preselected);
            prev.sources = [...new Set([...prev.sources, ...c.sources])].slice(0, 5);
        }
    }
    return (0, urls_1.sortCandidates)([...merged.values()]);
}
