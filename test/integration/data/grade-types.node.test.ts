import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addGradeType, removeGradeType, setDefaultGradeType, updateGradeType, type GradeTypeDetails, type Principal } from '@family-organizer/data';
import { household, type Household } from '@/test/utils/data-area';
import { DANA, ELI, seedFamily } from '@/test/utils/family-fixture';
import { createTestDatabase, type TestDatabase } from '@/test/utils/postgres';

// The scales a task's response is graded on, set up on a parent's device.

const parent: Principal = { type: 'parent', familyMemberId: DANA };
const percent: GradeTypeDetails = { name: 'Percentage', kind: 'number', lowValue: 0, highValue: 100, lowLabel: '0', highLabel: '100', steps: null };
const letters: GradeTypeDetails = { name: 'Letters', kind: 'letter', lowValue: 0, highValue: 100, lowLabel: 'F', highLabel: 'A+', steps: [{ label: 'A', value: 95 }, { label: 'B', value: 85 }] };

let server: TestDatabase;
let home: Household;
beforeEach(async () => {
    server = await createTestDatabase();
    await seedFamily(server);
    home = household(() => server);
});
afterEach(async () => {
    await home.close();
    await server.close();
});

const scales = async () => (await server.sql.query<Record<string, any>>(`SELECT name, kind, steps, is_default, sort_order FROM grade_types ORDER BY sort_order`)).rows;

describe('grade types', () => {
    it('are added in order, the first as the default, and there is only ever one default', async () => {
        const device = await home.deviceFor(parent, { now: '2026-03-09T12:00:00.000Z' });
        await addGradeType(percent);
        const second = await addGradeType(letters);
        await setDefaultGradeType(second);

        expect(await home.sync(device)).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
        expect(await scales()).toEqual([
            { name: 'Percentage', kind: 'number', steps: null, is_default: false, sort_order: 0 },
            { name: 'Letters', kind: 'letter', steps: [{ label: 'A', value: 95 }, { label: 'B', value: 85 }], is_default: true, sort_order: 1 },
        ]);
    });

    it('are changed, and removing the default hands it to the first that is left', async () => {
        const device = await home.deviceFor(parent);
        const first = await addGradeType(percent);
        await addGradeType(letters);
        await updateGradeType(first, { name: 'Out of a hundred', highLabel: 'Full marks' });
        await removeGradeType(first);
        await removeGradeType(first);

        expect((await home.sync(device)).every((outcome) => outcome.ok)).toBe(true);
        expect(await scales()).toEqual([{ name: 'Letters', kind: 'letter', steps: [{ label: 'A', value: 95 }, { label: 'B', value: 85 }], is_default: true, sort_order: 1 }]);
        await expect(updateGradeType(first, { name: 'Gone' })).rejects.toThrow('no longer exists');
        await expect(addGradeType({ ...percent, name: ' ' })).rejects.toThrow('needs a name');
    });

    it('are a parent\'s to set up', async () => {
        await home.deviceFor({ type: 'kid', familyMemberId: ELI });
        await expect(addGradeType(percent)).rejects.toMatchObject({ reason: 'not_allowed' });
    });
});
