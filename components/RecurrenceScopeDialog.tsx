'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export type RecurrenceEditScope = 'single' | 'following' | 'cancel';

interface RecurrenceScopeDialogProps {
    open: boolean;
    action: 'edit' | 'drag';
    onSelect: (scope: RecurrenceEditScope) => void;
}

export function RecurrenceScopeDialog({ open, action, onSelect }: RecurrenceScopeDialogProps) {
    const title = action === 'drag' ? 'Move Repeating Event' : 'Edit Repeating Event';
    const description =
        action === 'drag'
            ? 'Choose whether this move applies only to this occurrence, or to this and all following occurrences.'
            : 'Choose whether your changes apply only to this occurrence, or to this and all following occurrences.';

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen) {
                    onSelect('cancel');
                }
            }}
        >
            <DialogContent className="sm:max-w-[480px]">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                <DialogFooter className="gap-2 sm:justify-end">
                    <Button type="button" variant="outline" onClick={() => onSelect('cancel')}>
                        Cancel
                    </Button>
                    <Button type="button" variant="outline" onClick={() => onSelect('single')}>
                        Only this event
                    </Button>
                    <Button type="button" onClick={() => onSelect('following')}>
                        This and following events
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

