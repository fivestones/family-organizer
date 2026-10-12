'use client';

import type { AbstractPowerSyncDatabase, PowerSyncBackendConnector } from '@powersync/common';
import { AppSchema } from '@family-organizer/data/powersync/schema';
import { SESSION_TOKEN_HEADER, type DevicePlatform } from '@family-organizer/data/session/platform';

// The browser's side of the data layer on PowerSync (docs/powersync-migration.md, "The web client").
//
// On the web the local database is SQLite compiled to WebAssembly, running in a worker, and browsers differ in
// where a page may keep it. The choice is made here, once, when the app starts.

/** Where this browser keeps the local database. */
export type StorageMode =
    /** The browser's private file system: the default, and the only mode that shares one database between tabs everywhere. */
    | 'opfs'
    /** IndexedDB: where the private file system is not available, as in Safari's and Firefox's private windows. */
    | 'indexeddb'
    /** Nowhere: the app works while online and keeps nothing once the page is closed. */
    | 'memory';

export interface WebPlatform {
    platform: DevicePlatform;
    storageMode: StorageMode;
    /** Calls back when another tab of this browser changes who is signed in. */
    onOtherTabChanged(listener: () => void): () => void;
}

/** What the browser lacks that the app cannot run without, in words for a person. Empty when it has everything. */
export function missingBrowserFeatures(): string[] {
    const missing: string[] = [];
    if (typeof WebAssembly !== 'object') missing.push('WebAssembly');
    if (typeof Worker !== 'function') missing.push('web workers');
    if (typeof indexedDB !== 'object' && !navigator.storage?.getDirectory) missing.push('local storage for a database');
    if (!globalThis.crypto?.getRandomValues) missing.push('secure random numbers');
    return missing;
}

async function chooseStorage(): Promise<StorageMode> {
    // Being offered the private file system is not the same as being able to use it: a private window offers it
    // and then refuses. So it is tried.
    try {
        if (navigator.storage?.getDirectory) {
            await navigator.storage.getDirectory();
            return 'opfs';
        }
    } catch {
        // Falls through to IndexedDB.
    }
    try {
        if (typeof indexedDB === 'object') {
            await new Promise<void>((resolve, reject) => {
                const probe = indexedDB.open('family-organizer-storage-probe');
                probe.onerror = () => reject(probe.error);
                probe.onsuccess = () => {
                    probe.result.close();
                    resolve();
                };
            });
            return 'indexeddb';
        }
    } catch {
        // Falls through to memory.
    }
    return 'memory';
}

function randomId(): string {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    // `randomUUID` exists only on a secure address. The same id can be made from random bytes anywhere.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const SESSIONS_CHANNEL = 'family-organizer.sessions';

export async function createWebPlatform(): Promise<WebPlatform> {
    const web = await import('@powersync/web');
    const storageMode = await chooseStorage();
    const vfs = { opfs: web.WASQLiteVFS.OPFSCoopSyncVFS, indexeddb: web.WASQLiteVFS.IDBBatchAtomicVFS, memory: web.WASQLiteVFS.InMemoryVfs }[storageMode];
    const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(SESSIONS_CHANNEL) : null;

    // Asking the browser to keep this site's storage makes it less likely to clear a database that still holds
    // changes nobody has sent. It may say no; nothing depends on the answer.
    void navigator.storage?.persist?.().catch(() => false);

    const platform: DevicePlatform = {
        openDatabase(fileName: string): AbstractPowerSyncDatabase {
            return new web.PowerSyncDatabase({
                schema: AppSchema,
                database: { dbFilename: fileName, vfs, worker: '/@powersync/worker.js' },
                sync: { worker: '/@powersync/worker.js' },
            });
        },
        async connect(db: AbstractPowerSyncDatabase, connector: PowerSyncBackendConnector): Promise<void> {
            // A WebSocket, not the SDK's default of a streamed response: WebKit held the start of the stream back
            // for twenty seconds in the spike. Uploads go at once, not after the SDK's default wait of a second.
            await db.connect(connector, { connectionMethod: web.SyncStreamConnectionMethod.WEB_SOCKET, crudUploadThrottleMs: 100 });
        },
        storage: {
            get: async (key) => window.localStorage.getItem(key),
            set: async (key, value) => {
                window.localStorage.setItem(key, value);
                channel?.postMessage('changed');
            },
        },
        async request(path, init = {}) {
            const response = await fetch(path, {
                method: init.method ?? 'GET',
                cache: 'no-store',
                credentials: 'same-origin',
                headers: {
                    ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
                    ...(init.sessionToken ? { [SESSION_TOKEN_HEADER]: init.sessionToken } : {}),
                },
                body: init.body === undefined ? undefined : JSON.stringify(init.body),
            });
            return { status: response.status, json: () => response.json().catch(() => ({})) };
        },
        resolveUrl: (pathOrUrl) => new URL(pathOrUrl, window.location.origin).toString(),
        createId: randomId,
        now: () => new Date(),
    };

    return {
        platform,
        storageMode,
        onOtherTabChanged(listener) {
            if (!channel) return () => undefined;
            const handle = () => listener();
            channel.addEventListener('message', handle);
            return () => channel.removeEventListener('message', handle);
        },
    };
}
