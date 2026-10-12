// Runs once when the server starts, before it handles a request.
export async function register() {
    if (process.env.NEXT_RUNTIME !== 'nodejs') return;
    // No DATABASE_URL means this deployment is still on InstantDB alone, and there is nothing to migrate.
    if (!process.env.DATABASE_URL) return;
    const { migrateOnStart } = await import('./lib/server/migrate-on-start');
    await migrateOnStart();
}
