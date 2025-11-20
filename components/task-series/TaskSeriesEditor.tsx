// components/task-series/TaskSeriesEditor.tsx
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useEditor, EditorContent, JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { id, tx } from '@instantdb/react';
import { startOfDay, format, parseISO } from 'date-fns';
import { RRule } from 'rrule'; // Import RRule
import { Loader2 } from 'lucide-react';
import { useDebouncedCallback } from 'use-debounce';
import { SlashCommand, slashCommandSuggestion } from './SlashCommand';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import TaskItemExtension, { TaskDateContext } from './TaskItem';

// --- Types (Simplified for brevity, matching your provided types) ---
interface Task {
    id: string;
    text?: string | null;
    indentationLevel?: number;
    order?: number | null;
    isDayBreak?: boolean | null;
    // ... other DB fields (notes, attachments, etc)
}

interface TaskSeriesEditorProps {
    db: any;
    initialSeriesId?: string | null;
    initialFamilyMemberId?: string | null;
    onClose?: () => void;
}

const TaskSeriesEditor: React.FC<TaskSeriesEditorProps> = ({ db, initialSeriesId, onClose }) => {
    const { toast } = useToast();
    const [seriesId] = useState<string>(initialSeriesId || id());
    const [isSaving, setIsSaving] = useState(false);

    // Map stores object { label, date } instead of just string
    const [taskDateMap, setTaskDateMap] = useState<Record<string, { label: string; date: Date } | undefined>>({});

    const [taskSeriesName, setTaskSeriesName] = useState('');
    const [startDate, setStartDate] = useState<Date>(startOfDay(new Date()));

    // --- 1. Fetch Data ---
    const { data, isLoading } = db.useQuery({
        taskSeries: {
            $: { where: { id: seriesId } },
            tasks: {},
        },
    });

    const dbTasks: Task[] = data?.taskSeries?.[0]?.tasks || [];
    const seriesData = data?.taskSeries?.[0];

    // Load series metadata
    useEffect(() => {
        if (seriesData) {
            setTaskSeriesName(seriesData.name || '');
            if (seriesData.startDate) setStartDate(parseISO(seriesData.startDate));
        }
    }, [seriesData]);

    // --- 2. Editor Setup ---
    const editor = useEditor({
        immediatelyRender: false,
        extensions: [
            StarterKit.configure({
                paragraph: false,
                bulletList: false,
                orderedList: false,
                listItem: false,

                // Disable other blocks to keep the schema clean/flat
                blockquote: false,
                codeBlock: false,
                heading: false,
                horizontalRule: false,

                // Note: We implicitly KEEP 'document', 'text', 'bold', 'history', etc.
            }),
            TaskItemExtension,
            // Add Slash Command Extension
            SlashCommand.configure({
                suggestion: slashCommandSuggestion,
            }),
        ],
        content: { type: 'doc', content: [] },
        editorProps: {
            attributes: {
                class: 'focus:outline-none min-h-[300px] p-4',
            },
        },
        onUpdate: ({ editor }) => {
            // 1. DATE CALCULATION
            requestAnimationFrame(() => {
                calculateDates(editor.getJSON());
            });

            // 2. SAVE
            debouncedSave(editor.getJSON());
        },
    });

    // --- 3. Date Calculation Logic (RRule) ---
    const calculateDates = useCallback(
        (json: JSONContent) => {
            if (!json.content) return;

            const map: Record<string, { label: string; date: Date } | undefined> = {};

            // 1. Configure RRule
            // FIX: Use 'byweekday', not 'byday'
            const rule = new RRule({
                freq: RRule.MONTHLY,
                interval: 2,
                bysetpos: 5,
                byweekday: RRule.FR,
                dtstart: startDate,
            });

            // 2. Determine Start Date
            // We want the first task to be ON start date (if valid) or the first valid weekday after.
            // 'inc: true' means "inclusive" - if startDate is valid, return it.
            // We subtract 1 day locally to ensure 'after' catches today if today is valid.
            let currentDate = rule.after(new Date(startDate.getTime() - 24 * 60 * 60 * 1000), true);

            // Fallback: If rule fails (rare), default to startDate
            if (!currentDate) currentDate = startDate;

            // 3. Track the last displayed label to prevent repeats
            let lastDisplayedDateLabel = '';

            json.content.forEach((node) => {
                if (node.type === 'taskItem' && node.attrs) {
                    const { id, isDayBreak } = node.attrs;

                    // STRICT CHECK: Only use the attribute.
                    // We no longer check text content for "-".
                    if (isDayBreak) {
                        // ... (Day break logic - advance date, empty label)
                        if (currentDate) {
                            currentDate = rule.after(currentDate) || currentDate;
                        }

                        // 2. The Break itself gets the NEW date internally (for sorting/storage),
                        // but we forcefully suppress the label by passing empty string.
                        map[id] = { label: '', date: currentDate };
                    } else {
                        // --- STANDARD TASK ---
                        if (currentDate) {
                            const dateLabel = format(currentDate, 'E, M/d');

                            // Only show label if it differs from the previous visible one
                            const showLabel = dateLabel !== lastDisplayedDateLabel;

                            map[id] = {
                                label: showLabel ? dateLabel : '',
                                date: currentDate,
                            };

                            if (showLabel) {
                                lastDisplayedDateLabel = dateLabel;
                            }
                        }
                    }
                }
            });

            setTaskDateMap(map);
        },
        [startDate]
    );

    // Recalculate dates if start date changes
    useEffect(() => {
        if (editor) calculateDates(editor.getJSON());
    }, [startDate, editor, calculateDates]);

    // --- 4. Hydration (DB -> TipTap) ---
    // We use a ref to ensure we only hydrate ONCE when data is first available
    const hasHydrated = React.useRef(false);

    useEffect(() => {
        if (editor && !isLoading && !hasHydrated.current) {
            if (dbTasks.length > 0) {
                // Sort by order
                const sortedTasks = [...dbTasks].sort((a, b) => (a.order || 0) - (b.order || 0));

                // Convert to TipTap JSON
                const content = sortedTasks.map((t) => ({
                    type: 'taskItem',
                    attrs: {
                        id: t.id,
                        indentationLevel: t.indentationLevel || 0,
                        // STRICT HYDRATION: Only true if DB says true.
                        // If DB has text: "-" but isDayBreak is false, it loads as a normal task with text "-".
                        isDayBreak: t.isDayBreak || false,
                    },
                    content: t.text ? [{ type: 'text', text: t.text }] : undefined,
                }));

                editor.commands.setContent({ type: 'doc', content });
            } else {
                // Initialize with one empty task if new
                editor.commands.setContent({
                    type: 'doc',
                    content: [
                        {
                            type: 'taskItem',
                            attrs: { id: id(), indentationLevel: 0, isDayBreak: false },
                        },
                    ],
                });
            }

            hasHydrated.current = true;
            // Initial date calc
            calculateDates(editor.getJSON());
        }
    }, [editor, isLoading, dbTasks, calculateDates]);

    // --- 5. Saving (TipTap -> DB) ---
    const debouncedSave = useDebouncedCallback(async (json: JSONContent) => {
        if (!json.content) return;
        setIsSaving(true);

        const transactions: any[] = [];
        const currentIds = new Set<string>();

        // 1. Prepare Updates/Inserts
        json.content.forEach((node, index) => {
            if (node.type !== 'taskItem' || !node.attrs) return;

            const taskId = node.attrs.id || id();
            const isDayBreak = !!node.attrs.isDayBreak; // Strict check

            // CLEANUP: If it's a Day Break, force text to be empty in DB.
            const textContent = isDayBreak ? '' : node.content?.[0]?.text || '';

            currentIds.add(taskId);

            // Note: We aren't saving the calculated date to DB yet, per requirements.
            // When you are ready, you can grab the date from 'taskDateMap' here using taskId.
            const taskData = {
                text: textContent,
                order: index,
                indentationLevel: node.attrs.indentationLevel,
                isDayBreak: isDayBreak,
                updatedAt: new Date().toISOString(),
            };

            // Upsert task
            transactions.push(tx.tasks[taskId].update(taskData));

            // Link to series (idempotent)
            transactions.push(tx.taskSeries[seriesId].link({ tasks: taskId }));
        });

        // 2. Handle Deletions
        // Find tasks in DB that are NOT in the current editor content
        const tasksToDelete = dbTasks.filter((t) => !currentIds.has(t.id));
        tasksToDelete.forEach((t) => {
            transactions.push(tx.tasks[t.id].delete());
            transactions.push(tx.taskSeries[seriesId].unlink({ tasks: t.id }));
        });

        // 3. Update Series Metadata if needed
        transactions.push(
            tx.taskSeries[seriesId].update({
                name: taskSeriesName,
                updatedAt: new Date().toISOString(),
            })
        );

        try {
            await db.transact(transactions);
        } catch (err) {
            console.error('Save failed', err);
            toast({ title: 'Save failed', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    }, 1000);

    // --- Render ---
    if (isLoading && !hasHydrated.current) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="animate-spin" />
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto p-6 space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">Task Series Editor</h1>
                <div className="text-sm text-muted-foreground">{isSaving ? 'Saving...' : 'Saved'}</div>
            </div>

            {/* Header Inputs */}
            <div className="space-y-4 border p-4 rounded-lg bg-card">
                <div>
                    <label className="text-sm font-medium">Series Name</label>
                    <Input
                        value={taskSeriesName}
                        onChange={(e) => {
                            setTaskSeriesName(e.target.value);
                            // Trigger save manually or via effect
                        }}
                        placeholder="Math Homework..."
                    />
                </div>
                {/* Add other metadata inputs (start date, family member) here */}
            </div>

            {/* The Editor */}
            <div className="border rounded-lg bg-background shadow-sm min-h-[500px] flex flex-col">
                <div className="bg-muted/40 px-4 py-2 border-b text-xs font-medium text-muted-foreground flex">
                    <div className="w-20 text-right pr-3">Date</div>
                    <div>Task</div>
                </div>

                <TaskDateContext.Provider value={taskDateMap}>
                    <EditorContent editor={editor} />
                </TaskDateContext.Provider>
            </div>

            <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={onClose}>
                    Close
                </Button>
            </div>
        </div>
    );
};

export default TaskSeriesEditor;
