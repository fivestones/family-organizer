import type { AbstractPowerSyncDatabase, PowerSyncBackendConnector } from '@powersync/common';

/** What the server tells a client about the backend it runs on (`GET /api/client-config`). */
export interface InstallationConfig {
    installationId: string;
    dataGeneration: number;
    /** Where the sync service is: a full address, or a path on the app's own. */
    powersyncUrl: string;
}

export interface ServerResponse {
    status: number;
    json(): Promise<any>;
}

/**
 * What differs between the web and the phone, and between either and a test: how a local database is opened, where
 * a little state is kept, and how the server is reached. Everything about who is signed in and whose database is
 * whose is the same everywhere and lives in the session manager.
 */
export interface DevicePlatform {
    /** Opens the local database kept under a file name, creating it if it is not there. */
    openDatabase(fileName: string): AbstractPowerSyncDatabase;
    /** Starts syncing a database. PowerSync then calls the connector for tokens and to send what is queued. */
    connect(db: AbstractPowerSyncDatabase, connector: PowerSyncBackendConnector): Promise<void>;
    /** A small durable store for which sessions this device holds. */
    storage: {
        get(key: string): Promise<string | null>;
        set(key: string, value: string): Promise<void>;
    };
    /** Calls the app's own server. Rejects when the server cannot be reached. */
    request(path: string, init?: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown; sessionToken?: string }): Promise<ServerResponse>;
    /** A full address for the sync service from what the configuration gives. */
    resolveUrl(pathOrUrl: string): string;
    createId(): string;
    now(): Date;
}
