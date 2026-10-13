import type { AbstractPowerSyncDatabase } from '@powersync/common';
import type { ServerResponse } from '../session/platform';
import type { Principal } from '../session/principal';

/**
 * One person's local database, and who they are. Everything the PowerSync implementation does is done on one of
 * these: a database belongs to one principal, so a device with several people has several, one at a time.
 */
export interface Device {
    db: AbstractPowerSyncDatabase;
    principal: Principal;
    /** Calls the app's own server as this person. Rejects when the server cannot be reached. */
    request(path: string, init?: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown }): Promise<ServerResponse>;
    /** This person's session token, for the few things that are handed one, such as a server action. */
    sessionToken: string;
    /** A new random id, in the form the database uses. Platforms differ in how they make one. */
    createId(): string;
    now(): Date;
}
