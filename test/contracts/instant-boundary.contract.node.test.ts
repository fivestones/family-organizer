import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The ratchet for the move off InstantDB (docs/powersync-migration.md, Phase 1).
 *
 * Screens are moving, area by area, to the data layer in packages/data. This test holds the line while they do:
 * `instant-coupled-files.json` lists every file that still reaches InstantDB directly. No file may join the list,
 * and a file that has been converted must leave it. When the list is empty, the app touches Instant only through
 * the data layer's own Instant implementation — which is what makes that implementation replaceable.
 *
 * After converting files, regenerate the list:
 *   UPDATE_INSTANT_BOUNDARY=1 npx vitest run test/contracts/instant-boundary.contract.node.test.ts
 */

const root = process.cwd();
const listPath = path.join(root, 'test/contracts/instant-coupled-files.json');

const SCANNED = ['app', 'components', 'lib', 'mobile/app', 'mobile/src', 'scripts'];

/** The places that are allowed to know about Instant: the client entry points and the data layer's implementation. */
const DOORS = new Set(['lib/db.ts', 'lib/data.ts', 'lib/instant-admin.ts', 'mobile/src/lib/instant-db.js', 'mobile/src/lib/instant-mmkv-store.js']);

const REACHES_INSTANT = [
    /from\s+['"]@instantdb\//,
    /require\(['"]@instantdb\//,
    /from\s+['"]@\/lib\/db['"]/,
    /from\s+['"]@\/lib\/instant-admin['"]/,
    /from\s+['"][./]+\/(?:src\/)?lib\/instant-db['"]/,
    /\(?\bdb\b(?:\s+as\s+any\))?\.(?:useQuery|queryOnce|transact|tx|auth|rooms|room|useAuth|useConnectionStatus)\b/,
    /\badminDb\.(?:query|transact|tx|auth)\b/,
];

function sourceFiles(directory: string): string[] {
    const absolute = path.join(root, directory);
    if (!existsSync(absolute)) return [];
    return readdirSync(absolute).flatMap((entry) => {
        if (entry === 'node_modules' || entry.startsWith('.')) return [];
        const relative = path.join(directory, entry);
        if (statSync(path.join(root, relative)).isDirectory()) return sourceFiles(relative);
        return /\.(ts|tsx|js|jsx|mjs)$/.test(entry) && !entry.endsWith('.d.ts') ? [relative] : [];
    });
}

function findCoupledFiles(): string[] {
    return SCANNED.flatMap(sourceFiles)
        .filter((file) => !DOORS.has(file))
        .filter((file) => {
            const source = readFileSync(path.join(root, file), 'utf8');
            return REACHES_INSTANT.some((pattern) => pattern.test(source));
        })
        .sort();
}

describe('the Instant boundary', () => {
    const actual = findCoupledFiles();

    if (process.env.UPDATE_INSTANT_BOUNDARY === '1') {
        writeFileSync(listPath, `${JSON.stringify(actual, null, 4)}\n`);
    }

    const recorded: string[] = JSON.parse(readFileSync(listPath, 'utf8'));

    it('lets no new file reach InstantDB directly', () => {
        const added = actual.filter((file) => !recorded.includes(file));
        expect(added, 'These files reach InstantDB directly and are not on the list. Use the data layer (packages/data) instead.').toEqual([]);
    });

    it('drops a file from the list once it has been converted', () => {
        const converted = recorded.filter((file) => !actual.includes(file));
        expect(converted, 'These files no longer reach InstantDB. Regenerate the list (see the top of this test) so they cannot slip back.').toEqual([]);
    });

    it('keeps the data layer itself free of Instant outside its Instant implementation', () => {
        const leaks = sourceFiles('packages/data/src')
            .filter((file) => !file.startsWith(path.join('packages/data/src/instant') + path.sep))
            .filter((file) => /@instantdb\/|\btx\.|\bdb\.useQuery\b/.test(readFileSync(path.join(root, file), 'utf8')));
        expect(leaks).toEqual([]);
    });
});
