export type MessageServiceErrorStatus = 400 | 403 | 404 | 409;

export class MessageServiceError extends Error {
    readonly status: MessageServiceErrorStatus;

    constructor(status: MessageServiceErrorStatus, message: string) {
        super(message);
        this.name = 'MessageServiceError';
        this.status = status;
    }
}

export function toMessageErrorResponse(
    error: unknown,
    fallback: string
): { message: string; status: MessageServiceErrorStatus | 500 } {
    if (error instanceof MessageServiceError) {
        return {
            message: error.message,
            status: error.status,
        };
    }

    return {
        message: fallback,
        status: 500,
    };
}
