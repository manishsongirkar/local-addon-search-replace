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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = LogsTab;
const react_1 = __importStar(require("react"));
const types_1 = require("../common/types");
const Progress_1 = __importDefault(require("./Progress"));
const util_1 = require("./util");
const MAX_RENDER = 2000;
function LogsTab({ siteId, live, snapshot, }) {
    var _a;
    const [levels, setLevels] = (0, react_1.useState)(new Set(util_1.LEVELS));
    const [query, setQuery] = (0, react_1.useState)('');
    const [auto, setAuto] = (0, react_1.useState)(true);
    const [cleared, setCleared] = (0, react_1.useState)(0); // Hides the first N live lines. The file keeps everything.
    const [files, setFiles] = (0, react_1.useState)([]);
    const [saved, setSaved] = (0, react_1.useState)(null);
    const [error, setError] = (0, react_1.useState)('');
    const box = (0, react_1.useRef)(null);
    // A short message that goes away by itself. It sits in a live region, so a screen reader says it too.
    const [toast, setToast] = (0, react_1.useState)('');
    const toastTimer = (0, react_1.useRef)();
    const notify = (text) => {
        clearTimeout(toastTimer.current);
        setToast(text);
        toastTimer.current = setTimeout(() => setToast(''), 2500);
    };
    (0, react_1.useEffect)(() => () => clearTimeout(toastTimer.current), []);
    const loadFiles = () => (0, util_1.call)(types_1.CH.logFiles, siteId)
        .then(setFiles)
        .catch((e) => setError((0, util_1.errText)(e)));
    // biome-ignore lint/correctness/useExhaustiveDependencies: list once per site
    (0, react_1.useEffect)(() => void loadFiles(), [siteId]);
    // A new run empties the live list. An old "clear" position must not hide the first lines of the new one.
    (0, react_1.useEffect)(() => {
        if (cleared > live.length)
            setCleared(0);
    }, [live.length, cleared]);
    const source = saved ? saved.lines : live.slice(cleared);
    const q = query.toLowerCase();
    const shown = source
        .filter((l) => levels.has(l.level) && (!q || l.text.toLowerCase().includes(q)))
        .slice(-MAX_RENDER);
    const fmt = (l) => `${l.t ? new Date(l.t).toISOString() : ''} [${util_1.LEVEL_STYLE[l.level].label}] ${l.text}`;
    // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when a line is added
    (0, react_1.useEffect)(() => {
        if (auto && box.current)
            box.current.scrollTop = box.current.scrollHeight;
    }, [auto, shown.length]);
    const open = (name) => {
        if (!name)
            return setSaved(null);
        (0, util_1.call)(types_1.CH.readLog, siteId, name)
            .then((text) => setSaved({ name, lines: (0, util_1.parseLogFile)(text) }))
            .catch((e) => setError((0, util_1.errText)(e)));
    };
    const toggle = (lv) => setLevels((prev) => {
        const next = new Set(prev);
        next.has(lv) ? next.delete(lv) : next.add(lv);
        return next;
    });
    return (react_1.default.createElement("div", null,
        snapshot && !saved && react_1.default.createElement(Progress_1.default, { snap: snapshot }),
        react_1.default.createElement("fieldset", { "aria-label": "Log filters", style: Object.assign(Object.assign({}, util_1.row), { marginBottom: 8, border: 0, padding: 0, marginInline: 0 }) },
            util_1.LEVELS.map((lv) => (react_1.default.createElement("label", { key: lv },
                react_1.default.createElement("input", { type: "checkbox", checked: levels.has(lv), onChange: () => toggle(lv) }),
                ' ',
                util_1.LEVEL_STYLE[lv].label))),
            react_1.default.createElement("input", { type: "search", placeholder: "Search", "aria-label": "Search the log", style: util_1.input, value: query, onChange: (e) => setQuery(e.target.value) }),
            react_1.default.createElement("label", null,
                react_1.default.createElement("input", { type: "checkbox", checked: auto, onChange: (e) => setAuto(e.target.checked) }),
                ' ',
                "Auto-scroll")),
        react_1.default.createElement("div", { style: Object.assign(Object.assign({}, util_1.row), { marginBottom: 8 }) },
            react_1.default.createElement("button", { type: "button", className: "sr-btn", onClick: () => {
                    var _a, _b;
                    const text = shown.map(fmt).join('\n');
                    const n = shown.length;
                    ((_b = (_a = navigator.clipboard) === null || _a === void 0 ? void 0 : _a.writeText(text)) !== null && _b !== void 0 ? _b : Promise.reject())
                        .then(() => notify(`Copied ${n} log line${n === 1 ? '' : 's'}.`))
                        .catch(() => notify('Could not copy to the clipboard.'));
                } }, "Copy visible"),
            react_1.default.createElement("button", { type: "button", className: "sr-btn", onClick: () => {
                    setCleared(live.length);
                    notify('Log view cleared. The saved log file keeps every line.');
                }, disabled: !!saved }, "Clear view"),
            react_1.default.createElement("button", { type: "button", className: "sr-btn", onClick: () => (0, util_1.call)(types_1.CH.openFolder, siteId).catch((e) => setError((0, util_1.errText)(e))) }, "Open log folder"),
            react_1.default.createElement("label", null,
                "Saved logs",
                ' ',
                react_1.default.createElement("select", { style: util_1.input, value: (_a = saved === null || saved === void 0 ? void 0 : saved.name) !== null && _a !== void 0 ? _a : '', onChange: (e) => open(e.target.value), onFocus: loadFiles },
                    react_1.default.createElement("option", { value: "" }, "Live"),
                    files.map((f) => (react_1.default.createElement("option", { key: f.name, value: f.name },
                        f.name,
                        " (",
                        Math.max(1, Math.round(f.bytes / 1024)),
                        " KB)"))))),
            saved && (react_1.default.createElement(react_1.default.Fragment, null,
                react_1.default.createElement("strong", null,
                    "Saved file: ",
                    saved.name),
                react_1.default.createElement("button", { type: "button", className: "sr-btn", onClick: () => setSaved(null) }, "Back to live")))),
        error && react_1.default.createElement("p", { role: "alert" }, error),
        react_1.default.createElement("div", { ref: box, role: "log", "aria-live": "off", 
            // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling log must be reachable by keyboard
            tabIndex: 0, "aria-label": "Log lines", style: {
                fontFamily: 'monospace',
                fontSize: 12,
                height: 380,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                border: '1px solid var(--sr-border, rgba(127,127,127,.35))',
                background: 'var(--sr-code, transparent)',
                padding: 8,
            } },
            shown.length === 0 && react_1.default.createElement("em", null, "No log lines."),
            shown.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines have no id and only append
            react_1.default.createElement("div", { key: i },
                react_1.default.createElement("span", { style: { color: util_1.LEVEL_STYLE[l.level].color, fontWeight: 600 } },
                    "[",
                    util_1.LEVEL_STYLE[l.level].label,
                    "]"),
                ' ',
                l.text)))),
        react_1.default.createElement("output", { className: "sr-toast" }, toast)));
}
