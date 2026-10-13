import { PowerSyncFrame } from '@/components/sync/PowerSyncFrame';

/**
 * The app on PowerSync. Every page under here is shown in one frame, which signs the device in and gives the page
 * the signed-in person's local database. On a deployment whose clients are on PowerSync the middleware shows these
 * pages at the addresses of the pages they replace (docs/powersync-migration.md, "How the app gets there").
 */
export default function PowerSyncLayout({ children }: { children: React.ReactNode }) {
    return <PowerSyncFrame>{children}</PowerSyncFrame>;
}
