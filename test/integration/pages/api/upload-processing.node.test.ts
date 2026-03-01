import { beforeEach, describe, expect, it, vi } from 'vitest';

const uploadProcessingMocks = vi.hoisted(() => {
    const fsDefault = {
        mkdirSync: vi.fn(),
        unlinkSync: vi.fn(),
        promises: {
            unlink: vi.fn(),
        },
    };

    return {
        formidable: vi.fn(),
        parse: vi.fn(),
        sharp: vi.fn(),
        fsDefault,
        randomUUID: vi.fn(),
        sharpToFileCalls: [] as Array<{ input: string; resizeArgs: any[]; output: string }>,
    };
});

vi.mock('formidable', () => ({
    default: uploadProcessingMocks.formidable,
}));

vi.mock('sharp', () => ({
    default: uploadProcessingMocks.sharp,
}));

vi.mock('fs', () => ({
    default: uploadProcessingMocks.fsDefault,
}));

vi.mock('crypto', async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    return {
        ...actual,
        randomUUID: uploadProcessingMocks.randomUUID,
    };
});

function createResponsePromise() {
    let statusCode = 200;
    let body: unknown;

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
            body = payload;
            resolvePromise({ statusCode, body });
            return this;
        },
    };

    return { res, done };
}

describe('pages/api/upload parsing and image processing', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        uploadProcessingMocks.sharpToFileCalls.length = 0;

        uploadProcessingMocks.randomUUID.mockReturnValue('uuid-test');
        uploadProcessingMocks.formidable.mockImplementation(() => ({
            parse: uploadProcessingMocks.parse,
        }));
        uploadProcessingMocks.sharp.mockImplementation((input: string) => ({
            resize: (...resizeArgs: any[]) => ({
                toFile: async (output: string) => {
                    uploadProcessingMocks.sharpToFileCalls.push({ input, resizeArgs, output });
                },
            }),
        }));
    });

    async function invokeUpload(reqOverrides: any) {
        const { res, done } = createResponsePromise();
        const { default: handler } = await import('@/pages/api/upload');
        const req = {
            method: 'POST',
            cookies: { family_device_auth: 'true' },
            ...reqOverrides,
        };
        await handler(req as any, res as any);
        return done;
    }

    it('returns 400 when formidable parse fails', async () => {
        uploadProcessingMocks.parse.mockImplementation((_req, cb) => {
            cb(new Error('parse failed'), {}, {});
        });

        const result = await invokeUpload({});

        expect(result.statusCode).toBe(400);
        expect(result.body).toEqual({ message: 'Error parsing files' });
    });

    it('rejects unsupported mime types and deletes the uploaded temp file', async () => {
        uploadProcessingMocks.parse.mockImplementation((_req, cb) => {
            cb(null, {}, { file: { mimetype: 'text/plain', filepath: '/tmp/upload.txt' } });
        });

        const result = await invokeUpload({});

        expect(result.statusCode).toBe(400);
        expect(result.body).toEqual({ message: 'Unsupported file type' });
        expect(uploadProcessingMocks.fsDefault.promises.unlink).toHaveBeenCalledWith('/tmp/upload.txt');
        expect(uploadProcessingMocks.sharp).not.toHaveBeenCalled();
    });

    it('processes a valid image into 3 sizes and returns generated filenames', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
        uploadProcessingMocks.parse.mockImplementation((_req, cb) => {
            cb(null, {}, { file: { mimetype: 'image/png', filepath: '/tmp/upload.png' } });
        });

        const result = await invokeUpload({});

        expect(result.statusCode).toBe(200);
        expect(result.body).toEqual({
            photoUrls: {
                64: '1700000000000_uuid-test_cropped_image_64.png',
                320: '1700000000000_uuid-test_cropped_image_320.png',
                1200: '1700000000000_uuid-test_cropped_image_1200.png',
            },
        });
        expect(uploadProcessingMocks.sharp).toHaveBeenCalledTimes(3);
        expect(uploadProcessingMocks.sharpToFileCalls).toHaveLength(3);
        expect(uploadProcessingMocks.fsDefault.unlinkSync).toHaveBeenCalledWith('/tmp/upload.png');
    });
});
