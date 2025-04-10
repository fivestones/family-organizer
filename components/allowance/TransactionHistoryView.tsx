// components/allowance/TransactionHistoryView.tsx
import React, { useState, useMemo } from 'react';
import { init, tx, id } from '@instantdb/react';
import { Button } from "@/components/ui/button";
import { ArrowLeft, Filter } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBalances, UnitDefinition } from '@/lib/currency-utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge'; // For transaction type

// Define expected Transaction structure based on schema and query
// Needs refinement based on actual query results
interface Transaction {
  id: string;
  amount: number;
  createdAt: string; // ISO String date
  currency: string;
  transactionType: string;
  description?: string | null;
  envelope?: { id: string; name: string; familyMember?: { id: string; name: string } };
  sourceEnvelope?: { id: string; name: string; familyMember?: { id: string; name: string } };
  destinationEnvelope?: { id: string; name: string; familyMember?: { id: string; name: string } };
}

interface TransactionHistoryViewProps {
  db: any;
  mode: 'all' | 'member';
  familyMemberId?: string | null; // Required if mode is 'member'
  unitDefinitions: UnitDefinition[];
  onClose: () => void; // Callback to close/go back
}

// Helper to format date
const formatDate = (dateString: string): string => {
  try {
    return new Date(dateString).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  } catch (e) {
    return dateString; // Fallback
  }
};

// Helper to interpret transaction details
const getTransactionDetails = (tx: Transaction): string => {
    switch (tx.transactionType) {
        case 'deposit':
            return `Deposit to ${tx.envelope?.name || 'N/A'}`;
        case 'withdrawal':
            return `Withdrawal from ${tx.envelope?.name || 'N/A'}`;
        case 'transfer-in':
            return `Transfer from ${tx.sourceEnvelope?.name || 'N/A'} to ${tx.destinationEnvelope?.name || 'N/A'}`;
        case 'transfer-out':
             return `Transfer from ${tx.sourceEnvelope?.name || 'N/A'} to ${tx.destinationEnvelope?.name || 'N/A'}`;
        case 'transfer-in-person':
            return `Transfer from ${tx.sourceEnvelope?.familyMember?.name || 'another member'} (${tx.sourceEnvelope?.name || 'N/A'})`;
        case 'transfer-out-person':
            return `Transfer to ${tx.destinationEnvelope?.familyMember?.name || 'another member'} (${tx.destinationEnvelope?.name || 'N/A'})`;
        default:
            return tx.description || tx.transactionType || 'Unknown transaction';
    }
};

// Helper to get transaction sign/style
const getTransactionStyle = (tx: Transaction): { sign: string; colorClass: string } => {
    if (tx.amount > 0) return { sign: '+', colorClass: 'text-green-600' };
    if (tx.amount < 0) return { sign: '', colorClass: 'text-red-600' }; // Amount already negative
    return { sign: '', colorClass: 'text-muted-foreground' }; // Zero amount?
}


