import { createChoreCompletionRecordId } from '@family-organizer/shared-core';
import type { ChoresBackend } from '../chores/backend';
import type { AnchorEvent, Chore, ChoreCompletion, ChoreCompletionInput, ChoreCompletionResult, ChoreDay, ChoreTiming, Day } from '../chores/types';
import { toServerForm } from '../policy';
import type { QueryResult, ReadOptions } from '../query-result';
import type { Device } from './device';
import { useLiveRead } from './live';
import { ensureInsert, ensureUpdate, mutate } from './mutate';
import type { ClientDatabase } from './schema';
import { all, asRecord, first, flag, fromJson, run, sqlFor, toMinutes, type Reader, type Writer } from './sql';

type ChoreRow = ClientDatabase['chores'];
type CompletionRow = ClientDatabase['chore_completions'];
type AssigneeRow = Pick<ClientDatabase['chore_assignees'], 'chore_id' | 'family_member_id'>;

interface RawChoreDay {
    chores: ChoreRow[];
    assignees: AssigneeRow[];
    completions: CompletionRow[];
}

const anchorEvent = (value: string | null): AnchorEvent => (value === 'started' ? 'started' : 'completed');

/** The columns of a chore that say when in the day it is due, as the one shape its mode calls for. */
function toTiming(row: ChoreRow): ChoreTiming {
    switch (row.timing_mode) {
        case 'named_window':
            return { mode: 'named_window', windowKey: row.timing_window_key };
        case 'before_time':
        case 'after_time':
            return { mode: row.timing_mode, time: toMinutes(row.timing_time) };
        case 'between_times':
            return { mode: 'between_times', startTime: toMinutes(row.timing_start_time), endTime: toMinutes(row.timing_end_time) };
        case 'before_marker':
        case 'after_marker':
            return { mode: row.timing_mode, markerKey: row.timing_marker_key, event: anchorEvent(row.timing_event), fallbackTime: toMinutes(row.timing_fallback_time) };
        case 'before_chore':
        case 'after_chore':
            return { mode: row.timing_mode, choreId: row.timing_chore_id, event: anchorEvent(row.timing_event), fallbackTime: toMinutes(row.timing_fallback_time) };
        default:
            return { mode: 'anytime' };
    }
}

export function toChore(row: ChoreRow, assigneeIds: readonly string[]): Chore {
    const exdates = fromJson(row.exdates);
    return {
        id: row.id,
        title: row.title ?? '',
        description: row.description,
        startDate: row.start_date ?? '',
        rrule: row.rrule,
        exdates: Array.isArray(exdates) ? exdates.filter((value): value is string => typeof value === 'string') : [],
        pauseState: asRecord(fromJson(row.pause_state)),
        rotationType: row.rotation_type === 'daily' || row.rotation_type === 'weekly' || row.rotation_type === 'monthly' ? row.rotation_type : 'none',
        isJoint: flag(row.is_joint),
        isUpForGrabs: flag(row.is_up_for_grabs),
        hideFromDayList: flag(row.hide_from_day_list),
        sortOrder: row.sort_order ?? 0,
        weight: row.weight,
        rewardType: row.reward_type === 'fixed' || row.reward_type === 'weight' ? row.reward_type : null,
        rewardAmount: row.reward_amount,
        rewardCurrency: row.reward_currency,
        estimatedDurationSecs: row.estimated_duration_secs,
        timing: toTiming(row),
        createdAt: row.created_at ?? '',
        assigneeIds,
    };
}

function toCompletion(row: CompletionRow): ChoreCompletion {
    return {
        id: row.id,
        choreId: row.chore_id ?? '',
        completedBy: row.completed_by ?? '',
        markedBy: row.marked_by,
        dateDue: row.date_due ?? '',
        completedAt: row.completed_at,
        notDone: flag(row.not_done),
        allowanceAwarded: flag(row.allowance_awarded),
    };
}

/** Every chore with who it is assigned to, in the family's order. */
export async function readChores(reader: Reader): Promise<Pick<RawChoreDay, 'chores' | 'assignees'>> {
    return {
        chores: await all<ChoreRow>(reader, sqlFor.selectFrom('chores').selectAll().orderBy('sort_order').orderBy('id')),
        assignees: await all<AssigneeRow>(reader, sqlFor.selectFrom('chore_assignees').select(['chore_id', 'family_member_id']).orderBy('position').orderBy('family_member_id')),
    };
}

export function toChores(raw: Pick<RawChoreDay, 'chores' | 'assignees'>): Chore[] {
    return [...toChoreDay('', { ...raw, completions: [] }).chores];
}

/** Three flat reads, each on an indexed column, taken at one moment. */
export async function readChoreDay(reader: Reader, day: Day): Promise<RawChoreDay> {
    return {
        chores: await all<ChoreRow>(reader, sqlFor.selectFrom('chores').selectAll().orderBy('sort_order').orderBy('id')),
        assignees: await all<AssigneeRow>(reader, sqlFor.selectFrom('chore_assignees').select(['chore_id', 'family_member_id']).orderBy('position').orderBy('family_member_id')),
        completions: await all<CompletionRow>(reader, sqlFor.selectFrom('chore_completions').selectAll().where('date_due', '=', day).orderBy('id')),
    };
}

export function toChoreDay(day: Day, raw: RawChoreDay): ChoreDay {
    const assigneesOf = new Map<string, string[]>();
    for (const row of raw.assignees) {
        if (!row.chore_id || !row.family_member_id) continue;
        const list = assigneesOf.get(row.chore_id) ?? [];
        list.push(row.family_member_id);
        assigneesOf.set(row.chore_id, list);
    }
    return { day, chores: raw.chores.map((row) => toChore(row, assigneesOf.get(row.id) ?? [])), completions: raw.completions.map(toCompletion) };
}

