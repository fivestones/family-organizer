// components/allowance/MemberAllowanceDetail.tsx
import { init, tx, id } from '@instantdb/react';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Check, ChevronsUpDown, MinusCircle, Users, History, Target } from "lucide-react"; // Added Target
// --- Shadcn UI Imports ---
import { cn } from "@/lib/utils";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// --- Import Components ---
// **** Import updated Envelope type ****
import EnvelopeItem, { Envelope } from '@/components/EnvelopeItem';
import AddEditEnvelopeForm from '@/components/allowance/AddEditEnvelopeForm';
import TransferFundsForm from '@/components/allowance/TransferFundsForm'; // From envelope to envelope of the same person
import DeleteEnvelopeDialog from '@/components/allowance/DeleteEnvelopeDialog';
import DefineUnitForm from '@/components/allowance/DefineUnitForm';
import WithdrawForm from '@/components/allowance/WithdrawForm';
import TransferToPersonForm from '@/components/allowance/TransferToPersonForm';
import TransactionHistoryView from '@/components/allowance/TransactionHistoryView';
// **** NEW: Import CombinedBalanceDisplay ****
import CombinedBalanceDisplay from '@/components/allowance/CombinedBalanceDisplay';

// --- Import Utilities ---
import {
    depositToSpecificEnvelope,
    createInitialSavingsEnvelope,
    setDefaultEnvelope, // Keep existing setDefaultEnvelope import
    transferFunds,
    deleteEnvelope,
    withdrawFromEnvelope,
    transferFundsToPerson,
    // **** NEW: Import exchange rate and preference utils ****
    fetchExternalExchangeRates,
    cacheExchangeRates,
    getExchangeRate, // Async util
    setLastDisplayCurrencyPref,
    CachedExchangeRate, // Type for cache entries

    UnitDefinition,
    formatBalances,
    ExchangeRateResult, // Type for rate result
} from '@/lib/currency-utils';

// Minimal interface for family members passed down
interface BasicFamilyMember {
    id: string;
    name: string;
}

// Add allFamilyMembers to props
interface MemberAllowanceDetailProps {
    memberId: string; // Changed from string | null previously? Ensure consistency.
    allFamilyMembers: BasicFamilyMember[]; // Added prop
    allMonetaryCurrenciesInUse: string[]; // e.g., ["USD", "NPR", "EUR"] - this is passed from parent
    unitDefinitions: UnitDefinition[]; 
}

const APP_ID =  process.env.NEXT_PUBLIC_INSTANT_APP_ID || 'af77353a-0a48-455f-b892-010232a052b4';
const db = init({
  appId: APP_ID,
  apiURI: process.env.NEXT_PUBLIC_INSTANT_API_URI || "http://kepler.local:8888",
  websocketURI: process.env.NEXT_PUBLIC_INSTANT_WEBSOCKET_URI || "ws://kepler.local:8888/runtime/session",
});

// Define props for the component
interface MemberAllowanceDetailProps { // [cite: 101]
    memberId: string; // [cite: 102]
}

const BASE_CURRENCY = "USD"; // API Base

