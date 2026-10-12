import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { saveSetting, useSetting } from '@/lib/data';
import { useToast } from '@/components/ui/use-toast';

const CurrencySettings: React.FC = () => {
  const { toast } = useToast();
  const [lastCurrencyMessage, setLastCurrencyMessage] = useState<string | null>(null);
  const [isMessageVisible, setIsMessageVisible] = useState(false);

  // USD is enabled until the family chooses otherwise, so nothing needs to be stored before the first change.
  const { data: enabledCurrencies, isLoading, error } = useSetting('enabledCurrencies');

  // Handle the message timeout
  useEffect(() => {
    if (lastCurrencyMessage) {
      setIsMessageVisible(true);
      const timer = setTimeout(() => {
        setIsMessageVisible(false);
        setTimeout(() => {
          setLastCurrencyMessage(null);
        }, 300);
      }, 4000);

      return () => clearTimeout(timer);
    }
  }, [lastCurrencyMessage]);

  const toggleCurrency = async (currency: string) => {
    let newEnabledCurrencies: string[];

    if (!enabledCurrencies.includes(currency)) {
      newEnabledCurrencies = [...enabledCurrencies, currency];
    } else {
      if (enabledCurrencies.length === 1) {
        setLastCurrencyMessage(currency);
        return;
      }
      newEnabledCurrencies = enabledCurrencies.filter((code) => code !== currency);
    }

    try {
      await saveSetting('enabledCurrencies', newEnabledCurrencies);
    } catch (error) {
      console.error('Error updating currency settings:', error);
      toast({
        title: "Error",
        description: "Failed to update currency settings.",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return <div>Error loading settings: {error.message}</div>;
  }

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Currency Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="usd-toggle">United States Dollar (USD)</Label>
              <div className="text-sm text-muted-foreground">
                Track allowances in USD
              </div>
            </div>
            <Switch
              id="usd-toggle"
              checked={enabledCurrencies.includes('USD')}
              onCheckedChange={() => toggleCurrency('USD')}
            />
          </div>
          <div className="h-3">
            {lastCurrencyMessage === 'USD' && (
              <div
                className={`text-sm text-amber-600 dark:text-amber-500 transition-opacity duration-300 ${
                  isMessageVisible ? 'opacity-100' : 'opacity-0'
                }`}
              >
                Must keep at least one currency enabled
              </div>
            )}
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="npr-toggle">Nepali Rupee (NPR)</Label>
              <div className="text-sm text-muted-foreground">
                Track allowances in Nepali Rupees
              </div>
            </div>
            <Switch
              id="npr-toggle"
              checked={enabledCurrencies.includes('NPR')}
              onCheckedChange={() => toggleCurrency('NPR')}
            />
          </div>
          <div className="h-6">
            {lastCurrencyMessage === 'NPR' && (
              <div
                className={`text-sm text-amber-600 dark:text-amber-500 transition-opacity duration-300 ${
                  isMessageVisible ? 'opacity-100' : 'opacity-0'
                }`}
              >
                Must keep at least one currency enabled
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default CurrencySettings;