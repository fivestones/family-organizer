'use client';

import { useCallback, useEffect, useState } from 'react';
import { Upload, File as FileIcon, X, Loader2, Search, ShieldCheck, Trash2 } from 'lucide-react';
import {
    type S3File,
    type TaskUploadSweepResult,
    getFiles,
    getPresignedUploadUrl,
    refreshFiles,
    sweepOrphanedTaskUploads,
} from '@/app/actions';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { requireCachedMemberToken } from '@/lib/instant-principal-storage';

interface FileManagerProps {
    initialFiles?: S3File[];
}

function formatBytes(value: number) {
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const unitIndex = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    const amount = value / 1024 ** unitIndex;
    return `${amount >= 10 || unitIndex === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unitIndex]}`;
}

export default function FileManager({ initialFiles }: FileManagerProps) {
    const [files, setFiles] = useState<S3File[]>(initialFiles ?? []);
    const [selectedFile, setSelectedFile] = useState<S3File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [loadingFiles, setLoadingFiles] = useState(initialFiles === undefined);
    const [cleanupReport, setCleanupReport] = useState<TaskUploadSweepResult | null>(null);
    const [scanningTaskStorage, setScanningTaskStorage] = useState(false);
    const [deletingTaskOrphans, setDeletingTaskOrphans] = useState(false);
    const [cleanupDialogOpen, setCleanupDialogOpen] = useState(false);

    const loadFiles = useCallback(async () => {
        setLoadingFiles(true);
        try {
            setFiles(await getFiles(requireCachedMemberToken()));
        } catch (error) {
            console.error('Failed to load files', error);
            alert('Could not load files. Parent access is required.');
        } finally {
            setLoadingFiles(false);
        }
    }, []);

    useEffect(() => {
        if (initialFiles !== undefined) return;
        void loadFiles();
    }, [initialFiles, loadFiles]);

    const isImage = (key: string) => /\.(jpg|jpeg|png|webp|gif)$/i.test(key);

    // Helper to generate the stable URL
    const getFileUrl = (key: string) => `/files/${key}`;

    const handleUpload = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fileInput = form.elements.namedItem('file') as HTMLInputElement;
        const file = fileInput.files?.[0];

        if (!file) return;

        setUploading(true);

        try {
            const instantAuthToken = requireCachedMemberToken();
            const { url, fields } = await getPresignedUploadUrl(file.type, file.name, instantAuthToken);

            const formData = new FormData();
            Object.entries(fields).forEach(([key, value]) => {
                formData.append(key, value as string);
            });
            formData.append('file', file);

            const response = await fetch(url, {
                method: 'POST',
                body: formData,
            });

            // S3 presigned POST returns 204. Cross-origin opaque responses have status 0.
            // Only treat 4xx/5xx as failures.
            if (response.status >= 400) throw new Error('Upload failed');

            await refreshFiles(instantAuthToken);
            if (initialFiles === undefined) {
                await loadFiles();
            }
            form.reset();
        } catch (error) {
            console.error(error);
            alert('Upload failed.');
        } finally {
            setUploading(false);
        }
    };

    const runTaskStorageSweep = async (execute: boolean) => {
        if (execute) setDeletingTaskOrphans(true);
        else setScanningTaskStorage(true);

        try {
            const report = await sweepOrphanedTaskUploads(
                { execute },
                requireCachedMemberToken()
            );
            setCleanupReport(report);
            if (execute) {
                setCleanupDialogOpen(false);
                await loadFiles();
            }
        } catch (error) {
            console.error('Failed to sweep task upload storage', error);
            alert(execute ? 'Could not delete orphaned task files.' : 'Could not scan task file storage.');
        } finally {
            if (execute) setDeletingTaskOrphans(false);
            else setScanningTaskStorage(false);
        }
    };

    return (
        <div className="p-6 max-w-5xl mx-auto">
            {/* Upload Area */}
            <div className="mb-10 p-8 border-2 border-dashed border-gray-300 rounded-xl bg-gray-50/50">
                <form onSubmit={handleUpload} className="flex flex-col items-center gap-4">
                    <div className="flex items-center gap-2 text-gray-700 font-semibold">
                        {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
                        <span>Add to Family Organizer</span>
                    </div>
                    <input
                        type="file"
                        name="file"
                        accept="image/*,.pdf,.doc,.txt"
                        disabled={uploading}
                        className="file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700 cursor-pointer text-gray-500"
                        required
                    />
                    <button
                        type="submit"
                        disabled={uploading}
                        className="bg-blue-600 text-white px-8 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-all shadow-sm"
                    >
                        {uploading ? 'Uploading...' : 'Start Upload'}
                    </button>
                </form>
            </div>

            <section className="mb-10 overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-sky-50 shadow-sm">
                <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                        <span className="rounded-xl bg-emerald-100 p-2.5 text-emerald-700">
                            <ShieldCheck aria-hidden="true" size={22} />
                        </span>
                        <div>
                            <h2 className="font-semibold text-gray-900">Task storage cleanup</h2>
                            <p className="mt-1 max-w-2xl text-sm text-gray-600">
                                Preview task files that have no live attachment record and are at least 24 hours old.
                                General family files are never included.
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        disabled={scanningTaskStorage || deletingTaskOrphans}
                        onClick={() => void runTaskStorageSweep(false)}
                        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {scanningTaskStorage ? <Loader2 className="animate-spin" size={17} /> : <Search size={17} />}
                        {scanningTaskStorage ? 'Scanning…' : 'Scan task storage'}
                    </button>
                </div>

                {cleanupReport && (
                    <div className="border-t border-emerald-100 bg-white/70 px-5 py-4">
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            <div className="rounded-xl border border-gray-100 bg-white p-3">
                                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Task-managed</p>
                                <p className="mt-1 text-xl font-semibold text-gray-900">{cleanupReport.managedObjects}</p>
                                <p className="text-xs text-gray-500">{formatBytes(cleanupReport.managedBytes)}</p>
                            </div>
                            <div className="rounded-xl border border-gray-100 bg-white p-3">
                                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Live references</p>
                                <p className="mt-1 text-xl font-semibold text-gray-900">{cleanupReport.referencedObjects}</p>
                                <p className="text-xs text-gray-500">{formatBytes(cleanupReport.referencedBytes)}</p>
                            </div>
                            <div className="rounded-xl border border-gray-100 bg-white p-3">
                                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Grace protected</p>
                                <p className="mt-1 text-xl font-semibold text-gray-900">{cleanupReport.graceProtectedObjects}</p>
                                <p className="text-xs text-gray-500">{formatBytes(cleanupReport.graceProtectedBytes)}</p>
                            </div>
                            <div className="rounded-xl border border-gray-100 bg-white p-3">
                                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                    {cleanupReport.deletedObjects > 0 ? 'Deleted' : 'Safe to reclaim'}
                                </p>
                                <p className="mt-1 text-xl font-semibold text-gray-900">
                                    {cleanupReport.deletedObjects > 0
                                        ? cleanupReport.deletedObjects
                                        : cleanupReport.orphanedObjects}
                                </p>
                                <p className="text-xs text-gray-500">
                                    {formatBytes(
                                        cleanupReport.deletedObjects > 0
                                            ? cleanupReport.deletedBytes
                                            : cleanupReport.orphanedBytes
                                    )}
                                </p>
                            </div>
                        </div>

                        {cleanupReport.deletedObjects === 0 && cleanupReport.orphanedObjects > 0 && (
                            <div className="mt-4 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                                <p className="text-sm text-amber-900">
                                    {cleanupReport.orphanedObjects} old, unreferenced task {cleanupReport.orphanedObjects === 1 ? 'file is' : 'files are'} ready to remove.
                                </p>
                                <button
                                    type="button"
                                    onClick={() => setCleanupDialogOpen(true)}
                                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700"
                                >
                                    <Trash2 size={16} />
                                    Delete orphaned files
                                </button>
                            </div>
                        )}

                        {cleanupReport.deletedObjects > 0 && (
                            <p className="mt-4 text-sm font-medium text-emerald-700" role="status">
                                Cleanup completed. Run another scan any time to refresh the report.
                            </p>
                        )}
                    </div>
                )}
            </section>

            {/* File Grid */}
            <h2 className="text-xl font-bold mb-4 text-gray-800">Files ({files.length})</h2>

            {loadingFiles && <p className="mb-4 text-sm text-gray-500">Loading files…</p>}

            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {files.map((file) => (
                    <div
                        key={file.key}
                        onClick={() => setSelectedFile(file)}
                        className="group relative aspect-square border rounded-xl overflow-hidden cursor-pointer hover:shadow-xl transition-all bg-white"
                    >
                        {isImage(file.key) ? (
                            <img
                                // 👇 THE BIG CHANGE: Use the route handler path
                                src={getFileUrl(file.key)}
                                alt={file.key}
                                loading="lazy"
                                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                            />
                        ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center bg-gray-100 text-gray-400 p-4">
                                <FileIcon size={40} />
                                <span className="text-xs mt-2 text-center break-all line-clamp-2">{file.key}</span>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Modal Viewer */}
            {selectedFile && (
                <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4">
                    <button onClick={() => setSelectedFile(null)} className="absolute top-6 right-6 text-white/70 hover:text-white transition-colors">
                        <X size={36} />
                    </button>

                    <div className="max-w-6xl max-h-screen flex flex-col items-center">
                        {isImage(selectedFile.key) ? (
                            <img
                                // 👇 Use the route handler path here too
                                src={getFileUrl(selectedFile.key)}
                                alt={selectedFile.key}
                                className="max-h-[85vh] w-auto rounded-lg shadow-2xl"
                            />
                        ) : (
                            <div className="bg-white p-16 rounded-xl flex flex-col items-center text-center">
                                <FileIcon size={80} className="text-blue-500 mb-6" />
                                <p className="text-xl font-semibold mb-6 text-gray-800 max-w-md break-all">{selectedFile.key}</p>
                                <a
                                    href={getFileUrl(selectedFile.key)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 font-medium"
                                >
                                    Download File
                                </a>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <AlertDialog
                open={cleanupDialogOpen}
                onOpenChange={(open) => {
                    if (!deletingTaskOrphans) setCleanupDialogOpen(open);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete orphaned task files?</AlertDialogTitle>
                        <AlertDialogDescription>
                            The server will scan again, protect every current attachment reference, and permanently delete only task-managed files older than {cleanupReport?.gracePeriodHours || 24} hours that are still unreferenced.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deletingTaskOrphans}>Keep files</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={deletingTaskOrphans}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={(event) => {
                                event.preventDefault();
                                void runTaskStorageSweep(true);
                            }}
                        >
                            {deletingTaskOrphans ? 'Deleting…' : 'Delete orphaned files'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
