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
                renderHTML: (attributes) => ({ 'data-is-day-break': attributes.isDayBreak }),
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

            // --- INDENT (Tab) ---
            Tab: () => {
                return this.editor.commands.command(({ state, dispatch }) => {
                    const { selection, doc } = state;
                    const { $from } = selection;
                    const currentNode = $from.node();

                    if (currentNode.type.name !== 'taskItem') return false;
                    if (currentNode.attrs.isDayBreak) return true; // Do nothing, but handle event

                    // 1. Calculate Max Indent (Validation)
                    const currentPos = $from.before(1);
                    const resolved = doc.resolve(currentPos);
                    const parent = resolved.parent;
                    const index = resolved.index();

                    // Default: if no previous task, you can't nest (max 0)
                    let maxIndent = 0;
                    // Look backwards for the "parent" of the current node to determine max indentation
                    for (let i = index - 1; i >= 0; i--) {
                        const sibling = parent.child(i);
                        if (sibling.type.name === 'taskItem' && !sibling.attrs.isDayBreak) {
                            maxIndent = sibling.attrs.indentationLevel + 1;
                            break;
                        }
                    }

                    const currentLevel = currentNode.attrs.indentationLevel;
                    if (currentLevel + 1 > maxIndent) return true; // Cannot indent further

                    if (dispatch) {
                        const tr = state.tr;

                        // 2. Update Current Node
                        tr.setNodeMarkup(currentPos, undefined, {
                            ...currentNode.attrs,
                            indentationLevel: currentLevel + 1,
                        });

                        // 3. Update Children (Subtree)
                        // Scan forward. Any node with indentation > currentLevel is a child.
                        // Stop at first node with indentation <= currentLevel.
                        let pos = currentPos + currentNode.nodeSize;

                        while (pos < doc.content.size) {
                            const node = doc.nodeAt(pos);
                            if (!node || node.type.name !== 'taskItem') break;

                            // If we hit a DayBreak or a sibling/parent, the subtree ends.
                            if (node.attrs.isDayBreak || node.attrs.indentationLevel <= currentLevel) {
                                break;
                            }

                            // It is a child -> Indent it
                            tr.setNodeMarkup(pos, undefined, {
                                ...node.attrs,
                                indentationLevel: node.attrs.indentationLevel + 1,
                            });

                            pos += node.nodeSize;
                        }

                        dispatch(tr);
                    }
                    return true;
                });
            },

            // --- OUTDENT (Shift-Tab) ---
            'Shift-Tab': () => {
                return this.editor.commands.command(({ state, dispatch }) => {
                    const { selection, doc } = state;
                    const { $from } = selection;
                    const currentNode = $from.node();

                    if (currentNode.type.name !== 'taskItem') return false;

                    const currentLevel = currentNode.attrs.indentationLevel;
                    if (currentLevel === 0) return true; // Cannot outdent further

                    if (dispatch) {
                        const currentPos = $from.before(1);
                        const tr = state.tr;

                        // 1. Update Current Node
                        tr.setNodeMarkup(currentPos, undefined, {
                            ...currentNode.attrs,
                            indentationLevel: currentLevel - 1,
                        });

                        // 2. Update Children (Subtree)
                        // Scan forward. Logic is identical to indent, but we decrement.
                        let pos = currentPos + currentNode.nodeSize;

                        while (pos < doc.content.size) {
                            const node = doc.nodeAt(pos);
                            if (!node || node.type.name !== 'taskItem') break;

                            // Stop if we hit a node that wasn't part of the subtree
                            if (node.attrs.isDayBreak || node.attrs.indentationLevel <= currentLevel) {
                                break;
                            }

                            tr.setNodeMarkup(pos, undefined, {
                                ...node.attrs,
                                indentationLevel: node.attrs.indentationLevel - 1,
                            });

                            pos += node.nodeSize;
                        }

                        dispatch(tr);
                    }
                    return true;
                });
            },

            // --- 1. DELETE KEYS (Day Break Management) ---
            Delete: () => {
                return this.editor.commands.command(({ state, dispatch, chain }) => {
                    const { selection, doc } = state;
                    const { $from, empty } = selection;

                    // 1. Check if cursor is at the END of the node
                    if (!empty || $from.parentOffset !== $from.parent.content.size) return false;

                    const currentPos = $from.before(1);
                    const resolved = doc.resolve(currentPos);
                    const index = resolved.index();
                    const currentNode = resolved.parent.child(index);

                    // Ensure we are actually in a taskItem
                    if (currentNode.type.name !== 'taskItem') return false;

                    // 2. Check if there is a Next Node to merge with
                    if (index + 1 >= resolved.parent.childCount) return false;
                    const nextNode = resolved.parent.child(index + 1);

                    // --- SCENARIO A: Next Node is a Day Break ---
                    // (Existing logic: just delete the break line)
                    if (nextNode.type.name === 'taskItem' && nextNode.attrs.isDayBreak) {
                        if (dispatch) {
                            const nextNodePos = currentPos + currentNode.nodeSize;
                            dispatch(state.tr.delete(nextNodePos, nextNodePos + nextNode.nodeSize));
                        }
                        return true;
                    }

                    // --- SCENARIO B: Next Node is a Standard Task (The Merge Logic) ---
                    if (nextNode.type.name === 'taskItem' && !nextNode.attrs.isDayBreak) {
                        // Calculate the "Pull": How much should the children move left?
                        // e.g. Current (0) - Next (1) = -1. We shift children by -1.
                        const indentDiff = currentNode.attrs.indentationLevel - nextNode.attrs.indentationLevel;

                        // Only perform complex logic if there is an indentation difference
                        // and we are specifically pulling deeper content up to a shallower level
                        if (indentDiff !== 0 && dispatch) {
                            const tr = state.tr;

                            // The position of the "Next Node"
                            const nextNodePos = currentPos + currentNode.nodeSize;

                            // Start scanning for children immediately AFTER the next node
                            let pos = nextNodePos + nextNode.nodeSize;
                            const nextNodeBaseIndent = nextNode.attrs.indentationLevel;

                            while (pos < doc.content.size) {
                                const node = doc.nodeAt(pos);
                                if (!node || node.type.name !== 'taskItem') break;

                                // STOP if we hit a node that is NOT a child of the 'nextNode'
                                // (i.e., it has the same or less indentation than the node being merged)
                                if (node.attrs.isDayBreak || node.attrs.indentationLevel <= nextNodeBaseIndent) {
                                    break;
                                }

                                // ADJUST: Apply the calculated difference
                                // Ensure we don't go below 0
                                const newLevel = Math.max(0, node.attrs.indentationLevel + indentDiff);

                                tr.setNodeMarkup(pos, undefined, {
                                    ...node.attrs,
                                    indentationLevel: newLevel,
                                });

                                pos += node.nodeSize;
                            }

                            // Apply the indentation changes first
                            dispatch(tr);
                        }

                        // Finally, perform the standard text merge (joinForward)
                        // We use the chain so it operates on the updated document state
                        return chain().joinForward().run();
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

                    // Unindent (using the Shift-Tab logic to keep children attached)
                    if (currentNode.attrs.indentationLevel > 0) {
                        // We delegate to the Shift-Tab command logic we just wrote
                        // But for simplicity, we can just run the raw chain if we don't care about children here,
                        // OR manually trigger the outdent logic.
                        // Users usually expect Backspace at start of line to Outdent AND bring children.

                        // Manually triggering outdent logic:
                        if (dispatch) {
                            const currentPos = $from.before(1);
                            const tr = state.tr;
                            const currentLevel = currentNode.attrs.indentationLevel;

                            tr.setNodeMarkup(currentPos, undefined, { ...currentNode.attrs, indentationLevel: currentLevel - 1 });

                            // Move children
                            let pos = currentPos + currentNode.nodeSize;
                            while (pos < doc.content.size) {
                                const node = doc.nodeAt(pos);
                                if (!node || node.type.name !== 'taskItem' || node.attrs.isDayBreak || node.attrs.indentationLevel <= currentLevel) break;
                                tr.setNodeMarkup(pos, undefined, { ...node.attrs, indentationLevel: node.attrs.indentationLevel - 1 });
                                pos += node.nodeSize;
                            }
                            dispatch(tr);
                        }
                        return true;
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
