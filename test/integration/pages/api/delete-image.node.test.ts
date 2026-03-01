import fs from 'fs/promises';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import handler from '@/pages/api/delete-image';

const repoRoot = process.cwd();
const uploadsDir = path.join(repoRoot, 'public', 'uploads');
const publicDir = path.join(repoRoot, 'public');
const createdPaths = new Set<string>();

function createResponsePromise() {
    let statusCode = 200;

    let resolvePromise: (value: { statusCode: number; body: unknown }) => void = () => {};
    const done = new Promise<{ statusCode: number; body: unknown }>((resolve) => {
        resolvePromise = resolve;
    });

    const res = {
        status(code: number) {
            statusCode = code;
            return this;
        },
        json(payload: unknown) {
            resolvePromise({ statusCode, body: payload });
            return this;
        },
    };

    return { res, done };
}

async function invokeDeleteImage(reqOverrides: any) {
    const { res, done } = createResponsePromise();
    const req = {
        method: 'POST',
        cookies: {},
        body: {},
        ...reqOverrides,
    };

    handler(req as any, res as any);
    return done;
}

async function ensureFile(filePath: string, contents = 'x') {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, contents, 'utf8');
    createdPaths.add(filePath);
}

afterEach(async () => {
    for (const filePath of Array.from(createdPaths)) {
        try {
            await fs.unlink(filePath);
        } catch {}
        createdPaths.delete(filePath);
    }
});

describe('pages/api/delete-image', () => {
    it('rejects unauthorized devices', async () => {
        const result = await invokeDeleteImage({
            cookies: {},
            body: { urls: { 64: 'whatever.png' } },
        });

        expect(result.statusCode).toBe(401);
        expect(result.body).toEqual({ message: 'Unauthorized device' });
    });

    it('ignores traversal-style filenames and does not delete files outside uploads', async () => {
        const outsideFile = path.join(publicDir, `delete-image-test-${Date.now()}.txt`);
        await ensureFile(outsideFile, 'keep me');

        const result = await invokeDeleteImage({
            cookies: { family_device_auth: 'true' },
            body: {
                urls: {
                    64: `../${path.basename(outsideFile)}`,
                },
            },
        });

        expect(result.statusCode).toBe(200);
        expect(await fs.readFile(outsideFile, 'utf8')).toBe('keep me');
    });

    it('deletes safe upload files', async () => {
        const filename = `delete-image-safe-${Date.now()}.png`;
        const uploadFile = path.join(uploadsDir, filename);
        await ensureFile(uploadFile, 'delete me');

        const result = await invokeDeleteImage({
            cookies: { family_device_auth: 'true' },
            body: {
                urls: {
                    64: filename,
                },
            },
        });

        expect(result.statusCode).toBe(200);
        await expect(fs.stat(uploadFile)).rejects.toMatchObject({ code: 'ENOENT' });
        createdPaths.delete(uploadFile);
    });
});
