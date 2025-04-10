import { tx, id } from '@instantdb/react';

// Define an interface based on your unitDefinitions schema entity
export interface UnitDefinition {
  code: string;
  name?: string | null;
  symbol?: string | null;
  isMonetary?: boolean | null;
  symbolPlacement?: 'before' | 'after' | null;
  symbolSpacing?: boolean | null;
  decimalPlaces?: number | null;
}

export interface CurrencyBalance {
  amount: number;
  currency: string;
  exchangeRate?: number;
}

// --- Helper to find the default envelope ---
/**
 * Finds the default envelope for a given family member.
 * @param db - InstantDB instance
 * @param familyMemberId - ID of the family member
 * @returns The default envelope object or null if none found (should normally not happen after setup)
 */
export const getDefaultEnvelope = async (db: any, familyMemberId: string) => {
  const { data } = await db.useQuery({
      allowanceEnvelopes: {
          $: { where: { familyMember: { id: familyMemberId }, isDefault: true } },
          id: true,
          name: true,
          balances: true,
          isDefault: true,
      }
  });
  if (data.allowanceEnvelopes && data.allowanceEnvelopes.length > 0) {
      return data.allowanceEnvelopes[0];
  }
  // Fallback: If no default explicitly set, maybe return the oldest? Or handle error?
  // For now, returning null, calling code needs to handle.
  console.warn(`No default envelope found for member ${familyMemberId}`);
  return null;
};

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


/**
 * Formats a balance object into a readable string using unit definitions.
 * Example: { "USD": 10.50, "NPR": 1500, "STARS": 25 } => "$10.50, रु. 1,500, ⭐ 25"
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
  return "Empty";
}

const definitionsMap = new Map(unitDefinitions.map(def => [def.code.toUpperCase(), def]));

return Object.entries(balances)
  .map(([currencyCode, amount]) => {
    const upperCaseCode = currencyCode.toUpperCase();
    const definition = definitionsMap.get(upperCaseCode);

    // --- Case 1: Definition Found ---
    if (definition) {
      const {
          symbol,
          isMonetary,
          symbolPlacement: placementOpt,
          symbolSpacing: spacingOpt,
          decimalPlaces: decimalsOpt
      } = definition;

      // Determine defaults based on monetary status if options are null/undefined
      const placement = placementOpt ?? (isMonetary ? 'before' : 'after');
      const useSpace = spacingOpt ?? (placement === 'after'); // Default: space if symbol is after, no space if before
      const decimals = decimalsOpt ?? (isMonetary ? 2 : 0); // Default: 2 for monetary, 0 for non-monetary

      const formattingOptions: Intl.NumberFormatOptions = {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
      };

      const formattedAmount = amount.toLocaleString(undefined, formattingOptions);

      // Construct final string
      if (placement === 'before') {
          return useSpace ? `${symbol} ${formattedAmount}` : `${symbol}${formattedAmount}`;
      } else { // placement === 'after'
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
          minimumFractionDigits: (amount % 1 === 0) ? 0 : 2, // Show decimals only if they exist
          maximumFractionDigits: 20 // Allow high precision if needed
      });
      return `${formattedAmount} ${currencyCode}`; // e.g., "125.5 CustomUnit"
    }
  })
  .join(', ');
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

/**
 * Creates the initial "Savings" envelope. Assumes checks (like envelope count) are done beforehand.
 * @param db - InstantDB instance (from useDB hook)
 * @param familyMemberId - ID of the family member
 */
export const createInitialSavingsEnvelope = async (db: any, familyMemberId: string) => {
  // Function no longer needs to query - assumes calling code verified no envelopes exist.
  const newEnvelopeId = id();
  await db.transact([
      tx.allowanceEnvelopes[newEnvelopeId].update({
          name: "Savings",
          balances: {},
          isDefault: true, // First one is default
          familyMember: familyMemberId,
      }),
  ]);
  console.log(`Created initial Savings envelope ${newEnvelopeId} for member ${familyMemberId}`);
  return newEnvelopeId;
}

/**
 * Creates an additional envelope, optionally setting it as default.
 * Note: Setting as default requires a subsequent call to `setDefaultEnvelope`.
 * @param db - InstantDB instance
 * @param familyMemberId - ID of the family member
 * @param name - Name for the new envelope
 * @param isDefault - Whether this envelope should be the default
 * @returns The ID of the newly created envelope.
 */
