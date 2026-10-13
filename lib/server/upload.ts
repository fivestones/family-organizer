import 'server-only';

import { sql, type RawBuilder, type Transaction } from 'kysely';
import { checkOperation, judge, policyFor, type CheckedOperation, type DeviceOperation, type RefusalReason, type Row } from '@family-organizer/data/policy';
import { principalKey } from '@family-organizer/data/session/principal';
import type { Database } from '@/db/types';
import type { AppDatabase } from './db';
import type { Session } from './sessions';

// Applying what a device uploads (docs/powersync-migration.md, "Writes: the upload endpoint").
//
// A device sends one of its local transactions at a time. What it calls each write is a hint: every write is
// judged against the row as Postgres holds it, under a lock, by the shared write rules. A transaction is applied
// wholly or not at all, and exactly once: its outcome is recorded with it, under the id its mutation gave it, and a
// retry is answered from the record.

export interface UploadedTransaction {
    /**
     * The id the mutation gave the transaction when it made it. A device's own numbering starts again when its
     * database is emptied, so it cannot be what tells one transaction from another; a random id can.
     */
    uploadId: string;
    /** The data generation the device's database belongs to. */
    dataGeneration: number;
    /** The name of the mutation that made it, so a refusal can say what was refused. */
    mutation: string | null;
    operations: DeviceOperation[];
}

export type UploadOutcome = { ok: true } | { ok: false; reason: RefusalReason; table: string | null; rowId: string | null };

export interface UploadResult {
    outcome: UploadOutcome;
    /** True when this transaction had been uploaded before and the answer is the one it was given then. */
    replayed: boolean;
}

/**
 * How long the record of an upload is kept. A device that was applied but never heard so retries, and the record
 * is what answers it without applying it again; a device silent for longer than this is treated as new.
 */
export const UPLOAD_RECORD_DAYS = 90;
const DAY_MS = 86_400_000;

/** Removes the records of uploads too old to be retried. Returns how many went. */
export async function pruneUploads(db: AppDatabase, now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - UPLOAD_RECORD_DAYS * DAY_MS).toISOString();
    const result = await db.deleteFrom('sync_uploads').where('received_at', '<', cutoff).executeTakeFirst();
    return Number(result.numDeletedRows ?? 0);
}

let lastPruneAt = 0;
/**
 * Prunes at most once a day for each running server, on the back of an upload: with no uploads there is nothing
 * to prune. It is never waited for, and a failure is left for the next day.
 */
export function pruneUploadsOccasionally(db: AppDatabase, now: Date = new Date()): void {
    if (now.getTime() - lastPruneAt < DAY_MS) return;
    lastPruneAt = now.getTime();
    void pruneUploads(db, now).catch(() => {});
}
/** For tests: forget when the last prune was. */
export function __resetUploadPruningForTests(): void {
    lastPruneAt = 0;
}

/** The server is not taking writes just now. The device keeps what it has and tries again. */
export class WritesFrozenError extends Error {}
/** The data under the app has been replaced since the device's database was made. */
export class GenerationChangedError extends Error {}

class Refused extends Error {
    constructor(readonly reason: RefusalReason, readonly table: string | null, readonly rowId: string | null) {
        super(`refused: ${reason}`);
    }
}

const MAX_OPERATIONS = 2000;

/** Reads a request body as an uploaded transaction, or `null` when it is not one. */
export function parseUpload(body: unknown): UploadedTransaction | null {
    if (!body || typeof body !== 'object') return null;
    const { uploadId, dataGeneration, mutation, operations } = body as Record<string, unknown>;
    if (typeof uploadId !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(uploadId)) return null;
    if (typeof dataGeneration !== 'number' || !Number.isSafeInteger(dataGeneration)) return null;
    if (mutation != null && (typeof mutation !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(mutation))) return null;
    if (!Array.isArray(operations) || operations.length === 0 || operations.length > MAX_OPERATIONS) return null;
    return { uploadId, dataGeneration, mutation: (mutation as string | null) ?? null, operations: operations as DeviceOperation[] };
}

type Trx = Transaction<Database>;

// Every name below comes from the write rules' own lists, looked up by what the device sent. Nothing a device
// sends is ever put into a statement as a name.
const whereKey = (key: Readonly<Record<string, string>>) => sql.join(Object.entries(key).map(([column, value]) => sql`${sql.ref(column)} = ${value}`), sql` AND `);

