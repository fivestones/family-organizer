'use client';

import { getAttachmentKind, type AppAttachment } from '@family-organizer/shared-core';
import { finalizeUploadedAttachmentAction, getPresignedUploadUrl } from '@/app/actions';

export interface UploadedFileAttachment extends AppAttachment {
    id: string;
    name: string;
    type: string;
    url: string;
}

type LocalAttachmentMetadata = {
    width?: number | null;
    height?: number | null;
    durationSec?: number | null;
    thumbnailBlob?: Blob | null;
    thumbnailFileName?: string | null;
    thumbnailWidth?: number | null;
    thumbnailHeight?: number | null;
    waveformPeaks?: number[] | null;
};

function revokeObjectUrl(url: string | null) {
    if (url) {
        URL.revokeObjectURL(url);
    }
}

async function uploadBlobToS3(blob: Blob, fileName: string, contentType: string) {
    const { url, fields, key } = await getPresignedUploadUrl(contentType || 'application/octet-stream', fileName);
    const formData = new FormData();
    Object.entries(fields).forEach(([fieldKey, fieldValue]) => {
        formData.append(fieldKey, fieldValue as string);
    });
    formData.append('file', blob, fileName);

    const uploadResponse = await fetch(url, {
        method: 'POST',
        body: formData,
    });

    if (uploadResponse.status >= 400) {
        throw new Error(`Upload failed for ${fileName}`);
    }

    return key;
}

async function readImageDimensions(file: File) {
    const objectUrl = URL.createObjectURL(file);
    try {
        const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
            image.onerror = () => reject(new Error('Unable to read image metadata'));
            image.src = objectUrl;
        });
        return dimensions;
    } finally {
        revokeObjectUrl(objectUrl);
    }
}

async function readMediaElementMetadata(file: File, tagName: 'video' | 'audio') {
    const objectUrl = URL.createObjectURL(file);
    try {
        return await new Promise<{
            durationSec: number | null;
            width: number | null;
            height: number | null;
            element: HTMLMediaElement;
        }>((resolve, reject) => {
            const media = document.createElement(tagName);
            media.preload = 'metadata';
            media.crossOrigin = 'anonymous';
            if (tagName === 'video') {
                const video = media as HTMLVideoElement;
                video.muted = true;
                video.playsInline = true;
            }
            media.onloadedmetadata = () =>
                resolve({
                    durationSec: Number.isFinite(media.duration) ? media.duration : null,
                    width: tagName === 'video' ? (media as HTMLVideoElement).videoWidth || null : null,
                    height: tagName === 'video' ? (media as HTMLVideoElement).videoHeight || null : null,
                    element: media,
                });
            media.onerror = () => reject(new Error(`Unable to read ${tagName} metadata`));
            media.src = objectUrl;
        });
    } finally {
        revokeObjectUrl(objectUrl);
    }
}

async function captureVideoPoster(file: File) {
    const objectUrl = URL.createObjectURL(file);
    try {
        const video = document.createElement('video');
        video.preload = 'auto';
        video.muted = true;
        video.playsInline = true;
        video.crossOrigin = 'anonymous';
        video.src = objectUrl;

        await new Promise<void>((resolve, reject) => {
            video.onloadedmetadata = () => {
                const targetTime =
                    Number.isFinite(video.duration) && video.duration > 0
                        ? Math.min(0.15, Math.max(video.duration * 0.1, 0))
                        : 0;
                if (targetTime <= 0) {
                    resolve();
                    return;
                }
                video.currentTime = targetTime;
            };
            video.onseeked = () => resolve();
            video.onerror = () => reject(new Error('Unable to capture video poster'));
        });

        const width = video.videoWidth || 0;
        const height = video.videoHeight || 0;
        if (!width || !height) return null;

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) return null;

        context.drawImage(video, 0, 0, width, height);
        const blob = await new Promise<Blob | null>((resolve) => {
            canvas.toBlob(resolve, 'image/jpeg', 0.84);
        });

        if (!blob) return null;
        return {
            blob,
            width,
            height,
        };
    } finally {
        revokeObjectUrl(objectUrl);
    }
}

