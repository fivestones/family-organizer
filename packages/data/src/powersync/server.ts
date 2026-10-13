import type { Device } from './device';

// The things only the server may do — money, a message, a PIN — are asked of it, as the signed-in person. They
// need a connection, and say so plainly when there is none.

/** The server could not be reached. */
export class OfflineError extends Error {
    constructor(message = 'This needs a connection. Try again when you are back online.') {
        super(message);
        this.name = 'OfflineError';
    }
}

/** The server was reached and would not do it. Its message is for the person. */
export class ServerRefusedError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code: string | null
    ) {
        super(message);
        this.name = 'ServerRefusedError';
    }
}

export async function askServer<Answer = unknown>(device: Device, path: string, init: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown } = {}): Promise<Answer> {
    let response;
    try {
        response = await device.request(path, init);
    } catch {
        throw new OfflineError();
    }
    const body = await response.json().catch(() => null);
    if (response.status >= 400) {
        throw new ServerRefusedError(typeof body?.error === 'string' ? body.error : 'That could not be done.', response.status, typeof body?.code === 'string' ? body.code : null);
    }
    return body as Answer;
}

/** How many of this person's changes the server has not yet answered for. */
async function unsent(device: Device): Promise<number> {
    const rows = await device.db.getAll<{ waiting: number }>('SELECT count(*) AS waiting FROM ps_crud');
    return rows[0]?.waiting ?? 0;
}

/**
 * Waits until everything this person has changed here has reached the server. Something asked of the server
 * about a row made a moment ago — a PIN for a new member, their first envelope — has to wait for the row.
 */
export async function waitUntilSent(device: Device, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while ((await unsent(device)) > 0) {
        if (Date.now() >= deadline) throw new OfflineError('What you changed has not reached the server yet. Try again when you are back online.');
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}
