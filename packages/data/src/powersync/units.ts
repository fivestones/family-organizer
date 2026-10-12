import type { QueryResult, ReadOptions } from '../query-result';
import type { UnitsBackend } from '../units/backend';
import type { NewUnitDefinition, UnitDefinition } from '../units/types';
import type { Device } from './device';
import { useLiveRead } from './live';
import { ensureInsert, mutate } from './mutate';
import type { ClientDatabase } from './schema';
import { all, asFlag, first, flag, optionalFlag, run, sqlFor } from './sql';

type UnitRow = ClientDatabase['unit_definitions'];

const EMPTY_UNITS: UnitDefinition[] = [];

function toUnitDefinition(row: UnitRow): UnitDefinition {
    return {
        id: row.id,
        code: row.code ?? '',
        name: row.name ?? '',
        symbol: row.symbol ?? '',
        isMonetary: flag(row.is_monetary),
        symbolPlacement: row.symbol_placement === 'before' || row.symbol_placement === 'after' ? row.symbol_placement : null,
        symbolSpacing: optionalFlag(row.symbol_spacing),
        decimalPlaces: row.decimal_places,
    };
}

export function createPowerSyncUnitsBackend(device: Device): UnitsBackend {
    return {
        useUnitDefinitions(options?: ReadOptions): QueryResult<UnitDefinition[]> {
            return useLiveRead(
                device.db,
                ['unit_definitions'],
                (reader) => all<UnitRow>(reader, sqlFor.selectFrom('unit_definitions').selectAll().orderBy('code')),
                (rows) => rows.map(toUnitDefinition),
                EMPTY_UNITS,
                [],
                options
            );
        },

        defineUnit(unit: NewUnitDefinition): Promise<string> {
            return mutate(device, 'defineUnit', async (writer) => {
                // The server holds the code to be unique. Saying so here spares a refusal that would arrive later.
                const taken = await first(writer, sqlFor.selectFrom('unit_definitions').select('id').where('code', '=', unit.code));
                if (taken) throw new Error(`A unit with the code ${unit.code} already exists.`);
                const id = device.createId();
                ensureInsert(device, 'unit_definitions', { id, ...unit });
                await run(
                    writer,
                    sqlFor.insertInto('unit_definitions').values({
                        id,
                        code: unit.code,
                        name: unit.name,
                        symbol: unit.symbol,
                        is_monetary: asFlag(unit.isMonetary),
                        symbol_placement: unit.symbolPlacement,
                        symbol_spacing: unit.symbolSpacing === null ? null : asFlag(unit.symbolSpacing),
                        decimal_places: unit.decimalPlaces,
                    })
                );
                return id;
            });
        },
    };
}
