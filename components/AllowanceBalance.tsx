import React from 'react';
import { Card, CardContent } from '@/components/ui/card';

interface AllowanceData {
  totalAmount: number;
  currency: string;
}

interface AllowanceBalanceProps {
  familyMember: {
    id: string;
    name: string;
  };
  db: any; // We'll use any for now, but you could create a proper type for the db
}


const AllowanceBalance: React.FC<AllowanceBalanceProps> = ({ familyMember, db }) => {
  const { data } = db.useQuery({
    allowance: {
      $: {
        where: {
          familyMember: familyMember.id
        }
      },
      // totalAmount: true,
      // currency: true
    }
  });

  console.log("data from query to get allowance of familymember ", familyMember.name, " with id ", familyMember.id, ": ", data);


  // Explicitly type and transform the allowance data
  const allowance: AllowanceData = {
    totalAmount: data?.allowance?.[0]?.totalAmount ?? 0,
    currency: data?.allowance?.[0]?.currency ?? 'USD'
  };

  const formatCurrency = (amount: number, currency: string = 'USD'): string => {
    if (amount === undefined || amount === null) return '$0.00';
    
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency
    }).format(amount);
  };

  return (
    <Card className="mb-6">
      <CardContent className="pt-6">
        <div className="text-center">
          <div className="text-sm font-medium text-muted-foreground">
            Current Balance
          </div>
          <div className="text-3xl font-bold mt-1">
            {formatCurrency(allowance.totalAmount, allowance.currency)}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default AllowanceBalance;