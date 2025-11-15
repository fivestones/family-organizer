// app/allowance-distribution/page.tsx
'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { init, tx, id } from '@instantdb/react';
import { RRule, RRuleSet } from 'rrule'; // Keep RRule import if needed for other logic
import { format, startOfDay, endOfDay, isBefore, isEqual, addDays } from 'date-fns'; // For formatting dates

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Loader2, CheckCircle, XCircle, DollarSign, TrendingDown, Edit, Info, CalendarIcon } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { formatBalances, UnitDefinition, Envelope, findOrDefaultEnvelope, executeAllowanceTransaction } from '@/lib/currency-utils';
import {
    createRRuleWithStartDate,
    getAllowancePeriodForDate,
    calculatePeriodDetails,
    markCompletionsAwarded,
    toUTCDate,
    Chore,
    ChoreCompletion,
} from '@/lib/chore-utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';

// --- Component Types ---

// Interface matching the return type of calculatePeriodDetails from chore-utils
interface CalculatedPeriod {
    id: string;
    familyMemberId: string;
    periodStartDate: Date;
    periodEndDate: Date;
    totalWeight: number;
    completedWeight: number;
    percentage: number;
    calculatedAmount: number; // Weight-based amount
    lastCalculatedAt: Date;
    isStale: boolean;
    status?: 'pending' | 'calculated' | 'skipped' | 'distributed' | 'in-progress';
    completionsToMark: string[];
    // +++ Add fixed rewards +++
    fixedRewardsEarned: { [currency: string]: number };
    // +++ Add contribution percentage field +++
    upForGrabsContributionPercentage: number;
}

// Adjust based on full FamilyMember type if defined elsewhere
interface FamilyMemberWithAllowance extends Record<string, any> {
    id: string;
    name?: string;
    allowanceAmount?: number | null;
    allowanceCurrency?: string | null;
    allowanceRrule?: string | null;
    allowanceStartDate?: string | null; // Expect ISO string from DB
    allowanceEnvelopes?: Envelope[];
    // Link added for fetching last awarded completion
    completedChores?: ChoreCompletion[];
    // Added field from schema
    allowancePayoutDelayDays?: number | null;
}

interface MemberAllowanceInfo {
    member: FamilyMemberWithAllowance;
    pendingPeriods: CalculatedPeriod[]; // Includes pending AND in-progress
    totalDue: number; // Combined total (weight-based + same-currency fixed)
    // +++ Add storage for fixed rewards +++
    totalFixedRewardsInPrimaryCurrency: number;
    totalFixedRewardsInOtherCurrencies: { [currency: string]: number };
}

interface EditableAmounts {
    [memberId: string]: string;
}

// +++ NEW STATE: Store editable amounts per period +++
interface EditablePeriodAmounts {
    [periodId: string]: string;
}

// --- DB Initialization ---
const APP_ID = process.env.NEXT_PUBLIC_INSTANT_APP_ID || 'df733414-7ccd-45bd-85f3-ffd0b3da8812';
const db = init({
    appId: APP_ID,
    apiURI: process.env.NEXT_PUBLIC_INSTANT_API_URI || 'http://localhost:8888',
    websocketURI: process.env.NEXT_PUBLIC_INSTANT_WEBSOCKET_URI || 'ws://localhost:8888/runtime/session',
});

// --- Component ---

