import type { AbstractPowerSyncDatabase, PowerSyncBackendConnector } from '@powersync/common';
import type { DeviceOperation } from '../policy';
import { TRANSACTION_TABLE } from './schema';

/** One local transaction, as the upload route takes it. */
export interface UploadBody {
    uploadId: string;
    dataGeneration: number;
    mutation: string | null;
    operations: DeviceOperation[];
}

export interface PendingUpload {
    body: UploadBody;
    /** Takes the transaction off the device's queue, once the server has answered for it. */
    complete(): Promise<void>;
}

/**
 * The device's oldest unsent transaction. Its id and name are the row its mutation wrote beside its writes; that
 * row is not a write itself and is not sent as one.
 */
export async function nextUpload(db: AbstractPowerSyncDatabase, dataGeneration: number): Promise<PendingUpload | null> {
    const transaction = await db.getNextCrudTransaction();
    if (!transaction) return null;
    const name = transaction.crud.find((entry) => entry.table === TRANSACTION_TABLE);
    const operations = transaction.crud
        .filter((entry) => entry.table !== TRANSACTION_TABLE)
        .map((entry): DeviceOperation => ({ op: entry.op as DeviceOperation['op'], table: entry.table, id: entry.id, data: entry.opData ?? null }));
    const mutation = typeof name?.opData?.mutation === 'string' ? name.opData.mutation : null;
    // Every mutation names its transaction. A write that somehow did not come from one is still sent, under a
    // name made from what the device does know about it.
    const uploadId = name?.id ?? `unnamed-${await db.getClientId()}-${transaction.transactionId ?? 0}`;
    return { body: { uploadId, dataGeneration, mutation, operations }, complete: () => transaction.complete() };
}

export interface ConnectorOptions {
    /** The data generation this device's database was made under. */
    dataGeneration: number;
    /** A fresh token for the sync service, and where the service is. */
    fetchCredentials(): Promise<{ endpoint: string; token: string }>;
    /**
     * Sends one transaction to the server. Resolves once the server has answered for it, whether it applied it
     * or refused it: either way it must not be sent again. Rejects when it should be tried again later.
     */
    upload(body: UploadBody): Promise<void>;
}

/** What PowerSync calls to get a token and to send what the device has written. */
export function createConnector(options: ConnectorOptions): PowerSyncBackendConnector {
    return {
        fetchCredentials: options.fetchCredentials,
        async uploadData(database) {
            const pending = await nextUpload(database, options.dataGeneration);
            if (!pending) return;
            if (pending.body.operations.length) await options.upload(pending.body);
            await pending.complete();
        },
    };
}
