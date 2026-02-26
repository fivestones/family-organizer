#!/usr/bin/env node

const { execFileSync } = require('node:child_process');

const idbBin = process.env.IDB_BIN || `${process.env.HOME}/Library/Python/3.9/bin/idb`;
const companion = process.env.IDB_COMPANION || 'localhost:10882';
const childPin = process.env.IDB_CHILD_PIN || '5543';
const parentPin = process.env.IDB_PARENT_PIN || '1234';

function sleep(ms) {
  const sab = new SharedArrayBuffer(4);
  const int32 = new Int32Array(sab);
  Atomics.wait(int32, 0, 0, ms);
}

function runIdb(args) {
  try {
    return execFileSync(idbBin, ['--companion', companion, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr = error?.stderr?.toString?.() || '';
    const stdout = error?.stdout?.toString?.() || '';
    throw new Error(`idb ${args.join(' ')} failed\n${stderr || stdout || error.message}`);
  }
}

function describeAll() {
  const output = runIdb(['ui', 'describe-all']);
  return JSON.parse(output);
}

function centerOf(frame) {
  return {
    x: Math.round(frame.x + frame.width / 2),
    y: Math.round(frame.y + frame.height / 2),
  };
}

function matchesText(value, expected) {
  return typeof value === 'string' && value.toLowerCase().includes(expected.toLowerCase());
}

function findElement(tree, { id, labelIncludes, type }) {
  return tree.find((el) => {
    if (id && el.AXUniqueId !== id) return false;
    if (labelIncludes && !matchesText(el.AXLabel, labelIncludes)) return false;
    if (type && el.type !== type) return false;
    return true;
  });
}

function requireElement(tree, query, description) {
  const el = findElement(tree, query);
  if (!el) {
    throw new Error(`Could not find ${description}`);
  }
  return el;
}

function tapElement(tree, query, description) {
  const el = requireElement(tree, query, description);
  const { x, y } = centerOf(el.frame);
  runIdb(['ui', 'tap', String(x), String(y)]);
  return el;
}

function typeText(value) {
  runIdb(['ui', 'text', value]);
}

function expectScreen(tree, label) {
  const found = findElement(tree, { labelIncludes: label });
  if (!found) {
    throw new Error(`Expected screen containing "${label}"`);
  }
}

function waitForElement(query, description, timeoutMs = 6000, stepMs = 300) {
  const startedAt = Date.now();
  let lastTree = [];
  while (Date.now() - startedAt < timeoutMs) {
    lastTree = describeAll();
    const found = findElement(lastTree, query);
    if (found) {
      return { element: found, tree: lastTree };
    }
    sleep(stepMs);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function waitForScreen(label, timeoutMs = 6000, stepMs = 300) {
  return waitForElement({ labelIncludes: label }, `screen containing "${label}"`, timeoutMs, stepMs).tree;
}

function maybeWaitForScreen(label, timeoutMs = 1500, stepMs = 250) {
  try {
    return waitForScreen(label, timeoutMs, stepMs);
  } catch {
    return null;
  }
}

function maybeWaitForElement(query, description, timeoutMs = 1500, stepMs = 250) {
  try {
    return waitForElement(query, description, timeoutMs, stepMs);
  } catch {
    return null;
  }
}

function logStep(message) {
  process.stdout.write(`• ${message}\n`);
}

function main() {
  logStep(`Using idb companion at ${companion}`);
  logStep('Checking lock screen');
  let tree = describeAll();
  expectScreen(tree, "Who’s using the app?");

  logStep('Child flow: Judah login');
  tapElement(tree, { id: 'member-card-judah' }, 'Judah member card');
  tree =
    maybeWaitForElement({ id: 'member-pin-input' }, 'Judah PIN input', 2000)?.tree ||
    (() => {
      const refreshed = describeAll();
      tapElement(refreshed, { id: 'member-card-judah' }, 'Judah member card (retry)');
      return waitForElement({ id: 'member-pin-input' }, 'Judah PIN input', 5000).tree;
    })();
  tree = waitForElement({ id: 'member-pin-input' }, 'Judah PIN input', 2000).tree;
  tapElement(tree, { id: 'member-pin-input' }, 'member PIN input');
  typeText(childPin);
  sleep(200);
  tree = describeAll();
  tapElement(tree, { id: 'member-confirm-button' }, 'Unlock button');
  tree = waitForScreen('Chores', 8000);
  requireElement(tree, { id: 'chores-switch-user-button' }, 'Chores switch user button');

  logStep('Child flow: Switch User');
  sleep(400);
  tree = describeAll();
  tapElement(tree, { id: 'chores-switch-user-button' }, 'Chores switch user button');
  tree = maybeWaitForScreen("Who’s using the app?", 2000) || (() => {
    const refreshed = describeAll();
    if (findElement(refreshed, { id: 'chores-switch-user-button' })) {
      tapElement(refreshed, { id: 'chores-switch-user-button' }, 'Chores switch user button (retry)');
    }
    return waitForScreen("Who’s using the app?", 8000);
  })();
  requireElement(tree, { id: 'member-card-judah' }, 'lock screen family member cards');

  logStep('Parent flow: David elevation');
  tapElement(tree, { id: 'member-card-david' }, 'David member card');
  tree =
    maybeWaitForElement({ id: 'member-pin-input' }, 'parent PIN input', 2000)?.tree ||
    (() => {
      const refreshed = describeAll();
      tapElement(refreshed, { id: 'member-card-david' }, 'David member card (retry)');
      return waitForElement({ id: 'member-pin-input' }, 'parent PIN input', 5000).tree;
    })();
  tree = waitForElement({ id: 'member-pin-input' }, 'parent PIN input', 2000).tree;
  tapElement(tree, { id: 'member-pin-input' }, 'parent PIN input');
  typeText(parentPin);
  sleep(200);
  tree = describeAll();
  tapElement(tree, { id: 'member-confirm-button' }, 'parent Unlock button');
  tree = waitForScreen('Chores', 8000);
  requireElement(tree, { id: 'chores-switch-user-button' }, 'Chores switch user button');
  requireElement(tree, { labelIncludes: 'Parent mode' }, 'Parent mode indicator');

  logStep('Parent flow: More tab -> Lock App');
  tapElement(tree, { labelIncludes: 'More, tab' }, 'More tab button');
  tree =
    maybeWaitForElement({ id: 'more-lock-app-button' }, 'More lock app button', 2000)?.tree ||
    (() => {
      const refreshed = describeAll();
      tapElement(refreshed, { labelIncludes: 'More, tab' }, 'More tab button (retry)');
      return waitForElement({ id: 'more-lock-app-button' }, 'More lock app button', 6000).tree;
    })();
  tapElement(tree, { id: 'more-lock-app-button' }, 'More lock app button');
  tree = waitForScreen("Who’s using the app?");

  process.stdout.write('\nPASS: child login/switch-user and parent elevation/lock flows succeeded via idb.\n');
}

try {
  main();
} catch (error) {
  process.stderr.write(`\nFAIL: ${error.message}\n`);
  process.stderr.write(
    '\nHints: make sure Expo Go is open on the app, the backend is running on :3000, and idb_companion is running (e.g. on localhost:10882).\n'
  );
  process.exit(1);
}
