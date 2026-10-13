#!/usr/bin/env node
// Looks for the family's own words in what is about to be committed or pushed.
//
// The export under .migration/exports/ is real data: names, chore titles, messages. None of it belongs in this
// repository, which is public. This reads the newest export, takes every name and every phrase a person typed,
// and searches the lines a range of commits adds for them. It prints where a match is and never what matched.
//
//   node scripts/migrate/leak-check.mjs                 what is staged
//   node scripts/migrate/leak-check.mjs origin/main..   every commit not yet pushed
//
// A match is not always a leak: two ordinary words that someone also used as a label will match. Look at the line.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const exportsRoot = path.join(root, '.migration', 'exports');
if (!existsSync(exportsRoot)) {
    console.log('No export here, so nothing to compare with.');
    process.exit(0);
}
const exportDir = path.join(exportsRoot, readdirSync(exportsRoot).sort().at(-1), 'entities');

/** Attributes that hold what a person typed. */
const TYPED = new Set(['name', 'title', 'description', 'label', 'text', 'body', 'note', 'notes', 'summary', 'location', 'editNote', 'richTextContent', 'latestMessagePreview', 'displayName', 'accountLabel', 'username', 'email']);
const phrases = new Set();
const names = new Set();
const collect = (value, key) => {
    if (Array.isArray(value)) for (const item of value) collect(item, key);
    else if (value && typeof value === 'object') for (const [name, item] of Object.entries(value)) collect(item, name);
    else if (typeof value === 'string' && TYPED.has(key)) {
        const text = value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (text.length >= 6 && text.length <= 120 && text.includes(' ')) phrases.add(text);
    }
};
for (const file of readdirSync(exportDir).filter((name) => name.endsWith('.jsonl'))) {
    // The log of calendar sync runs is most of the export and holds nothing anyone typed.
    if (file === 'calendarSyncRuns.jsonl') continue;
    for (const line of readFileSync(path.join(exportDir, file), 'utf8').split('\n').filter(Boolean)) {
        const { entity } = JSON.parse(line);
        collect(entity, null);
        if (file === 'familyMembers.jsonl') for (const word of String(entity.name ?? '').match(/[A-Za-z]{3,}/g) ?? []) names.add(word);
    }
}
// The repository's owner is named in its history and its documents already.
const owner = execFileSync('git', ['config', 'user.name'], { cwd: root, encoding: 'utf8' }).trim().split(/\s+/);
for (const word of owner) names.delete(word);

const range = process.argv[2];
const diff = execFileSync('git', ['diff', '--unified=0', ...(range ? [range] : ['--cached'])], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const tag = (text) => createHash('sha1').update(text).digest('hex').slice(0, 6);
let file = null;
let line = 0;
let found = 0;
for (const text of diff.split('\n')) {
    if (text.startsWith('+++ ')) file = text.startsWith('+++ b/') ? text.slice(6) : null;
    else if (text.startsWith('@@')) line = Number(/\+(\d+)/.exec(text)?.[1] ?? 0) - 1;
    else if (text.startsWith('+') && file) {
        line += 1;
        const words = new Set(text.match(/[A-Za-z]{3,}/g) ?? []);
        const hits = [...[...phrases].filter((phrase) => text.includes(phrase)).map((phrase) => `phrase ${tag(phrase)}`), ...[...names].filter((name) => words.has(name)).map((name) => `name ${tag(name)}`)];
        if (hits.length) {
            found += 1;
            console.log(`${file}:${line}  ${hits.join(', ')}`);
        }
    }
}
console.log(found ? `\n${found} line${found === 1 ? '' : 's'} to look at. A match is named by a tag, never shown.` : `Nothing from the export in ${range ?? 'what is staged'} (${phrases.size} phrases and ${names.size} names looked for).`);
process.exitCode = found ? 1 : 0;
