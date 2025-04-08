// components/allowance/MemberAllowanceDetail.tsx
import { init, tx, id } from '@instantdb/react';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'; // Added React import
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Check, ChevronsUpDown } from "lucide-react"; // Added Combobox icons

// --- Shadcn UI Imports for Combobox ---
import { cn } from "@/lib/utils"; // Assuming you have this utility
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList, // Import CommandList
  } from "@/components/ui/command";
  import {
    Popover,
    PopoverContent,
    PopoverTrigger,
  } from "@/components/ui/popover";

// --- Import Components ---
import EnvelopeItem, { Envelope } from '@/components/EnvelopeItem';
import AddEditEnvelopeForm from '@/components/allowance/AddEditEnvelopeForm';
import TransferFundsForm from '@/components/allowance/TransferFundsForm';
import DeleteEnvelopeDialog from '@/components/allowance/DeleteEnvelopeDialog';
// **** NEW: Import DefineUnitForm ****
import DefineUnitForm from '@/components/allowance/DefineUnitForm'; // Adjust path if needed

// --- Import Utilities ---
import {
    depositToSpecificEnvelope,
    createInitialSavingsEnvelope,
    transferFunds,
    deleteEnvelope,
    formatBalances,
    UnitDefinition // Ensure UnitDefinition is exported from currency-utils
} from '@/lib/currency-utils';