/** A value as a statement takes it. A document and a list of days are sent as text and cast. */
function valueFor(operation: CheckedOperation, column: string, value: unknown): RawBuilder<unknown> {
    if (value === null || value === undefined) return sql`NULL`;
    const kind = policyFor(operation.table).columns[column]?.kind;
    if (kind === 'json') return sql`${JSON.stringify(value)}::jsonb`;
    if (kind === 'days') return sql`${`{${(value as string[]).join(',')}}`}::date[]`;
    if (kind === 'uuids') return sql`${`{${(value as string[]).join(',')}}`}::uuid[]`;
    // Text may hold a comma or a brace, so a list of it is handed over as JSON and unpacked by the database.
    if (kind === 'texts') return sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(value)}::jsonb))`;
    return sql`${value}`;
}

async function readForUpdate(trx: Trx, operation: CheckedOperation): Promise<Row | null> {
    const result = await sql<Row>`SELECT * FROM ${sql.table(operation.table)} WHERE ${whereKey(operation.key)} FOR UPDATE`.execute(trx);
    return result.rows[0] ?? null;
}

async function applyOperation(trx: Trx, session: Session, operation: CheckedOperation): Promise<void> {
    // Twice at most: an insert that finds the row was created under it is judged again, as the update it now is.
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const current = await readForUpdate(trx, operation);
        const judged = judge(session.principal, operation, current);
        if (judged.action === 'refuse') throw new Refused(judged.reason, operation.table, operation.id);
        if (judged.action === 'skip') return;

        const table = sql.table(operation.table);
        if (judged.action === 'delete') {
            await sql`DELETE FROM ${table} WHERE ${whereKey(operation.key)}`.execute(trx);
            return;
        }
        if (judged.action === 'update') {
            const assignments = judged.changed.map((column) => sql`${sql.ref(column)} = ${valueFor(operation, column, judged.row[column])}`);
            await sql`UPDATE ${table} SET ${sql.join(assignments)} WHERE ${whereKey(operation.key)}`.execute(trx);
            return;
        }
        const columns = Object.keys(judged.row);
        const inserted = await sql`
            INSERT INTO ${table} (${sql.join(columns.map((column) => sql.ref(column)))})
            VALUES (${sql.join(columns.map((column) => valueFor(operation, column, judged.row[column])))})
            ON CONFLICT (${sql.join(Object.keys(operation.key).map((column) => sql.ref(column)))}) DO NOTHING
            RETURNING 1 AS inserted
        `.execute(trx);
        if (inserted.rows.length > 0) return;
    }
    throw new Refused('conflict', operation.table, operation.id);
}

/** What Postgres refused, as a reason. Anything that is not the write's own fault is left to be retried. */
function refusalFromDatabase(error: unknown, operation: CheckedOperation): Refused | null {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
    // A row another device changed first: something it points at has gone, or its place is already taken.
    if (code === '23503' || code === '23505') return new Refused('conflict', operation.table, operation.id);
    // The write itself cannot be held: an empty value where one is required, a failed check, a malformed value.
    if (code.startsWith('23') || code.startsWith('22')) return new Refused('invalid', operation.table, operation.id);
    return null;
}

async function claim(trx: Trx, session: Session, upload: UploadedTransaction, outcome: UploadOutcome | null): Promise<UploadResult | null> {
    const claimed = await trx
        .insertInto('sync_uploads')
        .values({
            upload_id: upload.uploadId,
            session_id: session.id,
            principal: principalKey(session.principal),
            mutation: upload.mutation,
            outcome: outcome ? sql`${JSON.stringify(outcome)}::jsonb` : null,
        })
        .onConflict((conflict) => conflict.column('upload_id').doNothing())
        .returning('upload_id')
        .executeTakeFirst();
    if (claimed) return null;
    // Uploaded before. Postgres has already waited for that attempt to finish, so its outcome is settled.
    const earlier = await trx
        .selectFrom('sync_uploads')
        .select('outcome')
        .where('upload_id', '=', upload.uploadId)
        .executeTakeFirstOrThrow();
    if (!earlier.outcome) throw new Error('An upload is on record with no outcome.');
    return { outcome: earlier.outcome as UploadOutcome, replayed: true };
}

/**
 * Applies one uploaded transaction, or answers from the record if it has been applied before.
 * A refusal is not an error: it is the answer, it is recorded, and the person who made the write is told.
 */
export async function applyUpload(db: AppDatabase, session: Session, upload: UploadedTransaction): Promise<UploadResult> {
    const installation = await db.selectFrom('installation').select(['data_generation', 'writes_frozen']).executeTakeFirstOrThrow();
    if (installation.writes_frozen) throw new WritesFrozenError();
    if (installation.data_generation !== upload.dataGeneration) throw new GenerationChangedError();

    let refused: Refused;
    try {
        return await db.transaction().execute(async (trx) => {
            const replay = await claim(trx, session, upload, null);
            if (replay) return replay;
            let last: CheckedOperation | null = null;
            for (const raw of upload.operations) {
                const checked = checkOperation(raw);
                if (!checked.valid) {
                    throw new Refused(checked.reason, typeof raw?.table === 'string' ? raw.table.slice(0, 64) : null, typeof raw?.id === 'string' ? raw.id.slice(0, 200) : null);
                }
                try {
                    await applyOperation(trx, session, checked.operation);
                } catch (error) {
                    throw refusalFromDatabase(error, checked.operation) ?? error;
                }
                last = checked.operation;
            }
            // Where two rows name each other, as a rule and its first version do, the database puts its check off
            // to the end of the transaction. It is made now, so that a failure is a refusal like any other and
            // not an error at commit that the device would retry for ever.
            if (last) {
                try {
                    await sql`SET CONSTRAINTS ALL IMMEDIATE`.execute(trx);
                } catch (error) {
                    throw refusalFromDatabase(error, last) ?? error;
                }
            }
            const outcome: UploadOutcome = { ok: true };
            await trx
                .updateTable('sync_uploads')
                .set({ outcome: sql`${JSON.stringify(outcome)}::jsonb` })
                .where('upload_id', '=', upload.uploadId)
                .execute();
            return { outcome, replayed: false };
        });
    } catch (error) {
        if (!(error instanceof Refused)) throw error;
        refused = error;
    }

    // Everything the transaction wrote has been undone. What remains is to record that it was refused, so a retry
    // gets the same answer, and to tell the person.
    const outcome: UploadOutcome = { ok: false, reason: refused.reason, table: refused.table, rowId: refused.rowId };
    return db.transaction().execute(async (trx) => {
        const replay = await claim(trx, session, upload, outcome);
        if (replay) return replay;
        await trx
            .insertInto('write_refusals')
            .values({
                family_member_id: session.principal.familyMemberId,
                principal_type: session.principal.type,
                mutation: upload.mutation,
                reason: refused.reason,
                table_name: refused.table,
                row_id: refused.rowId,
            })
            .execute();
        return { outcome, replayed: false };
    });
}
