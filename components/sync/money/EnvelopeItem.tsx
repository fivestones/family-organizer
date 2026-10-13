'use client';

import React, { useMemo } from 'react';
import { ArrowRightLeft, Edit, Target, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import type { Envelope, ExchangeRate, UnitDefinition } from '@/lib/data';
import { goalProgress } from '@/lib/money';
import { formatBalances } from '@/lib/money-format';

interface EnvelopeItemProps {
    envelope: Envelope;
    /** The only envelope a member has cannot be deleted. */
    isLastEnvelope: boolean;
    unitDefinitions: UnitDefinition[];
    rates: ExchangeRate[];
    onEdit: (envelopeId: string) => void;
    onTransfer: (sourceEnvelopeId: string) => void;
    onDelete: (envelopeId: string) => void;
}

/** One envelope: what it holds, how far it is towards its goal, and what can be done with it. */
export default function EnvelopeItem({ envelope, isLastEnvelope, unitDefinitions, rates, onEdit, onTransfer, onDelete }: EnvelopeItemProps) {
    const hasGoal = Boolean(envelope.goalAmount && envelope.goalCurrency);
    const progress = useMemo(() => (hasGoal ? goalProgress(envelope, unitDefinitions, rates) : null), [hasGoal, envelope, unitDefinitions, rates]);

    return (
        <Card className="mb-4 shadow-sm transition-shadow hover:shadow-md" data-testid="envelope" data-envelope-id={envelope.id}>
            <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div>
                    <CardTitle className="flex items-center text-lg font-semibold">
                        {envelope.name}
                        {envelope.isDefault && <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-xs font-normal text-muted-foreground">Default</span>}
                    </CardTitle>
                </div>
            </CardHeader>
            <CardContent className="space-y-2 pb-4">
                <p className="text-sm text-muted-foreground">
                    Balance: <span className="font-medium text-foreground" data-testid="envelope-balance">{formatBalances(envelope.balances, unitDefinitions)}</span>
                </p>

                {hasGoal && progress && (
                    <div className="mt-2 border-t pt-2 text-sm">
                        <p className="flex items-center text-muted-foreground">
                            <Target className="mr-1.5 h-4 w-4 shrink-0" />
                            Goal: <span className="ml-1 font-medium text-foreground">{formatBalances({ [envelope.goalCurrency!]: envelope.goalAmount! }, unitDefinitions)}</span>
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                            Progress: <span className="font-medium text-foreground">{progress.percentage !== null ? `${progress.percentage.toFixed(1)}%` : 'N/A'}</span>
                            {progress.totalValueInGoalCurrency !== null && ` (${formatBalances({ [envelope.goalCurrency!]: progress.totalValueInGoalCurrency }, unitDefinitions)} of goal)`}
                        </p>
                        {progress.errors.length > 0 && <p className="mt-1 text-xs text-destructive">{progress.errors.join(' ')}</p>}
                    </div>
                )}
            </CardContent>
            <CardFooter className="flex justify-end space-x-2">
                <Button variant="outline" size="sm" onClick={() => onEdit(envelope.id)} aria-label={`Edit ${envelope.name} envelope`}>
                    <Edit className="mr-1 h-4 w-4" /> Edit
                </Button>
                <Button variant="outline" size="sm" onClick={() => onTransfer(envelope.id)} aria-label={`Transfer funds from ${envelope.name} envelope`}>
                    <ArrowRightLeft className="mr-1 h-4 w-4" /> Transfer
                </Button>
                <Button variant="destructive" size="sm" onClick={() => onDelete(envelope.id)} disabled={isLastEnvelope} aria-label={`Delete ${envelope.name} envelope`}>
                    <Trash2 className="mr-1 h-4 w-4" /> Delete
                </Button>
            </CardFooter>
        </Card>
    );
}
