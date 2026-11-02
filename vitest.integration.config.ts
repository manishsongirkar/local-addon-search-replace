import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/integration/**/*.test.ts'],
		globalSetup: ['tests/integration/globalSetup.ts'],
		pool: 'forks',
		poolOptions: { forks: { singleFork: true } },
		testTimeout: 180_000,
		hookTimeout: 180_000,
	},
});
