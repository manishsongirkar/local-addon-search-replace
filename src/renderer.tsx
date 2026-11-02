import type * as LocalRenderer from '@getflywheel/local/renderer';
import React from 'react';
import SearchReplace from './renderer/SearchReplace';

export default function (context: LocalRenderer.AddonRendererContext): void {
	context.hooks.addFilter('siteInfoToolsItem', (items: unknown[]) => [
		...items,
		{
			path: '/search-replace',
			menuItem: 'Search & Replace',
			// `key` resets all state when the user opens another site.
			render: ({ site }: { site: { id: string } }) => (
				<SearchReplace key={site.id} site={site} context={context} />
			),
		},
	]);
}
