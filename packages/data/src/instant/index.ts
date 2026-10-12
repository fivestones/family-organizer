import type { DataBackend } from '../backend';
import type { InstantClient } from './client';
import { createInstantSettingsBackend } from './settings';
import { createInstantUnitsBackend } from './units';

export type { InstantClient } from './client';

/** The data layer over InstantDB. Temporary: it is deleted when the app moves to PowerSync. */
export function createInstantBackend(client: InstantClient): DataBackend {
    return {
        settings: createInstantSettingsBackend(client),
        units: createInstantUnitsBackend(client),
    };
}
