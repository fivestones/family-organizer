import { getDataBackend } from '../backend';
import type { NewUnitDefinition } from './types';

/** Defines a new currency or point unit and resolves to its id. */
export function defineUnit(unit: NewUnitDefinition): Promise<string> {
    return getDataBackend().units.defineUnit(unit);
}
