// components/TaskSeriesChecklist.tsx
import React, { useEffect, useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Task } from '@/lib/task-scheduler';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { File as FileIcon, Loader2, X, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { PDFPreview } from './PDFPreview';
// +++ NEW IMPORT +++
import { Fireworks } from '@/components/ui/fireworks';

interface Props {
    tasks: Task[]; // These are the "Scheduled" tasks returned by getTasksForDate
    allTasks: Task[]; // The full list of tasks in the series (for context lookup)
    onToggle: (taskId: string, currentStatus: boolean) => void;
    isReadOnly?: boolean;
    selectedMember: string | null | 'All';
    showDetails: boolean;
}

// --- SAFE ACCESSOR HELPER ---
const getParentId = (task: Task): string | undefined => {
    if (!task.parentTask) return undefined;
    if (Array.isArray(task.parentTask)) {
        return task.parentTask[0]?.id;
    }
    return (task.parentTask as any).id;
};

// Helper to check if a node has visible children in the current schedule
const hasScheduledChildren = (parentId: string, scheduledIds: Set<string>, allTasks: Task[]) => {
    return allTasks.some((t) => {
        const pId = getParentId(t);
        return pId === parentId && scheduledIds.has(t.id);
    });
};

// --- Helper Component: File Thumbnail (fetches text preview if needed) ---
const FileThumbnail = ({ file, onClick }: { file: any; onClick: () => void }) => {
    const isImage = /\.(jpg|jpeg|png|webp|gif)$/i.test(file.url);
    const isPdf = /\.pdf$/i.test(file.url);
    const isText = /\.(txt|md|csv|log)$/i.test(file.url);
    const [previewText, setPreviewText] = useState<string | null>(null);

    useEffect(() => {
        if (isText && !previewText) {
            // Fetch tiny preview
            fetch(`/files/${file.url}`)
                .then((res) => res.text())
                .then((text) => setPreviewText(text.slice(0, 150)))
                .catch((err) => console.error('Failed to load text preview', err));
        }
    }, [isText, file.url, previewText]);

    return (
        <div
            onClick={(e) => {
                e.stopPropagation();
                onClick();
            }}
            className="group relative w-12 h-12 border rounded bg-white overflow-hidden cursor-pointer hover:ring-2 hover:ring-blue-400 transition-all flex-shrink-0"
            title={file.name}
        >
            {isImage ? (
                <img src={`/files/${file.url}`} alt={file.name} className="w-full h-full object-cover" />
            ) : isPdf ? (
                <div className="w-full h-full flex items-center justify-center bg-red-50 text-red-500">
                    <span className="text-[8px] font-bold">PDF</span>
                </div>
            ) : isText ? (
                <div className="w-full h-full p-1 bg-gray-50 overflow-hidden">
                    <div className="text-[5px] leading-[6px] text-gray-500 font-mono break-all opacity-70">{previewText || 'Loading...'}</div>
                </div>
            ) : (
                <div className="w-full h-full flex items-center justify-center bg-gray-100">
                    <FileIcon className="w-5 h-5 text-gray-400" />
                </div>
            )}
        </div>
    );
};

export const TaskSeriesChecklist: React.FC<Props> = ({ tasks: scheduledTasks, allTasks, onToggle, isReadOnly, selectedMember, showDetails }) => {
    // --- Local Expand State (for "View Details" override) ---
    const [localExpandedIds, setLocalExpandedIds] = useState<Set<string>>(new Set());

    const toggleLocalExpand = (taskId: string) => {
        setLocalExpandedIds((prev) => {
            const next = new Set(prev);
            if (next.has(taskId)) {
                next.delete(taskId);
            } else {
                next.add(taskId);
            }
            return next;
        });
    };

    // --- Preview Modal State ---
    const [previewFile, setPreviewFile] = useState<any | null>(null);
    const [fullTextContent, setFullTextContent] = useState<string | null>(null);
    const [loadingText, setLoadingText] = useState(false);
    // New state for expanding the preview modal
    const [isExpanded, setIsExpanded] = useState(false);

    // +++ ADD THIS HELPER +++
    const isPreviewPdf = previewFile && /\.pdf$/i.test(previewFile.url);

    const openPreview = async (file: any) => {
        setPreviewFile(file);
        setFullTextContent(null);
        setIsExpanded(false); // Reset expand state on open

        if (/\.(txt|md|csv|log)$/i.test(file.url)) {
            setLoadingText(true);
            try {
                const res = await fetch(`/files/${file.url}`);
                const text = await res.text();
                setFullTextContent(text);
            } catch (err) {
                console.error('Failed to load full text', err);
                setFullTextContent('Error loading file content.');
            } finally {
                setLoadingText(false);
            }
        }
    };

    // --- 1. Compute Visual Tree (Moved outside render return to use in Effect) ---
    // We need to compute 'visibleNodes' early so we can check for Headers needing auto-completion.

    const visibleNodes: Task[] = React.useMemo(() => {
        if (!scheduledTasks || scheduledTasks.length === 0) return [];

        // 1. Build the "View Tree"
        // We need to display not just the scheduled tasks, but their parents (as headers)
        const scheduledIds = new Set(scheduledTasks.map((t) => t.id));
        const visibleNodesMap = new Map<string, Task>();

        // Add all scheduled tasks
        scheduledTasks.forEach((t) => visibleNodesMap.set(t.id, t));

        // Walk up ancestors for all scheduled tasks
        scheduledTasks.forEach((task) => {
            let current = task;
            // Safety: limit depth to avoid infinite loops if data is malformed
            let depth = 0;
            // FIX: Use safe getParentId helper in loop
            let parentId = getParentId(current);

            while (parentId && depth < 10) {
                // If parent already added, stop walking up
                if (visibleNodesMap.has(parentId)) break;

                const parent = allTasks.find((t) => t.id === parentId);
                if (parent) {
                    visibleNodesMap.set(parent.id, parent);
                    current = parent;
                    parentId = getParentId(current); // Update for next iteration
                } else {
                    break;
                }
                depth++;
            }
        });

        // Sort by order
        return Array.from(visibleNodesMap.values()).sort((a, b) => (a.order || 0) - (b.order || 0));
    }, [scheduledTasks, allTasks]);

    // --- 2. Auto-Complete Headers Effect ---
    useEffect(() => {
        if (isReadOnly) return; // Only apply auto-complete logic for "Today" (interactive mode)

        const scheduledIds = new Set(scheduledTasks.map((t) => t.id));

        visibleNodes.forEach((task) => {
            const isScheduled = scheduledIds.has(task.id);
            const isParentGroup = hasScheduledChildren(task.id, scheduledIds, allTasks);

            // Logic: If it is a Header (Parent with visible kids OR not scheduled today but shown as context),
            // and it is NOT marked complete, mark it complete immediately.
            const isHeader = isParentGroup || !isScheduled;

            if (isHeader && !task.isCompleted) {
                // Call onToggle with 'false' (current status), prompting the handler to flip it to 'true'.
                // The handler in ChoreList will apply the current date.
                onToggle(task.id, false);
            }
        });
    }, [visibleNodes, scheduledTasks, allTasks, isReadOnly, onToggle]);

    if (!scheduledTasks || scheduledTasks.length === 0) return null;

    // --- 3. Render ---
    // (We re-derive isHeader inside the map for rendering convenience, relies on same logic)
    const scheduledIds = new Set(scheduledTasks.map((t) => t.id));

    return (
        <div className="mt-3 mb-2 space-y-2 relative">
            {/* Global Visibility Toggle Removed - Now Controlled by Parent */}

            {visibleNodes.map((task) => {
                const isScheduled = scheduledIds.has(task.id);
                // It is a header if:
                // 1. It acts as a parent to other visible items (hasScheduledChildren)
                // 2. OR it isn't actually scheduled for today (it's just here for context)
                const isParentGroup = hasScheduledChildren(task.id, scheduledIds, allTasks);
                const isHeader = isParentGroup || !isScheduled;

                // Subtitle Logic
                const parentId = getParentId(task);
                let subtitle = null;
                let breadcrumbs = '';

                if (parentId) {
                    const parent = allTasks.find((t) => t.id === parentId);
                    if (parent) {
                        breadcrumbs = parent.text;
                        // Find siblings AND filter out day breaks so they don't inflate the count
                        const siblings = allTasks.filter((t) => getParentId(t) === parentId && !t.isDayBreak).sort((a, b) => (a.order || 0) - (b.order || 0));
                        const index = siblings.findIndex((t) => t.id === task.id) + 1;
                        const total = siblings.length;

                        // Only show if we found the task (it wasn't filtered out as a break itself)
                        if (index > 0) {
                            subtitle = `Task ${index} of ${total}`;
                        }
                    }
                }

                // Check metadata
                const hasNotes = (task as any).notes && (task as any).notes.trim().length > 0;
                const attachments = (task as any).attachments || [];
                const hasAttachments = attachments.length > 0;
                const hasMetadata = hasNotes || hasAttachments;

                // Determine if this task's details are visible (Global toggle OR Local override)
                const isDetailsVisible = showDetails || localExpandedIds.has(task.id);

                const directChildren = allTasks.filter((t) => getParentId(t) === task.id && !t.isDayBreak).sort((a, b) => (a.order || 0) - (b.order || 0));

                // Shared Popover Content Definition to avoid duplication in JSX
                const popoverContent = (
                    <PopoverContent className="w-72 p-3 z-50" align="start" side="right">
                        <div className="space-y-3">
                            <div className="border-b pb-2">
                                <h4 className="font-medium text-sm">Task Details</h4>
                            </div>

                            <div className="space-y-1">
                                <div className="text-sm font-medium">Full Text</div>
                                <p className="text-sm text-muted-foreground bg-muted/20 p-2 rounded select-text">{task.text || '(No text)'}</p>
                            </div>

                            {(task as any).notes ? (
                                <div className="space-y-1">
                                    <div className="text-sm font-medium">Details</div>
                                    <p className="text-sm text-muted-foreground bg-muted/20 p-2 rounded whitespace-pre-wrap select-text">
                                        {(task as any).notes}
                                    </p>
                                </div>
                            ) : null}

                            <div className="text-xs text-muted-foreground space-y-1">
                                {subtitle && <div>Sequence: {subtitle}</div>}
                                {breadcrumbs && <div>Parent: {breadcrumbs}</div>}
                                <div className="font-mono text-[10px] opacity-70 mt-2">ID: {task.id.slice(0, 8)}...</div>
                            </div>

                            {/* List Children if any exist */}
                            {directChildren.length > 0 && (
                                <div className="space-y-1 border-t pt-2 mt-2">
                                    <div className="text-xs font-medium text-muted-foreground">Subtasks ({directChildren.length})</div>
                                    <ul className="text-xs text-muted-foreground space-y-1 max-h-32 overflow-y-auto">
                                        {directChildren.map((child) => (
                                            <li key={child.id} className="flex items-start gap-2">
                                                <span className="opacity-50">•</span>
                                                <span className={cn('select-text', child.isCompleted ? 'line-through opacity-70' : '')}>{child.text}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    </PopoverContent>
                );

                return (
                    <div
                        key={task.id}
                        className={cn('flex items-start group relative pr-2', isHeader ? 'mt-4 mb-1' : 'my-1')}
                        style={{ marginLeft: `${(task.indentationLevel || 0) * 1.5}rem` }}
                    >
                        {/* Connector Lines (Optional polish, kept simple for now) */}

                        <div className="flex-grow flex items-start justify-between min-w-0">
                            {isHeader ? (
                                // --- HEADER VARIANT ---
                                <div className="flex flex-col w-full">
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <div className="flex flex-col cursor-pointer hover:bg-accent/50 rounded px-1 -ml-1 transition-colors">
                                                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground/80">{task.text}</span>
                                            </div>
                                        </PopoverTrigger>
                                        {popoverContent}
                                    </Popover>

                                    {/* Show metadata toggle for headers that have notes/files */}
                                    {hasMetadata && (
                                        <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground mt-0.5 px-1">
                                            {!showDetails && (
                                                <span
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        toggleLocalExpand(task.id);
                                                    }}
                                                    className="text-blue-600 hover:underline cursor-pointer font-normal"
                                                >
                                                    {localExpandedIds.has(task.id) ? 'hide details' : 'view details'}
                                                </span>
                                            )}
                                        </div>
                                    )}

                                    {/* Metadata Details for header tasks */}
                                    {isDetailsVisible && hasMetadata && (
                                        <div className="mt-2 mb-1 p-2 bg-blue-50/50 border border-blue-100 rounded-md text-sm">
                                            {hasNotes && <div className="text-gray-700 whitespace-pre-wrap mb-2 text-xs">{(task as any).notes}</div>}
                                            {hasAttachments && (
                                                <div className="flex flex-wrap gap-2">
                                                    {attachments.map((file: any) => (
                                                        <FileThumbnail key={file.id} file={file} onClick={() => openPreview(file)} />
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                // --- CHECKBOX VARIANT ---
                                <div className="flex flex-col w-full">
                                    {/* Main Row: Checkbox + Text */}
                                    <div className="flex items-start space-x-3 w-full">
                                        {/* Checkbox remains separate from Popover trigger */}

                                        <div className="relative">
                                            <Fireworks active={task.isCompleted} />
                                            <Checkbox
                                                id={`task-${task.id}`}
                                                checked={task.isCompleted}
                                                disabled={isReadOnly}
                                                onCheckedChange={() => onToggle(task.id, task.isCompleted)}
                                                className="mt-0.5 h-4 w-4 border-muted-foreground/50 data-[state=checked]:bg-primary data-[state=checked]:border-primary flex-shrink-0 relative z-10"
                                            />
                                        </div>

                                        {/* Split Trigger and Subtitle/Link to avoid nested buttons */}
                                        <div className="flex flex-col flex-1 min-w-0">
                                            <Popover>
                                                <PopoverTrigger asChild>
                                                    <span
                                                        className={cn(
                                                            'text-sm leading-tight select-text transition-colors hover:text-foreground/80 cursor-text w-fit',
                                                            'group-hover/text:underline decoration-muted-foreground/30 underline-offset-2',
                                                            task.isCompleted
                                                                ? 'text-muted-foreground line-through decoration-muted-foreground/50'
                                                                : 'text-foreground'
                                                        )}
                                                    >
                                                        {task.text}
                                                    </span>
                                                </PopoverTrigger>
                                                {popoverContent}
                                            </Popover>

                                            {/* Subtitle Line with "View Details" Link */}
                                            <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
                                                {subtitle && (
                                                    <span className="group-hover/text:text-muted-foreground/80">
                                                        {subtitle}
                                                        {breadcrumbs && ` in ${breadcrumbs}`}
                                                    </span>
                                                )}

                                                {/* Show link if metadata exists and not already expanded via global toggle */}
                                                {!showDetails && hasMetadata && (
                                                    <>
                                                        {(subtitle || breadcrumbs) && <span> - </span>}
                                                        <span
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                toggleLocalExpand(task.id);
                                                            }}
                                                            className="text-blue-600 hover:underline cursor-pointer font-normal"
                                                        >
                                                            {localExpandedIds.has(task.id) ? 'hide details' : 'view details'}
                                                        </span>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* --- Metadata Details (Conditional Render) --- */}
                                    {isDetailsVisible && hasMetadata && (
                                        <div className="ml-7 mt-2 mb-1 p-2 bg-blue-50/50 border border-blue-100 rounded-md text-sm">
                                            {hasNotes && <div className="text-gray-700 whitespace-pre-wrap mb-2 text-xs select-text">{(task as any).notes}</div>}
                                            {hasAttachments && (
                                                <div className="flex flex-wrap gap-2">
                                                    {attachments.map((file: any) => (
                                                        <FileThumbnail key={file.id} file={file} onClick={() => openPreview(file)} />
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}

            {/* File Preview Modal */}
            <Dialog open={!!previewFile} onOpenChange={(open) => !open && setPreviewFile(null)}>
                <DialogContent
                    className={cn(
                        'flex flex-col p-0 overflow-hidden transition-all duration-300',
                        isExpanded
                            ? 'w-screen h-screen max-w-none max-h-none rounded-none border-0' // Full screen mode
                            : cn(
                                  'max-w-4xl w-[90vw]',
                                  // FIX: Use fixed height 'h-[85vh]' for PDFs so the canvas has space to draw.
                                  // Use 'max-h-[85vh]' for images/text so they shrink to fit.
                                  isPreviewPdf ? 'h-[85vh]' : 'max-h-[85vh]'
                              )
                    )}
                >
                    <DialogHeader className="p-4 border-b flex flex-row items-center justify-between space-y-0 bg-white z-10 shrink-0">
                        <div className="flex items-center gap-2 overflow-hidden flex-1">
                            <DialogTitle className="truncate pr-4">{previewFile?.name}</DialogTitle>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                            {/* Expand/Collapse Button */}
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setIsExpanded(!isExpanded)}
                                className="text-gray-500 hover:bg-gray-100"
                                title={isExpanded ? 'Exit Full Screen' : 'Full Screen'}
                            >
                                {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                            </Button>

                            <DialogClose className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
                                <X className="h-4 w-4" />
                                <span className="sr-only">Close</span>
                            </DialogClose>
                        </div>
                    </DialogHeader>

                    {/* Content area: Fixed height in default mode, Flex grow in expanded mode */}
                    <div
                        className={cn(
                            'flex-1 bg-gray-50 overflow-auto',
                            // We can simplify this now since the parent DialogContent enforces the height constraint
                            'w-full h-full'
                        )}
                    >
                        <div className="min-h-full flex flex-col items-center justify-start h-full">
                            {previewFile && (
                                <>
                                    {/\.(jpg|jpeg|png|webp|gif)$/i.test(previewFile.url) ? (
                                        <div className="p-4 w-full flex justify-center">
                                            <img
                                                src={`/files/${previewFile.url}`}
                                                alt={previewFile.name}
                                                className="max-w-full object-contain shadow-md rounded"
                                            />
                                        </div>
                                    ) : /\.pdf$/i.test(previewFile.url) ? (
                                        // --- PDF VIEWER ---
                                        <PDFPreview url={`/files/${encodeURIComponent(previewFile.url)}`} />
                                    ) : /\.(txt|md|csv|log)$/i.test(previewFile.url) ? (
                                        <div className="p-4 w-full flex justify-center">
                                            {loadingText ? (
                                                <div className="flex items-center gap-2 text-muted-foreground mt-10">
                                                    <Loader2 className="h-6 w-6 animate-spin" /> Loading text...
                                                </div>
                                            ) : (
                                                <div className="bg-white p-6 shadow-sm border rounded w-full max-w-3xl whitespace-pre-wrap font-mono text-base overflow-hidden">
                                                    {fullTextContent}
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="text-center mt-10">
                                            <FileIcon className="h-16 w-16 mx-auto text-gray-300 mb-4" />
                                            <p className="text-muted-foreground mb-4">Preview not available for this file type.</p>
                                            <Button asChild>
                                                <a href={`/files/${previewFile.url}`} download target="_blank" rel="noreferrer">
                                                    Download File
                                                </a>
                                            </Button>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};