interface MemberAllowanceDetailProps {
    memberId: string | null;
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

export default function MemberAllowanceDetail({ memberId }: MemberAllowanceDetailProps) {
    const { toast } = useToast();
    const hasInitializedEnvelope = useRef(false);

    // --- State for Modals & Actions ---
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [envelopeToEdit, setEnvelopeToEdit] = useState<Envelope | null>(null);
    const [transferSourceEnvelopeId, setTransferSourceEnvelopeId] = useState<string | null>(null);
    const [envelopeToDelete, setEnvelopeToDelete] = useState<Envelope | null>(null);
    // **** NEW: State for Define Unit Modal ****
    const [isDefineUnitModalOpen, setIsDefineUnitModalOpen] = useState(false);

    // --- State for Forms ---
    const [depositAmount, setDepositAmount] = useState('');
    const [depositCurrency, setDepositCurrency] = useState('USD'); // Default or maybe ''
    const [depositDescription, setDepositDescription] = useState('');
    const [isDepositing, setIsDepositing] = useState(false);
    // **** NEW: State for Combobox Popover ****
    const [isCurrencyPopoverOpen, setIsCurrencyPopoverOpen] = useState(false);


    // --- Fetch Member Data AND Unit Definitions ---
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


    // --- Generate Currency List for Combobox ---
    const currencyOptions = useMemo(() => {
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

        // Add the special item
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
        } else {
           hasInitializedEnvelope.current = true; // [cite: 84]
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
        // **** NEW: Check if depositCurrency is set ****
        if (!depositCurrency || depositCurrency === '__DEFINE_NEW__') {
             toast({ title: "Invalid Currency", description:"Please select or define a currency/unit.", variant: "destructive" });
             return;
        }


        const defaultEnvelope = envelopes.find(env => env.isDefault);
        if (!defaultEnvelope) {
             toast({ title: "Deposit Failed", description: "Default envelope not found.", variant: "destructive" });
            return;
        }

        setIsDepositing(true);
        try {
            await depositToSpecificEnvelope(
                db,
                defaultEnvelope.id,
                defaultEnvelope.balances || {},
                amount,
                depositCurrency, // Use state value
                depositDescription.trim()
            );
            toast({ title: "Success", description: `Deposited ${depositCurrency} ${amount}` });
            // Reset form fields
            setDepositAmount('');
            // Keep currency or reset? Maybe keep last used. setDepositCurrency('USD');
            setDepositDescription('');
        } catch (err: any) {
            console.error("Failed to deposit:", err);
            toast({ title: "Deposit Failed", description: err.message, variant: "destructive" });
        } finally {
            setIsDepositing(false);
        }
    };

    // Modal Triggers
    const handleAddClick = () => setIsAddModalOpen(true); // [cite: 145]
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

    // --- Modal Submit Handlers ---
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

    // **** NEW: Handler for when a unit is defined ****
    const handleUnitDefined = (newCode: string) => {
        setIsDefineUnitModalOpen(false); // Close the define modal
        setDepositCurrency(newCode); // Set the deposit currency to the new code
        // Optional: Trigger refetch if reactivity isn't immediate for the list
        // refetch();
    };

    // --- Render Logic ---
    if (!memberId) return null; // [cite: 173]
    if (!db) return <div className="p-4 flex justify-center items-center"><Loader2 className="h-6 w-6 animate-spin" />&nbsp;Initializing...</div>; // [cite: 174]
    if (isLoading) return <div className="p-4 flex justify-center items-center"><Loader2 className="h-6 w-6 animate-spin" />&nbsp;Loading allowance...</div>; // [cite: 175]
    if (error || !member) { // [cite: 176]
        console.error("Error loading member data:", error); // [cite: 176]
        return <div className="p-4 text-red-600">Error loading allowance details for this member.</div>; // [cite: 177]
    }


    return (
        <div className="p-4 space-y-6 border rounded-lg mt-4 bg-card text-card-foreground">
            <h2 className="text-xl font-bold">Allowance for {member.name}</h2>

            {/* Deposit Section */}
             <section className="p-4 border rounded-md">
                <h3 className="text-lg font-semibold mb-3">Add to Allowance (Default Envelope)</h3>
                <form onSubmit={handleDeposit} className="space-y-3">
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
                         {/* **** NEW: Currency Combobox **** */}
                         <div>
                             <Label htmlFor="deposit-currency">Currency/Unit</Label>
                             <Popover open={isCurrencyPopoverOpen} onOpenChange={setIsCurrencyPopoverOpen}>
                                <PopoverTrigger asChild>
                                    <Button
                                    variant="outline"
                                    role="combobox"
                                    aria-expanded={isCurrencyPopoverOpen}
                                    className="w-full justify-between"
                                    >
                                    {depositCurrency
                                        ? currencyOptions.find((opt) => opt.value === depositCurrency)?.label
                                        : "Select unit..."}
                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[--radix-popover-trigger-width] max-h-[--radix-popover-content-available-height] p-0">
                                    <Command>
                                        <CommandInput placeholder="Search unit..." />
                                         <CommandList> {/* Added CommandList for scrolling */}
                                            <CommandEmpty>No unit found.</CommandEmpty>
                                            <CommandGroup>
                                                {currencyOptions.map((option) => (
                                                <CommandItem
                                                    key={option.value}
                                                    value={option.value}
                                                    onSelect={(currentValue) => {
                                                        // ** DEBUGGING STEP: Log the value when selected **
                                                        console.log("Selected value:", currentValue);
                                                        
                                                        if (currentValue === '__DEFINE_NEW__') {
                                                            console.log("Define New Unit selected, setting modal open to true.");
                                                            setIsDefineUnitModalOpen(true); // Open define modal
                                                        } else {
                                                            setDepositCurrency(currentValue === depositCurrency ? "" : currentValue.toUpperCase()); // Set selected currency
                                                        }
                                                        setIsCurrencyPopoverOpen(false); // Close popover
                                                    }}
                                                    className={option.value === '__DEFINE_NEW__' ? 'font-bold text-blue-600' : ''} // Highlight special item
                                                >
                                                    <Check
                                                    className={cn(
                                                        "mr-2 h-4 w-4",
                                                        depositCurrency === option.value ? "opacity-100" : "opacity-0"
                                                    )}
                                                    />
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

             {/* Total Allowance Display */}
            <section className="p-4 border rounded-md bg-muted/50">
                {/* ... Total balance display using formatBalances(totalBalances, unitDefinitions) ... */}
                 <h3 className="text-lg font-semibold mb-2">Total Balance</h3>
                 {Object.keys(totalBalances).length > 0 ? (
                    <p className="text-lg font-medium">
                        {formatBalances(totalBalances, unitDefinitions)}
                    </p>
                 ) : (
                    <p className="text-muted-foreground italic">No funds available yet.</p>
                 )}
            </section>

            {/* Envelopes Section */}
            <section>
                 {/* ... Envelope list mapping EnvelopeItem ... */}
                 <div className="flex justify-between items-center mb-3">
                     <h3 className="text-lg font-semibold">Envelopes</h3>
                     <Button onClick={handleAddClick} size="sm">+ Add Envelope</Button>
                 </div>
                 {envelopes.length === 0 && !isLoading && ( <p>...</p> )}
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
            {/* **** NEW: Define Unit Modal **** */}
            <DefineUnitForm
                db={db}
                isOpen={isDefineUnitModalOpen}
                onClose={() => setIsDefineUnitModalOpen(false)}
                onUnitDefined={handleUnitDefined} // Pass the callback
            />
        </div>
    );
}