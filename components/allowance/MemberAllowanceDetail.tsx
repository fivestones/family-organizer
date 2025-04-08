// components/allowance/MemberAllowanceDetail.tsx
import { init, tx, id } from '@instantdb/react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { Loader2 } from "lucide-react";

// --- Import Components ---
import EnvelopeItem, { Envelope } from '@/components/EnvelopeItem';
import AddEditEnvelopeForm from '@/components/allowance/AddEditEnvelopeForm';
// **** IMPORT THE NEW COMPONENTS ****
import TransferFundsForm from '@/components/allowance/TransferFundsForm';
import DeleteEnvelopeDialog from '@/components/allowance/DeleteEnvelopeDialog';

// --- Import Utilities ---
import {
    depositToSpecificEnvelope,
    createInitialSavingsEnvelope,
    transferFunds, // [cite: 62]
    deleteEnvelope, // [cite: 62]
    // You might need setDefaultEnvelope separately if not handled within delete flow
} from '@/lib/currency-utils'; // [cite: 62]


interface MemberAllowanceDetailProps {
    memberId: string | null;
}

const APP_ID = 'af77353a-0a48-455f-b892-010232a052b4';
const db = init({
  appId: APP_ID,
  apiURI: "http://kepler.local:8888",
  websocketURI: "ws://kepler.local:8888/runtime/session",
});

// --- Import Child/Modal Components (Create these) ---
// import EnvelopeList from '@/components/allowance/EnvelopeList';
// import TransferFundsForm from '@/components/allowance/TransferFundsForm';
// import SelectDefaultEnvelopeDialog from '@/components/allowance/SelectDefaultEnvelopeDialog';

// Define props for the component
interface MemberAllowanceDetailProps {
    memberId: string; // `memberId: string | null;`? Accept memberId as a prop
}

export default function MemberAllowanceDetail({ memberId }: MemberAllowanceDetailProps) {
    const { toast } = useToast(); // [cite: 68]
    const hasInitializedEnvelope = useRef(false); // [cite: 68]

    // --- State for Modals & Actions ---
    const [isAddModalOpen, setIsAddModalOpen] = useState(false); // [cite: 69]
    const [isEditModalOpen, setIsEditModalOpen] = useState(false); // [cite: 69]
    const [isTransferModalOpen, setIsTransferModalOpen] = useState(false); // [cite: 70]
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false); // [cite: 70]
    const [envelopeToEdit, setEnvelopeToEdit] = useState<Envelope | null>(null); // [cite: 70]
    const [transferSourceEnvelopeId, setTransferSourceEnvelopeId] = useState<string | null>(null); // [cite: 71]
    const [envelopeToDelete, setEnvelopeToDelete] = useState<Envelope | null>(null); // [cite: 71]

    // --- State for Forms ---
    const [depositAmount, setDepositAmount] = useState(''); // [cite: 72]
    const [depositCurrency, setDepositCurrency] = useState('USD'); // [cite: 72]
    const [depositDescription, setDepositDescription] = useState(''); // [cite: 72]
    const [isDepositing, setIsDepositing] = useState(false); // [cite: 72]

    // --- Fetch Member Data (including envelopes) ---
    const { isLoading, error, data } = db.useQuery({
        familyMembers: {
            $: { where: { id: memberId! } },
            allowanceEnvelopes: {}
        }
    }); // [cite: 73, 74]

    const member = data?.familyMembers?.[0]; // [cite: 75]
    const envelopes: Envelope[] = member?.allowanceEnvelopes || []; // [cite: 75]
    const isLastEnvelope = envelopes.length === 1; // Derived state [cite: 76] - Adjusted from original cite


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
    const handleAddClick = () => setIsAddModalOpen(true); // [cite: 97]

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
    if (!memberId) return null; // [cite: 123]
    if (!db) return <div className="p-4 flex justify-center items-center"><Loader2 className="h-6 w-6 animate-spin" />&nbsp;Initializing...</div>; // [cite: 124]
    if (isLoading) return <div className="p-4 flex justify-center items-center"><Loader2 className="h-6 w-6 animate-spin" />&nbsp;Loading allowance...</div>; // [cite: 125]
    if (error || !member) {
        console.error("Error loading member data:", error); // [cite: 127]
        return <div className="p-4 text-red-600">Error loading allowance details for this member.</div>; // [cite: 127]
    }

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


            {/* Envelopes Section */}
            <section>
                 <div className="flex justify-between items-center mb-3">
                     <h3 className="text-lg font-semibold">Envelopes</h3>
                     <Button onClick={handleAddClick} size="sm">+ Add Envelope</Button> {/* [cite: 142] */}
                 </div>
                 {envelopes.length === 0 && !isLoading && (
                    <p className="text-muted-foreground itallic">No envelopes created yet. The initial 'Savings' envelope should appear shortly.</p> // [cite: 143]
                 )}
                 <div>
                    {envelopes.map(envelope => (
                        <EnvelopeItem
                            key={envelope.id}
                            envelope={envelope} // [cite: 145]
                            isLastEnvelope={isLastEnvelope} // [cite: 145]
                            onEdit={handleEditClick} // [cite: 145]
                            onTransfer={handleTransferClick} // [cite: 146]
                            onDelete={handleDeleteClick} // [cite: 146]
                        />
                    ))}
                 </div>
             </section>

            {/* --- Modals --- */}

            <AddEditEnvelopeForm
                db={db}
                isOpen={isAddModalOpen || isEditModalOpen} // [cite: 148]
                onClose={() => {
                    setIsAddModalOpen(false);
                    setIsEditModalOpen(false); // [cite: 149]
                    setEnvelopeToEdit(null);
                }} // [cite: 148, 149]
                initialData={envelopeToEdit} // [cite: 149]
                memberId={memberId} // [cite: 149]
             />

            {/* **** USE THE ACTUAL TransferFundsForm **** */}
            <TransferFundsForm
                db={db}
                isOpen={isTransferModalOpen}
                onClose={() => {
                    setIsTransferModalOpen(false);
                    setTransferSourceEnvelopeId(null);
                 }}
                onSubmit={handleTransferSubmit} // Pass the handler
                sourceEnvelopeId={transferSourceEnvelopeId}
                allEnvelopes={envelopes}
            />

            {/* **** USE THE ACTUAL DeleteEnvelopeDialog **** */}
            <DeleteEnvelopeDialog
                 db={db}
                 isOpen={isDeleteModalOpen}
                 onClose={() => {
                    setIsDeleteModalOpen(false);
                    setEnvelopeToDelete(null);
                 }}
                 onConfirm={handleDeleteConfirm} // Pass the handler
                 envelopeToDelete={envelopeToDelete}
                 allEnvelopes={envelopes}
            />

            {/* Remove the old placeholders */}
            {/* {isTransferModalOpen && <div className='p-4 my-2 border rounded bg-secondary'> Transfer Funds Modal Placeholder...</div>} */}
            {/* {isDeleteModalOpen && <div className='p-4 my-2 border rounded bg-secondary'> Delete Confirmation Modal Placeholder...</div>} */}

        </div>
    );
}