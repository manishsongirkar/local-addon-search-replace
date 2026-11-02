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
Object.defineProperty(exports, "__esModule", { value: true });
exports.readFingerprint = readFingerprint;
exports.compareFingerprints = compareFingerprints;
const fallback_1 = require("./fallback");
/** Read the fingerprint with mysqli. `null` when the database cannot be reached. */
function readFingerprint(rt) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!rt.db)
            return null;
        const res = yield (0, fallback_1.fallbackJson)(rt, { mode: 'fingerprint' });
        return res.data;
    });
}
/**
 * Did the database change since the last scan?
 * An import by any tool (WP-CLI, phpMyAdmin, the mysql command) recreates the tables. A new site URL changes the URLs.
 * Content that changes without either is not seen: use "Scan site" for that.
 */
function compareFingerprints(previous, next) {
    if (!next)
        return { changed: false, reason: '' };
    if (!previous)
        return { changed: true, reason: 'This site was not scanned in this session.' };
    const tables = previous.tables !== next.tables;
    const urls = previous.urls !== next.urls;
    if (tables && urls)
        return {
            changed: true,
            reason: 'The database was replaced: its tables were created again and its site URL changed.',
        };
    if (tables) {
        return {
            changed: true,
            reason: previous.count !== next.count
                ? `The tables of the database changed (${previous.count} before, ${next.count} now), for example after an import.`
                : 'The tables of the database were created again, for example after an import.',
        };
    }
    if (urls)
        return { changed: true, reason: 'The site URL or the domains of the network changed.' };
    return { changed: false, reason: '' };
}
