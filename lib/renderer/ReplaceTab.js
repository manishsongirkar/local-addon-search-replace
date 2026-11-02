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
exports.default = ReplaceTab;
const react_1 = __importStar(require("react"));
const types_1 = require("../common/types");
const Progress_1 = __importDefault(require("./Progress"));
const util_1 = require("./util");
const BOOL_GROUPS = [
    [
        'Safety',
        [
            ['backup', 'Back up the database first'],
            ['precise', 'Precise mode (slower, safer for odd serialized data)'],
        ],
    ],
    [
        'Matching',
        [
            ['includeVariants', 'Include http/https, //, escaped and encoded forms'],
            ['protectEmails', 'Keep domains inside e-mail addresses'],
        ],
    ],
    [
        'WP-CLI',
        [
            ['reportChangedOnly', 'Report changed tables only (--report-changed-only)'],
            ['skipPlugins', 'Do not load plugins (--skip-plugins)'],
            ['skipThemes', 'Do not load the theme (--skip-themes)'],
            ['skipPackages', 'Do not load WP-CLI packages (--skip-packages)'],
            ['flushCache', 'Flush the cache when done'],
            ['fallback', 'Use the built-in fallback if WP-CLI cannot run'],
        ],
    ],
];
const TEXTS = [
    ['skipColumns', 'Skip columns', 'Comma separated. The guid column is always skipped.'],
    ['regexFlags', 'Regex flags', 'For regex pairs, for example i.'],
    ['wpPath', 'WordPress path', 'Empty = detect.'],
];
const ICON = {
    error: ['✖', 'Error'],
    warning: ['⚠', 'Warning'],
    info: ['ℹ', 'Info'],
};
let seq = 0;
const newId = (kind) => `${kind}-${Math.random().toString(36).slice(2, 10)}${++seq}`;
function ReplaceTab({ siteId, pairs, setPairs, options, setOptions, snapshot, onStarted, onShowLogs, loaded, importInfo, setImportInfo, }) {
    var _a;
    const [scan, setScan] = (0, react_1.useState)(null);
    const [scanning, setScanning] = (0, react_1.useState)(false);
    const [error, setError] = (0, react_1.useState)('');
    // A run that did not start. Shown under the Run buttons, where the click happened.
    const [runError, setRunError] = (0, react_1.useState)('');
    const [starting, setStarting] = (0, react_1.useState)(false);
    const [scannedAt, setScannedAt] = (0, react_1.useState)(null);
    const [autoNote, setAutoNote] = (0, react_1.useState)('');
    const [issues, setIssues] = (0, react_1.useState)([]);
    const [confirmed, setConfirmed] = (0, react_1.useState)(false);
    const active = !!snapshot && ['preparing', 'running', 'cancelling'].includes(snapshot.state);
    const runOpts = (dryRun) => (Object.assign(Object.assign({}, options), { pairs, dryRun }));
    // Live validation. A real run is checked, so the strictest rules show.
    // biome-ignore lint/correctness/useExhaustiveDependencies: runOpts is rebuilt every render
    (0, react_1.useEffect)(() => {
        const t = setTimeout(() => {
            (0, util_1.call)(types_1.CH.validate, siteId, runOpts(false))
                .then(setIssues)
                .catch(() => setIssues([]));
        }, 400);
        return () => clearTimeout(t);
    }, [siteId, pairs, options]);
    const needsConfirm = issues.some((i) => i.needsConfirm);
    const hasErrors = issues.some((i) => i.level === 'error');
    // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the set of issues changes
    (0, react_1.useEffect)(() => setConfirmed(false), [issues.map((i) => { var _a; return i.code + ((_a = i.pairId) !== null && _a !== void 0 ? _a : ''); }).join()]);
    const doScan = (...args_1) => __awaiter(this, [...args_1], void 0, function* (note = '', startSite = false) {
        setScanning(true);
        setError('');
        try {
            const res = yield (0, util_1.call)(types_1.CH.scan, siteId, options.wpPath, { pairs, options }, startSite);
            setScan(res);
            setImportInfo(res.importInfo);
            setScannedAt(Date.now());
            setAutoNote(note);
            // Main already merged the scan into the saved list and saved it. Show that list.
            setPairs(() => res.pairs);
        }
        catch (e) {
            setScan(null);
            setError((0, util_1.errText)(e));
        }
        finally {
            setScanning(false);
        }
    });
    // The database can change under this page: an import with WP-CLI, phpMyAdmin or the mysql command, a new site URL.
    // So the page asks main when it opens and when you come back to Local, and scans again when something changed.
    const busyNow = (0, react_1.useRef)(false);
    busyNow.current = scanning || active || starting;
    const lastCheck = (0, react_1.useRef)(0);
    const checkNow = (0, react_1.useRef)(() => __awaiter(this, void 0, void 0, function* () { return undefined; }));
    checkNow.current = () => __awaiter(this, void 0, void 0, function* () {
        if (busyNow.current)
            return;
        lastCheck.current = Date.now();
        try {
            const c = yield (0, util_1.call)(types_1.CH.check, siteId, options.wpPath);
            if (c.changed)
                yield doScan(c.reason);
        }
        catch (_a) {
            // The site may be stopped. The Scan site button shows the reason when you press it.
        }
    });
    // biome-ignore lint/correctness/useExhaustiveDependencies: siteId is a trigger, so a site switch checks again.
    (0, react_1.useEffect)(() => {
        if (!loaded)
            return;
        void checkNow.current();
        const onFocus = () => {
            if (Date.now() - lastCheck.current > 15000)
                void checkNow.current();
        };
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, [loaded, siteId]);
    const start = (dryRun) => __awaiter(this, void 0, void 0, function* () {
        setRunError('');
        setStarting(true);
        try {
            onStarted();
            yield (0, util_1.call)(types_1.CH.start, siteId, runOpts(dryRun));
            // The run is under way. Show its logs, live, for a dry run and a real run alike.
            onShowLogs();
        }
        catch (e) {
            setRunError((0, util_1.errText)(e));
        }
        finally {
            setStarting(false);
        }
    });
    const patch = (id, change) => setPairs((cur) => cur.map((p) => (p.id === id ? Object.assign(Object.assign({}, p), change) : p)));
    const trim = (v) => v.replace(/\/+$/, '');
    const infoFor = (p) => p.origin === 'scan'
        ? scan === null || scan === void 0 ? void 0 : scan.candidates.find((c) => trim(c.value) === trim(p.search))
        : undefined;
    const levelOrder = ['error', 'warning', 'info'];
    const sorted = [...issues].sort((a, b) => levelOrder.indexOf(a.level) - levelOrder.indexOf(b.level));
    const [filter, setFilter] = (0, react_1.useState)('');
    const q = filter.trim().toLowerCase();
    const matches = (p) => !q || p.search.toLowerCase().includes(q) || p.replace.toLowerCase().includes(q);
    const groupOf = (p) => { var _a; return (p.origin === 'scan' ? ((_a = p.kind) !== null && _a !== void 0 ? _a : 'other') : 'custom'); };
    const GROUPS = [
        ['main', 'Main domains', 'The domains this site is registered under. Ticked: start here.'],
        ['close', 'Close domains', 'Near a main domain, with a suggested replace. Not ticked.'],
        [
            'other',
            'Other domains found in the database',
            'Not ticked. Tick one and type its replace text to change it too.',
        ],
        ['custom', 'Added by you', ''],
    ];
    const renderRow = (p) => {
        var _a, _b;
        return (react_1.default.createElement("fieldset", { key: p.id, className: "sr-pair", "aria-label": p.search || 'New pair' },
            react_1.default.createElement("input", { type: "checkbox", "aria-label": "Replace this domain", checked: p.enabled, onChange: (e) => patch(p.id, { enabled: e.target.checked }) }),
            react_1.default.createElement("input", { style: Object.assign(Object.assign({}, util_1.input), { width: '100%' }), "aria-label": "Search", placeholder: "Search", value: p.search, onChange: (e) => patch(p.id, { search: e.target.value }) }),
            react_1.default.createElement("span", { className: "sr-arrow sr-muted", "aria-hidden": "true" }, "\u2192"),
            react_1.default.createElement("input", { style: Object.assign(Object.assign({}, util_1.input), { width: '100%' }), "aria-label": "Replace", placeholder: "Replace", value: p.replace, onChange: (e) => patch(p.id, { replace: e.target.value }) }),
            react_1.default.createElement("small", { className: "sr-src sr-muted" }, p.origin === 'scan' ? 'from scan' : 'custom'),
            react_1.default.createElement("label", { style: { whiteSpace: 'nowrap' } },
                react_1.default.createElement("input", { type: "checkbox", checked: p.regex, onChange: (e) => patch(p.id, { regex: e.target.checked }) }),
                ' ',
                "Regex"),
            react_1.default.createElement("button", { type: "button", className: "sr-btn sr-btn-sm", "aria-label": `Remove pair ${p.search}`.trim(), onClick: () => setPairs((cur) => cur.filter((x) => x.id !== p.id)) }, "Remove"),
            infoFor(p) && (react_1.default.createElement("small", { className: "sr-pair-note" },
                "Found ", (_a = infoFor(p)) === null || _a === void 0 ? void 0 :
                _a.count,
                "\u00D7 \u00B7 ", (_b = infoFor(p)) === null || _b === void 0 ? void 0 :
                _b.sources.join(', ')))));
    };
    const blocked = active || scanning || hasErrors || pairs.every((p) => !p.enabled);
    return (react_1.default.createElement("div", null,
        importInfo && (react_1.default.createElement("aside", { className: "sr-banner", "aria-label": "Database import" },
            react_1.default.createElement("strong", null, importInfo.replaced ? 'Last import' : 'Imported database'),
            react_1.default.createElement("div", null,
                "Imported from ",
                react_1.default.createElement("code", null, importInfo.from),
                ' ',
                importInfo.replaced ? 'and replaced with' : '→ Local domain',
                ' ',
                react_1.default.createElement("code", null, importInfo.to)),
            react_1.default.createElement("small", { className: "sr-muted" }, importInfo.replaced
                ? `Replaced on ${new Date((_a = importInfo.replacedAt) !== null && _a !== void 0 ? _a : importInfo.at).toLocaleString()}.`
                : `Seen on ${new Date(importInfo.at).toLocaleString()}. Tick the pair below and run to replace it.`))),
        react_1.default.createElement("p", { role: "note", className: "sr-muted", style: { margin: '0 0 16px' } },
            react_1.default.createElement("strong", null, "All tables:"),
            " ",
            types_1.ALL_TABLES_NOTICE),
        react_1.default.createElement("section", { className: "sr-card", "aria-label": "Scan" },
            react_1.default.createElement("div", { style: util_1.row },
                react_1.default.createElement("button", { type: "button", className: "sr-btn", onClick: () => {
                        if (!scanning && !active)
                            void doScan('', true);
                    }, "aria-disabled": scanning || active }, scanning ? 'Scanning…' : 'Scan site'),
                scan && (react_1.default.createElement("span", { className: "sr-muted" },
                    "Local URL: ",
                    scan.localUrl,
                    " \u00B7",
                    ' ',
                    scan.context.multisite
                        ? scan.context.subdomain
                            ? 'multisite (sub-domains)'
                            : 'multisite (sub-directories)'
                        : 'single site'))),
            react_1.default.createElement("output", { className: "sr-muted", style: { display: 'block', marginTop: scanning ? 8 : 0 } }, scanning
                ? 'Scanning. If the site is stopped, Local starts it first. This can take a minute.'
                : ''),
            (scan === null || scan === void 0 ? void 0 : scan.context.fallback) && (react_1.default.createElement("output", { style: { display: 'block' } }, "WP-CLI could not run; using built-in fallback.")),
            scannedAt && (react_1.default.createElement("p", { style: { margin: '8px 0 0' } },
                react_1.default.createElement("small", { className: "sr-muted" },
                    "Last scan ",
                    new Date(scannedAt).toLocaleTimeString(),
                    ".",
                    ' ',
                    autoNote
                        ? `Scanned again automatically: ${autoNote}`
                        : 'The page checks the database when you open it and when you return to Local, and scans again if it changed.'))),
            error && react_1.default.createElement("p", { role: "alert" }, error),
            scan && (scan.added.length > 0 || scan.removed.length > 0) && (react_1.default.createElement("details", null,
                react_1.default.createElement("summary", null,
                    "Added ",
                    scan.added.length,
                    " new domain(s), removed ",
                    scan.removed.length,
                    " that are no longer in the database"),
                scan.added.length > 0 && react_1.default.createElement("p", null,
                    "Added: ",
                    scan.added.join(', ')),
                scan.removed.length > 0 && react_1.default.createElement("p", null,
                    "Removed: ",
                    scan.removed.join(', ')))),
            scan && scan.added.length === 0 && scan.removed.length === 0 && (react_1.default.createElement("output", { style: { display: 'block', margin: '8px 0 0' } }, "Scan finished. The saved list already matches the database."))),
        react_1.default.createElement("section", { className: "sr-card", "aria-label": "Search and replace pairs" },
            react_1.default.createElement("strong", null, "Pairs"),
            " ",
            react_1.default.createElement("small", { className: "sr-muted" }, "(saved for this site)"),
            pairs.length === 0 && react_1.default.createElement("p", null, "No pairs yet. Scan the site or add a domain."),
            pairs.length > 8 && (react_1.default.createElement("p", { style: { margin: '12px 0 0' } },
                react_1.default.createElement("input", { type: "search", style: Object.assign(Object.assign({}, util_1.input), { width: '100%', maxWidth: 360 }), "aria-label": "Filter domains", placeholder: "Filter domains", value: filter, onChange: (e) => setFilter(e.target.value) }))),
            q && (react_1.default.createElement("output", { className: "sr-only" },
                pairs.filter(matches).length,
                " of ",
                pairs.length,
                " domains shown")),
            GROUPS.map(([group, title, hint]) => {
                const rows = pairs.filter((p) => groupOf(p) === group);
                const shown = rows.filter(matches);
                if (rows.length === 0)
                    return null;
                return (react_1.default.createElement("div", { key: group, style: { marginTop: 20 } },
                    react_1.default.createElement("h3", { style: { display: 'inline', fontSize: 'inherit', margin: 0 } }, title),
                    ' ',
                    react_1.default.createElement("span", { className: "sr-badge" }, q ? `${shown.length} of ${rows.length}` : rows.length),
                    hint && (react_1.default.createElement("div", null,
                        react_1.default.createElement("small", { className: "sr-muted" }, hint))),
                    react_1.default.createElement("div", { style: group === 'other'
                            ? { maxHeight: 360, overflow: 'auto', marginTop: 4, paddingRight: 4 }
                            : undefined }, shown.map(renderRow))));
            }),
            react_1.default.createElement("p", { style: { margin: '16px 0 0' } },
                react_1.default.createElement("button", { type: "button", className: "sr-btn", onClick: () => setPairs((cur) => [
                        ...cur,
                        {
                            id: newId('custom'),
                            origin: 'custom',
                            search: '',
                            replace: '',
                            regex: false,
                            enabled: true,
                        },
                    ]) }, "Add domain"))),
        react_1.default.createElement("details", { className: "sr-card" },
            react_1.default.createElement("summary", { style: { cursor: 'pointer', fontWeight: 600 } }, "Options"),
            react_1.default.createElement("p", { className: "sr-muted", style: { margin: '8px 0 0' } },
                react_1.default.createElement("small", null, "Always on: exact upper and lower case matching. The guid column is never changed.")),
            BOOL_GROUPS.map(([title, items]) => (react_1.default.createElement("fieldset", { key: title, className: "sr-group" },
                react_1.default.createElement("legend", null, title),
                react_1.default.createElement("div", { className: "sr-opts" }, items.map(([k, label]) => (react_1.default.createElement("label", { key: k, className: "sr-check" },
                    react_1.default.createElement("input", { type: "checkbox", checked: options[k], onChange: (e) => setOptions(Object.assign(Object.assign({}, options), { [k]: e.target.checked })) }),
                    react_1.default.createElement("span", null, label)))))))),
            react_1.default.createElement("fieldset", { className: "sr-group" },
                react_1.default.createElement("legend", null, "Advanced"),
                react_1.default.createElement("div", { className: "sr-fields" },
                    TEXTS.map(([k, label, hint]) => (react_1.default.createElement("label", { key: k, className: "sr-field" },
                        react_1.default.createElement("span", null, label),
                        react_1.default.createElement("input", { style: Object.assign(Object.assign({}, util_1.input), { width: '100%' }), value: options[k], onChange: (e) => setOptions(Object.assign(Object.assign({}, options), { [k]: e.target.value })) }),
                        react_1.default.createElement("small", { className: "sr-muted" }, hint)))),
                    react_1.default.createElement("label", { className: "sr-field" },
                        react_1.default.createElement("span", null, "Parallel processes"),
                        react_1.default.createElement("input", { type: "number", min: 0, style: Object.assign(Object.assign({}, util_1.input), { width: '100%' }), value: options.workers, onChange: (e) => setOptions(Object.assign(Object.assign({}, options), { workers: Math.max(0, Number.parseInt(e.target.value, 10) || 0) })) }),
                        react_1.default.createElement("small", { className: "sr-muted" }, "0 = auto."))))),
        sorted.length > 0 && (react_1.default.createElement("ul", { style: { listStyle: 'none', margin: '0 0 16px', padding: 0 }, "aria-label": "Checks" }, sorted.map((i, n) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: issues have no id
        react_1.default.createElement("li", { key: n, className: `sr-note sr-note-${i.level}` },
            react_1.default.createElement("strong", null,
                react_1.default.createElement("span", { "aria-hidden": "true" },
                    ICON[i.level][0],
                    " "),
                ICON[i.level][1],
                ":"),
            ' ',
            i.message))))),
        react_1.default.createElement("section", { className: "sr-card sr-actions", "aria-label": "Run" },
            needsConfirm && (react_1.default.createElement("label", { className: "sr-check", style: { flex: '1 1 100%' } },
                react_1.default.createElement("input", { type: "checkbox", checked: confirmed, onChange: (e) => setConfirmed(e.target.checked) }),
                react_1.default.createElement("span", null, "I understand the warnings above and want to run anyway."))),
            react_1.default.createElement("button", { type: "button", className: "sr-btn", onClick: () => start(true), disabled: blocked || starting }, "Dry run"),
            react_1.default.createElement("button", { type: "button", className: "sr-btn sr-btn-primary", onClick: () => start(false), disabled: blocked || starting || (needsConfirm && !confirmed) }, "Run"),
            active && (react_1.default.createElement("button", { type: "button", className: "sr-btn", onClick: () => (0, util_1.call)(types_1.CH.cancel, siteId).catch((e) => setError((0, util_1.errText)(e))), disabled: (snapshot === null || snapshot === void 0 ? void 0 : snapshot.state) === 'cancelling' }, "Cancel")),
            react_1.default.createElement("span", { className: "sr-muted", style: { marginLeft: 'auto' } },
                react_1.default.createElement("small", null, "A dry run changes nothing. It shows what a run would do."))),
        starting && react_1.default.createElement("output", { style: { display: 'block', marginBottom: 8 } }, "Starting\u2026"),
        runError && (react_1.default.createElement("p", { role: "alert", style: { color: 'var(--sr-error, #c62828)', fontWeight: 600 } }, runError)),
        snapshot && react_1.default.createElement(Progress_1.default, { snap: snapshot })));
}
