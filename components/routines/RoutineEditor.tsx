'use client';

import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, FastForward, Hand, ListPlus, Plus, Search, Timer, X } from 'lucide-react';
import type { SharedChoreLike, SharedRoutineLike } from '@family-organizer/shared-core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { validateRoutineDraft, type RoutineDraft } from '@/lib/routine-mutations';
import { cn } from '@/lib/utils';
import {
    EVERY_DAY,
    SCHOOL_DAYS,
    WEEKDAYS,
    WEEKEND_DAYS,
    createChoreStep,
    createRoutineEditorState,
    createTypedStep,
    describeDays,
    moveStep,
    toRoutineDraft,
    type EditorStep,
    type RoutineEditorState,
    type WeekdayCode,
} from './routine-draft';

interface RoutineEditorProps {
    /** The routine being edited; null to create one. */
    routine: SharedRoutineLike | null;
    chores: Array<SharedChoreLike & { estimatedDurationSecs?: number | null }>;
    familyMembers: Array<{ id: string; name?: string | null }>;
    onSave: (draft: RoutineDraft) => Promise<void> | void;
    onCancel: () => void;
}

const OVERRUN_CHOICES = [
    {
        value: 'wait' as const,
        icon: Hand,
        title: 'Wait for Done',
        detail: 'The step counts up past zero and stays put until it is ticked off.',
    },
    {
        value: 'advance' as const,
        icon: FastForward,
        title: 'Move on at zero',
        detail: 'The next step starts by itself. For routines that end when the bus arrives.',
    },
];

const DAY_PRESETS: Array<{ label: string; days: WeekdayCode[] }> = [
    { label: 'Every day', days: EVERY_DAY },
    { label: 'Weekdays', days: SCHOOL_DAYS },
    { label: 'Weekends', days: WEEKEND_DAYS },
];

function sameDays(left: WeekdayCode[], right: WeekdayCode[]) {
    return left.length === right.length && right.every((day) => left.includes(day));
}

