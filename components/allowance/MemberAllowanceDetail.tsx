// components/allowance/MemberAllowanceDetail.tsx
import { init, tx, id } from '@instantdb/react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { Loader2 } from "lucide-react"; // For loading indicators

// --- Import Components ---
import EnvelopeItem, { Envelope } from '@/components/EnvelopeItem'; // Import the updated component and type
// import AddEditEnvelopeForm from '@/components/allowance/AddEditEnvelopeForm'; // Placeholder
// import TransferFundsForm from '@/components/allowance/TransferFundsForm'; // Placeholder
// import DeleteEnvelopeDialog from '@/components/allowance/DeleteEnvelopeDialog'; // Placeholder for deletion confirmation/selection

// --- Import Utilities ---
import {
    depositToSpecificEnvelope, // [cite: 325]
    createInitialSavingsEnvelope, // [cite: 308]
    createAdditionalEnvelope, // [cite: 312]
    updateEnvelopeName, // [cite: 358]
    transferFunds, // [cite: 330]
    deleteEnvelope, // [cite: 342]
    // You might need setDefaultEnvelope separately if not handled within delete flow [cite: 317]
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

// --- Import Child/Modal Components (Create these) ---
// import EnvelopeList from '@/components/allowance/EnvelopeList';
// import AddEditEnvelopeForm from '@/components/allowance/AddEditEnvelopeForm';
// import TransferFundsForm from '@/components/allowance/TransferFundsForm';
// import SelectDefaultEnvelopeDialog from '@/components/allowance/SelectDefaultEnvelopeDialog';

// Define props for the component
interface MemberAllowanceDetailProps {
    memberId: string; // Accept memberId as a prop
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

    // --- State for Forms ---
    const [depositAmount, setDepositAmount] = useState('');
    const [depositCurrency, setDepositCurrency] = useState('USD');
    const [depositDescription, setDepositDescription] = useState('');
    const [isDepositing, setIsDepositing] = useState(false);

    // --- Fetch Member Data (including envelopes) ---
    const { isLoading, error, data } = db.useQuery({
        familyMembers: {
            $: { where: { id: memberId! } },
            // Fetch all envelopes for this member
            allowanceEnvelopes: {}
        }
    });

    console.log("data:", data);

    const member = data?.familyMembers?.[0];
    const envelopes: Envelope[] = member?.allowanceEnvelopes || []; // [cite: 422]
    const isLastEnvelope = data.familyMembers[0].allowanceEnvelopes.length === 1; // Calculate if only one envelope exists

    console.log("data:", data);

     // --- Effect for Initial Envelope ---
     useEffect(() => {
        if (
            hasInitializedEnvelope.current || 
            !db || 
            !memberId || 
            isLoading || 
            !data
        ) return;
    
        // Check if the fetched member has zero envelopes
        // const member = data.familyMembers?.[0];
        if (member && member.allowanceEnvelopes?.length === 0) {
            console.log(`Member ${memberId} has no envelopes. Calling createInitialSavingsEnvelope.`);
            hasInitializedEnvelope.current = true; // prevent loop
            createInitialSavingsEnvelope(db, memberId)
                .then((newId) => {
                    if (newId) toast({ title: "Created 'Savings' envelope." });
                })
                .catch(err => {
                    console.error("Failed to create initial Savings envelope:", err);
                    toast({
                        title: "Error",
                        description: err.message || "Could not create envelope.",
                        variant: "destructive"
                    });
                    hasInitializedEnvelope.current = false; // Allow retry if failed
                });
        } else {
            // If envelopes exist, mark as initialized (or potentially verify default exists)
           hasInitializedEnvelope.current = true;
       }
    }, [memberId, db, isLoading, data, error, toast]);

    // --- Event Handlers ---
    const handleDeposit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!db || !memberId || isDepositing || !data?.familyMembers?.[0]?.allowanceEnvelopes) return;

        const amount = parseFloat(depositAmount);
        if (isNaN(amount) || amount <= 0) {
            toast({ title: "Invalid Amount", variant: "destructive" }); return;
        }

        // Find the default envelope *from the fetched data*
        const envelopes = data.familyMembers[0].allowanceEnvelopes;
        const defaultEnvelope = envelopes.find(env => env.isDefault);

        if (!defaultEnvelope) {
             toast({ title: "Deposit Failed", description: "Default envelope not found.", variant: "destructive" });
             return;
        }

        setIsDepositing(true);
        try {
            // Call the simplified utility, passing current balances
            await depositToSpecificEnvelope(
                db,
                defaultEnvelope.id,
                defaultEnvelope.balances || {}, // Pass current balances
                amount,
                depositCurrency,
                depositDescription.trim()
            );
            toast({ title: "Success", description: `Deposited ${depositCurrency} ${amount}` });
            setDepositAmount(''); setDepositCurrency('USD'); setDepositDescription('');
        } catch (err: any) {
            console.error("Failed to deposit:", err);
            toast({ title: "Deposit Failed", description: err.message, variant: "destructive" });
        } finally {
            setIsDepositing(false);
        }
    };

    // Modal Triggers
    const handleAddClick = () => setIsAddModalOpen(true); // [cite: 437]

    const handleEditClick = useCallback((envelopeId: string) => {
        const envelope = envelopes.find(e => e.id === envelopeId);
        if (envelope) {
            setEnvelopeToEdit(envelope);
            setIsEditModalOpen(true);
        }
    }, [envelopes]);

    const handleTransferClick = useCallback((sourceId: string) => {
        setTransferSourceEnvelopeId(sourceId);
        setIsTransferModalOpen(true);
    }, []);

    const handleDeleteClick = useCallback((envelopeId: string) => {
        const envelope = envelopes.find(e => e.id === envelopeId);
        if (envelope) {
            setEnvelopeToDelete(envelope);
            setIsDeleteModalOpen(true); // Open the generic delete modal/dialog trigger
            // The actual dialog component will handle the logic for default vs non-default
        }
    }, [envelopes]);
    
    // --- Modal Submit Handlers (Implement these within your Modal components or pass them down) ---

    const handleAddEnvelopeSubmit = async (name: string) => {
        if (!db || !memberId || !name.trim()) return;
        try {
            await createAdditionalEnvelope(db, memberId, name); // [cite: 312]
            toast({ title: "Success", description: `Envelope '${name}' created.` });
            setIsAddModalOpen(false);
        } catch (err: any) {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        }
    };

    const handleEditEnvelopeSubmit = async (newName: string) => {
        if (!db || !envelopeToEdit || !newName.trim()) return;
        try {
            await updateEnvelopeName(db, envelopeToEdit.id, newName); // [cite: 358]
            toast({ title: "Success", description: `Envelope renamed to '${newName}'.` });
            setIsEditModalOpen(false);
            setEnvelopeToEdit(null);
        } catch (err: any) {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        }
    };

     const handleTransferSubmit = async (amount: number, currency: string, destinationEnvelopeId: string) => {
        if (!db || !transferSourceEnvelopeId || !destinationEnvelopeId || amount <= 0) return;

        const sourceEnvelope = envelopes.find(e => e.id === transferSourceEnvelopeId);
        const destinationEnvelope = envelopes.find(e => e.id === destinationEnvelopeId);

        if (!sourceEnvelope || !destinationEnvelope) {
            toast({ title: "Error", description: "Could not find source or destination envelope.", variant: "destructive" });
            return;
        }

        try {
            await transferFunds(db, sourceEnvelope, destinationEnvelope, amount, currency); // [cite: 330]
            toast({ title: "Success", description: "Funds transferred." });
            setIsTransferModalOpen(false);
            setTransferSourceEnvelopeId(null);
        } catch (err: any) {
            toast({ title: "Transfer Failed", description: err.message, variant: "destructive" });
        }
    };

    const handleDeleteConfirm = async (transferTargetId: string, newDefaultId: string | null) => {
        // This function would be called by the DeleteEnvelopeDialog upon confirmation
        if (!db || !envelopeToDelete || !transferTargetId) return;

        // The deleteEnvelope utility expects the full list of envelopes [cite: 342]
        try {
            await deleteEnvelope(db, envelopes, envelopeToDelete.id, transferTargetId, newDefaultId); // [cite: 342]
            toast({ title: "Success", description: `Envelope '${envelopeToDelete.name}' deleted.` });
            setIsDeleteModalOpen(false);
            setEnvelopeToDelete(null);
        } catch (err: any) {
            toast({ title: "Delete Failed", description: err.message, variant: "destructive" }); // [cite: 344, 346, 347, 348, 349, 350] etc.
        }
    };

    // --- Render Logic ---
    if (!memberId) return null;
    if (!db) return <div className="p-4 flex justify-center items-center"><Loader2 className="h-6 w-6 animate-spin" />&nbsp;Initializing...</div>; // [cite: 418]
    if (isLoading) return <div className="p-4 flex justify-center items-center"><Loader2 className="h-6 w-6 animate-spin" />&nbsp;Loading allowance...</div>; // [cite: 419]
    if (error || !member) {
        console.error("Error loading member data:", error);
        return <div className="p-4 text-red-600">Error loading allowance details for this member.</div>; // [cite: 421]
    }

    return (
        <div className="p-4 space-y-6 border rounded-lg mt-4 bg-card text-card-foreground">
            <h2 className="text-xl font-bold">Allowance for {member.name}</h2>

            {/* Deposit Section (remains mostly the same) */}
            <section className="p-4 border rounded-md">
                <h3 className="text-lg font-semibold mb-3">Add to Allowance (Default Envelope)</h3>
                <form onSubmit={handleDeposit} className="space-y-3"> {/* [cite: 424] */}
                     <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                         <div>
                             <Label htmlFor="deposit-amount">Amount</Label> {/* [cite: 425] */}
                             <Input
                                 id="deposit-amount"
                                 type="number" // [cite: 426]
                                 value={depositAmount}
                                 onChange={(e) => setDepositAmount(e.target.value)}
                                 placeholder="e.g., 10.00" // [cite: 427]
                                 step="0.01"
                                 required
                            />
                         </div>
                         <div>
                             <Label htmlFor="deposit-currency">Currency</Label> {/* [cite: 428] */}
                             <Input
                                 id="deposit-currency"
                                 type="text" // [cite: 429]
                                 value={depositCurrency}
                                 onChange={(e) => setDepositCurrency(e.target.value.toUpperCase())} // [cite: 430]
                                 placeholder="e.g., USD" // [cite: 430]
                                 maxLength={3}
                                 required // [cite: 431]
                             />
                         </div>
                         <div>
                             <Label htmlFor="deposit-description">Description (Optional)</Label> {/* [cite: 432] */}
                             <Input
                                 id="deposit-description"
                                 type="text" // [cite: 433]
                                 value={depositDescription}
                                 onChange={(e) => setDepositDescription(e.target.value)}
                                 placeholder="e.g., Weekly allowance" // [cite: 434]
                            />
                         </div>
                     </div>
                    <Button type="submit" disabled={isDepositing}>
                        {isDepositing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Depositing...</> : 'Deposit Funds'} {/* [cite: 435, 436] */}
                    </Button>
                </form>
            </section>

            {/* Envelopes Section */}
            <section>
                 <div className="flex justify-between items-center mb-3">
                     <h3 className="text-lg font-semibold">Envelopes</h3> {/* [cite: 437] */}
                     <Button onClick={handleAddClick} size="sm">+ Add Envelope</Button> {/* [cite: 437] */}
                 </div>
                 {/* Render EnvelopeList using EnvelopeItem */}
                 {envelopes.length === 0 && !isLoading && ( // Show 'No envelopes' only if not loading and array is empty [cite: 440]
                    <p className="text-muted-foreground itallic">No envelopes created yet. The initial 'Savings' envelope should appear shortly.</p>
                 )}
                 <div>
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

            {/* --- Modals (Render conditionally based on state) --- */}
            {/* Example Placeholder - Replace with your actual Shadcn Dialogs/Modals */}
            {/*
            <AddEditEnvelopeForm
                isOpen={isAddModalOpen || isEditModalOpen}
                onClose={() => { setIsAddModalOpen(false); setIsEditModalOpen(false); setEnvelopeToEdit(null); }}
                onSubmit={isEditModalOpen ? handleEditEnvelopeSubmit : handleAddEnvelopeSubmit}
                initialData={envelopeToEdit} // Pass null for Add, envelope data for Edit
            />

            <TransferFundsForm
                isOpen={isTransferModalOpen}
                onClose={() => { setIsTransferModalOpen(false); setTransferSourceEnvelopeId(null); }}
                onSubmit={handleTransferSubmit}
                sourceEnvelopeId={transferSourceEnvelopeId}
                allEnvelopes={envelopes} // Pass all envelopes for destination dropdown
                db={db} // May need db if form fetches data itself
            />

             <DeleteEnvelopeDialog
                 isOpen={isDeleteModalOpen}
                 onClose={() => { setIsDeleteModalOpen(false); setEnvelopeToDelete(null); }}
                 onConfirm={handleDeleteConfirm} // This handler takes targetId and newDefaultId
                 envelopeToDelete={envelopeToDelete}
                 allEnvelopes={envelopes} // Pass all envelopes for selection logic
                 db={db} // May need db if dialog fetches data itself
             />
            */}
             {/* Simple Example using basic state for demonstration: */}
             {isAddModalOpen && <div className='p-4 my-2 border rounded bg-secondary'> Add Envelope Modal Placeholder (State: Open) <Button variant="ghost" size="sm" onClick={()=>setIsAddModalOpen(false)}>Close</Button></div>}
             {isEditModalOpen && <div className='p-4 my-2 border rounded bg-secondary'> Edit Envelope Modal Placeholder (Editing: {envelopeToEdit?.name}) <Button variant="ghost" size="sm" onClick={()=>setIsEditModalOpen(false)}>Close</Button></div>}
             {isTransferModalOpen && <div className='p-4 my-2 border rounded bg-secondary'> Transfer Funds Modal Placeholder (From: {transferSourceEnvelopeId}) <Button variant="ghost" size="sm" onClick={()=>setIsTransferModalOpen(false)}>Close</Button></div>}
             {isDeleteModalOpen && <div className='p-4 my-2 border rounded bg-secondary'> Delete Confirmation Modal Placeholder (Deleting: {envelopeToDelete?.name}) <Button variant="ghost" size="sm" onClick={()=>setIsDeleteModalOpen(false)}>Close</Button></div>}


        </div>
    );
}
