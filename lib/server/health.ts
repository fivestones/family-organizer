import { sql } from 'kysely';
import type { AppDatabase } from '@/lib/server/db';

// What the health report says about the database, the sync service's hold on it, and the backups. It is written
// to be read by a person: each thing that wants attention is a sentence.

/** Past this, the sync service is so far behind that something is wrong with it. */
const LAG_WORTH_SAYING_BYTES = 256 * 1024 * 1024;
/** A nightly job that has not run for this long has missed a night. */
const A_NIGHT_AND_A_HALF_HOURS = 36;

export interface SlotRow {
    active: boolean;
    wal_status: string | null;
    lag_bytes: number | null;
}

export interface DataHealth {
    postgres: 'ok' | 'unreachable';
    /**
     * The sync service reads the database through a place it keeps in the database's log.
     * streaming: it is connected. waiting: it has a place and is not connected. lost: it was away so long the
     * database let its place go, and it will copy the tables afresh. none: it has never had one.
     */
    replication: { state: 'streaming' | 'waiting' | 'lost' | 'none'; lagBytes: number | null } | null;
    backup: { lastAt: string | null; ageHours: number | null } | null;
    offsite: { lastAt: string | null; ageHours: number | null } | null;
    compaction: { lastAt: string | null; ageHours: number | null } | null;
    /** Each thing someone should look at, as a sentence. Empty when all is well. */
    attention: string[];
}

const hoursBetween = (from: string, to: Date) => (to.getTime() - new Date(from).getTime()) / 3_600_000;
const toOneDecimal = (hours: number) => Math.round(hours * 10) / 10;

/** The report, from what the database said. Pure, so every case of it can be shown without a database in that state. */
export function describeDataHealth(slots: readonly SlotRow[], lastRuns: Readonly<Record<string, string | undefined>>, now: Date): DataHealth {
    const attention: string[] = [];
    const slot = slots.find((row) => row.wal_status !== 'lost') ?? slots[0];
    const state = !slot ? 'none' : slot.wal_status === 'lost' ? 'lost' : slot.active ? 'streaming' : 'waiting';
    if (state === 'none') attention.push('The sync service has never connected to the database. Devices are not being sent changes.');
    if (state === 'lost') attention.push('The sync service was away so long that the database stopped keeping its place. It copies everything afresh when it returns.');
    if (state === 'waiting') attention.push('The sync service is not connected to the database. Devices are not being sent changes.');
    const lagBytes = slot?.lag_bytes ?? null;
    if (state === 'streaming' && lagBytes !== null && lagBytes > LAG_WORTH_SAYING_BYTES) attention.push(`The sync service is ${Math.round(lagBytes / 1024 / 1024)} MB behind the database.`);

    const age = (kind: string) => (lastRuns[kind] ? hoursBetween(lastRuns[kind]!, now) : null);
    const last = (kind: string) => ({ lastAt: lastRuns[kind] ?? null, ageHours: age(kind) === null ? null : toOneDecimal(age(kind)!) });
    const [backupAge, offsiteAge] = [age('backup'), age('offsite')];
    if (backupAge === null) attention.push('No backup has been made. Schedule scripts/powersync/nightly.sh.');
    else if (backupAge > A_NIGHT_AND_A_HALF_HOURS) attention.push(`The newest backup is ${Math.round(backupAge)} hours old.`);
    // A backup kept only on the disk it describes is lost with that disk.
    if (backupAge !== null && offsiteAge === null) attention.push('Backups are not being copied off this machine. Set BACKUP_OFFSITE_REMOTE.');
    else if (offsiteAge !== null && offsiteAge > A_NIGHT_AND_A_HALF_HOURS) attention.push(`Backups were last copied off this machine ${Math.round(offsiteAge)} hours ago.`);

    return { postgres: 'ok', replication: { state, lagBytes }, backup: last('backup'), offsite: last('offsite'), compaction: last('compact'), attention };
}

/** Asks the database, giving up after a moment: a health report that hangs is worse than one that says it could not ask. */
export async function readDataHealth(db: AppDatabase, now: Date = new Date(), timeoutMs = 2_000): Promise<DataHealth> {
    const ask = async () => {
        const slots = await sql<SlotRow>`
            SELECT active, wal_status, pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)::float8 AS lag_bytes
            FROM pg_replication_slots
            WHERE slot_type = 'logical' AND database = current_database()
        `.execute(db);
        const runs = await db.selectFrom('maintenance_runs').select(['kind', (eb) => eb.fn.max('finished_at').as('last_at')]).groupBy('kind').execute();
        return describeDataHealth(slots.rows, Object.fromEntries(runs.map((row) => [row.kind, row.last_at ?? undefined])), now);
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            ask(),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('timed out')), timeoutMs);
            }),
        ]);
    } catch {
        return { postgres: 'unreachable', replication: null, backup: null, offsite: null, compaction: null, attention: ['The database could not be reached.'] };
    } finally {
        clearTimeout(timer);
    }
}
