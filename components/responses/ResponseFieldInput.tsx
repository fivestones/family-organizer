'use client';

import React, { useRef } from 'react';
import { Upload, X, FileText, Image, Film, Mic, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RichTextEditor } from '@/components/responses/RichTextEditor';
import type { TaskResponseFieldType } from '@/lib/task-response-types';
import { RESPONSE_FIELD_TYPE_LABELS } from '@/lib/task-response-types';

interface Props {
    fieldId: string;
    type: TaskResponseFieldType;
    label: string;
    description?: string | null;
    required: boolean;
    /** Current rich text content (for rich_text type). */
    richTextContent?: string | null;
    /** Current file URL (for media/file types). */
    fileUrl?: string | null;
    fileName?: string | null;
    fileType?: string | null;
    /** Called when rich text changes. */
    onRichTextChange?: (content: string) => void;
    /** Called when files are selected for upload. */
    onFileSelect?: (files: File[]) => void;
    /** Called to clear the current file. */
    onFileClear?: () => void;
    isUploading?: boolean;
    disabled?: boolean;
    onExpand?: () => void;
}

const fieldTypeIcon: Record<TaskResponseFieldType, React.ReactNode> = {
    rich_text: <FileText className="h-4 w-4" />,
    photo: <Image className="h-4 w-4" />,
    video: <Film className="h-4 w-4" />,
    audio: <Mic className="h-4 w-4" />,
    file: <FileText className="h-4 w-4" />,
};

const acceptMap: Record<string, string> = {
    photo: 'image/*',
    video: 'video/*',
    audio: 'audio/*',
    file: '*/*',
};

export const ResponseFieldInput: React.FC<Props> = ({
    fieldId,
    type,
    label,
    description,
    required,
    richTextContent,
    fileUrl,
    fileName,
    fileType,
    onRichTextChange,
    onFileSelect,
    onFileClear,
    isUploading,
    disabled,
    onExpand,
}) => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            onFileSelect?.(Array.from(files));
        }
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    if (type === 'rich_text') {
        return (
            <div className="space-y-2">
                <FieldHeader type={type} label={label} description={description} required={required} />
                <RichTextEditor
                    content={richTextContent || ''}
                    onContentChange={(html) => onRichTextChange?.(html)}
                    disabled={disabled}
                    onExpand={onExpand}
                />
            </div>
        );
    }

    // Media / file type
    return (
        <div className="space-y-2">
            <FieldHeader type={type} label={label} description={description} required={required} />
            {fileUrl ? (
                <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                    <FilePreview fileUrl={fileUrl} fileName={fileName} fileType={fileType} type={type} />
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-700">{fileName || 'Uploaded file'}</p>
                        <p className="text-xs text-slate-500">{RESPONSE_FIELD_TYPE_LABELS[type]}</p>
                    </div>
                    {!disabled && (
                        <button
                            type="button"
                            onClick={onFileClear}
                            className="rounded-full p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </div>
            ) : (
                <div className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50/50 px-4 py-6">
                    {isUploading ? (
                        <>
                            <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                            <p className="text-sm text-slate-500">Uploading...</p>
                        </>
                    ) : (
                        <>
                            <div className="rounded-full bg-slate-100 p-2 text-slate-400">
                                {fieldTypeIcon[type]}
                            </div>
                            <p className="text-sm text-slate-500">
                                Upload {RESPONSE_FIELD_TYPE_LABELS[type].toLowerCase()}
                            </p>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={disabled}
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <Upload className="mr-1.5 h-3.5 w-3.5" />
                                Choose file
                            </Button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept={acceptMap[type] || '*/*'}
                                className="hidden"
                                onChange={handleFileChange}
                            />
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

function FieldHeader({
    label,
    description,
    required,
}: {
    type?: TaskResponseFieldType;
    label: string;
    description?: string | null;
    required: boolean;
}) {
    return (
        <div>
            <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium text-slate-800">{label}</span>
                {required && (
                    <span className="text-xs font-medium text-rose-500">Required</span>
                )}
            </div>
            {description && (
                <p className="mt-0.5 text-xs text-slate-500">{description}</p>
            )}
        </div>
    );
}

function FilePreview({
    fileUrl,
    fileName,
    fileType,
    type,
}: {
    fileUrl: string;
    fileName?: string | null;
    fileType?: string | null;
    type: TaskResponseFieldType;
}) {
    const mimeType = fileType || '';

    if (type === 'photo' || mimeType.startsWith('image/')) {
        return (
            <img
                src={fileUrl}
                alt={fileName || 'Uploaded image'}
                className="h-12 w-12 rounded-md object-cover"
            />
        );
    }

    if (type === 'video' || mimeType.startsWith('video/')) {
        return (
            <div className="flex h-12 w-12 items-center justify-center rounded-md bg-slate-200">
                <Film className="h-5 w-5 text-slate-500" />
            </div>
        );
    }

    if (type === 'audio' || mimeType.startsWith('audio/')) {
        return (
            <div className="flex h-12 w-12 items-center justify-center rounded-md bg-slate-200">
                <Mic className="h-5 w-5 text-slate-500" />
            </div>
        );
    }

    return (
        <div className="flex h-12 w-12 items-center justify-center rounded-md bg-slate-200">
            <FileText className="h-5 w-5 text-slate-500" />
        </div>
    );
}
