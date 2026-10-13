import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
    plugins: [tsconfigPaths()],
    test: {
        // The suite now runs hundreds of database tests beside the browser ones, and with every core busy a
        // component test that takes a second alone has crossed the usual five and failed for no other reason.
        testTimeout: 20_000,
        globals: true,
        environment: 'node',
        setupFiles: ['./test/setup/vitest.setup.ts'],
        include: ['test/**/*.test.{ts,tsx}'],
        exclude: ['node_modules/**', '.next/**', 'e2e/**'],
        restoreMocks: true,
        clearMocks: true,
        mockReset: true,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov'],
            reportsDirectory: './coverage',
            include: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}', 'middleware.ts', 'instant.perms.ts'],
            exclude: ['**/*.d.ts', '**/*.test.*', 'components/ui/**'],
        },
    },
});
