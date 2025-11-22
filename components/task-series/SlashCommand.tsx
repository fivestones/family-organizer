// components/task-series/SlashCommand.tsx
'use client';

import React, { useState, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { ReactRenderer } from '@tiptap/react';
import tippy from 'tippy.js';
import { Calendar } from 'lucide-react'; // Changed from Minus to Calendar
import { id as generateId } from '@instantdb/react';

// --- The Command List Component (UI) ---
const CommandList = forwardRef((props: any, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    const selectItem = useCallback(
        (index: number) => {
            const item = props.items[index];
            if (item) {
                props.command(item);
            }
        },
        [props]
    );

    useEffect(() => {
        setSelectedIndex(0);
    }, [props.items]);

    useImperativeHandle(ref, () => ({
        onKeyDown: ({ event }: { event: KeyboardEvent }) => {
            if (event.key === 'ArrowUp') {
                setSelectedIndex((selectedIndex + props.items.length - 1) % props.items.length);
                return true;
            }
            if (event.key === 'ArrowDown') {
                setSelectedIndex((selectedIndex + 1) % props.items.length);
                return true;
            }
            if (event.key === 'Enter') {
                selectItem(selectedIndex);
                return true;
            }
            return false;
        },
    }));

    if (!props.items.length) {
        return null;
    }

    return (
        <div className="z-50 h-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md w-52 overflow-hidden">
            {props.items.map((item: any, index: number) => (
                <button
                    key={index}
                    className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none ${
                        index === selectedIndex ? 'bg-accent text-accent-foreground' : ''
                    }`}
                    onClick={() => selectItem(index)}
                >
                    <div className="flex items-center justify-center border rounded w-5 h-5 bg-background">
                        {/* The Icon */}
                        {item.icon}
                    </div>
                    <span>{item.title}</span>
                </button>
            ))}
        </div>
    );
});

CommandList.displayName = 'CommandList';

// --- The Definition of Commands ---
const getSuggestionItems = ({ query }: { query: string }) => {
    return [
        {
            title: 'Day Break',
            // Using Calendar icon so it doesn't look like a dash
            icon: <Calendar size={14} />,
            command: ({ editor, range }: any) => {
                // 1. Delete the slash command text (e.g. "/day")
                // We run this immediately so we can calculate positions on the clean text.
                editor.chain().focus().deleteRange(range).run();

                const { state } = editor;
                const { selection } = state;
                const { $from } = selection;

                // 2. Analyze the split point
                // The node containing the cursor
                const currentNode = $from.node();
                // The text content of the node (minus the slash command which we just deleted)
                const fullText = currentNode.textContent;
                // The offset within the node where the cursor sits
                const offset = $from.parentOffset;

                // --- FIX: Capture the current indentation level ---
                const currentIndent = currentNode.attrs.indentationLevel || 0;

                const textBefore = fullText.slice(0, offset);
                const textAfter = fullText.slice(offset);

                // Helper: Scan logic to find next task or create blank one
                const scanForNextTask = (startPos: number) => {
                    let scanPos = startPos;
                    let foundRealTask = false;

                    // Resolve position to find starting index in parent
                    // We use safe resolution to avoid out of bounds
                    const safePos = Math.min(scanPos, editor.state.doc.content.size);
                    const resolved = editor.state.doc.resolve(safePos);
                    const startIndex = resolved.index(0);
                    const parent = resolved.parent;

                    // Loop through siblings
                    for (let i = startIndex; i < parent.childCount; i++) {
                        const node = parent.child(i);

                        // If it's a real task, move cursor there
                        if (node.type.name === 'taskItem' && !node.attrs.isDayBreak) {
                            // Found it! Move cursor to the start of this task.
                            editor.commands.setTextSelection(scanPos + 1);
                            foundRealTask = true;
                            break;
                        }

                        // If it is a Day Break, simply add its size to our position tracker and continue loop
                        scanPos += node.nodeSize;
                    }

                    // If no real task found, create one at the very end
                    if (!foundRealTask) {
                        // Create blank task at the very end
                        editor.commands.setTextSelection(scanPos);
                        editor.commands.createParagraphNear();
                        editor.commands.splitBlock();
                        editor.commands.updateAttributes('taskItem', {
                            id: generateId(),
                            isDayBreak: false,
                            indentationLevel: 0, // New default task at end is usually 0
                            // ^ is that true?
                        });
                    }
                };

                // --- SCENARIO 1: START OF TEXT ---
                // Case: "/day Hello"
                if (!textBefore) {
                    // Convert current node to Day Break
                    const breakId = generateId();
                    editor.commands.updateAttributes('taskItem', {
                        id: breakId,
                        isDayBreak: true,
                        text: '',
                        // Day breaks typically don't visually show indent, but keeping it clean doesn't hurt
                        indentationLevel: currentIndent,
                    });

                    // If there was text after the cursor, move it to a NEW task below
                    if (textAfter) {
                        // Create new task below with the text
                        const newId = generateId();
                        // Use updated selection post-attribute change
                        const posAfterBreak = editor.state.selection.$from.after();

                        editor
                            .chain()
                            .insertContentAt(posAfterBreak, {
                                type: 'taskItem',
                                attrs: {
                                    id: newId,
                                    isDayBreak: false,
                                    // --- FIX: Apply original indent to the text that was pushed down ---
                                    indentationLevel: currentIndent,
                                },
                                content: [{ type: 'text', text: textAfter }],
                            })
                            // Move cursor to start of new task
                            .setTextSelection(posAfterBreak + 1)
                            .run();
                    } else {
                        // Empty task became break; scan for next
                        scanForNextTask(editor.state.selection.$from.after());
                    }
                    return;
                }

                // --- SCENARIO 2: MIDDLE OR END ---
                // Case: "Hello /day World" or "Hello /day"

                // A. Delete the textAfter from the current node
                if (textAfter) {
                    editor.commands.deleteRange({ from: $from.pos, to: $from.end() });
                }

                // B. Recalculate position!
                // The node has shrunk. We must get the NEW 'after' position.
                const posAfterTruncated = editor.state.selection.$from.after();

                // C. Prepare the nodes to insert
                // We always insert a Day Break.
                const nodesToInsert: any[] = [
                    {
                        type: 'taskItem',
                        attrs: {
                            id: generateId(),
                            isDayBreak: true,
                            text: '',
                            // Optional: inherit indent for the break line itself,
                            // though visual styling usually ignores it for breaks.
                            indentationLevel: currentIndent,
                        },
                    },
                ];

                if (textAfter) {
                    nodesToInsert.push({
                        type: 'taskItem',
                        attrs: {
                            id: generateId(),
                            isDayBreak: false,
                            // --- FIX: Apply original indent to the split-off text ---
                            indentationLevel: currentIndent,
                        },
                        content: [{ type: 'text', text: textAfter }],
                    });
                }

                // D. Insert Content in one go
                editor.chain().insertContentAt(posAfterTruncated, nodesToInsert).run();

                // E. Handle Cursor Placement
                if (textAfter) {
                    // Position cursor: posAfterTruncated + DayBreak(size) + 1 (inside new task)
                    // We need to calculate size of the inserted break node to be safe, usually 2 for empty block
                    // But simpler: just use node size logic or hardcoded +3 if we know the schema closely.
                    // Tiptap blocks are usually 2 tokens.
                    editor.commands.setTextSelection(posAfterTruncated + 3);
                } else {
                    // End case: We inserted just a break. Now scan for the next task.
                    // Start scanning after the new break (posAfterTruncated + 2)
                    scanForNextTask(posAfterTruncated + 2);
                }
            },
        },
    ].filter((item) => item.title.toLowerCase().startsWith(query.toLowerCase()));
};

// --- The Extension Wrapper ---
export const SlashCommand = Extension.create({
    name: 'slashCommand',

    addOptions() {
        return {
            suggestion: {
                char: '/',
                command: ({ editor, range, props }: any) => {
                    props.command({ editor, range });
                },
            },
        };
    },

    addProseMirrorPlugins() {
        return [
            Suggestion({
                editor: this.editor,
                ...this.options.suggestion,
            }),
        ];
    },
});

// --- Configuration for the Editor ---
export const slashCommandSuggestion = {
    items: getSuggestionItems,
    render: () => {
        let component: any;
        let popup: any;

        return {
            onStart: (props: any) => {
                component = new ReactRenderer(CommandList, {
                    props,
                    editor: props.editor,
                });

                if (!props.clientRect) {
                    return;
                }

                popup = tippy('body', {
                    getReferenceClientRect: props.clientRect,
                    appendTo: () => document.body,
                    content: component.element,
                    showOnCreate: true,
                    interactive: true,
                    trigger: 'manual',
                    placement: 'bottom-start',
                });
            },
            onUpdate: (props: any) => {
                component.updateProps(props);
                if (!props.clientRect) {
                    return;
                }
                popup[0].setProps({
                    getReferenceClientRect: props.clientRect,
                });
            },
            onKeyDown: (props: any) => {
                if (props.event.key === 'Escape') {
                    popup[0].hide();
                    return true;
                }
                return component.ref?.onKeyDown(props);
            },
            onExit: () => {
                popup[0].destroy();
                component.destroy();
            },
        };
    },
};
