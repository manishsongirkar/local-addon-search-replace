"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Progress;
const react_1 = __importStar(require("react"));
const util_1 = require("./util");
const STEP = {
    pending: ['○', 'pending'],
    running: ['▶', 'running'],
    done: ['✔', 'done'],
    failed: ['✖', 'failed'],
    cancelled: ['■', 'cancelled'],
};
function Progress({ snap }) {
    var _a;
    const live = ['preparing', 'running', 'cancelling'].includes(snap.state);
    const [now, setNow] = (0, react_1.useState)(Date.now());
    (0, react_1.useEffect)(() => {
        if (!live)
            return;
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, [live]);
    const pct = Math.round(snap.progress * 100);
    const elapsed = snap.startedAt ? ((_a = snap.finishedAt) !== null && _a !== void 0 ? _a : now) - snap.startedAt : 0;
    const remaining = snap.estimatedTotalMs === null ? null : Math.max(0, snap.estimatedTotalMs - elapsed);
    const tables = snap.activeTables.join(', ');
    return (react_1.default.createElement("section", { style: util_1.box, "aria-label": "Progress" },
        react_1.default.createElement("output", { className: "sr-only" },
            snap.dryRun ? 'Dry run' : 'Run',
            " ",
            snap.state),
        react_1.default.createElement("div", { style: util_1.row },
            react_1.default.createElement("strong", null,
                snap.dryRun ? 'Dry run' : 'Run',
                ": ",
                snap.state),
            react_1.default.createElement("span", null, snap.currentLabel)),
        react_1.default.createElement("progress", { max: 100, value: pct, "aria-label": "Search and replace progress", style: { width: '100%', height: 14, margin: '8px 0' } },
            pct,
            "%"),
        react_1.default.createElement("div", { style: util_1.row },
            react_1.default.createElement("span", null,
                pct,
                "%"),
            react_1.default.createElement("span", null,
                "Tables ",
                snap.tablesDone,
                " of ",
                snap.tablesTotal),
            react_1.default.createElement("span", null,
                "Elapsed ",
                (0, util_1.fmtDuration)(elapsed)),
            live && (react_1.default.createElement("span", null,
                "Remaining ",
                remaining === null ? 'calculating' : (0, util_1.fmtDuration)(remaining))),
            snap.workers > 1 && react_1.default.createElement("span", null,
                snap.workers,
                " processes")),
        tables && live && (react_1.default.createElement("div", { title: tables, style: {
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                marginTop: 4,
            } },
            "Checking: ",
            tables)),
        snap.error && (react_1.default.createElement("p", { role: "alert", style: { whiteSpace: 'pre-wrap' } }, snap.error)),
        !live && snap.state !== 'idle' && (react_1.default.createElement("p", null,
            snap.totalReplacements,
            " replacement(s) ",
            snap.dryRun ? 'would be made' : 'made',
            ".",
            snap.backupFile && (react_1.default.createElement(react_1.default.Fragment, null,
                react_1.default.createElement("br", null),
                "Backup: ",
                snap.backupFile)),
            snap.logFile && (react_1.default.createElement(react_1.default.Fragment, null,
                react_1.default.createElement("br", null),
                "Log: ",
                snap.logFile)))),
        react_1.default.createElement("details", null,
            react_1.default.createElement("summary", null,
                "Steps (",
                snap.steps.length,
                ")"),
            react_1.default.createElement("ol", { style: { maxHeight: 220, overflow: 'auto' } }, snap.steps.map((s) => (react_1.default.createElement("li", { key: s.index },
                react_1.default.createElement("span", { "aria-hidden": "true" },
                    STEP[s.state][0],
                    " "),
                STEP[s.state][1],
                " \u00B7 ",
                s.scope,
                ": ",
                s.label,
                " (",
                s.tables,
                " table(s)",
                s.state === 'done' ? `, ${s.replacements} replacement(s)` : '',
                ")")))))));
}
