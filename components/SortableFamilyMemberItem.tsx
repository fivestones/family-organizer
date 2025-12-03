import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { GripVertical, Edit, Trash2 } from 'lucide-react';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { DropIndicator } from '@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box';
import { type Edge, attachClosestEdge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { cn } from '@/lib/utils';
import invariant from 'tiny-invariant';

// Import types from FamilyMembersList
import CombinedBalanceDisplay from '@/components/allowance/CombinedBalanceDisplay';
import { UnitDefinition } from '@/lib/currency-utils';

interface FamilyMember {
    id: string;
    name: string;
    email?: string | null;
    photoUrls?: {
        '64'?: string;
        '320'?: string;
        '1200'?: string;
    } | null;
    order?: number | null;
}

interface SortableFamilyMemberItemProps {
    member: FamilyMember;
    index: number;
    isEditMode: boolean;
    selectedMember: string | null | 'All';
    setSelectedMember: (id: string | null | 'All') => void;
    showBalances?: boolean;
    membersBalances?: { [memberId: string]: { [currency: string]: number } };
    unitDefinitions?: UnitDefinition[];
    handleEditMember: (member: FamilyMember) => void;
    handleDeleteMember: (memberId: string) => void;
    currentUser: any; // +++ NEW PROP +++
}

type DropIndicatorEdge = Edge | null; // 'top' | 'bottom' | 'left' | 'right' | null

export const SortableFamilyMemberItem: React.FC<SortableFamilyMemberItemProps> = ({
    member,
    index,
    isEditMode,
    selectedMember,
    setSelectedMember,
    showBalances,
    membersBalances,
    unitDefinitions = [],
    handleEditMember,
    handleDeleteMember,
    currentUser, // +++ Destructure +++
}) => {
    const itemRef = useRef<HTMLDivElement>(null);
    const handleRef = useRef<HTMLButtonElement>(null);

    const [isDragging, setIsDragging] = useState(false);
    const [dropIndicatorEdge, setDropIndicatorEdge] = useState<DropIndicatorEdge>(null);

    // +++ Permission Checks +++
    const isParent = currentUser?.role === 'parent';
    const isSelf = currentUser?.id === member.id;

    // Only parents can reorder/delete.
    // Parents can edit anyone. Children can only edit themselves.
    const canDrag = isEditMode && isParent;
    const canEdit = isEditMode && (isParent || isSelf);
    const canDelete = isEditMode && isParent;

    // Register the element as draggable and a drop target only if allowed
    useEffect(() => {
        if (!canDrag) {
            // If cannot drag, do not register dnd listeners
            return;
        }

        invariant(itemRef.current);
        invariant(handleRef.current);

        const element = itemRef.current;
        const dragHandle = handleRef.current;

        const cleanupDraggable = draggable({
            element: element,
            dragHandle: dragHandle, // Use the specific handle for dragging
            getInitialData: () => ({ memberId: member.id, index }),
            onDragStart: () => setIsDragging(true),
            onDrop: () => setIsDragging(false),
        });

        const cleanupDropTarget = dropTargetForElements({
            element,
            getIsSticky: () => true,
            getData: ({ input, element }) => {
                // Attach closest edge info (top/bottom) to our data
                const data = { memberId: member.id, index };
                return attachClosestEdge(data, {
                    input,
                    element,
                    allowedEdges: ['top', 'bottom'],
                });
            },
            onDrag({ self }) {
                // Read closest edge from the hitbox data and drive the DropIndicator
                const closestEdge = extractClosestEdge(self.data) as DropIndicatorEdge;
                setDropIndicatorEdge(closestEdge);
            },
            onDragLeave() {
                setDropIndicatorEdge(null);
            },
            onDrop() {
                setDropIndicatorEdge(null);
            },
        });

        // Return cleanup function
        return () => {
            cleanupDraggable();
            cleanupDropTarget();
        };
    }, [canDrag, member.id, index]); // Re-run if drag permission changes

    const memberBalance = showBalances ? membersBalances?.[member.id] : null;
    const hasBalanceData = !!memberBalance && Object.keys(memberBalance).length > 0;

    return (
        <div ref={itemRef} style={{ opacity: isDragging ? 0.4 : 1 }} className="relative">
            {/* Show drop indicator when an item is dragged over this one */}
            {dropIndicatorEdge === 'top' && <DropIndicator edge="top" />}

            <div className="flex items-center mb-2">
                {/* Drag Handle (visible only if permission allowed) */}
                {canDrag && (
                    <Button ref={handleRef} variant="ghost" size="icon" className="cursor-grab" aria-label={`Reorder ${member.name}`}>
                        <GripVertical className="h-4 w-4" />
                    </Button>
                )}

                {/* If edit mode is on but user can't drag (e.g. child), add some spacing so avatars stay aligned 
                    only if the parent view had a grip there. 
                    Actually, it's cleaner to just not render the grip and let them align to the left. 
                    But if you want alignment with parent view, you might add a spacer. 
                    For now, I'll leave it as collapsing to the left. */}

                {/* Main Member Button */}
                <div className="flex-grow mr-2">
                    <Button
                        variant={selectedMember === member.id ? 'default' : 'ghost'}
                        className="w-full justify-start text-left h-auto py-2"
                        onClick={() => setSelectedMember(member.id)}
                        disabled={isEditMode} // Disable clicking when in edit mode
                    >
                        <div className="flex items-center space-x-3 flex-grow">
                            <Avatar className="h-10 w-10 flex-shrink-0">
                                {member.photoUrls ? (
                                    <AvatarImage src={'uploads/' + member.photoUrls['64']} alt={member.name} />
                                ) : (
                                    <AvatarFallback>
                                        {member.name
                                            .split(' ')
                                            .map((n) => n[0])
                                            .join('')
                                            .toUpperCase()}
                                    </AvatarFallback>
                                )}
                            </Avatar>
                            <span className="flex-grow font-medium">{member.name}</span>
                            {/* Balance Display */}
                            {showBalances && hasBalanceData && (
                                <div className="ml-auto pl-2 flex-shrink-0 text-xs">
                                    <CombinedBalanceDisplay
                                        totalBalances={memberBalance!}
                                        unitDefinitions={unitDefinitions}
                                        showCombinedBalance={false}
                                        isLoading={false}
                                        className="text-right"
                                    />
                                </div>
                            )}
                            {showBalances && !hasBalanceData && (
                                <div className="ml-auto pl-2 flex-shrink-0 text-xs text-muted-foreground italic">No balance</div>
                            )}
                        </div>
                    </Button>
                </div>
                {/* Edit/Delete Buttons (visible only based on permission) */}

                {/* Edit Button */}
                {canEdit ? (
                    <Button variant="ghost" size="icon" onClick={() => handleEditMember(member)}>
                        <Edit className="h-4 w-4" />
                    </Button>
                ) : isEditMode ? // Placeholder to keep alignment if needed, or simply render nothing.
                // Rendering nothing is cleaner for restricted views.
                null : null}

                {/* Delete Button */}
                {canDelete && (
                    <Button variant="ghost" size="icon" onClick={() => handleDeleteMember(member.id)}>
                        <Trash2 className="h-4 w-4" />
                    </Button>
                )}
            </div>

            {/* Show drop indicator at the bottom */}
            {dropIndicatorEdge === 'bottom' && <DropIndicator edge="bottom" />}
        </div>
    );
};
