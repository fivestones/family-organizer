import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { tx, id } from '@instantdb/react';

const AllowanceDepositForm = ({ familyMember, db }) => {
  const [amount, setAmount] = useState('');
  const [selectedCurrency, setSelectedCurrency] = useState<string>('');
  const { toast } = useToast();

  // Query both the allowances and enabled currencies from settings
  const { data } = db.useQuery({
    familyMembers: {
      $: {
        where: {
          id: familyMember.id
        }
      },
      allowance: {}
    },
    settings: {
      $: {
        where: {
          name: 'enabledCurrencies'
        }
      }
    }
  });

  // Parse enabled currencies from settings
  const enabledCurrencies = data?.settings?.[0]?.value 
    ? JSON.parse(data.settings[0].value)
    : ['USD'];

  // Set default currency when component mounts or when enabled currencies change
  React.useEffect(() => {
    if (enabledCurrencies.length > 0 && !selectedCurrency) {
      setSelectedCurrency(enabledCurrencies[0]);
    }
  }, [enabledCurrencies, selectedCurrency]);

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

    // Use the single enabled currency if there's only one, otherwise use selected currency
    const currencyToUse = enabledCurrencies.length === 1 ? enabledCurrencies[0] : selectedCurrency;

    try {
      const transactions = [];
      let allowanceId;

      // Find existing allowance entry for this currency
      const existingAllowance = data?.familyMembers?.[0]?.allowance?.find(
        a => a.currency === currencyToUse
      );

      if (!existingAllowance) {
        // Create new allowance entry for this currency
        allowanceId = id();
        transactions.push(
          tx.allowance[allowanceId].update({
            totalAmount: depositAmount,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            currency: currencyToUse,
          }),
          tx.familyMembers[familyMember.id].link({ allowance: allowanceId }),
        );
      } else {
        // Update existing allowance for this currency
        allowanceId = existingAllowance.id;
        transactions.push(
          tx.allowance[allowanceId].update({
            totalAmount: existingAllowance.totalAmount + depositAmount,
            updatedAt: new Date().toISOString(),
          })
        );
      }

      // Create transaction record
      const transactionId = id();
      transactions.push(
        tx.allowanceTransactions[transactionId].update({
          amount: depositAmount,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          currency: currencyToUse,
          transactionType: 'deposit',
        }),
        tx.allowance[allowanceId].link({ allowanceTransactions: transactionId })
      );

      await db.transact(transactions);

      setAmount('');
      toast({
        title: 'Deposit Successful',
        description: `Deposited ${formatCurrency(depositAmount, currencyToUse)} to ${familyMember.name}'s allowance.`,
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

  const formatCurrency = (value: number, currency: string): string => {
    const formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency
    });
    return formatter.format(value);
  };

  return (
    <div className="mt-4">
      <h3 className="text-lg font-semibold mb-2">Add to Allowance</h3>
      <div className="flex items-center space-x-2">
        <div className="relative flex-1">
          <Input
            type="number"
            placeholder="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="pl-7"
          />
          {enabledCurrencies.length === 1 ? (
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500">
              {enabledCurrencies[0] === 'USD' ? '$' : 
               enabledCurrencies[0] === 'NPR' ? 'रू' : ''}
            </span>
          ) : null}
        </div>
        
        {enabledCurrencies.length > 1 && (
          <Select 
            value={selectedCurrency}
            onValueChange={setSelectedCurrency}
          >
            <SelectTrigger className="w-24">
              <SelectValue>
                {selectedCurrency}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {enabledCurrencies.map(currency => (
                <SelectItem key={currency} value={currency}>
                  {currency}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        
        <Button onClick={handleDeposit}>Deposit</Button>
      </div>
    </div>
  );
};

export default AllowanceDepositForm;