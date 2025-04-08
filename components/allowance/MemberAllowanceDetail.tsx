// components/allowance/MemberAllowanceDetail.tsx
import { init, tx, id } from '@instantdb/react';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { Loader2 } from "lucide-react";
// --- Import Components ---
import EnvelopeItem, { Envelope } from '@/components/EnvelopeItem';
import AddEditEnvelopeForm from '@/components/allowance/AddEditEnvelopeForm';
import TransferFundsForm from '@/components/allowance/TransferFundsForm';
import DeleteEnvelopeDialog from '@/components/allowance/DeleteEnvelopeDialog';
// --- Import Utilities ---
import {
    depositToSpecificEnvelope,
    createInitialSavingsEnvelope,
    transferFunds,
    deleteEnvelope,
    formatBalances,
    // Import the UnitDefinition type
    UnitDefinition
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
interface MemberAllowanceDetailProps {
    memberId: string;
}

export default function MemberAllowanceDetail({ memberId }: MemberAllowanceDetailProps) {
    const { toast } = useToast();
    const hasInitializedEnvelope = useRef(false);

    // --- State for Modals & Actions ---
    const [isAddModalOpen, setIsAddModalOpen] = useState(false); // [cite: 105]
    const [isEditModalOpen, setIsEditModalOpen] = useState(false); // [cite: 106]
    const [isTransferModalOpen, setIsTransferModalOpen] = useState(false); // [cite: 107]
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false); // [cite: 108]
    const [envelopeToEdit, setEnvelopeToEdit] = useState<Envelope | null>(null); // [cite: 109]
    const [transferSourceEnvelopeId, setTransferSourceEnvelopeId] = useState<string | null>(null); // [cite: 110]
    const [envelopeToDelete, setEnvelopeToDelete] = useState<Envelope | null>(null); // [cite: 111]

    // --- State for Forms ---
    const [depositAmount, setDepositAmount] = useState(''); // [cite: 112]
    const [depositCurrency, setDepositCurrency] = useState('USD'); // [cite: 113]
    const [depositDescription, setDepositDescription] = useState(''); // [cite: 114]
    const [isDepositing, setIsDepositing] = useState(false); // [cite: 115]

    // --- Fetch Member Data AND Unit Definitions ---
    const { isLoading, error, data } = db.useQuery({
        // Fetch family member and their envelopes
        familyMembers: {
            $: { where: { id: memberId! } },
            allowanceEnvelopes: {}
        },
        // **** NEW: Fetch all unit definitions ****
        unitDefinitions: {}
    }); // [cite: 116] // Added unitDefinitions query

    const member = data?.familyMembers?.[0];
    const envelopes: Envelope[] = member?.allowanceEnvelopes || [];
    // **** NEW: Extract unit definitions, provide default empty array ****
    const unitDefinitions: UnitDefinition[] = data?.unitDefinitions || [];
    const isLastEnvelope = envelopes.length === 1;


    // --- Calculate Total Balances ---
    // This useMemo doesn't need unitDefinitions directly,
    // but formatBalances called later will.
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
    }, [envelopes]); // Depends only on envelopes so recalculate only when envelopes data c

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
        e.preventDefault(); // [cite: 86]
        if (!db || !memberId || isDepositing || !data?.familyMembers?.[0]?.allowanceEnvelopes) return; // [cite: 86]

        const amount = parseFloat(depositAmount); // [cite: 87]
        if (isNaN(amount) || amount <= 0) {
            toast({ title: "Invalid Amount", variant: "destructive" }); // [cite: 87, 88]
            return; // [cite: 88]
        }

        const defaultEnvelope = envelopes.find(env => env.isDefault); // [cite: 89]

        if (!defaultEnvelope) {
             toast({ title: "Deposit Failed", description: "Default envelope not found.", variant: "destructive" }); // [cite: 90]
            return; // [cite: 90]
        }

        setIsDepositing(true); // [cite: 91]
        try {
            await depositToSpecificEnvelope(
                db,
                defaultEnvelope.id,
                defaultEnvelope.balances || {},
                amount,
                depositCurrency,
                depositDescription.trim()
            ); // [cite: 91, 92]
            toast({ title: "Success", description: `Deposited ${depositCurrency} ${amount}` }); // [cite: 93]
            setDepositAmount(''); setDepositCurrency('USD'); setDepositDescription(''); // [cite: 94]
        } catch (err: any) {
            console.error("Failed to deposit:", err); // [cite: 95]
            toast({ title: "Deposit Failed", description: err.message, variant: "destructive" }); // [cite: 95]
        } finally {
            setIsDepositing(false); // [cite: 96]
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


    // --- Render Logic ---
    if (!memberId) return null;
    if (!db) return <div className="p-4 flex justify-center items-center"><Loader2 className="h-6 w-6 animate-spin" />&nbsp;Initializing...</div>;
    // Combine loading states if needed, or rely on overall isLoading
    if (isLoading) return <div className="p-4 flex justify-center items-center"><Loader2 className="h-6 w-6 animate-spin" />&nbsp;Loading allowance...</div>;
    if (error || !member) {
        console.error("Error loading member data:", error);
        return <div className="p-4 text-red-600">Error loading allowance details for this member.</div>;
    }
    // Could add specific error check for unitDefinitions if desired:
    // if (!data?.unitDefinitions) { /* handle missing definitions */ }


    return (
        <div className="p-4 space-y-6 border rounded-lg mt-4 bg-card text-card-foreground">
            <h2 className="text-xl font-bold">Allowance for {member.name}</h2>

            {/* Deposit Section */}
             <section className="p-4 border rounded-md">
             <h3 className="text-lg font-semibold mb-3">Add to Allowance (Default Envelope)</h3>
                 <form onSubmit={handleDeposit} className="space-y-3"> {/* [cite: 129] */}
                     <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                         <div>
                             <Label htmlFor="deposit-amount">Amount</Label> {/* [cite: 130] */}
                             <Input
                                 id="deposit-amount"
                                 type="number" // [cite: 131]
                                 value={depositAmount}
                                 onChange={(e) => setDepositAmount(e.target.value)} // [cite: 131]
                                 placeholder="e.g., 10.00" // [cite: 132]
                                 step="0.01"
                                 required // [cite: 133]
                             />
                         </div>
                         <div>
                             <Label htmlFor="deposit-currency">Currency</Label> {/* [cite: 134] */}
                             <Input
                                 id="deposit-currency"
                                 type="text" // [cite: 134]
                                 value={depositCurrency}
                                 onChange={(e) => setDepositCurrency(e.target.value.toUpperCase())} // [cite: 135]
                                 placeholder="e.g., USD" // [cite: 135]
                                 maxLength={3} // [cite: 136]
                                 required // [cite: 136]
                             />
                         </div>
                         <div>
                             <Label htmlFor="deposit-description">Description (Optional)</Label> {/* [cite: 137] */}
                             <Input
                                 id="deposit-description"
                                 type="text" // [cite: 138]
                                 value={depositDescription}
                                 onChange={(e) => setDepositDescription(e.target.value)} // [cite: 139]
                                 placeholder="e.g., Weekly allowance" // [cite: 139]
                             />
                         </div>
                     </div>
                    <Button type="submit" disabled={isDepositing}>
                        {isDepositing
                         ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Depositing...</>
                         : 'Deposit Funds'} {/* [cite: 141] */}
                    </Button>
                </form>
             </section>

             {/* Total Allowance Display */}
            <section className="p-4 border rounded-md bg-muted/50">
                 <h3 className="text-lg font-semibold mb-2">Total Balance</h3>
                 {Object.keys(totalBalances).length > 0 ? (
                    <p className="text-lg font-medium">
                        {/* **** UPDATED: Pass unitDefinitions to formatBalances **** */}
                        {formatBalances(totalBalances, unitDefinitions)}
                    </p>
                 ) : (
                    <p className="text-muted-foreground italic">No funds available yet.</p>
                 )}
            </section>

            {/* Envelopes Section */}
            <section>
                 <div className="flex justify-between items-center mb-3">
                     <h3 className="text-lg font-semibold">Envelopes</h3>
                     <Button onClick={handleAddClick} size="sm">+ Add Envelope</Button>
                 </div>
                 {envelopes.length === 0 && !isLoading && (
                    <p className="text-muted-foreground itallic">No envelopes created yet. The initial 'Savings' envelope should appear after a refresh.</p> // [cite: 193]
                 )}
                 <div>
                     {/* NOTE: EnvelopeItem currently calls formatBalances internally.
                         For consistent formatting using unitDefinitions, EnvelopeItem
                         will also need to be updated either to accept unitDefinitions
                         or to receive a pre-formatted balance string from here.
                         For now, only the Total Balance above uses the new logic.
                     */}
                     {envelopes.map(envelope => (
                        <EnvelopeItem
                            key={envelope.id}
                            envelope={envelope}
                            isLastEnvelope={isLastEnvelope}
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
        </div>
    );
}