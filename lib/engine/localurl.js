"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withSsl = withSsl;
const urls_1 = require("./urls");
/**
 * The URL of a Local site, with the protocol it is really served on.
 * Local builds `site.url` as `http://<host>` whatever the SSL state, so the SSL state is applied here:
 * - SSL is on for a site when its certificate is trusted by the system (that is what Local's "Trust" button does);
 * - it works for site domains (`my-site.test`). With localhost routing (`localhost:10008`) Local serves plain http.
 */
function withSsl(url, certificateTrusted) {
    const p = (0, urls_1.parseUrlish)(url);
    if (!p || !certificateTrusted || p.scheme !== 'http')
        return url;
    if (p.port || p.host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(p.host))
        return url;
    return `https://${p.host}${p.path}`.replace(/\/$/, '');
}
