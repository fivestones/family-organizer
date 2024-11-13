import React from 'react';
import { Card, CardContent } from '@/components/ui/card';

interface AllowanceData {
  id: string;
  totalAmount: number;
  currency: string;
}

interface AllowanceBalanceProps {
  familyMember: {
    id: string;
    name: string;
  };
  db: any;
}

const AllowanceBalance: React.FC<AllowanceBalanceProps> = ({ familyMember, db }) => {
  const { data } = db.useQuery({
    allowance: {
      $: {
        where: {
          familyMember: familyMember.id
        }
      }
    }
  });

  const formatCurrency = (amount: number, currency: string = 'USD'): string => {
    if (amount === undefined || amount === null) {
      return currency === 'USD' ? '$0.00' : 'रू 0';
    }
    
    if (currency === 'NPR') {
      return `रू ${new Intl.NumberFormat('en-IN').format(amount)}`;
    }

    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency
    }).format(amount);
  };

  // Filter out any null or undefined allowances and sort by currency
  const allowances: AllowanceData[] = (data?.allowance || [])
    .filter(a => a && a.totalAmount !== undefined && a.currency)
    .sort((a, b) => a.currency.localeCompare(b.currency));

  return (
    <Card className="mb-6">
      <CardContent className="pt-6">
        <div className="text-center">
          <div className="text-sm font-medium text-muted-foreground mb-2">
            Current Balance
          </div>
          {allowances.length === 0 ? (
            <div className="text-3xl font-bold mt-1">
              No balance
            </div>
          ) : (
            <div className="space-y-2">
              {allowances.map((allowance) => (
                <div key={allowance.id} className="text-3xl font-bold">
                  {formatCurrency(allowance.totalAmount, allowance.currency)}
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default AllowanceBalance;