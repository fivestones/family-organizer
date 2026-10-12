import type { DataBackend } from '../backend';
import { createPowerSyncChoresBackend } from './chores';
import type { Device } from './device';
import { createPowerSyncFamilyBackend } from './family';
import { createPowerSyncSettingsBackend } from './settings';
import { createPowerSyncUnitsBackend } from './units';

export type { Device } from './device';
export { WriteRefusedError } from './mutate';
export { AppSchema, TRANSACTION_TABLE, type ClientDatabase } from './schema';

/** The data layer over one person's local database. Reads are SQL on the device; writes are local and sync when they can. */
export function createPowerSyncBackend(device: Device): DataBackend {
    return {
        family: createPowerSyncFamilyBackend(device),
        settings: createPowerSyncSettingsBackend(device),
        units: createPowerSyncUnitsBackend(device),
        chores: createPowerSyncChoresBackend(device),
    };
}
