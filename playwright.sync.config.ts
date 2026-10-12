import { defineConfig, devices } from '@playwright/test';

// Browser tests of the app on PowerSync (e2e-sync/). They run the production build against a throwaway Postgres
// and the real PowerSync service in Docker, which scripts/powersync/e2e-server.mjs starts and stops.
//
//   npm run build && npx playwright test --config playwright.sync.config.ts
export default defineConfig({
    testDir: './e2e-sync',
    timeout: 60_000,
    expect: { timeout: 15_000 },
    fullyParallel: false,
    workers: 1,
    reporter: [['list']],
    use: { baseURL: 'http://127.0.0.1:3210', trace: 'retain-on-failure' },
    webServer: {
        command: 'node scripts/powersync/e2e-server.mjs',
        url: 'http://127.0.0.1:3210/api/health',
        reuseExistingServer: false,
        timeout: 180_000,
        gracefulShutdown: { signal: 'SIGTERM', timeout: 30_000 },
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
        { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    ],
});
