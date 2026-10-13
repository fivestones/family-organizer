// How an amount of money, or of anything else the family counts, is written out. It knows nothing of where
// balances are kept.

export interface UnitDefinition {
    id: string;
    code: string;
    name?: string | null;
    symbol?: string | null;
    isMonetary?: boolean | null;
    symbolPlacement?: 'before' | 'after' | null;
    symbolSpacing?: boolean | null;
    decimalPlaces?: number | null;
}

/**
 * Formats a balance object into a readable string using unit definitions.
 * Example: { "USD": 10.50, "NPR": 1500, "STARS": 25 } => "$10.50, रु1500, ⭐ 25"
 * Assumes unitDefinitions data is provided.
 * @param balances - The balances object { currencyCode: amount }
 * @param unitDefinitions - An array of unit definition objects fetched from the DB.
 * @returns A formatted string representation of the balances.
 */
export const formatBalances = (
    balances: { [currency: string]: number },
    unitDefinitions: UnitDefinition[] = [] // Accept definitions, default to empty array
): string => {
    if (!balances || Object.keys(balances).length === 0) {
        return 'Empty';
    }

    const definitionsMap = new Map(unitDefinitions.map((def) => [def.code.toUpperCase(), def]));

    return (
        Object.entries(balances)
            .map(([currencyCode, amount]) => {
                const upperCaseCode = currencyCode.toUpperCase();
                const definition = definitionsMap.get(upperCaseCode);

                // --- Case 1: Definition Found ---
                if (definition) {
                    const { symbol, isMonetary, symbolPlacement: placementOpt, symbolSpacing: spacingOpt, decimalPlaces: decimalsOpt } = definition;

                    // Determine defaults based on monetary status if options are null/undefined
                    const placement = placementOpt ?? (isMonetary ? 'before' : 'after');
                    const useSpace = spacingOpt ?? placement === 'after'; // Default: space if symbol is after, no space if before
                    const decimals = decimalsOpt ?? (isMonetary ? 2 : 0); // Default: 2 for monetary, 0 for non-monetary

                    const formattingOptions: Intl.NumberFormatOptions = {
                        minimumFractionDigits: decimals,
                        maximumFractionDigits: decimals,
                    };

                    const formattedAmount = amount.toLocaleString(undefined, formattingOptions);

                    // Construct final string
                    if (placement === 'before') {
                        return useSpace ? `${symbol} ${formattedAmount}` : `${symbol}${formattedAmount}`;
                    } else {
                        // placement === 'after'
                        return useSpace ? `${formattedAmount} ${symbol}` : `${formattedAmount}${symbol}`;
                    }
                }

                // --- Case 2: No Definition Found - Try Standard Intl Formatting ---
                try {
                    // Assume it's a standard monetary currency
                    return new Intl.NumberFormat(undefined, {
                        style: 'currency',
                        currency: currencyCode,
                        // Use default decimal places for standard currencies
                    }).format(amount);
                } catch (e) {
                    // --- Case 3: No Definition & Intl Fails - Basic Fallback ---
                    console.warn(`No definition for "${currencyCode}" and Intl formatting failed. Using basic format.`);
                    // Format amount with decimals only if necessary
                    const formattedAmount = amount.toLocaleString(undefined, {
                        minimumFractionDigits: amount % 1 === 0 ? 0 : 2, // Show decimals only if they exist
                        maximumFractionDigits: 20, // Allow high precision if needed
                    });
                    return `${formattedAmount} ${currencyCode}`; // e.g., "125.5 CustomUnit"
                }
            })
            .join(', ') || 'Empty'
    ); // Return "Empty" if all balances were zero
};