export const createAdditionalEnvelope = async (db: any, familyMemberId: string, name: string, isDefault: boolean) => {
  if (!name || name.trim().length === 0) {
      throw new Error("Envelope name cannot be empty.");
  }
  const newEnvelopeId = id();
  await db.transact([
      tx.allowanceEnvelopes[newEnvelopeId].update({
          name: name.trim(),
          balances: {},
          // Set the initial default status directly here
          isDefault: isDefault,
          familyMember: familyMemberId,
      }),
  ]);
  console.log(`Created envelope ${newEnvelopeId} with name '${name}' and isDefault=${isDefault}`);
  return newEnvelopeId; // Return the new ID
};

/**
 * Sets a specific envelope as the default. Ensures any previously default envelope is unset.
 * @param db - InstantDB instance
 * @param envelopes - Array of current envelope objects for the member (fetched in component)
 * @param newDefaultEnvelopeId - ID of the envelope to set as default
 */
export const setDefaultEnvelope = async (db: any, envelopes: Envelope[], newDefaultEnvelopeId: string) => {
  console.log(`Attempting to set default: ${newDefaultEnvelopeId}. Current envelopes:`, envelopes);
  const transactions: any[] = [];
  let currentDefaultId: string | null = null;
  let newDefaultExists = false;

  envelopes.forEach((env: Envelope) => { // Use Envelope type
      if (env.id === newDefaultEnvelopeId) {
           newDefaultExists = true;
           // If it's the target AND it's not already default, mark it for update
           if (!env.isDefault) {
               console.log(`Marking ${env.id} to become default.`);
               transactions.push(tx.allowanceEnvelopes[env.id].update({ isDefault: true }));
           } else {
                console.log(`${env.id} is already default.`);
           }
      } else if (env.isDefault) {
           // If it's NOT the target, but IS currently default, mark it to be unset
           console.log(`Marking old default ${env.id} to be unset.`);
           currentDefaultId = env.id; // Keep track of the one we are unsetting
           transactions.push(tx.allowanceEnvelopes[env.id].update({ isDefault: false }));
      }
  });

   // Handle case where the newDefaultEnvelopeId wasn't in the original list (e.g., just created)
   if (!newDefaultExists) {
       console.log(`New default ${newDefaultEnvelopeId} was not in the initial list, marking for update.`);
       transactions.push(tx.allowanceEnvelopes[newDefaultEnvelopeId].update({ isDefault: true }));
       // We still need to ensure the old default (if one exists) is unset.
       // The loop above should have already added the transaction to unset the currentDefaultId if it exists.
   }


  if (transactions.length > 0) {
      console.log("Executing transactions:", transactions);
      await db.transact(transactions);
      console.log("Default envelope transaction successful.");
  } else if (newDefaultExists && envelopes.find(e => e.id === newDefaultEnvelopeId)?.isDefault) {
       console.log("No changes needed, target envelope is already the default.");
  } else {
      console.warn("Set default called, but no transactions were generated. Target ID:", newDefaultEnvelopeId);
      // This might happen if the target ID doesn't exist, which should ideally be caught earlier.
      // Or if the target was already default and there was no other default to unset.
  }
};

/**
 * Deposits funds into a specific envelope. Needs the current balances.
 * @param db - InstantDB instance
 * @param envelopeId - ID of the specific envelope
 * @param currentBalances - The current balances object of the envelope (fetched in component)
 * @param amount - Amount to deposit
 * @param currency - Currency of the deposit
 * @param description - Optional description
 */
export const depositToSpecificEnvelope = async (db: any, envelopeId: string, currentBalances: { [currency: string]: number }, amount: number, currency: string, description: string = "Deposit") => {
  if (amount <= 0) throw new Error("Deposit amount must be positive.");

  // Logic now uses passed 'currentBalances' instead of querying
  const balances = currentBalances || {};
  const newBalance = (balances[currency] || 0) + amount;
  const updatedBalances = { ...balances, [currency]: newBalance };
  const transactionId = id();

  await db.transact([
      tx.allowanceEnvelopes[envelopeId].update({ balances: updatedBalances }),
      tx.allowanceTransactions[transactionId].update({
          amount: amount, currency: currency, transactionType: 'deposit',
          envelope: envelopeId, destinationEnvelope: envelopeId, //sourceEnvelope: null,
          description: description, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      })
  ]);
};

