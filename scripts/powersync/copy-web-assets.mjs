#!/usr/bin/env node
// Copies the PowerSync web client's worker and WebAssembly loader files into public/@powersync/, where the browser
// loads them from, and lists them, so the service worker can keep them for starting with no network.
//
// Run before `next dev` and `next build` (npm run sync:assets).

import { execFileSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const target = path.join(root, 'public', '@powersync');
execFileSync(path.join(root, 'node_modules', '.bin', 'powersync-web'), ['copy-assets', '-o', 'public'], { cwd: root, stdio: 'ignore' });

// Source maps are for a debugger, not for running: they are left out of what a device keeps.
const files = readdirSync(target).filter((file) => !file.endsWith('.map') && file !== 'files.json').sort();
writeFileSync(path.join(target, 'files.json'), `${JSON.stringify(files.map((file) => `/@powersync/${file}`), null, 2)}\n`);
console.log(`PowerSync web assets: ${files.length} files in public/@powersync/`);