// **** Destructure new props ****
export default function MemberAllowanceDetail({
    memberId,
    allFamilyMembers,
    allMonetaryCurrenciesInUse, // Use received prop
    unitDefinitions            // Use received prop
}: MemberAllowanceDetailProps) {
    const { toast } = useToast();
    const hasInitializedEnvelope = useRef(false);
    const rateCalculationController = useRef<AbortController | null>(null); // Abort controller
    const isFetchingApiRates = useRef(false); // Prevent concurrent API calls
    const hasSetInitialCurrency = useRef(false); // Flag to prevent re-initializing currency


    // --- State ---
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [envelopeToEdit, setEnvelopeToEdit] = useState<Envelope | null>(null);
    const [transferSourceEnvelopeId, setTransferSourceEnvelopeId] = useState<string | null>(null);
    const [envelopeToDelete, setEnvelopeToDelete] = useState<Envelope | null>(null);
    const [isDefineUnitModalOpen, setIsDefineUnitModalOpen] = useState(false);
    const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
    const [isTransferToPersonModalOpen, setIsTransferToPersonModalOpen] = useState(false);
    // **** NEW exchange rate States ****
    const [selectedDisplayCurrency, setSelectedDisplayCurrency] = useState<string | null>(null); // e.g., "USD"
    const [isLoadingRates, setIsLoadingRates] = useState(false);   
    // **** NEW: State to toggle between Allowance Details and Transactions ****
    const [showingTransactions, setShowingTransactions] = useState(false);
    
    // ... (form states) ...
    const [depositAmount, setDepositAmount] = useState('');
    const [depositCurrency, setDepositCurrency] = useState('USD'); // The actual selected/final currency
    const [depositDescription, setDepositDescription] = useState('');
    const [isDepositing, setIsDepositing] = useState(false);
    const [isCurrencyPopoverOpen, setIsCurrencyPopoverOpen] = useState(false);
    const [currencySearchInput, setCurrencySearchInput] = useState('');
    const itemSelectedRef = useRef(false); // Track if selection happened via mouse/keyboard

    const [hasFetchedInitialPrefs, setHasFetchedInitialPrefs] = useState(false);
    // **** NEW State for calculated results ****
    const [combinedValue, setCombinedValue] = useState<number | null>(null);
    const [tooltipLines, setTooltipLines] = useState<string[]>([]);
    const [nonMonetaryBalances, setNonMonetaryBalances] = useState<{ [c: string]: number }>({});


    // --- Data Fetching ---
    // Query only for the specific member, their envelopes, and exchange rates
    // No need to fetch allFamilyMembers here, it's passed as a prop
    const { isLoading: isLoadingData, error: errorData, data } = db.useQuery({
        familyMembers: {
            $: { where: { id: memberId! } },
            allowanceEnvelopes: {},
        },
        exchangeRates: {} // Fetch all cached rates
    });
    
    // --- Derived Data ---
    const member = data?.familyMembers?.[0];
    const envelopes: Envelope[] = useMemo(() => member?.allowanceEnvelopes || [], [member]);
    const allCachedRates: CachedExchangeRate[] = useMemo(() => { // Memoize processing
        if (!data?.exchangeRates) return [];
        return data.exchangeRates.map((r: any) => ({
            ...r,
            lastFetchedTimestamp: r.lastFetchedTimestamp ? new Date(r.lastFetchedTimestamp) : new Date(0), // Ensure Date, handle potential null
        })).filter((r: any) => r.lastFetchedTimestamp instanceof Date && !isNaN(r.lastFetchedTimestamp.getTime()));
    }, [data?.exchangeRates]);

    const isLastEnvelope = envelopes.length === 1;


  // --- Generate Currency Options for Deposit (using props) ---
    const currencyOptions = useMemo(() => {
        // ... (same logic as before to generate options list) ...
        const codes = new Set<string>();
        // Add codes from definitions
        unitDefinitions.forEach(def => codes.add(def.code.toUpperCase()));
        // Add codes currently used in this member's envelopes
        envelopes.forEach(env => {
            if (env.balances) {
                Object.keys(env.balances).forEach(code => codes.add(code.toUpperCase()));
            }
        });
        // Add common default if not present (optional)
        if (!codes.has('USD')) codes.add('USD');

        const sortedCodes = Array.from(codes).sort();
        return [
            ...sortedCodes.map(code => ({ value: code, label: code })),
            { value: '__DEFINE_NEW__', label: 'Define New Unit...' }
        ];
    }, [unitDefinitions, envelopes]);


    // --- Calculate Total Balances ---
  const totalBalances = useMemo(() => {
        const totals: { [currency: string]: number } = {};
        envelopes.forEach(envelope => {
            if (envelope.balances) {
                Object.entries(envelope.balances).forEach(([currency, amount]) => {
                    totals[currency] = (totals[currency] || 0) + amount;
                });
            }
        });
        return totals;
    }, [envelopes]);

    // --- Helper to find first available monetary currency ---
    const getFirstMonetaryCurrency = useCallback(() => {
        const unitDefMap = new Map(unitDefinitions.map(def => [def.code.toUpperCase(), def]));
        for (const code in totalBalances) {
            if (totalBalances[code] > 0) {
                    const definition = unitDefMap.get(code.toUpperCase());
                    const isMonetary = definition?.isMonetary ?? (code.length === 3);
                    if (isMonetary) {
                        return code;
                    }
            }
        }
        // Fallback if no monetary currency found with balance
        const firstMonetaryDef = unitDefinitions.find(def => def.isMonetary);
        return firstMonetaryDef?.code || "USD"; // Absolute fallback
    }, [totalBalances, unitDefinitions]);
    

    // --- Effect for Initial Setup (Envelope & Currency Pref) ---
    useEffect(() => {
        if (isLoadingData || !member || hasFetchedInitialPrefs) return;
        // ... (logic to set initial selectedDisplayCurrency based on pref or default) ...
        console.log("Initial Pref/Default currency:", member.lastDisplayCurrency);
        let initialCurrency = member.lastDisplayCurrency;
        const availableMonetaryCodes = Object.keys(totalBalances).filter(code => {
            const def = unitDefinitions.find(ud => ud.code.toUpperCase() === code.toUpperCase());
            return def?.isMonetary ?? (code.length === 3);
        });

        if (!initialCurrency || !allMonetaryCurrenciesInUse.includes(initialCurrency)) {
            initialCurrency = getFirstMonetaryCurrency();
            console.log("Pref missing or invalid, using default:", initialCurrency);
        }
        setSelectedDisplayCurrency(initialCurrency);
        setHasFetchedInitialPrefs(true); // Mark pref as fetched/set

        // --- Initialize Default Envelope (Keep existing logic) ---
        if (!hasInitializedEnvelope.current) {
             if (envelopes.length === 0) {
            console.log(`Member ${memberId} has no envelopes. Calling createInitialSavingsEnvelope.`);
            hasInitializedEnvelope.current = true; // prevent loop
            createInitialSavingsEnvelope(db, memberId) // [cite: 78]
                 .then((newId) => {
                    if (newId) toast({ title: "Created 'Savings' envelope." }); // [cite: 79]
                })
                .catch(err => {
                    console.error("Failed to create initial Savings envelope:", err); // [cite: 79]
                    toast({
                        title: "Error",
                        description: err.message || "Could not create envelope.",
                        variant: "destructive"
                    }); // [cite: 80, 81]
                   hasInitializedEnvelope.current = false; // Allow retry if failed // [cite: 82]
                });
            } else {
                const hasDefault = envelopes.some((env: Envelope) => env.isDefault);
                 if (!hasDefault) {
                    console.warn(`Member ${memberId} has envelopes but no default. Setting first one '${envelopes[0].name}' as default.`);
                    hasInitializedEnvelope.current = true;
                    setDefaultEnvelope(db, envelopes, envelopes[0].id)
                        .then(() => toast({ title: "Default Set", description: `Set '${envelopes[0].name}' as default.` }))
                         .catch(err => {
                             console.error("Failed to set default envelope automatically:", err);
                             toast({ title: "Error", description: err.message || "Could not set default envelope.", variant: "destructive" });
                            hasInitializedEnvelope.current = false;
                         });
                 } else {
                    hasInitializedEnvelope.current = true; // envelopes exist and have a default
                 }
             }
         }

   }, [isLoadingData, member, envelopes, hasFetchedInitialPrefs, allMonetaryCurrenciesInUse, getFirstMonetaryCurrency, unitDefinitions, db, memberId, toast]); // Add allMonetaryCurrenciesInUse to dependencies
    

    // --- Effect to Calculate Combined Balance and Fetch Rates ---
    useEffect(() => {
        // Abort previous calculation if running
        rateCalculationController.current?.abort();
        const controller = new AbortController();
        rateCalculationController.current = controller;
        const signal = controller.signal;

        // Don't run calculation if currency/data isn't ready
        if (!selectedDisplayCurrency || isLoadingData || !hasFetchedInitialPrefs) {
            setCombinedValue(null);
            setTooltipLines([]);
            setNonMonetaryBalances({});
            setIsLoadingRates(false); // Not loading if we don't have the currency yet
            return;
        }

        console.log(`Calculating combined balance for: ${selectedDisplayCurrency}`);
        setIsLoadingRates(true);
        setCombinedValue(null); // Reset while calculating
        setTooltipLines([]);
        setNonMonetaryBalances({});

        const calculate = async () => {
            let combinedTotal = 0;
            const lines: string[] = [];
            const nonMonetary: { [c: string]: number } = {};
            let needsApiFetch = false;
            const unitDefMap = new Map(unitDefinitions.map(def => [def.code.toUpperCase(), def]));

            for (const code in totalBalances) {
                if (signal.aborted) return; // Check for abort
                const amount = totalBalances[code];
                if (amount === 0) continue;

                const definition = unitDefMap.get(code.toUpperCase());
                 // Determine if monetary (definition first, then fallback)
                const isMonetary = definition?.isMonetary ?? (code.length === 3);

                if (isMonetary) {
                    const rateResult = await getExchangeRate(db, code, selectedDisplayCurrency, allCachedRates);
                    if (signal.aborted) return; // Check for abort

                    if (rateResult.rate !== null) {
                        const convertedAmount = amount * rateResult.rate;
                        combinedTotal += convertedAmount;

                        // Add tooltip line based on how the rate was obtained
                        const formattedOriginal = formatBalances({[code]: amount}, unitDefinitions);
                        const formattedConverted = formatBalances({[selectedDisplayCurrency]: convertedAmount}, unitDefinitions);
                        let sourceText = "";
                        if (rateResult.source === 'identity') sourceText = `already in ${selectedDisplayCurrency}`;
                        else if (rateResult.source === 'cache') sourceText = `from ${formattedOriginal}`; // removed " (cached rate)" from the end of the string
                        else if (rateResult.source === 'calculated') sourceText = `from ${formattedOriginal}`; // removed " (calculated rate)" from the edn of the string
                        else sourceText = `from ${formattedOriginal}`; // Default if source unclear

                        lines.push(`${formattedConverted} ${sourceText}`);

                    } else {
                        // Rate unavailable, add note to tooltip
                        lines.push(`${formatBalances({[code]: amount}, unitDefinitions)} (rate to ${selectedDisplayCurrency} unavailable)`);
                    }

                    if (rateResult.needsApiFetch) {
                        needsApiFetch = true;
                    }
                } else {
                    nonMonetary[code] = amount;
                }
            } // end for loop

            if (signal.aborted) return;

            // Update state with results
            setCombinedValue(combinedTotal);
            setTooltipLines(lines);
            setNonMonetaryBalances(nonMonetary);
            console.log("Calculation complete. Combined:", combinedTotal, "Tooltips:", lines.length, "Needs Fetch:", needsApiFetch);


            // Trigger API fetch if needed
            if (needsApiFetch) {
                console.log("Triggering background API fetch...");
                //setIsLoadingRates(true); // Already true or will be handled by useQuery refresh
                try {
                    const apiData = await fetchExternalExchangeRates(); // Fetches USD based rates
                     if (signal.aborted) return;
                    if (apiData && apiData.rates) {
                        const now = new Date();
                        const ratesToCache = Object.entries(apiData.rates).map(([currency, rate]) => ({
                            baseCurrency: BASE_CURRENCY,
                            targetCurrency: currency,
                            rate: rate as number,
                            timestamp: now
                        }));
                        // Cache the fresh rates, passing *all* current rates for potential updates
                        await cacheExchangeRates(db, ratesToCache, allCachedRates);
                        console.log("Background fetch and cache complete.");
                        // Let useQuery refresh trigger final state/loading changes
                    }
                } catch (fetchError: any) {
                     if (fetchError.name !== 'AbortError') {
                        console.error("Error during background rate fetch:", fetchError);
                        toast({ title: "Error", description: "Could not update exchange rates.", variant: "destructive" });
                         setIsLoadingRates(false); // Stop loading on error only if fetch fails
                     } else { console.log("Background fetch aborted."); }
                } finally {
                     // setIsLoadingRates(false); // Let useQuery handle final loading state
                }
            } else {
                 setIsLoadingRates(false);
            }
        };

        calculate().catch(err => {
             if (err.name !== 'AbortError') {
                console.error("Error in calculation effect:", err);
                setIsLoadingRates(false);
                setCombinedValue(null); // Indicate error state
                setTooltipLines(["Error calculating combined value."]);
             } else {
                 console.log("Calculation aborted.");
             }
        });

        // Cleanup function
        return () => {
            console.log("Cleaning up calculation effect.");
            controller.abort();
        };

    }, [selectedDisplayCurrency, totalBalances, unitDefinitions, allCachedRates, db, hasFetchedInitialPrefs, isLoadingData, toast]); // Dependencies


    // --- Event Handlers ---
    const handleDeposit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!db || !memberId || isDepositing || !data?.familyMembers?.[0]?.allowanceEnvelopes) return;

        const amount = parseFloat(depositAmount);
        if (isNaN(amount) || amount <= 0) {
            toast({ title: "Invalid Amount", variant: "destructive" });
            return;
        }
        // **** UPDATED: Validate typed currency format ****
        const finalDepositCurrency = depositCurrency.trim().toUpperCase();
        if (!finalDepositCurrency || finalDepositCurrency === '__DEFINE_NEW__') {
             toast({ title: "Invalid Currency", description:"Please select or define a currency/unit.", variant: "destructive" });
             return;
        }

        // ... (rest of deposit logic using finalDepositCurrency) ...
         const defaultEnvelope = envelopes.find(env => env.isDefault);
        if (!defaultEnvelope) {
             toast({ title: "Deposit Failed", description: "Default envelope not found.", variant: "destructive" });
            return;
        }

         setIsDepositing(true);
         try {
             await depositToSpecificEnvelope(
                 db, defaultEnvelope.id, defaultEnvelope.balances || {}, amount,
                 finalDepositCurrency, // Use validated code
                 depositDescription.trim()
             );
             toast({ title: "Success", description: `Deposited ${finalDepositCurrency} ${amount}` });
             setDepositAmount('');
             // setDepositCurrency('USD'); // Reset or keep?
             setDepositDescription('');
         } catch (err: any) {
             console.error("Failed to deposit:", err);
             toast({ title: "Deposit Failed", description: err.message, variant: "destructive" });
         } finally {
             setIsDepositing(false);
         }
    };
    // --- Other Handlers ---
    // ... (AddClick, EditClick, TransferClick, DeleteClick, TransferSubmit, DeleteConfirm) ...
    const handleAddClick = () => setIsAddModalOpen(true);
    const handleEditClick = useCallback((envelopeId: string) => {
        const envelope = envelopes.find(e => e.id === envelopeId);
        if (envelope) {
            setEnvelopeToEdit(envelope);
            setIsEditModalOpen(true);
        }
    }, [envelopes]); // [cite: 98]

    const handleTransferClick = useCallback((sourceId: string) => {
        setTransferSourceEnvelopeId(sourceId);
        setIsTransferModalOpen(true);
    }, []); // [cite: 99]

    const handleDeleteClick = useCallback((envelopeId: string) => {
        const envelope = envelopes.find(e => e.id === envelopeId);
        if (envelope) {
            // Prevent opening delete modal for the last envelope
            if (isLastEnvelope) {
                 toast({ title: "Action Denied", description: "Cannot delete the last envelope.", variant: "destructive" });
                 return;
            }
            setEnvelopeToDelete(envelope);
            setIsDeleteModalOpen(true);
        }
    }, [envelopes, isLastEnvelope, toast]); // Added isLastEnvelope and toast dependencies // [cite: 100]

    // **** NEW: Handler for Withdraw Button Click ****
    const handleWithdrawClick = () => {
        // Ensure there's an envelope to withdraw from before opening
        if (!envelopes || envelopes.length === 0) {
                toast({ title: "Action Denied", description: "You need at least one envelope to withdraw funds.", variant: "destructive" });
                return;
        }
        setIsWithdrawModalOpen(true);
    };

     // **** NEW: Handler for Transfer to Person Button Click ****
     const handleTransferToPersonClick = () => {
         const otherMembers = allFamilyMembers.filter(m => m.id !== memberId);
         if (!otherMembers || otherMembers.length === 0) {
              toast({ title: "Action Denied", description: "No other family members available to transfer to.", variant: "destructive" });
              return;
         }
         if (!envelopes || envelopes.length === 0) {
              toast({ title: "Action Denied", description: "You need at least one envelope with funds to initiate a transfer.", variant: "destructive" });
              return;
         }
         setIsTransferToPersonModalOpen(true);
     };

    // **** NEW: Handler to show transactions ****
    const handleShowTransactionsClick = () => {
        setShowingTransactions(true);
    };

    // --- **** NEW Handler to Change Display Currency **** ---
    const handleDisplayCurrencyChange = useCallback((newCurrency: string) => {
        if (newCurrency && newCurrency !== selectedDisplayCurrency) {
            setSelectedDisplayCurrency(newCurrency);
            // Store preference asynchronously
            setLastDisplayCurrencyPref(db, memberId, newCurrency)
                .catch(err => toast({ title: "Warning", description: "Could not save currency preference.", variant:"default" }));
        }
    }, [selectedDisplayCurrency, db, memberId, toast]);

    // --- Modal Submit Handlers & Callbacks ---
    const handleTransferSubmit = async (amount: number, currency: string, destinationEnvelopeId: string) => {
        // Basic validation moved to form, but keep checks here too
        if (!db || !transferSourceEnvelopeId || !destinationEnvelopeId || amount <= 0) return; // [cite: 112]

       const sourceEnvelope = envelopes.find(e => e.id === transferSourceEnvelopeId); // [cite: 113]
       const destinationEnvelope = envelopes.find(e => e.id === destinationEnvelopeId); // [cite: 113]

       if (!sourceEnvelope || !destinationEnvelope) {
           toast({ title: "Error", description: "Could not find source or destination envelope.", variant: "destructive" }); // [cite: 114]
           return; // [cite: 115]
       }

       // More robust validation before calling utility
       const sourceBalance = sourceEnvelope.balances?.[currency] ?? 0;
       if (amount > sourceBalance) {
            toast({
               title: "Transfer Failed",
               description: `Insufficient ${currency} funds in ${sourceEnvelope.name}.`,
               variant: "destructive",
            });
            return;
       }

       try {
           await transferFunds(db, sourceEnvelope, destinationEnvelope, amount, currency); // [cite: 116]
           toast({ title: "Success", description: "Funds transferred." }); // [cite: 116, 117]
           setIsTransferModalOpen(false); // [cite: 117]
           setTransferSourceEnvelopeId(null); // [cite: 117]
       } catch (err: any) {
           toast({ title: "Transfer Failed", description: err.message, variant: "destructive" }); // [cite: 118]
           // Don't close modal on error? Or handle within form? Decide on desired UX.
       }
   };

   const handleDeleteConfirm = async (transferTargetId: string, newDefaultId: string | null) => {
       if (!db || !envelopeToDelete || !transferTargetId) return; // [cite: 119]
       // Added check: prevent deletion if it's the last one (belt-and-suspenders)
       if (envelopes.length <= 1) {
            toast({ title: "Delete Failed", description: "Cannot delete the last envelope.", variant: "destructive" });
            setIsDeleteModalOpen(false);
            setEnvelopeToDelete(null);
            return;
       }

       try {
           await deleteEnvelope(db, envelopes, envelopeToDelete.id, transferTargetId, newDefaultId); // [cite: 120]
           toast({ title: "Success", description: `Envelope '${envelopeToDelete.name}' deleted.` }); // [cite: 121]
           setIsDeleteModalOpen(false); // [cite: 121]
           setEnvelopeToDelete(null); // [cite: 121]
       } catch (err: any) {
           toast({ title: "Delete Failed", description: err.message, variant: "destructive" }); // [cite: 122]
           // Consider keeping modal open on failure?
       }
   };


    const handleUnitDefined = (newCode: string) => { //
       setIsDefineUnitModalOpen(false); //
       setDepositCurrency(newCode); // Set actual state
       setCurrencySearchInput(newCode); // Also update input visually
    };
    // **** NEW: Handler for Withdraw Form Submission ****
    const handleWithdrawSubmit = async (envelopeId: string, amount: number, currency: string, description?: string) => {
        const envelopeToWithdrawFrom = envelopes.find(e => e.id === envelopeId);

        if (!envelopeToWithdrawFrom) {
            toast({ title: "Error", description: "Could not find the specified envelope.", variant: "destructive" });
            return; // Or throw?
        }

        try {
            // Pass values to the utility function
            await withdrawFromEnvelope(db, envelopeToWithdrawFrom, amount, currency, description);
            toast({ title: "Success", description: "Withdrawal successful." });
            setIsWithdrawModalOpen(false); // Close modal on success
        } catch (err: any) {
                console.error("Withdrawal failed:", err);
                toast({ title: "Withdrawal Failed", description: err.message || "Could not process withdrawal.", variant: "destructive" });
                // Keep modal open on error
        }
    };

    // **** NEW: Handler for TransferToPersonForm Submission ****
    const handleTransferToPersonSubmit = async (
        sourceEnvelopeId: string,
        // Receive the full destination envelope object
        destinationDefaultEnvelope: Envelope,
        amount: number,
        currency: string,
        description?: string
    ) => {
        const sourceEnvelope = envelopes.find(e => e.id === sourceEnvelopeId);
        if (!sourceEnvelope) {
             toast({ title: "Error", description: "Source envelope not found.", variant: "destructive" });
             return;
        }

        try {
             // **** Use the passed destinationDefaultEnvelope directly ****
             await transferFundsToPerson(db, sourceEnvelope, destinationDefaultEnvelope, amount, currency, description);

             toast({ title: "Success", description: "Funds transferred successfully." });
             setIsTransferToPersonModalOpen(false); // Close modal on success

        } catch (err: any) {
            console.error("Transfer to person failed:", err);
            toast({ title: "Transfer Failed", description: err.message || "Could not complete transfer.", variant: "destructive" });
            // Keep modal open on error
        }
    };


    // --- Render Logic ---
    if (!memberId || !db) return <div className="p-4">Error: Missing required data.</div>;
    if (isLoadingData && !member) return <div className="p-4">Loading member details...</div>; // Show loading only if member isn't available yet
    if (errorData) return <div className="p-4 text-red-600">Error loading details: {errorData.message}</div>;
    if (!member) return <div className="p-4 text-muted-foreground">Member details not found.</div>;


    // --- Conditional Rendering for Transactions ---
    if (showingTransactions) { // [cite: 418]
        return (
             <div className="h-full"> {/* Ensure container takes height */}
                 <TransactionHistoryView
                     db={db}
                     mode="member"
                     familyMemberId={memberId}
                     unitDefinitions={unitDefinitions}
                     onClose={() => setShowingTransactions(false)} // Set state back to false
                 />
             </div>
        );
    }

    // --- Original Allowance Detail View ---
    return (
        // Use h-full and flex/flex-col if needed to ensure height consistency
        <div className="p-4 space-y-6 border rounded-lg bg-card text-card-foreground h-full flex flex-col">
             {/* Header Section */}
             <div className="flex justify-between items-center pb-4 border-b">
             <h2 className="text-xl font-bold">Allowance for {member.name}</h2>
                 {/* **** NEW: Show Transactions Button **** */}
                 <Button variant="outline" size="sm" onClick={handleShowTransactionsClick}>
                     <History className="mr-2 h-4 w-4" />
                     View History
                 </Button>
             </div>


            {/* Wrap content in a flex-grow ScrollArea if content might overflow */}
            <ScrollArea className="flex-grow -mr-4 pr-4">
                 <div className="space-y-6 pb-4"> 

            {/* Deposit Section */}
             <section className="p-4 border rounded-md">
                <h3 className="text-lg font-semibold mb-3">Add to Allowance</h3>
                <form onSubmit={handleDeposit} className="space-y-3">
                    {/* ... deposit form inputs ... */}
                     <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                         {/* Amount Input */}
                         <div>
                             <Label htmlFor="deposit-amount">Amount</Label>
                             <Input
                                 id="deposit-amount"
                                 type="number"
                                 value={depositAmount}
                                 onChange={(e) => setDepositAmount(e.target.value)}
                                 placeholder="e.g., 10.00"
                                 step="0.01"
                                 required
                             />
                         </div>

                         {/* **** UPDATED: Currency Combobox **** */}
                         <div>
                             <Label htmlFor="deposit-currency-input">Currency/Unit</Label>
                             <Popover
                                open={isCurrencyPopoverOpen}
                                // ** UPDATED: onOpenChange logic **
                                onOpenChange={(open) => {
                                    setIsCurrencyPopoverOpen(open);
                                    if (open) {
                                        // Clear search input when opening
                                        setCurrencySearchInput('');
                                        itemSelectedRef.current = false;
                                    } else {
                                        // Popover closed: If no item was selected via click/enter,
                                        // consider using the typed value.
                                        if (!itemSelectedRef.current) {
                                             const typedValue = currencySearchInput.trim().toUpperCase();
                                             // Basic check: Is it non-empty, not the special value,
                                             // AND either 3 letters OR already known in options?
                                             const isValidCode = /^[A-Z]{3}$/.test(typedValue); // Common 3-letter case
                                             const isKnownOption = currencyOptions.some(opt => opt.value === typedValue);

                                             if (typedValue && typedValue !== '__DEFINE_NEW__' && (isValidCode || isKnownOption)) {
                                                console.log("Using typed value:", typedValue)
                                                setDepositCurrency(typedValue);
                                             }
                                             // Else: maybe revert to previous depositCurrency or do nothing,
                                             // letting the trigger button show the last valid state.
                                        }
                                    }
                                }}
                             >
                                <PopoverTrigger asChild>
                                    <Button variant="outline" role="combobox" className="w-full justify-between">
                                        {/* Display the main depositCurrency state */}
                                        {depositCurrency && depositCurrency !== '__DEFINE_NEW__'
                                            ? depositCurrency
                                            : "Select or type unit..."}
                                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[--radix-popover-trigger-width] max-h-[--radix-popover-content-available-height] p-0">
                                    <Command>
                                        <CommandInput
                                            id="deposit-currency-input"
                                            placeholder="Type or select..."
                                            // ** UPDATED: Bind value to currencySearchInput **
                                            value={currencySearchInput}
                                            // ** UPDATED: Update search input state **
                                            onValueChange={setCurrencySearchInput}
                                            />
                                         <CommandList>
                                            <CommandEmpty>No unit found.</CommandEmpty>
                                            <CommandGroup>
                                                {currencyOptions.map((option) => (
                                                <CommandItem
                                                    key={option.value}
                                                    value={option.value}
                                                    // ** UPDATED: onSelect logic **
                                                    onSelect={(currentValue) => {
                                                        itemSelectedRef.current = true; // Mark selection happened
                                                        if (currentValue === '__DEFINE_NEW__') {
                                                            setIsDefineUnitModalOpen(true);
                                                        } else {
                                                            const finalValue = currentValue.toUpperCase();
                                                            setDepositCurrency(finalValue); // Set main state
                                                            setCurrencySearchInput(finalValue); // Update input visual
                                                        }
                                                        setIsCurrencyPopoverOpen(false); // Close popover
                                                    }}
                                                    className={option.value === '__DEFINE_NEW__' ? 'font-bold text-blue-600' : ''}
                                                >
                                                    <Check className={cn("mr-2 h-4 w-4", depositCurrency === option.value ? "opacity-100" : "opacity-0")} />
                                                    {option.label}
                                                </CommandItem>
                                                ))}
                                            </CommandGroup>
                                         </CommandList>
                                    </Command>
                                </PopoverContent>
                             </Popover>
                         </div>
                         {/* Description Input */}
                         <div>
                             <Label htmlFor="deposit-description">Description (Optional)</Label>
                             <Input
                                 id="deposit-description"
                                 type="text"
                                 value={depositDescription}
                                 onChange={(e) => setDepositDescription(e.target.value)}
                                 placeholder="e.g., Weekly allowance"
                            />
                         </div>
                     </div>
                    <Button type="submit" disabled={isDepositing}>
                         {isDepositing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Depositing...</> : 'Deposit Funds'}
                    </Button>
                </form>
            </section>

             {/* Total Allowance Display & Actions */}
            <section className="p-4 border rounded-md bg-muted/50">
                 <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                    {/* Balance Display */}
                    <div className="flex-grow"> {/* Allow balance display to take space */}
                        <h3 className="text-lg font-semibold mb-1">Total Balance</h3>
                                 {/* Use CombinedBalanceDisplay */}
                                {selectedDisplayCurrency ? (
                                     <CombinedBalanceDisplay
                                        totalBalances={totalBalances}
                                        displayCurrency={selectedDisplayCurrency}
                                        combinedMonetaryValue={combinedValue} // Pass calculated value
                                        nonMonetaryBalances={nonMonetaryBalances} // Pass separated balances
                                        tooltipLines={tooltipLines} // Pass breakdown lines
                                        unitDefinitions={unitDefinitions}
                                        onCurrencyChange={handleDisplayCurrencyChange}
                                        className="mt-1"
                                        isLoading={isLoadingRates || (!hasFetchedInitialPrefs && isLoadingData)} // Combine loading states
                                        // **** NEW: Pass all monetary currencies ****
                                        allMonetaryCurrenciesInUse={allMonetaryCurrenciesInUse}
                                     />
                                ) : (
                                     // Fallback (should only show briefly during initial load)
                                     <p className="text-lg font-medium opacity-50">
                        {formatBalances(totalBalances, unitDefinitions)}
                    </p>
                 )}
                    </div>
                    {/* Action Buttons */}
                    <div className="flex flex-col sm:flex-row gap-2 shrink-0 pt-1">
                        <Button variant="outline" onClick={handleWithdrawClick}> <MinusCircle className="mr-2 h-4 w-4" /> Withdraw </Button>
                         {/* **** UPDATED: Added onClick handler **** */}
                        <Button variant="outline" onClick={handleTransferToPersonClick}> <Users className="mr-2 h-4 w-4" /> Transfer to Person </Button>
                    </div>
                 </div>
            </section>

            {/* Envelopes Section */}
            <section>
                 {/* ... Envelope list mapping EnvelopeItem ... */}
                 <div className="flex justify-between items-center mb-3">
                     <h3 className="text-lg font-semibold">Envelopes</h3>
                     <Button onClick={handleAddClick} size="sm">+ Add Envelope</Button>
                 </div>
            {/* ... loading/empty states ... */}
            {envelopes.length === 0 && !isLoadingData && ( <p className='text-muted-foreground italic'>No envelopes created yet.</p> )}
            {isLoadingData && envelopes.length === 0 && ( <p className='text-muted-foreground italic'>Loading envelopes...</p> )}
                 <div>
                     {envelopes.map(envelope => (
                        <EnvelopeItem
                            key={envelope.id}
                  db={db}
                            envelope={envelope}
                            isLastEnvelope={isLastEnvelope}
                            unitDefinitions={unitDefinitions}
                            // **** Pass cached rates down ****
                            allCachedRates={allCachedRates}
                            onEdit={handleEditClick}
                            onTransfer={handleTransferClick}
                            onDelete={handleDeleteClick}
                        />
                    ))}
                 </div>
            </section>
                </div>{/* End inner padding div */}
             </ScrollArea> {/* End ScrollArea */}


             {/* --- Modals --- */}
             <AddEditEnvelopeForm
                db={db}
                isOpen={isAddModalOpen || isEditModalOpen} // [cite: 198]
                onClose={() => {
                    setIsAddModalOpen(false); // [cite: 199]
                    setIsEditModalOpen(false); // [cite: 199]
                    setEnvelopeToEdit(null); // [cite: 200]
                 }}
                initialData={envelopeToEdit} // [cite: 200]
                memberId={memberId} // [cite: 200]
                allMemberEnvelopes={envelopes}
                // **** Pass unit definitions to Add/Edit form ****
                unitDefinitions={unitDefinitions}
                allMonetaryCurrenciesInUse={allMonetaryCurrenciesInUse}
             />

            <TransferFundsForm
                 db={db} // [cite: 201]
                isOpen={isTransferModalOpen}
                onClose={() => {
                    setIsTransferModalOpen(false); // [cite: 202]
                    setTransferSourceEnvelopeId(null); // [cite: 202]
                 }}
                onSubmit={handleTransferSubmit}
                sourceEnvelopeId={transferSourceEnvelopeId}
                allEnvelopes={envelopes}
                // **** Pass unit definitions if needed by Transfer form for formatting ****
                unitDefinitions={unitDefinitions}
            />

            <DeleteEnvelopeDialog
                  db={db} // [cite: 203]
                 isOpen={isDeleteModalOpen}
                 onClose={() => {
                    setIsDeleteModalOpen(false); // [cite: 204]
                    setEnvelopeToDelete(null); // [cite: 204]
                 }}
                 onConfirm={handleDeleteConfirm}
                 envelopeToDelete={envelopeToDelete}
                 allEnvelopes={envelopes}
            />
            <DefineUnitForm
                db={db}
                isOpen={isDefineUnitModalOpen}
                onClose={() => setIsDefineUnitModalOpen(false)}
                onUnitDefined={handleUnitDefined} // Pass the callback
            />
            {/* **** NEW: Withdraw Modal **** */}
            <WithdrawForm
                db={db}
                isOpen={isWithdrawModalOpen}
                onClose={() => setIsWithdrawModalOpen(false)}
                onSubmit={handleWithdrawSubmit} // Pass the handler
                memberEnvelopes={envelopes}
                unitDefinitions={unitDefinitions}
            />

             {/* **** NEW: Transfer to Person Modal **** */}
             <TransferToPersonForm
                db={db}
                isOpen={isTransferToPersonModalOpen}
                onClose={() => setIsTransferToPersonModalOpen(false)}
                onSubmit={handleTransferToPersonSubmit} // Pass the new handler
                sourceMemberId={memberId} // Pass current member's ID
                allFamilyMembers={allFamilyMembers} // Pass the list from props
                sourceMemberEnvelopes={envelopes} // Pass current member's envelopes
                unitDefinitions={unitDefinitions} // Pass definitions
             />

        </div>
    );
}