/**
 * Transfers funds between two envelopes. Needs current balances for both.
 * @param db - InstantDB instance
 * @param fromEnvelope - Source envelope object (fetched in component)
 * @param toEnvelope - Destination envelope object (fetched in component)
 * @param amount - Amount to transfer
 * @param currency - Currency of the transfer
 */
export const transferFunds = async (db: any, fromEnvelope: any, toEnvelope: any, amount: number, currency: string) => {
  if (amount <= 0) throw new Error("Transfer amount must be positive.");
  if (!fromEnvelope || !toEnvelope) throw new Error("Source or destination envelope data missing.");
  if (fromEnvelope.id === toEnvelope.id) throw new Error("Cannot transfer funds to the same envelope.");

  // Logic uses passed envelope objects instead of querying
  const fromBalances = fromEnvelope.balances || {};
  const toBalances = toEnvelope.balances || {};
  const currentFromBalance = fromBalances[currency] || 0;

  if (currentFromBalance < amount) throw new Error(`Insufficient ${currency} funds in ${fromEnvelope.name}.`);

  const newFromBalance = currentFromBalance - amount;
  const newToBalance = (toBalances[currency] || 0) + amount;
  const updatedFromBalances = { ...fromBalances, [currency]: newFromBalance };
  const updatedToBalances = { ...toBalances, [currency]: newToBalance };
  if (updatedFromBalances[currency] === 0) delete updatedFromBalances[currency];

  const transferDesc = `Transfer from ${fromEnvelope.name} to ${toEnvelope.name}`;
  const transactionIdOut = id();
  const transactionIdIn = id();

  await db.transact([
    tx.allowanceEnvelopes[fromEnvelope.id].update({ balances: updatedFromBalances }),
    tx.allowanceEnvelopes[toEnvelope.id].update({ balances: updatedToBalances }),
    tx.allowanceTransactions[transactionIdOut].update({
        amount: -amount, currency: currency, transactionType: 'transfer-out',
        envelope: fromEnvelope.id, sourceEnvelope: fromEnvelope.id, destinationEnvelope: toEnvelope.id,
        description: transferDesc, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }),
    tx.allowanceTransactions[transactionIdIn].update({
        amount: amount, currency: currency, transactionType: 'transfer-in',
        envelope: toEnvelope.id, sourceEnvelope: fromEnvelope.id, destinationEnvelope: toEnvelope.id,
        description: transferDesc, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }),
  ]);
};

/**
 * Deletes an envelope. Needs the list of all envelopes for the member.
 * @param db - InstantDB instance
 * @param allEnvelopes - Array of all envelope objects for the member (fetched in component)
 * @param envelopeToDeleteId - ID of the envelope to delete
 * @param transferToEnvelopeId - ID of the envelope to transfer funds to
 * @param newDefaultEnvelopeId - Optional: ID to become new default if deleting the default
 */
export const deleteEnvelope = async (
    db: any,
    allEnvelopes: any[],
    envelopeToDeleteId: string,
    transferToEnvelopeId: string,
    newDefaultEnvelopeId: string | null = null
  ) => {

  if (envelopeToDeleteId === transferToEnvelopeId) throw new Error("Cannot transfer funds to the envelope being deleted.");

  // Logic uses passed 'allEnvelopes' array instead of querying
  if (!allEnvelopes || allEnvelopes.length <= 1) throw new Error("Cannot delete the last envelope.");

  const envelopeToDelete = allEnvelopes.find((e: any) => e.id === envelopeToDeleteId);
  const targetEnvelope = allEnvelopes.find((e: any) => e.id === transferToEnvelopeId);

  if (!envelopeToDelete) throw new Error("Envelope to delete not found in provided list.");
  if (!targetEnvelope) throw new Error("Envelope to transfer funds to not found in provided list.");
  if (envelopeToDelete.isDefault && !newDefaultEnvelopeId) throw new Error("Must specify a new default envelope.");
  if (envelopeToDelete.isDefault && newDefaultEnvelopeId === envelopeToDeleteId) throw new Error("New default cannot be the deleted envelope.");
  if (newDefaultEnvelopeId && !allEnvelopes.some((e: any) => e.id === newDefaultEnvelopeId)) throw new Error(`Specified new default envelope (${newDefaultEnvelopeId}) not found in list.`);

  const balancesToDelete = envelopeToDelete.balances || {};
  const transactions: any[] = [];
  const targetBalances = targetEnvelope.balances || {};
  const updatedTargetBalances = { ...targetBalances };

  // Transfer funds logic
  for (const currency in balancesToDelete) {
    const amount = balancesToDelete[currency];
    if (amount > 0) {
      updatedTargetBalances[currency] = (updatedTargetBalances[currency] || 0) + amount;
      // ... (create transaction records as before) ...
      const transferDesc = `Transfer from deleted envelope ${envelopeToDelete.name} to ${targetEnvelope.name}`;
      const transactionIdOut = id();
      const transactionIdIn = id();
      transactions.push(tx.allowanceTransactions[transactionIdOut].update({ /* ... */ }));
      transactions.push(tx.allowanceTransactions[transactionIdIn].update({ /* ... */ }));
    }
  }
  transactions.push(tx.allowanceEnvelopes[transferToEnvelopeId].update({ balances: updatedTargetBalances }));

  // Set new default logic
  if (envelopeToDelete.isDefault && newDefaultEnvelopeId) {
       transactions.push(tx.allowanceEnvelopes[newDefaultEnvelopeId].update({ isDefault: true }));
  }

  // Add delete transaction
  transactions.push(tx.allowanceEnvelopes[envelopeToDeleteId].delete());

  await db.transact(transactions);
};


