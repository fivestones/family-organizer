import FileManager from '@/components/FileManager';
import { ParentGate } from '@/components/auth/ParentGate';

export const dynamic = 'force-dynamic'; // Ensure we don't cache the list of files

export default function Page() {
    return (
        <ParentGate>
            <main className="min-h-screen bg-gray-50 py-12">
                <h1 className="text-3xl font-bold text-center mb-8 text-gray-800">My Local MinIO Storage</h1>
                <FileManager />
            </main>
        </ParentGate>
    );
}
