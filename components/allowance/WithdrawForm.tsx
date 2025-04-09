// **NEW FILE:** components/allowance/WithdrawForm.tsx
import React, { useState, useEffect, FormEvent, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { Loader2 } from "lucide-react";
import { Envelope, UnitDefinition, formatBalances } from '@/lib/currency-utils'; // Assuming types are exported

interface WithdrawFormProps {
  db: any; // InstantDB instance
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (envelopeId: string, amount: number, currency: string) => Promise<void>; // Callback to parent
  memberEnvelopes: Envelope[]; // All envelopes for the member
  unitDefinitions: UnitDefinition[]; // For formatting display
}

const WithdrawForm: React.FC<WithdrawFormProps> = ({
  db,
  isOpen,
  onClose,
  onSubmit,
  memberEnvelopes,
  unitDefinitions,
}) => {
  const { toast } = useToast();
  const [selectedEnvelopeId, setSelectedEnvelopeId] = useState<string | undefined>(undefined);
  const [selectedCurrency, setSelectedCurrency] = useState<string | undefined>(undefined);
  const [amount, setAmount] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Find the selected envelope object
  const selectedEnvelope = useMemo(() => {
    return memberEnvelopes.find(e => e.id === selectedEnvelopeId);
  }, [selectedEnvelopeId, memberEnvelopes]);

  // Get available currencies with positive balance from the selected envelope
  const availableCurrencies = useMemo(() => {
    if (!selectedEnvelope || !selectedEnvelope.balances) return [];
    return Object.entries(selectedEnvelope.balances)
      .filter(([_, balance]) => balance > 0)
      .map(([currency]) => currency);
  }, [selectedEnvelope]);

  // Get the balance for the selected currency in the selected envelope
  const currentBalance = useMemo(() => {
      if (!selectedEnvelope || !selectedCurrency || !selectedEnvelope.balances) return 0;
      return selectedEnvelope.balances[selectedCurrency] ?? 0;
  }, [selectedEnvelope, selectedCurrency]);

  // Reset currency and amount when envelope changes or modal opens
  useEffect(() => {
    if (isOpen) {
        // Reset dependent fields when envelope changes
        setSelectedCurrency(undefined);
        setAmount('');
        // Don't reset selectedEnvelopeId here, only when modal first opens maybe?
        // If we reset envelopeId, we might need another effect based only on isOpen
    }
  }, [selectedEnvelopeId, isOpen]);

  // Reset form completely when modal opens
   useEffect(() => {
     if (isOpen) {
       setSelectedEnvelopeId(undefined);
       setSelectedCurrency(undefined);
       setAmount('');
       setIsSubmitting(false);
     }
   }, [isOpen]);


  // Reset currency if it becomes unavailable (e.g., balance becomes 0 elsewhere)
  useEffect(() => {
    if (selectedCurrency && !availableCurrencies.includes(selectedCurrency)) {
      setSelectedCurrency(undefined);
    }
  }, [availableCurrencies, selectedCurrency]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const withdrawAmount = parseFloat(amount);

    // --- Validation ---
    if (!selectedEnvelopeId || !selectedCurrency || isNaN(withdrawAmount) || withdrawAmount <= 0) {
      toast({ title: "Validation Error", description: "Please fill all fields with valid values.", variant: "destructive" });
      return;
    }

    if (withdrawAmount > currentBalance) {
         toast({
            title: "Validation Error",
            description: `Insufficient funds. Available: ${formatBalances({[selectedCurrency]: currentBalance}, unitDefinitions)}.`,
            variant: "destructive",
         });
         return;
    }
    // --- End Validation ---

    setIsSubmitting(true);
    try {
      // Call the onSubmit prop passed from the parent, which contains the actual DB logic
      await onSubmit(selectedEnvelopeId, withdrawAmount, selectedCurrency);
      // Parent component (MemberAllowanceDetail) should handle success toast & closing modal
    } catch (err: any) {
      // Parent should ideally handle error toast as well, but log here just in case
      console.error("Withdrawal failed:", err);
      // Optional: Show a generic error toast here if parent doesn't
      // toast({ title: "Withdrawal Failed", description: err.message || "Could not process withdrawal.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  // Check if there are any envelopes to withdraw from
  const canWithdraw = memberEnvelopes && memberEnvelopes.length > 0;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Withdraw Funds</DialogTitle>
        </DialogHeader>
        {!canWithdraw ? (
             <p className="py-4 text-muted-foreground">You need at least one envelope to withdraw funds.</p>
        ) : (
            <form onSubmit={handleSubmit}>
            <div className="grid gap-4 py-4">
                {/* From Envelope */}
                <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="withdraw-envelope" className="text-right">From Envelope</Label>
                <Select
                    value={selectedEnvelopeId}
                    onValueChange={setSelectedEnvelopeId}
                    required
                    disabled={isSubmitting}
                    name="withdraw-envelope"
                >
                    <SelectTrigger className="col-span-3">
                        <SelectValue placeholder="Select envelope..." />
                    </SelectTrigger>
                    <SelectContent>
                    {memberEnvelopes.map(envelope => (
                        <SelectItem key={envelope.id} value={envelope.id}>
                            {envelope.name} ({formatBalances(envelope.balances || {}, unitDefinitions)})
                        </SelectItem>
                    ))}
                    </SelectContent>
                </Select>
                </div>

                {/* Currency */}
                <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="withdraw-currency" className="text-right">Currency/Unit</Label>
                <Select
                    value={selectedCurrency}
                    onValueChange={setSelectedCurrency}
                    required
                    disabled={isSubmitting || !selectedEnvelopeId || availableCurrencies.length === 0}
                    name="withdraw-currency"
                >
                    <SelectTrigger className="col-span-3">
                    <SelectValue placeholder={!selectedEnvelopeId ? "Select envelope first" : availableCurrencies.length === 0 ? "No funds available" : "Select currency..."} />
                    </SelectTrigger>
                    <SelectContent>
                    {availableCurrencies.map(currency => (
                        <SelectItem key={currency} value={currency}>
                            {currency} ({formatBalances({[currency]: selectedEnvelope?.balances?.[currency] ?? 0}, unitDefinitions)})
                        </SelectItem>
                    ))}
                    </SelectContent>
                </Select>
                </div>

                {/* Amount */}
                <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="withdraw-amount" className="text-right">Amount</Label>
                <Input
                    id="withdraw-amount"
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="col-span-3"
                    placeholder="e.g., 5.00"
                    step="0.01" // Adjust step based on currency needs if possible?
                    required
                    disabled={isSubmitting || !selectedCurrency}
                    min="0.01" // Minimum withdraw amount
                    max={currentBalance > 0 ? String(currentBalance) : undefined} // Set max based on available balance
                />
                </div>
            </div>
            <DialogFooter>
                <DialogClose asChild>
                <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
                    Cancel
                </Button>
                </DialogClose>
                <Button
                    type="submit"
                    disabled={
                        isSubmitting ||
                        !selectedEnvelopeId ||
                        !selectedCurrency ||
                        !amount ||
                        parseFloat(amount) <= 0 ||
                        parseFloat(amount) > currentBalance
                    }
                >
                {isSubmitting ? (
                    <> <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Withdrawing... </>
                ) : ( 'Confirm Withdraw' )}
                </Button>
            </DialogFooter>
            </form>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default WithdrawForm;