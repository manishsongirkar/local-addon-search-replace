"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = default_1;
const react_1 = __importDefault(require("react"));
const SearchReplace_1 = __importDefault(require("./renderer/SearchReplace"));
function default_1(context) {
    context.hooks.addFilter('siteInfoToolsItem', (items) => [
        ...items,
        {
            path: '/search-replace',
            menuItem: 'Search & Replace',
            // `key` resets all state when the user opens another site.
            render: ({ site }) => (react_1.default.createElement(SearchReplace_1.default, { key: site.id, site: site, context: context })),
        },
    ]);
}
