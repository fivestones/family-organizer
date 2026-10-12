import { getAssignedMembersForChoreOnDate, type SharedChoreLike } from '@family-organizer/shared-core';
import type { Chore, ChoreCompletion, ChoreDay, FamilyMember } from '@/lib/data';

// What a day's chores look like to a person: which fall due, who each is for, and what has been done.
//
// Which chores fall due on a day, and whose turn a rotating chore is, is worked out by shared-core, as it is
// everywhere else in the app. It still takes a chore in the shape Instant returned one; this gives it that shape.

export interface ChoreForPerson {
    member: FamilyMember;
    completion: ChoreCompletion | null;
    done: boolean;
}

export interface ChoreOnDay {
    chore: Chore;
    people: ChoreForPerson[];
    /** For an up-for-grabs chore that someone has done: who. */
    doneBy: FamilyMember | null;
}

function asSharedChore(chore: Chore, membersById: ReadonlyMap<string, FamilyMember>): SharedChoreLike {
    const assignees = chore.assigneeIds.flatMap((memberId) => {
        const member = membersById.get(memberId);
        return member ? [{ id: member.id, name: member.name, color: member.color }] : [];
    });
    return {
        id: chore.id,
        title: chore.title,
        startDate: chore.startDate,
        rrule: chore.rrule,
        exdates: [...chore.exdates],
        rotationType: chore.rotationType,
        isJoint: chore.isJoint,
        isUpForGrabs: chore.isUpForGrabs,
        sortOrder: chore.sortOrder,
        assignees,
        // A rotation runs through the assignees in their order.
        assignments: assignees.map((familyMember, order) => ({ order, familyMember })),
    };
}

/** The chores due on a day, in the family's order, each with the people it is for that day. */
export function choresDueOn(day: ChoreDay, members: readonly FamilyMember[]): ChoreOnDay[] {
    const membersById = new Map(members.map((member) => [member.id, member]));
    const date = new Date(`${day.day}T00:00:00Z`);
    const due: ChoreOnDay[] = [];
    for (const chore of day.chores) {
        const assigned = getAssignedMembersForChoreOnDate(asSharedChore(chore, membersById), date);
        if (assigned.length === 0) continue;
        const completions = day.completions.filter((completion) => completion.choreId === chore.id);
        const people = assigned.flatMap((assignee) => {
            const member = membersById.get(assignee.id);
            if (!member) return [];
            const completion = completions.find((entry) => entry.completedBy === member.id) ?? null;
            return [{ member, completion, done: completion?.completedAt != null }];
        });
        const finished = chore.isUpForGrabs ? completions.find((completion) => completion.completedAt !== null) : undefined;
        due.push({ chore, people, doneBy: finished ? membersById.get(finished.completedBy) ?? null : null });
    }
    return due;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** A calendar day as the device's own clock has it, `YYYY-MM-DD`. */
export const localDayKey = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export function shiftDay(day: string, by: number): string {
    const date = new Date(`${day}T12:00:00`);
    date.setDate(date.getDate() + by);
    return localDayKey(date);
}

export function describeDay(day: string, today: string): string {
    if (day === today) return 'Today';
    if (day === shiftDay(today, -1)) return 'Yesterday';
    if (day === shiftDay(today, 1)) return 'Tomorrow';
    return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}
