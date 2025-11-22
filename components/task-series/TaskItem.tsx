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
import { TextSelection, Plugin } from 'prosemirror-state';

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

            {/* Content Wrapper 
            FIX: Changed marginLeft to paddingLeft. 
            The node now physically occupies the indentation space, so the cursor "hits" it 
            instead of skipping it.
        */}
            <div className="flex-grow flex items-start relative">
                {/* Drag Handle */}
                <button
                    ref={dragHandleRef}
                    className="mt-1 mr-1 text-gray-400 opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing transition-opacity"
                    contentEditable={false}
                    data-drag-handle
                >
                    <GripVertical size={16} />
                </button>

                {/* Editor Content 
                Keep min-h-[1.5em] to ensure empty tasks have a targetable height 
            */}
                <div className="flex-grow min-w-0 rounded-sm px-2 py-0.5 bg-transparent min-h-[1.5em]">
                    <NodeViewContent className="outline-none min-h-[1.5em]" style={{ paddingLeft: `${indentationLevel * 2}rem` }} />
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
            Enter: () => {
                return this.editor.chain().splitBlock().updateAttributes('taskItem', { id: generateId(), isDayBreak: false }).run();
            },
            Tab: () => {
                return this.editor.commands.command(({ state, chain }) => {
                    const { selection, doc } = state;
                    const { $from } = selection;
                    const node = $from.node();

                    if (node.type.name !== 'taskItem') return false;
                    if (node.attrs.isDayBreak) return true;

                    const currentLevel: number = node.attrs.indentationLevel || 0;

                    // Find the block position for the current task
                    const blockPos = $from.before(1);
                    const resolved = doc.resolve(blockPos);
                    const parent = resolved.parent;
                    const index = resolved.index();

                    // Default: if no previous task, you can't nest (max 0)
                    let maxIndent = 0;

                    // Walk backwards to find the previous real taskItem (skip day breaks)
                    for (let i = index - 1; i >= 0; i--) {
                        const sibling = parent.child(i);
                        if (sibling.type.name === 'taskItem' && !sibling.attrs.isDayBreak) {
                            const siblingIndent = sibling.attrs.indentationLevel || 0;
                            maxIndent = siblingIndent + 1;
                            break;
                        }
                    }

                    const desiredLevel = currentLevel + 1;

                    // If trying to go deeper than allowed relative to previous sibling, do nothing
                    if (desiredLevel > maxIndent) {
                        // We still return true so the browser doesn't insert a tab character.
                        return true;
                    }

                    return chain().updateAttributes('taskItem', { indentationLevel: desiredLevel }).focus().run();
                });
            },
            'Shift-Tab': () => {
                return this.editor.commands.command(({ state, chain }) => {
                    const { selection } = state;
                    const { $from } = selection;
                    const node = $from.node();
                    if (node.type.name !== 'taskItem') return false;
                    if (node.attrs.indentationLevel > 0) {
                        return chain()
                            .updateAttributes('taskItem', { indentationLevel: node.attrs.indentationLevel - 1 })
                            .focus()
                            .run();
                    }
                    return true;
                });
            },

            // --- 1. DELETE KEYS (Day Break Management) ---
            Delete: () => {
                return this.editor.commands.command(({ state, dispatch }) => {
                    const { selection, doc } = state;
                    const { $from, empty } = selection;
                    if (!empty || $from.parentOffset !== $from.parent.content.size) return false;

                    const currentPos = $from.after(1);
                    const resolved = doc.resolve(currentPos);
                    const index = resolved.index();

                    if (index + 1 < resolved.parent.childCount) {
                        const nextNode = resolved.parent.child(index + 1);
                        if (nextNode.type.name === 'taskItem' && nextNode.attrs.isDayBreak) {
                            if (dispatch) dispatch(state.tr.delete(currentPos, currentPos + nextNode.nodeSize));
                            return true;
                        }
                    }
                    return false;
                });
            },
            Backspace: () => {
                return this.editor.commands.command(({ state, chain, dispatch }) => {
                    const { selection, doc } = state;
                    const { $from, empty } = selection;
                    if (!empty || $from.parentOffset !== 0) return false;
                    const currentNode = $from.node();
                    if (currentNode.type.name !== 'taskItem') return false;

                    // Unindent
                    if (currentNode.attrs.indentationLevel > 0) {
                        return chain()
                            .updateAttributes('taskItem', { indentationLevel: currentNode.attrs.indentationLevel - 1 })
                            .run();
                    }

                    // Delete Day Break (Always)
                    const currentPos = $from.before(1);
                    const resolvedPos = doc.resolve(currentPos);
                    const index = resolvedPos.index();
                    if (index > 0) {
                        const prevNode = resolvedPos.parent.child(index - 1);
                        if (prevNode.type.name === 'taskItem' && prevNode.attrs.isDayBreak) {
                            if (dispatch) {
                                const prevNodeStart = currentPos - prevNode.nodeSize;
                                dispatch(state.tr.delete(prevNodeStart, currentPos));
                            }
                            return true;
                        }
                    }
                    return chain().joinBackward().run();
                });
            },

            // --- 2. SMART NAVIGATION (Arrow Keys) ---
            // Handles: Stuck cursors in empty tasks AND Skipping over indented tasks
            ArrowUp: () => {
                return this.editor.commands.command(({ editor, state, view, dispatch }) => {
                    const isAtTop = view.endOfTextblock('up');
                    if (!isAtTop) return false;

                    const { selection, doc } = state;
                    const { $from, empty } = selection;
                    if (!empty) return false;

                    // 1. RETRIEVE GOAL COLUMN (The Phantom Cursor)
                    // If we are in a sequence of Up/Down presses, 'goal' holds the original X.
                    // Otherwise, we grab the current visual X.
                    const currentGoal = (selection as any).goal;
                    const currentCoords = view.coordsAtPos($from.pos);
                    const targetX = currentGoal !== undefined ? currentGoal : currentCoords.left;

                    const currentPos = $from.before(1);
                    const resolved = doc.resolve(currentPos);
                    const index = resolved.index();
                    const parent = resolved.parent;

                    // 2. Scan Backwards
                    let prevNode = null;
                    let prevPos = currentPos;

                    for (let i = index - 1; i >= 0; i--) {
                        const node = parent.child(i);
                        prevPos -= node.nodeSize;
                        if (node.type.name === 'taskItem' && !node.attrs.isDayBreak) {
                            prevNode = node;
                            break;
                        }
                    }

                    if (!prevNode) return false;

                    // 3. Project Cursor
                    let targetPos = prevPos + prevNode.nodeSize - 1; // Default fallback

                    try {
                        const nodeDOM = view.nodeDOM(prevPos) as HTMLElement;
                        if (nodeDOM) {
                            const rect = nodeDOM.getBoundingClientRect();
                            const targetY = rect.bottom - 10;
                            const posResult = view.posAtCoords({ left: targetX, top: targetY });

                            if (posResult && posResult.pos >= prevPos && posResult.pos < prevPos + prevNode.nodeSize) {
                                targetPos = posResult.pos;
                            }
                        }
                    } catch (e) {}

                    // 4. DISPATCH WITH GOAL
                    if (dispatch) {
                        const tr = state.tr;
                        // Create the new selection
                        const newSelection = TextSelection.near(doc.resolve(targetPos));
                        // PERSIST THE GOAL: Attach the original X to the new selection
                        (newSelection as any).goal = targetX;

                        tr.setSelection(newSelection);
                        tr.scrollIntoView();
                        dispatch(tr);
                        view.focus();
                    }
                    return true;
                });
            },

            ArrowDown: () => {
                return this.editor.commands.command(({ editor, state, view, dispatch }) => {
                    console.log('%c--- ARROW DOWN DEBUG START ---', 'color: cyan; font-weight: bold');

                    // 1. Check Tiptap's opinion on position
                    const isAtBottom = view.endOfTextblock('down');
                    console.log('1. view.endOfTextblock("down") returned:', isAtBottom);

                    if (!isAtBottom) {
                        console.log('%c-> Result: Returning FALSE. Letting Browser handle navigation.', 'color: orange');
                        // This means Tiptap thinks you are inside a multi-line paragraph
                        // and should move to the next line naturally.
                        return false;
                    }

                    const { selection, doc } = state;
                    const { $from, empty } = selection;
                    if (!empty) return false;

                    const currentPos = $from.before(1);
                    const currentNode = $from.node();
                    const resolved = doc.resolve(currentPos);
                    const index = resolved.index();
                    const parent = resolved.parent;

                    // 2. Goal Column Logic
                    const currentGoal = (selection as any).goal;
                    const currentCoords = view.coordsAtPos($from.pos);
                    const targetX = currentGoal !== undefined ? currentGoal : currentCoords.left;

                    console.log('2. Horizontal Goal (Target X):', targetX);
                    console.log(`   Current Node Index: ${index}`);

                    // 3. Finding Next Node
                    let nextNode = null;
                    let nextPos = currentPos + currentNode.nodeSize;

                    console.log('3. Scanning siblings...');
                    for (let i = index + 1; i < parent.childCount; i++) {
                        const node = parent.child(i);
                        console.log(`   Sibling [${i}]: Type=${node.type.name}, Break=${node.attrs.isDayBreak}, Indent=${node.attrs.indentationLevel}`);

                        if (node.type.name === 'taskItem' && !node.attrs.isDayBreak) {
                            nextNode = node;
                            break;
                        }
                        nextPos += node.nodeSize;
                    }

                    if (!nextNode) {
                        console.log('-> Result: End of document. No next node found.');
                        return false;
                    }

                    console.log(`   > FOUND Next Node at pos: ${nextPos}`);

                    // 4. Projection Calculation
                    let targetPos = nextPos + 1; // Default fallback

                    try {
                        const nodeDOM = view.nodeDOM(nextPos) as HTMLElement;
                        if (nodeDOM) {
                            const rect = nodeDOM.getBoundingClientRect();
                            const targetY = rect.top + 10; // Aim a bit inside the top
                            console.log(`4. Target Y coord: ${targetY} (Rect Top: ${rect.top})`);

                            // Check what ProseMirror finds at (TargetX, TargetY)
                            const posResult = view.posAtCoords({ left: targetX, top: targetY });
                            console.log('   posAtCoords result:', posResult);

                            if (posResult && posResult.pos >= nextPos && posResult.pos < nextPos + nextNode.nodeSize) {
                                console.log('   > HIT! Calculated position is valid.');
                                targetPos = posResult.pos;
                            } else {
                                console.log('%c   > MISS! posAtCoords landed outside the target node.', 'color: red');
                                console.log(`     Expected range: ${nextPos} to ${nextPos + nextNode.nodeSize}`);
                            }
                        } else {
                            console.log('   > nodeDOM returned null');
                        }
                    } catch (e) {
                        console.error('   > Error in projection:', e);
                    }

                    // 5. Dispatch
                    console.log(`5. DISPATCHING jump to pos: ${targetPos}`);

                    if (dispatch) {
                        const tr = state.tr;
                        const newSelection = TextSelection.near(doc.resolve(targetPos));
                        (newSelection as any).goal = targetX;
                        tr.setSelection(newSelection);
                        tr.scrollIntoView();
                        dispatch(tr);
                        view.focus();
                    }
                    return true;
                });
            },
        };
    },

    addProseMirrorPlugins() {
        return [
            new Plugin({
                appendTransaction(transactions, oldState, newState) {
                    // Only act on paste transactions
                    const didPaste = transactions.some((tr) => tr.getMeta('uiEvent') === 'paste');
                    if (!didPaste) return null;

                    const oldDoc = oldState.doc;
                    const newDoc = newState.doc;

                    // Collect IDs of all taskItems that existed *before* the paste
                    const oldIds = new Set<string>();
                    oldDoc.descendants((node) => {
                        if (node.type.name === 'taskItem' && node.attrs?.id) {
                            oldIds.add(node.attrs.id as string);
                        }
                        return false;
                    });

                    // Baseline indentation = indentation of the task where paste happened
                    let baselineIndentation = 0;
                    const { $from } = oldState.selection;
                    const pasteNode = $from.node();
                    if (pasteNode.type.name === 'taskItem') {
                        baselineIndentation = pasteNode.attrs.indentationLevel || 0;
                    }

                    let tr = newState.tr;
                    let changed = false;

                    // Go through all taskItems in the NEW doc
                    newDoc.descendants((node, pos) => {
                        if (node.type.name !== 'taskItem') return false;

                        const id = node.attrs?.id as string | undefined;
                        const isDayBreak = !!node.attrs?.isDayBreak;

                        // Skip day breaks entirely
                        if (isDayBreak) return false;

                        // If this node existed before paste, don't touch it
                        if (id && oldIds.has(id)) return false;

                        // This is a *new* taskItem (created by paste or still missing id)
                        const currentIndent = node.attrs?.indentationLevel || 0;

                        if (currentIndent !== baselineIndentation) {
                            tr = tr.setNodeMarkup(
                                pos,
                                undefined,
                                {
                                    ...node.attrs,
                                    indentationLevel: baselineIndentation,
                                },
                                node.marks
                            );
                            changed = true;
                        }

                        return false;
                    });

                    return changed ? tr : null;
                },
            }),
        ];
    },
});

export default TaskItemExtension;
