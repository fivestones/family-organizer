import type { DataBackend } from '../backend';
import { setDataBackend } from '../backend';
import { createPowerSyncChoresBackend } from './chores';
import { setCurrentDevice } from './current';
import type { Device } from './device';
import { createPowerSyncFamilyBackend } from './family';
import { createPowerSyncSettingsBackend } from './settings';
import { createPowerSyncSyncBackend } from './sync';
import { createPowerSyncUnitsBackend } from './units';

export type { Device } from './device';
export { WriteRefusedError } from './mutate';
export { AppSchema, TRANSACTION_TABLE, type ClientDatabase } from './schema';

/** The data layer over one person's local database. Reads are SQL on the device; writes are local and sync when they can. */
export function createPowerSyncBackend(device: Device): DataBackend {
    return {
        family: createPowerSyncFamilyBackend(device),
        settings: createPowerSyncSettingsBackend(device),
        sync: createPowerSyncSyncBackend(device),
        units: createPowerSyncUnitsBackend(device),
        chores: createPowerSyncChoresBackend(device),
    };
}

/**
 * Points the whole data layer at one person's database: the areas with a seam, and the areas written directly on
 * PowerSync. The app's frame calls it when someone is signed in, before it mounts anything that reads.
 */
export function bindDevice(device: Device): void {
    setDataBackend(createPowerSyncBackend(device));
    setCurrentDevice(device);
}
