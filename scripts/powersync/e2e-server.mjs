#!/usr/bin/env node
// Runs the app on PowerSync for the browser tests in e2e-sync/: the throwaway Postgres and sync service from
// test-stack.mjs, and the production build of the app pointed at them. Stops all of it when it is told to stop.
//
//   npm run build && node scripts/powersync/e2e-server.mjs
//
// Playwright starts this itself (playwright.sync.config.ts). The app listens on 127.0.0.1:3210.

import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const standalone = path.join(root, '.next', 'standalone');
if (!existsSync(path.join(standalone, 'server.js'))) {
    console.error('There is no production build. Run `npm run build` first.');
    process.exit(1);
}

execFileSync('node', ['scripts/powersync/test-stack.mjs', 'up'], { cwd: root, stdio: 'inherit' });
const env = Object.fromEntries(
    readFileSync(path.join(root, '.migration', 'sync-test', 'env'), 'utf8')
        .split('\n')
        .map((line) => /^([A-Z_]+)=(.*)$/.exec(line))
        .filter(Boolean)
        .map((match) => [match[1], match[2]])
);

// A standalone build serves its static files and public/ from beside server.js, as the Docker image arranges.
cpSync(path.join(root, '.next', 'static'), path.join(standalone, '.next', 'static'), { recursive: true });
cpSync(path.join(root, 'public'), path.join(standalone, 'public'), { recursive: true });
cpSync(path.join(root, 'db'), path.join(standalone, 'db'), { recursive: true });

const server = spawn('node', ['server.js'], {
    cwd: standalone,
    stdio: 'inherit',
    env: {
        ...process.env,
        ...env,
        PORT: '3210',
        HOSTNAME: '127.0.0.1',
        NODE_ENV: 'production',
        DEVICE_ACCESS_KEY: 'sync-e2e-device-key',
        DATA_BACKEND: 'powersync',
    },
});

let stopping = false;
function stop() {
    if (stopping) return;
    stopping = true;
    server.kill('SIGTERM');
    try {
        execFileSync('node', ['scripts/powersync/test-stack.mjs', 'down'], { cwd: root, stdio: 'inherit' });
    } catch {
        // Nothing more to do about a stack that will not stop.
    }
    process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
server.on('exit', stop);