/** The entry the family's history gets for a chore ticked or un-ticked, with whom it affected. */
async function recordInHistory(device: Device, writer: Writer, input: ChoreCompletionInput, title: string, done: boolean, occurredAt: string): Promise<void> {
    const eventId = device.createId();
    const actorId = input.markedBy || input.memberId;
    const metadata = { choreTitle: title, completed: done, dateDue: input.day };
    const event = {
        id: eventId,
        occurred_at: occurredAt,
        domain: 'chores',
        action_type: done ? 'chore_marked_done' : 'chore_marked_undone',
        summary: done ? `Completed "${title}"` : `Marked "${title}" not done`,
        source: 'manual',
        actor_id: actorId,
        chore_id: input.choreId,
        scheduled_for: input.day,
    };
    ensureInsert(device, 'history_events', { ...event, metadata });
    await run(writer, sqlFor.insertInto('history_events').values({ ...event, metadata: JSON.stringify(metadata) }));
    const affected = { history_event_id: eventId, family_member_id: input.memberId };
    ensureInsert(device, 'history_event_members', affected);
    await run(writer, sqlFor.insertInto('history_event_members').values({ id: `${eventId}.${input.memberId}`, ...affected }));
}

function changeCompletion(device: Device, input: ChoreCompletionInput, done: boolean): Promise<ChoreCompletionResult> {
    return mutate(device, done ? 'completeChore' : 'reopenChore', async (writer): Promise<ChoreCompletionResult> => {
        const chore = await first(writer, sqlFor.selectFrom('chores').select(['id', 'title', 'is_up_for_grabs']).where('id', '=', input.choreId));
        if (!chore) throw new Error('That chore no longer exists.');
        const onDay = await all<CompletionRow>(writer, sqlFor.selectFrom('chore_completions').selectAll().where('chore_id', '=', input.choreId).where('date_due', '=', input.day));
        const mine = onDay.find((row) => row.completed_by === input.memberId) ?? null;
        const upForGrabs = flag(chore.is_up_for_grabs);
        const title = chore.title ?? '';
        const occurredAt = device.now().toISOString();

        if (!done) {
            if (!mine || mine.completed_at === null) return { status: 'unchanged' };
            ensureUpdate(device, 'chore_completions', toServerForm('chore_completions', mine), { completed_at: null, not_done: false });
            await run(writer, sqlFor.updateTable('chore_completions').set({ completed_at: null, not_done: 0 }).where('id', '=', mine.id));
            await recordInHistory(device, writer, input, title, false, occurredAt);
            return { status: 'reopened', completionId: mine.id };
        }

        // Up for grabs: once someone has done it today, it is done for everyone.
        const doneByOther = upForGrabs ? onDay.find((row) => row.completed_at !== null && row.completed_by !== input.memberId) : undefined;
        if (doneByOther && !(mine && mine.completed_at !== null)) return { status: 'claimed', claimedBy: doneByOther.completed_by ?? '' };
        if (mine && mine.completed_at !== null) return { status: 'unchanged' };

        if (mine) {
            ensureUpdate(device, 'chore_completions', toServerForm('chore_completions', mine), { completed_at: occurredAt, not_done: false });
            await run(writer, sqlFor.updateTable('chore_completions').set({ completed_at: occurredAt, not_done: 0 }).where('id', '=', mine.id));
            await recordInHistory(device, writer, input, title, true, occurredAt);
            return { status: 'completed', completionId: mine.id };
        }

        // An up-for-grabs completion has an id worked out from its chore and day, so two devices that each make
        // one offline make the same row and the server can see that they did.
        const completionId = createChoreCompletionRecordId(input.choreId, input.day, upForGrabs, device.createId);
        const released = onDay.find((row) => row.id === completionId) ?? null;
        if (released) {
            // Someone ticked it and un-ticked it again. It is taken over, not made a second time.
            const changes = { completed_by: input.memberId, marked_by: input.markedBy ?? null, completed_at: occurredAt, not_done: false };
            ensureUpdate(device, 'chore_completions', toServerForm('chore_completions', released), changes);
            await run(writer, sqlFor.updateTable('chore_completions').set({ ...changes, not_done: 0 }).where('id', '=', completionId));
        } else {
            const completion = { id: completionId, chore_id: input.choreId, completed_by: input.memberId, marked_by: input.markedBy ?? null, date_due: input.day, completed_at: occurredAt };
            ensureInsert(device, 'chore_completions', { ...completion, not_done: false, allowance_awarded: false });
            await run(writer, sqlFor.insertInto('chore_completions').values({ ...completion, not_done: 0, allowance_awarded: 0 }));
        }
        await recordInHistory(device, writer, input, title, true, occurredAt);
        return { status: 'completed', completionId };
    });
}

const EMPTY_DAY = (day: Day): ChoreDay => ({ day, chores: [], completions: [] });

export function createPowerSyncChoresBackend(device: Device): ChoresBackend {
    return {
        useChoreDay(day: Day, options?: ReadOptions): QueryResult<ChoreDay> {
            return useLiveRead(
                device.db,
                ['chores', 'chore_assignees', 'chore_completions'],
                (reader) => readChoreDay(reader, day),
                (raw) => toChoreDay(day, raw),
                EMPTY_DAY(day),
                [day],
                options
            );
        },
        completeChore: (input) => changeCompletion(device, input, true),
        reopenChore: (input) => changeCompletion(device, input, false),
    };
}
