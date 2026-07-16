import { describe, expect, it } from 'vitest';
import { MessageServiceError, toMessageErrorResponse } from '@/lib/message-errors';

describe('message service errors', () => {
    it('preserves an explicitly classified public error', () => {
        expect(toMessageErrorResponse(new MessageServiceError(409, 'Edit window expired'), 'Request failed')).toEqual({
            message: 'Edit window expired',
            status: 409,
        });
    });

    it('does not expose unexpected server error details', () => {
        expect(toMessageErrorResponse(new Error('database credential leaked here'), 'Unable to send message')).toEqual({
            message: 'Unable to send message',
            status: 500,
        });
    });
});