/**
 * Updates the name and/or default status of an envelope.
 * Note: Changing the default status requires a subsequent call to `setDefaultEnvelope`.
 * @param db - InstantDB instance
 * @param envelopeId - ID of the envelope to update
 * @param newName - The new name for the envelope
 * @param isDefault - The new default status for the envelope
 */
export const updateEnvelope = async (db: any, envelopeId: string, newName: string, isDefault: boolean) => {
  const trimmedName = newName.trim();
  if (!trimmedName) throw new Error("Envelope name cannot be empty.");

  console.log(`Updating envelope ${envelopeId}: name='${trimmedName}', isDefault=${isDefault}`);
  await db.transact([
      // Update name and default status in one go.
      // The subsequent call to setDefaultEnvelope will handle unsetting the *previous* default if necessary.
      tx.allowanceEnvelopes[envelopeId].update({ name: trimmedName, isDefault: isDefault })
  ]);
  console.log("Envelope update transaction successful.");
};

/**
 * Withdraws funds from a specific envelope.
 * @param db - InstantDB instance
 * @param envelope - The envelope object to withdraw from (must include current balances)
 * @param amount - Amount to withdraw (must be positive)
 * @param currency - Currency code of the withdrawal
 * @param description - Optional description for the transaction log
 * @throws Will throw an error if amount is invalid or insufficient funds.
 */
export const withdrawFromEnvelope = async (
  db: any,
  envelope: Envelope, // Pass the full envelope object
  amount: number,
  currency: string,
  description: string = "Withdrawal"
) => {
if (amount <= 0) {
  throw new Error("Withdrawal amount must be positive.");
}
if (!envelope || !envelope.balances) {
  throw new Error("Invalid envelope data provided.");
}

const upperCaseCurrency = currency.toUpperCase();
const currentBalance = envelope.balances[upperCaseCurrency] || 0;

if (currentBalance < amount) {
  throw new Error(`Insufficient ${upperCaseCurrency} funds in ${envelope.name}. Available: ${currentBalance}, Tried: ${amount}`);
}

// Calculate new balance
const newBalance = currentBalance - amount;
const updatedBalances = { ...envelope.balances };

// Remove currency from balances if zero, otherwise update it
if (newBalance === 0) {
  delete updatedBalances[upperCaseCurrency];
} else {
  updatedBalances[upperCaseCurrency] = newBalance;
}

// Create transaction record
const transactionId = id();
const withdrawalTransaction = tx.allowanceTransactions[transactionId].update({
    amount: -amount, // Store withdrawal as negative amount for consistency? Or use type field only. Using negative here.
    currency: upperCaseCurrency,
    transactionType: 'withdrawal',
    envelope: envelope.id, // Link to the envelope it affected
    // sourceEnvelope: envelope.id, // Could arguably be source
    // destinationEnvelope: null, // No destination
    description: description,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
});

// Perform transaction
await db.transact([
  tx.allowanceEnvelopes[envelope.id].update({ balances: updatedBalances }),
  withdrawalTransaction
]);

console.log(`Withdrew ${upperCaseCurrency} ${amount} from envelope ${envelope.id}`);
};

