import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The app on PowerSync must not carry InstantDB (docs/powersync-migration.md, "How the app gets there").
 *
 * Its pages live under app/sync/ and components/sync/. This follows what they import, and what that imports, to
 * the end, and fails if anything on the way is one of the files that reach InstantDB, or InstantDB itself. So the
 * new app can be built from shared pieces — a button, a date helper, the navigation — and never from an old
 * screen, and the day the old screens are deleted nothing of the new app goes with them.
 */

const root = process.cwd();
const coupled = new Set<string>(JSON.parse(readFileSync(path.join(root, 'test/contracts/instant-coupled-files.json'), 'utf8')));
// The doors to InstantDB themselves, which the list of files that go through them does not name.
for (const door of ['lib/db.ts', 'lib/data-instant.ts', 'lib/instant-admin.ts']) coupled.add(door);

const ALIASES: Array<[string, string]> = [
    ['@family-organizer/data/', 'packages/data/src/'],
    ['@family-organizer/data', 'packages/data/src/index.ts'],
    ['@family-organizer/shared-core', 'packages/shared-core/src/index.ts'],
    ['@/', ''],
];
const ENDINGS = ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx', '/index.js'];

function resolve(from: string, specifier: string): string | null {
    let base: string | null = null;
    if (specifier.startsWith('.')) base = path.join(path.dirname(from), specifier);
    else for (const [alias, target] of ALIASES) if (specifier === alias.replace(/\/$/, '') || specifier.startsWith(alias)) { base = target + specifier.slice(alias.length); break; } // prettier-ignore
    if (base === null) return null;
    for (const ending of ENDINGS) {
        const candidate = path.normalize(base + ending);
        if (existsSync(path.join(root, candidate)) && statSync(path.join(root, candidate)).isFile()) return candidate;
    }
    return null;
}

const IMPORT = /(?:import|export)\s+(?:type\s+)?(?:[^'"()]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const TYPE_ONLY = /^(?:import|export)\s+type\s/;

/** What a file imports that exists at run time: a type-only import brings no code with it. */
function importsOf(file: string): string[] {
    const source = readFileSync(path.join(root, file), 'utf8');
    return Array.from(source.matchAll(IMPORT))
        .filter((match) => !TYPE_ONLY.test(match[0]))
        .map((match) => match[1] ?? match[2]);
}

const isServerActions = (file: string) => /^\s*['"]use server['"]/.test(readFileSync(path.join(root, file), 'utf8'));

function filesUnder(directory: string): string[] {
    if (!existsSync(path.join(root, directory))) return [];
    return readdirSync(path.join(root, directory)).flatMap((entry) => {
        const relative = path.join(directory, entry);
        if (statSync(path.join(root, relative)).isDirectory()) return filesUnder(relative);
        return /\.(ts|tsx)$/.test(entry) ? [relative] : [];
    });
}

describe('the app on PowerSync', () => {
    it('reaches nothing that reaches InstantDB, however far its imports are followed', () => {
        const reachedBy = new Map<string, string>();
        const queue = [...filesUnder('app/sync'), ...filesUnder('components/sync')];
        for (const file of queue) reachedBy.set(file, file);
        const problems: string[] = [];

        while (queue.length > 0) {
            const file = queue.shift()!;
            for (const specifier of importsOf(file)) {
                if (specifier.startsWith('@instantdb/')) {
                    problems.push(`${reachedBy.get(file)} reaches ${specifier} through ${file}`);
                    continue;
                }
                const target = resolve(file, specifier);
                if (!target || reachedBy.has(target)) continue;
                // The data layer's own InstantDB side is loaded only by the old app's frame.
                if (target.startsWith('packages/data/src/instant/')) continue;
                // A module of server actions stays on the server: a screen that imports one is given a way to
                // call it, and none of its code. The server keeps both backends until cleanup, by design.
                if (isServerActions(target)) continue;
                reachedBy.set(target, reachedBy.get(file)!);
                if (coupled.has(target)) problems.push(`${reachedBy.get(file)} reaches ${target} through ${file}`);
                else queue.push(target);
            }
        }

        expect(problems).toEqual([]);
    });
});
