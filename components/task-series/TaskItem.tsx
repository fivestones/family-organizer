// components/task-series/TaskItem.tsx
'use client';

import React, { useRef, useEffect, useLayoutEffect } from 'react';
import { Textarea } from '@/components/ui/textarea';
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
    onPressEnter: (currentTaskId: string, currentTaskText: string, cursorPos: number) => void;
    onPaste: (currentTaskId: string, pastedText: string, currentTaskText: string) => void;
    onDelete: (taskId: string) => void;
    onIndent: (taskId: string) => void;
    onUnindent: (taskId: string) => void;
    onFocus: (taskId: string) => void; // To manage which task is "active"
    onBlur: (taskId: string) => void;
    isFocused?: boolean; // Optional: if parent manages focus state
    // Add other callbacks as needed, e.g., for opening metadata popover
    onArrowUp: (taskId: string, globalCaretX: number) => void;
    onArrowDown: (taskId: string, cursorPos: number, caretX: number) => void;
    onBackspaceEmpty: (taskId: string) => void;
    desiredVisualCursorPos: number | 'start' | 'end' | null;
    onFocusClearCursorPos: () => void;
    cursorEntryDirection?: 'up' | 'down' | null; // NEW
    onArrowLeftAtStart: (taskId: string) => void;
    onArrowRightAtEnd: (taskId: string) => void;
}

const MIRROR_ID = 'task-item-mirror-div';

/**
 * Creates or retrieves a hidden mirror div, styles it like the textarea,
 * and measures the visual line position of the cursor.
 */
function getVisualLineInfo(textarea: HTMLTextAreaElement, cursorPos: number): { currentLine: number; totalLines: number; caretLeft: number } {
    let mirror = document.getElementById(MIRROR_ID) as HTMLDivElement;
    if (!mirror) {
        mirror = document.createElement('div');
        mirror.id = MIRROR_ID;
        mirror.style.position = 'absolute';
        mirror.style.left = '-9999px';
        mirror.style.top = '0';
        mirror.style.pointerEvents = 'none';
        mirror.style.opacity = '0';
        mirror.style.visibility = 'hidden';
        document.body.appendChild(mirror);
    }

    const styles = window.getComputedStyle(textarea);
    mirror.style.width = styles.width;
    mirror.style.font = styles.font;
    mirror.style.lineHeight = styles.lineHeight;
    mirror.style.padding = styles.padding;
    mirror.style.border = styles.border;
    mirror.style.letterSpacing = styles.letterSpacing;
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.overflowWrap = 'break-word';
    mirror.style.wordBreak = 'break-word';
    mirror.style.boxSizing = styles.boxSizing;

    const text = textarea.value;
    const lineHeight = parseFloat(styles.lineHeight) || 1;

    if (text.length === 0) {
        return { currentLine: 0, totalLines: 1, caretLeft: 0 };
    }

    const textBefore = text.substring(0, cursorPos);
    const textAfter = text.substring(cursorPos);
    const caretMarker = '<span id="caret-marker" style="display: inline-block;">\u200B</span>';

    const sanitize = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br />');

    // totalLines
    mirror.innerHTML = sanitize(text) + '<span id="end-marker" style="display: inline-block;">\u200B</span>';
    const endSpan = mirror.querySelector<HTMLSpanElement>('#end-marker');
    if (!endSpan) return { currentLine: 0, totalLines: 1, caretLeft: 0 };

    const divTop = mirror.offsetTop;
    const endTop = endSpan.offsetTop;
    const totalLines = Math.max(1, Math.round((endTop - divTop) / lineHeight) + 1);

    // caret line + X
    mirror.innerHTML = sanitize(textBefore) + caretMarker + sanitize(textAfter);
    const caretSpan = mirror.querySelector<HTMLSpanElement>('#caret-marker');
    if (!caretSpan) return { currentLine: 0, totalLines, caretLeft: 0 };

    const caretTop = caretSpan.offsetTop;
    const currentLine = Math.round((caretTop - divTop) / lineHeight);
    const caretLeft = caretSpan.offsetLeft;

    return { currentLine, totalLines, caretLeft };
}

/**
 * Returns the character index where the requested visual line starts.
 * Uses getVisualLineInfo + binary search to avoid O(n^2) scanning.
 */
function getStartOfVisualLine(textarea: HTMLTextAreaElement, which: 'first' | 'last'): number {
    const text = textarea.value;
    const textLength = text.length;
    if (textLength === 0) return 0;

    // Measure total lines using caret at the end
    const { totalLines } = getVisualLineInfo(textarea, textLength);
    const targetLine = which === 'first' ? 0 : totalLines - 1;

    let low = 0;
    let high = textLength;
    let best = 0;

    // Binary search the earliest index whose caret is on targetLine
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const { currentLine } = getVisualLineInfo(textarea, mid);

        if (currentLine < targetLine) {
            // We are above the target line, move right
            low = mid + 1;
        } else {
            // We are on or below the target line. Keep track and move left.
            best = mid;
            high = mid - 1;
        }
    }

    return best;
}

