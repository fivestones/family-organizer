import type { Row } from '../policy';
import { readChores, toChores } from '../powersync/chores';
import { currentDevice } from '../powersync/current';
import { useLiveRead } from '../powersync/live';
import { mutate } from '../powersync/mutate';
import { deleteRow, insertRow, updateRow } from '../powersync/rows';
import { all, sqlFor, type Writer } from '../powersync/sql';
import type { Device } from '../powersync/device';
import type { QueryResult, ReadOptions } from '../query-result';
import type { Chore, ChoreTiming, Day, RotationType } from './types';

// The family's chores as a catalogue: every chore there is, and making, changing and removing one. A parent's
// to change; everyone's to read. Each change is one local transaction.

const EMPTY: Chore[] = [];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Live. Every chore, with who it is assigned to, in the family's order. */
export function useChores(options?: ReadOptions): QueryResult<Chore[]> {
    return useLiveRead(currentDevice().db, ['chores', 'chore_assignees'], readChores, toChores, EMPTY, [], options);
}

/** What a chore is made of. Changing a chore gives any of these; what is left out stays as it is. */
export interface ChoreDetails {
    title: string;
    description: string | null;
    /** The first day it is due. */
    startDate: Day;
    /** An RFC 5545 recurrence rule, without its `RRULE:` label. `null` means once, on `startDate`. */
    rrule: string | null;
    exdates: readonly Day[];
    pauseState: Record<string, unknown> | null;
    rotationType: RotationType;
    isJoint: boolean;
    isUpForGrabs: boolean;
    hideFromDayList: boolean;
    weight: number | null;
    rewardType: 'fixed' | 'weight' | null;
    rewardAmount: number | null;
    rewardCurrency: string | null;
    estimatedDurationSecs: number | null;
    timing: ChoreTiming;
    /** Who it is assigned to, in the order of its rotation where it rotates. */
    assigneeIds: readonly string[];
}

export type NewChore = Pick<ChoreDetails, 'title' | 'startDate'> & Partial<ChoreDetails>;

const time = (value: string | null | undefined): string | null => (value ? value : null);

/** A chore's timing as the columns that hold it. Every column is given, so a change of mode clears what the old one used. */
function timingColumns(timing: ChoreTiming): Row {
    const columns: Record<string, unknown> = {
        timing_mode: timing.mode,
        timing_window_key: null,
        timing_time: null,
        timing_start_time: null,
        timing_end_time: null,
        timing_marker_key: null,
        timing_chore_id: null,
        timing_event: null,
        timing_fallback_time: null,
    };
    switch (timing.mode) {
        case 'named_window':
            columns.timing_window_key = timing.windowKey;
            break;
        case 'before_time':
        case 'after_time':
            columns.timing_time = time(timing.time);
            break;
        case 'between_times':
            columns.timing_start_time = time(timing.startTime);
            columns.timing_end_time = time(timing.endTime);
            break;
        case 'before_marker':
        case 'after_marker':
            columns.timing_marker_key = timing.markerKey;
            columns.timing_event = timing.event;
            columns.timing_fallback_time = time(timing.fallbackTime);
            break;
        case 'before_chore':
        case 'after_chore':
            columns.timing_chore_id = timing.choreId;
            columns.timing_event = timing.event;
            columns.timing_fallback_time = time(timing.fallbackTime);
            break;
        default:
            break;
    }
    return columns;
}

function columnsOf(details: Partial<ChoreDetails>): Row {
    const row: Record<string, unknown> = {};
    if (details.title !== undefined) {
        const title = typeof details.title === 'string' ? details.title.trim() : '';
        if (!title) throw new Error('A chore needs a title.');
        row.title = title;
    }
    if (details.startDate !== undefined) {
        if (typeof details.startDate !== 'string' || !DAY.test(details.startDate)) throw new Error('A chore needs the day it starts, as YYYY-MM-DD.');
        row.start_date = details.startDate;
    }
    if (details.description !== undefined) row.description = details.description;
    if (details.rrule !== undefined) row.rrule = details.rrule ? details.rrule.replace(/^RRULE:/i, '') : null;
    if (details.exdates !== undefined) row.exdates = [...details.exdates];
    if (details.pauseState !== undefined) row.pause_state = details.pauseState;
    if (details.rotationType !== undefined) row.rotation_type = details.rotationType;
    if (details.isJoint !== undefined) row.is_joint = details.isJoint;
    if (details.isUpForGrabs !== undefined) row.is_up_for_grabs = details.isUpForGrabs;
    if (details.hideFromDayList !== undefined) row.hide_from_day_list = details.hideFromDayList;
    if (details.weight !== undefined) row.weight = details.weight;
    if (details.rewardType !== undefined) row.reward_type = details.rewardType;
    if (details.rewardAmount !== undefined) row.reward_amount = details.rewardAmount;
    if (details.rewardCurrency !== undefined) row.reward_currency = details.rewardCurrency;
    if (details.estimatedDurationSecs !== undefined) row.estimated_duration_secs = details.estimatedDurationSecs;
    if (details.timing !== undefined) Object.assign(row, timingColumns(details.timing));
    return row;
}

