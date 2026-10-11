import {
    calculateDailyXP,
    formatDateKeyUTC,
    getAssignedMembersForChoreOnDate,
    getRoutineChoreIds,
    isChoreHiddenFromDayList,
    sortRoutines,
    type SharedChoreLike,
    type SharedFamilyMemberLike,
    type SharedRoutineLike,
} from '@family-organizer/shared-core';

/**
 * What the day list shows in place of a routine's steps: one row per routine
 * with its progress and its XP.
 *
 * XP is worked out from the chores, never from the rows on screen, so folding
 * steps away changes no totals. But it does leave the sidebar's possible-XP
 * counting chores nobody can see, which is why each row carries its own figure:
 * without it the numbers would not visibly add up.
 */

export interface RoutineDayStep {
    choreId: string;
    title: string;
    /** Folded into this row rather than listed by itself. */
    hidden: boolean;
    /** Who is doing it today, and whether they have. */
    members: Array<{ id: string; name: string; done: boolean }>;
}

export interface RoutineDayMember {
    id: string;
    name: string;
    completed: number;
    total: number;
}

export interface RoutineDaySummary {
    id: string;
    name: string;
    /** Steps counted once per person doing them. */
    completed: number;
    total: number;
    xpEarned: number;
    xpPossible: number;
    hiddenCount: number;
    steps: RoutineDayStep[];
    members: RoutineDayMember[];
}

function completedMemberIds(chore: SharedChoreLike, dateKey: string): Set<string> {
    const memberIds = new Set<string>();
    for (const completion of chore.completions || []) {
        if (!completion?.completed || completion.dateDue !== dateKey) continue;
        const completedBy = Array.isArray(completion.completedBy) ? completion.completedBy[0] : completion.completedBy;
        if (completedBy?.id) memberIds.add(completedBy.id);
    }
    return memberIds;
}

/**
 * Summarise every routine that has a step due on `date` for the people in view.
 * `memberId` narrows it to one person; `'All'` counts everyone.
 */
export function summarizeRoutinesForDay(
    routines: SharedRoutineLike[],
    chores: SharedChoreLike[],
    familyMembers: SharedFamilyMemberLike[],
    date: Date,
    memberId: string | 'All' = 'All',
): RoutineDaySummary[] {
    const dateKey = formatDateKeyUTC(date);
    const choresById = new Map(chores.map((chore) => [chore.id, chore]));
    const memberNames = new Map(familyMembers.map((member) => [member.id, member.name || 'Unknown']));
    const summaries: RoutineDaySummary[] = [];

    for (const routine of sortRoutines(routines)) {
        const steps: RoutineDayStep[] = [];
        const dueChores: SharedChoreLike[] = [];
        const perMember = new Map<string, RoutineDayMember>();

        for (const choreId of getRoutineChoreIds(routine)) {
            const chore = choresById.get(choreId);
            if (!chore) continue;
            const assigned = getAssignedMembersForChoreOnDate(chore, date).filter(
                (member) => memberId === 'All' || member.id === memberId,
            );
            if (assigned.length === 0) continue;

            const done = completedMemberIds(chore, dateKey);
            dueChores.push(chore);
            steps.push({
                choreId,
                title: chore.title || 'Untitled chore',
                hidden: isChoreHiddenFromDayList(chore),
                members: assigned.map((member) => ({
                    id: member.id,
                    name: memberNames.get(member.id) ?? member.name ?? 'Unknown',
                    done: done.has(member.id),
                })),
            });
            for (const member of assigned) {
                const tally = perMember.get(member.id) ?? {
                    id: member.id,
                    name: memberNames.get(member.id) ?? member.name ?? 'Unknown',
                    completed: 0,
                    total: 0,
                };
                tally.total += 1;
                if (done.has(member.id)) tally.completed += 1;
                perMember.set(member.id, tally);
            }
        }

        if (steps.length === 0) continue;

        const members = familyMembers.flatMap((member) => perMember.get(member.id) ?? []);
        const xp = calculateDailyXP(dueChores, familyMembers, date);
        const inView = members.map((member) => xp[member.id]).filter(Boolean);

        summaries.push({
            id: routine.id,
            name: routine.name || 'Routine',
            completed: members.reduce((sum, member) => sum + member.completed, 0),
            total: members.reduce((sum, member) => sum + member.total, 0),
            xpEarned: inView.reduce((sum, stats) => sum + stats.current, 0),
            xpPossible: inView.reduce((sum, stats) => sum + stats.possible, 0),
            hiddenCount: steps.filter((step) => step.hidden).length,
            steps,
            members,
        });
    }

    return summaries;
}