function getCharIndexOnFirstLineAtX(textarea: HTMLTextAreaElement, targetX: number): number {
    const text = textarea.value;
    const textLength = text.length;
    if (textLength === 0) return 0;

    // First find the last index that is still on visual line 0
    let left = 0;
    let right = textLength;
    let lastIdxOnFirstLine = 0;

    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const { currentLine } = getVisualLineInfo(textarea, mid);

        if (currentLine === 0) {
            lastIdxOnFirstLine = mid;
            left = mid + 1; // search further right
        } else {
            right = mid - 1; // too far down
        }
    }

    // Now binary search within [0, lastIdxOnFirstLine] for the closest caretLeft to targetX
    let bestIndex = 0;
    let bestDiff = Infinity;
    left = 0;
    right = lastIdxOnFirstLine;

    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const { caretLeft } = getVisualLineInfo(textarea, mid);
        const diff = Math.abs(caretLeft - targetX);

        if (diff < bestDiff) {
            bestDiff = diff;
            bestIndex = mid;
        }

        if (caretLeft < targetX) {
            left = mid + 1;
        } else {
            right = mid - 1;
        }
    }

    return bestIndex;
}

function getCharIndexOnLastLineAtX(textarea: HTMLTextAreaElement, targetX: number): number {
    const text = textarea.value;
    const textLength = text.length;
    if (textLength === 0) return 0;

    // 1. Find the start of the last visual line
    const firstIdxOnLastLine = getStartOfVisualLine(textarea, 'last');
    const lastIdxOnLastLine = textLength; // The last line goes to the end

    // 2. Binary search within [firstIdxOnLastLine, lastIdxOnLastLine] for the closest caretLeft to targetX
    let bestIndex = firstIdxOnLastLine;
    let bestDiff = Infinity;

    // Check the start position first
    const { caretLeft: initialCaretLeft } = getVisualLineInfo(textarea, firstIdxOnLastLine);
    bestDiff = Math.abs(initialCaretLeft - targetX);

    let left = firstIdxOnLastLine;
    let right = lastIdxOnLastLine;

    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        // We only care about measurements on the last line
        const { currentLine, caretLeft } = getVisualLineInfo(textarea, mid);

        // Get targetLine (this is inefficient, 'getStartOfVisualLine' should return it)
        const { totalLines } = getVisualLineInfo(textarea, textLength);
        const targetLine = totalLines - 1;

        if (currentLine < targetLine) {
            left = mid + 1; // Should not happen if firstIdxOnLastLine is correct
            continue;
        }

        // We are on the last line (or past it, which `getVisualLineInfo` handles)
        const diff = Math.abs(caretLeft - targetX);

        if (diff < bestDiff) {
            bestDiff = diff;
            bestIndex = mid;
        }

        if (caretLeft < targetX) {
            left = mid + 1;
        } else {
            right = mid - 1;
        }
    }

    return bestIndex;
}

