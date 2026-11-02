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
exports.startIfHalted = startIfHalted;
/**
 * Start the site when Local says it is stopped, so a scan can read its database.
 * This never throws and never blocks the old path: when Local has no such API, the site is not stopped, or the start
 * fails, it returns `false` and the caller goes on as before (and shows the usual "database not reachable" advice).
 */
function startIfHalted(spm, db, site, log) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            if (typeof (spm === null || spm === void 0 ? void 0 : spm.getSiteStatus) !== 'function' || typeof spm.start !== 'function')
                return false;
            if (spm.getSiteStatus(site) !== 'halted')
                return false;
            log('info', 'The site is stopped. Starting it in Local before the scan.');
            yield spm.start(site);
            if (typeof (db === null || db === void 0 ? void 0 : db.waitForDB) === 'function')
                yield db.waitForDB(site);
            log('info', 'The site is running.');
            return true;
        }
        catch (e) {
            log('warn', `Could not start the site: ${e.message}. Scanning without it.`);
            return false;
        }
    });
}
