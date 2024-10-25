import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ScrollArea } from "@/components/ui/scroll-area";

const AllowanceTracker = ({ familyMember }) => {
  const [selectedCurrencies, setSelectedCurrencies] = useState({
    USD: true,
    NPR: true,
    stars: true
  });

  // Mock data - will be replaced with real data later
  const envelopes = [
    {
      id: '1',
      name: 'Savings',
      balances: {
        convertible: {
          USD: 23.33,
          NPR: 3079,
          includedPoints: { amount: 100, inUSD: 5 },
          includedStars: { amount: 400, inUSD: 2 }
        },
        nonConvertible: {
          stars: {
            total: 700,
            includedInConvertible: { amount: 400, inUSD: 2 }
          }
        }
      }
    },
    {
      id: '2',
      name: 'Spending money',
      balances: {
        convertible: {
          USD: 12.00,
          NPR: 1608
        }
      }
    },
    {
      id: '3',
      name: 'Tithe',
      balances: {
        convertible: {
          USD: 3.53,
          NPR: 459
        }
      }
    }
  ];

  const formatCurrency = (amount, currency) => {
    if (amount === undefined || amount === null) return '';
    switch (currency) {
      case 'USD':
        return `$${Number(amount).toFixed(2)}`;
      case 'NPR':
        return `NPR ${Number(amount).toFixed(0)}`;
      case 'stars':
        return `${Number(amount)} stars`;
      default:
        return `${Number(amount)}`;
    }
  };

  return (
    <Card className="w-full border shadow-sm">
      <CardHeader className="bg-background border-b">
        <div className="flex items-center justify-between">
          <CardTitle>Allowance Tracker</CardTitle>
          <div className="flex items-center space-x-6">
            {Object.entries(selectedCurrencies).map(([currency, isSelected]) => (
              <div key={currency} className="flex items-center space-x-2">
                <Switch
                  id={`currency-${currency}`}
                  checked={isSelected}
                  onCheckedChange={() => setSelectedCurrencies(prev => ({
                    ...prev,
                    [currency]: !prev[currency]
                  }))}
                />
                <Label htmlFor={`currency-${currency}`} className="text-sm font-medium">
                  {currency}
                </Label>
              </div>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-6">
        <ScrollArea className="h-[calc(100vh-300px)]">
          {envelopes.map(envelope => (
            <div key={envelope.id} className="mb-8">
              <h3 className="text-lg font-semibold mb-3">{envelope.name}</h3>
              {envelope.balances.convertible && (
                <div className="space-y-1">
                  <div className="text-base">
                    {Object.entries(envelope.balances.convertible)
                      .filter(([currency]) => selectedCurrencies[currency] && !currency.includes('included'))
                      .map(([currency, amount], index, array) => (
                        <span key={currency}>
                          {formatCurrency(amount, currency)}
                          {index < array.length - 1 ? ' / ' : ''}
                        </span>
                      ))}
                  </div>
                  {Object.entries(envelope.balances.convertible)
                    .filter(([key]) => key.startsWith('included'))
                    .map(([key, value]) => value && (
                      <div key={key} className="pl-6 text-sm text-muted-foreground">
                        ├── including {formatCurrency(value.amount, key.replace('included', ''))} / {formatCurrency(value.inUSD, 'USD')}
                      </div>
                    ))}
                </div>
              )}
              {envelope.balances.nonConvertible && Object.entries(envelope.balances.nonConvertible)
                .filter(([currency]) => selectedCurrencies[currency])
                .map(([currency, data]) => (
                  <div key={currency} className="mt-2">
                    <div className="text-base">{formatCurrency(data.total, currency)}</div>
                    {data.includedInConvertible && (
                      <div className="pl-6 text-sm text-muted-foreground">
                        └── including {formatCurrency(data.includedInConvertible.amount, currency)} / {formatCurrency(data.includedInConvertible.inUSD, 'USD')}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          ))}
        </ScrollArea>
      </CardContent>
    </Card>
  );
};

export default AllowanceTracker;