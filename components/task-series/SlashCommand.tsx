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
                editor.chain().focus().deleteRange(range).run();

                // 2. Convert the current node into a Day Break
                // We set text to empty string internally to keep things clean
                editor.commands.updateAttributes('taskItem', {
                    isDayBreak: true,
                    text: '',
                });

                // 3. Immediately create a new empty task below for flow
                editor.commands.createParagraphNear();
                const newId = generateId();
                editor.commands.splitBlock();
                editor.commands.updateAttributes('taskItem', { id: newId, isDayBreak: false });
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
