import 'server-only';

import { getDb, isPostgresConfigured } from './db';

/**
 * What every client is told when it starts (docs/powersync-migration.md, "The cutover protocol"): which backend to
 * use, and what a device's local database has to match. A deployment with no Postgres is on InstantDB.
 */
export type ClientConfig =
    | { backend: 'instant' }
    | {
          backend: 'instant' | 'powersync';
          installationId: string;
          dataGeneration: number;
          writesFrozen: boolean;
          minClientBuild: number;
          /** Where devices reach the PowerSync service: a path on the app's own address unless overridden. */
          powersyncUrl: string;
      };

export async function readClientConfig(): Promise<ClientConfig> {
    if (!isPostgresConfigured()) return { backend: 'instant' };
    const row = await getDb().selectFrom('installation').selectAll().executeTakeFirstOrThrow();
    return {
        backend: row.backend,
        installationId: row.id,
        dataGeneration: row.data_generation,
        writesFrozen: row.writes_frozen,
        minClientBuild: row.min_client_build,
        powersyncUrl: process.env.POWERSYNC_URL || '/powersync',
    };
}

/**
 * Whether this deployment's clients are on PowerSync. A route with no session to go by, such as one a shortcut or
 * a scheduled job calls, serves from Postgres when they are and from InstantDB when they are not.
 */
export async function servesFromPostgres(): Promise<boolean> {
    if (!isPostgresConfigured()) return false;
    const row = await getDb().selectFrom('installation').select('backend').executeTakeFirstOrThrow();
    return row.backend === 'powersync';
}
