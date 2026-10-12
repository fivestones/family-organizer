import { getDataBackend } from '../backend';

/** Marks a refusal as seen. */
export function dismissRefusal(refusalId: string): Promise<void> {
    if (typeof refusalId !== 'string' || !refusalId) throw new TypeError('A refusal is dismissed by its id.');
    return getDataBackend().sync.dismissRefusal(refusalId);
}
