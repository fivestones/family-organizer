// components/allowance/MemberAllowanceDetail.tsx
import { init, tx, id } from '@instantdb/react';
import { useState, useEffect, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";

// --- Import Utilities ---
import {
    depositToSpecificEnvelope,
    createInitialSavingsEnvelope
} from '@/lib/currency-utils'; // Adjust path if needed

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

    // --- States ---
    const [isAddEnvelopeOpen, setIsAddEnvelopeOpen] = useState(false);
    // ... other modal states
    const [depositAmount, setDepositAmount] = useState('');
    const [depositCurrency, setDepositCurrency] = useState('USD');
    const [depositDescription, setDepositDescription] = useState('');
    const [isDepositing, setIsDepositing] = useState(false);
    const hasInitializedEnvelope = useRef(false);

    // --- Fetch Member Data (including envelopes) ---
    const { isLoading, error, data } = db.useQuery({
        familyMembers: {
            $: { where: { id: memberId! } },
            // Fetch all envelopes for this member
            allowanceEnvelopes: {}
        }
    });

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
    
        const member = data.familyMembers?.[0];
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
                });
        }
    }, [memberId, db, isLoading, data, toast]);

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

    const openAddEnvelopeModal = () => setIsAddEnvelopeOpen(true);

    // --- Render Logic ---
    if (!memberId) return null;
    // Initial loading state before db or memberId is ready
    if (!db) return <div className="p-4">Initializing...</div>;
    // Loading state while fetching data
    if (isLoading) return <div className="p-4">Loading allowance details...</div>;

    if (error || !data?.familyMembers?.[0]) {
        console.error("Error fetching member data:", error);
        return <div className="p-4 text-red-600">Error loading allowance details.</div>;
    }

    const member = data.familyMembers[0];
    // Get envelopes from the fetched data
    const envelopes = member.allowanceEnvelopes || [];

    return (
        <div className="p-4 space-y-6 border rounded-lg mt-4 bg-card text-card-foreground">
            <h2 className="text-xl font-bold">Allowance for {member.name}</h2>

            {/* --- Add to Allowance Section --- */}
            <section className="p-4 border rounded-md">
                <h3 className="text-lg font-semibold mb-3">Add to Allowance (Default Envelope)</h3>
                <form onSubmit={handleDeposit} className="space-y-3">
                    {/* ... (deposit form structure remains the same) ... */}
                     <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
                        <div>
                             <Label htmlFor="deposit-currency">Currency</Label>
                            <Input
                                id="deposit-currency"
                                type="text"
                                value={depositCurrency}
                                onChange={(e) => setDepositCurrency(e.target.value.toUpperCase())}
                                placeholder="e.g., USD"
                                maxLength={3}
                                required
                             />
                        </div>
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
                        {isDepositing ? 'Depositing...' : 'Deposit Funds'}
                    </Button>
                </form>
            </section>

            {/* Envelopes Section */}
            <section>
                 <div className="flex justify-between items-center mb-3">
                     <h3 className="text-lg font-semibold">Envelopes</h3>
                     {/* Button onClick should trigger modal state change */}
                     <Button onClick={() => setIsAddEnvelopeOpen(true)} size="sm">+ Add Envelope</Button>
                 </div>
                 {/* Replace placeholder with actual EnvelopeList component */}
                 {/* Pass the fetched 'envelopes' array to EnvelopeList */}
                 {/* <EnvelopeList
                     envelopes={envelopes}
                     memberId={memberId}
                     db={db} // Pass db if EnvelopeList needs it for its own actions
                     // Pass handlers for edit/transfer/delete that will fetch necessary data
                     // before calling simplified utility functions.
                 /> */}
                  {envelopes.length === 0 && <p className="text-muted-foreground">No envelopes yet.</p>}
                  {envelopes.length > 0 && (
                    <div className="border rounded p-2 mt-2 bg-muted text-muted-foreground">
                        <p className="font-semibold">Envelope list placeholder:</p>
                        <pre className="text-xs p-2 rounded overflow-x-auto">{JSON.stringify(envelopes, null, 2)}</pre>
                    </div>
                 )}
             </section>

            {/* --- Modals (Placeholders - Render these conditionally) --- */}
             {/* {isAddEnvelopeOpen || isEditEnvelopeOpen ? <AddEditEnvelopeForm ... /> : null } */}
             {/* {isTransferOpen ? <TransferFundsForm ... /> : null } */}
             {/* { isDeleteConfirmationOpen ? <SelectDefaultEnvelopeDialog ... /> : null } */}
        </div>
    );
}