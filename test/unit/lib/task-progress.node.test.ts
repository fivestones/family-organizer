import { describe, expect, it } from 'vitest';
import {
    getLatestTaskFeedbackThread,
    getTaskUpdateFeedbackReplies,
    taskUpdateHasMeaningfulFeedbackContent,
    type TaskUpdateLike,
} from '@/lib/task-progress';

function makeUpdate(id: string, createdAt: number, overrides: Partial<TaskUpdateLike> = {}): TaskUpdateLike {
    return {
        id,
        createdAt,
        isDraft: false,
        toState: 'in_progress',
        fromState: 'in_progress',
        ...overrides,
    };
}

describe('task-progress feedback threading helpers', () => {
    it('surfaces the latest reviewed response even when newer no-op updates exist', () => {
        const submission = makeUpdate('submission-1', 1_000, {
            responseFieldValues: [{ id: 'field-value-1', richTextContent: '<p>Initial answer</p>' }],
            replies: [
                makeUpdate('feedback-1', 2_000, {
                    replyTo: [{ id: 'submission-1' }],
                    note: 'Please explain this more clearly.',
                }),
            ],
        });

        const noOpUpdate = makeUpdate('noop-1', 3_000, {
            note: '   ',
        });

        const thread = getLatestTaskFeedbackThread([submission, noOpUpdate]);

        expect(thread?.submission.id).toBe('submission-1');
        expect(thread?.feedbackReplies.map((reply) => reply.id)).toEqual(['feedback-1']);
    });

    it('does not surface older feedback once a newer response has been submitted', () => {
        const submission = makeUpdate('submission-1', 1_000, {
            responseFieldValues: [{ id: 'field-value-1', richTextContent: '<p>Initial answer</p>' }],
            replies: [
                makeUpdate('feedback-1', 2_000, {
                    replyTo: [{ id: 'submission-1' }],
                    note: 'Please revise this.',
                }),
            ],
        });

        const newerSubmission = makeUpdate('submission-2', 4_000, {
            responseFieldValues: [{ id: 'field-value-2', richTextContent: '<p>Revised answer</p>' }],
        });

        expect(getLatestTaskFeedbackThread([submission, newerSubmission])).toBeNull();
    });

    it('treats grade-only replies as meaningful feedback and keeps reply order chronological', () => {
        const replies = [
            makeUpdate('feedback-2', 3_000, {
                replyTo: [{ id: 'submission-1' }],
                gradeDisplayValue: 'A-',
                gradeNumericValue: 91,
            }),
            makeUpdate('feedback-1', 2_000, {
                replyTo: [{ id: 'submission-1' }],
                note: 'Nice improvement.',
            }),
        ];

        expect(taskUpdateHasMeaningfulFeedbackContent(replies[0])).toBe(true);
        expect(getTaskUpdateFeedbackReplies(replies).map((reply) => reply.id)).toEqual(['feedback-1', 'feedback-2']);
    });
});
