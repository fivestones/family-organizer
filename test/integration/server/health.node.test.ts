import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET } from '@/app/api/health/route';
import { describeDataHealth, offsiteArrangement, readDataHealth } from '@/lib/server/health';
import { createTestDatabase, type TestDatabase } from '@/test/utils/postgres';

// What the health report says about the database, the sync service and the backups.

const NOW = new Date('2026-03-10T08:00:00.000Z');
const lastNight = { backup: '2026-03-10T02:30:00.000Z', offsite: '2026-03-10T02:31:00.000Z', compact: '2026-03-10T02:32:00.000Z' };
const streaming = [{ active: true, wal_status: 'reserved', lag_bytes: 1_024 }];

describe('what the health report says', () => {
    it('is nothing at all when the sync service is connected and last night\'s jobs ran', () => {
        const health = describeDataHealth(streaming, lastNight, NOW, 'rclone');

        expect(health.attention).toEqual([]);
        expect(health.replication).toEqual({ state: 'streaming', lagBytes: 1_024 });
        expect(health.backup).toEqual({ lastAt: '2026-03-10T02:30:00.000Z', ageHours: 5.5 });
    });

    it.each([
        ['has never connected', [], 'none', 'The sync service has never connected to the database. Devices are not being sent changes.'],
        ['is not connected', [{ active: false, wal_status: 'reserved', lag_bytes: 4_096 }], 'waiting', 'The sync service is not connected to the database. Devices are not being sent changes.'],
        ['was away too long', [{ active: false, wal_status: 'lost', lag_bytes: null }], 'lost', 'The sync service was away so long that the database stopped keeping its place. It copies everything afresh when it returns.'],
        ['is far behind', [{ active: true, wal_status: 'extended', lag_bytes: 600 * 1024 * 1024 }], 'streaming', 'The sync service is 600 MB behind the database.'],
    ] as const)('says so when the sync service %s', (_what, slots, state, sentence) => {
        const health = describeDataHealth(slots, lastNight, NOW, 'rclone');

        expect(health.replication?.state).toBe(state);
        expect(health.attention).toEqual([sentence]);
    });

    it('says so when no backup has been made, and when the newest is old', () => {
        expect(describeDataHealth(streaming, {}, NOW, 'external').attention).toEqual(['No backup has been made. Schedule scripts/powersync/nightly.sh.']);
        expect(describeDataHealth(streaming, { backup: '2026-03-08T02:30:00.000Z' }, NOW, 'external').attention).toEqual(['The newest backup is 54 hours old.']);
    });

    it('asks who gets the backups off the machine until someone has said, and then says only what is its own to check', () => {
        const onlyHere = { backup: lastNight.backup };
        // Nobody has said: the dumps are on the disk they describe.
        expect(describeDataHealth(streaming, onlyHere, NOW, 'nobody').attention).toEqual([
            'Backups stay on this machine. Set BACKUP_OFFSITE_REMOTE to an rclone remote, or to `external` if something else already copies the backup folder elsewhere.',
        ]);
        // The machine's own backup takes the folder: that is not the app's to watch.
        expect(describeDataHealth(streaming, onlyHere, NOW, 'external').attention).toEqual([]);
        // The app copies them itself, so it says when it has not.
        expect(describeDataHealth(streaming, onlyHere, NOW, 'rclone').attention).toEqual(['Backups have not been copied off this machine yet.']);
        expect(describeDataHealth(streaming, { ...lastNight, offsite: '2026-03-07T02:31:00.000Z' }, NOW, 'rclone').attention).toEqual(['Backups were last copied off this machine 77 hours ago.']);

        expect([undefined, '', ' External ', 'offsite:family-organizer'].map(offsiteArrangement)).toEqual(['nobody', 'nobody', 'external', 'rclone']);
    });
});

describe('reading it from the database', () => {
    let database: TestDatabase;
    beforeEach(async () => {
        database = await createTestDatabase();
        // This deployment copies its backups to a remote itself.
        process.env.BACKUP_OFFSITE_REMOTE = 'offsite:family-organizer';
    });
    afterEach(async () => {
        delete process.env.BACKUP_OFFSITE_REMOTE;
        await database.close();
    });

    it('finds when each nightly job last ran, and that nothing has connected to a database nothing has connected to', async () => {
        await database.sql.exec(`
            INSERT INTO maintenance_runs (kind, finished_at, detail) VALUES
                ('backup', '2026-03-09T02:30:00Z', 'an older one'), ('backup', '2026-03-10T02:30:00Z', 'family-organizer-2026-03-10T02-30-00Z.dump, 4096 bytes'), ('offsite', '2026-03-10T02:31:00Z', NULL);
        `);
        const health = await readDataHealth(database.db, NOW);

        expect(health).toMatchObject({ postgres: 'ok', replication: { state: 'none' }, backup: { lastAt: '2026-03-10T02:30:00.000Z', ageHours: 5.5 }, offsite: { ageHours: 5.5 }, compaction: { lastAt: null } });
        expect(health.attention).toEqual(['The sync service has never connected to the database. Devices are not being sent changes.']);
    });

    it('is given by the health route when there is a database, and the route stays up when there is not', async () => {
        const withDatabase = await (await GET()).json();
        expect(withDatabase).toMatchObject({ ok: true, data: { postgres: 'ok' } });

        await database.db.destroy();
        const without = await GET();
        expect(without.status).toBe(200);
        expect(await without.json()).toMatchObject({ ok: true, data: { postgres: 'unreachable', attention: ['The database could not be reached.'] } });
    });
});
