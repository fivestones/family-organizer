import { tx, id } from '@instantdb/react';

// Define an interface based on your unitDefinitions schema entity
export interface UnitDefinition {
  id: string; // Include ID
  code: string;
  name?: string | null;
  symbol?: string | null;
  isMonetary?: boolean | null;
  symbolPlacement?: 'before' | 'after' | null;
  symbolSpacing?: boolean | null;
  decimalPlaces?: number | null;
}

// **** UPDATED Envelope interface to include goal fields ****
export interface Envelope {
  id: string;
  name: string;
  balances: { [currency: string]: number };
  isDefault?: boolean | null;
  // Add optional goal fields
  goalAmount?: number | null;
  goalCurrency?: string | null;
  // relationships (may not be populated depending on query)
  familyMember?: { id: string, name: string }[];
  transactions?: any[]; // Define more strictly if needed
  outgoingTransfers?: any[];
  incomingTransfers?: any[];
}


export interface CurrencyBalance {
  amount: number;
  currency: string;
  exchangeRate?: number;
}

// Interface for cached exchange rates
export interface CachedExchangeRate {
  id: string;
  baseCurrency: string;
  targetCurrency: string;
  rate: number;
  lastFetchedTimestamp: Date; // Use Date object for easier comparison
}

// Interface for the result of getting a rate
export interface ExchangeRateResult {
  rate: number | null; // The rate (fromCurrency -> toCurrency)
  source: 'cache' | 'calculated' | 'api' | 'identity' | 'unavailable';
  needsApiFetch: boolean;
  calculationTimestamp?: Date;
}

// +++ New Interface for Goal Progress Result +++
export interface GoalProgressResult {
  totalValueInGoalCurrency: number | null;
  percentage: number | null;
  errors: string[]; // To report issues like missing rates
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

// **** NEW: Constants ****
const OPEN_EXCHANGE_RATES_APP_ID = 'a6175466a16c4ce3b3cdbf9fbb50cb7e';
const EXCHANGE_RATE_CACHE_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours; this should cause a maximum of 360 or so api calls per month to openexchangerates.org's api; we have 1000/month in the free tier
const BASE_CURRENCY = "USD"; // API Base

export interface ConvertibleBalance {
  primaryAmount: number;
  primaryCurrency: string;
  secondaryAmounts: {
    amount: number;
    currency: string;
    exchangeRate: number;
  }[];
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
    .join(', ') || "Empty"; // Return "Empty" if all balances were zero
};

// To do:
// This isn't used at the moment, but once we implement percentages for envelopes, we can then used it.
// For family members who have set percentages for envelopes, we will distribute their allowance deposits using the distribute by percentage method
// (used here) instead of distributing all to their default
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

// To do:
// This is not used at the moment, but when we implement roles for each user, and logins, we will need to use this
// to see who can initiate certain transactions.
// At the moment, it's pretty simple, and will need to be expanded on.
// Children should be able to initiate transfers from one of their envelopes to another of their own envelopes, and
// from one of their envelopes to another person. But they should not be able to initiate transfers from an envelope
// belonging to someone else. They also should not be able to do withdrawals or deposits.
// Parents should be able to initiate any of the transaction types
export const canInitiateTransaction = (
  userRole: 'Parent' | 'Child',
  transactionType: 'deposit' | 'withdrawal' | 'transfer'
): boolean => {
  if (userRole === 'Parent') return true;
  return transactionType === 'transfer';
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
      // Goal fields initially null
      goalAmount: null,
      goalCurrency: null,
      }),
  ]);
  console.log(`Created initial Savings envelope ${newEnvelopeId} for member ${familyMemberId}`);
  return newEnvelopeId;
}

/**
 * Creates an additional envelope, optionally setting it as default and adding goal info.
 * Note: Setting as default requires a subsequent call to `setDefaultEnvelope`.
 * @param db - InstantDB instance
 * @param familyMemberId - ID of the family member
 * @param name - Name for the new envelope
 * @param isDefault - Whether this envelope should be the default
 * @returns The ID of the newly created envelope.
 */
