// components/allowance/CombinedBalanceDisplay.tsx
import React, { useState, useCallback, useMemo } from 'react';
import { UnitDefinition, formatBalances } from '@/lib/currency-utils'; // [cite: 2]
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"; // [cite: 2]
import { cn } from "@/lib/utils"; // [cite: 3]
import { Loader2, ChevronsUpDown } from 'lucide-react'; // [cite: 3]
// **** NEW: Import DropdownMenu components ****
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"; // Make sure this path is correct

import { Button } from "@/components/ui/button";

interface CombinedBalanceDisplayProps {
  totalBalances: { [currency: string]: number }; // Original balances
  displayCurrency: string; // Target currency
  // **** NEW: Pass final calculated value and breakdown ****
  combinedMonetaryValue: number | null; // Final value in displayCurrency, null if calculation pending/failed
  nonMonetaryBalances: { [currency: string]: number }; // Separated non-monetary
  tooltipLines: string[]; // Pre-calculated breakdown lines
  unitDefinitions: UnitDefinition[];
  onCurrencyChange?: (currencyCode: string) => void;
  className?: string;
  isLoading: boolean;
  // **** NEW PROP ****
  allMonetaryCurrenciesInUse: string[]; // All monetary codes used across app
}

const CombinedBalanceDisplay: React.FC<CombinedBalanceDisplayProps> = ({
  totalBalances,
  displayCurrency,
  combinedMonetaryValue,
  nonMonetaryBalances,
  tooltipLines,
  unitDefinitions,
  onCurrencyChange,
  className,
  isLoading,
  allMonetaryCurrenciesInUse, // Destructure new prop
}) => {
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const [isCurrencyDropdownOpen, setIsCurrencyDropdownOpen] = useState(false); // For dropdown

  // Helper to check if a code is monetary
  const isMonetary = useCallback((code: string): boolean => {
    const unitDefMap = new Map(unitDefinitions.map(def => [def.code.toUpperCase(), def])); // [cite: 9]
    const definition = unitDefMap.get(code.toUpperCase()); // [cite: 10]
    return definition?.isMonetary ?? (code.length === 3 && code.toUpperCase() !== 'STARS'); // [cite: 11]
  }, [unitDefinitions]);

  // Prepare the list for the dropdown - filter and get details
  const dropdownCurrencyOptions = useMemo(() => {
      const unitDefMap = new Map(unitDefinitions.map(def => [def.code.toUpperCase(), def]));
      return allMonetaryCurrenciesInUse
          .filter(code => isMonetary(code)) // Ensure it's monetary
          .map(code => {
              const def = unitDefMap.get(code.toUpperCase());
              return {
                  code: code,
                  // Display format: "USD ($)" or "NPR (रु)" or just "CODE" if no symbol
                  label: def?.symbol ? `${code} (${def.symbol})` : code,
              };
          })
          .sort((a, b) => a.code.localeCompare(b.code)); // Sort alphabetically
  }, [allMonetaryCurrenciesInUse, unitDefinitions, isMonetary]);


  const handleOriginalClick = (currencyCode: string) => {
     if (onCurrencyChange && isMonetary(currencyCode)) { // [cite: 37]
        onCurrencyChange(currencyCode); // [cite: 38]
     }
  };

  const handleDropdownSelect = (currencyCode: string) => {
    if (onCurrencyChange) {
          onCurrencyChange(currencyCode);
     }
    setIsCurrencyDropdownOpen(false); // Close dropdown after selection
  }

  // --- Format Output Strings ---
  const formattedCombinedMonetary = (combinedMonetaryValue !== null)
    ? formatBalances({ [displayCurrency]: combinedMonetaryValue }, unitDefinitions)
    : "Calculating..."; // Placeholder while loading or if failed

  const formattedNonMonetary = formatBalances(nonMonetaryBalances, unitDefinitions); // [cite: 41]
  const hasMonetaryBalances = Object.keys(totalBalances).some(isMonetary); // [cite: 41]
  const hasNonMonetaryBalances = Object.keys(nonMonetaryBalances).length > 0; // [cite: 41]

  // Determine current display currency details for the label
  const currentDisplayUnitDef = useMemo(() => {
      const unitDefMap = new Map(unitDefinitions.map(def => [def.code.toUpperCase(), def]));
      return unitDefMap.get(displayCurrency.toUpperCase());
  }, [displayCurrency, unitDefinitions]);
  const displayCurrencyLabelPart = currentDisplayUnitDef?.symbol
      ? `${currentDisplayUnitDef.symbol} ${displayCurrency}` // e.g., "$ USD"
      : displayCurrency; // Fallback to code

  // **** NEW: Check if displayCurrency exists in *this member's* balances ****
  const displayCurrencyExistsForMember = totalBalances.hasOwnProperty(displayCurrency);

  return (
    <div className={cn("space-y-1", className)}>
       {/* Original Balances (Clickable, with adjusted highlighting) */}
       <p className="text-lg font-medium">
          {Object.entries(totalBalances).map(([code, amount], index, arr) => {
             const monetary = isMonetary(code);
             // **** UPDATED Highlight Logic ****
             const isHighlighted = monetary && code === displayCurrency && displayCurrencyExistsForMember;
             const isClickable = monetary && !!onCurrencyChange;
             const balanceStr = formatBalances({ [code]: amount }, unitDefinitions);

             return (
               <React.Fragment key={code}>
                 {isClickable ? (
                   <button
                     onClick={() => handleOriginalClick(code)}
                     className={cn(
                       "hover:underline focus:underline focus:outline-none rounded px-1 py-0.5 transition-colors",
                       isHighlighted ? "bg-primary/10 text-primary font-semibold" : "hover:bg-muted" // Use isHighlighted flag
                      )} // [cite: 44]
                     title={`Show total in ${code}`}
                     disabled={isLoading} // Disable while loading
                   >
                     {balanceStr}
                   </button>
                 ) : (
                   <span className="px-1 py-0.5">{balanceStr}</span>
                 )}
                 {index < arr.length - 1 && <span className="text-muted-foreground">, </span>}
               </React.Fragment>
             );
          })}
          {Object.keys(totalBalances).length === 0 && <span className="text-muted-foreground italic">No funds available yet.</span>}
       </p>

       {/* Combined Balance */}
       {/* Show combined section if there are monetary balances OR if loading */}
       {(hasMonetaryBalances || isLoading) && (
           <div className="flex items-center space-x-1 text-sm min-h-[20px]"> {/* Reduced space-x */}
                {/* **** UPDATED Label Structure **** */}
                <span className="text-muted-foreground">Combined, in</span>
                {/* Dropdown Trigger Button */}
                <DropdownMenu open={isCurrencyDropdownOpen} onOpenChange={setIsCurrencyDropdownOpen}>
                    <DropdownMenuTrigger asChild>
                         <Button
                            variant="ghost"
                            size="sm" // Smaller size
                            className="px-1.5 py-0.5 h-auto font-semibold hover:bg-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-ring" // Adjust padding/height
                            disabled={isLoading}
                            aria-label={`Change combined balance display currency, currently ${displayCurrencyLabelPart}`}
                         >
                            {displayCurrencyLabelPart}
                            <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                         </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                        {dropdownCurrencyOptions.map(option => (
                            <DropdownMenuItem
                                key={option.code}
                                onSelect={() => handleDropdownSelect(option.code)}
                                className={cn(option.code === displayCurrency && "bg-accent")} // Highlight selected in dropdown
                            >
                                {option.label}
                            </DropdownMenuItem>
                        ))}
                         {dropdownCurrencyOptions.length === 0 && <DropdownMenuItem disabled>No other currencies</DropdownMenuItem>}
                    </DropdownMenuContent>
                </DropdownMenu>
                 <span className="text-muted-foreground">:</span>

                {/* Value and Tooltip */}
                {isLoading ? (
                     <span className="flex items-center space-x-1 font-semibold">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          <span>Calculating...</span>
                     </span>
                ) : combinedMonetaryValue !== null ? (
                  <Popover open={isTooltipOpen} onOpenChange={setIsTooltipOpen}>
                      <PopoverTrigger asChild>
                          <button className="font-semibold hover:underline focus:underline focus:outline-none rounded px-1 py-0.5 hover:bg-muted">
                              {formattedCombinedMonetary}
                          </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-2 text-xs" align="start">
                          <ul className="space-y-0.5">
                                {tooltipLines.length > 0
                                    ? tooltipLines.map((line, i) => <li key={i}>{line}</li>)
                                    : <li>Breakdown unavailable.</li>
                                }
                        </ul>
                    </PopoverContent>
                </Popover>
                ) : (
                     <span className="font-semibold text-muted-foreground italic">Unavailable</span>
                )}
                {/* Add non-monetary part if exists and not loading */}
                {hasNonMonetaryBalances && !isLoading && (
                    <>
                        <span className="text-muted-foreground">,</span>
                        <span className="font-semibold">{formattedNonMonetary}</span>
                    </>
                )}
           </div>
       )}
       {/* If only non-monetary balances exist and not loading */}
       {!hasMonetaryBalances && hasNonMonetaryBalances && !isLoading && (
            <div className="flex items-center space-x-2 text-sm">
                <span className="text-muted-foreground">Total:</span>
                <span className="font-semibold">{formattedNonMonetary}</span>
            </div>
       )}
    </div>
  );
};

export default CombinedBalanceDisplay;