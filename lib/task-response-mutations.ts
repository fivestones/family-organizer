// lib/task-response-mutations.ts
// Transaction builders for task responses, grading, and feedback.

import { tx, id as createId } from '@instantdb/react';
import type { TaskResponseStatus } from './task-response-types';

export interface DraftFieldValueParams {
    responseId: string;
    fieldId: string;
    richTextContent?: string | null;
    fileUrl?: string | null;
    fileName?: string | null;
    fileType?: string | null;
    fileSizeBytes?: number | null;
    thumbnailUrl?: string | null;
    /** If an existing field value row exists, pass its ID to update; else pass null to create. */
    existingValueId?: string | null;
}

export function buildDraftFieldValueTransactions(params: DraftFieldValueParams) {
    const valueId = params.existingValueId || createId();
    const now = Date.now();

    const txns = [
        tx.taskResponseFieldValues[valueId].update({
            richTextContent: params.richTextContent ?? null,
            fileUrl: params.fileUrl ?? null,
            fileName: params.fileName ?? null,
            fileType: params.fileType ?? null,
            fileSizeBytes: params.fileSizeBytes ?? null,
            thumbnailUrl: params.thumbnailUrl ?? null,
            createdAt: now,
            updatedAt: now,
        }),
    ];

    // Only link on first creation
    if (!params.existingValueId) {
        txns.push(
            tx.taskResponseFieldValues[valueId].link({ response: params.responseId }),
            tx.taskResponseFieldValues[valueId].link({ field: params.fieldId }),
        );
    }

    return { transactions: txns, valueId };
}

export interface CreateDraftResponseParams {
    taskId: string;
    authorFamilyMemberId: string;
}

export function buildCreateDraftResponseTransactions(params: CreateDraftResponseParams) {
    const responseId = createId();
    const now = Date.now();

    return {
        transactions: [
            tx.taskResponses[responseId].update({
                status: 'draft' satisfies TaskResponseStatus,
                version: 1,
                createdAt: now,
                updatedAt: now,
            }),
            tx.taskResponses[responseId].link({ task: params.taskId }),
            tx.taskResponses[responseId].link({ author: params.authorFamilyMemberId }),
        ],
        responseId,
    };
}

export interface SubmitResponseParams {
    responseId: string;
    version: number;
}

export function buildSubmitResponseTransactions(params: SubmitResponseParams) {
    const now = Date.now();
    return [
        tx.taskResponses[params.responseId].update({
            status: 'submitted' satisfies TaskResponseStatus,
            submittedAt: now,
            updatedAt: now,
            version: params.version,
        }),
    ];
}

export interface CreateRevisionResponseParams {
    taskId: string;
    authorFamilyMemberId: string;
    previousVersion: number;
}

export function buildCreateRevisionResponseTransactions(params: CreateRevisionResponseParams) {
    const responseId = createId();
    const now = Date.now();

    return {
        transactions: [
            tx.taskResponses[responseId].update({
                status: 'draft' satisfies TaskResponseStatus,
                version: params.previousVersion + 1,
                createdAt: now,
                updatedAt: now,
            }),
            tx.taskResponses[responseId].link({ task: params.taskId }),
            tx.taskResponses[responseId].link({ author: params.authorFamilyMemberId }),
        ],
        responseId,
    };
}

export interface GradeParams {
    responseId: string;
    fieldId?: string | null;
    gradeTypeId: string;
    graderFamilyMemberId: string;
    numericValue: number;
    displayValue: string;
}

export function buildGradeTransactions(params: GradeParams) {
    const gradeId = createId();
    const now = Date.now();

    const txns = [
        tx.taskResponseGrades[gradeId].update({
            numericValue: params.numericValue,
            displayValue: params.displayValue,
            createdAt: now,
            updatedAt: now,
        }),
        tx.taskResponseGrades[gradeId].link({ response: params.responseId }),
        tx.taskResponseGrades[gradeId].link({ gradeType: params.gradeTypeId }),
        tx.taskResponseGrades[gradeId].link({ grader: params.graderFamilyMemberId }),
    ];

    if (params.fieldId) {
        txns.push(tx.taskResponseGrades[gradeId].link({ field: params.fieldId }));
    }

    return { transactions: txns, gradeId };
}

export interface FeedbackParams {
    gradeId: string;
    authorFamilyMemberId: string;
    text?: string | null;
    attachments?: Array<{
        id: string;
        name: string;
        type: string;
        url: string;
        kind?: string | null;
        sizeBytes?: number | null;
        thumbnailUrl?: string | null;
        width?: number | null;
        height?: number | null;
        durationSec?: number | null;
        blurhash?: string | null;
        waveformPeaks?: number[] | null;
    }>;
}

export function buildFeedbackTransactions(params: FeedbackParams) {
    const feedbackId = createId();
    const now = Date.now();

    const txns = [
        tx.taskResponseFeedback[feedbackId].update({
            text: params.text?.trim() || null,
            createdAt: now,
            updatedAt: now,
        }),
        tx.taskResponseFeedback[feedbackId].link({ grade: params.gradeId }),
        tx.taskResponseFeedback[feedbackId].link({ author: params.authorFamilyMemberId }),
    ];

    if (params.attachments?.length) {
        for (const attachment of params.attachments) {
            const attId = attachment.id || createId();
            txns.push(
                tx.taskResponseFeedbackAttachments[attId].update({
                    name: attachment.name,
                    type: attachment.type,
                    url: attachment.url,
                    kind: attachment.kind || null,
                    sizeBytes: attachment.sizeBytes ?? null,
                    thumbnailUrl: attachment.thumbnailUrl || null,
                    width: attachment.width ?? null,
                    height: attachment.height ?? null,
                    durationSec: attachment.durationSec ?? null,
                    blurhash: attachment.blurhash || null,
                    waveformPeaks: attachment.waveformPeaks || null,
                    createdAt: now,
                    updatedAt: now,
                }),
                tx.taskResponseFeedbackAttachments[attId].link({ feedback: feedbackId }),
            );
        }
    }

    return { transactions: txns, feedbackId };
}

export function buildRevisionRequestTransactions(responseId: string) {
    return [
        tx.taskResponses[responseId].update({
            status: 'revision_requested' satisfies TaskResponseStatus,
            updatedAt: Date.now(),
        }),
    ];
}

export function buildCompleteGradingTransactions(responseId: string) {
    return [
        tx.taskResponses[responseId].update({
            status: 'graded' satisfies TaskResponseStatus,
            updatedAt: Date.now(),
        }),
    ];
}
