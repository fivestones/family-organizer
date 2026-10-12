import type { QueryResult, ReadOptions } from '../query-result';
import type { NewUnitDefinition, UnitDefinition } from './types';

/** What an implementation must provide for unit definitions. */
export interface UnitsBackend {
    /** Live. Every unit the family has defined, ordered by code. The array keeps its identity until a unit changes. */
    useUnitDefinitions(options?: ReadOptions): QueryResult<UnitDefinition[]>;
    /** Defines a new unit and resolves to its id. A code that is already in use is refused. */
    defineUnit(unit: NewUnitDefinition): Promise<string>;
}