const TaskItem: React.FC<TaskItemProps> = ({
    task,
    onTextChange,
    onPressEnter,
    onPaste,
    onDelete,
    onIndent,
    onUnindent,
    onFocus,
    onBlur,
    isFocused,
    onArrowUp,
    onArrowDown,
    onBackspaceEmpty,
    desiredVisualCursorPos,
    indentCharEquivalent,
    onFocusClearCursorPos,
    cursorEntryDirection,
    onArrowLeftAtStart,
    onArrowRightAtEnd,
}) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Effect to clean up the mirror div on unmount
    useEffect(() => {
        return () => {
            const mirror = document.getElementById(MIRROR_ID);
            if (mirror) {
                mirror.parentNode?.removeChild(mirror);
            }
        };
    }, []); // Run once on mount to register cleanup

    useEffect(() => {
        if (isFocused && textareaRef.current) {
            const textarea = textareaRef.current;
            textarea.focus();

            if (desiredVisualCursorPos !== null) {
                let targetPos: number;

                // FIX: Handle 'start' and 'end' magic strings
                if (desiredVisualCursorPos === 'start') {
                    targetPos = 0;
                } else if (desiredVisualCursorPos === 'end') {
                    targetPos = task.text.length;

                    // FIX: Handle the pixel number case
                } else if (typeof desiredVisualCursorPos === 'number') {
                    let localX = desiredVisualCursorPos;
                    if (containerRef.current) {
                        const containerStyles = window.getComputedStyle(containerRef.current);
                        const paddingLeftPx = parseFloat(containerStyles.paddingLeft) || 0;
                        localX = desiredVisualCursorPos - paddingLeftPx;
                    }
                    if (localX < 0) localX = 0;

                    if (cursorEntryDirection === 'up') {
                        // Use the helper from the previous fix
                        targetPos = getCharIndexOnLastLineAtX(textarea, localX);
                    } else {
                        // Default to 'down' logic (first line)
                        targetPos = getCharIndexOnFirstLineAtX(textarea, localX);
                    }
                } else {
                    // Fallback
                    targetPos = 0;
                }

                const clampedPos = Math.min(Math.max(0, targetPos), task.text.length);
                textarea.setSelectionRange(clampedPos, clampedPos);

                onFocusClearCursorPos();
            }
        }
    }, [isFocused, task.text, task.indentationLevel, desiredVisualCursorPos, cursorEntryDirection, onFocusClearCursorPos]);

    // Auto-resize textarea height
    useLayoutEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto'; // Reset height
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`; // Set to scroll height
        }
    }, [task.text, task.indentationLevel]); // Re-run on text change OR indentation change

    const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        onFocus(task.id);
        const input = textareaRef.current;
        if (!input) return;

        const cursorPos = input.selectionStart ?? 0;
        const textLength = task.text.length;

        switch (event.key) {
            case 'Enter':
                event.preventDefault();
                onPressEnter(task.id, input.value || task.text, cursorPos); // Pass cursor pos
                break;
            case 'Tab':
                event.preventDefault();
                if (event.shiftKey) {
                    onUnindent(task.id);
                } else {
                    onIndent(task.id);
                }
                break;
            case 'ArrowUp': {
                // FIX: Get caretLeft
                const { currentLine, caretLeft } = getVisualLineInfo(input, cursorPos);
                if (currentLine === 0) {
                    event.preventDefault();

                    // FIX: Calculate globalCaretX, just like in ArrowDown
                    let globalCaretX = caretLeft;
                    if (containerRef.current) {
                        const containerStyles = window.getComputedStyle(containerRef.current);
                        const paddingLeftPx = parseFloat(containerStyles.paddingLeft) || 0;
                        globalCaretX += paddingLeftPx;
                    }

                    // FIX: Pass globalCaretX, not cursorPos
                    onArrowUp(task.id, globalCaretX);
                }
                // Otherwise, let the browser handle moving the cursor up within the wrapped text.
                break;
            }
            case 'ArrowDown': {
                const { currentLine: downLine, totalLines, caretLeft } = getVisualLineInfo(input, cursorPos);
                if (downLine === totalLines - 1) {
                    event.preventDefault();

                    // Compute global X = caretLeft inside textarea + container's padding-left
                    let globalCaretX = caretLeft;
                    if (containerRef.current) {
                        const containerStyles = window.getComputedStyle(containerRef.current);
                        const paddingLeftPx = parseFloat(containerStyles.paddingLeft) || 0;
                        globalCaretX += paddingLeftPx;
                    }

                    onArrowDown(task.id, cursorPos, globalCaretX); // pass global X
                }
                break;
            }
            case 'ArrowLeft':
                if (cursorPos === 0) {
                    event.preventDefault();
                    onArrowLeftAtStart(task.id);
                }
                // Allow default behavior if not at start
                break;
            case 'ArrowRight':
                if (cursorPos === textLength) {
                    event.preventDefault();
                    onArrowRightAtEnd(task.id);
                }
                // Allow default behavior if not at end
                break;
            case 'Backspace':
                if (input.value === '') {
                    event.preventDefault();
                    onBackspaceEmpty(task.id);
                }
                break;
            default:
                // Do nothing for other keys
                break;
        }
    };

    const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
        event.preventDefault();
        const pastedText = event.clipboardData.getData('text/plain');
        onPaste(task.id, pastedText, textareaRef.current?.value || task.text);
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
                ref={containerRef}
                className="task-item flex items-center group py-0.5" // group for showing icons on hover
                style={{ paddingLeft: `${task.indentationLevel * 2}rem` }} // Basic indentation
                onFocus={() => onFocus(task.id)} // Might bubble from input
                onBlurCapture={() => onBlur(task.id)} // Might bubble from input
            >
                {/* Placeholder for a drag handle eventually */}
                {/* <MoreVertical className="h-5 w-5 text-gray-400 cursor-grab mr-1 opacity-0 group-hover:opacity-100" /> */}

                <Textarea
                    ref={textareaRef}
                    rows={1}
                    value={task.text}
                    onChange={(e) => {
                        onTextChange(task.id, e.target.value);
                        // Manually trigger resize on change
                        if (textareaRef.current) {
                            textareaRef.current.style.height = 'auto';
                            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
                        }
                    }}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    onFocus={() => {
                        onFocus(task.id);
                        // Also trigger resize on focus in case content loaded weirdly
                        if (textareaRef.current) {
                            textareaRef.current.style.height = 'auto';
                            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
                        }
                    }}
                    // onBlur={() => onBlur(task.id)} // Can cause issues if focus moves to another button within the item
                    placeholder="New task..."
                    className="w-full border-none ring-0 ring-offset-0 shadow-none focus:ring-0 focus:ring-offset-0 focus:shadow-none focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:shadow-none focus-visible:outline-none bg-transparent p-0 h-auto min-h-0 leading-snug resize-none overflow-hidden"
                />
                <Button variant="ghost" size="icon" onClick={() => onDelete(task.id)} className="h-6 w-6 ml-1 opacity-0 group-hover:opacity-100">
                    <Trash2 className="h-4 w-4" />
                </Button>
            </div>
        </>
    );
};

export default TaskItem;