/** Makes a chore's assignees what they are given as: those no longer named go, new ones are added, and each takes its place. */
async function setAssignees(device: Device, writer: Writer, choreId: string, memberIds: readonly string[]): Promise<void> {
    const wanted = memberIds.filter((id, index) => memberIds.indexOf(id) === index);
    const held = await all(writer, sqlFor.selectFrom('chore_assignees').select(['id', 'family_member_id']).where('chore_id', '=', choreId));
    for (const row of held) if (!row.family_member_id || !wanted.includes(row.family_member_id)) await deleteRow(device, writer, 'chore_assignees', row.id);
    let position = 0;
    for (const memberId of wanted) {
        const id = `${choreId}.${memberId}`;
        if (held.some((row) => row.id === id)) await updateRow(device, writer, 'chore_assignees', id, { position });
        else await insertRow(device, writer, 'chore_assignees', { chore_id: choreId, family_member_id: memberId, position });
        position += 1;
    }
}

/** Adds a chore, after every other in the family's order. Answers with its id. */
export async function addChore(chore: NewChore): Promise<string> {
    const device = currentDevice();
    const columns = columnsOf({ timing: { mode: 'anytime' }, ...chore });
    return mutate(device, 'addChore', async (writer) => {
        const places = await all(writer, sqlFor.selectFrom('chores').select('sort_order'));
        const last = places.reduce((highest, row) => Math.max(highest, row.sort_order ?? 0), -1);
        const id = await insertRow(device, writer, 'chores', { id: device.createId(), ...columns, sort_order: last + 1, created_at: device.now().toISOString() });
        await setAssignees(device, writer, id, chore.assigneeIds ?? []);
        return id;
    });
}

export async function updateChore(choreId: string, changes: Partial<ChoreDetails>): Promise<void> {
    const device = currentDevice();
    const columns = columnsOf(changes);
    return mutate(device, 'updateChore', async (writer) => {
        if ((await updateRow(device, writer, 'chores', choreId, columns)) === null) throw new Error('That chore no longer exists.');
        if (changes.assigneeIds !== undefined) await setAssignees(device, writer, choreId, changes.assigneeIds);
    });
}

/** Removes a chore. What was done about it, and its place in any routine, goes with it on the server. */
export async function removeChore(choreId: string): Promise<void> {
    const device = currentDevice();
    return mutate(device, 'removeChore', async (writer) => {
        const assignees = await all(writer, sqlFor.selectFrom('chore_assignees').select('id').where('chore_id', '=', choreId));
        for (const row of assignees) await deleteRow(device, writer, 'chore_assignees', row.id);
        await deleteRow(device, writer, 'chores', choreId);
    });
}

/** Puts the chores in a new order: those named, in the order given, then the rest as they were. */
export async function reorderChores(orderedIds: readonly string[]): Promise<void> {
    const device = currentDevice();
    return mutate(device, 'reorderChores', async (writer) => {
        const every = await all(writer, sqlFor.selectFrom('chores').select('id').orderBy('sort_order').orderBy('id'));
        const known = new Set(every.map((row) => row.id));
        const named = orderedIds.filter((id, index) => known.has(id) && orderedIds.indexOf(id) === index);
        let place = 0;
        for (const id of [...named, ...every.map((row) => row.id).filter((id) => !named.includes(id))]) await updateRow(device, writer, 'chores', id, { sort_order: place++ });
    });
}

/** Gives several chores the same timing at once, as when the window they were in is taken away. */
export async function setChoresTiming(choreIds: readonly string[], timing: ChoreTiming): Promise<void> {
    const device = currentDevice();
    const columns = timingColumns(timing);
    return mutate(device, 'setChoresTiming', async (writer) => {
        for (const id of choreIds) await updateRow(device, writer, 'chores', id, columns);
    });
}