const TransactionHistoryView: React.FC<TransactionHistoryViewProps> = ({
  db,
  mode,
  familyMemberId,
  unitDefinitions,
  onClose,
}) => {
  const [filterCurrency, setFilterCurrency] = useState<string | null>(null); // null means 'all'

  // --- Data Fetching ---
  // Query based on mode
  // Note: Query structure needs careful testing with InstantDB links
  const query = useMemo(() => {
    if (mode === 'member' && familyMemberId) {
       // Fetch member -> envelopes -> transactions, and linked source/dest envelopes + their members
      return {
        "familyMembers": {
          "$": {
            "where": {
              "id": "96a2e5b8-a519-4ec9-a0a8-f57e3417a4c7"
            }
          },
          "allowanceEnvelopes": {
            "transactions": {
              "envelope": {},
              "sourceEnvelope": {
                "familyMember": {}
              },
              "destinationEnvelope": {
                "familyMember": {}
              }
            }
          }
        }
      };
    } else if (mode === 'all') {
      // Fetch ALL transactions and their related envelopes/members
      // This might be performance-intensive and query structure might need adjustment
      return {
        allowanceTransactions: {
            $: {orderBy: {createdAt: 'desc'}}, // Order by newest first
             createdAt: true, amount: true, currency: true, description: true, transactionType: true, id: true,
             envelope: { id: true, name: true, familyMember: { id: true, name: true } }, // Also get member via envelope
             sourceEnvelope: { id: true, name: true, familyMember: { id: true, name: true } },
             destinationEnvelope: { id: true, name: true, familyMember: { id: true, name: true } }
        }
      };
    }
    return {}; // Default empty query if props are invalid
  }, [mode, familyMemberId]);

  const { isLoading, error, data } = db.useQuery(query, { enabled: mode === 'all' || (mode === 'member' && !!familyMemberId) });

  // --- Data Processing ---
  const transactions: Transaction[] = useMemo(() => {
    if (isLoading || error || !data) return [];
    if (mode === 'member') {
      // Flatten transactions from member's envelopes
      return data.familyMembers?.[0]?.allowanceEnvelopes?.flatMap((env: any) => env.transactions || []) || [];
    } else if (mode === 'all') {
      return data.allowanceTransactions || [];
    }
    return [];
  }, [data, isLoading, error, mode]);

  // Get unique currencies for the filter dropdown
  const availableCurrencies = useMemo(() => {
    const currencies = new Set(transactions.map(tx => tx.currency));
    return Array.from(currencies).sort();
  }, [transactions]);

  // Apply currency filter
  const filteredTransactions = useMemo(() => {
    if (!filterCurrency) return transactions; // No filter applied
    return transactions.filter(tx => tx.currency === filterCurrency);
  }, [transactions, filterCurrency]);

  // Sort transactions by date (descending) - API might handle this via query ($orderBy)
   const sortedTransactions = useMemo(() => {
       return [...filteredTransactions].sort((a, b) => {
           try {
               return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
           } catch {
               return 0; // Fallback sort
           }
       });
   }, [filteredTransactions]);


  // --- Render Logic ---
  if (isLoading) return <div className="p-4">Loading transactions...</div>;
  if (error) return <div className="p-4 text-red-600">Error loading transactions: {error.message}</div>;

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 border-b">
        <div className='flex items-center space-x-2'>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Go Back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <CardTitle className="text-lg font-semibold">
                {mode === 'member' ? "Member Transactions" : "All Transactions"}
            </CardTitle>
        </div>
        {/* Currency Filter */}
        <div className="flex items-center space-x-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
             <Select value={filterCurrency || 'all'} onValueChange={(value) => setFilterCurrency(value === 'all' ? null : value)}>
                <SelectTrigger className="w-[120px]">
                    <SelectValue placeholder="Filter Currency" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All Currencies</SelectItem>
                    {availableCurrencies.map(currency => (
                        <SelectItem key={currency} value={currency}>{currency}</SelectItem>
                    ))}
                </SelectContent>
             </Select>
        </div>
      </CardHeader>
      <CardContent className="flex-grow p-0 overflow-hidden">
        <ScrollArea className="h-full p-4"> {/* Add padding inside ScrollArea */}
          {sortedTransactions.length === 0 ? (
            <p className="text-center text-muted-foreground py-10">No transactions found.</p>
          ) : (
            <ul className="space-y-4">
              {sortedTransactions.map(tx => {
                 const { sign, colorClass } = getTransactionStyle(tx);
                 const details = getTransactionDetails(tx);
                 const formattedAmount = formatBalances({ [tx.currency]: Math.abs(tx.amount) }, unitDefinitions);
                 return (
                     <li key={tx.id} className="flex items-center space-x-4 border-b pb-3 last:border-b-0">
                         <div className="flex-shrink-0 w-12 text-center">
                             <span className={`text-xl font-semibold ${colorClass}`}>
                                {sign}{formattedAmount.split(' ')[0]} {/* Show only amount part */}
                             </span>
                              <span className="text-xs text-muted-foreground block">
                                 {tx.currency}
                             </span>
                         </div>
                         <div className="flex-grow">
                              <p className="text-sm font-medium leading-none">{details}</p>
                              {tx.description && <p className="text-xs text-muted-foreground pt-1">{tx.description}</p>}
                              <p className="text-xs text-muted-foreground pt-1">{formatDate(tx.createdAt)}</p>
                         </div>
                          <Badge variant="outline" className="flex-shrink-0">{tx.transactionType}</Badge>
                     </li>
                 );
              })}
            </ul>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
};

export default TransactionHistoryView;