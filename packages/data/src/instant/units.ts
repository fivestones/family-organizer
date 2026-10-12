import { useMemo } from 'react';
import type { QueryResult, ReadOptions } from '../query-result';
import type { UnitsBackend } from '../units/backend';
import type { NewUnitDefinition, UnitDefinition } from '../units/types';
import { toError, type InstantClient } from './client';

const UNITS_QUERY = { unitDefinitions: { $: { order: { code: 'asc' } } } };
const EMPTY_ROWS: readonly any[] = [];

function toUnitDefinition(row: any): UnitDefinition {
    const code = String(row.code ?? '');
    return {
        id: row.id,
        code,
        name: row.name ?? '',
        symbol: row.symbol ?? '',
        // Every defined unit says whether it is money. Where an old row does not, apply the rule the app's
        // formatters apply to an undefined unit: a three-letter code is a currency.
        isMonetary: typeof row.isMonetary === 'boolean' ? row.isMonetary : code.length === 3,
        symbolPlacement: row.symbolPlacement === 'before' || row.symbolPlacement === 'after' ? row.symbolPlacement : null,
        symbolSpacing: typeof row.symbolSpacing === 'boolean' ? row.symbolSpacing : null,
        decimalPlaces: typeof row.decimalPlaces === 'number' ? row.decimalPlaces : null,
    };
}

export function createInstantUnitsBackend({ db, tx, id }: InstantClient): UnitsBackend {
    return {
        useUnitDefinitions(options?: ReadOptions): QueryResult<UnitDefinition[]> {
            const { data, isLoading, error } = db.useQuery(options?.enabled === false ? null : UNITS_QUERY);
            const rows: readonly any[] = data?.unitDefinitions ?? EMPTY_ROWS;
            const units = useMemo(() => rows.map(toUnitDefinition), [rows]);
            return { data: units, isLoading, error: toError(error) };
        },

        async defineUnit(unit: NewUnitDefinition): Promise<string> {
            const unitId = id();
            // Instant enforces the unique code when the write reaches the server.
            await db.transact([tx.unitDefinitions[unitId].update({ ...unit })]);
            return unitId;
        },
    };
}
