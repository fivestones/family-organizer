import { describe, expect, it } from 'vitest';
import handler from '@/pages/api/upload';

function createResponse() {
    let statusCode = 200;
    let body: unknown = undefined;

    const res = {
        status(code: number) {
            statusCode = code;
            return this;
        },
        json(payload: unknown) {
            body = payload;
            return this;
        },
        get statusCode() {
            return statusCode;
        },
        get body() {
            return body;
        },
    };

    return res;
}

describe('pages/api/upload', () => {
    it('rejects non-POST methods', async () => {
        const res = createResponse();
        await handler({ method: 'GET', cookies: {} } as any, res as any);

        expect(res.statusCode).toBe(405);
        expect(res.body).toEqual({ message: 'Method not allowed' });
    });

    it('rejects unauthorized devices before parsing files', async () => {
        const res = createResponse();
        await handler({ method: 'POST', cookies: {} } as any, res as any);

        expect(res.statusCode).toBe(401);
        expect(res.body).toEqual({ message: 'Unauthorized device' });
    });
});
