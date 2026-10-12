import type { ChoresBackend } from '../chores/backend';

// On InstantDB the chore screens still read and write the database directly. This area was designed on PowerSync
// first, in the slice; its implementation over Instant is written when the chore screens move to the data layer.
const notYet = (): never => {
    throw new Error('Chores are not on the data layer over InstantDB yet.');
};

export function createInstantChoresBackend(): ChoresBackend {
    return { useChoreDay: notYet, completeChore: notYet, reopenChore: notYet };
}
