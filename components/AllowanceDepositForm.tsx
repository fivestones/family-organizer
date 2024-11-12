'use client'
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

  // Query to get the current allowance data
  const { data } = db.useQuery({
    familyMembers: {
      $: {
        where: {
          id: familyMember.id
        }
      },
      allowance: {
      }
    }
  });
  console.log("familyMember with allowance data: ", data)

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

    const currentAllowance = data?.familyMembers?.[0]?.allowance?.[0];
    const currentTotal = currentAllowance?.totalAmount || 0;
    
    try {
      const transactions = [];
      let allowanceId;

      if (!currentAllowance) {
        // If no allowance exists, create a new one
        allowanceId = id();
        transactions.push(
          tx.allowance[allowanceId].update({
            totalAmount: depositAmount,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            currency: 'USD',
          }),
          tx.familyMembers[familyMember.id].link({ allowance: allowanceId }),
        );
      } else {
        // Update existing allowance
        allowanceId = currentAllowance.id;
        transactions.push(
          tx.allowance[allowanceId].update({
            totalAmount: currentTotal + depositAmount,
            updatedAt: new Date().toISOString(),
          })
        );
      }

      // Always create a transaction record
      const transactionId = id();
      transactions.push(
        tx.allowanceTransactions[transactionId].update({
          amount: depositAmount,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          currency: 'USD',
          transactionType: 'deposit',
        }),
        tx.allowance[allowanceId].link({ allowanceTransactions: transactionId })
      );

      await db.transact(transactions);

      setAmount('');
      toast({
        title: 'Deposit Successful',
        description: `Deposited $${depositAmount.toFixed(2)} to ${familyMember.name}'s allowance.`,
      });
    } catch (error) {
      console.error('Error processing deposit:', error);
      toast({
        title: 'Error',
        description: 'Failed to process deposit. Please try again.',
        variant: 'destructive',
      });
    }
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