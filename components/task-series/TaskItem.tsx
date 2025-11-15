// components/task-series/TaskItem.tsx
'use client';

import React, { useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { MoreVertical, Trash2, CornerDownLeft, CornerUpLeft } from 'lucide-react'; // Example icons

// Re-using UITask from TaskSeriesEditor.tsx, or define locally/import from shared types
interface UITask {
    id: string;
    text: string;
    indentationLevel: number;
    isDayBreak: boolean;
    // parentId: string | null;
}

interface TaskItemProps {
    task: UITask;
    onTextChange: (taskId: string, newText: string) => void;
    onPressEnter: (currentTaskId: string, currentTaskText: string) => void;
    onPaste: (currentTaskId: string, pastedText: string, currentTaskText: string) => void;
    onDelete: (taskId: string) => void;
    onIndent: (taskId: string) => void;
    onUnindent: (taskId: string) => void;
    onFocus: (taskId: string) => void; // To manage which task is "active"
    onBlur: (taskId: string) => void;
    isFocused?: boolean; // Optional: if parent manages focus state
    // Add other callbacks as needed, e.g., for opening metadata popover
}

const TaskItem: React.FC<TaskItemProps> = ({ task, onTextChange, onPressEnter, onPaste, onDelete, onIndent, onUnindent, onFocus, onBlur, isFocused }) => {
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isFocused && inputRef.current) {
            inputRef.current.focus();
            // Potentially move cursor to end of text if needed
            // inputRef.current.selectionStart = inputRef.current.selectionEnd = task.text.length;
        }
    }, [isFocused, task.text]);

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        onFocus(task.id); // Ensure this item is marked as focused
        if (event.key === 'Enter') {
            event.preventDefault();
            onPressEnter(task.id, inputRef.current?.value || task.text);
        } else if (event.key === 'Tab') {
            event.preventDefault();
            if (event.shiftKey) {
                onUnindent(task.id);
            } else {
                onIndent(task.id);
            }
        }
        // TODO: Handle Backspace on empty input to merge with previous or unindent
        // TODO: Handle ArrowUp / ArrowDown to navigate focus between TaskItems
    };

    const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
        event.preventDefault();
        const pastedText = event.clipboardData.getData('text/plain');
        onPaste(task.id, pastedText, inputRef.current?.value || task.text);
    };

    if (task.isDayBreak) {
        return (
            <div
                className="flex items-center py-2 text-muted-foreground"
                style={{ paddingLeft: `${task.indentationLevel * 2}rem` }} // Basic indentation
            >
                <span className="w-full border-t border-dashed border-gray-400 text-center text-xs">~ Day Break ~</span>
                {/* TODO: Add delete button for day break? */}
            </div>
        );
    }

    return (
        <>
            <div
                className="task-item flex items-center group py-0.5" // group for showing icons on hover
                style={{ paddingLeft: `${task.indentationLevel * 2}rem` }} // Basic indentation
                onFocus={() => onFocus(task.id)} // Might bubble from input
                onBlurCapture={() => onBlur(task.id)} // Might bubble from input
            >
                {/* Placeholder for a drag handle eventually */}
                {/* <MoreVertical className="h-5 w-5 text-gray-400 cursor-grab mr-1 opacity-0 group-hover:opacity-100" /> */}

                <Input
                    ref={inputRef}
                    type="text"
                    value={task.text}
                    onChange={(e) => onTextChange(task.id, e.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    onFocus={() => onFocus(task.id)}
                    // onBlur={() => onBlur(task.id)} // Can cause issues if focus moves to another button within the item
                    placeholder="New task..."
                    className="w-full border-none focus-visible:ring-0 focus:outline-none bg-transparent p-0 h-auto leading-normal" // Styling for "single textbox" look
                />
                {/* Action buttons - might be better in a popover or only on hover */}
                <Button variant="ghost" size="icon" onClick={() => onDelete(task.id)} className="h-6 w-6 ml-1 opacity-0 group-hover:opacity-100">
                    <Trash2 className="h-4 w-4" />
                </Button>
                {/* <Button variant="ghost" size="icon" onClick={() => { }} className="h-6 w-6 opacity-0 group-hover:opacity-100"> */}
                {/* <Settings className="h-4 w-4" /> */}
                {/* </Button> */}
            </div>
        </>
    );
};

export default TaskItem;
