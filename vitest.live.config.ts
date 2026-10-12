import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// Tests that need the real PowerSync service and a real Postgres, started by scripts/powersync/test-stack.mjs.
// They are not part of `npm test`: run them with `npm run test:sync:live`.
export default defineConfig({
    plugins: [tsconfigPaths()],
    test: {
        globals: true,
        environment: 'node',
        setupFiles: ['./test/setup/vitest.setup.ts'],
        include: ['test/live/**/*.live.ts'],
        testTimeout: 60_000,
        hookTimeout: 60_000,
        fileParallelism: false,
    },
});
