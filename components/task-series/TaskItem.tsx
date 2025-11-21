// components/task-series/TaskItem.tsx
'use client';

import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { Node, mergeAttributes } from '@tiptap/core';
import React, { useContext } from 'react';
import { GripVertical, Paperclip } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { id as generateId } from '@instantdb/react'; // Import the InstantDB ID generator

// --- Context ---
// Now stores both the visual label and the underlying date object
export const TaskDateContext = React.createContext<Record<string, { label: string; date: Date } | undefined>>({});

// --- The React Component (UI) ---
const TaskItemComponent = (props: any) => {
    const { node, updateAttributes } = props;
    const { indentationLevel, isDayBreak, id } = node.attrs;

    // Ensure every taskItem has a stable ID, even after paste.
    React.useEffect(() => {
        if (!id) {
            const newId = generateId();
            updateAttributes({ id: newId });
        }
    }, [id, updateAttributes]);

    const dateMap = useContext(TaskDateContext);

    // Safety check: If ID is missing, we can't find the date.
    const taskData = id ? dateMap[id] : undefined;
    const dateLabel = taskData?.label;

    // Handle Drag Handle Ref (Placeholder for Pragmatic Drag and Drop)
    // You would attach your draggable logic to this ref
    const dragHandleRef = React.useRef<HTMLButtonElement>(null);

    // --- RENDER LOGIC ---

    // CASE 1: DAY BREAK (Thin Line)
    if (isDayBreak) {
        return (
            <NodeViewWrapper className="group relative my-4 select-none" contentEditable={false}>
                {/* Visual Line */}
                <div className="flex items-center justify-center" contentEditable={false}>
                    <div className="h-0.5 w-full bg-border" />
                </div>

                {/* Hidden content to satisfy Tiptap structure, but invisible to user */}
                <div className="hidden">
                    <NodeViewContent />
                </div>

                {/* Delete Handle (Optional: Show a small X on hover to delete the break?) */}
                {/* For now, user can delete it by backspacing into it */}
            </NodeViewWrapper>
        );
    }

    // CASE 2: STANDARD TASK
    return (
        <NodeViewWrapper className="flex items-start group relative my-0.5">
            {/* Date Margin */}
            <div
                className={cn(
                    'w-20 flex-shrink-0 text-right pr-3 pt-1 text-xs font-medium select-none',
                    dateLabel ? 'text-muted-foreground' : 'text-transparent'
                )}
                contentEditable={false} // Make sure cursor doesn't go here
            >
                {dateLabel || '-'}
            </div>

            {/* Content Wrapper */}
            <div className="flex-grow flex items-start relative" style={{ marginLeft: `${indentationLevel * 2}rem` }}>
                {/* Drag Handle */}
                <button
                    ref={dragHandleRef}
                    className="mt-1 mr-1 text-gray-400 opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing transition-opacity"
                    contentEditable={false}
                    data-drag-handle
                >
                    <GripVertical size={16} />
                </button>

                {/* Editor Content */}
                <div className="flex-grow min-w-0 rounded-sm px-2 py-0.5 bg-transparent">
                    <NodeViewContent className="outline-none" />
                </div>

                {/* Metadata Trigger */}
                <div className="opacity-0 group-hover:opacity-100 transition-opacity ml-2" contentEditable={false}>
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6">
                                <Paperclip className="h-3 w-3" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80">
                            <div className="space-y-2">
                                <h4 className="font-medium leading-none">Attachments</h4>
                                <p className="text-sm text-muted-foreground">Metadata UI goes here.</p>
                                <div className="text-xs text-gray-400 pt-2 border-t mt-2">
                                    <div>Task ID: {id}</div>
                                    {taskData?.date && <div>Assigned Date: {taskData.date.toDateString()}</div>}
                                </div>
                            </div>
                        </PopoverContent>
                    </Popover>
                </div>
            </div>
        </NodeViewWrapper>
    );
};

