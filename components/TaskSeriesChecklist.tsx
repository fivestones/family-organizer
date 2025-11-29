// components/TaskSeriesChecklist.tsx
import React from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Task } from '@/lib/task-scheduler';

interface Props {
    tasks: Task[];
    onToggle: (taskId: string, currentStatus: boolean) => void;
    isReadOnly?: boolean;
}

export const TaskSeriesChecklist: React.FC<Props> = ({ tasks, onToggle, isReadOnly }) => {
    if (!tasks || tasks.length === 0) return null;

    return (
        <div className="mt-3 ml-12 mb-2 space-y-2 relative">
            {/* Vertical line connecting tasks to parent */}
            <div className="absolute left-[-1.5rem] top-0 bottom-2 w-px bg-border/50" />

            {tasks.map((task) => (
                <div key={task.id} className="flex items-start space-x-3 group relative" style={{ marginLeft: `${(task.indentationLevel || 0) * 1.5}rem` }}>
                    {/* Horizontal connector for nested items (optional visual polish) */}
                    {(task.indentationLevel || 0) > 0 && <div className="absolute left-[-1.5rem] top-2.5 w-4 h-px bg-border/50" />}

                    <Checkbox
                        id={`task-${task.id}`}
                        checked={task.isCompleted}
                        disabled={isReadOnly}
                        onCheckedChange={() => onToggle(task.id, task.isCompleted)}
                        className="mt-0.5 h-4 w-4 border-muted-foreground/50 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                    />
                    <label
                        htmlFor={`task-${task.id}`}
                        className={cn(
                            'text-sm leading-tight peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer select-none py-0.5',
                            task.isCompleted ? 'text-muted-foreground line-through decoration-muted-foreground/50' : 'text-foreground'
                        )}
                    >
                        {task.text}
                    </label>
                </div>
            ))}
        </div>
    );
};
