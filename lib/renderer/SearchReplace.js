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
exports.default = SearchReplace;
const react_1 = __importStar(require("react"));
const types_1 = require("../common/types");
const HistoryTab_1 = __importDefault(require("./HistoryTab"));
const LogsTab_1 = __importDefault(require("./LogsTab"));
const ReplaceTab_1 = __importDefault(require("./ReplaceTab"));
const theme_1 = require("./theme");
const util_1 = require("./util");
const MAX_LIVE_LINES = 5000;
const TABS = ['Replace', 'Logs', 'History'];
/** Mounted with `key={site.id}`, so every piece of state below belongs to exactly one site. */
function SearchReplace({ site, context }) {
    var _a;
    const siteId = site.id;
    const [tab, setTab] = (0, react_1.useState)('Replace');
    const [pairs, setPairs] = (0, react_1.useState)([]);
    const [options, setOptions] = (0, react_1.useState)(types_1.DEFAULT_OPTIONS);
    const [importInfo, setImportInfo] = (0, react_1.useState)(null);
    const [loaded, setLoaded] = (0, react_1.useState)(false);
    const [loadError, setLoadError] = (0, react_1.useState)('');
    const [snapshot, setSnapshot] = (0, react_1.useState)(null);
    const [logs, setLogs] = (0, react_1.useState)([]);
    const pending = (0, react_1.useRef)([]);
    // Follow Local's theme. It is read from the page, again whenever the page changes its theme or the system does.
    const root = (0, react_1.useRef)(null);
    const [dark, setDark] = (0, react_1.useState)(true);
    (0, react_1.useEffect)(() => {
        var _a, _b;
        const read = () => {
            var _a;
            const el = root.current;
            if (!el)
                return;
            const backgrounds = [];
            for (let n = el; n; n = n.parentElement)
                backgrounds.push(getComputedStyle(n).backgroundColor);
            setDark((0, theme_1.detectDark)({
                backgrounds,
                text: getComputedStyle(el).color,
                prefersDark: (_a = window.matchMedia) === null || _a === void 0 ? void 0 : _a.call(window, '(prefers-color-scheme: dark)').matches,
            }));
        };
        read();
        const watch = new MutationObserver(read);
        for (const target of [document.documentElement, document.body]) {
            watch.observe(target, {
                attributes: true,
                attributeFilter: ['class', 'style', 'data-theme'],
            });
        }
        const media = (_a = window.matchMedia) === null || _a === void 0 ? void 0 : _a.call(window, '(prefers-color-scheme: dark)');
        (_b = media === null || media === void 0 ? void 0 : media.addEventListener) === null || _b === void 0 ? void 0 : _b.call(media, 'change', read);
        window.addEventListener('focus', read);
        return () => {
            var _a;
            watch.disconnect();
            (_a = media === null || media === void 0 ? void 0 : media.removeEventListener) === null || _a === void 0 ? void 0 : _a.call(media, 'change', read);
            window.removeEventListener('focus', read);
        };
    }, []);
    const palette = (0, theme_1.paletteFor)(dark);
    // Saved mappings and the running or last job.
    (0, react_1.useEffect)(() => {
        let gone = false;
        (0, util_1.call)(types_1.CH.loadConfig, siteId)
            .then((c) => {
            if (gone)
                return;
            setPairs(c.pairs);
            setOptions(c.options);
            setImportInfo(c.importInfo);
            // Only now is it safe to save: an empty form must never replace a config that could not be read.
            setLoaded(true);
        })
            .catch((e) => {
            if (!gone)
                setLoadError(e instanceof Error ? e.message : String(e));
        });
        (0, util_1.call)(types_1.CH.state, siteId)
            .then((v) => {
            if (gone)
                return;
            // Events that arrived before this answer are newer. Keep them.
            setSnapshot((cur) => cur !== null && cur !== void 0 ? cur : v.snapshot);
            setLogs((cur) => {
                const seen = new Set(cur.map((l) => `${l.t}|${l.level}|${l.text}`));
                return [...v.logs.filter((l) => !seen.has(`${l.t}|${l.level}|${l.text}`)), ...cur].slice(-MAX_LIVE_LINES);
            });
        })
            .catch(() => undefined);
        return () => {
            gone = true;
        };
    }, [siteId]);
    // A finished real run may have replaced the imported domain. Main records it, so read the note again.
    const runState = snapshot === null || snapshot === void 0 ? void 0 : snapshot.state;
    (0, react_1.useEffect)(() => {
        if (runState !== 'completed')
            return;
        (0, util_1.call)(types_1.CH.loadConfig, siteId)
            .then((c) => setImportInfo(c.importInfo))
            .catch(() => undefined);
    }, [runState, siteId]);
    // Save after every change, but never before the first load, or an empty form would erase the saved pairs.
    const latest = (0, react_1.useRef)({ pairs, options });
    const unsaved = (0, react_1.useRef)(false);
    (0, react_1.useEffect)(() => {
        if (!loaded)
            return;
        latest.current = { pairs, options };
        unsaved.current = true;
        const t = setTimeout(() => {
            unsaved.current = false;
            void (0, util_1.call)(types_1.CH.saveConfig, siteId, { pairs, options }).catch(() => {
                unsaved.current = true;
            });
        }, 600);
        return () => clearTimeout(t);
    }, [loaded, siteId, pairs, options]);
    // Leaving the page (or another site) inside the 600 ms must not lose the last edit.
    (0, react_1.useEffect)(() => () => {
        if (unsaved.current)
            void (0, util_1.call)(types_1.CH.saveConfig, siteId, latest.current).catch(() => undefined);
    }, [siteId]);
    // Live events. Local sends them to every window, so drop any event of another site.
    (0, react_1.useEffect)(() => {
        const ipc = context.electron.ipcRenderer;
        const onSnap = (_e, s) => s.siteId === siteId && setSnapshot(s);
        const onLog = (_e, id, line) => id === siteId && pending.current.push(line);
        ipc.on(types_1.CH.snapshot, onSnap);
        ipc.on(types_1.CH.log, onLog);
        // Batch log lines: a big run prints thousands of lines.
        const timer = setInterval(() => {
            if (!pending.current.length)
                return;
            const batch = pending.current;
            pending.current = [];
            setLogs((cur) => [...cur, ...batch].slice(-MAX_LIVE_LINES));
        }, 250);
        return () => {
            ipc.removeListener(types_1.CH.snapshot, onSnap);
            ipc.removeListener(types_1.CH.log, onLog);
            clearInterval(timer);
        };
    }, [siteId, context]);
    return (react_1.default.createElement("div", { ref: root, className: "sr-root", style: Object.assign({ padding: 24, overflow: 'auto' }, (0, theme_1.cssVars)(palette)) },
        react_1.default.createElement("style", null, (0, theme_1.baseCss)(palette)),
        loadError && (react_1.default.createElement("p", { role: "alert" },
            "Could not load the saved settings: ",
            loadError,
            ". Nothing is saved from this page until they load. Close the page and open it again.")),
        react_1.default.createElement("div", { role: "tablist", "aria-label": "Search and replace", onKeyDown: (e) => {
                var _a;
                const k = e.key;
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(k))
                    return;
                e.preventDefault();
                const at = TABS.indexOf(tab);
                const next = k === 'Home'
                    ? 0
                    : k === 'End'
                        ? TABS.length - 1
                        : (at + (k === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
                setTab(TABS[next]);
                (_a = document.getElementById(`sr-tab-${TABS[next]}`)) === null || _a === void 0 ? void 0 : _a.focus();
            }, style: {
                display: 'flex',
                gap: 4,
                marginBottom: 20,
                borderBottom: '1px solid var(--sr-border)',
            } }, TABS.map((t) => (react_1.default.createElement("button", { key: t, id: `sr-tab-${t}`, type: "button", role: "tab", className: "sr-tab", "aria-selected": tab === t, "aria-controls": `sr-panel-${t}`, tabIndex: tab === t ? 0 : -1, onClick: () => setTab(t) }, t)))),
        react_1.default.createElement("div", { id: "sr-panel-Replace", role: "tabpanel", "aria-labelledby": "sr-tab-Replace", hidden: tab !== 'Replace' },
            react_1.default.createElement(ReplaceTab_1.default, { siteId: siteId, pairs: pairs, setPairs: setPairs, options: options, setOptions: setOptions, snapshot: snapshot, loaded: loaded, importInfo: importInfo, setImportInfo: setImportInfo, onShowLogs: () => setTab('Logs'), onStarted: () => {
                    setSnapshot(null);
                    pending.current = [];
                    setLogs([]);
                } })),
        tab === 'Logs' && (react_1.default.createElement("div", { id: "sr-panel-Logs", role: "tabpanel", "aria-labelledby": "sr-tab-Logs" },
            react_1.default.createElement(LogsTab_1.default, { siteId: siteId, live: logs, snapshot: snapshot }))),
        tab === 'History' && (react_1.default.createElement("div", { id: "sr-panel-History", role: "tabpanel", "aria-labelledby": "sr-tab-History" },
            react_1.default.createElement(HistoryTab_1.default, { siteId: siteId, refreshKey: (_a = snapshot === null || snapshot === void 0 ? void 0 : snapshot.state) !== null && _a !== void 0 ? _a : '' })))));
}
