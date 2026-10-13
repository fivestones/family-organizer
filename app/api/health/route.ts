import { NextResponse } from 'next/server';
import { getDb, isPostgresConfigured } from '@/lib/server/db';
import { readDataHealth } from '@/lib/server/health';

export const dynamic = 'force-dynamic';

// Answers the container's health check, and says how the database, the sync service and the backups are doing.
// `ok` means only that the app is up, so a missed backup never restarts the container; `data.attention` lists
// what someone should look at. A deployment with no Postgres, which is every one still on InstantDB, has no `data`.
export async function GET() {
    const data = isPostgresConfigured() ? await readDataHealth(getDb()) : undefined;
    return NextResponse.json(
        {
            ok: true,
            service: 'family-organizer',
            timestamp: new Date().toISOString(),
            ...(data ? { data } : {}),
        },
        { headers: { 'Cache-Control': 'no-store' } }
    );
}