export default function AllowanceDistributionPage() {
    const { toast } = useToast();
    const [isLoading, setIsLoading] = useState(true); // Overall processing state
    const [error, setError] = useState<Error | null>(null);
    // State still holds only members WITH pending periods after processing
    const [processedAllowances, setProcessedAllowances] = useState<MemberAllowanceInfo[]>([]);
    const [editableAmounts, setEditableAmounts] = useState<EditableAmounts>({});
    const [processingMemberId, setProcessingMemberId] = useState<string | null>(null); // Track processing state for specific member actions
    const [simulatedDate, setSimulatedDate] = useState<Date>(() => startOfDay(new Date()));

    // +++ NEW STATE: Add state for editable period amounts +++
    const [editablePeriodAmounts, setEditablePeriodAmounts] = useState<EditablePeriodAmounts>({});

    // --- Data Fetching ---
    // Fetch necessary data for calculations
    const {
        isLoading: isDataLoading,
        error: dataError,
        data,
    } = db.useQuery({
        familyMembers: {
            allowanceEnvelopes: {},
            completedChores: {
                $: {
                    where: {
                        allowanceAwarded: true,
                    },
                },
            },
        },
        choreCompletions: {
            $: {
                where: {
                    allowanceAwarded: false,
                },
            },
            chore: {},
            completedBy: {},
        },
        chores: {
            assignees: {},
            assignments: {
                familyMember: {},
            },
        },
        unitDefinitions: {},
        allowanceEnvelopes: {
            familyMember: {},
        },
    });

    // Type assertion for fetched data
    const typedData = data as
        | {
              familyMembers: FamilyMemberWithAllowance[];
              choreCompletions: ChoreCompletion[];
              chores: Chore[];
              unitDefinitions: UnitDefinition[];
              allowanceEnvelopes: Envelope[];
          }
        | undefined;

    // --- Calculation and Processing Logic ---
    const processAllowanceData = useCallback(
        async (currentSimulatedDate: Date) => {
            if (isDataLoading || !typedData) {
                console.log('Data still loading or not available for processing.');
                return;
            }
            setIsLoading(true);
            setError(null);

            const { familyMembers, choreCompletions: allUnawardedCompletions, chores, unitDefinitions, allowanceEnvelopes } = typedData;
            const results: MemberAllowanceInfo[] = [];
            const newEditableAmounts: EditableAmounts = {};
            // +++ NEW: Reset period amounts on each process run +++
            const newEditablePeriodAmounts: EditablePeriodAmounts = {};

            try {
                for (const member of familyMembers) {
                    // Skip members without necessary allowance configuration
                    if (!member.allowanceRrule || !member.allowanceStartDate || !member.allowanceAmount || !member.allowanceCurrency) {
                        continue;
                    }

                    const allowanceStartDate = toUTCDate(member.allowanceStartDate); // Ensure UTC start
                    const rule = createRRuleWithStartDate(member.allowanceRrule, allowanceStartDate);
                    if (!rule) {
                        console.warn(`Invalid RRULE for member ${member.id}`);
                        continue;
                    }
                    const delayDays = member.allowancePayoutDelayDays ?? 0; // Get delay days

                    // 1. Determine the date to start searching for relevant periods
                    const lastAwardedCompletion = member.completedChores?.[0];
                    let searchStartDate: Date = allowanceStartDate; // Default to allowance start

                    if (lastAwardedCompletion && lastAwardedCompletion.dateDue) {
                        const lastAwardedDate = toUTCDate(lastAwardedCompletion.dateDue);
                        // Find the *allowance period* the last awarded completion fell into
                        // Note: getAllowancePeriodForDate should correctly use the rule occurrences now
                        const lastAwardedPeriod = getAllowancePeriodForDate(lastAwardedDate, member.allowanceRrule, allowanceStartDate);
                        if (lastAwardedPeriod) {
                            // Start searching for the *next* period boundary after the last processed one ended
                            searchStartDate = addDays(lastAwardedPeriod.endDate, 1);
                        }
                    }

                    // 2. Generate relevant RRULE occurrences (period boundaries)
                    const rruleSet = new RRuleSet();
                    rruleSet.rrule(rule);

                    // Add allowanceStartDate as a potential boundary if it's not already an occurrence
                    // and if our search needs to start there.
                    // This ensures the very first period starts correctly.
                    rruleSet.rdate(allowanceStartDate);

                    // Generate occurrences from the allowance start up to a bit past the simulated date + delay
                    // to ensure we capture the end boundary of the current or last relevant period.
                    const futureBuffer = addDays(currentSimulatedDate, Math.max(7, delayDays + 1)); // Look ahead a bit
                    const occurrences = rruleSet.between(
                        allowanceStartDate, // Always start from the absolute beginning for boundary finding
                        toUTCDate(futureBuffer), // Look into the future
                        true // inc=true
                    );

                    // Ensure occurrences are sorted and unique, and include the effective start date implicitly via allowanceStartDate
                    let periodBoundaries = [...occurrences] // Start with generated occurrences
                        .map((d) => toUTCDate(d).getTime()) // Convert to milliseconds for unique check
                        .filter((value, index, self) => self.indexOf(value) === index) // Get unique timestamps
                        .map((ts) => new Date(ts)) // Convert back to Date objects
                        .sort((a, b) => a.getTime() - b.getTime()); // Sort chronologically

                    // Prepend allowanceStartDate if it's not the first boundary already
                    if (periodBoundaries.length === 0 || periodBoundaries[0].getTime() > allowanceStartDate.getTime()) {
                        periodBoundaries.unshift(allowanceStartDate);
                    }

                    const memberPendingPeriods: CalculatedPeriod[] = [];
                    const memberUnawardedCompletions = allUnawardedCompletions.filter((c: any) => c.completedBy?.[0]?.id === member.id);

                    // 3. Iterate through boundaries to define periods
                    for (let i = 0; i < periodBoundaries.length; i++) {
                        let periodStartDate = periodBoundaries[i];
                        // The next boundary defines the end of the *current* period.
                        const nextBoundary = periodBoundaries[i + 1];

                        // If there's no next boundary, we can't define the end yet.
                        if (!nextBoundary && periodBoundaries.length > 0) {
                            // If only one boundary (start date), need to calc potential end based on rule
                            // This case might need refinement depending on desired behavior for single-occurrence rules
                            console.log(`Only one boundary found (${periodStartDate.toISOString()}), cannot define end for member ${member.id}`);
                            break;
                        }
                        if (!nextBoundary) break; // Exit if no next boundary

                        // Period ends the day BEFORE the next boundary.
                        const periodEndDate = addDays(nextBoundary, -1);

                        // Skip periods that entirely finished before our searchStartDate logic needs adjustment
                        // We need to *generate* all periods from start, but only consider *processing* those ending after searchStartDate
                        if (periodEndDate < searchStartDate) {
                            continue;
                        }

                        // Ensure start date is not after end date (can happen with boundary logic)
                        if (periodStartDate > periodEndDate) {
                            console.warn('Calculated period start date is after end date, adjusting start.', {
                                periodStartDate,
                                periodEndDate,
                            });
                            periodStartDate = periodEndDate; // Adjust for single day period if needed
                        }

                        // Filter completions for THIS specific period
                        const periodStartMillis = periodStartDate.getTime();
                        const periodEndMillis = addDays(periodEndDate, 1).getTime(); // Use day *after* end date for comparison

                        const completionsForThisPeriod = memberUnawardedCompletions.filter((comp) => {
                            if (!comp.dateDue) return false;
                            const dueMillis = toUTCDate(comp.dateDue).getTime();
                            // Completion due date must be >= period start AND < day after period end
                            return dueMillis >= periodStartMillis && dueMillis < periodEndMillis;
                        });

                        // Calculate details
                        const details = await calculatePeriodDetails(
                            db,
                            member.id,
                            periodStartDate,
                            periodEndDate,
                            member.allowanceAmount,
                            chores,
                            completionsForThisPeriod
                        );

                        if (details) {
                            // Determine payout due date and status
                            const payoutDueDate = addDays(periodEndDate, delayDays);
                            const isDue = isBefore(payoutDueDate, currentSimulatedDate) || isEqual(payoutDueDate, currentSimulatedDate);
                            // Check if simulated date falls within the period (inclusive start, inclusive end)
                            const isInProgress =
                                (isBefore(periodStartDate, currentSimulatedDate) || isEqual(periodStartDate, currentSimulatedDate)) &&
                                isBefore(currentSimulatedDate, addDays(periodEndDate, 1));

                            if (isInProgress && !isDue) {
                                // If it's currently in progress AND not yet due for payout
                                details.status = 'in-progress';
                            } else if (isDue) {
                                // If the payout due date has passed or is today
                                details.status = 'pending'; // Mark as pending payout calculation/action
                            } else {
                                // Period ends in the future and payout isn't due yet - skip display for now
                                continue;
                            }

                            memberPendingPeriods.push(details);
                        }
                    } // End loop through boundaries

                    if (memberPendingPeriods.length > 0) {
                        // No need to sort again if boundaries were sorted

                        // +++ FILTERING STEP: Remove periods that are 'pending' but have no unawarded completions +++
                        const displayablePeriods = memberPendingPeriods.filter((p) => {
                            // Always keep 'in-progress' periods for display
                            if (p.status === 'in-progress') return true;
                            // Keep 'pending' periods ONLY if they still have completions to mark OR fixed rewards earned
                            if (p.status === 'pending' && (p.completionsToMark.length > 0 || Object.keys(p.fixedRewardsEarned || {}).length > 0)) return true;
                            // Filter out 'pending' periods with no work done
                            return false;
                        });

                        // +++ Proceed only if there are displayable periods left +++
                        if (displayablePeriods.length > 0) {
                            // +++ Populate initial editable period amounts ONLY for displayable periods +++
                            displayablePeriods.forEach((p) => {
                                // Populate for pending or in-progress
                                if (p.status === 'pending' || p.status === 'in-progress') {
                                    newEditablePeriodAmounts[p.id] = String(p.calculatedAmount.toFixed(2));
                                }
                            });

                            // +++ Calculate totalDue including same-currency fixed rewards +++
                            let totalCalculatedAmountDue = 0;
                            const aggregatedFixedRewards: {
                                [currency: string]: number;
                            } = {};
                            displayablePeriods
                                .filter((p) => p.status === 'pending') // Only sum pending ones
                                .forEach((p) => {
                                    totalCalculatedAmountDue += p.calculatedAmount; // Sum weight-based part
                                    // Aggregate fixed rewards
                                    for (const [currency, amount] of Object.entries(p.fixedRewardsEarned || {})) {
                                        aggregatedFixedRewards[currency] = (aggregatedFixedRewards[currency] || 0) + amount;
                                    }
                                });

                            const primaryCurrency = member.allowanceCurrency?.toUpperCase();
                            const totalFixedPrimary = primaryCurrency ? aggregatedFixedRewards[primaryCurrency] || 0 : 0;
                            const totalFixedOther: {
                                [currency: string]: number;
                            } = {};
                            for (const [currency, amount] of Object.entries(aggregatedFixedRewards)) {
                                if (currency !== primaryCurrency) {
                                    totalFixedOther[currency] = amount;
                                }
                            }

                            const finalTotalDue = totalCalculatedAmountDue + totalFixedPrimary;

                            // +++ Push filtered periods and calculated totals to results +++
                            results.push({
                                member,
                                pendingPeriods: displayablePeriods,
                                totalDue: finalTotalDue, // Total including primary fixed rewards
                                totalFixedRewardsInPrimaryCurrency: totalFixedPrimary,
                                totalFixedRewardsInOtherCurrencies: totalFixedOther,
                            });
                            // Editable amount in footer reflects the combined total
                            newEditableAmounts[member.id] = String(finalTotalDue.toFixed(2));
                        } // End check for displayable periods length
                    }
                } // End loop through members

                // +++ Update state variables (editablePeriodAmounts should now only contain entries for displayable periods) +++

                setProcessedAllowances(results);
                setEditableAmounts(newEditableAmounts);
                setEditablePeriodAmounts(newEditablePeriodAmounts);
            } catch (e: any) {
                console.error('Error processing allowance data:', e);
                setError(e);
                toast({
                    title: 'Error Calculating Allowances',
                    description: e.message,
                    variant: 'destructive',
                });
            } finally {
                setIsLoading(false);
            }
        },
        [isDataLoading, typedData, db, toast]
    ); // Dependencies

    // Trigger processing when fetched data changes OR simulatedDate changes
    useEffect(() => {
        if (!isDataLoading && typedData) {
            processAllowanceData(simulatedDate); // Pass the simulated date
        }
        if (dataError) {
            setError(dataError);
            setIsLoading(false);
        }
    }, [isDataLoading, typedData, dataError, processAllowanceData, simulatedDate]);

    // --- Event Handlers --- (Keep existing: handleAmountChange, handleSkipPeriod, handleDepositWithdraw)
    const handleAmountChange = (memberId: string, value: string) => {
        setEditableAmounts((prev) => ({ ...prev, [memberId]: value }));
    };

    const handleSkipPeriod = async (memberId: string, period: CalculatedPeriod) => {
        setProcessingMemberId(memberId);
        try {
            await markCompletionsAwarded(db, period.completionsToMark);
            toast({
                title: 'Period Skipped',
                description: `Allowance period ending ${format(period.periodEndDate, 'yyyy-MM-dd')} marked as skipped.`,
            });
            //   await processAllowanceData(simulatedDate); // This was causing a race condition I think
        } catch (err: any) {
            console.error('Error skipping period:', err);
            toast({
                title: 'Error Skipping Period',
                description: err.message,
                variant: 'destructive',
            });
        } finally {
            setProcessingMemberId(null);
        }
    };

    // +++ NEW: Handler for individual period amount changes +++
    const handlePeriodAmountChange = (periodId: string, memberId: string, value: string) => {
        setEditablePeriodAmounts((prev) => ({ ...prev, [periodId]: value }));

        // Recalculate totalDue for the footer based on the new period amounts
        setEditableAmounts((prevTotalAmounts) => {
            const allowanceInfo = processedAllowances.find((pa) => pa.member.id === memberId);
            if (!allowanceInfo) return prevTotalAmounts; // Should not happen

            // +++ This needs adjustment: totalDue should include fixed rewards, but fixed rewards aren't editable per period.
            // The editable part is only the 'calculatedAmount' (weight-based).
            // We should recalculate the *display* total based on edited period amounts + fixed rewards.

            const newTotalCalculatedAmount = allowanceInfo.pendingPeriods
                .filter((p) => p.status === 'pending') // Only sum pending periods
                .reduce((sum, p) => {
                    // Use the updated amount for the changed period, or existing for others
                    // This represents the weight-based part only
                    const amountString = p.id === periodId ? value : editablePeriodAmounts[p.id];
                    const amount = parseFloat(amountString || '0');
                    return sum + (isNaN(amount) ? 0 : amount);
                }, 0);

            // Re-add the non-editable fixed rewards for the final display total
            const newFinalTotalDue = newTotalCalculatedAmount + allowanceInfo.totalFixedRewardsInPrimaryCurrency;

            return {
                ...prevTotalAmounts,
                [memberId]: String(newFinalTotalDue.toFixed(2)),
            };
        });
    };

    // +++ NEW: Handler for depositing/withdrawing a single period +++
    const handleDepositWithdrawPeriod = async (memberId: string, period: CalculatedPeriod) => {
        setProcessingMemberId(memberId); // Use member ID to disable all buttons for that member

        // The amount being deposited/withdrawn for a *single* period should be the editable weight-based amount
        // PLUS any fixed rewards earned *in that specific period*.
        const editableAmountString = editablePeriodAmounts[period.id];
        const editableAmount = parseFloat(editableAmountString);
        if (isNaN(editableAmount)) {
            toast({
                title: 'Invalid Amount',
                description: "Please enter a valid number for the period's calculated amount.",
                variant: 'destructive',
            });
            setProcessingMemberId(null);
            return;
        }

        const member = processedAllowances.find((pa) => pa.member.id === memberId)?.member;
        if (!member) {
            toast({
                title: 'Error',
                description: 'Could not find member data.',
                variant: 'destructive',
            });
            setProcessingMemberId(null);
            return;
        }
        const primaryCurrency = member.allowanceCurrency;
        if (!primaryCurrency) {
            toast({
                title: 'Missing Configuration',
                description: 'Allowance currency is not set for this member.',
                variant: 'destructive',
            });
            setProcessingMemberId(null);
            return;
        }

        // Calculate total for this period including fixed rewards in primary currency
        const fixedRewardThisPeriodPrimary = period.fixedRewardsEarned?.[primaryCurrency.toUpperCase()] || 0;
        const finalPeriodTotal = editableAmount + fixedRewardThisPeriodPrimary;

        // Note: Fixed rewards in other currencies are ignored for this primary currency transaction.
        // They are displayed separately but not included in the main deposit/withdraw action here.

        // Only mark completions for THIS specific period
        const completionIdsToMark = period.completionsToMark;
        const description = `Allowance distribution for period ending ${format(period.periodEndDate, 'yyyy-MM-dd')}`;

        try {
            const memberEnvelopes = typedData?.allowanceEnvelopes?.filter((e) => e.familyMember?.[0]?.id === memberId) || [];
            // Use the calculated finalPeriodTotal for the transaction
            await executeAllowanceTransaction(db, memberId, memberEnvelopes, finalPeriodTotal, primaryCurrency, description);
            await markCompletionsAwarded(db, completionIdsToMark); // Mark only this period's completions

            toast({
                title: finalPeriodTotal >= 0 ? 'Period Deposited' : 'Period Withdrawn',
                description: `${formatBalances({ [primaryCurrency]: Math.abs(finalPeriodTotal) }, typedData?.unitDefinitions || [])} for period ending ${format(
                    period.periodEndDate,
                    'yyyy-MM-dd'
                )} processed.`,
            });
            //  await processAllowanceData(simulatedDate); // Refresh data // This was causing a race condition I think, making an amount show even after a deposit.
        } catch (err: any) {
            console.error('Error processing period deposit/withdrawal:', err);
            toast({
                title: 'Period Processing Failed',
                description: err.message,
                variant: 'destructive',
            });
        } finally {
            setProcessingMemberId(null);
        }
    };

    const handleDepositWithdraw = async (memberId: string) => {
        setProcessingMemberId(memberId);

        const allowanceInfo = processedAllowances.find((pa) => pa.member.id === memberId);
        if (!allowanceInfo) {
            toast({
                title: 'Error',
                description: 'Could not find allowance data for this member.',
                variant: 'destructive',
            });
            setProcessingMemberId(null);
            return;
        }

        // +++ UPDATE: Use editablePeriodAmounts AND fixed rewards to calculate finalAmount for total deposit/withdraw +++
        // Sum the *editable* weight-based amounts first
        const totalEditableAmount = allowanceInfo.pendingPeriods
            .filter((p) => p.status === 'pending')
            .reduce((sum, p) => {
                const amountString = editablePeriodAmounts[p.id]; // Read from period state
                const amount = parseFloat(amountString || '0');
                return sum + (isNaN(amount) ? 0 : amount);
            }, 0);

        // Add the total fixed rewards in the primary currency
        const finalAmount = totalEditableAmount + allowanceInfo.totalFixedRewardsInPrimaryCurrency;

        // Ensure calculated finalAmount is used instead of relying solely on editableAmounts[memberId]
        // editableAmounts[memberId] should reflect this sum already if handlePeriodAmountChange worked correctly,
        // but recalculating here ensures accuracy at the time of deposit.
        const finalAmountString = String(finalAmount.toFixed(2)); // Use the recalculated sum

        if (isNaN(finalAmount)) {
            toast({
                title: 'Invalid Amount',
                description: 'Please enter a valid number.',
                variant: 'destructive',
            });
            setProcessingMemberId(null);
            return;
        }

        const currency = allowanceInfo.member.allowanceCurrency;
        if (!currency) {
            toast({
                title: 'Missing Configuration',
                description: 'Allowance currency is not set for this member.',
                variant: 'destructive',
            });
            setProcessingMemberId(null);
            return;
        }

        // Filter completions only for 'pending' periods being paid out
        const completionIdsToMark = allowanceInfo.pendingPeriods.filter((p) => p.status === 'pending').flatMap((p) => p.completionsToMark);

        const description = `Allowance distribution covering periods up to ${format(
            allowanceInfo.pendingPeriods[allowanceInfo.pendingPeriods.length - 1].periodEndDate,
            'yyyy-MM-dd'
        )}`;

        try {
            const memberEnvelopes = typedData?.allowanceEnvelopes?.filter((e) => e.familyMember?.[0]?.id === memberId) || [];
            await executeAllowanceTransaction(db, memberId, memberEnvelopes, finalAmount, currency, description);
            await markCompletionsAwarded(db, completionIdsToMark); // Mark only paid-out completions

            toast({
                title: finalAmount >= 0 ? 'Allowance Deposited' : 'Allowance Withdrawn',
                description: `${formatBalances({ [currency]: Math.abs(finalAmount) }, typedData?.unitDefinitions || [])} processed successfully.`,
            });

            // await processAllowanceData(simulatedDate); // This was causing a race condition I think
        } catch (err: any) {
            console.error('Error processing deposit/withdrawal:', err);
            toast({
                title: 'Processing Failed',
                description: err.message,
                variant: 'destructive',
            });
        } finally {
            setProcessingMemberId(null);
        }
    };

    // --- Render ---
    const showLoading = isLoading || isDataLoading;

    return (
        <div className="container mx-auto p-4 md:p-8 space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                <h1 className="text-3xl font-bold">Allowance Distribution</h1>
                <div className="flex items-center gap-2">
                    <Label htmlFor="simulated-date" className="whitespace-nowrap">
                        Simulated Date:
                    </Label>
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                variant={'outline'}
                                className={cn('w-[200px] justify-start text-left font-normal', !simulatedDate && 'text-muted-foreground')}
                            >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {simulatedDate ? format(simulatedDate, 'PPP') : <span>Pick a date</span>}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                            <Calendar
                                mode="single"
                                selected={simulatedDate}
                                onSelect={(date) => setSimulatedDate(date ? startOfDay(date) : startOfDay(new Date()))}
                                initialFocus
                            />
                        </PopoverContent>
                    </Popover>
                </div>
            </div>

            {showLoading && (
                <div className="p-4 flex items-center justify-center ">
                    <Loader2 className="h-8 w-8 animate-spin mr-2" /> Loading allowance data...
                </div>
            )}

            {!showLoading && (error || dataError) && (
                <div className="p-4 text-red-600 text-center">Error loading data: {error?.message || dataError?.message}</div>
            )}

            {!showLoading &&
                !(error || dataError) &&
                ((typedData?.familyMembers || []).length === 0 ? (
                    <p className="text-muted-foreground italic text-center py-10">No family members found.</p>
                ) : (
                    (typedData?.familyMembers || []).map((member) => {
                        const allowanceInfo = processedAllowances.find((pa) => pa.member.id === member.id);
                        const hasAnyPeriodsToShow = allowanceInfo && allowanceInfo.pendingPeriods.length > 0;
                        // Use totalDue from allowanceInfo which now includes primary fixed rewards
                        const currentTotalDue = allowanceInfo?.totalDue ?? 0;
                        const displayEditableAmount = editableAmounts[member.id] ?? String(currentTotalDue.toFixed(2)); // Footer total display

                        const memberBaseAllowanceText =
                            member.allowanceAmount && member.allowanceCurrency
                                ? `${formatBalances(
                                      {
                                          [member.allowanceCurrency]: member.allowanceAmount,
                                      },
                                      typedData?.unitDefinitions || []
                                  )} / period`
                                : 'Not Configured';

                        return (
                            <Card key={member.id} className="overflow-hidden shadow-md mb-6">
                                <CardHeader className="bg-gray-50 dark:bg-gray-800">
                                    <CardTitle className="text-xl">{member.name}</CardTitle>
                                    <p className="text-sm text-muted-foreground">Base Allowance: {memberBaseAllowanceText}</p>
                                </CardHeader>
                                <CardContent className="p-4 space-y-4">
                                    <h3 className="text-lg font-semibold mb-2 border-b pb-2">
                                        Pending Allowance Periods (up to {format(simulatedDate, 'PPP')})
                                    </h3>
                                    {!hasAnyPeriodsToShow ? (
                                        <div className="flex items-center text-muted-foreground text-sm p-3 bg-secondary rounded-md">
                                            <Info className="h-4 w-4 mr-2 flex-shrink-0" />
                                            <span>No allowance periods due for {member.name} based on the current settings and simulated date.</span>
                                        </div>
                                    ) : (
                                        allowanceInfo.pendingPeriods.map((period) => {
                                            // +++ UPDATED Date Formatting Logic +++
                                            const startYear = period.periodStartDate.getFullYear();
                                            const endYear = period.periodEndDate.getFullYear();
                                            let displayDateRange = '';

                                            if (isEqual(startOfDay(period.periodStartDate), startOfDay(period.periodEndDate))) {
                                                // Single-day period
                                                displayDateRange = format(period.periodStartDate, 'MMM d, yyyy');
                                            } else {
                                                // Multi-day period
                                                const startDateFormatted = format(period.periodStartDate, 'MMM d');
                                                // Format end date, adding year conditionally
                                                const endDateFormatted = format(period.periodEndDate, startYear === endYear ? 'MMM d, yyyy' : 'MMM d, yyyy');
                                                displayDateRange = `${startDateFormatted}${
                                                    startYear !== endYear ? ', ' + startYear : ''
                                                } - ${endDateFormatted}`;
                                            }

                                            const isInProgress = period.status === 'in-progress';
                                            const periodFixedPrimary = allowanceInfo.member.allowanceCurrency
                                                ? period.fixedRewardsEarned?.[allowanceInfo.member.allowanceCurrency.toUpperCase()] || 0
                                                : 0;
                                            const periodFixedOther = {
                                                ...period.fixedRewardsEarned,
                                            };
                                            if (allowanceInfo.member.allowanceCurrency)
                                                delete periodFixedOther[allowanceInfo.member.allowanceCurrency.toUpperCase()];

                                            return (
                                                <div
                                                    key={period.id}
                                                    className="p-3 border rounded bg-white dark:bg-gray-700 space-y-1 flex justify-between items-start gap-2"
                                                >
                                                    <div className="flex-grow">
                                                        {/* Use the calculated displayDateRange */}
                                                        <p className="font-medium text-base">
                                                            {displayDateRange}{' '}
                                                            {isInProgress && (
                                                                <span className="text-xs font-normal text-blue-600 dark:text-blue-400 italic ml-1">
                                                                    (In Progress)
                                                                </span>
                                                            )}
                                                        </p>
                                                        {/* ... rest of the details (weights, amount, etc.) ... */}
                                                        {/* +++ Display weight details +++ */}
                                                        <div className="text-xs grid grid-cols-2 gap-x-2">
                                                            <span>
                                                                Total Wt: <span className="font-mono">{period.totalWeight.toFixed(2)}</span>
                                                            </span>
                                                            <span>
                                                                Completed Wt: <span className="font-mono">{period.completedWeight.toFixed(2)}</span>
                                                            </span>
                                                            {/* +++ Update Percentage Display +++ */}
                                                            <span>
                                                                Completion: <span className="font-mono">{period.percentage.toFixed(1)}%</span>
                                                                {/* +++ Add Note for Up-for-Grabs Contribution +++ */}
                                                                {period.upForGrabsContributionPercentage > 0 && (
                                                                    <span className="text-xs italic text-muted-foreground ml-1">
                                                                        (incl. {period.upForGrabsContributionPercentage.toFixed(1)}% from up-for-grabs)
                                                                    </span>
                                                                )}
                                                            </span>
                                                            <span>
                                                                Calc Amt:{' '}
                                                                <span className="font-mono">
                                                                    {formatBalances(
                                                                        {
                                                                            [allowanceInfo.member.allowanceCurrency!]: period.calculatedAmount,
                                                                        },
                                                                        typedData?.unitDefinitions || []
                                                                    )}
                                                                </span>
                                                            </span>
                                                        </div>
                                                        {/* +++ Display fixed reward details for the period +++ */}
                                                        {(periodFixedPrimary > 0 || Object.keys(periodFixedOther).length > 0) && (
                                                            <div className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">
                                                                Fixed Rewards:
                                                                {periodFixedPrimary > 0 &&
                                                                    ` ${formatBalances(
                                                                        {
                                                                            [allowanceInfo.member.allowanceCurrency!]: periodFixedPrimary,
                                                                        },
                                                                        typedData?.unitDefinitions || []
                                                                    )}`}
                                                                {Object.keys(periodFixedOther).length > 0 &&
                                                                    `${periodFixedPrimary > 0 ? ' + ' : ''}${formatBalances(
                                                                        periodFixedOther,
                                                                        typedData?.unitDefinitions || []
                                                                    )}`}
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* +++ NEW: Per-period Edit/Deposit/Skip controls (Right Aligned) +++ */}
                                                    <div className="flex flex-col items-end gap-1">
                                                        {' '}
                                                        {/* Wrap controls in flex-col for alignment */}
                                                        {!isInProgress && ( // Only show edit/deposit for pending periods
                                                            <div className="flex items-center gap-1 justify-end">
                                                                {/* +++ Input now only shows the calculated weight-based amount +++ */}
                                                                <div className="flex items-center bg-white dark:bg-gray-900 border rounded-md overflow-hidden h-8">
                                                                    <span className="pl-1.5 pr-0.5 text-sm font-semibold">
                                                                        {allowanceInfo.member.allowanceCurrency}
                                                                    </span>
                                                                    <Input
                                                                        id={`periodAmount-${period.id}`}
                                                                        type="number"
                                                                        step="0.01"
                                                                        value={editablePeriodAmounts[period.id] ?? '0'} // Editable part
                                                                        onChange={(e) => handlePeriodAmountChange(period.id, member.id, e.target.value)}
                                                                        className="w-20 text-sm font-semibold border-0 rounded-none focus-visible:ring-0 h-full p-1" // Adjust size/padding
                                                                        disabled={processingMemberId === member.id}
                                                                    />
                                                                </div>
                                                                <Button
                                                                    size="sm" // Smaller button
                                                                    className="h-8" // Match input height
                                                                    onClick={() => handleDepositWithdrawPeriod(member.id, period)} // Use updated handler
                                                                    // Deposit button considers editable amount + fixed primary amount for enabling/styling
                                                                    disabled={
                                                                        processingMemberId === member.id ||
                                                                        parseFloat(editablePeriodAmounts[period.id] || '0') + periodFixedPrimary === 0
                                                                    }
                                                                    variant={
                                                                        parseFloat(editablePeriodAmounts[period.id] || '0') + periodFixedPrimary < 0
                                                                            ? 'destructive'
                                                                            : 'default'
                                                                    }
                                                                >
                                                                    {processingMemberId === member.id ? (
                                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                                    ) : // Check combined amount for icon
                                                                    parseFloat(editablePeriodAmounts[period.id] || '0') + periodFixedPrimary < 0 ? (
                                                                        <TrendingDown className="h-4 w-4" />
                                                                    ) : (
                                                                        <DollarSign className="h-4 w-4" />
                                                                    )}
                                                                    <span className="sr-only">
                                                                        {parseFloat(editablePeriodAmounts[period.id] || '0') + periodFixedPrimary < 0
                                                                            ? 'Withdraw'
                                                                            : 'Deposit'}{' '}
                                                                        Period
                                                                    </span>
                                                                </Button>
                                                            </div>
                                                        )}
                                                        {/* +++ Add Per-Period Breakdown Text Here +++ */}
                                                        {!isInProgress && (periodFixedPrimary > 0 || Object.keys(periodFixedOther).length > 0) && (
                                                            <div className="text-xs text-muted-foreground text-right w-full pr-1 mt-0.5">
                                                                {' '}
                                                                {/* Align text right, add slight margin-top */}
                                                                {/* Case 1: Both primary and other currency fixed rewards */}
                                                                {periodFixedPrimary > 0 && Object.keys(periodFixedOther).length > 0 && (
                                                                    <span>
                                                                        (Deposit includes{' '}
                                                                        {formatBalances(
                                                                            { [allowanceInfo.member.allowanceCurrency!]: periodFixedPrimary },
                                                                            typedData?.unitDefinitions || []
                                                                        )}
                                                                        . Also includes {formatBalances(periodFixedOther, typedData?.unitDefinitions || [])}.)
                                                                    </span>
                                                                )}
                                                                {/* Case 2: Only primary currency fixed rewards */}
                                                                {periodFixedPrimary > 0 && Object.keys(periodFixedOther).length === 0 && (
                                                                    <span>
                                                                        (Deposit includes{' '}
                                                                        {formatBalances(
                                                                            { [allowanceInfo.member.allowanceCurrency!]: periodFixedPrimary },
                                                                            typedData?.unitDefinitions || []
                                                                        )}{' '}
                                                                        from fixed rewards.)
                                                                    </span>
                                                                )}
                                                                {/* Case 3: Only other currency fixed rewards */}
                                                                {periodFixedPrimary === 0 && Object.keys(periodFixedOther).length > 0 && (
                                                                    <span>
                                                                        (Also includes {formatBalances(periodFixedOther, typedData?.unitDefinitions || [])} from
                                                                        fixed rewards.)
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )}
                                                        {/* Original Skip Button */}
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="text-xs text-muted-foreground hover:text-destructive"
                                                            onClick={() => handleSkipPeriod(member.id, period)}
                                                            disabled={processingMemberId === member.id || isInProgress} // Disable skip for in-progress
                                                            title={
                                                                isInProgress
                                                                    ? 'Cannot skip period in progress'
                                                                    : 'Mark period as processed without deposit/withdrawal'
                                                            }
                                                        >
                                                            <XCircle className="h-4 w-4 mr-1" /> Skip
                                                        </Button>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </CardContent>
                                {/* Footer only shown if there are ANY periods to show (pending or in-progress) */}
                                {hasAnyPeriodsToShow && allowanceInfo && (
                                    <CardFooter className="bg-gray-100 dark:bg-gray-800/50 p-4 flex flex-col items-start space-y-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
                                        <div className="flex flex-col items-start gap-1">
                                            {' '}
                                            {/* Use flex-col for label and breakdown */}
                                            <div className="flex items-center gap-2 flex-wrap">
                                                {' '}
                                                {/* Keep amount/input horizontal */}
                                                <Label htmlFor={`editAmount-${member.id}`} className="font-semibold text-lg whitespace-nowrap">
                                                    {/* Use calculated totalDue which excludes in-progress */}
                                                    Total Due:
                                                </Label>
                                                <div className="flex items-center bg-white dark:bg-gray-900 border rounded-md overflow-hidden">
                                                    <span className="pl-2 pr-1 text-lg font-semibold">{allowanceInfo.member.allowanceCurrency}</span>
                                                    <Input
                                                        id={`editAmount-${member.id}`}
                                                        type="number"
                                                        step="0.01"
                                                        // Bind value to the specific member's editable amount state
                                                        value={displayEditableAmount} // This now includes primary fixed rewards
                                                        onChange={(e) => handleAmountChange(member.id, e.target.value)}
                                                        className="w-28 text-lg font-semibold border-0 rounded-none focus-visible:ring-0"
                                                        disabled={processingMemberId === member.id}
                                                    />
                                                </div>
                                                <Edit className="h-4 w-4 text-muted-foreground ml-1" title="Amount can be edited" />
                                            </div>
                                            {/* +++ Enhanced Footer Breakdown Text Logic +++ */}
                                            <div className="text-xs text-muted-foreground pl-1 h-4">
                                                {' '}
                                                {/* Ensure consistent height */}
                                                {/* Check if there are ANY fixed rewards (primary or other) */}
                                                {allowanceInfo.totalFixedRewardsInPrimaryCurrency === 0 &&
                                                Object.keys(allowanceInfo.totalFixedRewardsInOtherCurrencies).length === 0 ? (
                                                    <span>&nbsp;</span> // Render nothing or placeholder if no fixed rewards
                                                ) : (
                                                    <>
                                                        {'('} {/* Opening parenthesis */}
                                                        {allowanceInfo.totalFixedRewardsInPrimaryCurrency > 0 && (
                                                            <span>
                                                                Deposit amount includes{' '}
                                                                {formatBalances(
                                                                    {
                                                                        [allowanceInfo.member.allowanceCurrency!]:
                                                                            allowanceInfo.totalFixedRewardsInPrimaryCurrency,
                                                                    },
                                                                    typedData?.unitDefinitions || []
                                                                )}
                                                            </span>
                                                        )}
                                                        {allowanceInfo.totalFixedRewardsInPrimaryCurrency > 0 &&
                                                            Object.keys(allowanceInfo.totalFixedRewardsInOtherCurrencies).length > 0 && <span>. </span>}
                                                        {/* Separator */}
                                                        {Object.keys(allowanceInfo.totalFixedRewardsInOtherCurrencies).length > 0 && (
                                                            <span>
                                                                Also depositing{' '}
                                                                {formatBalances(
                                                                    allowanceInfo.totalFixedRewardsInOtherCurrencies,
                                                                    typedData?.unitDefinitions || []
                                                                )}
                                                            </span>
                                                        )}
                                                        {/* Add closing text only if there were rewards */}
                                                        {allowanceInfo.totalFixedRewardsInPrimaryCurrency > 0 ||
                                                        Object.keys(allowanceInfo.totalFixedRewardsInOtherCurrencies).length > 0 ? (
                                                            allowanceInfo.totalFixedRewardsInPrimaryCurrency > 0 ? (
                                                                <span> from fixed rewards.)</span>
                                                            ) : (
                                                                <span>.)</span>
                                                            )
                                                        ) : null}
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                        <Button
                                            onClick={() => handleDepositWithdraw(member.id)} // Pass memberId only
                                            // Disable button based on the PARSED value of the editable amount
                                            disabled={processingMemberId === member.id || parseFloat(displayEditableAmount || '0') === 0}
                                            variant={parseFloat(displayEditableAmount || '0') < 0 ? 'destructive' : 'default'}
                                            size="lg"
                                        >
                                            {processingMemberId === member.id ? (
                                                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                                            ) : parseFloat(displayEditableAmount || '0') < 0 ? (
                                                <TrendingDown className="h-5 w-5 mr-2" />
                                            ) : (
                                                <DollarSign className="h-5 w-5 mr-2" />
                                            )}
                                            {processingMemberId === member.id
                                                ? 'Processing...'
                                                : parseFloat(displayEditableAmount || '0') < 0
                                                ? 'Withdraw Amount'
                                                : 'Deposit Amount'}
                                        </Button>
                                    </CardFooter>
                                )}
                            </Card>
                        );
                    })
                ))}
        </div>
    );
}
