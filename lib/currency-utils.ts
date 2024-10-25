export interface CurrencyBalance {
    amount: number;
    currency: string;
    exchangeRate?: number;
  }
  
  export interface ConvertibleBalance {
    primaryAmount: number;
    primaryCurrency: string;
    secondaryAmounts: {
      amount: number;
      currency: string;
      exchangeRate: number;
    }[];
  }
  
  export const calculateWeightedExchangeRate = (
    balances: CurrencyBalance[],
    fromCurrency: string,
    toCurrency: string
  ): number => {
    const relevantBalances = balances.filter(
      (b) => b.currency === fromCurrency && b.exchangeRate
    );
  
    if (relevantBalances.length === 0) {
      return 0;
    }
  
    const totalAmount = relevantBalances.reduce((sum, b) => sum + b.amount, 0);
    const weightedSum = relevantBalances.reduce(
      (sum, b) => sum + b.amount * (b.exchangeRate || 0),
      0
    );
  
    return weightedSum / totalAmount;
  };
  
  export const convertCurrency = (
    amount: number,
    fromCurrency: string,
    toCurrency: string,
    exchangeRate: number
  ): number => {
    if (fromCurrency === toCurrency) return amount;
    return amount * exchangeRate;
  };
  
  export const distributeAllowance = (
    amount: number,
    currency: string,
    envelopes: Array<{ id: string; allowancePercentage?: number }>
  ): Array<{ envelopeId: string; amount: number }> => {
    const totalPercentage = envelopes.reduce(
      (sum, env) => sum + (env.allowancePercentage || 0),
      0
    );
  
    if (totalPercentage === 0) {
      // If no percentages are set, all goes to first envelope
      return [{ envelopeId: envelopes[0].id, amount }];
    }
  
    // Scale percentages to 100%
    const scaleFactor = 100 / totalPercentage;
  
    return envelopes
      .filter((env) => env.allowancePercentage && env.allowancePercentage > 0)
      .map((env) => ({
        envelopeId: env.id,
        amount: (amount * (env.allowancePercentage || 0) * scaleFactor) / 100,
      }));
  };
  
  export const canInitiateTransaction = (
    userRole: 'Parent' | 'Child',
    transactionType: 'deposit' | 'withdrawal' | 'transfer'
  ): boolean => {
    if (userRole === 'Parent') return true;
    return transactionType === 'transfer';
  };
  
  export const calculateEnvelopeTotal = (
    transactions: Array<{
      primaryCurrency: string;
      amountPrimary: number;
      secondaryCurrencies?: Array<{
        currency: string;
        amount: number;
        exchangeRate: number;
      }>;
    }>,
    currency: string,
    latestExchangeRate?: number
  ): number => {
    return transactions.reduce((total, transaction) => {
      if (transaction.primaryCurrency === currency) {
        return total + transaction.amountPrimary;
      }
  
      const secondaryCurrency = transaction.secondaryCurrencies?.find(
        (sc) => sc.currency === currency
      );
  
      if (secondaryCurrency) {
        return total + secondaryCurrency.amount;
      }
  
      // If no direct conversion exists but we have a latest exchange rate
      if (latestExchangeRate) {
        return (
          total +
          convertCurrency(
            transaction.amountPrimary,
            transaction.primaryCurrency,
            currency,
            latestExchangeRate
          )
        );
      }
  
      return total;
    }, 0);
  };