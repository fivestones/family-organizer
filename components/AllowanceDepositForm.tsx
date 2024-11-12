'use client'

// components/AllowanceDepositForm.tsx
import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { tx, id } from '@instantdb/react';

interface AllowanceDepositFormProps {
  familyMember: any; // Family member data passed from AllowancePage
  db: any;
}

const AllowanceDepositForm: React.FC<AllowanceDepositFormProps> = ({ familyMember, db }) => {
  const [amount, setAmount] = useState('');
  const { toast } = useToast();

  const handleDeposit = async () => {
    const depositAmount = parseFloat(amount);
    if (isNaN(depositAmount)) {
      toast({
        title: 'Invalid amount',
        description: 'Please enter a valid number',
        variant: 'destructive',
      });
      return;
    }

    // Initialize or use existing allowance data without querying the database
    const allowanceId = familyMember.allowance?.id || id();

    if (!familyMember.allowance) {
      await db.transact([
        tx.allowance[allowanceId].update({
          totalAmount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          currency: 'USD', // Adjust currency as needed
        }),
        tx.familyMember[familyMember.id].link({ allowance: allowanceId }),
      ]);
    }

    // Create a new transaction and link it to the allowance
    const transactionId = id();
    await db.transact([
      tx.allowanceTransactions[transactionId].update({
        amount: depositAmount,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        currency: 'USD', // Adjust currency as needed
        transactionType: 'deposit',
      }),
      tx.allowance[allowanceId].link({ allowanceTransactions: transactionId }),
    ]);

    // Update the totalAmount in allowance
    const currentTotal = familyMember.allowance?.totalAmount || 0;
    await db.transact([
      tx.allowance[allowanceId].update({
        totalAmount: currentTotal + depositAmount,
        updatedAt: new Date().toISOString(),
      }),
    ]);

    setAmount('');
    toast({
      title: 'Deposit Successful',
      description: `Deposited $${depositAmount.toFixed(2)} to ${familyMember.name}'s allowance.`,
    });
  };

  return (
    <div className="mt-4">
      <h3 className="text-lg font-semibold mb-2">Add to Allowance</h3>
      <div className="flex items-center space-x-2">
        <Input
          type="number"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-32"
        />
        <Button onClick={handleDeposit}>Deposit</Button>
      </div>
    </div>
  );
};

export default AllowanceDepositForm;