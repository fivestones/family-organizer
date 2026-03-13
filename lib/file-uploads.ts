'use client';

import { getPresignedUploadUrl } from '@/app/actions';

export interface UploadedFileAttachment {
    id: string;
    name: string;
    type: string;
    url: string;
}

export async function uploadFilesToS3(files: File[], createId: () => string): Promise<UploadedFileAttachment[]> {
    const uploadedAttachments: UploadedFileAttachment[] = [];

    for (const file of files) {
        const contentType = file.type || 'application/octet-stream';
        const { url, fields, key } = await getPresignedUploadUrl(contentType, file.name);
        const formData = new FormData();
        Object.entries(fields).forEach(([fieldKey, fieldValue]) => {
            formData.append(fieldKey, fieldValue as string);
        });
        formData.append('file', file);

        const uploadResponse = await fetch(url, {
            method: 'POST',
            body: formData,
        });

        if (uploadResponse.status >= 400) {
            throw new Error(`Upload failed for ${file.name}`);
        }

        uploadedAttachments.push({
            id: createId(),
            name: file.name,
            type: contentType,
            url: key,
        });
    }

    return uploadedAttachments;
}