async function extractAudioWaveform(file: File, barCount = 48) {
    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return null;

    const context = new AudioContextCtor();
    try {
        const fileBuffer = await file.arrayBuffer();
        const audioBuffer = await context.decodeAudioData(fileBuffer.slice(0));
        const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, index) => audioBuffer.getChannelData(index));
        const sampleCount = channels[0]?.length || 0;
        if (!sampleCount) return null;

        const blockSize = Math.max(1, Math.floor(sampleCount / barCount));
        const peaks = Array.from({ length: barCount }).map((_, index) => {
            const start = index * blockSize;
            const end = Math.min(sampleCount, start + blockSize);
            let peak = 0;

            for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
                const channel = channels[channelIndex];
                for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
                    peak = Math.max(peak, Math.abs(channel[sampleIndex] || 0));
                }
            }

            return Number(peak.toFixed(4));
        });

        return peaks;
    } catch (error) {
        console.error('Unable to extract audio waveform', error);
        return null;
    } finally {
        await context.close().catch(() => {});
    }
}

async function extractLocalAttachmentMetadata(file: File): Promise<LocalAttachmentMetadata> {
    const kind = getAttachmentKind({ type: file.type, url: file.name });

    if (kind === 'image') {
        const dimensions = await readImageDimensions(file).catch(() => null);
        return {
            width: dimensions?.width ?? null,
            height: dimensions?.height ?? null,
        };
    }

    if (kind === 'video') {
        const metadata = await readMediaElementMetadata(file, 'video').catch(() => null);
        const poster = await captureVideoPoster(file).catch(() => null);
        const baseName = file.name.replace(/\.[^.]+$/, '') || 'video';
        return {
            width: metadata?.width ?? poster?.width ?? null,
            height: metadata?.height ?? poster?.height ?? null,
            durationSec: metadata?.durationSec ?? null,
            thumbnailBlob: poster?.blob ?? null,
            thumbnailFileName: poster?.blob ? `${baseName}-poster.jpg` : null,
            thumbnailWidth: poster?.width ?? null,
            thumbnailHeight: poster?.height ?? null,
        };
    }

    if (kind === 'audio') {
        const metadata = await readMediaElementMetadata(file, 'audio').catch(() => null);
        const waveformPeaks = await extractAudioWaveform(file).catch(() => null);
        return {
            durationSec: metadata?.durationSec ?? null,
            waveformPeaks,
        };
    }

    return {};
}

export async function uploadFilesToS3(files: File[], createId: () => string): Promise<UploadedFileAttachment[]> {
    const uploadedAttachments: UploadedFileAttachment[] = [];

    for (const file of files) {
        const contentType = file.type || 'application/octet-stream';
        const localMetadata: LocalAttachmentMetadata = await extractLocalAttachmentMetadata(file).catch((error) => {
            console.error('Unable to extract local attachment metadata', error);
            return {};
        });

        const objectKey = await uploadBlobToS3(file, file.name, contentType);
        let thumbnailKey: string | null = null;

        if (localMetadata.thumbnailBlob && localMetadata.thumbnailFileName) {
            thumbnailKey = await uploadBlobToS3(localMetadata.thumbnailBlob, localMetadata.thumbnailFileName, 'image/jpeg');
        }

        const finalized = await finalizeUploadedAttachmentAction({
            objectKey,
            fileName: file.name,
            contentType,
            width: localMetadata.width ?? null,
            height: localMetadata.height ?? null,
            durationSec: localMetadata.durationSec ?? null,
            thumbnailUrl: thumbnailKey,
            thumbnailWidth: localMetadata.thumbnailWidth ?? null,
            thumbnailHeight: localMetadata.thumbnailHeight ?? null,
            waveformPeaks: localMetadata.waveformPeaks ?? null,
        });

        uploadedAttachments.push({
            id: createId(),
            ...finalized,
        });
    }

    return uploadedAttachments;
}
