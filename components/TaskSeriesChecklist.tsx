// components/TaskSeriesChecklist.tsx
import React from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Task } from '@/lib/task-scheduler';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Info } from 'lucide-react';

interface Props {
    tasks: Task[]; // These are the "Scheduled" tasks returned by getTasksForDate
    allTasks: Task[]; // The full list of tasks in the series (for context lookup)
    onToggle: (taskId: string, currentStatus: boolean) => void;
    isReadOnly?: boolean;
}

// Helper to check if a node has visible children in the current schedule
const hasScheduledChildren = (parentId: string, scheduledIds: Set<string>, allTasks: Task[]) => {
    // Look for any task in 'allTasks' that points to 'parentId' AND is in 'scheduledIds'
    return allTasks.some((t) => t.parentTask?.[0]?.id === parentId && scheduledIds.has(t.id));
};

export const TaskSeriesChecklist: React.FC<Props> = ({ tasks: scheduledTasks, allTasks, onToggle, isReadOnly }) => {
    if (!scheduledTasks || scheduledTasks.length === 0) return null;

    // 1. Build the "View Tree"
    // We need to display not just the scheduled tasks, but their parents (as headers)
    const scheduledIds = new Set(scheduledTasks.map((t) => t.id));
    const visibleNodesMap = new Map<string, Task>();

    // Add all scheduled tasks
    scheduledTasks.forEach((t) => visibleNodesMap.set(t.id, t));

    // Walk up ancestors for all scheduled tasks
    scheduledTasks.forEach((task) => {
        let current = task;
        // Safety: limit depth to avoid infinite loops if data is malformed
        let depth = 0;
        while (current.parentTask && current.parentTask.length > 0 && depth < 10) {
            const parentId = current.parentTask[0].id;
            // If parent already added, stop walking up (assuming tree is consistent)
            if (visibleNodesMap.has(parentId)) break;

            const parent = allTasks.find((t) => t.id === parentId);
            if (parent) {
                visibleNodesMap.set(parent.id, parent);
                current = parent;
            } else {
                break;
            }
            depth++;
        }
    });

    // 2. Sort visible nodes by 'order'
    const visibleNodes = Array.from(visibleNodesMap.values()).sort((a, b) => (a.order || 0) - (b.order || 0));

    // 3. Render
    return (
        <div className="mt-3 mb-2 space-y-2 relative">
            {visibleNodes.map((task) => {
                const isScheduled = scheduledIds.has(task.id);
                // It is a header if:
                // 1. It acts as a parent to other visible items (hasScheduledChildren)
                // 2. OR it isn't actually scheduled for today (it's just here for context)
                const isParentGroup = hasScheduledChildren(task.id, scheduledIds, allTasks);
                const isHeader = isParentGroup || !isScheduled;

                // Subtitle Logic: "Task X of Y"
                const parentId = task.parentTask?.[0]?.id;
                let subtitle = null;
                let breadcrumbs = '';

                if (parentId) {
                    const parent = allTasks.find((t) => t.id === parentId);
                    if (parent) {
                        breadcrumbs = parent.text;
                        // Find siblings AND filter out day breaks so they don't inflate the count
                        const siblings = allTasks
                            .filter((t) => t.parentTask?.[0]?.id === parentId && !t.isDayBreak)
                            .sort((a, b) => (a.order || 0) - (b.order || 0));
                        const index = siblings.findIndex((t) => t.id === task.id) + 1;
                        const total = siblings.length;

                        // Only show if we found the task (it wasn't filtered out as a break itself)
                        if (index > 0) {
                            subtitle = `Task ${index} of ${total}`;
                        }
                    }
                }

                // Find direct children for Metadata Popover
                const directChildren = allTasks
                    .filter((t) => t.parentTask?.[0]?.id === task.id && !t.isDayBreak)
                    .sort((a, b) => (a.order || 0) - (b.order || 0));

                // Shared Popover Content Definition to avoid duplication in JSX
                const popoverContent = (
                    <PopoverContent className="w-72 p-3 z-50" align="start" side="right">
                        <div className="space-y-3">
                            <div className="border-b pb-2">
                                <h4 className="font-medium text-sm">Task Details</h4>
                            </div>

                            <div className="space-y-1">
                                <div className="text-sm font-medium">Full Text</div>
                                <p className="text-sm text-muted-foreground bg-muted/20 p-2 rounded">{task.text || '(No text)'}</p>
                            </div>

                            <div className="text-xs text-muted-foreground space-y-1">
                                {subtitle && <div>Sequence: {subtitle}</div>}
                                {breadcrumbs && <div>Parent: {breadcrumbs}</div>}
                                <div className="font-mono text-[10px] opacity-70 mt-2">ID: {task.id.slice(0, 8)}...</div>
                            </div>

                            {/* List Children if any exist */}
                            {directChildren.length > 0 && (
                                <div className="space-y-1 border-t pt-2 mt-2">
                                    <div className="text-xs font-medium text-muted-foreground">Subtasks ({directChildren.length})</div>
                                    <ul className="text-xs text-muted-foreground space-y-1 max-h-32 overflow-y-auto">
                                        {directChildren.map((child) => (
                                            <li key={child.id} className="flex items-start gap-2">
                                                <span className="opacity-50">•</span>
                                                <span className={child.isCompleted ? 'line-through opacity-70' : ''}>{child.text}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    </PopoverContent>
                );

                return (
                    <div
                        key={task.id}
                        className={cn('flex items-start group relative pr-2', isHeader ? 'mt-4 mb-1' : 'my-1')}
                        style={{ marginLeft: `${(task.indentationLevel || 0) * 1.5}rem` }}
                    >
                        {/* Connector Lines (Optional polish, kept simple for now) */}

                        <div className="flex-grow flex items-start justify-between min-w-0">
                            {isHeader ? (
                                // --- HEADER VARIANT ---
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <div className="flex flex-col select-none cursor-pointer hover:bg-accent/50 rounded px-1 -ml-1 transition-colors">
                                            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground/80">{task.text}</span>
                                        </div>
                                    </PopoverTrigger>
                                    {popoverContent}
                                </Popover>
                            ) : (
                                // --- CHECKBOX VARIANT ---
                                <div className="flex items-start space-x-3 w-full">
                                    {/* Checkbox remains separate from Popover trigger */}
                                    <Checkbox
                                        id={`task-${task.id}`}
                                        checked={task.isCompleted}
                                        disabled={isReadOnly}
                                        onCheckedChange={() => onToggle(task.id, task.isCompleted)}
                                        className="mt-0.5 h-4 w-4 border-muted-foreground/50 data-[state=checked]:bg-primary data-[state=checked]:border-primary flex-shrink-0"
                                    />

                                    {/* Text area is the Popover Trigger */}
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <div className="flex flex-col cursor-pointer group/text">
                                                {/* Replaced 'label' with 'span' to decouple from checkbox click */}
                                                <span
                                                    className={cn(
                                                        'text-sm leading-tight select-none transition-colors hover:text-foreground/80',
                                                        // Add a subtle underline/color shift on hover to indicate interactability
                                                        'group-hover/text:underline decoration-muted-foreground/30 underline-offset-2',
                                                        task.isCompleted
                                                            ? 'text-muted-foreground line-through decoration-muted-foreground/50'
                                                            : 'text-foreground'
                                                    )}
                                                >
                                                    {task.text}
                                                </span>
                                                {subtitle && (
                                                    <span className="text-[10px] text-muted-foreground mt-0.5 group-hover/text:text-muted-foreground/80">
                                                        {subtitle}
                                                        {breadcrumbs && ` in ${breadcrumbs}`}
                                                    </span>
                                                )}
                                            </div>
                                        </PopoverTrigger>
                                        {popoverContent}
                                    </Popover>
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};
