import type { QueryResult, ReadOptions } from '../query-result';

/** One stored setting, as it sits in the database. */
export interface StoredSetting {
    name: string;
    /** The stored value, parsed from JSON. */
    value: unknown;
}

/** What an implementation must provide for the settings area. A setting is one JSON value stored under a name. */
export interface SettingsBackend {
    /**
     * Live. The stored value of each named setting, parsed from JSON.
     * A name with nothing stored is absent from the map. The map keeps its identity until a value changes.
     */
    useStoredSettings(names: readonly string[], options?: ReadOptions): QueryResult<ReadonlyMap<string, unknown>>;
    /** Live. Every stored setting, for the screen that lists them raw. */
    useAllStoredSettings(options?: ReadOptions): QueryResult<readonly StoredSetting[]>;
    /** Creates or replaces the value stored under a name. */
    saveStoredSetting(name: string, value: unknown): Promise<void>;
    /** Removes whatever is stored under a name. A name with nothing stored is not an error. */
    deleteStoredSetting(name: string): Promise<void>;
}
