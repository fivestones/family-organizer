import type { SettingsBackend } from './settings/backend';
import type { UnitsBackend } from './units/backend';

/** Everything an implementation of the data layer provides, one member per area. */
export interface DataBackend {
    settings: SettingsBackend;
    units: UnitsBackend;
}

let activeBackend: DataBackend | null = null;

/** Called once at startup by the platform's data module. */
export function setDataBackend(backend: DataBackend): void {
    activeBackend = backend;
}

export function getDataBackend(): DataBackend {
    if (!activeBackend) {
        throw new Error(
            'The data layer has no backend yet. Import the platform data module (web: @/lib/data, phone: src/lib/data) before using it.'
        );
    }
    return activeBackend;
}
