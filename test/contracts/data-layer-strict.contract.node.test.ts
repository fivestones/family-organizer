import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

/**
 * The rest of the app compiles with `strict` off. The data layer is what everything else will stand on, and the
 * phone's screens that call it are plain JavaScript, so it is held to strict TypeScript here.
 *
 * Its tsconfig also reaches `shared-core`, which is not strict yet; only errors in the data layer's own files count.
 */
describe('the data layer', () => {
    it('passes strict TypeScript', () => {
        const tsc = path.join(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc');
        const result = spawnSync(process.execPath, [tsc, '--noEmit', '-p', 'packages/data/tsconfig.json'], { encoding: 'utf8' });
        const errors = `${result.stdout}${result.stderr}`.split('\n').filter((line) => line.startsWith('packages/data/'));
        expect(errors).toEqual([]);
    }, 180_000);
});
