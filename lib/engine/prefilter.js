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
exports.PREFILTER_MIN_BYTES = void 0;
exports.needlesFor = needlesFor;
exports.prefilter = prefilter;
const node_path_1 = __importDefault(require("node:path"));
const phpDir_1 = require("./phpDir");
const plan_1 = require("./plan");
const urls_1 = require("./urls");
const validate_1 = require("./validate");
const wpRunner_1 = require("./wpRunner");
/** Below this much data the pre-scan costs more than it saves. */
exports.PREFILTER_MIN_BYTES = 64 * 1024 * 1024;
/**
 * Text that every database form of a pair must contain, for a cheap `LIKE` test.
 * A URL becomes its host (JSON-escaped, double-escaped and URL-encoded forms keep the host as it is; the port may not be).
 * Regex pairs give nothing: they run on every table.
 */
function needlesFor(pairs) {
    const out = new Set();
    for (const p of (0, validate_1.normalizePairs)(pairs.filter((x) => x.enabled && !x.regex))) {
        if ((0, validate_1.isNoOp)(p))
            continue;
        if (!p.search)
            continue;
        const u = (0, urls_1.parseUrlish)(p.search);
        out.add(u && (u.scheme || p.search.includes('.')) ? u.host : p.search);
    }
    return [...out];
}
/** Run the pre-scan on `workers` groups of tables at the same time. Returns null when it cannot tell. */
function prefilter(rt, tables, needles, workers, onHandle) {
    return __awaiter(this, void 0, void 0, function* () {
        if (needles.length === 0 || tables.length === 0)
            return null;
        const hits = new Map();
        const groups = (0, plan_1.partitionTables)(tables, workers);
        const results = yield Promise.all(groups.map((group) => __awaiter(this, void 0, void 0, function* () {
            const job = Buffer.from(JSON.stringify({ tables: group.map((t) => t.name), needles })).toString('base64');
            const handle = (0, wpRunner_1.spawnWp)(rt, ['eval-file', node_path_1.default.join(phpDir_1.PHP_DIR, 'prefilter.php'), job]);
            onHandle === null || onHandle === void 0 ? void 0 : onHandle(handle);
            const res = yield handle.promise;
            return res.code === 0 ? (0, wpRunner_1.extractJson)(res.stdout) : null;
        })));
        if (results.some((r) => r === null))
            return null;
        for (const r of results)
            for (const [t, cols] of Object.entries(r !== null && r !== void 0 ? r : {}))
                hits.set(t, cols);
        return hits;
    });
}
