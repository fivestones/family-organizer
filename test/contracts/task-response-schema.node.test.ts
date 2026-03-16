import { describe, expect, it } from 'vitest';
import schema from '@/instant.schema';

const entities = (schema as any).entities;
const links = (schema as any).links;

describe('task response schema contract', () => {
    it('has all task response entities', () => {
        const requiredEntities = [
            'taskResponseFields',
            'taskResponses',
            'taskResponseFieldValues',
            'taskResponseGrades',
            'taskResponseFeedback',
            'taskResponseFeedbackAttachments',
            'gradeTypes',
        ];
        for (const name of requiredEntities) {
            expect(entities, `missing entity: ${name}`).toHaveProperty(name);
        }
    });

    it('tasks entity has weight field', () => {
        expect(entities.tasks.attrs).toHaveProperty('weight');
    });

    it('taskResponseFields has required field', () => {
        expect(entities.taskResponseFields.attrs).toHaveProperty('required');
    });

    it('has all task response links', () => {
        const requiredLinks = [
            'taskResponseFieldsTask',
            'taskResponsesTask',
            'taskResponsesAuthor',
            'taskResponseFieldValuesResponse',
            'taskResponseFieldValuesField',
            'taskResponseGradesResponse',
            'taskResponseGradesField',
            'taskResponseGradesGradeType',
            'taskResponseGradesGrader',
            'taskResponseFeedbackGrade',
            'taskResponseFeedbackAuthor',
            'taskResponseFeedbackAttachmentsFeedback',
        ];
        for (const name of requiredLinks) {
            expect(links, `missing link: ${name}`).toHaveProperty(name);
        }
    });

    it('gradeTypes entity has expected fields', () => {
        const attrs = entities.gradeTypes.attrs;
        for (const field of ['name', 'kind', 'highValue', 'lowValue', 'highLabel', 'lowLabel', 'isDefault', 'order', 'steps']) {
            expect(attrs, `missing field: ${field}`).toHaveProperty(field);
        }
    });
});
