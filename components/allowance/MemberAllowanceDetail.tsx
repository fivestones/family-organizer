// components/allowance/MemberAllowanceDetail.tsx
import { init, tx, id } from '@instantdb/react';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Check, ChevronsUpDown, MinusCircle, Users, History } from "lucide-react"; // Add History icon
// --- Shadcn UI Imports ---
import { cn } from "@/lib/utils";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// --- Import Components ---
import EnvelopeItem, { Envelope } from '@/components/EnvelopeItem';
import AddEditEnvelopeForm from '@/components/allowance/AddEditEnvelopeForm';
import TransferFundsForm from '@/components/allowance/TransferFundsForm'; // From envelope to envelope of the same person
import DeleteEnvelopeDialog from '@/components/allowance/DeleteEnvelopeDialog';
import DefineUnitForm from '@/components/allowance/DefineUnitForm';
import WithdrawForm from '@/components/allowance/WithdrawForm';
import TransferToPersonForm from '@/components/allowance/TransferToPersonForm';
// **** NEW: Import TransactionHistoryView ****
import TransactionHistoryView from '@/components/allowance/TransactionHistoryView'; // Adjust path if needed

// --- Import Utilities ---
import {
    depositToSpecificEnvelope,
    createInitialSavingsEnvelope,
    transferFunds, // Renaming this might be good later (e.g., transferFundsIntraMember)
    deleteEnvelope,
    formatBalances,
    UnitDefinition,
    withdrawFromEnvelope,
    // **** NEW: Import transferFundsToPerson and getDefaultEnvelope ****
    transferFundsToPerson,
    // getDefaultEnvelope // Utility to find the recipient's default envelope; no longer needed, since it's done in the TransferToPersonForm.tsx
} from '@/lib/currency-utils';

// Minimal interface for family members passed down
interface BasicFamilyMember {
    id: string;
    name: string;
}

// **** UPDATED: Add allFamilyMembers to props ****
interface MemberAllowanceDetailProps {
    memberId: string; // Changed from string | null previously? Ensure consistency.
    allFamilyMembers: BasicFamilyMember[]; // Added prop
}

const APP_ID = 'af77353a-0a48-455f-b892-010232a052b4';
const db = init({
  appId: APP_ID,
  apiURI: "http://kepler.local:8888",
  websocketURI: "ws://kepler.local:8888/runtime/session",
});

// Define props for the component
interface MemberAllowanceDetailProps { // [cite: 101]
    memberId: string; // [cite: 102]
}

export default function MemberAllowanceDetail({ memberId, allFamilyMembers }: MemberAllowanceDetailProps) { // <-- Destructure new prop
    const { toast } = useToast();
    const hasInitializedEnvelope = useRef(false);

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
     // **** NEW: State for Transfer to Person Modal ****
    const [isTransferToPersonModalOpen, setIsTransferToPersonModalOpen] = useState(false);

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


    // --- Data Fetching (unitDefinitions still needed locally) ---
    // No need to fetch allFamilyMembers here, it's passed as a prop
    const { isLoading, error, data } = db.useQuery({
        familyMembers: {
            $: { where: { id: memberId! } },
            allowanceEnvelopes: {}
        },
        unitDefinitions: {}
    });

    const member = data?.familyMembers?.[0];
    const envelopes: Envelope[] = member?.allowanceEnvelopes || [];
    const unitDefinitions: UnitDefinition[] = data?.unitDefinitions || [];
    const isLastEnvelope = envelopes.length === 1;


    // --- Generate Currency Options ---
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
    const totalBalances = useMemo(() => { // [cite: 119]
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

    // --- Effect for Initial Envelope ---
    useEffect(() => {
        if (
            hasInitializedEnvelope.current ||
            !db ||
            !memberId ||
            isLoading ||
            !data
        ) return; // [cite: 77]

        if (member && member.allowanceEnvelopes?.length === 0) { // [cite: 78]
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
            } else if (member && member.allowanceEnvelopes && member.allowanceEnvelopes.length > 0) {
                // Ensure there's always a default if envelopes exist but none is marked
                 const hasDefault = member.allowanceEnvelopes.some((env: Envelope) => env.isDefault);
                 if (!hasDefault) {
                     console.warn(`Member ${memberId} has envelopes but no default. Setting first one as default.`);
                     hasInitializedEnvelope.current = true; // prevent loop
                     setDefaultEnvelope(db, member.allowanceEnvelopes, member.allowanceEnvelopes[0].id)
                         .then(() => toast({ title: "Default Set", description: `Set '${member.allowanceEnvelopes[0].name}' as default.`}))
                         .catch(err => {
                             console.error("Failed to set default envelope automatically:", err);
                             toast({ title: "Error", description: err.message || "Could not set default envelope.", variant: "destructive" });
                             hasInitializedEnvelope.current = false; // Allow retry
                         });
                 } else {
                    hasInitializedEnvelope.current = true; // Envelopes exist and have a default
                 }
             }
         }, [memberId, db, isLoading, data, error, toast, member]); // Added member dependency
    
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
    if (isLoading) return <div className="p-4">Loading allowance details...</div>;
    if (error) return <div className="p-4 text-red-600">Error loading details: {error.message}</div>;
    if (!member) return <div className="p-4 text-muted-foreground">Member details not found.</div>;


    // **** NEW: Conditional Rendering ****
    if (showingTransactions) {
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
            <ScrollArea className="flex-grow">
                 <div className="space-y-6 p-1"> {/* Add padding inside scroll area if needed */}

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
                 <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    {/* Balance Display */}
                    <div>
                        <h3 className="text-lg font-semibold mb-1 md:mb-0">Total Balance</h3>
                 {Object.keys(totalBalances).length > 0 ? (
                    <p className="text-lg font-medium">
                        {formatBalances(totalBalances, unitDefinitions)}
                    </p>
                 ) : (
                    <p className="text-muted-foreground italic">No funds available yet.</p>
                 )}
                    </div>
                    {/* Action Buttons */}
                    <div className="flex flex-col sm:flex-row gap-2 shrink-0">
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
                          {envelopes.length === 0 && !isLoading && ( <p className='text-muted-foreground italic'>No envelopes created yet.</p> )}
                 <div>
                     {envelopes.map(envelope => (
                        <EnvelopeItem
                            key={envelope.id}
                            envelope={envelope}
                            isLastEnvelope={isLastEnvelope}
                            unitDefinitions={unitDefinitions} // Pass definitions down
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