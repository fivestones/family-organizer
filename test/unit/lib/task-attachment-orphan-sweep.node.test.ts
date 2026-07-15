import { describe, expect, it } from 'vitest';
import {
    collectReferencedTaskUploadKeys,
    planTaskUploadOrphanSweep,
} from '@/lib/task-attachment-orphan-sweep';

describe('task attachment orphan sweep', () => {
    it('normalizes stored task object keys without accepting unrelated uploads', () => {
        expect(
            collectReferencedTaskUploadKeys([
                'task-attachment/direct.pdf',
                '/files/task-update%2Fphoto.jpg',
                'https://files.example.test/api/mobile/files/task-attachment--mobile--scan.png?download=1',
                '/files/general-report.pdf',
                'message-attachment/file.png',
                '/files/%E0%A4%A',
                null,
            ])
        ).toEqual(
            new Set([
                'task-attachment/direct.pdf',
                'task-update/photo.jpg',
                'task-attachment--mobile--scan.png',
            ])
        );
    });

    it('protects every live reference and recent or undated objects while selecting old orphans', () => {
        const plan = planTaskUploadOrphanSweep({
            now: new Date('2026-07-15T12:00:00.000Z'),
            gracePeriodHours: 24,
            referencedValues: [
                'task-attachment/definition.pdf',
                '/files/task-update%2Fevidence.jpg',
                '/api/mobile/files/task-attachment--mobile--scan.png',
                // A duplicated metadata row sharing the same URL remains one protected object.
                'task-attachment/definition.pdf',
            ],
            objects: [
                { key: 'task-attachment/definition.pdf', lastModified: new Date('2026-07-10T00:00:00Z'), size: 100 },
                { key: 'task-update/evidence.jpg', lastModified: new Date('2026-07-10T00:00:00Z'), size: 200 },
                { key: 'task-response/orphan.pdf', lastModified: new Date('2026-07-10T00:00:00Z'), size: 300 },
                { key: 'task-attachment--mobile--scan.png', lastModified: new Date('2026-07-10T00:00:00Z'), size: 400 },
                { key: 'task-response/recent.txt', lastModified: new Date('2026-07-15T11:00:00Z'), size: 500 },
                { key: 'task-update/unknown-date.bin', size: 600 },
                { key: 'task-response/orphan.pdf', lastModified: new Date('2026-07-10T00:00:00Z'), size: 300 },
                { key: 'family-photo/all/photo.png', lastModified: new Date('2026-07-01T00:00:00Z'), size: 700 },
                { key: 'legacy-root-object.pdf', lastModified: new Date('2026-07-01T00:00:00Z'), size: 800 },
            ],
        });

        expect(plan).toMatchObject({
            managedObjects: 6,
            managedBytes: 2100,
            referencedObjects: 3,
            referencedBytes: 700,
            graceProtectedObjects: 2,
            graceProtectedBytes: 1100,
            orphanedBytes: 300,
        });
        expect(plan.orphanedObjects).toEqual([
            {
                key: 'task-response/orphan.pdf',
                lastModified: new Date('2026-07-10T00:00:00Z'),
                size: 300,
            },
        ]);
    });

    it('rejects an invalid grace period instead of broadening the deletion window', () => {
        expect(() =>
            planTaskUploadOrphanSweep({
                objects: [],
                referencedValues: [],
                gracePeriodHours: Number.NaN,
            })
        ).toThrow('Invalid task upload sweep grace period');
    });
});
