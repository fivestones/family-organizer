import { currentDevice } from '../powersync/current';
import { useLiveRead } from '../powersync/live';
import { mutate } from '../powersync/mutate';
import { deleteRow, insertRow, updateRow } from '../powersync/rows';
import type { ClientDatabase } from '../powersync/schema';
import { all, flag, fromJson, sqlFor, type Reader } from '../powersync/sql';
import type { QueryResult, ReadOptions } from '../query-result';

// The scales a response to a task can be graded on. A parent sets them up; one of them is the scale a new grade
// starts on.

export type GradeTypeKind = 'number' | 'letter' | 'stars' | 'freeform';

/** One named step of a scale that has them, such as a letter. */
export interface GradeStep {
    label: string;
    value: number;
}

export interface GradeType {
    id: string;
    name: string;
    kind: GradeTypeKind;
    lowValue: number;
    highValue: number;
    lowLabel: string;
    highLabel: string;
    /** The steps of a scale that has them. Read and written whole. */
    steps: GradeStep[] | null;
    /** The scale a new grade starts on. At most one is. */
    isDefault: boolean;
    sortOrder: number;
}

/** What a scale is made of. Which is the default, and its place among the others, are changed on their own. */
export type GradeTypeDetails = Pick<GradeType, 'name' | 'kind' | 'lowValue' | 'highValue' | 'lowLabel' | 'highLabel' | 'steps'>;

type GradeTypeRow = ClientDatabase['grade_types'];

const KINDS: readonly GradeTypeKind[] = ['number', 'letter', 'stars', 'freeform'];
const EMPTY: GradeType[] = [];

function toGradeType(row: GradeTypeRow): GradeType {
    const steps = fromJson(row.steps);
    return {
        id: row.id,
        name: row.name ?? '',
        kind: KINDS.includes(row.kind as GradeTypeKind) ? (row.kind as GradeTypeKind) : 'number',
        lowValue: row.low_value ?? 0,
        highValue: row.high_value ?? 0,
        lowLabel: row.low_label ?? '',
        highLabel: row.high_label ?? '',
        steps: Array.isArray(steps) ? (steps as GradeStep[]) : null,
        isDefault: flag(row.is_default),
        sortOrder: row.sort_order ?? 0,
    };
}

const readGradeTypes = (reader: Reader) => all<GradeTypeRow>(reader, sqlFor.selectFrom('grade_types').selectAll().orderBy('sort_order').orderBy('created_at').orderBy('id'));

/** Live. Every scale, in the order they were set up. */
export function useGradeTypes(options?: ReadOptions): QueryResult<GradeType[]> {
    return useLiveRead(currentDevice().db, ['grade_types'], readGradeTypes, (rows) => rows.map(toGradeType), EMPTY, [], options);
}

function columnsOf(details: Partial<GradeTypeDetails>) {
    const row: Record<string, unknown> = {};
    if (details.name !== undefined) {
        const name = typeof details.name === 'string' ? details.name.trim() : '';
        if (!name) throw new Error('A grade type needs a name.');
        row.name = name;
    }
    if (details.kind !== undefined) {
        if (!KINDS.includes(details.kind)) throw new Error('A grade type is a number, a letter, stars or freeform.');
        row.kind = details.kind;
    }
    if (details.lowValue !== undefined) row.low_value = details.lowValue;
    if (details.highValue !== undefined) row.high_value = details.highValue;
    if (details.lowLabel !== undefined) row.low_label = details.lowLabel;
    if (details.highLabel !== undefined) row.high_label = details.highLabel;
    if (details.steps !== undefined) row.steps = details.steps;
    return row;
}

/** Adds a scale after the others. The first one made is the default. Answers with its id. */
export async function addGradeType(details: GradeTypeDetails): Promise<string> {
    const device = currentDevice();
    const columns = columnsOf(details);
    return mutate(device, 'addGradeType', async (writer) => {
        const held = await readGradeTypes(writer);
        const now = device.now().toISOString();
        const last = held.reduce((highest, row) => Math.max(highest, row.sort_order ?? 0), -1);
        return insertRow(device, writer, 'grade_types', { id: device.createId(), ...columns, is_default: held.length === 0, sort_order: last + 1, created_at: now, updated_at: now });
    });
}

export async function updateGradeType(gradeTypeId: string, details: Partial<GradeTypeDetails>): Promise<void> {
    const device = currentDevice();
    const columns = columnsOf(details);
    return mutate(device, 'updateGradeType', async (writer) => {
        const changed = await updateRow(device, writer, 'grade_types', gradeTypeId, columns);
        if (changed === null) throw new Error('That grade type no longer exists.');
        if (changed.length > 0) await updateRow(device, writer, 'grade_types', gradeTypeId, { updated_at: device.now().toISOString() });
    });
}

/** Makes one scale the default, in place of whichever was. */
export async function setDefaultGradeType(gradeTypeId: string): Promise<void> {
    const device = currentDevice();
    return mutate(device, 'setDefaultGradeType', async (writer) => {
        const now = device.now().toISOString();
        // The old default steps down first: the database holds the family to one.
        for (const row of await readGradeTypes(writer)) {
            if (row.id !== gradeTypeId && flag(row.is_default)) await updateRow(device, writer, 'grade_types', row.id, { is_default: false, updated_at: now });
        }
        if ((await updateRow(device, writer, 'grade_types', gradeTypeId, { is_default: true, updated_at: now })) === null) throw new Error('That grade type no longer exists.');
    });
}

/** Removes a scale. Grades already given on it keep what they say. If it was the default, the first that is left becomes it. */
export async function removeGradeType(gradeTypeId: string): Promise<void> {
    const device = currentDevice();
    return mutate(device, 'removeGradeType', async (writer) => {
        const held = await readGradeTypes(writer);
        const removed = held.find((row) => row.id === gradeTypeId);
        if (!removed || !(await deleteRow(device, writer, 'grade_types', gradeTypeId))) return;
        const next = held.find((row) => row.id !== gradeTypeId);
        if (flag(removed.is_default) && next) await updateRow(device, writer, 'grade_types', next.id, { is_default: true, updated_at: device.now().toISOString() });
    });
}