// --- The TipTap Extension (Logic) ---
export const TaskItemExtension = Node.create({
    name: 'taskItem',
    group: 'block',
    content: 'text*', // Can only contain inline text (no nested blocks)

    // Define attributes that map to your DB
    addAttributes() {
        return {
            id: {
                default: null,
                // Ensure the ID is persisted to the DOM so it survives copy/paste/re-renders
                parseHTML: (element) => element.getAttribute('data-id'),
                renderHTML: (attributes) => ({ 'data-id': attributes.id }),
            },
            indentationLevel: {
                default: 0,
                keepOnSplit: true, // Inherit indentation on Enter
            },
            isDayBreak: {
                default: false,
                keepOnSplit: false,
                parseHTML: (element) => element.getAttribute('data-is-day-break') === 'true',
                renderHTML: (attributes) => {
                    return {
                        'data-is-day-break': attributes.isDayBreak,
                    };
                },
            },
        };
    },

    parseHTML() {
        return [{ tag: 'div[data-type="task-item"]' }];
    },

    renderHTML({ HTMLAttributes }) {
        return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'task-item' }), 0];
    },

    addNodeView() {
        return ReactNodeViewRenderer(TaskItemComponent);
    },

    addKeyboardShortcuts() {
        return {
            // CRITICAL FIX: When hitting Enter, generate a unique ID immediately using InstantDB's id()
            Enter: () => {
                // If we are IN a day break, Enter should create a new NORMAL task below
                // But normally Tiptap handles escaping node views well.
                return this.editor.chain().splitBlock().updateAttributes('taskItem', { id: generateId(), isDayBreak: false }).run();
            },
            Tab: () => {
                return this.editor.commands.command(({ state }) => {
                    const { selection } = state;
                    const { $from } = selection;
                    const node = $from.node();

                    if (node.type.name !== 'taskItem') return false;
                    if (node.attrs.isDayBreak) return true; // Tab does nothing on breaks
                    return this.editor.commands.updateAttributes('taskItem', {
                        indentationLevel: node.attrs.indentationLevel + 1,
                    });
                });
            },
            'Shift-Tab': () => {
                return this.editor.commands.command(({ state }) => {
                    const { selection } = state;
                    const { $from } = selection;
                    const node = $from.node();

                    if (node.type.name !== 'taskItem') return false;

                    if (node.attrs.indentationLevel > 0) {
                        return this.editor.commands.updateAttributes('taskItem', {
                            indentationLevel: node.attrs.indentationLevel - 1,
                        });
                    }
                    return true;
                });
            },

            // --- 1. FORWARD DELETE (Delete Key) ---
            Delete: () => {
                return this.editor.commands.command(({ state, dispatch }) => {
                    const { selection, doc } = state;
                    const { $from, empty } = selection;

                    if (!empty) return false;

                    // Check if we are at the END of the current task
                    if ($from.parentOffset !== $from.parent.content.size) return false;

                    const currentPos = $from.after(1);
                    const resolved = doc.resolve(currentPos);
                    const index = resolved.index();

                    // Check if the NEXT sibling exists
                    if (index + 1 < resolved.parent.childCount) {
                        const nextNode = resolved.parent.child(index + 1);

                        // If next node is a Day Break, delete it!
                        if (nextNode.type.name === 'taskItem' && nextNode.attrs.isDayBreak) {
                            if (dispatch) {
                                dispatch(state.tr.delete(currentPos, currentPos + nextNode.nodeSize));
                            }
                            return true;
                        }
                    }
                    return false; // Otherwise default behavior
                });
            },

            // --- 2. UP ARROW (Fix for Stuck Cursor) ---
            ArrowUp: () => {
                return this.editor.commands.command(({ state, editor }) => {
                    const { selection, doc } = state;
                    const { $from, empty } = selection;
                    const currentNode = $from.node();

                    // Strict check: Cursor must be collapsed
                    if (!empty) return false;

                    // FIX: Use textContent.length for a more robust check of "emptiness"
                    const isEmpty = currentNode.content.size === 0 || currentNode.textContent.length === 0;

                    // Only override behavior if we are at the start of an empty task
                    if (isEmpty && $from.parentOffset === 0) {
                        const currentPos = $from.before(1);
                        const resolved = doc.resolve(currentPos);
                        const index = resolved.index();
                        const parent = resolved.parent;

                        // Scan backwards for the nearest real task
                        let scanPos = currentPos;
                        for (let i = index - 1; i >= 0; i--) {
                            const prevNode = parent.child(i);
                            scanPos -= prevNode.nodeSize;

                            if (prevNode.type.name === 'taskItem' && !prevNode.attrs.isDayBreak) {
                                // Move cursor to the END of that previous task
                                editor.commands.setTextSelection(scanPos + prevNode.nodeSize - 1);
                                return true;
                            }
                            // Loop continues if Day Break (skipping it)
                        }
                    }

                    // If task has text, let browser handle natural "visual" navigation
                    return false;
                });
            },

            // --- 3. BACKSPACE HANDLER ---
            Backspace: () => {
                return this.editor.commands.command(({ state, chain, dispatch }) => {
                    const { selection, doc } = state;
                    const { $from, empty } = selection;

                    // 1. Only care about a collapsed cursor.
                    if (!empty) return false;

                    // 2. Only when cursor is at the start of the text within this task.
                    if ($from.parentOffset !== 0) return false;

                    const currentNode = $from.node();
                    if (currentNode.type.name !== 'taskItem') return false;

                    // A. Indentation priority
                    if (currentNode.attrs.indentationLevel > 0) {
                        return chain()
                            .updateAttributes('taskItem', {
                                indentationLevel: currentNode.attrs.indentationLevel - 1,
                            })
                            .run();
                    }

                    // B. Check Previous Sibling
                    const currentPos = $from.before(1);
                    const resolvedPos = doc.resolve(currentPos);
                    const index = resolvedPos.index();
                    const parent = resolvedPos.parent;

                    if (index > 0) {
                        const prevNode = parent.child(index - 1);

                        // C. Day Break Logic
                        if (prevNode.type.name === 'taskItem' && prevNode.attrs.isDayBreak) {
                            // UNIFIED LOGIC: If previous is Day Break, DELETE IT.
                            // It doesn't matter if current task is empty or has text.
                            if (dispatch) {
                                const prevNodeStart = currentPos - prevNode.nodeSize;
                                dispatch(state.tr.delete(prevNodeStart, currentPos));
                            }
                            return true;
                        }
                    }

                    // D. Default Merge (only if no Day Break involved)
                    return chain().joinBackward().run();
                });
            },
        };
    },
});

export default TaskItemExtension;