export const createAdditionalEnvelope = async (
  db: any,
  familyMemberId: string,
  name: string,
  isDefault: boolean,
  goalAmount?: number | null,
  goalCurrency?: string | null
) => {
  if (!name || name.trim().length === 0) {
      throw new Error("Envelope name cannot be empty.");
  }
  if (goalAmount !== null && goalAmount !== undefined && goalAmount <= 0) {
    throw new Error("Goal amount must be positive if set.");
  }
  if ((goalAmount !== null && goalAmount !== undefined) && (!goalCurrency)) {
      throw new Error("Goal currency must be specified if goal amount is set.");
  }
  if (goalCurrency && (goalAmount === null || goalAmount === undefined)) {
      throw new Error("Goal amount must be specified if goal currency is set.");
  }


  const newEnvelopeId = id();
  await db.transact([
      tx.allowanceEnvelopes[newEnvelopeId].update({
        name: name.trim(),
        balances: {},
        // Set the initial default status directly here
        isDefault: isDefault,
        familyMember: familyMemberId,
        goalAmount: goalAmount ?? null, // Store as null if not provided
        goalCurrency: goalCurrency ?? null,
      }),
  ]);
  console.log(`Created envelope ${newEnvelopeId} with name '${name}', isDefault=${isDefault}, goal=${goalCurrency || ''} ${goalAmount || ''}`);
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
  allEnvelopes: Envelope[], // Use Envelope type
    envelopeToDeleteId: string,
    transferToEnvelopeId: string,
    newDefaultEnvelopeId: string | null = null
  ) => {

  if (envelopeToDeleteId === transferToEnvelopeId) throw new Error("Cannot transfer funds to the envelope being deleted.");

  // Logic uses passed 'allEnvelopes' array instead of querying
  if (!allEnvelopes || allEnvelopes.length <= 1) throw new Error("Cannot delete the last envelope.");

  const envelopeToDelete = allEnvelopes.find((e) => e.id === envelopeToDeleteId);
  const targetEnvelope = allEnvelopes.find((e) => e.id === transferToEnvelopeId);

  if (!envelopeToDelete) throw new Error("Envelope to delete not found in provided list.");
  if (!targetEnvelope) throw new Error("Envelope to transfer funds to not found in provided list.");
  if (envelopeToDelete.isDefault && !newDefaultEnvelopeId) throw new Error("Must specify a new default envelope.");
  if (envelopeToDelete.isDefault && newDefaultEnvelopeId === envelopeToDeleteId) throw new Error("New default cannot be the deleted envelope.");
  if (newDefaultEnvelopeId && !allEnvelopes.some((e) => e.id === newDefaultEnvelopeId)) throw new Error(`Specified new default envelope (${newDefaultEnvelopeId}) not found in list.`);

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
      transactions.push(tx.allowanceTransactions[transactionIdOut].update({
        amount: -amount, currency: currency, transactionType: 'transfer-out',
        envelope: envelopeToDeleteId, sourceEnvelope: envelopeToDeleteId, destinationEnvelope: transferToEnvelopeId,
        description: transferDesc, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }));
      transactions.push(tx.allowanceTransactions[transactionIdIn].update({
        amount: amount, currency: currency, transactionType: 'transfer-in',
        envelope: transferToEnvelopeId, sourceEnvelope: envelopeToDeleteId, destinationEnvelope: transferToEnvelopeId,
        description: transferDesc, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }));
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
 * Updates the name, default status, and goal information of an envelope.
 * Note: Changing the default status requires a subsequent call to `setDefaultEnvelope`.
 * @param db - InstantDB instance
 * @param envelopeId - ID of the envelope to update
 * @param newName - The new name for the envelope
 * @param isDefault - The new default status for the envelope
 */
export const updateEnvelope = async (
  db: any,
  envelopeId: string,
  newName: string,
  isDefault: boolean,
  goalAmount?: number | null,
  goalCurrency?: string | null
) => {
  const trimmedName = newName.trim();
  if (!trimmedName) throw new Error("Envelope name cannot be empty.");
  if (goalAmount !== null && goalAmount !== undefined && goalAmount <= 0) {
    throw new Error("Goal amount must be positive if set.");
  }
  if ((goalAmount !== null && goalAmount !== undefined) && (!goalCurrency)) {
      throw new Error("Goal currency must be specified if goal amount is set.");
  }
  if (goalCurrency && (goalAmount === null || goalAmount === undefined)) {
      throw new Error("Goal amount must be specified if goal currency is set.");
  }


  console.log(`Updating envelope ${envelopeId}: name='${trimmedName}', isDefault=${isDefault}, goal=${goalCurrency || ''} ${goalAmount || ''}`);
  await db.transact([
    tx.allowanceEnvelopes[envelopeId].update({
      name: trimmedName,
      isDefault: isDefault,
      goalAmount: goalAmount ?? null,
      goalCurrency: goalCurrency ?? null,
    })
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
const transferDesc = description || `Transfer to ${(destinationEnvelope as any).familyMember?.[0]?.name || 'other member'} - ${destinationEnvelope.name}`; // Try to get recipient name  // this line was `const transferDesc = description || `Transfer to ${destinationEnvelope.name}`; // Default description if none provided`

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


// --- Exchange Rate Functions ---

/**
 * Fetches the latest exchange rates from Open Exchange Rates API.
 * NOTE: This uses the web 'fetch' API. Ensure it's available in your environment.
 * @param baseCurrency - The base currency (usually USD for free tier).
 * @returns The API response containing rates.
 */
export const fetchExternalExchangeRates = async () => {
    const url = `https://openexchangerates.org/api/latest.json?app_id=${OPEN_EXCHANGE_RATES_APP_ID}&base=${BASE_CURRENCY}`;
  try {
      console.log(`Workspaceing exchange rates from: ${url}`);
      const response = await fetch(url);
      if (!response.ok) {
          throw new Error(`API Error (${response.status}): ${response.statusText}`);
      }
      const data = await response.json();
        if (data.error) { /* handle error */ throw new Error(`API Error (${data.status}): ${data.description}`); }
        if (!data.rates || typeof data.rates !== 'object') { throw new Error("Invalid rates data received from API."); }
      console.log("API Response:", data);
        return data; // Contains { base: "USD", rates: { ... }, timestamp: ... }
  } catch (error) {
      console.error("Failed to fetch external exchange rates:", error);
      throw error; // Re-throw to be caught by calling function
  }
};

const findRateInCache = (baseCurrency: string, targetCurrency: string, cachedRates: CachedExchangeRate[]): CachedExchangeRate | null => {
  // Find the most recent valid entry for the pair
  const rates = cachedRates
      .filter(r => r.baseCurrency === baseCurrency && r.targetCurrency === targetCurrency)
      .sort((a, b) => b.lastFetchedTimestamp.getTime() - a.lastFetchedTimestamp.getTime()); // Sort descending by time
  return rates[0] || null; // Return the latest one found
};

const isRateValid = (cachedRate: CachedExchangeRate | null): boolean => {
  if (!cachedRate) return false;
  const now = new Date();
  const fetchedTime = cachedRate.lastFetchedTimestamp; // Should be a Date object now
  if (!(fetchedTime instanceof Date) || isNaN(fetchedTime.getTime())) return false; // Invalid date
  return (now.getTime() - fetchedTime.getTime()) < EXCHANGE_RATE_CACHE_DURATION_MS;
};

// /**
// * Retrieves a cached exchange rate from InstantDB for a specific target currency.
// * @param db - InstantDB instance.
// * @param targetCurrency - The target currency code (e.g., "NPR").
// * @param baseCurrency - The base currency code (e.g., "USD").
// * @returns The cached rate object { id, rate, lastFetchedTimestamp } or null if not found/error.
// */
// export const getCachedExchangeRate = async (db: any, targetCurrency: string, baseCurrency: string = "USD"): Promise<CachedExchangeRate | null> => {
//   try {
//       const query = {
//           exchangeRates: {
//               $: {
//                   where: { baseCurrency: baseCurrency, targetCurrency: targetCurrency },
//                   limit: 1 // Expecting only one rate per pair
//               }
//           }
//       };
//       // Use queryOnce as we need the data immediately, not a subscription [cite: 129]
//       const { data, error } = await db.queryOnce(query);

//       if (error) {
//           console.error("Error fetching cached rate from DB:", error);
//           return null;
//       }

//       if (data && data.exchangeRates && data.exchangeRates.length > 0) {
//           const rateData = data.exchangeRates[0];
//           return {
//               ...rateData,
//               lastFetchedTimestamp: new Date(rateData.lastFetchedTimestamp) // Convert string to Date
//           };
//       }
//       return null; // Not found in cache
//   } catch (dbError) {
//       console.error("Database error fetching cached rate:", dbError);
//       return null;
//   }
// };

/**
 * Stores or updates multiple exchange rates in the InstantDB cache.
 * Attempts to update existing entries if found, otherwise creates new ones.
 * @param db - InstantDB instance.
 * @param ratesToCache - An array of objects: { baseCurrency, targetCurrency, rate, timestamp }
 * @param allExistingCachedRates - Pass the full list currently known to the component to find IDs.
 */
export const cacheExchangeRates = async (
  db: any,
  ratesToCache: { baseCurrency: string, targetCurrency: string, rate: number, timestamp: Date }[],
  allExistingCachedRates: CachedExchangeRate[] // Provide existing cache to find IDs
): Promise<void> => {
  if (ratesToCache.length === 0) return;

  const transactions: any[] = [];

  for (const rateInfo of ratesToCache) {
      if (rateInfo.baseCurrency === rateInfo.targetCurrency || typeof rateInfo.rate !== 'number') continue;

      // Find if an entry for this pair *already exists* in the cache passed from the component
      const existingRate = findRateInCache(rateInfo.baseCurrency, rateInfo.targetCurrency, allExistingCachedRates);

      const rateData = {
          baseCurrency: rateInfo.baseCurrency,
          targetCurrency: rateInfo.targetCurrency,
          rate: rateInfo.rate,
          lastFetchedTimestamp: rateInfo.timestamp.toISOString(), // Store as ISO string
      };

      if (existingRate) {
          // Update existing entry using its ID
          console.log(`Updating cached rate for ${rateInfo.baseCurrency}->${rateInfo.targetCurrency} (ID: ${existingRate.id})`);
          transactions.push(tx.exchangeRates[existingRate.id].update(rateData));
      } else {
          // Create new entry
          const newRateId = id();
          console.log(`Creating new cached rate for ${rateInfo.baseCurrency}->${rateInfo.targetCurrency} (ID: ${newRateId})`);
          transactions.push(tx.exchangeRates[newRateId].update(rateData));
      }
  }

  if (transactions.length > 0) {
      try {
          await db.transact(transactions);
          console.log(`Processed ${transactions.length} cache updates/creations.`);
      } catch (error) {
          console.error("Failed to cache exchange rates in DB:", error);
      }
  }
};

/**
 * Gets the exchange rate between two currencies. Uses cache, calculates via USD if needed,
 * caches calculated rates, and signals if an external API fetch is required.
 * @param db - InstantDB instance (for caching calculated rates).
 * @param fromCurrency - The currency code to convert from (e.g., "EUR").
 * @param toCurrency - The currency code to convert to (e.g., "NPR").
 * @param allCachedRates - The list of ALL cached rates fetched via useQuery in the component.
 * @returns Promise<ExchangeRateResult>
*/
export const getExchangeRate = async (
    db: any,
    fromCurrency: string,
    toCurrency: string,
    allCachedRates: CachedExchangeRate[]
): Promise<ExchangeRateResult> => {
    if (fromCurrency === toCurrency) return { rate: 1.0, source: 'identity', needsApiFetch: false };

    // 1. Check cache for the direct rate (from -> to)
    const directRateCached = findRateInCache(fromCurrency, toCurrency, allCachedRates);
    if (isRateValid(directRateCached)) {
        console.log(`Using valid cached direct rate ${fromCurrency}->${toCurrency}: ${directRateCached!.rate}`);
        return { rate: directRateCached!.rate, source: 'cache', needsApiFetch: false };
  }

    // 2. Check cache for USD-based rates (USD -> from) and (USD -> to)
    const usdToFromRateCached = findRateInCache(BASE_CURRENCY, fromCurrency, allCachedRates); // [cite: 479]
    // *No need to look up USD->USD in cache*
    // const usdToToRateCached = findRateInCache(BASE_CURRENCY, toCurrency, allCachedRates); // [cite: 480]

// 3. Check validity of the *required* intermediate rates
const isUsdToFromValid = isRateValid(usdToFromRateCached); // [cite: 481]

// **** FIX START ****
// Determine if the USD -> toCurrency rate is valid OR if the toCurrency IS USD itself
let isUsdToToValid = false;
let usdToToRateCached: CachedExchangeRate | null = null;
if (toCurrency === BASE_CURRENCY) {
    isUsdToToValid = true; // USD -> USD is always valid (rate 1)
} else {
    usdToToRateCached = findRateInCache(BASE_CURRENCY, toCurrency, allCachedRates); // Find USD -> non-USD rate
    isUsdToToValid = isRateValid(usdToToRateCached); // Check its validity
}
// **** FIX END ****


// 4. If both necessary intermediate rates are valid, calculate and cache the direct rate
    if (isUsdToFromValid && isUsdToToValid) { // [cite: 482]
        const rateFrom = usdToFromRateCached!.rate; // [cite: 482]
        // Get the rate for USD -> toCurrency (it's 1.0 if toCurrency is USD)
        const rateTo = (toCurrency === BASE_CURRENCY) ? 1.0 : usdToToRateCached!.rate; // [cite: 482]

        if (rateFrom !== 0) { // Avoid division by zero
            const calculatedRate = rateTo / rateFrom;
            console.log(`Calculated rate ${fromCurrency}->${toCurrency} via USD: ${calculatedRate}`);

            // Determine the older timestamp for the calculated rate cache entry
            // If toCurrency is USD, we only depend on the usdToFrom timestamp
            const calcTimestampSource1 = usdToFromRateCached!.lastFetchedTimestamp;
            const calcTimestampSource2 = (toCurrency === BASE_CURRENCY) ? calcTimestampSource1 : usdToToRateCached!.lastFetchedTimestamp; // Use first timestamp if comparing against itself
            const olderTimestamp = calcTimestampSource1.getTime() < calcTimestampSource2.getTime()
                ? calcTimestampSource1
                : calcTimestampSource2; //

            // Cache the calculated direct rate async
            cacheExchangeRates(db, [{
                baseCurrency: fromCurrency,
                targetCurrency: toCurrency,
                rate: calculatedRate,
                timestamp: olderTimestamp
            }], allCachedRates) // Pass existing cache for potential update
              .catch(err => console.error("Failed to cache calculated rate:", err)); // Log error but don't block

            return { rate: calculatedRate, source: 'calculated', needsApiFetch: false, calculationTimestamp: olderTimestamp };
        }
    }

    // 5. Signal that an external fetch (base USD) is needed.
    console.log(`Rate ${fromCurrency}->${toCurrency} requires external fetch. Direct cached: ${!!directRateCached}, USD->From valid: ${isUsdToFromValid}, USD->To valid: ${isUsdToToValid}`);

    // Determine which stale rate to return, if any
    let staleRate: number | null = null;
    if (directRateCached) {
        staleRate = directRateCached.rate;
        console.log("Returning stale direct rate temporarily.");
    } else if (usdToFromRateCached && toCurrency === BASE_CURRENCY && usdToFromRateCached.rate !== 0) {
        // Calculate stale EUR -> USD from stale USD -> EUR
        staleRate = 1.0 / usdToFromRateCached.rate;
        console.log("Returning stale calculated (inverse USD) rate temporarily.");
    } else if (usdToFromRateCached && usdToToRateCached && usdToFromRateCached.rate !== 0) {
        // Calculate stale EUR -> NPR from stale USD -> EUR and stale USD -> NPR
        staleRate = usdToToRateCached.rate / usdToFromRateCached.rate;
        console.log("Returning stale calculated (cross USD) rate temporarily.");
    }

    return { rate: staleRate, source: 'unavailable', needsApiFetch: true };
};

/**
* Updates the last viewed display currency preference for a family member.
* @param db - InstantDB instance.
* @param familyMemberId - The ID of the family member.
* @param currencyCode - The currency code (e.g., "USD") to store.
*/
export const setLastDisplayCurrencyPref = async (db: any, familyMemberId: string, currencyCode: string): Promise<void> => {
    if (!familyMemberId) {
         console.error("Cannot set currency preference without familyMemberId");
         return;
     }
    try {
      await db.transact([
            tx.familyMembers[familyMemberId].update({ lastDisplayCurrency: currencyCode })
      ]);
      console.log(`Set last display currency for ${familyMemberId} to ${currencyCode}`);
  } catch (error) {
      console.error(`Failed to set currency preference for ${familyMemberId}:`, error);
      // Handle error appropriately (e.g., show toast)
  }
};

// --- NEW Goal Progress Calculation Function ---

/**
 * Calculates the total value of an envelope's balances in the goal currency
 * and the percentage of the goal achieved.
 * @param db - InstantDB instance (for caching calculated rates).
 * @param envelope - The envelope object (must include balances, goalAmount, goalCurrency).
 * @param unitDefinitions - Array of unit definitions.
 * @param allCachedRates - Array of all currently cached exchange rates.
 * @returns Promise<GoalProgressResult>
 */
export const calculateEnvelopeProgress = async (
  db: any,
  envelope: Envelope,
  unitDefinitions: UnitDefinition[],
  allCachedRates: CachedExchangeRate[]
): Promise<GoalProgressResult> => {
  const result: GoalProgressResult = {
    totalValueInGoalCurrency: null,
    percentage: null,
    errors: [],
  };

  // --- Validation ---
  if (!envelope.goalAmount || envelope.goalAmount <= 0 || !envelope.goalCurrency) {
    result.errors.push("Envelope does not have a valid savings goal set.");
    return result; // Cannot calculate without goal info
  }
  if (!envelope.balances || Object.keys(envelope.balances).length === 0) {
      result.totalValueInGoalCurrency = 0;
      result.percentage = 0;
      return result; // No balances, progress is 0%
  }

  const goalCurrency = envelope.goalCurrency;
  const goalAmount = envelope.goalAmount;
  let totalValue = 0;
  let needsApiFetchOverall = false; // Track if any conversion needs an API fetch

  const unitDefMap = new Map(unitDefinitions.map(def => [def.code.toUpperCase(), def]));

  // --- Iterate through balances and convert ---
  for (const [code, amount] of Object.entries(envelope.balances)) {
    if (amount === 0) continue; // Skip zero balances

    // Check if the currency is monetary
    const definition = unitDefMap.get(code.toUpperCase());
    const isMonetary = definition?.isMonetary ?? (code.length === 3); // Assuming non-defined 3-letter codes are monetary

    if (!isMonetary) {
      console.log(`Skipping non-monetary balance: ${code} ${amount}`);
      continue; // Skip non-monetary balances for goal calculation
    }

    // Get exchange rate to goal currency
    const rateResult = await getExchangeRate(db, code, goalCurrency, allCachedRates);

    if (rateResult.rate !== null) {
      totalValue += amount * rateResult.rate;
    } else {
      // Rate unavailable - record error but continue summing others
      const errorMsg = `Could not find exchange rate from ${code} to ${goalCurrency}.`;
      console.warn(errorMsg);
      result.errors.push(errorMsg);
      // Do not add this balance to the totalValue
    }

    // Track if any conversion triggered a need for API fetch
    if (rateResult.needsApiFetch) {
      needsApiFetchOverall = true;
    }
  } // End loop through balances

  // --- Final Calculations ---
  result.totalValueInGoalCurrency = totalValue;

  if (goalAmount > 0) {
    result.percentage = (totalValue / goalAmount) * 100;
  } else {
    result.percentage = 0; // Avoid division by zero if goal amount is somehow invalid
  }

  // If rates were missing, percentage might be inaccurate
  if (result.errors.length > 0) {
    console.warn("Goal progress calculated, but some rates were missing.");
  }

  // Optionally: trigger background fetch if needed (though the display component might handle this)
  if (needsApiFetchOverall) {
      console.log("Triggering background rate fetch due to goal calculation needs...");
      fetchExternalExchangeRates()
          .then(apiData => {
              if (apiData && apiData.rates) {
                  const now = new Date();
                  const ratesToCache = Object.entries(apiData.rates).map(([currency, rate]) => ({
                      baseCurrency: BASE_CURRENCY,
                      targetCurrency: currency,
                      rate: rate as number,
                      timestamp: now
                  }));
                  return cacheExchangeRates(db, ratesToCache, allCachedRates);
              }
          })
          .then(() => console.log("Background fetch for goal calculation complete."))
          .catch(err => console.error("Error during background fetch for goal:", err));
  }


  return result;
};