/**
 * Transfers funds from a source envelope to a destination envelope (potentially belonging to a different member).
 * Assumes destinationEnvelope is fetched and provided (e.g., recipient's default envelope).
 * @param db - InstantDB instance
 * @param sourceEnvelope - The source envelope object (must include current balances & ID)
 * @param destinationEnvelope - The destination envelope object (must include current balances & ID)
 * @param amount - Amount to transfer (must be positive)
 * @param currency - Currency code of the transfer
 * @param description - Optional description for the transaction log
 * @throws Will throw an error if amount is invalid, envelopes are invalid, or insufficient funds.
 */
export const transferFundsToPerson = async (
  db: any,
  sourceEnvelope: Envelope,
  destinationEnvelope: Envelope,
  amount: number,
  currency: string,
  description?: string // Allow optional description
) => {
if (amount <= 0) {
  throw new Error("Transfer amount must be positive.");
}
if (!sourceEnvelope || !sourceEnvelope.balances || !sourceEnvelope.id) {
  throw new Error("Invalid source envelope data provided.");
}
 if (!destinationEnvelope || !destinationEnvelope.balances || !destinationEnvelope.id) {
  throw new Error("Invalid destination envelope data provided.");
}
if (sourceEnvelope.id === destinationEnvelope.id) {
  // Use the existing intra-member transfer function for this case if needed
  throw new Error("Source and destination envelopes cannot be the same. Use regular transfer for intra-member moves.");
}

const upperCaseCurrency = currency.toUpperCase();
const sourceCurrentBalance = sourceEnvelope.balances[upperCaseCurrency] || 0;

if (sourceCurrentBalance < amount) {
  throw new Error(`Insufficient ${upperCaseCurrency} funds in source envelope (${sourceEnvelope.name}). Available: ${sourceCurrentBalance}, Tried: ${amount}`);
}

// Calculate new balances
const sourceNewBalance = sourceCurrentBalance - amount;
const updatedSourceBalances = { ...sourceEnvelope.balances };
if (sourceNewBalance === 0) {
  delete updatedSourceBalances[upperCaseCurrency];
} else {
  updatedSourceBalances[upperCaseCurrency] = sourceNewBalance;
}

const destinationCurrentBalance = destinationEnvelope.balances[upperCaseCurrency] || 0;
const destinationNewBalance = destinationCurrentBalance + amount;
const updatedDestinationBalances = { ...destinationEnvelope.balances, [upperCaseCurrency]: destinationNewBalance };

// Create transaction records
const transactionIdOut = id();
const transactionIdIn = id();
const transferDesc = description || `Transfer to ${destinationEnvelope.name}`; // Default description if none provided

// Transaction for the sender
const transferOutTransaction = tx.allowanceTransactions[transactionIdOut].update({
    amount: -amount, // Negative amount for outgoing
    currency: upperCaseCurrency,
    transactionType: 'transfer-out-person', // Specific type for inter-person transfer
    envelope: sourceEnvelope.id, // Envelope the transaction is logged against
    sourceEnvelope: sourceEnvelope.id, // Source of funds
    destinationEnvelope: destinationEnvelope.id, // Destination of funds
    description: transferDesc,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    // Consider adding sourceMemberId and destinationMemberId if schema supports/needs it
});

// Transaction for the receiver
const transferInTransaction = tx.allowanceTransactions[transactionIdIn].update({
    amount: amount, // Positive amount for incoming
    currency: upperCaseCurrency,
    transactionType: 'transfer-in-person', // Specific type for inter-person transfer
    envelope: destinationEnvelope.id, // Envelope the transaction is logged against
    sourceEnvelope: sourceEnvelope.id, // Source of funds
    destinationEnvelope: destinationEnvelope.id, // Destination of funds
    description: transferDesc,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    // Consider adding sourceMemberId and destinationMemberId if schema supports/needs it
});


// Perform transaction
await db.transact([
  // Update source envelope balance
  tx.allowanceEnvelopes[sourceEnvelope.id].update({ balances: updatedSourceBalances }),
  // Update destination envelope balance
  tx.allowanceEnvelopes[destinationEnvelope.id].update({ balances: updatedDestinationBalances }),
  // Log the outgoing transaction
  transferOutTransaction,
  // Log the incoming transaction
  transferInTransaction
]);

console.log(`Transferred ${upperCaseCurrency} ${amount} from envelope ${sourceEnvelope.id} to ${destinationEnvelope.id}`);
};