function formatMinutes(secs: number | null | undefined): string | null {
    if (secs == null || secs <= 0) return null;
    const minutes = secs / 60;
    return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)} min`;
}

const SECTION = 'space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4';

export default function RoutineEditor({ routine, chores, familyMembers, onSave, onCancel }: RoutineEditorProps) {
    const [state, setState] = useState<RoutineEditorState>(() =>
        createRoutineEditorState(
            routine,
            chores,
            familyMembers.slice(0, 1).map((member) => member.id),
        ),
    );
    const [newTitle, setNewTitle] = useState('');
    const [newMinutes, setNewMinutes] = useState('');
    const [isPickingChore, setIsPickingChore] = useState(false);
    const [choreSearch, setChoreSearch] = useState('');
    const [problem, setProblem] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const choresById = useMemo(() => new Map(chores.map((chore) => [chore.id, chore])), [chores]);
    const memberNames = useMemo(() => new Map(familyMembers.map((member) => [member.id, member.name || 'Unknown'])), [familyMembers]);
    const hasTypedSteps = state.steps.some((step) => !step.choreId);

    const pickableChores = useMemo(() => {
        const taken = new Set(state.steps.map((step) => step.choreId));
        const query = choreSearch.trim().toLowerCase();
        return chores
            .filter((chore) => !taken.has(chore.id) && (!query || (chore.title || '').toLowerCase().includes(query)))
            .sort((left, right) => (left.title || '').localeCompare(right.title || '', undefined, { sensitivity: 'base' }));
    }, [chores, state.steps, choreSearch]);

    const update = (patch: Partial<RoutineEditorState>) => {
        setProblem(null);
        setState((current) => ({ ...current, ...patch }));
    };
    const updateStep = (key: string, patch: Partial<EditorStep>) =>
        update({ steps: state.steps.map((step) => (step.key === key ? { ...step, ...patch } : step)) });

    const addTypedStep = () => {
        const title = newTitle.trim();
        if (!title) return;
        update({ steps: [...state.steps, createTypedStep(title, newMinutes)] });
        setNewTitle('');
        setNewMinutes('');
    };

    const toggleDay = (day: WeekdayCode) => {
        const next = state.days.includes(day) ? state.days.filter((entry) => entry !== day) : [...state.days, day];
        if (next.length > 0) update({ days: next }); // A chore that repeats on no days would never appear.
    };

    const toggleAssignee = (memberId: string) =>
        update({
            assigneeIds: state.assigneeIds.includes(memberId)
                ? state.assigneeIds.filter((entry) => entry !== memberId)
                : [...state.assigneeIds, memberId],
        });

    const handleSave = async () => {
        const draft = toRoutineDraft(state);
        const invalid = validateRoutineDraft(draft);
        if (invalid) {
            setProblem(invalid);
            return;
        }
        setIsSaving(true);
        try {
            await onSave(draft);
        } catch (error: any) {
            setProblem(error?.message || 'The routine could not be saved.');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-5">
            {/* ---- Name ---- */}
            <div className="space-y-1.5">
                <Label htmlFor="routine-name">Name</Label>
                <Input
                    id="routine-name"
                    value={state.name}
                    onChange={(event) => update({ name: event.target.value })}
                    placeholder="Morning Routine"
                    autoFocus
                />
            </div>

            {/* ---- Steps ---- */}
            <section className={SECTION} aria-label="Steps">
                <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-sm font-semibold">Steps</h3>
                    <p className="text-xs text-muted-foreground">Run top to bottom. The order here replaces any &ldquo;after this chore&rdquo; rules.</p>
                </div>

                {state.steps.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-muted-foreground">
                        No steps yet. Type one below, or add a chore you already have.
                    </p>
                ) : (
                    <ol className="space-y-2">
                        {state.steps.map((step, index) => {
                            const chore = step.choreId ? choresById.get(step.choreId) : null;
                            const assignees = (chore?.assignees || []).map((assignee) => memberNames.get(assignee.id) ?? assignee.name).filter(Boolean);
                            const duration = formatMinutes(chore?.estimatedDurationSecs ?? (chore?.weight ? chore.weight * 60 : null));
                            return (
                                <li
                                    key={step.key}
                                    data-testid="routine-step"
                                    className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm"
                                >
                                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                                        {index + 1}
                                    </span>

                                    {chore ? (
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-sm font-medium">{step.title}</div>
                                            <div className="truncate text-xs text-muted-foreground">
                                                {[assignees.join(', ') || 'Nobody assigned', duration ?? 'No timer'].join(' · ')}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex min-w-0 flex-1 items-center gap-2">
                                            <Input
                                                aria-label={`Step ${index + 1} name`}
                                                value={step.title}
                                                onChange={(event) => updateStep(step.key, { title: event.target.value })}
                                                className="h-9 min-w-0 flex-1"
                                            />
                                            <Input
                                                aria-label={`Step ${index + 1} minutes`}
                                                type="number"
                                                min={0}
                                                step="any"
                                                inputMode="decimal"
                                                value={step.durationMins}
                                                onChange={(event) => updateStep(step.key, { durationMins: event.target.value })}
                                                placeholder="min"
                                                className="h-9 w-20 shrink-0"
                                            />
                                            <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                                                New
                                            </span>
                                        </div>
                                    )}

                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={step.showInDayList}
                                        aria-label={`Show ${step.title || `step ${index + 1}`} in the day list`}
                                        title={step.showInDayList ? 'Listed by itself in the day list' : 'Folded into the routine in the day list'}
                                        onClick={() => updateStep(step.key, { showInDayList: !step.showInDayList })}
                                        className={cn(
                                            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                                            step.showInDayList ? 'bg-sky-100 text-sky-700 hover:bg-sky-200' : 'text-slate-400 hover:bg-slate-100',
                                        )}
                                    >
                                        {step.showInDayList ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                                    </button>

                                    <div className="flex shrink-0 items-center">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8"
                                            disabled={index === 0}
                                            aria-label={`Move ${step.title || `step ${index + 1}`} up`}
                                            onClick={() => update({ steps: moveStep(state.steps, index, -1) })}
                                        >
                                            <ArrowUp className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8"
                                            disabled={index === state.steps.length - 1}
                                            aria-label={`Move ${step.title || `step ${index + 1}`} down`}
                                            onClick={() => update({ steps: moveStep(state.steps, index, 1) })}
                                        >
                                            <ArrowDown className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-slate-400 hover:text-destructive"
                                            aria-label={`Remove ${step.title || `step ${index + 1}`}`}
                                            onClick={() => update({ steps: state.steps.filter((entry) => entry.key !== step.key) })}
                                        >
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </li>
                            );
                        })}
                    </ol>
                )}

                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Eye className="h-3.5 w-3.5 text-sky-700" /> listed by itself in the day list
                    <EyeOff className="ml-2 h-3.5 w-3.5" /> folded into the routine&rsquo;s row
                </p>

                {/* Add a step by typing it */}
                <form
                    className="flex items-center gap-2"
                    onSubmit={(event) => {
                        event.preventDefault();
                        addTypedStep();
                    }}
                >
                    <Input
                        aria-label="New step name"
                        value={newTitle}
                        onChange={(event) => setNewTitle(event.target.value)}
                        placeholder="Type a new step, like “Brush teeth”"
                        className="min-w-0 flex-1 bg-white"
                    />
                    <div className="relative w-24 shrink-0">
                        <Timer className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                            aria-label="New step minutes"
                            type="number"
                            min={0}
                            step="any"
                            inputMode="decimal"
                            value={newMinutes}
                            onChange={(event) => setNewMinutes(event.target.value)}
                            placeholder="min"
                            className="bg-white pl-8"
                        />
                    </div>
                    <Button type="submit" variant="secondary" disabled={!newTitle.trim()} className="shrink-0">
                        <Plus className="mr-1.5 h-4 w-4" /> Add
                    </Button>
                </form>

                {/* Add a step by pointing at a chore */}
                {isPickingChore ? (
                    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                        <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <Input
                                aria-label="Search chores"
                                value={choreSearch}
                                onChange={(event) => setChoreSearch(event.target.value)}
                                placeholder="Search your chores"
                                className="pl-9"
                                autoFocus
                            />
                        </div>
                        <ul className="max-h-48 space-y-1 overflow-y-auto">
                            {pickableChores.length === 0 ? (
                                <li className="px-2 py-3 text-center text-sm text-muted-foreground">No chores to add.</li>
                            ) : (
                                pickableChores.map((chore) => (
                                    <li key={chore.id}>
                                        <button
                                            type="button"
                                            onClick={() => update({ steps: [...state.steps, createChoreStep(chore)] })}
                                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-100"
                                        >
                                            <Plus className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                            <span className="min-w-0 flex-1 truncate">{chore.title}</span>
                                            <span className="shrink-0 text-xs text-muted-foreground">
                                                {(chore.assignees || []).map((assignee) => memberNames.get(assignee.id)).filter(Boolean).join(', ')}
                                            </span>
                                        </button>
                                    </li>
                                ))
                            )}
                        </ul>
                        <div className="flex justify-end">
                            <Button type="button" variant="ghost" size="sm" onClick={() => setIsPickingChore(false)}>
                                Done adding
                            </Button>
                        </div>
                    </div>
                ) : (
                    <Button type="button" variant="outline" size="sm" onClick={() => setIsPickingChore(true)} className="bg-white">
                        <ListPlus className="mr-1.5 h-4 w-4" /> Add a chore you already have
                    </Button>
                )}
            </section>

            {/* ---- Who and when, for the chores this routine creates ---- */}
            {hasTypedSteps && (
                <section className={SECTION} aria-label="New steps">
                    <div>
                        <h3 className="text-sm font-semibold">New steps</h3>
                        <p className="text-xs text-muted-foreground">
                            Each new step becomes a chore for{' '}
                            {state.assigneeIds.length > 0
                                ? state.assigneeIds.map((memberId) => memberNames.get(memberId)).filter(Boolean).join(', ')
                                : 'nobody yet'}
                            , {describeDays(state.days)}. You can change either later from the chore itself.
                        </p>
                    </div>

                    <div className="space-y-1.5">
                        <Label>Who</Label>
                        <div className="flex flex-wrap gap-2" role="group" aria-label="Who the new steps are for">
                            {familyMembers.map((member) => {
                                const chosen = state.assigneeIds.includes(member.id);
                                return (
                                    <button
                                        key={member.id}
                                        type="button"
                                        aria-pressed={chosen}
                                        onClick={() => toggleAssignee(member.id)}
                                        className={cn(
                                            'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                                            chosen ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100',
                                        )}
                                    >
                                        {member.name}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label>Days</Label>
                        <div className="flex flex-wrap items-center gap-2">
                            {DAY_PRESETS.map((preset) => (
                                <button
                                    key={preset.label}
                                    type="button"
                                    aria-pressed={sameDays(state.days, preset.days)}
                                    onClick={() => update({ days: preset.days })}
                                    className={cn(
                                        'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                                        sameDays(state.days, preset.days)
                                            ? 'border-slate-900 bg-slate-900 text-white'
                                            : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100',
                                    )}
                                >
                                    {preset.label}
                                </button>
                            ))}
                            <span className="mx-1 h-5 w-px bg-slate-300" aria-hidden />
                            <div className="flex gap-1" role="group" aria-label="Days the new steps repeat on">
                                {WEEKDAYS.map((day) => {
                                    const chosen = state.days.includes(day.code);
                                    return (
                                        <button
                                            key={day.code}
                                            type="button"
                                            aria-pressed={chosen}
                                            aria-label={day.label}
                                            onClick={() => toggleDay(day.code)}
                                            className={cn(
                                                'h-8 w-8 rounded-full text-xs font-semibold transition-colors',
                                                chosen ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 ring-1 ring-slate-300 hover:bg-slate-100',
                                            )}
                                        >
                                            {day.short}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </section>
            )}

            {/* ---- At zero ---- */}
            <section className={SECTION} aria-label="When a step runs out of time">
                <h3 className="text-sm font-semibold">When a step runs out of time</h3>
                <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="When a step runs out of time">
                    {OVERRUN_CHOICES.map((choice) => {
                        const chosen = state.onStepOverrun === choice.value;
                        return (
                            <button
                                key={choice.value}
                                type="button"
                                role="radio"
                                aria-checked={chosen}
                                onClick={() => update({ onStepOverrun: choice.value })}
                                className={cn(
                                    'flex items-start gap-3 rounded-xl border bg-white p-3 text-left transition-all',
                                    chosen ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200 hover:border-slate-300',
                                )}
                            >
                                <choice.icon className={cn('mt-0.5 h-5 w-5 shrink-0', chosen ? 'text-slate-900' : 'text-slate-400')} />
                                <span>
                                    <span className="block text-sm font-semibold">{choice.title}</span>
                                    <span className="block text-xs text-muted-foreground">{choice.detail}</span>
                                </span>
                            </button>
                        );
                    })}
                </div>
            </section>

            {problem && (
                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700">
                    {problem}
                </div>
            )}

            <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={onCancel} disabled={isSaving}>
                    Cancel
                </Button>
                <Button type="button" onClick={handleSave} disabled={isSaving}>
                    {isSaving ? 'Saving…' : routine ? 'Save routine' : 'Create routine'}
                </Button>
            </div>
        </div>
    );
}
